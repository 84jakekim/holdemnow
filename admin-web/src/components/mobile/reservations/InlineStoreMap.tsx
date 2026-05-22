'use client';

/**
 * /m/reservations 예약 카드용 인라인 카카오맵.
 *
 * - 매장 마커 + 사용자 위치 마커 + 두 점 fit bounds + 거리 라벨
 * - 길찾기는 별도 버튼(외부 카카오맵 앱 딥링크)에서 처리 — 이 컴포넌트는 위치 컨텍스트만
 * - 매장 lat/lng 누락 시 부모에서 ensureStoreCoords로 채워서 prop으로 전달
 * - 사용자 위치는 navigator.geolocation.getCurrentPosition(/m/find와 동일 옵션)
 * - prefers-reduced-motion / SDK 로드 실패 시 정적 fallback (주소만 텍스트로)
 */

import { useEffect, useRef, useState } from 'react';
import { loadKakaoMaps } from '@/lib/kakao';
import { haversineMeters, formatDistance } from '@/lib/geo';

interface Props {
  storeId: string;
  storeName: string;
  storeLat?: number | null;
  storeLng?: number | null;
  storeAddress?: string;
  /** 카드 너비에 맞춰 높이만 지정. 기본 160. */
  height?: number;
  /** pending 상태에서 약간 흐림 처리 (PM 결정: 지도 50% opacity). */
  dimmed?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function InlineStoreMap({
  storeId,
  storeName,
  storeLat,
  storeLng,
  storeAddress,
  height = 160,
  dimmed = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 사용자 위치 1회 fetch
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // 카카오맵 마운트
  useEffect(() => {
    if (typeof storeLat !== 'number' || typeof storeLng !== 'number') return;
    if (!containerRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const maps = (await loadKakaoMaps()) as any;
        if (cancelled || !containerRef.current) return;

        // 기존 인스턴스 있으면 그대로 panTo만
        if (!mapRef.current) {
          mapRef.current = new maps.Map(containerRef.current, {
            center: new maps.LatLng(storeLat, storeLng),
            level: 5,
            draggable: false,
            zoomable: false,
            disableDoubleClickZoom: true,
          });
        }

        const map = mapRef.current;
        const storePos = new maps.LatLng(storeLat, storeLng);

        // 매장 마커 — 핫핑크 톤
        new maps.Marker({
          map,
          position: storePos,
          title: storeName,
        });

        // 사용자 위치 마커 + bounds fit
        if (userLoc) {
          const userPos = new maps.LatLng(userLoc.lat, userLoc.lng);
          // 사용자 위치는 작은 파란 원 (CustomOverlay)
          const userDot = new maps.CustomOverlay({
            position: userPos,
            content:
              '<div style="' +
              'width:14px;height:14px;border-radius:50%;background:#2563EB;' +
              'border:2.5px solid #fff;box-shadow:0 0 10px rgba(37,99,235,0.55);' +
              '"></div>',
            yAnchor: 0.5,
            xAnchor: 0.5,
          });
          userDot.setMap(map);

          // 두 점 fit bounds
          const bounds = new maps.LatLngBounds();
          bounds.extend(storePos);
          bounds.extend(userPos);
          map.setBounds(bounds, 24, 24, 24, 24);
        } else {
          map.setCenter(storePos);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storeLat, storeLng, storeName, userLoc]);

  // 좌표 없음 — fallback
  if (typeof storeLat !== 'number' || typeof storeLng !== 'number') {
    return (
      <div
        className="w-full rounded-xl flex items-center justify-center text-[12px] px-3"
        style={{
          height,
          background: 'var(--surface-2)',
          color: 'var(--text-3)',
          opacity: dimmed ? 0.5 : 1,
        }}
        aria-label="매장 위치 정보 없음"
      >
        🗺 {storeAddress || '매장 위치 정보를 불러올 수 없습니다'}
      </div>
    );
  }

  const distanceM =
    userLoc && typeof storeLat === 'number' && typeof storeLng === 'number'
      ? haversineMeters(userLoc, { lat: storeLat, lng: storeLng })
      : null;

  return (
    <div
      className="relative w-full rounded-xl overflow-hidden"
      style={{
        height,
        background: 'var(--surface-2)',
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      {/* 카카오맵 컨테이너 */}
      <div ref={containerRef} className="w-full h-full" aria-label={`${storeName} 위치`} />

      {/* 거리 라벨 — 우상단 핀 */}
      {distanceM != null && (
        <div
          className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-extrabold tabular-nums"
          style={{
            background: 'rgba(255,255,255,0.95)',
            color: 'var(--text-1)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            border: '1px solid rgba(0,0,0,0.08)',
          }}
        >
          📍 {formatDistance(distanceM)}
        </div>
      )}

      {/* 매장명 라벨 — 좌하단 */}
      <div
        className="absolute bottom-2 left-2 px-2 py-1 rounded-md text-[11px] font-bold truncate max-w-[60%]"
        style={{
          background: 'rgba(255,255,255,0.95)',
          color: 'var(--text-1)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          border: '1px solid rgba(0,0,0,0.08)',
        }}
        title={storeName}
      >
        🏬 {storeName}
      </div>

      {error && (
        <div
          className="absolute inset-0 flex items-center justify-center text-[11px] px-3"
          style={{ background: 'rgba(255,255,255,0.92)', color: 'var(--text-3)' }}
        >
          지도를 불러올 수 없습니다 ({error.slice(0, 40)})
        </div>
      )}

      {/* 키 prop 변화로 mapRef 누수 방지용 (정적) */}
      <span data-store-id={storeId} aria-hidden className="hidden" />
    </div>
  );
}
