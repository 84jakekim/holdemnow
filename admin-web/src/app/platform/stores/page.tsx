'use client';

/**
 * /platform/stores — deprecated
 * → /platform/members?tab=stores 로 redirect
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PlatformStoresRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/platform/members?tab=stores');
  }, [router]);
  return (
    <div className="text-sm text-gray-500">페이지를 이동 중입니다…</div>
  );
}
