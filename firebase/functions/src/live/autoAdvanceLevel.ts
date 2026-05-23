/**
 * LIVE 세션 — Deterministic Timeline 동기화 (서버 cron · fallback).
 *
 * 2026-05-23 재설계:
 *   기존엔 cron이 1분마다 모든 running 세션의 timeline을 계산해 currentLevel을 업데이트했음.
 *   문제: cron 평균 30초 지연 → 클라이언트가 sec=0에 다음 레벨 사운드/TTS 즉시 발사하려 해도
 *   서버 doc 변경이 30초 뒤. 클라 즉시 호출 경로(advanceLevelIfDue)가 정상 동작하면
 *   이 cron은 거의 일을 하지 않음 (fallback).
 *
 *   새 흐름:
 *   1. 클라(시청자/사장)가 매초 sec=0 도달 시 advanceLevelIfDue transaction 호출.
 *   2. transaction이 currentLevel을 즉시 증가 + nextLevelAt을 다음 레벨 끝나는 시각으로 박음.
 *   3. 이 cron은 nextLevelAt이 지났는데도 advance가 안 된 세션(클라 화면 모두 꺼진 케이스)만 catch-up.
 *
 *   Firebase v2 scheduler 최소 주기가 1분이라 cron 자체는 1분 유지하되,
 *   nextLevelAt이 NOW 이전인 세션만 advance 대상으로 좁힘 → 클라가 정상 동작하면 cron은 사실상 no-op.
 *
 * 트리거: 매 1분 scheduled.
 * 처리: nextLevelAt <= now 이고 finishingAt 없는 running 세션만 1레벨 advance (또는 finishingAt 박음).
 * 동시성: idempotent. transaction으로 검증.
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
  nextLevelAt?: admin.firestore.Timestamp | null;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  storeName?: string;
  tournamentName?: string;
}

export const autoAdvanceLevel = onSchedule(
  {
    schedule: 'every 1 minutes', // Firebase v2 scheduler 최소 1분 — 클라 즉시 호출이 1차 경로, 이건 fallback
    region: 'asia-northeast3',
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    // running 전부 fetch — 베타 규모(<100)에서 충분히 효율적
    // nextLevelAt 인덱스 없이 클라 사이드 필터 (running 세션 자체가 적어서 OK)
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
    let skipped = 0;
    let legacyHandled = 0;

    for (const sessionDoc of snap.docs) {
      const data = sessionDoc.data() as SessionData;
      if (data.status !== 'running') continue;
      if (data.finishingAt) continue;

      const structure = (data.blindStructureLocked && data.blindStructureLocked.length > 0)
        ? data.blindStructureLocked
        : (data.blindStructure ?? []);
      if (!structure.length) continue;

      const currentLevel = data.currentLevel ?? structure[0].level;
      const idx = structure.findIndex((l) => l.level === currentLevel);

      // Legacy 세션(nextLevelAt 박혀있지 않음) — totalStartedAt 기반 timeline으로 한번 nextLevelAt 박아주기
      if (!data.nextLevelAt) {
        if (!data.totalStartedAt) {
          skipped++;
          continue;
        }
        // timeline 기반으로 현재 레벨 끝나는 시각 계산
        const startedMs = data.totalStartedAt.toMillis();
        const totalPausedMs = data.totalPausedMs ?? 0;
        const elapsedMs = Math.max(0, Date.now() - startedMs - totalPausedMs);
        let cumulativeMs = 0;
        let levelEndMs: number | null = null;
        for (const lvl of structure) {
          const durMs = Math.max(0, lvl.durationSec) * 1000;
          if (lvl.level === currentLevel) {
            levelEndMs = startedMs + totalPausedMs + cumulativeMs + durMs;
            break;
          }
          cumulativeMs += durMs;
        }
        if (levelEndMs == null) {
          skipped++;
          continue;
        }
        // 아직 안 끝난 레벨 → nextLevelAt만 박아두고 다음 cron으로
        if (levelEndMs > Date.now()) {
          await sessionDoc.ref.update({
            nextLevelAt: admin.firestore.Timestamp.fromMillis(levelEndMs),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          legacyHandled++;
          continue;
        }
        // 이미 끝난 상태 — 아래 advance/finish 로직으로 직진하기 위해 nextLevelAt을 가상 박음
        data.nextLevelAt = admin.firestore.Timestamp.fromMillis(levelEndMs);
        // elapsed로 idx 보정 불가능 — 클라 advance가 한 레벨씩 진행하는 게 정책. 한 cron tick당 1레벨만.
      }

      // nextLevelAt이 아직 도래 안 했으면 skip (클라가 처리 예정)
      if (data.nextLevelAt && data.nextLevelAt.toMillis() > now.toMillis()) {
        continue;
      }

      // SANITY: structure에서 currentLevel 못 찾으면 skip
      if (idx < 0) {
        console.warn(
          `[autoAdvanceLevel] BLOCKED — currentLevel=${currentLevel} not found in structure. ` +
          `session=${sessionDoc.id} structureLen=${structure.length}`,
        );
        skipped++;
        continue;
      }

      // 마지막 레벨이면 finishingAt 박음
      if (idx === structure.length - 1) {
        // SANITY GUARD: structure 길이 일관성 검증 (2026-05-21 finishingAt 오박힘 버그 방지)
        const lockedLen = (data.blindStructureLocked ?? []).length;
        const liveLen = (data.blindStructure ?? []).length;
        const lockMatchesLive = lockedLen === 0 || liveLen === 0 || Math.abs(lockedLen - liveLen) <= 1;
        if (!lockMatchesLive) {
          console.warn(
            `[autoAdvanceLevel] BLOCKED finishingAt — structure mismatch. ` +
            `session=${sessionDoc.id} lockedLen=${lockedLen} liveLen=${liveLen} ` +
            `store="${data.storeName ?? '?'}" tourney="${data.tournamentName ?? '?'}"`,
          );
          skipped++;
          continue;
        }

        await sessionDoc.ref.update({
          finishingAt: admin.firestore.FieldValue.serverTimestamp(),
          levelSecondsLeft: 0,
          levelEndsAt: null,
          nextLevelAt: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        finished++;
        console.log(
          `[autoAdvanceLevel] CATCH-UP finishing session=${sessionDoc.id} ` +
          `(last level ${currentLevel}) store="${data.storeName ?? '?'}"`,
        );
        continue;
      }

      // 다음 레벨로 advance — transaction으로 안전하게 (클라와 race 회피)
      const next = structure[idx + 1];
      const nextEndMs = Date.now() + next.durationSec * 1000;
      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(sessionDoc.ref);
          const fd = fresh.data() as SessionData | undefined;
          if (!fd || fd.status !== 'running') return;
          if (fd.currentLevel !== currentLevel) return; // 이미 클라가 advance함
          if (fd.finishingAt) return;
          tx.update(sessionDoc.ref, {
            currentLevel: next.level,
            smallBlind: next.sb,
            bigBlind: next.bb,
            ante: next.ante,
            levelSecondsLeft: next.durationSec,
            levelEndsAt: admin.firestore.Timestamp.fromMillis(nextEndMs),
            nextLevelAt: admin.firestore.Timestamp.fromMillis(nextEndMs),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        advanced++;
        console.log(
          `[autoAdvanceLevel] CATCH-UP advanced session=${sessionDoc.id} ` +
          `${currentLevel}→${next.level} (store="${data.storeName ?? '?'}" tourney="${data.tournamentName ?? '?'}") ` +
          `— 클라 advance 누락된 케이스`,
        );
      } catch (e) {
        console.warn(`[autoAdvanceLevel] tx failed session=${sessionDoc.id}`, e);
        skipped++;
      }
    }

    console.log(
      `[autoAdvanceLevel] scanned=${snap.size} advanced=${advanced} finished=${finished} ` +
      `skipped=${skipped} legacyHandled=${legacyHandled}`,
    );
  },
);
