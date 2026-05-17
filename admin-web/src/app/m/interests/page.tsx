'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  doc,
  deleteDoc,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import { posterStyleFor } from '@/lib/templates';
import type { InterestDoc } from '@/lib/actions';

export default function InterestsPage() {
  const authState = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<InterestDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authState.status !== 'authenticated') {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(
      collection(db, 'users', authState.user.uid, 'interests'),
      (snap) => {
        setItems(snap.docs.map((d) => d.data() as InterestDoc));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [authState]);

  // 시작 시간 순 정렬 (과거 제외)
  const sorted = useMemo(() => {
    const now = Date.now();
    return [...items]
      .filter((it) => it.startsAt && (it.startsAt as Timestamp).toDate().getTime() > now - 60 * 60 * 1000)
      .sort((a, b) => (a.startsAt as Timestamp).toDate().getTime() - (b.startsAt as Timestamp).toDate().getTime());
  }, [items]);

  // 비로그인 → /m (effect로)
  useEffect(() => {
    if (authState.status === 'anonymous') router.replace('/m');
  }, [authState.status, router]);

  if (authState.status === 'loading') {
    return <div className="p-6 text-center text-sm text-gray-500">로딩 중…</div>;
  }
  if (authState.status === 'anonymous') {
    return null;
  }

  const removeInterest = async (tournamentId: string) => {
    if (authState.status !== 'authenticated') return;
    await deleteDoc(doc(db, 'users', authState.user.uid, 'interests', tournamentId));
  };

  return (
    <div>
      <div className="px-4 h-14 flex items-center gap-2 border-b border-gray-100">
        <button onClick={() => router.back()} className="text-xl px-1">←</button>
        <span className="text-lg font-extrabold font-serif">관심 토너</span>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500">로딩 중…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center">
          <div className="text-4xl mb-3">⭐</div>
          <div className="font-bold text-gray-900 mb-2">관심 토너가 없습니다</div>
          <div className="text-xs text-gray-500 leading-relaxed">
            토너 캘린더나 매장 상세에서 ☆ 버튼을 눌러<br />
            관심 토너를 등록하세요. <b>시작 1시간 전 푸시</b>로 알려드립니다.
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-2">
          {sorted.map((it) => {
            const poster = posterStyleFor(it.posterStyle);
            const t = (it.startsAt as Timestamp).toDate();
            const hh = String(t.getHours()).padStart(2, '0');
            const mm = String(t.getMinutes()).padStart(2, '0');
            const today = new Date();
            const isToday =
              t.getFullYear() === today.getFullYear() &&
              t.getMonth() === today.getMonth() &&
              t.getDate() === today.getDate();
            const minutesUntil = Math.floor((t.getTime() - Date.now()) / (1000 * 60));
            const imminent = minutesUntil >= -60 && minutesUntil <= 60;

            return (
              <div
                key={it.tournamentId}
                className={`flex items-center gap-3 p-3 rounded-2xl border ${
                  imminent ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
                }`}
              >
                <button
                  onClick={() => router.push(`/m/store/${it.storeId}`)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div
                    className="w-12 h-16 rounded-md flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
                    style={{ background: poster.bg, color: poster.color }}
                  >
                    {it.tournamentName.split(' ')[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-900 truncate">
                      {it.tournamentName}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      <span className="font-mono font-bold text-gray-900">
                        {isToday ? '오늘' : `${t.getMonth() + 1}/${t.getDate()}`} {hh}:{mm}
                      </span>{' '}
                      · {it.storeName}
                    </div>
                    {imminent && (
                      <div className="inline-flex items-center gap-1 mt-1.5 bg-red-100 text-red-700 rounded px-1.5 py-0.5 text-[10px] font-extrabold">
                        ⏰ {minutesUntil > 0 ? `${minutesUntil}분 후 시작` : '진행 중'}
                      </div>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => {
                    if (window.confirm('관심 해제할까요?')) removeInterest(it.tournamentId);
                  }}
                  className="w-8 h-8 rounded-full bg-yellow-50 text-yellow-500 border border-yellow-300 flex items-center justify-center text-base flex-shrink-0"
                  title="관심 해제"
                >
                  ★
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="px-5 py-6 text-center text-[10px] text-gray-400">
        💡 시작 1시간 전, 늦은 등록 30분 전 푸시 알림은 v0.2 (FCM)에서 자동 발송
      </div>
    </div>
  );
}
