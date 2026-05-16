'use client';

import { useEffect, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import {
  subscribeTournamentInterest,
  toggleTournamentInterest,
} from '@/lib/actions';
import type { TournamentInstance } from '@/lib/tournaments';

/** 관심 토너 ⭐ 토글 버튼 — 작은 사이즈 (캘린더·매장상세용) */
export default function TournamentInterestStar({
  tournament,
  size = 'md',
}: {
  tournament: TournamentInstance;
  size?: 'sm' | 'md';
}) {
  const authState = useAuth();
  const [interested, setInterested] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authState.status !== 'authenticated') {
      setInterested(false);
      return;
    }
    const unsub = subscribeTournamentInterest(
      authState.user.uid,
      tournament.id,
      setInterested,
    );
    return unsub;
  }, [authState, tournament.id]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (authState.status !== 'authenticated') {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch {
        return;
      }
      return;
    }
    setBusy(true);
    try {
      await toggleTournamentInterest(authState.user.uid, tournament, interested);
    } finally {
      setBusy(false);
    }
  };

  const px = size === 'sm' ? 'w-8 h-8 text-base' : 'w-9 h-9 text-lg';

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={`${px} rounded-full flex items-center justify-center flex-shrink-0 transition disabled:opacity-50 ${
        interested
          ? 'bg-yellow-50 text-yellow-500 border border-yellow-300'
          : 'bg-gray-50 text-gray-400 border border-gray-200 hover:text-gray-700'
      }`}
      title={interested ? '관심 해제' : '관심 등록 (시작 1시간 전 알림)'}
    >
      {interested ? '★' : '☆'}
    </button>
  );
}
