'use client';

import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { BlindLevel, TournamentTemplate, TournamentType } from './templates';

export type TournamentInstanceStatus = 'scheduled' | 'live' | 'completed' | 'cancelled';

export interface TournamentInstance {
  id: string;
  storeId: string;
  storeName: string;
  templateId: string;
  name: string;
  type: TournamentType;
  posterStyle: string;
  buyIn: number;
  guarantee: number;
  totalPlayers: number;
  startingStack: number;
  lateRegEndLevel: number;
  blindStructure: BlindLevel[];
  startsAt: Timestamp;
  status: TournamentInstanceStatus;
  activeLiveSessionId?: string;
}

export function tournamentsCol(storeId: string) {
  return collection(db, 'stores', storeId, 'tournaments');
}

/** 매장의 예정·진행 중 토너 구독 */
export function subscribeStoreTournaments(
  storeId: string,
  onChange: (items: TournamentInstance[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    tournamentsCol(storeId),
    where('status', 'in', ['scheduled', 'live']),
    orderBy('startsAt', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        snap.docs.map((d) => ({ id: d.id, storeId, ...(d.data() as Omit<TournamentInstance, 'id' | 'storeId'>) })),
      ),
    (err) => onError(err as Error),
  );
}

/** 전체 매장의 예정·진행 중 토너 (모바일 캘린더용) — collectionGroup */
export function subscribeAllTournaments(
  onChange: (items: TournamentInstance[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    collectionGroup(db, 'tournaments'),
    where('status', 'in', ['scheduled', 'live']),
    orderBy('startsAt', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<TournamentInstance, 'id'>),
      })) as TournamentInstance[];
      onChange(items);
    },
    (err) => onError(err as Error),
  );
}

export async function createTournament(
  storeId: string,
  storeName: string,
  template: TournamentTemplate,
  startsAt: Date,
): Promise<string> {
  const ref = await addDoc(tournamentsCol(storeId), {
    storeId,
    storeName,
    templateId: template.id,
    name: template.name,
    type: template.type,
    posterStyle: template.posterStyle,
    buyIn: template.buyIn,
    guarantee: template.guarantee,
    totalPlayers: template.totalPlayers,
    startingStack: template.startingStack,
    lateRegEndLevel: template.lateRegEndLevel,
    blindStructure: template.blindStructure,
    startsAt: Timestamp.fromDate(startsAt),
    status: 'scheduled' as TournamentInstanceStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteTournament(storeId: string, tournamentId: string) {
  await deleteDoc(doc(tournamentsCol(storeId), tournamentId));
}

export async function cancelTournament(storeId: string, tournamentId: string) {
  await updateDoc(doc(tournamentsCol(storeId), tournamentId), {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
  });
}
