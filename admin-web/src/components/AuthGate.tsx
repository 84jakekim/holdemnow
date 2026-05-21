'use client';

/**
 * AuthGate — 인증 상태 기반 라우팅 게이트
 *
 * 우선순위:
 * 1. loading  → <AppSplash />
 * 2. anonymous → /login?next=<현재경로> (화이트리스트 경로 제외)
 * 3. authenticated + kycCompletedAt 없음 → /onboarding/kyc (KYC 화이트리스트 제외)
 * 4. authenticated → children 렌더
 */

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth, useUserDoc } from '@/lib/hooks';
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

type Props = {
  children: React.ReactNode;
  loadingFallback?: React.ReactNode;
};

export default function AuthGate({ children, loadingFallback }: Props) {
  const authState = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '/';

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

  // KYC 강제 게이트 제거 — 사장님 정책: 본인확인은 실제 액션 시점에만 요구.
  return <>{children}</>;
}
