/**
 * curateHotVideos — 인기 유튜브 영상 자동 큐레이션
 *
 * 트리거: 매일 새벽 4시 KST (onSchedule)
 * 흐름:
 *   1. hotYoutubers 컬렉션에서 isActive=true && channelId!='' 채널 목록 수집
 *   2. 각 채널 RSS feed 파싱 → 최근 15개 videoId 추출
 *   3. YouTube Data API videos.list (50개 batch) 로 메타/통계 보강
 *   4. 90일 이내 영상만 필터 → score = viewCount / daysSincePublished 계산
 *   5. hotYoutubeVideos upsert (manual doc 보호)
 *   6. 만료 auto doc 일괄 삭제
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { logger } from 'firebase-functions/v2';

const YOUTUBE_API_KEY = defineSecret('YOUTUBE_API_KEY');

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

    // fast-xml-parser 사용
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    // feed.entry 는 단건이면 object, 복수면 array
    const feed = parsed?.feed;
    if (!feed) return [];
    const entries = feed.entry;
    if (!entries) return [];
    const entryArr: unknown[] = Array.isArray(entries) ? entries : [entries];

    const ids: string[] = [];
    for (const entry of entryArr.slice(0, 15)) {
      const e = entry as Record<string, unknown>;
      // <yt:videoId> → fast-xml-parser 가 "yt:videoId" 키로 파싱
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

/** viewCount / daysSincePublished 점수 */
function calcScore(viewCount: number, publishedAtMs: number): number {
  const now = Date.now();
  const daysSince = Math.max(1, (now - publishedAtMs) / 86_400_000);
  return viewCount / daysSince;
}

// ─── Cloud Function ────────────────────────────────────────────

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

    const firestore = db();
    const cutoffMs = Date.now() - 90 * 86_400_000;
    const cutoffTs = Timestamp.fromMillis(cutoffMs);

    // ── 1. 활성 유튜버 channelId 수집 ──────────────────────────
    const youtubersSnap = await firestore
      .collection('hotYoutubers')
      .where('isActive', '==', true)
      .get();

    const channelIds: string[] = youtubersSnap.docs
      .map((d) => (d.data() as YoutuberDoc).channelId?.trim() ?? '')
      .filter((id) => id.startsWith('UC'));

    if (channelIds.length === 0) {
      logger.info('활성 채널 없음 — 큐레이션 종료');
      return;
    }
    logger.info(`활성 채널 ${channelIds.length}개 발견`);

    // ── 2. RSS → videoId 수집 ───────────────────────────────────
    const allVideoIds: string[] = [];
    await Promise.all(
      channelIds.map(async (cid) => {
        const ids = await fetchVideoIdsFromRss(cid);
        allVideoIds.push(...ids);
      }),
    );
    // 중복 제거
    const uniqueVideoIds = [...new Set(allVideoIds)];
    logger.info(`RSS 수집 videoId ${uniqueVideoIds.length}개 (중복 제거)`);

    if (uniqueVideoIds.length === 0) {
      logger.info('RSS에서 영상 없음 — 큐레이션 종료');
      return;
    }

    // ── 3. YouTube API videos.list ──────────────────────────────
    const items = await fetchVideoDetails(uniqueVideoIds, apiKey);
    logger.info(`API 응답 ${items.length}개`);

    // ── 4. 90일 이내 필터 + 점수 계산 ──────────────────────────
    let upsertedCount = 0;
    const videosCol = firestore.collection('hotYoutubeVideos');

    // Firestore batch (500 limit) → 청크 처리
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
      if (isNaN(publishedMs) || publishedMs < cutoffMs) continue; // 90일 초과 skip

      const viewCount = parseInt(item.statistics.viewCount ?? '0', 10);
      const score = calcScore(viewCount, publishedMs);
      const channelId = item.snippet.channelId;
      const thumbnailUrl =
        item.snippet.thumbnails.high?.url ??
        item.snippet.thumbnails.medium?.url ??
        '';

      const docRef = videosCol.doc(item.id);

      // manual 보호: 기존 doc의 source 확인
      const existing = await docRef.get();
      if (existing.exists) {
        const data = existing.data() as { source?: string };
        if (data.source !== 'auto') continue; // manual → skip
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
      if (isNew) {
        payload.createdAt = FieldValue.serverTimestamp();
      }

      batch.set(docRef, payload, { merge: true });
      batchCount++;
      upsertedCount++;

      if (batchCount >= BATCH_SIZE) {
        await flushBatch();
      }
    }
    await flushBatch();

    // ── 5. 만료 auto doc 삭제 ───────────────────────────────────
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

    logger.info(
      `큐레이션 완료 — upsert ${upsertedCount}개, 만료 삭제 ${deletedCount}개`,
    );
  },
);
