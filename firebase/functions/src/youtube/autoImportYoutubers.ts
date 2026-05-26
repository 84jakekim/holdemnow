/**
 * autoImportYoutubers — 인기 유튜버 채널 자동 일괄 등록 Callable
 *
 * 권한: platform_admin only
 *
 * 인자:
 *   count?:    1~20  (기본 5)         — 최종 저장할 채널 수
 *   keywords?: string[] (기본 ['홀덤','포커'])  — search 키워드(여러 개면 OR 합산)
 *
 * 동작:
 *   1. 각 키워드별로 YouTube Data API v3 search.list 호출
 *      (regionCode='KR', relevanceLanguage='ko', type='channel', maxResults=10)
 *   2. 중복 channelId 제거 + Firestore hotYoutubers 이미 등록된 channelId 제거
 *   3. 후보 channelId들을 channels.list(part=snippet,statistics,brandingSettings)
 *      로 일괄 조회 (50개 단위 batch). 메타·아바타·구독자수·영상수 한 번에 fetch.
 *   4. 구독자 수 desc 정렬 → 상위 count 개 선택
 *   5. Firestore hotYoutubers에 일괄 저장 (avatarUrl 포함, isActive=true, order=기존 max+1..)
 *   6. 결과: { inserted, skipped, total, requested }
 *
 * 메모리 보호:
 *   - count는 1..20으로 clamp
 *   - 키워드는 최대 5개로 clamp (search.list quota 100 unit/call)
 *   - 한 번에 최대 50개 channel 후보까지만 channels.list 호출
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { logger } from 'firebase-functions/v2';
import { YOUTUBE_API_KEY } from './curateHotVideos';

interface AutoImportInput {
  count?: number;
  keywords?: string[];
}

interface InsertedChannel {
  channelId: string;
  channelName: string;
  channelUrl: string;
  avatarUrl: string;
  description: string;
  subscriberCount: number;
  videoCount: number;
}

interface SkippedReason {
  channelId: string;
  reason: 'already_registered' | 'meta_fetch_failed' | 'invalid_channel_id';
  channelName?: string;
}

interface AutoImportResult {
  inserted: InsertedChannel[];
  skipped: SkippedReason[];
  total: number;
  requested: number;
  keywords: string[];
}

// YouTube API 응답 타입
interface SearchListItem {
  id: { channelId?: string };
  snippet: {
    channelId: string;
    channelTitle?: string;
    title?: string;
    description?: string;
  };
}

interface ChannelListItem {
  id: string;
  snippet: {
    title: string;
    description?: string;
    customUrl?: string;
    thumbnails?: {
      high?: { url: string };
      medium?: { url: string };
      default?: { url: string };
    };
  };
  statistics?: {
    subscriberCount?: string;
    videoCount?: string;
    viewCount?: string;
  };
  brandingSettings?: {
    channel?: {
      title?: string;
      description?: string;
    };
  };
}

const DEFAULT_KEYWORDS = ['홀덤', '포커'];
const MAX_KEYWORDS = 5;
const MAX_COUNT = 20;
const MIN_COUNT = 1;
const SEARCH_PER_KEYWORD = 10; // search.list maxResults — quota 100 unit/call
const CHANNELS_BATCH_SIZE = 50; // channels.list 한 번에 ID 50개

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? Math.floor(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** YouTube Data API v3 search.list — keyword로 채널 검색 */
async function searchChannels(
  keyword: string,
  apiKey: string,
): Promise<string[]> {
  try {
    const res = await axios.get<{ items: SearchListItem[] }>(
      'https://www.googleapis.com/youtube/v3/search',
      {
        params: {
          part: 'snippet',
          q: keyword,
          type: 'channel',
          maxResults: SEARCH_PER_KEYWORD,
          regionCode: 'KR',
          relevanceLanguage: 'ko',
          key: apiKey,
        },
        timeout: 10000,
      },
    );
    const ids: string[] = [];
    for (const item of res.data.items ?? []) {
      const cid = item.snippet?.channelId ?? item.id?.channelId;
      if (cid && /^UC[\w-]+$/.test(cid)) ids.push(cid);
    }
    return ids;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`search.list 실패 keyword="${keyword}": ${msg}`);
    return [];
  }
}

/** YouTube Data API v3 channels.list — 50개씩 batch로 메타 fetch */
async function fetchChannelDetails(
  channelIds: string[],
  apiKey: string,
): Promise<ChannelListItem[]> {
  const results: ChannelListItem[] = [];
  for (let i = 0; i < channelIds.length; i += CHANNELS_BATCH_SIZE) {
    const batch = channelIds.slice(i, i + CHANNELS_BATCH_SIZE);
    try {
      const res = await axios.get<{ items: ChannelListItem[] }>(
        'https://www.googleapis.com/youtube/v3/channels',
        {
          params: {
            part: 'snippet,statistics,brandingSettings',
            id: batch.join(','),
            maxResults: CHANNELS_BATCH_SIZE,
            key: apiKey,
          },
          timeout: 10000,
        },
      );
      results.push(...(res.data.items ?? []));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`channels.list batch 실패 (i=${i}): ${msg}`);
    }
  }
  return results;
}

export const autoImportYoutubers = onCall<AutoImportInput>(
  {
    region: 'asia-northeast3',
    timeoutSeconds: 120,
    memory: '256MiB',
    secrets: [YOUTUBE_API_KEY],
    maxInstances: 3, // spam 방지
  },
  async (req): Promise<AutoImportResult> => {
    // ─── 1. 권한 검사 (platform_admin only) ────────────────────
    if (!req.auth?.uid) {
      throw new HttpsError('unauthenticated', 'login required');
    }
    const userSnap = await admin
      .firestore()
      .collection('users')
      .doc(req.auth.uid)
      .get();
    const userData = userSnap.data() as { role?: string; roles?: string[] } | undefined;
    const isAdmin =
      userData?.role === 'platform_admin' ||
      (Array.isArray(userData?.roles) && userData!.roles!.includes('platform_admin'));
    if (!isAdmin) {
      throw new HttpsError('permission-denied', 'platform_admin only');
    }

    // ─── 2. 인자 정규화 ────────────────────────────────────────
    const count = clampInt(req.data?.count, MIN_COUNT, MAX_COUNT, 5);
    const rawKeywords = Array.isArray(req.data?.keywords)
      ? req.data!.keywords!.map((k) => String(k).trim()).filter((k) => k.length > 0)
      : [];
    const keywords = (rawKeywords.length > 0 ? rawKeywords : DEFAULT_KEYWORDS).slice(0, MAX_KEYWORDS);

    const apiKey = YOUTUBE_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'YOUTUBE_API_KEY secret 미설정');
    }

    // ─── 3. 키워드별 search → 후보 channelId 수집 ─────────────
    const candidateIds: string[] = [];
    for (const kw of keywords) {
      const ids = await searchChannels(kw, apiKey);
      candidateIds.push(...ids);
    }
    const uniqueIds = [...new Set(candidateIds)];

    if (uniqueIds.length === 0) {
      return {
        inserted: [],
        skipped: [],
        total: 0,
        requested: count,
        keywords,
      };
    }

    // ─── 4. 이미 등록된 channelId 제외 ─────────────────────────
    const db = admin.firestore();
    const existingSnap = await db.collection('hotYoutubers').get();
    const existingIds = new Set<string>();
    let existingMaxOrder = -1;
    for (const d of existingSnap.docs) {
      const data = d.data() as { channelId?: string; order?: number };
      if (data.channelId) existingIds.add(data.channelId);
      if (typeof data.order === 'number' && data.order > existingMaxOrder) {
        existingMaxOrder = data.order;
      }
    }

    const skipped: SkippedReason[] = [];
    const toFetch: string[] = [];
    for (const cid of uniqueIds) {
      if (existingIds.has(cid)) {
        skipped.push({ channelId: cid, reason: 'already_registered' });
      } else {
        toFetch.push(cid);
      }
    }

    if (toFetch.length === 0) {
      return {
        inserted: [],
        skipped,
        total: 0,
        requested: count,
        keywords,
      };
    }

    // ─── 5. channels.list — 메타 batch fetch ───────────────────
    const details = await fetchChannelDetails(toFetch.slice(0, 50), apiKey);
    const detailMap = new Map<string, ChannelListItem>();
    for (const d of details) {
      if (d.id) detailMap.set(d.id, d);
    }

    // 메타 fetch 실패한 channelId
    for (const cid of toFetch) {
      if (!detailMap.has(cid)) {
        skipped.push({ channelId: cid, reason: 'meta_fetch_failed' });
      }
    }

    // ─── 6. 구독자 수 desc 정렬 → 상위 count개 ─────────────────
    const sorted = details
      .map((d) => ({
        item: d,
        subCount: parseInt(d.statistics?.subscriberCount ?? '0', 10) || 0,
      }))
      .sort((a, b) => b.subCount - a.subCount)
      .slice(0, count);

    // ─── 7. Firestore 일괄 저장 ─────────────────────────────────
    const inserted: InsertedChannel[] = [];
    const batch = db.batch();
    let orderCursor = existingMaxOrder + 1;
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const { item, subCount } of sorted) {
      const channelId = item.id;
      if (!channelId || !/^UC[\w-]+$/.test(channelId)) {
        skipped.push({ channelId: channelId ?? '', reason: 'invalid_channel_id' });
        continue;
      }
      const channelName =
        item.snippet?.title ??
        item.brandingSettings?.channel?.title ??
        '(이름 없음)';
      const description = (
        item.snippet?.description ??
        item.brandingSettings?.channel?.description ??
        ''
      )
        .split(/\r?\n/)[0]
        .slice(0, 200);
      const avatarUrl =
        item.snippet?.thumbnails?.high?.url ??
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url ??
        '';
      const customUrl = item.snippet?.customUrl?.trim() ?? '';
      // 채널 URL — customUrl이 있으면 /@handle 형태로, 없으면 /channel/UC...
      const channelUrl = customUrl
        ? `https://www.youtube.com/${customUrl.startsWith('@') ? customUrl : '@' + customUrl}`
        : `https://www.youtube.com/channel/${channelId}`;
      const videoCount = parseInt(item.statistics?.videoCount ?? '0', 10) || 0;

      // hotYoutubers는 auto-ID 사용 (기존 패턴 동일)
      const docRef = db.collection('hotYoutubers').doc();
      const payload: Record<string, unknown> = {
        channelId,
        channelName,
        channelUrl,
        avatarUrl,
        description,
        subscriberCount: subCount,
        videoCount,
        isActive: true,
        order: orderCursor++,
        source: 'auto_import',
        createdAt: now,
        updatedAt: now,
      };
      // undefined 값 제거 (안전)
      const cleanPayload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleanPayload[k] = v;
      }
      batch.set(docRef, cleanPayload);

      inserted.push({
        channelId,
        channelName,
        channelUrl,
        avatarUrl,
        description,
        subscriberCount: subCount,
        videoCount,
      });
    }

    if (inserted.length > 0) {
      await batch.commit();
    }

    logger.info(
      `autoImportYoutubers by ${req.auth.uid} — keywords=[${keywords.join(',')}] ` +
        `count=${count} inserted=${inserted.length} skipped=${skipped.length} ` +
        `candidates=${uniqueIds.length}`,
    );

    return {
      inserted,
      skipped,
      total: inserted.length,
      requested: count,
      keywords,
    };
  },
);
