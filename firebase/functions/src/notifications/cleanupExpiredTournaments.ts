/**
 * 시작 시각 + 3시간 지났는데 LIVE 시작 안 된 scheduled 토너를 'expired'로 자동 변경.
 *
 * 트리거: 매 1시간 scheduled
 * 흐름:
 *   1. collectionGroup('tournaments') status='scheduled' + startsAt < now-3h 조회
 *   2. 각 토너에 대해 liveSessions에서 tournamentId 일치 doc 검색
 *   3. liveSession 없으면 status='expired' + expiredAt 박음
 *      (매장이 깜빡한 것 또는 취소 — cancelled와 구분해 자동 만료 신호)
 *
 * 사용자 앱은 status in ['scheduled', 'live']만 표시 → expired 자동 숨김.
 * 매장 어드민은 expired 토너 별도 섹션에서 확인 가능.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const EXPIRY_AFTER_START_MS = 3 * 60 * 60 * 1000; // 3시간 안전 마진

export const cleanupExpiredTournaments = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'asia-northeast3',
    timeoutSeconds: 300,
  },
  async () => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - EXPIRY_AFTER_START_MS);

    const tournSnap = await db
      .collectionGroup('tournaments')
      .where('status', '==', 'scheduled')
      .where('startsAt', '<', cutoff)
      .get();

    if (tournSnap.empty) {
      console.log('[cleanupExpiredTournaments] no candidates');
      return;
    }

    let expired = 0;
    let skipped = 0;
    const batches: admin.firestore.WriteBatch[] = [db.batch()];
    let batchOps = 0;

    for (const tournDoc of tournSnap.docs) {
      // 이 토너로 시작된 LIVE 세션 있는지 확인
      const liveSnap = await db
        .collection('liveSessions')
        .where('tournamentId', '==', tournDoc.id)
        .limit(1)
        .get();

      if (!liveSnap.empty) {
        // LIVE 시작은 됐지만 토너 doc status가 안 바뀐 케이스 — 별도 처리하지 말고 skip
        skipped++;
        continue;
      }

      const current = batches[batches.length - 1];
      current.update(tournDoc.ref, {
        status: 'expired',
        expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        autoExpiredReason: '시작 시각 후 3시간 동안 LIVE 미시작',
      });
      expired++;
      batchOps++;
      if (batchOps % 500 === 0) batches.push(db.batch());
    }

    if (expired === 0) {
      console.log(
        `[cleanupExpiredTournaments] scanned=${tournSnap.size} skipped=${skipped} (live started)`,
      );
      return;
    }

    await Promise.all(batches.map((b) => b.commit()));
    console.log(
      `[cleanupExpiredTournaments] expired ${expired}, skipped (live started) ${skipped}`,
    );
  },
);
