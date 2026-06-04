'use client';

import {
  doc,
  setDoc,
  increment,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';

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

/** YYYY-MM-DD (브라우저 로컬 = KST 가정) */
function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function dailyMetricsRef(storeId: string, dateKey: string) {
  return doc(db, 'stores', storeId, 'dailyMetrics', dateKey);
}

/**
 * 카운터 +1. sessionStorage 기반 클라이언트 dedup — 같은 (storeId, field) 조합은
 * 브라우저 세션 내 1회만 카운트(베타 어뷰징 1차 방어). 새 탭/리로드 시 리셋.
 * v0.2 Cloud Function 이관 시 서버측 uid dedup으로 강화 예정.
 * fire-and-forget — 트래킹 실패가 UX를 막으면 안 됨. 에러는 silent.
 */
const DEDUPE_KEY_PREFIX = 'holdemnow:metric:';
function alreadyBumped(storeId: string, field: StoreMetricField): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const key = `${DEDUPE_KEY_PREFIX}${storeId}:${field}`;
    if (window.sessionStorage.getItem(key)) return true;
    window.sessionStorage.setItem(key, '1');
    return false;
  } catch {
    return false; // storage 사용 불가 — dedup skip
  }
}

/**
 * 테스트 트래픽 차단 — "실사용자만 카운트" (2026-06-04).
 * 배경: 누적 노출 26,100회가 전부 개발·테스트 트래픽으로 판명(dev 서버가 prod Firestore에
 * 연결 + Playwright 스모크 감사 + QA 계정 브라우징). 매장 사장에게 가짜 성과로 보이는 문제.
 * 차단 대상:
 *  1) 로컬/사설망 dev 서버 — 최대 오염원
 *  2) 자동화 브라우저 (Playwright/Selenium — navigator.webdriver)
 *  3) 내부 QA·관리자 계정
 *  4) 수동 옵트아웃: localStorage 'hn:noTrack' = '1'
 * 판별 실패 시엔 카운트 진행(가용성 우선). 기존 누적분 리셋은 출시 전 초기화 절차에서.
 */
const TEST_ACCOUNT_EMAILS = new Set([
  'thethego@naver.com',   // 총관리자
  'pinkrabbit@naver.com', // QA 플레이어
  'ssibak@empal.com',     // QA 본사
  '1111@naver.com',       // QA 매장
]);

function isTestTraffic(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.startsWith('10.')) {
      return true;
    }
    if (navigator.webdriver) return true;
    if (window.localStorage.getItem('hn:noTrack') === '1') return true;
    const email = auth.currentUser?.email?.toLowerCase();
    if (email && TEST_ACCOUNT_EMAILS.has(email)) return true;
  } catch {
    // 판별 자체가 실패하면 실사용자로 간주하고 카운트
  }
  return false;
}

export function bumpStoreMetric(storeId: string, field: StoreMetricField) {
  if (!storeId) return;
  if (isTestTraffic()) return; // 테스트 트래픽 — 카운트 제외
  // 같은 세션 중복 카운트 방지 (favoriteAdds/directionsClicks 등). impressions는 trackImpressionOnce가 별도 처리.
  if (field !== 'impressions' && alreadyBumped(storeId, field)) return;
  // 1) 누적 카운터 (기존)
  setDoc(
    metricsRef(storeId),
    { [field]: increment(1), updatedAt: serverTimestamp() },
    { merge: true },
  ).catch(() => {
    /* 익명 사용자/네트워크 오류 — silent */
  });
  // 2) 일별 카운터 (2026-05-27 추가) — 대시보드 일/주/월 분석 + 추이 그래프용
  const dk = todayKey();
  setDoc(
    dailyMetricsRef(storeId, dk),
    { [field]: increment(1), date: dk, updatedAt: serverTimestamp() },
    { merge: true },
  ).catch(() => {
    /* silent */
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
