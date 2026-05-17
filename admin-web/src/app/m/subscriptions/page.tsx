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
      <div className="px-4 h-14 flex items-center gap-2 border-b border-gray-100">
        <button onClick={() => router.back()} className="text-xl px-1">←</button>
        <span className="text-lg font-extrabold font-serif">시리즈 구독</span>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500">로딩 중…</div>
      ) : subs.length === 0 ? (
        <div className="p-8 text-center">
          <div className="text-4xl mb-3">🏆</div>
          <div className="font-bold text-gray-900 mb-2">구독 중인 시리즈가 없습니다</div>
          <div className="text-xs text-gray-500 leading-relaxed">
            홈의 메이저 시리즈 카드를 탭하고 🔔 구독을 누르세요.<br />
            본선 D-7 / D-3 / D-1 푸시 알림을 받습니다.
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
                className="block bg-white rounded-2xl border border-gray-200 overflow-hidden active:scale-[0.98] transition"
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
                    <div className="font-mono text-sm font-extrabold text-red-500">
                      ₩{(s.finalGuarantee / 100000000).toFixed(1)}억
                    </div>
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
