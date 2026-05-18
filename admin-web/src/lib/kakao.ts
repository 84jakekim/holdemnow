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
// 한 세션에서 SDK가 한 번 실패하면 같은 세션 내 추가 호출 시도 즉시 거절.
// 카카오 일일 한도 초과 등으로 SDK 거부 시 같은 페이지에서 수십~수백번 재시도하는 콘솔 폭증 차단.
let sessionFailed = false;

/** Kakao Maps SDK가 준비될 때까지 기다림. window.kakao.maps 반환. */
export function loadKakaoMaps(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Kakao Maps는 클라이언트에서만 로드 가능'));
  }
  // 같은 세션에서 한 번 실패하면 즉시 reject — 카카오 일일 한도 초과 시
  // 페이지의 모든 SDK 호출이 25초씩 폴링하며 콘솔 폭증하는 것 차단.
  if (sessionFailed) {
    return Promise.reject(new Error('Kakao Maps SDK 세션 실패 — 새로고침 후 재시도'));
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
        sessionFailed = true; // 이후 호출은 폴링 안 함
        const has = !!window.kakao;
        const scripts = Array.from(document.querySelectorAll('script[src*="dapi.kakao.com"]'));
        const mapsScript = scripts[0] as HTMLScriptElement | undefined;
        const detail = `window.kakao=${has}, scripts=${scripts.length}, src=${mapsScript?.src ?? 'none'}`;
        // 한 번만 콘솔에 안내 — 카카오 일일 한도 초과가 가장 흔한 원인
        console.warn('[kakao] SDK 로드 실패. 카카오 일일 호출 한도(30만/일) 초과 또는 도메인 거부일 가능성. 한국시간 자정 후 재시도. ' + detail);
        reject(new Error('Kakao Maps SDK 로드 타임아웃. ' + detail));
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

/** 좌표 → 행정구역 (services.Geocoder.coord2RegionCode).
 *  반환: "부산 부산진구 부전동" 형태의 축약 라벨, 또는 null. */
export async function coordToRegionLabel(lat: number, lng: number): Promise<string | null> {
  const maps = await loadKakaoMaps();
  const geocoder = new maps.services.Geocoder();
  return new Promise<string | null>((resolve) => {
    geocoder.coord2RegionCode(lng, lat, (result: any[], status: any) => {
      if (status !== maps.services.Status.OK || !result || result.length === 0) {
        resolve(null);
        return;
      }
      const hRegion = result.find((r) => r.region_type === 'H') ?? result[0];
      if (!hRegion) {
        resolve(null);
        return;
      }
      const region1 = String(hRegion.region_1depth_name || '').replace(/(특별시|광역시|특별자치시|특별자치도|도)$/u, '');
      const region2 = String(hRegion.region_2depth_name || '');
      const region3 = String(hRegion.region_3depth_name || '');
      const parts = [region1, region2, region3].filter(Boolean);
      resolve(parts.join(' '));
    });
  });
}

/** 서면역 좌표 — 매장 좌표 없을 때 기본 중심으로 사용 */
export const DEFAULT_CENTER: LatLng = { lat: 35.157827, lng: 129.05912 };
