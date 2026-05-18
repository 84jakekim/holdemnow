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
  startedAt?: unknown;
  endedAt?: unknown;
}

export function liveSessionsCol() {
  return collection(db, 'liveSessions');
}

/** "지금부터 N초 후" Timestamp 생성 (Firestore는 add-seconds 연산을 지원 안 해서 클라 시계 기준). */
function deadlineFromNow(seconds: number): Timestamp {
  return Timestamp.fromMillis(Date.now() + Math.max(0, seconds) * 1000);
}

/** 세션 객체에서 현재 표시할 남은 초 계산.
 *  running + levelEndsAt 있음 → deadline − now (절대 시각 기반, 폰 재접속해도 정확)
 *  그 외 (paused, break, 레거시) → 저장된 levelSecondsLeft */
export function computeRemainingSec(s: LiveSession): number {
  if (s.status === 'running' && s.levelEndsAt) {
    const endsMs = s.levelEndsAt.toMillis();
    return Math.max(0, Math.floor((endsMs - Date.now()) / 1000));
  }
  return Math.max(0, s.levelSecondsLeft);
}

/** 표시용 카운트다운 훅 — 1초 tick + 세션 변화 시 재동기화. */
export function useLiveCountdown(session: LiveSession | null | undefined): number {
  const [sec, setSec] = useState(() => (session ? computeRemainingSec(session) : 0));
  useEffect(() => {
    if (!session) {
      setSec(0);
      return;
    }
    setSec(computeRemainingSec(session));
    if (session.status !== 'running') return;
    const t = setInterval(() => setSec(computeRemainingSec(session)), 1000);
    return () => clearInterval(t);
    // 세션의 정체성 + 타이머 상태가 바뀌면 재구성
  }, [
    session?.id,
    session?.status,
    session?.currentLevel,
    session?.levelSecondsLeft,
    session?.levelEndsAt?.toMillis(),
  ]);
  return sec;
}

/** 전체 진행 중 LIVE 세션 구독 (모바일 피드용) */
export function subscribeAllLiveSessions(
  onChange: (items: LiveSession[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    liveSessionsCol(),
    where('status', 'in', ['running', 'paused', 'break']),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LiveSession, 'id'>) }));
      onChange(items);
    },
    (err) => onError(err as Error),
  );
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

/** 매장의 활성 세션 실시간 구독 — 매장 어드민은 'ready'(시작 대기)도 봐야 시작 버튼을 누를 수 있음. */
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
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<LiveSession, 'id'>) }),
      );
      onChange(items);
    },
    (err) => onError(err as Error),
  );
}

/**
 * 새 LIVE 세션 생성 — 대기(ready) 상태로.
 * 카운트다운은 자동으로 출발하지 않음. 사장이 LivePanel에서 "▶ 시작"을 눌러야
 * togglePauseSession이 ready→running 전환하며 levelEndsAt(=deadline)을 박는다.
 * 모바일/지도 LIVE 피드(subscribeAllLiveSessions)는 ready를 제외하므로,
 * 사장이 실제 시작을 누르기 전까진 외부에 노출되지 않음.
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
    prizePool: template.prizePool || template.buyIn * template.totalPlayers,
    lateRegClosed: false,
    viewerCount: 0,
    // startedAt은 첫 'ready'→'running' 전환 시 togglePauseSession에서 박음 (실제 진행 시작 시각).
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
 * 시작/일시정지 토글.
 * - ready 또는 paused → running: 남은 시간만큼 새 deadline 박음.
 * - ready→running 첫 전환: startedAt(실제 진행 시작 시각)도 같이 박음.
 * - running → paused: deadline=null, 남은 초만 보존.
 */
export async function togglePauseSession(s: LiveSession, currentSecondsLeft: number) {
  const isStarting = s.status === 'ready' || s.status === 'paused';
  const newStatus: LiveStatus = isStarting ? 'running' : 'paused';
  const wasReady = s.status === 'ready';
  await patchSession(s.id, {
    status: newStatus,
    levelSecondsLeft: currentSecondsLeft,
    levelEndsAt: isStarting ? deadlineFromNow(currentSecondsLeft) : null,
    ...(wasReady && newStatus === 'running' ? { startedAt: serverTimestamp() } : {}),
  });
}

export async function goToLevelInSession(s: LiveSession, delta: 1 | -1, currentSecondsLeft: number) {
  const target = s.blindStructure.find((l) => l.level === s.currentLevel + delta);
  if (!target) return;
  await patchSession(s.id, {
    currentLevel: target.level,
    smallBlind: target.sb,
    bigBlind: target.bb,
    ante: target.ante,
    levelSecondsLeft: target.durationSec,
    levelEndsAt: s.status === 'running' ? deadlineFromNow(target.durationSec) : null,
  });
}

export async function addSecondsToSession(s: LiveSession, currentSecondsLeft: number, delta: number) {
  const maxSec = (s.blindStructure.find((l) => l.level === s.currentLevel)?.durationSec || 1200) * 3;
  const next = Math.max(0, Math.min(maxSec, currentSecondsLeft + delta));
  await patchSession(s.id, {
    levelSecondsLeft: next,
    levelEndsAt: s.status === 'running' ? deadlineFromNow(next) : null,
  });
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

export async function nextLevelTick(s: LiveSession) {
  // 카운트다운 0 도달 시 자동 다음 레벨
  const next = s.blindStructure.find((l) => l.level === s.currentLevel + 1);
  if (!next) {
    // 마지막 레벨까지 모두 소진 → 자동 라이브 종료.
    // status='completed'가 되면 subscribeAllLiveSessions의 in 쿼리에서 자동 제외되어
    // 모바일/지도/매장 LIVE 표시 모두 자동으로 사라짐.
    await stopLiveSession(s, 0);
    return false;
  }
  await patchSession(s.id, {
    currentLevel: next.level,
    smallBlind: next.sb,
    bigBlind: next.bb,
    ante: next.ante,
    levelSecondsLeft: next.durationSec,
    levelEndsAt: deadlineFromNow(next.durationSec),
  });
  return true;
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
