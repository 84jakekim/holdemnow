'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession } from '@/lib/live';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { loadKakaoMaps, geocodeAddress, DEFAULT_CENTER, type LatLng } from '@/lib/kakao';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface StoreSummary {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
  lat?: number;
  lng?: number;
}

export default function DiscoverPage() {
  const router = useRouter();
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

  // 현재 위치 가져오기 (Permission 거부 시 기본 중심 사용)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        // 권한 거부 또는 실패 — 기본 중심(서면)으로 fallback
        setLocationDenied(true);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  // 매장 데이터 로드
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'stores'));
        const list: StoreSummary[] = snap.docs.map((d) => {
          const data = d.data() as {
            name: string;
            address?: string;
            photoUrls?: string[];
            lat?: number;
            lng?: number;
          };
          return {
            id: d.id,
            name: data.name,
            address: data.address,
            photoUrl: data.photoUrls?.[0],
            lat: data.lat,
            lng: data.lng,
          };
        });
        setStores(list);
        list.forEach((s) => trackImpressionOnce(s.id, 'discover-map'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(setSessions, () => {});
    return unsub;
  }, []);

  const liveCountByStore = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sessions) map[s.storeId] = (map[s.storeId] || 0) + 1;
    return map;
  }, [sessions]);

  // 10km 반경 매장만 + 거리 정렬 (사용자 위치 없으면 전체)
  const NEARBY_RADIUS_M = 10_000;
  const nearbyStores = useMemo(() => {
    const withCoords = stores.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
    if (!userLocation) return withCoords;
    return withCoords
      .map((s) => ({ ...s, _dist: haversineMeters(userLocation, { lat: s.lat!, lng: s.lng! }) }))
      .filter((s) => s._dist <= NEARBY_RADIUS_M)
      .sort((a, b) => a._dist - b._dist);
  }, [stores, userLocation]);

  // 사용자 위치 잡히고 selectedId 없으면 가장 가까운 매장 자동 선택
  useEffect(() => {
    if (selectedId || !userLocation || nearbyStores.length === 0) return;
    setSelectedId(nearbyStores[0].id);
  }, [userLocation, nearbyStores, selectedId]);

  const totalLive = Object.values(liveCountByStore).reduce((a, b) => a + b, 0);
  const selected = stores.find((s) => s.id === selectedId);
  const selectedLiveCount = selected ? liveCountByStore[selected.id] || 0 : 0;
  const selectedDist = selected && userLocation && typeof selected.lat === 'number' && typeof selected.lng === 'number'
    ? haversineMeters(userLocation, { lat: selected.lat, lng: selected.lng })
    : null;

  // 좌표 없는 매장은 즉시 geocoding (1회). 결과를 Firestore에 캐시.
  useEffect(() => {
    const needsGeocode = stores.filter((s) => s.address && (s.lat == null || s.lng == null));
    if (needsGeocode.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const s of needsGeocode) {
        if (cancelled) return;
        try {
          const coords = await geocodeAddress(s.address!);
          if (!coords) continue;
          // Firestore에 저장 (다음 번부터 즉시 사용)
          updateDoc(doc(db, 'stores', s.id), { lat: coords.lat, lng: coords.lng }).catch(() => {
            // owner 아닌 경우 권한 없음 — 메모리에만 반영
          });
          // 로컬 state도 즉시 업데이트
          setStores((prev) => prev.map((x) => (x.id === s.id ? { ...x, lat: coords.lat, lng: coords.lng } : x)));
        } catch {
          // skip
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stores]);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      {/* 상단 헤더 */}
      <div className="px-5 h-14 flex items-center justify-between border-b border-gray-100 bg-white">
        <span className="text-xl font-extrabold tracking-tight font-serif">탐색</span>
        <Link href="/m/search" className="text-lg" title="검색">
          🔍
        </Link>
      </div>

      <div className="flex-1 relative">
        {/* 카카오맵 — 10km 반경 안 매장만 마커, 사용자 반경 500m 원 오버레이 */}
        <KakaoMap
          stores={nearbyStores}
          liveCountByStore={liveCountByStore}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onError={setMapError}
          userLocation={userLocation}
          locationDenied={locationDenied}
        />

        {/* 상단 정보 카드 */}
        <div className="absolute top-3 left-3 right-3 bg-white/95 backdrop-blur rounded-xl px-4 py-3 flex items-center justify-between shadow-md z-30 pointer-events-none">
          <div>
            <div className="text-[11px] text-gray-500">
              {userLocation ? '내 주변 매장 · 10km' : locationDenied ? '서면 중심' : '위치 확인 중…'}
            </div>
            <div className="text-sm font-bold text-gray-900 mt-0.5">{nearbyStores.length}개</div>
          </div>
          {totalLive > 0 ? (
            <div className="bg-red-50 text-red-600 rounded-xl px-3 py-1.5 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-extrabold">LIVE {totalLive}</span>
            </div>
          ) : (
            <div className="text-xs text-gray-500">LIVE 없음</div>
          )}
        </div>

        {mapError && (
          <div className="absolute top-20 left-3 right-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 z-30">
            <b>지도 로드 실패:</b> {mapError}
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 pointer-events-none">
            로딩 중…
          </div>
        )}

        {/* 하단 선택 매장 카드 */}
        {selected && (
          <button
            onClick={() => {
              bumpStoreMetric(selected.id, 'cardClicks');
              router.push(`/m/store/${selected.id}`);
            }}
            className="absolute bottom-3 left-3 right-3 bg-white rounded-2xl p-3 shadow-lg flex items-center gap-3 text-left z-30 active:scale-[0.98] transition"
          >
            <div
              className="w-16 h-16 rounded-xl flex-shrink-0 bg-gray-200 overflow-hidden"
              style={
                selected.photoUrl
                  ? undefined
                  : { background: 'linear-gradient(135deg, #C9B49A 0%, #A8927A 100%)' }
              }
            >
              {selected.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.photoUrl} alt={selected.name} className="w-full h-full object-cover" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="text-sm font-bold text-gray-900 truncate">{selected.name}</div>
                {selectedLiveCount > 0 && (
                  <div className="inline-flex items-center gap-1 bg-red-50 text-red-600 rounded-md px-1.5 py-0.5">
                    <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[9px] font-extrabold">
                      LIVE{selectedLiveCount > 1 ? ` ${selectedLiveCount}` : ''}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-500 truncate">
                {selectedDist != null && (
                  <span className="font-bold text-gray-700 flex-shrink-0">
                    {formatDistance(selectedDist)}
                  </span>
                )}
                {selected.address && <span className="truncate">📍 {selected.address}</span>}
              </div>
            </div>
            <span className="text-xl text-gray-400">›</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 카카오맵 인스턴스 + 매장 마커 관리.
 * SDK는 layout.tsx에서 로드됨. 여기서는 load()만 기다리고 지도 인스턴스 생성.
 */
function KakaoMap({
  stores,
  liveCountByStore,
  selectedId,
  onSelect,
  onError,
  userLocation,
  locationDenied,
}: {
  stores: StoreSummary[];
  liveCountByStore: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onError: (msg: string | null) => void;
  userLocation: LatLng | null;
  locationDenied: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const userMarkerRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const centeredRef = useRef(false);
  // 지도 인스턴스 생성 완료 신호 — async 초기화 후 false→true. 마커 effect가 이걸 기다림.
  const [mapReady, setMapReady] = useState(false);

  // 지도 초기화 — 위치 권한 결정될 때까지 대기, 깜박임 없이 정확한 중심으로 시작.
  useEffect(() => {
    if (!userLocation && !locationDenied) return; // 위치 결정 대기
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadKakaoMaps();
        if (cancelled || !containerRef.current || mapRef.current) return;
        const center = userLocation
          ? new maps.LatLng(userLocation.lat, userLocation.lng)
          : new maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
        mapRef.current = new maps.Map(containerRef.current, {
          center,
          // 250m 반경 원이 viewport에 적당히 들어갈 줌. 너무 가까우면 매장 마커 가려짐.
          level: 4,
        });
        centeredRef.current = true;
        setMapReady(true);
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError, userLocation, locationDenied]);

  // 사용자 위치 마커 + 250m 반경 원 — 지도 준비 + 위치 둘 다 갖춰지면 생성/갱신.
  useEffect(() => {
    if (!mapReady || !userLocation || !mapRef.current) return;
    const maps = window.kakao?.maps;
    if (!maps) return;
    const pos = new maps.LatLng(userLocation.lat, userLocation.lng);

    // 파란 점 마커
    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition(pos);
    } else {
      userMarkerRef.current = new maps.Marker({
        position: pos,
        map: mapRef.current,
        image: buildUserMarker(maps),
        zIndex: 30,
      });
    }

    // 250m 반경 원 (도보 가능 범위)
    if (radiusCircleRef.current) {
      radiusCircleRef.current.setPosition(pos);
    } else {
      radiusCircleRef.current = new maps.Circle({
        center: pos,
        radius: 250,
        strokeWeight: 2,
        strokeColor: '#3B82F6',
        strokeOpacity: 0.6,
        strokeStyle: 'solid',
        fillColor: '#60A5FA',
        fillOpacity: 0.12,
      });
      radiusCircleRef.current.setMap(mapRef.current);
    }
  }, [mapReady, userLocation]);

  // 매장 마커 동기화
  useEffect(() => {
    if (!mapRef.current) {
      // 지도 아직 안 떴으면 100ms 후 재시도 (1회만)
      const t = setTimeout(() => {
        // 의도적으로 빈 effect — deps 바뀌면 다시 실행됨
      }, 100);
      return () => clearTimeout(t);
    }
    const maps = window.kakao?.maps;
    if (!maps) return;

    const validStores = stores.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
    const seen = new Set<string>();

    for (const s of validStores) {
      seen.add(s.id);
      const live = liveCountByStore[s.id] || 0;
      const isSelected = s.id === selectedId;
      const pos = new maps.LatLng(s.lat!, s.lng!);

      // 이미 마커가 있으면 위치만 갱신
      const existing = markersRef.current.get(s.id);
      if (existing) {
        existing.setPosition(pos);
        existing.setImage(buildMarkerImage(maps, { live, selected: isSelected }));
        continue;
      }

      const marker = new maps.Marker({
        position: pos,
        map: mapRef.current,
        title: s.name,
        image: buildMarkerImage(maps, { live, selected: isSelected }),
        zIndex: live > 0 ? 20 : isSelected ? 25 : 10,
      });
      maps.event.addListener(marker, 'click', () => onSelect(s.id));
      markersRef.current.set(s.id, marker);
    }

    // 제거된 매장의 마커 정리
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    }

    // 자동 bounds 조정은 제거 — 지도는 사용자 위치(또는 기본 서면)에서 시작하므로
    // 마커들이 viewport 밖에 있으면 사용자가 직접 줌 아웃/팬해서 봄.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, liveCountByStore, selectedId, onSelect]);

  // 선택 매장으로 중심 이동
  useEffect(() => {
    if (!mapRef.current || !selectedId) return;
    const target = stores.find((s) => s.id === selectedId);
    if (!target || target.lat == null || target.lng == null) return;
    const maps = window.kakao?.maps;
    if (!maps) return;
    mapRef.current.panTo(new maps.LatLng(target.lat, target.lng));
  }, [selectedId, stores]);

  return <div ref={containerRef} className="w-full h-full" />;
}

/** 마커 이미지 HTML overlay 대신 SVG 마커 — LIVE/일반/선택 3가지 상태 */
function buildMarkerImage(maps: any, opts: { live: number; selected: boolean }) {
  const { live, selected } = opts;
  let svg: string;
  let size: { w: number; h: number };
  let anchor: { x: number; y: number };

  if (live > 0) {
    // LIVE 진행 중 — 빨간 알약
    const label = live > 1 ? `LIVE ${live}` : 'LIVE';
    const width = label.length * 8 + 16;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28">
      <rect x="0" y="0" width="${width}" height="24" rx="12" fill="#D94B3D" stroke="${selected ? '#000' : 'none'}" stroke-width="${selected ? 2 : 0}"/>
      <circle cx="10" cy="12" r="3" fill="#fff"/>
      <text x="${width / 2 + 4}" y="16" fill="#fff" font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="800" text-anchor="middle">${label}</text>
      <polygon points="${width / 2 - 4},24 ${width / 2 + 4},24 ${width / 2},28" fill="#D94B3D"/>
    </svg>`;
    size = { w: width, h: 28 };
    anchor = { x: width / 2, y: 28 };
  } else {
    // 일반 매장 — 작은 점
    const r = selected ? 12 : 8;
    const stroke = selected ? '#000' : '#333';
    const fill = selected ? '#fff' : '#fff';
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r * 2 + 4}" height="${r * 2 + 4}" viewBox="0 0 ${r * 2 + 4} ${r * 2 + 4}">
      <circle cx="${r + 2}" cy="${r + 2}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${selected ? 2.5 : 2}"/>
    </svg>`;
    size = { w: r * 2 + 4, h: r * 2 + 4 };
    anchor = { x: r + 2, y: r + 2 };
  }

  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(size.w, size.h), {
    offset: new maps.Point(anchor.x, anchor.y),
  });
}

/** 사용자 현재 위치 마커 — 파란 점 + 흰 외곽 + 펄스 halo */
function buildUserMarker(maps: any) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="16" fill="#3B82F6" opacity="0.15">
      <animate attributeName="r" values="10;16;10" dur="2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.3;0.05;0.3" dur="2s" repeatCount="indefinite"/>
    </circle>
    <circle cx="18" cy="18" r="7" fill="#fff"/>
    <circle cx="18" cy="18" r="5" fill="#2563EB"/>
  </svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(36, 36), {
    offset: new maps.Point(18, 18),
  });
}

/** 두 좌표 사이 거리 (미터, Haversine). 빠른 근사용. */
function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** 거리 사람 친화적 포맷 */
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters / 1000)}km`;
}
