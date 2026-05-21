/**
 * scheduledAdSlotExpiry — 매시간 cron.
 *
 * endAt이 지난 active 슬롯을 'expired'로 일괄 전환.
 * pending이지만 startAt이 지난 슬롯도 'active'로 자동 승격.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

export const scheduledAdSlotExpiry = onSchedule(
  {
    schedule: 'every 60 minutes',
    region: 'asia-northeast3',
    timeZone: 'Asia/Seoul',
  },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    // 1) endAt 지난 active → expired
    const expSnap = await db
      .collection('adSlots')
      .where('status', '==', 'active')
      .where('endAt', '<=', now)
      .limit(200)
      .get();

    let expired = 0;
    if (!expSnap.empty) {
      const batch = db.batch();
      expSnap.docs.forEach((d) => {
        batch.update(d.ref, {
          status: 'expired',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      expired = expSnap.size;
    }

    // 2) startAt 지난 pending → active
    const actSnap = await db
      .collection('adSlots')
      .where('status', '==', 'pending')
      .where('startAt', '<=', now)
      .limit(200)
      .get();

    let activated = 0;
    if (!actSnap.empty) {
      const batch = db.batch();
      actSnap.docs.forEach((d) => {
        const data = d.data() as { endAt?: admin.firestore.Timestamp };
        // endAt도 지났으면 expired로 (혹시 cron이 오래 안돌았던 경우)
        if (data.endAt && data.endAt.toMillis() <= now.toMillis()) {
          batch.update(d.ref, {
            status: 'expired',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          batch.update(d.ref, {
            status: 'active',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      });
      await batch.commit();
      activated = actSnap.size;
    }

    console.log(`[scheduledAdSlotExpiry] expired=${expired} activated=${activated}`);
  },
);
