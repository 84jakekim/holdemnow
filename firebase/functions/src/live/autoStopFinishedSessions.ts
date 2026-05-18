/**
 * 만료된 LIVE 세션을 자동 정리. 두 가지 만료 케이스를 처리:
 *
 * 1. **그레이스 만료** (마지막 레벨 종료 + 180초): finishingAt 박힌 세션이 cutoff 지나면
 *    status=completed로 박아 모든 LIVE 피드에서 사라지게 함.
 * 2. **ready 만료** (시작 버튼 안 누른 채 300초 경과): status=ready + createdAt 오래된 세션
 *    정리. "실시간" 컨셉상 시작 안 한 LIVE가 사용자 앱에 영원히 떠 있으면 안 됨.
 *
 * 트리거: 매 1분 scheduled. 매장 사장 화면이 꺼져 있어도 서버에서 정리.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const FINISHING_GRACE_MS = 180 * 1000;
const READY_EXPIRY_MS = 300 * 1000;
const FINISHING_ACTIVE_STATUSES = ['running', 'paused', 'break'];

export const autoStopFinishedSessions = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'asia-northeast3',
    timeoutSeconds: 60,
  },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    const finishingCutoff = admin.firestore.Timestamp.fromMillis(now - FINISHING_GRACE_MS);
    const readyCutoff = admin.firestore.Timestamp.fromMillis(now - READY_EXPIRY_MS);

    // 두 쿼리 병렬 — 각 단일 inequality라 자동 인덱스로 동작.
    const [finishingSnap, readySnap] = await Promise.all([
      db.collection('liveSessions').where('finishingAt', '<', finishingCutoff).get(),
      db
        .collection('liveSessions')
        .where('status', '==', 'ready')
        .where('createdAt', '<', readyCutoff)
        .get(),
    ]);

    const batch = db.batch();
    let finishingCount = 0;
    let readyCount = 0;

    finishingSnap.forEach((doc) => {
      const data = doc.data() as { status?: string };
      if (!FINISHING_ACTIVE_STATUSES.includes(data.status ?? '')) return; // 이미 completed면 skip
      batch.update(doc.ref, {
        status: 'completed',
        levelEndsAt: null,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      finishingCount++;
    });

    readySnap.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'completed',
        levelEndsAt: null,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      readyCount++;
    });

    if (finishingCount === 0 && readyCount === 0) {
      console.log('[autoStopFinishedSessions] no expired sessions to clean');
      return;
    }

    await batch.commit();
    console.log(
      `[autoStopFinishedSessions] stopped finishing=${finishingCount}, expiredReady=${readyCount}`,
    );
  },
);
