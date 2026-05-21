/**
 * LIVE 세션 — Deterministic Timeline 동기화 (서버 cron).
 *
 * 새 설계:
 * - 세션 시작 시점에 totalStartedAt + blindStructureLocked가 박힘.
 * - 클라이언트와 서버 모두 동일한 computeTimelinePosition 로직으로
 *   "지금 어느 레벨인지·해당 레벨 몇 초 남았는지"를 절대 시각 기반으로 계산.
 * - 클라이언트는 매초 자체 계산 → 화면 표시는 cron 지연과 무관하게 정확.
 * - 이 cron은 doc의 "보이는 필드"를 동기화 (currentLevel·sb·bb·ante·levelEndsAt·levelSecondsLeft).
 *   외부 구독자(모바일 LIVE 피드 등)가 보는 doc 값이 1분 stale할 수 있지만,
 *   useLiveCountdown이 timeline 기반으로 매초 정확히 그린다.
 *
 * 트리거: 매 1분 scheduled.
 * 처리:
 * 1. running 세션 전부 fetch (levelEndsAt 필터 없음 — 모든 running 동기화)
 * 2. 각 세션의 timeline position 계산
 * 3. currentLevel / sb / bb / ante가 stale하면 update
 * 4. isFinishing이면 finishingAt 박음 (autoStopFinishedSessions가 그레이스 후 정리)
 *
 * 동시성: idempotent. 같은 currentLevel이면 update skip.
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

interface SessionData {
  status?: string;
  currentLevel?: number;
  blindStructure?: BlindLevel[];
  blindStructureLocked?: BlindLevel[];
  levelEndsAt?: admin.firestore.Timestamp | null;
  levelSecondsLeft?: number;
  finishingAt?: admin.firestore.Timestamp | null;
  totalStartedAt?: admin.firestore.Timestamp | null;
  totalPausedMs?: number;
  pausedAt?: admin.firestore.Timestamp | null;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  storeName?: string;
  tournamentName?: string;
}

/** admin-web/src/lib/live.ts의 computeTimelinePosition과 동일 로직 (서버 사이드 복사). */
function computeTimelinePosition(data: SessionData): {
  level: number;
  secondsLeft: number;
  isFinishing: boolean;
  sb: number;
  bb: number;
  ante: number;
  durationSec: number;
} | null {
  const structure: BlindLevel[] = (data.blindStructureLocked && data.blindStructureLocked.length > 0)
    ? data.blindStructureLocked
    : (data.blindStructure ?? []);
  if (!structure.length) return null;

  // Fallback: totalStartedAt 없는 레거시 세션 — 현재 currentLevel 그대로 유지하라는 신호
  if (!data.totalStartedAt) {
    const cur = structure.find((l) => l.level === (data.currentLevel ?? 1)) ?? structure[0];
    return {
      level: cur.level,
      secondsLeft: data.levelSecondsLeft ?? cur.durationSec,
      isFinishing: !!data.finishingAt,
      sb: cur.sb,
      bb: cur.bb,
      ante: cur.ante ?? 0,
      durationSec: cur.durationSec,
    };
  }

  const startedMs = data.totalStartedAt.toMillis();
  const totalPausedMs = data.totalPausedMs ?? 0;
  const refNowMs = data.status === 'paused' && data.pausedAt
    ? data.pausedAt.toMillis()
    : Date.now();
  const elapsedMs = Math.max(0, refNowMs - startedMs - totalPausedMs);

  let cumulativeMs = 0;
  for (const lvl of structure) {
    const durMs = Math.max(0, lvl.durationSec) * 1000;
    if (cumulativeMs + durMs > elapsedMs) {
      const secondsLeft = Math.max(0, Math.ceil((cumulativeMs + durMs - elapsedMs) / 1000));
      return {
        level: lvl.level,
        secondsLeft,
        isFinishing: false,
        sb: lvl.sb,
        bb: lvl.bb,
        ante: lvl.ante ?? 0,
        durationSec: lvl.durationSec,
      };
    }
    cumulativeMs += durMs;
  }

  const last = structure[structure.length - 1];
  return {
    level: last.level,
    secondsLeft: 0,
    isFinishing: true,
    sb: last.sb,
    bb: last.bb,
    ante: last.ante ?? 0,
    durationSec: last.durationSec,
  };
}

export const autoAdvanceLevel = onSchedule(
  {
    schedule: 'every 1 minutes', // Firebase v2 scheduler 최소 1분
    region: 'asia-northeast3',
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();

    // running 전부 fetch — 베타 규모(<100)에서 충분히 효율적
    const snap = await db
      .collection('liveSessions')
      .where('status', '==', 'running')
      .get();

    if (snap.empty) {
      console.log('[autoAdvanceLevel] no running sessions');
      return;
    }

    let advanced = 0;
    let finished = 0;
    let synced = 0;

    for (const doc of snap.docs) {
      const data = doc.data() as SessionData;
      if (data.status !== 'running') continue;
      if (data.finishingAt) continue; // 이미 마지막 레벨 처리됨

      const pos = computeTimelinePosition(data);
      if (!pos) continue;

      // 마지막 레벨까지 모두 소진 → finishingAt 박음
      if (pos.isFinishing) {
        // SANITY GUARD: 진짜 마지막 레벨이 맞는지 다층 검증.
        // 12레벨 토너인데 5~7레벨쯤 자동 종료되는 버그(2026-05-21 사용자 보고)의 핵심 원인 차단.
        // ① locked structure가 비정상적으로 짧으면 (예: 한쪽만 동기화 누락) skip
        // ② pos.level이 locked의 마지막 레벨과 일치해야 finishingAt 박음
        // ③ live 구조(blindStructure)와 lock된 구조의 길이가 같은지도 점검
        const lockedLen = (data.blindStructureLocked ?? []).length;
        const liveLen = (data.blindStructure ?? []).length;
        const effectiveStructure = lockedLen > 0 ? data.blindStructureLocked! : (data.blindStructure ?? []);
        const lastLevelNum = effectiveStructure.length > 0
          ? effectiveStructure[effectiveStructure.length - 1].level
          : -1;

        const isReallyLastLevel = pos.level === lastLevelNum && effectiveStructure.length > 0;
        const lockMatchesLive = lockedLen === 0 || liveLen === 0 || Math.abs(lockedLen - liveLen) <= 1;

        if (!isReallyLastLevel || !lockMatchesLive) {
          console.warn(
            `[autoAdvanceLevel] BLOCKED finishingAt — sanity guard tripped. ` +
            `session=${doc.id} pos.level=${pos.level} lastLevelNum=${lastLevelNum} ` +
            `lockedLen=${lockedLen} liveLen=${liveLen} store="${data.storeName ?? '?'}" ` +
            `tourney="${data.tournamentName ?? '?'}". ` +
            `세션이 정상 진행 중인데 마지막 레벨로 오판된 케이스로 추정. ` +
            `타이머 진행은 continueElevated하고 다음 cron tick에서 재평가.`
          );
          continue;
        }

        await doc.ref.update({
          finishingAt: admin.firestore.FieldValue.serverTimestamp(),
          currentLevel: pos.level,
          smallBlind: pos.sb,
          bigBlind: pos.bb,
          ante: pos.ante,
          levelSecondsLeft: 0,
          levelEndsAt: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        finished++;
        console.log(
          `[autoAdvanceLevel] finished session ${doc.id} (last level ${pos.level}) store="${data.storeName ?? '?'}"`,
        );
        continue;
      }

      // 같은 레벨이면 doc update 아예 X — 클라이언트는 totalStartedAt 기반 timeline으로
      // 매초 자체 계산하므로 levelEndsAt sync 불필요. 매분 doc update가 클라이언트
      // useEffect 재실행을 일으켜 잠재적 race(타이머 점프) 원인이 됨.
      if ((data.currentLevel ?? 0) === pos.level) {
        continue;
      }

      // 레벨 전환만 doc update — currentLevel/sb/bb/ante 갱신 (levelEndsAt/levelSecondsLeft 제거)
      await doc.ref.update({
        currentLevel: pos.level,
        smallBlind: pos.sb,
        bigBlind: pos.bb,
        ante: pos.ante,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      advanced++;
      console.log(
        `[autoAdvanceLevel] advanced ${doc.id} ${data.currentLevel ?? '?'}→${pos.level} (${data.storeName ?? '?'} · ${data.tournamentName ?? '?'})`,
      );
    }

    console.log(
      `[autoAdvanceLevel] scanned=${snap.size} advanced=${advanced} synced=${synced} finished=${finished}`,
    );
  },
);
