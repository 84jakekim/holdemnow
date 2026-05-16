'use client';

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import type { BlindLevel, TournamentTemplate } from './templates';

export type LiveStatus = 'running' | 'paused' | 'break' | 'completed';

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
  levelSecondsLeft: number;
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

/** 매장의 진행 중(또는 일시정지) 세션 실시간 구독 */
export function subscribeStoreLiveSessions(
  storeId: string,
  onChange: (items: LiveSession[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    liveSessionsCol(),
    where('storeId', '==', storeId),
    where('status', 'in', ['running', 'paused', 'break']),
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

export async function startLiveSession(
  storeId: string,
  storeName: string,
  template: TournamentTemplate,
): Promise<string> {
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
    status: 'running' as LiveStatus,
    currentLevel: first.level,
    levelSecondsLeft: first.durationSec,
    smallBlind: first.sb,
    bigBlind: first.bb,
    ante: first.ante,
    playersRemaining: template.totalPlayers,
    tablesRemaining: Math.max(1, Math.ceil(template.totalPlayers / 8)),
    prizePool: template.prizePool || template.buyIn * template.totalPlayers,
    lateRegClosed: false,
    viewerCount: 0,
    startedAt: serverTimestamp(),
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

export async function togglePauseSession(s: LiveSession, currentSecondsLeft: number) {
  await patchSession(s.id, {
    status: s.status === 'paused' ? 'running' : 'paused',
    levelSecondsLeft: currentSecondsLeft,
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
  });
}

export async function addSecondsToSession(s: LiveSession, currentSecondsLeft: number, delta: number) {
  const maxSec = (s.blindStructure.find((l) => l.level === s.currentLevel)?.durationSec || 1200) * 3;
  const next = Math.max(0, Math.min(maxSec, currentSecondsLeft + delta));
  await patchSession(s.id, { levelSecondsLeft: next });
}

export async function eliminatePlayerInSession(s: LiveSession, currentSecondsLeft: number) {
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
    await patchSession(s.id, { levelSecondsLeft: 0 });
    return false;
  }
  await patchSession(s.id, {
    currentLevel: next.level,
    smallBlind: next.sb,
    bigBlind: next.bb,
    ante: next.ante,
    levelSecondsLeft: next.durationSec,
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
