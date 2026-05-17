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

interface NearbyStore extends StoreSummary {
  _dist?: number;
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
  const [sheetOpen, setSheetOpen] = useState(false);
  // 지도 인스턴스 ref — handleUserSelect의 panTo가 KakaoMap 내부 ref를 공유해서 호출.
  const mapInstanceRef = useRef<any>(null);

  // 현재 위치
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      // browser API 부재는 사실상 발생 안 함('use client'). 비동기로 미뤄서 effect 동기 setState 회피.
      const tid = setTimeout(() => setLocationDenied(true), 0);
      return () => clearTimeout(tid);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationDenied(true),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  // 매장 데이터
  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, 'stores'))
      .then((snap) => {
        if (cancelled) return;
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
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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

  // 10km 반경 + 거리 정렬. LIVE 진행 중 매장은 거리와 무관하게 항상 포함 (핵심 기능).
  const NEARBY_RADIUS_M = 10_000;
  const nearbyStores = useMemo<NearbyStore[]>(() => {
    const withCoords = stores.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
    if (!userLocation) return withCoords;
    return withCoords
      .map((s) => ({ ...s, _dist: haversineMeters(userLocation, { lat: s.lat!, lng: s.lng! }) }))
      .filter((s) => (s._dist as number) <= NEARBY_RADIUS_M || (liveCountByStore[s.id] ?? 0) > 0)
      .sort((a, b) => (a._dist as number) - (b._dist as number));
  }, [stores, userLocation, liveCountByStore]);

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
          updateDoc(doc(db, 'stores', s.id), { lat: coords.lat, lng: coords.lng }).catch(() => {});
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

  // 사용자 직접 선택 (마커 클릭) — panTo + selectedId 갱신.
  // 자동 선택은 하지 않음 — 지도 중심을 사용자 위치에 유지하기 위함.
  const handleUserSelect = (id: string) => {
    setSelectedId(id);
    const target = stores.find((s) => s.id === id);
    if (!target || target.lat == null || target.lng == null) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (mapInstanceRef.current && maps) {
      mapInstanceRef.current.panTo(new maps.LatLng(target.lat, target.lng));
    }
  };

  const handleSheetItemClick = (id: string) => {
    setSheetOpen(false);
    bumpStoreMetric(id, 'cardClicks');
    router.push(`/m/store/${id}`);
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      <div className="px-5 h-14 flex items-center justify-between border-b border-gray-100 bg-white">
        <span className="text-xl font-extrabold tracking-tight font-serif">탐색</span>
        <Link href="/m/search" className="text-lg" title="검색">
          🔍
        </Link>
      </div>

      <div className="flex-1 relative">
        <KakaoMap
          stores={nearbyStores}
          liveCountByStore={liveCountByStore}
          selectedId={selectedId}
          onSelect={handleUserSelect}
          onError={setMapError}
          userLocation={userLocation}
          locationDenied={locationDenied}
          mapInstanceRef={mapInstanceRef}
        />

        {/* 상단 — 터치 가능 버튼. 누르면 거리순 리스트 시트가 열림 */}
        <button
          onClick={() => setSheetOpen(true)}
          disabled={nearbyStores.length === 0}
          className="absolute top-3 left-3 right-3 bg-white/95 backdrop-blur rounded-xl px-4 py-3 flex items-center justify-between shadow-md z-30 text-left active:scale-[0.98] transition disabled:opacity-60 disabled:active:scale-100"
        >
          <div>
            <div className="text-[11px] text-gray-500">
              {userLocation ? '내 주변 매장 · 10km' : locationDenied ? '서면 중심' : '위치 확인 중…'}
            </div>
            <div className="text-sm font-bold text-gray-900 mt-0.5 flex items-center gap-1.5">
              <span>{nearbyStores.length}개</span>
              {nearbyStores.length > 0 && (
                <span className="text-gray-400 text-[11px] font-normal">전체보기 ›</span>
              )}
            </div>
          </div>
          {totalLive > 0 ? (
            <div className="bg-red-50 text-red-600 rounded-xl px-3 py-1.5 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-extrabold">LIVE {totalLive}</span>
            </div>
          ) : (
            <div className="text-xs text-gray-500">LIVE 없음</div>
          )}
        </button>

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

        {/* 하단 선택 매장 카드 — 사용자가 마커/시트에서 선택해야 표시 */}
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

        {sheetOpen && (
          <NearbyStoresSheet
            stores={nearbyStores}
            liveCountByStore={liveCountByStore}
            onClose={() => setSheetOpen(false)}
            onItemClick={handleSheetItemClick}
          />
        )}
      </div>
    </div>
  );
}

/** 내 주변 매장 거리순 리스트 시트 — 상단 카운트 버튼이 트리거. row 터치 시 매장 페이지 이동. */
function NearbyStoresSheet({
  stores,
  liveCountByStore,
  onClose,
  onItemClick,
}: {
  stores: NearbyStore[];
  liveCountByStore: Record<string, number>;
  onClose: () => void;
  onItemClick: (id: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative bg-white rounded-t-2xl shadow-2xl max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <div>
            <div className="text-[11px] text-gray-500">내 주변 매장 · 10km · 거리순</div>
            <div className="text-base font-extrabold text-gray-900">{stores.length}개</div>
          </div>
          <button
            onClick={onClose}
            className="text-2xl text-gray-400 leading-none px-2"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
          {stores.map((s) => {
            const live = liveCountByStore[s.id] || 0;
            return (
              <button
                key={s.id}
                onClick={() => onItemClick(s.id)}
                className="w-full flex items-center gap-3 px-5 py-3 text-left active:bg-gray-50"
              >
                <div
                  className="w-12 h-12 rounded-xl flex-shrink-0 bg-gray-200 overflow-hidden"
                  style={
                    s.photoUrl
                      ? undefined
                      : { background: 'linear-gradient(135deg, #C9B49A 0%, #A8927A 100%)' }
                  }
                >
                  {s.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photoUrl} alt={s.name} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="text-sm font-bold text-gray-900 truncate">{s.name}</div>
                    {live > 0 && (
                      <div className="inline-flex items-center gap-1 bg-red-50 text-red-600 rounded-md px-1.5 py-0.5">
                        <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[9px] font-extrabold">
                          LIVE{live > 1 ? ` ${live}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500 truncate mt-0.5">
                    {s._dist != null && (
                      <span className="font-bold text-gray-700 flex-shrink-0">
                        {formatDistance(s._dist)}
                      </span>
                    )}
                    {s.address && <span className="truncate">📍 {s.address}</span>}
                  </div>
                </div>
                <span className="text-lg text-gray-400">›</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KakaoMap({
  stores,
  liveCountByStore,
  selectedId,
  onSelect,
  onError,
  userLocation,
  locationDenied,
  mapInstanceRef,
}: {
  stores: StoreSummary[];
  liveCountByStore: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onError: (msg: string | null) => void;
  userLocation: LatLng | null;
  locationDenied: boolean;
  mapInstanceRef: React.MutableRefObject<any>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const userMarkerRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // 지도 초기화 — 위치 결정 후 사용자 위치 중심으로 시작
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
        setMapReady(true);
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError, userLocation, locationDenied, mapInstanceRef]);

  // 사용자 위치 마커 + 250m 반경 원
  useEffect(() => {
    if (!mapReady || !userLocation || !mapInstanceRef.current) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!maps) return;
    const pos = new maps.LatLng(userLocation.lat, userLocation.lng);
    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition(pos);
    } else {
      userMarkerRef.current = new maps.Marker({
        position: pos,
        map: mapInstanceRef.current,
        image: buildUserMarker(maps),
        zIndex: 30,
      });
    }
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
      radiusCircleRef.current.setMap(mapInstanceRef.current);
    }
  }, [mapReady, userLocation, mapInstanceRef]);

  // 매장 마커 동기화
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!maps) return;

    const validStores = stores.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
    const seen = new Set<string>();

    for (const s of validStores) {
      seen.add(s.id);
      const live = liveCountByStore[s.id] || 0;
      const isSelected = s.id === selectedId;
      const pos = new maps.LatLng(s.lat!, s.lng!);

      const existing = markersRef.current.get(s.id);
      if (existing) {
        existing.setPosition(pos);
        existing.setImage(buildMarkerImage(maps, { live, selected: isSelected }));
        continue;
      }

      const marker = new maps.Marker({
        position: pos,
        map: mapInstanceRef.current,
        title: s.name,
        image: buildMarkerImage(maps, { live, selected: isSelected }),
        zIndex: live > 0 ? 20 : isSelected ? 25 : 10,
      });
      maps.event.addListener(marker, 'click', () => onSelect(s.id));
      markersRef.current.set(s.id, marker);
    }

    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    }
  }, [stores, liveCountByStore, selectedId, onSelect, mapInstanceRef]);

  return <div ref={containerRef} className="w-full h-full" />;
}

/**
 * 마커 이미지.
 * LIVE 진행 중 → 빨간 알약 (눈에 띄게).
 * 일반 홀덤펍 → 다크 핀(표준 location pin) + 흰 원 안에 ♠ 스페이드. 선택 시 골드.
 * 사이즈는 선택/비선택 통일(28x38) — 색상으로만 강조.
 */
function buildMarkerImage(maps: any, opts: { live: number; selected: boolean }) {
  const { live, selected } = opts;

  if (live > 0) {
    const label = live > 1 ? `LIVE ${live}` : 'LIVE';
    const width = label.length * 8 + 16;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28"><rect x="0" y="0" width="${width}" height="24" rx="12" fill="#D94B3D" stroke="${selected ? '#000' : 'none'}" stroke-width="${selected ? 2 : 0}"/><circle cx="10" cy="12" r="3" fill="#fff"/><text x="${width / 2 + 4}" y="16" fill="#fff" font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="800" text-anchor="middle">${label}</text><polygon points="${width / 2 - 4},24 ${width / 2 + 4},24 ${width / 2},28" fill="#D94B3D"/></svg>`;
    const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    return new maps.MarkerImage(url, new maps.Size(width, 28), {
      offset: new maps.Point(width / 2, 28),
    });
  }

  // 표준 location pin — 단순/검증된 path. 사이즈 28x38 통일, 색상으로 선택 강조.
  const fill = selected ? '#D97706' : '#1F2937';
  const stroke = selected ? '#7C2D12' : '#0F172A';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38"><path d="M14 37 C14 37 26 22 26 13 C26 6.4 20.6 1 14 1 C7.4 1 2 6.4 2 13 C2 22 14 37 14 37 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><circle cx="14" cy="13" r="6" fill="#fff"/><text x="14" y="17" text-anchor="middle" font-size="11" font-weight="800" fill="${fill}" font-family="Arial,sans-serif">♠</text></svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(28, 38), {
    offset: new maps.Point(14, 37),
  });
}

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

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters / 1000)}km`;
}
