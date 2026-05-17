'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession, fmtTime, useLiveCountdown } from '@/lib/live';
import { subscribeAllSeries, type Series } from '@/lib/series';
import { posterStyleFor } from '@/lib/templates';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { haversineMeters, formatDistance, type LatLng } from '@/lib/geo';

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

type NearbyViewMode = 'list' | 'large' | 'album';
const NEARBY_VIEW_STORAGE_KEY = 'hn-home-nearby-view';

interface NearbyStore {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
  facilities?: string[];
  tier?: string;
  lat?: number;
  lng?: number;
  /** 사용자 위치 있을 때만 — 미터 */
  distance?: number;
}

function NearbyStoresSection({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [viewMode, setViewMode] = useState<NearbyViewMode>('album');

  // 저장된 뷰 모드 복원
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(NEARBY_VIEW_STORAGE_KEY) as NearbyViewMode | null;
    if (saved === 'list' || saved === 'large' || saved === 'album') setViewMode(saved);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(NEARBY_VIEW_STORAGE_KEY, viewMode);
  }, [viewMode]);

  // 사용자 위치 (정밀도 낮음 — 빠른 응답 우선)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        /* 권한 거부 — 거리 없이 표시 */
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  // 매장 fetch
  useEffect(() => {
    getDocs(collection(db, 'stores')).then((snap) => {
      setStores(
        snap.docs.map((d) => {
          const data = d.data() as {
            name: string;
            address?: string;
            photoUrls?: string[];
            facilities?: string[];
            tier?: string;
            lat?: number;
            lng?: number;
          };
          return {
            id: d.id,
            name: data.name,
            address: data.address,
            photoUrl: data.photoUrls?.[0],
            facilities: data.facilities,
            tier: data.tier,
            lat: data.lat,
            lng: data.lng,
          };
        }),
      );
    });
  }, []);

  // 정렬: 거리 가까운 순 (좌표 없는 매장은 맨 뒤). LIVE 여부는 정렬에 영향 X — 카드 배지로만 표시.
  const sorted = useMemo(() => {
    const withDist: NearbyStore[] = stores.map((s) => ({
      ...s,
      distance:
        userLocation && typeof s.lat === 'number' && typeof s.lng === 'number'
          ? haversineMeters(userLocation, { lat: s.lat, lng: s.lng })
          : undefined,
    }));
    return withDist.sort((a, b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      if (a.distance != null) return -1;
      if (b.distance != null) return 1;
      return 0;
    });
  }, [stores, userLocation]);

  if (stores.length === 0) return null;

  return (
    <>
      <div className="px-5 pt-8 pb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-extrabold tracking-tight font-serif">주변 매장</span>
          <span className="text-xs text-gray-500">{stores.length}개</span>
        </div>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </div>

      {viewMode === 'album' ? (
        <div className="px-5 pb-2 grid grid-cols-2 gap-3">
          {sorted.map((st) => (
            <NearbyStoreAlbumCard key={st.id} store={st} live={liveByStore[st.id] || 0} />
          ))}
        </div>
      ) : viewMode === 'list' ? (
        <div className="divide-y divide-gray-100">
          {sorted.map((st) => (
            <NearbyStoreCompactRow key={st.id} store={st} live={liveByStore[st.id] || 0} />
          ))}
        </div>
      ) : (
        <div className="px-5 pb-2 space-y-2.5">
          {sorted.map((st) => (
            <NearbyStoreLargeCard key={st.id} store={st} live={liveByStore[st.id] || 0} />
          ))}
        </div>
      )}
    </>
  );
}

/* ============================================================
 * 뷰 모드 토글
 * ========================================================== */

function ViewModeToggle({ value, onChange }: { value: NearbyViewMode; onChange: (v: NearbyViewMode) => void }) {
  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      <button onClick={() => onChange('list')} className={`w-7 h-7 rounded text-sm flex items-center justify-center ${value === 'list' ? 'bg-white shadow-sm' : 'opacity-50'}`} title="목록">☰</button>
      <button onClick={() => onChange('large')} className={`w-7 h-7 rounded text-sm flex items-center justify-center ${value === 'large' ? 'bg-white shadow-sm' : 'opacity-50'}`} title="큰 목록">☷</button>
      <button onClick={() => onChange('album')} className={`w-7 h-7 rounded text-sm flex items-center justify-center ${value === 'album' ? 'bg-white shadow-sm' : 'opacity-50'}`} title="앨범">▦</button>
    </div>
  );
}

/* ============================================================
 * 뷰 1: 압축 목록 — 한 줄, 정보 밀도 ↑
 * ========================================================== */

function NearbyStoreCompactRow({ store: st, live }: { store: NearbyStore; live: number }) {
  useEffect(() => {
    trackImpressionOnce(st.id, 'home-nearby');
  }, [st.id]);
  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 active:bg-gray-100 transition"
    >
      <div className="w-12 h-12 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden relative">
        {st.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-amber-100 to-amber-200" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-bold text-gray-900 truncate">{st.name}</div>
          {st.tier === 'vip' && (
            <span className="text-[9px] font-extrabold bg-yellow-100 text-yellow-800 rounded px-1 py-0.5">
              VIP
            </span>
          )}
        </div>
        <div className="text-[11px] text-gray-500 truncate mt-0.5">
          {st.distance != null && (
            <span className="font-bold text-gray-700">{formatDistance(st.distance)}</span>
          )}
          {st.distance != null && st.address ? ' · ' : ''}
          {st.address ? `📍 ${st.address.split(' ').slice(1).join(' ')}` : ''}
        </div>
      </div>
      {live > 0 && (
        <div className="inline-flex items-center gap-1 bg-red-50 text-red-600 rounded-md px-1.5 py-1 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] font-extrabold">LIVE{live > 1 ? ` ${live}` : ''}</span>
        </div>
      )}
    </Link>
  );
}

/* ============================================================
 * 뷰 2: 큰 목록 — 사진 + 상세 정보 (기본)
 * ========================================================== */

function NearbyStoreLargeCard({ store: st, live }: { store: NearbyStore; live: number }) {
  useEffect(() => {
    trackImpressionOnce(st.id, 'home-nearby');
  }, [st.id]);
  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
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
        {st.distance != null && (
          <div className="absolute bottom-1.5 left-1.5 bg-black/60 backdrop-blur text-white text-[9px] font-bold rounded px-1.5 py-0.5">
            {formatDistance(st.distance)}
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
}

/* ============================================================
 * 뷰 3: 앨범 그리드 — 2열, 사진 중심
 * ========================================================== */

function NearbyStoreAlbumCard({ store: st, live }: { store: NearbyStore; live: number }) {
  useEffect(() => {
    trackImpressionOnce(st.id, 'home-nearby');
  }, [st.id]);
  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="block bg-white border border-gray-200 rounded-xl overflow-hidden active:scale-[0.98] transition"
    >
      <div className="aspect-square bg-gray-100 relative overflow-hidden">
        {st.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-amber-100 to-amber-200" />
        )}
        {/* 좌상단 — 거리 + VIP */}
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {st.distance != null && (
            <span className="bg-black/60 backdrop-blur text-white text-[10px] font-bold rounded-full px-2 py-0.5">
              {formatDistance(st.distance)}
            </span>
          )}
          {st.tier === 'vip' && (
            <span className="bg-yellow-500 text-white text-[9px] font-extrabold rounded-full px-2 py-0.5">
              VIP
            </span>
          )}
        </div>
        {/* 우상단 — LIVE */}
        {live > 0 && (
          <div className="absolute top-2 right-2 bg-red-500 text-white rounded-full px-2 py-0.5 flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
            <span className="text-[9px] font-extrabold">LIVE{live > 1 ? ` ${live}` : ''}</span>
          </div>
        )}
      </div>
      <div className="p-2.5">
        <div className="text-sm font-bold text-gray-900 truncate">{st.name}</div>
        {st.address && (
          <div className="text-[10px] text-gray-500 truncate mt-0.5">📍 {st.address.split(' ').slice(1).join(' ')}</div>
        )}
      </div>
    </Link>
  );
}

function StoreCard({ group, thumbnail }: { group: StoreGroup; thumbnail?: string }) {
  const primary = group.sessions[0];
  const count = group.sessions.length;
  const poster = posterStyleFor(primary.posterStyle);

  useEffect(() => {
    trackImpressionOnce(group.storeId, 'home-live');
  }, [group.storeId]);

  return (
    <Link
      href={`/m/store/${group.storeId}`}
      onClick={() => bumpStoreMetric(group.storeId, 'cardClicks')}
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
  const sec = useLiveCountdown(session);
  const paused = session.status === 'paused';
  return (
    <span className={`font-mono text-sm font-extrabold ${paused ? 'text-amber-700' : 'text-gray-900'}`}>
      {paused ? '⏸' : '⏱'} {fmtTime(sec)}
    </span>
  );
}
