'use client';

import {
  doc,
  setDoc,
  increment,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

/**
 * 매장별 누적 카운터 (stores/{storeId}/metrics/global)
 *
 * v0.1: 평탄한 cumulative counter. 일별 집계는 v0.2에서 Cloud Function이 자정 배치로 처리.
 * Firestore 규칙으로 누구나 increment 가능 (베타 abuse 감지 시 강화).
 */

export type StoreMetricField =
  | 'impressions'      // 매장 카드가 모바일 화면에 노출됨
  | 'cardClicks'       // 매장 카드 → 매장 상세 이동
  | 'liveOpens'        // LIVE 풀스크린 진입
  | 'directionsClicks' // 길찾기 버튼 클릭
  | 'phoneClicks'      // 전화 버튼 클릭
  | 'favoriteAdds';    // 즐겨찾기 추가 (해제는 카운트 X)

export interface StoreMetrics {
  impressions?: number;
  cardClicks?: number;
  liveOpens?: number;
  directionsClicks?: number;
  phoneClicks?: number;
  favoriteAdds?: number;
}

function metricsRef(storeId: string) {
  return doc(db, 'stores', storeId, 'metrics', 'global');
}

/**
 * 카운터 +1.
 * fire-and-forget — 트래킹 실패가 UX를 막으면 안 됨. 에러는 silent.
 */
export function bumpStoreMetric(storeId: string, field: StoreMetricField) {
  if (!storeId) return;
  setDoc(
    metricsRef(storeId),
    { [field]: increment(1), updatedAt: serverTimestamp() },
    { merge: true },
  ).catch(() => {
    // 익명 사용자, 네트워크 오류 등 — silent fail
  });
}

/** 매장 어드민 KPI/Stats용 — 실시간 구독 */
export function subscribeStoreMetrics(
  storeId: string,
  onChange: (m: StoreMetrics) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    metricsRef(storeId),
    (snap) => onChange((snap.exists() ? snap.data() : {}) as StoreMetrics),
    (err) => onError?.(err as Error),
  );
}

/**
 * 노출 dedupe — 세션 동안 같은 (storeId, surface) 조합은 1번만 카운트.
 * 새 페이지 로드 시 리셋. 베타 단계의 단순 구현.
 */
const seenImpressions = new Set<string>();

export function trackImpressionOnce(storeId: string, surface: string) {
  if (!storeId) return;
  const key = `${storeId}::${surface}`;
  if (seenImpressions.has(key)) return;
  seenImpressions.add(key);
  bumpStoreMetric(storeId, 'impressions');
}
