/**
 * 만료된 LIVE 세션을 자동 정리. 세 가지 만료 케이스를 처리:
 *
 * 1. **그레이스 만료** (마지막 레벨 종료 + 180초): finishingAt 박힌 세션이 cutoff 지나면
 *    status=completed로 박아 모든 LIVE 피드에서 사라지게 함.
 * 2. **ready 만료** (시작 버튼 안 누른 채 300초 경과): status=ready + createdAt 오래된 세션
 *    정리. "실시간" 컨셉상 시작 안 한 LIVE가 사용자 앱에 영원히 떠 있으면 안 됨.
 * 3. **진짜 좀비 정리** (totalStartedAt + structure 기반 elapsed가 전체 토너 길이 + 30분을
 *    초과한 running/paused/break): nextLevelTick이 호출되지 않은 채 finishingAt도 안 박힌
 *    유기 세션. paused로 잠시 멈춘 것일 수 있어 임계값(30분)을 길게 유지.
 *
 * ⚠ 과거에 있던 "levelEndsAt + 180초 = 좀비" 룰은 2026-05-21 hot fix로 **제거**됨.
 *    Deterministic timeline 도입 후 autoAdvanceLevel cron은 같은 currentLevel이면
 *    doc update를 의도적으로 skip하므로 doc의 levelEndsAt은 "첫 레벨 시작 시점에 박힌
 *    deadline" 상태로 영구히 남는다. 첫 레벨 종료 + 180초 시점에 정상 진행 중인 12레벨
 *    토너를 좀비로 오판해 status=completed 박는 버그가 사용자 환경에서 재현됨.
 *    클라이언트(admin-web/src/lib/live.ts)는 이미 동일 룰을 제거했고, 이제 서버도 통일.
 *
 * 트리거: 매 1분 scheduled. 매장 사장 화면이 꺼져 있어도 서버에서 정리.
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

const FINISHING_GRACE_MS = 180 * 1000;
const READY_EXPIRY_MS = 300 * 1000;
const ZOMBIE_GRACE_MS = 30 * 60_000;     // 전체 토너 길이를 이만큼 초과하면 좀비 (paused 보호)
const STALE_NULL_TIMER_MS = 30 * 60_000; // totalStartedAt 없는 레거시 fallback (updatedAt 기준)
const ACTIVE_STATUSES = ['running', 'paused', 'break', 'ready'];

type Maybe<T> = T | null | undefined;
type TsLike = admin.firestore.Timestamp;

function tsMs(t: Maybe<TsLike>): number | null {
  if (!t || typeof (t as TsLike).toMillis !== 'function') return null;
  return (t as TsLike).toMillis();
}

/** structure 전체 길이(초). blindStructureLocked 우선, 없으면 blindStructure. */
function totalStructureMs(data: {
  blindStructureLocked?: BlindLevel[] | null;
  blindStructure?: BlindLevel[] | null;
}): number | null {
  const locked = data.blindStructureLocked ?? [];
  const live = data.blindStructure ?? [];
  const structure = locked.length > 0 ? locked : live;
  if (structure.length === 0) return null;
  let total = 0;
  for (const lvl of structure) total += Math.max(0, lvl.durationSec) * 1000;
  return total;
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
    let zombieCount = 0;
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
        totalStartedAt?: TsLike | null;
        totalPausedMs?: number;
        pausedAt?: TsLike | null;
        blindStructureLocked?: BlindLevel[] | null;
        blindStructure?: BlindLevel[] | null;
      };
      const status = data.status ?? '';
      const finishingMs = tsMs(data.finishingAt);
      const createdMs = tsMs(data.createdAt);
      const startedMs = tsMs(data.totalStartedAt);
      const updatedMs = tsMs(data.updatedAt);
      const totalPausedMs = data.totalPausedMs ?? 0;
      const totalStructureLen = totalStructureMs(data);

      // paused면 elapsed가 pausedAt에서 정지 (autoAdvanceLevel과 동일 로직)
      const refNowMs = status === 'paused' && data.pausedAt
        ? tsMs(data.pausedAt) ?? now
        : now;
      const elapsedMs = startedMs != null
        ? Math.max(0, refNowMs - startedMs - totalPausedMs)
        : null;

      // 진단용 raw 덤프 — 모든 active 세션의 시간 필드를 ISO로 찍음.
      console.log(
        `[autoStop:scan] ${doc.id} store="${data.storeName ?? '?'}" status=${status} ` +
          `started=${data.totalStartedAt?.toDate?.()?.toISOString() ?? 'null'} ` +
          `elapsedMin=${elapsedMs != null ? Math.floor(elapsedMs / 60_000) : 'null'} ` +
          `totalMin=${totalStructureLen != null ? Math.floor(totalStructureLen / 60_000) : 'null'} ` +
          `finishing=${data.finishingAt?.toDate?.()?.toISOString() ?? 'null'} ` +
          `created=${data.createdAt?.toDate?.()?.toISOString() ?? 'null'}`,
      );

      let reason = '';

      // 1. finishingAt 그레이스 만료 (autoAdvanceLevel이 박은 마지막 레벨)
      if (finishingMs != null && finishingMs + FINISHING_GRACE_MS < now) {
        reason = 'finishingGrace';
      }
      // 2. ready 만료
      else if (status === 'ready' && createdMs != null && createdMs + READY_EXPIRY_MS < now) {
        reason = 'readyExpiry';
      }
      // 3. 진짜 좀비 정리 — totalStartedAt + structure 기반 elapsed가 전체 토너 길이 + 30분을 초과
      //    (paused 의도적 휴식 시간 보호용으로 그레이스 30분 부여)
      //    이 룰은 totalStartedAt이 있을 때만 동작 — 레거시 세션은 4번 룰로 처리.
      else if (
        (status === 'running' || status === 'paused' || status === 'break') &&
        startedMs != null &&
        totalStructureLen != null &&
        elapsedMs != null &&
        elapsedMs > totalStructureLen + ZOMBIE_GRACE_MS
      ) {
        reason = 'zombieOverrun';
      }
      // 4. 레거시 fallback — totalStartedAt 없는 채 updatedAt이 30분 이상 stale
      else if (
        (status === 'running' || status === 'paused' || status === 'break') &&
        startedMs == null &&
        updatedMs != null &&
        updatedMs + STALE_NULL_TIMER_MS < now
      ) {
        reason = 'staleNullTimer';
      }

      if (!reason) return;

      console.log(
        `[autoStop] reaping ${doc.id} status=${status} reason=${reason} ` +
          `store="${data.storeName ?? '?'}" tourney="${data.tournamentName ?? '?'}" ` +
          `elapsedMin=${elapsedMs != null ? Math.floor(elapsedMs / 60_000) : '?'} ` +
          `totalMin=${totalStructureLen != null ? Math.floor(totalStructureLen / 60_000) : '?'}`,
      );

      batch.update(doc.ref, {
        status: 'completed',
        levelEndsAt: null,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (reason === 'finishingGrace') finishingCount++;
      else if (reason === 'readyExpiry') readyCount++;
      else if (reason === 'zombieOverrun') zombieCount++;
      else if (reason === 'staleNullTimer') staleNullCount++;
    });

    const total = finishingCount + readyCount + zombieCount + staleNullCount;
    if (total === 0) {
      console.log(
        `[autoStopFinishedSessions] scanned=${snap.size} no expired sessions to clean`,
      );
      return;
    }

    await batch.commit();
    console.log(
      `[autoStopFinishedSessions] scanned=${snap.size} stopped total=${total} ` +
        `(finishing=${finishingCount} ready=${readyCount} zombie=${zombieCount} staleNull=${staleNullCount})`,
    );
  },
);
