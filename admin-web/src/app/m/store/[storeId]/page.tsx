'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  doc,
  getDoc,
  setDoc,
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
import TournamentInterestStar from '@/components/mobile/TournamentInterestStar';

interface StoreData {
  name: string;
  address?: string;
  phone?: string;
  hours?: string;
  description?: string;
  facilities?: string[];
  photoUrls?: string[];
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
      setIsFav(false);
      return;
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
