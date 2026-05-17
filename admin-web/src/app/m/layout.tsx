'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import NoticePopup from '@/components/mobile/NoticePopup';

/* ============================================================
 * 탭 정의 — 5탭 (대회 → 토너 흡수, 즐겨찾기 유지)
 * 활성: 핑크 텍스트 + 핑크 알약 배경 (카카오/토스 스타일)
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
    id: 'discover',
    href: '/m/discover',
    label: '탐색',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2.2 : 1.7} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.10 : 0} />
        <circle cx="12" cy="12" r="9"/>
        <path d="M14.5 9.5l-5 2-2 5 5-2 2-5z"/>
        <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
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
    label: '마이',
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
  const pathname = usePathname() ?? '';
  // 풀스크린 페이지 — 탭바 숨김
  const isFullscreen =
    pathname.startsWith('/m/store/') ||
    pathname.startsWith('/m/live/') ||
    pathname.startsWith('/m/events/');

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-md mx-auto min-h-screen relative" style={{ background: 'var(--bg)' }}>
        <div className={isFullscreen ? '' : 'pb-[68px]'}>{children}</div>
        {!isFullscreen && <TabBar pathname={pathname} />}
        <NoticePopup />
      </div>
    </div>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 tabbar-bg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="메인 내비게이션"
    >
      <div className="flex items-stretch h-[56px]">
        {TABS.map((t) => {
          const active =
            pathname === t.href ||
            (t.href !== '/m' && pathname.startsWith(t.href));

          return (
            <Link
              key={t.id}
              href={t.href}
              aria-label={t.label}
              aria-current={active ? 'page' : undefined}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative"
              style={{ color: active ? '#FFFFFF' : 'var(--text-3)' }}
            >
              {/* 활성 탭: 핑크 솔리드 알약 배경 (브랜드 컨셉 띠 v5) */}
              {active && (
                <span
                  className="absolute top-1.5 left-1/2 -translate-x-1/2 rounded-full pointer-events-none tabbar-active-pill"
                  style={{
                    width: 44,
                    height: 28,
                  }}
                  aria-hidden="true"
                />
              )}
              <span
                className="relative z-10"
                style={{ color: active ? '#FFFFFF' : undefined }}
              >
                {t.icon(active)}
              </span>
              <span
                className="relative z-10 text-[10px] leading-none"
                style={{
                  fontWeight: active ? 700 : 500,
                  color: active ? '#FFFFFF' : undefined,
                }}
              >
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
