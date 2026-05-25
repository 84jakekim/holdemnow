'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  collection,
  documentId,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import { type Series } from '@/lib/series';
import { posterStyleFor } from '@/lib/templates';

interface SubDoc {
  seriesId: string;
  seriesName: string;
}

export default function SubscriptionsPage() {
  const authState = useAuth();
  const router = useRouter();
  const [subs, setSubs] = useState<SubDoc[]>([]);
  const [seriesMap, setSeriesMap] = useState<Record<string, Series>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authState.status !== 'authenticated') {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(
      collection(db, 'users', authState.user.uid, 'seriesSubscriptions'),
      (snap) => {
        setSubs(snap.docs.map((d) => d.data() as SubDoc));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [authState]);

  useEffect(() => {
    const ids = subs.map((s) => s.seriesId).filter((id) => !(id in seriesMap));
    if (ids.length === 0) return;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'series'), where(documentId(), 'in', ids.slice(0, 10))),
        );
        const next: Record<string, Series> = {};
        snap.forEach((d) => {
          next[d.id] = { id: d.id, ...(d.data() as Omit<Series, 'id'>) };
        });
        setSeriesMap((prev) => ({ ...prev, ...next }));
      } catch {
        // ignore
      }
    })();
  }, [subs, seriesMap]);

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

  return (
    <div>
      {/* 골드 hero */}
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
            <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase opacity-90">SERIES SUBSCRIPTIONS</div>
            <h1 className="h2 font-serif mt-1.5">🏆 시리즈 구독</h1>
            <p className="text-[13px] font-semibold opacity-90 mt-1.5">본선 D-7/D-3/D-1 푸시</p>
          </div>
          <div className="w-9 h-9 flex-shrink-0" aria-hidden />
        </div>
      </header>

      {loading ? (
        <div className="p-5 space-y-3">
          <div className="skel h-28 rounded-r-xl" />
          <div className="skel h-28 rounded-r-xl" />
        </div>
      ) : subs.length === 0 ? (
        <div className="px-5 pt-6">
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden>🏆</div>
            <div>
              <div className="empty-state-title">구독 중인 시리즈가 없어요</div>
              <div className="empty-state-desc" style={{ marginTop: 6 }}>
                홈의 메이저 시리즈 카드를 탭하고 🔔 구독을 누르세요.
                본선 D-7/D-3/D-1 푸시 알림을 받습니다.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-3">
          {subs.map((sub) => {
            const s = seriesMap[sub.seriesId];
            const poster = s ? posterStyleFor(s.posterStyle) : null;
            return (
              <Link
                key={sub.seriesId}
                href={`/m/series/${sub.seriesId}`}
                className="block pr-card overflow-hidden lift tap"
              >
                {poster && s ? (
                  <div className="p-4" style={{ background: poster.bg, color: poster.color }}>
                    <div className="text-[10px] opacity-80 mb-1">{s.season}</div>
                    <div className="text-base font-extrabold font-serif">{s.name}</div>
                  </div>
                ) : (
                  <div className="p-4 bg-gray-100">
                    <div className="text-base font-bold">{sub.seriesName}</div>
                  </div>
                )}
                {s && (
                  <div className="p-3 flex justify-between items-baseline">
                    <div className="text-[11px] text-gray-500">
                      본선{' '}
                      {s.finalDate
                        ? s.finalDate.toDate().toISOString().slice(0, 10)
                        : '미정'}
                    </div>
                    {/* 게런티 표기 제거 — 법적 리스크 (현금 상금 노출 금지) */}
                    <div className="text-[10px] text-gray-400 font-bold">{s.season}</div>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
