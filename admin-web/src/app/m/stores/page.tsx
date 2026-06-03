'use client';

/**
 * /m/stores?type=popular|new|nearby&mode=list|map
 *
 * 섹션별 전용 전체 목록 + 스코프 지도 페이지.
 * - popular : 내 주변 인기 매장 (loadPopularStores)
 * - new     : 새로 합류한 매장  (loadRecentlyJoinedStores)
 * - nearby  : 내 주변 매장      (getDocs stores + 거리 계산 + 정렬칩)
 *
 * useSearchParams → Suspense 경계 필수 (Next 16)
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { haversineMeters, formatDistance, type LatLng } from '@/lib/geo';
import {
  loadPopularStores,
  loadRecentlyJoinedStores,
  type PopularityStore,
} from '@/lib/popularity';
import { subscribeFeedConfig, FEED_CONFIG_DEFAULT, type FeedConfig } from '@/lib/feedConfig';
import { subscribeAllLiveSessions, type LiveSession } from '@/lib/live';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { StoreListRow, type NearbyStore } from '@/components/mobile/StoreListRow';
import type { MapStoreSummary } from '@/app/m/find/FindKakaoMap';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── 카카오 지도 lazy 로드 ──────────────────────────────────────
const FindKakaoMap = dynamic(() => import('@/app/m/find/FindKakaoMap'), {
  ssr: false,
  loading: () => (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: 'var(--surface-2)' }}
    >
      <div className="skeleton h-full w-full" aria-label="지도 로딩 중" />
    </div>
  ),
});

// ─── 타입 ──────────────────────────────────────────────────────
type StoreType = 'popular' | 'new' | 'nearby';
type ViewMode = 'list' | 'map';
type NearbySort = 'distance' | 'live' | 'open' | 'rating' | 'new';

const NEARBY_SORT_OPTIONS: { value: NearbySort; label: string; emoji: string }[] = [
  { value: 'distance', label: '거리순',  emoji: '📍' },
  { value: 'live',     label: 'LIVE',    emoji: '🔴' },
  { value: 'open',     label: '영업 중', emoji: '🟢' },
  { value: 'rating',   label: '평점순',  emoji: '⭐' },
  { value: 'new',      label: '신규순',  emoji: '🆕' },
];

const NEARBY_SORT_KEY = 'holdemnow:nearbySort';

function loadSavedSort(): NearbySort {
  if (typeof window === 'undefined') return 'distance';
  try {
    const v = window.localStorage.getItem(NEARBY_SORT_KEY);
    if (v === 'distance' || v === 'live' || v === 'open' || v === 'rating' || v === 'new') return v;
  } catch { /* noop */ }
  return 'distance';
}

function isOpenNow(hours?: string): boolean {
  if (!hours) return true;
  try {
    const timeRe = /(\d{1,2}):(\d{2})\s*[-~]\s*(?:익일\s*)?(\d{1,2}):(\d{2})/;
    const m = hours.match(timeRe);
    if (!m) return true;
    const openH = parseInt(m[1], 10), openMin = parseInt(m[2], 10);
    const closeH = parseInt(m[3], 10), closeMin = parseInt(m[4], 10);
    const openTotal = openH * 60 + openMin;
    let closeTotal = closeH * 60 + closeMin;
    const isNextDay = /익일/.test(hours) || closeTotal < openTotal;
    if (isNextDay) closeTotal += 24 * 60;
    const now = new Date();
    let nowTotal = now.getHours() * 60 + now.getMinutes();
    if (isNextDay && nowTotal < openTotal) nowTotal += 24 * 60;
    return nowTotal >= openTotal && nowTotal < closeTotal;
  } catch { return true; }
}

function sortNearbyStores(
  stores: NearbyStore[],
  sort: NearbySort,
  liveByStore: Record<string, number>,
): NearbyStore[] {
  const distCmp = (a: NearbyStore, b: NearbyStore) => {
    if (a.distance != null && b.distance != null) return a.distance - b.distance;
    if (a.distance != null) return -1;
    if (b.distance != null) return 1;
    return 0;
  };
  switch (sort) {
    case 'distance': return [...stores].sort(distCmp);
    case 'live':
      return [...stores].sort((a, b) => {
        const la = (liveByStore[a.id] ?? 0) > 0 ? 1 : 0;
        const lb = (liveByStore[b.id] ?? 0) > 0 ? 1 : 0;
        return lb !== la ? lb - la : distCmp(a, b);
      });
    case 'open':
      return [...stores].sort((a, b) => {
        const oa = isOpenNow(a.hours) ? 1 : 0;
        const ob = isOpenNow(b.hours) ? 1 : 0;
        return ob !== oa ? ob - oa : distCmp(a, b);
      });
    case 'rating':
      return [...stores].sort((a, b) => {
        const ra = a.averageRating ?? -1, rb = b.averageRating ?? -1;
        return rb !== ra ? rb - ra : distCmp(a, b);
      });
    case 'new':
      return [...stores].sort((a, b) => {
        const ca = a.createdAt ?? 0, cb = b.createdAt ?? 0;
        return cb !== ca ? cb - ca : distCmp(a, b);
      });
    default: return [...stores].sort(distCmp);
  }
}

// PopularityStore → NearbyStore 변환
function popularToNearby(s: PopularityStore): NearbyStore {
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    photoUrl: s.photoUrls?.[0],
    lat: s.lat,
    lng: s.lng,
    distance: s.distance,
    createdAt: s.createdAt?.toMillis?.(),
  };
}

// NearbyStore → MapStoreSummary 변환
function nearbyToMap(s: NearbyStore): MapStoreSummary {
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    photoUrl: s.photoUrl,
    lat: s.lat,
    lng: s.lng,
    averageRating: s.averageRating,
    reviewCount: s.reviewCount,
  };
}

// ─── 빈 상태 ────────────────────────────────────────────────────
function EmptyState({ type }: { type: StoreType }) {
  const msgs: Record<StoreType, { icon: string; title: string; desc: string }> = {
    popular: { icon: '🏆', title: '인기 매장이 없어요', desc: '위치를 허용하거나 범위를 넓혀보세요.' },
    new:     { icon: '🆕', title: '최근 합류 매장이 없어요', desc: '최근 30일 내 가입한 매장이 아직 없어요.' },
    nearby:  { icon: '📍', title: '주변 매장이 없어요', desc: '위치 권한을 허용해 주세요.' },
  };
  const { icon, title, desc } = msgs[type];
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <span className="text-[48px] mb-4" aria-hidden="true">{icon}</span>
      <div className="text-[16px] font-bold mb-2" style={{ color: 'var(--text-1)' }}>{title}</div>
      <div className="text-[13px]" style={{ color: 'var(--text-3)' }}>{desc}</div>
    </div>
  );
}

// ─── 로딩 스켈레톤 ──────────────────────────────────────────────
function ListSkeleton() {
  return (
    <div className="pt-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="w-5 h-4 rounded skeleton flex-shrink-0" />
          <div className="w-16 h-16 rounded-xl skeleton flex-shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div className="h-4 w-3/4 rounded skeleton" />
            <div className="h-3 w-1/2 rounded skeleton" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 지도 모드 (스코프된 stores 주입) ──────────────────────────
function ScopedMapMode({
  stores,
  userLocation,
  locationDenied,
  liveByStore,
}: {
  stores: NearbyStore[];
  userLocation: LatLng | null;
  locationDenied: boolean;
  liveByStore: Record<string, number>;
}) {
  const router = useRouter();
  const mapInstanceRef = useRef<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  // NearbyStore → MapStoreSummary (좌표 있는 것만)
  const mapStores = useMemo(
    () => stores.filter((s) => s.lat != null && s.lng != null).map(nearbyToMap),
    [stores],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    const target = stores.find((s) => s.id === id);
    if (!target || target.lat == null || target.lng == null) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (mapInstanceRef.current && maps) {
      mapInstanceRef.current.panTo(new maps.LatLng(target.lat, target.lng));
    }
  }, [stores]);

  const selected = stores.find((s) => s.id === selectedId);
  const selectedDist = selected && userLocation && selected.lat != null && selected.lng != null
    ? haversineMeters(userLocation, { lat: selected.lat, lng: selected.lng })
    : null;
  const selectedLive = selected ? liveByStore[selected.id] ?? 0 : 0;
  const totalLive = Object.values(liveByStore).reduce((a, b) => a + b, 0);

  return (
    <div className="relative" style={{ height: 'calc(100vh - 112px)' }}>
      <FindKakaoMap
        stores={mapStores}
        liveCountByStore={liveByStore}
        selectedId={selectedId}
        onSelect={handleSelect}
        onError={setMapError}
        userLocation={userLocation}
        locationDenied={locationDenied}
        mapInstanceRef={mapInstanceRef}
      />

      {/* 상단 카운트 버튼 */}
      <button
        onClick={() => setSelectedId(null)}
        className="absolute top-3 left-3 right-3 z-30 text-left transition active:scale-[0.98]"
        style={{
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            {userLocation ? '스코프 내 매장 · 거리순' : locationDenied ? '서면 중심' : '위치 확인 중…'}
          </div>
          <div
            className="text-[14px] font-bold mt-0.5"
            style={{ color: 'var(--text-1)' }}
          >
            매장 {mapStores.length}개
          </div>
        </div>
        {totalLive > 0 ? (
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
            style={{
              background: 'rgba(229,62,62,0.08)',
              border: '1px solid rgba(229,62,62,0.25)',
            }}
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 pulse-live"
              style={{ background: 'var(--live)' }}
            />
            <span
              className="text-[12px] font-extrabold"
              style={{ color: 'var(--live)' }}
            >
              LIVE {totalLive}
            </span>
          </div>
        ) : (
          <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>LIVE 없음</span>
        )}
      </button>

      {/* 지도 에러 */}
      {mapError && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 px-6"
          style={{ background: 'var(--bg)' }}
        >
          <div className="text-[40px]" aria-hidden="true">🗺️</div>
          <div className="text-[15px] font-bold text-center" style={{ color: 'var(--text-1)' }}>
            지도를 불러올 수 없어요
          </div>
          <div className="text-[12px] text-center" style={{ color: 'var(--text-3)' }}>
            네트워크 연결을 확인해 주세요
          </div>
        </div>
      )}

      {/* 선택 매장 카드 */}
      {selected && (
        <button
          onClick={() => {
            bumpStoreMetric(selected.id, 'cardClicks');
            router.push(`/m/store/${selected.id}`);
          }}
          className="absolute bottom-3 left-3 right-3 z-30 flex items-center gap-3 text-left transition active:scale-[0.98]"
          style={{
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
            padding: '12px 14px',
          }}
        >
          <div
            className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden"
            style={{ background: 'var(--surface-2)' }}
          >
            {selected.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.photoUrl}
                alt={selected.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg,#FFF0F7 0%,#F3F4F6 100%)' }}
              >
                <span
                  className="text-[16px] font-extrabold"
                  style={{ color: 'var(--brand)', opacity: 0.45 }}
                >
                  {selected.name.charAt(0)}
                </span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="text-[14px] font-bold truncate"
                style={{ color: 'var(--text-1)' }}
              >
                {selected.name}
              </span>
              {selectedLive > 0 && (
                <span className="badge-live flex-shrink-0">
                  <span className="dot" />LIVE
                </span>
              )}
            </div>
            {selectedDist != null && (
              <div
                className="text-[12px] mt-0.5 stat-number font-semibold"
                style={{ color: 'var(--text-3)' }}
              >
                {formatDistance(selectedDist)}
              </div>
            )}
          </div>
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ color: 'var(--brand)', flexShrink: 0 }}
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── nearby 전용: 정렬칩 + 필터 + 전체 목록 ─────────────────────
function NearbyListView({
  stores: rawStores,
  liveByStore,
  userLocation,
  feedCfg,
}: {
  stores: NearbyStore[];
  liveByStore: Record<string, number>;
  userLocation: LatLng | null;
  feedCfg: FeedConfig;
}) {
  const [activeSort, setActiveSort] = useState<NearbySort>(loadSavedSort);
  const [radiusKm, setRadiusKm] = useState(feedCfg.nearbyRadiusDefaultKm);
  const [radiusManual, setRadiusManual] = useState(false);
  const radiusManualRef = useRef(radiusManual);
  useEffect(() => { radiusManualRef.current = radiusManual; }, [radiusManual]);
  useEffect(() => {
    if (!radiusManualRef.current) setRadiusKm(feedCfg.nearbyRadiusDefaultKm);
  }, [feedCfg.nearbyRadiusDefaultKm]);

  const handleSortChange = (s: NearbySort) => {
    setActiveSort(s);
    try { window.localStorage.setItem(NEARBY_SORT_KEY, s); } catch { /* noop */ }
  };

  const sorted = useMemo(() => {
    const withDist = rawStores.map((s) => ({
      ...s,
      distance:
        userLocation && s.lat != null && s.lng != null
          ? haversineMeters(userLocation, { lat: s.lat, lng: s.lng })
          : undefined,
    }));
    return sortNearbyStores(withDist, activeSort, liveByStore);
  }, [rawStores, userLocation, activeSort, liveByStore]);

  const visible = useMemo(() => {
    if (!userLocation) return sorted;
    const maxM = radiusKm * 1000;
    return sorted.filter((s) => s.distance != null && s.distance <= maxM);
  }, [sorted, userLocation, radiusKm]);

  const nextRadiusKm =
    userLocation
      ? feedCfg.nearbyRadiusOptionsKm.find((r) => r > radiusKm) ??
        (feedCfg.nearbyAutoExpand && feedCfg.nearbyAutoExpandMaxKm > radiusKm
          ? feedCfg.nearbyAutoExpandMaxKm
          : null)
      : null;

  const moreCount = useMemo(() => {
    if (!userLocation || nextRadiusKm == null) return 0;
    const nextMaxM = nextRadiusKm * 1000;
    return Math.max(
      0,
      sorted.filter((s) => s.distance != null && s.distance <= nextMaxM).length -
        visible.length,
    );
  }, [sorted, userLocation, nextRadiusKm, visible.length]);

  const canExpand = nextRadiusKm != null && radiusKm < feedCfg.nearbyAutoExpandMaxKm;

  const activeSortLabel =
    NEARBY_SORT_OPTIONS.find((o) => o.value === activeSort)?.label ?? '거리순';

  return (
    <div>
      {/* 메타 정보 */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
          {userLocation
            ? `현재 위치 기준 · 반경 ${radiusKm}km · `
            : '위치 권한 허용 시 거리 표시 · '}
          <span className="font-bold stat-number" style={{ color: 'var(--brand)' }}>
            {visible.length}개
          </span>
          {activeSort !== 'distance' && (
            <span
              className="ml-1.5 text-[11px] font-semibold rounded-full px-1.5 py-0.5"
              style={{
                background: 'var(--brand-pale)',
                color: 'var(--brand)',
              }}
            >
              {activeSortLabel}으로 정렬
            </span>
          )}
        </div>
      </div>

      {/* 정렬 칩 */}
      <div
        className="pl-4 flex gap-2 overflow-x-auto scrollbar-none py-2.5"
        role="group"
        aria-label="정렬 기준 선택"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {NEARBY_SORT_OPTIONS.map((opt) => {
          const isActive = activeSort === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => handleSortChange(opt.value)}
              aria-pressed={isActive}
              className="flex-shrink-0 flex items-center gap-1 rounded-full text-[12px] font-semibold transition-all active:scale-95"
              style={{
                height: 32,
                padding: '0 12px',
                background: isActive ? 'var(--brand)' : 'var(--surface-2)',
                color: isActive ? '#fff' : 'var(--text-2)',
                border: isActive ? '1.5px solid var(--brand)' : '1.5px solid var(--border)',
                boxShadow: isActive ? '0 2px 8px rgba(255,31,143,0.25)' : 'none',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 13 }}>{opt.emoji}</span>
              {opt.label}
            </button>
          );
        })}
        <div className="w-2 flex-shrink-0" aria-hidden="true" />
      </div>

      {/* 목록 */}
      {visible.length === 0 ? (
        <EmptyState type="nearby" />
      ) : (
        visible.map((st, i) => (
          <StoreListRow
            key={st.id}
            store={st}
            live={liveByStore[st.id] ?? 0}
            rank={i + 1}
            impressionSource="stores-nearby-list"
          />
        ))
      )}

      {/* 반경 확장 */}
      {canExpand && (
        <div className="px-4 py-3">
          <button
            onClick={() => { setRadiusKm(nextRadiusKm!); setRadiusManual(true); }}
            className="w-full py-2.5 rounded-2xl text-[12px] font-semibold transition active:scale-[0.99] flex items-center justify-center gap-1"
            style={{
              background: 'var(--surface-1)',
              border: '1px dashed var(--border)',
              color: 'var(--text-3)',
            }}
          >
            더 멀리 · 반경 {nextRadiusKm}km까지 넓히기
            {moreCount > 0 && (
              <span className="stat-number font-bold" style={{ color: 'var(--text-2)' }}>
                +{moreCount}개
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 일반 목록 (popular / new) ──────────────────────────────────
function GenericListView({
  stores,
  liveByStore,
  type,
}: {
  stores: NearbyStore[];
  liveByStore: Record<string, number>;
  type: StoreType;
}) {
  if (stores.length === 0) return <EmptyState type={type} />;
  return (
    <div>
      {stores.map((st, i) => (
        <StoreListRow
          key={st.id}
          store={st}
          live={liveByStore[st.id] ?? 0}
          rank={i + 1}
          impressionSource={type === 'popular' ? 'stores-popular-list' : 'stores-new-list'}
        />
      ))}
    </div>
  );
}

// ─── 메인 이너 컴포넌트 (useSearchParams 사용) ─────────────────
function StoresPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawType = searchParams.get('type');
  const type: StoreType =
    rawType === 'popular' || rawType === 'new' || rawType === 'nearby'
      ? rawType
      : 'nearby';

  const initialMode: ViewMode = searchParams.get('mode') === 'map' ? 'map' : 'list';
  const [mode, setMode] = useState<ViewMode>(initialMode);

  // ─ 위치 (단일 watchPosition) ─
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationDenied(true);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationDenied(true),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // ─ feedConfig ─
  const [feedCfg, setFeedCfg] = useState<FeedConfig>(FEED_CONFIG_DEFAULT);
  useEffect(() => subscribeFeedConfig(setFeedCfg, () => {}), []);

  // ─ LIVE 세션 ─
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  useEffect(() => {
    const unsub = subscribeAllLiveSessions(setSessions, () => {});
    return unsub;
  }, []);

  const liveByStore = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sessions) map[s.storeId] = (map[s.storeId] || 0) + 1;
    return map;
  }, [sessions]);

  // ─ 데이터 로드 ─
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [appliedRadiusKm, setAppliedRadiusKm] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStores([]);

    if (type === 'popular') {
      loadPopularStores(userLocation, {
        defaultRadiusKm: feedCfg.popularRadiusDefaultKm,
        expandStepsKm: feedCfg.popularRadiusOptionsKm,
        autoExpand: feedCfg.popularAutoExpand,
        maxKm: feedCfg.popularAutoExpandMaxKm,
      }).then((res) => {
        if (cancelled) return;
        setStores(res.stores.map(popularToNearby));
        setAppliedRadiusKm(res.appliedRadiusM > 0 ? Math.round(res.appliedRadiusM / 1000) : null);
        setExpanded(res.expanded);
        setLoading(false);
      }).catch(() => { if (!cancelled) setLoading(false); });

    } else if (type === 'new') {
      loadRecentlyJoinedStores(userLocation, { radiusKm: feedCfg.newlyJoinedRadiusKm }).then((list) => {
        if (cancelled) return;
        setStores(list.map(popularToNearby));
        setLoading(false);
      }).catch(() => { if (!cancelled) setLoading(false); });

    } else {
      // nearby — 전체 active 매장 로드 후 거리 계산
      getDocs(
        query(collection(db, 'stores'), where('status', '==', 'active')),
      ).then((snap) => {
        if (cancelled) return;
        const list: NearbyStore[] = snap.docs.map((d) => {
          const data = d.data() as {
            name: string; address?: string; photoUrls?: string[];
            facilities?: string[]; tier?: string;
            lat?: number; lng?: number;
            averageRating?: number; reviewCount?: number;
            pitch?: string; hours?: string;
            createdAt?: { toMillis?: () => number; seconds?: number } | number | string;
          };
          let createdAtMs: number | undefined;
          if (data.createdAt != null) {
            if (typeof data.createdAt === 'object' && 'toMillis' in data.createdAt && typeof data.createdAt.toMillis === 'function') {
              createdAtMs = data.createdAt.toMillis();
            } else if (typeof data.createdAt === 'object' && 'seconds' in data.createdAt && typeof data.createdAt.seconds === 'number') {
              createdAtMs = data.createdAt.seconds * 1000;
            } else if (typeof data.createdAt === 'number') {
              createdAtMs = data.createdAt;
            } else if (typeof data.createdAt === 'string') {
              createdAtMs = Date.parse(data.createdAt) || undefined;
            }
          }
          return {
            id: d.id,
            name: data.name,
            address: data.address,
            photoUrl: data.photoUrls?.[0],
            facilities: data.facilities,
            tier: data.tier,
            lat: data.lat,
            lng: data.lng,
            averageRating: data.averageRating,
            reviewCount: data.reviewCount,
            pitch: data.pitch,
            hours: data.hours,
            createdAt: createdAtMs,
          };
        });
        setStores(list);
        setLoading(false);
      }).catch(() => { if (!cancelled) setLoading(false); });
    }

    return () => { cancelled = true; };
  }, [
    type,
    userLocation,
    feedCfg.popularRadiusDefaultKm,
    feedCfg.popularRadiusOptionsKm,
    feedCfg.popularAutoExpand,
    feedCfg.popularAutoExpandMaxKm,
    feedCfg.newlyJoinedRadiusKm,
  ]);

  // ─ 모드 토글 + URL 동기화 ─
  const handleToggle = (m: ViewMode) => {
    setMode(m);
    if (typeof window !== 'undefined') {
      const base = `/m/stores?type=${type}`;
      window.history.replaceState(null, '', m === 'map' ? `${base}&mode=map` : base);
    }
  };

  // ─ 제목/서브 문구 ─
  const TITLES: Record<StoreType, string> = {
    popular: '내 주변 인기 매장',
    new:     '새로 합류한 매장',
    nearby:  '내 주변 매장',
  };
  const SUB_LABELS: Record<StoreType, string> = {
    popular: 'POPULAR NEARBY',
    new:     'NEW STORES',
    nearby:  'NEARBY',
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* 헤더 */}
      <header
        className="sticky top-0 z-30"
        style={{
          background: 'linear-gradient(120deg, #FF1F8F 0%, #FF6BAA 100%)',
        }}
      >
        <div className="px-4 flex items-center gap-2.5" style={{ height: 56 }}>
          {/* 뒤로가기 */}
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 transition active:scale-90"
            style={{ background: 'rgba(255,255,255,0.20)' }}
            aria-label="뒤로"
          >
            <svg
              width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="#FFFFFF"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          {/* 타이틀 */}
          <div className="flex-1 min-w-0">
            <div
              className="text-[9px] font-extrabold tracking-widest opacity-80"
              style={{ color: '#fff', letterSpacing: '0.14em' }}
            >
              {SUB_LABELS[type]}
            </div>
            <div
              className="text-[17px] font-black tracking-tight leading-none"
              style={{ color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,0.18)' }}
            >
              {TITLES[type]}
            </div>
          </div>

          {/* 리스트 ↔ 지도 토글 */}
          <div
            className="flex items-center rounded-full p-0.5 flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.22)' }}
          >
            <button
              onClick={() => handleToggle('list')}
              aria-pressed={mode === 'list'}
              className="flex items-center gap-1 rounded-full px-3 h-8 text-[12px] font-bold transition-all"
              style={{
                background: mode === 'list' ? '#fff' : 'transparent',
                color: mode === 'list' ? 'var(--brand)' : 'rgba(255,255,255,0.85)',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              목록
            </button>
            <button
              onClick={() => handleToggle('map')}
              aria-pressed={mode === 'map'}
              className="flex items-center gap-1 rounded-full px-3 h-8 text-[12px] font-bold transition-all"
              style={{
                background: mode === 'map' ? '#fff' : 'transparent',
                color: mode === 'map' ? 'var(--brand)' : 'rgba(255,255,255,0.85)',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
                <line x1="9" y1="3" x2="9" y2="18" /><line x1="15" y1="6" x2="15" y2="21" />
              </svg>
              지도
            </button>
          </div>
        </div>

        {/* popular 섹션 메타 */}
        {type === 'popular' && appliedRadiusKm != null && (
          <div
            className="px-4 pb-2 text-[11px]"
            style={{ color: 'rgba(255,255,255,0.80)' }}
          >
            {expanded
              ? `주변 매장이 적어 ${appliedRadiusKm}km까지 범위를 넓혔어요`
              : `반경 ${appliedRadiusKm}km · LIVE 운영 활발한 매장 우선`}
          </div>
        )}
        {type === 'new' && (
          <div
            className="px-4 pb-2 text-[11px]"
            style={{ color: 'rgba(255,255,255,0.80)' }}
          >
            최근 30일 가입 ·{' '}
            {userLocation
              ? `반경 ${feedCfg.newlyJoinedRadiusKm}km · 거리순`
              : '가입 최신순'}
          </div>
        )}
      </header>

      {/* 컨텐츠 */}
      {mode === 'map' ? (
        <ScopedMapMode
          stores={stores}
          userLocation={userLocation}
          locationDenied={locationDenied}
          liveByStore={liveByStore}
        />
      ) : (
        <div className="pb-[calc(env(safe-area-inset-bottom)+72px)]">
          {loading ? (
            <ListSkeleton />
          ) : type === 'nearby' ? (
            <NearbyListView
              stores={stores}
              liveByStore={liveByStore}
              userLocation={userLocation}
              feedCfg={feedCfg}
            />
          ) : (
            <GenericListView
              stores={stores}
              liveByStore={liveByStore}
              type={type}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── 페이지 export (Suspense 래핑) ─────────────────────────────
export default function StoresPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center text-sm"
          style={{ color: 'var(--text-3)' }}
        >
          로딩 중…
        </div>
      }
    >
      <StoresPageInner />
    </Suspense>
  );
}
