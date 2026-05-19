'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession, fmtTime, useLiveCountdown } from '@/lib/live';
import { subscribeAllSeries, type Series } from '@/lib/series';
import { posterStyleFor } from '@/lib/templates';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { haversineMeters, formatDistance, type LatLng } from '@/lib/geo';
import { loadPopularStores, loadRecentlyJoinedStores, type PopularityStore } from '@/lib/popularity';
import { useAuth } from '@/lib/hooks';
import { coordToRegionLabel } from '@/lib/kakao';
import { loadKakaoMaps, geocodeAddress, DEFAULT_CENTER } from '@/lib/kakao';
import {
  loadActivePostsAll,
  subscribeActivePinnedPosts,
  type StorePost,
  type PinnedPost,
} from '@/lib/posts';
import { RatingChip } from '@/components/mobile/RatingChip';
import StoreFindModeToggle from '@/components/mobile/find/StoreFindModeToggle';

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

const NEARBY_RADIUS_STEPS_KM = [20, 40, 60, 80, 100] as const;
const NEARBY_RADIUS_INITIAL_KM = 20;
const NEARBY_RADIUS_MAX_KM = 100;
const NEARBY_LIST_INITIAL_COUNT = 8;
const HOME_POSTS_LIMIT = 15;
const PINNED_ROTATE_MS = 3000;
const MAP_NEARBY_RADIUS_M = 10_000;

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeParam = searchParams.get('mode');
  const mode: 'list' | 'map' = modeParam === 'map' ? 'map' : 'list';

  const handleToggle = (m: 'list' | 'map') => {
    if (m === 'map') {
      router.replace('/m/find?mode=map');
    } else {
      router.replace('/m/find');
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
        <MapMode />
      ) : (
        <ListMode />
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
        background: 'rgba(255,255,255,0.94)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="px-4 h-14 flex items-center justify-between gap-3">
        <div className="text-[18px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          매장찾기
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/m/search"
            aria-label="검색"
            className="w-10 h-10 flex items-center justify-center rounded-full transition active:bg-[var(--surface-2)]"
          >
            <svg
              width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="var(--text-1)"
              strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </Link>
        </div>
      </div>
    </header>
  );
}

// ═══════════════════════════════════════════════════════════════
// 리스트 모드 — 기존 /m/page.tsx 매장 허브 콘텐츠 전부 이전
// ═══════════════════════════════════════════════════════════════

function ListMode() {
  const authState = useAuth();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [storeSummaries, setStoreSummaries] = useState<Record<string, StoreSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      {/* 위치 표시 바 */}
      <div
        className="px-4 py-2.5 flex items-center gap-1.5"
        style={{ background: 'var(--bg-sub)', borderBottom: '1px solid var(--border)' }}
      >
        <svg
          width="11" height="11" viewBox="0 0 24 24"
          fill="none" stroke="var(--brand)" strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>
          {regionLabel ?? '위치 확인 중'}
        </span>
        {displayName && (
          <span className="ml-auto text-[11px]" style={{ color: 'var(--text-3)' }}>
            {displayName}님
          </span>
        )}
      </div>

      {/* ─ 빠른 메뉴 (5 카테고리 아이콘) */}
      <CategoryIconGrid />

      <div className="brand-strip-divider" />

      {/* ─ 오늘의 매장 소식 */}
      <DailyPostsFeed />

      <div className="brand-strip-divider" />

      {/* ─ LIVE 중인 매장 */}
      <section aria-label="지금 LIVE" className="pt-5">
        <div className="px-4 flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 pulse-live"
              style={{ background: 'var(--live)' }}
              aria-hidden="true"
            />
            <span className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
              지금 LIVE
            </span>
            {groups.length > 0 && (
              <span
                className="text-[11px] font-extrabold rounded-full px-2 py-0.5 stat-number"
                style={{ background: 'var(--live)', color: '#fff' }}
              >
                {groups.length}
              </span>
            )}
          </div>
          <Link
            href="/m/live"
            className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60"
            style={{ color: 'var(--brand)' }}
          >
            전체보기
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
          </Link>
        </div>
        {loading ? (
          <LiveHeroSkeleton />
        ) : error ? (
          <div className="mx-4 rounded-2xl p-4 text-sm" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: 'var(--live)' }}>
            {error}
          </div>
        ) : groups.length === 0 ? (
          <LiveEmptyState />
        ) : (
          <div className="pl-4 flex gap-3 overflow-x-auto pb-1 scrollbar-none">
            {groups.map((g) => (
              <LiveHeroCard
                key={g.storeId}
                group={g}
                thumbnail={storeSummaries[g.storeId]?.thumbnail}
              />
            ))}
            <div className="w-3 flex-shrink-0" aria-hidden="true" />
          </div>
        )}
      </section>

      <div className="brand-strip-divider mt-5" />

      {/* ─ 인기 매장 */}
      <PopularStoresAvatarScroll liveByStore={liveByStore} />

      <div className="brand-strip-divider" />

      {/* ─ 새로 합류한 매장 */}
      <NewlyJoinedStoresSection liveByStore={liveByStore} />

      <div className="brand-strip-divider" />

      {/* ─ 내 주변 매장 */}
      <NearbyStoresSection liveByStore={liveByStore} />

      {/* ─ 메이저 시리즈 */}
      {series.length > 0 && (
        <>
          <div className="brand-strip-divider mt-5" />
          <section aria-label="메이저 시리즈" className="pb-6">
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
        HoldemNow BETA · 부산/경남 홀덤펍 디스커버리
      </div>
    </div>
  );
}

// ─── 카테고리 아이콘 그리드 (5개) ────────────────────────────

function CategoryIconGrid() {
  return (
    <section aria-label="빠른 메뉴" className="px-4 py-5">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id="fc-cardFace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="55%" stopColor="#FFF4F9" />
            <stop offset="100%" stopColor="#FFD9EA" />
          </linearGradient>
          <linearGradient id="fc-suitDark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5A0830" />
            <stop offset="100%" stopColor="#2E0418" />
          </linearGradient>
          <linearGradient id="fc-suitRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFE2E2" />
            <stop offset="60%" stopColor="#FF4848" />
            <stop offset="100%" stopColor="#7A0808" />
          </linearGradient>
          <linearGradient id="fc-goldFace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFF1B5" />
            <stop offset="45%" stopColor="#FFC845" />
            <stop offset="100%" stopColor="#A55F08" />
          </linearGradient>
          <radialGradient id="fc-chipRed" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#FFD0D0" />
            <stop offset="55%" stopColor="#E53E3E" />
            <stop offset="100%" stopColor="#5A0808" />
          </radialGradient>
          <linearGradient id="fc-beamLight" x1="0.5" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          <filter id="fc-innerShade" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.8" />
            <feOffset dx="0" dy="0.6" result="offsetblur" />
            <feFlood floodColor="#3A0218" floodOpacity="0.6" />
            <feComposite in2="offsetblur" operator="in" />
            <feComposite in2="SourceGraphic" operator="arithmetic" k2="-1" k3="1" />
          </filter>
          <filter id="fc-innerShadeGold" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.8" />
            <feOffset dx="0" dy="0.6" result="offsetblur" />
            <feFlood floodColor="#5C2F00" floodOpacity="0.55" />
            <feComposite in2="offsetblur" operator="in" />
            <feComposite in2="SourceGraphic" operator="arithmetic" k2="-1" k3="1" />
          </filter>
        </defs>
      </svg>

      <div className="grid grid-cols-5 gap-1">
        {/* 1. 지도탐색 */}
        <button
          onClick={() => window.location.href = '/m/find?mode=map'}
          className="flex flex-col items-center gap-2 transition active:scale-95"
        >
          <div className="cat-icon-wrap">
            <svg width="32" height="36" viewBox="0 0 40 44" aria-hidden="true">
              <path d="M14 2 L26 2 L31 10 L9 10 Z" fill="url(#fc-beamLight)" opacity="0.55" />
              <rect x="9" y="14" width="22" height="28" rx="3.2" fill="#5A0830" opacity="0.45" transform="rotate(-6 20 28)" />
              <rect x="9" y="12" width="22" height="28" rx="3.2" fill="url(#fc-cardFace)" transform="rotate(-6 20 26)" />
              <rect x="9.5" y="12.5" width="21" height="27" rx="2.8" fill="none" stroke="#FFFFFF" strokeWidth="0.8" opacity="0.8" transform="rotate(-6 20 26)" />
              <g transform="rotate(-6 20 26)">
                <path d="M20 18 C16.4 22.8 14.2 24.4 14.2 27.2 C14.2 29.0 15.7 30.3 17.4 30.3 C18.4 30.3 19.2 29.9 19.6 29.2 C19.4 30.6 18.7 31.6 17.8 32.4 L22.2 32.4 C21.3 31.6 20.6 30.6 20.4 29.2 C20.8 29.9 21.6 30.3 22.6 30.3 C24.3 30.3 25.8 29.0 25.8 27.2 C25.8 24.4 23.6 22.8 20 18 Z" fill="url(#fc-suitDark)" filter="url(#fc-innerShade)" />
              </g>
              <circle cx="20" cy="5" r="1.4" fill="#FFFFFF" opacity="0.95" />
              <circle cx="20" cy="5" r="2.6" fill="#FFFFFF" opacity="0.35" />
            </svg>
          </div>
          <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>지도탐색</span>
        </button>

        {/* 2. LIVE */}
        <Link href="/m/live" className="flex flex-col items-center gap-2 transition active:scale-95">
          <div className="cat-icon-wrap cat-icon-wrap-live">
            <svg width="32" height="36" viewBox="0 0 40 44" aria-hidden="true">
              <ellipse cx="20" cy="38" rx="13" ry="2.6" fill="#3A0202" opacity="0.45" />
              <ellipse cx="20" cy="33" rx="11" ry="3.4" fill="url(#fc-chipRed)" />
              <path d="M9 33 L9 36 A11 3.4 0 0 0 31 36 L31 33 A11 3.4 0 0 1 9 33 Z" fill="#5A0808" opacity="0.85" />
              <ellipse cx="20" cy="27" rx="11" ry="3.4" fill="url(#fc-chipRed)" />
              <path d="M9 27 L9 30 A11 3.4 0 0 0 31 30 L31 27 A11 3.4 0 0 1 9 27 Z" fill="#7A0A0A" opacity="0.7" />
              <ellipse cx="20" cy="21" rx="11" ry="3.4" fill="url(#fc-chipRed)" />
              <g transform="translate(20 21)">
                <rect x="-7" y="-0.6" width="14" height="1.2" rx="0.5" fill="#FFFFFF" opacity="0.85" />
                <rect x="-0.6" y="-2.4" width="1.2" height="4.8" rx="0.5" fill="#FFFFFF" opacity="0.85" />
                <circle cx="0" cy="0" r="2" fill="#FF6464" stroke="#FFFFFF" strokeWidth="0.6" />
              </g>
              <ellipse cx="17" cy="20" rx="5.5" ry="1.2" fill="#FFFFFF" opacity="0.55" />
              <path d="M20 4 L20 10" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
              <path d="M12 7 L15 11" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" opacity="0.65" />
              <path d="M28 7 L25 11" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" opacity="0.65" />
            </svg>
          </div>
          <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>LIVE</span>
        </Link>

        {/* 3. 토너먼트 */}
        <Link href="/m/calendar" className="flex flex-col items-center gap-2 transition active:scale-95">
          <div className="cat-icon-wrap">
            <svg width="32" height="36" viewBox="0 0 40 44" aria-hidden="true">
              <rect x="11" y="13" width="20" height="26" rx="3" fill="#7A0840" opacity="0.55" transform="rotate(8 21 26)" />
              <rect x="11" y="11" width="20" height="26" rx="3" fill="url(#fc-cardFace)" transform="rotate(8 21 24)" />
              <rect x="8" y="14" width="20" height="26" rx="3" fill="#5A0830" opacity="0.5" transform="rotate(-8 18 27)" />
              <rect x="8" y="12" width="20" height="26" rx="3" fill="url(#fc-cardFace)" transform="rotate(-8 18 25)" />
              <rect x="8.5" y="12.5" width="19" height="25" rx="2.6" fill="none" stroke="#FFFFFF" strokeWidth="0.8" opacity="0.85" transform="rotate(-8 18 25)" />
              <g transform="rotate(-8 18 25)">
                <path d="M18 18 L24 25 L18 32 L12 25 Z" fill="url(#fc-suitDark)" filter="url(#fc-innerShade)" />
              </g>
              <circle cx="32" cy="10" r="5" fill="#FFFFFF" stroke="#7A0840" strokeWidth="0.8" />
              <path d="M32 10 L32 7 M32 10 L34 11" stroke="#7A0840" strokeWidth="1.1" strokeLinecap="round" />
              <circle cx="32" cy="10" r="0.7" fill="#7A0840" />
            </svg>
          </div>
          <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>토너먼트</span>
        </Link>

        {/* 4. 대회정보 */}
        <Link href="/m/events" className="flex flex-col items-center gap-2 transition active:scale-95">
          <div className="cat-icon-wrap">
            <svg width="32" height="36" viewBox="0 0 40 44" aria-hidden="true">
              <ellipse cx="20" cy="38" rx="10" ry="2" fill="#5C2F00" opacity="0.5" />
              <g transform="translate(20 30)">
                <circle cx="0" cy="-3" r="3.2" fill="url(#fc-suitDark)" filter="url(#fc-innerShade)" />
                <circle cx="-3.4" cy="0.5" r="3.2" fill="url(#fc-suitDark)" filter="url(#fc-innerShade)" />
                <circle cx="3.4" cy="0.5" r="3.2" fill="url(#fc-suitDark)" filter="url(#fc-innerShade)" />
                <path d="M-1.2 1.5 L0 5.5 L1.2 1.5 Z" fill="url(#fc-suitDark)" />
              </g>
              <path d="M9 13 L12 20 L16 14 L20 21 L24 14 L28 20 L31 13 L30 24 L10 24 Z" fill="url(#fc-goldFace)" filter="url(#fc-innerShadeGold)" />
              <circle cx="20" cy="17" r="1.6" fill="#FF1F8F" />
              <rect x="9" y="22" width="22" height="3" rx="0.6" fill="url(#fc-goldFace)" />
            </svg>
          </div>
          <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>대회정보</span>
        </Link>

        {/* 5. 커뮤니티 */}
        <Link href="/m/community" className="flex flex-col items-center gap-2 transition active:scale-95">
          <div className="cat-icon-wrap">
            <svg width="32" height="36" viewBox="0 0 40 44" aria-hidden="true">
              <path d="M20 8 C28 8 32 12 32 17 C32 22 28 26 20 26 C18 26 16.5 25.8 15 25.3 L10 28 L11.5 23.5 C9 22 8 19.5 8 17 C8 12 12 8 20 8 Z" fill="#FFFFFF" opacity="0.97" />
              <g transform="rotate(10 24 17)">
                <rect x="20" y="11" width="8" height="11" rx="1.2" fill="url(#fc-cardFace)" />
                <path d="M24 14 C22.4 15.8 21.6 16.4 21.6 17.4 C21.6 18.0 22.1 18.4 22.7 18.4 C23.0 18.4 23.3 18.3 23.5 18.0 C23.4 18.5 23.1 18.9 22.8 19.2 L25.2 19.2 C24.9 18.9 24.6 18.5 24.5 18.0 C24.7 18.3 25.0 18.4 25.3 18.4 C25.9 18.4 26.4 18.0 26.4 17.4 C26.4 16.4 25.6 15.8 24 14 Z" fill="url(#fc-suitDark)" />
              </g>
              <g transform="rotate(-12 16 18)">
                <rect x="12" y="12" width="8" height="11" rx="1.2" fill="url(#fc-cardFace)" />
                <path d="M16 20 C16 20 12.8 18.4 12.8 16.4 C12.8 15.4 13.6 14.6 14.6 14.6 C15.3 14.6 15.8 15.0 16 15.5 C16.2 15.0 16.7 14.6 17.4 14.6 C18.4 14.6 19.2 15.4 19.2 16.4 C19.2 18.4 16 20 16 20 Z" fill="url(#fc-suitRed)" />
              </g>
              <ellipse cx="32" cy="34" rx="4.5" ry="3.5" fill="#FFFFFF" opacity="0.92" />
              <circle cx="30" cy="34" r="0.7" fill="#FF1F8F" />
              <circle cx="32" cy="34" r="0.7" fill="#FF1F8F" />
              <circle cx="34" cy="34" r="0.7" fill="#FF1F8F" />
            </svg>
          </div>
          <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>커뮤니티</span>
        </Link>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// 지도 모드 — 기존 /m/discover/page.tsx 콘텐츠 인라인 통합
// 카카오맵 SDK는 이 컴포넌트 마운트 시에만 로드됨
// ═══════════════════════════════════════════════════════════════

function MapMode() {
  const router = useRouter();
  const [stores, setStores] = useState<MapStoreSummary[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationDenied(true); return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationDenied(true),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

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
        <KakaoMap
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
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20 px-8 text-center" style={{ background: 'var(--bg-sub)' }}>
            <div className="text-4xl mb-3" aria-hidden="true">🗺️</div>
            <div className="text-[15px] font-bold mb-2" style={{ color: 'var(--text-1)' }}>지도가 일시적으로 표시되지 않습니다</div>
            <div className="text-[12px] leading-relaxed mb-5" style={{ color: 'var(--text-3)' }}>매장 목록은 정상 사용 가능합니다.</div>
            <button onClick={() => setSheetOpen(true)} className="px-5 h-11 rounded-2xl text-[13px] font-extrabold text-white" style={{ background: 'var(--brand)' }}>
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
            <div className="w-[60px] h-[60px] rounded-xl flex-shrink-0 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              {selected.photoUrl && <img src={selected.photoUrl} alt={selected.name} className="w-full h-full object-cover" />}
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

// ─── 카카오 지도 컴포넌트 ─────────────────────────────────────

function KakaoMap({
  stores, liveCountByStore, selectedId, onSelect, onError, userLocation, locationDenied, mapInstanceRef,
}: {
  stores: MapStoreSummary[];
  liveCountByStore: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onError: (msg: string | null) => void;
  userLocation: LatLng | null;
  locationDenied: boolean;
  mapInstanceRef: React.MutableRefObject<any>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const normalMarkersRef = useRef<Map<string, any>>(new Map());
  const liveMarkersRef = useRef<Map<string, any>>(new Map());
  const clustererRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!userLocation && !locationDenied) return;
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadKakaoMaps();
        if (cancelled || !containerRef.current || mapInstanceRef.current) return;
        const center = userLocation
          ? new maps.LatLng(userLocation.lat, userLocation.lng)
          : new maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
        mapInstanceRef.current = new maps.Map(containerRef.current, { center, level: 4 });
        if (maps.MarkerClusterer) {
          clustererRef.current = new maps.MarkerClusterer({
            map: mapInstanceRef.current,
            averageCenter: true, minLevel: 6, gridSize: 80,
            disableClickZoom: false, calculator: [10, 30, 100, 300],
            styles: clusterStyles(),
          });
        }
        setMapReady(true);
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [onError, userLocation, locationDenied, mapInstanceRef]);

  useEffect(() => {
    if (!mapReady || !userLocation || !mapInstanceRef.current) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!maps) return;
    const pos = new maps.LatLng(userLocation.lat, userLocation.lng);
    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition(pos);
    } else {
      userMarkerRef.current = new maps.Marker({ position: pos, map: mapInstanceRef.current, image: buildUserMarker(maps), zIndex: 30 });
    }
    const initialRadius = radiusForZoomLevel(mapInstanceRef.current.getLevel());
    if (radiusCircleRef.current) {
      radiusCircleRef.current.setPosition(pos);
      radiusCircleRef.current.setRadius(initialRadius);
    } else {
      radiusCircleRef.current = new maps.Circle({
        center: pos, radius: initialRadius,
        strokeWeight: 2, strokeColor: '#FF1F8F', strokeOpacity: 0.5, strokeStyle: 'solid',
        fillColor: '#FF1F8F', fillOpacity: 0.08,
      });
      radiusCircleRef.current.setMap(mapInstanceRef.current);
    }
  }, [mapReady, userLocation, mapInstanceRef]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!maps) return;
    const map = mapInstanceRef.current;
    const onZoom = () => { if (!radiusCircleRef.current) return; radiusCircleRef.current.setRadius(radiusForZoomLevel(map.getLevel())); };
    maps.event.addListener(map, 'zoom_changed', onZoom);
    return () => { maps.event.removeListener(map, 'zoom_changed', onZoom); };
  }, [mapReady]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!maps) return;
    const clusterer = clustererRef.current;
    const validStores = stores.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
    const seenNormal = new Set<string>();
    const seenLive = new Set<string>();
    const newClusterMarkers: any[] = [];

    for (const s of validStores) {
      const live = liveCountByStore[s.id] || 0;
      const isSelected = s.id === selectedId;
      const pos = new maps.LatLng(s.lat!, s.lng!);
      const image = getMarkerImage(maps, { name: s.name, live, selected: isSelected });
      if (live > 0) {
        seenLive.add(s.id);
        const wasNormal = normalMarkersRef.current.get(s.id);
        if (wasNormal) { if (clusterer) clusterer.removeMarker(wasNormal); else wasNormal.setMap(null); normalMarkersRef.current.delete(s.id); }
        const existing = liveMarkersRef.current.get(s.id);
        if (existing) { existing.setPosition(pos); existing.setImage(image); }
        else {
          const marker = new maps.Marker({ position: pos, map: mapInstanceRef.current, title: s.name, image, zIndex: 25 });
          maps.event.addListener(marker, 'click', () => onSelect(s.id));
          liveMarkersRef.current.set(s.id, marker);
        }
      } else {
        seenNormal.add(s.id);
        const wasLive = liveMarkersRef.current.get(s.id);
        if (wasLive) { wasLive.setMap(null); liveMarkersRef.current.delete(s.id); }
        const existing = normalMarkersRef.current.get(s.id);
        if (existing) { existing.setPosition(pos); existing.setImage(image); }
        else {
          const marker = new maps.Marker({ position: pos, map: clusterer ? undefined : mapInstanceRef.current, title: s.name, image, zIndex: isSelected ? 20 : 10 });
          maps.event.addListener(marker, 'click', () => onSelect(s.id));
          normalMarkersRef.current.set(s.id, marker);
          if (clusterer) newClusterMarkers.push(marker);
        }
      }
    }
    if (clusterer && newClusterMarkers.length > 0) clusterer.addMarkers(newClusterMarkers);
    for (const [id, m] of normalMarkersRef.current) { if (!seenNormal.has(id)) { if (clusterer) clusterer.removeMarker(m); else m.setMap(null); normalMarkersRef.current.delete(id); } }
    for (const [id, m] of liveMarkersRef.current) { if (!seenLive.has(id)) { m.setMap(null); liveMarkersRef.current.delete(id); } }
  }, [stores, liveCountByStore, selectedId, onSelect, mapInstanceRef]);

  return <div ref={containerRef} className="w-full h-full" />;
}

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
                <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                  {s.photoUrl && <img src={s.photoUrl} alt={s.name} className="w-full h-full object-cover" />}
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

// ─── 마커 유틸 (지도용) ───────────────────────────────────────

const _markerImageCache = new Map<string, any>();
function getMarkerImage(maps: any, opts: { name: string; live: number; selected: boolean }) {
  const key = `${opts.live}|${opts.selected ? 's' : ''}|${opts.name}`;
  const cached = _markerImageCache.get(key);
  if (cached) return cached;
  const img = buildMarkerImage(maps, opts);
  _markerImageCache.set(key, img);
  return img;
}

function buildMarkerImage(maps: any, opts: { name: string; live: number; selected: boolean }) {
  const { name, live, selected } = opts;
  const PILL_H = 26, TAIL_H = 7, height = PILL_H + TAIL_H;
  const nameW = widthOf(name);
  const safeName = escapeSvg(name);
  if (live > 0) {
    const liveLabel = live > 1 ? `LIVE ${live}` : 'LIVE';
    const liveLabelW = liveLabel.length * 6;
    const RIPPLE_PAD = 10, LEFT = 8, DOT = 6, G1 = 5, G2 = 8, RIGHT = 12;
    const pillWidth = LEFT + DOT + G1 + liveLabelW + G2 + nameW + RIGHT;
    const totalH = RIPPLE_PAD + PILL_H + TAIL_H, cx = pillWidth / 2;
    const dotX = LEFT + DOT / 2, liveX = LEFT + DOT + G1, nameX = liveX + liveLabelW + G2;
    const fill = '#E53E3E', stroke = selected ? '#7F1D1D' : '#C53030', sw = selected ? 2 : 1;
    const rDotCx = dotX, rDotCy = RIPPLE_PAD + PILL_H / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillWidth}" height="${totalH}" viewBox="0 0 ${pillWidth} ${totalH}"><circle cx="${rDotCx}" cy="${rDotCy}" r="3" fill="#E53E3E" opacity="0.6"><animate attributeName="r" values="4;14;4" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.55;0;0.55" dur="1.6s" repeatCount="indefinite"/></circle><rect x="0.5" y="${RIPPLE_PAD + 0.5}" width="${pillWidth-1}" height="${PILL_H-1}" rx="${PILL_H/2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/><circle cx="${dotX}" cy="${RIPPLE_PAD + PILL_H/2}" r="${DOT/2}" fill="#fff"/><text x="${liveX}" y="${RIPPLE_PAD + PILL_H/2+4}" fill="#fff" font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="800">${liveLabel}</text><text x="${nameX}" y="${RIPPLE_PAD + PILL_H/2+5}" fill="#fff" font-family="Pretendard,Inter,system-ui,sans-serif" font-size="12" font-weight="800">${safeName}</text><polygon points="${cx-6},${RIPPLE_PAD+PILL_H} ${cx+6},${RIPPLE_PAD+PILL_H} ${cx},${RIPPLE_PAD+PILL_H+TAIL_H}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
    const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    return new maps.MarkerImage(url, new maps.Size(pillWidth, totalH), { offset: new maps.Point(cx, totalH) });
  }
  const PAD = 14, width = nameW + PAD * 2, cx = width / 2;
  const fill = selected ? '#FF1F8F' : '#FFFFFF', textColor = selected ? '#fff' : '#111827';
  const stroke = selected ? '#CC1072' : '#E5E7EB', sw = selected ? 2 : 1.5;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><filter id="s"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.12"/></filter><rect x="0.5" y="0.5" width="${width-1}" height="${PILL_H-1}" rx="${PILL_H/2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" filter="url(#s)"/><text x="${cx}" y="${PILL_H/2+5}" fill="${textColor}" font-family="Pretendard,Inter,system-ui,sans-serif" font-size="12" font-weight="800" text-anchor="middle">${safeName}</text><polygon points="${cx-6},${PILL_H} ${cx+6},${PILL_H} ${cx},${PILL_H+TAIL_H}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(width, height), { offset: new maps.Point(cx, height) });
}

function widthOf(s: string) { return Array.from(s).reduce((sum, ch) => sum + (/[\x00-\x7F]/.test(ch) ? 7 : 12), 0); }
function escapeSvg(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function clusterStyles() {
  const base = { color: '#FF1F8F', textAlign: 'center' as const, fontWeight: '800' as const, fontFamily: 'Inter,system-ui,sans-serif', border: '2px solid #FF1F8F', background: '#FFFFFF', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' };
  return [
    { ...base, width: '36px', height: '36px', borderRadius: '18px', lineHeight: '32px', fontSize: '12px' },
    { ...base, width: '44px', height: '44px', borderRadius: '22px', lineHeight: '40px', fontSize: '13px' },
    { ...base, width: '52px', height: '52px', borderRadius: '26px', lineHeight: '48px', fontSize: '14px' },
    { ...base, width: '60px', height: '60px', borderRadius: '30px', lineHeight: '56px', fontSize: '15px' },
    { ...base, width: '72px', height: '72px', borderRadius: '36px', lineHeight: '68px', fontSize: '16px' },
  ];
}

function buildUserMarker(maps: any) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="#FF1F8F" opacity="0.12"><animate attributeName="r" values="10;16;10" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.22;0.04;0.22" dur="2s" repeatCount="indefinite"/></circle><circle cx="18" cy="18" r="7" fill="#fff" filter="drop-shadow(0 1px 3px rgba(0,0,0,0.20))"/><circle cx="18" cy="18" r="5" fill="#FF1F8F"/></svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(36, 36), { offset: new maps.Point(18, 18) });
}

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
    <section aria-label="오늘의 매장 소식" className="py-5">
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
            <span>오늘의 매장 소식</span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>매장이 직접 올린 24시간 한정 소식</div>
        </div>
      </div>
      {pinned.length > 0 && <div className="px-4 mb-4"><PinnedCarousel items={pinned} /></div>}
      {posts.length > 0 && (
        <ul role="list" className="pl-4 flex gap-2.5 overflow-x-auto scrollbar-none pb-2" aria-label="매장 데일리 소식 리스트">
          {posts.map((p) => <li role="listitem" key={p.id} className="flex-shrink-0"><StorePostMiniCard post={p} /></li>)}
          <li aria-hidden="true" className="w-3 flex-shrink-0" />
        </ul>
      )}
    </section>
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
  const openLink = () => post.ctaUrl && window.open(post.ctaUrl, '_blank', 'noopener,noreferrer');
  return (
    <button onClick={openLink} disabled={!post.ctaUrl} className="w-full rounded-2xl overflow-hidden card-hover text-left block" style={{ background: 'var(--surface-1)', border: '1.5px solid var(--brand)', boxShadow: '0 2px 12px rgba(255,31,143,0.15)' }}>
      {photo && (
        <div className="relative w-full" style={{ aspectRatio: '21/9', background: 'var(--surface-2)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt={post.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
          <span className="absolute top-2 left-2 text-[10px] font-extrabold rounded-full px-2 py-0.5" style={{ background: 'var(--brand)', color: '#fff' }}>📌 본사 공지</span>
        </div>
      )}
      <div className="px-4 py-3">
        {!photo && <span className="inline-block text-[10px] font-extrabold rounded-full px-2 py-0.5 mb-2" style={{ background: 'var(--brand)', color: '#fff' }}>📌 본사 공지</span>}
        <div className="text-[15px] font-extrabold mb-1 line-clamp-2" style={{ color: 'var(--text-1)' }}>{post.title}</div>
        {post.body && <div className="text-[12px] line-clamp-2" style={{ color: 'var(--text-2)' }}>{post.body}</div>}
        {post.ctaLabel && <div className="text-[13px] font-bold mt-2" style={{ color: 'var(--brand)' }}>{post.ctaLabel} ›</div>}
      </div>
    </button>
  );
}

function StorePostMiniCard({ post }: { post: StorePost }) {
  const photo = post.imageUrls[0];
  const summary = post.body.split('\n').slice(0, 4).join('\n');
  return (
    <Link href={`/m/store/${post.storeId}`} onClick={() => bumpStoreMetric(post.storeId, 'cardClicks')} className="w-[200px] block rounded-2xl overflow-hidden card-hover" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
      {photo && (
        <div className="relative w-full" style={{ aspectRatio: '4/3', background: 'var(--surface-2)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
          {post.imageUrls.length > 1 && <span className="absolute bottom-2 right-2 text-[10px] font-bold rounded-full px-2 py-0.5 text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>+{post.imageUrls.length - 1}</span>}
        </div>
      )}
      <div className="px-3 py-2.5" style={{ minHeight: photo ? undefined : 100 }}>
        <div className="text-[12px] font-extrabold mb-1 truncate" style={{ color: 'var(--brand)' }}>{post.storeName ?? '매장'}</div>
        <div className="text-[11px] leading-relaxed whitespace-pre-wrap line-clamp-3" style={{ color: 'var(--text-2)' }}>{summary}</div>
        {post.eventTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {post.eventTags.slice(0, 2).map((t) => <span key={t} className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background: 'rgba(255,31,143,0.10)', color: 'var(--brand)' }}>#{t}</span>)}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── 인기 매장 아바타 스크롤 ──────────────────────────────────

function PopularStoresAvatarScroll({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<PopularityStore[]>([]);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [appliedRadiusKm, setAppliedRadiusKm] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setUserLocation(null); return; }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPopularStores(userLocation).then((res) => {
      if (cancelled) return;
      setStores(res.stores); setExpanded(res.expanded);
      setAppliedRadiusKm(res.appliedRadiusM > 0 ? Math.round(res.appliedRadiusM / 1000) : null);
      setLoaded(true);
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userLocation]);

  if (loaded && stores.length === 0) return null;

  return (
    <section aria-label="내 주변 인기 매장" className="py-5">
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>내 주변 인기 매장</div>
          {appliedRadiusKm != null && (
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {expanded ? `주변 매장이 적어 ${appliedRadiusKm}km까지 범위를 넓혔어요` : `반경 ${appliedRadiusKm}km · LIVE 운영 활발한 매장 우선`}
            </div>
          )}
        </div>
        <button onClick={() => window.location.href = '/m/find?mode=map'} className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60 mb-0.5" style={{ color: 'var(--brand)' }}>
          지도로 보기
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div className="pl-4 flex gap-4 overflow-x-auto scrollbar-none pb-1">
        {stores.map((st) => {
          const isLive = (liveByStore[st.id] || 0) > 0;
          const photo = st.photoUrls[0];
          return (
            <Link key={st.id} href={`/m/store/${st.id}`} onClick={() => bumpStoreMetric(st.id, 'cardClicks')} className="flex flex-col items-center gap-1.5 flex-shrink-0 transition active:scale-95" style={{ width: 64 }}>
              <div className={`store-avatar-ring${isLive ? ' live-ring' : ''}`} style={{ width: 60, height: 60, position: 'relative' }}>
                {photo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={photo} alt={st.name} className="w-full h-full object-cover" style={{ borderRadius: '50%' }} />
                  : <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)', borderRadius: '50%' }}><span className="text-[16px] font-extrabold" style={{ color: 'var(--brand)' }}>{st.name.charAt(0)}</span></div>
                }
                {isLive && <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white pulse-live" style={{ background: 'var(--live)' }} aria-label="LIVE 중" />}
              </div>
              <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)', width: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.name}</span>
            </Link>
          );
        })}
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>
    </section>
  );
}

// ─── 새로 합류한 매장 ─────────────────────────────────────────

function NewlyJoinedStoresSection({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<PopularityStore[]>([]);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setUserLocation(null); return; }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRecentlyJoinedStores(userLocation).then((list) => {
      if (cancelled) return; setStores(list); setLoaded(true);
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userLocation]);

  if (loaded && stores.length === 0) return null;

  return (
    <section aria-label="새로 합류한 매장" className="py-5">
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
            <span>새로 합류한 매장</span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>최근 30일 가입 · {userLocation ? '거리순' : '가입 최신순'}</div>
        </div>
      </div>
      <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
        {stores.map((st) => {
          const isLive = (liveByStore[st.id] || 0) > 0;
          const photo = st.photoUrls[0];
          return (
            <Link key={st.id} href={`/m/store/${st.id}`} onClick={() => bumpStoreMetric(st.id, 'cardClicks')} className="w-[140px] flex-shrink-0 rounded-2xl overflow-hidden card-hover" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
              <div className="relative overflow-hidden" style={{ aspectRatio: '1', background: 'var(--surface-2)' }}>
                {photo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={photo} alt={st.name} className="w-full h-full object-cover" />
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

// ─── 내 주변 매장 ─────────────────────────────────────────────

function NearbyStoresSection({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(NEARBY_RADIUS_INITIAL_KM);
  const [listExpanded, setListExpanded] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    getDocs(collection(db, 'stores')).then((snap) => {
      setStores(snap.docs.filter((d) => {
        const data = d.data() as { status?: string; isDemo?: boolean };
        return data.status === 'active' || data.isDemo === true;
      }).map((d) => {
        const data = d.data() as { name: string; address?: string; photoUrls?: string[]; facilities?: string[]; tier?: string; lat?: number; lng?: number; averageRating?: number; reviewCount?: number };
        return { id: d.id, name: data.name, address: data.address, photoUrl: data.photoUrls?.[0], facilities: data.facilities, tier: data.tier, lat: data.lat, lng: data.lng, averageRating: data.averageRating, reviewCount: data.reviewCount };
      }));
    });
  }, []);

  const sorted = useMemo(() => {
    return stores.map((s) => ({ ...s, distance: userLocation && typeof s.lat === 'number' && typeof s.lng === 'number' ? haversineMeters(userLocation, { lat: s.lat, lng: s.lng }) : undefined }))
      .sort((a, b) => { if (a.distance != null && b.distance != null) return a.distance - b.distance; if (a.distance != null) return -1; if (b.distance != null) return 1; return 0; });
  }, [stores, userLocation]);

  const visible = useMemo(() => {
    if (!userLocation) return sorted;
    const maxM = radiusKm * 1000;
    return sorted.filter((s) => s.distance != null && s.distance <= maxM);
  }, [sorted, userLocation, radiusKm]);

  const nextRadiusKm = userLocation ? NEARBY_RADIUS_STEPS_KM.find((r) => r > radiusKm) ?? null : null;
  const moreCount = useMemo(() => {
    if (!userLocation || nextRadiusKm == null) return 0;
    const nextMaxM = nextRadiusKm * 1000;
    return Math.max(0, sorted.filter((s) => s.distance != null && s.distance <= nextMaxM).length - visible.length);
  }, [sorted, userLocation, nextRadiusKm, visible.length]);

  const canExpand = nextRadiusKm != null && radiusKm < NEARBY_RADIUS_MAX_KM;

  if (stores.length === 0) return null;

  return (
    <section aria-label="내 주변 매장" className="pt-5">
      <div className="px-4 flex items-end justify-between mb-4">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>내 주변 매장</div>
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {userLocation ? `현재 위치 기준 · 반경 ${radiusKm}km · ` : '위치 권한 허용 시 거리 표시'}
            {userLocation && <span className="font-bold stat-number" style={{ color: 'var(--brand)' }}>{visible.length}개</span>}
          </div>
        </div>
        <button onClick={() => window.location.href = '/m/find?mode=map'} className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60 mb-1" style={{ color: 'var(--brand)' }}>
          지도로 보기
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>

      {/* 가로 스크롤 */}
      <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
        {visible.slice(0, 10).map((st) => <NearbyStoreSquareCard key={st.id} store={st} live={liveByStore[st.id] || 0} />)}
        <button onClick={() => window.location.href = '/m/find?mode=map'} className="w-[140px] flex-shrink-0 rounded-2xl flex flex-col items-center justify-center gap-2 transition active:scale-95" style={{ aspectRatio: '1', background: 'var(--surface-2)', border: '1px solid var(--border)' }} aria-label="전체 매장 지도로 보기">
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
          <button onClick={() => setRadiusKm(nextRadiusKm!)} className="w-full py-2.5 rounded-2xl text-[12px] font-semibold transition active:scale-[0.99] flex items-center justify-center gap-1" style={{ background: 'var(--surface-1)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}>
            더 멀리 · 반경 {nextRadiusKm}km까지 넓히기
            {moreCount > 0 && <span className="stat-number font-bold" style={{ color: 'var(--text-2)' }}> +{moreCount}개</span>}
          </button>
        </div>
      )}
    </section>
  );
}

function NearbyStoreSquareCard({ store: st, live }: { store: NearbyStore; live: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'find-nearby'); }, [st.id]);
  return (
    <Link href={`/m/store/${st.id}`} onClick={() => bumpStoreMetric(st.id, 'cardClicks')} className="w-[140px] flex-shrink-0 rounded-2xl overflow-hidden card-hover" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
      <div className="relative overflow-hidden" style={{ aspectRatio: '1', background: 'var(--surface-2)' }}>
        {st.photoUrl ? <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}><span className="text-[24px] font-extrabold" style={{ color: 'var(--brand)', opacity: 0.4 }}>{st.name.charAt(0)}</span></div>}
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {st.distance != null && <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)' }}>{formatDistance(st.distance)}</span>}
        </div>
        {live > 0 && <div className="absolute top-2 right-2"><span className="badge-live" style={{ fontSize: 9, padding: '2px 6px' }}><span className="dot" />LIVE</span></div>}
        <div className="absolute bottom-0 left-0 right-0 h-10" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 100%)' }} aria-hidden="true" />
      </div>
      <div className="px-2.5 pt-2.5 pb-2">
        <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</div>
        {(st.reviewCount ?? 0) > 0 && <div className="mt-1"><RatingChip rating={st.averageRating} count={st.reviewCount} size="sm" /></div>}
        {st.address && <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{st.address.split(' ').slice(1, 3).join(' ')}</div>}
      </div>
    </Link>
  );
}

function NearbyStoreListRow({ store: st, live, rank }: { store: NearbyStore; live: number; rank: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'find-nearby-list'); }, [st.id]);
  return (
    <Link href={`/m/store/${st.id}`} onClick={() => bumpStoreMetric(st.id, 'cardClicks')} className="flex items-center gap-3 px-4 py-3 transition active:bg-gray-50" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="w-6 text-center text-[13px] font-extrabold flex-shrink-0 stat-number" style={{ color: rank <= 3 ? 'var(--brand)' : 'var(--text-3)' }}>{rank}</span>
      <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        {st.photoUrl ? <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}><span className="text-[14px] font-extrabold" style={{ color: 'var(--brand)', opacity: 0.5 }}>{st.name.charAt(0)}</span></div>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</span>
        </div>
        <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
          {st.distance != null && <span className="font-semibold stat-number" style={{ color: 'var(--text-2)' }}>{formatDistance(st.distance)} · </span>}
          {st.address ? st.address.split(' ').slice(1, 3).join(' ') : ''}
        </div>
        {(st.reviewCount ?? 0) > 0 && <div className="mt-0.5"><RatingChip rating={st.averageRating} count={st.reviewCount} size="sm" /></div>}
      </div>
      {live > 0 ? <span className="badge-live flex-shrink-0"><span className="dot" />LIVE</span> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>}
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
    <Link href={`/m/store/${group.storeId}`} onClick={() => bumpStoreMetric(group.storeId, 'cardClicks')} className="w-[220px] flex-shrink-0 overflow-hidden card-hover hero-dark-card" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.22), 0 1px 6px rgba(229,62,62,0.18)' }}>
      <div className="relative overflow-hidden" style={{ aspectRatio: '16/9', background: poster.bg }}>
        {thumbnail ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnail} alt={group.storeName} className="absolute inset-0 w-full h-full object-cover" />
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
      <button onClick={() => window.location.href = '/m/find?mode=map'} className="block w-full rounded-3xl overflow-hidden card-hover text-left" style={{ background: 'linear-gradient(135deg, var(--brand-pale) 0%, #fff 100%)', border: '1px solid rgba(255,31,143,0.15)', padding: '24px 20px' }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--brand)' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="#fff" stroke="none"/><path d="M16.5 7.5a6.5 6.5 0 010 9M7.5 7.5a6.5 6.5 0 000 9"/></svg>
          </div>
          <div>
            <div className="text-[15px] font-extrabold" style={{ color: 'var(--text-1)' }}>현재 진행 중인 LIVE 없음</div>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>주변 홀덤펍 지도로 탐색하기 →</div>
          </div>
        </div>
      </button>
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
    <Link href={`/m/series/${series.id}`} className="w-[220px] flex-shrink-0 rounded-2xl overflow-hidden card-hover" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
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
