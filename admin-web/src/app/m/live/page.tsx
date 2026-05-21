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
} from '@/lib/live';
import { posterStyleFor, fmtBuyInTicketsMobile } from '@/lib/templates';
import { bumpStoreMetric } from '@/lib/analytics';
import { haversineMeters, formatDistance, type LatLng } from '@/lib/geo';

/**
 * 지금 LIVE — 사용자 위치 30km 반경 내 LIVE 매장 카드 리스트.
 * 정렬: 거리 가까운 순. 위치 거부 시 모든 LIVE 표시 (거리 정보 없음).
 */

const NEARBY_RADIUS_M = 30_000;

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

  // 30km 필터 + 거리 정렬 (그레이스 만료 세션은 subscribeAllLiveSessions에서 이미 제외됨)
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
    if (!userLocation) return enriched; // 위치 없으면 전부 표시
    return enriched
      .filter(({ distance }) => distance == null || distance <= NEARBY_RADIUS_M)
      .sort((a, b) => {
        if (a.distance != null && b.distance != null) return a.distance - b.distance;
        if (a.distance != null) return -1;
        if (b.distance != null) return 1;
        return 0;
      });
  }, [sessions, storesById, userLocation]);

  return (
    <div className="pb-24">
      {/* 헤더 */}
      <div className="px-5 h-14 flex items-center justify-between border-b border-gray-100 sticky top-0 bg-white z-10">
        <Link href="/m" className="text-xl">←</Link>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-lg font-extrabold tracking-tight font-serif">지금 LIVE</span>
        </div>
        <div className="w-6" />
      </div>

      {/* 안내 */}
      <div className="px-5 py-3 flex items-center justify-between text-[11px] text-gray-500">
        <span>
          {userLocation
            ? `내 주변 ${NEARBY_RADIUS_M / 1000}km · 거리순`
            : locationDenied
              ? '전체 LIVE'
              : '위치 확인 중…'}
        </span>
        <span>{filteredSessions.length}개</span>
      </div>

      {/* 결과 */}
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">로딩 중…</div>
      ) : filteredSessions.length === 0 ? (
        <div className="py-16 px-6 text-center">
          <div className="text-4xl mb-3">🎬</div>
          <div className="font-bold text-gray-900 mb-2">
            {userLocation ? '내 주변 LIVE 없음' : '진행 중인 LIVE 없음'}
          </div>
          <div className="text-xs text-gray-500 leading-relaxed">
            {userLocation
              ? `반경 ${NEARBY_RADIUS_M / 1000}km 안에 진행 중인 LIVE 토너가 없습니다.`
              : '어드민에서 LIVE 시작 시 즉시 표시됩니다.'}
          </div>
        </div>
      ) : (
        <div className="px-5 space-y-3">
          {filteredSessions.map(({ session, distance, locality }) => (
            <LiveCard key={session.id} session={session} distance={distance} locality={locality} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * LIVE 카드 — 리스트형 · TOSS DESIGN LANGUAGE
 *
 * 토스 톤 채택 원칙:
 *   - 그라데이션·네온 글로우·이모지 → 절제 (clean / monochrome / solid)
 *   - 컬러는 의미 있는 곳에만 (LIVE 빨강 · 참가가능 그린 · 그 외 무채색)
 *   - 텍스트 컬러 위계: #191F28(타이틀) / #4E5968(본문) / #8B95A1(보조)
 *   - 카드: border 없음 + 부드러운 soft shadow + rounded 20px
 *   - 숫자: tnum / letter-spacing -0.02em
 *
 * 정보 위계:
 *   1) 상단행: LIVE · 매장명 · (우) 참가가능/참가마감 칩
 *   2) 토너명 (보조)
 *   3) hero 타이머 + Lv/블라인드 + NEXT
 *   4) hairline + 메타 (인원 · 등록 · 지역 · 거리)
 * ========================================================== */

// 토스 컬러 토큰
const TOSS = {
  textTitle: '#191F28',
  textBody: '#4E5968',
  textHint: '#8B95A1',
  divider: '#F2F4F6',
  hairline: 'rgba(25,31,40,0.06)',
  cardBg: '#FFFFFF',
  green: '#15B97D',
  greenSoft: '#E6F9F1',
  red: '#F04452',
  redSoft: '#FEECEE',
  yellow: '#FFB31A',
  gray50: '#F2F4F6',
  gray100: '#E5E8EB',
} as const;

function LiveCard({ session, distance, locality }: { session: LiveSession; distance?: number; locality?: string }) {
  const sec = useLiveCountdown(session);
  const isPaused = session.status === 'paused';
  const lowTime = sec > 0 && sec <= 10 && !isPaused;
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
    ? TOSS.red
    : isPaused
      ? TOSS.yellow
      : lowTime
        ? TOSS.red
        : TOSS.textTitle;
  const timerPulse = isFinishing || lowTime;

  const statusChip = isFinishing
    ? { label: '곧 종료', bg: TOSS.redSoft, color: TOSS.red, pulse: true }
    : isPaused
      ? { label: '일시정지', bg: 'rgba(255,179,26,0.14)', color: TOSS.yellow, pulse: false }
      : null;

  return (
    <Link
      href={`/m/live/${session.id}`}
      onClick={() => bumpStoreMetric(session.storeId, 'liveOpens')}
      className="relative block rounded-2xl overflow-hidden active:scale-[0.985] transition-transform"
      style={{
        background: TOSS.cardBg,
        boxShadow: '0 1px 2px rgba(25,31,40,0.04), 0 6px 16px rgba(25,31,40,0.05)',
      }}
    >
      {/* 카드 전체 좌측 4px 수직 액센트 바 — 상단/헤더 BG의 이중 띠 이질감 제거.
       * 카드 전체 높이를 가로지르는 단일 컬러 ID. (이전 상단 4px 색띠는 제거) */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0"
        style={{ width: 4, background: poster.bg, zIndex: 1 }}
      />

      {/* 헤더 블록 — 펍명·토너명 두 행을 컬러 배경으로 강조 */}
      <div
        style={{
          background: `linear-gradient(rgba(255,255,255,0.92), rgba(255,255,255,0.95)), ${poster.bg}`,
          borderBottom: `1px solid ${TOSS.divider}`,
        }}
      >
        {/* 1행 — 펍 이름(좌·최상단) · LIVE + 참가가능/마감 (우상단) */}
        <div className="pl-5 pr-4 pt-3.5 pb-1 flex items-center gap-2">
          <span
            className="text-[16px] font-extrabold truncate flex-1 min-w-0"
            style={{ color: TOSS.textTitle, letterSpacing: '-0.025em' }}
          >
            {session.storeName}
          </span>
          <span
            className="inline-flex items-center gap-1 text-[10.5px] font-bold tracking-wider px-1.5 py-[2px] rounded-md flex-shrink-0"
            style={{ background: TOSS.redSoft, color: TOSS.red }}
          >
            <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: TOSS.red }} />
            LIVE
          </span>
          <ParticipationBadge open={isLateRegOpen} />
        </div>

        {/* 2행 — 토너명 · 티켓 · 상태칩 */}
        <div className="pl-5 pr-4 pb-3 flex items-center gap-1.5 min-w-0">
          <span
            className="text-[12.5px] font-semibold truncate"
            style={{ color: TOSS.textBody, letterSpacing: '-0.01em' }}
          >
            {session.tournamentName}
          </span>
          {buyInLabel && (
            <>
              <span aria-hidden style={{ color: TOSS.gray100 }}>·</span>
              <span
                className="inline-flex items-center gap-0.5 text-[11px] font-bold flex-shrink-0"
                style={{ color: TOSS.textTitle }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: poster.bg as string }}>
                  <path d="M3 7v6a2 2 0 002 2h14a2 2 0 002-2V7" />
                  <path d="M3 7l9 6 9-6" />
                  <path d="M3 7a2 2 0 012-2h14a2 2 0 012 2" />
                </svg>
                <span className="tabular-nums">{buyInLabel}</span>
              </span>
            </>
          )}
          {statusChip && (
            <span
              className={`ml-auto inline-flex items-center text-[10px] font-bold px-1.5 py-[2px] rounded-md flex-shrink-0 ${statusChip.pulse ? 'animate-pulse' : ''}`}
              style={{ background: statusChip.bg, color: statusChip.color }}
            >
              {statusChip.label}
            </span>
          )}
        </div>
      </div>

      {/* 메인행 — TV 풀스크린 타이머의 미니어처.
       * 좌: 큰 Lv 라벨 + 블라인드 굵게 / 우: hero 타이머 + NEXT 칩 */}
      <div className="pl-5 pr-4 pt-3.5 pb-3.5 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Lv N — TV 라벨 톤 */}
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-[10px] font-bold tracking-[0.15em]"
              style={{ color: TOSS.textHint }}
            >
              LEVEL
            </span>
            <span
              className="text-[22px] font-extrabold leading-none tabular-nums"
              style={{ color: TOSS.textTitle, letterSpacing: '-0.03em' }}
            >
              {session.currentLevel}
            </span>
          </div>
          {/* 블라인드 — 강조 */}
          <div
            className="mt-1 text-[18px] font-extrabold tabular-nums leading-none"
            style={{ color: TOSS.textTitle, letterSpacing: '-0.02em' }}
          >
            {session.smallBlind}/{session.bigBlind}
          </div>
          <div
            className="text-[10px] font-bold tracking-[0.12em] mt-1"
            style={{ color: TOSS.textHint }}
          >
            BLINDS
          </div>
        </div>

        {/* 우측 — hero 타이머 (TV 풀스크린의 축소판) + NEXT 칩 */}
        <div className="flex-shrink-0 text-right flex flex-col items-end">
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
          {nextBlind && !isFinishing && (
            <span
              className="mt-2 inline-flex items-baseline gap-1 px-2 py-[3px] rounded-md"
              style={{ background: nextBlind.isBreak ? 'rgba(255,179,26,0.12)' : TOSS.gray50 }}
            >
              <span
                className="text-[9.5px] font-bold tracking-wider"
                style={{ color: nextBlind.isBreak ? TOSS.yellow : TOSS.textHint }}
              >
                NEXT
              </span>
              <span className="text-[11px] tabular-nums font-bold" style={{ color: TOSS.textBody }}>
                {nextBlind.isBreak
                  ? `${Math.round(nextBlind.durationSec / 60)}분`
                  : `${nextBlind.sb}/${nextBlind.bb}`}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* 메타 — hairline + 한 줄. 별도 배경 없음(토스 톤) */}
      <div
        className="px-4 py-2.5 flex items-center gap-2 text-[11.5px]"
        style={{ borderTop: `1px solid ${TOSS.divider}`, color: TOSS.textBody }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0" style={{ color: TOSS.textHint }}>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
        <span className="tabular-nums font-bold" style={{ color: TOSS.textTitle }}>
          {session.playersRemaining}
        </span>
        <span className="tabular-nums" style={{ color: TOSS.textHint }}>
          /{session.totalPlayers}
        </span>

        <span aria-hidden style={{ color: TOSS.gray100 }}>·</span>

        {session.lateRegClosed ? (
          <span style={{ color: TOSS.textHint }}>등록 마감</span>
        ) : (
          <span
            className={lateMin <= 5 ? 'font-bold' : 'font-medium'}
            style={{ color: lateMin <= 5 ? TOSS.red : TOSS.textBody }}
          >
            등록 {lateMin}분
          </span>
        )}

        <span className="ml-auto flex items-center gap-1.5" style={{ color: TOSS.textHint }}>
          {locality && <span className="truncate max-w-[110px]">{locality}</span>}
          {locality && distance != null && <span aria-hidden style={{ color: TOSS.gray100 }}>·</span>}
          {distance != null && <span className="tabular-nums">{formatDistance(distance)}</span>}
        </span>
      </div>
    </Link>
  );
}

/** 참가가능 / 참가마감 — 토스 톤 (솔리드 컬러 · subtle · 무채색 대비). */
function ParticipationBadge({ open }: { open: boolean }) {
  if (open) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10.5px] font-bold pl-1.5 pr-2 py-[3px] rounded-full"
        style={{
          background: TOSS.green,
          color: '#FFFFFF',
          letterSpacing: '-0.01em',
        }}
        aria-label="참가가능"
      >
        <span
          className="w-1 h-1 rounded-full pulse-live flex-shrink-0"
          style={{ background: '#FFFFFF' }}
          aria-hidden="true"
        />
        참가가능
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-[3px] rounded-full"
      style={{
        background: TOSS.gray50,
        color: TOSS.textHint,
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
