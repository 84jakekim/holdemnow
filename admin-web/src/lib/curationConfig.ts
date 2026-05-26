'use client';

/**
 * platformConfig/youtubeCuration — 인기 유튜브 영상 큐레이션 설정
 *
 * 본사 어드민에서 키워드·갯수·실행 시각·쇼츠 제외 등을 설정.
 * Cloud Function curateHotVideos 가 매시 정각 실행되면서 이 doc을 읽고
 * scheduleHourKst와 현재 KST 시각이 일치할 때만 큐레이션 수행.
 */

import {
  doc,
  onSnapshot,
  setDoc,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stripUndefined } from '@/lib/firestoreUtil';

export interface YoutubeCurationLastRunSlotEntry {
  slot: 1 | 2 | 3;
  upserted: number;
  skippedByInterval?: boolean;
  pickedVideoId?: string | null;
  pickedTitle?: string | null;
  message?: string | null;
}

export interface YoutubeCurationLastRunResult {
  upserted: number;
  expiredDeleted: number;
  durationMs: number;
  channelsActive?: number;
  videoIdsCollected?: number;
  apiResponses?: number;
  filtered?: {
    shortsExcluded?: number;
    keywordExcluded?: number;
    maxResultsCut?: number;
    duplicateExcluded?: number;
  };
  /** Slot 모델(2026-05-26+) — 슬롯별 결과 요약. */
  slots?: YoutubeCurationLastRunSlotEntry[];
  message?: string;
}

export interface YoutubeCurationConfig {
  /** 제목·설명에 하나라도 포함되어야 통과. 빈 배열이면 키워드 필터 비활성. */
  includeKeywords: string[];
  /** 제목·설명에 하나라도 포함되면 제외. */
  excludeKeywords: string[];
  /** 쇼츠(60초 이하 또는 #shorts/#쇼츠 태그) 제외 여부. */
  excludeShorts: boolean;
  /** 영상 최소 길이 (초). 쇼츠 외에도 강제 가능. */
  minDurationSec: number;
  /** 영상 최대 나이 (일). 너무 옛날 영상 제외. */
  maxAgeDays: number;
  /** 슬롯 1(홈 큰 카드) 새 영상 fetch 주기 (시간). 1~720. */
  slot1IntervalHours: number;
  /** 슬롯 2(홈 작은 카드 좌) 새 영상 fetch 주기 (시간). 1~720. */
  slot2IntervalHours: number;
  /** 슬롯 3(홈 작은 카드 우) 새 영상 fetch 주기 (시간). 1~720. */
  slot3IntervalHours: number;
  /** 마지막 실행 시각. */
  lastRunAt?: Timestamp;
  /** 마지막 실행 결과. */
  lastRunResult?: YoutubeCurationLastRunResult;
  /** 각 슬롯의 마지막 fetch 시각. cron이 갱신. */
  slot1LastFetchedAt?: Timestamp;
  slot2LastFetchedAt?: Timestamp;
  slot3LastFetchedAt?: Timestamp;
  /** 각 슬롯의 마지막 picked 영상 (어드민 미리보기용). */
  slot1LastPickedVideoId?: string;
  slot2LastPickedVideoId?: string;
  slot3LastPickedVideoId?: string;
  slot1LastPickedTitle?: string;
  slot2LastPickedTitle?: string;
  slot3LastPickedTitle?: string;
  updatedAt?: Timestamp;
  // ─── Legacy (보존, 미사용) ─────────────────────────────────
  /** @deprecated Slot 모델로 대체. UI에서 숨김. */
  maxResults?: number;
  /** @deprecated Slot 모델로 대체. UI에서 숨김. */
  scheduleHourKst?: number;
  /** @deprecated Slot 모델로 대체. UI에서 숨김. */
  refreshIntervalDays?: number;
  /** @deprecated Slot 모델로 대체. UI에서 숨김. */
  expirePreviousOnRefresh?: boolean;
  /** @deprecated Slot 모델로 대체. UI에서 숨김. */
  autoVideoMaxAgeDays?: number;
}

export const DEFAULT_CURATION_CONFIG: YoutubeCurationConfig = {
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

const DOC_PATH = ['platformConfig', 'youtubeCuration'] as const;

/**
 * platformConfig/youtubeCuration doc 실시간 구독.
 * doc이 없으면 DEFAULT_CURATION_CONFIG 를 콜백에 전달.
 */
export function subscribeCurationConfig(
  onChange: (cfg: YoutubeCurationConfig) => void,
  onError?: (e: Error) => void,
): () => void {
  const ref = doc(db, DOC_PATH[0], DOC_PATH[1]);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onChange({ ...DEFAULT_CURATION_CONFIG });
        return;
      }
      const data = snap.data() as Partial<YoutubeCurationConfig>;
      onChange({
        ...DEFAULT_CURATION_CONFIG,
        ...data,
        includeKeywords: Array.isArray(data.includeKeywords)
          ? data.includeKeywords
          : DEFAULT_CURATION_CONFIG.includeKeywords,
        excludeKeywords: Array.isArray(data.excludeKeywords)
          ? data.excludeKeywords
          : DEFAULT_CURATION_CONFIG.excludeKeywords,
      });
    },
    (err) => onError?.(err),
  );
}

/**
 * 설정 저장 (merge). updatedAt 자동 갱신.
 */
export async function saveCurationConfig(
  patch: Partial<YoutubeCurationConfig>,
): Promise<void> {
  const ref = doc(db, DOC_PATH[0], DOC_PATH[1]);
  const clean = stripUndefined({ ...patch, updatedAt: serverTimestamp() });
  await setDoc(ref, clean, { merge: true });
}

/**
 * 텍스트(줄바꿈/콤마 구분)를 키워드 배열로 변환.
 */
export function parseKeywordsText(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 키워드 배열을 textarea용 텍스트로 변환 (줄바꿈 구분).
 */
export function formatKeywordsText(arr: string[]): string {
  return arr.join('\n');
}
