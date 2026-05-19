/**
 * curateHotVideos — 인기 유튜브 영상 자동 큐레이션
 *
 * 트리거:
 *  - onSchedule: 매일 새벽 4시 KST (정상 일정)
 *  - onRequest:  수동 트리거 (관리자 즉시 실행용, secret query param 인증)
 *
 * 흐름:
 *   1. hotYoutubers 컬렉션에서 isActive=true && channelId!='' 채널 목록 수집
 *   2. 각 채널 RSS feed 파싱 → 최근 15개 videoId 추출
 *   3. YouTube Data API videos.list (50개 batch) 로 메타/통계 보강
 *   4. 90일 이내 영상만 필터 → score = viewCount / daysSincePublished 계산
 *   5. hotYoutubeVideos upsert (manual doc 보호)
 *   6. 만료 auto doc 일괄 삭제
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { logger } from 'firebase-functions/v2';

const YOUTUBE_API_KEY = defineSecret('YOUTUBE_API_KEY');
// onRequest 수동 트리거용 단순 secret — v0.5 에서 어드민 callable로 정식화 예정
const TRIGGER_SECRET = 'holdemnow-trigger-2026';

const db = () => admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

// ─── 타입 ─────────────────────────────────────────────────────

interface YoutuberDoc {
  channelId?: string;
  isActive?: boolean;
}

interface VideoApiItem {
  id: string;
  snippet: {
    title: string;
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
}

export interface CurationResult {
  channelsActive: number;
  videoIdsCollected: number;
  apiResponses: number;
  upserted: number;
  expiredDeleted: number;
  durationMs: number;
  message?: string;
}

// ─── 헬퍼 ─────────────────────────────────────────────────────

/** RSS feed에서 videoId 목록 추출 (최근 15개) */
async function fetchVideoIdsFromRss(channelId: string): Promise<string[]> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  try {
    const res = await axios.get<string>(feedUrl, {
      timeout: 8000,
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 HoldemNow-Curator/1.0' },
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

/** YouTube Data API videos.list — 50개 단위 batch */
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
          part: 'snippet,statistics',
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

function calcScore(viewCount: number, publishedAtMs: number): number {
  const now = Date.now();
  const daysSince = Math.max(1, (now - publishedAtMs) / 86_400_000);
  return viewCount / daysSince;
}

// ─── 메인 로직 (onSchedule + onRequest 공용) ───────────────────────

async function runCuration(apiKey: string): Promise<CurationResult> {
  const startedAt = Date.now();
  const firestore = db();
  const cutoffMs = Date.now() - 90 * 86_400_000;
  const cutoffTs = Timestamp.fromMillis(cutoffMs);

  // 1. 활성 유튜버 channelId 수집
  const youtubersSnap = await firestore
    .collection('hotYoutubers')
    .where('isActive', '==', true)
    .get();

  const channelIds: string[] = youtubersSnap.docs
    .map((d) => (d.data() as YoutuberDoc).channelId?.trim() ?? '')
    .filter((id) => id.startsWith('UC'));

  if (channelIds.length === 0) {
    logger.info('활성 채널 없음 — 큐레이션 종료');
    return {
      channelsActive: 0, videoIdsCollected: 0, apiResponses: 0,
      upserted: 0, expiredDeleted: 0, durationMs: Date.now() - startedAt,
      message: '활성 채널(UC...로 시작하는 channelId 등록)이 없습니다.',
    };
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
    return {
      channelsActive: channelIds.length, videoIdsCollected: 0, apiResponses: 0,
      upserted: 0, expiredDeleted: 0, durationMs: Date.now() - startedAt,
      message: 'RSS feed에서 영상이 발견되지 않았습니다.',
    };
  }

  // 3. YouTube API videos.list
  const items = await fetchVideoDetails(uniqueVideoIds, apiKey);
  logger.info(`API 응답 ${items.length}개`);

  // 4. 90일 이내 필터 + 점수 계산 + upsert (manual 보호)
  let upsertedCount = 0;
  const videosCol = firestore.collection('hotYoutubeVideos');
  const BATCH_SIZE = 400;
  let batch = firestore.batch();
  let batchCount = 0;

  const flushBatch = async () => {
    if (batchCount > 0) {
      await batch.commit();
      batch = firestore.batch();
      batchCount = 0;
    }
  };

  for (const item of items) {
    const publishedMs = new Date(item.snippet.publishedAt).getTime();
    if (isNaN(publishedMs) || publishedMs < cutoffMs) continue;

    const viewCount = parseInt(item.statistics.viewCount ?? '0', 10);
    const score = calcScore(viewCount, publishedMs);
    const channelId = item.snippet.channelId;
    const thumbnailUrl =
      item.snippet.thumbnails.high?.url ??
      item.snippet.thumbnails.medium?.url ??
      '';

    const docRef = videosCol.doc(item.id);
    const existing = await docRef.get();
    if (existing.exists) {
      const data = existing.data() as { source?: string };
      if (data.source !== 'auto') continue; // manual 보호
    }

    const isNew = !existing.exists;
    const payload: Record<string, unknown> = {
      videoId: item.id,
      title: item.snippet.title,
      channelId,
      channelName: item.snippet.channelTitle,
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      thumbnailUrl,
      publishedAt: Timestamp.fromMillis(publishedMs),
      viewCount,
      score,
      source: 'auto',
      isActive: true,
      order: 0,
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

  // 5. 만료 auto doc 삭제
  const expiredSnap = await videosCol
    .where('source', '==', 'auto')
    .where('publishedAt', '<', cutoffTs)
    .get();

  let deletedCount = 0;
  if (!expiredSnap.empty) {
    let delBatch = firestore.batch();
    let delCount = 0;
    for (const d of expiredSnap.docs) {
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

  logger.info(`큐레이션 완료 — upsert ${upsertedCount}개, 만료 삭제 ${deletedCount}개`);

  return {
    channelsActive: channelIds.length,
    videoIdsCollected: uniqueVideoIds.length,
    apiResponses: items.length,
    upserted: upsertedCount,
    expiredDeleted: deletedCount,
    durationMs: Date.now() - startedAt,
  };
}

// ─── Cloud Functions ────────────────────────────────────────────

export const curateHotVideos = onSchedule(
  {
    schedule: '0 4 * * *',
    timeZone: 'Asia/Seoul',
    region: 'asia-northeast3',
    secrets: [YOUTUBE_API_KEY],
    memory: '256MiB',
    timeoutSeconds: 300,
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
 * 수동 트리거 (관리자용)
 * URL: https://asia-northeast3-holdemnow-prod.cloudfunctions.net/triggerCurateHotVideos?key=holdemnow-trigger-2026
 * v0.5에서 어드민 callable 버튼으로 정식화 예정
 */
export const triggerCurateHotVideos = onRequest(
  {
    region: 'asia-northeast3',
    secrets: [YOUTUBE_API_KEY],
    memory: '256MiB',
    timeoutSeconds: 300,
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
      const result = await runCuration(apiKey);
      res.json({ ok: true, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`수동 트리거 실패: ${msg}`);
      res.status(500).json({ ok: false, error: msg });
    }
  },
);
