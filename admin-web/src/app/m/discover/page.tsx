'use client';

/**
 * /m/discover — /m/find?mode=map 으로 리다이렉트
 * 기존 딥링크 및 북마크 호환성 유지
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DiscoverRedirect() {
  const r = useRouter();
  useEffect(() => {
    r.replace('/m/find?mode=map');
  }, [r]);
  return (
    <main
      className="min-h-screen flex items-center justify-center text-sm"
      style={{ color: 'var(--text-3)', background: 'var(--bg)' }}
    >
      매장찾기로 이동 중…
    </main>
  );
}
