/**
 * 지리적 유틸리티 — 거리 계산·포맷 + 광역 regionCode 헬퍼.
 * /m/discover, /m 홈, 매장찾기, 광고 슬롯 분배(adSlots), backfill 스크립트에서 공유.
 *
 * regionCode 정책 (Sprint 1 Phase B, 2026-05-21 확정):
 *  - 광역 단위 한글 키: "부산" / "서울" / "경기" / "제주" 등 (regionFromAddress와 호환)
 *  - `where regionCode in [내 시/도 + 인접]` 쿼리에 직접 사용 (Firestore in 캡 10개)
 *  - 카카오 SDK 일일 한도 절약: 가능하면 광역 라벨 prefix만 사용
 *  - 인접 광역 매핑: 부산↔경남, 서울↔경기↔인천 등
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** 두 좌표 사이 거리 (미터, Haversine). 빠른 근사용. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** 거리 사람 친화적 포맷: 320m / 1.2km / 12km */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters / 1000)}km`;
}

// ─────────────────────────────────────────────────────────────
// regionCode — 광역 단위 한글 키
// ─────────────────────────────────────────────────────────────

/** 한국 광역 단위 코드. regionFromAddress와 호환. */
export const KNOWN_REGION_CODES = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
] as const;
export type RegionCode = (typeof KNOWN_REGION_CODES)[number] | '미분류';

/**
 * 한국 주소에서 광역 단위 추출.
 * 예) "부산광역시 부산진구..." → "부산"
 *     "서울특별시 강남구..." → "서울"
 *     "경기도 성남시..." → "경기"
 *     "제주특별자치도 ..." → "제주"
 *
 * (stats.ts의 regionFromAddress와 동일 로직 — 단일 진실 원천화)
 */
export function regionCodeFromAddress(address?: string | null): RegionCode {
  if (!address) return '미분류';
  const first = address.trim().split(/\s+/)[0];
  if (!first) return '미분류';
  if (first.includes('광역시') || first.includes('특별시') || first.includes('특별자치시')) {
    const r = first.slice(0, 2);
    return (KNOWN_REGION_CODES as readonly string[]).includes(r) ? (r as RegionCode) : '미분류';
  }
  if (first.includes('특별자치도')) {
    const r = first.slice(0, 2);
    return (KNOWN_REGION_CODES as readonly string[]).includes(r) ? (r as RegionCode) : '미분류';
  }
  if (first.endsWith('도') && first.length >= 2) {
    const r = first.replace(/도$/, '');
    return (KNOWN_REGION_CODES as readonly string[]).includes(r) ? (r as RegionCode) : '미분류';
  }
  const r = first.slice(0, 2);
  return (KNOWN_REGION_CODES as readonly string[]).includes(r) ? (r as RegionCode) : '미분류';
}

/**
 * 카카오 region label("부산 부산진구 부전동")에서 광역 코드만 추출.
 * 헤더 위치 라벨에 이미 있는 데이터 재활용 — 추가 SDK 호출 없음.
 */
export function regionCodeFromLabel(label?: string | null): RegionCode {
  if (!label) return '미분류';
  const first = label.trim().split(/\s+/)[0];
  if (!first) return '미분류';
  return (KNOWN_REGION_CODES as readonly string[]).includes(first)
    ? (first as RegionCode)
    : '미분류';
}

/**
 * GPS 좌표 → 광역 regionCode (좌표 박스 근사, SDK 호출 없음).
 * 카카오 일일 30만 한도 보호용 — 정확하지 않지만 광역 단위는 충분.
 *
 * 박스 우선순위: 부산·경남 → 서울·경기·인천 → 광역시 → 도 → fallback 거리 매핑.
 */
export function regionCodeFromCoord(lat: number, lng: number): RegionCode {
  // 부산·경남 핵심 시장 — 가장 좁은 박스 먼저 매칭
  if (lat >= 34.9 && lat <= 35.4 && lng >= 128.7 && lng <= 129.3) return '부산';
  if (lat >= 34.5 && lat <= 35.9 && lng >= 127.7 && lng <= 129.0) return '경남';
  if (lat >= 35.6 && lat <= 36.3 && lng >= 128.4 && lng <= 129.7) return '경북';
  if (lat >= 35.2 && lat <= 35.8 && lng >= 129.0 && lng <= 129.5) return '울산';

  // 수도권
  if (lat >= 37.4 && lat <= 37.7 && lng >= 126.7 && lng <= 127.2) return '서울';
  if (lat >= 37.3 && lat <= 37.7 && lng >= 126.4 && lng <= 126.8) return '인천';
  if (lat >= 36.9 && lat <= 38.3 && lng >= 126.5 && lng <= 127.7) return '경기';

  // 광역시
  if (lat >= 35.7 && lat <= 36.0 && lng >= 128.4 && lng <= 128.8) return '대구';
  if (lat >= 35.0 && lat <= 35.3 && lng >= 126.7 && lng <= 127.0) return '광주';
  if (lat >= 36.2 && lat <= 36.5 && lng >= 127.2 && lng <= 127.5) return '대전';
  if (lat >= 36.4 && lat <= 36.7 && lng >= 127.2 && lng <= 127.4) return '세종';

  // 도 단위
  if (lat >= 37.0 && lat <= 38.7 && lng >= 127.0 && lng <= 129.4) return '강원';
  if (lat >= 36.0 && lat <= 37.3 && lng >= 127.0 && lng <= 128.6) return '충북';
  if (lat >= 36.0 && lat <= 37.1 && lng >= 126.0 && lng <= 127.5) return '충남';
  if (lat >= 35.4 && lat <= 36.3 && lng >= 126.4 && lng <= 127.9) return '전북';
  if (lat >= 33.9 && lat <= 35.5 && lng >= 125.9 && lng <= 127.9) return '전남';
  if (lat >= 33.1 && lat <= 33.6 && lng >= 126.1 && lng <= 126.9) return '제주';

  return '미분류';
}

/**
 * 인접 광역 매핑 — `where regionCode in [내 + 인접]` 쿼리용.
 * 30km 자동 확장 시 호출자에서 사용. Firestore in 캡=10이므로 최대 9개로 제한.
 */
const ADJACENT_REGIONS: Record<string, RegionCode[]> = {
  서울: ['경기', '인천'],
  경기: ['서울', '인천', '강원', '충남', '충북'],
  인천: ['서울', '경기'],
  부산: ['경남', '울산'],
  경남: ['부산', '울산', '경북', '전남'],
  울산: ['부산', '경남', '경북'],
  경북: ['대구', '울산', '경남', '강원', '충북'],
  대구: ['경북', '경남'],
  대전: ['세종', '충남', '충북'],
  세종: ['대전', '충남', '충북'],
  충남: ['세종', '대전', '경기', '충북', '전북'],
  충북: ['세종', '대전', '경기', '강원', '충남', '경북', '전북'],
  강원: ['경기', '충북', '경북'],
  광주: ['전남', '전북'],
  전남: ['광주', '전북', '경남'],
  전북: ['광주', '전남', '충남', '충북', '경남'],
  제주: [],
};

/**
 * 내 광역 + 인접 광역 코드 배열. Firestore `where regionCode in […]` 캡 보호 (≤10).
 * 자동확장 미적용 시(initial)는 `[내 1개]`, 5건 미만 자동확장 시 `[내 + 인접 N개]`.
 */
export function regionsWithAdjacent(my: RegionCode, includeAdjacent = true): RegionCode[] {
  if (my === '미분류') return [];
  if (!includeAdjacent) return [my];
  const adj = ADJACENT_REGIONS[my] ?? [];
  return [my, ...adj].slice(0, 10);
}
