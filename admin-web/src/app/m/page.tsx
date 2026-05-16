'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession, fmtTime } from '@/lib/live';
import { subscribeAllSeries, type Series } from '@/lib/series';
import { posterStyleFor } from '@/lib/templates';

interface StoreGroup {
  storeId: string;
  storeName: string;
  sessions: LiveSession[];
}

interface StoreSummary {
  thumbnail?: string;
}

export default function MobileHome() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [storeSummaries, setStoreSummaries] = useState<Record<string, StoreSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(
      (items) => {
        setSessions(items);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeAllSeries(setSeries, () => {});
    return unsub;
  }, []);

  // 매장별 그룹
  const groups: StoreGroup[] = useMemo(() => {
    const map: Record<string, StoreGroup> = {};
    for (const s of sessions) {
      if (!map[s.storeId]) {
        map[s.storeId] = { storeId: s.storeId, storeName: s.storeName, sessions: [] };
      }
      map[s.storeId].sessions.push(s);
    }
    return Object.values(map);
  }, [sessions]);

  // 매장 썸네일 (photoUrls[0]) fetch — 그룹이 바뀔 때만
  useEffect(() => {
    const ids = groups.map((g) => g.storeId).filter((id) => !(id in storeSummaries));
    if (ids.length === 0) return;
    // Firestore in 쿼리는 최대 10개. 데모용 OK
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'stores'), where(documentId(), 'in', ids.slice(0, 10))),
        );
        const next: Record<string, StoreSummary> = {};
        snap.forEach((d) => {
          const data = d.data() as { photoUrls?: string[] };
          next[d.id] = { thumbnail: data.photoUrls?.[0] };
        });
        setStoreSummaries((prev) => ({ ...prev, ...next }));
      } catch {
        // ignore
      }
    })();
  }, [groups, storeSummaries]);

  return (
    <div>
      {/* 상단 바 */}
      <div className="px-5 h-14 flex items-center justify-between border-b border-gray-100 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-lg font-extrabold tracking-tight font-serif">
            HoldemNow
          </span>
        </div>
        <span className="text-xs text-gray-500">v0.1 데모</span>
      </div>

      {/* 검색 */}
      <div className="px-5 py-3">
        <Link
          href="/m/search"
          className="bg-gray-100 rounded-xl h-11 flex items-center px-4 text-sm text-gray-500 active:scale-[0.99] transition"
        >
          🔍 매장·토너·시리즈 검색
        </Link>
      </div>

      {/* 지역 칩 */}
      <div className="px-5 pb-4 flex gap-2 overflow-x-auto scrollbar-none">
        {['부산 ▼', '서면', '해운대', '광안리', '동래', '양산'].map((r, i) => (
          <div
            key={r}
            className={`px-4 py-2 rounded-full text-xs whitespace-nowrap flex-shrink-0 ${
              i === 0 ? 'bg-black text-white font-bold' : 'bg-white border border-gray-200 text-gray-900'
            }`}
          >
            {r}
          </div>
        ))}
      </div>

      {/* 지금 LIVE 섹션 */}
      <div className="px-5 pb-3 flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xl font-extrabold tracking-tight font-serif">
            지금 LIVE
          </span>
        </div>
        <span className="text-xs text-gray-500">전체 →</span>
      </div>

      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-gray-500">로딩 중…</div>
      ) : error ? (
        <div className="mx-5 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
          {error}
        </div>
      ) : groups.length === 0 ? (
        <div className="mx-5 my-8 bg-gray-50 rounded-xl p-8 text-center text-sm text-gray-500">
          현재 진행 중인 LIVE가 없습니다
          <div className="text-[11px] text-gray-400 mt-2">
            어드민에서 LIVE 시작 시 즉시 표시됩니다
          </div>
        </div>
      ) : (
        <div className="pl-5 flex gap-3 overflow-x-auto pb-2 scrollbar-none">
          {groups.map((g) => (
            <StoreCard
              key={g.storeId}
              group={g}
              thumbnail={storeSummaries[g.storeId]?.thumbnail}
            />
          ))}
        </div>
      )}

      {/* 메이저 시리즈 */}
      {series.length > 0 && (
        <>
          <div className="px-5 pt-8 pb-3 flex items-baseline justify-between">
            <span className="text-xl font-extrabold tracking-tight font-serif">
              메이저 시리즈
            </span>
            <span className="text-xs text-gray-500">전체 →</span>
          </div>
          <div className="pl-5 flex gap-3 overflow-x-auto scrollbar-none pb-2">
            {series.map((s) => (
              <SeriesCard key={s.id} series={s} />
            ))}
          </div>
        </>
      )}

      {/* 주변 매장 — 전체 매장 (LIVE 진행 중 우선) */}
      <NearbyStoresSection liveByStore={
        sessions.reduce<Record<string, number>>((acc, s) => {
          acc[s.storeId] = (acc[s.storeId] || 0) + 1;
          return acc;
        }, {})
      } />

      {/* 다음 섹션 placeholder */}
      <div className="px-5 py-8 mt-4 border-t border-gray-100 text-center">
        <div className="text-xs text-gray-400">
          🃏 HoldemNow v0.1 · 데모 데이터
        </div>
      </div>

      <style jsx global>{`
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { scrollbar-width: none; }
      `}</style>
    </div>
  );
}

function NearbyStoresSection({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<{
    id: string;
    name: string;
    address?: string;
    photoUrl?: string;
    facilities?: string[];
    tier?: string;
  }[]>([]);
  useEffect(() => {
    getDocs(collection(db, 'stores')).then((snap) => {
      setStores(
        snap.docs.map((d) => {
          const data = d.data() as {
            name: string; address?: string; photoUrls?: string[]; facilities?: string[]; tier?: string;
          };
          return {
            id: d.id,
            name: data.name,
            address: data.address,
            photoUrl: data.photoUrls?.[0],
            facilities: data.facilities,
            tier: data.tier,
          };
        }),
      );
    });
  }, []);

  if (stores.length === 0) return null;

  // LIVE 진행 중 매장 우선 정렬
  const sorted = [...stores].sort((a, b) => (liveByStore[b.id] || 0) - (liveByStore[a.id] || 0));

  return (
    <>
      <div className="px-5 pt-8 pb-3 flex items-baseline justify-between">
        <span className="text-xl font-extrabold tracking-tight font-serif">주변 매장</span>
        <span className="text-xs text-gray-500">{stores.length}개</span>
      </div>
      <div className="px-5 pb-2 space-y-2.5">
        {sorted.map((st) => {
          const live = liveByStore[st.id] || 0;
          return (
            <Link
              key={st.id}
              href={`/m/store/${st.id}`}
              className="flex bg-white border border-gray-200 rounded-2xl overflow-hidden active:scale-[0.99] transition"
            >
              <div className="w-28 h-28 bg-gray-100 flex-shrink-0 relative overflow-hidden">
                {st.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-amber-100 to-amber-200" />
                )}
                {st.tier === 'vip' && (
                  <div className="absolute top-1.5 left-1.5 bg-yellow-500 text-white text-[8px] font-extrabold rounded px-1.5 py-0.5">
                    VIP
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
                <div>
                  <div className="text-sm font-bold text-gray-900 truncate">{st.name}</div>
                  {live > 0 && (
                    <div className="inline-flex items-center gap-1 bg-red-50 text-red-600 rounded-md px-1.5 py-0.5 mt-1.5">
                      <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[9px] font-extrabold">LIVE{live > 1 ? ` ${live}` : ''}</span>
                    </div>
                  )}
                </div>
                {st.address && (
                  <div className="text-[11px] text-gray-500 truncate">📍 {st.address.split(' ').slice(1).join(' ')}</div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function StoreCard({ group, thumbnail }: { group: StoreGroup; thumbnail?: string }) {
  const primary = group.sessions[0];
  const count = group.sessions.length;
  const poster = posterStyleFor(primary.posterStyle);

  return (
    <Link
      href={`/m/store/${group.storeId}`}
      className="w-[220px] rounded-2xl bg-white border border-gray-200 overflow-hidden flex-shrink-0 active:scale-[0.98] transition"
    >
      {/* 사진 (있으면) + 포스터 오버레이 */}
      <div
        className="h-44 relative flex items-center justify-center overflow-hidden"
        style={!thumbnail ? { background: poster.bg } : undefined}
      >
        {thumbnail && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnail} alt={group.storeName} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/30" />
          </>
        )}
        {/* LIVE 뱃지 */}
        <div className="absolute top-3 left-3 bg-red-500 rounded-xl px-2.5 py-1 flex items-center gap-1.5 z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-[10px] font-extrabold text-white tracking-wider">
            LIVE{count > 1 ? ` ${count}` : ''}
          </span>
        </div>

        <div
          className={`text-center px-4 z-10 ${thumbnail ? 'rounded-lg px-4 py-2 shadow-lg' : ''}`}
          style={
            thumbnail
              ? { background: poster.bg, color: poster.color }
              : { color: poster.color }
          }
        >
          <div className="text-sm font-extrabold leading-tight font-serif">
            {primary.tournamentName}
          </div>
          {primary.buyIn > 0 && (
            <div className="text-[10px] font-bold mt-1 opacity-80">
              ₩{primary.buyIn.toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {/* 정보 */}
      <div className="p-3">
        <div className="text-sm font-bold text-gray-900 truncate">{group.storeName}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          {primary.tournamentName} · Lv {primary.currentLevel}
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
          <CountdownInline session={primary} />
          {count > 1 && <span className="text-[10px] text-gray-500 font-bold">+{count - 1}개 더</span>}
        </div>
      </div>
    </Link>
  );
}

function SeriesCard({ series }: { series: Series }) {
  const poster = posterStyleFor(series.posterStyle);
  const dDays = series.finalDate
    ? Math.ceil((series.finalDate.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const statusLabel =
    series.status === 'active' ? '진행 중' : series.status === 'upcoming' ? '예정' : '종료';
  const statusColor =
    series.status === 'active' ? '#00B074' : series.status === 'upcoming' ? '#FFB800' : '#767676';
  return (
    <Link
      href={`/m/series/${series.id}`}
      className="w-[260px] rounded-2xl bg-white border border-gray-200 overflow-hidden flex-shrink-0 active:scale-[0.98] transition"
    >
      <div className="p-4 h-32" style={{ background: poster.bg, color: poster.color }}>
        <div className="flex justify-between items-start mb-2">
          <span className="text-[9px] font-extrabold rounded-full px-2 py-0.5 text-white" style={{ background: statusColor }}>
            {statusLabel}
          </span>
          {dDays !== null && dDays > 0 && series.status !== 'completed' && (
            <span className="text-[9px] font-bold rounded-full px-2 py-0.5 bg-black/40 text-white">
              본선 D-{dDays}
            </span>
          )}
        </div>
        <div className="text-[10px] opacity-80 mb-1">{series.season}</div>
        <div className="text-base font-extrabold leading-tight font-serif">
          {series.name}
        </div>
      </div>
      <div className="p-3">
        <div className="text-[10px] text-gray-500 mb-1">본선 게런티</div>
        <div className="font-mono text-base font-extrabold text-gray-900 mb-2">
          ₩{(series.finalGuarantee / 100000000).toFixed(1)}억
        </div>
        <div className="flex justify-between text-[11px] text-gray-500">
          <span>협력 매장</span>
          <span className="font-bold text-gray-900">{series.partnerStoreIds.length}곳</span>
        </div>
      </div>
    </Link>
  );
}

function CountdownInline({ session }: { session: LiveSession }) {
  // 가벼운 클라이언트 카운트다운 (모바일 표시용)
  const [sec, setSec] = useState(session.levelSecondsLeft);
  useEffect(() => setSec(session.levelSecondsLeft), [session.levelSecondsLeft, session.currentLevel, session.id]);
  useEffect(() => {
    if (session.status !== 'running') return;
    const t = setInterval(() => setSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [session.status, session.id]);

  const paused = session.status === 'paused';
  return (
    <span className={`font-mono text-sm font-extrabold ${paused ? 'text-amber-700' : 'text-gray-900'}`}>
      {paused ? '⏸' : '⏱'} {fmtTime(sec)}
    </span>
  );
}
