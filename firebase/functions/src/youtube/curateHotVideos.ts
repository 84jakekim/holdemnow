/**
 * curateHotVideos — 인기 유튜브 영상 자동 큐레이션 (Slot 모델)
 *
 * 트리거:
 *  - onSchedule: 매시 정각 KST — 각 슬롯(1/2/3)별로 intervalHours 도달 시에만 큐레이션 실행
 *  - onRequest:  수동 트리거 (관리자 즉시 실행용, secret query param 인증) — slot=N param 지원
 *  - onCall:     triggerYoutubeCurationNow.ts (platform_admin 어드민 버튼)
 *
 * 슬롯 모델 (2026-05-26 변경):
 *   - 홈 화면은 슬롯 1(큰 카드) / 슬롯 2(작은 카드 1) / 슬롯 3(작은 카드 2) 항상 다른 영상.
 *   - 각 슬롯은 platformConfig/youtubeCuration의 slotN_IntervalHours마다 새 영상 1개로 교체.
 *   - 같은 영상이 여러 슬롯에 들어가지 않도록 다른 슬롯의 videoId는 후보에서 제외.
 *
 * 흐름 (각 슬롯별):
 *   0. platformConfig/youtubeCuration doc 읽기 (없으면 default)
 *   1. 슬롯의 lastFetchedAt + intervalHours 검사 (force=true면 우회)
 *   2. hotYoutubers 활성 채널에서 RSS feed → videoId 수집
 *   3. YouTube Data API videos.list 로 메타·통계·duration 보강
 *   4. config 기반 필터 (쇼츠/길이/키워드/나이)
 *   5. 이미 다른 슬롯에 있는 videoId 제외 (중복 방지)
 *   6. score 1위 영상 1개를 slot:N 으로 upsert + 기존 slot:N auto doc 삭제
 *   7. platformConfig.slotN_LastFetchedAt 갱신
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

export type SlotIndex = 1 | 2 | 3;
const ALL_SLOTS: SlotIndex[] = [1, 2, 3];

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
  duplicateExcluded: number; // 다른 슬롯에 이미 있는 영상 제외
}

export interface SlotCurationResult {
  slot: SlotIndex;
  channelsActive: number;
  videoIdsCollected: number;
  apiResponses: number;
  candidateCount: number; // 필터 통과한 후보 수
  upserted: number; // 0 또는 1
  expiredDeleted: number; // 기존 slot doc 삭제
  durationMs: number;
  filtered: CurationFilterStats;
  skippedByInterval?: boolean;
  pickedVideoId?: string;
  pickedTitle?: string;
  message?: string;
}

export interface CurationResult {
  slots: SlotCurationResult[];
  upserted: number;
  expiredDeleted: number;
  durationMs: number;
  channelsActive?: number;
  videoIdsCollected?: number;
  apiResponses?: number;
  filtered?: {
    shortsExcluded?: number;
    keywordExcluded?: number;
    duplicateExcluded?: number;
  };
  message?: string;
}

interface YoutubeCurationConfig {
  includeKeywords: string[];
  excludeKeywords: string[];
  excludeShorts: boolean;
  minDurationSec: number;
  maxAgeDays: number;
  // ─── Slot 모델 (2026-05-26 추가) ───────────────────────────
  slot1IntervalHours: number;
  slot2IntervalHours: number;
  slot3IntervalHours: number;
  // ─── Legacy (보존, 미사용) ─────────────────────────────────
  maxResults?: number;
  scheduleHourKst?: number;
  refreshIntervalDays?: number;
  expirePreviousOnRefresh?: boolean;
  autoVideoMaxAgeDays?: number;
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
  excludeShorts: true,
  minDurationSec: 61,
  maxAgeDays: 90,
  slot1IntervalHours: 6,
  slot2IntervalHours: 12,
  slot3IntervalHours: 24,
};

// ─── 헬퍼 ─────────────────────────────────────────────────────

interface LoadedConfig {
  config: YoutubeCurationConfig;
  slotLastFetchedAt: Record<SlotIndex, admin.firestore.Timestamp | null>;
}

async function loadCurationConfig(): Promise<LoadedConfig> {
  const empty: LoadedConfig = {
    config: { ...DEFAULT_CONFIG },
    slotLastFetchedAt: { 1: null, 2: null, 3: null },
  };
  try {
    const snap = await db().collection('platformConfig').doc('youtubeCuration').get();
    if (!snap.exists) return empty;
    const data = snap.data() ?? {};
    const slotLastFetchedAt: Record<SlotIndex, admin.firestore.Timestamp | null> = {
      1: data.slot1LastFetchedAt instanceof Timestamp ? data.slot1LastFetchedAt : null,
      2: data.slot2LastFetchedAt instanceof Timestamp ? data.slot2LastFetchedAt : null,
      3: data.slot3LastFetchedAt instanceof Timestamp ? data.slot3LastFetchedAt : null,
    };
    return {
      config: {
        includeKeywords: Array.isArray(data.includeKeywords)
          ? (data.includeKeywords as string[])
          : DEFAULT_CONFIG.includeKeywords,
        excludeKeywords: Array.isArray(data.excludeKeywords)
          ? (data.excludeKeywords as string[])
          : DEFAULT_CONFIG.excludeKeywords,
        excludeShorts:
          typeof data.excludeShorts === 'boolean'
            ? data.excludeShorts
            : DEFAULT_CONFIG.excludeShorts,
        minDurationSec: clampInt(data.minDurationSec, 0, 7200, DEFAULT_CONFIG.minDurationSec),
        maxAgeDays: clampInt(data.maxAgeDays, 1, 365, DEFAULT_CONFIG.maxAgeDays),
        slot1IntervalHours: clampInt(
          data.slot1IntervalHours,
          1,
          720,
          DEFAULT_CONFIG.slot1IntervalHours,
        ),
        slot2IntervalHours: clampInt(
          data.slot2IntervalHours,
          1,
          720,
          DEFAULT_CONFIG.slot2IntervalHours,
        ),
        slot3IntervalHours: clampInt(
          data.slot3IntervalHours,
          1,
          720,
          DEFAULT_CONFIG.slot3IntervalHours,
        ),
        maxResults: typeof data.maxResults === 'number' ? data.maxResults : undefined,
        scheduleHourKst:
          typeof data.scheduleHourKst === 'number' ? data.scheduleHourKst : undefined,
      },
      slotLastFetchedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`curation config 읽기 실패 — default 사용: ${msg}`);
    return empty;
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? Math.floor(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getSlotIntervalHours(cfg: YoutubeCurationConfig, slot: SlotIndex): number {
  if (slot === 1) return cfg.slot1IntervalHours;
  if (slot === 2) return cfg.slot2IntervalHours;
  return cfg.slot3IntervalHours;
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

/** channelUrl에서 channelId(UC...) 자동 추출 + hotYoutubers doc 업데이트. */
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

/**
 * 슬롯 1개에 대한 큐레이션 실행.
 * - opts.force=true 면 interval 검사 우회.
 * - excludeVideoIds: 다른 슬롯에 이미 채워진 videoId (중복 방지)
 * - 결과: SlotCurationResult.
 */
async function runSlotCuration(
  slot: SlotIndex,
  apiKey: string,
  cfg: YoutubeCurationConfig,
  lastFetchedAt: admin.firestore.Timestamp | null,
  excludeVideoIds: Set<string>,
  opts: { force?: boolean } = {},
): Promise<SlotCurationResult> {
  const startedAt = Date.now();
  const firestore = db();
  const filtered: CurationFilterStats = {
    shortsExcluded: 0,
    keywordExcluded: 0,
    ageExcluded: 0,
    minDurationExcluded: 0,
    duplicateExcluded: 0,
  };

  const intervalHours = getSlotIntervalHours(cfg, slot);

  // 1. interval 검사
  if (!opts.force && lastFetchedAt) {
    const elapsedMs = Date.now() - lastFetchedAt.toMillis();
    const intervalMs = intervalHours * 3_600_000;
    if (elapsedMs < intervalMs) {
      const elapsedH = Math.floor(elapsedMs / 3_600_000);
      logger.info(
        `[curate slot${slot}] interval not yet elapsed (${elapsedH}h / ${intervalHours}h) — skip`,
      );
      return {
        slot,
        channelsActive: 0,
        videoIdsCollected: 0,
        apiResponses: 0,
        candidateCount: 0,
        upserted: 0,
        expiredDeleted: 0,
        durationMs: Date.now() - startedAt,
        filtered,
        skippedByInterval: true,
        message: `slot${slot}: 교체 주기 미도달 (${elapsedH}h / ${intervalHours}h)`,
      };
    }
  }

  const cutoffMs = Date.now() - cfg.maxAgeDays * 86_400_000;

  // 2. 활성 채널 channelId 수집
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
    return {
      slot,
      channelsActive: 0,
      videoIdsCollected: 0,
      apiResponses: 0,
      candidateCount: 0,
      upserted: 0,
      expiredDeleted: 0,
      durationMs: Date.now() - startedAt,
      filtered,
      message: 'slot ' + slot + ': 활성 채널이 없습니다.',
    };
  }

  // 3. RSS → videoId 수집
  const allVideoIds: string[] = [];
  await Promise.all(
    channelIds.map(async (cid) => {
      const ids = await fetchVideoIdsFromRss(cid);
      allVideoIds.push(...ids);
    }),
  );
  const uniqueVideoIds = [...new Set(allVideoIds)];
  logger.info(`[curate slot${slot}] RSS 수집 videoId ${uniqueVideoIds.length}개`);

  if (uniqueVideoIds.length === 0) {
    return {
      slot,
      channelsActive: channelIds.length,
      videoIdsCollected: 0,
      apiResponses: 0,
      candidateCount: 0,
      upserted: 0,
      expiredDeleted: 0,
      durationMs: Date.now() - startedAt,
      filtered,
      message: 'slot ' + slot + ': RSS feed에서 영상이 발견되지 않았습니다.',
    };
  }

  // 4. YouTube API videos.list
  const items = await fetchVideoDetails(uniqueVideoIds, apiKey);

  // 5. 필터링 + 점수 계산
  interface ScoredVideo {
    item: VideoApiItem;
    publishedMs: number;
    score: number;
    durationSec: number;
  }
  const scored: ScoredVideo[] = [];

  const includeLower = cfg.includeKeywords.map((k) => k.toLowerCase());
  const excludeLower = cfg.excludeKeywords.map((k) => k.toLowerCase());

  for (const item of items) {
    // 다른 슬롯 중복 제외
    if (excludeVideoIds.has(item.id)) {
      filtered.duplicateExcluded++;
      continue;
    }

    const publishedMs = new Date(item.snippet.publishedAt).getTime();
    if (isNaN(publishedMs) || publishedMs < cutoffMs) {
      filtered.ageExcluded++;
      continue;
    }

    const durationSec = parseISO8601DurationToSeconds(item.contentDetails?.duration);
    const title = item.snippet.title ?? '';
    const titleLower = title.toLowerCase();

    // 쇼츠 필터
    if (cfg.excludeShorts) {
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
    if (durationSec > 0 && durationSec < cfg.minDurationSec) {
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

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];

  // 후보 없음 → upsert 안 함, lastFetchedAt도 기록 안 함 (다음 시간에 재시도)
  if (!top) {
    return {
      slot,
      channelsActive: channelIds.length,
      videoIdsCollected: uniqueVideoIds.length,
      apiResponses: items.length,
      candidateCount: 0,
      upserted: 0,
      expiredDeleted: 0,
      durationMs: Date.now() - startedAt,
      filtered,
      message: 'slot ' + slot + ': 필터 통과 영상 없음',
    };
  }

  // 6. 기존 slot:N auto doc 삭제 (다른 docId만)
  const videosCol = firestore.collection('hotYoutubeVideos');
  const existingSlotSnap = await videosCol
    .where('source', '==', 'auto')
    .where('slot', '==', slot)
    .get();

  let deletedCount = 0;
  if (!existingSlotSnap.empty) {
    let delBatch = firestore.batch();
    let delCount = 0;
    for (const d of existingSlotSnap.docs) {
      const data = d.data() as { manualLocked?: boolean };
      if (data.manualLocked === true) continue;
      if (d.id === top.item.id) continue; // 같은 영상이면 유지(upsert로 덮어씀)
      delBatch.delete(d.ref);
      delCount++;
      deletedCount++;
    }
    if (delCount > 0) await delBatch.commit();
  }

  // 7. 새 영상 upsert (slot 필드 포함)
  const item = top.item;
  const viewCount = parseInt(item.statistics.viewCount ?? '0', 10);
  const channelId = item.snippet.channelId;
  const thumbnailUrl =
    item.snippet.thumbnails.high?.url ??
    item.snippet.thumbnails.medium?.url ??
    '';

  const docRef = videosCol.doc(item.id);
  const existing = await docRef.get();

  // manual 보호 — 같은 videoId가 수동으로 이미 등록되어 있으면 덮어쓰지 않음
  if (existing.exists) {
    const data = existing.data() as { source?: string; manualLocked?: boolean };
    if (data.source !== 'auto' || data.manualLocked === true) {
      logger.info(
        `[curate slot${slot}] picked videoId=${item.id} 은 수동 영상이라 덮어쓰지 않음`,
      );
      // 이번 슬롯은 빈 채로 두고 lastFetchedAt만 갱신 (다음 주기에 다른 영상 시도)
      await db().collection('platformConfig').doc('youtubeCuration').set(
        slotLastFetchedAtPayload(slot),
        { merge: true },
      );
      return {
        slot,
        channelsActive: channelIds.length,
        videoIdsCollected: uniqueVideoIds.length,
        apiResponses: items.length,
        candidateCount: scored.length,
        upserted: 0,
        expiredDeleted: deletedCount,
        durationMs: Date.now() - startedAt,
        filtered,
        message: 'slot ' + slot + ': top 후보가 수동 영상과 충돌 — 다음 주기 재시도',
      };
    }
  }

  const isNew = !existing.exists;
  const payload: Record<string, unknown> = {
    videoId: item.id,
    title: item.snippet.title,
    channelId,
    channelName: item.snippet.channelTitle,
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    thumbnailUrl,
    publishedAt: Timestamp.fromMillis(top.publishedMs),
    viewCount,
    score: top.score,
    durationSec: top.durationSec,
    source: 'auto',
    slot,
    priority: slot, // 슬롯 번호를 priority로 (1,2,3 순)
    isActive: true,
    order: 0,
    curatedAt: FieldValue.serverTimestamp(),
    lastCuratedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (isNew) payload.createdAt = FieldValue.serverTimestamp();

  await docRef.set(payload, { merge: true });

  // slot lastFetchedAt + 결과 기록
  await db().collection('platformConfig').doc('youtubeCuration').set(
    {
      ...slotLastFetchedAtPayload(slot),
      [`slot${slot}LastPickedVideoId`]: item.id,
      [`slot${slot}LastPickedTitle`]: item.snippet.title,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info(
    `[curate slot${slot}] picked videoId=${item.id} title="${item.snippet.title}" ` +
      `score=${top.score.toFixed(0)} 후보 ${scored.length}개 중`,
  );

  return {
    slot,
    channelsActive: channelIds.length,
    videoIdsCollected: uniqueVideoIds.length,
    apiResponses: items.length,
    candidateCount: scored.length,
    upserted: 1,
    expiredDeleted: deletedCount,
    durationMs: Date.now() - startedAt,
    filtered,
    pickedVideoId: item.id,
    pickedTitle: item.snippet.title,
  };
}

function slotLastFetchedAtPayload(slot: SlotIndex): Record<string, unknown> {
  return { [`slot${slot}LastFetchedAt`]: FieldValue.serverTimestamp() };
}

/** 슬롯에 이미 채워진(또는 다른 슬롯의) auto videoId 집합. 슬롯간 중복 방지용. */
async function loadOccupiedVideoIdsByOtherSlots(
  excludeSlot: SlotIndex,
): Promise<Set<string>> {
  const snap = await db()
    .collection('hotYoutubeVideos')
    .where('source', '==', 'auto')
    .get();
  const result = new Set<string>();
  for (const d of snap.docs) {
    const data = d.data() as { slot?: number; videoId?: string };
    if (typeof data.slot === 'number' && data.slot !== excludeSlot && data.videoId) {
      result.add(data.videoId);
    }
  }
  return result;
}

/**
 * 전체 슬롯 큐레이션 실행 (force=true면 모든 슬롯, false면 도래한 슬롯만).
 * 선택 슬롯만 강제 실행하려면 slotsToRun 지정.
 */
export async function runCuration(
  apiKey: string,
  opts: { force?: boolean; slotsToRun?: SlotIndex[] } = {},
): Promise<CurationResult> {
  const startedAt = Date.now();
  const { config, slotLastFetchedAt } = await loadCurationConfig();

  const slotsToRun = opts.slotsToRun ?? ALL_SLOTS;
  const results: SlotCurationResult[] = [];

  for (const slot of slotsToRun) {
    const occupied = await loadOccupiedVideoIdsByOtherSlots(slot);
    const slotResult = await runSlotCuration(
      slot,
      apiKey,
      config,
      slotLastFetchedAt[slot],
      occupied,
      { force: opts.force },
    );
    results.push(slotResult);
  }

  const aggregate: CurationResult = {
    slots: results,
    upserted: results.reduce((s, r) => s + r.upserted, 0),
    expiredDeleted: results.reduce((s, r) => s + r.expiredDeleted, 0),
    durationMs: Date.now() - startedAt,
    channelsActive: Math.max(0, ...results.map((r) => r.channelsActive)),
    videoIdsCollected: results.reduce((s, r) => s + r.videoIdsCollected, 0),
    apiResponses: results.reduce((s, r) => s + r.apiResponses, 0),
    filtered: {
      shortsExcluded: results.reduce((s, r) => s + r.filtered.shortsExcluded, 0),
      keywordExcluded: results.reduce((s, r) => s + r.filtered.keywordExcluded, 0),
      duplicateExcluded: results.reduce((s, r) => s + r.filtered.duplicateExcluded, 0),
    },
  };

  // 마지막 실행 결과 doc 기록 (어드민 UI에서 표시)
  try {
    await db().collection('platformConfig').doc('youtubeCuration').set(
      {
        lastRunAt: FieldValue.serverTimestamp(),
        lastRunResult: {
          upserted: aggregate.upserted,
          expiredDeleted: aggregate.expiredDeleted,
          durationMs: aggregate.durationMs,
          slots: results.map((r) => ({
            slot: r.slot,
            upserted: r.upserted,
            skippedByInterval: r.skippedByInterval ?? false,
            pickedVideoId: r.pickedVideoId ?? null,
            pickedTitle: r.pickedTitle ?? null,
            message: r.message ?? null,
          })),
        },
      },
      { merge: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`lastRunResult 기록 실패: ${msg}`);
  }

  return aggregate;
}

// ─── Cloud Functions ────────────────────────────────────────────

/**
 * 매시 정각 — 각 슬롯의 lastFetchedAt + intervalHours 검사 후 도래한 슬롯만 큐레이션.
 * intervalHours는 어드민 페이지(/platform/home-content videos 탭)에서 설정.
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
    await runCuration(apiKey);
  },
);

/**
 * 수동 트리거 (관리자용, secret query param 인증).
 * - ?key=SECRET&slot=1   → slot 1만 force 실행
 * - ?key=SECRET          → 전체 슬롯 force 실행
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
    const slotParam = req.query.slot;
    let slotsToRun: SlotIndex[] | undefined;
    if (typeof slotParam === 'string' && /^[123]$/.test(slotParam)) {
      slotsToRun = [parseInt(slotParam, 10) as SlotIndex];
    }
    try {
      const result = await runCuration(apiKey, { force: true, slotsToRun });
      res.json({ ok: true, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`수동 트리거 실패: ${msg}`);
      res.status(500).json({ ok: false, error: msg });
    }
  },
);
