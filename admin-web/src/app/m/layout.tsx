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
 * 컨테이너: 표준 하단 고정형 (배민·당근·토스 톤) v4
 * 활성: 상단 미세 핑크 라인 + 아이콘·라벨 핑크 색 + 굵게
 * 비활성: 옅은 회색(--text-3), 폰트 500
 * ========================================================== */
const TABS = [
  {
    id: 'home',
    href: '/m',
    label: '홈',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2 : 1.8} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2 : 1.8} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2 : 1.8} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
      </svg>
    ),
  },
  {
    id: 'my',
    href: '/m/my',
    label: '내정보',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2 : 1.8} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
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
    pathname.startsWith('/m/notice/') ||
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
          <div className={isFullscreen ? '' : 'pb-[80px]'}>{children}</div>
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
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 tabbar-glass"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="메인 내비게이션"
    >
      {/* 표준 하단 고정형 — 좌우 풀폭·rounded 없음.
       * 활성 표현: 상단 미세 핑크 라인 + 아이콘·라벨 핑크 색 + 굵게.
       * 다크 모드는 .tabbar-glass + 토큰(--surface-1, --border)이 자동 분기. */}
      <div className="flex items-stretch h-[56px]">
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
              className="flex-1 flex flex-col items-center justify-center gap-[3px] relative transition-colors duration-200 active:scale-95"
              style={{ color: active ? 'var(--brand)' : 'var(--text-3)' }}
            >
              {/* 활성 indicator — 상단 미세 핑크 라인 (24×1.5px) */}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full pointer-events-none"
                  style={{
                    width: 24,
                    height: 1.5,
                    background: 'var(--brand)',
                  }}
                />
              )}
              {/* 아이콘 — 활성 시 1px 위로 살짝 떠오름 */}
              <span
                className="transition-transform duration-200"
                style={{
                  transform: active ? 'translateY(-1px)' : 'translateY(0)',
                }}
              >
                {t.icon(active)}
              </span>
              <span
                className="text-[11px] leading-none transition-all duration-200"
                style={{ fontWeight: active ? 700 : 500 }}
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
