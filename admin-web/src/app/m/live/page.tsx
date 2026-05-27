'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  subscribeAllLiveSessions,
  type LiveSession,
  fmtTime,
  computeLateRegMinutes,
  useLiveCountdown,
  computeFinishingGraceSec,
  isLiveOnBreak,
  resolveNextPlayLevel,
} from '@/lib/live';
import { posterStyleFor, fmtBuyInTicketsMobile } from '@/lib/templates';
import { bumpStoreMetric } from '@/lib/analytics';
import { haversineMeters, formatDistance, type LatLng } from '@/lib/geo';
import { subscribeFeedConfig, FEED_CONFIG_DEFAULT, type FeedConfig } from '@/lib/feedConfig';

/**
 * 지금 LIVE — 사용자 위치 30km 반경 내 LIVE 매장 카드 리스트.
 * 정렬: 거리 가까운 순. 위치 거부 시 모든 LIVE 표시 (거리 정보 없음).
 */

/** 본사 feedConfig.liveListRadiusKm(km) → m. 미설정 시 30km fallback. 2026-05-27 동적 제어. */

interface StoreMeta {
  lat?: number;
  lng?: number;
  address?: string;
}

/** 주소에서 "구·시 + 동" 정도만 추출. 광역/도 prefix 제거.
 *  예) "부산광역시 부산진구 부전동 123" → "부산진구 부전동"
 *  예) "경기도 성남시 분당구 정자동" → "성남시 분당구" */
function localityFromAddress(address?: string): string {
  if (!address) return '';
  const parts = address.trim().split(/\s+/);
  if (parts.length === 0) return '';
  const first = parts[0];
  const isMetroOrProvince = /광역시$|특별시$|특별자치시$|특별자치도$|도$/.test(first);
  const rest = isMetroOrProvince ? parts.slice(1) : parts;
  return rest.slice(0, 2).join(' ');
}

export default function LiveFeedListPage() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [storesById, setStoresById] = useState<Record<string, StoreMeta>>({});
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  // 필터/정렬 (2026-05-27 사용자 요청)
  const [sortKey, setSortKey] = useState<'distance' | 'startsAt'>('distance');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed' | 'break'>('all');
  // 본사 feedConfig 구독 — liveListRadiusKm 동적 적용
  const [feedConfig, setFeedConfig] = useState<FeedConfig>(FEED_CONFIG_DEFAULT);
  useEffect(() => subscribeFeedConfig(setFeedConfig), []);
  const radiusM = (feedConfig.liveListRadiusKm ?? 30) * 1000;
  // 1초 tick — finishingAt 그레이스 만료를 매초 재평가하기 위함
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // 사용자 위치 (실시간 추적)
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

  // LIVE 세션 구독
  useEffect(() => {
    const unsub = subscribeAllLiveSessions(
      (items) => {
        setSessions(items);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  // 매장 좌표·주소 fetch (1회)
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'stores'));
        const map: Record<string, StoreMeta> = {};
        snap.forEach((d) => {
          // pending 매장은 join 대상에서 제외 — 해당 매장의 LIVE도 자연 숨김
          const data = d.data() as { lat?: number; lng?: number; address?: string; status?: string; isDemo?: boolean };
          if (data.status !== 'active' && data.isDemo !== true) return;
          map[d.id] = { lat: data.lat, lng: data.lng, address: data.address };
        });
        setStoresById(map);
      } catch {
        /* skip — 거리·지역 정보 없음으로 폴백 */
      }
    })();
  }, []);

  // 30km 필터 + 상태/정렬 필터 (사용자 토글)
  const filteredSessions = useMemo(() => {
    const enriched = sessions.map((s) => {
      const meta = storesById[s.storeId];
      const distance =
        userLocation && typeof meta?.lat === 'number' && typeof meta?.lng === 'number'
          ? haversineMeters(userLocation, { lat: meta.lat, lng: meta.lng })
          : undefined;
      const locality = localityFromAddress(meta?.address);
      return { session: s, distance, locality };
    });

    // 1) 30km 반경 필터 (위치 없으면 skip)
    const inRadius = userLocation
      ? enriched.filter(({ distance }) => distance == null || distance <= radiusM)
      : enriched;

    // 2) 상태 필터 (참가가능 / 참가마감 / 휴식)
    const byStatus = inRadius.filter(({ session: s }) => {
      const isOpen = !s.lateRegClosed && s.currentLevel <= s.lateRegEndLevel;
      const isBreak = s.status === 'break' || s.status === 'paused';
      switch (statusFilter) {
        case 'open':   return isOpen && !isBreak;
        case 'closed': return !isOpen;
        case 'break':  return isBreak;
        default:       return true;
      }
    });

    // 3) 정렬 (거리순 또는 시작순)
    return [...byStatus].sort((a, b) => {
      if (sortKey === 'startsAt') {
        // startedAt이 Timestamp이면 toMillis()로 정렬 (any 우회 — 타입 좁힘)
        const toMs = (v: unknown): number => {
          if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
            return (v as { toMillis: () => number }).toMillis();
          }
          return 0;
        };
        return toMs(b.session.startedAt) - toMs(a.session.startedAt); // 최근 시작순
      }
      // 거리순 (기본)
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      if (a.distance != null) return -1;
      if (b.distance != null) return 1;
      return 0;
    });
  }, [sessions, storesById, userLocation, sortKey, statusFilter, radiusM]);

  return (
    <div className="pb-24">
      {/* LIVE hero — 빨강 그라데이션 (LIVE 시그니처) */}
      <header
        className="px-5 pt-5 pb-6 text-white relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #C53030 0%, #E53E3E 55%, #FF6B6B 100%)',
        }}
      >
        <div
          aria-hidden
          className="absolute top-[-40px] right-[-40px] w-[220px] h-[220px] rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 65%)',
          }}
        />
        <div className="relative z-10 flex items-start justify-between gap-3">
          <Link href="/m" className="hero-pink-action w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 tap" aria-label="뒤로">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase opacity-90 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              LIVE NOW
            </div>
            <h1 className="h2 font-serif mt-1.5">🎬 지금 LIVE</h1>
            <p className="text-[13px] font-semibold opacity-90 mt-1.5">
              {userLocation
                ? `내 주변 ${radiusM / 1000}km · 거리순`
                : locationDenied
                  ? '전체 LIVE 매장'
                  : '위치 확인 중…'}
            </p>
          </div>
          <div className="hero-pink-action px-3 py-1.5 rounded-full text-[12px] font-extrabold mono">
            {filteredSessions.length}곳
          </div>
        </div>
      </header>

      {/* 필터/정렬 칩 (2026-05-27 사용자 요청) */}
      <div
        className="px-5 pt-4 pb-2 flex flex-wrap items-center gap-1.5"
        style={{ background: 'var(--bg)' }}
      >
        {/* 정렬 */}
        {([
          { key: 'distance' as const, label: '📍 거리순' },
          { key: 'startsAt' as const, label: '🕐 시작순' },
        ]).map((opt) => {
          const active = sortKey === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              className="tap"
              style={{
                padding: '5px 11px',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 800,
                border: active ? 'none' : '1px solid var(--border)',
                background: active ? 'var(--brand)' : 'var(--bg)',
                color: active ? '#fff' : 'var(--text-1)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {opt.label}
            </button>
          );
        })}
        {/* 구분선 */}
        <span aria-hidden style={{ width: 1, height: 14, background: 'var(--border-strong)', margin: '0 4px' }} />
        {/* 상태 */}
        {([
          { key: 'all' as const, label: '전체' },
          { key: 'open' as const, label: '✅ 참가가능' },
          { key: 'closed' as const, label: '🔒 참가마감' },
          { key: 'break' as const, label: '☕ 휴식' },
        ]).map((opt) => {
          const active = statusFilter === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setStatusFilter(opt.key)}
              className="tap"
              style={{
                padding: '5px 11px',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 700,
                border: active ? 'none' : '1px solid var(--border)',
                background: active ? 'var(--text-1)' : 'var(--bg)',
                color: active ? 'var(--bg)' : 'var(--text-2)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* 결과 */}
      {loading ? (
        <div className="px-5 pt-3 space-y-3">
          <div className="skel h-40 rounded-r-xl" />
          <div className="skel h-40 rounded-r-xl" />
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="px-5 pt-6">
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden>🎬</div>
            <div>
              <div className="empty-state-title">
                {statusFilter !== 'all'
                  ? '해당 조건의 LIVE가 없어요'
                  : userLocation ? '내 주변에 LIVE가 없어요' : '진행 중인 LIVE가 없어요'}
              </div>
              <div className="empty-state-desc" style={{ marginTop: 6 }}>
                {statusFilter !== 'all'
                  ? '필터를 "전체"로 바꾸면 더 많은 LIVE를 볼 수 있어요.'
                  : userLocation
                    ? `반경 ${radiusM / 1000}km 안에 LIVE 토너가 없습니다.`
                    : '어드민에서 LIVE 시작 시 즉시 표시됩니다.'}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-5 pt-2 space-y-3">
          {filteredSessions.map(({ session, distance, locality }) => (
            <LiveCard key={session.id} session={session} distance={distance} locality={locality} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * LIVE 카드 — 다크 카드 (사장님 TIMER.PNG 시안 톤)
 *
 * 시각 컨셉:
 *   - 라이트 페이지 위에 다크 카드만 박는 컨셉 (검은 네이비 #161724)
 *   - 상단 5px 그라데이션 띠 (poster.bg → 투명) — 카드 시각 ID
 *   - 펍명 흰 굵게 + 우상단에 LIVE/티켓/참가 칩 세로 스택
 *   - hero 타이머 흰 40px, 좌측에 Lv·블라인드 큰 굵게
 * ========================================================== */

// 다크 카드 컬러 토큰
const DARK = {
  cardBg: '#161724',
  divider: 'rgba(255,255,255,0.08)',
  textTitle: '#FFFFFF',
  textBody: 'rgba(255,255,255,0.72)',
  textHint: 'rgba(255,255,255,0.42)',
  chipBg: 'rgba(255,255,255,0.08)',
  pink: '#FF1F8F',
  red: '#FF3B5C',
  redSoft: 'rgba(255,59,92,0.18)',
  green: '#22D67E',
  yellow: '#FFB31A',
} as const;

function LiveCard({ session, distance, locality }: { session: LiveSession; distance?: number; locality?: string }) {
  const sec = useLiveCountdown(session);
  const isPaused = session.status === 'paused';
  // 2026-05-24: BREAK 상태 — amber 톤
  const onBreak = isLiveOnBreak(session);
  const nextPlay = onBreak ? resolveNextPlayLevel(session) : null;
  // BREAK일 땐 lowTime 위험 깜빡임 끔
  const lowTime = sec > 0 && sec <= 10 && !isPaused && !onBreak;
  const lateMin = computeLateRegMinutes(session, sec);
  const isLateRegOpen = !session.lateRegClosed && lateMin > 0;
  const graceSec = computeFinishingGraceSec(session);
  const isFinishing = graceSec != null && graceSec > 0;
  const poster = posterStyleFor(session.posterStyle || 'poster-dark');
  const buyInLabel = fmtBuyInTicketsMobile(session.buyIn ?? 0);

  const nextBlind = (() => {
    const structure = (session.blindStructureLocked && session.blindStructureLocked.length > 0)
      ? session.blindStructureLocked
      : session.blindStructure;
    if (!structure || structure.length === 0) return null;
    const nextIdx = structure.findIndex((b) => b.level === session.currentLevel) + 1;
    if (nextIdx <= 0 || nextIdx >= structure.length) return null;
    return structure[nextIdx];
  })();

  const timerColor = isFinishing
    ? DARK.red
    : onBreak
      ? DARK.yellow
      : isPaused
        ? DARK.yellow
        : lowTime
          ? DARK.red
          : DARK.textTitle;
  const timerPulse = isFinishing || lowTime;

  // 2026-05-24: BREAK 우선순위 = finishing > onBreak > paused
  const statusChip = isFinishing
    ? { label: '곧 종료', bg: DARK.redSoft, color: DARK.red, pulse: true }
    : onBreak
      ? { label: '☕ BREAK', bg: 'rgba(245,158,11,0.22)', color: DARK.yellow, pulse: false }
      : isPaused
        ? { label: '일시정지', bg: 'rgba(255,179,26,0.18)', color: DARK.yellow, pulse: false }
        : null;

  return (
    <Link
      href={`/m/live/${session.id}`}
      onClick={() => bumpStoreMetric(session.storeId, 'liveOpens')}
      className="relative block rounded-2xl overflow-hidden active:scale-[0.985] transition-transform"
      style={{
        background: DARK.cardBg,
        boxShadow: '0 1px 2px rgba(0,0,0,0.28), 0 8px 22px rgba(0,0,0,0.22)',
      }}
    >
      {/* 상단 그라데이션 띠 — 좌측 진하게 시작해 우측으로 페이드 (사장님 시안) */}
      <div
        aria-hidden
        style={{
          height: 5,
          background: `linear-gradient(90deg, ${poster.bg} 0%, ${poster.bg} 50%, rgba(255,31,143,0) 100%)`,
        }}
      />

      {/* 헤더 — 펍명+토너명(좌, 세로) · LIVE + 티켓 + 참가 (우상단, 세로 스택) */}
      <div className="px-4 pt-3.5 pb-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div
            className="text-[16px] font-extrabold truncate"
            style={{ color: DARK.textTitle, letterSpacing: '-0.025em' }}
          >
            {session.storeName}
          </div>
          <div
            className="text-[12px] font-semibold truncate mt-1"
            style={{ color: DARK.textBody, letterSpacing: '-0.01em' }}
          >
            {session.tournamentName}
          </div>
        </div>

        <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-extrabold tracking-wider px-1.5 py-[3px] rounded-md"
              style={{
                background: DARK.pink,
                color: '#FFFFFF',
                boxShadow: '0 0 12px rgba(255,31,143,0.45)',
              }}
            >
              <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: '#FFFFFF' }} />
              LIVE
            </span>
            <ParticipationBadge open={isLateRegOpen} />
          </div>
          {buyInLabel && (
            <span
              className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-[3px] rounded-md tabular-nums"
              style={{ background: DARK.chipBg, color: DARK.textBody }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 7v6a2 2 0 002 2h14a2 2 0 002-2V7" />
                <path d="M3 7l9 6 9-6" />
                <path d="M3 7a2 2 0 012-2h14a2 2 0 012 2" />
              </svg>
              {buyInLabel}
            </span>
          )}
          {statusChip && (
            <span
              className={`inline-flex items-center text-[10px] font-bold px-1.5 py-[2px] rounded-md ${statusChip.pulse ? 'animate-pulse' : ''}`}
              style={{ background: statusChip.bg, color: statusChip.color }}
            >
              {statusChip.label}
            </span>
          )}
        </div>
      </div>

      {/* 메인 — 좌: Lv·블라인드 (BREAK일 땐 "☕ 휴식 중") / 우: hero 타이머 (TV 풀스크린 축소판) */}
      <div className="px-4 pb-3.5 flex items-end gap-3">
        <div className="flex-1 min-w-0">
          {onBreak ? (
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[18px] font-extrabold leading-none"
                style={{ color: DARK.yellow, letterSpacing: '-0.02em' }}
              >
                ☕ 휴식 중
              </span>
            </div>
          ) : (
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[11px] font-bold"
                style={{ color: DARK.textHint, letterSpacing: '0.02em' }}
              >
                Lv
              </span>
              <span
                className="text-[22px] font-extrabold leading-none tabular-nums"
                style={{ color: DARK.textTitle, letterSpacing: '-0.03em' }}
              >
                {session.currentLevel}
              </span>
              <span aria-hidden style={{ color: DARK.textHint }}>·</span>
              <span
                className="text-[18px] font-extrabold tabular-nums leading-none"
                style={{ color: DARK.textTitle, letterSpacing: '-0.025em' }}
              >
                {session.smallBlind}
                <span style={{ color: DARK.textHint }}>/</span>
                {session.bigBlind}
              </span>
            </div>
          )}
          {onBreak && nextPlay && (
            <div className="mt-2 inline-flex items-baseline gap-1">
              <span
                className="text-[9.5px] font-bold tracking-wider"
                style={{ color: DARK.yellow }}
              >
                NEXT
              </span>
              <span
                className="text-[11px] tabular-nums font-bold"
                style={{ color: DARK.textBody }}
              >
                LV{nextPlay.displayedNumber} · {nextPlay.sb.toLocaleString()}/{nextPlay.bb.toLocaleString()}
              </span>
            </div>
          )}
          {!onBreak && nextBlind && !isFinishing && (
            <div className="mt-2 inline-flex items-baseline gap-1">
              <span
                className="text-[9.5px] font-bold tracking-wider"
                style={{ color: nextBlind.isBreak ? DARK.yellow : DARK.textHint }}
              >
                NEXT
              </span>
              <span
                className="text-[11px] tabular-nums font-bold"
                style={{ color: DARK.textBody }}
              >
                {nextBlind.isBreak
                  ? `BREAK ${Math.round(nextBlind.durationSec / 60)}분`
                  : `${nextBlind.sb}/${nextBlind.bb}`}
              </span>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 text-right">
          <div
            className={`text-[40px] font-extrabold leading-none tabular-nums ${timerPulse ? 'animate-pulse' : ''}`}
            style={{
              color: timerColor,
              letterSpacing: '-0.045em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {isFinishing && graceSec != null ? fmtTime(graceSec) : fmtTime(sec)}
          </div>
        </div>
      </div>

      {/* 메타 — hairline + 한 줄 (다크) */}
      <div
        className="px-4 py-2.5 flex items-center gap-2 text-[11.5px]"
        style={{ borderTop: `1px solid ${DARK.divider}`, color: DARK.textBody }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0" style={{ color: DARK.textHint }}>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
        <span className="tabular-nums font-bold" style={{ color: DARK.textTitle }}>
          {session.playersRemaining}
        </span>
        <span className="tabular-nums" style={{ color: DARK.textHint }}>
          /{session.totalPlayers}
        </span>

        <span aria-hidden style={{ color: DARK.textHint }}>·</span>

        {session.lateRegClosed ? (
          <span style={{ color: DARK.textHint }}>등록 마감</span>
        ) : (
          <span
            className={lateMin <= 5 ? 'font-bold' : 'font-medium'}
            style={{ color: lateMin <= 5 ? DARK.red : DARK.textBody }}
          >
            등록 {lateMin}분
          </span>
        )}

        <span className="ml-auto flex items-center gap-1.5" style={{ color: DARK.textHint }}>
          {locality && <span className="truncate max-w-[110px]">{locality}</span>}
          {locality && distance != null && <span aria-hidden style={{ color: DARK.textHint }}>·</span>}
          {distance != null && <span className="tabular-nums">{formatDistance(distance)}</span>}
        </span>
      </div>
    </Link>
  );
}

/** 참가가능 / 참가마감 — 다크 카드용 톤. */
function ParticipationBadge({ open }: { open: boolean }) {
  if (open) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold pl-1.5 pr-2 py-[3px] rounded-md"
        style={{
          background: DARK.green,
          color: '#062B19',
          letterSpacing: '-0.01em',
          boxShadow: '0 0 10px rgba(34,214,126,0.30)',
        }}
        aria-label="참가가능"
      >
        <span
          className="w-1 h-1 rounded-full pulse-live flex-shrink-0"
          style={{ background: '#062B19' }}
          aria-hidden="true"
        />
        참가가능
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-[3px] rounded-md"
      style={{
        background: 'rgba(255,255,255,0.08)',
        color: 'rgba(255,255,255,0.55)',
        letterSpacing: '-0.01em',
      }}
      aria-label="참가마감"
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="flex-shrink-0"
      >
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V7a4 4 0 018 0v4" />
      </svg>
      참가마감
    </span>
  );
}
