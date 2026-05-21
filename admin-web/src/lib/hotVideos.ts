'use client';

/**
 * hotYoutubeVideos — 수동 영상 관리 헬퍼
 *
 * 본사가 직접 등록하는 수동 영상(priority 0~) 과 자동 큐레이션 영상(priority 1~)
 * 을 모두 구독·관리. 모바일 정렬 키는 priority asc, score desc.
 *
 * - subscribeAllHotVideos: 어드민에서 전체(active 무관) 영상 priority asc 정렬 구독.
 * - addManualVideo:        수동 영상 신규 doc 생성 (source='manual', manualLocked=true).
 * - updateManualVideoPriority: priority 정수 갱신.
 * - shiftManualVideoPriority:  +1/-1 (위/아래) 단축.
 * - deleteManualVideo:     해당 doc 삭제.
 * - fetchYoutubeOembed:    무인증 oembed로 title/channel/thumbnail 자동 채움.
 */

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stripUndefined } from '@/lib/firestoreUtil';
import {
  PRIORITY_FALLBACK,
  type HotYoutubeVideo,
} from '@/lib/homeContent';
import { extractYoutubeVideoId, youtubeThumbnailUrl } from '@/lib/youtube';

const COL = 'hotYoutubeVideos';

/**
 * 전체 hotYoutubeVideos 구독 (active 여부 무관 — 어드민 관리용).
 * 정렬: priority asc → source(manual 먼저) → score desc.
 * undefined priority는 9999 fallback.
 */
export function subscribeAllHotVideos(
  onChange: (items: HotYoutubeVideo[]) => void,
  onError?: (e: Error) => void,
): () => void {
  const q = query(collection(db, COL));
  return onSnapshot(
    q,
    (snap) => {
      const all = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as HotYoutubeVideo),
      );
      all.sort((a, b) => {
        const aPrio = a.priority ?? PRIORITY_FALLBACK;
        const bPrio = b.priority ?? PRIORITY_FALLBACK;
        if (aPrio !== bPrio) return aPrio - bPrio;
        const aManual = a.source !== 'auto';
        const bManual = b.source !== 'auto';
        if (aManual !== bManual) return aManual ? -1 : 1;
        return (b.score ?? 0) - (a.score ?? 0);
      });
      onChange(all);
    },
    (err) => onError?.(err),
  );
}

export interface OembedMeta {
  title?: string;
  channelName?: string;
  channelUrl?: string;
  thumbnailUrl?: string;
}

/**
 * 유튜브 oembed (무인증) — title / author_name / author_url / thumbnail_url.
 * URL 또는 videoId 둘 다 허용.
 */
export async function fetchYoutubeOembed(
  urlOrId: string,
): Promise<OembedMeta | null> {
  const id = extractYoutubeVideoId(urlOrId);
  if (!id) return null;
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      author_url?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title,
      channelName: data.author_name,
      channelUrl: data.author_url,
      thumbnailUrl: data.thumbnail_url,
    };
  } catch {
    return null;
  }
}

export interface AddManualVideoInput {
  /** YouTube URL 또는 videoId. 둘 다 허용. */
  urlOrId: string;
  /** 사용자 지정 priority (기본 0 = 최상단). */
  priority?: number;
  /** 명시적으로 제목 override (없으면 oembed 결과 사용). */
  title?: string;
  /** 명시적으로 채널명 override. */
  channelName?: string;
}

/**
 * 수동 영상 등록 — hotYoutubeVideos/{videoId} doc 생성.
 * - source: 'manual', manualLocked: true.
 * - priority: 기본 0 (최상단).
 * - title/channelName이 비어 있으면 oembed로 자동 채움.
 * docId = videoId — 같은 영상 중복 등록 방지 (merge=true).
 */
export async function addManualVideo(
  input: AddManualVideoInput,
  addedBy: string,
): Promise<string> {
  const videoId = extractYoutubeVideoId(input.urlOrId);
  if (!videoId) {
    throw new Error('유효한 YouTube URL 또는 videoId가 아닙니다.');
  }

  let title = input.title?.trim() ?? '';
  let channelName = input.channelName?.trim() ?? '';
  let channelUrl = '';
  let thumbnailUrl = youtubeThumbnailUrl(videoId, 'hqdefault');

  if (!title || !channelName) {
    const meta = await fetchYoutubeOembed(videoId);
    if (meta) {
      if (!title && meta.title) title = meta.title;
      if (!channelName && meta.channelName) channelName = meta.channelName;
      if (meta.channelUrl) channelUrl = meta.channelUrl;
      if (meta.thumbnailUrl) thumbnailUrl = meta.thumbnailUrl;
    }
  }

  if (!title) title = videoId; // 최소 안전장치

  const priority = Number.isFinite(input.priority)
    ? Math.max(0, Math.floor(input.priority as number))
    : 0;

  const ref = doc(db, COL, videoId);
  await setDoc(
    ref,
    stripUndefined({
      videoId,
      title,
      channelName,
      channelUrl,
      thumbnailUrl,
      source: 'manual',
      manualLocked: true,
      priority,
      isActive: true,
      order: 0,
      score: 0,
      addedBy,
      addedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true },
  );
  return videoId;
}

/** 수동 영상 priority 변경 (0 이상 정수). */
export async function updateManualVideoPriority(
  videoId: string,
  priority: number,
): Promise<void> {
  const p = Number.isFinite(priority)
    ? Math.max(0, Math.floor(priority))
    : 0;
  await updateDoc(doc(db, COL, videoId), {
    priority: p,
    updatedAt: serverTimestamp(),
  });
}

/** 수동 영상 priority +1 (아래로) / -1 (위로). 0 미만 차단. */
export async function shiftManualVideoPriority(
  videoId: string,
  currentPriority: number | undefined,
  delta: number,
): Promise<void> {
  const cur = Number.isFinite(currentPriority)
    ? (currentPriority as number)
    : 0;
  const next = Math.max(0, cur + delta);
  await updateManualVideoPriority(videoId, next);
}

/** 수동 영상 doc 삭제 — 같은 docId의 자동 영상도 함께 사라지므로 호출자 주의. */
export async function deleteManualVideo(videoId: string): Promise<void> {
  await deleteDoc(doc(db, COL, videoId));
}
