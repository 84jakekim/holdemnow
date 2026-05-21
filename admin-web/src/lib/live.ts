'use client';

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  query,
  where,
  orderBy,
  increment,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from './firebase';
import type { BlindLevel, TournamentTemplate } from './templates';

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
 *  ⚠ 과거에 있던 "levelEndsAt + 180초 = 좀비" 룰은 **제거**됨.
 *    Deterministic timeline 도입 후 autoAdvanceLevel cron은 같은 currentLevel이면
 *    doc update를 의도적으로 skip한다. 결과적으로 doc의 levelEndsAt은 "첫 레벨 시작 시점에
 *    박힌 deadline" 상태로 머무르고, 첫 레벨 종료 + 180초 시점에 정상 진행 중인 세션을
 *    "좀비"로 오판해 화면에서 가리는 버그가 발생했다.
 *    좀비 세션 정리는 서버 cron(autoStopFinishedSessions)이 totalStartedAt + structure로
 *    실제 elapsed를 계산해 처리한다 — 클라이언트는 doc의 status만 신뢰한다.
 */
function isSessionExpired(s: LiveSession): boolean {
  if (s.finishingAt) {
    const endsMs = s.finishingAt.toMillis() + FINISHING_GRACE_SEC * 1000;
    if (endsMs <= Date.now()) return true;
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
  const first = template.blindStructure[0];
  const ref = await addDoc(liveSessionsCol(), {
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
    smallBlind: first.sb,
    bigBlind: first.bb,
    ante: first.ante,
    playersRemaining: template.totalPlayers,
    tablesRemaining: Math.max(1, Math.ceil(template.totalPlayers / 8)),
    // 상금풀 항상 0 — 사용자 앱 어디에도 표기되지 않음 (법적 리스크)
    prizePool: 0,
    lateRegClosed: false,
    viewerCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function patchSession(sessionId: string, updates: Partial<LiveSession>) {
  await updateDoc(doc(liveSessionsCol(), sessionId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
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
    });
    return;
  }

  // running → paused
  await patchSession(s.id, {
    status: 'paused',
    pausedAt: serverTimestamp() as unknown as Timestamp,
    levelSecondsLeft: currentSecondsLeft,
    levelEndsAt: null,
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
    // Deterministic timeline 재정렬 — 핵심 fix
    totalStartedAt: newTotalStartedTs,
    // blindStructureLocked가 비어있으면 지금 박아준다 (이후 일관성 보장)
    ...(hasTimeline ? {} : { blindStructureLocked: structure }),
  });
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
  if (s.totalStartedAt) {
    const shiftedMs = s.totalStartedAt.toMillis() + actualDelta * 1000;
    updates.totalStartedAt = Timestamp.fromMillis(shiftedMs);
  }

  await patchSession(s.id, updates);
}

/**
 * 진행바 드래그로 현재 레벨의 남은 시간을 직접 설정 — 2순위 요구.
 * UX: 사용자가 슬라이더/진행바를 드래그하면 newSecondsLeft를 그대로 setTimeRemaining 호출.
 *
 * 구현: addSecondsToSession과 동일 원리. delta = newSec - currentSec 계산 후 timeline shift.
 * 클램프: [1, currentLvlDur] — 마지막 레벨 끝을 넘기는 실수를 원천 차단.
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
  const clamped = Math.max(1, Math.min(curLvlDur, Math.round(newSecondsLeft)));
  const delta = clamped - currentSecondsLeft;
  if (delta === 0) return;

  const updates: Partial<LiveSession> = {
    levelSecondsLeft: clamped,
    levelEndsAt: s.status === 'running' ? deadlineFromNow(clamped) : null,
  };

  if (s.totalStartedAt) {
    const shiftedMs = s.totalStartedAt.toMillis() + delta * 1000;
    updates.totalStartedAt = Timestamp.fromMillis(shiftedMs);
  }

  await patchSession(s.id, updates);
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

export async function stopLiveSession(s: LiveSession, currentSecondsLeft: number) {
  await patchSession(s.id, {
    levelSecondsLeft: currentSecondsLeft,
    levelEndsAt: null,
    status: 'completed',
    endedAt: serverTimestamp(),
  });
  // v0.1 데모: 완료된 세션은 어드민 리스트에서 자동 제외 (where status in running/paused/break)
  // 영구 삭제는 v0.2에서 (이력 보관 목적)
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
