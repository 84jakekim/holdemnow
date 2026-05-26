/**
 * 사용자가 confirmed 예약에 "취소 신청"을 보냈을 때 매장 owner에게 FCM 푸시 발송.
 *
 * 트리거: stores/{storeId}/reservations/{rid} onDocumentUpdated
 * 조건:
 *  - before.cancelRequested !== true && after.cancelRequested === true
 *  - status === 'confirmed' (보호 게이트 — 안전망)
 *
 * 흐름:
 * 1. before/after cancelRequested 변화 검사
 * 2. stores/{storeId}.ownerUid 조회 → owner FCM 토큰 일괄 발송
 * 3. data: type=reservation_cancel_request, storeId, reservationId
 * 4. deepLink → /admin/{storeId}#reservations
 *
 * PM 결정 2026-05-27: 사용자 발의 → 매장 승인 흐름.
 * 매장은 토너 준비 중에도 알림을 받아 즉시 승인/거절 가능.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatKST(ts: admin.firestore.Timestamp | undefined): string {
  if (!ts) return '';
  const d = new Date(ts.toMillis() + 9 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export const notifyStoreOnCancelRequest = onDocumentUpdated(
  {
    document: 'stores/{storeId}/reservations/{rid}',
    region: 'asia-northeast3',
  },
  async (event) => {
    const before = event.data?.before?.data() as
      | {
          cancelRequested?: boolean;
          status?: string;
        }
      | undefined;

    const after = event.data?.after?.data() as
      | {
          cancelRequested?: boolean;
          status?: string;
          storeId?: string;
          storeName?: string;
          authorName?: string;
          reservedFor?: admin.firestore.Timestamp;
          partySize?: number;
          cancelRequestReason?: string | null;
        }
      | undefined;

    if (!before || !after) return;

    // 조건: cancelRequested false → true 전환, confirmed 상태에서만.
    if (before.cancelRequested === true) return;
    if (after.cancelRequested !== true) return;
    if (after.status !== 'confirmed') return;

    const { storeId, rid } = event.params;
    const storeName = after.storeName ?? '매장';
    const authorName = after.authorName ?? '익명';
    const timeStr = formatKST(after.reservedFor);
    const partySize = after.partySize ?? 1;
    const reason = (after.cancelRequestReason ?? '').trim();

    const db = admin.firestore();
    const messaging = admin.messaging();

    // 매장 owner uid
    const storeSnap = await db.collection('stores').doc(storeId).get();
    const ownerUid = storeSnap.data()?.ownerUid as string | undefined;
    if (!ownerUid) {
      console.log(`[notifyStoreOnCancelRequest] no owner store=${storeId} rid=${rid}`);
      return;
    }

    // owner FCM 토큰
    const tokenSnap = await db
      .collection('users')
      .doc(ownerUid)
      .collection('fcmTokens')
      .get();
    if (tokenSnap.empty) {
      console.log(`[notifyStoreOnCancelRequest] no tokens owner=${ownerUid} store=${storeId}`);
      return;
    }

    const tokens = tokenSnap.docs
      .map((d) => (d.data() as { token?: string }).token)
      .filter((t): t is string => Boolean(t));
    if (tokens.length === 0) return;

    const reasonSuffix = reason ? ` (사유: ${reason})` : '';
    const body = `${authorName} · ${timeStr} ${partySize}명 — 취소 신청${reasonSuffix}`;

    const messages: admin.messaging.Message[] = tokens.map((token) => ({
      token,
      notification: {
        title: `🔔 ${storeName} — 사용자 취소 신청`,
        body,
      },
      data: {
        type: 'reservation_cancel_request',
        storeId,
        reservationId: rid,
        deepLink: `/admin/${storeId}#reservations`,
      },
      webpush: {
        fcmOptions: { link: `/admin/${storeId}#reservations` },
      },
    }));

    const resp = await messaging.sendEach(messages);
    console.log(
      `[notifyStoreOnCancelRequest] owner=${ownerUid} store=${storeId} rid=${rid} sent=${resp.successCount} failed=${resp.failureCount}`,
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
          .doc(ownerUid)
          .collection('fcmTokens')
          .doc(tokenId)
          .delete()
          .catch(() => undefined);
      });
      await Promise.all(cleanups);
      console.log(
        `[notifyStoreOnCancelRequest] cleaned up ${invalidTokens.length} invalid tokens for owner=${ownerUid}`,
      );
    }
  },
);
