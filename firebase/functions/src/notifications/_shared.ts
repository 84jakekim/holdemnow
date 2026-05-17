/**
 * 알림 함수 공통 헬퍼. uid 목록 → FCM 토큰 모으기 + 발송 + 만료 토큰 정리.
 */

import * as admin from 'firebase-admin';

export interface TokenDoc {
  uid: string;
  tokenId: string;
  token: string;
}

/** uid 목록 → 각 사용자의 fcmTokens 서브컬렉션을 평탄화한 토큰 배열 */
export async function gatherFcmTokens(uids: string[]): Promise<TokenDoc[]> {
  const db = admin.firestore();
  const out: TokenDoc[] = [];
  await Promise.all(
    uids.map(async (uid) => {
      const snap = await db.collection('users').doc(uid).collection('fcmTokens').get();
      snap.forEach((d) => {
        const v = d.data() as { token?: string };
        if (v.token) out.push({ uid, tokenId: d.id, token: v.token });
      });
    }),
  );
  return out;
}

/** FCM 일괄 발송 + 만료/무효 토큰 자동 정리. 성공 카운트 반환. */
export async function sendAndCleanup(
  tokenDocs: TokenDoc[],
  payload: { title: string; body: string; data: Record<string, string>; url: string; tag?: string },
): Promise<{ successCount: number; failureCount: number }> {
  if (tokenDocs.length === 0) return { successCount: 0, failureCount: 0 };
  const db = admin.firestore();
  const messaging = admin.messaging();

  const messages: admin.messaging.Message[] = tokenDocs.map(({ token }) => ({
    token,
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
    webpush: {
      notification: {
        icon: '/icon-app.svg',
        badge: '/icon-app.svg',
        tag: payload.tag,
      },
      fcmOptions: { link: payload.url },
    },
  }));

  const resp = await messaging.sendEach(messages);

  // 만료/무효 토큰 정리
  const cleanups: Promise<unknown>[] = [];
  resp.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        const { uid, tokenId } = tokenDocs[i];
        cleanups.push(
          db.collection('users').doc(uid).collection('fcmTokens').doc(tokenId).delete(),
        );
      }
    }
  });
  if (cleanups.length > 0) await Promise.allSettled(cleanups);

  return { successCount: resp.successCount, failureCount: resp.failureCount };
}

/**
 * uid 목록을 사용자 prefs 키 기준으로 필터링.
 * 기본 동작: pref가 없거나 undefined면 defaultOn에 따라 결정.
 */
export async function filterByPrefs(
  uids: string[],
  prefKey: 'favLive' | 'tournamentStart' | 'lateRegImminent' | 'marketing',
  defaultOn: boolean,
): Promise<string[]> {
  if (uids.length === 0) return [];
  const db = admin.firestore();
  const allowed: string[] = [];
  await Promise.all(
    uids.map(async (uid) => {
      const u = await db.collection('users').doc(uid).get();
      const prefs = u.data()?.notificationPrefs as Record<string, boolean | undefined> | undefined;
      const v = prefs?.[prefKey];
      if (v === true) allowed.push(uid);
      else if (v === false) return;
      else if (defaultOn) allowed.push(uid); // 미설정 시 default
    }),
  );
  return allowed;
}

/** Firestore 서브컬렉션 경로(`users/{uid}/...`)에서 uid 추출 */
export function uidFromPath(refPath: string): string | null {
  const parts = refPath.split('/');
  const idx = parts.indexOf('users') + 1;
  return idx > 0 && parts[idx] ? parts[idx] : null;
}
