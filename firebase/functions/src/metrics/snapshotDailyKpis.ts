/**
 * 일별 플랫폼 KPI 스냅샷 — 유료 전환 판단용 추이 데이터 (2026-06-04 회의 2단계).
 *
 * 트리거: 매일 00:05 KST (Asia/Seoul)
 * 기록: platformKpis/{YYYY-MM-DD} (방금 끝난 어제 날짜 키)
 *
 * 배경: users.lastActiveAt은 최신값만 남아 과거 시점의 WAU를 소급 산출할 수 없다.
 * 매일 자정 직후 rolling 카운트를 박제해 일평균·주간/월간 추이 분석을 가능하게 한다.
 * 유료 재노출 트리거(활성 매장 ≥40 / 주간 LIVE ≥50 / WAU ≥300 중 2개 + PG)의 근거 데이터.
 *
 * 인덱스: users.lastActiveAt(단일 자동) / stores(status,isDemo) / liveSessions(status,endedAt)
 *        — 모두 기존 인덱스로 충분, 신규 불필요.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const DAY = 24 * 60 * 60 * 1000;

/** KST 기준 YYYY-MM-DD (UTC now + 9h 보정) */
function kstDateKey(ms: number): string {
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const snapshotDailyKpis = onSchedule(
  { schedule: '5 0 * * *', timeZone: 'Asia/Seoul', region: 'asia-northeast3', timeoutSeconds: 120 },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    const t1 = admin.firestore.Timestamp.fromMillis(now - DAY);
    const t7 = admin.firestore.Timestamp.fromMillis(now - 7 * DAY);
    const t30 = admin.firestore.Timestamp.fromMillis(now - 30 * DAY);

    const count = async (q: admin.firestore.Query): Promise<number> => {
      try {
        return (await q.count().get()).data().count;
      } catch (e) {
        console.error('[snapshotDailyKpis] count failed:', e);
        return 0;
      }
    };

    const [dau, wau, mau, activeTotal, activeDemo, liveDay, liveWeek] = await Promise.all([
      count(db.collection('users').where('lastActiveAt', '>=', t1)),
      count(db.collection('users').where('lastActiveAt', '>=', t7)),
      count(db.collection('users').where('lastActiveAt', '>=', t30)),
      count(db.collection('stores').where('status', '==', 'active')),
      // 실매장엔 isDemo 필드가 없을 수 있어 ==false는 누락 위험 → 차감 방식
      count(db.collection('stores').where('status', '==', 'active').where('isDemo', '==', true)),
      count(db.collection('liveSessions').where('status', '==', 'completed').where('endedAt', '>=', t1)),
      count(db.collection('liveSessions').where('status', '==', 'completed').where('endedAt', '>=', t7)),
    ]);

    // 00:05 실행 → 방금 끝난 "어제" 날짜를 키로 사용
    const dateKey = kstDateKey(now - DAY);

    await db.collection('platformKpis').doc(dateKey).set({
      date: dateKey,
      dau,
      wau,
      mau,
      activeRealStores: Math.max(0, activeTotal - activeDemo),
      liveCompletedDay: liveDay,   // 지난 24h 완료 LIVE
      liveCompletedWeek: liveWeek, // 지난 7일 완료 LIVE
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `[snapshotDailyKpis] ${dateKey} dau=${dau} wau=${wau} mau=${mau} stores=${Math.max(0, activeTotal - activeDemo)} live(d/w)=${liveDay}/${liveWeek}`,
    );
  },
);
