'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import NoticePopup from '@/components/mobile/NoticePopup';
import AuthGate from '@/components/AuthGate';
import { useAuth, useUserDoc } from '@/lib/hooks';
import { useHeartbeat } from '@/lib/heartbeat';

/* ============================================================
 * 탭 정의 — 5탭 (대회 → 토너 흡수, 즐겨찾기 유지)
 * 활성: 핑크 아이콘·라벨 + 상단 underline indicator
 * 컨테이너: Floating Glass Pill (Soft Pink + Glass)
 * ========================================================== */
const TABS = [
  {
    id: 'home',
    href: '/m',
    label: '홈',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.2 : 1.7} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.12 : 0} />
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
        <path d="M9 21V12h6v9"/>
      </svg>
    ),
  },
  {
    id: 'find',
    href: '/m/find',
    label: '매장찾기',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.2 : 1.7} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {/* 빌딩 + 돋보기 결합 아이콘 */}
        <rect x="3" y="7" width="10" height="14" rx="1.5" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.10 : 0} />
        <rect x="3" y="7" width="10" height="14" rx="1.5"/>
        <path d="M7 21V3h10v7"/>
        <circle cx="18" cy="17" r="3"/>
        <path d="M20.5 19.5l2 2"/>
      </svg>
    ),
  },
  {
    id: 'calendar',
    href: '/m/calendar',
    label: '토너',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.2 : 1.7} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2.5" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.10 : 0} />
        <rect x="3" y="4" width="18" height="18" rx="2.5"/>
        <path d="M16 2v4M8 2v4M3 10h18"/>
        <circle cx="8" cy="15" r="1" fill="currentColor" stroke="none"/>
        <circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/>
        <circle cx="16" cy="15" r="1" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    id: 'favorites',
    href: '/m/favorites',
    label: '즐겨찾기',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
      </svg>
    ),
  },
  {
    id: 'my',
    href: '/m/my',
    label: '내정보',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.2 : 1.7} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.12 : 0} />
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
    ),
  },
] as const;

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const authState = useAuth();
  const uid = authState.status === 'authenticated' ? authState.user.uid : null;
  useHeartbeat(uid);

  const router = useRouter();
  const pathname = usePathname() ?? '';
  const userDoc = useUserDoc(uid);

  // 풀스크린 페이지 — 탭바 숨김 (온보딩 포함)
  const isFullscreen =
    pathname.startsWith('/m/store/') ||
    pathname.startsWith('/m/live/') ||
    pathname.startsWith('/m/events/') ||
    pathname.startsWith('/m/campaigns/') ||
    pathname.startsWith('/m/onboarding/');

  // 전화번호 미등록 사용자는 /m/onboarding/phone으로 강제
  // (users doc 존재 + phone 필드 비어있음 → 강제 게이트)
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    if (userDoc === undefined) return;     // 로딩 중
    if (userDoc === null) return;          // 신규 — users doc 아직 생성 전, AuthGate가 처리
    if (userDoc.phone) return;             // 이미 등록
    if (pathname.startsWith('/m/onboarding')) return;  // 온보딩 페이지 자체는 통과
    const next = pathname && pathname.startsWith('/m') ? pathname : '/m';
    router.replace(`/m/onboarding/phone?next=${encodeURIComponent(next)}`);
  }, [authState.status, userDoc, pathname, router]);

  return (
    <AuthGate>
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <div className="max-w-md mx-auto min-h-screen relative" style={{ background: 'var(--bg)' }}>
          <div className={isFullscreen ? '' : 'pb-[88px]'}>{children}</div>
          {!isFullscreen && <TabBar pathname={pathname} />}
          <NoticePopup />
        </div>
      </div>
    </AuthGate>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="메인 내비게이션"
    >
      {/* Floating Translucent Hot Pink Pill — 핫핑크 alpha 0.28.
       * 핑크 톤 유지 + 투명도만 낮춤. 아이콘은 진한 핫핑크. */}
      <div
        className="mx-3 mb-3 rounded-full tabbar-glass overflow-hidden"
        style={{
          background: 'rgba(255, 31, 143, 0.28)',
        }}
      >
        <div className="flex items-stretch h-[60px] px-1">
          {TABS.map((t) => {
            const active =
              pathname === t.href ||
              (t.href !== '/m' && pathname.startsWith(t.href)) ||
              // /m/discover는 /m/find로 리다이렉트되므로 find 탭 활성 처리
              (t.id === 'find' && pathname.startsWith('/m/discover'));

            return (
              <Link
                key={t.id}
                href={t.href}
                aria-label={t.label}
                aria-current={active ? 'page' : undefined}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-all duration-200 active:scale-90"
                style={{ color: active ? '#E01077' : 'rgba(224, 16, 119, 0.55)' }}
              >
                {/* 활성 indicator — 상단 짧은 진한 핑크 underline */}
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] rounded-full pointer-events-none transition-all duration-200"
                  style={{
                    width: active ? 28 : 0,
                    background: '#E01077',
                    opacity: active ? 1 : 0,
                  }}
                  aria-hidden="true"
                />
                {/* 아이콘 — 활성 시 살짝 위로 떠오르고 scale-up */}
                <span
                  className="transition-transform duration-200"
                  style={{
                    transform: active
                      ? 'translateY(-2px) scale(1.05)'
                      : 'translateY(0) scale(1)',
                  }}
                >
                  {t.icon(active)}
                </span>
                <span
                  className="text-[11px] leading-none transition-all duration-200"
                  style={{
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {t.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
