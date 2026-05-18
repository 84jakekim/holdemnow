'use client';

/**
 * /signup — 구 OAuth 매장 가입 마법사 (deprecated)
 * → /signup/store 로 redirect
 *
 * 기존 OAuth로 가입된 매장 사장 계정은 그대로 작동 (데이터 호환 유지).
 * 신규 가입은 Email/Password 자체 가입(/signup/store)으로 통일.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SignupRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/signup/store');
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
      페이지를 이동 중입니다…
    </main>
  );
}
