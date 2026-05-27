'use client';

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
  query,
  where,
  orderBy,
  increment,
} from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { auth, db } from './firebase';
import { stripUndefined } from './firestoreUtil';
import type { BlindLevel, PayoutStructure, PrizeDisplayUnit, TournamentTemplate } from './templates';
import { computeAutoPrizePool, resolvePayoutStructure, resolveShowPrizePool } from './templates';

/**
 * LIVE 세션 상태.
 * - ready: 토너 생성됨, 사장이 아직 시작 버튼을 누르지 않은 대기 상태. 모바일/지도 LIVE 피드에는 노출 X.
 * - running: 진행 중 (deadline 기반 카운트다운).
 * - paused: 일시정지 (deadline=null, levelSecondsLeft 보존).
 * - break: 브레이크.
 * - completed: 종료 (LIVE 피드에서 제외).
 */
export type LiveStatus = 'ready' | 'running' | 'paused' | 'break' | 'completed';

export interface LiveSession {
  id: string;
  storeId: string;
  storeName: string;
  templateId: string;
  tournamentName: string;
  tournamentType: string;
  posterStyle: string;
  buyIn: number;
  totalPlayers: number;
  blindStructure: BlindLevel[];
  lateRegEndLevel: number;
  /** 실제 등록 인원(엔트리 수). 사장이 토너 운영 > 타이머에서 실시간 조절.
   *  탈락 차감 X (그건 playersRemaining). prizePool 계산의 기준.
   *  누락 시 totalPlayers fallback (백워드 호환). 2026-05-23 신설. */
  currentEntries?: number;
  /** 리바인 총 횟수. 사장이 +1/-1 버튼으로 조절.
   *  prizePool = (currentEntries + rebuysCount) × buyIn × payoutPercent / 100.
   *  누락 시 0 fallback. 2026-05-23 신설. */
  rebuysCount?: number;
  /** 스타팅칩 — LiveSession 레벨에서 사장이 실시간 변경 가능. 누락 시 템플릿 값 fallback. 2026-05-23 신설. */
  startingStack?: number;
  // 진행 상태
  status: LiveStatus;
  currentLevel: number;
  /** 현재 레벨에 "남은 초" — paused/break일 때만 의미 있음.
   *  running일 때는 levelEndsAt이 진실의 원천. levelEndsAt이 없는 레거시 세션의 fallback으로도 사용. */
  levelSecondsLeft: number;
  /** 현재 레벨이 끝나는 절대 시각. running일 때만 유효 (paused 시 null로 설정).
   *  모든 클라이언트가 같은 deadline을 보고 자기 시계로 카운트다운. */
  levelEndsAt?: Timestamp | null;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  playersRemaining: number;
  tablesRemaining: number;
  prizePool: number;
  lateRegClosed: boolean;
  viewerCount: number;
  createdAt?: Timestamp;
  startedAt?: unknown;
  endedAt?: unknown;
  /** 마지막 레벨까지 모두 진행되어 자동 종료 카운트다운 시작 시각.
   *  설정되면 FINISHING_GRACE_SEC 동안 "곧 종료" 깜빡임 노출 후 stopLiveSession으로 정리.
   *  매장 사장 LivePanel(권한 보유 클라이언트)이 만료 시 자동 호출.
   *  모바일/지도는 그레이스 만료된 세션을 클라이언트 필터로 가림 (안전망). */
  finishingAt?: Timestamp | null;
  /** Deterministic timeline — 1레벨이 처음 시작한 절대 시각. ready→running 첫 전환 시점에 박힘.
   *  이후 togglePause·다음 레벨 진입 등으로 절대 갱신되지 않음. */
  totalStartedAt?: Timestamp | null;
  /** 누적 일시정지 시간(ms). resume 시점에 (now - pausedAt)을 더함. */
  totalPausedMs?: number;
  /** running→paused 전환 시점 절대 시각. resume 시 totalPausedMs 계산에 사용 후 null 해제. */
  pausedAt?: Timestamp | null;
  /** 시작 시점에 고정된 blindStructure 스냅샷.
   *  사장이 도중에 템플릿/blindStructure를 수정해도 영향 없음.
   *  computeTimelinePosition의 진실의 원천. */
  blindStructureLocked?: BlindLevel[];
  /** 시작 시점에 고정된 상금 분배 정책 스냅샷 — Phase 3 (2026-05-21).
   *  사장이 도중에 템플릿 분배 정책을 바꿔도 진행 중 세션엔 영향 없음.
   *  매장 TV 분배표(PrizeDistributionPanel)가 우선 사용. 없으면 computeAutoITM fallback. */
  payoutStructure?: PayoutStructure;
  /** 시작 시점에 고정된 상금 표시 단위 스냅샷 — Phase 4 (2026-05-21).
   *  사장이 도중에 템플릿 표시 단위를 바꿔도 진행 중 세션엔 영향 없음.
   *  매장 TV·LivePanel·TournamentControlCenter 표기에 사용. 없으면 'ticket' fallback. */
  prizeDisplayUnit?: PrizeDisplayUnit;
  /** 시작 시점에 고정된 프라이즈풀 노출 스냅샷 — 2026-05-23.
   *  사장이 도중에 템플릿 토글을 바꿔도 진행 중 세션엔 영향 없음.
   *  매장 TV 우측 stat의 PRIZE POOL 카드 노출 여부. 없으면 true (기존 호환). */
  showPrizePool?: boolean;
  /** 다음 레벨이 시작될 예정 절대 시각 — 2026-05-23.
   *  LIVE 첫 시작 / 매 레벨 advance / pause→resume 시점에 갱신.
   *  클라가 sec=0 도달 시 advanceLevelIfDue로 transaction 진행. 서버 cron은 이 시각이
   *  지난 세션을 catch-up. 마지막 레벨이면 null (autoStopFinishedSessions 영역).
   *
   *  결정 근거: 기존 cron 1분 평균 30초 지연 → 사운드 발사가 30초 늦음. 클라가 직접
   *  transaction으로 doc을 advance하면 즉시 currentLevel 변경 → onSnapshot 리스너가
   *  바로 다음 레벨 TTS 발사. cron은 fallback. */
  nextLevelAt?: Timestamp | null;
}

/** 마지막 레벨 종료 후 자동 정리까지의 그레이스(초). */
export const FINISHING_GRACE_SEC = 180;

/** ready 상태로 등록만 되고 시작 안 한 세션의 자동 정리까지 만료(초). */
export const READY_EXPIRY_SEC = 300;

/** 남은 그레이스 초. finishingAt 없으면 null, 만료 시 0 이하. */
export function computeFinishingGraceSec(s: LiveSession): number | null {
  if (!s.finishingAt) return null;
  const endsMs = s.finishingAt.toMillis() + FINISHING_GRACE_SEC * 1000;
  return Math.floor((endsMs - Date.now()) / 1000);
}

/** ready 만료까지 남은 초. ready 아니거나 createdAt 없으면 null. 만료 시 0 이하. */
export function computeReadyExpirySec(s: LiveSession): number | null {
  if (s.status !== 'ready') return null;
  const created = s.createdAt as Timestamp | undefined;
  if (!created || typeof created.toMillis !== 'function') return null;
  const endsMs = created.toMillis() + READY_EXPIRY_SEC * 1000;
  return Math.floor((endsMs - Date.now()) / 1000);
}

/** 세션이 만료 상태인지 — 두 가지 케이스 통합:
 *  ① 그레이스 만료 (finishingAt + 180초)
 *  ② ready 만료 (createdAt + 5분)
 *
 *  ⚠ 2026-05-21 3차 핫픽스 (사용자 보고: 12레벨 토너인데 중간에 사라짐):
 *    finishingAt이 박혀있어도 currentLevel이 진짜 마지막 레벨이 아니면 expired로
 *    판정하지 않는다. cron의 sanity guard가 한 번이라도 뚫리면 finishingAt이 잘못
 *    박힐 수 있는데, 클라이언트가 그 잘못된 finishingAt을 신뢰해 세션을 화면에서
 *    가리면 사용자는 "타이머 중도종료"로 인지한다. structure 기반 elapsed로 한 번 더 검증.
 *
 *  ⚠ 과거에 있던 "levelEndsAt + 180초 = 좀비" 룰은 **제거**됨.
 *    Deterministic timeline 도입 후 autoAdvanceLevel cron은 같은 currentLevel이면
 *    doc update를 의도적으로 skip한다. 좀비 세션 정리는 서버 cron이 totalStartedAt +
 *    structure로 실제 elapsed를 계산해 처리한다.
 */
function isSessionExpired(s: LiveSession): boolean {
  if (s.finishingAt) {
    const endsMs = s.finishingAt.toMillis() + FINISHING_GRACE_SEC * 1000;
    if (endsMs <= Date.now()) {
      // 2026-05-21 3차 핫픽스: finishingAt이 잘못 박힌 케이스 방어.
      // structure를 보고 currentLevel이 진짜 마지막 레벨인지 검증.
      const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
        ? s.blindStructureLocked
        : s.blindStructure;
      const lastLevelNum = structure && structure.length > 0
        ? structure[structure.length - 1].level
        : -1;
      const isReallyLastLevel = s.currentLevel === lastLevelNum && lastLevelNum > 0;
      if (!isReallyLastLevel) {
        // 잘못 박힌 finishingAt — expired 판정 거부. 화면에서 가리지 않음.
        // (별도 자가 치유 로직이 finishingAt 자체를 null로 복구함)
        // eslint-disable-next-line no-console
        console.warn(
          `[isSessionExpired] BLOCKED — finishingAt 박혔지만 currentLevel=${s.currentLevel}이 ` +
          `lastLevelNum=${lastLevelNum} 아님. 잘못 박힌 finishingAt으로 추정.`
        );
        return false;
      }
      return true;
    }
  }
  if (s.status === 'ready') {
    const created = s.createdAt as Timestamp | undefined;
    if (created && typeof created.toMillis === 'function') {
      const endsMs = created.toMillis() + READY_EXPIRY_SEC * 1000;
      if (endsMs <= Date.now()) return true;
    }
  }
  return false;
}

export function liveSessionsCol() {
  return collection(db, 'liveSessions');
}

/** "지금부터 N초 후" Timestamp 생성 (Firestore는 add-seconds 연산을 지원 안 해서 클라 시계 기준). */
function deadlineFromNow(seconds: number): Timestamp {
  return Timestamp.fromMillis(Date.now() + Math.max(0, seconds) * 1000);
}

/** 세션 객체에서 현재 표시할 남은 초 계산 (레거시 호환).
 *  Deterministic timeline이 박혀있으면 그걸 우선 사용.
 *  없으면 legacy fallback (running + levelEndsAt) → 마지막엔 levelSecondsLeft. */
export function computeRemainingSec(s: LiveSession): number {
  if (s.totalStartedAt) {
    const pos = computeTimelinePosition(s);
    return pos.secondsLeft;
  }
  if (s.status === 'running' && s.levelEndsAt) {
    const endsMs = s.levelEndsAt.toMillis();
    return Math.max(0, Math.floor((endsMs - Date.now()) / 1000));
  }
  return Math.max(0, s.levelSecondsLeft);
}

/**
 * Deterministic timeline 위치 계산.
 *
 * 절대 시각 기반으로 "지금 어느 레벨인지·해당 레벨이 몇 초 남았는지" 결정.
 * - totalStartedAt 없음 → legacy fallback (저장된 currentLevel/levelSecondsLeft/levelEndsAt)
 * - paused → pausedAt 기준으로 elapsed 정지
 * - running → now - totalStartedAt - totalPausedMs 만큼 진행된 위치 계산
 * - 마지막 레벨까지 모두 소진 → isFinishing=true, level=마지막 레벨, secondsLeft=0
 *
 * blindStructureLocked가 있으면 그걸 사용 (시작 시점 스냅샷). 없으면 blindStructure.
 */
export function computeTimelinePosition(s: LiveSession): {
  level: number;
  secondsLeft: number;
  isFinishing: boolean;
  sb: number;
  bb: number;
  ante: number;
} {
  const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
    ? s.blindStructureLocked
    : s.blindStructure;

  // Fallback: totalStartedAt이 없는 레거시 세션
  if (!s.totalStartedAt || !structure || structure.length === 0) {
    const cur = structure?.find((l) => l.level === s.currentLevel) ?? structure?.[0];
    let secondsLeft = Math.max(0, s.levelSecondsLeft ?? 0);
    if (s.status === 'running' && s.levelEndsAt) {
      secondsLeft = Math.max(0, Math.floor((s.levelEndsAt.toMillis() - Date.now()) / 1000));
    }
    return {
      level: s.currentLevel ?? cur?.level ?? 1,
      secondsLeft,
      isFinishing: !!s.finishingAt,
      sb: cur?.sb ?? s.smallBlind ?? 0,
      bb: cur?.bb ?? s.bigBlind ?? 0,
      ante: cur?.ante ?? s.ante ?? 0,
    };
  }

  // 절대 시각 기반 계산
  const startedMs = s.totalStartedAt.toMillis();
  const totalPausedMs = s.totalPausedMs ?? 0;
  // paused면 elapsed가 pausedAt에서 정지
  const refNowMs = s.status === 'paused' && s.pausedAt
    ? s.pausedAt.toMillis()
    : Date.now();
  const elapsedMs = Math.max(0, refNowMs - startedMs - totalPausedMs);

  let cumulativeMs = 0;
  for (const lvl of structure) {
    const durMs = Math.max(0, lvl.durationSec) * 1000;
    if (cumulativeMs + durMs > elapsedMs) {
      const secondsLeft = Math.max(0, Math.ceil((cumulativeMs + durMs - elapsedMs) / 1000));
      return {
        level: lvl.level,
        secondsLeft,
        isFinishing: false,
        sb: lvl.sb,
        bb: lvl.bb,
        ante: lvl.ante,
      };
    }
    cumulativeMs += durMs;
  }

  // 마지막 레벨까지 다 지남
  const last = structure[structure.length - 1];
  return {
    level: last.level,
    secondsLeft: 0,
    isFinishing: true,
    sb: last.sb,
    bb: last.bb,
    ante: last.ante,
  };
}

/** 표시용 카운트다운 훅 — 매초 computeTimelinePosition 호출.
 *  클라이언트가 자체적으로 레벨 전환 인식 (Firestore doc update 안 기다림 → cron 1분 지연과 무관).
 *  반환은 number(secondsLeft) — 기존 시그너처 100% 호환.
 *  level/sb/bb/ante가 필요한 호출자는 useLiveTimelineTick 사용. */
export function useLiveCountdown(session: LiveSession | null | undefined): number {
  const pos = useLiveTimelineTick(session);
  return pos?.secondsLeft ?? 0;
}

/** Deterministic timeline 기반 카운트다운 훅 (확장형).
 *  매초 computeTimelinePosition을 호출해 level/sec/sb/bb/ante/isFinishing을 모두 반환. */
export function useLiveTimelineTick(
  session: LiveSession | null | undefined,
): { level: number; secondsLeft: number; isFinishing: boolean; sb: number; bb: number; ante: number } | null {
  const [pos, setPos] = useState(() => (session ? computeTimelinePosition(session) : null));
  useEffect(() => {
    if (!session) {
      setPos(null);
      return;
    }
    setPos(computeTimelinePosition(session));
    // ready/running/paused/break 모두 매초 재계산 (paused는 pausedAt 고정이라 변동 없음 → 무해)
    if (session.status === 'completed') return;
    const t = setInterval(() => setPos(computeTimelinePosition(session)), 1000);
    return () => clearInterval(t);
  }, [
    // timeline 기반이라 levelEndsAt/levelSecondsLeft는 useEffect dep에서 제외 —
    // cron이 매분 갱신하던 그 필드들이 dep에 있으면 setInterval 재시작 race로
    // 타이머가 점프하는 현상이 발생함 (사용자 보고: 18:50→20:00 reset).
    session?.id,
    session?.status,
    session?.currentLevel,
    session?.totalStartedAt?.toMillis(),
    session?.totalPausedMs,
    session?.pausedAt?.toMillis(),
  ]);

  // 2026-05-24 사용자 정정 #3 + 2026-05-27 사용자 정정 #4 (PM 단독):
  //   "0초 도달 즉시 블라인드업 TTS + 레벨 변경이 동시에 나와야 하는데
  //    현재는 10초 카운트다운만 정상, 레벨 변경+사운드는 몇 분 후 늦게 나옴."
  //
  // 결정적 원인 (2단 버그):
  //   ① computeTimelinePosition은 elapsed >= cumulative 도달 즉시 다음 레벨로 wrap →
  //      secondsLeft가 0이 아니라 다음 레벨 전체 시간으로 점프.
  //      따라서 호출처(display/m/live/TournamentControlCenter)의
  //      `prev > 0 && sec === 0` useEffect가 한 tick도 sec=0 상태를 못 보고 통과 →
  //      ❌ TTS/playBlindUp 영영 트리거 X
  //      ❌ advanceLevelIfDue 영영 트리거 X (advanceFiredKeyRef 가드는 sec=0과 별도 효과)
  //   ② cron(1분 주기)이 결국 catch-up — 사용자에게는 "몇 분 후 쌩뚱맞게" 발화로 체감.
  //
  // Fix (2-pronged):
  //   (A) pos가 다음 레벨로 wrap한 상태(pos.level > session.currentLevel)에서는
  //       반환 시 secondsLeft를 0으로 강제. level은 서버 currentLevel을 유지 (호출처 동기화).
  //       → 호출처의 `prev > 0 && sec === 0` 트리거가 자연 동작 → 즉시 TTS + advanceLevelIfDue 호출.
  //   (B) 백업으로 여기서도 advanceLevelIfDue 직접 호출 (cron 대기 X).
  //   결과: 0초 도달 → 화면 sec=0 한 tick 노출 → TTS+톤+advance 동시 발사 → 다음 tick에서 새 레벨.
  const advanceFiredKeyRef = useRef<string>('');
  useEffect(() => {
    if (!session || !pos) return;
    if (session.status !== 'running') return;
    if (pos.level <= session.currentLevel) return;
    const key = `lv${session.currentLevel}-${session.id}`;
    if (advanceFiredKeyRef.current === key) return;
    advanceFiredKeyRef.current = key;
    void advanceLevelIfDue(session.id, session.currentLevel).catch(() => {
      // 실패 시 다음 tick에서 재시도 가능하도록 key 해제 (서버가 아직 옛 레벨이면 동일 key 재사용 OK)
      advanceFiredKeyRef.current = '';
    });
  }, [pos?.level, session?.id, session?.currentLevel, session?.status]);

  // 2026-05-27 정정 #4 핵심: 다음 레벨 wrap 상태에서는 sec=0을 표면화.
  //   서버가 아직 currentLevel을 안 올린 상태(advance 트랜잭션 진행 중 또는 직전)에서
  //   호출처가 sec=0을 한 tick이라도 볼 수 있게 만들어 TTS/playBlindUp 트리거를 정상화.
  if (pos && session && session.status === 'running' && pos.level > session.currentLevel) {
    const cur = (session.blindStructureLocked && session.blindStructureLocked.length > 0
      ? session.blindStructureLocked
      : session.blindStructure)?.find((l) => l.level === session.currentLevel);
    return {
      level: session.currentLevel,
      secondsLeft: 0,
      isFinishing: false,
      sb: cur?.sb ?? session.smallBlind ?? 0,
      bb: cur?.bb ?? session.bigBlind ?? 0,
      ante: cur?.ante ?? session.ante ?? 0,
    };
  }

  return pos;
}

/**
 * 전체 LIVE 세션 구독.
 * - 기본: running/paused/break (모바일/지도/홈 피드용 — 사장이 ▶ 시작 누른 뒤만 노출)
 * - includeReady=true: ready도 포함 (본사 모니터링 — 본사가 미리 등록한 대기 세션 제어용)
 *
 * 안전망: finishingAt 그레이스 만료된 세션을 클라이언트 측에서 즉시 가림.
 * Cloud Function autoStopFinishedSessions가 1분 cron으로 DB도 정리하지만,
 * 그 사이 60초 동안의 잔상까지 제거하기 위해 30초마다 재평가하여 onChange 재호출.
 */
export function subscribeAllLiveSessions(
  onChange: (items: LiveSession[]) => void,
  onError: (e: Error) => void,
  options?: { includeReady?: boolean },
) {
  const statuses = options?.includeReady
    ? ['ready', 'running', 'paused', 'break']
    : ['running', 'paused', 'break'];
  const q = query(liveSessionsCol(), where('status', 'in', statuses));
  let last: LiveSession[] = [];
  const emit = () => onChange(last.filter((s) => !isSessionExpired(s)));
  const unsubFs = onSnapshot(
    q,
    (snap) => {
      last = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LiveSession, 'id'>) }));
      emit();
    },
    (err) => onError(err as Error),
  );
  const tick = setInterval(emit, 30_000);
  return () => {
    unsubFs();
    clearInterval(tick);
  };
}

/** 단일 LIVE 세션 실시간 구독 (풀스크린·TV용) */
export function subscribeLiveSession(
  sessionId: string,
  onChange: (s: LiveSession | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    doc(liveSessionsCol(), sessionId),
    (snap) => {
      if (!snap.exists()) {
        onChange(null);
        return;
      }
      onChange({ id: snap.id, ...(snap.data() as Omit<LiveSession, 'id'>) });
    },
    (err) => onError(err as Error),
  );
}

/** 매장의 활성 세션 실시간 구독 — 매장 어드민은 'ready'(시작 대기)도 봐야 시작 버튼을 누를 수 있음.
 *  안전망: finishingAt 그레이스 만료 + ready 5분 만료 세션을 즉시 화면에서 가림.
 *  Cloud Function autoStopExpiredSessions가 DB도 정리하지만, 그 사이 잔상 제거. */
export function subscribeStoreLiveSessions(
  storeId: string,
  onChange: (items: LiveSession[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    liveSessionsCol(),
    where('storeId', '==', storeId),
    where('status', 'in', ['ready', 'running', 'paused', 'break']),
  );
  let last: LiveSession[] = [];
  const emit = () => onChange(last.filter((s) => !isSessionExpired(s)));
  const unsubFs = onSnapshot(
    q,
    (snap) => {
      last = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LiveSession, 'id'>) }));
      emit();
    },
    (err) => onError(err as Error),
  );
  const tick = setInterval(emit, 30_000);
  return () => {
    unsubFs();
    clearInterval(tick);
  };
}

/**
 * 새 LIVE 세션 생성 — 항상 'ready' 상태로.
 * 카운트다운은 자동 출발하지 않음. 매장 사장(LivePanel) 또는 본사(/platform/live)가
 * ▶ 시작 버튼을 눌러 togglePauseSession으로 ready→running 전환해야 함.
 * subscribeAllLiveSessions 기본 구독은 ready를 제외 → 사장/본사가 실제 시작 누르기 전까진
 * 모바일/지도/홈 피드에 노출되지 않음.
 */
export async function startLiveSession(
  storeId: string,
  storeName: string,
  template: TournamentTemplate,
): Promise<string> {
  // 누적 운영 카운터 — 인기 점수의 핵심 신호. 실패해도 세션 생성은 진행.
  updateDoc(doc(db, 'stores', storeId), {
    liveSessionCount: increment(1),
    lastLiveAt: serverTimestamp(),
  }).catch(() => {
    // 권한 없음 등 — popularity 신호만 누락
  });

  // 매장 광역 코드 스냅샷 — liveSessions에 storeRegion 필드로 부착 (인덱스 활용).
  // 실패해도 LIVE 시작 자체는 진행 (storeRegion 없으면 region 필터 미적용).
  let storeRegion: string | undefined = undefined;
  try {
    const sSnap = await getDoc(doc(db, 'stores', storeId));
    if (sSnap.exists()) {
      const sData = sSnap.data() as { regionCode?: string };
      if (sData.regionCode) storeRegion = sData.regionCode;
    }
  } catch {
    // ignore
  }

  const first = template.blindStructure[0];

  // 상금풀 계산 — Phase 5 단일 모드: payoutStructure 항상 auto-percent (수동 입력 제거됨).
  // resolvePayoutStructure로 레거시 데이터 정규화 → 항상 참가비 × 인원 × payoutPercent% 계산.
  const ps = resolvePayoutStructure(template.payoutStructure);
  const finalPrizePool = computeAutoPrizePool(template.buyIn, template.totalPlayers, ps.payoutPercent);

  // 세션 doc — payoutStructure가 있을 때만 필드 부착 (undefined 저장 방지: Firestore 에러 회피)
  const docData: Record<string, unknown> = {
    storeId,
    storeName,
    templateId: template.id,
    tournamentName: template.name,
    tournamentType: template.type,
    posterStyle: template.posterStyle,
    buyIn: template.buyIn,
    totalPlayers: template.totalPlayers,
    blindStructure: template.blindStructure,
    lateRegEndLevel: template.lateRegEndLevel,
    status: 'ready' as LiveStatus,
    currentLevel: first.level,
    levelSecondsLeft: first.durationSec,
    levelEndsAt: null,
    // 2026-05-23 nextLevelAt 도입 — ready 상태에선 null. togglePauseSession이 ready→running 전환 시 박음.
    nextLevelAt: null,
    smallBlind: first.sb,
    bigBlind: first.bb,
    ante: first.ante,
    playersRemaining: template.totalPlayers,
    tablesRemaining: Math.max(1, Math.ceil(template.totalPlayers / 8)),
    // 2026-05-23 신설 — LIVE 시작 시 템플릿 값으로 초기화. 사장이 토너 운영 > 타이머에서 실시간 조절.
    currentEntries: template.totalPlayers,
    rebuysCount: 0,
    startingStack: template.startingStack,
    // 상금풀 = 위 finalPrizePool. 매장 어드민/매장 TV 디스플레이에서만 표시되며
    // 사용자 모바일 앱(/m/*)에는 어떤 상금 필드도 렌더링하지 않음 (UI 레이어에서 분리).
    prizePool: finalPrizePool,
    lateRegClosed: false,
    viewerCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  docData.payoutStructure = ps; // 정책 스냅샷 (분배 방식·ITM·custom 비율 등 전부 포함) — Phase 5 항상 부착
  if (template.prizeDisplayUnit) docData.prizeDisplayUnit = template.prizeDisplayUnit; // Phase 4 표시 단위 스냅샷
  // 2026-05-23: 프라이즈풀 노출 토글 스냅샷 — 시작 시점 정책 고정. 누락 시 true 추론.
  docData.showPrizePool = resolveShowPrizePool(template.showPrizePool);
  if (storeRegion) docData.storeRegion = storeRegion; // Phase B 광역 키 — region 인덱스 활용

  const ref = await addDoc(liveSessionsCol(), stripUndefined(docData));
  return ref.id;
}

export async function patchSession(sessionId: string, updates: Partial<LiveSession>) {
  await updateDoc(doc(liveSessionsCol(), sessionId), stripUndefined({
    ...updates,
    updatedAt: serverTimestamp(),
  }));
}

// ──────────────────────────────────────────────────────────────────────
// 2026-05-23: 토너 운영 > 타이머 실시간 컨트롤 — 인원/리바인/바이인/스타팅칩
// ──────────────────────────────────────────────────────────────────────

/** 세션의 현재 entry 수 (currentEntries 우선, 누락 시 totalPlayers fallback). */
export function resolveCurrentEntries(s: Pick<LiveSession, 'currentEntries' | 'totalPlayers'>): number {
  if (typeof s.currentEntries === 'number' && s.currentEntries >= 0) return s.currentEntries;
  return Math.max(0, s.totalPlayers ?? 0);
}

/** 세션의 리바인 수 (없으면 0). */
export function resolveRebuysCount(s: Pick<LiveSession, 'rebuysCount'>): number {
  return typeof s.rebuysCount === 'number' && s.rebuysCount >= 0 ? s.rebuysCount : 0;
}

/** 총 prize-eligible entries = currentEntries + rebuysCount. */
export function resolveTotalEntries(s: Pick<LiveSession, 'currentEntries' | 'totalPlayers' | 'rebuysCount'>): number {
  return resolveCurrentEntries(s) + resolveRebuysCount(s);
}

/**
 * 세션의 자동 prizePool 재계산 — 매장 사장 정책 (2026-05-23).
 *   prizePool = (currentEntries + rebuysCount) × buyIn × payoutPercent / 100
 *  + 만원 단위 내림 (computeAutoPrizePool과 동일 룰).
 *
 * payoutPercent는 시작 시점에 스냅샷된 session.payoutStructure에서 추출.
 * 누락 시 90% 디폴트.
 */
export function recomputeSessionPrizePool(s: LiveSession, overrides?: {
  buyIn?: number;
  currentEntries?: number;
  rebuysCount?: number;
}): number {
  const bi = overrides?.buyIn ?? s.buyIn ?? 0;
  const entries = overrides?.currentEntries ?? resolveCurrentEntries(s);
  const rebuys = overrides?.rebuysCount ?? resolveRebuysCount(s);
  const total = entries + rebuys;
  const ps = resolvePayoutStructure(s.payoutStructure);
  return computeAutoPrizePool(bi, total, ps.payoutPercent);
}

/**
 * 인원/리바인/바이인/스타팅칩/잔여인원/시상비율 통합 mutator.
 * 변경된 값으로 prizePool을 즉시 재계산하고 단일 patchSession write로 반영.
 *
 * ⚠️ 2026-05-23 PM 정정 (사용자 보고: 리바인은 기존 플레이어가 다시 바인을 하는 것):
 *   - 리바인은 **인원수에 영향을 주지 않음**. 단지 prizePool에만 +buyIn.
 *   - 인원수(currentEntries) 변경만 totalPlayers에 반영. 리바인 변경은 totalPlayers 무관.
 *   - playersRemaining은 사장이 별도 ✕ 탈락 버튼으로만 감소. 리바인 시 변동 X.
 *
 * ⚠️ 2026-05-24 확장:
 *   - playersRemaining/playersRemainingDelta — 잔여 인원 실시간 컨트롤 (사장이 탈락 처리).
 *     currentEntries 초과 불가, 0 미만 불가. tablesRemaining 자동 재계산 (8명/테이블).
 *   - payoutPercent — session.payoutStructure 스냅샷의 시상 비율 % 실시간 변경.
 *     0~100 clamp. prizePool 즉시 재계산.
 *
 * @example incrementRebuys: updateSessionTournamentMeta(s, { rebuysDelta: 1 })
 *          → currentEntries 그대로, totalPlayers 그대로, prizePool만 +buyIn×payoutPercent%
 * @example setEntries: updateSessionTournamentMeta(s, { currentEntries: 25 })
 *          → currentEntries=25, totalPlayers=25, playersRemaining 자동 clamp, prizePool 재계산
 * @example eliminate: updateSessionTournamentMeta(s, { playersRemainingDelta: -1 })
 *          → playersRemaining -=1, tablesRemaining 재계산, prizePool 무영향
 * @example setPayoutPercent: updateSessionTournamentMeta(s, { payoutPercent: 60 })
 *          → session.payoutStructure.payoutPercent=60, prizePool 재계산 (60% 적용)
 */
export async function updateSessionTournamentMeta(
  s: LiveSession,
  patch: {
    buyIn?: number;
    currentEntries?: number;
    entriesDelta?: number;
    rebuysCount?: number;
    rebuysDelta?: number;
    startingStack?: number;
    playersRemaining?: number;
    playersRemainingDelta?: number;
    payoutPercent?: number;
  },
) {
  const curEntries = resolveCurrentEntries(s);
  const curRebuys = resolveRebuysCount(s);
  const curPlayersRemaining = Math.max(0, s.playersRemaining ?? curEntries);

  let newEntries = patch.currentEntries ?? curEntries;
  if (typeof patch.entriesDelta === 'number') newEntries = curEntries + patch.entriesDelta;
  newEntries = Math.max(0, Math.floor(newEntries));

  let newRebuys = patch.rebuysCount ?? curRebuys;
  if (typeof patch.rebuysDelta === 'number') newRebuys = curRebuys + patch.rebuysDelta;
  newRebuys = Math.max(0, Math.floor(newRebuys));

  const newBuyIn = typeof patch.buyIn === 'number' ? Math.max(0, Math.floor(patch.buyIn)) : s.buyIn;
  const newStartingStack = typeof patch.startingStack === 'number'
    ? Math.max(0, Math.floor(patch.startingStack))
    : s.startingStack;

  // payoutPercent 실시간 변경 — session.payoutStructure 스냅샷 갱신.
  // resolvePayoutStructure 통해 누락 필드 안전 보강.
  const hasPayoutPercentPatch = typeof patch.payoutPercent === 'number';
  const clampedPct = hasPayoutPercentPatch
    ? Math.max(0, Math.min(100, Math.round(patch.payoutPercent!)))
    : undefined;
  const newPayoutStructure = hasPayoutPercentPatch
    ? { ...resolvePayoutStructure(s.payoutStructure), payoutPercent: clampedPct! }
    : undefined;

  // recompute 위해 임시 세션 객체 — payoutStructure 갱신 반영
  const sessionForCompute: LiveSession = newPayoutStructure
    ? { ...s, payoutStructure: newPayoutStructure }
    : s;
  const newPrizePool = recomputeSessionPrizePool(sessionForCompute, {
    buyIn: newBuyIn,
    currentEntries: newEntries,
    rebuysCount: newRebuys,
  });

  // 인원 변경 여부 — true일 때만 totalPlayers/playersRemaining/tablesRemaining 영향.
  // 리바인만 변경된 경우엔 인원수 관련 필드는 모두 그대로.
  const entriesChanged = newEntries !== curEntries;

  // 잔여 인원 실시간 컨트롤
  let newPlayersRemaining: number | undefined;
  if (typeof patch.playersRemaining === 'number' || typeof patch.playersRemainingDelta === 'number') {
    let pr = typeof patch.playersRemaining === 'number' ? patch.playersRemaining : curPlayersRemaining;
    if (typeof patch.playersRemainingDelta === 'number') pr = curPlayersRemaining + patch.playersRemainingDelta;
    // clamp: [0, newEntries] — currentEntries 초과 불가, 음수 불가.
    newPlayersRemaining = Math.max(0, Math.min(Math.floor(pr), newEntries));
  } else if (entriesChanged) {
    // 인원 감소 시 자동 clamp. 인원 증가 시 그대로 유지 (탈락자 부활 방지).
    newPlayersRemaining = Math.max(0, Math.min(curPlayersRemaining, newEntries));
  }

  const updates: Partial<LiveSession> = {
    currentEntries: newEntries,
    rebuysCount: newRebuys,
    buyIn: newBuyIn,
    startingStack: newStartingStack,
    prizePool: newPrizePool,
  };

  if (newPayoutStructure) {
    updates.payoutStructure = newPayoutStructure;
  }

  if (entriesChanged) {
    updates.totalPlayers = newEntries; // 백워드 호환: 기존 코드(/m/*, display 등)는 totalPlayers를 본다.
  }

  if (typeof newPlayersRemaining === 'number') {
    updates.playersRemaining = newPlayersRemaining;
    // tablesRemaining = ceil(playersRemaining / 8). 잔여 0이면 1로 (display divide-by-zero 방지).
    updates.tablesRemaining = Math.max(1, Math.ceil(Math.max(1, newPlayersRemaining) / 8));
  } else if (entriesChanged) {
    // 인원만 변경되고 playersRemaining patch 없는 경우 — 기존 잔여로 tablesRemaining 재계산.
    updates.tablesRemaining = Math.max(1, Math.ceil(newEntries / 8));
  }

  await patchSession(s.id, updates);
}

/**
 * 시작/일시정지 토글 — Deterministic timeline 기반.
 *
 * ready → running (첫 시작):
 *   - totalStartedAt = now (전체 타임라인의 절대 origin)
 *   - totalPausedMs = 0
 *   - blindStructureLocked = blindStructure 스냅샷 (이후 템플릿 수정과 무관)
 *   - startedAt = now (레거시 표시용)
 *   - levelEndsAt = deadlineFromNow(첫 레벨 durationSec) — legacy 호환
 *
 * paused → running (재개):
 *   - 누적 paused 시간: totalPausedMs += (now - pausedAt)
 *   - pausedAt = null
 *   - levelEndsAt = deadlineFromNow(currentSecondsLeft) — legacy 호환 (cron이 다음 분에 동기화)
 *
 * running → paused:
 *   - pausedAt = now (이 시점 이후 elapsed 정지)
 *   - levelEndsAt = null
 */
export async function togglePauseSession(s: LiveSession, currentSecondsLeft: number) {
  const isStarting = s.status === 'ready' || s.status === 'paused';
  const newStatus: LiveStatus = isStarting ? 'running' : 'paused';

  if (s.status === 'ready' && newStatus === 'running') {
    // 첫 시작 — 전체 타임라인 결정 시점
    await patchSession(s.id, {
      status: 'running',
      totalStartedAt: serverTimestamp() as unknown as Timestamp,
      totalPausedMs: 0,
      blindStructureLocked: s.blindStructure,
      pausedAt: null,
      levelSecondsLeft: currentSecondsLeft,
      levelEndsAt: deadlineFromNow(currentSecondsLeft),
      // 2026-05-23 첫 시작 시 다음 레벨 시각 = 첫 레벨 duration 후
      nextLevelAt: deadlineFromNow(currentSecondsLeft),
      startedAt: serverTimestamp(),
    });
    return;
  }

  if (s.status === 'paused' && newStatus === 'running') {
    // resume — 누적 paused 시간 정산
    const pausedAtMs = s.pausedAt?.toMillis() ?? Date.now();
    const additionalPaused = Math.max(0, Date.now() - pausedAtMs);
    await patchSession(s.id, {
      status: 'running',
      pausedAt: null,
      totalPausedMs: (s.totalPausedMs ?? 0) + additionalPaused,
      levelSecondsLeft: currentSecondsLeft,
      levelEndsAt: deadlineFromNow(currentSecondsLeft),
      // 2026-05-23 resume 시 다음 레벨 시각도 재계산 (paused 동안 흐른 시간 보정)
      nextLevelAt: deadlineFromNow(currentSecondsLeft),
    });
    return;
  }

  // running → paused
  await patchSession(s.id, {
    status: 'paused',
    pausedAt: serverTimestamp() as unknown as Timestamp,
    levelSecondsLeft: currentSecondsLeft,
    levelEndsAt: null,
    // paused 동안엔 nextLevelAt 의미 없음 — null로 둬서 cron이 잘못 advance하지 않게.
    nextLevelAt: null,
  });
}

/**
 * Deterministic timeline 친화 레벨 점프 — 사용자가 ⏮/⏭ 누르면
 * computeTimelinePosition이 즉시 새 레벨을 반환하도록 totalStartedAt/totalPausedMs를 재정렬한다.
 *
 * 동작 원리: timeline 좌표계에서 "타겟 레벨이 시작하는 누적 ms 위치"를 구한 뒤
 * elapsed = targetCumulativeMs 가 되도록 totalStartedAt(또는 totalPausedMs)을 역산.
 *
 * - running: now - totalStartedAt - totalPausedMs == targetCumulativeMs 가 되도록
 *   totalStartedAt = now - totalPausedMs - targetCumulativeMs
 *   (totalPausedMs는 보존, pausedAt도 그대로)
 * - paused: pausedAt - totalStartedAt - totalPausedMs == targetCumulativeMs
 *   totalStartedAt = pausedAt - totalPausedMs - targetCumulativeMs
 *
 * 타겟 레벨의 시작점으로 점프하므로 secondsLeft는 자동으로 target.durationSec이 된다.
 * delta 직접 받지 않고 targetLevel을 받도록 absLevel 인자 지원 — UI는 +1/-1만 보내지만
 * 점프 모달 같은 후속 기능이 절대 레벨로 부르기 쉽도록.
 */
export async function goToLevelInSession(
  s: LiveSession,
  deltaOrAbs: 1 | -1 | { absLevel: number },
  _currentSecondsLeft: number,
) {
  const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
    ? s.blindStructureLocked
    : s.blindStructure;
  if (!structure || structure.length === 0) return;

  const targetLevelNum = typeof deltaOrAbs === 'number'
    ? s.currentLevel + deltaOrAbs
    : deltaOrAbs.absLevel;
  const target = structure.find((l) => l.level === targetLevelNum);
  if (!target) return;

  // 타겟 레벨의 누적 시작 ms 계산 (timeline 좌표계)
  let cumulativeMs = 0;
  for (const lvl of structure) {
    if (lvl.level === target.level) break;
    cumulativeMs += Math.max(0, lvl.durationSec) * 1000;
  }
  const targetCumulativeMs = cumulativeMs;

  // totalStartedAt이 없는 레거시 세션은 박아준다 (점프 직후부터 deterministic 진입)
  const hasTimeline = !!s.totalStartedAt;
  const totalPausedMs = s.totalPausedMs ?? 0;
  const refNowMs = s.status === 'paused' && s.pausedAt
    ? s.pausedAt.toMillis()
    : Date.now();
  // refNow - newTotalStartedMs - totalPausedMs == targetCumulativeMs
  const newTotalStartedMs = refNowMs - totalPausedMs - targetCumulativeMs;
  const newTotalStartedTs = Timestamp.fromMillis(newTotalStartedMs);

  await patchSession(s.id, {
    currentLevel: target.level,
    smallBlind: target.sb,
    bigBlind: target.bb,
    ante: target.ante,
    levelSecondsLeft: target.durationSec,
    levelEndsAt: s.status === 'running' ? deadlineFromNow(target.durationSec) : null,
    // 2026-05-23 점프 시 nextLevelAt도 타겟 레벨 끝나는 시각으로 갱신
    nextLevelAt: s.status === 'running' ? deadlineFromNow(target.durationSec) : null,
    // Deterministic timeline 재정렬 — 핵심 fix
    totalStartedAt: newTotalStartedTs,
    // blindStructureLocked가 비어있으면 지금 박아준다 (이후 일관성 보장)
    ...(hasTimeline ? {} : { blindStructureLocked: structure }),
  });
}

/**
 * 2026-05-23 — 클라이언트 측 즉시 레벨 진행 transaction.
 *
 * 배경: 기존엔 cron(1분 주기, 평균 30초 지연)이 currentLevel을 올렸기 때문에
 *   sec=0 도달 후 다음 레벨 TTS/사운드가 평균 30초 늦게 발사됨.
 *   클라가 직접 transaction으로 doc을 advance하면 즉시 onSnapshot 리스너가 트리거되어
 *   다음 레벨로 화면 + 사운드가 동시에 넘어감.
 *
 * 동시성: runTransaction으로 atomically 검증·증가.
 *   - currentLevel === expectedLevel (다른 클라/cron이 이미 처리했으면 skip)
 *   - nextLevelAt이 이미 도래 (도래 안 했으면 skip)
 *   - 마지막 레벨이면 finishingAt 박음, currentLevel은 그대로 유지
 *     (autoStopFinishedSessions cron이 그레이스 후 정리)
 *   - 마지막이 아니면 currentLevel += 1, nextLevelAt = now + 다음 레벨 durationSec
 *
 * 보안: firestore.rules에서 `request.resource.data.currentLevel == resource.data.currentLevel + 1`
 *   강제 — 임의 사용자가 임의 레벨로 점프 불가능.
 *
 * @returns advance에 성공했으면 true. 이미 다른 주체가 처리/조건 미충족이면 false.
 */
export async function advanceLevelIfDue(
  sessionId: string,
  expectedLevel: number,
): Promise<boolean> {
  const ref = doc(liveSessionsCol(), sessionId);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      const data = snap.data() as Omit<LiveSession, 'id'>;

      // 조건 1: 다른 주체가 이미 advance했으면 skip
      if (data.currentLevel !== expectedLevel) return false;

      // 조건 2: 진행 중인 세션이어야 함
      if (data.status !== 'running') return false;

      // 조건 3: 이미 finishing이면 skip
      if (data.finishingAt) return false;

      // 조건 4: nextLevelAt이 도래해야 함 (없으면 timeline 기반 fallback)
      const now = Date.now();
      const nextMs = data.nextLevelAt?.toMillis?.();
      if (typeof nextMs === 'number' && nextMs > now) return false;

      // structure에서 expectedLevel과 다음 레벨 찾기
      const structure = (data.blindStructureLocked && data.blindStructureLocked.length > 0)
        ? data.blindStructureLocked
        : data.blindStructure;
      if (!structure || structure.length === 0) return false;

      const idx = structure.findIndex((l) => l.level === expectedLevel);
      if (idx < 0) return false;

      // 마지막 레벨이면 finishingAt만 박음 (currentLevel은 유지 — autoStopFinishedSessions가 정리)
      if (idx === structure.length - 1) {
        tx.update(ref, {
          finishingAt: serverTimestamp(),
          levelSecondsLeft: 0,
          levelEndsAt: null,
          nextLevelAt: null,
          updatedAt: serverTimestamp(),
        });
        return true;
      }

      // 다음 레벨로 advance
      const next = structure[idx + 1];
      tx.update(ref, {
        currentLevel: next.level,
        smallBlind: next.sb,
        bigBlind: next.bb,
        ante: next.ante,
        levelSecondsLeft: next.durationSec,
        levelEndsAt: Timestamp.fromMillis(now + next.durationSec * 1000),
        nextLevelAt: Timestamp.fromMillis(now + next.durationSec * 1000),
        updatedAt: serverTimestamp(),
      });
      return true;
    });
  } catch (e) {
    // 동시성 충돌 / 권한 / 네트워크 — 모두 false로 보고 호출자는 다음 tick에서 재시도하지 않음
    // (다음 tick에선 currentLevel이 이미 expectedLevel과 다를 것이므로 skip된다)
    // eslint-disable-next-line no-console
    console.warn(`[advanceLevelIfDue] tx failed sessionId=${sessionId} expected=${expectedLevel}`, e);
    return false;
  }
}

/**
 * +1분 / −1분 — 현재 레벨의 남은 시간만 조정. timeline 좌표계에서는
 * elapsed를 delta초만큼 뒤로/앞으로 미는 것과 같다.
 *
 * 구현: secondsLeft += delta 하면서 timeline elapsed도 -=delta 만큼 변하도록
 * totalStartedAt을 delta초만큼 미래로(+1분) 또는 과거로(−1분) 이동.
 * (그래야 computeTimelinePosition이 다음 tick에서 같은 currentLevel을
 *  유지하면서 새로운 secondsLeft를 반환한다.)
 *
 * Clamp 범위: [1, currentLvlDur]. 0 또는 음수가 되면 자동 다음 레벨 진입 트리거.
 *  마지막 레벨 끝을 넘기지 않도록 안전 보호 — finishingAt이 잘못 박혀 세션이 사라지는 버그 방지.
 */
export async function addSecondsToSession(s: LiveSession, currentSecondsLeft: number, delta: number) {
  const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
    ? s.blindStructureLocked
    : s.blindStructure;
  const curLvlDur = structure?.find((l) => l.level === s.currentLevel)?.durationSec || 1200;
  // 1초 이상 보장 (0이 되면 즉시 다음 레벨로 advance해야 하는데 그건 별도 흐름) +
  // 현재 레벨 duration을 초과하지 못하도록 (timeline elapsed 보호)
  const next = Math.max(1, Math.min(curLvlDur, currentSecondsLeft + delta));
  const actualDelta = next - currentSecondsLeft; // clamp 반영
  if (actualDelta === 0) return;

  const updates: Partial<LiveSession> = {
    levelSecondsLeft: next,
    levelEndsAt: s.status === 'running' ? deadlineFromNow(next) : null,
  };

  // Deterministic timeline 재정렬 — 시간을 늘리면 elapsed가 줄어야 하므로 totalStartedAt을 +delta초 미래로
  // SANITY: 새 elapsed가 음수가 되거나 totalStartedAt이 미래로 너무 멀리 가지 않도록 hard cap.
  // 잘못된 shift가 누적되면 cron이 elapsed를 잘못 계산해 마지막 레벨로 점프 → finishingAt 박힘 → 자동 종료 버그 유발.
  if (s.totalStartedAt) {
    const shiftedMs = s.totalStartedAt.toMillis() + actualDelta * 1000;
    // shift된 totalStartedAt이 (현재 시각 - 현재 누적 레벨 종료까지의 시간)보다 미래면 의심 — reject
    const totalPausedMs = s.totalPausedMs ?? 0;
    const refNowMs = s.status === 'paused' && s.pausedAt ? s.pausedAt.toMillis() : Date.now();
    const newElapsedMs = refNowMs - shiftedMs - totalPausedMs;
    if (newElapsedMs < 0) {
      // 미래로 너무 멀리 shift됨 — 거부하고 단순 levelSecondsLeft만 업데이트
      // eslint-disable-next-line no-console
      console.warn(`[addSecondsToSession] BLOCKED timeline shift — newElapsedMs=${newElapsedMs}ms. levelSecondsLeft만 update.`);
    } else {
      updates.totalStartedAt = Timestamp.fromMillis(shiftedMs);
    }
  }

  await patchSession(s.id, updates);
}

/**
 * 진행바 드래그로 현재 레벨의 남은 시간을 직접 설정 — 2순위 요구.
 * UX: 사용자가 슬라이더/진행바를 드래그하면 newSecondsLeft를 그대로 setTimeRemaining 호출.
 *
 * 구현: addSecondsToSession과 동일 원리. delta = newSec - currentSec 계산 후 timeline shift.
 * 클램프: [0, currentLvlDur].
 *
 * 2026-05-24 사용자 정정 #2: "드래그로 시간을 0까지 당겨도 다음 레벨로 안 넘어가고
 *   해당 레벨에서 한번더 타이머시간이 시작된다."
 *   원인: 직전엔 min을 1로 강제해 0이 될 수 없었음. nextLevelAt도 갱신 안 함.
 *   Fix:
 *     1) min을 0으로 — 드래그 끝까지 당기면 sec=0 도달 → advanceLevelIfDue 트리거
 *     2) nextLevelAt도 deadline과 동기화 — cron/클라 advance 둘 다 동일 기준
 *     3) 사용자가 진행바를 한 번에 끝까지 드래그한 경우(currentSeconds>>1)
 *        → 즉시 advance가 안 되고 다음 tick에서 발사돼야 함. patchSession 직후
 *           Firestore onSnapshot이 새 sec=0을 반영 → SessionControlPanel의
 *           sec=0 useEffect가 advanceLevelIfDue 호출.
 */
export async function setTimeRemainingInSession(
  s: LiveSession,
  currentSecondsLeft: number,
  newSecondsLeft: number,
) {
  const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
    ? s.blindStructureLocked
    : s.blindStructure;
  const curLvlDur = structure?.find((l) => l.level === s.currentLevel)?.durationSec || 1200;
  // 2026-05-24 정정: min 1 → 0. 0까지 드래그 가능. running 중이면 즉시 advance.
  const clamped = Math.max(0, Math.min(curLvlDur, Math.round(newSecondsLeft)));
  const delta = clamped - currentSecondsLeft;
  if (delta === 0) return;

  const newDeadline = s.status === 'running' ? deadlineFromNow(clamped) : null;
  const updates: Partial<LiveSession> = {
    levelSecondsLeft: clamped,
    levelEndsAt: newDeadline,
    // 2026-05-24 정정: nextLevelAt도 동기화. autoAdvanceLevel cron과 advanceLevelIfDue
    //   transaction 모두 nextLevelAt을 보고 due 판정한다. 누락하면 cron이 이전 nextLevelAt을
    //   믿어 advance를 skip → 같은 레벨에서 1분간 대기.
    nextLevelAt: newDeadline,
  };

  // 같은 sanity guard 적용 — addSecondsToSession과 동일 원리
  if (s.totalStartedAt) {
    const shiftedMs = s.totalStartedAt.toMillis() + delta * 1000;
    const totalPausedMs = s.totalPausedMs ?? 0;
    const refNowMs = s.status === 'paused' && s.pausedAt ? s.pausedAt.toMillis() : Date.now();
    const newElapsedMs = refNowMs - shiftedMs - totalPausedMs;
    if (newElapsedMs < 0) {
      // eslint-disable-next-line no-console
      console.warn(`[setTimeRemainingInSession] BLOCKED timeline shift — newElapsedMs=${newElapsedMs}ms.`);
    } else {
      updates.totalStartedAt = Timestamp.fromMillis(shiftedMs);
    }
  }

  await patchSession(s.id, updates);

  // 2026-05-24 사용자 정정 #3 보조: 사용자가 드래그를 0초까지 당긴 경우,
  // useLiveTimelineTick wrap 감지(최대 1 tick=1초)를 기다리지 않고 즉시 transaction으로 advance 시도.
  //   - 옵션 A(timeline wrap 감지)와 중복 발사돼도 advanceLevelIfDue 내부 transaction이
  //     expectedLevel 일치 여부로 idempotent하게 처리 → 두 번째 호출은 false 반환.
  //   - running 상태일 때만 의미 있음 (paused/break는 deadline null).
  if (clamped === 0 && s.status === 'running') {
    void advanceLevelIfDue(s.id, s.currentLevel).catch(() => {});
  }
}

export async function eliminatePlayerInSession(s: LiveSession, currentSecondsLeft: number) {
  // 시간 흐름과 무관 — levelEndsAt 건드리지 않음 (running 중이면 deadline 그대로 유효)
  await patchSession(s.id, {
    levelSecondsLeft: currentSecondsLeft,
    playersRemaining: Math.max(1, s.playersRemaining - 1),
  });
}

export async function toggleLateRegInSession(s: LiveSession, currentSecondsLeft: number) {
  await patchSession(s.id, {
    levelSecondsLeft: currentSecondsLeft,
    lateRegClosed: !s.lateRegClosed,
  });
}

/**
 * 세션 종료 — caller를 명시해 어디서 호출됐는지 추적한다.
 * 2026-05-21 3차 핫픽스: "타이머 중도종료" 신고 3회 후 결정적 진단 위해 audit 도입.
 * 2026-05-24 4차 핫픽스: audit에 caller='user-button' 0.187초 간격 double-fire 패턴 발견.
 *   사용자는 종료 버튼 누른 적 없다고 주장. 모바일 ghost click / 키보드 race / 우발 클릭
 *   가설 모두 차단하기 위해 (1) 5초 진입 debounce, (2) audit에 userAgent/pathname/uid 추가.
 *
 * caller 예: 'LivePanel:auto-finishing', 'LivePanel:user-button',
 *           'TournamentControlCenter:auto-finishing', 'TournamentControlCenter:user-button',
 *           'platform/live:auto-finishing', 'platform/live:user-button'
 */
const RECENT_STOP_CALLS = new Map<string, number>();
const STOP_DEBOUNCE_MS = 5000;
const RECENT_STOP_GC_MS = 5 * 60 * 1000;

// 호출 직전 5초 내 마지막 키보드 이벤트 추적 — 사용자 보고(2026-05-24):
//   "전체화면에서 ESC 누르면 세션 종료된다". 코드상 ESC→stopLiveSession 직접 경로 없음.
//   가설: F11 fullscreen + window.confirm + ESC/Enter race로 confirm 자동 통과.
//   audit에 마지막 keydown(key + target + delta)을 박아 다음 사건 시 결정적 진단.
let LAST_KEY_EVENT: { key: string; target: string; ts: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      LAST_KEY_EVENT = {
        key: e.key,
        target: (e.target as HTMLElement | null)?.tagName ?? 'unknown',
        ts: Date.now(),
      };
    },
    true, // capture phase — 어떤 핸들러보다 먼저 잡음
  );
}

export async function stopLiveSession(
  s: LiveSession,
  currentSecondsLeft: number,
  caller: string = 'unknown',
) {
  // ── debounce: 같은 sessionId가 5초 안에 또 호출되면 즉시 reject ──
  // double-fire (모바일 ghost click·React reconciliation race·키보드 trigger 등) 차단.
  // 단, 진짜 마지막 레벨 auto-finishing은 컴포넌트 unmount/remount로 한 번만 fire되도록
  // useEffect가 cleanup 보장 — debounce가 막아도 부작용 없음.
  const nowMs = Date.now();
  const lastCall = RECENT_STOP_CALLS.get(s.id);
  if (lastCall && nowMs - lastCall < STOP_DEBOUNCE_MS) {
    // eslint-disable-next-line no-console
    console.warn(
      `[stopLiveSession] ⛔ DEBOUNCED — sessionId=${s.id} ${nowMs - lastCall}ms ago. ` +
      `caller=${caller} (likely double-fire / ghost click)`
    );
    // 진단을 위해 debounce된 호출도 audit에 따로 기록
    try {
      await addDoc(collection(db, 'liveSessionsAudit'), {
        sessionId: s.id,
        storeId: s.storeId,
        action: 'debounced',
        caller,
        msSinceLastCall: nowMs - lastCall,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
        pathname: typeof window !== 'undefined' ? window.location.pathname : null,
        uid: auth.currentUser?.uid ?? null,
        lastKey: LAST_KEY_EVENT && (nowMs - LAST_KEY_EVENT.ts < 5000)
          ? `${LAST_KEY_EVENT.key}@${LAST_KEY_EVENT.target}(${nowMs - LAST_KEY_EVENT.ts}ms)`
          : null,
        fullscreenActive: typeof document !== 'undefined' ? !!document.fullscreenElement : null,
        timestamp: serverTimestamp(),
      });
    } catch { /* ignore */ }
    return;
  }
  RECENT_STOP_CALLS.set(s.id, nowMs);
  // GC: 5분 이상 된 entry 제거
  for (const [k, v] of RECENT_STOP_CALLS) {
    if (nowMs - v > RECENT_STOP_GC_MS) RECENT_STOP_CALLS.delete(k);
  }

  const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
    ? s.blindStructureLocked
    : s.blindStructure;
  const lastLevelNum = structure && structure.length > 0
    ? structure[structure.length - 1].level
    : -1;
  const isLastLevel = s.currentLevel === lastLevelNum && lastLevelNum > 0;

  // 콘솔에 항상 풀 스택 — 매장 사장 브라우저에서 어떤 경로로 종료됐는지 즉시 파악
  // eslint-disable-next-line no-console
  console.warn(
    `[stopLiveSession] caller=${caller} sessionId=${s.id} tournament="${s.tournamentName}" ` +
    `status=${s.status} currentLevel=${s.currentLevel} lastLevelNum=${lastLevelNum} ` +
    `isLastLevel=${isLastLevel} finishingAt=${s.finishingAt ? 'set' : 'null'} ` +
    `secondsLeft=${currentSecondsLeft}`,
    new Error('stopLiveSession call site').stack
  );

  // Firestore audit (best-effort, 실패해도 stop은 진행) — 강화된 컨텍스트
  try {
    const auditCol = collection(db, 'liveSessionsAudit');
    await addDoc(auditCol, {
      sessionId: s.id,
      storeId: s.storeId,
      storeName: s.storeName,
      tournamentName: s.tournamentName,
      caller,
      currentLevel: s.currentLevel,
      lastLevelNum,
      isLastLevel,
      hadFinishingAt: !!s.finishingAt,
      secondsLeft: currentSecondsLeft,
      structureLen: structure?.length ?? 0,
      // 2026-05-24 추가 — 누가/어디서/어떤 디바이스
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
      pathname: typeof window !== 'undefined' ? window.location.pathname : null,
      viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
      uid: auth.currentUser?.uid ?? null,
      // 2026-05-24 ESC 가설 검증 — 호출 직전 5초 내 마지막 keydown 정보.
      // null 또는 (Escape/Enter/Space + 5초 이내)면 키보드 race로 트리거됐을 가능성.
      lastKey: LAST_KEY_EVENT && (nowMs - LAST_KEY_EVENT.ts < 5000)
        ? `${LAST_KEY_EVENT.key}@${LAST_KEY_EVENT.target}(${nowMs - LAST_KEY_EVENT.ts}ms)`
        : null,
      fullscreenActive: typeof document !== 'undefined' ? !!document.fullscreenElement : null,
      timestamp: serverTimestamp(),
    });
  } catch {
    // audit 실패해도 본업은 계속
  }

  await patchSession(s.id, {
    levelSecondsLeft: currentSecondsLeft,
    levelEndsAt: null,
    status: 'completed',
    endedAt: serverTimestamp(),
  });
}

/**
 * @deprecated Deterministic timeline 도입 이후 클라이언트가 호출할 필요 없음.
 *  레벨 전환은 클라이언트가 매초 computeTimelinePosition으로 인식하고,
 *  Firestore doc 동기화는 autoAdvanceLevel cron이 담당한다.
 *  기존 호출자(LivePanel 등) 호환을 위해 no-op로 남겨둠.
 */
export async function nextLevelTick(_s: LiveSession): Promise<boolean> {
  // No-op: 서버 cron이 doc 동기화를, 클라이언트가 화면 갱신을 담당한다.
  return false;
}

/**
 * 2026-05-21 3차 핫픽스 — 잘못 박힌 finishingAt 자가 치유.
 * cron의 sanity guard가 우연히 뚫려 finishingAt이 잘못 박힌 케이스(12레벨 토너에서
 * 7레벨에 finishingAt 박힘) 발견 시 클라이언트가 즉시 Firestore에서 null로 복구한다.
 * 진단 로그를 audit에도 남긴다. 매장 사장 화면이 켜져 있는 한 빠르게 자가 치유됨.
 */
export async function selfHealStaleFinishingAt(s: LiveSession): Promise<boolean> {
  if (!s.finishingAt) return false;
  const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
    ? s.blindStructureLocked
    : s.blindStructure;
  const lastLevelNum = structure && structure.length > 0
    ? structure[structure.length - 1].level
    : -1;
  const isReallyLastLevel = s.currentLevel === lastLevelNum && lastLevelNum > 0;
  if (isReallyLastLevel) return false; // 정상

  // 잘못 박힘 — 복구
  // eslint-disable-next-line no-console
  console.warn(
    `[selfHealStaleFinishingAt] HEALING ${s.id} — currentLevel=${s.currentLevel} ` +
    `lastLevelNum=${lastLevelNum}. finishingAt=null로 복구.`
  );
  try {
    const auditCol = collection(db, 'liveSessionsAudit');
    await addDoc(auditCol, {
      sessionId: s.id,
      storeId: s.storeId,
      storeName: s.storeName,
      tournamentName: s.tournamentName,
      action: 'self-heal-finishingAt',
      currentLevel: s.currentLevel,
      lastLevelNum,
      structureLen: structure?.length ?? 0,
      timestamp: serverTimestamp(),
    });
  } catch {
    // audit 실패해도 복구는 진행
  }
  try {
    await patchSession(s.id, { finishingAt: null });
    return true;
  } catch {
    return false;
  }
}

export function computeLateRegMinutes(s: LiveSession, currentSecondsLeft: number): number {
  if (s.lateRegClosed) return 0;
  if (s.currentLevel > s.lateRegEndLevel) return 0;
  let totalSec = currentSecondsLeft;
  for (let lv = s.currentLevel + 1; lv <= s.lateRegEndLevel; lv++) {
    const item = s.blindStructure.find((l) => l.level === lv);
    if (item) totalSec += item.durationSec;
  }
  return Math.ceil(totalSec / 60);
}

export function fmtTime(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.max(0, sec) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ──────────────────────────────────────────────
 * BREAK 상태 헬퍼 — 2026-05-24 신규
 *
 * 사용자 앱(/m/*) LIVE 카드/배지/타이머 색을 BREAK일 때 명확히 차별화하기 위한
 * 통합 진실의 원천. 5곳(PrimaryLiveCard, LiveSlider, /m/find, /m/store, /m/live)에서 공유.
 *
 * 판정 우선순위:
 *   1) session.status === 'break'  → BREAK (서버 명시)
 *   2) blindStructureLocked|blindStructure에서 currentLevel 행의 isBreak === true → BREAK
 *
 * 두 경로 모두 잡는 이유: 어떤 토너는 status='break'로 명시 토글하고, 어떤 토너는
 * status는 'running' 유지하면서 단순히 break 레벨로 currentLevel만 advance함.
 * (TournamentControlCenter가 후자를 채택)
 * ────────────────────────────────────────────── */

/** 세션이 현재 BREAK 레벨에 있는지. 위 판정 우선순위 참고. */
export function isLiveOnBreak(s: LiveSession | null | undefined): boolean {
  if (!s) return false;
  if (s.status === 'break') return true;
  const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
    ? s.blindStructureLocked
    : s.blindStructure;
  if (!structure || structure.length === 0) return false;
  const cur = structure.find((l) => l.level === s.currentLevel);
  return cur?.isBreak === true;
}

/** BREAK 종료 후 진입할 다음 play 레벨(isBreak=false 첫 행)을 찾는다.
 *  없으면 null (= 마지막이 break인 비정상 케이스).
 *  사용자 카드에서 "다음 LV N · SB/BB" 표시에 사용. */
export function resolveNextPlayLevel(
  s: LiveSession | null | undefined,
): { level: number; sb: number; bb: number; ante: number; displayedNumber: number } | null {
  if (!s) return null;
  const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
    ? s.blindStructureLocked
    : s.blindStructure;
  if (!structure || structure.length === 0) return null;
  // currentLevel 이후 첫 play 레벨
  let playSeq = 0;
  for (const row of structure) {
    if (!row.isBreak) playSeq++;
    if (row.level > s.currentLevel && !row.isBreak) {
      return {
        level: row.level,
        sb: row.sb,
        bb: row.bb,
        ante: row.ante,
        displayedNumber: playSeq,
      };
    }
  }
  return null;
}
