'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import { subscribeStoreLiveSessions, type LiveSession, fmtTime, computeLateRegMinutes, useLiveCountdown } from '@/lib/live';
import { subscribeStoreTournaments, type TournamentInstance } from '@/lib/tournaments';
import { posterStyleFor } from '@/lib/templates';
import { callPhone, openDirections, shareContent } from '@/lib/actions';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { enableNotifications, getNotificationPermission } from '@/lib/messaging';
import { loadKakaoMaps, geocodeAddress } from '@/lib/kakao';
import TournamentInterestStar from '@/components/mobile/TournamentInterestStar';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface StoreData {
  name: string;
  address?: string;
  phone?: string;
  hours?: string;
  description?: string;
  facilities?: string[];
  photoUrls?: string[];
  lat?: number;
  lng?: number;
}

export default function MobileStorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = use(params);
  const router = useRouter();
  const authState = useAuth();
  const [store, setStore] = useState<StoreData | null | undefined>(undefined);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [tournaments, setTournaments] = useState<TournamentInstance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeStoreTournaments(storeId, setTournaments, () => {});
    return unsub;
  }, [storeId]);

  // 매장 상세 진입 = impression 1회
  useEffect(() => {
    trackImpressionOnce(storeId, 'store-detail');
  }, [storeId]);
  const [isFav, setIsFav] = useState(false);
  const [favBusy, setFavBusy] = useState(false);

  // 즐겨찾기 상태 구독
  useEffect(() => {
    if (authState.status !== 'authenticated') {
      const tid = setTimeout(() => setIsFav(false), 0);
      return () => clearTimeout(tid);
    }
    const unsub = onSnapshot(
      doc(db, 'users', authState.user.uid, 'favorites', storeId),
      (snap) => setIsFav(snap.exists()),
      () => setIsFav(false),
    );
    return unsub;
  }, [authState, storeId]);

  const toggleFavorite = async () => {
    if (authState.status !== 'authenticated') {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch {
        return;
      }
      return; // 로그인 popup 후 useEffect가 재구독해서 상태 갱신
    }
    if (!store) return;
    setFavBusy(true);
    try {
      const favRef = doc(db, 'users', authState.user.uid, 'favorites', storeId);
      if (isFav) {
        await deleteDoc(favRef);
      } else {
        await setDoc(favRef, {
          storeId,
          storeName: store.name,
          notifyOnLive: true,
          createdAt: serverTimestamp(),
        });
        bumpStoreMetric(storeId, 'favoriteAdds');
        // 즐겨찾기 추가 시 알림 권한 요청 (default 상태에서만 — 이미 거부됐으면 무리하지 않음)
        if (getNotificationPermission() === 'default') {
          enableNotifications(authState.user.uid).catch(() => {});
        }
      }
    } finally {
      setFavBusy(false);
    }
  };

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, 'stores', storeId));
      setStore(snap.exists() ? (snap.data() as StoreData) : null);
    })();
  }, [storeId]);

  // 좌표 없는 매장은 주소로 1회 geocoding → Firestore 캐시 + 로컬 반영
  useEffect(() => {
    if (!store || !store.address) return;
    if (store.lat != null && store.lng != null) return;
    let cancelled = false;
    (async () => {
      try {
        const coords = await geocodeAddress(store.address!);
        if (cancelled || !coords) return;
        setStore((prev) => (prev ? { ...prev, lat: coords.lat, lng: coords.lng } : prev));
        updateDoc(doc(db, 'stores', storeId), { lat: coords.lat, lng: coords.lng }).catch(() => {
          // owner 아니면 권한 거부 — 메모리만 반영
        });
      } catch {
        // skip
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, storeId]);

  useEffect(() => {
    const unsub = subscribeStoreLiveSessions(
      storeId,
      (items) => {
        setSessions(items);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [storeId]);

  if (store === undefined) {
    return <div className="p-10 text-center text-sm text-gray-500">로딩 중…</div>;
  }
  if (store === null) {
    return (
      <div className="p-10 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <div className="font-bold mb-2">매장을 찾을 수 없습니다</div>
        <button onClick={() => router.replace('/m')} className="text-xs text-gray-500 underline">
          홈으로
        </button>
      </div>
    );
  }

  return (
    <div className="pb-20">
      {/* 상단 — 뒤로가기 + 매장명 */}
      <div className="sticky top-0 z-10 bg-white px-5 h-14 flex items-center justify-between border-b border-gray-100">
        <Link href="/m" className="text-xl">←</Link>
        <div className="font-bold text-sm truncate">{store.name}</div>
        <div className="w-6" />
      </div>

      {/* 매장 사진 (Storage) — 가로 스크롤 */}
      {store.photoUrls && store.photoUrls.length > 0 ? (
        <div className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none">
          {store.photoUrls.map((url, i) => (
            <div key={url} className="w-full flex-shrink-0 snap-center relative" style={{ aspectRatio: '4/3' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`매장 ${i + 1}`} className="w-full h-full object-cover" />
              {store.photoUrls && store.photoUrls.length > 1 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[10px] font-bold rounded-full px-2.5 py-1 backdrop-blur">
                  {i + 1} / {store.photoUrls.length}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="h-48 bg-gradient-to-br from-amber-100 to-amber-200 flex items-end justify-center pb-4">
          <div className="text-xs text-amber-900 font-bold opacity-60">사진 미등록</div>
        </div>
      )}

      {/* 매장 정보 */}
      <div className="px-5 py-4 border-b-[6px] border-gray-50">
        <div className="text-2xl font-extrabold tracking-tight text-gray-900 mb-2 font-serif">
          {store.name}
        </div>
        {store.description && <div className="text-sm text-gray-600 mb-3">{store.description}</div>}
        <div className="space-y-1 text-xs text-gray-600">
          {store.address && <div>📍 {store.address}</div>}
          {store.hours && <div>🕐 {store.hours}</div>}
          {store.phone && <div>📞 {store.phone}</div>}
        </div>
        {store.facilities && store.facilities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {store.facilities.map((f) => (
              <span key={f} className="text-[10px] bg-gray-100 text-gray-700 rounded-full px-2.5 py-1 font-bold">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 위치 — 미니맵 (틀 안에서 직접 드래그/줌) */}
      {store.lat != null && store.lng != null && (
        <div className="px-5 py-4 border-b-[6px] border-gray-50">
          <div className="text-xs font-extrabold text-gray-900 tracking-wider mb-3">
            🗺 위치
          </div>
          <StoreMiniMap lat={store.lat} lng={store.lng} name={store.name} />
          {store.address && (
            <div className="text-[11px] text-gray-500 mt-2">📍 {store.address}</div>
          )}
        </div>
      )}

      {/* LIVE 세션 멀티 타이머 그리드 */}
      {loading ? (
        <div className="p-6 text-center text-xs text-gray-500">LIVE 정보 로딩…</div>
      ) : sessions.length === 0 ? (
        <div className="p-6 text-center text-xs text-gray-500">
          현재 진행 중인 LIVE가 없습니다
        </div>
      ) : (
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-extrabold text-red-600 tracking-wider">
              LIVE 진행 중 {sessions.length > 1 ? `(${sessions.length}개)` : ''}
            </span>
          </div>
          <SessionTimerGrid sessions={sessions} />
        </div>
      )}

      {/* 예정 토너 */}
      {tournaments.length > 0 && (
        <div className="p-5 border-b-[6px] border-gray-50">
          <div className="text-xs font-extrabold text-gray-900 tracking-wider mb-3">
            📅 예정 토너 ({tournaments.length})
          </div>
          <div className="space-y-2">
            {tournaments.map((t) => {
              const poster = posterStyleFor(t.posterStyle);
              const d = t.startsAt.toDate();
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              return (
                <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3">
                  <div
                    className="w-10 h-12 rounded-md flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
                    style={{ background: poster.bg, color: poster.color }}
                  >
                    {t.name.split(' ')[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-900 truncate">{t.name}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      <span className="font-mono font-bold text-gray-900">
                        {d.getMonth() + 1}/{d.getDate()} {hh}:{mm}
                      </span>{' '}
                      · 바이인 ₩{t.buyIn.toLocaleString()}
                    </div>
                  </div>
                  {t.guarantee > 0 && (
                    <div className="text-[10px] font-extrabold text-red-600 bg-red-50 rounded px-1.5 py-0.5 flex-shrink-0">
                      GTD ₩{(t.guarantee / 10000).toFixed(0)}만
                    </div>
                  )}
                  <TournamentInterestStar tournament={t} size="sm" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="px-5 pb-6 flex gap-2">
        <button
          onClick={() => {
            bumpStoreMetric(storeId, 'directionsClicks');
            openDirections(store.name, store.address);
          }}
          className="flex-1 h-12 bg-black text-white rounded-xl font-bold text-sm flex items-center justify-center gap-1.5"
        >
          🗺 길찾기
        </button>
        <button
          onClick={() => {
            bumpStoreMetric(storeId, 'phoneClicks');
            callPhone(store.phone);
          }}
          disabled={!store.phone}
          className="w-12 h-12 border-[1.5px] border-gray-200 rounded-xl text-sm flex items-center justify-center disabled:opacity-40"
          title={store.phone ? `전화: ${store.phone}` : '전화번호 없음'}
        >
          📞
        </button>
        <button
          onClick={toggleFavorite}
          disabled={favBusy}
          className={`w-12 h-12 border-[1.5px] rounded-xl text-base flex items-center justify-center disabled:opacity-50 ${
            isFav ? 'bg-red-50 border-red-300 text-red-500' : 'bg-white border-gray-200'
          }`}
          title={isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        >
          {isFav ? '♥' : '♡'}
        </button>
        <button
          onClick={() => shareContent({ title: store.name, text: `${store.name} — HoldemNow에서 확인` })}
          className="w-12 h-12 border-[1.5px] border-gray-200 rounded-xl text-sm flex items-center justify-center"
          title="공유"
        >
          ↗
        </button>
      </div>
    </div>
  );
}

/**
 * 매장 상세 미니맵.
 * - 틀 안에서 직접 드래그/핀치 줌/더블클릭 줌 가능 — 별도 전체보기 모달 없음.
 * - 우상단 줌 컨트롤(+/-) 노출 — 카카오맵 표준 ZoomControl.
 * - 마커는 매장명 뱃지 SVG (다크 알약 + 흰 텍스트 + 꼬리 핀).
 */
function StoreMiniMap({
  lat,
  lng,
  name,
}: {
  lat: number;
  lng: number;
  name: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadKakaoMaps();
        if (cancelled || !containerRef.current || mapRef.current) return;
        const center = new maps.LatLng(lat, lng);
        mapRef.current = new maps.Map(containerRef.current, {
          center,
          level: 3,
          // 인터랙션 전부 허용 (default가 활성). 명시적으로 활성화 호출은 불필요.
        });
        // 줌 컨트롤(+/-) — 우상단
        const zoomControl = new maps.ZoomControl();
        mapRef.current.addControl(zoomControl, maps.ControlPosition.TOPRIGHT);
        // 매장명 뱃지 마커
        markerRef.current = new maps.Marker({
          position: center,
          map: mapRef.current,
          image: buildNameBadgeMarker(maps, name),
          title: name,
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lng, name]);

  // 좌표 갱신(geocoding 결과 도착 등) — 중심 + 마커 위치
  useEffect(() => {
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!mapRef.current || !maps) return;
    const pos = new maps.LatLng(lat, lng);
    mapRef.current.setCenter(pos);
    if (markerRef.current) markerRef.current.setPosition(pos);
  }, [lat, lng]);

  return (
    <div className="relative w-full h-56 rounded-xl overflow-hidden border border-gray-200">
      <div ref={containerRef} className="absolute inset-0" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 text-xs text-gray-500">
          지도 로드 실패
        </div>
      )}
    </div>
  );
}

/**
 * 매장명 뱃지 마커 — 다크 알약 + 흰색 매장명 + 아래 꼬리.
 * 너비는 매장명 길이에 맞춰 자동 (한글 약 13px/자, 영문 약 8px/자 보수 추정).
 */
function buildNameBadgeMarker(maps: any, name: string) {
  // 글자별 너비 추정 — 정확한 폰트 메트릭 대신 한글/영문 분기로 근사
  const widthOf = (s: string) =>
    Array.from(s).reduce((sum, ch) => sum + (/[ -~]/.test(ch) ? 8 : 13), 0);
  const PAD_X = 14;
  const TAIL_H = 8;
  const PILL_H = 28;
  const width = Math.max(60, widthOf(name) + PAD_X * 2);
  const height = PILL_H + TAIL_H;
  const cx = width / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0.5" y="0.5" width="${width - 1}" height="${PILL_H - 1}" rx="${PILL_H / 2}" fill="#1F2937" stroke="#0F172A" stroke-width="1"/><text x="${cx}" y="${PILL_H / 2 + 5}" fill="#fff" font-family="Pretendard,Inter,system-ui,-apple-system,sans-serif" font-size="12" font-weight="800" text-anchor="middle">${escapeSvg(name)}</text><polygon points="${cx - 6},${PILL_H} ${cx + 6},${PILL_H} ${cx},${PILL_H + TAIL_H}" fill="#1F2937" stroke="#0F172A" stroke-width="1"/></svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(width, height), {
    offset: new maps.Point(cx, height),
  });
}

function escapeSvg(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function SessionTimerGrid({ sessions }: { sessions: LiveSession[] }) {
  const cols = sessions.length === 1 ? 1 : sessions.length === 2 ? 2 : 3;
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {sessions.map((s) => (
        <TimerCard key={s.id} session={s} cols={cols} />
      ))}
    </div>
  );
}

function TimerCard({ session, cols }: { session: LiveSession; cols: number }) {
  const sizes = {
    1: { timer: 56, name: 16, meta: 12, p: 'p-5' },
    2: { timer: 36, name: 13, meta: 11, p: 'p-3.5' },
    3: { timer: 24, name: 11, meta: 10, p: 'p-2.5' },
  } as const;
  const sz = sizes[cols as 1 | 2 | 3];

  const sec = useLiveCountdown(session);
  const paused = session.status === 'paused';
  const lowTime = sec <= 10 && !paused;
  const lateMin = computeLateRegMinutes(session, sec);

  return (
    <Link
      href={`/m/live/${session.id}`}
      className={`block bg-red-50 rounded-2xl ${sz.p} active:scale-[0.98] transition`}
    >
      <div className="flex items-center gap-1 mb-1">
        {paused ? (
          <span className="text-[9px] font-extrabold text-amber-800 tracking-wider">⏸ PAUSED</span>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[9px] font-extrabold text-red-600 tracking-wider">LIVE</span>
          </>
        )}
      </div>
      <div className="font-bold text-gray-900 truncate" style={{ fontSize: `${sz.name}px` }}>
        {session.tournamentName}
      </div>
      <div
        className={`font-mono font-extrabold leading-none mt-1.5 ${
          lowTime ? 'text-red-500' : paused ? 'text-amber-800' : 'text-gray-900'
        }`}
        style={{ fontSize: `${sz.timer}px`, letterSpacing: '-0.03em' }}
      >
        {fmtTime(sec)}
      </div>
      <div className="text-gray-500 mt-1.5" style={{ fontSize: `${sz.meta}px` }}>
        Lv {session.currentLevel} · {session.playersRemaining}명
        {cols === 1 && (
          <span>
            {' '}
            · {session.lateRegClosed ? '등록 마감' : `등록 ${lateMin}분`}
          </span>
        )}
      </div>
    </Link>
  );
}
