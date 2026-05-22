'use client';

/**
 * storeGeocode — 매장 좌표 lazy fallback 헬퍼.
 *
 * 매장 doc에 lat/lng가 누락된 경우, 클라이언트에서 address를 Kakao Geocoder로
 * 변환한 뒤 Firestore stores/{id} 에 best-effort로 캐시한다.
 *
 * - 권한이 없는 일반 사용자는 stores update가 룰에서 거부되므로 캐시 실패해도
 *   throw 하지 않는다 (좌표 자체는 함수 반환값으로 제공).
 * - 매장 owner/member/platform_admin이 호출하면 캐시가 영구 적용되어 다음 사용자부터
 *   geocode 호출 없이 사용 가능.
 *
 * 사용 예:
 *   const coords = await ensureStoreCoords({
 *     id: store.id,
 *     lat: store.lat,
 *     lng: store.lng,
 *     address: store.address,
 *   });
 *   if (coords) {
 *     // distance 계산, 지도 마커 표시 등
 *   }
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { geocodeAddress } from './kakao';

export interface StoreCoordsInput {
  id: string;
  lat?: number;
  lng?: number;
  address?: string;
}

export interface StoreCoords {
  lat: number;
  lng: number;
}

/**
 * 매장 좌표를 보장한다.
 * - lat/lng가 이미 있으면 그대로 반환.
 * - 없고 address가 있으면 Kakao geocodeAddress로 변환 후 Firestore에 캐시 시도.
 * - 둘 다 없거나 geocode 실패하면 null.
 */
export async function ensureStoreCoords(
  store: StoreCoordsInput,
): Promise<StoreCoords | null> {
  const lat = typeof store.lat === 'number' && Number.isFinite(store.lat) ? store.lat : undefined;
  const lng = typeof store.lng === 'number' && Number.isFinite(store.lng) ? store.lng : undefined;

  if (lat !== undefined && lng !== undefined) {
    return { lat, lng };
  }

  const address = store.address?.trim();
  if (!address) return null;

  let resolved: StoreCoords | null = null;
  try {
    resolved = await geocodeAddress(address);
  } catch {
    // Kakao SDK 실패(일일 한도, 도메인 거부 등) — 좌표 없음으로 처리
    return null;
  }

  if (!resolved) return null;

  // best-effort 캐시. 일반 사용자는 stores update 권한이 없으므로
  // 실패하더라도 무시하고 좌표 자체는 반환한다.
  void updateDoc(doc(db, 'stores', store.id), {
    lat: resolved.lat,
    lng: resolved.lng,
  }).catch(() => {
    /* 캐시 실패 무시 — 권한 부족이 가장 흔한 원인 */
  });

  return resolved;
}
