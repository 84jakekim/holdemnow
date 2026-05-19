/**
 * 홈 콘텐츠 Firestore 구독 헬퍼
 * 컬렉션: homeAds / hotYoutubeVideos / hotYoutubers
 * 클라이언트 필터: isActive==true + orderBy order + startAt/endAt 클라이언트 비교
 */

import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ─── 타입 정의 ────────────────────────────────────────────────

export interface HomeAd {
  id: string;
  position: 'top' | 'bottom';
  imageUrl: string;
  title?: string;
  subtitle?: string;
  linkType: 'external' | 'store' | 'event' | 'internal';
  linkUrl: string;
  startAt: Timestamp;
  endAt: Timestamp;
  order: number;
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface HotYoutubeVideo {
  id: string;
  videoId: string;
  title: string;
  channelName?: string;
  channelUrl?: string;
  channelAvatarUrl?: string;
  thumbnailUrl?: string;
  order: number;
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface HotYoutuber {
  id: string;
  channelId?: string;
  channelName: string;
  channelUrl: string;
  avatarUrl: string;
  description?: string;
  order: number;
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─── 내부 헬퍼 ────────────────────────────────────────────────

/** startAt/endAt 범위 내에 있는지 현재 시각 기준 클라이언트 필터 */
function isDateRangeActive(startAt?: Timestamp, endAt?: Timestamp): boolean {
  const now = Date.now();
  const start = startAt?.toMillis() ?? 0;
  const end = endAt?.toMillis() ?? Infinity;
  return now >= start && now <= end;
}

// ─── 구독 함수 ────────────────────────────────────────────────

/**
 * homeAds 구독 — position 필터 가능
 * @param position 'top' | 'bottom' | 'all'
 */
export function subscribeHomeAds(
  position: 'top' | 'bottom' | 'all',
  onData: (ads: HomeAd[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, 'homeAds'),
    where('isActive', '==', true),
    orderBy('order'),
  );

  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HomeAd));
      const filtered = all.filter((ad) => {
        // position 필터
        if (position !== 'all' && ad.position !== position) return false;
        // 날짜 범위 필터 (클라이언트)
        const start = ad.startAt?.toMillis() ?? 0;
        const end = ad.endAt?.toMillis() ?? Infinity;
        return now >= start && now <= end;
      });
      onData(filtered);
    },
    (err) => onError?.(err),
  );
}

/**
 * hotYoutubeVideos 구독
 */
export function subscribeHotVideos(
  onData: (videos: HotYoutubeVideo[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, 'hotYoutubeVideos'),
    where('isActive', '==', true),
    orderBy('order'),
  );

  return onSnapshot(
    q,
    (snap) => {
      const videos = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HotYoutubeVideo));
      onData(videos);
    },
    (err) => onError?.(err),
  );
}

/**
 * hotYoutubers 구독
 */
export function subscribeHotYoutubers(
  onData: (youtubers: HotYoutuber[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, 'hotYoutubers'),
    where('isActive', '==', true),
    orderBy('order'),
  );

  return onSnapshot(
    q,
    (snap) => {
      const youtubers = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HotYoutuber));
      onData(youtubers);
    },
    (err) => onError?.(err),
  );
}

/** 날짜 범위 유효성 체크 export (어드민 페이지에서 재사용) */
export { isDateRangeActive };
