'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import NoticePopup from '@/components/mobile/NoticePopup';
import InAppToast from '@/components/mobile/InAppToast';
import ConfirmedReservationBanner from '@/components/mobile/ConfirmedReservationBanner';
import AuthGate from '@/components/AuthGate';
import { useAuth } from '@/lib/hooks';
import { useHeartbeat } from '@/lib/heartbeat';

/* ============================================================
 * 탭 정의 — 5탭 (대회 → 토너 흡수, 즐겨찾기 유지)
 * 컨테이너: Floating Solid White Pill (시인성 최우선)
 * 활성: 핫핑크 풀필 알약 박스 + 흰 아이콘·라벨
 * 비활성: 진한 회색 아이콘·라벨
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

  const pathname = usePathname() ?? '';

  // 풀스크린 페이지 — 탭바 숨김 (온보딩 포함)
  const isFullscreen =
    pathname.startsWith('/m/store/') ||
    pathname.startsWith('/m/live/') ||
    pathname.startsWith('/m/events/') ||
    pathname.startsWith('/m/campaigns/') ||
    pathname.startsWith('/m/onboarding/');

  // 전화번호 미등록 강제 게이트 — 비활성화.
  // 사장님 보고: 앱 내렸다 올릴 때마다 본인 확인처럼 떠서 불편.
  // 전화번호는 예약 신청 등 실제 필요한 액션 시점에만 요구.
  // 일반 진입엔 게이트 없음 — 사용자가 자율적으로 /m/my에서 등록.

  return (
    <AuthGate>
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <div className="max-w-md mx-auto min-h-screen relative" style={{ background: 'var(--bg)' }}>
          {/* 인앱 FCM 예약 확정 토스트 (전역) */}
          <InAppToast />
          {/* 녹색 마퀴 띠 — 헤더 바로 아래 sticky */}
          {!isFullscreen && (
            <div className="sticky top-0 z-30">
              <ConfirmedReservationBanner />
            </div>
          )}
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
      {/* Floating Solid White Pill — 시인성 최우선.
       * 컨테이너는 흰 솔리드 + 또렷한 그림자.
       * 활성 탭에만 핫핑크 풀필 박스 + 흰 텍스트로 강조.
       * 다크 모드는 .tabbar-glass 클래스가 자동 분기 (배경 → #1A1F2A). */}
      <div className="mx-3 mb-3 rounded-full tabbar-glass overflow-hidden">
        <div className="flex items-stretch h-[60px] px-1.5 gap-0.5">
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
              >
                {/* 활성 indicator — 핫핑크 풀필 알약 박스 (탭 내부) */}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-1.5 inset-x-1 rounded-full pointer-events-none"
                    style={{
                      background:
                        'linear-gradient(135deg, var(--brand) 0%, var(--brand-dim) 100%)',
                      boxShadow:
                        '0 2px 8px rgba(255, 31, 143, 0.35), 0 1px 2px rgba(255, 31, 143, 0.20)',
                    }}
                  />
                )}
                {/* 아이콘 — 활성 시 살짝 위로 떠오르고 scale-up */}
                <span
                  className="relative z-10 transition-transform duration-200"
                  style={{
                    color: active ? '#FFFFFF' : 'var(--text-2)',
                    transform: active
                      ? 'translateY(-1px) scale(1.05)'
                      : 'translateY(0) scale(1)',
                  }}
                >
                  {t.icon(active)}
                </span>
                <span
                  className="relative z-10 text-[10px] leading-none transition-all duration-200"
                  style={{
                    color: active ? '#FFFFFF' : 'var(--text-2)',
                    fontWeight: active ? 800 : 600,
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
