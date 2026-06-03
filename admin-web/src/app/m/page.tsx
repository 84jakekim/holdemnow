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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { hasSeenOnboarding } from '@/lib/onboarding';
import { coordToRegionLabel } from '@/lib/kakao';
import HomeAdsCarousel from '@/components/mobile/home/HomeAdsCarousel';
import HotVideosCarousel from '@/components/mobile/home/HotVideosCarousel';
import HotYoutubersScroll from '@/components/mobile/home/HotYoutubersScroll';
import DailyPostsCarousel from '@/components/mobile/home/DailyPostsCarousel';
import RecentCheckInsStrip from '@/components/mobile/home/RecentCheckInsStrip';
import NotificationBellButton from '@/components/mobile/NotificationBellButton';

/** 활성 콘텐츠 존재 여부를 1회 fetch로 확인 */
async function hasActiveContent(col: string): Promise<boolean> {
  const q = query(collection(db, col), where('isActive', '==', true), limit(1));
  const snap = await getDocs(q);
  return !snap.empty;
}

/**
 * 홈 전용 섹션 wrapper — 모든 섹션의 좌우 패딩(16px)·세로 패딩(20px)을 통일.
 * 자식 컴포넌트는 width/스크롤만 책임지고, 정렬은 부모가 보장.
 *
 * 모든 콘텐츠 카드의 좌측 끝선이 정확히 같은 X좌표(16px)에 위치하도록 강제.
 */
function HomeSection({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={ariaLabel} className="px-4 py-5">
      {children}
    </section>
  );
}

export default function MobileHome() {
  const router = useRouter();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  const isPlatformAdmin = hasRole(userDoc, 'platform_admin');

  // 첫 진입 사용자 — /intro 슬라이드 가이드로 redirect (한 번 보면 안 보임)
  //   ⚠️ 매장/대회사/본사 계정은 제외 — 사용자 온보딩으로 새면 안 됨.
  //      (userDoc 로딩 대기 후 판정. AuthGate가 /m 자체를 차단하지만, 이 redirect가
  //       먼저 발화해 /intro로 빠지는 경합을 원천 차단하는 가드.)
  useEffect(() => {
    if (authState.status === 'authenticated' && userDoc === undefined) return; // userDoc 로딩 대기
    const nonPlayer = !!userDoc && (!!userDoc.storeId || !!userDoc.organizerId || hasRole(userDoc, 'platform_admin'));
    if (nonPlayer) return;
    if (!hasSeenOnboarding()) {
      router.replace('/intro');
    }
  }, [router, userDoc, authState.status]);

  // 4섹션 콘텐츠 0건 여부 — 모든 사용자에게 적용
  //  - platform_admin: 본사 어드민 이동 안내 카드
  //  - 일반 사용자: 친화적 빈상태 placeholder ("매장찾기 둘러보기")
  const [allEmpty, setAllEmpty] = useState<boolean | null>(null);

  // Sprint 2 Phase A 변경: LIVE 히어로 → DailyPostsCarousel.
  //   - LIVE는 /m/find로 이동 (이미 섹션 헤더 + 큰 카드 슬라이더 보유).
  //   - 홈은 "오늘의 매장 소식" peek + 본사 pinned stripe 중심.

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
          1. 헤더 — Pink Rabbit hero 그라데이션 (handoff v2.1)
          핸드오프 패턴: 핑크 → 라이트 핑크 그라데이션 + 토끼 backdrop +
          흰 워드마크 + 흰 액션 버튼 (검색·알림)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <header className="sticky top-0 z-30 pr-home-hero">
        <div className="pr-home-hero-content px-4 h-16 flex items-center justify-between gap-3">

          {/* 좌: Pink Rabbit 로고 + 워드마크 (흰색 워드마크) */}
          <Link
            href="/m"
            aria-label="Pink Rabbit 홈"
            className="flex-shrink-0 flex items-center gap-2 transition active:opacity-60"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-rabbit.svg"
              alt=""
              width={44}
              height={44}
              style={{
                display: 'block', width: 44, height: 44, objectFit: 'contain',
                filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.18))',
              }}
            />
            <span
              className="font-black leading-none whitespace-nowrap"
              style={{
                fontSize: 19,
                letterSpacing: '-0.03em',
                color: '#FFFFFF',
                textShadow: '0 1px 6px rgba(0,0,0,0.18)',
              }}
            >
              Pink Rabbit
            </span>
          </Link>

          {/* 중앙: 환영 + 위치 (흰 텍스트) */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-center leading-tight">
            <div
              className="text-[12px] font-bold truncate"
              style={{ color: '#FFFFFF', textShadow: '0 1px 3px rgba(0,0,0,0.18)' }}
            >
              {displayName ? `${displayName}님 환영합니다` : '오늘도 환영합니다'}
            </div>
            <button aria-label="위치 변경" className="flex items-center gap-0.5 mt-0.5 max-w-full transition active:opacity-60">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span
                className="text-[11px] font-semibold truncate"
                style={{ color: 'rgba(255,255,255,0.92)' }}
              >
                {regionLabel ?? '위치 확인 중'}
              </span>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
          </div>

          {/* 우: 검색 + 알림 (흰 액션 버튼) */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Link
              href="/m/search"
              aria-label="검색"
              className="hero-pink-action w-10 h-10 flex items-center justify-center rounded-full"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            </Link>
            <NotificationBellButton variant="hero" ariaLabel="알림" />
          </div>
        </div>
      </header>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          2. 오늘의 매장 소식 — Sprint 2 Phase A
            (LIVE는 /m/find로 이동)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <DailyPostsCarousel />
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          모든 콘텐츠 섹션은 HomeSection wrapper를 통해
          좌우 padding(16px) · 세로 padding(20px) 통일.
          모든 카드의 좌측 끝선이 정확히 같은 X좌표에 정렬됨.
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      {/* 2. 본사 광고 상단 — 16:9 카드 (전체 콘텐츠와 좌측 끝선 일치) */}
      <HomeSection ariaLabel="추천 광고">
        <HomeAdsCarousel position="top" />
      </HomeSection>

      {/* 3. 지금 다녀온 사람들 — 소셜 v0.1 (memory: project_social_feature_plan)
            별도 탭 신설 X. 홈 한 섹션으로만 노출 — 매장 체크인 24h 피드. */}
      <RecentCheckInsStrip />

      {/* 4. 인기 유튜브 영상 — 가로 카드 슬라이드 */}
      <HomeSection ariaLabel="인기 유튜브 영상">
        <HotVideosCarousel />
      </HomeSection>

      {/* 4. 인기 유튜버 채널 — 원형 아바타 스크롤 */}
      <HomeSection ariaLabel="인기 유튜버 채널">
        <HotYoutubersScroll />
      </HomeSection>

      {/* 5. 본사 광고 하단 — 16:9 카드 (상단과 동일 스타일) */}
      <HomeSection ariaLabel="추천 광고">
        <HomeAdsCarousel position="bottom" />
      </HomeSection>

      {/* 일반 사용자용 친화적 빈상태 placeholder — 콘텐츠 0건이고 본사 관리자가 아닌 경우 */}
      {!isPlatformAdmin && allEmpty === true && (
        <section className="px-4 py-5">
          <div
            className="rounded-2xl px-5 py-6 flex flex-col items-center text-center gap-3 lift"
            style={{
              background: 'var(--surface-1)',
              border: '1.5px solid var(--border)',
              boxShadow: 'var(--shadow-card)',
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
              className="text-[13px] font-bold px-4 py-2 rounded-xl transition active:opacity-70 tap"
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
        <section className="px-4 py-5">
          <div
            className="rounded-2xl px-5 py-4 flex flex-col gap-3 lift"
            style={{
              background: 'var(--surface-1)',
              border: '1.5px solid var(--border)',
              boxShadow: 'var(--shadow-card)',
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
              className="self-start text-[12px] font-bold px-3 py-1.5 rounded-xl transition active:opacity-70 tap"
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
        Pink Rabbit BETA · 내 주변 홀덤펍 디스커버리
      </div>
    </div>
  );
}
