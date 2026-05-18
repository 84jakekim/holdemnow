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

/** "내 주변" 매장 필터링 반경 (미터). 지도 원 오버레이의 최대 반경과 동기화.
 *  단일 source of truth — 시각적 원 / 시트 카운트 / 정렬 모두 이 값 기준. */
const NEARBY_RADIUS_M = 10_000;

/** 카카오 맵 줌 레벨(1=가장 확대, 14=가장 축소)에 맞춰 시각적으로 적절한 원 반경(m) 산출.
 *  최대는 NEARBY_RADIUS_M(=매장 필터링 반경)이라 줌 아웃하면 정확히 검색 범위가 보임.
 *  줌인 시엔 원이 화면 안에 들어오도록 작은 반경을 사용. */
function radiusForZoomLevel(level: number): number {
  if (level <= 2) return 250;
  if (level === 3) return 500;
  if (level === 4) return 1000;
  if (level === 5) return 2000;
  if (level === 6) return 3500;
  if (level === 7) return 5000;
  if (level === 8) return 7500;
  return NEARBY_RADIUS_M;
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
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const tid = setTimeout(() => setLocationDenied(true), 0);
      return () => clearTimeout(tid);
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationDenied(true),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, 'stores'))
      .then((snap) => {
        if (cancelled) return;
        setStores(snap.docs.map((d) => {
          const data = d.data() as { name: string; address?: string; photoUrls?: string[]; lat?: number; lng?: number };
          return { id: d.id, name: data.name, address: data.address, photoUrl: data.photoUrls?.[0], lat: data.lat, lng: data.lng };
        }));
        snap.docs.forEach((d) => trackImpressionOnce(d.id, 'discover-map'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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

  // 지도 마커용 — 좌표 있는 전체 매장. 사용자가 줌 아웃하면 부산·양산·김해 모두 보임.
  // 클러스터러가 줌 레벨에 따라 자동 그룹화하므로 수천개 대응 OK.
  const storesWithCoords = useMemo<StoreSummary[]>(() => {
    return stores.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
  }, [stores]);

  // 시트·상단 카운트용 — NEARBY_RADIUS_M 반경 + 거리 정렬. LIVE 매장은 거리 무관 항상 포함.
  const nearbyStores = useMemo<NearbyStore[]>(() => {
    if (!userLocation) return storesWithCoords;
    return storesWithCoords
      .map((s) => ({ ...s, _dist: haversineMeters(userLocation, { lat: s.lat!, lng: s.lng! }) }))
      .filter((s) => (s._dist as number) <= NEARBY_RADIUS_M || (liveCountByStore[s.id] ?? 0) > 0)
      .sort((a, b) => (a._dist as number) - (b._dist as number));
  }, [storesWithCoords, userLocation, liveCountByStore]);

  const totalLive = Object.values(liveCountByStore).reduce((a, b) => a + b, 0);
  const selected = stores.find((s) => s.id === selectedId);
  const selectedLiveCount = selected ? liveCountByStore[selected.id] || 0 : 0;
  const selectedDist =
    selected && userLocation && typeof selected.lat === 'number' && typeof selected.lng === 'number'
      ? haversineMeters(userLocation, { lat: selected.lat, lng: selected.lng })
      : null;

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
          setStores((prev) => prev.map((x) => x.id === s.id ? { ...x, lat: coords.lat, lng: coords.lng } : x));
        } catch { /* skip */ }
      }
    })();
    return () => { cancelled = true; };
  }, [stores]);

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
    handleUserSelect(id);
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 68px)', background: 'var(--bg)' }}>

      {/* ── 헤더 — 라이트 ─────────────────────────────────── */}
      <header
        className="px-5 h-14 flex items-center justify-between flex-shrink-0"
        style={{
          background: 'rgba(255,255,255,0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span className="text-[18px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          지도 탐색
        </span>
        <Link href="/m/search" aria-label="검색">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-2)' }}>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </Link>
      </header>

      {/* ── 지도 영역 ───────────────────────────────────────── */}
      <div className="flex-1 relative">
        <KakaoMap
          stores={storesWithCoords}
          liveCountByStore={liveCountByStore}
          selectedId={selectedId}
          onSelect={handleUserSelect}
          onError={setMapError}
          userLocation={userLocation}
          locationDenied={locationDenied}
          mapInstanceRef={mapInstanceRef}
        />

        {/* ── 상단 카운트 버튼 — 라이트 카드 ──────────────── */}
        <button
          onClick={() => setSheetOpen(true)}
          disabled={nearbyStores.length === 0}
          className="absolute top-3 left-3 right-3 z-30 text-left transition active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
          style={{
            background: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {userLocation ? '내 주변 매장 · 거리순' : locationDenied ? '서면 중심' : '위치 확인 중…'}
            </div>
            <div className="text-[14px] font-bold mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
              <span>매장 {nearbyStores.length}개</span>
              {nearbyStores.length > 0 && (
                <span className="text-[12px] font-normal" style={{ color: 'var(--text-3)' }}>전체 목록 ›</span>
              )}
            </div>
          </div>

          {totalLive > 0 ? (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
              style={{ background: 'rgba(229,62,62,0.08)', border: '1px solid rgba(229,62,62,0.25)' }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0 pulse-live" style={{ background: 'var(--live)' }} />
              <span className="text-[12px] font-extrabold" style={{ color: 'var(--live)' }}>LIVE {totalLive}</span>
            </div>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>LIVE 없음</span>
          )}
        </button>

        {/* 지도 로드 실패 시 — 안내 + 시트 열기 유도 (지도 없이도 매장 탐색 가능) */}
        {mapError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20 px-8 text-center" style={{ background: 'var(--bg-sub)' }}>
            <div className="text-4xl mb-3" aria-hidden="true">🗺️</div>
            <div className="text-[15px] font-bold mb-2" style={{ color: 'var(--text-1)' }}>
              지도가 일시적으로 표시되지 않습니다
            </div>
            <div className="text-[12px] leading-relaxed mb-5" style={{ color: 'var(--text-3)' }}>
              매장 목록은 정상 사용 가능합니다.
            </div>
            <button
              onClick={() => setSheetOpen(true)}
              className="px-5 h-11 rounded-2xl text-[13px] font-extrabold text-white"
              style={{ background: 'var(--brand)' }}
            >
              내 주변 매장 목록 보기
            </button>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none" style={{ color: 'var(--text-3)' }}>
            로딩 중…
          </div>
        )}

        {/* ── 하단 선택 매장 카드 — 라이트 ───────────────── */}
        {selected && (
          <button
            onClick={() => { bumpStoreMetric(selected.id, 'cardClicks'); router.push(`/m/store/${selected.id}`); }}
            className="absolute bottom-3 left-3 right-3 z-30 flex items-center gap-3 text-left transition active:scale-[0.98]"
            style={{
              background: 'rgba(255,255,255,0.97)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-xl)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              padding: '12px',
            }}
          >
            {/* 썸네일 */}
            <div
              className="w-[60px] h-[60px] rounded-xl flex-shrink-0 overflow-hidden"
              style={{ background: 'var(--surface-2)' }}
            >
              {selected.photoUrl && (
                <img src={selected.photoUrl} alt={selected.name} className="w-full h-full object-cover" />
              )}
            </div>
            {/* 정보 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{selected.name}</div>
                {selectedLiveCount > 0 && (
                  <span className="badge-live flex-shrink-0">
                    <span className="dot" />
                    LIVE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[12px] truncate" style={{ color: 'var(--text-3)' }}>
                {selectedDist != null && (
                  <span className="font-semibold flex-shrink-0" style={{ color: 'var(--text-2)' }}>
                    {formatDistance(selectedDist)}
                  </span>
                )}
                {selected.address && <span className="truncate">{selected.address}</span>}
              </div>
            </div>
            {/* 상세보기 화살표 */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--brand)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </button>
        )}

        {/* 매장 목록 시트 */}
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

/* ============================================================
 * 매장 목록 바텀 시트 — 라이트
 * ========================================================== */
function NearbyStoresSheet({
  stores, liveCountByStore, onClose, onItemClick,
}: {
  stores: NearbyStore[];
  liveCountByStore: Record<string, number>;
  onClose: () => void;
  onItemClick: (id: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button aria-label="닫기" onClick={onClose} className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.30)' }} />
      <div
        className="relative flex flex-col"
        style={{
          background: 'var(--surface-1)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: '75vh',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
        }}
      >
        {/* 핸들 */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--surface-3)' }} />
        </div>

        <div
          className="flex items-center justify-between px-5 pb-3 pt-2"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>내 주변 매장 · 거리순</div>
            <div className="text-[16px] font-extrabold" style={{ color: 'var(--text-1)' }}>{stores.length}개</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition active:scale-90"
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 18 }}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {stores.map((s) => {
            const live = liveCountByStore[s.id] || 0;
            return (
              <button
                key={s.id}
                onClick={() => onItemClick(s.id)}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition active:bg-gray-50"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                {/* 썸네일 */}
                <div
                  className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden"
                  style={{ background: 'var(--surface-2)' }}
                >
                  {s.photoUrl && <img src={s.photoUrl} alt={s.name} className="w-full h-full object-cover" />}
                </div>
                {/* 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{s.name}</span>
                    {live > 0 && (
                      <span className="badge-live flex-shrink-0">
                        <span className="dot" />
                        LIVE
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {s._dist != null && (
                      <span className="font-semibold flex-shrink-0" style={{ color: 'var(--text-2)' }}>{formatDistance(s._dist)}</span>
                    )}
                    {s.address && <span className="truncate">{s.address}</span>}
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', flexShrink: 0 }}>
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Kakao 지도 — 마커 로직 그대로 유지, 클러스터 스타일만 라이트로
 * ========================================================== */
function KakaoMap({
  stores, liveCountByStore, selectedId, onSelect, onError, userLocation, locationDenied, mapInstanceRef,
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
        // MarkerClusterer는 카카오 SDK `libraries=clusterer` 옵션이 있을 때만 존재.
        // 없으면 fallback — 모든 매장 마커를 그대로 표시 (클러스터링 X).
        if (maps.MarkerClusterer) {
          clustererRef.current = new maps.MarkerClusterer({
            map: mapInstanceRef.current,
            averageCenter: true,
            minLevel: 6,
            gridSize: 80,
            disableClickZoom: false,
            calculator: [10, 30, 100, 300],
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

  // 줌 변경 시 원 반경을 줌 레벨에 맞춰 갱신 — 매장 검색 범위(최대 NEARBY_RADIUS_M)의
  // 시각적 표현을 줌 인/아웃에 따라 자연스럽게 따라가게 함.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!maps) return;
    const map = mapInstanceRef.current;
    const onZoom = () => {
      if (!radiusCircleRef.current) return;
      radiusCircleRef.current.setRadius(radiusForZoomLevel(map.getLevel()));
    };
    maps.event.addListener(map, 'zoom_changed', onZoom);
    return () => {
      maps.event.removeListener(map, 'zoom_changed', onZoom);
    };
  }, [mapReady]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!maps) return;
    // clusterer가 없으면 직접 map에 마커 부착(fallback). 있으면 일반 마커는 clusterer 위탁.
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
        if (wasNormal) {
          if (clusterer) clusterer.removeMarker(wasNormal);
          else wasNormal.setMap(null);
          normalMarkersRef.current.delete(s.id);
        }
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
          const marker = new maps.Marker({
            position: pos,
            // clusterer 있으면 그쪽에서 표시 관리. 없으면 직접 map 붙임.
            map: clusterer ? undefined : mapInstanceRef.current,
            title: s.name,
            image,
            zIndex: isSelected ? 20 : 10,
          });
          maps.event.addListener(marker, 'click', () => onSelect(s.id));
          normalMarkersRef.current.set(s.id, marker);
          if (clusterer) newClusterMarkers.push(marker);
        }
      }
    }

    if (clusterer && newClusterMarkers.length > 0) clusterer.addMarkers(newClusterMarkers);

    for (const [id, m] of normalMarkersRef.current) {
      if (!seenNormal.has(id)) {
        if (clusterer) clusterer.removeMarker(m);
        else m.setMap(null);
        normalMarkersRef.current.delete(id);
      }
    }
    for (const [id, m] of liveMarkersRef.current) {
      if (!seenLive.has(id)) { m.setMap(null); liveMarkersRef.current.delete(id); }
    }
  }, [stores, liveCountByStore, selectedId, onSelect, mapInstanceRef]);

  return <div ref={containerRef} className="w-full h-full" />;
}

/* ── 마커 이미지 (캐시) ── */
const _markerImageCache = new Map<string, any>();
function getMarkerImage(maps: any, opts: { name: string; live: number; selected: boolean }) {
  const key = `${opts.live}|${opts.selected ? 's' : ''}|${opts.name}`;
  const cached = _markerImageCache.get(key);
  if (cached) return cached;
  const img = buildMarkerImage(maps, opts);
  _markerImageCache.set(key, img);
  return img;
}

function buildMarkerImage(maps: any, opts: { name: string; live: number; selected: boolean }) {
  const { name, live, selected } = opts;
  const PILL_H = 26;
  const TAIL_H = 7;
  const height = PILL_H + TAIL_H;
  const nameW = widthOf(name);
  const safeName = escapeSvg(name);

  if (live > 0) {
    const liveLabel = live > 1 ? `LIVE ${live}` : 'LIVE';
    const liveLabelW = liveLabel.length * 6;
    // ripple 원을 위해 상단 여유 공간 추가
    const RIPPLE_PAD = 10;
    const LEFT = 8, DOT = 6, G1 = 5, G2 = 8, RIGHT = 12;
    const pillWidth = LEFT + DOT + G1 + liveLabelW + G2 + nameW + RIGHT;
    const totalH = RIPPLE_PAD + PILL_H + TAIL_H;
    const cx = pillWidth / 2;
    const dotX = LEFT + DOT / 2;
    const liveX = LEFT + DOT + G1;
    const nameX = liveX + liveLabelW + G2;
    const fill = '#E53E3E';
    const stroke = selected ? '#7F1D1D' : '#C53030';
    const sw = selected ? 2 : 1;
    // SMIL ripple: 좌측 도트 기준으로 퍼지는 원형 파동
    const rDotCx = dotX;
    const rDotCy = RIPPLE_PAD + PILL_H / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillWidth}" height="${totalH}" viewBox="0 0 ${pillWidth} ${totalH}">
      <circle cx="${rDotCx}" cy="${rDotCy}" r="3" fill="#E53E3E" opacity="0.6">
        <animate attributeName="r" values="4;14;4" dur="1.6s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.55;0;0.55" dur="1.6s" repeatCount="indefinite"/>
      </circle>
      <rect x="0.5" y="${RIPPLE_PAD + 0.5}" width="${pillWidth-1}" height="${PILL_H-1}" rx="${PILL_H/2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
      <circle cx="${dotX}" cy="${RIPPLE_PAD + PILL_H/2}" r="${DOT/2}" fill="#fff"/>
      <text x="${liveX}" y="${RIPPLE_PAD + PILL_H/2+4}" fill="#fff" font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="800">${liveLabel}</text>
      <text x="${nameX}" y="${RIPPLE_PAD + PILL_H/2+5}" fill="#fff" font-family="Pretendard,Inter,system-ui,sans-serif" font-size="12" font-weight="800">${safeName}</text>
      <polygon points="${cx-6},${RIPPLE_PAD+PILL_H} ${cx+6},${RIPPLE_PAD+PILL_H} ${cx},${RIPPLE_PAD+PILL_H+TAIL_H}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
    </svg>`;
    const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    return new maps.MarkerImage(url, new maps.Size(pillWidth, totalH), { offset: new maps.Point(cx, totalH) });
  }

  const PAD = 14;
  const width = nameW + PAD * 2;
  const cx = width / 2;
  // 선택 시 핑크, 기본은 화이트 카드 (라이트 모드 지도에 맞게)
  const fill = selected ? '#FF1F8F' : '#FFFFFF';
  const textColor = selected ? '#fff' : '#111827';
  const stroke = selected ? '#CC1072' : '#E5E7EB';
  const sw = selected ? 2 : 1.5;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><filter id="s"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.12"/></filter><rect x="0.5" y="0.5" width="${width-1}" height="${PILL_H-1}" rx="${PILL_H/2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" filter="url(#s)"/><text x="${cx}" y="${PILL_H/2+5}" fill="${textColor}" font-family="Pretendard,Inter,system-ui,sans-serif" font-size="12" font-weight="800" text-anchor="middle">${safeName}</text><polygon points="${cx-6},${PILL_H} ${cx+6},${PILL_H} ${cx},${PILL_H+TAIL_H}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(width, height), { offset: new maps.Point(cx, height) });
}

function widthOf(s: string): number {
  return Array.from(s).reduce((sum, ch) => sum + (/[\x00-\x7F]/.test(ch) ? 7 : 12), 0);
}
function escapeSvg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 클러스터 스타일 — 라이트 + 핑크 테두리 */
function clusterStyles() {
  const base = {
    color: '#FF1F8F',
    textAlign: 'center' as const,
    fontWeight: '800' as const,
    fontFamily: 'Inter,system-ui,sans-serif',
    border: '2px solid #FF1F8F',
    background: '#FFFFFF',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  };
  return [
    { ...base, width: '36px', height: '36px', borderRadius: '18px', lineHeight: '32px', fontSize: '12px' },
    { ...base, width: '44px', height: '44px', borderRadius: '22px', lineHeight: '40px', fontSize: '13px' },
    { ...base, width: '52px', height: '52px', borderRadius: '26px', lineHeight: '48px', fontSize: '14px' },
    { ...base, width: '60px', height: '60px', borderRadius: '30px', lineHeight: '56px', fontSize: '15px' },
    { ...base, width: '72px', height: '72px', borderRadius: '36px', lineHeight: '68px', fontSize: '16px' },
  ];
}

/** 사용자 위치 마커 — 핑크 펄스 (라이트 지도에서도 잘 보임) */
function buildUserMarker(maps: any) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="16" fill="#FF1F8F" opacity="0.12">
      <animate attributeName="r" values="10;16;10" dur="2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.22;0.04;0.22" dur="2s" repeatCount="indefinite"/>
    </circle>
    <circle cx="18" cy="18" r="7" fill="#fff" filter="drop-shadow(0 1px 3px rgba(0,0,0,0.20))"/>
    <circle cx="18" cy="18" r="5" fill="#FF1F8F"/>
  </svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(36, 36), { offset: new maps.Point(18, 18) });
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters / 1000)}km`;
}
