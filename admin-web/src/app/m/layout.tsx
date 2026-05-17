'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import NoticePopup from '@/components/mobile/NoticePopup';

/* ============================================================
 * 탭 정의 — 이모지 대신 inline SVG 아이콘 (네온 핑크 호환)
 * ========================================================== */
const TABS = [
  {
    id: 'home',
    href: '/m',
    label: '홈',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <path d="M14.5 9.5l-5 2-2 5 5-2 2-5z"/>
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    id: 'calendar',
    href: '/m/calendar',
    label: '토너',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M16 2v4M8 2v4M3 10h18"/>
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
      </svg>
    ),
  },
  {
    id: 'events',
    href: '/m/events',
    label: '대회',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 21h8M12 17v4"/>
        <path d="M6 3h12v7a6 6 0 01-12 0V3z"/>
        <path d="M6 7H2v2a4 4 0 004 4M18 7h4v2a4 4 0 01-4 4"/>
      </svg>
    ),
  },
  {
    id: 'favorites',
    href: '/m/favorites',
    label: '즐겨찾기',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
      </svg>
    ),
  },
  {
    id: 'my',
    href: '/m/my',
    label: '마이',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
    ),
  },
];

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
        <div className={isFullscreen ? '' : 'pb-20'}>{children}</div>
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
      <div className="flex">
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
              className="flex-1 flex flex-col items-center py-2.5 transition-colors"
              style={{ color: active ? 'var(--brand)' : 'var(--text-3)' }}
            >
              {/* 활성 탭: 작은 핑크 글로우 뒤 아이콘 */}
              <span className="relative flex items-center justify-center">
                {active && (
                  <span
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: 'var(--brand-glow)',
                      width: 36,
                      height: 36,
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                    }}
                    aria-hidden="true"
                  />
                )}
                <span className="relative">{t.icon(active)}</span>
              </span>
              <span
                className="text-[10px] mt-0.5"
                style={{
                  fontWeight: active ? 700 : 500,
                  color: active ? 'var(--brand)' : 'var(--text-3)',
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
