/**
 * onAdSlotActivate — adSlots/{adId} onWrite 트리거.
 *
 * status가 'active'로 바뀌면 stores/{storeId}에 캐싱 필드(adTier, adActiveUntil) 동기화.
 * status가 'expired'|'cancelled'로 바뀌면 stores 캐싱 필드 제거.
 *
 * 클라이언트도 grantAdSlot에서 한 번 시도하지만, 본 Function이 진실의 원천(SoR)으로
 * 권한·실패에 무관하게 매장 doc과 일관성 보장.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

type AdSlotData = {
  storeId?: string;
  tier?: 'premium' | 'standard';
  status?: 'pending' | 'active' | 'expired' | 'cancelled';
  endAt?: admin.firestore.Timestamp;
};

export const onAdSlotActivate = onDocumentWritten(
  { document: 'adSlots/{adId}', region: 'asia-northeast3' },
  async (event) => {
    const after = event.data?.after.data() as AdSlotData | undefined;
    const before = event.data?.before.data() as AdSlotData | undefined;
    if (!after || !after.storeId) return;

    const db = admin.firestore();
    const storeRef = db.doc(`stores/${after.storeId}`);

    // 상태 전이 케이스
    const becameActive = after.status === 'active' && before?.status !== 'active';
    const leftActive = before?.status === 'active' && after.status !== 'active';

    if (becameActive) {
      await storeRef.set({
        adTier: after.tier ?? null,
        adActiveUntil: after.endAt ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      console.log(`[onAdSlotActivate] activated ad for store=${after.storeId} tier=${after.tier}`);
      return;
    }

    if (leftActive) {
      // 다른 active 광고가 있으면 그것으로 대체, 없으면 제거
      const otherActive = await db
        .collection('adSlots')
        .where('storeId', '==', after.storeId)
        .where('status', '==', 'active')
        .limit(1)
        .get();

      if (!otherActive.empty) {
        const a = otherActive.docs[0].data() as AdSlotData;
        await storeRef.set({
          adTier: a.tier ?? null,
          adActiveUntil: a.endAt ?? null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        console.log(`[onAdSlotActivate] swapped ad for store=${after.storeId} → ${a.tier}`);
      } else {
        await storeRef.set({
          adTier: admin.firestore.FieldValue.delete(),
          adActiveUntil: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        console.log(`[onAdSlotActivate] cleared ad for store=${after.storeId}`);
      }
    }
  },
);
