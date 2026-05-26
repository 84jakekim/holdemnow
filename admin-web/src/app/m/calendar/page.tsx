'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession, fmtTime, useLiveCountdown } from '@/lib/live';
import { subscribeAllTournaments, type TournamentInstance } from '@/lib/tournaments';
import Link from 'next/link';
import { posterStyleFor } from '@/lib/templates';
import TournamentInterestStar from '@/components/mobile/TournamentInterestStar';
import { bumpStoreMetric } from '@/lib/analytics';
import { haversineMeters, type LatLng } from '@/lib/geo';
import NotificationBellButton from '@/components/mobile/NotificationBellButton';

/** 캘린더 "내 주변" 반경 (m). 위치 거부/미동의 시 전국 폴백. */
const NEARBY_RADIUS_M = 20_000;

interface StoreCoord {
  lat?: number;
  lng?: number;
}

export default function CalendarPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [tournaments, setTournaments] = useState<TournamentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  // 'gtd-large' 필터 제거 — 게런티/상금 표기 법적 리스크
  type FilterId = 'all' | 'buyin-low' | 'satellite';
  const [filter, setFilter] = useState<FilterId>('all');
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [storesById, setStoresById] = useState<Record<string, StoreCoord>>({});

  // 사용자 위치 (watchPosition — 이동 중에도 갱신)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationDenied(true);
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationDenied(true),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // 매장 좌표 일괄 fetch (1회) — 토너 거리 필터용
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'stores'));
        const map: Record<string, StoreCoord> = {};
        snap.forEach((d) => {
          // pending 매장 제외 — 해당 매장의 토너도 자연 숨김
          const data = d.data() as { lat?: number; lng?: number; status?: string; isDemo?: boolean };
          if (data.status !== 'active' && data.isDemo !== true) return;
          map[d.id] = { lat: data.lat, lng: data.lng };
        });
        setStoresById(map);
      } catch {
        /* 거리 정보 없이 폴백 */
      }
    })();
  }, []);

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(
      (items) => { setSessions(items); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeAllTournaments(
      (items) => setTournaments(items),
      (e) => console.warn('tournaments subscribe error', e),
    );
    return unsub;
  }, []);

  // 위치 반경 필터 적용된 토너 (위치 거부 시 전체 폴백)
  const nearbyTournaments = useMemo<TournamentInstance[]>(() => {
    if (!userLocation) return tournaments;
    return tournaments.filter((t) => {
      const coord = storesById[t.storeId];
      if (typeof coord?.lat !== 'number' || typeof coord?.lng !== 'number') return true; // 좌표 없으면 통과(매장 좌표 누락 보호)
      return haversineMeters(userLocation, { lat: coord.lat, lng: coord.lng }) <= NEARBY_RADIUS_M;
    });
  }, [tournaments, userLocation, storesById]);

  const upcomingForDay = useMemo(() => {
    return nearbyTournaments.filter((t) => {
      const d = t.startsAt.toDate();
      if (d.getDate() !== selectedDay || t.status !== 'scheduled') return false;
      if (filter === 'buyin-low' && t.buyIn > 50000) return false;
      if (filter === 'satellite' && t.type !== 'satellite') return false;
      return true;
    });
  }, [nearbyTournaments, selectedDay, filter]);

  const days = useMemo(() => {
    const list = [] as { n: number; dow: string; isToday: boolean; isWeekend: boolean }[];
    const dowNames = ['일', '월', '화', '수', '목', '금', '토'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      list.push({
        n: d.getDate(),
        dow: dowNames[d.getDay()],
        isToday: i === 0,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isToday = selectedDay === today.getDate();

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── 헤더 — 핑크 hero 그라데이션 (handoff v3.0) ── */}
      <header className="pr-home-hero">
        <div className="pr-home-hero-content px-5 h-14 flex items-center justify-between">
          <span className="text-[19px] font-black tracking-tight" style={{ color: '#FFFFFF', textShadow: '0 1px 4px rgba(0,0,0,0.18)' }}>
            📅 토너 캘린더
          </span>
          <div className="flex items-center gap-1">
            <Link
              href="/m/search"
              aria-label="검색"
              className="hero-pink-action w-9 h-9 flex items-center justify-center rounded-full"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            </Link>
            <NotificationBellButton variant="hero" ariaLabel="알림" />
          </div>
        </div>
      </header>

      {/* ── 위치 범위 안내 ── */}
      <div
        className="px-5 pt-3 pb-1 text-[11px] font-bold flex items-center gap-1.5"
        style={{ color: 'var(--text-3)' }}
      >
        {userLocation ? (
          <>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span style={{ color: 'var(--brand)' }}>내 주변 {NEARBY_RADIUS_M / 1000}km</span>
            <span>· 거리 기준</span>
          </>
        ) : locationDenied ? (
          <span>📍 위치 권한 거부 — 전국 토너 표시</span>
        ) : (
          <span>📍 위치 확인 중…</span>
        )}
      </div>

      {/* ── 필터 칩 ── */}
      <div className="px-4 py-3 flex gap-1.5 overflow-x-auto scrollbar-none">
        {([
          { id: 'all', label: '전체' },
          { id: 'buyin-low', label: '바이인 5만↓' },
          { id: 'satellite', label: '위성 예선' },
        ] as { id: FilterId; label: string }[]).map((c) => {
          const active = filter === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className="px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex-shrink-0 transition active:scale-[0.96]"
              style={active
                ? { background: 'var(--brand)', color: '#fff', boxShadow: 'var(--shadow-brand)' }
                : { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* ── 년월 표시 ── */}
      <div className="px-5 pb-2 text-sm font-bold" style={{ color: 'var(--text-2)' }}>
        {today.getFullYear()}년 {today.getMonth() + 1}월
      </div>

      {/* ── 날짜 선택 ── */}
      <div className="pl-4 pr-2 flex gap-2 overflow-x-auto scrollbar-none pb-5">
        {days.map((d) => {
          const active = selectedDay === d.n;
          return (
            <button
              key={d.n}
              onClick={() => setSelectedDay(d.n)}
              className="w-12 h-16 rounded-xl flex flex-col items-center justify-center flex-shrink-0 transition active:scale-[0.95]"
              style={active
                ? { background: 'var(--brand)', boxShadow: 'var(--shadow-brand)' }
                : { background: 'var(--surface-2)', border: '1px solid var(--border)' }
              }
            >
              <div
                className="text-[10px] font-bold"
                style={{
                  color: active ? 'rgba(255,255,255,0.70)' : d.isWeekend ? 'var(--live)' : 'var(--text-3)',
                }}
              >
                {d.dow}
              </div>
              <div
                className="text-lg font-extrabold mt-0.5"
                style={{ color: active ? '#fff' : 'var(--text-1)' }}
              >
                {d.n}
              </div>
              {d.isToday && active && (
                <div className="w-1 h-1 rounded-full mt-1" style={{ background: 'rgba(255,255,255,0.60)' }} />
              )}
              {d.isToday && !active && (
                <div className="w-1 h-1 rounded-full mt-1" style={{ background: 'var(--brand)' }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── 지금 LIVE ── */}
      {sessions.length > 0 && isToday && (
        <div className="px-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full flex-shrink-0 pulse-live" style={{ background: 'var(--live)' }} aria-hidden="true" />
            <span className="text-base font-extrabold" style={{ color: 'var(--live)' }}>
              지금 진행 중 ({sessions.length})
            </span>
          </div>
          <div className="space-y-2">
            {sessions.map((s) => (
              <CalendarLiveCard key={s.id} session={s} onOpen={() => { bumpStoreMetric(s.storeId, 'liveOpens'); router.push(`/m/live/${s.id}`); }} />
            ))}
          </div>
        </div>
      )}

      {/* ── 예정 토너 ── */}
      <div className="px-4 mb-8">
        <div className="text-base font-extrabold mb-3" style={{ color: 'var(--text-1)' }}>
          {today.getMonth() + 1}월 {selectedDay}일 예정 토너
        </div>
        {loading ? (
          <div className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
        ) : upcomingForDay.length === 0 ? (
          <div
            className="rounded-2xl p-8 text-center"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3"
              style={{ background: 'var(--surface-3)', fontSize: 22 }}
            >
              📅
            </div>
            <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)' }}>예정 토너 없음</div>
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
              매장 어드민에서 사전 등록 시 여기에 표시됩니다
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingForDay.map((t) => {
              const poster = posterStyleFor(t.posterStyle);
              const time = t.startsAt.toDate();
              const hh = String(time.getHours()).padStart(2, '0');
              const mm = String(time.getMinutes()).padStart(2, '0');
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-2xl p-3 lift"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
                >
                  <button
                    onClick={() => { bumpStoreMetric(t.storeId, 'cardClicks'); router.push(`/m/store/${t.storeId}`); }}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left tap"
                  >
                    <div
                      className="w-12 h-16 rounded-xl flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
                      style={{ background: poster.bg, color: poster.color }}
                    >
                      {t.name.split(' ').slice(0, 2).join(' ')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>{t.name}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        <span className="font-mono font-bold" style={{ color: 'var(--text-2)' }}>{hh}:{mm}</span>
                        {' '}· {t.storeName} · {t.totalPlayers}명
                      </div>
                      {/* GTD 뱃지 제거 — 법적 리스크. 바이인(좌석 이용권 가격)만 표시 */}
                      <div className="flex gap-1.5 mt-1.5">
                        <span
                          className="text-[10px] font-bold rounded-md px-1.5 py-0.5"
                          style={{ background: 'var(--surface-3)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                        >
                          ₩{(t.buyIn / 1000).toFixed(0)}K
                        </span>
                      </div>
                    </div>
                  </button>
                  <TournamentInterestStar tournament={t} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CalendarLiveCard({ session: s, onOpen }: { session: LiveSession; onOpen: () => void }) {
  const sec = useLiveCountdown(s);
  const poster = posterStyleFor(s.posterStyle);
  const paused = s.status === 'paused';
  return (
    <button
      onClick={onOpen}
      className="w-full rounded-2xl p-3 flex items-center gap-3 text-left transition active:scale-[0.98]"
      style={{
        background: paused ? 'rgba(255,183,28,0.10)' : 'rgba(229,62,62,0.10)',
        border: `1px solid ${paused ? 'rgba(255,183,28,0.25)' : 'rgba(229,62,62,0.25)'}`,
      }}
    >
      <div
        className="w-10 h-12 rounded-xl flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
        style={{ background: poster.bg, color: poster.color }}
      >
        {s.tournamentName.split(' ')[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>{s.tournamentName}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
          {s.storeName} · Lv {s.currentLevel} · {s.playersRemaining}명
        </div>
      </div>
      <div
        className="font-mono text-base font-extrabold flex-shrink-0"
        style={{ color: paused ? 'var(--gold)' : 'var(--live)' }}
      >
        {fmtTime(sec)}
      </div>
    </button>
  );
}
