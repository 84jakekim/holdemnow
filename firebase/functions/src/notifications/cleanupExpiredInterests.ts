/**
 * 종료된 관심 토너 자동 정리.
 *
 * 트리거: 매 1시간 scheduled
 * 흐름:
 * 1. collectionGroup('interests') — startsAt < now - 6h 인 doc 조회
 * 2. batch 삭제 (한 토너가 6시간 이상 가는 일은 거의 없음, 안전 마진)
 *
 * 사용자 의도: 매장이 매번 새 tournaments/{id}로 토너를 등록하므로,
 * "어제 8시 GTD 100만"과 "오늘 8시 GTD 100만"은 별개 인스턴스.
 * 종료된 인스턴스의 ⭐ 관심은 의미가 없고 통계만 부풀림 → 자동 정리.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const EXPIRY_AFTER_START_MS = 6 * 60 * 60 * 1000; // 6시간

export const cleanupExpiredInterests = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'asia-northeast3',
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - EXPIRY_AFTER_START_MS);

    const snap = await db
      .collectionGroup('interests')
      .where('startsAt', '<', cutoff)
      .get();

    if (snap.empty) {
      console.log('[cleanupExpiredInterests] no expired interests');
      return;
    }

    // batch 한 번에 최대 500 — 보통 그 이하라 단일 batch로 충분
    let count = 0;
    const batches: admin.firestore.WriteBatch[] = [db.batch()];
    snap.forEach((doc) => {
      const last = batches[batches.length - 1];
      last.delete(doc.ref);
      count++;
      if (count % 500 === 0) batches.push(db.batch());
    });

    await Promise.all(batches.map((b) => b.commit()));
    console.log(`[cleanupExpiredInterests] removed ${count} expired interests`);
  },
);
