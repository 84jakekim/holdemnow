'use client';

/**
 * /m/page.tsx — 신규 홈 (콘텐츠 허브)
 *
 * 섹션:
 * 1. 헤더 (로고 + 환영 + 위치 + 검색/알림)
 * 2. 본사 광고 상단 (16:9 슬라이드, homeAds position='top')
 * 3. 인기 유튜브 영상 (가로 카드 스크롤)
 * 4. 인기 유튜버 채널 (원형 아바타 스크롤)
 * 5. 본사 광고 하단 (21:9 서브 배너, homeAds position='bottom')
 *
 * 카카오맵 SDK: 이 페이지에서는 0회 호출.
 * 카카오 coordToRegionLabel: 위치 라벨용 1회 (기존 캐싱 로직 유지).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { coordToRegionLabel } from '@/lib/kakao';
import HomeAdsCarousel from '@/components/mobile/home/HomeAdsCarousel';
import HotVideosCarousel from '@/components/mobile/home/HotVideosCarousel';
import HotYoutubersScroll from '@/components/mobile/home/HotYoutubersScroll';
import PrimaryLiveCard from '@/components/mobile/live/PrimaryLiveCard';
import LiveSlider from '@/components/mobile/live/LiveSlider';
import LiveSectionHeader from '@/components/mobile/live/LiveSectionHeader';
import { subscribeAllLiveSessions, type LiveSession } from '@/lib/live';

/** 활성 콘텐츠 존재 여부를 1회 fetch로 확인 */
async function hasActiveContent(col: string): Promise<boolean> {
  const q = query(collection(db, col), where('isActive', '==', true), limit(1));
  const snap = await getDocs(q);
  return !snap.empty;
}

export default function MobileHome() {
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  const isPlatformAdmin = hasRole(userDoc, 'platform_admin');

  // 4섹션 콘텐츠 0건 여부 — 모든 사용자에게 적용
  //  - platform_admin: 본사 어드민 이동 안내 카드
  //  - 일반 사용자: 친화적 빈상태 placeholder ("매장찾기 둘러보기")
  const [allEmpty, setAllEmpty] = useState<boolean | null>(null);

  // LIVE 세션 구독 — 헤더 아래 PrimaryLiveCard + LiveSlider 노출
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [liveStoreSummaries, setLiveStoreSummaries] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(setLiveSessions, () => {});
    return unsub;
  }, []);

  // 썸네일 lazy-fetch (storeId 단위, 한 번만)
  const liveThumbnailIds = useMemo(
    () => liveSessions.map((s) => s.storeId).filter((id) => !(id in liveStoreSummaries)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveSessions],
  );
  useEffect(() => {
    if (liveThumbnailIds.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { getDocs: gd, query: q, collection: col, where: wh, documentId } = await import('firebase/firestore');
        const snap = await gd(q(col(db, 'stores'), wh(documentId(), 'in', liveThumbnailIds.slice(0, 10))));
        const next: Record<string, string | undefined> = {};
        snap.forEach((d) => {
          const data = d.data() as { photoUrls?: string[] };
          next[d.id] = data.photoUrls?.[0];
        });
        if (!cancelled) setLiveStoreSummaries((prev) => ({ ...prev, ...next }));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [liveThumbnailIds]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [hasAds, hasVideos, hasYoutubers] = await Promise.all([
          hasActiveContent('homeAds'),
          hasActiveContent('hotYoutubeVideos'),
          hasActiveContent('hotYoutubers'),
        ]);
        if (!cancelled) {
          setAllEmpty(!hasAds && !hasVideos && !hasYoutubers);
        }
      } catch {
        // fetch 실패 시 보수적으로 빈 상태로 처리 — placeholder는 보여주는 게 낫다
        if (!cancelled) setAllEmpty(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const displayName =
    authState.status === 'authenticated'
      ? authState.user.displayName ?? authState.user.email?.split('@')[0] ?? '플레이어'
      : null;

  // 위치 라벨 — 기존 24h 캐싱 로직 유지. 카카오맵 SDK 미호출.
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

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          1. 헤더 — 기존 디자인 그대로 재사용
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <header className="sticky top-0 z-30 header-minimal">
        <div className="px-4 h-14 flex items-center justify-between gap-3">

          {/* 좌: 워드마크 */}
          <Link href="/m" aria-label="HoldemNow 홈" className="flex-shrink-0 transition active:opacity-60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/top_right_logo.svg" alt="HoldemNow" width={36} height={36} style={{ display: 'block' }} />
          </Link>

          {/* 중앙: 환영 + 위치 */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-center leading-tight">
            <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
              {displayName ? `${displayName}님 환영합니다` : '오늘도 환영합니다'}
            </div>
            <button aria-label="위치 변경" className="flex items-center gap-0.5 mt-0.5 max-w-full transition active:opacity-60">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span className="text-[11px] font-normal truncate" style={{ color: 'var(--text-2)' }}>
                {regionLabel ?? '위치 확인 중'}
              </span>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
          </div>

          {/* 우: 검색 + 알림 */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Link href="/m/search" aria-label="검색" className="w-10 h-10 flex items-center justify-center rounded-full transition active:bg-[var(--surface-2)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            </Link>
            <button aria-label="알림" className="w-10 h-10 flex items-center justify-center rounded-full relative transition active:bg-[var(--surface-2)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 01-3.46 0"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="header-minimal-line" aria-hidden="true" />
      </header>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          2. HOT LIVE 섹션 헤더 + 큰 카드 + 작은 카드 슬라이더
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <LiveSectionHeader count={liveSessions.filter((s) => s.status === 'running' || s.status === 'paused' || s.status === 'break').length} />
      <PrimaryLiveCard sessions={liveSessions} thumbnails={liveStoreSummaries} />
      <LiveSlider sessions={liveSessions} thumbnails={liveStoreSummaries} />

      {liveSessions.length > 0 && <div className="brand-strip-divider" />}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          3. 본사 광고 상단 — 16:9 슬라이드 (어두운 톤)
          첫 슬라이드: "내 주변 매장 찾기" CTA 카드 등록 가능
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <HomeAdsCarousel position="top" />

      {/* 섹션 구분 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          3. 인기 유튜브 영상 — 가로 카드 슬라이드 (밝은 톤)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <HotVideosCarousel />

      {/* 섹션 구분 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          4. 인기 유튜버 채널 — 원형 아바타 스크롤 (빨간 ▶ 배지)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <HotYoutubersScroll />

      {/* 섹션 구분 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          5. 본사 광고 하단 — 21:9 서브 배너
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <HomeAdsCarousel position="bottom" />

      {/* 일반 사용자용 친화적 빈상태 placeholder — 콘텐츠 0건이고 본사 관리자가 아닌 경우 */}
      {!isPlatformAdmin && allEmpty === true && (
        <section className="px-4 py-6">
          <div
            className="rounded-2xl px-5 py-6 flex flex-col items-center text-center gap-3"
            style={{
              background: 'var(--surface-1)',
              border: '1.5px solid var(--border)',
            }}
            role="status"
          >
            <span className="text-3xl" aria-hidden>🎲</span>
            <div>
              <div
                className="text-[15px] font-bold leading-snug"
                style={{ color: 'var(--text-1)' }}
              >
                곧 새로운 콘텐츠가 채워집니다
              </div>
              <div
                className="text-[12px] mt-1 leading-relaxed"
                style={{ color: 'var(--text-2)' }}
              >
                먼저 내 주변 홀덤펍부터 둘러보세요.
              </div>
            </div>
            <Link
              href="/m/find"
              className="text-[13px] font-bold px-4 py-2 rounded-xl transition active:opacity-70"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-1)',
                border: '1px solid var(--border)',
              }}
            >
              매장찾기 둘러보기 →
            </Link>
          </div>
        </section>
      )}

      {/* 본사 관리자 전용 — 4섹션 콘텐츠 0건 안내 카드 */}
      {isPlatformAdmin && allEmpty === true && (
        <section className="px-4 py-4">
          <div
            className="rounded-2xl px-5 py-4 flex flex-col gap-3"
            style={{
              background: 'var(--surface-1)',
              border: '1.5px solid var(--border)',
            }}
            role="status"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0" aria-hidden>📺</span>
              <div>
                <div
                  className="text-[14px] font-bold leading-snug"
                  style={{ color: 'var(--text-1)' }}
                >
                  홈에 콘텐츠가 없습니다
                </div>
                <div
                  className="text-[12px] mt-0.5 leading-relaxed"
                  style={{ color: 'var(--text-2)' }}
                >
                  본사 어드민에서 광고·유튜브·유튜버를 등록해 주세요.
                </div>
              </div>
            </div>
            <Link
              href="/platform/home-content"
              className="self-start text-[12px] font-bold px-3 py-1.5 rounded-xl transition active:opacity-70"
              style={{
                background: '#FF1F8F',
                color: '#fff',
              }}
            >
              본사 어드민으로 이동 →
            </Link>
          </div>
        </section>
      )}

      {/* 푸터 */}
      <div
        className="px-4 py-6 text-center text-[11px]"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--text-3)' }}
      >
        HoldemNow BETA · 부산/경남 홀덤펍 디스커버리
      </div>
    </div>
  );
}
