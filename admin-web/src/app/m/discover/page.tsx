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

  const totalLive = Object.values(liveCountByStore).reduce((a, b) => a + b, 0);
  const selected = stores.find((s) => s.id === selectedId);
  const selectedLiveCount = selected ? liveCountByStore[selected.id] || 0 : 0;

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
        {/* 카카오맵 */}
        <KakaoMap
          stores={stores}
          liveCountByStore={liveCountByStore}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onError={setMapError}
        />

        {/* 상단 정보 카드 */}
        <div className="absolute top-3 left-3 right-3 bg-white/95 backdrop-blur rounded-xl px-4 py-3 flex items-center justify-between shadow-md z-30 pointer-events-none">
          <div>
            <div className="text-[11px] text-gray-500">전체 매장</div>
            <div className="text-sm font-bold text-gray-900 mt-0.5">{stores.length}개</div>
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
              {selected.address && (
                <div className="text-[11px] text-gray-500 truncate">📍 {selected.address}</div>
              )}
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
}: {
  stores: StoreSummary[];
  liveCountByStore: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onError: (msg: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());

  // 지도 초기화
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadKakaoMaps();
        if (cancelled || !containerRef.current) return;
        mapRef.current = new maps.Map(containerRef.current, {
          center: new maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
          level: 6,
        });
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

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

    // 최초 1회 viewport 자동 조정
    if (validStores.length > 0 && mapRef.current) {
      const bounds = new maps.LatLngBounds();
      validStores.forEach((s) => bounds.extend(new maps.LatLng(s.lat!, s.lng!)));
      // 한 곳만 있으면 너무 줌인되니 최소 레벨 유지
      if (validStores.length === 1) {
        mapRef.current.setCenter(new maps.LatLng(validStores[0].lat!, validStores[0].lng!));
      } else {
        mapRef.current.setBounds(bounds);
      }
    }
    // bounds는 매번 다시 계산하면 사용자가 줌·팬한 게 리셋됨.
    // 의도적으로 최초 1회만 — stores.length 변화에만 반응하도록 deps 좁힘.
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
