/**
 * curateHotVideos — 인기 유튜브 영상 자동 큐레이션
 *
 * 트리거:
 *  - onSchedule: 매시 정각 KST (config.scheduleHourKst 와 일치할 때만 실제 큐레이션 실행)
 *  - onRequest:  수동 트리거 (관리자 즉시 실행용, secret query param 인증)
 *  - onCall:     triggerYoutubeCurationNow.ts (platform_admin 어드민 버튼)
 *
 * 흐름:
 *   0. platformConfig/youtubeCuration doc 읽기 (없으면 default)
 *   1. hotYoutubers 컬렉션에서 isActive=true && channelId!='' 채널 목록 수집
 *   2. 각 채널 RSS feed 파싱 → 최근 15개 videoId 추출
 *   3. YouTube Data API videos.list (50개 batch) 로 메타/통계/duration 보강
 *   4. config 기반 필터:
 *        - maxAgeDays 이내
 *        - 쇼츠 제외 (excludeShorts && duration <= 60s 또는 #shorts/#쇼츠)
 *        - 최소 길이 minDurationSec
 *        - includeKeywords 중 1개 이상 포함
 *        - excludeKeywords 중 1개라도 있으면 제외
 *   5. score = viewCount / daysSincePublished 계산
 *   6. score 내림차순 정렬 → 상위 maxResults 만 hotYoutubeVideos upsert (manual doc 보호)
 *   7. 만료 auto doc 일괄 삭제
 *   8. platformConfig/youtubeCuration.lastRunAt, lastRunResult 기록
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { logger } from 'firebase-functions/v2';

export const YOUTUBE_API_KEY = defineSecret('YOUTUBE_API_KEY');
// onRequest 수동 트리거용 단순 secret — onCall(triggerYoutubeCurationNow) 외 백업 경로.
const TRIGGER_SECRET = 'holdemnow-trigger-2026';

const db = () => admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

// ─── 타입 ─────────────────────────────────────────────────────

interface YoutuberDoc {
  channelId?: string;
  channelUrl?: string;
  isActive?: boolean;
}

interface VideoApiItem {
  id: string;
  snippet: {
    title: string;
    description?: string;
    channelId: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: {
      high?: { url: string };
      medium?: { url: string };
    };
  };
  statistics: {
    viewCount?: string;
  };
  contentDetails: {
    duration: string; // ISO 8601 (예: PT15M33S)
  };
}

export interface CurationFilterStats {
  shortsExcluded: number;
  keywordExcluded: number;
  ageExcluded: number;
  minDurationExcluded: number;
  maxResultsCut: number;
}

export interface CurationResult {
  channelsActive: number;
  videoIdsCollected: number;
  apiResponses: number;
  upserted: number;
  expiredDeleted: number;
  durationMs: number;
  filtered: CurationFilterStats;
  skippedBySchedule?: boolean;
  message?: string;
}

interface YoutubeCurationConfig {
  includeKeywords: string[];
  excludeKeywords: string[];
  maxResults: number;
  scheduleHourKst: number;
  excludeShorts: boolean;
  minDurationSec: number;
  maxAgeDays: number;
  refreshIntervalDays: number;
  expirePreviousOnRefresh: boolean;
  autoVideoMaxAgeDays: number;
}

const DEFAULT_CONFIG: YoutubeCurationConfig = {
  includeKeywords: [
    '홀덤', '포커', 'poker', 'holdem', "hold'em",
    '토너먼트', 'tournament',
    'NL', 'NLH', '노리밋',
    'GTD', '게런티',
    '플롭', 'flop', '리버', 'river', '턴', 'turn',
    '올인', 'all-in',
    '블라인드', 'blind',
    'WSOP', 'WPT', 'EPT', 'APT', 'KPT',
    '베가스', '라스베가스', '마카오',
  ],
  excludeKeywords: [],
  maxResults: 20,
  scheduleHourKst: 4,
  excludeShorts: true,
  minDurationSec: 61,
  maxAgeDays: 90,
  refreshIntervalDays: 1,
  expirePreviousOnRefresh: true,
  autoVideoMaxAgeDays: 7,
};

// ─── 헬퍼 ─────────────────────────────────────────────────────

/**
 * platformConfig/youtubeCuration doc fetch.
 * 없거나 일부 필드가 비면 DEFAULT_CONFIG 값으로 보충.
 * lastRunAt도 함께 반환 (refreshIntervalDays 검사용).
 */
async function loadCurationConfig(): Promise<{
  config: YoutubeCurationConfig;
  lastRunAt: admin.firestore.Timestamp | null;
}> {
  try {
    const snap = await db().collection('platformConfig').doc('youtubeCuration').get();
    if (!snap.exists) return { config: { ...DEFAULT_CONFIG }, lastRunAt: null };
    const data = snap.data() ?? {};
    const lastRunAt =
      data.lastRunAt instanceof Timestamp ? (data.lastRunAt as admin.firestore.Timestamp) : null;
    return {
      config: {
        includeKeywords: Array.isArray(data.includeKeywords)
          ? (data.includeKeywords as string[])
          : DEFAULT_CONFIG.includeKeywords,
        excludeKeywords: Array.isArray(data.excludeKeywords)
          ? (data.excludeKeywords as string[])
          : DEFAULT_CONFIG.excludeKeywords,
        maxResults: clampInt(data.maxResults, 5, 50, DEFAULT_CONFIG.maxResults),
        scheduleHourKst: clampInt(data.scheduleHourKst, 0, 23, DEFAULT_CONFIG.scheduleHourKst),
        excludeShorts:
          typeof data.excludeShorts === 'boolean'
            ? data.excludeShorts
            : DEFAULT_CONFIG.excludeShorts,
        minDurationSec: clampInt(data.minDurationSec, 0, 7200, DEFAULT_CONFIG.minDurationSec),
        maxAgeDays: clampInt(data.maxAgeDays, 1, 365, DEFAULT_CONFIG.maxAgeDays),
        refreshIntervalDays: clampInt(
          data.refreshIntervalDays,
          1,
          90,
          DEFAULT_CONFIG.refreshIntervalDays,
        ),
        expirePreviousOnRefresh:
          typeof data.expirePreviousOnRefresh === 'boolean'
            ? data.expirePreviousOnRefresh
            : DEFAULT_CONFIG.expirePreviousOnRefresh,
        autoVideoMaxAgeDays: clampInt(
          data.autoVideoMaxAgeDays,
          1,
          90,
          DEFAULT_CONFIG.autoVideoMaxAgeDays,
        ),
      },
      lastRunAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`curation config 읽기 실패 — default 사용: ${msg}`);
    return { config: { ...DEFAULT_CONFIG }, lastRunAt: null };
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? Math.floor(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** ISO 8601 duration ("PT1H2M3S") → 초 */
function parseISO8601DurationToSeconds(iso: string | undefined): number {
  if (!iso) return 0;
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return 0;
  return (
    parseInt(m[1] ?? '0', 10) * 3600 +
    parseInt(m[2] ?? '0', 10) * 60 +
    parseInt(m[3] ?? '0', 10)
  );
}

/** 현재 시각의 KST 시간(0~23) */
function currentKstHour(): number {
  // UTC + 9
  const nowUtcMs = Date.now();
  const kstMs = nowUtcMs + 9 * 3600 * 1000;
  return new Date(kstMs).getUTCHours();
}

/** RSS feed에서 videoId 목록 추출 (최근 15개) */
async function fetchVideoIdsFromRss(channelId: string): Promise<string[]> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  try {
    const res = await axios.get<string>(feedUrl, {
      timeout: 8000,
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 Pink Rabbit-Curator/1.0' },
    });
    const xml: string = typeof res.data === 'string' ? res.data : String(res.data);

    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    const feed = parsed?.feed;
    if (!feed) return [];
    const entries = feed.entry;
    if (!entries) return [];
    const entryArr: unknown[] = Array.isArray(entries) ? entries : [entries];

    const ids: string[] = [];
    for (const entry of entryArr.slice(0, 15)) {
      const e = entry as Record<string, unknown>;
      const vid = (e['yt:videoId'] as string | undefined)?.trim();
      if (vid) ids.push(vid);
    }
    return ids;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`RSS fetch 실패 channelId=${channelId}: ${msg}`);
    return [];
  }
}

/** YouTube Data API videos.list — 50개 단위 batch (snippet,statistics,contentDetails) */
async function fetchVideoDetails(
  videoIds: string[],
  apiKey: string,
): Promise<VideoApiItem[]> {
  const results: VideoApiItem[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const url = 'https://www.googleapis.com/youtube/v3/videos';
      const res = await axios.get<{ items: VideoApiItem[] }>(url, {
        params: {
          part: 'snippet,statistics,contentDetails',
          id: batch.join(','),
          key: apiKey,
        },
        timeout: 10000,
      });
      results.push(...(res.data.items ?? []));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`YouTube API batch 실패 (i=${i}): ${msg}`);
    }
  }
  return results;
}

/**
 * channelUrl에서 channelId(UC...) 자동 추출 + hotYoutubers doc 업데이트.
 */
async function backfillChannelId(
  docId: string,
  channelUrl: string,
): Promise<string | null> {
  try {
    const res = await axios.get<string>(channelUrl, {
      timeout: 8000,
      responseType: 'text',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    });
    const html = typeof res.data === 'string' ? res.data : String(res.data);
    const m =
      html.match(/"channelId":"(UC[\w-]+)"/) ??
      html.match(/<meta itemprop="channelId" content="(UC[\w-]+)"/) ??
      html.match(/"externalId":"(UC[\w-]+)"/);
    let cid = m?.[1];

    if (!cid) {
      const directMatch = channelUrl.match(/\/channel\/(UC[\w-]+)/);
      cid = directMatch?.[1];
    }

    if (!cid) {
      logger.warn(`channelId 추출 실패: ${docId} (${channelUrl})`);
      return null;
    }
    await db().collection('hotYoutubers').doc(docId).update({
      channelId: cid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info(`channelId 추출: ${docId} → ${cid}`);
    return cid;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`backfillChannelId 실패 ${docId}: ${msg}`);
    return null;
  }
}

function calcScore(viewCount: number, publishedAtMs: number): number {
  const now = Date.now();
  const daysSince = Math.max(1, (now - publishedAtMs) / 86_400_000);
  return viewCount / daysSince;
}

/** lastRunAt + lastRunResult 기록 (best-effort) */
async function writeLastRun(result: CurationResult): Promise<void> {
  try {
    await db().collection('platformConfig').doc('youtubeCuration').set(
      {
        lastRunAt: FieldValue.serverTimestamp(),
        lastRunResult: {
          upserted: result.upserted,
          expiredDeleted: result.expiredDeleted,
          durationMs: result.durationMs,
          channelsActive: result.channelsActive,
          videoIdsCollected: result.videoIdsCollected,
          apiResponses: result.apiResponses,
          filtered: {
            shortsExcluded: result.filtered.shortsExcluded,
            keywordExcluded: result.filtered.keywordExcluded,
            maxResultsCut: result.filtered.maxResultsCut,
          },
          message: result.message ?? null,
        },
      },
      { merge: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`lastRunResult 기록 실패: ${msg}`);
  }
}

// ─── 메인 로직 (onSchedule + onRequest + onCall 공용) ───────────────

export async function runCuration(
  apiKey: string,
  opts: { force?: boolean } = {},
): Promise<CurationResult> {
  const startedAt = Date.now();
  const firestore = db();
  const { config, lastRunAt } = await loadCurationConfig();
  const cutoffMs = Date.now() - config.maxAgeDays * 86_400_000;

  const filtered: CurationFilterStats = {
    shortsExcluded: 0,
    keywordExcluded: 0,
    ageExcluded: 0,
    minDurationExcluded: 0,
    maxResultsCut: 0,
  };

  // 0. refreshIntervalDays 검사 — 마지막 실행 이후 N일 안 지났으면 skip
  //    수동 트리거(force=true)는 무시.
  if (!opts.force && config.refreshIntervalDays > 1 && lastRunAt) {
    const intervalMs = config.refreshIntervalDays * 86_400_000;
    const elapsed = Date.now() - lastRunAt.toMillis();
    if (elapsed < intervalMs) {
      const elapsedH = Math.floor(elapsed / 3_600_000);
      const totalH = config.refreshIntervalDays * 24;
      logger.info(
        `[curate] refresh interval not yet elapsed (${elapsedH}h / ${totalH}h) — skip`,
      );
      return {
        channelsActive: 0,
        videoIdsCollected: 0,
        apiResponses: 0,
        upserted: 0,
        expiredDeleted: 0,
        durationMs: Date.now() - startedAt,
        filtered,
        skippedBySchedule: true,
        message: `교체 주기 미도달 (${elapsedH}h / ${totalH}h)`,
      };
    }
  }

  // 1. 활성 유튜버 channelId 수집
  const youtubersSnap = await firestore
    .collection('hotYoutubers')
    .where('isActive', '==', true)
    .get();

  const channelIds: string[] = [];
  for (const docSnap of youtubersSnap.docs) {
    const data = docSnap.data() as YoutuberDoc;
    let cid = data.channelId?.trim() ?? '';
    if (data.channelUrl) {
      const filledId = await backfillChannelId(docSnap.id, data.channelUrl);
      if (filledId) cid = filledId;
    }
    if (cid.startsWith('UC')) channelIds.push(cid);
  }

  if (channelIds.length === 0) {
    const result: CurationResult = {
      channelsActive: 0,
      videoIdsCollected: 0,
      apiResponses: 0,
      upserted: 0,
      expiredDeleted: 0,
      durationMs: Date.now() - startedAt,
      filtered,
      message: '활성 채널이 없습니다.',
    };
    await writeLastRun(result);
    return result;
  }
  logger.info(`활성 채널 ${channelIds.length}개 발견`);

  // 2. RSS → videoId 수집
  const allVideoIds: string[] = [];
  await Promise.all(
    channelIds.map(async (cid) => {
      const ids = await fetchVideoIdsFromRss(cid);
      allVideoIds.push(...ids);
    }),
  );
  const uniqueVideoIds = [...new Set(allVideoIds)];
  logger.info(`RSS 수집 videoId ${uniqueVideoIds.length}개 (중복 제거)`);

  if (uniqueVideoIds.length === 0) {
    const result: CurationResult = {
      channelsActive: channelIds.length,
      videoIdsCollected: 0,
      apiResponses: 0,
      upserted: 0,
      expiredDeleted: 0,
      durationMs: Date.now() - startedAt,
      filtered,
      message: 'RSS feed에서 영상이 발견되지 않았습니다.',
    };
    await writeLastRun(result);
    return result;
  }

  // 3. YouTube API videos.list
  const items = await fetchVideoDetails(uniqueVideoIds, apiKey);
  logger.info(`API 응답 ${items.length}개`);

  // 4. 필터링 + 점수 계산
  interface ScoredVideo {
    item: VideoApiItem;
    publishedMs: number;
    score: number;
    durationSec: number;
  }
  const scored: ScoredVideo[] = [];

  const includeLower = config.includeKeywords.map((k) => k.toLowerCase());
  const excludeLower = config.excludeKeywords.map((k) => k.toLowerCase());

  for (const item of items) {
    const publishedMs = new Date(item.snippet.publishedAt).getTime();
    if (isNaN(publishedMs) || publishedMs < cutoffMs) {
      filtered.ageExcluded++;
      continue;
    }

    const durationSec = parseISO8601DurationToSeconds(item.contentDetails?.duration);
    const title = item.snippet.title ?? '';
    const titleLower = title.toLowerCase();

    // 쇼츠 필터
    if (config.excludeShorts) {
      if (durationSec > 0 && durationSec <= 60) {
        filtered.shortsExcluded++;
        continue;
      }
      if (titleLower.includes('#shorts') || titleLower.includes('#쇼츠')) {
        filtered.shortsExcluded++;
        continue;
      }
    }

    // 최소 길이
    if (durationSec > 0 && durationSec < config.minDurationSec) {
      filtered.minDurationExcluded++;
      continue;
    }

    // 키워드 필터
    const desc = item.snippet.description ?? '';
    const textLower = `${title}\n${desc}`.toLowerCase();

    if (includeLower.length > 0) {
      const hasInclude = includeLower.some((kw) => textLower.includes(kw));
      if (!hasInclude) {
        filtered.keywordExcluded++;
        continue;
      }
    }
    if (excludeLower.length > 0) {
      const hasExclude = excludeLower.some((kw) => textLower.includes(kw));
      if (hasExclude) {
        filtered.keywordExcluded++;
        continue;
      }
    }

    const viewCount = parseInt(item.statistics.viewCount ?? '0', 10);
    const score = calcScore(viewCount, publishedMs);
    scored.push({ item, publishedMs, score, durationSec });
  }

  // 5. 점수 내림차순 + maxResults 컷
  scored.sort((a, b) => b.score - a.score);
  const beforeCut = scored.length;
  const top = scored.slice(0, config.maxResults);
  filtered.maxResultsCut = Math.max(0, beforeCut - top.length);

  const videosCol = firestore.collection('hotYoutubeVideos');
  const BATCH_SIZE = 400;

  // 6-pre. expirePreviousOnRefresh=true — 새 upsert 직전에 기존 auto doc 전부 삭제.
  //        source !== 'auto' 또는 manualLocked === true 는 절대 삭제하지 않음.
  let deletedCount = 0;
  if (config.expirePreviousOnRefresh) {
    const oldAutoSnap = await videosCol.where('source', '==', 'auto').get();
    const protectedFilter = (d: admin.firestore.QueryDocumentSnapshot) => {
      const data = d.data() as { source?: string; manualLocked?: boolean };
      return data.source === 'auto' && data.manualLocked !== true;
    };
    const toWipe = oldAutoSnap.docs.filter(protectedFilter);
    if (toWipe.length > 0) {
      let wipeBatch = firestore.batch();
      let wipeCount = 0;
      for (const d of toWipe) {
        wipeBatch.delete(d.ref);
        wipeCount++;
        deletedCount++;
        if (wipeCount >= BATCH_SIZE) {
          await wipeBatch.commit();
          wipeBatch = firestore.batch();
          wipeCount = 0;
        }
      }
      if (wipeCount > 0) await wipeBatch.commit();
      logger.info(`[curate] expirePreviousOnRefresh — 기존 auto ${deletedCount}개 삭제`);
    }
  }

  // 6. upsert (manual 보호) — priority 1부터 score 순위대로 부여
  let upsertedCount = 0;
  let batch = firestore.batch();
  let batchCount = 0;

  const flushBatch = async () => {
    if (batchCount > 0) {
      await batch.commit();
      batch = firestore.batch();
      batchCount = 0;
    }
  };

  // 상위 항목들의 docId를 모아두고, 큐레이션에서 빠진 auto 항목은 삭제 후보로
  const keepIds = new Set<string>();

  let autoPriority = 0; // 실제 upsert 직전 +1 — 수동 영상 보호로 skip된 항목 제외하고 1, 2, 3, ...
  for (const sv of top) {
    const item = sv.item;
    const viewCount = parseInt(item.statistics.viewCount ?? '0', 10);
    const channelId = item.snippet.channelId;
    const thumbnailUrl =
      item.snippet.thumbnails.high?.url ??
      item.snippet.thumbnails.medium?.url ??
      '';

    const docRef = videosCol.doc(item.id);
    const existing = await docRef.get();
    if (existing.exists) {
      const data = existing.data() as { source?: string; manualLocked?: boolean };
      // manual doc 보호 — source !== 'auto' 이거나 manualLocked === true
      if (data.source !== 'auto' || data.manualLocked === true) continue;
    }
    keepIds.add(item.id);
    autoPriority++;

    const isNew = !existing.exists;
    const payload: Record<string, unknown> = {
      videoId: item.id,
      title: item.snippet.title,
      channelId,
      channelName: item.snippet.channelTitle,
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      thumbnailUrl,
      publishedAt: Timestamp.fromMillis(sv.publishedMs),
      viewCount,
      score: sv.score,
      durationSec: sv.durationSec,
      source: 'auto',
      // 자동 영상은 score 순위대로 1, 2, 3, ... — 수동 영상(0)이 항상 위에 노출.
      priority: autoPriority,
      isActive: true,
      order: 0,
      curatedAt: FieldValue.serverTimestamp(),
      lastCuratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (isNew) payload.createdAt = FieldValue.serverTimestamp();

    batch.set(docRef, payload, { merge: true });
    batchCount++;
    upsertedCount++;
    if (batchCount >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  // 7. 만료 처리
  //   - expirePreviousOnRefresh=true: 이미 위에서 wipe 했으므로 추가 작업 없음.
  //   - expirePreviousOnRefresh=false: autoVideoMaxAgeDays 기반 점진 만료.
  //     manual doc(source !== 'auto' 또는 manualLocked) 은 절대 건드리지 않음.
  if (!config.expirePreviousOnRefresh) {
    const maxAgeDays = config.autoVideoMaxAgeDays ?? DEFAULT_CONFIG.autoVideoMaxAgeDays;
    const ageCutoffMs = Date.now() - maxAgeDays * 86_400_000;
    const autoSnap = await videosCol.where('source', '==', 'auto').get();
    const toDelete = autoSnap.docs.filter((d) => {
      const data = d.data() as {
        source?: string;
        manualLocked?: boolean;
        curatedAt?: admin.firestore.Timestamp;
        lastCuratedAt?: admin.firestore.Timestamp;
        publishedAt?: admin.firestore.Timestamp;
      };
      // manual 보호
      if (data.source !== 'auto' || data.manualLocked === true) return false;
      // 이번 큐레이션에서 다시 keep 되었으면 유지
      if (keepIds.has(d.id)) return false;
      // 큐레이션 시각 기준 점진 만료
      const refTs = data.curatedAt ?? data.lastCuratedAt ?? data.publishedAt ?? null;
      if (!refTs) return true; // 시각 없으면 안전하게 정리
      return refTs.toMillis() < ageCutoffMs;
    });
    if (toDelete.length > 0) {
      let delBatch = firestore.batch();
      let delCount = 0;
      for (const d of toDelete) {
        delBatch.delete(d.ref);
        delCount++;
        deletedCount++;
        if (delCount >= BATCH_SIZE) {
          await delBatch.commit();
          delBatch = firestore.batch();
          delCount = 0;
        }
      }
      if (delCount > 0) await delBatch.commit();
    }
  }

  logger.info(
    `큐레이션 완료 — upsert ${upsertedCount}개, 삭제 ${deletedCount}개, ` +
      `필터(쇼츠 ${filtered.shortsExcluded}, 키워드 ${filtered.keywordExcluded}, ` +
      `나이 ${filtered.ageExcluded}, 길이 ${filtered.minDurationExcluded}, ` +
      `컷 ${filtered.maxResultsCut})`,
  );

  const result: CurationResult = {
    channelsActive: channelIds.length,
    videoIdsCollected: uniqueVideoIds.length,
    apiResponses: items.length,
    upserted: upsertedCount,
    expiredDeleted: deletedCount,
    durationMs: Date.now() - startedAt,
    filtered,
  };
  await writeLastRun(result);
  return result;
}

// ─── Cloud Functions ────────────────────────────────────────────

/**
 * 매시간 정각에 실행 — config.scheduleHourKst와 현재 KST 시각이 일치할 때만 큐레이션.
 * 어드민에서 시각 바꿔도 함수 재배포 불필요.
 */
export const curateHotVideos = onSchedule(
  {
    schedule: 'every 1 hours',
    timeZone: 'Asia/Seoul',
    region: 'asia-northeast3',
    secrets: [YOUTUBE_API_KEY],
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const apiKey = YOUTUBE_API_KEY.value();
    if (!apiKey) {
      logger.error('YOUTUBE_API_KEY secret 미설정 — 큐레이션 중단');
      return;
    }

    const { config } = await loadCurationConfig();
    const nowHour = currentKstHour();
    if (nowHour !== config.scheduleHourKst) {
      logger.info(
        `스케줄 시각 아님 — 현재 KST ${nowHour}시, 설정 ${config.scheduleHourKst}시 (건너뜀)`,
      );
      return;
    }
    await runCuration(apiKey);
  },
);

/**
 * 수동 트리거 (관리자용, secret query param 인증).
 * 어드민 UI는 triggerYoutubeCurationNow Callable 사용 권장.
 */
export const triggerCurateHotVideos = onRequest(
  {
    region: 'asia-northeast3',
    secrets: [YOUTUBE_API_KEY],
    memory: '256MiB',
    timeoutSeconds: 540,
    cors: true,
  },
  async (req, res) => {
    if (req.query.key !== TRIGGER_SECRET) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    const apiKey = YOUTUBE_API_KEY.value();
    if (!apiKey) {
      res.status(500).json({ ok: false, error: 'YOUTUBE_API_KEY missing' });
      return;
    }
    try {
      const result = await runCuration(apiKey, { force: true });
      res.json({ ok: true, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`수동 트리거 실패: ${msg}`);
      res.status(500).json({ ok: false, error: msg });
    }
  },
);
