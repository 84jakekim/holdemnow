/**
 * aggregateAdSlotImpressions — 매시간 집계.
 *
 * 각 active 광고의 누적 impressions/clicks를 stores/{storeId}/metrics/ad_summary에 미러링.
 * 본사 어드민 통계 페이지에서 활용. 클라이언트가 increment한 카운트가 원본.
 *
 * v0.1: 단순 미러. v0.2에서 daily snapshot 추가 예정.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

export const aggregateAdSlotImpressions = onSchedule(
  {
    schedule: 'every 60 minutes',
    region: 'asia-northeast3',
    timeZone: 'Asia/Seoul',
  },
  async () => {
    const db = admin.firestore();
    const snap = await db
      .collection('adSlots')
      .where('status', '==', 'active')
      .limit(500)
      .get();

    if (snap.empty) {
      console.log('[aggregateAdSlotImpressions] no active slots');
      return;
    }

    // storeId 단위로 합산
    const perStore = new Map<string, { impressions: number; clicks: number; ads: number }>();
    snap.docs.forEach((d) => {
      const data = d.data() as { storeId?: string; impressions?: number; clicks?: number };
      if (!data.storeId) return;
      const prev = perStore.get(data.storeId) ?? { impressions: 0, clicks: 0, ads: 0 };
      prev.impressions += data.impressions ?? 0;
      prev.clicks += data.clicks ?? 0;
      prev.ads += 1;
      perStore.set(data.storeId, prev);
    });

    const batch = db.batch();
    perStore.forEach((v, storeId) => {
      const ref = db.doc(`stores/${storeId}/metrics/ad_summary`);
      batch.set(
        ref,
        {
          impressions: v.impressions,
          clicks: v.clicks,
          activeAds: v.ads,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
    await batch.commit();

    console.log(`[aggregateAdSlotImpressions] mirrored ${perStore.size} stores`);
  },
);
