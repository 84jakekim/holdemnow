/**
 * 홈 콘텐츠 Firestore 구독 헬퍼
 * 컬렉션: homeAds / hotYoutubeVideos / hotYoutubers
 * 클라이언트 필터: isActive==true + orderBy order + startAt/endAt 클라이언트 비교
 */

import {
  collection,
  onSnapshot,
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
  /** 광고 상세 페이지에 전체 노출되는 본문(여러 줄, whitespace-pre-wrap). */
  description?: string;
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
  /** 'auto': Cloud Function 자동 큐레이션 | 'manual': 어드민 수동 등록 */
  source?: 'auto' | 'manual';
  /** true: 자동 큐레이션이 절대 덮어쓰지 않음 (수동 영상 보호) */
  manualLocked?: boolean;
  /**
   * 노출 우선순위 — 정수, 작을수록 위.
   * - manual: 0, 1, 2, ... (본사 직접 지정, 0이 최상단)
   * - auto:   1, 2, 3, ... (큐레이션 score 순위)
   * 정렬 키: priority asc, score desc. undefined는 9999로 간주.
   */
  priority?: number;
  /**
   * 슬롯 (1·2·3) — 2026-05-26 Slot 모델 추가.
   * 자동 큐레이션이 슬롯별 1개씩 채움. 슬롯 1=홈 큰 카드, 2=작은 카드 좌, 3=작은 카드 우.
   * 수동 영상은 일반적으로 slot 미설정(legacy 노출). 수동에서도 슬롯 지정 가능.
   */
  slot?: 1 | 2 | 3;
  channelId?: string;
  publishedAt?: Timestamp;
  viewCount?: number;
  /** score = viewCount / daysSincePublished */
  score?: number;
  lastCuratedAt?: Timestamp;
  addedBy?: string;
  addedAt?: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** priority fallback — undefined인 경우 정렬 시 가장 뒤로. */
export const PRIORITY_FALLBACK = 9999;

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
  // composite index 회피 — where만 적용, 정렬은 클라이언트.
  const q = query(
    collection(db, 'homeAds'),
    where('isActive', '==', true),
  );

  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HomeAd));
      const filtered = all
        .filter((ad) => {
          if (position !== 'all' && ad.position !== position) return false;
          const start = ad.startAt?.toMillis() ?? 0;
          const end = ad.endAt?.toMillis() ?? Infinity;
          return now >= start && now <= end;
        })
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
  // composite index 회피 — where만 적용, 정렬은 클라이언트.
  // 데이터 수십 건 이하 가정이라 비용 미미.
  const q = query(
    collection(db, 'hotYoutubeVideos'),
    where('isActive', '==', true),
  );

  return onSnapshot(
    q,
    (snap) => {
      const videos = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as HotYoutubeVideo))
        .sort((a, b) => {
          // priority asc, score desc — manual은 source-tier 우선 (수동 0 ≥ 수동 1 ≥ 자동 1 ...)
          // priority가 같아도 수동이 자동보다 위로 가도록 source tier로 한 번 더 분기.
          const aPrio = a.priority ?? PRIORITY_FALLBACK;
          const bPrio = b.priority ?? PRIORITY_FALLBACK;
          if (aPrio !== bPrio) return aPrio - bPrio;
          // priority 동률 — manual을 먼저
          const aManual = a.source !== 'auto';
          const bManual = b.source !== 'auto';
          if (aManual !== bManual) return aManual ? -1 : 1;
          // 같은 tier · 같은 priority → score desc
          return (b.score ?? 0) - (a.score ?? 0);
        })
        .slice(0, 10);
      onData(videos);
    },
    (err) => onError?.(err),
  );
}

/**
 * hotYoutubeVideos를 슬롯(1/2/3)별로 정확히 1개씩 묶어 반환.
 *
 * - 슬롯 N에 isActive=true이면서 source=auto이고 slot=N인 영상 1개 우선.
 * - 슬롯 N에 auto가 없으면 (legacy 또는 cron 첫 실행 전):
 *   slot 미설정인 영상 중에서 priority asc로 fallback (전체 중복 없이 채움).
 * - 결과는 [slot1, slot2, slot3] (없으면 null).
 */
export function subscribeHotVideosBySlot(
  onData: (slots: [HotYoutubeVideo | null, HotYoutubeVideo | null, HotYoutubeVideo | null]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, 'hotYoutubeVideos'),
    where('isActive', '==', true),
  );

  return onSnapshot(
    q,
    (snap) => {
      const all = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as HotYoutubeVideo),
      );

      // 슬롯별로 우선 auto 영상 (해당 slot 지정) 선택
      const bySlot: Record<1 | 2 | 3, HotYoutubeVideo | null> = { 1: null, 2: null, 3: null };
      for (const v of all) {
        if (v.slot === 1 || v.slot === 2 || v.slot === 3) {
          const cur = bySlot[v.slot];
          if (!cur || (v.score ?? 0) > (cur.score ?? 0)) {
            bySlot[v.slot] = v;
          }
        }
      }

      // fallback: slot 미설정 영상으로 빈 슬롯 채움 (priority asc, 중복 없이)
      const used = new Set<string>();
      ([1, 2, 3] as const).forEach((s) => {
        if (bySlot[s]) used.add(bySlot[s]!.videoId);
      });
      const fallback = all
        .filter((v) => v.slot !== 1 && v.slot !== 2 && v.slot !== 3 && !used.has(v.videoId))
        .sort((a, b) => {
          const aPrio = a.priority ?? PRIORITY_FALLBACK;
          const bPrio = b.priority ?? PRIORITY_FALLBACK;
          if (aPrio !== bPrio) return aPrio - bPrio;
          return (b.score ?? 0) - (a.score ?? 0);
        });

      let fi = 0;
      ([1, 2, 3] as const).forEach((s) => {
        if (!bySlot[s]) {
          while (fi < fallback.length && used.has(fallback[fi].videoId)) fi++;
          if (fi < fallback.length) {
            bySlot[s] = fallback[fi];
            used.add(fallback[fi].videoId);
            fi++;
          }
        }
      });

      onData([bySlot[1], bySlot[2], bySlot[3]]);
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
  // composite index 회피 — where만 적용, 정렬은 클라이언트.
  const q = query(
    collection(db, 'hotYoutubers'),
    where('isActive', '==', true),
  );

  return onSnapshot(
    q,
    (snap) => {
      const youtubers = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as HotYoutuber))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      onData(youtubers);
    },
    (err) => onError?.(err),
  );
}

/** 날짜 범위 유효성 체크 export (어드민 페이지에서 재사용) */
export { isDateRangeActive };
