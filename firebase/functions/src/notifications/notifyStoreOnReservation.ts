/**
 * 새 예약 생성 시 매장 owner에게 FCM 푸시 발송.
 *
 * 트리거: stores/{storeId}/reservations/{reservationId} onCreate
 *
 * 흐름:
 * 1. 예약 doc에서 storeId·authorName·reservedFor·partySize 추출
 * 2. stores/{storeId}.ownerUid 조회
 * 3. owner의 users/{uid}/fcmTokens 서브컬렉션 일괄 발송
 * 4. webpush link → /admin/{storeId}#reservations
 *
 * 토큰 정리 등 정밀 로직은 v0.2에서 추가 (notifyFavoriteOnLive 참고).
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

export const notifyStoreOnReservation = onDocumentCreated(
  {
    document: 'stores/{storeId}/reservations/{reservationId}',
    region: 'asia-northeast3',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as {
      storeId?: string;
      storeName?: string;
      authorName?: string;
      reservedFor?: admin.firestore.Timestamp;
      partySize?: number;
    };
    if (!data.storeId) return;

    const db = admin.firestore();
    const messaging = admin.messaging();

    // 매장 owner uid
    const storeSnap = await db.collection('stores').doc(data.storeId).get();
    const ownerUid = storeSnap.data()?.ownerUid as string | undefined;
    if (!ownerUid) return;

    // owner FCM 토큰
    const tokenSnap = await db
      .collection('users')
      .doc(ownerUid)
      .collection('fcmTokens')
      .get();
    if (tokenSnap.empty) return;

    const tokens = tokenSnap.docs
      .map((d) => (d.data() as { token?: string }).token)
      .filter((t): t is string => Boolean(t));
    if (tokens.length === 0) return;

    const reservedFor = data.reservedFor?.toDate();
    const timeStr = reservedFor
      ? `${reservedFor.getMonth() + 1}/${reservedFor.getDate()} ${String(
          reservedFor.getHours(),
        ).padStart(2, '0')}:${String(reservedFor.getMinutes()).padStart(2, '0')}`
      : '';

    const messages: admin.messaging.Message[] = tokens.map((token) => ({
      token,
      notification: {
        title: `🔔 새 예약 (${data.authorName ?? '익명'})`,
        body: `${timeStr} · ${data.partySize ?? 1}명`,
      },
      data: {
        type: 'reservation',
        storeId: data.storeId!,
        reservationId: event.params.reservationId,
        url: `/admin/${data.storeId}#reservations`,
      },
      webpush: {
        fcmOptions: { link: `/admin/${data.storeId}#reservations` },
      },
    }));

    const resp = await messaging.sendEach(messages);
    console.log(
      `[notifyStoreOnReservation] store=${data.storeId} sent=${resp.successCount} failed=${resp.failureCount}`,
    );
  },
);
