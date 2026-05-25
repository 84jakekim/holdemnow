'use client';

import { use, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, useStoreDoc, useUserDoc, hasRole } from '@/lib/hooks';
import AuthGate from '@/components/AuthGate';
import AdminAccessDenied from '@/components/admin/AdminAccessDenied';
import TournamentControlCenter from '@/components/admin/TournamentControlCenter';
import Link from 'next/link';
import StoreInfoPanel from '@/components/admin/StoreInfoPanel';
import TournamentsPanel from '@/components/admin/TournamentsPanel';
import AdsPanel from '@/components/admin/AdsPanel';
import StatsPanel from '@/components/admin/StatsPanel';
import PostsPanel from '@/components/admin/PostsPanel';
import JobsPanel from '@/components/admin/JobsPanel';
import UsedItemsPanel from '@/components/admin/UsedItemsPanel';
import DealerPoolPanel from '@/components/admin/DealerPoolPanel';
import ReservationsPanel from '@/components/admin/ReservationsPanel';
import ReviewsAdminPanel from '@/components/admin/ReviewsAdminPanel';
import AdminNotificationBell from '@/components/admin/AdminNotificationBell';
import AdminIdentityBadge from '@/components/admin/AdminIdentityBadge';
import StorePushPermissionWidget from '@/components/admin/StorePushPermissionWidget';
import { useReservationSoundAlert } from '@/hooks/useReservationSoundAlert';
import ThemeToggle from '@/components/admin/ThemeToggle';
import { useTheme } from '@/lib/theme';
import { subscribeStoreMetrics, type StoreMetrics } from '@/lib/analytics';
import { subscribeStoreReservations } from '@/lib/reservations';
import { changePassword, syncPasswordRecovery, validatePassword } from '@/lib/emailAuth';
import { RabbitLogo } from '@/components/ui';

const MENUS = [
  { id: 'dashboard', icon: '📊', label: '대시보드' },
  // 🎬 토너 운영 — LIVE + 토너 템플릿 + 디스플레이 슬롯 + 타이머 화면 설정을 한 페이지에서 통합 (2026-05-21)
  { id: 'tournament', icon: '🎬', label: '토너 운영' },
  { id: 'posts', icon: '📢', label: '오늘의 소식' },
  { id: 'jobs', icon: '💼', label: '구인' },
  { id: 'dealers', icon: '🃏', label: '딜러 풀' },
  { id: 'used', icon: '🛒', label: '중고거래' },
  { id: 'tournaments', icon: '📅', label: '예정 토너' },
  { id: 'reservations', icon: '📅', label: '예약 관리' },
  { id: 'reviews', icon: '⭐', label: '리뷰 답글' },
  { id: 'store', icon: '🏬', label: '매장 정보' },
  { id: 'ads', icon: '📣', label: '광고' },
  { id: 'stats', icon: '📈', label: '통계' },
];

// pending 매장에서 차단되는 외부 노출 메뉴 — 본사 승인 후에만 활성
// tournament는 LIVE+템플릿+디스플레이 통합 메뉴이므로 함께 차단
// 'posts'(오늘의 소식)는 패널 내부에서 status별 안내 + 작성 버튼 disable로 처리
// → 메뉴 자체는 열어둬서 사장이 미리 UI를 둘러보고 승인 후 즉시 사용 가능하게.
const PENDING_DISABLED_MENUS = new Set(['tournament', 'jobs', 'dealers', 'used', 'tournaments', 'ads']);

function AdminPageInner({ storeId }: { storeId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const authState = useAuth();
  const store = useStoreDoc(storeId);
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  const isPlatformAdmin = hasRole(userDoc, 'platform_admin');
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [showPwModal, setShowPwModal] = useState(false);
  const [unreadReservationCount, setUnreadReservationCount] = useState(0);
  // 모바일 드로어 — lg(1024px) 미만에서 햄버거로 토글
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pref, change } = useTheme('light-default');
  // 사운드 알림 훅은 early return 전에 호출 — Rules of Hooks
  useReservationSoundAlert(storeId);

  // 읽지 않은 pending 예약 카운트 구독 — 사이드바 '예약 관리' 메뉴 배지
  useEffect(() => {
    if (!storeId) return;
    const unsub = subscribeStoreReservations(
      storeId,
      (list) => {
        const unread = list.filter((r) => r.status === 'pending' && !r.readByStore).length;
        setUnreadReservationCount(unread);
      },
      () => setUnreadReservationCount(0),
    );
    return unsub;
  }, [storeId]);

  // 메뉴 전환 시 드로어 자동 닫힘
  useEffect(() => {
    setDrawerOpen(false);
  }, [activeMenu, pathname]);

  // ESC 키로 드로어 닫기
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // 드로어 열렸을 때 body 스크롤 잠금
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // 어드민 모바일 입력 줌-방지 globals.css 셀렉터용 body 마킹
  useEffect(() => {
    document.body.setAttribute('data-route', '/admin');
    return () => {
      document.body.removeAttribute('data-route');
    };
  }, []);

  if (authState.status === 'loading' || store === undefined) {
    return <main className="min-h-screen flex items-center justify-center text-sm text-gray-500">로딩 중…</main>;
  }
  // AuthGate가 anonymous를 이미 차단. 타입 좁힘 목적의 guard.
  if (authState.status !== 'authenticated') return null;

  if (store === null) {
    return (
      <main
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: 'var(--bg-sub)' }}
      >
        <div
          className="rounded-2xl p-8 max-w-sm w-full text-center"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        >
          <div className="text-4xl mb-3">⚠️</div>
          <div className="font-bold mb-2" style={{ color: 'var(--text-1)' }}>매장을 찾을 수 없습니다</div>
          <div className="text-xs mb-6" style={{ color: 'var(--text-2)' }}>URL이 잘못됐거나 매장이 삭제됐을 수 있습니다.</div>
          <button
            onClick={() => router.replace('/')}
            className="px-5 py-2 rounded-lg text-sm font-bold text-white"
            style={{ background: 'var(--brand)' }}
          >
            처음으로
          </button>
        </div>
      </main>
    );
  }

  // 본인 owner도 아니고 platform_admin도 아니면 — 어드민 접근 거부
  const currentUid = authState.user.uid;
  const isOwner = store.ownerUid === currentUid;
  if (!isOwner && !isPlatformAdmin) {
    return <AdminAccessDenied isLoggedIn myStoreId={userDoc?.storeId ?? null} />;
  }

  const isPending = store.status === 'pending';
  // platform_admin은 심사 차원에서 모든 메뉴 접근 가능. owner+pending만 메뉴 잠금.
  const isMenuLocked = (id: string) =>
    isPending && !isPlatformAdmin && PENDING_DISABLED_MENUS.has(id);

  // 현재 활성 메뉴 라벨 (상단 모바일 바 타이틀)
  const activeMenuMeta = MENUS.find((m) => m.id === activeMenu);
  const pageTitle = activeMenuMeta ? `${activeMenuMeta.icon} ${activeMenuMeta.label}` : '매장 어드민';

  // 사이드바 — 데스크탑/모바일 드로어 공용
  const SidebarContent = (
    <aside
      className="w-64 flex flex-col h-full"
      style={{ background: 'var(--surface-1)', borderRight: '1px solid var(--border)' }}
    >
        {/* 로고 + STORE OPS 워드마크 — DS v2.0: 핑크 hero 그라데이션 + RabbitLogo backdrop */}
        <div
          className="relative overflow-hidden"
          style={{
            padding: '20px 20px 18px',
            borderBottom: '1px solid var(--border)',
            background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BAA 55%, #FFB3D4 100%)',
            color: '#ffffff',
          }}
        >
          {/* Rabbit backdrop — 우상단 opacity .14 (handoff 명세) */}
          <div
            aria-hidden
            style={{ position: 'absolute', top: -18, right: -22, opacity: 0.18, pointerEvents: 'none' }}
          >
            <RabbitLogo size={120} variant="mark" />
          </div>
          {/* 우상단 미세 글로우 원 (핸드오프 hero 패턴) */}
          <div
            aria-hidden
            style={{
              position: 'absolute', top: -14, right: -14, width: 70, height: 70,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 70%)',
              pointerEvents: 'none',
            }}
          />
          <div className="relative" style={{ zIndex: 1 }}>
            <div className="flex items-center gap-2 mb-1.5">
              <RabbitLogo size={28} variant="badge" aria-label="Pink Rabbit" />
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 17,
                  letterSpacing: '-0.03em',
                  color: '#ffffff',
                  textShadow: '0 1px 4px rgba(0,0,0,0.18)',
                }}
              >
                Pink Rabbit
              </div>
            </div>
            <div
              className="text-[10px] font-extrabold"
              style={{ color: '#ffffff', letterSpacing: '0.20em', opacity: 0.94 }}
            >
              STORE OPS · 매장 운영
            </div>
          </div>
        </div>

        {/* 알림 종 + 사장 식별 뱃지 */}
        <div className="px-3 pt-2 pb-1 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <AdminIdentityBadge
            context="store"
            name={store.name}
            email={authState.user.email ?? undefined}
            subLabel={isPending ? '⏳ 심사 대기' : undefined}
          />
          {/* 모바일에서는 상단 바에 종이 있으므로 사이드바 종은 lg+에만 노출 */}
          <div className="hidden lg:block">
            <AdminNotificationBell
              storeId={storeId}
              onNavigate={() => setActiveMenu('reservations')}
            />
          </div>
        </div>

        {/* 푸시 알림 권한 위젯 — 사장이 브라우저 푸시 권한을 켜고 fcmToken을
         * 등록하는 진입점. 권한 default일 때만 큰 버튼 노출.
         * (모바일에서는 /m/my에서 별도 켜기 흐름이 이미 있음) */}
        <StorePushPermissionWidget ownerUid={authState.user.uid} />

        <nav className="flex-1 p-2 overflow-y-auto">
          {MENUS.map((m) => {
            const locked = isMenuLocked(m.id);
            const isActive = !locked && activeMenu === m.id;
            return (
              <button
                key={m.id}
                onClick={() => { if (!locked) setActiveMenu(m.id); }}
                disabled={locked}
                title={locked ? '본사 승인 후 사용 가능합니다' : undefined}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-[14px] font-bold flex items-center gap-2 mb-0.5 transition relative ${
                  locked
                    ? 'opacity-40 cursor-not-allowed'
                    : isActive
                      ? ''
                      : 'hover:bg-[var(--surface-2)] tap'
                }`}
                style={
                  isActive
                    ? {
                        background: 'rgba(255,31,143,0.10)',
                        color: 'var(--brand)',
                        borderLeft: '4px solid var(--brand)',
                        paddingLeft: '8px',
                      }
                    : { color: locked ? 'var(--text-3)' : 'var(--text-1)' }
                }
              >
                <span>{m.icon}</span>
                <span>{m.label}</span>
                {m.id === 'reservations' && unreadReservationCount > 0 && !locked && (
                  <span
                    className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-extrabold text-white tabular-nums animate-pulse"
                    style={{
                      background: '#FF1F8F',
                      boxShadow: '0 0 0 1.5px rgba(255,255,255,0.85), 0 2px 6px rgba(255,31,143,0.45)',
                      letterSpacing: '-0.02em',
                    }}
                    aria-label={`읽지 않은 예약 ${unreadReservationCount}건`}
                  >
                    {unreadReservationCount > 99 ? '99+' : unreadReservationCount}
                  </span>
                )}
                {locked && (
                  <span className="ml-auto text-[9px]" style={{ color: 'var(--text-3)' }}>🔒</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
          {/* 테마 토글 — 라이트/시스템/다크 */}
          <div className="mb-2">
            <ThemeToggle value={pref} onChange={change} />
          </div>

          {isPlatformAdmin && (
            <Link
              href="/platform"
              className="block text-[11px] font-bold rounded-md px-2.5 py-1.5"
              style={{ color: '#F59E0B', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.30)' }}
              title="본사 총관리자 화면으로 전환"
            >
              👑 본사 관리자로 전환
            </Link>
          )}
          {userDoc?.organizerId && (
            <Link
              href={`/organizer/${userDoc.organizerId}`}
              className="block text-[11px] font-bold rounded-md px-2.5 py-1.5"
              style={{ color: '#A855F7', background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.30)' }}
              title="대회사 어드민"
            >
              🏆 대회사 어드민으로 전환
            </Link>
          )}
          {/* 이메일/비번 가입자만 비밀번호 변경 표시 */}
          {authState.user.providerData?.some((p) => p.providerId === 'password') && (
            <button
              onClick={() => setShowPwModal(true)}
              className="text-[11px] font-bold underline underline-offset-2 block"
              style={{ color: 'var(--text-2)' }}
            >
              비밀번호 변경
            </button>
          )}
          <button
            onClick={() => signOut(auth)}
            className="text-xs underline"
            style={{ color: 'var(--text-2)' }}
          >
            로그아웃
          </button>
        </div>
      </aside>
  );

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg-sub)' }}>
      {/* 데스크탑 사이드바 (lg+) — 기존 UX 그대로 */}
      <div className="hidden lg:block" style={{ width: 256, flexShrink: 0 }}>
        {SidebarContent}
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
            style={{ width: 280, maxWidth: '85vw', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}
          >
            {SidebarContent}
          </div>
        </>
      )}

      {/* 비밀번호 변경 모달 */}
      {showPwModal && (
        <ChangePasswordModal
          email={authState.user.email ?? ''}
          onClose={() => setShowPwModal(false)}
        />
      )}

      {/* 메인 영역 — 모바일 상단바 + 콘텐츠 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 모바일 상단 바 (lg 미만) — 햄버거 + 페이지 타이틀 + 알림 종 */}
        <header
          className="lg:hidden sticky top-0 z-30 flex items-center gap-2 px-3"
          style={{
            height: 52,
            background: 'var(--surface-1)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center justify-center rounded-md"
            style={{
              width: 40,
              height: 40,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
            aria-label="메뉴 열기"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            {unreadReservationCount > 0 && (
              <span
                className="absolute inline-block rounded-full"
                style={{
                  top: 6,
                  left: 24,
                  width: 8,
                  height: 8,
                  background: '#FF1F8F',
                  boxShadow: '0 0 0 1.5px var(--surface-1)',
                }}
                aria-label={`알림 ${unreadReservationCount}건`}
              />
            )}
          </button>
          <div className="flex-1 truncate" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
            {pageTitle}
          </div>
          <AdminNotificationBell
            storeId={storeId}
            onNavigate={() => setActiveMenu('reservations')}
          />
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8" style={{ background: 'var(--bg-sub)' }}>
          <div className="max-w-4xl">
          {isPending && (
            <div
              className="mb-6 p-4 flex items-start gap-3"
              style={{
                background: 'rgba(245,158,11,0.10)',
                border: '1px solid rgba(245,158,11,0.35)',
                borderRadius: 'var(--r-lg)',
              }}
            >
              <div className="text-xl">⏳</div>
              <div>
                <div className="font-bold text-sm" style={{ color: '#F59E0B' }}>매장 심사 대기 중</div>
                <div className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  지금은 데모용으로 즉시 어드민 진입했지만, v0.2부터 플랫폼 운영팀 확인 후 활성화됩니다.
                  아래 메뉴는 모두 작동하며, 모바일 앱 노출만 승인 후 시작됩니다.
                </div>
              </div>
            </div>
          )}

          {activeMenu === 'dashboard' && <DashboardContent storeId={storeId} storeName={store.name} />}
          {activeMenu === 'tournament' && <TournamentControlCenter storeId={storeId} storeName={store.name} />}
          {activeMenu === 'posts' && <PostsPanel storeId={storeId} storeName={store.name} isPlatformAdmin={isPlatformAdmin} />}
          {activeMenu === 'jobs' && <JobsPanel storeId={storeId} storeName={store.name} />}
          {activeMenu === 'dealers' && <DealerPoolPanel storeId={storeId} storeName={store.name} />}
          {activeMenu === 'used' && <UsedItemsPanel storeId={storeId} storeName={store.name} storePhotoUrl={store.photoUrls?.[0]} />}
          {activeMenu === 'tournaments' && <TournamentsPanel storeId={storeId} storeName={store.name} />}
          {activeMenu === 'reservations' && <ReservationsPanel storeId={storeId} />}
          {activeMenu === 'reviews' && <ReviewsAdminPanel storeId={storeId} storeName={store.name} />}
          {activeMenu === 'store' && <StoreInfoPanel storeId={storeId} />}
          {activeMenu === 'ads' && <AdsPanel storeId={storeId} storeName={store.name} />}
          {activeMenu === 'stats' && <StatsPanel storeId={storeId} />}
          {!['dashboard', 'tournament', 'posts', 'jobs', 'dealers', 'used', 'tournaments', 'reservations', 'reviews', 'store', 'ads', 'stats'].includes(activeMenu) && (
            <ComingSoon menu={MENUS.find((m) => m.id === activeMenu)!} />
          )}
        </div>
      </main>
      </div>
    </div>
  );
}

function DashboardContent({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [metrics, setMetrics] = useState<StoreMetrics>({});
  useEffect(() => {
    const unsub = subscribeStoreMetrics(storeId, setMetrics);
    return unsub;
  }, [storeId]);

  const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();
  const kpis = [
    { label: '누적 노출', value: fmt(metrics.impressions), tag: '카드 표시 수' },
    { label: '카드 클릭', value: fmt(metrics.cardClicks), tag: '상세 진입' },
    { label: '길찾기', value: fmt(metrics.directionsClicks), tag: '카카오맵 호출' },
    { label: '전화', value: fmt(metrics.phoneClicks), tag: 'tel: 호출' },
  ];

  // 카드 공통 — 핸드오프 v3.0: r-xl(22px) + shadow-card + lift
  const cardStyle = {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-xl)',
    boxShadow: 'var(--shadow-card)',
  } as const;

  return (
    <>
      <div className="mb-6">
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>
          📊 대시보드
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
          {storeName} · 실시간 누적 지표
        </p>
      </div>

      {/* 환영 카드 — 시그니처 핑크 그라데이션 (handoff ds-card-signature) */}
      <div
        className="p-5 mb-6 lift"
        style={{
          background: 'linear-gradient(135deg, rgba(255,31,143,0.10) 0%, rgba(255,31,143,0.03) 100%)',
          border: '1px solid rgba(255,31,143,0.25)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div className="text-xs font-extrabold tracking-wider mb-1" style={{ color: 'var(--brand)' }}>
          🎉 환영합니다
        </div>
        <div className="font-bold mb-2" style={{ color: 'var(--text-1)' }}>매장 가입이 완료되었습니다.</div>
        <div className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
          좌측 메뉴에서 토너 템플릿을 먼저 만들고 LIVE 운영을 시작해보세요.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {kpis.map((k) => (
          <div key={k.label} className="p-4 lift" style={cardStyle}>
            <div className="text-[10px] font-extrabold tracking-wider mb-1.5" style={{ color: 'var(--text-2)' }}>{k.label}</div>
            <div className="mono text-xl font-extrabold" style={{ color: 'var(--text-1)' }}>{k.value}</div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{k.tag}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'LIVE 풀스크린 열기', value: fmt(metrics.liveOpens) },
          { label: '즐겨찾기 추가', value: fmt(metrics.favoriteAdds) },
        ].map((k) => (
          <div key={k.label} className="p-4 lift" style={cardStyle}>
            <div className="text-[10px] font-extrabold tracking-wider mb-1.5" style={{ color: 'var(--text-2)' }}>{k.label}</div>
            <div className="mono text-xl font-extrabold" style={{ color: 'var(--text-1)' }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="p-5" style={cardStyle}>
        <div className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>🎯 시작 가이드</div>
        <ol className="text-xs space-y-2 list-decimal list-inside leading-relaxed" style={{ color: 'var(--text-2)' }}>
          <li>좌측 <b>🎬 토너 운영</b>에 들어가 <b>🎲 템플릿 만들기</b>로 매장의 토너 종류를 등록하세요</li>
          <li>같은 화면 우측 <b>📺 TV 송출</b> 탭에서 매장 TV 슬롯을 추가하세요</li>
          <li><b>▶ 새 LIVE 시작</b>을 누르면 매장 TV와 모바일 앱에 즉시 LIVE로 노출됩니다</li>
          <li><b>🎨 화면 설정</b> 탭에서 매장 브랜드에 맞는 컬러·로고·공지를 설정할 수 있습니다</li>
          <li><b>🏬 매장 정보</b>에서 사진을 업로드하면 디스커버리 효과 +180% 추정</li>
        </ol>
      </div>
    </>
  );
}

// =====================================================================
// 비밀번호 변경 모달
// =====================================================================

function ChangePasswordModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPwConfirm, setNewPwConfirm] = useState('');
  const [updateHint, setUpdateHint] = useState(false);
  const [newHint, setNewHint] = useState('');
  const [newLast4, setNewLast4] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const pwErr = newPw ? validatePassword(newPw) : null;
  const pwMatch = newPw === newPwConfirm;
  const canSave =
    currentPw.length >= 1 &&
    !pwErr &&
    pwMatch &&
    newPw.length >= 8;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await changePassword(currentPw, newPw);
      if (updateHint) {
        await syncPasswordRecovery(email, {
          ...(newHint.trim() ? { passwordHint: newHint.trim() } : {}),
          ...(newLast4.length === 4 ? { recoveryLast4: newLast4 } : {}),
        });
      }
      setDone(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setError('현재 비밀번호가 올바르지 않습니다.');
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
      >
        {done ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M20 6L9 17l-5-5" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="font-extrabold text-gray-900 mb-1">비밀번호가 변경되었습니다</div>
            <div className="text-xs text-gray-500 mb-4">다음 로그인부터 새 비밀번호를 사용하세요.</div>
            <button onClick={onClose} className="w-full py-2.5 rounded-xl font-bold text-sm text-white" style={{ background: '#FF1F8F' }}>
              닫기
            </button>
          </div>
        ) : (
          <>
            <div className="mb-1">
              <div className="font-extrabold text-gray-900">비밀번호 변경</div>
              <div className="text-[10px] text-gray-500 mt-0.5 truncate">{email}</div>
            </div>

            <div className="space-y-3 mt-4">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">현재 비밀번호</label>
                <input
                  type="password"
                  className="pw-input"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="현재 비밀번호"
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">새 비밀번호</label>
                <input
                  type="password"
                  className="pw-input"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="영문+숫자 8자 이상"
                  autoComplete="new-password"
                />
                {newPw && pwErr && <div className="text-[11px] text-red-600 mt-0.5">{pwErr}</div>}
                {newPw && !pwErr && <div className="text-[11px] text-green-600 mt-0.5">안전한 비밀번호</div>}
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">새 비밀번호 확인</label>
                <input
                  type="password"
                  className="pw-input"
                  value={newPwConfirm}
                  onChange={(e) => setNewPwConfirm(e.target.value)}
                  placeholder="새 비밀번호를 다시 입력"
                  autoComplete="new-password"
                />
                {newPwConfirm && !pwMatch && <div className="text-[11px] text-red-600 mt-0.5">비밀번호가 일치하지 않습니다</div>}
              </div>

              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={updateHint}
                  onChange={(e) => setUpdateHint(e.target.checked)}
                  className="w-4 h-4 accent-gray-900"
                />
                <span className="text-xs text-gray-700 font-medium">비밀번호 힌트/복구 연락처도 변경</span>
              </label>

              {updateHint && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2.5">
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">새 비밀번호 힌트 (선택)</label>
                    <input
                      className="pw-input"
                      value={newHint}
                      onChange={(e) => setNewHint(e.target.value)}
                      placeholder="새 힌트 문구"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">새 복구 연락처 마지막 4자리 (선택)</label>
                    <input
                      className="pw-input font-mono tracking-widest"
                      value={newLast4}
                      onChange={(e) => setNewLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="0000"
                      maxLength={4}
                      inputMode="numeric"
                    />
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border-[1.5px] border-gray-200 font-bold text-sm">
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave || saving}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white transition disabled:opacity-40"
                style={{ background: '#FF1F8F' }}
              >
                {saving ? '변경 중…' : '변경'}
              </button>
            </div>

            <style jsx>{`
              .pw-input {
                background: #fff;
                border: 1.5px solid #e5e7eb;
                border-radius: 8px;
                padding: 9px 12px;
                font-size: 13px;
                color: #111;
                width: 100%;
                box-sizing: border-box;
                outline: none;
                transition: border-color 0.15s;
              }
              .pw-input:focus { border-color: #FF1F8F; }
            `}</style>
          </>
        )}
      </div>
    </div>
  );
}

function ComingSoon({ menu }: { menu: { icon: string; label: string; id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
          {menu.icon} {menu.label}
        </h1>
        <p className="text-sm text-gray-500 mt-1">다음 마일스톤에서 구현 예정</p>
      </div>
      <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
        <div className="text-4xl mb-3">🚧</div>
        <div className="font-bold text-gray-900 mb-2">곧 추가됩니다</div>
        <div className="text-xs text-gray-500 leading-relaxed max-w-md mx-auto">
          프로토타입에서 검증된 {menu.label} UI를 이 페이지에 Firestore 실시간 연동으로 옮기는 작업이 진행 중입니다.
        </div>
      </div>
    </div>
  );
}

export default function AdminPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = use(params);
  return (
    <AuthGate>
      <AdminPageInner storeId={storeId} />
    </AuthGate>
  );
}
