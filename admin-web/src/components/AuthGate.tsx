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
  useEffect(() => {
    if (authState.status !== 'anonymous') return;
    if (isWhitelisted(pathname)) return;

    const next = isSafeNextPath(pathname) ? pathname : '';
    const dest = next
      ? `/login?next=${encodeURIComponent(next)}`
      : '/login';
    router.replace(dest);
  }, [authState.status, pathname, router]);

  // 2. KYC soft-wall redirect
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    if (isKycWhitelisted(pathname)) return;
    // userDoc undefined = 로딩 중 — 대기
    if (userDoc === undefined) return;
    // userDoc null = 문서 없음 (첫 생성 중) — 대기
    if (userDoc === null) return;
    // kycCompletedAt 있으면 통과
    if (userDoc.kycCompletedAt) return;

    // KYC 미완료 — returnTo 저장 후 redirect
    try {
      if (isSafeNextPath(pathname)) {
        sessionStorage.setItem('kycReturnTo', pathname);
      }
    } catch {
      // sessionStorage 실패 무시
    }
    router.replace('/onboarding/kyc');
  }, [authState.status, pathname, router, userDoc]);

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

  // KYC 미완료이고 현재 경로가 KYC 화이트리스트 아닌 경우 스플래시 유지
  if (
    userDoc !== null &&
    !userDoc.kycCompletedAt &&
    !isKycWhitelisted(pathname)
  ) {
    return <>{loadingFallback ?? <AppSplash />}</>;
  }

  return <>{children}</>;
}
