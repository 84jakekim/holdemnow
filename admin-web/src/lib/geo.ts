/**
 * 지리적 유틸리티 — 거리 계산·포맷. /m/discover와 /m 홈에서 공유.
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
