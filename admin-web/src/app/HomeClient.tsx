'use client';

/**
 * / — 순수 dispatcher
 *
 * 인증 상태 + role을 판정하여 올바른 경로로 replace.
 * UI는 AppSplash 또는 "이동 중…" 텍스트만 노출.
 * Anonymous는 AuthGate 없음 — 직접 /login으로 보냄.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { getLoginIntent, clearLoginIntent } from '@/lib/auth';
import AppSplash from '@/components/AppSplash';

export default function Home() {
  const router = useRouter();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);

  useEffect(() => {
    // anonymous → /login
    if (authState.status === 'anonymous') {
      router.replace('/login');
      return;
    }
    if (authState.status !== 'authenticated') return;

    const uid = authState.user.uid;

    // 카카오 UID는 항상 player — userDoc 로딩 전에도 즉시 처리
    if (uid.startsWith('kakao:')) {
      if (userDoc && userDoc.storeId) {
        router.replace(`/admin/${userDoc.storeId}`);
        return;
      }
      // userDoc 없거나 storeId 없으면 /m
      if (userDoc !== undefined) {
        router.replace('/m');
      }
      return;
    }

    // userDoc 로딩 대기
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
      // player 또는 기타 role
      router.replace('/m');
      return;
    }

    // userDoc null (Google 첫 로그인 또는 세션 재진입)
    const intent = getLoginIntent();
    if (intent === 'store') {
      clearLoginIntent();
      router.replace('/signup/store');
      return;
    }
    if (intent === 'organizer') {
      clearLoginIntent();
      router.replace('/signup/organizer');
      return;
    }
    // intent='player' 또는 없음 → player로 문서 생성 후 /m
    clearLoginIntent();
    setDoc(
      doc(db, 'users', uid),
      {
        uid,
        role: 'player',
        roles: ['player'],
        email: authState.user.email ?? null,
        displayName: authState.user.displayName ?? null,
        providers: ['google'],
        signupSource: 'oauth',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {});
    // setDoc 후 onSnapshot이 새 doc을 받아오면 위 분기에서 /m으로 이동
  }, [authState, userDoc, router]);

  // 항상 Splash 또는 "이동 중…"만 표시
  if (authState.status === 'loading') {
    return <AppSplash />;
  }
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
      이동 중…
    </main>
  );
}
