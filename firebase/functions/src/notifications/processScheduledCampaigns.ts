/**
 * 예약 마케팅 캠페인 처리 — 매 1분 cron.
 *
 * 흐름:
 *   1. platformCampaigns where status='scheduled' AND scheduledAt <= now() 조회
 *   2. 각 doc → status='sending'으로 잠금 (재실행/중복 발송 방지)
 *   3. broadcastMarketing 헬퍼 호출
 *   4. 성공: status='sent', sentAt, 통계 기록
 *      실패: status='failed', errorMessage 기록
 *
 * region: asia-northeast3 (서울)
 * timeout: 540초 (대규모 발송 대비)
 *
 * idempotency: status='sending'으로 잠그므로 다음 분 cron이 같은 doc을 잡지 않음.
 *   단 sending 상태에서 함수가 죽으면 영구히 sending에 머무를 수 있음 → v0.2에서 stale lock 청소 함수 추가 검토.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { broadcastMarketing } from './_shared';

export const processScheduledCampaigns = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'asia-northeast3',
    timeoutSeconds: 540,
    timeZone: 'Asia/Seoul',
  },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const snap = await db
      .collection('platformCampaigns')
      .where('status', '==', 'scheduled')
      .where('scheduledAt', '<=', now)
      .get();

    if (snap.empty) {
      console.log('[processScheduledCampaigns] no due campaigns');
      return;
    }

    console.log(`[processScheduledCampaigns] due=${snap.size}`);

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as {
        title?: string;
        body?: string;
        imageUrl?: string | null;
        linkUrl?: string | null;
        isAdvertisement?: boolean;
      };

      // status=sending 잠금 (중복 발송 방지)
      try {
        await docSnap.ref.set(
          {
            status: 'sending',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } catch (lockErr) {
        console.error(
          '[processScheduledCampaigns] lock failed:',
          docSnap.id,
          lockErr,
        );
        continue;
      }

      if (!data.title || !data.body) {
        await docSnap.ref.set(
          {
            status: 'failed',
            errorMessage: 'title/body missing',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        console.error('[processScheduledCampaigns] invalid doc:', docSnap.id);
        continue;
      }

      try {
        const stats = await broadcastMarketing({
          campaignId: docSnap.id,
          title: data.title,
          body: data.body,
          imageUrl: data.imageUrl ?? null,
          linkUrl: data.linkUrl ?? null,
          isAdvertisement: data.isAdvertisement === true,
          testUid: null,
        });

        await docSnap.ref.set(
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

        // 감사 로그
        await db.collection('marketingBroadcasts').add({
          campaignId: docSnap.id,
          title: data.title,
          body: data.body,
          imageUrl: data.imageUrl ?? null,
          linkUrl: data.linkUrl ?? null,
          isAdvertisement: data.isAdvertisement === true,
          testUid: null,
          sentBy: 'system:scheduler',
          recipientCount: stats.recipientCount,
          deliveredCount: stats.deliveredCount,
          failureCount: stats.failureCount,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(
          `[processScheduledCampaigns] sent campaign=${docSnap.id} recipients=${stats.recipientCount} sent=${stats.deliveredCount} failed=${stats.failureCount}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await docSnap.ref.set(
          {
            status: 'failed',
            errorMessage: msg,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        console.error(
          '[processScheduledCampaigns] failed:',
          docSnap.id,
          e,
        );
      }
    }
  },
);
