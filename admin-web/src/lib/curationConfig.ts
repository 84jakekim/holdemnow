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
  };
  message?: string;
}

export interface YoutubeCurationConfig {
  /** 제목·설명에 하나라도 포함되어야 통과. 빈 배열이면 키워드 필터 비활성. */
  includeKeywords: string[];
  /** 제목·설명에 하나라도 포함되면 제외. */
  excludeKeywords: string[];
  /** 홈 노출 최대 갯수 (5~50). */
  maxResults: number;
  /** 매일 실행 시각 (KST 0~23). */
  scheduleHourKst: number;
  /** 쇼츠(60초 이하 또는 #shorts/#쇼츠 태그) 제외 여부. */
  excludeShorts: boolean;
  /** 영상 최소 길이 (초). 쇼츠 외에도 강제 가능. */
  minDurationSec: number;
  /** 영상 최대 나이 (일). 너무 옛날 영상 제외. */
  maxAgeDays: number;
  /**
   * 큐레이션 실행 주기 (일). 1=매일, 2=이틀마다, 7=주1회.
   * scheduleHourKst와 함께 작동 — 지정 시각에 도달했더라도
   * 마지막 실행으로부터 이 일수가 지나지 않았으면 건너뜀.
   */
  refreshIntervalDays: number;
  /**
   * true: 새 큐레이션 실행 시 기존 auto doc 모두 삭제 후 새 목록만 노출.
   * false: autoVideoMaxAgeDays 기반 점진적 만료.
   */
  expirePreviousOnRefresh: boolean;
  /**
   * auto doc이 N일 이상 지나면 자동 삭제 (expirePreviousOnRefresh=false일 때만).
   */
  autoVideoMaxAgeDays?: number;
  /** 마지막 실행 시각. */
  lastRunAt?: Timestamp;
  /** 마지막 실행 결과. */
  lastRunResult?: YoutubeCurationLastRunResult;
  updatedAt?: Timestamp;
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
  maxResults: 20,
  scheduleHourKst: 4,
  excludeShorts: true,
  minDurationSec: 61,
  maxAgeDays: 90,
  refreshIntervalDays: 1,
  expirePreviousOnRefresh: true,
  autoVideoMaxAgeDays: 7,
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
