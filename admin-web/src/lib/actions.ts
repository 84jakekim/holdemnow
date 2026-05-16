'use client';

import {
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { TournamentInstance } from './tournaments';

/** tel: 링크 (전화 걸기) */
export function callPhone(phone?: string | null) {
  if (!phone) {
    alert('전화번호가 등록되지 않았습니다');
    return;
  }
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (typeof window !== 'undefined') {
    window.location.href = `tel:${cleaned}`;
  }
}

/** 카카오맵 길찾기 (외부 링크) */
export function openDirections(storeName: string, address?: string | null) {
  const q = address ? `${storeName} ${address}` : storeName;
  const encoded = encodeURIComponent(q);
  // 카카오맵 검색 (앱 설치 시 앱 자동, 미설치 시 웹)
  const url = `https://map.kakao.com/?q=${encoded}`;
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener');
  }
}

/** Web Share API (지원 안 되면 URL 복사 fallback) */
export async function shareContent(opts: { title: string; text?: string; url?: string }) {
  if (typeof window === 'undefined') return;
  const url = opts.url ?? window.location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url });
      return;
    } catch {
      // 사용자가 취소한 경우 등 — 무시
      return;
    }
  }
  // fallback: 클립보드 복사
  try {
    await navigator.clipboard.writeText(url);
    alert('링크가 복사되었습니다');
  } catch {
    alert(`공유 링크: ${url}`);
  }
}

/** 시리즈 구독 토글 (users/{uid}/seriesSubscriptions/{seriesId}) */
export function subscribeSeriesSubscription(
  uid: string,
  seriesId: string,
  onChange: (subscribed: boolean) => void,
) {
  return onSnapshot(
    doc(db, 'users', uid, 'seriesSubscriptions', seriesId),
    (snap) => onChange(snap.exists()),
    () => onChange(false),
  );
}

export async function toggleSeriesSubscription(
  uid: string,
  seriesId: string,
  seriesName: string,
  currentlySubscribed: boolean,
) {
  const ref = doc(db, 'users', uid, 'seriesSubscriptions', seriesId);
  if (currentlySubscribed) {
    await deleteDoc(ref);
  } else {
    await setDoc(ref, {
      seriesId,
      seriesName,
      createdAt: serverTimestamp(),
    });
  }
}

/** 관심 토너 (users/{uid}/interests/{tournamentId}) */
export interface InterestDoc {
  tournamentId: string;
  storeId: string;
  storeName: string;
  tournamentName: string;
  posterStyle: string;
  buyIn: number;
  guarantee: number;
  startsAt: Timestamp;
}

export function subscribeTournamentInterest(
  uid: string,
  tournamentId: string,
  onChange: (interested: boolean) => void,
) {
  return onSnapshot(
    doc(db, 'users', uid, 'interests', tournamentId),
    (snap) => onChange(snap.exists()),
    () => onChange(false),
  );
}

export async function toggleTournamentInterest(
  uid: string,
  tournament: TournamentInstance,
  currentlyInterested: boolean,
) {
  const ref = doc(db, 'users', uid, 'interests', tournament.id);
  if (currentlyInterested) {
    await deleteDoc(ref);
  } else {
    await setDoc(ref, {
      tournamentId: tournament.id,
      storeId: tournament.storeId,
      storeName: tournament.storeName,
      tournamentName: tournament.name,
      posterStyle: tournament.posterStyle,
      buyIn: tournament.buyIn,
      guarantee: tournament.guarantee,
      startsAt: tournament.startsAt,
      createdAt: serverTimestamp(),
    });
  }
}
