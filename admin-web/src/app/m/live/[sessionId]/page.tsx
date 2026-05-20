'use client';

import { use, useEffect, useRef, useState } from 'react';
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
import {
  subscribeLiveSession,
  type LiveSession,
  fmtTime,
  computeLateRegMinutes,
  useLiveCountdown,
} from '@/lib/live';
import { callPhone, openDirections, shareContent } from '@/lib/actions';
import { bumpStoreMetric } from '@/lib/analytics';
import { enableNotifications, getNotificationPermission } from '@/lib/messaging';
import {
  playCountdownBeep,
  playFinalBeep,
  playBlindUp,
  unlockAudio,
} from '@/lib/sounds';

const SOUND_STORAGE_KEY = 'holdemnow:liveSoundOn';

export default function LiveFullscreen({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const authState = useAuth();
  const [session, setSession] = useState<LiveSession | null | undefined>(undefined);
  // 매장 연락처·주소 fetch (LIVE 풀스크린의 길찾기/전화용)
  const [storePhone, setStorePhone] = useState<string | undefined>();
  const [storeAddress, setStoreAddress] = useState<string | undefined>();
  useEffect(() => {
    if (!session?.storeId) return;
    getDoc(doc(db, 'stores', session.storeId)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data() as { phone?: string; address?: string };
        setStorePhone(data.phone);
        setStoreAddress(data.address);
      }
    });
  }, [session?.storeId]);

  // 즐겨찾기 상태 (매장 단위)
  const [isFav, setIsFav] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  useEffect(() => {
    if (authState.status !== 'authenticated' || !session?.storeId) {
      setIsFav(false);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'users', authState.user.uid, 'favorites', session.storeId),
      (snap) => setIsFav(snap.exists()),
      () => setIsFav(false),
    );
    return unsub;
  }, [authState, session?.storeId]);

  const toggleFavorite = async () => {
    if (!session) return;
    if (authState.status !== 'authenticated') {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch {
        return;
      }
      return; // 재구독해서 상태가 따라붙음
    }
    setFavBusy(true);
    try {
      const favRef = doc(db, 'users', authState.user.uid, 'favorites', session.storeId);
      if (isFav) {
        await deleteDoc(favRef);
      } else {
        await setDoc(favRef, {
          storeId: session.storeId,
          storeName: session.storeName,
          notifyOnLive: true,
          createdAt: serverTimestamp(),
        });
        bumpStoreMetric(session.storeId, 'favoriteAdds');
        if (getNotificationPermission() === 'default') {
          enableNotifications(authState.user.uid).catch(() => {});
        }
      }
    } finally {
      setFavBusy(false);
    }
  };

  useEffect(() => {
    const unsub = subscribeLiveSession(sessionId, setSession, () => setSession(null));
    return unsub;
  }, [sessionId]);

  // LIVE 풀스크린 열림 = liveOpen 1회 (sessionId 단위로 dedupe)
  const trackedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!session?.storeId || trackedSessionRef.current === session.id) return;
    trackedSessionRef.current = session.id;
    bumpStoreMetric(session.storeId, 'liveOpens');
  }, [session?.id, session?.storeId]);

  // 절대 시각(levelEndsAt) 기반 카운트다운 — 폰 재접속해도 정확
  const sec = useLiveCountdown(session ?? null);

  // ─── 사운드 (카운트다운 비프 · 블라인드업 알림) ───────────────────
  // 풀스크린 LIVE 페이지에서만 활성 — 사장님이 실제로 화면 켜놓고 보는 페이지.
  const prevSecRef = useRef<number | null>(null);
  const prevLevelRef = useRef<number | null>(null);
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(SOUND_STORAGE_KEY) !== 'off';
  });

  // mount 시 AudioContext unlock 시도 (iOS Safari 등)
  useEffect(() => {
    unlockAudio();
  }, []);

  // 토글 상태 영속화
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SOUND_STORAGE_KEY, soundOn ? 'on' : 'off');
  }, [soundOn]);

  // sec/level 변화 감지 → 비프/블라인드업 트리거
  useEffect(() => {
    if (!session) {
      prevSecRef.current = null;
      prevLevelRef.current = null;
      return;
    }
    const prevSec = prevSecRef.current;
    const prevLevel = prevLevelRef.current;
    const currLevel = session.currentLevel;
    const running = session.status === 'running';

    if (soundOn && running) {
      // 레벨 전환 감지 — 블라인드업!
      if (prevLevel != null && currLevel > prevLevel) {
        playBlindUp();
      }
      // 카운트다운 비프 — sec이 새로운 값으로 줄어들 때 트리거
      if (prevSec != null && prevSec !== sec) {
        if (sec === 1) {
          playFinalBeep();
        } else if (sec >= 2 && sec <= 5) {
          playCountdownBeep();
        }
      }
    }

    prevSecRef.current = sec;
    prevLevelRef.current = currLevel;
  }, [sec, soundOn, session]);

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-gray-500 flex items-center justify-center text-sm">
        로딩 중…
      </div>
    );
  }
  if (!session || session.status === 'completed') {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-3xl mb-3">●</div>
          <div className="font-bold mb-2">LIVE가 종료되었습니다</div>
          <button onClick={() => router.replace('/m')} className="text-xs text-gray-400 underline">
            홈으로
          </button>
        </div>
      </div>
    );
  }

  const paused = session.status === 'paused';
  const lateMin = computeLateRegMinutes(session, sec);
  const nextBlind = session.blindStructure.find((l) => l.level === session.currentLevel + 1);
  // 10초 이하 빨강 강조 (running 중일 때만) — 사용자 요청 핵심
  const isWarning = !paused && sec > 0 && sec <= 10 && session.status === 'running';

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col">
      {/* 상단 — 닫기 / 사운드 / 공유 */}
      <div className="px-5 pt-12 pb-2 flex justify-between items-center">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-full bg-[#1A1A1A] flex items-center justify-center text-base"
        >
          ✕
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              unlockAudio(); // 사용자 첫 토글 시 확실히 unlock
              setSoundOn((s) => !s);
            }}
            aria-label={soundOn ? '사운드 끄기' : '사운드 켜기'}
            title={soundOn ? '사운드 끄기' : '사운드 켜기'}
            className="w-9 h-9 rounded-full bg-[#1A1A1A] flex items-center justify-center text-sm"
          >
            {soundOn ? '🔊' : '🔇'}
          </button>
          <button
            onClick={() => session && shareContent({ title: session.tournamentName, text: `${session.storeName} — ${session.tournamentName} 진행 중` })}
            className="w-9 h-9 rounded-full bg-[#1A1A1A] flex items-center justify-center text-sm"
            title="공유"
          >
            ↗
          </button>
        </div>
      </div>

      {/* 매장 + 토너 */}
      <div className="text-center pt-6 px-6">
        <div className="text-xs text-gray-400">{session.storeName}</div>
        <div className="text-2xl font-extrabold tracking-tight mt-1 font-serif">
          {session.tournamentName}
        </div>
      </div>

      {/* LIVE / PAUSED 표시 */}
      <div className="flex items-center justify-center gap-2 pt-6">
        {paused ? (
          <>
            <span className="text-amber-400 font-extrabold tracking-widest text-xs">⏸ PAUSED</span>
          </>
        ) : (
          <>
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-500 font-extrabold tracking-widest text-xs">LIVE</span>
          </>
        )}
      </div>

      <div className="text-center text-[10px] text-gray-500 tracking-widest pt-4">
        LEVEL {session.currentLevel}
      </div>

      {/* 거대 카운트다운 — 10초 이내 빨강 + pulse */}
      <div className="text-center px-4 mt-2">
        <div
          className={`font-mono font-extrabold leading-none ${isWarning ? 'animate-pulse' : ''}`}
          style={{
            fontSize: '96px',
            letterSpacing: '-0.04em',
            color: paused ? '#A8A8A8' : isWarning ? '#FF4757' : '#fff',
          }}
        >
          {fmtTime(sec)}
        </div>
      </div>

      {/* 블라인드 */}
      <div className="text-center pt-6">
        <div className="text-[10px] text-gray-500 tracking-widest mb-1">BLINDS</div>
        <div className="font-mono text-2xl font-bold">
          {session.smallBlind} / {session.bigBlind}
        </div>
        {session.ante > 0 && (
          <div className="font-mono text-xs text-gray-500 mt-1">Ante {session.ante}</div>
        )}
      </div>

      <div className="h-px bg-[#2A2A2A] mx-10 mt-6" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 px-5 pt-5">
        <Stat label="PLAYERS" value={`${session.playersRemaining}/${session.totalPlayers}`} sub={`${session.tablesRemaining}테이블`} />
        <Stat label="PRIZE POOL" value={`₩${Math.floor(session.prizePool / 10000)}만`} sub="" />
        <Stat
          label="LATE REG"
          value={session.lateRegClosed ? '마감' : `${lateMin}분`}
          sub={session.lateRegClosed ? '' : '남음'}
          highlight={!session.lateRegClosed && lateMin <= 5}
        />
      </div>

      {nextBlind && (
        <div className="text-center text-[11px] text-gray-500 mt-6">
          NEXT · Lv {nextBlind.level} ·{' '}
          <span className="font-mono">
            {nextBlind.sb}/{nextBlind.bb}
          </span>
        </div>
      )}

      {/* 하단 CTA */}
      <div className="mt-auto px-5 pt-6 pb-8">
        <button
          onClick={() => {
            bumpStoreMetric(session.storeId, 'directionsClicks');
            openDirections(session.storeName, storeAddress);
          }}
          className="w-full h-14 bg-white text-black rounded-2xl font-extrabold text-base"
        >
          지금 가기 · 길찾기 시작
        </button>
        <div className="flex justify-around pt-4 text-xs text-gray-300">
          <button
            onClick={() => {
              bumpStoreMetric(session.storeId, 'phoneClicks');
              callPhone(storePhone);
            }}
            className="flex flex-col items-center gap-1"
          >
            <span>📞</span><span>전화</span>
          </button>
          <button
            onClick={toggleFavorite}
            disabled={favBusy}
            className="flex flex-col items-center gap-1 disabled:opacity-50"
          >
            <span className={isFav ? 'text-red-500 text-base' : 'text-base'}>
              {isFav ? '♥' : '♡'}
            </span>
            <span>{isFav ? '즐겨찾기됨' : '즐겨찾기'}</span>
          </button>
          <button onClick={() => router.push(`/m/store/${session.storeId}`)} className="flex flex-col items-center gap-1">
            <span>🏬</span><span>매장정보</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-gray-500 tracking-widest">{label}</div>
      <div className={`font-mono text-lg font-extrabold mt-1.5 ${highlight ? 'text-red-500' : 'text-white'}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
