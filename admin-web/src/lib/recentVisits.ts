/**
 * recentVisits.ts — 최근 방문 매장 localStorage 헬퍼
 *
 * 기록 키: holdemnow:recentVisits
 * 형식: JSON array of RecentVisit, 최대 10개 LRU (최신 앞)
 * SSR 안전: typeof window !== 'undefined' 가드 필수
 */

export interface RecentVisit {
  storeId: string;
  storeName: string;
  photoUrl?: string;
  visitedAt: string; // ISO 8601
}

const KEY = 'holdemnow:recentVisits';
const MAX = 10;

/** localStorage에서 배열을 안전하게 읽는다. */
function readAll(): RecentVisit[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentVisit[];
  } catch {
    return [];
  }
}

/** 배열을 localStorage에 안전하게 저장한다. */
function writeAll(items: RecentVisit[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* 용량 초과 등 무시 */
  }
}

/**
 * 최근 방문 매장 기록.
 * - 동일 storeId가 이미 있으면 제거 후 최신으로 앞에 추가 (LRU).
 * - 최대 MAX(10)개 유지.
 */
export function recordRecentVisit(visit: RecentVisit): void {
  const prev = readAll().filter((v) => v.storeId !== visit.storeId);
  const next = [visit, ...prev].slice(0, MAX);
  writeAll(next);
}

/**
 * 최근 방문 매장 목록 반환 (최신순, 최대 MAX개).
 * SSR 환경에선 항상 빈 배열 반환.
 */
export function getRecentVisits(): RecentVisit[] {
  return readAll();
}

/**
 * 최근 방문 매장 기록 전체 삭제.
 */
export function clearRecentVisits(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}
