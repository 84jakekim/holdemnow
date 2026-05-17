/**
 * 관심 토너 시작 1시간 전 알림.
 *
 * 트리거: 매 1분 scheduled
 * 흐름:
 * 1. tournaments collectionGroup 쿼리 — startsAt이 (now+55min, now+65min) 사이 (10분 안전 윈도우)
 * 2. 각 토너에 tournamentStartNotifiedAt 플래그 없는 것만 처리 (중복 방지)
 * 3. interests collectionGroup → tournamentId 일치 + 사용자 prefs.tournamentStart=true
 * 4. FCM 일괄 발송 + 토너 doc에 플래그 set
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { gatherFcmTokens, sendAndCleanup, filterByPrefs, uidFromPath } from './_shared';

export const notifyTournamentStart = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'asia-northeast3',
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();
    const nowMs = Date.now();
    const windowStart = admin.firestore.Timestamp.fromMillis(nowMs + 55 * 60_000);
    const windowEnd = admin.firestore.Timestamp.fromMillis(nowMs + 65 * 60_000);

    const tournSnap = await db
      .collectionGroup('tournaments')
      .where('status', '==', 'scheduled')
      .where('startsAt', '>=', windowStart)
      .where('startsAt', '<=', windowEnd)
      .get();

    if (tournSnap.empty) return;

    for (const tournDoc of tournSnap.docs) {
      const tourn = tournDoc.data() as {
        name?: string;
        storeName?: string;
        storeId?: string;
        buyIn?: number;
        tournamentStartNotifiedAt?: admin.firestore.Timestamp;
      };
      if (tourn.tournamentStartNotifiedAt) continue; // 이미 발송

      // 관심 등록자 조회
      const interestSnap = await db
        .collectionGroup('interests')
        .where('tournamentId', '==', tournDoc.id)
        .get();

      const candidateUids: string[] = [];
      interestSnap.forEach((d) => {
        const uid = uidFromPath(d.ref.path);
        if (uid) candidateUids.push(uid);
      });

      let sentCount = 0;
      if (candidateUids.length > 0) {
        const allowedUids = await filterByPrefs(candidateUids, 'tournamentStart', true);
        const tokens = await gatherFcmTokens(allowedUids);
        if (tokens.length > 0) {
          const res = await sendAndCleanup(tokens, {
            title: `⏰ ${tourn.name ?? '관심 토너'} 1시간 전`,
            body: `${tourn.storeName ?? ''} · 바이인 ₩${(tourn.buyIn ?? 0).toLocaleString()}`,
            data: {
              type: 'tournament-start',
              tournamentId: tournDoc.id,
              storeId: tourn.storeId ?? '',
              url: `/m/store/${tourn.storeId ?? ''}`,
            },
            url: `/m/store/${tourn.storeId ?? ''}`,
            tag: `tournament-start-${tournDoc.id}`,
          });
          sentCount = res.successCount;
        }
      }

      // 발송 여부 무관 — 중복 방지 플래그 set
      await tournDoc.ref.update({
        tournamentStartNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        tournamentStartNotifiedCount: sentCount,
      });
      console.log(
        `tournamentStart: tournament=${tournDoc.id} candidates=${candidateUids.length} sent=${sentCount}`,
      );
    }
  },
);
