'use client';

/**
 * 본사 어드민(platform_admin) 계정 생성·검증 유틸.
 *
 * 핵심 정책:
 *  - 사용자 입력은 **아이디 + 비밀번호** (이메일 형식 X).
 *  - Firebase Auth는 이메일 형식이 필수이므로 내부적으로
 *    `${username}@admin.pinkrabbit.local` 합성 이메일로 변환해 등록.
 *  - users/{uid} 문서에는 username/loginId/displayName/role='platform_admin'을 저장.
 *  - 로그인 시에도 동일 변환 적용 (platform-login 페이지에서 호출).
 *
 * 안전장치:
 *  - secondary Firebase App 인스턴스를 일회용으로 생성해 createUser 실행.
 *    → 본 앱 세션의 현재 로그인 admin이 새 계정으로 바뀌는 사고 방지.
 *  - aux app은 작업 후 즉시 deleteApp으로 정리.
 */

import {
  initializeApp,
  deleteApp,
  FirebaseOptions,
  type FirebaseApp,
} from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { doc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';

const ADMIN_EMAIL_DOMAIN = 'admin.pinkrabbit.local';

/** 아이디 검증 — 영문 소문자/숫자/언더스코어/하이픈 4~24자. */
export function validateAdminUsername(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: false, error: '아이디를 입력하세요' };
  if (value.length < 4) return { ok: false, error: '아이디는 4자 이상이어야 합니다' };
  if (value.length > 24) return { ok: false, error: '아이디는 24자 이하여야 합니다' };
  if (!/^[a-z0-9_-]+$/.test(value)) {
    return { ok: false, error: '영문 소문자·숫자·_·- 만 사용 가능합니다' };
  }
  return { ok: true, value };
}

export function validateAdminPassword(raw: string): { ok: true } | { ok: false; error: string } {
  if (!raw || raw.length < 8) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다' };
  return { ok: true };
}

/** 아이디 → Firebase Auth용 합성 이메일. */
export function usernameToAdminEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${ADMIN_EMAIL_DOMAIN}`;
}

/** 합성 이메일 → 아이디 추출 (디스플레이용). */
export function adminEmailToUsername(email: string | null | undefined): string | null {
  if (!email) return null;
  const lower = email.toLowerCase();
  const suffix = `@${ADMIN_EMAIL_DOMAIN}`;
  if (!lower.endsWith(suffix)) return null;
  return lower.slice(0, -suffix.length);
}

/**
 * 본사 어드민 계정 생성.
 *  - secondary Firebase App을 일회용으로 띄워서 현재 로그인 세션 보호.
 *  - users/{newUid}에 role='platform_admin' 저장.
 *
 * 호출자(클라이언트)는 본 함수를 호출하는 사용자 자신이 platform_admin인지
 * 사전 검증 후 호출 (firestore.rules도 users 컬렉션 write를 보호하지만
 * UI에서 권한 가드를 한 번 더).
 */
export async function createPlatformAdmin(input: {
  username: string;
  password: string;
  displayName?: string;
  memo?: string;
  /** 본 앱 firebase config (lib/firebase의 그것) — 호출자가 주입. */
  firebaseConfig: FirebaseOptions;
}): Promise<{ uid: string; username: string }> {
  const u = validateAdminUsername(input.username);
  if (!u.ok) throw new Error(u.error);
  const p = validateAdminPassword(input.password);
  if (!p.ok) throw new Error(p.error);

  const email = usernameToAdminEmail(u.value);

  // 일회용 secondary app — 현재 세션의 auth.currentUser 보호.
  // Firestore도 secondary app 인스턴스를 써야 함:
  //   본 앱의 db로 setDoc 하면 본 앱 auth(현재 admin)의 uid로 검증되어
  //   rules의 `uid() == userId` 통과 실패. secondary db는 새로 만든 user
  //   본인 자격으로 자기 doc을 쓰므로 rules 통과.
  const auxName = `__admin-create-${Date.now()}__`;
  let auxApp: FirebaseApp | null = null;
  try {
    auxApp = initializeApp(input.firebaseConfig, auxName);
    const auxAuth = getAuth(auxApp);
    const auxDb = getFirestore(auxApp);

    const cred = await createUserWithEmailAndPassword(auxAuth, email, input.password);
    const uid = cred.user.uid;

    // 새 user 본인 자격으로 users/{uid} 작성 — rules `uid() == userId` 통과.
    await setDoc(doc(auxDb, 'users', uid), {
      uid,
      username: u.value,
      loginId: u.value,
      email,
      displayName: input.displayName?.trim() || u.value,
      role: 'platform_admin',
      roles: ['platform_admin'],
      providers: ['password'],
      isAdminAccount: true,
      memo: input.memo?.trim() || '',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // aux 세션 사용 종료 — 본 앱 세션은 그대로 유지됨.
    await fbSignOut(auxAuth).catch(() => {});

    return { uid, username: u.value };
  } finally {
    if (auxApp) {
      await deleteApp(auxApp).catch(() => {});
    }
  }
}
