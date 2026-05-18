'use client';

/**
 * /admin-login — deprecated → /login/business 으로 redirect
 * 기존 북마크·링크 호환 유지용 (매장 사장님 진입점)
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login/business');
  }, [router]);
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
      페이지를 이동 중입니다…
    </main>
  );
}
