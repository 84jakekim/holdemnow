'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';

export default function Home() {
  const router = useRouter();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);

  // 로그인 + role/매장 매핑 결정되면 자동 라우팅
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
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
    // 매장 미가입 → 가입 마법사
    router.replace('/signup');
  }, [authState, userDoc, router]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`로그인 실패: ${msg}`);
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
        <h1 className="text-lg font-bold text-gray-900 mb-2">매장 어드민</h1>
        <p className="text-xs text-gray-500 mb-8">v0.1 · 매장 사장님 전용</p>
        <button
          onClick={handleLogin}
          className="w-full bg-black text-white py-3 rounded-xl font-bold text-sm hover:bg-gray-900 transition"
        >
          Google 로그인
        </button>
        <p className="text-[10px] text-gray-400 mt-6 leading-relaxed">
          최초 로그인 시 자동으로 매장 가입 마법사로 이동합니다.
        </p>
      </div>
    </main>
  );
}
