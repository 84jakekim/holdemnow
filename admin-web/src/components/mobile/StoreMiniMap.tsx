'use client';

/**
 * 매장 상세 미니맵 — lazy chunk 분리용 (#6).
 * store/[storeId]/page.tsx에서 next/dynamic으로 import → 초기 번들에 포함 안 됨.
 */

import { useEffect, useRef, useState } from 'react';
import { loadKakaoMaps } from '@/lib/kakao';
import MapLoadError from '@/components/mobile/MapLoadError';

/* eslint-disable @typescript-eslint/no-explicit-any */

function escapeSvg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildNameBadgeMarker(maps: any, name: string) {
  const widthOf = (s: string) => Array.from(s).reduce((sum, ch) => sum + (/[ -~]/.test(ch) ? 8 : 13), 0);
  const PAD_X = 14, TAIL_H = 8, PILL_H = 28;
  const width = Math.max(60, widthOf(name) + PAD_X * 2);
  const height = PILL_H + TAIL_H;
  const cx = width / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0.5" y="0.5" width="${width-1}" height="${PILL_H-1}" rx="${PILL_H/2}" fill="#FF1F8F" stroke="#CC1072" stroke-width="1.5"/><text x="${cx}" y="${PILL_H/2+5}" fill="#fff" font-family="Pretendard,Inter,system-ui,-apple-system,sans-serif" font-size="12" font-weight="800" text-anchor="middle">${escapeSvg(name)}</text><polygon points="${cx-6},${PILL_H} ${cx+6},${PILL_H} ${cx},${PILL_H+TAIL_H}" fill="#FF1F8F" stroke="#CC1072" stroke-width="1.5"/></svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(width, height), { offset: new maps.Point(cx, height) });
}

export default function StoreMiniMap({
  lat,
  lng,
  name,
  address,
  kakaoPlaceId,
}: {
  lat: number;
  lng: number;
  name: string;
  address?: string;
  kakaoPlaceId?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const maps = await loadKakaoMaps();
        if (cancelled || !containerRef.current || mapRef.current) return;
        const center = new maps.LatLng(lat, lng);
        mapRef.current = new maps.Map(containerRef.current, { center, level: 3 });
        const zoomControl = new maps.ZoomControl();
        mapRef.current.addControl(zoomControl, maps.ControlPosition.TOPRIGHT);
        markerRef.current = new maps.Marker({
          position: center, map: mapRef.current,
          image: buildNameBadgeMarker(maps, name), title: name,
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng, name]);

  useEffect(() => {
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!mapRef.current || !maps) return;
    const pos = new maps.LatLng(lat, lng);
    mapRef.current.setCenter(pos);
    if (markerRef.current) markerRef.current.setPosition(pos);
  }, [lat, lng]);

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height: 200, borderRadius: 'var(--r-xl)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {error && (
        <MapLoadError
          address={address}
          kakaoPlaceId={kakaoPlaceId}
          layout="overlay"
          compact
        />
      )}
    </div>
  );
}
