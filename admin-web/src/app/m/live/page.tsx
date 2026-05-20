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
import { posterStyleFor } from '@/lib/templates';
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
 * LIVE 카드 — 컨셉 1 "Hero 타이머 + 좌측 토너 포스터"
 *
 * 디자인 의도:
 * 배민 가게 카드처럼 좌측 토너 포스터(시각 앵커) + 우측 정보 블록.
 * 타이머는 카드의 hero 요소로 mono 32px 큼지막하게 — 한눈에 인지.
 * 핑크는 LIVE 점·곧종료 배지 두 곳만 절제. 다양한 포스터 컬러가
 * 카드별 시각 다양성을 만들고, 메트릭은 하단 한 줄로 깔끔하게.
 * ========================================================== */

function LiveCard({ session, distance, locality }: { session: LiveSession; distance?: number; locality?: string }) {
  const sec = useLiveCountdown(session);
  const isPaused = session.status === 'paused';
  const lowTime = sec <= 60 && !isPaused; // 1분 이내 임박 → 빨강
  const lateMin = computeLateRegMinutes(session, sec);
  const graceSec = computeFinishingGraceSec(session);
  const isFinishing = graceSec != null && graceSec > 0;
  const poster = posterStyleFor(session.posterStyle || 'poster-dark');

  // 토너명 첫 글자(또는 첫 단어 한 글자) — 포스터 표시용
  const posterChar = (() => {
    const name = (session.tournamentName || '').trim();
    if (!name) return 'T';
    // 첫 단어의 첫 문자 (한글/영문 무관)
    const firstWord = name.split(/\s+/)[0];
    return firstWord.charAt(0);
  })();

  // 타이머 색 분기
  const timerColor = isFinishing
    ? 'var(--live, #E53E3E)'
    : isPaused
      ? 'var(--gold, #F59E0B)'
      : lowTime
        ? 'var(--live, #E53E3E)'
        : 'var(--text-1, #111827)';

  // 타이머 펄스 — finishing 또는 1분 이내일 때만
  const timerPulse = isFinishing || lowTime;

  return (
    <Link
      href={`/m/live/${session.id}`}
      onClick={() => bumpStoreMetric(session.storeId, 'liveOpens')}
      className="relative block rounded-[20px] overflow-hidden active:scale-[0.99]"
      style={{
        background: 'var(--surface-1, #ffffff)',
        border: '1px solid var(--border, #e5e7eb)',
        boxShadow: 'var(--shadow-card, 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06))',
        transition: 'transform 80ms ease',
      }}
    >
      <div className="flex gap-3.5 p-4">
        {/* 좌측 — 토너 포스터 (시각 앵커) */}
        <div
          className="flex-shrink-0 w-[84px] h-[96px] rounded-[14px] flex flex-col items-center justify-center relative overflow-hidden"
          style={{ background: poster.bg, color: poster.color }}
          aria-hidden
        >
          {/* paused/finishing 상태 오버레이 (포스터 위) */}
          {isPaused && (
            <span
              className="absolute top-1.5 right-1.5 text-[9px] font-extrabold tracking-wider px-1 py-[1px] rounded"
              style={{ background: 'var(--gold, #F59E0B)', color: '#1A1A1A' }}
            >
              일시정지
            </span>
          )}
          {isFinishing && (
            <span
              className="absolute top-1.5 right-1.5 text-[9px] font-extrabold tracking-wider px-1 py-[1px] rounded animate-pulse"
              style={{ background: 'var(--live, #E53E3E)', color: '#ffffff' }}
            >
              곧 종료
            </span>
          )}
          <div className="text-[34px] font-black leading-none" style={{ color: poster.color }}>
            {posterChar}
          </div>
          <div
            className="text-[9px] font-bold tracking-wider mt-1 opacity-80"
            style={{ color: poster.color }}
          >
            TOURNEY
          </div>
        </div>

        {/* 우측 — 정보 블록 */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* 상단 — LIVE 배지 + 매장명 */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-extrabold tracking-wider px-1.5 py-[2px] rounded-md flex-shrink-0"
              style={{
                background: 'rgba(229, 62, 62, 0.10)',
                color: 'var(--live, #E53E3E)',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: 'var(--live, #E53E3E)' }}
              />
              LIVE
            </span>
            <span
              className="text-[15px] font-extrabold truncate"
              style={{ color: 'var(--text-1, #111827)' }}
            >
              {session.storeName}
            </span>
          </div>

          {/* 토너명 */}
          <div
            className="text-[13px] font-medium truncate mt-1"
            style={{ color: 'var(--text-2, #6B7280)' }}
          >
            {session.tournamentName}
          </div>

          {/* hero 타이머 + 레벨/블라인드 */}
          <div className="mt-2 flex items-baseline gap-2.5 min-w-0">
            <span
              className={`font-mono text-[30px] font-extrabold leading-none tabular-nums tracking-tight flex-shrink-0 ${timerPulse ? 'animate-pulse' : ''}`}
              style={{ color: timerColor }}
            >
              {isFinishing && graceSec != null ? fmtTime(graceSec) : fmtTime(sec)}
            </span>
            <div className="flex flex-col min-w-0 leading-tight">
              <span
                className="text-[11px] font-extrabold"
                style={{ color: 'var(--text-1, #111827)' }}
              >
                Lv {session.currentLevel}
              </span>
              <span
                className="text-[10px] font-mono tabular-nums"
                style={{ color: 'var(--text-3, #9CA3AF)' }}
              >
                {session.smallBlind}/{session.bigBlind}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 하단 메타 바 — 상금·인원·등록·지역·거리 */}
      <div
        className="px-4 py-2.5 flex items-center gap-2 text-[11px] flex-wrap"
        style={{
          background: 'var(--surface-2, #F3F4F6)',
          borderTop: '1px solid var(--border-soft, rgba(0,0,0,0.06))',
          color: 'var(--text-2, #6B7280)',
        }}
      >
        {session.prizePool > 0 && (
          <span className="font-mono font-bold" style={{ color: 'var(--text-1, #111827)' }}>
            ₩{Math.floor(session.prizePool / 10000)}만 GTD
          </span>
        )}
        {session.prizePool > 0 && <span aria-hidden style={{ color: 'var(--text-3, #9CA3AF)' }}>·</span>}
        <span>
          <span className="font-mono font-bold" style={{ color: 'var(--text-2, #6B7280)' }}>
            {session.playersRemaining}
          </span>
          <span className="font-mono" style={{ color: 'var(--text-3, #9CA3AF)' }}>
            /{session.totalPlayers}
          </span>
          명
        </span>
        <span aria-hidden style={{ color: 'var(--text-3, #9CA3AF)' }}>·</span>
        {session.lateRegClosed ? (
          <span style={{ color: 'var(--text-3, #9CA3AF)' }}>등록 마감</span>
        ) : (
          <span
            className={lateMin <= 5 ? 'font-bold' : ''}
            style={{
              color: lateMin <= 5 ? 'var(--live, #E53E3E)' : 'var(--text-2, #6B7280)',
            }}
          >
            등록 {lateMin}분
          </span>
        )}
        {/* 우측 정렬 — 지역·거리 */}
        <span className="ml-auto flex items-center gap-1.5" style={{ color: 'var(--text-3, #9CA3AF)' }}>
          {locality && <span className="truncate max-w-[120px]">{locality}</span>}
          {locality && distance != null && <span aria-hidden>·</span>}
          {distance != null && <span className="font-mono">{formatDistance(distance)}</span>}
        </span>
      </div>
    </Link>
  );
}
