'use client';

/**
 * 매장찾기 지도 컴포넌트 — lazy chunk 분리용 (#6).
 * find/page.tsx에서 next/dynamic으로 import → 지도 모드 선택 전에는 번들에 포함 안 됨.
 * - KakaoMap: 매장 마커 클러스터링 + 사용자 위치 원 + 줌 반경 동적 조정
 * - 마커 유틸: SVG 마커 이미지 빌더 (LIVE 펄스 애니메이션 포함)
 */

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { loadKakaoMaps, DEFAULT_CENTER } from '@/lib/kakao';
import type { LatLng } from '@/lib/geo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── 줌별 반경 ────────────────────────────────────────────────
function radiusForZoomLevel(level: number): number {
  if (level <= 2) return 125;
  if (level === 3) return 250;
  if (level === 4) return 500;
  if (level === 5) return 1000;
  if (level === 6) return 1750;
  if (level === 7) return 2500;
  if (level === 8) return 3750;
  return 5000;
}

// ─── 마커 이미지 캐시 ────────────────────────────────────────
const _markerImageCache = new Map<string, any>();
function getMarkerImage(maps: any, opts: { name: string; live: number; selected: boolean }) {
  const key = `${opts.live}|${opts.selected ? 's' : ''}|${opts.name}`;
  const cached = _markerImageCache.get(key);
  if (cached) return cached;
  const img = buildMarkerImage(maps, opts);
  _markerImageCache.set(key, img);
  return img;
}

function widthOf(s: string) { return Array.from(s).reduce((sum, ch) => sum + (/[\x00-\x7F]/.test(ch) ? 7 : 12), 0); }
function escapeSvg(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function buildMarkerImage(maps: any, opts: { name: string; live: number; selected: boolean }) {
  const { name, live, selected } = opts;
  const PILL_H = 26, TAIL_H = 7, height = PILL_H + TAIL_H;
  const nameW = widthOf(name);
  const safeName = escapeSvg(name);
  if (live > 0) {
    const liveLabel = live > 1 ? `LIVE ${live}` : 'LIVE';
    const liveLabelW = liveLabel.length * 6;
    const RIPPLE_PAD = 10, LEFT = 8, DOT = 6, G1 = 5, G2 = 8, RIGHT = 12;
    const pillWidth = LEFT + DOT + G1 + liveLabelW + G2 + nameW + RIGHT;
    const totalH = RIPPLE_PAD + PILL_H + TAIL_H, cx = pillWidth / 2;
    const dotX = LEFT + DOT / 2, liveX = LEFT + DOT + G1, nameX = liveX + liveLabelW + G2;
    const fill = '#E53E3E', stroke = selected ? '#7F1D1D' : '#C53030', sw = selected ? 2 : 1;
    const rDotCx = dotX, rDotCy = RIPPLE_PAD + PILL_H / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillWidth}" height="${totalH}" viewBox="0 0 ${pillWidth} ${totalH}"><circle cx="${rDotCx}" cy="${rDotCy}" r="3" fill="#E53E3E" opacity="0.6"><animate attributeName="r" values="4;14;4" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.55;0;0.55" dur="1.6s" repeatCount="indefinite"/></circle><rect x="0.5" y="${RIPPLE_PAD + 0.5}" width="${pillWidth-1}" height="${PILL_H-1}" rx="${PILL_H/2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/><circle cx="${dotX}" cy="${RIPPLE_PAD + PILL_H/2}" r="${DOT/2}" fill="#fff"/><text x="${liveX}" y="${RIPPLE_PAD + PILL_H/2+4}" fill="#fff" font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="800">${liveLabel}</text><text x="${nameX}" y="${RIPPLE_PAD + PILL_H/2+5}" fill="#fff" font-family="Pretendard,Inter,system-ui,sans-serif" font-size="12" font-weight="800">${safeName}</text><polygon points="${cx-6},${RIPPLE_PAD+PILL_H} ${cx+6},${RIPPLE_PAD+PILL_H} ${cx},${RIPPLE_PAD+PILL_H+TAIL_H}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
    const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    return new maps.MarkerImage(url, new maps.Size(pillWidth, totalH), { offset: new maps.Point(cx, totalH) });
  }
  const PAD = 14, width = nameW + PAD * 2, cx = width / 2;
  const fill = selected ? '#FF1F8F' : '#FFFFFF', textColor = selected ? '#fff' : '#111827';
  const stroke = selected ? '#CC1072' : '#E5E7EB', sw = selected ? 2 : 1.5;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><filter id="s"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.12"/></filter><rect x="0.5" y="0.5" width="${width-1}" height="${PILL_H-1}" rx="${PILL_H/2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" filter="url(#s)"/><text x="${cx}" y="${PILL_H/2+5}" fill="${textColor}" font-family="Pretendard,Inter,system-ui,sans-serif" font-size="12" font-weight="800" text-anchor="middle">${safeName}</text><polygon points="${cx-6},${PILL_H} ${cx+6},${PILL_H} ${cx},${PILL_H+TAIL_H}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(width, height), { offset: new maps.Point(cx, height) });
}

function clusterStyles() {
  const base = { color: '#FF1F8F', textAlign: 'center' as const, fontWeight: '800' as const, fontFamily: 'Inter,system-ui,sans-serif', border: '2px solid #FF1F8F', background: '#FFFFFF', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' };
  return [
    { ...base, width: '36px', height: '36px', borderRadius: '18px', lineHeight: '32px', fontSize: '12px' },
    { ...base, width: '44px', height: '44px', borderRadius: '22px', lineHeight: '40px', fontSize: '13px' },
    { ...base, width: '52px', height: '52px', borderRadius: '26px', lineHeight: '48px', fontSize: '14px' },
    { ...base, width: '60px', height: '60px', borderRadius: '30px', lineHeight: '56px', fontSize: '15px' },
    { ...base, width: '72px', height: '72px', borderRadius: '36px', lineHeight: '68px', fontSize: '16px' },
  ];
}

function buildUserMarker(maps: any) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="#FF1F8F" opacity="0.12"><animate attributeName="r" values="10;16;10" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.22;0.04;0.22" dur="2s" repeatCount="indefinite"/></circle><circle cx="18" cy="18" r="7" fill="#fff" filter="drop-shadow(0 1px 3px rgba(0,0,0,0.20))"/><circle cx="18" cy="18" r="5" fill="#FF1F8F"/></svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(36, 36), { offset: new maps.Point(18, 18) });
}

// ─── MapStoreSummary 타입 (find/page.tsx와 동일하게 유지) ───────
export interface MapStoreSummary {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
  lat?: number;
  lng?: number;
  averageRating?: number;
  reviewCount?: number;
}

// ─── KakaoMap 컴포넌트 ────────────────────────────────────────
export default function FindKakaoMap({
  stores, liveCountByStore, selectedId, onSelect, onError, userLocation, locationDenied, mapInstanceRef,
}: {
  stores: MapStoreSummary[];
  liveCountByStore: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onError: (msg: string | null) => void;
  userLocation: LatLng | null;
  locationDenied: boolean;
  mapInstanceRef: React.MutableRefObject<any>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const normalMarkersRef = useRef<Map<string, any>>(new Map());
  const liveMarkersRef = useRef<Map<string, any>>(new Map());
  const clustererRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!userLocation && !locationDenied) return;
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadKakaoMaps();
        if (cancelled || !containerRef.current || mapInstanceRef.current) return;
        const center = userLocation
          ? new maps.LatLng(userLocation.lat, userLocation.lng)
          : new maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
        mapInstanceRef.current = new maps.Map(containerRef.current, { center, level: 4 });
        if (maps.MarkerClusterer) {
          clustererRef.current = new maps.MarkerClusterer({
            map: mapInstanceRef.current,
            averageCenter: true, minLevel: 6, gridSize: 80,
            disableClickZoom: false, calculator: [10, 30, 100, 300],
            styles: clusterStyles(),
          });
        }
        setMapReady(true);
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [onError, userLocation, locationDenied, mapInstanceRef]);

  // 언마운트 전용 정리 (2026-06-04) — 목록↔지도 왕복·뒤로가기 시 지도 인스턴스를
  // 완전 해제. mapInstanceRef는 부모 소유라 언마운트돼도 truthy로 남아, 재마운트 시
  // 위 초기화 가드(mapInstanceRef.current 체크)에 걸려 떼어진 DOM을 참조하는 죽은
  // 인스턴스가 재사용되며 크래시/빈 지도가 되던 문제. (위 effect의 cleanup에 넣으면
  // userLocation 갱신마다 지도가 파괴·재생성되므로 deps 없는 별도 effect로 분리.)
  useEffect(() => {
    return () => {
      try { clustererRef.current?.clear?.(); } catch { /* noop */ }
      clustererRef.current = null;
      for (const m of normalMarkersRef.current.values()) { try { m.setMap(null); } catch { /* noop */ } }
      normalMarkersRef.current.clear();
      for (const m of liveMarkersRef.current.values()) { try { m.setMap(null); } catch { /* noop */ } }
      liveMarkersRef.current.clear();
      try { userMarkerRef.current?.setMap?.(null); } catch { /* noop */ }
      userMarkerRef.current = null;
      try { radiusCircleRef.current?.setMap?.(null); } catch { /* noop */ }
      radiusCircleRef.current = null;
      mapInstanceRef.current = null; // 핵심 — 재마운트 시 새 인스턴스 생성 허용
    };
  }, [mapInstanceRef]);

  useEffect(() => {
    if (!mapReady || !userLocation || !mapInstanceRef.current) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!maps) return;
    const pos = new maps.LatLng(userLocation.lat, userLocation.lng);
    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition(pos);
    } else {
      userMarkerRef.current = new maps.Marker({ position: pos, map: mapInstanceRef.current, image: buildUserMarker(maps), zIndex: 30 });
    }
    const initialRadius = radiusForZoomLevel(mapInstanceRef.current.getLevel());
    if (radiusCircleRef.current) {
      radiusCircleRef.current.setPosition(pos);
      radiusCircleRef.current.setRadius(initialRadius);
    } else {
      radiusCircleRef.current = new maps.Circle({
        center: pos, radius: initialRadius,
        strokeWeight: 2, strokeColor: '#FF1F8F', strokeOpacity: 0.5, strokeStyle: 'solid',
        fillColor: '#FF1F8F', fillOpacity: 0.08,
      });
      radiusCircleRef.current.setMap(mapInstanceRef.current);
    }
  }, [mapReady, userLocation, mapInstanceRef]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!maps) return;
    const map = mapInstanceRef.current;
    const onZoom = () => { if (!radiusCircleRef.current) return; radiusCircleRef.current.setRadius(radiusForZoomLevel(map.getLevel())); };
    maps.event.addListener(map, 'zoom_changed', onZoom);
    return () => { maps.event.removeListener(map, 'zoom_changed', onZoom); };
  }, [mapReady]);

  useEffect(() => {
    // mapReady 가드 추가 (2026-06-04) — 초기화 완료 전/해제 후 마커 작업 방지
    if (!mapReady || !mapInstanceRef.current) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!maps) return;
    const clusterer = clustererRef.current;
    const validStores = stores.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
    const seenNormal = new Set<string>();
    const seenLive = new Set<string>();
    const newClusterMarkers: any[] = [];

    for (const s of validStores) {
      const live = liveCountByStore[s.id] || 0;
      const isSelected = s.id === selectedId;
      const pos = new maps.LatLng(s.lat!, s.lng!);
      const image = getMarkerImage(maps, { name: s.name, live, selected: isSelected });
      if (live > 0) {
        seenLive.add(s.id);
        const wasNormal = normalMarkersRef.current.get(s.id);
        if (wasNormal) { if (clusterer) clusterer.removeMarker(wasNormal); else wasNormal.setMap(null); normalMarkersRef.current.delete(s.id); }
        const existing = liveMarkersRef.current.get(s.id);
        if (existing) { existing.setPosition(pos); existing.setImage(image); }
        else {
          const marker = new maps.Marker({ position: pos, map: mapInstanceRef.current, title: s.name, image, zIndex: 25 });
          maps.event.addListener(marker, 'click', () => onSelect(s.id));
          liveMarkersRef.current.set(s.id, marker);
        }
      } else {
        seenNormal.add(s.id);
        const wasLive = liveMarkersRef.current.get(s.id);
        if (wasLive) { wasLive.setMap(null); liveMarkersRef.current.delete(s.id); }
        const existing = normalMarkersRef.current.get(s.id);
        if (existing) { existing.setPosition(pos); existing.setImage(image); }
        else {
          const marker = new maps.Marker({ position: pos, map: clusterer ? undefined : mapInstanceRef.current, title: s.name, image, zIndex: isSelected ? 20 : 10 });
          maps.event.addListener(marker, 'click', () => onSelect(s.id));
          normalMarkersRef.current.set(s.id, marker);
          if (clusterer) newClusterMarkers.push(marker);
        }
      }
    }
    if (clusterer && newClusterMarkers.length > 0) clusterer.addMarkers(newClusterMarkers);
    for (const [id, m] of normalMarkersRef.current) { if (!seenNormal.has(id)) { if (clusterer) clusterer.removeMarker(m); else m.setMap(null); normalMarkersRef.current.delete(id); } }
    for (const [id, m] of liveMarkersRef.current) { if (!seenLive.has(id)) { m.setMap(null); liveMarkersRef.current.delete(id); } }
  }, [mapReady, stores, liveCountByStore, selectedId, onSelect, mapInstanceRef]);

  return <div ref={containerRef} className="w-full h-full" />;
}
