'use client';

import { httpsCallable, getFunctions } from 'firebase/functions';
import { collection, getDocs, query, orderBy, limit as fsLimit } from 'firebase/firestore';
import { app, db } from '@/lib/firebase';

/**
 * 본사 관리자가 특정 사용자에게 비밀번호 재설정 이메일 발송.
 * Cloud Function이 platform_admin 권한 검증 + Firebase Auth가 메일 발송.
 */
export async function sendPasswordResetByAdmin(input: {
  targetUid?: string;
  targetEmail?: string;
}): Promise<{ success: true; sentTo: string }> {
  const functions = getFunctions(app, 'asia-northeast3');
  const fn = httpsCallable<typeof input, { success: true; sentTo: string }>(
    functions,
    'sendPasswordResetByAdmin',
  );
  const res = await fn(input);
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
