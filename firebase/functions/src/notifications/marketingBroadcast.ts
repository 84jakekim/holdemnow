/**
 * 마케팅 푸시 일괄 발송 (platform_admin 전용 callable).
 *
 * 입력: { title, body, url? }
 * 흐름:
 * 1. auth.token.role === 'platform_admin' 검증
 * 2. users where notificationPrefs.marketing == true 조회 (단순 query)
 * 3. 토큰 모음 + FCM 일괄 발송
 *
 * 호출 예시 (클라이언트):
 *   const fn = httpsCallable(getFunctions(app, 'asia-northeast3'), 'marketingBroadcast');
 *   await fn({ title: '주말 토너 추천', body: '...' });
 *
 * 어드민 UI는 v0.2에서 추가 예정. 현재는 Firebase Console에서 수동 호출 가능.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { gatherFcmTokens, sendAndCleanup } from './_shared';

interface MarketingInput {
  title: string;
  body: string;
  url?: string;
}

export const marketingBroadcast = onCall<MarketingInput>(
  {
    region: 'asia-northeast3',
    maxInstances: 5,
  },
  async (request) => {
    // 1. 권한 검증
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', '로그인이 필요합니다');
    }
    if (auth.token.role !== 'platform_admin') {
      throw new HttpsError('permission-denied', 'platform_admin 권한 필요');
    }

    const { title, body, url } = request.data || ({} as MarketingInput);
    if (!title || !body) {
      throw new HttpsError('invalid-argument', 'title과 body는 필수');
    }
    if (title.length > 60 || body.length > 200) {
      throw new HttpsError('invalid-argument', 'title 60자, body 200자 제한');
    }

    const db = admin.firestore();

    // 2. marketing=true 사용자 조회
    const userSnap = await db
      .collection('users')
      .where('notificationPrefs.marketing', '==', true)
      .get();

    if (userSnap.empty) {
      return { sentCount: 0, totalUsers: 0, message: '마케팅 알림 수신 동의 사용자 없음' };
    }

    const uids = userSnap.docs.map((d) => d.id);
    const tokens = await gatherFcmTokens(uids);

    if (tokens.length === 0) {
      return { sentCount: 0, totalUsers: uids.length, message: 'FCM 토큰 등록된 사용자 없음' };
    }

    // 3. 일괄 발송
    const res = await sendAndCleanup(tokens, {
      title,
      body,
      data: {
        type: 'marketing',
        url: url ?? '/m',
      },
      url: url ?? '/m',
      tag: `marketing-${Date.now()}`,
    });

    // 4. 발송 로그 (감사용)
    await db.collection('marketingBroadcasts').add({
      title,
      body,
      url: url ?? null,
      sentBy: auth.uid,
      targetUsers: uids.length,
      tokensFound: tokens.length,
      successCount: res.successCount,
      failureCount: res.failureCount,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      sentCount: res.successCount,
      totalUsers: uids.length,
      tokensTried: tokens.length,
      failureCount: res.failureCount,
    };
  },
);
