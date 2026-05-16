'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import {
  type Series,
  type Finalist,
  subscribeSeries,
  subscribeFinalists,
} from '@/lib/series';
import { posterStyleFor } from '@/lib/templates';
import {
  shareContent,
  subscribeSeriesSubscription,
  toggleSeriesSubscription,
} from '@/lib/actions';
import { useAuth } from '@/lib/hooks';

interface StoreSummary {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
}

function daysUntil(ts?: { toDate: () => Date }) {
  if (!ts) return null;
  const ms = ts.toDate().getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default function SeriesPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = use(params);
  const router = useRouter();
  const authState = useAuth();
  const [series, setSeries] = useState<Series | null | undefined>(undefined);
  const [finalists, setFinalists] = useState<Finalist[]>([]);
  const [partnerStores, setPartnerStores] = useState<StoreSummary[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [subBusy, setSubBusy] = useState(false);

  // 구독 상태 실시간
  useEffect(() => {
    if (authState.status !== 'authenticated') {
      setSubscribed(false);
      return;
    }
    const unsub = subscribeSeriesSubscription(authState.user.uid, seriesId, setSubscribed);
    return unsub;
  }, [authState, seriesId]);

  const handleSubscribe = async () => {
    if (authState.status !== 'authenticated') {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch {
        return;
      }
      return;
    }
    if (!series) return;
    setSubBusy(true);
    try {
      await toggleSeriesSubscription(authState.user.uid, seriesId, series.name, subscribed);
    } finally {
      setSubBusy(false);
    }
  };

  useEffect(() => {
    const unsub = subscribeSeries(seriesId, setSeries, () => setSeries(null));
    return unsub;
  }, [seriesId]);

  useEffect(() => {
    const unsub = subscribeFinalists(seriesId, setFinalists, () => {});
    return unsub;
  }, [seriesId]);

  useEffect(() => {
    if (!series || series.partnerStoreIds.length === 0) return;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'stores'), where(documentId(), 'in', series.partnerStoreIds.slice(0, 10))),
        );
        setPartnerStores(
          snap.docs.map((d) => {
            const data = d.data() as { name: string; address?: string; photoUrls?: string[] };
            return { id: d.id, name: data.name, address: data.address, photoUrl: data.photoUrls?.[0] };
          }),
        );
      } catch {
        // ignore
      }
    })();
  }, [series]);

  if (series === undefined) {
    return <div className="p-10 text-center text-sm text-gray-500">로딩 중…</div>;
  }
  if (series === null) {
    return (
      <div className="p-10 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <div className="font-bold mb-2">시리즈를 찾을 수 없습니다</div>
        <button onClick={() => router.replace('/m')} className="text-xs text-gray-500 underline">
          홈으로
        </button>
      </div>
    );
  }

  const poster = posterStyleFor(series.posterStyle);
  const dDays = daysUntil(series.finalDate);
  const statusLabel = series.status === 'active' ? '진행 중' : series.status === 'upcoming' ? '예정' : '종료';
  const statusColor = series.status === 'active' ? '#00B074' : series.status === 'upcoming' ? '#FFB800' : '#767676';

  return (
    <div className="pb-6">
      {/* 포스터 헤더 */}
      <div className="relative px-5 pt-12 pb-6" style={{ background: poster.bg, color: poster.color, minHeight: 240 }}>
        <div className="flex items-start justify-between mb-6">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full bg-black/30 backdrop-blur flex items-center justify-center text-white"
          >
            ←
          </button>
          <button
            onClick={() => series && shareContent({ title: series.name, text: `${series.name} · 본선 게런티 ₩${(series.finalGuarantee / 100000000).toFixed(1)}억` })}
            className="w-9 h-9 rounded-full bg-black/30 backdrop-blur flex items-center justify-center text-white"
            title="공유"
          >
            ↗
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full text-white" style={{ background: statusColor }}>
            {statusLabel}
          </span>
          {dDays !== null && dDays > 0 && series.status !== 'completed' && (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-black/40 text-white">
              본선 D-{dDays}
            </span>
          )}
        </div>

        <div className="text-xs opacity-80 mb-1">{series.season}</div>
        <div className="text-2xl font-extrabold tracking-tight leading-tight font-serif">
          {series.name}
        </div>
        {series.description && (
          <div className="text-sm opacity-90 mt-3 leading-relaxed">{series.description}</div>
        )}
      </div>

      {/* 본선 정보 */}
      <div className="p-5 border-b-[6px] border-gray-50">
        <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-3">본선 정보</div>
        <div className="grid grid-cols-2 gap-3">
          <Cell label="일자" value={series.finalDate ? series.finalDate.toDate().toISOString().slice(0, 10) : '미정'} />
          <Cell label="장소" value={series.finalVenue || '미정'} />
          <Cell label="바이인" value={`₩${series.finalBuyIn.toLocaleString()}`} mono />
          <Cell label="게런티" value={`₩${(series.finalGuarantee / 100000000).toFixed(1)}억`} mono highlight />
        </div>
        {series.seedRule && (
          <div className="mt-4 px-3 py-2.5 bg-gray-50 rounded-lg text-xs text-gray-900">
            🎯 <b>시드 규칙</b>: {series.seedRule}
          </div>
        )}
      </div>

      {/* 협력 매장 */}
      {partnerStores.length > 0 && (
        <div className="p-5 border-b-[6px] border-gray-50">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-[10px] font-bold text-gray-500 tracking-wider">
              협력 매장 ({partnerStores.length}곳)
            </div>
            <div className="text-[10px] text-gray-500">
              위성 {series.satelliteCompleted}/{series.satelliteCount}
            </div>
          </div>
          <div className="space-y-2">
            {partnerStores.map((st) => (
              <Link
                key={st.id}
                href={`/m/store/${st.id}`}
                className="flex items-center gap-3 p-2.5 bg-white border border-gray-200 rounded-xl active:scale-[0.98] transition"
              >
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden">
                  {st.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-amber-100 to-amber-200" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-900">{st.name}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">위성 예선 개최 매장</div>
                </div>
                <span className="text-gray-400">›</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 본선 진출자 */}
      <div className="p-5 border-b-[6px] border-gray-50">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[10px] font-bold text-gray-500 tracking-wider">본선 진출자</div>
          <div className="text-[10px] text-gray-500">{finalists.length}명 확정 · 자동 집계</div>
        </div>
        {finalists.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-500">아직 확정자가 없습니다</div>
        ) : (
          <div className="space-y-1">
            {finalists.slice(0, 12).map((f, i) => (
              <div
                key={f.id}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg ${i < 3 ? 'bg-amber-50' : 'bg-gray-50'}`}
              >
                <div className={`font-mono text-xs font-extrabold w-6 ${i < 3 ? 'text-amber-700' : 'text-gray-500'}`}>
                  #{i + 1}
                </div>
                <div className="flex-1 text-sm font-bold text-gray-900">{f.nickname}</div>
                <div className="text-[11px] text-gray-500">{f.storeName}</div>
              </div>
            ))}
            {finalists.length > 12 && (
              <div className="text-center text-xs text-gray-500 py-2">⋯ 외 {finalists.length - 12}명</div>
            )}
          </div>
        )}
      </div>

      {/* 구독 토글 */}
      <div className="p-5">
        <button
          onClick={handleSubscribe}
          disabled={subBusy}
          className={`w-full py-3.5 rounded-2xl font-extrabold text-sm disabled:opacity-50 ${
            subscribed ? 'bg-white border-[1.5px] border-black text-gray-900' : 'bg-black text-white'
          }`}
        >
          {subBusy
            ? '처리 중…'
            : subscribed
              ? '✓ 구독 중 · 본선 D-7/D-3/D-1 알림'
              : authState.status === 'authenticated'
                ? '🔔 시리즈 구독'
                : '🔔 로그인 + 시리즈 구독'}
        </button>
        <div className="text-[10px] text-gray-400 text-center mt-2">
          v0.2: FCM 푸시 자동 발송 연동 예정
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 mb-1">{label}</div>
      <div className={`text-sm font-bold ${highlight ? 'text-red-500' : 'text-gray-900'} ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
    </div>
  );
}
