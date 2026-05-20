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
 * LIVE 카드 — 컴팩트 2단 레이아웃.
 * - 좌측 4px 핑크 라인 (브랜드 강조 / paused: 노랑 / finishing: 빨강)
 * - 흰 배경 + 토큰 기반 색상 (라이트·다크 자동 대응)
 * - 정보 한눈에: 매장·LIVE·거리·타이머 → 토너명·레벨 → 메트릭 inline
 * ========================================================== */

function LiveCard({ session, distance, locality }: { session: LiveSession; distance?: number; locality?: string }) {
  const sec = useLiveCountdown(session);
  const isPaused = session.status === 'paused';
  const lowTime = sec <= 10 && !isPaused;
  const lateMin = computeLateRegMinutes(session, sec);
  const graceSec = computeFinishingGraceSec(session);
  const isFinishing = graceSec != null && graceSec > 0;
  // 포스터 스타일은 후속 확장 여지를 위해 import 유지하되 본 컴파일러에는 미사용
  void posterStyleFor;

  // 좌측 라인 컬러 — 상태별
  const accentColor = isFinishing
    ? 'var(--live, #ef4444)'
    : isPaused
      ? '#f59e0b'
      : 'var(--brand, #FF1F8F)';

  return (
    <Link
      href={`/m/live/${session.id}`}
      onClick={() => bumpStoreMetric(session.storeId, 'liveOpens')}
      className={`relative block rounded-2xl overflow-hidden active:scale-[0.99] transition ${isFinishing ? 'animate-pulse' : ''}`}
      style={{
        background: 'var(--surface-1, #ffffff)',
        border: '1px solid var(--border, #e5e7eb)',
      }}
    >
      {/* 좌측 4px 강조 라인 */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: accentColor }}
      />

      <div className="pl-4 pr-3.5 py-3">
        {/* 1행 — LIVE 배지 · 매장명 (좌) / 거리 · 타이머 (우) */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {isFinishing ? (
              <span
                className="text-[10px] font-extrabold tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ background: 'var(--live, #ef4444)', color: '#ffffff' }}
              >
                곧 종료
              </span>
            ) : isPaused ? (
              <span className="text-[10px] font-extrabold tracking-wider flex-shrink-0" style={{ color: '#b45309' }}>
                PAUSED
              </span>
            ) : (
              <>
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
                  style={{ background: 'var(--live, #ef4444)' }}
                />
                <span
                  className="text-[10px] font-extrabold tracking-wider flex-shrink-0"
                  style={{ color: 'var(--live, #ef4444)' }}
                >
                  LIVE
                </span>
              </>
            )}
            <span
              className="text-[14px] font-extrabold truncate"
              style={{ color: 'var(--text-1, #111827)' }}
            >
              {session.storeName}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {distance != null && (
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-3, #6b7280)' }}>
                {formatDistance(distance)}
              </span>
            )}
            <span
              className={`font-mono text-[18px] font-extrabold leading-none ${lowTime ? '' : ''}`}
              style={{
                color: isFinishing
                  ? 'var(--live, #ef4444)'
                  : lowTime
                    ? 'var(--live, #ef4444)'
                    : isPaused
                      ? '#b45309'
                      : 'var(--text-1, #111827)',
              }}
            >
              {isFinishing && graceSec != null ? fmtTime(graceSec) : fmtTime(sec)}
            </span>
          </div>
        </div>

        {/* 2행 — 지역 (있을 때만) */}
        {locality && (
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3, #6b7280)' }}>
            {locality}
          </div>
        )}

        {/* 3행 — 토너명 + 레벨 */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div
            className="text-[13px] font-bold truncate min-w-0 flex-1"
            style={{ color: 'var(--text-1, #111827)' }}
          >
            {session.tournamentName}
          </div>
          <span
            className="text-[11px] font-bold flex-shrink-0 px-1.5 py-0.5 rounded"
            style={{
              background: 'var(--surface-2, #f3f4f6)',
              color: 'var(--text-2, #374151)',
            }}
          >
            Lv {session.currentLevel}
          </span>
        </div>

        {/* 4행 — 메트릭 inline (블라인드 · 인원 · 상금 · 등록) */}
        <div
          className="mt-1.5 flex items-center gap-1.5 text-[11px] flex-wrap"
          style={{ color: 'var(--text-3, #6b7280)' }}
        >
          <span className="font-mono" style={{ color: 'var(--text-2, #374151)' }}>
            {session.smallBlind}/{session.bigBlind}
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-mono font-bold" style={{ color: 'var(--text-2, #374151)' }}>
              {session.playersRemaining}
            </span>
            <span className="font-mono">/{session.totalPlayers}</span>명
          </span>
          {session.prizePool > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono font-bold" style={{ color: 'var(--text-2, #374151)' }}>
                ₩{Math.floor(session.prizePool / 10000)}만
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          {session.lateRegClosed ? (
            <span style={{ color: 'var(--text-3, #6b7280)' }}>등록 마감</span>
          ) : (
            <span
              className={lateMin <= 5 ? 'font-bold' : ''}
              style={{
                color: lateMin <= 5 ? 'var(--live, #ef4444)' : 'var(--text-3, #6b7280)',
              }}
            >
              등록 {lateMin}분
            </span>
          )}
          {session.buyIn > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono">바이인 ₩{session.buyIn.toLocaleString()}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
