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
  orderBy,
  where,
  Timestamp,
  getDocs,
} from 'firebase/firestore';
import { db } from './firebase';

export type SeriesStatus = 'upcoming' | 'active' | 'completed';

export interface Series {
  id: string;
  ownerUid: string;
  organizerId?: string;
  name: string;
  season: string;
  description: string;
  status: SeriesStatus;
  posterStyle: string;
  finalDate?: Timestamp;
  finalVenue: string;
  finalBuyIn: number;
  finalGuarantee: number;
  partnerStoreIds: string[];
  seedRule: string;
  // Denormalized stats
  satelliteCount: number;
  satelliteCompleted: number;
  finalistCount: number;
}

export interface Finalist {
  id: string;
  nickname: string;
  storeId: string;
  storeName: string;
  satelliteDate?: Timestamp;
  rank: number;
}

export function seriesCol() {
  return collection(db, 'series');
}

export function finalistsCol(seriesId: string) {
  return collection(db, 'series', seriesId, 'finalists');
}

/** 모든 시리즈 (모바일 홈용) */
export function subscribeAllSeries(
  onChange: (items: Series[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(seriesCol(), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snap) =>
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Series, 'id'>) }))),
    (err) => onError(err as Error),
  );
}

/** 내가 owner인 시리즈만 */
export function subscribeMySeries(
  uid: string,
  onChange: (items: Series[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(seriesCol(), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snap) =>
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Series, 'id'>) }))),
    (err) => onError(err as Error),
  );
}

/** 특정 대회사 소속 시리즈 */
export function subscribeSeriesByOrganizer(
  organizerId: string,
  onChange: (items: Series[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(seriesCol(), where('organizerId', '==', organizerId));
  return onSnapshot(
    q,
    (snap) =>
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Series, 'id'>) }))),
    (err) => onError(err as Error),
  );
}

export function subscribeSeries(
  seriesId: string,
  onChange: (s: Series | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    doc(seriesCol(), seriesId),
    (snap) =>
      onChange(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Series, 'id'>) }) : null),
    (err) => onError(err as Error),
  );
}

export function subscribeFinalists(
  seriesId: string,
  onChange: (items: Finalist[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(finalistsCol(seriesId), orderBy('rank', 'asc'));
  return onSnapshot(
    q,
    (snap) =>
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Finalist, 'id'>) }))),
    (err) => onError(err as Error),
  );
}

export async function createSeries(
  ownerUid: string,
  data: Omit<Series, 'id' | 'ownerUid' | 'satelliteCount' | 'satelliteCompleted' | 'finalistCount'>,
): Promise<string> {
  const payload: Record<string, unknown> = {
    ownerUid,
    ...data,
    satelliteCount: 0,
    satelliteCompleted: 0,
    finalistCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (data.organizerId === undefined) delete payload.organizerId; // Firestore: undefined 차단
  const ref = await addDoc(seriesCol(), payload);
  return ref.id;
}

export async function updateSeries(
  seriesId: string,
  updates: Partial<Omit<Series, 'id' | 'ownerUid'>>,
) {
  await updateDoc(doc(seriesCol(), seriesId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSeries(seriesId: string) {
  await deleteDoc(doc(seriesCol(), seriesId));
}

export async function addFinalistsBatch(
  seriesId: string,
  finalists: Omit<Finalist, 'id'>[],
) {
  // batch write (간단 버전)
  const promises = finalists.map((f) =>
    addDoc(finalistsCol(seriesId), { ...f, createdAt: serverTimestamp() }),
  );
  await Promise.all(promises);
  // 카운터 갱신
  const snap = await getDocs(finalistsCol(seriesId));
  await updateSeries(seriesId, {
    finalistCount: snap.size,
    satelliteCompleted: Math.ceil(snap.size / 2),
  });
}
