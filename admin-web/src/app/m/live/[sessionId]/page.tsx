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
  useLiveTimelineTick,
  advanceLevelIfDue,
  isLiveOnBreak,
  resolveNextPlayLevel,
} from '@/lib/live';
import { callPhone, openDirections, shareContent } from '@/lib/actions';
import { bumpStoreMetric } from '@/lib/analytics';
import { enableNotifications, getNotificationPermission } from '@/lib/messaging';
import {
  playCountdownBeep,
  playBlindUp,
  unlockAudio,
} from '@/lib/sounds';
import { resolveDisplayedLevel } from '@/lib/templates';

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

  // 절대 시각 기반 카운트다운 + wrap 처리 (사용자 폰 스피커 사운드 책임)
  const tick = useLiveTimelineTick(session ?? null, { handleWrap: true });
  const sec = tick?.secondsLeft ?? 0;

  // ─── 사운드 (카운트다운 비프 · 블라인드업 알림) ───────────────────
  // 풀스크린 LIVE 페이지에서만 활성 — 사용자가 화면 켜놓고 보는 페이지.
  const prevSecRef = useRef<number | null>(null);
  const prevLevelRef = useRef<number | null>(null);
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(SOUND_STORAGE_KEY) !== 'off';
  });

  // mount 시 AudioContext unlock 시도 (iOS Safari 등) + 첫 사용자 제스처에 한 번 더
  useEffect(() => {
    unlockAudio();
    const handler = () => unlockAudio();
    window.addEventListener('click', handler, { once: true });
    window.addEventListener('touchstart', handler, { once: true });
    return () => {
      window.removeEventListener('click', handler);
      window.removeEventListener('touchstart', handler);
    };
  }, []);

  // 토글 상태 영속화
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SOUND_STORAGE_KEY, soundOn ? 'on' : 'off');
  }, [soundOn]);

  // 블라인드업 중복 차단 — 같은 cycle에서 두 번 발사 방지.
  // 클라 sec=0 즉시 호출 + 서버 currentLevel 변경 호출 둘 다 발사되지 않도록.
  const blindUpFiredCycleRef = useRef<string>('');

  // 사운드 트리거 (2026-05-23 정책): 10초~1초 매초 비프(10회), 0초 도달 직후 즉시
  // Blind up! TTS (autoAdvanceLevel cron 1분 주기로 인한 10~20초 지연 회피).
  //
  // ⚠ prev 갱신을 비프 트리거와 같은 useEffect 마지막에 두는 게 중요. 별도 effect로
  // 분리하면 React가 같은 dep으로 둘 다 실행하며 prev가 먼저 갱신돼 비교 항상 같음 →
  // 비프 미발사 (Bug 2026-05-23).
  useEffect(() => {
    if (!session || session.status !== 'running') {
      prevSecRef.current = sec;
      return;
    }
    const prevSec = prevSecRef.current;
    if (soundOn && prevSec != null) {
      if (prevSec !== sec && sec >= 1 && sec <= 10) {
        playCountdownBeep();
      }
      // sec=0 도달 즉시 blindUp (서버 cron 대기 X).
      // 마지막 레벨/break 같은 경우 graceSec != null이라 currentLevel가 안 변경됨 → skip.
      // 2026-05-28 #8: playBlindUp/advance 호출 제거 — lib 단일 경로.
      if (prevSec > 0 && sec === 0) {
        const lv = session.currentLevel;
        const cycleKey = `lv${lv}-${session.id}`;
        if (blindUpFiredCycleRef.current !== cycleKey) {
          blindUpFiredCycleRef.current = cycleKey;
          // playBlindUp/advance 호출 X
        }
      }
    }
    prevSecRef.current = sec;
  }, [sec, soundOn, session]);

  // 블라인드업 백업 — 서버 currentLevel 변경 시점에 1회 (페이지 새로고침 직후 등
  // 클라가 sec=0을 놓친 경우 대비). 동일 cycle key면 skip.
  useEffect(() => {
    if (!soundOn) return;
    if (!session || session.status !== 'running') return;
    const prevLevel = prevLevelRef.current;
    const currLevel = session.currentLevel;
    if (prevLevel != null && currLevel > prevLevel) {
      // 2026-05-28: 백업 트리거에서 playBlindUp 호출 제거 — 메인 트리거(sec===0)와
      // 중복 발화 차단. cycleKey 마킹만 유지.
      const cycleKey = `lv${currLevel}-${session.id}`;
      if (blindUpFiredCycleRef.current !== cycleKey) {
        blindUpFiredCycleRef.current = cycleKey;
        // playBlindUp 호출 X
      }
    }
    prevLevelRef.current = currLevel;
  }, [session?.currentLevel, soundOn, session]);

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-3 h-3 mx-auto mb-3 rounded-full bg-[#E53E3E] animate-pulse" />
          <div className="text-sm font-bold text-white tracking-wider">LIVE 불러오는 중</div>
        </div>
      </div>
    );
  }
  if (!session || session.status === 'completed') {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-5xl mb-3" aria-hidden>●</div>
          <div className="text-lg font-extrabold mb-1.5 font-serif">LIVE가 종료되었습니다</div>
          <div className="text-xs text-white/60 mb-5">매장에서 새 LIVE를 시작하면 여기서 다시 볼 수 있어요</div>
          <button
            onClick={() => router.replace('/m')}
            className="px-5 py-2.5 rounded-full text-[13px] font-bold tap"
            style={{ background: '#FF1F8F', color: '#fff', boxShadow: '0 2px 12px rgba(255,31,143,0.30)' }}
          >
            홈으로
          </button>
        </div>
      </div>
    );
  }

  const paused = session.status === 'paused';
  // 2026-05-24: BREAK — amber 톤
  const onBreak = isLiveOnBreak(session);
  const nextPlay = onBreak ? resolveNextPlayLevel(session) : null;
  const lateMin = computeLateRegMinutes(session, sec);
  const structureForNext =
    session.blindStructureLocked && session.blindStructureLocked.length > 0
      ? session.blindStructureLocked
      : session.blindStructure;
  const nextBlind = structureForNext.find((l) => l.level === session.currentLevel + 1);
  // 10초 이하 빨강 강조 (running 중일 때만) — 사용자 요청 핵심.
  // BREAK일 땐 위험 강조 X (휴식 끝 카운트다운).
  const isWarning = !paused && !onBreak && sec > 0 && sec <= 10 && session.status === 'running';

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

      {/* LIVE / PAUSED / BREAK 표시 — 2026-05-24: BREAK 케이스 추가 */}
      <div className="flex items-center justify-center gap-2 pt-6">
        {onBreak ? (
          <>
            <span
              className="font-extrabold tracking-widest text-sm px-3 py-1 rounded-full"
              style={{
                background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                color: '#1F1300',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.30), 0 0 16px rgba(245,158,11,0.55)',
              }}
            >
              ☕ BREAK · 휴식 중
            </span>
          </>
        ) : paused ? (
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
        {/* 2026-05-24 정정 #1: 브레이크는 레벨 번호 X. play 레벨만 displayedNumber. */}
        {(() => {
          const disp = resolveDisplayedLevel(structureForNext, session.currentLevel);
          if (disp.isBreak) return '☕ BREAK';
          return `LEVEL ${disp.displayedNumber ?? session.currentLevel}`;
        })()}
      </div>

      {/* 거대 카운트다운 — 10초 이내 빨강 + pulse. BREAK은 amber.
          2026-05-24: BREAK일 땐 색·라벨 모두 amber로 휴식 인지 강화 */}
      <div className="text-center px-4 mt-2">
        <div
          className={`font-mono font-extrabold leading-none ${isWarning ? 'animate-pulse' : ''}`}
          style={{
            fontSize: '96px',
            letterSpacing: '-0.04em',
            color: onBreak ? '#FBBF24' : paused ? '#A8A8A8' : isWarning ? '#FF4757' : '#fff',
            textShadow: onBreak ? '0 2px 18px rgba(245,158,11,0.5)' : undefined,
          }}
        >
          {fmtTime(sec)}
        </div>
        {onBreak && (
          <div className="text-amber-300/90 text-xs font-bold tracking-widest mt-2">
            휴식 남은 시간
            {nextPlay && (
              <span className="text-amber-200/70">
                {' · '}끝나면 LV {nextPlay.displayedNumber} ({nextPlay.sb.toLocaleString()}/{nextPlay.bb.toLocaleString()})
              </span>
            )}
          </div>
        )}
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

      {/* Stats — 상금풀 표기 제거 (법적 리스크). 2-col 균형 레이아웃 */}
      <div className="grid grid-cols-2 gap-2 px-5 pt-5">
        <Stat label="PLAYERS" value={`${session.playersRemaining}/${session.totalPlayers}`} sub={`${session.tablesRemaining}테이블`} />
        <Stat
          label="LATE REG"
          value={session.lateRegClosed ? '마감' : `${lateMin}분`}
          sub={session.lateRegClosed ? '' : '남음'}
          highlight={!session.lateRegClosed && lateMin <= 5}
        />
      </div>

      {nextBlind && (
        <div className="mx-5 mt-6">
          <div
            className={`rounded-2xl px-5 py-4 border ${
              nextBlind.isBreak
                ? 'bg-amber-500/10 border-amber-500/40'
                : 'bg-white/5 border-white/15'
            }`}
          >
            <div
              className={`text-[10px] font-extrabold tracking-[0.3em] mb-1.5 text-center ${
                nextBlind.isBreak ? 'text-amber-400' : 'text-red-400'
              }`}
            >
              ▶ NEXT
            </div>
            {nextBlind.isBreak ? (
              <div className="text-center font-extrabold text-amber-300 text-lg">
                ☕ 휴식 {Math.round(nextBlind.durationSec / 60)}분
              </div>
            ) : (
              <div className="flex items-baseline justify-center gap-3 flex-wrap">
                <div className="text-[10px] font-extrabold tracking-widest text-gray-500">
                  {/* 2026-05-24 정정 #1: displayedNumber로. */}
                  LV {resolveDisplayedLevel(structureForNext, nextBlind.level).displayedNumber ?? nextBlind.level}
                </div>
                <div className="font-mono font-extrabold tabular-nums text-white text-2xl leading-none">
                  {nextBlind.sb.toLocaleString()}
                  <span className="text-gray-500 mx-1.5">/</span>
                  {nextBlind.bb.toLocaleString()}
                </div>
                {nextBlind.ante ? (
                  <div className="font-mono text-xs text-gray-400 font-bold">
                    ante {nextBlind.ante.toLocaleString()}
                  </div>
                ) : null}
              </div>
            )}
          </div>
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
