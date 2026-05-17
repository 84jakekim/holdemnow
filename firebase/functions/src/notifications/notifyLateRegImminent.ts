/**
 * 늦은 등록 마감 임박 알림 (~30분 전).
 *
 * 트리거: 매 1분 scheduled
 * 흐름:
 * 1. liveSessions status=running + lateRegClosed=false 조회
 * 2. 각 세션의 등록 마감 시각 계산 (levelEndsAt + 남은 레벨들의 duration 합)
 * 3. 28~32분 후 마감이고 미발송이면 → 매장 즐겨찾기 사용자 (prefs.lateRegImminent=true) 에게 FCM
 * 4. 세션에 lateRegImminentNotifiedAt 플래그 set
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { gatherFcmTokens, sendAndCleanup, filterByPrefs, uidFromPath } from './_shared';

interface BlindLevel {
  level: number;
  durationSec: number;
}

export const notifyLateRegImminent = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'asia-northeast3',
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();
    const nowMs = Date.now();

    const liveSnap = await db
      .collection('liveSessions')
      .where('status', '==', 'running')
      .where('lateRegClosed', '==', false)
      .get();

    if (liveSnap.empty) return;

    for (const liveDoc of liveSnap.docs) {
      const live = liveDoc.data() as {
        storeId?: string;
        storeName?: string;
        tournamentName?: string;
        currentLevel?: number;
        lateRegEndLevel?: number;
        levelEndsAt?: admin.firestore.Timestamp;
        blindStructure?: BlindLevel[];
        lateRegImminentNotifiedAt?: admin.firestore.Timestamp;
      };
      if (live.lateRegImminentNotifiedAt) continue;
      if (!live.levelEndsAt) continue; // 레거시 세션 — 계산 불가
      if (typeof live.currentLevel !== 'number' || typeof live.lateRegEndLevel !== 'number') continue;
      if (!live.blindStructure) continue;

      // 등록 마감 시각 계산
      let lateRegCloseMs = live.levelEndsAt.toMillis();
      for (let lv = live.currentLevel + 1; lv <= live.lateRegEndLevel; lv++) {
        const item = live.blindStructure.find((l) => l.level === lv);
        if (item) lateRegCloseMs += item.durationSec * 1000;
      }

      const minutesUntilClose = (lateRegCloseMs - nowMs) / 60_000;
      // 28~32분 윈도우 — 매 1분 실행이라 ±1분 여유, 스케줄러 지연 대비
      if (minutesUntilClose < 28 || minutesUntilClose > 32) continue;
      if (!live.storeId) continue;

      // 매장 즐겨찾기 사용자 조회
      const favSnap = await db
        .collectionGroup('favorites')
        .where('storeId', '==', live.storeId)
        .get();

      const candidateUids: string[] = [];
      favSnap.forEach((d) => {
        const uid = uidFromPath(d.ref.path);
        if (uid) candidateUids.push(uid);
      });

      let sentCount = 0;
      if (candidateUids.length > 0) {
        // lateRegImminent는 default OFF (opt-in) — 사용자가 명시적으로 켠 경우만 발송
        const allowedUids = await filterByPrefs(candidateUids, 'lateRegImminent', false);
        const tokens = await gatherFcmTokens(allowedUids);
        if (tokens.length > 0) {
          const res = await sendAndCleanup(tokens, {
            title: `⏰ ${live.storeName ?? '매장'} 등록 마감 30분 전`,
            body: `${live.tournamentName ?? 'LIVE 토너'} · 지금 바로 가세요`,
            data: {
              type: 'late-reg-imminent',
              sessionId: liveDoc.id,
              storeId: live.storeId,
              url: `/m/live/${liveDoc.id}`,
            },
            url: `/m/live/${liveDoc.id}`,
            tag: `late-reg-${liveDoc.id}`,
          });
          sentCount = res.successCount;
        }
      }

      await liveDoc.ref.update({
        lateRegImminentNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        lateRegImminentNotifiedCount: sentCount,
      });
      console.log(
        `lateRegImminent: session=${liveDoc.id} candidates=${candidateUids.length} sent=${sentCount}`,
      );
    }
  },
);
