'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession, fmtTime, useLiveCountdown } from '@/lib/live';
import { subscribeAllSeries, type Series } from '@/lib/series';
import { posterStyleFor } from '@/lib/templates';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { haversineMeters, formatDistance, type LatLng } from '@/lib/geo';
import { loadPopularStores, loadRecentlyJoinedStores, type PopularityStore } from '@/lib/popularity';
import { useAuth } from '@/lib/hooks';
import { coordToRegionLabel } from '@/lib/kakao';
import {
  loadActivePostsAll,
  subscribeActivePinnedPosts,
  type StorePost,
  type PinnedPost,
} from '@/lib/posts';

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
}

/* ============================================================
 * 홈 페이지 v4 — lun DNA 적용
 * 1. 위치 헤더
 * 2. 히어로 LIVE 카드 (가로 스와이프, GTD 숫자 강조)
 * 3. 원형 카테고리 아이콘 그리드 (5개)
 * 4. 인기 매장 아바타 가로 스크롤
 * 5. 내 주변 매장 TOP
 * 6. 메이저 시리즈
 * 7. 콘텐츠 영역 (추후 SNS 확장 자리)
 * ========================================================== */
export default function MobileHome() {
  const authState = useAuth();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [storeSummaries, setStoreSummaries] = useState<Record<string, StoreSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 환영 메시지용 사용자 이름 — displayName 없으면 이메일 prefix, 비로그인이면 일반 인사
  const displayName =
    authState.status === 'authenticated'
      ? authState.user.displayName ?? authState.user.email?.split('@')[0] ?? '플레이어'
      : null;

  // 사용자 위치 → 행정구역 라벨. localStorage 24h 캐싱 — 카카오 호출량 절약.
  // 좌표 100m 이상 이동하지 않는 한 같은 동/구. 캐시 만료 또는 위치 변동 시에만 카카오 호출.
  const REGION_CACHE_KEY = 'holdemnow:regionLabel';
  const REGION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const REGION_CACHE_RADIUS_M = 500; // 이 반경 내면 같은 행정동으로 간주, 호출 안 함
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
        // 캐시 검사: 기존 좌표와 가까우면 카카오 호출 안 함
        try {
          const raw = window.localStorage.getItem(REGION_CACHE_KEY);
          if (raw) {
            const c = JSON.parse(raw) as { label: string; lat: number; lng: number; ts: number };
            if (Date.now() - c.ts < REGION_CACHE_TTL_MS) {
              const dLat = (pos.coords.latitude - c.lat) * 111_000;
              const dLng = (pos.coords.longitude - c.lng) * 88_000;
              const distM = Math.sqrt(dLat * dLat + dLng * dLng);
              if (distM < REGION_CACHE_RADIUS_M) {
                setRegionLabel(c.label);
                return; // 카카오 호출 skip
              }
            }
          }
        } catch { /* fall through */ }
        // 캐시 miss 또는 위치 이동 — 카카오 호출 1회
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
        const snap = await getDocs(
          query(collection(db, 'stores'), where(documentId(), 'in', ids.slice(0, 10))),
        );
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
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          1. 상단 헤더 v7 — 1단 미니멀 (당근+토스 DNA)
          흰 배경 + 핑크 하단 액센트라인. 요소 3개만: 워드마크, 위치, 아이콘.
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <header className="sticky top-0 z-30 header-minimal">
        <div className="px-4 h-14 flex items-center justify-between gap-3">

          {/* 좌: 워드마크 (홈 링크) */}
          <Link
            href="/m"
            aria-label="HoldemNow 홈"
            className="flex-shrink-0 transition active:opacity-60"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.svg"
              alt="HoldemNow"
              height={20}
              style={{ width: 'auto', display: 'block' }}
            />
          </Link>

          {/* 중앙: 환영 + 위치 (작게, 한 줄·두 줄 자동 조정) */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-center leading-tight">
            <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
              {displayName ? `${displayName}님 환영합니다` : '오늘도 환영합니다'}
            </div>
            <button
              aria-label="위치 변경"
              className="flex items-center gap-0.5 mt-0.5 max-w-full transition active:opacity-60"
            >
              <svg
                width="10" height="10" viewBox="0 0 24 24"
                fill="none" stroke="var(--brand)" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true" style={{ flexShrink: 0 }}
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span
                className="text-[11px] font-normal truncate"
                style={{ color: 'var(--text-2)' }}
              >
                {regionLabel ?? '위치 확인 중'}
              </span>
              <svg
                width="9" height="9" viewBox="0 0 24 24"
                fill="none" stroke="var(--text-3)" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true" style={{ flexShrink: 0 }}
              >
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
          </div>

          {/* 우: 검색 + 알림 아이콘 */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Link
              href="/m/search"
              aria-label="검색"
              className="w-10 h-10 flex items-center justify-center rounded-full transition active:bg-[var(--surface-2)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            </Link>
            <button
              aria-label="알림"
              className="w-10 h-10 flex items-center justify-center rounded-full relative transition active:bg-[var(--surface-2)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 01-3.46 0"/>
              </svg>
              {/* 알림 뱃지 자리 예약 — 미읽음 있을 때만 노출 */}
              {/* <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: 'var(--live)' }} /> */}
            </button>
          </div>
        </div>

        {/* 하단 핑크 액센트 라인 — 브랜드 존재감, 구분선 역할 동시 */}
        <div className="header-minimal-line" aria-hidden="true" />
      </header>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          2. 히어로 LIVE 카드 — lun 강도 수준
          GTD/진행 인원 숫자 강조 + 강한 포스터 분위기
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section aria-label="지금 LIVE" className="pt-5">
        {/* 섹션 헤더 */}
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

        {/* 카드 영역 */}
        {loading ? (
          <LiveHeroSkeleton />
        ) : error ? (
          <div
            className="mx-4 rounded-2xl p-4 text-sm"
            style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: 'var(--live)' }}
          >
            {error}
          </div>
        ) : groups.length === 0 ? (
          <LiveEmptyHero />
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

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider mt-5" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          3. 원형 카테고리 아이콘 그리드 — lun DNA 핵심
          5개 즉시 진입점: 매장찾기 / LIVE중 / 토너 / 시리즈 / 즐겨찾기
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section aria-label="빠른 메뉴" className="px-4 py-5">
        {/* 공유 SVG defs — 5개 아이콘이 같은 그라데이션/필터를 공유 (light source 일관성) */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            {/* 카드 흰 면 — 위 밝고 아래 옅은 회색 */}
            <linearGradient id="cardFace" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="55%" stopColor="#FFF4F9" />
              <stop offset="100%" stopColor="#FFD9EA" />
            </linearGradient>
            {/* 슈트 — 짙은 자홍 그라데이션 (위 밝음) */}
            <linearGradient id="suitDark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5A0830" />
              <stop offset="100%" stopColor="#2E0418" />
            </linearGradient>
            {/* 슈트 — 빨강 (LIVE) */}
            <linearGradient id="suitRed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFE2E2" />
              <stop offset="60%" stopColor="#FF4848" />
              <stop offset="100%" stopColor="#7A0808" />
            </linearGradient>
            {/* 골드 — 메이저 시리즈 */}
            <linearGradient id="goldFace" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFF1B5" />
              <stop offset="45%" stopColor="#FFC845" />
              <stop offset="100%" stopColor="#A55F08" />
            </linearGradient>
            {/* 칩 — 위 밝고 아래 어두운 빨강 */}
            <radialGradient id="chipRed" cx="35%" cy="30%" r="80%">
              <stop offset="0%" stopColor="#FFD0D0" />
              <stop offset="55%" stopColor="#E53E3E" />
              <stop offset="100%" stopColor="#5A0808" />
            </radialGradient>
            {/* 위치 빔 — 빛이 퍼지는 콘 */}
            <linearGradient id="beamLight" x1="0.5" y1="0" x2="0.5" y2="1">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
            {/* inner shadow 필터 — 살짝 파인 느낌 */}
            <filter id="innerShade" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="0.8" />
              <feOffset dx="0" dy="0.6" result="offsetblur" />
              <feFlood floodColor="#3A0218" floodOpacity="0.6" />
              <feComposite in2="offsetblur" operator="in" />
              <feComposite in2="SourceGraphic" operator="arithmetic" k2="-1" k3="1" />
            </filter>
            {/* 골드 inner shadow */}
            <filter id="innerShadeGold" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="0.8" />
              <feOffset dx="0" dy="0.6" result="offsetblur" />
              <feFlood floodColor="#5C2F00" floodOpacity="0.55" />
              <feComposite in2="offsetblur" operator="in" />
              <feComposite in2="SourceGraphic" operator="arithmetic" k2="-1" k3="1" />
            </filter>
          </defs>
        </svg>

        <div className="grid grid-cols-5 gap-1">
          {/* 1. 매장찾기 — 비스듬히 떠 있는 카드 + 스페이드(매장 핀) + 위에서 내려오는 위치 빛줄기 */}
          <Link href="/m/discover" className="flex flex-col items-center gap-2 transition active:scale-95">
            <div className="cat-icon-wrap">
              <svg width="32" height="36" viewBox="0 0 40 44" aria-hidden="true">
                {/* 위치 빔 — 카드 위에서 빛이 내려옴 */}
                <path d="M14 2 L26 2 L31 10 L9 10 Z" fill="url(#beamLight)" opacity="0.55" />
                {/* 카드 그림자 (베이스) */}
                <rect x="9" y="14" width="22" height="28" rx="3.2" fill="#5A0830" opacity="0.45" transform="rotate(-6 20 28)" />
                {/* 카드 페이스 */}
                <rect x="9" y="12" width="22" height="28" rx="3.2" fill="url(#cardFace)" transform="rotate(-6 20 26)" />
                {/* 카드 테두리 라이트 */}
                <rect x="9.5" y="12.5" width="21" height="27" rx="2.8" fill="none" stroke="#FFFFFF" strokeWidth="0.8" opacity="0.8" transform="rotate(-6 20 26)" />
                {/* 스페이드 — 매장 핀 (카드 중앙) */}
                <g transform="rotate(-6 20 26)">
                  <path d="M20 18 C16.4 22.8 14.2 24.4 14.2 27.2 C14.2 29.0 15.7 30.3 17.4 30.3 C18.4 30.3 19.2 29.9 19.6 29.2 C19.4 30.6 18.7 31.6 17.8 32.4 L22.2 32.4 C21.3 31.6 20.6 30.6 20.4 29.2 C20.8 29.9 21.6 30.3 22.6 30.3 C24.3 30.3 25.8 29.0 25.8 27.2 C25.8 24.4 23.6 22.8 20 18 Z" fill="url(#suitDark)" filter="url(#innerShade)" />
                  <path d="M20 19 C18 22 16.5 23.8 16 25.4" stroke="#FF8FC4" strokeWidth="0.7" strokeLinecap="round" fill="none" opacity="0.85" />
                </g>
                {/* 위치 빔 위 작은 별빛 */}
                <circle cx="20" cy="5" r="1.4" fill="#FFFFFF" opacity="0.95" />
                <circle cx="20" cy="5" r="2.6" fill="#FFFFFF" opacity="0.35" />
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>매장찾기</span>
          </Link>

          {/* 2. LIVE — 3단 비스듬 칩 스택 + 빨강 코어 + 미세 광선 (실시간 진행 중) */}
          <Link href="/m/discover" className="flex flex-col items-center gap-2 transition active:scale-95">
            <div className="cat-icon-wrap cat-icon-wrap-live">
              <svg width="32" height="36" viewBox="0 0 40 44" aria-hidden="true">
                {/* 바닥 그림자 */}
                <ellipse cx="20" cy="38" rx="13" ry="2.6" fill="#3A0202" opacity="0.45" />
                {/* 칩 3층 (맨 아래) */}
                <ellipse cx="20" cy="33" rx="11" ry="3.4" fill="url(#chipRed)" />
                <path d="M9 33 L9 36 A11 3.4 0 0 0 31 36 L31 33 A11 3.4 0 0 1 9 33 Z" fill="#5A0808" opacity="0.85" />
                {/* 칩 2층 */}
                <ellipse cx="20" cy="27" rx="11" ry="3.4" fill="url(#chipRed)" />
                <path d="M9 27 L9 30 A11 3.4 0 0 0 31 30 L31 27 A11 3.4 0 0 1 9 27 Z" fill="#7A0A0A" opacity="0.7" />
                {/* 칩 1층 (맨 위 — 상단 면) */}
                <ellipse cx="20" cy="21" rx="11" ry="3.4" fill="url(#chipRed)" />
                {/* 칩 상단 마크 — 십자(칩 패턴) */}
                <g transform="translate(20 21)">
                  <rect x="-7" y="-0.6" width="14" height="1.2" rx="0.5" fill="#FFFFFF" opacity="0.85" />
                  <rect x="-0.6" y="-2.4" width="1.2" height="4.8" rx="0.5" fill="#FFFFFF" opacity="0.85" />
                  <circle cx="0" cy="0" r="2" fill="#FF6464" stroke="#FFFFFF" strokeWidth="0.6" />
                </g>
                {/* 상단 빛 반사 — 타원 일부 */}
                <ellipse cx="17" cy="20" rx="5.5" ry="1.2" fill="#FFFFFF" opacity="0.55" />
                {/* 위 광선 — 진행 중 표시 */}
                <path d="M20 4 L20 10" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
                <path d="M12 7 L15 11" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" opacity="0.65" />
                <path d="M28 7 L25 11" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" opacity="0.65" />
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>LIVE</span>
          </Link>

          {/* 3. 토너먼트 — 비스듬한 카드 두 장 + 다이아몬드(예정 일정) + 12시 시계 호 */}
          <Link href="/m/calendar" className="flex flex-col items-center gap-2 transition active:scale-95">
            <div className="cat-icon-wrap">
              <svg width="32" height="36" viewBox="0 0 40 44" aria-hidden="true">
                {/* 뒤 카드 (오른쪽으로 살짝 회전) */}
                <rect x="11" y="13" width="20" height="26" rx="3" fill="#7A0840" opacity="0.55" transform="rotate(8 21 26)" />
                <rect x="11" y="11" width="20" height="26" rx="3" fill="url(#cardFace)" transform="rotate(8 21 24)" />
                {/* 앞 카드 (왼쪽으로 살짝 회전) */}
                <rect x="8" y="14" width="20" height="26" rx="3" fill="#5A0830" opacity="0.5" transform="rotate(-8 18 27)" />
                <rect x="8" y="12" width="20" height="26" rx="3" fill="url(#cardFace)" transform="rotate(-8 18 25)" />
                <rect x="8.5" y="12.5" width="19" height="25" rx="2.6" fill="none" stroke="#FFFFFF" strokeWidth="0.8" opacity="0.85" transform="rotate(-8 18 25)" />
                {/* 다이아몬드 슈트 (앞 카드 중앙) */}
                <g transform="rotate(-8 18 25)">
                  <path d="M18 18 L24 25 L18 32 L12 25 Z" fill="url(#suitDark)" filter="url(#innerShade)" />
                  <path d="M18 19 L22.5 25 L18 22 Z" fill="#FFFFFF" opacity="0.35" />
                </g>
                {/* 시계 호 — 우상단 (예정/스케줄 메타) */}
                <circle cx="32" cy="10" r="5" fill="#FFFFFF" stroke="#7A0840" strokeWidth="0.8" />
                <path d="M32 10 L32 7 M32 10 L34 11" stroke="#7A0840" strokeWidth="1.1" strokeLinecap="round" />
                <circle cx="32" cy="10" r="0.7" fill="#7A0840" />
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>토너먼트</span>
          </Link>

          {/* 4. 대회정보 — 골드 왕관 + 클럽 슈트(메이저 시리즈, 트로피 클리셰 회피) */}
          <Link href="/m/events" className="flex flex-col items-center gap-2 transition active:scale-95">
            <div className="cat-icon-wrap">
              <svg width="32" height="36" viewBox="0 0 40 44" aria-hidden="true">
                {/* 베이스 그림자 */}
                <ellipse cx="20" cy="38" rx="10" ry="2" fill="#5C2F00" opacity="0.5" />
                {/* 클럽 슈트 (왕관 아래) */}
                <g transform="translate(20 30)">
                  <circle cx="0" cy="-3" r="3.2" fill="url(#suitDark)" filter="url(#innerShade)" />
                  <circle cx="-3.4" cy="0.5" r="3.2" fill="url(#suitDark)" filter="url(#innerShade)" />
                  <circle cx="3.4" cy="0.5" r="3.2" fill="url(#suitDark)" filter="url(#innerShade)" />
                  <path d="M-1.2 1.5 L0 5.5 L1.2 1.5 Z" fill="url(#suitDark)" />
                  <circle cx="-0.8" cy="-4" r="0.9" fill="#FFFFFF" opacity="0.6" />
                </g>
                {/* 골드 왕관 (메이저) */}
                <path d="M9 13 L12 20 L16 14 L20 21 L24 14 L28 20 L31 13 L30 24 L10 24 Z" fill="url(#goldFace)" filter="url(#innerShadeGold)" />
                {/* 왕관 보석 */}
                <circle cx="20" cy="17" r="1.6" fill="#FF1F8F" />
                <circle cx="20" cy="17" r="0.7" fill="#FFD0E5" />
                <circle cx="13" cy="14" r="0.9" fill="#E53E3E" />
                <circle cx="27" cy="14" r="0.9" fill="#E53E3E" />
                {/* 왕관 밴드 */}
                <rect x="9" y="22" width="22" height="3" rx="0.6" fill="url(#goldFace)" />
                <rect x="9" y="22" width="22" height="0.8" fill="#FFF1B5" opacity="0.8" />
                {/* 별빛 (위) */}
                <path d="M20 4 L21 7 L24 7 L21.5 8.8 L22.5 11.8 L20 10 L17.5 11.8 L18.5 8.8 L16 7 L19 7 Z" fill="#FFF1B5" opacity="0.9" />
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>대회정보</span>
          </Link>

          {/* 5. 커뮤니티 — 말풍선 안에 펼친 카드 한 쌍(스페이드+하트) + 대화 점 */}
          <Link href="/m/community" className="flex flex-col items-center gap-2 transition active:scale-95">
            <div className="cat-icon-wrap">
              <svg width="32" height="36" viewBox="0 0 40 44" aria-hidden="true">
                {/* 말풍선 (큰) */}
                <path d="M20 8 C28 8 32 12 32 17 C32 22 28 26 20 26 C18 26 16.5 25.8 15 25.3 L10 28 L11.5 23.5 C9 22 8 19.5 8 17 C8 12 12 8 20 8 Z" fill="#FFFFFF" opacity="0.97" />
                {/* 뒤 카드 (스페이드) — 오른쪽 회전 */}
                <g transform="rotate(10 24 17)">
                  <rect x="20" y="11" width="8" height="11" rx="1.2" fill="url(#cardFace)" />
                  <rect x="20.3" y="11.3" width="7.4" height="10.4" rx="0.9" fill="none" stroke="#FF1F8F" strokeWidth="0.5" opacity="0.6" />
                  <path d="M24 14 C22.4 15.8 21.6 16.4 21.6 17.4 C21.6 18.0 22.1 18.4 22.7 18.4 C23.0 18.4 23.3 18.3 23.5 18.0 C23.4 18.5 23.1 18.9 22.8 19.2 L25.2 19.2 C24.9 18.9 24.6 18.5 24.5 18.0 C24.7 18.3 25.0 18.4 25.3 18.4 C25.9 18.4 26.4 18.0 26.4 17.4 C26.4 16.4 25.6 15.8 24 14 Z" fill="url(#suitDark)" />
                </g>
                {/* 앞 카드 (하트) — 왼쪽 회전 */}
                <g transform="rotate(-12 16 18)">
                  <rect x="12" y="12" width="8" height="11" rx="1.2" fill="url(#cardFace)" />
                  <rect x="12.3" y="12.3" width="7.4" height="10.4" rx="0.9" fill="none" stroke="#FF1F8F" strokeWidth="0.5" opacity="0.6" />
                  <path d="M16 20 C16 20 12.8 18.4 12.8 16.4 C12.8 15.4 13.6 14.6 14.6 14.6 C15.3 14.6 15.8 15.0 16 15.5 C16.2 15.0 16.7 14.6 17.4 14.6 C18.4 14.6 19.2 15.4 19.2 16.4 C19.2 18.4 16 20 16 20 Z" fill="url(#suitRed)" />
                </g>
                {/* 작은 말풍선 (대화 표시, 우하단) */}
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

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          📢 오늘의 매장 소식 — 본사 pinned + 매장 데일리 글 통합 피드
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <DailyPostsFeed />

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          4. 인기 매장 아바타 가로 스크롤 — lun 인기 유튜버 패턴
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <PopularStoresAvatarScroll liveByStore={liveByStore} />

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          🆕 새로 합류한 매장 — 가입 30일 이내, cold-start 노출 보장
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <NewlyJoinedStoresSection liveByStore={liveByStore} />

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          5. 내 주변 매장 TOP
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <NearbyStoresSection liveByStore={liveByStore} />

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      {series.length > 0 && <div className="brand-strip-divider mt-5" />}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          6. 메이저 시리즈 (큰 포스터 카드)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {series.length > 0 && (
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
      )}

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          7. 콘텐츠 영역 — 추후 SNS/피드로 확장될 자리
          지금은 placeholder + 빈 상태 UI
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <ContentFeedPlaceholder />

      {/* ── 푸터 ── */}
      <div
        className="px-4 py-6 text-center text-[11px]"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--text-3)' }}
      >
        HoldemNow BETA · 부산/경남 홀덤펍 디스커버리
      </div>
    </div>
  );
}

/* ============================================================
 * 히어로 LIVE 카드 v4 — lun 강도 수준
 * 더 어두운 그라데이션 오버레이 + GTD/진행인원 숫자 강조
 * ========================================================== */
function LiveHeroCard({ group, thumbnail }: { group: StoreGroup; thumbnail?: string }) {
  const primary = group.sessions[0];
  const count = group.sessions.length;
  const poster = posterStyleFor(primary.posterStyle);
  const totalPlayers = group.sessions.reduce((s, x) => s + (x.playersRemaining || 0), 0);

  useEffect(() => { trackImpressionOnce(group.storeId, 'home-live'); }, [group.storeId]);

  return (
    <Link
      href={`/m/store/${group.storeId}`}
      onClick={() => bumpStoreMetric(group.storeId, 'cardClicks')}
      className="w-[220px] flex-shrink-0 overflow-hidden card-hover hero-dark-card"
      style={{
        boxShadow: '0 4px 24px rgba(0,0,0,0.22), 0 1px 6px rgba(229,62,62,0.18)',
      }}
    >
      {/* 사진 영역 — lun 수준의 강한 어두운 오버레이 */}
      <div
        className="relative overflow-hidden"
        style={{ aspectRatio: '16/9', background: poster.bg }}
      >
        {thumbnail ? (
          <>
            <img src={thumbnail} alt={group.storeName} className="absolute inset-0 w-full h-full object-cover" />
            {/* 상단 → 하단 그라데이션 */}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.70) 100%)' }} />
          </>
        ) : (
          /* 사진 없을 때: 다크 그라데이션 배경 */
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #1A0A1E 0%, #0D1117 100%)' }}>
            <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
              </svg>
            </div>
          </div>
        )}

        {/* LIVE 배지 — 좌상단 */}
        <div className="absolute top-3 left-3 z-10">
          <span className="badge-live" style={{ fontSize: 11, padding: '4px 10px' }}>
            <span className="dot" />
            LIVE{count > 1 ? ` ${count}` : ''}
          </span>
        </div>

        {/* 우상단: 진행 인원 강조 */}
        {totalPlayers > 0 && (
          <div className="absolute top-3 right-3 z-10">
            <div
              className="rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)' }}
            >
              <span className="stat-number" style={{ color: 'var(--brand)' }}>{totalPlayers}</span>
              <span> 명 진행</span>
            </div>
          </div>
        )}

        {/* 하단 텍스트 블록 — lun의 GTD 강조 레이아웃 */}
        <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
          {/* 토너 이름 — 굵고 크게 */}
          <div
            className="text-[13px] font-extrabold text-white leading-snug"
            style={{ textShadow: '0 1px 6px rgba(0,0,0,0.60)' }}
          >
            {primary.tournamentName}
          </div>
          {/* 바이인 — 금색 강조 */}
          {primary.buyIn > 0 && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.60)' }}>바이인</span>
              <span className="stat-number text-[12px] font-extrabold" style={{ color: '#F59E0B' }}>
                ₩{primary.buyIn.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 정보 영역 — 다크 배경 위 라이트 텍스트. 레벨 + 블라인드 + 인원 한눈에. */}
      <div className="px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[12px] font-bold truncate text-white flex-1 min-w-0">
            {group.storeName}
          </div>
          <CountdownPill session={primary} />
        </div>
        {/* 핵심 지표 한 줄 — Lv · SB/BB · 인원 */}
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.65)' }}>
          <span className="font-bold">
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>Lv </span>
            <span className="font-mono font-extrabold text-white">{primary.currentLevel}</span>
          </span>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
          <span className="font-mono font-bold tracking-tight">
            <span className="text-white">{primary.smallBlind}/{primary.bigBlind}</span>
          </span>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
          <span className="font-bold">
            <span className="font-mono font-extrabold text-white">{primary.playersRemaining}</span>
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>명</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

/* LIVE 없을 때 히어로 */
function LiveEmptyHero() {
  return (
    <div className="mx-4">
      <Link
        href="/m/discover"
        className="block rounded-3xl overflow-hidden card-hover"
        style={{
          background: 'linear-gradient(135deg, var(--brand-pale) 0%, #fff 100%)',
          border: '1px solid rgba(255,31,143,0.15)',
          padding: '24px 20px',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--brand)' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" fill="#fff" stroke="none"/>
              <path d="M16.5 7.5a6.5 6.5 0 010 9M7.5 7.5a6.5 6.5 0 000 9"/>
            </svg>
          </div>
          <div>
            <div className="text-[15px] font-extrabold" style={{ color: 'var(--text-1)' }}>
              현재 진행 중인 LIVE 없음
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>
              주변 홀덤펍 지도로 탐색하기 →
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}

/* 카운트다운 알약 */
function CountdownPill({ session }: { session: LiveSession }) {
  const sec = useLiveCountdown(session);
  const paused = session.status === 'paused';
  return (
    <div
      className="flex-shrink-0 rounded-full px-2.5 py-1 ml-1.5"
      style={{
        background: paused ? 'rgba(245,158,11,0.15)' : 'rgba(229,62,62,0.15)',
        border: `1px solid ${paused ? 'rgba(245,158,11,0.30)' : 'rgba(229,62,62,0.30)'}`,
      }}
    >
      <span
        className="font-mono text-[11px] font-extrabold stat-number"
        style={{ color: paused ? '#F59E0B' : '#FC8181' }}
      >
        {fmtTime(sec)}
      </span>
    </div>
  );
}

/* 스켈레톤 */
function LiveHeroSkeleton() {
  return (
    <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-1">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="w-[220px] flex-shrink-0 rounded-3xl overflow-hidden"
          style={{ border: '1px solid var(--border)' }}
        >
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

/* ============================================================
 * 인기 매장 아바타 가로 스크롤 — popularity 점수 + 위치 10km 자동 확장
 * 정책: project_holdemnow_popularity (LIVE×2 + favoriteAdds + directionsClicks + 신규부스트 − 거리감점)
 * ========================================================== */
/* ============================================================
 * 📢 오늘의 매장 소식 (디자이너 권고 C-변형)
 * - Pinned 배너 (풀 width, 21/9): 2건 이상 자동 회전(3초). IntersectionObserver + focus/touch 정지.
 * - 매장 글 가로 스크롤 (200px, 4/3): 자동 회전 없음, 최대 15건.
 * ========================================================== */
const HOME_POSTS_LIMIT = 15;
const PINNED_ROTATE_MS = 3000;

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
    loadActivePostsAll()
      .then((items) => {
        if (cancelled) return;
        const now = Date.now();
        setPosts(items.filter((p) => (p.expiresAt?.toMillis() ?? 0) > now).slice(0, HOME_POSTS_LIMIT));
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  if (loaded && pinned.length === 0 && posts.length === 0) return null;

  return (
    <section aria-label="오늘의 매장 소식" className="py-5">
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
            <span>📢</span>
            <span>오늘의 매장 소식</span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            매장이 직접 올린 24시간 한정 소식
          </div>
        </div>
      </div>

      {pinned.length > 0 && (
        <div className="px-4 mb-4">
          <PinnedCarousel items={pinned} />
        </div>
      )}

      {posts.length > 0 && (
        <ul
          role="list"
          className="pl-4 flex gap-2.5 overflow-x-auto scrollbar-none pb-2"
          aria-label="매장 데일리 소식 리스트"
        >
          {posts.map((p) => (
            <li role="listitem" key={p.id} className="flex-shrink-0">
              <StorePostMiniCard post={p} />
            </li>
          ))}
          <li aria-hidden="true" className="w-3 flex-shrink-0" />
        </ul>
      )}
    </section>
  );
}

/** 본사 pinned 자동 회전 캐러셀 — 2건 이상일 때만 회전.
 *  IntersectionObserver로 viewport 밖이면 타이머 정지(성능 + 배경 비용 0).
 *  사용자 터치/포커스 시 영구 정지(자동 재개 안 함). */
function PinnedCarousel({ items }: { items: PinnedPost[] }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // viewport 가시성 추적
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const ob = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? true),
      { threshold: 0.5 },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  // 자동 회전 — items 2건 이상 + 가시 + 미정지일 때만
  useEffect(() => {
    if (items.length < 2 || !inView || paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), PINNED_ROTATE_MS);
    return () => clearInterval(t);
  }, [items.length, inView, paused]);

  const pause = () => setPaused(true);
  const safeIdx = Math.min(idx, items.length - 1);
  const current = items[safeIdx];

  return (
    <div
      ref={containerRef}
      onTouchStart={pause}
      onPointerDown={pause}
      onFocus={pause}
      aria-live="off"
    >
      <PinnedBanner post={current} />
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2.5" role="tablist" aria-label="공지 인디케이터">
          {items.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === safeIdx}
              aria-label={`${i + 1}번째 공지`}
              onClick={() => { setPaused(true); setIdx(i); }}
              className="relative flex items-center justify-center"
              style={{ width: 32, height: 32 }}
            >
              <span
                className="block rounded-full transition-all"
                style={{
                  width: i === safeIdx ? 18 : 5,
                  height: 5,
                  background: i === safeIdx ? 'var(--brand)' : 'rgba(255,31,143,0.30)',
                }}
              />
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
    <button
      onClick={openLink}
      disabled={!post.ctaUrl}
      className="w-full rounded-2xl overflow-hidden card-hover text-left block"
      style={{ background: 'var(--surface-1)', border: '1.5px solid var(--brand)', boxShadow: '0 2px 12px rgba(255,31,143,0.15)' }}
    >
      {photo && (
        <div className="relative w-full" style={{ aspectRatio: '21/9', background: 'var(--surface-2)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt={post.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
          <span className="absolute top-2 left-2 text-[10px] font-extrabold rounded-full px-2 py-0.5" style={{ background: 'var(--brand)', color: '#fff' }}>📌 본사 공지</span>
        </div>
      )}
      <div className="px-4 py-3">
        {!photo && (
          <span className="inline-block text-[10px] font-extrabold rounded-full px-2 py-0.5 mb-2" style={{ background: 'var(--brand)', color: '#fff' }}>📌 본사 공지</span>
        )}
        <div className="text-[15px] font-extrabold mb-1 line-clamp-2" style={{ color: 'var(--text-1)' }}>{post.title}</div>
        {post.body && (
          <div className="text-[12px] line-clamp-2" style={{ color: 'var(--text-2)' }}>{post.body}</div>
        )}
        {post.ctaLabel && (
          <div className="text-[13px] font-bold mt-2" style={{ color: 'var(--brand)' }}>{post.ctaLabel} ›</div>
        )}
      </div>
    </button>
  );
}

/** 매장 글 소형 카드 — 200px × (사진 4/3 + 텍스트 영역) */
function StorePostMiniCard({ post }: { post: StorePost }) {
  const photo = post.imageUrls[0];
  const summary = post.body.split('\n').slice(0, 4).join('\n');
  return (
    <Link
      href={`/m/store/${post.storeId}`}
      onClick={() => bumpStoreMetric(post.storeId, 'cardClicks')}
      className="w-[200px] block rounded-2xl overflow-hidden card-hover"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
    >
      {photo ? (
        <div className="relative w-full" style={{ aspectRatio: '4/3', background: 'var(--surface-2)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
          {post.imageUrls.length > 1 && (
            <span className="absolute bottom-2 right-2 text-[10px] font-bold rounded-full px-2 py-0.5 text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>+{post.imageUrls.length - 1}</span>
          )}
        </div>
      ) : null}
      <div className="px-3 py-2.5" style={{ minHeight: photo ? undefined : 100 }}>
        <div className="text-[12px] font-extrabold mb-1 truncate" style={{ color: 'var(--brand)' }}>{post.storeName ?? '매장'}</div>
        <div className="text-[11px] leading-relaxed whitespace-pre-wrap line-clamp-3" style={{ color: 'var(--text-2)' }}>{summary}</div>
        {post.eventTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {post.eventTags.slice(0, 2).map((t) => (
              <span key={t} className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background: 'rgba(255,31,143,0.10)', color: 'var(--brand)' }}>#{t}</span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function PopularStoresAvatarScroll({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<PopularityStore[]>([]);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [appliedRadiusKm, setAppliedRadiusKm] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const tid = setTimeout(() => setUserLocation(null), 0);
      return () => clearTimeout(tid);
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPopularStores(userLocation)
      .then((res) => {
        if (cancelled) return;
        setStores(res.stores);
        setExpanded(res.expanded);
        setAppliedRadiusKm(res.appliedRadiusM > 0 ? Math.round(res.appliedRadiusM / 1000) : null);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [userLocation]);

  if (loaded && stores.length === 0) return null;

  return (
    <section aria-label="내 주변 인기 매장" className="py-5">
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
            내 주변 인기 매장
          </div>
          {appliedRadiusKm != null && (
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {expanded
                ? `주변 매장이 적어 ${appliedRadiusKm}km까지 범위를 넓혔어요`
                : `반경 ${appliedRadiusKm}km · LIVE 운영 활발한 매장 우선`}
            </div>
          )}
        </div>
        <Link
          href="/m/discover"
          className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60 mb-0.5"
          style={{ color: 'var(--brand)' }}
        >
          전체보기
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </Link>
      </div>
      <div className="pl-4 flex gap-4 overflow-x-auto scrollbar-none pb-1">
        {stores.map((st) => {
          const isLive = (liveByStore[st.id] || 0) > 0;
          const photo = st.photoUrls[0];
          return (
            <Link
              key={st.id}
              href={`/m/store/${st.id}`}
              onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 transition active:scale-95"
              style={{ width: 64 }}
            >
              <div
                className={`store-avatar-ring${isLive ? ' live-ring' : ''}`}
                style={{ width: 60, height: 60, position: 'relative' }}
              >
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={st.name} className="w-full h-full object-cover" style={{ borderRadius: '50%' }} />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)', borderRadius: '50%' }}
                  >
                    <span className="text-[16px] font-extrabold" style={{ color: 'var(--brand)' }}>
                      {st.name.charAt(0)}
                    </span>
                  </div>
                )}
                {isLive && (
                  <span
                    className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white pulse-live"
                    style={{ background: 'var(--live)' }}
                    aria-label="LIVE 중"
                  />
                )}
              </div>
              <span
                className="text-[11px] font-semibold text-center leading-tight"
                style={{ color: 'var(--text-2)', width: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {st.name}
              </span>
            </Link>
          );
        })}
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>
    </section>
  );
}

/* ============================================================
 * 🆕 새로 합류한 매장 — 가입 30일 이내, 거리순
 * 인기 신호와 무관 — 신규 매장 노출 보장 (카톡방 사장님 retention)
 * ========================================================== */
function NewlyJoinedStoresSection({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<PopularityStore[]>([]);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const tid = setTimeout(() => setUserLocation(null), 0);
      return () => clearTimeout(tid);
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRecentlyJoinedStores(userLocation)
      .then((list) => {
        if (cancelled) return;
        setStores(list);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userLocation]);

  if (loaded && stores.length === 0) return null;

  return (
    <section aria-label="새로 합류한 매장" className="py-5">
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
            <span>🆕</span>
            <span>새로 합류한 매장</span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            최근 30일 가입 · {userLocation ? '거리순' : '가입 최신순'}
          </div>
        </div>
      </div>
      <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
        {stores.map((st) => {
          const isLive = (liveByStore[st.id] || 0) > 0;
          const photo = st.photoUrls[0];
          return (
            <Link
              key={st.id}
              href={`/m/store/${st.id}`}
              onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
              className="w-[140px] flex-shrink-0 rounded-2xl overflow-hidden card-hover"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
            >
              <div className="relative overflow-hidden" style={{ aspectRatio: '1', background: 'var(--surface-2)' }}>
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={st.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}>
                    <span className="text-[20px] font-extrabold" style={{ color: 'var(--brand)' }}>{st.name.charAt(0)}</span>
                  </div>
                )}
                <span
                  className="absolute top-2 left-2 text-[9px] font-extrabold rounded-full px-2 py-0.5"
                  style={{ background: 'var(--brand)', color: '#fff' }}
                >
                  NEW
                </span>
                {isLive && (
                  <div className="absolute top-2 right-2">
                    <span className="badge-live" style={{ fontSize: 9, padding: '2px 6px' }}>
                      <span className="dot" />
                      LIVE
                    </span>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 h-10" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 100%)' }} aria-hidden="true" />
              </div>
              <div className="px-2.5 pt-2.5 pb-2">
                <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</div>
                {st.address && (
                  <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
                    {st.address.split(' ').slice(1, 3).join(' ')}
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

/* ============================================================
 * 주변 매장 섹션 — 큰 정사각 사진 카드 가로 스크롤 + 리스트
 * ========================================================== */
const NEARBY_RADIUS_STEPS_KM = [20, 40, 60, 80, 100] as const;
const NEARBY_RADIUS_INITIAL_KM = 20;
const NEARBY_RADIUS_MAX_KM = 100;

const NEARBY_LIST_INITIAL_COUNT = 8;

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
      // 본사 미승인 매장은 모바일 홈에 노출 차단. isDemo 시드는 항상 노출.
      setStores(snap.docs
        .filter((d) => {
          const data = d.data() as { status?: string; isDemo?: boolean };
          return data.status === 'active' || data.isDemo === true;
        })
        .map((d) => {
          const data = d.data() as {
            name: string; address?: string; photoUrls?: string[];
            facilities?: string[]; tier?: string; lat?: number; lng?: number;
          };
          return {
            id: d.id, name: data.name, address: data.address,
            photoUrl: data.photoUrls?.[0], facilities: data.facilities,
            tier: data.tier, lat: data.lat, lng: data.lng,
          };
        }));
    });
  }, []);

  const sorted = useMemo(() => {
    return stores
      .map((s) => ({
        ...s,
        distance:
          userLocation && typeof s.lat === 'number' && typeof s.lng === 'number'
            ? haversineMeters(userLocation, { lat: s.lat, lng: s.lng })
            : undefined,
      }))
      .sort((a, b) => {
        if (a.distance != null && b.distance != null) return a.distance - b.distance;
        if (a.distance != null) return -1;
        if (b.distance != null) return 1;
        return 0;
      });
  }, [stores, userLocation]);

  const visible = useMemo(() => {
    if (!userLocation) return sorted;
    const maxM = radiusKm * 1000;
    return sorted.filter((s) => s.distance != null && s.distance <= maxM);
  }, [sorted, userLocation, radiusKm]);

  const nextRadiusKm = userLocation
    ? NEARBY_RADIUS_STEPS_KM.find((r) => r > radiusKm) ?? null
    : null;
  const moreCount = useMemo(() => {
    if (!userLocation || nextRadiusKm == null) return 0;
    const nextMaxM = nextRadiusKm * 1000;
    const inNext = sorted.filter((s) => s.distance != null && s.distance <= nextMaxM).length;
    return Math.max(0, inNext - visible.length);
  }, [sorted, userLocation, nextRadiusKm, visible.length]);

  const canExpand = nextRadiusKm != null && radiusKm < NEARBY_RADIUS_MAX_KM;

  if (stores.length === 0) return null;

  return (
    <section aria-label="내 주변 매장" className="pt-5">
      {/* 섹션 헤더 */}
      <div className="px-4 flex items-end justify-between mb-4">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
            내 주변 매장
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {userLocation
              ? `현재 위치 기준 · 반경 ${radiusKm}km · `
              : '위치 권한 허용 시 거리 표시'}
            {userLocation && (
              <span className="font-bold stat-number" style={{ color: 'var(--brand)' }}>{visible.length}개</span>
            )}
          </div>
        </div>
        <Link
          href="/m/discover"
          className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60 mb-1"
          style={{ color: 'var(--brand)' }}
        >
          지도로 보기
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </Link>
      </div>

      {/* 가로 스크롤 큰 정사각 카드 */}
      <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
        {visible.slice(0, 10).map((st) => (
          <NearbyStoreSquareCard key={st.id} store={st} live={liveByStore[st.id] || 0} />
        ))}
        {/* 지도로 더보기 카드 */}
        <Link
          href="/m/discover"
          className="w-[140px] flex-shrink-0 rounded-2xl flex flex-col items-center justify-center gap-2 transition active:scale-95"
          style={{
            aspectRatio: '1',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
          aria-label="전체 매장 보기"
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface-3)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-2)' }} aria-hidden="true">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>지도로</span>
        </Link>
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>

      {/* 거리순 리스트 — 기본 1~20개, 펼치기로 전체 */}
      <div className="mt-4">
        {(listExpanded ? visible : visible.slice(0, NEARBY_LIST_INITIAL_COUNT)).map((st, idx) => (
          <NearbyStoreListRow key={st.id} store={st} live={liveByStore[st.id] || 0} rank={idx + 1} />
        ))}
      </div>

      {/* 펼쳐보기/접기 토글 — 8개 초과 시만 노출. 브랜드 틴트 배경으로 반경 확장 버튼과 구분 */}
      {visible.length > NEARBY_LIST_INITIAL_COUNT && (
        <div className="px-4 pt-3">
          <button
            onClick={() => setListExpanded((v) => !v)}
            className="w-full py-3 rounded-2xl text-[13px] font-bold transition active:scale-[0.99] flex items-center justify-center gap-1.5"
            style={{
              background: listExpanded ? 'var(--surface-2)' : 'var(--brand-pale)',
              border: `1px solid ${listExpanded ? 'var(--border)' : 'rgba(240,71,155,0.25)'}`,
              color: listExpanded ? 'var(--text-2)' : '#C8276A',
            }}
            aria-expanded={listExpanded}
          >
            {listExpanded ? (
              <>
                접기
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>
              </>
            ) : (
              <>
                <span>펼쳐보기</span>
                <span className="stat-number font-extrabold">
                  +{visible.length - NEARBY_LIST_INITIAL_COUNT}개
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
              </>
            )}
          </button>
        </div>
      )}

      {/* 반경 확장 버튼 — 뉴트럴 스타일, 역할이 다름을 명확히 */}
      {canExpand && (
        <div className="px-4 pt-2 pb-1">
          <button
            onClick={() => setRadiusKm(nextRadiusKm!)}
            className="w-full py-2.5 rounded-2xl text-[12px] font-semibold transition active:scale-[0.99] flex items-center justify-center gap-1"
            style={{
              background: 'var(--surface-1)',
              border: '1px dashed var(--border)',
              color: 'var(--text-3)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
            더 멀리 · 반경 {nextRadiusKm}km까지 넓히기
            {moreCount > 0 && (
              <span className="stat-number font-bold" style={{ color: 'var(--text-2)' }}> +{moreCount}개</span>
            )}
          </button>
        </div>
      )}
      {!canExpand && userLocation && (
        <div className="px-4 pt-3 text-center text-[11px]" style={{ color: 'var(--text-3)' }}>
          최대 반경({NEARBY_RADIUS_MAX_KM}km)까지 모두 표시됨
        </div>
      )}
    </section>
  );
}

/* 정사각 앨범 카드 (가로 스크롤용) */
function NearbyStoreSquareCard({ store: st, live }: { store: NearbyStore; live: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'home-nearby'); }, [st.id]);
  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="w-[140px] flex-shrink-0 rounded-2xl overflow-hidden card-hover"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="relative overflow-hidden" style={{ aspectRatio: '1', background: 'var(--surface-2)' }}>
        {st.photoUrl
          ? <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
          : (
            <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}>
              <span className="text-[24px] font-extrabold" style={{ color: 'var(--brand)', opacity: 0.4 }}>{st.name.charAt(0)}</span>
            </div>
          )
        }
        {/* 좌상단 배지 */}
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {st.distance != null && (
            <span
              className="text-[10px] font-bold rounded-full px-2 py-0.5"
              style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)' }}
            >
              {formatDistance(st.distance)}
            </span>
          )}
          {st.tier === 'vip' && (
            <span className="text-[9px] font-extrabold rounded-full px-2 py-0.5" style={{ background: 'var(--gold)', color: '#fff' }}>
              VIP
            </span>
          )}
        </div>
        {/* 우상단 LIVE */}
        {live > 0 && (
          <div className="absolute top-2 right-2">
            <span className="badge-live" style={{ fontSize: 9, padding: '2px 6px' }}>
              <span className="dot" />
              LIVE
            </span>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 h-10" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 100%)' }} aria-hidden="true" />
      </div>
      <div className="px-2.5 pt-2.5 pb-2">
        <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</div>
        {st.address && (
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
            {st.address.split(' ').slice(1, 3).join(' ')}
          </div>
        )}
      </div>
    </Link>
  );
}

/* 리스트 로우 */
function NearbyStoreListRow({ store: st, live, rank }: { store: NearbyStore; live: number; rank: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'home-nearby-list'); }, [st.id]);
  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="flex items-center gap-3 px-4 py-3 transition active:bg-gray-50"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <span
        className="w-6 text-center text-[13px] font-extrabold flex-shrink-0 stat-number"
        style={{ color: rank <= 3 ? 'var(--brand)' : 'var(--text-3)' }}
      >
        {rank}
      </span>
      <div
        className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden"
        style={{ background: 'var(--surface-2)' }}
      >
        {st.photoUrl
          ? <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}>
              <span className="text-[14px] font-extrabold" style={{ color: 'var(--brand)', opacity: 0.5 }}>{st.name.charAt(0)}</span>
            </div>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</span>
          {st.tier === 'vip' && (
            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: 'var(--gold)', color: '#fff' }}>VIP</span>
          )}
        </div>
        <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
          {st.distance != null && (
            <span className="font-semibold stat-number" style={{ color: 'var(--text-2)' }}>{formatDistance(st.distance)} · </span>
          )}
          {st.address ? st.address.split(' ').slice(1, 3).join(' ') : ''}
        </div>
      </div>
      {live > 0 ? (
        <span className="badge-live flex-shrink-0">
          <span className="dot" />
          LIVE
        </span>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      )}
    </Link>
  );
}

/* ============================================================
 * 시리즈 포스터 카드
 * ========================================================== */
function SeriesPosterCard({ series }: { series: Series }) {
  const poster = posterStyleFor(series.posterStyle);
  const dDays = series.finalDate
    // eslint-disable-next-line react-hooks/purity
    ? Math.ceil((series.finalDate.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const statusLabel = series.status === 'active' ? '진행 중' : series.status === 'upcoming' ? '예정' : '종료';
  const statusBg = series.status === 'active' ? 'var(--live)' : series.status === 'upcoming' ? 'var(--brand)' : 'var(--text-3)';

  return (
    <Link
      href={`/m/series/${series.id}`}
      className="w-[220px] flex-shrink-0 rounded-2xl overflow-hidden card-hover"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="h-[120px] relative" style={{ background: poster.bg, color: poster.color }}>
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
          <span
            className="text-[10px] font-extrabold rounded-full px-2.5 py-1"
            style={{ background: statusBg, color: '#fff' }}
          >
            {statusLabel}
          </span>
          {dDays !== null && dDays > 0 && series.status !== 'completed' && (
            <span
              className="text-[10px] font-bold rounded-full px-2.5 py-1 stat-number"
              style={{ background: 'rgba(0,0,0,0.35)', color: '#fff' }}
            >
              D-{dDays}
            </span>
          )}
        </div>
        <div className="absolute bottom-3 left-3 right-3">
          <div className="text-[10px] opacity-75 mb-0.5">{series.season}</div>
          <div className="text-[15px] font-extrabold leading-tight">{series.name}</div>
        </div>
      </div>
      <div className="p-3">
        <div className="text-[11px] mb-0.5" style={{ color: 'var(--text-3)' }}>본선 게런티</div>
        <div className="font-mono text-[16px] font-extrabold stat-number" style={{ color: 'var(--gold)' }}>
          ₩{(series.finalGuarantee / 100000000).toFixed(1)}억
        </div>
        <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
          <span>협력 매장</span>
          <span className="font-semibold stat-number" style={{ color: 'var(--text-2)' }}>{series.partnerStoreIds.length}곳</span>
        </div>
      </div>
    </Link>
  );
}

/* ============================================================
 * 콘텐츠 피드 자리 — 추후 SNS 게시글/영상으로 교체
 * ========================================================== */
function ContentFeedPlaceholder() {
  return (
    <section aria-label="커뮤니티" className="py-5">
      <div className="px-4 flex items-center justify-between mb-3">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
            커뮤니티
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            매장 소식 · 리뷰 · 후기 — 준비 중
          </div>
        </div>
      </div>

      {/* 2열 그리드 placeholder */}
      <div className="px-4 grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="content-card-placeholder"
            style={{ aspectRatio: '4/3', padding: '16px' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {i % 2 === 0 ? (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21"/>
                </>
              ) : (
                <>
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </>
              )}
            </svg>
            <span className="text-[11px] font-semibold text-center" style={{ color: 'var(--text-3)' }}>
              {i % 2 === 0 ? '매장 사진' : '리뷰'}
            </span>
          </div>
        ))}
      </div>

      {/* 오픈 예정 배너 */}
      <div
        className="mx-4 mt-4 rounded-2xl px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--brand-pale)', border: '1px solid rgba(255,31,143,0.15)' }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--brand)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <div>
          <div className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
            커뮤니티 기능 오픈 예정
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--brand)' }}>
            매장 리뷰 · 체크인 · 소식 알림
          </div>
        </div>
      </div>
    </section>
  );
}
