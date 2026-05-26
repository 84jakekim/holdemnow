/**
 * 매장이 사용자 취소 신청을 거절했을 때 예약자에게 FCM 푸시 발송.
 *
 * 트리거: stores/{storeId}/reservations/{rid} onDocumentUpdated
 * 조건:
 *  - before.cancelRequested === true && after.cancelRequested === false
 *  - after.cancelRequestDeclinedAt 신규 (= before에는 없거나 다른 값)
 *  - after.status === 'confirmed' (승인이 아닌 거절 케이스만)
 *
 * 흐름:
 * 1. before/after 검사 — 거절 케이스만 통과
 * 2. 예약자 authorUid → FCM 토큰 일괄 발송
 * 3. data: type=reservation_cancel_request_declined, storeId, reservationId
 * 4. deepLink → /m/reservations
 *
 * 승인 케이스는 별도 함수 notifyUserOnReservationCancelledByStore가 처리
 * (cancelledBy='store_approved' 분기 포함).
 *
 * PM 결정 2026-05-27.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { writeInAppNotification } from './_shared';

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatKST(ts: admin.firestore.Timestamp | undefined): string {
  if (!ts) return '';
  const d = new Date(ts.toMillis() + 9 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export const notifyUserOnCancelRequestDeclined = onDocumentUpdated(
  {
    document: 'stores/{storeId}/reservations/{rid}',
    region: 'asia-northeast3',
  },
  async (event) => {
    const before = event.data?.before?.data() as
      | {
          cancelRequested?: boolean;
          status?: string;
          cancelRequestDeclinedAt?: admin.firestore.Timestamp | null;
        }
      | undefined;

    const after = event.data?.after?.data() as
      | {
          cancelRequested?: boolean;
          status?: string;
          cancelRequestDeclinedAt?: admin.firestore.Timestamp | null;
          cancelRequestDeclineReason?: string | null;
          authorUid?: string;
          storeName?: string;
          reservedFor?: admin.firestore.Timestamp;
          partySize?: number;
        }
      | undefined;

    if (!before || !after) return;

    // 거절 케이스 정의:
    // - before.cancelRequested === true (사용자가 신청 상태였음)
    // - after.cancelRequested === false (매장이 처리)
    // - after.status === 'confirmed' (취소가 아닌 유지 케이스)
    // - cancelRequestDeclinedAt이 새로 박혔거나 변경됨 (단순 신청 취소 아닌 거절)
    if (before.cancelRequested !== true) return;
    if (after.cancelRequested !== false) return;
    if (after.status !== 'confirmed') return;
    if (!after.cancelRequestDeclinedAt) return;
    // 이미 있던 declinedAt이면 중복 발송 방지 (값 비교)
    const beforeMs = before.cancelRequestDeclinedAt?.toMillis?.() ?? 0;
    const afterMs = after.cancelRequestDeclinedAt?.toMillis?.() ?? 0;
    if (beforeMs && beforeMs === afterMs) return;

    const authorUid = after.authorUid;
    if (!authorUid) return;

    const { storeId, rid } = event.params;
    const storeName = after.storeName ?? '매장';
    const timeStr = formatKST(after.reservedFor);
    const partySize = after.partySize ?? 1;
    const declineReason = (after.cancelRequestDeclineReason ?? '').trim();

    const db = admin.firestore();
    const messaging = admin.messaging();

    const tokenSnap = await db
      .collection('users')
      .doc(authorUid)
      .collection('fcmTokens')
      .get();
    if (tokenSnap.empty) {
      console.log(
        `[notifyUserOnCancelRequestDeclined] no tokens uid=${authorUid} rid=${rid}`,
      );
      return;
    }

    const tokens = tokenSnap.docs
      .map((d) => (d.data() as { token?: string }).token)
      .filter((t): t is string => Boolean(t));
    if (tokens.length === 0) return;

    const reasonSuffix = declineReason ? ` (사유: ${declineReason})` : '';
    const bodyText = `${storeName} ${timeStr} ${partySize}명 — 매장이 취소 신청을 거절했습니다${reasonSuffix}`;

    const messages: admin.messaging.Message[] = tokens.map((token) => ({
      token,
      notification: {
        title: '❌ 취소 신청이 거절되었습니다',
        body: bodyText,
      },
      data: {
        type: 'reservation_cancel_request_declined',
        storeId,
        reservationId: rid,
        deepLink: '/m/reservations',
      },
      webpush: {
        fcmOptions: { link: '/m/reservations' },
      },
    }));

    const resp = await messaging.sendEach(messages);
    console.log(
      `[notifyUserOnCancelRequestDeclined] uid=${authorUid} store=${storeId} rid=${rid} sent=${resp.successCount} failed=${resp.failureCount}`,
    );

    // 인앱 알림 doc 작성
    await writeInAppNotification(authorUid, {
      type: 'cancel_request_declined',
      title: '취소 신청 거절',
      body: bodyText,
      linkPath: '/m/reservations',
      payload: { storeId, reservationId: rid },
    });

    // 토큰 정리
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
      const cleanups = invalidTokens.map((token) => {
        const tokenId = token.slice(0, 16);
        return db
          .collection('users')
          .doc(authorUid)
          .collection('fcmTokens')
          .doc(tokenId)
          .delete()
          .catch(() => undefined);
      });
      await Promise.all(cleanups);
      console.log(
        `[notifyUserOnCancelRequestDeclined] cleaned up ${invalidTokens.length} invalid tokens for uid=${authorUid}`,
      );
    }
  },
);
