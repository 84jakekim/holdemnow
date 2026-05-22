'use client';

/**
 * AuthGate — 인증 상태 기반 라우팅 게이트
 *
 * 우선순위:
 * 1. loading  → <AppSplash />
 * 2. anonymous → /login?next=<현재경로> (화이트리스트 경로 제외)
 * 3. authenticated 인데 path와 role 불일치 → 차단 안내 카드 (signOut 옵션)
 * 4. authenticated → children 렌더
 *
 * Path-vs-role 게이팅 (2026-05-22 신설 — 사장님 보고: PWA 재진입 시 매장 어드민
 * 계정이 일반 사용자 앱으로 통과되던 문제):
 *  - /m/*       → player 만 (storeId/organizerId 박힌 계정 차단)
 *  - /admin/*   → store_master / store_staff / platform_admin 만 (player 차단)
 *  - /organizer/*  → organizer_master / organizer_staff / platform_admin 만
 *  - /platform/*   → platform_admin 만 (자체 layout에서 추가 검증)
 *
 * 일반 로그인 페이지(/login)의 wrongRole 안내는 "로그인 직후" 한 번만 작동하므로,
 * 이미 세션이 살아있는 상태(PWA 재진입)에서는 AuthGate가 보강해야 함.
 */

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole, type UserDoc } from '@/lib/hooks';
import AppSplash from './AppSplash';

// anonymous 접근을 허용하는 경로 (로그인/가입/콜백/키오스크)
const ANONYMOUS_WHITELIST = [
  '/login',
  '/login/recover',
  '/signup',
  '/signup/store',
  '/signup/organizer',
  '/signup/player',
  '/admin-login',
  '/organizer-login',
  '/organizer-signup',
  '/platform-login',  // 본사 관리자 전용 로그인 — anonymous 허용
  '/auth/kakao/callback',
  '/display',
  '/onboarding/kyc',
];

// KYC redirect 없이 통과할 경로 (KYC 페이지 자체 + 화이트리스트)
const KYC_WHITELIST = [
  '/onboarding/kyc',
  '/login',
  '/login/recover',
  '/signup',
  '/admin-login',
  '/organizer-login',
  '/organizer-signup',
  '/platform-login',  // 본사 관리자 로그인 페이지도 KYC 면제
  '/auth/kakao/callback',
  '/display',
];

function isWhitelisted(pathname: string): boolean {
  return ANONYMOUS_WHITELIST.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}

function isKycWhitelisted(pathname: string): boolean {
  return KYC_WHITELIST.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}

// next= 파라미터로 허용할 경로 패턴 (오픈 리다이렉트 방지)
function isSafeNextPath(path: string): boolean {
  return path.startsWith('/m') || path.startsWith('/admin') || path.startsWith('/platform') || path.startsWith('/organizer');
}

// ───────────────────────────────────────────────────────────────
// Path-vs-role 게이팅 — 2026-05-22 신설
// 사장님 보고: 매장 어드민으로 로그인 후 PWA 종료 → 재진입 시 같은 계정이
// 일반 사용자 앱(/m)으로 통과되던 문제. 계정 분리를 PWA 재진입 시점에도 강제.
// ───────────────────────────────────────────────────────────────

type AccountKind = 'platform_admin' | 'store' | 'organizer' | 'player';

function classifyAccount(doc: UserDoc | null | undefined): AccountKind | null {
  if (doc === undefined) return null;
  if (!doc) return 'player'; // 문서 없으면 OAuth 첫 로그인 직후 — player로 간주
  // platform_admin이 가장 강력. 단, storeId/organizerId도 있을 수 있으므로 우선 검사.
  if (hasRole(doc, 'platform_admin')) return 'platform_admin';
  if (doc.storeId) return 'store';
  if (doc.organizerId) return 'organizer';
  return 'player';
}

function isPathAllowedForKind(pathname: string, kind: AccountKind): boolean {
  // /m/* — 일반 사용자 앱. player 만 통과.
  if (pathname === '/m' || pathname.startsWith('/m/')) {
    return kind === 'player';
  }
  // /admin/* — 매장 어드민. store 만 통과 (platform_admin은 별도 진입 — 본사가
  // 매장 어드민으로 진입할 때는 /admin/{storeId}/ 페이지 내부에서 추가 허용).
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return kind === 'store' || kind === 'platform_admin';
  }
  // /organizer/* — 대회사. organizer + platform_admin.
  if (pathname === '/organizer' || pathname.startsWith('/organizer/')) {
    return kind === 'organizer' || kind === 'platform_admin';
  }
  // /platform/* — 본사. platform_admin 만 (layout 자체 검증 있음).
  if (pathname === '/platform' || pathname.startsWith('/platform/')) {
    return kind === 'platform_admin';
  }
  // 그 외 — 통과 (예: /onboarding, /login 등은 이미 ANONYMOUS_WHITELIST에서 처리)
  return true;
}

function getRedirectPathForKind(kind: AccountKind): string {
  if (kind === 'platform_admin') return '/platform';
  if (kind === 'store') return '/login/business';
  if (kind === 'organizer') return '/login/business';
  return '/m';
}

function getKindLabel(kind: AccountKind): { title: string; desc: string; cta: string; href: string } {
  switch (kind) {
    case 'platform_admin':
      return {
        title: '본사 관리자 계정',
        desc: '본사 관제 페이지로 이동해 주세요.',
        cta: '본사 관제로 이동',
        href: '/platform',
      };
    case 'store':
      return {
        title: '매장 어드민 계정',
        desc: '매장 어드민 페이지로 이동하거나, 다른 계정으로 로그인해 주세요.',
        cta: '매장 어드민 로그인으로',
        href: '/login/business',
      };
    case 'organizer':
      return {
        title: '대회사 계정',
        desc: '대회사 어드민 페이지로 이동하거나, 다른 계정으로 로그인해 주세요.',
        cta: '대회사 어드민 로그인으로',
        href: '/login/business',
      };
    case 'player':
    default:
      return {
        title: '일반 사용자 계정',
        desc: '일반 사용자 앱으로 이동하거나, 다른 계정으로 로그인해 주세요.',
        cta: '사용자 앱으로 이동',
        href: '/m',
      };
  }
}

type Props = {
  children: React.ReactNode;
  loadingFallback?: React.ReactNode;
};

export default function AuthGate({ children, loadingFallback }: Props) {
  const authState = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [signingOut, setSigningOut] = useState(false);

  // userDoc 구독 — authenticated 상태에서만 uid 전달
  const uid = authState.status === 'authenticated' ? authState.user.uid : null;
  const userDoc = useUserDoc(uid);

  // 1. anonymous redirect
  //    - /platform/* 영역은 본사 전용 로그인(/platform/login)으로 분리
  //    - 그 외는 일반 통합 로그인(/login)으로
  useEffect(() => {
    if (authState.status !== 'anonymous') return;
    if (isWhitelisted(pathname)) return;

    const next = isSafeNextPath(pathname) ? pathname : '';
    const isPlatformArea = pathname === '/platform' || pathname.startsWith('/platform/');
    const base = isPlatformArea ? '/platform-login' : '/login';
    const dest = next ? `${base}?next=${encodeURIComponent(next)}` : base;
    router.replace(dest);
  }, [authState.status, pathname, router]);

  // 2. KYC soft-wall — 비활성화.
  //    사장님 보고: 앱 진입할 때마다 본인확인이 떠서 불편.
  //    KYC 페이지(/onboarding/kyc)는 자체적으로 존재하되 AuthGate가 강제하지 않음.
  //    실명·전화번호 등 본인 확인은 진짜 필요한 액션(예약 신청·매장 가입 등) 시점에만 요구.

  if (authState.status === 'loading') {
    return <>{loadingFallback ?? <AppSplash />}</>;
  }

  if (authState.status === 'anonymous') {
    return <>{loadingFallback ?? <AppSplash />}</>;
  }

  // authenticated — userDoc 로딩 중이거나 KYC redirect 대기 중
  if (userDoc === undefined) {
    return <>{loadingFallback ?? <AppSplash />}</>;
  }

  // 3. Path-vs-role 검증 — 화이트리스트 경로는 통과 (로그인/가입/온보딩/콜백/display).
  //    그 외 보호 영역(/m, /admin, /organizer, /platform)에서 계정 유형과 불일치 시
  //    안내 카드를 띄우고 자동 라우팅하지 않음. 사용자가 직접 "이동" 또는 "다른 계정"을 선택.
  if (!isWhitelisted(pathname)) {
    const kind = classifyAccount(userDoc);
    if (kind && !isPathAllowedForKind(pathname, kind)) {
      const label = getKindLabel(kind);
      const userEmail = authState.user.email ?? '(이메일 없음)';
      return (
        <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
          <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <div className="text-4xl mb-3" aria-hidden="true">🔒</div>
            <p className="text-base font-extrabold text-gray-900 mb-2">
              {label.title}으로 로그인되어 있습니다
            </p>
            <p className="text-xs text-gray-600 leading-relaxed mb-5">
              현재 페이지는 이 계정 유형에서 접근할 수 없습니다.<br />
              <span className="font-medium text-gray-500">({userEmail})</span><br />
              {label.desc}
            </p>
            <div className="flex flex-col gap-2">
              <Link
                href={getRedirectPathForKind(kind)}
                className="block w-full px-4 py-3 rounded-xl text-white text-sm font-extrabold text-center"
                style={{ background: '#FF1F8F' }}
              >
                {label.cta}
              </Link>
              <button
                onClick={async () => {
                  if (signingOut) return;
                  setSigningOut(true);
                  try {
                    await signOut(auth);
                    // signOut 후 AuthGate가 anonymous로 인식 → 적절한 로그인 페이지로 redirect.
                    // 사용자가 명시적으로 다른 계정으로 로그인하려는 의도 → /login으로 강제.
                    router.replace('/login');
                  } finally {
                    setSigningOut(false);
                  }
                }}
                className="block w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
                disabled={signingOut}
              >
                {signingOut ? '로그아웃 중…' : '다른 계정으로 로그인'}
              </button>
            </div>
          </div>
        </main>
      );
    }
  }

  // KYC 강제 게이트 제거 — 사장님 정책: 본인확인은 실제 액션 시점에만 요구.
  return <>{children}</>;
}
