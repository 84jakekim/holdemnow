'use client';

/**
 * /platform/organizers — deprecated
 * → /platform/members?tab=organizers 로 redirect
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PlatformOrganizersRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/platform/members?tab=organizers');
  }, [router]);
  return (
    <div className="text-sm text-gray-500">페이지를 이동 중입니다…</div>
  );
}
