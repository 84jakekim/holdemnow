/**
 * 예약 방문 10분 전 사용자 알림.
 *
 * 스케줄: 매 1분마다 실행. confirmed 예약 중 reservedFor가 now+10min 이내
 * (그러나 아직 reminderSentAt 박히지 않은 것)을 찾아 FCM 발송.
 *
 * 데이터:
 *  - collectionGroup('reservations') where status='confirmed'
 *  - reservedFor in (now-1min, now+11min) — 1분 cron 간격 안전 마진
 *  - reminderSentAt == null 인 것만 (중복 발송 방지)
 *
 * 전송 후 reminderSentAt = serverTimestamp 박아 다음 cron 실행 시 제외.
 *
 * 데이터 모델 영향:
 *  - reservations 문서에 reminderSentAt?: Timestamp 필드 추가됨 (선택)
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
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

const WINDOW_BEFORE_MS = 11 * 60 * 1000; // now+11분 이내 (10분 + 1분 cron 마진)
const WINDOW_AFTER_MS = 60 * 1000;        // now-1분 (이미 지난 직후 케이스 흡수)

export const notifyReservationReminder = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'asia-northeast3',
    timeoutSeconds: 60,
  },
  async () => {
    const db = admin.firestore();
    const messaging = admin.messaging();

    const now = Date.now();
    const upperTs = admin.firestore.Timestamp.fromMillis(now + WINDOW_BEFORE_MS);
    const lowerTs = admin.firestore.Timestamp.fromMillis(now - WINDOW_AFTER_MS);

    // confirmed 예약 + reservedFor 윈도우 내
    const snap = await db
      .collectionGroup('reservations')
      .where('status', '==', 'confirmed')
      .where('reservedFor', '>=', lowerTs)
      .where('reservedFor', '<=', upperTs)
      .get();

    if (snap.empty) {
      console.log('[notifyReservationReminder] no reservations in 10-min window');
      return;
    }

    let sent = 0;
    let skipped = 0;

    for (const doc of snap.docs) {
      const data = doc.data() as {
        authorUid?: string;
        storeName?: string;
        partySize?: number;
        reservedFor?: admin.firestore.Timestamp;
        reminderSentAt?: admin.firestore.Timestamp | null;
      };

      // 이미 보낸 예약은 skip
      if (data.reminderSentAt) {
        skipped++;
        continue;
      }
      const authorUid = data.authorUid;
      if (!authorUid) {
        skipped++;
        continue;
      }

      const storeId = doc.ref.parent.parent?.id ?? '';
      const rid = doc.id;
      const storeName = data.storeName ?? '매장';
      const timeStr = formatKST(data.reservedFor);
      const partySize = data.partySize ?? 1;

      // 사용자 FCM 토큰
      const tokenSnap = await db
        .collection('users')
        .doc(authorUid)
        .collection('fcmTokens')
        .get();

      if (tokenSnap.empty) {
        // 토큰 없어도 reminderSentAt 박아서 다음 cron에서 또 시도하지 않게
        await doc.ref.update({
          reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
          reminderResult: 'no_tokens',
        });
        skipped++;
        continue;
      }

      const tokens = tokenSnap.docs
        .map((d) => (d.data() as { token?: string }).token)
        .filter((t): t is string => Boolean(t));

      if (tokens.length === 0) {
        await doc.ref.update({
          reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
          reminderResult: 'no_tokens',
        });
        skipped++;
        continue;
      }

      const messages: admin.messaging.Message[] = tokens.map((token) => ({
        token,
        notification: {
          title: '⏰ 곧 방문 시간입니다',
          body: `${storeName} ${timeStr} ${partySize}명 — 10분 후 입장하세요`,
        },
        data: {
          type: 'reservation_reminder',
          storeId,
          reservationId: rid,
          deepLink: `/m/store/${storeId}`,
        },
        webpush: {
          fcmOptions: { link: `/m/store/${storeId}` },
        },
      }));

      try {
        const resp = await messaging.sendEach(messages);
        console.log(
          `[notifyReservationReminder] uid=${authorUid} store=${storeId} rid=${rid} ` +
            `sent=${resp.successCount} failed=${resp.failureCount}`,
        );

        // 인앱 알림 doc 작성
        await writeInAppNotification(authorUid, {
          type: 'reservation_reminder',
          title: '곧 방문 시간',
          body: `${storeName} ${timeStr} ${partySize}명 — 10분 후 입장하세요`,
          linkPath: `/m/store/${storeId}`,
          payload: { storeId, reservationId: rid },
        });

        // reminderSentAt 박아 다음 cron에서 중복 발송 차단
        await doc.ref.update({
          reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
          reminderResult: `sent_${resp.successCount}_failed_${resp.failureCount}`,
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
                .doc(authorUid)
                .collection('fcmTokens')
                .doc(tokenId)
                .delete()
                .catch(() => {});
            }),
          );
        }

        sent++;
      } catch (err) {
        console.warn(
          `[notifyReservationReminder] send failed uid=${authorUid} rid=${rid}`,
          err,
        );
        // 실패 시에도 reminderSentAt 안 박음 — 다음 cron 재시도
      }
    }

    console.log(
      `[notifyReservationReminder] scanned=${snap.size} sent=${sent} skipped=${skipped}`,
    );
  },
);
