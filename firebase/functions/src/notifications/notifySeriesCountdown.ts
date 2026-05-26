/**
 * 시리즈 본선 D-7 / D-3 / D-1 카운트다운 알림.
 *
 * 트리거: 매일 09:00 KST scheduled (시리즈는 일 단위 카운트다운이므로 분 단위 cron 불필요).
 * 흐름:
 * 1. series collectionGroup → status='upcoming' + finalDate 존재.
 * 2. 각 시리즈에 대해 D-day를 계산. {7,3,1} 중 하나면 발송 대상.
 *    - 중복 방지: seriesCountdownNotifiedDays 배열에 이미 발송한 day(7/3/1) 기록.
 * 3. seriesSubscriptions collectionGroup → seriesId 일치 → uid 추출.
 * 4. notificationPrefs.tournamentStart=true 또는 미설정(default ON) 사용자만 발송.
 *    (시리즈 카운트다운은 토너 시작 알림과 같은 카테고리로 묶어 토글 단순화)
 * 5. FCM 일괄 발송 + 시리즈 doc 플래그 배열 갱신.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { gatherFcmTokens, sendAndCleanup, filterByPrefs, uidFromPath } from './_shared';

const TARGET_DAYS = [7, 3, 1] as const;

function daysUntilKst(finalDateMs: number, nowMs: number): number {
  // KST 자정 기준 D-day. 9시 cron에서 9~24h 범위는 같은 날로 본다.
  // 단순 계산: (finalDateMs - nowMs) / 86400000 → 올림.
  const diffMs = finalDateMs - nowMs;
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 86_400_000);
}

export const notifySeriesCountdown = onSchedule(
  {
    // KST 09:00 매일. firebase v2 scheduler는 timeZone 옵션 지원.
    schedule: '0 9 * * *',
    timeZone: 'Asia/Seoul',
    region: 'asia-northeast3',
    timeoutSeconds: 300,
  },
  async () => {
    const db = admin.firestore();
    const nowMs = Date.now();

    // upcoming 시리즈만 (completed/active 제외)
    const seriesSnap = await db
      .collection('series')
      .where('status', '==', 'upcoming')
      .get();

    if (seriesSnap.empty) {
      console.log('seriesCountdown: no upcoming series');
      return;
    }

    for (const seriesDoc of seriesSnap.docs) {
      const series = seriesDoc.data() as {
        name?: string;
        season?: string;
        finalDate?: admin.firestore.Timestamp;
        finalVenue?: string;
        seriesCountdownNotifiedDays?: number[];
      };
      if (!series.finalDate) continue;

      const finalMs = series.finalDate.toMillis();
      const dDays = daysUntilKst(finalMs, nowMs);

      // 발송 대상 day인지 확인
      if (!TARGET_DAYS.includes(dDays as 7 | 3 | 1)) continue;

      // 이미 발송한 day는 skip
      const notifiedDays = Array.isArray(series.seriesCountdownNotifiedDays)
        ? series.seriesCountdownNotifiedDays
        : [];
      if (notifiedDays.includes(dDays)) continue;

      // 구독자 수집 — seriesSubscriptions collectionGroup
      const subSnap = await db
        .collectionGroup('seriesSubscriptions')
        .where('seriesId', '==', seriesDoc.id)
        .get();

      const candidateUids: string[] = [];
      subSnap.forEach((d) => {
        const uid = uidFromPath(d.ref.path);
        if (uid) candidateUids.push(uid);
      });

      let sentCount = 0;
      if (candidateUids.length > 0) {
        // tournamentStart pref 재사용 (default ON) — 별도 토글 신설 시 prefs key 추가
        const allowedUids = await filterByPrefs(candidateUids, 'tournamentStart', true);
        const tokens = await gatherFcmTokens(allowedUids);
        if (tokens.length > 0) {
          const emoji = dDays === 1 ? '🚨' : dDays === 3 ? '⚡' : '📅';
          const venue = series.finalVenue ? ` · ${series.finalVenue}` : '';
          const res = await sendAndCleanup(tokens, {
            title: `${emoji} ${series.name ?? '시리즈'} 본선 D-${dDays}`,
            body: `${series.season ?? ''}${venue} 본선까지 ${dDays}일 남았습니다`,
            data: {
              type: 'series-countdown',
              seriesId: seriesDoc.id,
              dDay: String(dDays),
              url: `/m/series/${seriesDoc.id}`,
            },
            url: `/m/series/${seriesDoc.id}`,
            tag: `series-countdown-${seriesDoc.id}-${dDays}`,
          });
          sentCount = res.successCount;
        }
      }

      // 발송 여부 무관 — day 플래그에 추가 (중복 방지)
      await seriesDoc.ref.update({
        seriesCountdownNotifiedDays: admin.firestore.FieldValue.arrayUnion(dDays),
        [`seriesCountdownD${dDays}NotifiedAt`]: admin.firestore.FieldValue.serverTimestamp(),
        [`seriesCountdownD${dDays}NotifiedCount`]: sentCount,
      });

      console.log(
        `seriesCountdown: series=${seriesDoc.id} dDays=${dDays} candidates=${candidateUids.length} sent=${sentCount}`,
      );
    }
  },
);
