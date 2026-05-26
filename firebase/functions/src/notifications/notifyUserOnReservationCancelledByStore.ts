/**
 * 매장 측 예약 취소 시 예약자에게 FCM 푸시 발송.
 *
 * 트리거: stores/{storeId}/reservations/{rid} onDocumentUpdated
 * 조건:
 *  - before.status === 'confirmed' (또는 'pending') 에서
 *  - after.status === 'cancelled' && after.cancelledBy === 'store'
 *
 * 흐름:
 * 1. before/after status + cancelledBy 검사
 * 2. 예약자 authorUid → users/{uid}/fcmTokens 전체 조회
 * 3. admin.messaging().sendEach() 멀티캐스트
 * 4. data: type=reservation_cancelled_by_store, storeId, reservationId, deepLink
 *
 * PM 결정 2026-05-27: 사용자가 전화로 변심 통보하면 매장이 어드민에서 처리.
 * 이때 자동 발송되는 알림으로 사용자도 명확히 인지.
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

export const notifyUserOnReservationCancelledByStore = onDocumentUpdated(
  {
    document: 'stores/{storeId}/reservations/{rid}',
    region: 'asia-northeast3',
  },
  async (event) => {
    const before = event.data?.before?.data() as
      | {
          status?: string;
          cancelledBy?: string;
        }
      | undefined;

    const after = event.data?.after?.data() as
      | {
          status?: string;
          cancelledBy?: string;
          authorUid?: string;
          storeName?: string;
          reservedFor?: admin.firestore.Timestamp;
          partySize?: number;
          cancelReason?: string | null;
        }
      | undefined;

    if (!before || !after) return;

    // 조건: status 변화가 cancelled & cancelledBy='store' 신규 진입.
    // (이미 cancelled 상태였던 doc의 다른 필드 변경은 트리거하지 않음)
    if (before.status === 'cancelled') return;
    if (after.status !== 'cancelled') return;
    if (after.cancelledBy !== 'store') return;

    const authorUid = after.authorUid;
    if (!authorUid) return;

    const { storeId, rid } = event.params;
    const storeName = after.storeName ?? '매장';
    const timeStr = formatKST(after.reservedFor);
    const partySize = after.partySize ?? 1;
    const reason = (after.cancelReason ?? '').trim();

    const reasonSuffix = reason ? ` (사유: ${reason})` : '';
    const bodyText = `${storeName} ${timeStr} ${partySize}명 예약이 매장에 의해 취소되었습니다${reasonSuffix}`;

    const db = admin.firestore();
    const messaging = admin.messaging();

    // 예약자 FCM 토큰 전체 조회
    const tokenSnap = await db
      .collection('users')
      .doc(authorUid)
      .collection('fcmTokens')
      .get();

    if (tokenSnap.empty) {
      console.log(
        `[notifyUserOnReservationCancelledByStore] no tokens uid=${authorUid} rid=${rid}`,
      );
      return;
    }

    const tokens = tokenSnap.docs
      .map((d) => (d.data() as { token?: string }).token)
      .filter((t): t is string => Boolean(t));

    if (tokens.length === 0) return;

    const messages: admin.messaging.Message[] = tokens.map((token) => ({
      token,
      notification: {
        title: '예약이 매장에 의해 취소되었습니다',
        body: bodyText,
      },
      data: {
        type: 'reservation_cancelled_by_store',
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
      `[notifyUserOnReservationCancelledByStore] uid=${authorUid} store=${storeId} rid=${rid} sent=${resp.successCount} failed=${resp.failureCount}`,
    );

    // Invalid/만료 토큰 자동 정리
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
        `[notifyUserOnReservationCancelledByStore] cleaned up ${invalidTokens.length} invalid tokens for uid=${authorUid}`,
      );
    }
  },
);
