/**
 * 새 리뷰 작성 시 매장 owner에게 FCM 푸시 발송.
 *
 * 트리거: stores/{storeId}/reviews/{reviewId} onCreate
 *
 * 흐름:
 * 1. 리뷰 doc에서 rating·body·authorName 추출
 * 2. stores/{storeId}.ownerUid 조회
 * 3. owner의 users/{uid}/fcmTokens 서브컬렉션 일괄 발송
 * 4. webpush link → /admin/{storeId} 매장 어드민
 * 5. 무효 토큰 자동 정리
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { writeInAppNotification } from './_shared';

export const notifyStoreOnReview = onDocumentCreated(
  {
    document: 'stores/{storeId}/reviews/{reviewId}',
    region: 'asia-northeast3',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as {
      authorName?: string;
      rating?: number;
      body?: string;
      hidden?: boolean;
    };
    // 본사 admin이 자동 hidden 처리한 리뷰는 알림 제외
    if (data.hidden === true) return;

    const { storeId, reviewId } = event.params;
    const db = admin.firestore();
    const messaging = admin.messaging();

    // 매장 owner uid
    const storeSnap = await db.collection('stores').doc(storeId).get();
    const ownerUid = storeSnap.data()?.ownerUid as string | undefined;
    const storeName = (storeSnap.data()?.name as string) ?? '매장';
    if (!ownerUid) return;

    // owner FCM 토큰
    const tokenSnap = await db
      .collection('users')
      .doc(ownerUid)
      .collection('fcmTokens')
      .get();
    if (tokenSnap.empty) {
      console.log(`[notifyStoreOnReview] store=${storeId} ownerUid=${ownerUid} no tokens`);
      return;
    }

    const tokens = tokenSnap.docs
      .map((d) => (d.data() as { token?: string }).token)
      .filter((t): t is string => Boolean(t));
    if (tokens.length === 0) return;

    const rating = typeof data.rating === 'number' ? data.rating : 0;
    const stars = '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));
    const author = data.authorName ?? '익명';
    const bodyPreview = (data.body ?? '').slice(0, 60);

    const messages: admin.messaging.Message[] = tokens.map((token) => ({
      token,
      notification: {
        title: `⭐ 새 리뷰 (${stars})`,
        body: `${author}님: ${bodyPreview}`,
      },
      data: {
        type: 'review',
        storeId,
        reviewId,
        url: `/admin/${storeId}`,
      },
      webpush: {
        fcmOptions: { link: `/admin/${storeId}` },
      },
    }));

    const resp = await messaging.sendEach(messages);
    console.log(
      `[notifyStoreOnReview] store=${storeId} (${storeName}) rid=${reviewId} ` +
        `rating=${rating} sent=${resp.successCount} failed=${resp.failureCount}`,
    );

    // 매장 owner에게 인앱 알림 doc 작성
    await writeInAppNotification(ownerUid, {
      type: 'new_review',
      title: `새 리뷰 (${stars})`,
      body: `${author}: ${bodyPreview}`,
      linkPath: `/admin/${storeId}`,
      payload: { storeId, reviewId, rating },
    });

    // 무효 토큰 정리
    const invalidTokens: string[] = [];
    resp.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code ?? '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        invalidTokens.push(tokens[i]);
      }
    });
    if (invalidTokens.length > 0) {
      await Promise.all(
        invalidTokens.map((token) => {
          const tokenId = token.slice(0, 16);
          return db
            .collection('users')
            .doc(ownerUid)
            .collection('fcmTokens')
            .doc(tokenId)
            .delete()
            .catch(() => {});
        }),
      );
    }
  },
);
