/**
 * 마지막 레벨 종료 후 그레이스가 만료된 LIVE 세션을 자동 정리.
 *
 * 트리거: 매 1분 scheduled
 * 흐름:
 * 1. liveSessions 중 finishingAt < (now - 180초) 인 문서 조회
 * 2. status가 running/paused/break 이면 status=completed로 업데이트 (idempotent)
 * 3. levelEndsAt=null, endedAt=now, updatedAt=now 박음
 *
 * 매장 사장 LivePanel이 꺼져 있어도 서버에서 정리되어 모바일/지도 LIVE 표시가 사라짐.
 * "실시간" 컨셉의 핵심 보증.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const FINISHING_GRACE_MS = 180 * 1000;
const ACTIVE_STATUSES = ['running', 'paused', 'break'];

export const autoStopFinishedSessions = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'asia-northeast3',
    timeoutSeconds: 60,
  },
  async () => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - FINISHING_GRACE_MS);

    // finishingAt 단일 inequality — 자동 인덱스로 동작
    const snap = await db
      .collection('liveSessions')
      .where('finishingAt', '<', cutoff)
      .get();

    if (snap.empty) {
      console.log('[autoStopFinishedSessions] no expired sessions');
      return;
    }

    const batch = db.batch();
    let count = 0;
    snap.forEach((doc) => {
      const data = doc.data() as { status?: string };
      if (!ACTIVE_STATUSES.includes(data.status ?? '')) return; // 이미 completed면 skip
      batch.update(doc.ref, {
        status: 'completed',
        levelEndsAt: null,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      count++;
    });

    if (count === 0) {
      console.log('[autoStopFinishedSessions] all expired sessions already completed');
      return;
    }

    await batch.commit();
    console.log(`[autoStopFinishedSessions] stopped ${count} session(s)`);
  },
);
