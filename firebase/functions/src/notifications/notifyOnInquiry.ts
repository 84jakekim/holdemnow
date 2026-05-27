/**
 * 사용자 ↔ 본사 1:1 문의 알림 (2026-05-27 신설)
 *
 * 1) notifyAdminOnNewInquiry — inquiries/{id} onCreate
 *    → 모든 platform_admin에게 FCM 푸시 + 인앱 알림
 *
 * 2) notifyUserOnInquiryReplied — inquiries/{id} onUpdate (adminReply 신규)
 *    → 문의 작성자에게 FCM 푸시 + 인앱 알림 + 본인 앱 종 카운트 +1
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { writeInAppNotificationBulk, writeInAppNotification } from './_shared';

const REGION = 'asia-northeast3';

interface InquiryData {
  uid?: string;
  userEmail?: string;
  userDisplayName?: string;
  category?: string;
  title?: string;
  body?: string;
  status?: 'pending' | 'answered' | 'closed';
  adminReply?: {
    body?: string;
    repliedBy?: string;
    repliedByName?: string;
  };
}

const CATEGORY_LABEL: Record<string, string> = {
  account: '계정·로그인',
  reservation: '예약',
  live: 'LIVE / 토너',
  community: '커뮤니티',
  bug: '오류 신고',
  feature: '기능 제안',
  etc: '기타',
};

// ───────────────────────────────────────────────────────
// 1) 새 문의 → 본사 알림
// ───────────────────────────────────────────────────────
export const notifyAdminOnNewInquiry = onDocumentCreated(
  {
    document: 'inquiries/{inquiryId}',
    region: REGION,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as InquiryData;
    const inquiryId = event.params.inquiryId;

    const title = (data.title ?? '').slice(0, 60);
    const body = (data.body ?? '').slice(0, 120);
    const userName = data.userDisplayName || data.userEmail || '익명 사용자';
    const categoryLabel = CATEGORY_LABEL[data.category ?? 'etc'] ?? '기타';

    const db = admin.firestore();
    const messaging = admin.messaging();

    // 모든 platform_admin uid 수집 (roles array-contains 또는 role 단일)
    const [bySingle, byArray] = await Promise.all([
      db.collection('users').where('role', '==', 'platform_admin').get(),
      db.collection('users').where('roles', 'array-contains', 'platform_admin').get(),
    ]);
    const adminUids = new Set<string>();
    bySingle.forEach((d) => adminUids.add(d.id));
    byArray.forEach((d) => adminUids.add(d.id));

    if (adminUids.size === 0) {
      logger.warn(`[notifyAdminOnNewInquiry] platform_admin 사용자 0명 — inquiry=${inquiryId}`);
      return;
    }

    // 인앱 알림 (bulk)
    await writeInAppNotificationBulk(Array.from(adminUids), {
      type: 'new_inquiry',
      title: `📩 새 문의 — ${userName}`,
      body: `[${categoryLabel}] ${title}\n${body}`,
      linkPath: '/platform/inquiries',
      payload: { inquiryId, category: data.category ?? '' },
    });

    // FCM 토큰 수집
    const tokenDocs: { uid: string; token: string; docId: string }[] = [];
    await Promise.all(
      Array.from(adminUids).map(async (uid) => {
        const tokenSnap = await db.collection('users').doc(uid).collection('fcmTokens').get();
        tokenSnap.docs.forEach((d) => {
          const token = (d.data() as { token?: string }).token;
          if (token) tokenDocs.push({ uid, token, docId: d.id });
        });
      }),
    );

    if (tokenDocs.length === 0) {
      logger.info(`[notifyAdminOnNewInquiry] admin FCM 토큰 0건 (인앱만 발송) — inquiry=${inquiryId}`);
      return;
    }

    // FCM 발송 (sendEach)
    const messages: admin.messaging.Message[] = tokenDocs.map(({ token }) => ({
      token,
      notification: {
        title: `📩 새 사용자 문의 (${userName})`,
        body: `[${categoryLabel}] ${title}`,
      },
      data: {
        type: 'new_inquiry',
        inquiryId,
        url: '/platform/inquiries',
      },
      webpush: {
        notification: {
          icon: '/icon-app.svg',
          badge: '/icon-app.svg',
          tag: `inquiry-${inquiryId}`,
        },
        fcmOptions: { link: '/platform/inquiries' },
      },
    }));

    const resp = await messaging.sendEach(messages);
    logger.info(
      `[notifyAdminOnNewInquiry] inquiry=${inquiryId} admin=${adminUids.size} tokens=${tokenDocs.length} ok=${resp.successCount} fail=${resp.failureCount}`,
    );

    // 만료 토큰 정리
    const cleanups: Promise<unknown>[] = [];
    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          const td = tokenDocs[idx];
          if (td) {
            cleanups.push(
              db.collection('users').doc(td.uid).collection('fcmTokens').doc(td.docId).delete().catch(() => undefined),
            );
          }
        }
      }
    });
    await Promise.all(cleanups);
  },
);

// ───────────────────────────────────────────────────────
// 2) 본사 답변 → 사용자 알림
// ───────────────────────────────────────────────────────
export const notifyUserOnInquiryReplied = onDocumentUpdated(
  {
    document: 'inquiries/{inquiryId}',
    region: REGION,
  },
  async (event) => {
    const before = event.data?.before.data() as InquiryData | undefined;
    const after = event.data?.after.data() as InquiryData | undefined;
    if (!before || !after) return;

    // 새 답변 등록 (adminReply 신규 또는 body 변경)인 경우만
    const beforeReplyBody = before.adminReply?.body ?? '';
    const afterReplyBody = after.adminReply?.body ?? '';
    if (!afterReplyBody || afterReplyBody === beforeReplyBody) return;

    const inquiryId = event.params.inquiryId;
    const uid = after.uid;
    if (!uid) return;

    const title = (after.title ?? '').slice(0, 60);
    const replySnippet = afterReplyBody.slice(0, 120);

    const db = admin.firestore();
    const messaging = admin.messaging();

    // 인앱 알림
    await writeInAppNotification(uid, {
      type: 'inquiry_replied',
      title: '📣 본사 답변 도착',
      body: `[${title}]\n${replySnippet}`,
      linkPath: '/m/help',
      payload: { inquiryId },
    });

    // FCM 토큰 수집
    const tokenSnap = await db.collection('users').doc(uid).collection('fcmTokens').get();
    if (tokenSnap.empty) {
      logger.info(`[notifyUserOnInquiryReplied] uid=${uid} 토큰 0건 (인앱만)`);
      return;
    }
    const tokenDocs = tokenSnap.docs
      .map((d) => ({ token: (d.data() as { token?: string }).token, docId: d.id }))
      .filter((t): t is { token: string; docId: string } => Boolean(t.token));

    if (tokenDocs.length === 0) return;

    const messages: admin.messaging.Message[] = tokenDocs.map(({ token }) => ({
      token,
      notification: {
        title: '📣 본사 답변이 도착했어요',
        body: `[${title}] 답변을 확인해보세요`,
      },
      data: {
        type: 'inquiry_replied',
        inquiryId,
        url: '/m/help',
      },
      webpush: {
        notification: {
          icon: '/icon-app.svg',
          badge: '/icon-app.svg',
          tag: `inquiry-reply-${inquiryId}`,
        },
        fcmOptions: { link: '/m/help' },
      },
    }));

    const resp = await messaging.sendEach(messages);
    logger.info(
      `[notifyUserOnInquiryReplied] inquiry=${inquiryId} uid=${uid} tokens=${tokenDocs.length} ok=${resp.successCount} fail=${resp.failureCount}`,
    );

    // 만료 토큰 정리
    const cleanups: Promise<unknown>[] = [];
    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          const td = tokenDocs[idx];
          if (td) {
            cleanups.push(
              db.collection('users').doc(uid).collection('fcmTokens').doc(td.docId).delete().catch(() => undefined),
            );
          }
        }
      }
    });
    await Promise.all(cleanups);
  },
);
