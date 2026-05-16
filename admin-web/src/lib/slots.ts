'use client';

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  getDocs,
} from 'firebase/firestore';
import { db } from './firebase';

export interface DisplaySlot {
  slotNum: number;
  name?: string;
  sessionId?: string | null;
}

export function slotsCollection(storeId: string) {
  return collection(db, 'stores', storeId, 'displaySlots');
}

export function subscribeSlots(
  storeId: string,
  onChange: (items: DisplaySlot[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(slotsCollection(storeId), orderBy('slotNum', 'asc'));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => d.data() as DisplaySlot)),
    (err) => onError(err as Error),
  );
}

export function subscribeSlot(
  storeId: string,
  slotNum: number,
  onChange: (s: DisplaySlot | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    doc(slotsCollection(storeId), String(slotNum)),
    (snap) => onChange(snap.exists() ? (snap.data() as DisplaySlot) : null),
    (err) => onError(err as Error),
  );
}

export async function setSlotSession(
  storeId: string,
  slotNum: number,
  sessionId: string | null,
) {
  await updateDoc(doc(slotsCollection(storeId), String(slotNum)), {
    sessionId,
    updatedAt: serverTimestamp(),
  });
}

export async function addSlot(storeId: string, name?: string) {
  const snap = await getDocs(slotsCollection(storeId));
  const nums = snap.docs.map((d) => (d.data() as DisplaySlot).slotNum);
  const nextNum = nums.length === 0 ? 1 : Math.max(...nums) + 1;
  const slot: DisplaySlot = { slotNum: nextNum, name: name ?? `${nextNum}번 TV`, sessionId: null };
  await setDoc(doc(slotsCollection(storeId), String(nextNum)), {
    ...slot,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return nextNum;
}

export async function removeSlot(storeId: string, slotNum: number) {
  await deleteDoc(doc(slotsCollection(storeId), String(slotNum)));
}

export async function renameSlot(storeId: string, slotNum: number, name: string) {
  await updateDoc(doc(slotsCollection(storeId), String(slotNum)), {
    name,
    updatedAt: serverTimestamp(),
  });
}
