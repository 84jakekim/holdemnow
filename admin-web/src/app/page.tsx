'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { startKakaoLogin } from '@/lib/kakaoAuth';

export default function Home() {
  const router = useRouter();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);

  // 로그인 + role/매장 매핑 결정되면 자동 라우팅
  useEffect(() => {
    if (authState.status !== 'authenticated') return;

    // Kakao uid는 `kakao:XXX` 형식 — userDoc propagation 지연을 피하기 위해 uid prefix로 즉시 판단.
    // Kakao 사용자가 매장도 운영하는 경우는 storeId가 박혀있을 때만 어드민으로.
    const uid = authState.user.uid;
    if (uid.startsWith('kakao:')) {
      if (userDoc && userDoc.storeId) {
        router.replace(`/admin/${userDoc.storeId}`);
        return;
      }
      router.replace('/m');
      return;
    }

    if (userDoc === undefined) return; // 로딩 중
    // 본사 관리자 role 있고 매장 미가입이면 본사로
    if (userDoc && hasRole(userDoc, 'platform_admin') && !userDoc.storeId) {
      router.replace('/platform');
      return;
    }
    // 매장 가입됨 → 매장 어드민
    if (userDoc && userDoc.storeId) {
      router.replace(`/admin/${userDoc.storeId}`);
      return;
    }
    // 대회사만 등록된 경우 → 대회사 어드민
    if (userDoc && userDoc.organizerId) {
      router.replace(`/organizer/${userDoc.organizerId}`);
      return;
    }
    // 일반 플레이어 → 모바일 피드
    if (userDoc && userDoc.role === 'player') {
      router.replace('/m');
      return;
    }
    // 그 외 (Google 로그인 후 role 미지정) → 가입 마법사
    router.replace('/signup');
  }, [authState, userDoc, router]);

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`로그인 실패: ${msg}`);
    }
  };

  const handleKakaoLogin = async () => {
    try {
      await startKakaoLogin('/');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`카카오 로그인 시작 실패: ${msg}`);
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
    // useEffect가 라우팅함 — 잠깐 보임
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        이동 중…
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-10 max-w-sm w-full text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span className="text-xl font-extrabold tracking-tight">HoldemNow</span>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mb-2">로그인</h1>
        <p className="text-xs text-gray-500 mb-8">v0.1 · 매장 사장님·플레이어 공용</p>

        {/* 카카오 (한국 사용자 친숙도 — 메인) */}
        <button
          onClick={handleKakaoLogin}
          className="w-full bg-[#FEE500] text-[#181600] py-3 rounded-xl font-bold text-sm hover:opacity-90 transition flex items-center justify-center gap-2 mb-2"
        >
          <span className="text-base">💬</span>
          <span>카카오로 시작하기</span>
        </button>

        {/* Google (보조) */}
        <button
          onClick={handleGoogleLogin}
          className="w-full bg-black text-white py-3 rounded-xl font-bold text-sm hover:bg-gray-900 transition"
        >
          Google 로그인
        </button>

        <p className="text-[10px] text-gray-400 mt-6 leading-relaxed">
          최초 로그인 시 매장 사장님은 가입 마법사로,
          <br />
          플레이어는 바로 모바일 앱으로 이동합니다.
        </p>
      </div>
    </main>
  );
}
