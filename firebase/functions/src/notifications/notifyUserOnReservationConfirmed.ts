/**
 * 예약 확정 시 예약자에게 FCM 푸시 발송.
 *
 * 트리거: stores/{storeId}/reservations/{rid} onDocumentUpdated
 * 조건: before.status === 'pending' && after.status === 'confirmed'
 *
 * 흐름:
 * 1. before/after status 검사
 * 2. 예약자 authorUid → users/{uid}/fcmTokens 전체 조회
 * 3. admin.messaging().sendEach() 멀티캐스트
 * 4. data: type, storeId, reservationId, deepLink
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatKST(ts: admin.firestore.Timestamp | undefined): string {
  if (!ts) return '';
  // KST = UTC+9
  const d = new Date(ts.toMillis() + 9 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export const notifyUserOnReservationConfirmed = onDocumentUpdated(
  {
    document: 'stores/{storeId}/reservations/{rid}',
    region: 'asia-northeast3',
  },
  async (event) => {
    const before = event.data?.before?.data() as {
      status?: string;
      authorUid?: string;
      storeName?: string;
      reservedFor?: admin.firestore.Timestamp;
      partySize?: number;
    } | undefined;

    const after = event.data?.after?.data() as {
      status?: string;
      authorUid?: string;
      storeName?: string;
      reservedFor?: admin.firestore.Timestamp;
      partySize?: number;
    } | undefined;

    if (!before || !after) return;

    // 조건: pending → confirmed 전환만 처리
    if (before.status !== 'pending' || after.status !== 'confirmed') return;

    const authorUid = after.authorUid;
    if (!authorUid) return;

    const { storeId, rid } = event.params;
    const storeName = after.storeName ?? '매장';
    const timeStr = formatKST(after.reservedFor);
    const partySize = after.partySize ?? 1;

    const db = admin.firestore();
    const messaging = admin.messaging();

    // 예약자 FCM 토큰 전체 조회
    const tokenSnap = await db
      .collection('users')
      .doc(authorUid)
      .collection('fcmTokens')
      .get();

    if (tokenSnap.empty) return;

    const tokens = tokenSnap.docs
      .map((d) => (d.data() as { token?: string }).token)
      .filter((t): t is string => Boolean(t));

    if (tokens.length === 0) return;

    const messages: admin.messaging.Message[] = tokens.map((token) => ({
      token,
      notification: {
        title: '예약 확정',
        body: `${storeName} ${timeStr} ${partySize}명 예약이 확정되었습니다`,
      },
      data: {
        type: 'reservation_confirmed',
        storeId,
        reservationId: rid,
        deepLink: `/m/store/${storeId}`,
      },
      webpush: {
        fcmOptions: { link: `/m/store/${storeId}` },
      },
    }));

    const resp = await messaging.sendEach(messages);
    console.log(
      `[notifyUserOnReservationConfirmed] uid=${authorUid} store=${storeId} rid=${rid} sent=${resp.successCount} failed=${resp.failureCount}`,
    );
  },
);
