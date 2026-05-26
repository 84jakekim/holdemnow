/**
 * autoCompleteReservations — 입장시간 + 2시간 지난 pending/confirmed 예약을
 * 자동으로 status='completed'로 전환.
 *
 * 정책 (PM 결정 2026-05-27):
 *  - 입장시간(reservedFor) + grace 2시간을 지난 pending/confirmed 예약 = 자동 완료.
 *  - 사용자 매장 도착이 늦을 수 있어 grace 2h 보장.
 *  - confirmed: 매장이 확정했지만 사용자가 안 옴 또는 시간 경과 후 정리.
 *  - pending: 매장이 응답 안 한 채 시간 경과 → 자동 정리 (매장의 무응답 보호).
 *  - 클라이언트 필터(/m/reservations)도 같은 룰로 이중 안전망.
 *
 * 추가 효과:
 *  - 1인 1매장 1예약 정책에서 활성 예약 자동 해제 → 사용자가 다음 매장 예약 가능.
 *  - 체크인 흐름과 통합: 매장 도착해 체크인하면 createCheckIn 후 같은 매장 활성 예약을
 *    별도 trigger(클라이언트)에서 즉시 completed로 전환 — 이 cron은 백업 안전망.
 *
 * 스케줄: 매 30분 (입장시간 경과 직후 빠르게 정리).
 * 쿼리: collectionGroup('reservations')
 *   where status in ['pending', 'confirmed']
 *   where reservedFor <= now - 2h
 *
 * Firestore 인덱스: (status asc, reservedFor asc) on collectionGroup 'reservations'.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const GRACE_MS = 2 * 60 * 60 * 1000; // 입장시간 + 2시간

export const autoCompleteReservations = onSchedule(
  {
    schedule: 'every 30 minutes',
    region: 'asia-northeast3',
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - GRACE_MS);

    // 'in' 쿼리는 1회로 묶음 (pending, confirmed).
    const snap = await db
      .collectionGroup('reservations')
      .where('status', 'in', ['pending', 'confirmed'])
      .where('reservedFor', '<=', cutoff)
      .limit(500)
      .get();

    if (snap.empty) {
      logger.info('autoCompleteReservations: no candidates');
      return;
    }

    const batch = db.batch();
    let updated = 0;
    snap.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completionReason: 'time_passed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      updated += 1;
    });

    try {
      await batch.commit();
      logger.info(`autoCompleteReservations: completed ${updated} reservations`);
    } catch (err) {
      logger.error('autoCompleteReservations failed', err);
      throw err;
    }
  },
);
