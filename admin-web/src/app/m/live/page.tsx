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
          const data = d.data() as { lat?: number; lng?: number; address?: string };
          map[d.id] = { lat: data.lat, lng: data.lng, address: data.address };
        });
        setStoresById(map);
      } catch {
        /* skip — 거리·지역 정보 없음으로 폴백 */
      }
    })();
  }, []);

  // 30km 필터 + 거리 정렬
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
 * LIVE 카드 — 정보 풍부한 한 줄. 타이머 + 레벨 + 블라인드 + 인원 + 상금
 * ========================================================== */

function LiveCard({ session, distance, locality }: { session: LiveSession; distance?: number; locality?: string }) {
  const sec = useLiveCountdown(session);
  const poster = posterStyleFor(session.posterStyle);
  const isPaused = session.status === 'paused';
  const lowTime = sec <= 10 && !isPaused;
  const lateMin = computeLateRegMinutes(session, sec);

  return (
    <Link
      href={`/m/live/${session.id}`}
      onClick={() => bumpStoreMetric(session.storeId, 'liveOpens')}
      className="block bg-white border border-gray-200 rounded-2xl overflow-hidden active:scale-[0.99] transition"
    >
      {/* 상단 — 매장명·거리·지역 (앱 테마 핑크) */}
      <div
        className="px-4 pt-3 pb-2.5 flex items-start justify-between gap-2"
        style={{ background: '#FF1F8F' }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isPaused ? (
              <span className="text-[10px] font-extrabold tracking-wider text-white/85">⏸ PAUSED</span>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span className="text-[10px] font-extrabold tracking-wider text-white">LIVE</span>
              </>
            )}
            <span className="text-sm font-extrabold text-white truncate">{session.storeName}</span>
          </div>
          {locality && (
            <div className="text-[11px] font-medium text-white/85 mt-0.5 truncate">📍 {locality}</div>
          )}
        </div>
        {distance != null && (
          <span className="text-xs font-extrabold text-white flex-shrink-0 mt-0.5">{formatDistance(distance)}</span>
        )}
      </div>

      {/* 토너 이름 + 바이인 — 포스터 컬러 강조 */}
      <div
        className="px-4 py-2.5 flex items-center justify-between gap-2"
        style={{ background: poster.bg, color: poster.color }}
      >
        <div className="min-w-0">
          <div className="text-sm font-extrabold truncate font-serif">{session.tournamentName}</div>
          {session.buyIn > 0 && (
            <div className="text-[11px] font-bold opacity-80 mt-0.5">
              바이인 ₩{session.buyIn.toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {/* 핵심 지표 — 4컬럼 */}
      <div className="grid grid-cols-4 divide-x divide-gray-100">
        <Stat
          label="남은 시간"
          value={
            <span className={`font-mono ${lowTime ? 'text-red-500' : isPaused ? 'text-amber-700' : 'text-gray-900'}`}>
              {fmtTime(sec)}
            </span>
          }
          highlight
        />
        <Stat label="레벨" value={<>Lv {session.currentLevel}</>} />
        <Stat
          label="블라인드"
          value={
            <span className="font-mono text-[13px]">
              {session.smallBlind}/{session.bigBlind}
            </span>
          }
        />
        <Stat
          label="인원"
          value={
            <>
              {session.playersRemaining}<span className="text-[10px] text-gray-500">/{session.totalPlayers}</span>
            </>
          }
        />
      </div>

      {/* 부가 정보 — 상금 + 등록 마감 */}
      <div className="px-4 py-2.5 border-t border-gray-100 grid grid-cols-2 gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500">🎁 상금</span>
          <span className="text-xs font-extrabold text-gray-900 font-mono">
            ₩{Math.floor(session.prizePool / 10000)}만
          </span>
        </div>
        <div className="flex items-center gap-1.5 justify-end">
          {session.lateRegClosed ? (
            <span className="text-[10px] text-gray-400">등록 마감</span>
          ) : (
            <>
              <span className="text-[10px] text-gray-500">⏰ 등록</span>
              <span className={`text-xs font-extrabold font-mono ${lateMin <= 5 ? 'text-red-500' : 'text-gray-900'}`}>
                {lateMin}분 남음
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="px-2.5 py-3 text-center">
      <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1">{label}</div>
      <div className={`font-extrabold ${highlight ? 'text-lg' : 'text-sm'} text-gray-900`}>{value}</div>
    </div>
  );
}
