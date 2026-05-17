'use client';

import { startKakaoLogin } from '@/lib/kakaoAuth';
import { loginAsPlayerWithGoogle } from '@/lib/auth';

/**
 * 모바일 페이지(즐겨찾기, 마이 등)에서 비로그인 사용자에게 보이는 로그인 안내.
 * 카카오 + Google 둘 다 일반 사용자(player)로 로그인.
 */
export default function AnonymousPrompt({
  title,
  icon,
  desc,
}: {
  title: string;
  icon: string;
  desc: string;
}) {
  const handleKakao = async () => {
    try {
      // 현재 페이지로 돌아오기 위해 pathname을 returnTo로 전달
      const returnTo = typeof window !== 'undefined' ? window.location.pathname : '/m';
      await startKakaoLogin(returnTo);
    } catch (e: unknown) {
      alert(`카카오 로그인 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const handleGoogle = async () => {
    try {
      await loginAsPlayerWithGoogle();
    } catch (e: unknown) {
      alert(`로그인 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div>
      <div className="px-5 h-14 flex items-center border-b border-gray-100">
        <span className="text-xl font-extrabold tracking-tight font-serif">{title}</span>
      </div>
      <div className="p-8 text-center">
        <div className="text-4xl mb-3">{icon}</div>
        <div className="font-bold text-gray-900 mb-2">로그인이 필요합니다</div>
        <div className="text-xs text-gray-500 leading-relaxed mb-6 max-w-xs mx-auto">{desc}</div>
        <div className="space-y-2 max-w-xs mx-auto">
          <button
            onClick={handleKakao}
            className="w-full bg-[#FEE500] text-[#181600] py-3 rounded-xl font-bold text-sm hover:opacity-90 transition flex items-center justify-center gap-2"
          >
            <span>💬</span>
            <span>카카오로 시작하기</span>
          </button>
          <button
            onClick={handleGoogle}
            className="w-full bg-white border border-gray-300 text-gray-900 py-3 rounded-xl font-bold text-sm hover:bg-gray-50 transition flex items-center justify-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span>Google로 시작하기</span>
          </button>
        </div>
      </div>
    </div>
  );
}
