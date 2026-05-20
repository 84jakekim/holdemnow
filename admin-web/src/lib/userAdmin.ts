'use client';

import { httpsCallable, getFunctions } from 'firebase/functions';
import { collection, getDocs, query, orderBy, limit as fsLimit } from 'firebase/firestore';
import { app, db } from '@/lib/firebase';

/**
 * 본사 관리자가 특정 사용자에게 비밀번호 재설정 이메일 발송.
 * Cloud Function이 platform_admin 권한 검증 + Firebase Auth가 메일 발송.
 *
 * 소셜 로그인(Google/Kakao) 전용 사용자면 success=false + reason='no_password' 반환.
 */
export interface SendPasswordResetResult {
  success: boolean;
  reason?: 'no_password';
  providers?: string[];
  sentTo?: string | null;
}

export async function sendPasswordResetByAdmin(input: {
  targetUid?: string;
  targetEmail?: string;
}): Promise<SendPasswordResetResult> {
  const functions = getFunctions(app, 'asia-northeast3');
  const fn = httpsCallable<typeof input, SendPasswordResetResult>(
    functions,
    'sendPasswordResetByAdmin',
  );
  const res = await fn(input);
  return res.data;
}

/**
 * 특정 사용자의 인증 방식 조회 (platform_admin only).
 * providerData + uid 접두사로 Email/Google/Kakao 판별.
 */
export interface UserAuthInfo {
  uid: string;
  email: string | null;
  displayName: string | null;
  providers: string[];
  hasPassword: boolean;
  hasGoogle: boolean;
  hasKakao: boolean;
  createdAt: string;
  lastSignIn: string;
}

export async function getUserAuthInfo(uid: string): Promise<UserAuthInfo> {
  const fn = httpsCallable<{ uid: string }, UserAuthInfo>(
    getFunctions(app, 'asia-northeast3'),
    'getUserAuthInfo',
  );
  const res = await fn({ uid });
  return res.data;
}

/**
 * 사용자 검색 (이메일·닉네임 부분 일치) — 본사 어드민용.
 * users 컬렉션을 firestore에서 fetch + 클라이언트 필터.
 * 베타 규모(< 수천 명) OK. v0.2에서 Algolia 등 검색 전용 인프라.
 */
export interface UserSearchResult {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  role?: string | null;
  roles?: string[];
  providers?: string[]; // Firestore users doc의 providers 필드 (가입 시 기록)
  createdAt?: { toDate(): Date } | null;
}

export async function searchUsers(keyword: string, limitN: number = 50): Promise<UserSearchResult[]> {
  // 단순 fetch + 클라 filter. 최신순 N개 우선 → 키워드 매치
  const snap = await getDocs(query(
    collection(db, 'users'),
    orderBy('createdAt', 'desc'),
    fsLimit(500),  // 일단 500명 fetch 후 클라 필터 — 베타 규모에선 OK
  ));

  const kw = keyword.trim().toLowerCase();
  const rows: UserSearchResult[] = [];
  snap.forEach((d) => {
    const data = d.data() as UserSearchResult;
    if (!kw) {
      rows.push({ ...data, uid: d.id });
      return;
    }
    const matchEmail = (data.email ?? '').toLowerCase().includes(kw);
    const matchName = (data.displayName ?? '').toLowerCase().includes(kw);
    if (matchEmail || matchName) {
      rows.push({ ...data, uid: d.id });
    }
  });
  return rows.slice(0, limitN);
}
