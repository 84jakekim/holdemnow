/**
 * cleanupOldReservations — 90일 이상 지난 종료 상태 예약 자동 삭제.
 *
 * 정책 (PM 결정 2026-05-27):
 *  - 보존 기간: 90일 (분쟁 대비 + 통계 + 매장 운영 이력).
 *  - 대상: status ∈ ['cancelled', 'rejected', 'completed', 'no_show']
 *    AND reservedFor < now - 90d
 *  - 절대 삭제 X:
 *      - pending / confirmed (활성 예약)
 *      - cancelRequested=true (처리 대기, status='confirmed'와 자동 일치)
 *  - batch 500건 단위, 단일 cron tick에서 최대 ~2,500건 정리.
 *
 * 스케줄: 매일 03:00 KST (저트래픽 시간대).
 * 쿼리: collectionGroup('reservations')
 *   where status in ['cancelled', 'rejected', 'completed', 'no_show']
 *   where reservedFor < now - 90d
 *   order by reservedFor asc
 *   limit 500 × N
 *
 * Firestore 인덱스: (status asc, reservedFor asc) on collectionGroup 'reservations'
 *  → 이미 존재 (autoCompleteReservations와 공유).
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 5; // 단일 tick 최대 2,500건

const TERMINAL_STATUSES = ['cancelled', 'rejected', 'completed', 'no_show'] as const;

export const cleanupOldReservations = onSchedule(
  {
    // 매일 03:00 KST = 18:00 UTC
    schedule: '0 3 * * *',
    timeZone: 'Asia/Seoul',
    region: 'asia-northeast3',
    timeoutSeconds: 300,
  },
  async () => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - RETENTION_MS);

    let totalDeleted = 0;
    let totalSkippedActive = 0;

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const snap = await db
        .collectionGroup('reservations')
        .where('status', 'in', TERMINAL_STATUSES as unknown as string[])
        .where('reservedFor', '<', cutoff)
        .orderBy('reservedFor', 'asc')
        .limit(BATCH_SIZE)
        .get();

      if (snap.empty) break;

      const batch = db.batch();
      let batchDeleted = 0;

      snap.forEach((doc) => {
        const data = doc.data();
        const status = data.status;
        const cancelRequested = data.cancelRequested === true;

        // 이중 가드: 활성 예약 또는 취소 신청 처리 대기 — 절대 삭제 X.
        if (status === 'pending' || status === 'confirmed' || cancelRequested) {
          totalSkippedActive += 1;
          return;
        }
        if (!TERMINAL_STATUSES.includes(status)) {
          totalSkippedActive += 1;
          return;
        }

        batch.delete(doc.ref);
        batchDeleted += 1;
      });

      if (batchDeleted === 0) break;

      try {
        await batch.commit();
        totalDeleted += batchDeleted;
        logger.info(
          `cleanupOldReservations: batch ${i + 1} deleted ${batchDeleted} (running total ${totalDeleted})`,
        );
      } catch (err) {
        logger.error(`cleanupOldReservations: batch ${i + 1} commit failed`, err);
        throw err;
      }

      // 마지막 batch가 500 미만이면 더 가져올 게 없음.
      if (snap.size < BATCH_SIZE) break;
    }

    logger.info(
      `cleanupOldReservations: complete. deleted=${totalDeleted} skipped_active_guard=${totalSkippedActive} retention=${RETENTION_DAYS}d cutoff=${cutoff.toDate().toISOString()}`,
    );
  },
);
