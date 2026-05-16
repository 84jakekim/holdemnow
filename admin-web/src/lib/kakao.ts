'use client';

/**
 * Kakao Maps SDK 헬퍼.
 *
 * SDK는 layout.tsx에서 `autoload=false`로 로드됨. 사용 직전에 `kakao.maps.load(cb)`로 초기화.
 * 이 모듈은 SDK 준비를 기다리는 promise + Geocoder 헬퍼 제공.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    kakao?: any;
  }
}

let readyPromise: Promise<any> | null = null;

/** Kakao Maps SDK가 준비될 때까지 기다림. window.kakao.maps 반환. */
export function loadKakaoMaps(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Kakao Maps는 클라이언트에서만 로드 가능'));
  }
  if (readyPromise) return readyPromise;

  readyPromise = new Promise((resolve, reject) => {
    // SDK 스크립트 로드 폴링 (최대 10초)
    const start = Date.now();
    const TICK = 50;
    const TIMEOUT = 10_000;

    const check = () => {
      const k = window.kakao;
      if (k?.maps?.load) {
        k.maps.load(() => resolve(k.maps));
        return;
      }
      if (Date.now() - start > TIMEOUT) {
        readyPromise = null;
        reject(new Error('Kakao Maps SDK 로드 타임아웃 (10s). API 키·도메인 화이트리스트 확인.'));
        return;
      }
      setTimeout(check, TICK);
    };
    check();
  });

  return readyPromise;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** 주소 → 좌표 변환 (services.Geocoder). 결과 없으면 null. */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  if (!address?.trim()) return null;
  const maps = await loadKakaoMaps();
  const geocoder = new maps.services.Geocoder();

  return new Promise<LatLng | null>((resolve) => {
    geocoder.addressSearch(address.trim(), (result: any[], status: any) => {
      if (status !== maps.services.Status.OK || result.length === 0) {
        resolve(null);
        return;
      }
      const r = result[0];
      // Kakao는 x=경도(lng), y=위도(lat) 문자열로 반환
      const lng = parseFloat(r.x);
      const lat = parseFloat(r.y);
      if (isNaN(lat) || isNaN(lng)) {
        resolve(null);
        return;
      }
      resolve({ lat, lng });
    });
  });
}

/** 키워드 검색 (services.Places). 매장명/지명 검색용. */
export async function searchPlaces(
  keyword: string,
  options?: { center?: LatLng; radius?: number },
): Promise<
  Array<{
    id: string;
    name: string;
    address: string;
    roadAddress: string;
    lat: number;
    lng: number;
    category: string;
    phone: string;
  }>
> {
  if (!keyword?.trim()) return [];
  const maps = await loadKakaoMaps();
  const places = new maps.services.Places();

  return new Promise((resolve) => {
    const opts: any = {};
    if (options?.center) {
      opts.location = new maps.LatLng(options.center.lat, options.center.lng);
      opts.radius = options.radius ?? 5000;
    }
    places.keywordSearch(
      keyword.trim(),
      (result: any[], status: any) => {
        if (status !== maps.services.Status.OK) {
          resolve([]);
          return;
        }
        resolve(
          result.map((r) => ({
            id: r.id,
            name: r.place_name,
            address: r.address_name,
            roadAddress: r.road_address_name,
            lat: parseFloat(r.y),
            lng: parseFloat(r.x),
            category: r.category_name,
            phone: r.phone,
          })),
        );
      },
      opts,
    );
  });
}

/** 서면역 좌표 — 매장 좌표 없을 때 기본 중심으로 사용 */
export const DEFAULT_CENTER: LatLng = { lat: 35.157827, lng: 129.05912 };
