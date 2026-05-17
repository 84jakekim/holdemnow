'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { loginAsStoreOwnerWithGoogle } from '@/lib/auth';

export default function AdminLoginPage() {
  const router = useRouter();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);

  // 이미 로그인된 사장 계정이면 어드민/가입 마법사로 즉시 이동
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    if (userDoc === undefined) return;

    if (userDoc) {
      if (hasRole(userDoc, 'platform_admin') && !userDoc.storeId) {
        router.replace('/platform');
        return;
      }
      if (userDoc.storeId) {
        router.replace(`/admin/${userDoc.storeId}`);
        return;
      }
      if (userDoc.organizerId) {
        router.replace(`/organizer/${userDoc.organizerId}`);
        return;
      }
      // role 'player'면 일반 사용자 — 매장 사장이 되려면 별도 작업 필요. 일단 /m으로.
      if (userDoc.role === 'player') {
        router.replace('/m');
        return;
      }
    }
    // 신규 Google 계정 (문서 없음) — 매장 가입 마법사로
    router.replace('/signup');
  }, [authState, userDoc, router]);

  const handleLogin = async () => {
    try {
      await loginAsStoreOwnerWithGoogle();
    } catch (e: unknown) {
      alert(`로그인 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (authState.status === 'loading' || (authState.status === 'authenticated' && userDoc === undefined)) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        로딩 중…
      </main>
    );
  }

  if (authState.status === 'authenticated') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        이동 중…
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-b from-gray-50 to-white relative">
      <div className="absolute top-4 left-4">
        <Link
          href="/"
          className="text-[11px] text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
        >
          ← 일반 사용자 로그인
        </Link>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8">
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-[#0A0E0C] flex items-center justify-center mb-4">
            <span className="text-xl font-extrabold text-[#D4AF37] tracking-tight font-serif">H</span>
          </div>
          <h1 className="text-xl font-extrabold tracking-tight font-serif text-gray-900">
            매장 어드민
          </h1>
          <p className="text-xs text-gray-500 mt-1.5 text-center leading-relaxed">
            HoldemNow에 매장을 등록·운영하시는 분
            <br />
            (사장님·매니저 전용)
          </p>
        </div>

        <div className="w-full max-w-xs">
          <button
            onClick={handleLogin}
            className="w-full bg-black text-white py-3.5 rounded-xl font-bold text-sm hover:bg-gray-900 transition flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span>Google로 매장 어드민 로그인</span>
          </button>
        </div>

        <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-4 max-w-xs">
          <div className="text-[11px] font-bold text-amber-900 mb-1">💡 매장 사장이 아니라면?</div>
          <div className="text-[11px] text-amber-800 leading-relaxed">
            일반 사용자(플레이어)는 <Link href="/" className="underline font-bold">메인 페이지</Link>에서
            카카오 로그인하세요.
          </div>
        </div>

        <p className="text-[10px] text-gray-400 mt-8 leading-relaxed text-center max-w-xs">
          최초 로그인 시 매장 가입 마법사로 이동합니다.
          <br />
          v0.1 데모 · 자동 승인 (v0.2부터 운영팀 심사)
        </p>
      </div>
    </main>
  );
}
