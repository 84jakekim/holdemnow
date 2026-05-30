'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { collection, doc, getDocs, query, where, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession, fmtTime, useLiveCountdown } from '@/lib/live';
import { subscribeAllSeries, type Series } from '@/lib/series';
import { posterStyleFor } from '@/lib/templates';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { haversineMeters, formatDistance, type LatLng } from '@/lib/geo';
import { loadPopularStores, loadRecentlyJoinedStores, type PopularityStore } from '@/lib/popularity';
import { subscribeFeedConfig, FEED_CONFIG_DEFAULT, type FeedConfig } from '@/lib/feedConfig';
import { useAuth } from '@/lib/hooks';
import { coordToRegionLabel } from '@/lib/kakao';
import { geocodeAddress } from '@/lib/kakao';

// 카카오맵 컴포넌트 — 지도 모드 진입 시에만 로드 (#6 lazy)
const FindKakaoMap = dynamic(() => import('./FindKakaoMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
      <div className="skeleton h-full w-full" aria-label="지도 로딩 중" />
    </div>
  ),
});
const MapLoadError = dynamic(() => import('@/components/mobile/MapLoadError'), { ssr: false });
import {
  loadActivePostsAll,
  subscribeActivePinnedPosts,
  type StorePost,
  type PinnedPost,
} from '@/lib/posts';
import { resolveCardVisual } from '@/lib/postCardStyle';
import { formatRelativeKo } from '@/lib/relativeTime';
import NotificationBellButton from '@/components/mobile/NotificationBellButton';
import { RatingChip } from '@/components/mobile/RatingChip';
import StoreFindModeToggle from '@/components/mobile/find/StoreFindModeToggle';
import PrimaryLiveCard from '@/components/mobile/live/PrimaryLiveCard';
import LiveSlider from '@/components/mobile/live/LiveSlider';
import LiveSectionHeader from '@/components/mobile/live/LiveSectionHeader';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── 타입 ─────────────────────────────────────────────────────

interface StoreGroup {
  storeId: string;
  storeName: string;
  sessions: LiveSession[];
}

interface StoreSummary {
  thumbnail?: string;
}

interface NearbyStore {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
  facilities?: string[];
  tier?: string;
  lat?: number;
  lng?: number;
  distance?: number;
  averageRating?: number;
  reviewCount?: number;
  /** 사장 한마디 자랑 — 최대 40자, 없으면 undefined */
  pitch?: string;
  /** 영업시간 문자열 (예: "매일 17:00 - 익일 03:00") */
  hours?: string;
  /** Firestore createdAt timestamp (ms epoch 또는 ISO string) */
  createdAt?: number;
}

// 지도용 추가 필드
interface MapStoreSummary {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
  lat?: number;
  lng?: number;
  averageRating?: number;
  reviewCount?: number;
}

// ─── 상수 ─────────────────────────────────────────────────────

// 내 주변 매장·인기 매장 반경은 본사 어드민 feedConfig가 제공 (nearby/popularRadius*)
// — 기존 NEARBY_RADIUS_STEPS_KM/_INITIAL_KM/_MAX_KM 상수 제거됨.
const NEARBY_LIST_INITIAL_COUNT = 8;
const HOME_POSTS_LIMIT = 15;
const PINNED_ROTATE_MS = 3000;
const MAP_NEARBY_RADIUS_M = 10_000; // 지도 모드 기본 표시 범위 (줌별 반경 fallback에만 사용)

// ─── 카카오 지도 줌별 반경 ────────────────────────────────────

function radiusForZoomLevel(level: number): number {
  if (level <= 2) return 125;
  if (level === 3) return 250;
  if (level === 4) return 500;
  if (level === 5) return 1000;
  if (level === 6) return 1750;
  if (level === 7) return 2500;
  if (level === 8) return 3750;
  return Math.floor(MAP_NEARBY_RADIUS_M / 2);
}

// ─── 메인 페이지 (useSearchParams 사용 → Suspense 필수) ───────

function FindPageInner() {
  const searchParams = useSearchParams();
  // 초기 mode는 URL ?mode=map 으로 진입 가능 — 첫 렌더 한 번만 반영.
  // 이후 토글은 useState로 관리 (URL 동기화는 history.replaceState 로 비파괴적으로 갱신).
  const initialMode: 'list' | 'map' =
    searchParams.get('mode') === 'map' ? 'map' : 'list';
  const [mode, setMode] = useState<'list' | 'map'>(initialMode);

  // ── 단일 watchPosition — #8 위치 추적 중복 가드
  // MapMode / PopularStoresAvatarScroll / NewlyJoinedStoresSection / NearbyStoresSection이
  // 각각 watchPosition을 등록하면 동시 최대 4개 watch ID가 생겨 배터리·메모리 낭비.
  // FindPageInner 레벨에서 1개만 등록하고 props로 내려준다.
  const [sharedLocation, setSharedLocation] = useState<LatLng | null>(null);
  const [sharedLocationDenied, setSharedLocationDenied] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setSharedLocationDenied(true);
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setSharedLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setSharedLocationDenied(true),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const handleToggle = (m: 'list' | 'map') => {
    setMode(m);
    if (typeof window !== 'undefined') {
      const next = m === 'map' ? '/m/find?mode=map' : '/m/find';
      window.history.replaceState(null, '', next);
    }
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* ── 헤더 */}
      <FindHeader />

      {/* ── 모드 토글 */}
      <StoreFindModeToggle mode={mode} onToggle={handleToggle} />

      {/* ── 컨텐츠 */}
      {mode === 'map' ? (
        <MapMode userLocation={sharedLocation} locationDenied={sharedLocationDenied} />
      ) : (
        <ListMode userLocation={sharedLocation} />
      )}
    </div>
  );
}

export default function FindPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: 'var(--text-3)' }}>
          로딩 중…
        </div>
      }
    >
      <FindPageInner />
    </Suspense>
  );
}

// ─── 헤더 ─────────────────────────────────────────────────────

function FindHeader() {
  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: 'linear-gradient(120deg, #FF1F8F 0%, #FF6BAA 100%)',
        position: 'sticky',
      }}
    >
      <div className="px-4 flex items-center gap-2.5" style={{ height: 64 }}>
        {/* 홈 아이콘 + 타이틀 */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div
            className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.22)' }}
            aria-hidden="true"
          >
            <svg
              width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="#FFFFFF"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <div
            className="text-[20px] font-black tracking-tight leading-none"
            style={{ color: '#FFFFFF', textShadow: '0 1px 6px rgba(0,0,0,0.18)', letterSpacing: '-0.02em' }}
          >
            매장찾기
          </div>
        </div>
        {/* 액션 버튼 그룹 */}
        <div className="flex items-center gap-1.5">
          <Link
            href="/m/search"
            aria-label="검색"
            className="w-10 h-10 flex items-center justify-center rounded-full transition active:scale-90"
            style={{ background: 'rgba(255,255,255,0.20)' }}
          >
            <svg
              width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="#FFFFFF"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </Link>
          <NotificationBellButton variant="hero" ariaLabel="알림" />
        </div>
      </div>
    </header>
  );
}

// ═══════════════════════════════════════════════════════════════
// 리스트 모드 — 기존 /m/page.tsx 매장 허브 콘텐츠 전부 이전
// ═══════════════════════════════════════════════════════════════

function ListMode({ userLocation }: { userLocation: LatLng | null }) {
  const authState = useAuth();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [storeSummaries, setStoreSummaries] = useState<Record<string, StoreSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 내 주변 매장용 — 한 번만 fetch해서 NearbyStoresSection에 주입
  const [nearbyStores, setNearbyStores] = useState<NearbyStore[]>([]);

  useEffect(() => {
    let cancelled = false;
    // 2026-05-29 fix #2: 데모 매장 100개도 내 주변 매장 섹션에 노출.
    //   다른 섹션(인기/새로합류/지도/목록)은 데모 표시 → 일관성 + 베타 출시 전 빈 화면 회피.
    //   서버 쿼리는 status==active만, 데모/실 매장 모두 포함.
    getDocs(
      query(
        collection(db, 'stores'),
        where('status', '==', 'active'),
      ),
    ).then((snap) => {
      if (cancelled) return;
      setNearbyStores(
        snap.docs.map((d) => {
          const data = d.data() as {
            name: string; address?: string; photoUrls?: string[];
            facilities?: string[]; tier?: string;
            lat?: number; lng?: number;
            averageRating?: number; reviewCount?: number;
            pitch?: string;
            hours?: string;
            createdAt?: { toMillis?: () => number; seconds?: number } | number | string;
          };
          // createdAt은 Firestore Timestamp / number(ms) / ISO string 모두 지원
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
        }),
      );
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const displayName =
    authState.status === 'authenticated'
      ? authState.user.displayName ?? authState.user.email?.split('@')[0] ?? '플레이어'
      : null;

  const REGION_CACHE_KEY = 'holdemnow:regionLabel';
  const REGION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const REGION_CACHE_RADIUS_M = 500;

  const [regionLabel, setRegionLabel] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(REGION_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw) as { label: string; lat: number; lng: number; ts: number };
      if (Date.now() - cached.ts > REGION_CACHE_TTL_MS) return null;
      return cached.label;
    } catch { return null; }
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        try {
          const raw = window.localStorage.getItem(REGION_CACHE_KEY);
          if (raw) {
            const c = JSON.parse(raw) as { label: string; lat: number; lng: number; ts: number };
            if (Date.now() - c.ts < REGION_CACHE_TTL_MS) {
              const dLat = (pos.coords.latitude - c.lat) * 111_000;
              const dLng = (pos.coords.longitude - c.lng) * 88_000;
              const distM = Math.sqrt(dLat * dLat + dLng * dLng);
              if (distM < REGION_CACHE_RADIUS_M) { setRegionLabel(c.label); return; }
            }
          }
        } catch { /* fall through */ }
        coordToRegionLabel(pos.coords.latitude, pos.coords.longitude)
          .then((label) => {
            if (cancelled || !label) return;
            setRegionLabel(label);
            try {
              window.localStorage.setItem(REGION_CACHE_KEY, JSON.stringify({
                label, lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now(),
              }));
            } catch { /* ignore */ }
          })
          .catch(() => {});
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
    );
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(
      (items) => { setSessions(items); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); },
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeAllSeries(setSeries, () => {});
    return unsub;
  }, []);

  const groups: StoreGroup[] = useMemo(() => {
    const map: Record<string, StoreGroup> = {};
    for (const s of sessions) {
      if (!map[s.storeId]) map[s.storeId] = { storeId: s.storeId, storeName: s.storeName, sessions: [] };
      map[s.storeId].sessions.push(s);
    }
    return Object.values(map);
  }, [sessions]);

  useEffect(() => {
    const ids = groups.map((g) => g.storeId).filter((id) => !(id in storeSummaries));
    if (ids.length === 0) return;
    (async () => {
      try {
        const { getDocs: gd, query: q, collection: col, where, documentId } = await import('firebase/firestore');
        const snap = await gd(q(col(db, 'stores'), where(documentId(), 'in', ids.slice(0, 10))));
        const next: Record<string, StoreSummary> = {};
        snap.forEach((d) => {
          const data = d.data() as { photoUrls?: string[] };
          next[d.id] = { thumbnail: data.photoUrls?.[0] };
        });
        setStoreSummaries((prev) => ({ ...prev, ...next }));
      } catch { /* ignore */ }
    })();
  }, [groups, storeSummaries]);

  const liveByStore = useMemo(() => sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.storeId] = (acc[s.storeId] || 0) + 1;
    return acc;
  }, {}), [sessions]);

  return (
    <div>
      {/* 위치 표시 바 — 탭 가능한 버튼 형식 */}
      <button
        className="w-full flex items-center gap-1.5 tap"
        style={{
          margin: '10px 16px 0',
          width: 'calc(100% - 32px)',
          padding: '10px 14px',
          borderRadius: 12,
          background: 'var(--surface-2)',
          border: 'none',
          cursor: 'default',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
        aria-label="현재 위치"
        disabled
      >
        <svg
          width="13" height="13" viewBox="0 0 24 24"
          fill="none" stroke="var(--brand)" strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        <span className="text-[13px] font-extrabold" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
          {regionLabel ?? '위치 확인 중'}
        </span>
        <svg
          width="11" height="11" viewBox="0 0 24 24"
          fill="none" stroke="var(--text-3)" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
          style={{ marginLeft: 2 }}
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>
        {displayName && (
          <span className="ml-auto text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>
            {displayName}님
          </span>
        )}
      </button>

      {/* ─ LIVE 섹션 헤더 + 큰 카드 + 작은 카드 슬라이더 */}
      {!loading && !error && (
        <>
          <LiveSectionHeader
            count={sessions.filter(
              (s) => s.status === 'running' || s.status === 'paused' || s.status === 'break',
            ).length}
          />
          <PrimaryLiveCard
            sessions={sessions}
            thumbnails={Object.fromEntries(
              Object.entries(storeSummaries).map(([k, v]) => [k, v.thumbnail]),
            )}
          />
          <LiveSlider
            sessions={sessions}
            thumbnails={Object.fromEntries(
              Object.entries(storeSummaries).map(([k, v]) => [k, v.thumbnail]),
            )}
          />
        </>
      )}

      {/* ─ 대회정보·커뮤니티 2-column 카드 */}
      <QuickNavCards />

      {/* ─ 오늘의 매장 소식 */}
      <DailyPostsFeed />

      {/* ─ 인기 매장 — 두꺼운 섹션 구분선 */}
      <PopularStoresAvatarScroll liveByStore={liveByStore} userLocation={userLocation} />

      {/* ─ 새로 합류한 매장 */}
      <NewlyJoinedStoresSection liveByStore={liveByStore} userLocation={userLocation} />

      {/* ─ 내 주변 매장 */}
      <NearbyStoresSection liveByStore={liveByStore} initialStores={nearbyStores} userLocation={userLocation} />

      {/* ─ 메이저 시리즈 */}
      {series.length > 0 && (
        <>
          <section aria-label="메이저 시리즈" className="pb-6" style={{ marginTop: 8, borderTop: '8px solid var(--bg-sub)' }}>
            <div className="px-4 flex items-center justify-between mb-4 pt-5">
              <div>
                <div className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
                  메이저 시리즈
                </div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  전국 주요 대회 일정
                </div>
              </div>
              <Link
                href="/m/events"
                className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60"
                style={{ color: 'var(--brand)' }}
              >
                전체보기
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
              </Link>
            </div>
            <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
              {series.map((s) => <SeriesPosterCard key={s.id} series={s} />)}
              <div className="w-3 flex-shrink-0" aria-hidden="true" />
            </div>
          </section>
        </>
      )}

      <div className="brand-strip-divider" />

      {/* 푸터 */}
      <div className="px-4 py-6 text-center text-[11px]" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-3)' }}>
        Pink Rabbit BETA · 부산/경남 홀덤펍 디스커버리
      </div>
    </div>
  );
}

// ─── 대회정보·커뮤니티 2-column 빠른 이동 카드 ───────────────

function QuickNavCards() {
  return (
    <section aria-label="빠른 이동" className="px-4 py-3">
      <div className="grid grid-cols-2 gap-2.5">
        {/* 대회정보 — 골드 시그니처 */}
        <Link
          href="/m/events"
          aria-label="대회정보"
          className="lift tap relative overflow-hidden"
          style={{
            borderRadius: 16,
            padding: '16px 14px',
            background: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)',
            boxShadow: '0 6px 18px rgba(245,158,11,0.32)',
            color: '#fff',
            border: 'none',
            display: 'block',
          }}
        >
          {/* 배경 이모지 — opacity 0.22 */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', top: -8, right: -6,
              fontSize: 54, opacity: 0.22, pointerEvents: 'none',
              lineHeight: 1,
            }}
          >🏆</span>
          <div style={{ position: 'relative' }}>
            {/* 아이콘 박스 */}
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: 'rgba(255,255,255,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, marginBottom: 24,
            }} aria-hidden="true">🏆</div>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.14em', opacity: 0.85 }}>TOURNAMENT</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
              <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em' }}>대회정보</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.9 }}><path d="M9 18l6-6-6-6"/></svg>
            </div>
          </div>
        </Link>

        {/* 커뮤니티 — 핫핑크 시그니처 */}
        <Link
          href="/m/community"
          aria-label="커뮤니티"
          className="lift tap relative overflow-hidden"
          style={{
            borderRadius: 16,
            padding: '16px 14px',
            background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BAA 100%)',
            boxShadow: '0 6px 18px rgba(255,31,143,0.32)',
            color: '#fff',
            border: 'none',
            display: 'block',
          }}
        >
          {/* 배경 이모지 — opacity 0.22 */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', top: -8, right: -6,
              fontSize: 54, opacity: 0.22, pointerEvents: 'none',
              lineHeight: 1,
            }}
          >💬</span>
          <div style={{ position: 'relative' }}>
            {/* 아이콘 박스 */}
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: 'rgba(255,255,255,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, marginBottom: 24,
            }} aria-hidden="true">💬</div>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.14em', opacity: 0.85 }}>COMMUNITY</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
              <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em' }}>커뮤니티</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.9 }}><path d="M9 18l6-6-6-6"/></svg>
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// 지도 모드 — 기존 /m/discover/page.tsx 콘텐츠 인라인 통합
// 카카오맵 SDK는 이 컴포넌트 마운트 시에만 로드됨
// ═══════════════════════════════════════════════════════════════

function MapMode({ userLocation, locationDenied }: { userLocation: LatLng | null; locationDenied: boolean }) {
  const router = useRouter();
  const [stores, setStores] = useState<MapStoreSummary[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const mapInstanceRef = useRef<any>(null);
  // userLocation / locationDenied는 FindPageInner 단일 watch에서 주입 (#8)

  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, 'stores')).then((snap) => {
      if (cancelled) return;
      const visible = snap.docs.filter((d) => {
        const data = d.data() as { status?: string; isDemo?: boolean };
        return data.status === 'active' || data.isDemo === true;
      });
      setStores(visible.map((d) => {
        const data = d.data() as { name: string; address?: string; photoUrls?: string[]; lat?: number; lng?: number; averageRating?: number; reviewCount?: number };
        return { id: d.id, name: data.name, address: data.address, photoUrl: data.photoUrls?.[0], lat: data.lat, lng: data.lng, averageRating: data.averageRating, reviewCount: data.reviewCount };
      }));
      visible.forEach((d) => trackImpressionOnce(d.id, 'discover-map'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(setSessions, () => {});
    return unsub;
  }, []);

  const liveCountByStore = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sessions) map[s.storeId] = (map[s.storeId] || 0) + 1;
    return map;
  }, [sessions]);

  const storesWithCoords = useMemo(() => stores.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number'), [stores]);

  const nearbyStores = useMemo(() => {
    if (!userLocation) return storesWithCoords.map((s) => ({ ...s, _dist: undefined }));
    return storesWithCoords
      .map((s) => ({ ...s, _dist: haversineMeters(userLocation, { lat: s.lat!, lng: s.lng! }) }))
      .filter((s) => s._dist <= MAP_NEARBY_RADIUS_M || (liveCountByStore[s.id] ?? 0) > 0)
      .sort((a, b) => a._dist - b._dist);
  }, [storesWithCoords, userLocation, liveCountByStore]);

  const totalLive = Object.values(liveCountByStore).reduce((a, b) => a + b, 0);
  const selected = stores.find((s) => s.id === selectedId);
  const selectedLiveCount = selected ? liveCountByStore[selected.id] || 0 : 0;
  const selectedDist = selected && userLocation && typeof selected.lat === 'number' && typeof selected.lng === 'number'
    ? haversineMeters(userLocation, { lat: selected.lat, lng: selected.lng })
    : null;

  useEffect(() => {
    const needsGeocode = stores.filter((s) => s.address && (s.lat == null || s.lng == null));
    if (needsGeocode.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const s of needsGeocode) {
        if (cancelled) return;
        try {
          const coords = await geocodeAddress(s.address!);
          if (!coords) continue;
          updateDoc(doc(db, 'stores', s.id), { lat: coords.lat, lng: coords.lng }).catch(() => {});
          setStores((prev) => prev.map((x) => x.id === s.id ? { ...x, lat: coords.lat, lng: coords.lng } : x));
        } catch { /* skip */ }
      }
    })();
    return () => { cancelled = true; };
  }, [stores]);

  const handleUserSelect = (id: string) => {
    setSelectedId(id);
    const target = stores.find((s) => s.id === id);
    if (!target || target.lat == null || target.lng == null) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (mapInstanceRef.current && maps) {
      mapInstanceRef.current.panTo(new maps.LatLng(target.lat, target.lng));
    }
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 124px)', background: 'var(--bg)' }}>
      {/* 지도 영역 */}
      <div className="flex-1 relative">
        <FindKakaoMap
          stores={storesWithCoords}
          liveCountByStore={liveCountByStore}
          selectedId={selectedId}
          onSelect={handleUserSelect}
          onError={setMapError}
          userLocation={userLocation}
          locationDenied={locationDenied}
          mapInstanceRef={mapInstanceRef}
        />

        {/* 상단 카운트 버튼 */}
        <button
          onClick={() => setSheetOpen(true)}
          disabled={nearbyStores.length === 0}
          className="absolute top-3 left-3 right-3 z-30 text-left transition active:scale-[0.98] disabled:opacity-60"
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
              {userLocation ? '내 주변 매장 · 거리순' : locationDenied ? '서면 중심' : '위치 확인 중…'}
            </div>
            <div className="text-[14px] font-bold mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
              <span>매장 {nearbyStores.length}개</span>
              {nearbyStores.length > 0 && (
                <span className="text-[12px] font-normal" style={{ color: 'var(--text-3)' }}>전체 목록 ›</span>
              )}
            </div>
          </div>
          {totalLive > 0 ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: 'rgba(229,62,62,0.08)', border: '1px solid rgba(229,62,62,0.25)' }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0 pulse-live" style={{ background: 'var(--live)' }} />
              <span className="text-[12px] font-extrabold" style={{ color: 'var(--live)' }}>LIVE {totalLive}</span>
            </div>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>LIVE 없음</span>
          )}
        </button>

        {/* 지도 에러 */}
        {mapError && (
          <div className="absolute inset-0 z-20">
            <MapLoadError layout="overlay" />
            {/* 하단 — 매장 목록 보기 보조 버튼 */}
            <button
              onClick={() => setSheetOpen(true)}
              className="absolute bottom-4 left-4 right-4 h-11 rounded-2xl text-[13px] font-extrabold text-white z-30"
              style={{ background: 'var(--brand)', boxShadow: '0 2px 12px rgba(255,31,143,0.35)' }}
            >
              내 주변 매장 목록 보기
            </button>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none" style={{ color: 'var(--text-3)' }}>
            로딩 중…
          </div>
        )}

        {/* 선택 매장 카드 */}
        {selected && (
          <button
            onClick={() => { bumpStoreMetric(selected.id, 'cardClicks'); router.push(`/m/store/${selected.id}`); }}
            className="absolute bottom-3 left-3 right-3 z-30 flex items-center gap-3 text-left transition active:scale-[0.98]"
            style={{
              background: 'rgba(255,255,255,0.97)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-xl)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              padding: '12px',
            }}
          >
            <div className="relative w-[60px] h-[60px] rounded-xl flex-shrink-0 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              {selected.photoUrl && <Image src={selected.photoUrl} alt={selected.name} fill className="object-cover" sizes="60px" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{selected.name}</div>
                {selectedLiveCount > 0 && (
                  <span className="badge-live flex-shrink-0"><span className="dot" />LIVE</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[12px] truncate" style={{ color: 'var(--text-3)' }}>
                {selectedDist != null && (
                  <span className="font-semibold flex-shrink-0" style={{ color: 'var(--text-2)' }}>{formatDistance(selectedDist)}</span>
                )}
                {selected.address && <span className="truncate">{selected.address}</span>}
              </div>
            </div>
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--brand)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          </button>
        )}

        {/* 바텀 시트 */}
        {sheetOpen && (
          <NearbyStoresSheet
            stores={nearbyStores}
            liveCountByStore={liveCountByStore}
            onClose={() => setSheetOpen(false)}
            onItemClick={(id) => { setSheetOpen(false); handleUserSelect(id); }}
          />
        )}
      </div>
    </div>
  );
}

// KakaoMap 컴포넌트는 FindKakaoMap.tsx로 분리 → dynamic import (#6)

// ─── 바텀 시트 ────────────────────────────────────────────────

function NearbyStoresSheet({
  stores, liveCountByStore, onClose, onItemClick,
}: {
  stores: Array<MapStoreSummary & { _dist?: number }>;
  liveCountByStore: Record<string, number>;
  onClose: () => void;
  onItemClick: (id: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button aria-label="닫기" onClick={onClose} className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.30)' }} />
      <div className="relative flex flex-col" style={{ background: 'var(--surface-1)', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '75vh', boxShadow: '0 -4px 24px rgba(0,0,0,0.12)' }}>
        <div className="flex justify-center pt-3 pb-1"><div className="w-9 h-1 rounded-full" style={{ background: 'var(--surface-3)' }} /></div>
        <div className="flex items-center justify-between px-5 pb-3 pt-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>내 주변 매장 · 거리순</div>
            <div className="text-[16px] font-extrabold" style={{ color: 'var(--text-1)' }}>{stores.length}개</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center transition active:scale-90" style={{ background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 18 }} aria-label="닫기">×</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {stores.map((s) => {
            const live = liveCountByStore[s.id] || 0;
            return (
              <button key={s.id} onClick={() => onItemClick(s.id)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition active:bg-gray-50" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="relative w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                  {s.photoUrl && <Image src={s.photoUrl} alt={s.name} fill className="object-cover" sizes="48px" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{s.name}</span>
                    {live > 0 && <span className="badge-live flex-shrink-0"><span className="dot" />LIVE</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {s._dist != null && <span className="font-semibold flex-shrink-0" style={{ color: 'var(--text-2)' }}>{formatDistance(s._dist)}</span>}
                    {s.address && <span className="truncate">{s.address}</span>}
                  </div>
                  {(s.reviewCount ?? 0) > 0 && <div className="mt-1"><RatingChip rating={s.averageRating} count={s.reviewCount} size="sm" /></div>}
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// 마커 유틸은 FindKakaoMap.tsx로 이동 (#6)

// ═══════════════════════════════════════════════════════════════
// 리스트 모드 서브 컴포넌트들 (기존 /m/page.tsx에서 이전)
// ═══════════════════════════════════════════════════════════════

// ─── 오늘의 매장 소식 ────────────────────────────────────────

function DailyPostsFeed() {
  const [pinned, setPinned] = useState<PinnedPost[]>([]);
  const [posts, setPosts] = useState<StorePost[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = subscribeActivePinnedPosts(setPinned, () => {});
    return unsub;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadActivePostsAll().then((items) => {
      if (cancelled) return;
      const now = Date.now();
      setPosts(items.filter((p) => (p.expiresAt?.toMillis() ?? 0) > now).slice(0, HOME_POSTS_LIMIT));
      setLoaded(true);
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  if (loaded && pinned.length === 0 && posts.length === 0) return null;

  return (
    <section aria-label="오늘의 매장 소식" className="py-5" style={{ borderTop: '8px solid var(--bg-sub)' }}>
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="section-title" style={{ marginBottom: 2 }}>TODAY'S NEWS</div>
          <div className="h3 flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
            <span>오늘의 매장 소식</span>
          </div>
        </div>
        <Link
          href="/m/posts"
          className="text-[12px] font-semibold transition active:opacity-60"
          style={{ color: 'var(--text-3)' }}
        >
          전체보기 →
        </Link>
      </div>
      {pinned.length > 0 && <div className="px-4 mb-3"><PinnedCarousel items={pinned} /></div>}
      {posts.length > 0 && <StorePostsPortraitCarousel posts={posts} />}
    </section>
  );
}

/**
 * 세로 포스터 2개씩 노출 + 자동 슬라이드.
 * 사장님이 카톡방용 세로 포스터(2:3, 3:4 등)를 그대로 올려도 잘리지 않도록 비율 자유.
 * 페이지(2개)당 5초마다 다음 슬라이드로 자동 회전. 사용자가 직접 스크롤·터치하면 5초 일시정지.
 */
function StorePostsPortraitCarousel({ posts }: { posts: StorePost[] }) {
  const pages = useMemo(() => {
    const chunks: StorePost[][] = [];
    for (let i = 0; i < posts.length; i += 2) chunks.push(posts.slice(i, i + 2));
    return chunks;
  }, [posts]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);

  // viewport 가시성
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const ob = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? true),
      { threshold: 0.4 },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  // 사용자 스크롤로 인덱스 동기화
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || pages.length < 2) return;
    const handleScroll = () => {
      const w = el.clientWidth;
      if (w === 0) return;
      const newIdx = Math.round(el.scrollLeft / w);
      setActiveIdx(Math.min(newIdx, pages.length - 1));
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [pages.length]);

  const scrollTo = useCallback((i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' });
    setActiveIdx(i);
  }, []);

  // 자동 슬라이드
  useEffect(() => {
    if (pages.length < 2 || !inView || paused) return;
    const t = setInterval(() => {
      setActiveIdx((prev) => {
        const next = (prev + 1) % pages.length;
        scrollTo(next);
        return next;
      });
    }, 5000);
    return () => clearInterval(t);
  }, [pages.length, inView, paused, scrollTo]);

  const handleUserInteraction = useCallback(() => {
    setPaused(true);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setPaused(false), 5000);
  }, []);

  useEffect(() => () => { if (resumeTimer.current) clearTimeout(resumeTimer.current); }, []);

  return (
    <div ref={containerRef} className="w-full">
      <div
        ref={scrollRef}
        className="flex overflow-x-auto scrollbar-none"
        style={{ scrollSnapType: 'x mandatory' }}
        onTouchStart={handleUserInteraction}
        onPointerDown={handleUserInteraction}
        aria-label="매장 데일리 소식 슬라이드"
      >
        {pages.map((page, pageIdx) => (
          <div
            key={pageIdx}
            className="flex-shrink-0 w-full px-4 grid grid-cols-2 gap-3"
            style={{ scrollSnapAlign: 'start' }}
          >
            {page.map((p) => <StorePostMiniCard key={p.id} post={p} />)}
            {/* 마지막 페이지 카드가 1장이면 빈 자리 균형 유지 */}
            {page.length < 2 && <div aria-hidden="true" />}
          </div>
        ))}
      </div>
      {pages.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3" aria-label="페이지 인디케이터">
          {pages.map((_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="block rounded-full transition-all duration-200"
              style={{
                width: i === activeIdx ? 18 : 5,
                height: 5,
                background: i === activeIdx ? 'var(--brand)' : 'rgba(255,31,143,0.30)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PinnedCarousel({ items }: { items: PinnedPost[] }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const ob = new IntersectionObserver((entries) => setInView(entries[0]?.isIntersecting ?? true), { threshold: 0.5 });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    if (items.length < 2 || !inView || paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), PINNED_ROTATE_MS);
    return () => clearInterval(t);
  }, [items.length, inView, paused]);

  const safeIdx = Math.min(idx, items.length - 1);
  const current = items[safeIdx];

  return (
    <div ref={containerRef} onTouchStart={() => setPaused(true)} onPointerDown={() => setPaused(true)} onFocus={() => setPaused(true)} aria-live="off">
      <PinnedBanner post={current} />
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2.5" role="tablist" aria-label="공지 인디케이터">
          {items.map((_, i) => (
            <button key={i} role="tab" aria-selected={i === safeIdx} aria-label={`${i + 1}번째 공지`} onClick={() => { setPaused(true); setIdx(i); }} className="relative flex items-center justify-center" style={{ width: 32, height: 32 }}>
              <span className="block rounded-full transition-all" style={{ width: i === safeIdx ? 18 : 5, height: 5, background: i === safeIdx ? 'var(--brand)' : 'rgba(255,31,143,0.30)' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PinnedBanner({ post }: { post: PinnedPost }) {
  const photo = post.imageUrls[0];
  return (
    <Link
      href={`/m/notice/${post.id}`}
      aria-label={post.title}
      className="w-full rounded-2xl overflow-hidden card-hover text-left block"
      style={{ background: 'var(--surface-1)' }}
    >
      {photo ? (
        /* 사진 있으면 16:9 사진만. 테두리 제거. */
        <div className="relative w-full" style={{ aspectRatio: '16/9', background: 'var(--surface-2)' }}>
          <Image src={photo} alt={post.title} fill className="object-cover" sizes="100vw" />
        </div>
      ) : (
        /* 사진 없으면 제목·본문 요약 (16:9 비율 박스 안에) */
        <div
          className="relative w-full flex flex-col justify-center px-4"
          style={{ aspectRatio: '16/9', background: 'var(--surface-2)' }}
        >
          <div className="text-[15px] font-extrabold mb-1 line-clamp-2" style={{ color: 'var(--text-1)' }}>{post.title}</div>
          {post.body && <div className="text-[12px] line-clamp-2" style={{ color: 'var(--text-2)' }}>{post.body}</div>}
          {post.ctaLabel && <div className="text-[13px] font-bold mt-1" style={{ color: 'var(--brand)' }}>{post.ctaLabel} ›</div>}
        </div>
      )}
    </Link>
  );
}

function StorePostMiniCard({ post }: { post: StorePost }) {
  const photo = post.imageUrls[0];
  const summary = post.body.split('\n').slice(0, 4).join('\n');
  // Phase F: headline 우선, 없으면 body 첫 줄
  const headline = (post.headline ?? '').trim() || (post.body || '').split('\n')[0]?.trim() || '';
  const { style, emojis } = resolveCardVisual(post);
  const relative = formatRelativeKo(post.createdAt);
  return (
    <Link
      href={`/m/post/${post.storeId}/${post.id}`}
      onClick={() => bumpStoreMetric(post.storeId, 'cardClicks')}
      aria-label={`${post.storeName ?? '매장'} 소식 보기`}
      className="block w-full rounded-xl overflow-hidden card-hover"
      style={{ background: 'var(--surface-1)' }}
    >
      {photo ? (
        /* 세로 포스터(2:3) — 사장님이 카톡방용 세로 포스터 업로드해도 잘리지 않게.
         * 작은 카드(2개씩 노출) → 터치해서 상세 페이지에서 크게 본다. */
        <div className="relative w-full" style={{ aspectRatio: '2/3', background: 'var(--surface-2)' }}>
          <Image src={photo} alt={post.storeName ?? ''} fill className="object-cover" sizes="(max-width: 430px) 50vw, 200px" />
          {post.imageUrls.length > 1 && (
            <span className="absolute top-2 right-2 text-[10px] font-bold rounded-full px-1.5 py-0.5 text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>
              +{post.imageUrls.length - 1}
            </span>
          )}
          {relative && (
            <span className="absolute top-2 left-2 text-[10px] font-semibold rounded-full px-1.5 py-0.5 text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>
              {relative}
            </span>
          )}
          {/* 매장명 — 하단 그라데이션 위에 작게 */}
          {post.storeName && (
            <>
              <div className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 100%)' }} />
              <div className="absolute bottom-1.5 left-2 right-2 text-[11px] font-extrabold text-white truncate" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                {post.storeName}
              </div>
            </>
          )}
        </div>
      ) : (
        /* 사진 없는 경우 — 색상 톤 + 헤드라인 강조 텍스트 카드 (Phase F) */
        <div
          className="px-3 py-3 flex flex-col"
          style={{ aspectRatio: '2/3', background: style.surface, border: `1px solid ${style.border}` }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            {emojis.length > 0 && (
              <div className="flex items-center gap-0.5">
                {emojis.map((e, i) => (
                  <div
                    key={`${e}_${i}`}
                    className="flex items-center justify-center rounded"
                    style={{ width: 22, height: 22, background: style.accent, fontSize: 13 }}
                  >
                    <span>{e}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[11px] font-extrabold truncate flex-1" style={{ color: style.textSecondary }}>
              {post.storeName ?? '매장'}
            </div>
          </div>
          {headline && (
            <div className="text-[12px] font-extrabold leading-snug line-clamp-3 mb-1.5" style={{ color: style.textPrimary }}>
              {headline}
            </div>
          )}
          <div className="text-[10px] leading-relaxed whitespace-pre-wrap line-clamp-[7] flex-1" style={{ color: style.textSecondary }}>{summary}</div>
          {relative && (
            <div className="text-[9px] font-medium mt-1" style={{ color: style.textSecondary, opacity: 0.8 }}>{relative}</div>
          )}
        </div>
      )}
    </Link>
  );
}

// ─── 인기 매장 아바타 스크롤 ──────────────────────────────────

function PopularStoresAvatarScroll({ liveByStore, userLocation }: { liveByStore: Record<string, number>; userLocation: LatLng | null }) {
  const [stores, setStores] = useState<PopularityStore[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [appliedRadiusKm, setAppliedRadiusKm] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [feedCfg, setFeedCfg] = useState<FeedConfig>(FEED_CONFIG_DEFAULT);
  // userLocation은 FindPageInner 단일 watch에서 주입 (#8)

  // 본사 어드민 반경 설정 구독 — 인기 매장 정책
  useEffect(() => {
    return subscribeFeedConfig(setFeedCfg, () => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPopularStores(userLocation, {
      defaultRadiusKm: feedCfg.popularRadiusDefaultKm,
      expandStepsKm: feedCfg.popularRadiusOptionsKm,
      autoExpand: feedCfg.popularAutoExpand,
      maxKm: feedCfg.popularAutoExpandMaxKm,
    }).then((res) => {
      if (cancelled) return;
      setStores(res.stores); setExpanded(res.expanded);
      setAppliedRadiusKm(res.appliedRadiusM > 0 ? Math.round(res.appliedRadiusM / 1000) : null);
      setLoaded(true);
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [
    userLocation,
    feedCfg.popularRadiusDefaultKm,
    feedCfg.popularRadiusOptionsKm,
    feedCfg.popularAutoExpand,
    feedCfg.popularAutoExpandMaxKm,
  ]);

  if (loaded && stores.length === 0) return null;

  return (
    <section aria-label="내 주변 인기 매장" className="py-5" style={{ borderTop: '8px solid var(--bg-sub)' }}>
      <div className="px-4 flex items-end justify-between mb-1">
        <div>
          <div className="section-title" style={{ marginBottom: 2 }}>POPULAR NEARBY</div>
          <div className="h3" style={{ color: 'var(--text-1)' }}>내 주변 인기 매장</div>
        </div>
        <button onClick={() => window.location.href = '/m/find?mode=map'} className="text-[12px] font-bold flex items-center gap-0.5 transition active:opacity-60 mb-0.5" style={{ color: 'var(--brand)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
          지도로 보기
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      {appliedRadiusKm != null && (
        <div className="px-4 mb-3 text-[11px]" style={{ color: 'var(--text-3)' }}>
          {expanded ? `주변 매장이 적어 ${appliedRadiusKm}km까지 범위를 넓혔어요` : `반경 ${appliedRadiusKm}km · LIVE 운영 활발한 매장 우선`}
        </div>
      )}
      <div className="pl-4 flex gap-4 overflow-x-auto scrollbar-none pb-2">
        {stores.map((st, i) => {
          const isLive = (liveByStore[st.id] || 0) > 0;
          const photo = st.photoUrls[0];
          const rankTop3 = i < 3;
          return (
            <Link key={st.id} href={`/m/store/${st.id}`} onClick={() => bumpStoreMetric(st.id, 'cardClicks')} className="flex flex-col items-center flex-shrink-0 transition active:scale-95" style={{ width: 72, gap: 8 }}>
              {/* 아바타 — 핸드오프: 68px roundedSquare(22px radius) */}
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    width: 68, height: 68,
                    borderRadius: 22,
                    background: photo ? 'var(--surface-2)' : 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)',
                    boxShadow: 'var(--shadow-card)',
                    border: isLive ? '2px solid var(--live)' : '2px solid var(--bg)',
                    overflow: 'hidden',
                    position: 'relative',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {photo
                    ? <Image src={photo} alt={st.name} fill className="object-cover" sizes="68px" />
                    : <span className="text-[22px] font-extrabold" style={{ color: 'var(--brand)' }}>{st.name.charAt(0)}</span>
                  }
                </div>
                {/* 순위 배지 — 1~3위: brand, 4위~: surface-3 */}
                <span style={{
                  position: 'absolute', top: -4, left: -4,
                  width: 20, height: 20, borderRadius: 99,
                  background: rankTop3 ? 'var(--brand)' : 'var(--surface-3)',
                  color: rankTop3 ? '#fff' : 'var(--text-2)',
                  fontSize: 10, fontWeight: 900,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '2px solid var(--bg)',
                  fontVariantNumeric: 'tabular-nums',
                }}>{i + 1}</span>
                {/* LIVE 도트 */}
                {isLive && (
                  <span
                    className="absolute pulse-live"
                    style={{ bottom: 2, right: 2, width: 14, height: 14, borderRadius: 99, background: 'var(--live)', border: '2px solid var(--bg)' }}
                    aria-label="LIVE 중"
                  />
                )}
              </div>
              <div style={{ width: 72, textAlign: 'center' }}>
                <div className="text-[11px] font-bold leading-tight" style={{ color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.name}</div>
                {st.distance != null && (
                  <div className="mono text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {st.distance < 1000 ? `${Math.round(st.distance)}m` : `${(st.distance / 1000).toFixed(1)}km`}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>
    </section>
  );
}

// ─── 새로 합류한 매장 ─────────────────────────────────────────

function NewlyJoinedStoresSection({ liveByStore, userLocation }: { liveByStore: Record<string, number>; userLocation: LatLng | null }) {
  const [stores, setStores] = useState<PopularityStore[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [feedCfg, setFeedCfg] = useState<FeedConfig>(FEED_CONFIG_DEFAULT);
  // userLocation은 FindPageInner 단일 watch에서 주입 (#8)

  // 본사 어드민 반경 설정 구독
  useEffect(() => {
    return subscribeFeedConfig(setFeedCfg, () => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRecentlyJoinedStores(userLocation, { radiusKm: feedCfg.newlyJoinedRadiusKm }).then((list) => {
      if (cancelled) return; setStores(list); setLoaded(true);
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userLocation, feedCfg.newlyJoinedRadiusKm]);

  if (loaded && stores.length === 0) return null;

  return (
    <section aria-label="새로 합류한 매장" className="py-5" style={{ borderTop: '8px solid var(--bg-sub)' }}>
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="section-title" style={{ marginBottom: 2 }}>NEW STORES</div>
          <div className="h3 flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
            <span>새로 합류한 매장</span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            최근 30일 가입 · {userLocation ? `반경 ${feedCfg.newlyJoinedRadiusKm}km · 거리순` : '가입 최신순'}
          </div>
        </div>
      </div>
      <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
        {stores.map((st) => {
          const isLive = (liveByStore[st.id] || 0) > 0;
          const photo = st.photoUrls[0];
          return (
            <Link key={st.id} href={`/m/store/${st.id}`} onClick={() => bumpStoreMetric(st.id, 'cardClicks')} className="w-[140px] flex-shrink-0 rounded-2xl overflow-hidden card-hover lift tap" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
              <div className="relative overflow-hidden" style={{ aspectRatio: '4/3', background: 'var(--surface-2)' }}>
                {photo
                  ? <Image src={photo} alt={st.name} fill className="object-cover" sizes="140px" />
                  : <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}><span className="text-[20px] font-extrabold" style={{ color: 'var(--brand)' }}>{st.name.charAt(0)}</span></div>
                }
                <span className="absolute top-2 left-2 text-[9px] font-extrabold rounded-full px-2 py-0.5" style={{ background: 'var(--brand)', color: '#fff' }}>NEW</span>
                {isLive && <div className="absolute top-2 right-2"><span className="badge-live" style={{ fontSize: 9, padding: '2px 6px' }}><span className="dot" />LIVE</span></div>}
                <div className="absolute bottom-0 left-0 right-0 h-10" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 100%)' }} aria-hidden="true" />
              </div>
              <div className="px-2.5 pt-2.5 pb-2">
                <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</div>
                {st.address && <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{st.address.split(' ').slice(1, 3).join(' ')}</div>}
              </div>
            </Link>
          );
        })}
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>
    </section>
  );
}

// ─── 내 주변 매장 — 정렬 유틸 ────────────────────────────────

type NearbySort = 'distance' | 'live' | 'open' | 'rating' | 'new';

const NEARBY_SORT_OPTIONS: { value: NearbySort; label: string; emoji: string }[] = [
  { value: 'distance', label: '거리순', emoji: '📍' },
  { value: 'live',     label: 'LIVE',   emoji: '🔴' },
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

/**
 * 영업 중 여부 판단
 * 지원 패턴:
 *   "매일 17:00 - 익일 03:00"
 *   "매일 18:00 - 02:00"
 *   "17:00 - 03:00"
 *   "17:00 ~ 03:00"
 * 파싱 실패 시 true 반환 (영업 중으로 가정)
 */
function isOpenNow(hours?: string): boolean {
  if (!hours) return true;
  try {
    const timeRe = /(\d{1,2}):(\d{2})\s*[-~]\s*(?:익일\s*)?(\d{1,2}):(\d{2})/;
    const m = hours.match(timeRe);
    if (!m) return true;
    const openH = parseInt(m[1], 10);
    const openMin = parseInt(m[2], 10);
    const closeH = parseInt(m[3], 10);
    const closeMin = parseInt(m[4], 10);
    const openTotal = openH * 60 + openMin;
    let closeTotal = closeH * 60 + closeMin;
    // 익일 패턴이거나 닫는 시간이 여는 시간보다 작으면 자정 넘김
    const isNextDay = /익일/.test(hours) || closeTotal < openTotal;
    if (isNextDay) closeTotal += 24 * 60;
    const now = new Date();
    let nowTotal = now.getHours() * 60 + now.getMinutes();
    // 자정 이후(00:00~06:00)에 closeTotal이 24h를 넘는 경우 현재 시각도 +24h 처리
    if (isNextDay && nowTotal < openTotal) nowTotal += 24 * 60;
    return nowTotal >= openTotal && nowTotal < closeTotal;
  } catch { return true; }
}

function sortNearbyStores(stores: NearbyStore[], sort: NearbySort, liveByStore: Record<string, number>): NearbyStore[] {
  const distCmp = (a: NearbyStore, b: NearbyStore) => {
    if (a.distance != null && b.distance != null) return a.distance - b.distance;
    if (a.distance != null) return -1;
    if (b.distance != null) return 1;
    return 0;
  };

  switch (sort) {
    case 'distance':
      return [...stores].sort(distCmp);

    case 'live': {
      return [...stores].sort((a, b) => {
        const la = (liveByStore[a.id] ?? 0) > 0 ? 1 : 0;
        const lb = (liveByStore[b.id] ?? 0) > 0 ? 1 : 0;
        if (lb !== la) return lb - la;
        return distCmp(a, b);
      });
    }

    case 'open': {
      return [...stores].sort((a, b) => {
        const oa = isOpenNow(a.hours) ? 1 : 0;
        const ob = isOpenNow(b.hours) ? 1 : 0;
        if (ob !== oa) return ob - oa;
        return distCmp(a, b);
      });
    }

    case 'rating': {
      return [...stores].sort((a, b) => {
        const ra = a.averageRating ?? -1;
        const rb = b.averageRating ?? -1;
        if (rb !== ra) return rb - ra;
        return distCmp(a, b);
      });
    }

    case 'new': {
      return [...stores].sort((a, b) => {
        const ca = a.createdAt ?? 0;
        const cb = b.createdAt ?? 0;
        if (cb !== ca) return cb - ca;
        return distCmp(a, b);
      });
    }

    default:
      return [...stores].sort(distCmp);
  }
}

// ─── 내 주변 매장 ─────────────────────────────────────────────

function NearbyStoresSection({ liveByStore, initialStores, userLocation }: { liveByStore: Record<string, number>; initialStores: NearbyStore[]; userLocation: LatLng | null }) {
  const [stores, setStores] = useState<NearbyStore[]>(initialStores);
  // userLocation은 FindPageInner 단일 watch에서 주입 (#8)
  const [feedCfg, setFeedCfg] = useState<FeedConfig>(FEED_CONFIG_DEFAULT);
  const [radiusKm, setRadiusKm] = useState<number>(FEED_CONFIG_DEFAULT.nearbyRadiusDefaultKm);
  const [radiusManual, setRadiusManual] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);
  const [activeSort, setActiveSort] = useState<NearbySort>(loadSavedSort);

  const handleSortChange = (s: NearbySort) => {
    setActiveSort(s);
    try { window.localStorage.setItem(NEARBY_SORT_KEY, s); } catch { /* noop */ }
  };

  // 본사 어드민 반경 설정 구독
  // 2026-05-28 #5 fix: stale closure 버그 — subscribe 콜백이 mount 시점 radiusManual=false만 보고
  //   사용자가 manual로 반경 변경해도 cfg 갱신 시 덮어씀. ref로 최신 값 참조.
  const radiusManualRef = useRef(radiusManual);
  useEffect(() => {
    radiusManualRef.current = radiusManual;
  }, [radiusManual]);
  useEffect(() => {
    return subscribeFeedConfig((cfg) => {
      setFeedCfg(cfg);
      if (!radiusManualRef.current) setRadiusKm(cfg.nearbyRadiusDefaultKm);
    }, () => {});
  }, []);

  // initialStores는 ListMode에서 한 번 fetch된 데이터 — 도착하면 로컬 상태에 반영
  useEffect(() => {
    if (initialStores.length > 0) setStores(initialStores);
  }, [initialStores]);

  const sorted = useMemo(() => {
    const withDist = stores.map((s) => ({
      ...s,
      distance: userLocation && typeof s.lat === 'number' && typeof s.lng === 'number'
        ? haversineMeters(userLocation, { lat: s.lat, lng: s.lng })
        : undefined,
    }));
    return sortNearbyStores(withDist, activeSort, liveByStore);
  }, [stores, userLocation, activeSort, liveByStore]);

  const visible = useMemo(() => {
    if (!userLocation) return sorted;
    const maxM = radiusKm * 1000;
    return sorted.filter((s) => s.distance != null && s.distance <= maxM);
  }, [sorted, userLocation, radiusKm]);

  // 본사 옵션 배열에서 현재보다 큰 다음 단계 (없으면 자동확장 max로 fallback)
  const nextRadiusKm = userLocation
    ? feedCfg.nearbyRadiusOptionsKm.find((r) => r > radiusKm)
      ?? (feedCfg.nearbyAutoExpand && feedCfg.nearbyAutoExpandMaxKm > radiusKm ? feedCfg.nearbyAutoExpandMaxKm : null)
    : null;
  const moreCount = useMemo(() => {
    if (!userLocation || nextRadiusKm == null) return 0;
    const nextMaxM = nextRadiusKm * 1000;
    return Math.max(0, sorted.filter((s) => s.distance != null && s.distance <= nextMaxM).length - visible.length);
  }, [sorted, userLocation, nextRadiusKm, visible.length]);

  const canExpand = nextRadiusKm != null && radiusKm < feedCfg.nearbyAutoExpandMaxKm;

  if (stores.length === 0) return null;

  const activeSortLabel = NEARBY_SORT_OPTIONS.find((o) => o.value === activeSort)?.label ?? '거리순';

  return (
    <section aria-label="내 주변 매장" className="pt-5" style={{ borderTop: '8px solid var(--bg-sub)' }}>
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="section-title" style={{ marginBottom: 2 }}>NEARBY</div>
          <div className="h3" style={{ color: 'var(--text-1)' }}>내 주변 매장</div>
          <div className="text-[12px] mt-0.5 flex items-center gap-1 flex-wrap" style={{ color: 'var(--text-3)' }}>
            {userLocation ? `현재 위치 기준 · 반경 ${radiusKm}km · ` : '위치 권한 허용 시 거리 표시'}
            {userLocation && <span className="font-bold stat-number" style={{ color: 'var(--brand)' }}>{visible.length}개</span>}
            {activeSort !== 'distance' && (() => {
              // 정렬 기준에 실제 부합하는 매장 수 — UX 혼란 차단
              let matchCount: number | null = null;
              if (activeSort === 'live') {
                matchCount = visible.filter((s) => (liveByStore[s.id] ?? 0) > 0).length;
              } else if (activeSort === 'open') {
                matchCount = visible.filter((s) => isOpenNow(s.hours)).length;
              } else if (activeSort === 'rating') {
                matchCount = visible.filter((s) => (s.reviewCount ?? 0) > 0).length;
              }
              const zero = matchCount === 0;
              return (
                <span
                  className="ml-1 text-[11px] font-semibold rounded-full px-1.5 py-0.5"
                  style={{
                    background: zero ? 'rgba(245,158,11,0.12)' : 'rgba(255,31,143,0.1)',
                    color: zero ? '#D97706' : 'var(--brand)',
                  }}
                >
                  {activeSortLabel}으로 정렬됨
                  {matchCount != null && (
                    zero
                      ? ` · 해당 매장 없음(거리순 표시)`
                      : ` · ${matchCount}곳`
                  )}
                </span>
              );
            })()}
          </div>
        </div>
        <button onClick={() => window.location.href = '/m/find?mode=map'} className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60 mb-1" style={{ color: 'var(--brand)' }}>
          지도로 보기
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>

      {/* 정렬 selector — 가로 스크롤 pill */}
      <div
        className="pl-4 flex gap-2 overflow-x-auto scrollbar-none pb-2 mb-3"
        role="group"
        aria-label="정렬 기준 선택"
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

      {/* 가로 스크롤 */}
      <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
        {visible.slice(0, 10).map((st) => <NearbyStoreSquareCard key={st.id} store={st} live={liveByStore[st.id] || 0} />)}
        <button onClick={() => window.location.href = '/m/find?mode=map'} className="w-[140px] flex-shrink-0 rounded-2xl flex flex-col items-center justify-center gap-2 transition active:scale-95" style={{ aspectRatio: '4/3', background: 'var(--surface-2)', border: '1px solid var(--border)' }} aria-label="전체 매장 지도로 보기">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-3)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-2)' }} aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </div>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>지도로</span>
        </button>
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>

      {/* 리스트 */}
      <div className="mt-4">
        {(listExpanded ? visible : visible.slice(0, NEARBY_LIST_INITIAL_COUNT)).map((st, i) => (
          <NearbyStoreListRow key={st.id} store={st} live={liveByStore[st.id] || 0} rank={i + 1} />
        ))}
      </div>

      {visible.length > NEARBY_LIST_INITIAL_COUNT && (
        <div className="px-4 pt-3">
          <button onClick={() => setListExpanded((v) => !v)} className="w-full py-3 rounded-2xl text-[13px] font-bold transition active:scale-[0.99] flex items-center justify-center gap-1.5" style={{ background: listExpanded ? 'var(--surface-2)' : 'var(--brand-pale)', border: `1px solid ${listExpanded ? 'var(--border)' : 'rgba(240,71,155,0.25)'}`, color: listExpanded ? 'var(--text-2)' : '#C8276A' }} aria-expanded={listExpanded}>
            {listExpanded ? <>접기 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg></> : <><span>펼쳐보기</span><span className="stat-number font-extrabold">+{visible.length - NEARBY_LIST_INITIAL_COUNT}개</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></>}
          </button>
        </div>
      )}

      {canExpand && (
        <div className="px-4 pt-2 pb-1">
          <button onClick={() => { setRadiusKm(nextRadiusKm!); setRadiusManual(true); }} className="w-full py-2.5 rounded-2xl text-[12px] font-semibold transition active:scale-[0.99] flex items-center justify-center gap-1" style={{ background: 'var(--surface-1)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}>
            더 멀리 · 반경 {nextRadiusKm}km까지 넓히기
            {moreCount > 0 && <span className="stat-number font-bold" style={{ color: 'var(--text-2)' }}> +{moreCount}개</span>}
          </button>
        </div>
      )}
    </section>
  );
}

// ─── 시설 아이콘 매핑 ─────────────────────────────────────────

const FACILITY_ICON: Record<string, string> = {
  '주차': '🚗', '발렛': '🅿️', '식사': '🍱', '24시간': '🌙',
  '흡연실': '🚬', '룸': '🚪', '여성전용시간': '👩', 'VIP룸': '💎',
};

function NearbyStoreSquareCard({ store: st, live }: { store: NearbyStore; live: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'find-nearby'); }, [st.id]);
  const hasPitch = !!(st.pitch?.trim());
  const facilityLabels = (st.facilities ?? []).slice(0, 2);

  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="flex-shrink-0 rounded-2xl overflow-hidden card-hover lift tap"
      style={{
        width: hasPitch ? 160 : 140,
        background: 'var(--surface-1)',
        border: hasPitch ? '1.5px solid rgba(255,31,143,0.22)' : '1px solid var(--border)',
        boxShadow: hasPitch ? '0 4px 16px rgba(255,31,143,0.10), var(--shadow-card)' : 'var(--shadow-card)',
        transition: 'width 0.2s',
      }}
      aria-label={`${st.name}${hasPitch ? ` — ${st.pitch}` : ''}`}
    >
      {/* 이미지 영역 */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '4/3', background: 'var(--surface-2)' }}>
        {st.photoUrl ? (
          <Image
            src={st.photoUrl}
            alt={st.name}
            fill
            className="object-cover transition-transform duration-300"
            sizes={hasPitch ? '160px' : '140px'}
            style={{ transformOrigin: 'center' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}>
            <span className="text-[28px] font-extrabold" style={{ color: 'var(--brand)', opacity: 0.3 }}>{st.name.charAt(0)}</span>
          </div>
        )}

        {/* 거리 + 평점 뱃지 (좌상단 그룹) */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
          {st.distance != null && (
            <span
              className="text-[10px] font-bold rounded-full px-2 py-0.5"
              style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
            >
              {formatDistance(st.distance)}
            </span>
          )}
          {(st.reviewCount ?? 0) > 0 && st.averageRating != null && (
            <span
              className="text-[10px] font-bold rounded-full px-2 py-0.5 inline-flex items-center gap-0.5"
              style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
              aria-label={`평점 ${st.averageRating.toFixed(1)}점 / 리뷰 ${st.reviewCount}개`}
            >
              <span aria-hidden style={{ color: '#FFD43B' }}>★</span>
              {st.averageRating.toFixed(1)}
              <span style={{ opacity: 0.7 }}>({st.reviewCount})</span>
            </span>
          )}
        </div>

        {/* LIVE 뱃지 */}
        {live > 0 && (
          <div className="absolute top-2 right-2">
            <span className="badge-live" style={{ fontSize: 9, padding: '2px 6px' }}>
              <span className="dot pulse-live" />LIVE
            </span>
          </div>
        )}

        {/* 하단 그라데이션 */}
        <div
          className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%)' }}
          aria-hidden="true"
        />

        {/* pitch 없을 때 — 시설 태그 오버레이 (하단): 단일 칩 한 줄 + ·구분 + 잘림 */}
        {!hasPitch && facilityLabels.length > 0 && (
          <div className="absolute bottom-1.5 left-2 right-2 flex">
            <span
              className="text-[9px] font-bold rounded-full px-1.5 py-0.5 inline-flex items-center max-w-full overflow-hidden"
              style={{
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {facilityLabels
                .map((f) => `${FACILITY_ICON[f] ?? ''}${f}`)
                .join(' · ')}
            </span>
          </div>
        )}
      </div>

      {/* 하단 정보 */}
      <div className="px-2.5 pt-2 pb-2">
        <div className="text-[13px] font-bold truncate leading-tight" style={{ color: 'var(--text-1)' }}>{st.name}</div>

        {/* pitch 인용 — 핑크 그라데이션 배경 */}
        {hasPitch && (
          <div
            className="mt-1.5 rounded-lg px-2 py-1.5 flex items-start gap-1"
            style={{
              background: 'linear-gradient(90deg, rgba(255,31,143,0.09) 0%, rgba(255,107,170,0.06) 100%)',
              border: '1px solid rgba(255,31,143,0.15)',
            }}
          >
            <span style={{ fontSize: 11, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>💬</span>
            <span
              className="text-[11px] font-semibold italic leading-snug line-clamp-2"
              style={{ color: '#D4176C' }}
            >
              {st.pitch}
            </span>
          </div>
        )}

        {/* pitch 없을 때 — 평점 또는 주소 대체 */}
        {!hasPitch && (
          <>
            {(st.reviewCount ?? 0) > 0
              ? <div className="mt-1"><RatingChip rating={st.averageRating} count={st.reviewCount} size="sm" /></div>
              : live > 0
                ? (
                  <div className="mt-1 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 pulse-live" style={{ background: 'var(--live)' }} />
                    <span className="text-[10px] font-bold" style={{ color: 'var(--live)' }}>지금 LIVE 운영 중</span>
                  </div>
                )
                : st.address && (
                  <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
                    {st.address.split(' ').slice(1, 3).join(' ')}
                  </div>
                )
            }
          </>
        )}
      </div>
    </Link>
  );
}

function NearbyStoreListRow({ store: st, live, rank }: { store: NearbyStore; live: number; rank: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'find-nearby-list'); }, [st.id]);
  const hasPitch = !!(st.pitch?.trim());
  const facilityLabels = (st.facilities ?? []).slice(0, 3);

  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="flex items-start gap-3 px-4 py-3 transition active:bg-gray-50 tap"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {/* 순위 */}
      <span className="w-6 text-center text-[13px] font-extrabold flex-shrink-0 stat-number mt-0.5" style={{ color: rank <= 3 ? 'var(--brand)' : 'var(--text-3)' }}>{rank}</span>

      {/* 썸네일 */}
      <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden relative" style={{ background: 'var(--surface-2)' }}>
        {st.photoUrl
          ? <Image src={st.photoUrl} alt={st.name} fill className="object-cover" sizes="48px" />
          : <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}><span className="text-[14px] font-extrabold" style={{ color: 'var(--brand)', opacity: 0.5 }}>{st.name.charAt(0)}</span></div>
        }
        {live > 0 && (
          <span className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full pulse-live border border-white" style={{ background: 'var(--live)' }} aria-label="LIVE 중" />
        )}
      </div>

      {/* 텍스트 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</span>
          {live > 0 && <span className="badge-live flex-shrink-0"><span className="dot" />LIVE</span>}
        </div>

        {/* pitch */}
        {hasPitch ? (
          <div className="mt-1 flex items-center gap-1">
            <span style={{ fontSize: 11 }}>💬</span>
            <span className="text-[11px] font-semibold italic truncate" style={{ color: '#D4176C' }}>{st.pitch}</span>
          </div>
        ) : (
          <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
            {st.distance != null && <span className="font-semibold stat-number" style={{ color: 'var(--text-2)' }}>{formatDistance(st.distance)} · </span>}
            {st.address ? st.address.split(' ').slice(1, 3).join(' ') : ''}
          </div>
        )}

        {/* 거리 (pitch 있을 때도 거리는 별도 표시) */}
        {hasPitch && st.distance != null && (
          <div className="text-[11px] mt-0.5 stat-number" style={{ color: 'var(--text-3)' }}>
            {formatDistance(st.distance)}
          </div>
        )}

        {/* 평점 */}
        {(st.reviewCount ?? 0) > 0 && <div className="mt-0.5"><RatingChip rating={st.averageRating} count={st.reviewCount} size="sm" /></div>}

        {/* 시설 태그 — pitch 없고 평점도 없을 때 */}
        {!hasPitch && (st.reviewCount ?? 0) === 0 && facilityLabels.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {facilityLabels.map((f) => (
              <span key={f} className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                {FACILITY_ICON[f] ?? ''} {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 우측 */}
      {live > 0 ? null : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
      )}
    </Link>
  );
}

// ─── LIVE 서브 컴포넌트 ───────────────────────────────────────

function LiveHeroCard({ group, thumbnail }: { group: StoreGroup; thumbnail?: string }) {
  const primary = group.sessions[0];
  const count = group.sessions.length;
  const poster = posterStyleFor(primary.posterStyle);
  const totalPlayers = group.sessions.reduce((s, x) => s + (x.playersRemaining || 0), 0);
  useEffect(() => { trackImpressionOnce(group.storeId, 'find-live'); }, [group.storeId]);
  return (
    <Link href={`/m/store/${group.storeId}`} onClick={() => bumpStoreMetric(group.storeId, 'cardClicks')} className="w-[220px] flex-shrink-0 overflow-hidden card-hover hero-dark-card lift tap" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.22), 0 1px 6px rgba(229,62,62,0.18)' }}>
      <div className="relative overflow-hidden" style={{ aspectRatio: '16/9', background: poster.bg }}>
        {thumbnail ? (
          <>
            <Image src={thumbnail} alt={group.storeName} fill className="object-cover" sizes="220px" />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.70) 100%)' }} />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #1A0A1E 0%, #0D1117 100%)' }}>
            <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            </div>
          </div>
        )}
        <div className="absolute top-3 left-3 z-10">
          <span className="badge-live" style={{ fontSize: 11, padding: '4px 10px' }}><span className="dot" />LIVE{count > 1 ? ` ${count}` : ''}</span>
        </div>
        {totalPlayers > 0 && (
          <div className="absolute top-3 right-3 z-10">
            <div className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)' }}>
              <span className="stat-number" style={{ color: 'var(--brand)' }}>{totalPlayers}</span><span> 명 진행</span>
            </div>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
          <div className="text-[13px] font-extrabold text-white leading-snug" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.60)' }}>{primary.tournamentName}</div>
          {primary.buyIn > 0 && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.60)' }}>바이인</span>
              <span className="stat-number text-[12px] font-extrabold" style={{ color: '#F59E0B' }}>₩{primary.buyIn.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
      <div className="px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[12px] font-bold truncate text-white flex-1 min-w-0">{group.storeName}</div>
          <CountdownPill session={primary} />
        </div>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.65)' }}>
          <span className="font-bold"><span style={{ color: 'rgba(255,255,255,0.45)' }}>Lv </span><span className="font-mono font-extrabold text-white">{primary.currentLevel}</span></span>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
          <span className="font-mono font-bold tracking-tight"><span className="text-white">{primary.smallBlind}/{primary.bigBlind}</span></span>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
          <span className="font-bold"><span className="font-mono font-extrabold text-white">{primary.playersRemaining}</span><span style={{ color: 'rgba(255,255,255,0.45)' }}>명</span></span>
        </div>
      </div>
    </Link>
  );
}

function LiveEmptyState() {
  return (
    <div className="mx-4">
      <div
        style={{
          borderRadius: 18,
          padding: '22px 18px',
          background: 'linear-gradient(135deg, var(--surface-1), var(--brand-pale))',
          border: '1px dashed rgba(255,31,143,0.30)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {/* Ripple pulse ring (핸드오프 패턴) */}
        <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: 99, background: 'rgba(255,31,143,0.12)', animation: 'findPulseRing 2s ease-out infinite' }} />
          <span style={{ position: 'absolute', inset: 8, borderRadius: 99, background: 'rgba(255,31,143,0.18)', animation: 'findPulseRing 2s ease-out infinite', animationDelay: '0.5s' }} />
          <div style={{ position: 'absolute', inset: 16, borderRadius: 99, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" fill="#fff" stroke="none"/>
              <path d="M16.5 7.5a6.5 6.5 0 010 9M7.5 7.5a6.5 6.5 0 000 9"/>
            </svg>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.015em', color: 'var(--text-1)' }}>현재 진행 중인 LIVE 없음</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>주변 홀덤펍 지도로 탐색해보세요</div>
          <button
            onClick={() => window.location.href = '/m/find?mode=map'}
            className="tap"
            style={{
              marginTop: 10, padding: '7px 14px', borderRadius: 99,
              fontSize: 11, fontWeight: 800,
              background: 'var(--bg)', color: 'var(--brand)',
              border: '1px solid rgba(255,31,143,0.25)',
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            지도로 탐색
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function CountdownPill({ session }: { session: LiveSession }) {
  const sec = useLiveCountdown(session);
  const paused = session.status === 'paused';
  return (
    <div className="flex-shrink-0 rounded-full px-2.5 py-1 ml-1.5" style={{ background: paused ? 'rgba(245,158,11,0.15)' : 'rgba(229,62,62,0.15)', border: `1px solid ${paused ? 'rgba(245,158,11,0.30)' : 'rgba(229,62,62,0.30)'}` }}>
      <span className="font-mono text-[11px] font-extrabold stat-number" style={{ color: paused ? '#F59E0B' : '#FC8181' }}>{fmtTime(sec)}</span>
    </div>
  );
}

function LiveHeroSkeleton() {
  return (
    <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-1">
      {[0, 1].map((i) => (
        <div key={i} className="w-[220px] flex-shrink-0 rounded-3xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <div className="skeleton" style={{ aspectRatio: '16/9' }} />
          <div className="p-3.5 space-y-2" style={{ background: 'var(--surface-2)' }}>
            <div className="skeleton h-4 w-3/4 rounded" />
            <div className="skeleton h-3 w-1/2 rounded" />
          </div>
        </div>
      ))}
      <div className="w-3 flex-shrink-0" aria-hidden="true" />
    </div>
  );
}

// ─── 시리즈 포스터 카드 ───────────────────────────────────────

function SeriesPosterCard({ series }: { series: Series }) {
  const poster = posterStyleFor(series.posterStyle);
  const dDays = series.finalDate
    ? Math.ceil((series.finalDate.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const statusLabel = series.status === 'active' ? '진행 중' : series.status === 'upcoming' ? '예정' : '종료';
  const statusBg = series.status === 'active' ? 'var(--live)' : series.status === 'upcoming' ? 'var(--brand)' : 'var(--text-3)';
  return (
    <Link href={`/m/series/${series.id}`} className="w-[220px] flex-shrink-0 rounded-2xl overflow-hidden card-hover lift tap" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
      <div className="h-[120px] relative" style={{ background: poster.bg, color: poster.color }}>
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
          <span className="text-[10px] font-extrabold rounded-full px-2.5 py-1" style={{ background: statusBg, color: '#fff' }}>{statusLabel}</span>
          {dDays !== null && dDays > 0 && series.status !== 'completed' && (
            <span className="text-[10px] font-bold rounded-full px-2.5 py-1 stat-number" style={{ background: 'rgba(0,0,0,0.40)', color: '#fff' }}>D-{dDays}</span>
          )}
        </div>
        <div className="absolute bottom-3 left-3 right-3">
          <div className="text-[16px] font-extrabold leading-tight" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.40)' }}>{series.name}</div>
          {series.organizerId && <div className="text-[11px] mt-0.5 opacity-75">{series.organizerId}</div>}
        </div>
      </div>
      <div className="px-3 py-2.5">
        {series.description && <div className="text-[11px] leading-relaxed line-clamp-2" style={{ color: 'var(--text-2)' }}>{series.description}</div>}
      </div>
    </Link>
  );
}
