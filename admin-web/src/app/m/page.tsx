'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession, fmtTime, useLiveCountdown } from '@/lib/live';
import { subscribeAllSeries, type Series } from '@/lib/series';
import { posterStyleFor } from '@/lib/templates';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { haversineMeters, formatDistance, type LatLng } from '@/lib/geo';

interface StoreGroup {
  storeId: string;
  storeName: string;
  sessions: LiveSession[];
}

interface StoreSummary {
  thumbnail?: string;
}

export default function MobileHome() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [storeSummaries, setStoreSummaries] = useState<Record<string, StoreSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(
      (items) => { setSessions(items); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); },
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeAllSeries(setSeries, () => {});
    return unsub;
  }, []);

  const groups: StoreGroup[] = useMemo(() => {
    const map: Record<string, StoreGroup> = {};
    for (const s of sessions) {
      if (!map[s.storeId]) map[s.storeId] = { storeId: s.storeId, storeName: s.storeName, sessions: [] };
      map[s.storeId].sessions.push(s);
    }
    return Object.values(map);
  }, [sessions]);

  useEffect(() => {
    const ids = groups.map((g) => g.storeId).filter((id) => !(id in storeSummaries));
    if (ids.length === 0) return;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'stores'), where(documentId(), 'in', ids.slice(0, 10))),
        );
        const next: Record<string, StoreSummary> = {};
        snap.forEach((d) => {
          const data = d.data() as { photoUrls?: string[] };
          next[d.id] = { thumbnail: data.photoUrls?.[0] };
        });
        setStoreSummaries((prev) => ({ ...prev, ...next }));
      } catch { /* ignore */ }
    })();
  }, [groups, storeSummaries]);

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── 상단 헤더 ────────────────────────────────────── */}
      <header
        className="px-5 h-14 flex items-center justify-between sticky top-0 z-10"
        style={{ background: 'rgba(13,17,23,0.92)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2.5">
          {/* 네온 핑크 펄스 도트 */}
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: 'var(--brand)', boxShadow: '0 0 8px var(--brand)' }}
            aria-hidden="true"
          />
          <span
            className="text-lg font-extrabold tracking-tight font-serif"
            style={{ color: 'var(--text-1)' }}
          >
            Holdem<span style={{ color: 'var(--brand)' }}>Now</span>
          </span>
        </div>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
        >
          BETA
        </span>
      </header>

      {/* ── 검색 ─────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3">
        <Link
          href="/m/search"
          className="flex items-center gap-2.5 px-4 h-11 rounded-xl text-sm transition active:scale-[0.98]"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-3)',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          매장·토너·시리즈 검색
        </Link>
      </div>

      {/* ── 지역 칩 ──────────────────────────────────────── */}
      <div className="px-4 pb-5 flex gap-2 overflow-x-auto scrollbar-none">
        {['부산 ▼', '서면', '해운대', '광안리', '동래', '양산'].map((r, i) => (
          <button
            key={r}
            className="px-4 py-1.5 rounded-full text-xs whitespace-nowrap flex-shrink-0 font-bold transition active:scale-[0.96]"
            style={
              i === 0
                ? { background: 'var(--brand)', color: '#fff', boxShadow: 'var(--shadow-brand)' }
                : { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }
            }
          >
            {r}
          </button>
        ))}
      </div>

      {/* ── 지금 LIVE ────────────────────────────────────── */}
      <section aria-label="지금 LIVE">
        <div className="px-4 pb-3 flex items-baseline justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 pulse-live"
              style={{ background: 'var(--live)' }}
              aria-hidden="true"
            />
            <span
              className="text-xl font-extrabold tracking-tight font-serif"
              style={{ color: 'var(--text-1)' }}
            >
              지금 LIVE
            </span>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>전체 →</span>
        </div>

        {loading ? (
          <LiveSkeleton />
        ) : error ? (
          <div
            className="mx-4 rounded-xl p-3 text-xs"
            style={{ background: 'rgba(229,62,62,0.12)', border: '1px solid rgba(229,62,62,0.30)', color: 'var(--live)' }}
          >
            {error}
          </div>
        ) : groups.length === 0 ? (
          <div
            className="mx-4 my-2 rounded-xl p-8 text-center text-sm"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
          >
            현재 진행 중인 LIVE가 없습니다
            <div className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
              어드민에서 LIVE 시작 시 즉시 표시됩니다
            </div>
          </div>
        ) : (
          <div className="pl-4 flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {groups.map((g) => (
              <StoreCard
                key={g.storeId}
                group={g}
                thumbnail={storeSummaries[g.storeId]?.thumbnail}
              />
            ))}
            <div className="w-2 flex-shrink-0" aria-hidden="true" />
          </div>
        )}
      </section>

      {/* ── 메이저 시리즈 ─────────────────────────────────── */}
      {series.length > 0 && (
        <section aria-label="메이저 시리즈" className="mt-6">
          <div className="px-4 pb-3 flex items-baseline justify-between">
            <span className="text-xl font-extrabold tracking-tight font-serif" style={{ color: 'var(--text-1)' }}>
              메이저 시리즈
            </span>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>전체 →</span>
          </div>
          <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
            {series.map((s) => <SeriesCard key={s.id} series={s} />)}
            <div className="w-2 flex-shrink-0" aria-hidden="true" />
          </div>
        </section>
      )}

      {/* ── 주변 매장 ─────────────────────────────────────── */}
      <NearbyStoresSection
        liveByStore={sessions.reduce<Record<string, number>>((acc, s) => {
          acc[s.storeId] = (acc[s.storeId] || 0) + 1;
          return acc;
        }, {})}
      />

      {/* ── 푸터 ──────────────────────────────────────────── */}
      <div
        className="px-4 py-8 mt-4 text-center text-[11px]"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--text-3)' }}
      >
        HoldemNow BETA · 부산/경남 홀덤펍 디스커버리
      </div>
    </div>
  );
}

/* ============================================================
 * 스켈레톤
 * ========================================================== */
function LiveSkeleton() {
  return (
    <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="w-[220px] flex-shrink-0 rounded-2xl overflow-hidden"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
        >
          <div className="skeleton h-44" />
          <div className="p-3 space-y-2">
            <div className="skeleton h-4 w-3/4 rounded" />
            <div className="skeleton h-3 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
 * 주변 매장 섹션
 * ========================================================== */
type NearbyViewMode = 'list' | 'large' | 'album';
const NEARBY_VIEW_STORAGE_KEY = 'hn-home-nearby-view';

interface NearbyStore {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
  facilities?: string[];
  tier?: string;
  lat?: number;
  lng?: number;
  distance?: number;
}

function NearbyStoresSection({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [viewMode, setViewMode] = useState<NearbyViewMode>('album');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(NEARBY_VIEW_STORAGE_KEY) as NearbyViewMode | null;
    if (saved === 'list' || saved === 'large' || saved === 'album') setViewMode(saved);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(NEARBY_VIEW_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    getDocs(collection(db, 'stores')).then((snap) => {
      setStores(snap.docs.map((d) => {
        const data = d.data() as {
          name: string; address?: string; photoUrls?: string[];
          facilities?: string[]; tier?: string; lat?: number; lng?: number;
        };
        return {
          id: d.id, name: data.name, address: data.address,
          photoUrl: data.photoUrls?.[0], facilities: data.facilities,
          tier: data.tier, lat: data.lat, lng: data.lng,
        };
      }));
    });
  }, []);

  const sorted = useMemo(() => {
    const withDist: NearbyStore[] = stores.map((s) => ({
      ...s,
      distance:
        userLocation && typeof s.lat === 'number' && typeof s.lng === 'number'
          ? haversineMeters(userLocation, { lat: s.lat, lng: s.lng })
          : undefined,
    }));
    return withDist.sort((a, b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      if (a.distance != null) return -1;
      if (b.distance != null) return 1;
      return 0;
    });
  }, [stores, userLocation]);

  if (stores.length === 0) return null;

  return (
    <section aria-label="주변 매장" className="mt-6">
      <div className="px-4 pb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-extrabold tracking-tight font-serif" style={{ color: 'var(--text-1)' }}>
            주변 매장
          </span>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>{stores.length}개</span>
        </div>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </div>

      {viewMode === 'album' ? (
        <div className="px-4 pb-2 grid grid-cols-2 gap-3">
          {sorted.map((st) => <NearbyStoreAlbumCard key={st.id} store={st} live={liveByStore[st.id] || 0} />)}
        </div>
      ) : viewMode === 'list' ? (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {sorted.map((st) => <NearbyStoreCompactRow key={st.id} store={st} live={liveByStore[st.id] || 0} />)}
        </div>
      ) : (
        <div className="px-4 pb-2 space-y-3">
          {sorted.map((st) => <NearbyStoreLargeCard key={st.id} store={st} live={liveByStore[st.id] || 0} />)}
        </div>
      )}
    </section>
  );
}

/* ── 뷰 모드 토글 ── */
function ViewModeToggle({ value, onChange }: { value: NearbyViewMode; onChange: (v: NearbyViewMode) => void }) {
  return (
    <div
      className="flex items-center gap-0.5 p-1 rounded-lg"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      {([
        ['list', '☰'],
        ['large', '☷'],
        ['album', '▦'],
      ] as [NearbyViewMode, string][]).map(([mode, icon]) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          aria-label={mode}
          className="w-7 h-7 rounded text-sm flex items-center justify-center transition"
          style={{
            background: value === mode ? 'var(--brand)' : 'transparent',
            color: value === mode ? '#fff' : 'var(--text-3)',
            fontSize: 13,
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

/* ── 압축 목록 ── */
function NearbyStoreCompactRow({ store: st, live }: { store: NearbyStore; live: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'home-nearby'); }, [st.id]);
  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="flex items-center gap-3 px-4 py-3 transition"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <div
        className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden"
        style={{ background: 'var(--surface-3)' }}
      >
        {st.photoUrl
          ? <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, #2A1F3D 0%, #1A1028 100%)' }} />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</span>
          {st.tier === 'vip' && (
            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: 'var(--gold)', color: '#000' }}>VIP</span>
          )}
        </div>
        <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
          {st.distance != null && <span className="font-bold" style={{ color: 'var(--text-2)' }}>{formatDistance(st.distance)}</span>}
          {st.distance != null && st.address ? ' · ' : ''}
          {st.address ? st.address.split(' ').slice(1).join(' ') : ''}
        </div>
      </div>
      {live > 0 && (
        <span className="badge-live flex-shrink-0">
          <span className="dot" />
          LIVE{live > 1 ? ` ${live}` : ''}
        </span>
      )}
    </Link>
  );
}

/* ── 큰 목록 ── */
function NearbyStoreLargeCard({ store: st, live }: { store: NearbyStore; live: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'home-nearby'); }, [st.id]);
  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="flex card card-hover overflow-hidden"
    >
      <div className="w-28 h-28 flex-shrink-0 relative overflow-hidden" style={{ background: 'var(--surface-3)' }}>
        {st.photoUrl
          ? <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, #2A1F3D 0%, #1A1028 100%)' }} />
        }
        {st.tier === 'vip' && (
          <div className="absolute top-1.5 left-1.5 text-[8px] font-extrabold rounded px-1.5 py-0.5" style={{ background: 'var(--gold)', color: '#000' }}>
            VIP
          </div>
        )}
        {st.distance != null && (
          <div className="absolute bottom-1.5 left-1.5 text-[9px] font-bold rounded px-1.5 py-0.5" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff', backdropFilter: 'blur(4px)' }}>
            {formatDistance(st.distance)}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
        <div>
          <div className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</div>
          {live > 0 && (
            <div className="mt-1.5">
              <span className="badge-live">
                <span className="dot" />
                LIVE{live > 1 ? ` ${live}` : ''}
              </span>
            </div>
          )}
        </div>
        {st.address && (
          <div className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
            {st.address.split(' ').slice(1).join(' ')}
          </div>
        )}
      </div>
    </Link>
  );
}

/* ── 앨범 그리드 ── */
function NearbyStoreAlbumCard({ store: st, live }: { store: NearbyStore; live: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'home-nearby'); }, [st.id]);
  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="block card card-hover overflow-hidden"
    >
      <div className="aspect-square relative overflow-hidden" style={{ background: 'var(--surface-3)' }}>
        {st.photoUrl
          ? <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, #2A1F3D 0%, #1A1028 100%)' }} />
        }
        {/* 좌상단 — 거리 + VIP */}
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {st.distance != null && (
            <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff', backdropFilter: 'blur(4px)' }}>
              {formatDistance(st.distance)}
            </span>
          )}
          {st.tier === 'vip' && (
            <span className="text-[9px] font-extrabold rounded-full px-2 py-0.5" style={{ background: 'var(--gold)', color: '#000' }}>
              VIP
            </span>
          )}
        </div>
        {/* 우상단 — LIVE */}
        {live > 0 && (
          <div className="absolute top-2 right-2">
            <span className="badge-live">
              <span className="dot" />
              LIVE{live > 1 ? ` ${live}` : ''}
            </span>
          </div>
        )}
        {/* 하단 그라데이션 */}
        <div className="absolute bottom-0 left-0 right-0 h-12" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.70) 0%, transparent 100%)' }} aria-hidden="true" />
      </div>
      <div className="p-2.5">
        <div className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</div>
        {st.address && (
          <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
            {st.address.split(' ').slice(1).join(' ')}
          </div>
        )}
      </div>
    </Link>
  );
}

/* ============================================================
 * LIVE 카드 (상단 가로 스크롤)
 * ========================================================== */
function StoreCard({ group, thumbnail }: { group: StoreGroup; thumbnail?: string }) {
  const primary = group.sessions[0];
  const count = group.sessions.length;
  const poster = posterStyleFor(primary.posterStyle);

  useEffect(() => { trackImpressionOnce(group.storeId, 'home-live'); }, [group.storeId]);

  return (
    <Link
      href={`/m/store/${group.storeId}`}
      onClick={() => bumpStoreMetric(group.storeId, 'cardClicks')}
      className="w-[220px] flex-shrink-0 card card-hover overflow-hidden"
    >
      {/* 사진 + 포스터 오버레이 */}
      <div
        className="h-44 relative flex items-center justify-center overflow-hidden"
        style={!thumbnail ? { background: poster.bg } : undefined}
      >
        {thumbnail && (
          <>
            <img src={thumbnail} alt={group.storeName} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.38)' }} />
          </>
        )}

        {/* LIVE 배지 — 우상단 */}
        <div className="absolute top-3 left-3 z-10">
          <span className="badge-live" style={{ boxShadow: '0 0 12px var(--live-glow)' }}>
            <span className="dot" />
            LIVE{count > 1 ? ` ${count}` : ''}
          </span>
        </div>

        {/* 토너 이름 카드 */}
        <div
          className="text-center px-4 z-10 rounded-lg py-2"
          style={thumbnail ? { background: poster.bg, color: poster.color } : { color: poster.color }}
        >
          <div className="text-sm font-extrabold leading-tight font-serif">
            {primary.tournamentName}
          </div>
          {primary.buyIn > 0 && (
            <div className="text-[10px] font-bold mt-1 opacity-80">
              ₩{primary.buyIn.toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {/* 정보 */}
      <div className="p-3">
        <div className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>{group.storeName}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
          {primary.tournamentName} · Lv {primary.currentLevel}
        </div>
        <div className="mt-2 pt-2 flex items-center justify-between text-xs" style={{ borderTop: '1px solid var(--border)' }}>
          <CountdownInline session={primary} />
          {count > 1 && <span className="text-[10px] font-bold" style={{ color: 'var(--text-3)' }}>+{count - 1}개 더</span>}
        </div>
      </div>
    </Link>
  );
}

/* ============================================================
 * 시리즈 카드
 * ========================================================== */
function SeriesCard({ series }: { series: Series }) {
  const poster = posterStyleFor(series.posterStyle);
  const dDays = series.finalDate
    ? Math.ceil((series.finalDate.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const statusLabel = series.status === 'active' ? '진행 중' : series.status === 'upcoming' ? '예정' : '종료';
  const statusColor = series.status === 'active' ? 'var(--success)' : series.status === 'upcoming' ? 'var(--gold)' : 'var(--text-3)';

  return (
    <Link
      href={`/m/series/${series.id}`}
      className="w-[260px] flex-shrink-0 card card-hover overflow-hidden"
    >
      <div className="p-4 h-32" style={{ background: poster.bg, color: poster.color }}>
        <div className="flex justify-between items-start mb-2">
          <span
            className="text-[9px] font-extrabold rounded-full px-2 py-0.5 text-white"
            style={{ background: statusColor }}
          >
            {statusLabel}
          </span>
          {dDays !== null && dDays > 0 && series.status !== 'completed' && (
            <span className="text-[9px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(0,0,0,0.40)', color: '#fff' }}>
              본선 D-{dDays}
            </span>
          )}
        </div>
        <div className="text-[10px] opacity-80 mb-1">{series.season}</div>
        <div className="text-base font-extrabold leading-tight font-serif">{series.name}</div>
      </div>
      <div className="p-3">
        <div className="text-[10px] mb-1" style={{ color: 'var(--text-3)' }}>본선 게런티</div>
        <div className="font-mono text-base font-extrabold mb-2" style={{ color: 'var(--gold)' }}>
          ₩{(series.finalGuarantee / 100000000).toFixed(1)}억
        </div>
        <div className="flex justify-between text-[11px]" style={{ color: 'var(--text-3)' }}>
          <span>협력 매장</span>
          <span className="font-bold" style={{ color: 'var(--text-2)' }}>{series.partnerStoreIds.length}곳</span>
        </div>
      </div>
    </Link>
  );
}

/* ============================================================
 * 카운트다운 인라인
 * ========================================================== */
function CountdownInline({ session }: { session: LiveSession }) {
  const sec = useLiveCountdown(session);
  const paused = session.status === 'paused';
  return (
    <span
      className="font-mono text-sm font-extrabold"
      style={{ color: paused ? 'var(--gold)' : 'var(--text-1)' }}
    >
      {paused ? '⏸' : '⏱'} {fmtTime(sec)}
    </span>
  );
}
