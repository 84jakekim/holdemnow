/**
 * 마케팅 푸시 일괄 발송 (platform_admin 전용 callable).
 *
 * v0.2: 본사 어드민 마케팅 캠페인 시스템.
 *   - 즉시 발송: campaignId 동봉 → 발송 후 platformCampaigns/{id}.status='sent' + 통계 기록.
 *   - 테스트 발송: testUid 동봉 → 그 사용자에게만 전송 (캠페인 doc 갱신 안 함).
 *   - 이미지·링크·광고 prefix 지원.
 *
 * 입력:
 *   {
 *     campaignId?: string,
 *     title: string,
 *     body: string,
 *     imageUrl?: string,
 *     linkUrl?: string,
 *     isAdvertisement: boolean,
 *     testUid?: string
 *   }
 *
 * 흐름:
 *   1. platform_admin 검증 (custom claim role OR users/{uid}.role/roles)
 *   2. broadcastMarketing 헬퍼 호출 (대상자 결정 + 토큰 모음 + chunk 발송 + 토큰 정리)
 *   3. campaignId && !testUid → platformCampaigns/{id}에 통계 머지
 *   4. 감사 로그(marketingBroadcasts) 1건 추가
 *
 * 호출 예시 (클라이언트):
 *   const fn = httpsCallable(getFunctions(app, 'asia-northeast3'), 'marketingBroadcast');
 *   await fn({ campaignId, title, body, imageUrl, linkUrl, isAdvertisement: true });
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { broadcastMarketing } from './_shared';

interface MarketingInput {
  campaignId?: string;
  title: string;
  body: string;
  imageUrl?: string;
  linkUrl?: string;
  isAdvertisement?: boolean;
  testUid?: string;
}

export const marketingBroadcast = onCall<MarketingInput>(
  {
    region: 'asia-northeast3',
    timeoutSeconds: 540,
    maxInstances: 5,
  },
  async (request) => {
    // 1. 권한 검증 — token claim 우선, 없으면 Firestore users/{uid}.role/roles
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', '로그인이 필요합니다');
    }

    const db = admin.firestore();
    let isAdmin = auth.token.role === 'platform_admin';
    if (!isAdmin) {
      const userSnap = await db.collection('users').doc(auth.uid).get();
      const userData = userSnap.data() as
        | { role?: string; roles?: string[] }
        | undefined;
      isAdmin =
        userData?.role === 'platform_admin' ||
        userData?.roles?.includes('platform_admin') === true;
    }
    if (!isAdmin) {
      throw new HttpsError('permission-denied', 'platform_admin 권한 필요');
    }

    // 2. 입력 검증
    const input = (request.data || {}) as MarketingInput;
    if (!input.title || !input.body) {
      throw new HttpsError('invalid-argument', 'title과 body는 필수');
    }
    if (input.title.length > 60 || input.body.length > 200) {
      throw new HttpsError('invalid-argument', 'title 60자, body 200자 제한');
    }

    const isAdvertisement = input.isAdvertisement === true;
    const testUid = input.testUid ?? null;
    const campaignId = input.campaignId ?? null;

    // 3. 발송
    const stats = await broadcastMarketing({
      campaignId,
      title: input.title,
      body: input.body,
      imageUrl: input.imageUrl ?? null,
      linkUrl: input.linkUrl ?? null,
      isAdvertisement,
      testUid,
    });

    // 4. 캠페인 통계 머지 (테스트 발송은 제외)
    if (campaignId && !testUid) {
      await db
        .collection('platformCampaigns')
        .doc(campaignId)
        .set(
          {
            status: 'sent',
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            recipientCount: stats.recipientCount,
            deliveredCount: stats.deliveredCount,
            failureCount: stats.failureCount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
    }

    // 5. 감사 로그
    await db.collection('marketingBroadcasts').add({
      campaignId,
      title: input.title,
      body: input.body,
      imageUrl: input.imageUrl ?? null,
      linkUrl: input.linkUrl ?? null,
      isAdvertisement,
      testUid,
      sentBy: auth.uid,
      recipientCount: stats.recipientCount,
      deliveredCount: stats.deliveredCount,
      failureCount: stats.failureCount,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `[marketingBroadcast] campaign=${campaignId ?? '(test/manual)'} test=${
        testUid ?? '-'
      } recipients=${stats.recipientCount} sent=${stats.deliveredCount} failed=${
        stats.failureCount
      }`,
    );

    return stats;
  },
);
