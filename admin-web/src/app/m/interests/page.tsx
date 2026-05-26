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

  // 다가오는 토너만 표시. 종료된 토너(startsAt + 6h 지남)는 Cloud Function
  // cleanupExpiredInterests가 자동 정리. 매장이 같은 토너를 매번 새 인스턴스로
  // 등록하므로 "지난 토너" 기록 보존은 무의미.
  const upcoming = useMemo(() => {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000; // -6h 보다 새것만 (cron 사이클 안 잔존분)
    return [...items]
      .filter((it) => {
        if (!it.startsAt || typeof (it.startsAt as Timestamp).toDate !== 'function') return true;
        return (it.startsAt as Timestamp).toDate().getTime() > cutoff;
      })
      .sort((a, b) => {
        const ta = a.startsAt ? (a.startsAt as Timestamp).toDate().getTime() : Infinity;
        const tb = b.startsAt ? (b.startsAt as Timestamp).toDate().getTime() : Infinity;
        return ta - tb;
      });
  }, [items]);
  const totalCount = upcoming.length;

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
      {/* 골드 hero — 관심 토너 = 트로피 톤 */}
      <header
        className="px-5 pt-5 pb-6 text-white relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #B8860B 0%, #F59E0B 55%, #FCD34D 100%)',
        }}
      >
        <div
          aria-hidden
          className="absolute top-[-40px] right-[-40px] w-[220px] h-[220px] rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 65%)',
          }}
        />
        <div className="relative z-10 flex items-start justify-between gap-3">
          <button onClick={() => router.back()} className="hero-pink-action w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 tap" aria-label="뒤로">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase opacity-90">MY INTERESTS</div>
            <h1 className="h2 font-serif mt-1.5">⭐ 관심 토너</h1>
            <p className="text-[13px] font-semibold opacity-90 mt-1.5">시작 1시간 전 푸시 알림</p>
          </div>
          <div className="w-9 h-9 flex-shrink-0" aria-hidden />
        </div>
      </header>

      {loading ? (
        <div className="p-5 space-y-2">
          <div className="skel h-20 rounded-r-md" />
          <div className="skel h-20 rounded-r-md" />
        </div>
      ) : totalCount === 0 ? (
        <div className="px-5 pt-6">
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden>⭐</div>
            <div>
              <div className="empty-state-title">관심 토너가 없어요</div>
              <div className="empty-state-desc" style={{ marginTop: 6 }}>
                캘린더나 매장 상세에서 ☆ 버튼을 눌러 관심 토너를 등록하세요.
                시작 1시간 전 푸시로 알려드립니다.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-2">
          {upcoming.map((it) => (
            <InterestRow key={it.tournamentId} it={it} onOpen={() => router.push(`/m/store/${it.storeId}`)} onRemove={() => { if (window.confirm('관심 해제할까요?')) removeInterest(it.tournamentId); }} />
          ))}
        </div>
      )}

      <div className="px-5 py-6 text-center text-[10px] text-gray-400">
        💡 시작 1시간 전, 늦은 등록 30분 전 FCM 푸시 자동 발송됩니다
      </div>
    </div>
  );
}

/* ============================================================
 * 관심 토너 한 행 — 다가오는·지난 공용
 * ========================================================== */
function InterestRow({
  it,
  onOpen,
  onRemove,
}: {
  it: InterestDoc;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const poster = posterStyleFor(it.posterStyle);
  const startsMs = it.startsAt && typeof (it.startsAt as Timestamp).toDate === 'function'
    ? (it.startsAt as Timestamp).toDate().getTime()
    : null;
  const t = startsMs != null ? new Date(startsMs) : null;
  const hh = t ? String(t.getHours()).padStart(2, '0') : '--';
  const mm = t ? String(t.getMinutes()).padStart(2, '0') : '--';
  const today = new Date();
  const isToday = t &&
    t.getFullYear() === today.getFullYear() &&
    t.getMonth() === today.getMonth() &&
    t.getDate() === today.getDate();
  const minutesUntil = startsMs != null ? Math.floor((startsMs - Date.now()) / (1000 * 60)) : null;
  const imminent = minutesUntil != null && minutesUntil >= -60 && minutesUntil <= 60;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-2xl border ${
        imminent ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
      }`}
    >
      <button
        onClick={onOpen}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
      >
        <div
          className="w-12 h-16 rounded-md flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
          style={{ background: poster.bg, color: poster.color }}
        >
          {it.tournamentName.split(' ')[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate text-gray-900">
            {it.tournamentName}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {t ? (
              <>
                <span className="font-mono font-bold text-gray-900">
                  {isToday ? '오늘' : `${t.getMonth() + 1}/${t.getDate()}`} {hh}:{mm}
                </span>{' '}
              </>
            ) : (
              <span className="font-mono font-bold text-gray-400">시각 미지정 </span>
            )}
            · {it.storeName}
          </div>
          {imminent && minutesUntil != null && (
            <div className="inline-flex items-center gap-1 mt-1.5 bg-red-100 text-red-700 rounded px-1.5 py-0.5 text-[10px] font-extrabold">
              ⏰ {minutesUntil > 0 ? `${minutesUntil}분 후 시작` : '진행 중'}
            </div>
          )}
        </div>
      </button>
      <button
        onClick={onRemove}
        className="w-8 h-8 rounded-full bg-yellow-50 text-yellow-500 border border-yellow-300 flex items-center justify-center text-base flex-shrink-0"
        title="관심 해제"
      >
        ★
      </button>
    </div>
  );
}
