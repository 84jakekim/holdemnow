'use client';

/**
 * /onboarding/kyc — DEPRECATED
 *
 * KYC 강제 게이트는 사장님 정책 결정으로 비활성화됨.
 * 이 페이지에 진입하면 즉시 /m(또는 sessionStorage의 kycReturnTo)으로 리다이렉트.
 *
 * 본인확인은 실제 액션 시점에만 요구 (예약 신청·매장 가입 등).
 * 코드는 보존하지만 진입 시 자동으로 빠져나옴.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function KycPage() {
  const router = useRouter();

  useEffect(() => {
    let dest = '/m';
    try {
      const saved = typeof window !== 'undefined' ? window.sessionStorage.getItem('kycReturnTo') : null;
      if (saved && saved.startsWith('/')) {
        dest = saved;
        window.sessionStorage.removeItem('kycReturnTo');
      }
    } catch {
      /* ignore */
    }
    router.replace(dest);
  }, [router]);

  return (
    <main
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <div className="text-sm" style={{ color: 'var(--text-3)' }}>
        이동 중…
      </div>
    </main>
  );
}
