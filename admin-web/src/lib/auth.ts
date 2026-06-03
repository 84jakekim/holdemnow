'use client';

import { GoogleAuthProvider, signInWithPopup, type User } from 'firebase/auth';
import { auth } from './firebase';

/**
 * Firebase Auth User → providers 배열 도출.
 *
 * 회원관리 "로그인 방법" 표시의 단일 진실 원천. providerData를 우선으로 매핑하고,
 * 카카오 custom token은 providerData에 안 잡히므로 uid 접두사로 보정한다.
 *  - providerData[].providerId: 'google.com'→'google', 'password'→'password', 그 외는 원본 유지
 *  - uid가 'kakao:'로 시작 → ['kakao'] (custom token이라 providerData가 비어 있음)
 *
 * ⚠️ 가입/세션 재진입 fallback에서 providers를 하드코딩하지 말 것.
 *    과거 'google' 하드코딩으로 이메일·카카오 사용자가 "구글"로 오표시되던 버그가 있었음.
 */
export function deriveProviders(user: User): string[] {
  // 카카오 custom token — providerData에 잡히지 않으므로 uid로 판별
  if (user.uid.startsWith('kakao:')) return ['kakao'];

  const mapped = (user.providerData ?? [])
    .map((p) => p?.providerId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => {
      if (id === 'google.com') return 'google';
      if (id === 'password') return 'password';
      return id; // 그 외(예: 'facebook.com')는 원본 id 유지
    });

  // 중복 제거 (순서 보존)
  return Array.from(new Set(mapped));
}

/**
 * providers 배열 → signupSource 값 도출.
 * password가 포함되면 이메일 가입('email'), 소셜(google/kakao 등)만 있으면 'oauth'.
 * (기존 emailAuth.ts의 '*-signup' 컨벤션과는 별개의, OAuth 신규 생성 경로 전용 값)
 */
export function deriveSignupSource(providers: string[]): 'email' | 'oauth' {
  return providers.includes('password') ? 'email' : 'oauth';
}

/**
 * 로그인 의도 추적 — Google 로그인은 사용자/사장 둘 다 가능하므로
 * 어느 페이지에서 시작했는지를 sessionStorage에 저장 → /page.tsx 라우팅에서 사용.
 *
 * 'player': 일반 사용자 (모바일 앱). 신규 가입 시 자동으로 role=player 문서 생성.
 * 'store':  매장 사장. 신규 가입 시 /signup 매장 가입 마법사로 이동.
 *
 * Kakao 로그인은 Cloud Function이 무조건 role=player로 문서 생성하므로 의도 추적 불필요.
 */

const INTENT_KEY = 'hn-login-intent';

export type LoginIntent = 'player' | 'store' | 'organizer';

export function setLoginIntent(intent: LoginIntent) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(INTENT_KEY, intent);
  } catch {
    // private mode 등 — 무시. 기본 'store' fallback이 됨.
  }
}

export function getLoginIntent(): LoginIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = sessionStorage.getItem(INTENT_KEY);
    return v === 'player' || v === 'store' || v === 'organizer' ? v : null;
  } catch {
    return null;
  }
}

export function clearLoginIntent() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(INTENT_KEY);
  } catch {
    // ignore
  }
}

/** 일반 사용자로 Google 로그인 (홈 + 모바일 페이지 anonymous 상태에서 호출) */
export async function loginAsPlayerWithGoogle(): Promise<void> {
  setLoginIntent('player');
  await signInWithPopup(auth, new GoogleAuthProvider());
}

/** 매장 사장으로 Google 로그인 (/admin-login 페이지에서 호출) */
export async function loginAsStoreOwnerWithGoogle(): Promise<void> {
  setLoginIntent('store');
  await signInWithPopup(auth, new GoogleAuthProvider());
}

/** 대회사 어드민으로 Google 로그인 (/organizer-login 페이지에서 호출) */
export async function loginAsOrganizerWithGoogle(): Promise<void> {
  setLoginIntent('organizer');
  await signInWithPopup(auth, new GoogleAuthProvider());
}
