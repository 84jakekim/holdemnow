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
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';

export type OrganizerStatus = 'active' | 'paused' | 'pending';

export interface Organizer {
  id: string;
  ownerUid: string;
  name: string;
  tagline: string;
  contactEmail?: string;
  status: OrganizerStatus;
}

export function organizersCol() {
  return collection(db, 'organizers');
}

export function subscribeAllOrganizers(
  onChange: (items: Organizer[]) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    query(organizersCol(), orderBy('createdAt', 'desc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Organizer, 'id'>) }))),
    (err) => onError(err as Error),
  );
}

export function subscribeMyOrganizer(
  uid: string,
  onChange: (org: Organizer | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    query(organizersCol(), where('ownerUid', '==', uid)),
    (snap) => {
      const first = snap.docs[0];
      onChange(first ? ({ id: first.id, ...(first.data() as Omit<Organizer, 'id'>) }) : null);
    },
    (err) => onError(err as Error),
  );
}

export function subscribeOrganizer(
  organizerId: string,
  onChange: (org: Organizer | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    doc(organizersCol(), organizerId),
    (snap) =>
      onChange(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Organizer, 'id'>) }) : null),
    (err) => onError(err as Error),
  );
}

export async function createOrganizer(
  ownerUid: string,
  data: Pick<Organizer, 'name' | 'tagline' | 'contactEmail'>,
): Promise<string> {
  const ref = await addDoc(organizersCol(), {
    ownerUid,
    name: data.name,
    tagline: data.tagline,
    contactEmail: data.contactEmail ?? null,
    status: 'active' as OrganizerStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // owner user doc에 organizerId 매핑 + organizer_master role 추가
  const userRef = doc(db, 'users', ownerUid);
  const userSnap = await getDoc(userRef);
  const existingRoles = (userSnap.data()?.roles as string[] | undefined) ?? [];
  const newRoles = existingRoles.includes('organizer_master')
    ? existingRoles
    : [...existingRoles, 'organizer_master'];
  await setDoc(
    userRef,
    {
      uid: ownerUid,
      organizerId: ref.id,
      roles: newRoles,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return ref.id;
}

export async function updateOrganizer(
  organizerId: string,
  updates: Partial<Pick<Organizer, 'name' | 'tagline' | 'contactEmail' | 'status'>>,
) {
  await updateDoc(doc(organizersCol(), organizerId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteOrganizer(organizerId: string) {
  await deleteDoc(doc(organizersCol(), organizerId));
}
