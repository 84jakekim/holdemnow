'use client';

import { httpsCallable, getFunctions } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { auth, app } from './firebase';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Kakao?: any;
  }
}

const KAKAO_JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY;

let initialized = false;

/** Kakao JS SDK 준비 + init. SDK 스크립트는 layout.tsx에서 로드. */
async function waitForKakaoSdk(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('브라우저 환경에서만');
  if (!KAKAO_JS_KEY) throw new Error('NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY 미설정');

  // SDK 로드 폴링
  const start = Date.now();
  while (!window.Kakao) {
    if (Date.now() - start > 10_000) {
      throw new Error('Kakao SDK 로드 타임아웃 (10s)');
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!initialized) {
    if (!window.Kakao.isInitialized()) {
      window.Kakao.init(KAKAO_JS_KEY);
    }
    initialized = true;
  }
  return window.Kakao;
}

/** 카카오 로그인 시작 — redirect 기반. 콜백 페이지로 돌아옴. */
export async function startKakaoLogin(returnTo: string = '/') {
  const kakao = await waitForKakaoSdk();
  const redirectUri = `${window.location.origin}/auth/kakao/callback`;
  // returnTo를 state로 전달 (콜백 이후 어디로 보낼지)
  const state = encodeURIComponent(returnTo);
  kakao.Auth.authorize({
    redirectUri,
    scope: 'profile_nickname,profile_image,account_email',
    state,
  });
}

/** 콜백 페이지에서 호출: code → customToken → Firebase 로그인. */
export async function finishKakaoLogin(code: string): Promise<void> {
  const redirectUri = `${window.location.origin}/auth/kakao/callback`;
  const functions = getFunctions(app, 'asia-northeast3');
  const callable = httpsCallable<
    { code: string; redirectUri: string },
    { customToken: string; uid: string }
  >(functions, 'kakaoCustomToken');
  const res = await callable({ code, redirectUri });
  const { customToken } = res.data;
  await signInWithCustomToken(auth, customToken);
}
