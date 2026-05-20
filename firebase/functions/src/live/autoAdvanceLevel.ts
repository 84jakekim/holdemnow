/**
 * LIVE 세션 레벨 자동 진행 (매장 어드민 화면 의존 제거).
 *
 * 트리거: 매 1분 scheduled (Firebase v2 scheduler 최소 1분)
 * 흐름:
 * 1. liveSessions status='running' + levelEndsAt < now 조회
 * 2. 각 세션:
 *    - 다음 레벨 있으면 → currentLevel+1, smallBlind·bigBlind·ante 갱신,
 *      levelSecondsLeft·levelEndsAt 새로 박음
 *    - 다음 레벨 없으면 (마지막 레벨 종료) → finishingAt 박음 (autoStopFinishedSessions가 3분 후 정리)
 *
 * 동시성: 같은 doc을 LivePanel·이 cron 둘이 동시 update 가능 — Firestore lastWrite-wins,
 * idempotent하게 작성: levelEndsAt이 이미 미래로 박혀있으면 skip (다른 클라이언트가 먼저 진행).
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

interface BlindLevel {
  level: number;
  durationSec: number;
  sb: number;
  bb: number;
  ante: number;
}

export const autoAdvanceLevel = onSchedule(
  {
    schedule: 'every 1 minutes', // Firebase v2 scheduler 최소 1분
    region: 'asia-northeast3',
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    // running + levelEndsAt 만료 세션 조회 (인덱스: status + levelEndsAt 이미 있음)
    const snap = await db
      .collection('liveSessions')
      .where('status', '==', 'running')
      .where('levelEndsAt', '<=', now)
      .get();

    if (snap.empty) {
      console.log('[autoAdvanceLevel] no due sessions');
      return;
    }

    let advanced = 0;
    let finished = 0;

    for (const doc of snap.docs) {
      const data = doc.data() as {
        status?: string;
        currentLevel?: number;
        blindStructure?: BlindLevel[];
        levelEndsAt?: admin.firestore.Timestamp;
        finishingAt?: admin.firestore.Timestamp;
        storeName?: string;
        tournamentName?: string;
      };

      // 이중 안전: status가 바뀌었거나 levelEndsAt이 사이에 또 갱신됐으면 skip
      if (data.status !== 'running') continue;
      if (!data.levelEndsAt || data.levelEndsAt.toMillis() > Date.now()) continue;
      if (data.finishingAt) continue; // 이미 마지막 레벨 종료 처리됨

      const structure = data.blindStructure ?? [];
      const currentLevel = data.currentLevel ?? 1;
      const nextLevel = structure.find((l) => l.level === currentLevel + 1);

      if (!nextLevel) {
        // 마지막 레벨 종료 → finishingAt 박음. autoStopFinishedSessions가 3분 후 정리.
        await doc.ref.update({
          finishingAt: admin.firestore.FieldValue.serverTimestamp(),
          levelSecondsLeft: 0,
          levelEndsAt: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        finished++;
        console.log(
          `[autoAdvanceLevel] finished session ${doc.id} (last level ${currentLevel})`,
        );
        continue;
      }

      // 다음 레벨로 진행
      const newEndsAt = admin.firestore.Timestamp.fromMillis(
        Date.now() + nextLevel.durationSec * 1000,
      );
      await doc.ref.update({
        currentLevel: nextLevel.level,
        smallBlind: nextLevel.sb,
        bigBlind: nextLevel.bb,
        ante: nextLevel.ante ?? 0,
        levelSecondsLeft: nextLevel.durationSec,
        levelEndsAt: newEndsAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      advanced++;
      console.log(
        `[autoAdvanceLevel] advanced ${doc.id} ${currentLevel}→${nextLevel.level} (${data.storeName ?? '?'} · ${data.tournamentName ?? '?'})`,
      );
    }

    console.log(
      `[autoAdvanceLevel] advanced=${advanced} finished=${finished} total=${snap.size}`,
    );
  },
);
