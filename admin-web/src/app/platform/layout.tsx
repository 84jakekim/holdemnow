'use client';

/**
 * 본사 어드민 레이아웃 — "관제센터" v2
 *
 * 시각 정체성:
 *   - 다크 모드 기본 + 3-state 토글 (사이드바 푸터)
 *   - 차가운 네이비/그레이 + 골드(#F59E0B) 액센트
 *   - 사이드바 카테고리 그룹화 (운영/심사/콘텐츠/데이터)
 *   - 좌상단 통일 식별 영역 (AdminIdentityBadge)
 *
 * 반응형:
 *   - lg+: 좌측 고정 사이드바(w-60) + 메인
 *   - <lg: 상단 햄버거 + 드로어 슬라이드 사이드바 + 메인 풀폭
 *
 * 콘텐츠 페이지는 건드리지 않음 — layout.tsx 안에서 흡수.
 */

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import AuthGate from '@/components/AuthGate';
import { useTheme } from '@/lib/theme';
import AdminIdentityBadge from '@/components/admin/AdminIdentityBadge';
import ThemeToggle from '@/components/admin/ThemeToggle';
import { RabbitLogo } from '@/components/ui';

interface MenuItem {
  id: string;
  icon: string;
  label: string;
  href: string;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    title: '운영',
    items: [
      { id: 'dashboard', icon: '📊', label: '대시보드', href: '/platform' },
      { id: 'live', icon: '🎬', label: '전국 LIVE', href: '/platform/live' },
      { id: 'members', icon: '👥', label: '회원 관리', href: '/platform/members' },
      { id: 'users', icon: '👥', label: '사용자 관리', href: '/platform/users' },
    ],
  },
  {
    title: '심사',
    items: [
      { id: 'stores', icon: '🏬', label: '매장 심사', href: '/platform/stores' },
      { id: 'organizers', icon: '🏢', label: '대회사 심사', href: '/platform/organizers' },
    ],
  },
  {
    title: '콘텐츠',
    items: [
      { id: 'home-content', icon: '📺', label: '홈 콘텐츠', href: '/platform/home-content' },
      { id: 'events', icon: '🎫', label: '대회 큐레이션', href: '/platform/events' },
      { id: 'moderation', icon: '🛡️', label: '모더레이션', href: '/platform/moderation' },
      { id: 'audit-log', icon: '📋', label: '감사 로그', href: '/platform/audit-log' },
      { id: 'reviews', icon: '⭐', label: '리뷰 관리', href: '/platform/reviews' },
      { id: 'inquiries', icon: '📩', label: '사용자 문의', href: '/platform/inquiries' },
      { id: 'notices', icon: '📢', label: '팝업 공지', href: '/platform/notices' },
      { id: 'pinned', icon: '📌', label: '홈 고정 공지', href: '/platform/pinned' },
      { id: 'feed-config', icon: '📍', label: '반경 설정', href: '/platform/feed-config' },
      { id: 'moderation-keywords', icon: '🚫', label: '금지어 사전', href: '/platform/moderation-keywords' },
      { id: 'marketing', icon: '📣', label: '마케팅 푸시', href: '/platform/marketing' },
    ],
  },
  {
    title: '광고',
    items: [
      { id: 'ads', icon: '💰', label: '광고 슬롯 관리', href: '/platform/ads' },
    ],
  },
  {
    title: '데이터/시스템',
    items: [
      { id: 'demo', icon: '🛠', label: '데모 데이터', href: '/platform/demo' },
      { id: 'stats', icon: '📈', label: '플랫폼 통계', href: '/platform/stats' },
    ],
  },
];

const ALL_MENU_ITEMS = MENU_GROUPS.flatMap((g) => g.items);

function isActive(pathname: string, href: string): boolean {
  if (href === '/platform') return pathname === '/platform';
  return pathname === href || pathname.startsWith(href + '/');
}

function currentPageTitle(pathname: string): string {
  // 가장 긴 prefix 매치 우선
  let best: MenuItem | null = null;
  for (const item of ALL_MENU_ITEMS) {
    if (isActive(pathname, item.href)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best ? `${best.icon} ${best.label}` : '본사 어드민';
}

interface HomeContentCounts {
  adsActive: number;
  videosActive: number;
  youtubersActive: number;
}

function PlatformLayoutInner({ children }: { children: React.ReactNode }) {
  const authState = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  const [claiming, setClaiming] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [contentCounts, setContentCounts] = useState<HomeContentCounts | null>(null);

  // 다크 기본 — 본사 어드민
  const { pref, change } = useTheme('dark-default');

  // 라우트 이동 시 드로어 자동 닫힘
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // meta/homeContentCounts 실시간 구독 (사이드바 배지 + 대시보드 위젯 공유)
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'meta', 'homeContentCounts'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setContentCounts({
            adsActive: data.adsActive ?? 0,
            videosActive: data.videosActive ?? 0,
            youtubersActive: data.youtubersActive ?? 0,
          });
        } else {
          setContentCounts({ adsActive: 0, videosActive: 0, youtubersActive: 0 });
        }
      },
      () => {
        setContentCounts({ adsActive: 0, videosActive: 0, youtubersActive: 0 });
      },
    );
    return unsub;
  }, []);

  // ESC로 드로어 닫기
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // 어드민 모바일 입력 줌-방지 globals.css 셀렉터용 body 마킹
  useEffect(() => {
    document.body.setAttribute('data-route', '/platform');
    return () => {
      document.body.removeAttribute('data-route');
    };
  }, []);

  if (authState.status !== 'authenticated' || userDoc === undefined) {
    return (
      <div
        className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--bg)', color: 'var(--text-3)' }}
      >
        로딩 중…
      </div>
    );
  }

  const isPlatformAdmin = hasRole(userDoc, 'platform_admin');
  if (!isPlatformAdmin) {
    const claim = async () => {
      if (authState.status !== 'authenticated') return;
      setClaiming(true);
      try {
        await setDoc(
          doc(db, 'users', authState.user.uid),
          {
            uid: authState.user.uid,
            roles: [...(userDoc?.roles ?? []), 'platform_admin'],
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } finally {
        setClaiming(false);
      }
    };
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: 'var(--bg)' }}
      >
        <div
          className="rounded-2xl p-8 max-w-md w-full text-center"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--gold)',
            color: 'var(--text-1)',
          }}
        >
          <div className="text-4xl mb-3">🏢</div>
          <div className="font-extrabold mb-2" style={{ color: 'var(--text-1)' }}>
            본사 어드민 권한 필요
          </div>
          <div className="text-xs leading-relaxed mb-6" style={{ color: 'var(--text-2)' }}>
            현재 계정에{' '}
            <code
              className="px-1 rounded"
              style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}
            >
              platform_admin
            </code>{' '}
            role이 없습니다.
            <br />
            v0.1 데모 단계에서는 자기 자신에게 부여 가능 (운영 단계는 Functions Custom Claims).
          </div>
          <button
            onClick={claim}
            disabled={claiming}
            className="px-6 py-3 rounded-xl font-bold text-sm disabled:opacity-40"
            style={{ background: 'var(--gold)', color: '#0F1419' }}
          >
            {claiming ? '부여 중…' : '본사 관리자 권한 부여받기 (데모)'}
          </button>
          <button
            onClick={() => router.replace('/')}
            className="block mx-auto mt-4 text-xs underline"
            style={{ color: 'var(--text-3)' }}
          >
            매장 어드민으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  const displayName = authState.user.displayName ?? '본사 관리자';
  const email = authState.user.email ?? undefined;
  const pageTitle = currentPageTitle(pathname);

  // 사이드바 컴포넌트 (데스크탑 + 모바일 드로어 공용)
  const Sidebar = (
    <aside
      className="flex flex-col h-full"
      style={{
        width: 240,
        background: 'var(--surface-1)',
        borderRight: '1px solid var(--border)',
        color: 'var(--text-1)',
      }}
    >
      {/* 브랜드 헤더 — DS v2.0: 관제센터 다크 hero + 골드 액센트 */}
      <div
        className="relative overflow-hidden"
        style={{
          padding: '18px 20px 16px',
          borderBottom: '1px solid var(--border)',
          background:
            'radial-gradient(ellipse at 20% 0%, rgba(255,31,143,0.18) 0%, rgba(255,31,143,0) 55%), linear-gradient(135deg, #1A0A1E 0%, #0D1117 60%, #0F1419 100%)',
        }}
      >
        {/* Rabbit backdrop — 우상단 opacity .14 */}
        <div
          aria-hidden
          style={{ position: 'absolute', top: -16, right: -18, opacity: 0.14, pointerEvents: 'none' }}
        >
          <RabbitLogo size={100} variant="mark" />
        </div>
        {/* 상단 1px 그라데이션 라인 (hero-dark 패턴) */}
        <div
          aria-hidden
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, #FF1F8F 0%, #F59E0B 50%, #FF1F8F 100%)',
          }}
        />
        <div className="relative" style={{ zIndex: 1 }}>
          <div className="flex items-center gap-2 mb-1.5">
            <RabbitLogo size={26} variant="badge" aria-label="Pink Rabbit" />
            <div
              style={{
                fontWeight: 900,
                fontSize: 15,
                letterSpacing: '-0.02em',
                background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BAA 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent',
              }}
            >
              Pink Rabbit
            </div>
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.20em',
              color: 'var(--gold)',
              textShadow: '0 1px 4px rgba(245,158,11,0.25)',
            }}
          >
            BACKOFFICE · 관제센터
          </div>
        </div>
      </div>

      {/* 식별 뱃지 */}
      <div className="px-3 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <AdminIdentityBadge
          context="platform"
          name={displayName}
          email={email}
        />
      </div>

      {/* 메뉴 그룹 */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {MENU_GROUPS.map((group) => (
          <div key={group.title} className="mb-4">
            <div
              className="px-2 mb-1.5"
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.12em',
                color: 'var(--text-3)',
              }}
            >
              {group.title}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const totalActive = contentCounts
                  ? contentCounts.adsActive + contentCounts.videosActive + contentCounts.youtubersActive
                  : null;
                const showBadge = item.id === 'home-content' && totalActive === 0;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="platform-nav-item"
                    data-active={active ? 'true' : 'false'}
                  >
                    <span aria-hidden>{item.icon}</span>
                    <span>{item.label}</span>
                    {showBadge && (
                      <span className="ml-auto">
                        <span
                          className="w-2 h-2 rounded-full bg-red-500 block"
                          aria-label="콘텐츠 없음"
                        />
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 푸터: 테마 토글 + 로그아웃 + 매장 어드민 이동 */}
      <div
        className="px-3 py-3 space-y-2"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <ThemeToggle value={pref} onChange={change} />
        <Link
          href="/"
          className="block text-center text-[11px] font-bold rounded-md px-2.5 py-1.5"
          style={{
            background: 'var(--surface-2)',
            color: 'var(--text-1)',
            border: '1px solid var(--border)',
          }}
        >
          ← 매장 어드민으로
        </Link>
        <button
          onClick={() => signOut(auth)}
          className="block w-full text-center text-xs underline"
          style={{ color: 'var(--text-3)' }}
        >
          로그아웃
        </button>
      </div>
    </aside>
  );

  return (
    <div
      className="min-h-screen flex"
      style={{ background: 'var(--bg)', color: 'var(--text-1)' }}
    >
      {/* 사이드바 활성 메뉴 스타일 — scoped via styled-jsx */}
      <style jsx global>{`
        .platform-nav-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-2);
          text-decoration: none;
          transition: background 120ms, color 120ms, box-shadow 120ms;
          position: relative;
        }
        .platform-nav-item:hover {
          background: var(--surface-2);
          color: var(--text-1);
          box-shadow: inset 2px 0 0 rgba(6, 182, 212, 0.55);
        }
        .platform-nav-item[data-active='true'] {
          color: var(--gold);
          background: rgba(245, 158, 11, 0.08);
          box-shadow: inset 2px 0 0 var(--gold);
        }
        .platform-nav-item[data-active='true']:hover {
          background: rgba(245, 158, 11, 0.12);
        }
      `}</style>

      {/* 데스크탑 사이드바 (lg+) */}
      <div className="hidden lg:block" style={{ width: 240, flexShrink: 0 }}>
        <div className="fixed inset-y-0 left-0" style={{ width: 240 }}>
          {Sidebar}
        </div>
      </div>

      {/* 모바일 드로어 (lg 미만) */}
      {drawerOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div
            className="lg:hidden fixed inset-y-0 left-0 z-50"
            style={{ width: 240, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
          >
            {Sidebar}
          </div>
        </>
      )}

      {/* 메인 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 상단 가로 바 */}
        <header
          className="sticky top-0 z-30 flex items-center gap-3 px-4 lg:px-6"
          style={{
            height: 52,
            background: 'var(--surface-1)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {/* 햄버거 (모바일 전용) */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden inline-flex items-center justify-center rounded-md"
            style={{
              width: 36,
              height: 36,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
            aria-label="메뉴 열기"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {/* 현재 페이지 타이틀 */}
          <div
            className="flex-1 truncate"
            style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}
          >
            {pageTitle}
          </div>

          {/* 우측 사용자 영역 (데스크탑) */}
          <div className="hidden sm:flex items-center gap-2">
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {email ?? displayName}
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'rgba(245,158,11,0.12)',
                color: 'var(--gold)',
                border: '1px solid rgba(245,158,11,0.4)',
              }}
            >
              👑 총관리자
            </span>
          </div>
        </header>

        {/* 메인 콘텐츠 */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-8 max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <PlatformLayoutInner>{children}</PlatformLayoutInner>
    </AuthGate>
  );
}
