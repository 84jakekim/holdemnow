'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { startKakaoLogin } from '@/lib/kakaoAuth';
import { loginAsPlayerWithGoogle, getLoginIntent, clearLoginIntent } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);

  // 로그인 후 자동 라우팅
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    const uid = authState.user.uid;

    // Kakao uid는 항상 player — userDoc propagation 지연을 회피하기 위해 즉시 라우팅
    if (uid.startsWith('kakao:')) {
      if (userDoc && userDoc.storeId) {
        router.replace(`/admin/${userDoc.storeId}`);
        return;
      }
      router.replace('/m');
      return;
    }

    // Google 등 — userDoc 로딩 대기
    if (userDoc === undefined) return;

    // 문서 있음 — role/storeId 기반 라우팅
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
      if (userDoc.role === 'player') {
        router.replace('/m');
        return;
      }
      // role 미지정 — 의도 기반 폴백 (방어용)
      router.replace('/signup');
      return;
    }

    // 문서 없음 (Google 첫 로그인 또는 옛 세션) — 의도에 따라 분기
    const intent = getLoginIntent();
    if (intent === 'store') {
      clearLoginIntent();
      router.replace('/signup');
      return;
    }
    if (intent === 'organizer') {
      clearLoginIntent();
      router.replace('/organizer-signup');
      return;
    }
    // 그 외 (intent='player' 또는 없음/만료) — 플레이어로 처리해서 /m으로.
    // 매장 사장이 되고 싶으면 명시적으로 /admin-login을 거치게 함 — 실수로 가입되는 거 방지.
    clearLoginIntent();
    setDoc(
      doc(db, 'users', uid),
      {
        uid,
        role: 'player',
        email: authState.user.email ?? null,
        displayName: authState.user.displayName ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {});
    // setDoc 후 onSnapshot이 새 doc을 받아오면 위 분기에서 /m으로 이동
  }, [authState, userDoc, router]);

  const handleKakaoLogin = async () => {
    try {
      await startKakaoLogin('/');
    } catch (e: unknown) {
      alert(`카카오 로그인 시작 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await loginAsPlayerWithGoogle();
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
    <main className="min-h-screen flex flex-col bg-gradient-to-b from-white to-gray-50 relative">
      {/* 우상단: 사장·대회사 로그인 진입점 */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
        <Link
          href="/admin-login"
          className="text-[11px] text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
        >
          매장 사장이신가요? →
        </Link>
        <Link
          href="/organizer-login"
          className="text-[11px] text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
        >
          대회사이신가요? →
        </Link>
      </div>

      {/* 중앙: 로고 + 앱 이름 + 로그인 */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8">
        <div className="flex flex-col items-center mb-12">
          <div className="w-20 h-20 rounded-3xl bg-[#0A0E0C] flex items-center justify-center mb-5 shadow-lg">
            <span className="text-3xl font-extrabold text-[#D4AF37] tracking-tight font-serif">H</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight font-serif text-gray-900">
            HoldemNow
          </h1>
          <p className="text-xs text-gray-500 mt-2">전국 홀덤펍 · 토너먼트 디스커버리</p>
        </div>

        <div className="w-full max-w-xs space-y-2.5">
          {/* 카카오 (메인) */}
          <button
            onClick={handleKakaoLogin}
            className="w-full bg-[#FEE500] text-[#181600] py-3.5 rounded-xl font-bold text-sm hover:opacity-90 transition flex items-center justify-center gap-2"
          >
            <span className="text-base">💬</span>
            <span>카카오로 시작하기</span>
          </button>

          {/* Google (보조) */}
          <button
            onClick={handleGoogleLogin}
            className="w-full bg-white border border-gray-300 text-gray-900 py-3.5 rounded-xl font-bold text-sm hover:bg-gray-50 transition flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span>Google로 시작하기</span>
          </button>
        </div>

        <p className="text-[10px] text-gray-400 mt-8 leading-relaxed text-center max-w-xs">
          로그인 시 이용약관 및 개인정보 처리방침에 동의한 것으로 간주합니다.
          <br />
          v0.1 데모 · 정보 제공 플랫폼 (사행성 매개 X)
        </p>
      </div>
    </main>
  );
}
