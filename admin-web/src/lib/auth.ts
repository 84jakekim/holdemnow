'use client';

import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from './firebase';

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
