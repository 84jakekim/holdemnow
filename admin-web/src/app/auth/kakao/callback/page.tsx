'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { finishKakaoLogin } from '@/lib/kakaoAuth';

export default function KakaoCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    const kakaoError = params.get('error');
    const errorDesc = params.get('error_description');

    const returnTo = state ? decodeURIComponent(state) : '/';

    if (kakaoError) {
      setError(`카카오 로그인 취소 또는 실패: ${errorDesc || kakaoError}`);
      return;
    }
    if (!code) {
      setError('인증 code 없음 — 다시 시도해주세요');
      return;
    }

    (async () => {
      try {
        await finishKakaoLogin(code);
        router.replace(returnTo);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [params, router]);

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 max-w-sm w-full text-center">
        {error ? (
          <>
            <div className="text-4xl mb-3">⚠️</div>
            <div className="font-bold text-gray-900 mb-2">로그인 처리 중 오류</div>
            <div className="text-xs text-red-600 leading-relaxed mb-6 break-words">
              {error}
            </div>
            <button
              onClick={() => router.replace('/')}
              className="bg-black text-white px-6 py-2.5 rounded-lg font-bold text-sm"
            >
              처음으로
            </button>
          </>
        ) : (
          <>
            <div className="text-4xl mb-3">🔑</div>
            <div className="font-bold text-gray-900 mb-2">카카오 로그인 처리 중…</div>
            <div className="text-xs text-gray-500">잠시만 기다려주세요</div>
          </>
        )}
      </div>
    </main>
  );
}
