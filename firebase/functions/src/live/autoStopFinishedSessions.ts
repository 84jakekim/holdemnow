/**
 * 만료된 LIVE 세션을 자동 정리. 세 가지 만료 케이스를 처리:
 *
 * 1. **그레이스 만료** (마지막 레벨 종료 + 180초): finishingAt 박힌 세션이 cutoff 지나면
 *    status=completed로 박아 모든 LIVE 피드에서 사라지게 함.
 * 2. **ready 만료** (시작 버튼 안 누른 채 300초 경과): status=ready + createdAt 오래된 세션
 *    정리. "실시간" 컨셉상 시작 안 한 LIVE가 사용자 앱에 영원히 떠 있으면 안 됨.
 * 3. **좀비 running 정리** (levelEndsAt이 만료 후 180초 이상 경과): 매장 사장 LivePanel이
 *    꺼져 있어 nextLevelTick이 호출되지 않은 케이스. finishingAt이 박힐 일이 없으니
 *    여기서 좀비로 간주하고 completed로 직접 종료. "실시간" 컨셉의 핵심 안전망.
 *
 * 트리거: 매 1분 scheduled. 매장 사장 화면이 꺼져 있어도 서버에서 정리.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const FINISHING_GRACE_MS = 180 * 1000;
const READY_EXPIRY_MS = 300 * 1000;
const STALE_TIMER_MS = 180 * 1000;       // levelEndsAt 만료 후 이만큼 지나면 좀비
const STALE_NULL_TIMER_MS = 30 * 60_000; // levelEndsAt 없을 때 updatedAt 기준 30분
const ACTIVE_STATUSES = ['running', 'paused', 'break', 'ready'];

type Maybe<T> = T | null | undefined;
type TsLike = admin.firestore.Timestamp;

function tsMs(t: Maybe<TsLike>): number | null {
  if (!t || typeof (t as TsLike).toMillis !== 'function') return null;
  return (t as TsLike).toMillis();
}

export const autoStopFinishedSessions = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'asia-northeast3',
    timeoutSeconds: 60,
  },
  async () => {
    const db = admin.firestore();
    const now = Date.now();

    // 단일 쿼리로 active 세션 모두 fetch (running/paused/break/ready).
    // 베타 규모(수십 개)에서 충분히 효율적이고, 인덱스/필드 형태 문제에 견고.
    const snap = await db
      .collection('liveSessions')
      .where('status', 'in', ACTIVE_STATUSES)
      .get();

    const batch = db.batch();
    let finishingCount = 0;
    let readyCount = 0;
    let staleTimerCount = 0;
    let staleNullCount = 0;

    snap.forEach((doc) => {
      const data = doc.data() as {
        status?: string;
        storeName?: string;
        tournamentName?: string;
        finishingAt?: TsLike | null;
        createdAt?: TsLike | null;
        levelEndsAt?: TsLike | null;
        updatedAt?: TsLike | null;
      };
      const status = data.status ?? '';
      const finishingMs = tsMs(data.finishingAt);
      const createdMs = tsMs(data.createdAt);
      const levelEndsMs = tsMs(data.levelEndsAt);
      const updatedMs = tsMs(data.updatedAt);

      // 진단용 raw 덤프 — 모든 active 세션의 시간 필드를 ISO로 찍음.
      console.log(
        `[autoStop:scan] ${doc.id} store="${data.storeName ?? '?'}" status=${status} ` +
          `lvlEnds=${data.levelEndsAt?.toDate?.()?.toISOString() ?? 'null'} ` +
          `updated=${data.updatedAt?.toDate?.()?.toISOString() ?? 'null'} ` +
          `finishing=${data.finishingAt?.toDate?.()?.toISOString() ?? 'null'} ` +
          `created=${data.createdAt?.toDate?.()?.toISOString() ?? 'null'}`,
      );

      let reason = '';

      // 1. finishingAt 그레이스 만료
      if (finishingMs != null && finishingMs + FINISHING_GRACE_MS < now) {
        reason = 'finishingGrace';
      }
      // 2. ready 만료
      else if (status === 'ready' && createdMs != null && createdMs + READY_EXPIRY_MS < now) {
        reason = 'readyExpiry';
      }
      // 3. 좀비 timer 만료 (running OR paused — paused도 levelEndsAt이 만료 후 3분 지나면 좀비)
      else if (
        (status === 'running' || status === 'paused' || status === 'break') &&
        levelEndsMs != null &&
        levelEndsMs + STALE_TIMER_MS < now
      ) {
        reason = 'staleTimer';
      }
      // 4. levelEndsAt 없는 채 updatedAt이 오래된 좀비
      // paused로 잠시 멈춘 것일 수 있어 임계값 길게 (30분) — 의도된 휴식 시간 보호
      else if (
        (status === 'running' || status === 'paused' || status === 'break') &&
        levelEndsMs == null &&
        updatedMs != null &&
        updatedMs + STALE_NULL_TIMER_MS < now
      ) {
        reason = 'staleNullTimer';
      }

      if (!reason) return;

      console.log(
        `[autoStop] reaping ${doc.id} status=${status} reason=${reason} store="${data.storeName ?? '?'}" tourney="${data.tournamentName ?? '?'}"`,
      );

      batch.update(doc.ref, {
        status: 'completed',
        levelEndsAt: null,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (reason === 'finishingGrace') finishingCount++;
      else if (reason === 'readyExpiry') readyCount++;
      else if (reason === 'staleTimer') staleTimerCount++;
      else if (reason === 'staleNullTimer') staleNullCount++;
    });

    const total = finishingCount + readyCount + staleTimerCount + staleNullCount;
    if (total === 0) {
      console.log(
        `[autoStopFinishedSessions] scanned=${snap.size} no expired sessions to clean`,
      );
      return;
    }

    await batch.commit();
    console.log(
      `[autoStopFinishedSessions] scanned=${snap.size} stopped total=${total} (finishing=${finishingCount} ready=${readyCount} staleTimer=${staleTimerCount} staleNull=${staleNullCount})`,
    );
  },
);
