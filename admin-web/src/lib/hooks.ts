'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from './firebase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: User };

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setState(u ? { status: 'authenticated', user: u } : { status: 'anonymous' });
    });
    return unsub;
  }, []);
  return state;
}

export type UserRole = 'store_master' | 'store_staff' | 'organizer_master' | 'organizer_staff' | 'platform_admin';

export interface UserDoc {
  uid: string;
  storeId?: string;
  organizerId?: string;
  role?: UserRole;
  roles?: UserRole[];          // 다중 역할 (사장 + 본사 관리자 둘 다 등)
  nickname?: string;
  email?: string;
  displayName?: string;
}

export function hasRole(user: UserDoc | null | undefined, target: UserRole): boolean {
  if (!user) return false;
  if (user.role === target) return true;
  if (user.roles?.includes(target)) return true;
  return false;
}

/** users/{uid} document 실시간 구독 */
export function useUserDoc(uid: string | null) {
  const [doc_, setDoc] = useState<UserDoc | null | undefined>(undefined); // undefined=loading
  useEffect(() => {
    if (!uid) {
      setDoc(null);
      return;
    }
    const ref = doc(db, 'users', uid);
    const unsub = onSnapshot(
      ref,
      (snap) => setDoc(snap.exists() ? ({ uid, ...snap.data() } as UserDoc) : null),
      () => setDoc(null),
    );
    return unsub;
  }, [uid]);
  return doc_;
}

export interface StoreDoc {
  id: string;
  name: string;
  ownerUid?: string;
  address?: string;
  addressDetail?: string;
  phone?: string;
  hours?: string;
  description?: string;
  facilities?: string[];
  photoUrls?: string[];
  status?: 'active' | 'paused' | 'closed' | 'pending';
  tier?: 'free' | 'premium' | 'vip';
}

export function useStoreDoc(storeId: string | null) {
  const [store, setStore] = useState<StoreDoc | null | undefined>(undefined);
  useEffect(() => {
    if (!storeId) {
      setStore(null);
      return;
    }
    const ref = doc(db, 'stores', storeId);
    const unsub = onSnapshot(
      ref,
      (snap) => setStore(snap.exists() ? ({ id: snap.id, ...snap.data() } as StoreDoc) : null),
      () => setStore(null),
    );
    return unsub;
  }, [storeId]);
  return store;
}

/** 매장 fetch (1회) — gated 라우팅에서 사용 */
export async function fetchMyStoreId(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const data = snap.data() as UserDoc;
  return data.storeId ?? null;
}
