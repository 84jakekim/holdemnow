'use client';

/**
 * AuthGate — 인증 상태 기반 라우팅 게이트
 *
 * - loading  → <AppSplash /> (또는 prop으로 주입한 fallback)
 * - anonymous → /login?next=<현재경로> 로 replace (화이트리스트 경로 제외)
 * - authenticated → children 렌더
 */

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks';
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
];

function isWhitelisted(pathname: string): boolean {
  return ANONYMOUS_WHITELIST.some(
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

  useEffect(() => {
    if (authState.status !== 'anonymous') return;
    if (isWhitelisted(pathname)) return;

    const next = isSafeNextPath(pathname) ? pathname : '';
    const dest = next
      ? `/login?next=${encodeURIComponent(next)}`
      : '/login';
    router.replace(dest);
  }, [authState.status, pathname, router]);

  if (authState.status === 'loading') {
    return <>{loadingFallback ?? <AppSplash />}</>;
  }

  if (authState.status === 'anonymous') {
    // useEffect가 redirect 처리 — 그 사이 빈 화면 방지
    return <>{loadingFallback ?? <AppSplash />}</>;
  }

  return <>{children}</>;
}
