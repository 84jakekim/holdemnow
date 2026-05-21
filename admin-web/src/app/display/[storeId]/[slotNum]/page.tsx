'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeSlot, type DisplaySlot } from '@/lib/slots';
import {
  subscribeLiveSession,
  type LiveSession,
  fmtTime,
  computeLateRegMinutes,
  useLiveCountdown,
  setTimeRemainingInSession,
} from '@/lib/live';
import {
  type TimerDisplaySettings,
  DEFAULT_TIMER_DISPLAY,
  subscribeTimerDisplay,
  buildBackgroundCss,
} from '@/lib/timerDisplay';
import { playCountdownBeep, playFinalBeep, playBlindUp, unlockAudio } from '@/lib/sounds';

interface StoreData {
  name: string;
}

export default function DisplayPage({
  params,
}: {
  params: Promise<{ storeId: string; slotNum: string }>;
}) {
  const { storeId, slotNum } = use(params);
  const slotNumInt = parseInt(slotNum, 10);

  const [slot, setSlot] = useState<DisplaySlot | null | undefined>(undefined);
  const [storeName, setStoreName] = useState<string>('매장 디스플레이');
  const [session, setSession] = useState<LiveSession | null | undefined>(undefined);
  const [display, setDisplay] = useState<TimerDisplaySettings>(DEFAULT_TIMER_DISPLAY);

  useEffect(() => {
    getDoc(doc(db, 'stores', storeId)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data() as StoreData;
        setStoreName(data.name);
      }
    });
  }, [storeId]);

  useEffect(() => {
    const unsub = subscribeSlot(storeId, slotNumInt, setSlot, () => setSlot(null));
    return unsub;
  }, [storeId, slotNumInt]);

  useEffect(() => {
    const unsub = subscribeTimerDisplay(storeId, setDisplay, () => {});
    return unsub;
  }, [storeId]);

  useEffect(() => {
    if (!slot?.sessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(null);
      return;
    }
    const unsub = subscribeLiveSession(slot.sessionId, setSession, () => setSession(null));
    return unsub;
  }, [slot?.sessionId]);

  // 절대 시각(levelEndsAt) 기반 카운트다운
  const sec = useLiveCountdown(session ?? null);

  // 사용자 첫 터치(또는 클릭) 시 오디오 활성화
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  // 사운드 트리거 — prev sec를 추적해 정확한 임계값에서만 1번 울리도록
  const prevSecRef = useRef<number>(sec);
  const prevLevelRef = useRef<number | undefined>(session?.currentLevel);
  useEffect(() => {
    const prev = prevSecRef.current;
    // 임계값 통과(prev > t && sec <= t)에서만 1회 울림
    if (session?.status === 'running') {
      if (display.soundWarn60 && prev > 60 && sec <= 60) playCountdownBeep();
      if (display.soundWarn30 && prev > 30 && sec <= 30) playCountdownBeep();
      // 마지막 5초 카운트다운 — 30s 옵션과 묶어 동작
      if (display.soundWarn30 && prev > 5 && sec <= 5 && sec > 0) playCountdownBeep();
      if (display.soundLevelEnd && prev > 0 && sec <= 0) playFinalBeep();
    }
    prevSecRef.current = sec;
  }, [sec, session?.status, display.soundWarn60, display.soundWarn30, display.soundLevelEnd]);

  // 레벨 전환 시 블라인드업 차임
  useEffect(() => {
    const prevLv = prevLevelRef.current;
    if (
      display.soundLevelEnd &&
      session?.status === 'running' &&
      prevLv != null &&
      session.currentLevel !== prevLv &&
      session.currentLevel > prevLv
    ) {
      playBlindUp();
    }
    prevLevelRef.current = session?.currentLevel;
  }, [session?.currentLevel, session?.status, display.soundLevelEnd]);

  // F11 안내 (한 번만)
  const [showHint, setShowHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(t);
  }, []);

  // 시계 (10초마다 갱신 — 디스플레이용이라 초 단위는 불필요)
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  // 동기화 상태
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [showStale, setShowStale] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  useEffect(() => {
    if (online) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowStale(false);
      return;
    }
    const t = setTimeout(() => setShowStale(true), 30_000);
    return () => clearTimeout(t);
  }, [online]);

  // 배경 CSS — 메모이즈
  const bgStyle = useMemo<React.CSSProperties>(() => ({ background: buildBackgroundCss(display) }), [display]);

  if (slot === undefined) {
    return <DarkScreen>로딩 중…</DarkScreen>;
  }
  if (slot === null) {
    return (
      <DarkScreen>
        <div className="text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <div className="text-2xl font-bold mb-2">슬롯이 존재하지 않습니다</div>
          <div className="text-sm text-gray-400">
            매장: <span className="font-mono">{storeId}</span> · 슬롯: <span className="font-mono">{slotNum}</span>
          </div>
        </div>
      </DarkScreen>
    );
  }

  const paused = session?.status === 'paused';
  const isRunning = session?.status === 'running';
  const lowTime = session && sec <= 10 && isRunning;
  const veryLow = session && sec <= 3 && isRunning;

  // 다음 블라인드 — 현재 구조에서 currentLevel + 1
  const structure = session?.blindStructureLocked && session.blindStructureLocked.length > 0
    ? session.blindStructureLocked
    : session?.blindStructure;
  const currentLevelObj = structure?.find((l) => l.level === session?.currentLevel);
  const nextBlind = structure?.find((l) => l.level === (session?.currentLevel ?? 0) + 1);
  const isCurrentBreak = currentLevelObj?.isBreak === true;

  // 현재 레벨 진행률
  const currentDur = currentLevelObj?.durationSec ?? 0;
  const progress = currentDur > 0 ? Math.min(1, Math.max(0, (currentDur - sec) / currentDur)) : 0;

  const lateMin = session ? computeLateRegMinutes(session, sec) : 0;
  const lateClosed = session
    ? session.lateRegClosed || session.currentLevel > session.lateRegEndLevel
    : false;
  // 5분 이내면 mm:ss 정밀
  const lateRegDisplay = session
    ? lateClosed
      ? '🔒 마감'
      : (() => {
          let total = sec;
          for (let lv = session.currentLevel + 1; lv <= session.lateRegEndLevel; lv++) {
            const item = session.blindStructure.find((l) => l.level === lv);
            if (item) total += item.durationSec;
          }
          return total < 300 ? fmtTime(Math.max(0, total)) : `${Math.ceil(total / 60)}분`;
        })()
    : '';

  const heroTitle = display.customTournamentTitle || session?.tournamentName || '대기 중';

  return (
    <div className="min-h-screen text-white flex flex-col relative overflow-hidden" style={bgStyle}>
      {/* 이미지 배경 시 어둠 overlay */}
      {display.backgroundType === 'image' && display.backgroundImageUrl && (
        <div className="absolute inset-0 pointer-events-none" style={{ background: `rgba(0,0,0,${display.overlayOpacity})` }} />
      )}

      {/* 상단: 좌상단 매장명/로고 · 우상단 시계 */}
      <div className="relative px-10 pt-8 flex items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          {display.storeLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={display.storeLogoUrl} alt="logo" className="h-12 w-12 rounded-lg object-cover" />
          )}
          <div>
            <div className="text-xs tracking-widest mb-1" style={{ color: display.textColor, opacity: 0.6 }}>
              STORE
            </div>
            <div className="text-2xl font-extrabold tracking-tight" style={{ color: display.textColor }}>
              {storeName}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] tracking-widest mb-1" style={{ color: display.textColor, opacity: 0.6 }}>
            {`${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(
              now.getDate(),
            ).padStart(2, '0')}`}{' '}
            ·{' '}
            {['일', '월', '화', '수', '목', '금', '토'][now.getDay()]}
          </div>
          <div className="font-mono text-2xl font-extrabold leading-none" style={{ color: display.textColor }}>
            {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
          </div>
          <div className="text-[10px] mt-2" style={{ color: display.textColor, opacity: 0.5 }}>
            {slot.name ?? `${slot.slotNum}번 TV`}
          </div>
        </div>
      </div>

      {/* 동기화 끊김 배너 */}
      {showStale && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-20 bg-amber-500/90 text-black px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 backdrop-blur shadow-lg">
          <span className="w-2 h-2 rounded-full bg-black animate-pulse" />
          동기화 중 · 네트워크 확인
        </div>
      )}

      {/* 중앙 */}
      {!session || session.status === 'completed' ? (
        <div className="relative flex-1 flex flex-col items-center justify-center">
          <div
            className="text-7xl font-extrabold mb-6"
            style={{ letterSpacing: '-0.04em', color: display.textColor, opacity: 0.3 }}
          >
            대기 중
          </div>
          <div className="text-sm max-w-md text-center leading-relaxed" style={{ color: display.textColor, opacity: 0.6 }}>
            어드민에서 이 슬롯에 LIVE 세션을 매핑하면
            <br />이 화면에 실시간 송출됩니다
          </div>
        </div>
      ) : (
        <div className="relative flex-1 flex flex-col justify-center items-center pb-10">
          {/* LIVE / PAUSED / BREAK */}
          <div className="flex items-center gap-3 mb-2">
            {paused ? (
              <span className="font-extrabold tracking-[0.3em] text-sm" style={{ color: '#FFD166' }}>
                ⏸ PAUSED
              </span>
            ) : isCurrentBreak ? (
              <span className="font-extrabold tracking-[0.3em] text-sm" style={{ color: '#FFD166' }}>
                ☕ BREAK
              </span>
            ) : (
              <>
                <span
                  className="w-3 h-3 rounded-full animate-pulse"
                  style={{ background: display.accentColor }}
                />
                <span
                  className="font-extrabold tracking-[0.3em] text-sm"
                  style={{ color: display.accentColor }}
                >
                  LIVE
                </span>
              </>
            )}
          </div>

          <div className="text-xs tracking-widest mb-6 max-w-[80%] truncate" style={{ color: display.textColor }}>
            {heroTitle}
          </div>
          <div className="text-[10px] tracking-[0.3em] mb-3" style={{ color: display.textColor, opacity: 0.7 }}>
            {isCurrentBreak ? `BREAK · ${currentLevelObj?.level ?? ''}레벨` : `LEVEL ${session.currentLevel}`}
          </div>

          {/* 거대 카운트다운 */}
          <div
            className={`font-mono font-extrabold leading-none transition-colors ${veryLow ? 'animate-pulse' : ''}`}
            style={{
              fontSize: 'clamp(150px, 18vw, 280px)',
              letterSpacing: '-0.05em',
              color: paused
                ? '#A8A8A8'
                : lowTime
                ? display.accentColor
                : isCurrentBreak
                ? '#FFD166'
                : display.timerColor,
              transition: 'color 0.2s',
            }}
          >
            {fmtTime(sec)}
          </div>

          {/* 진행률 바 — 드래그로 시간 조절 (running/paused) */}
          {(isRunning || paused) && currentDur > 0 && (
            <DisplayDraggableProgressBar
              session={session}
              currentSeconds={sec}
              currentDur={currentDur}
              progress={progress}
              barColor={lowTime ? display.accentColor : isCurrentBreak ? '#FFD166' : display.blindsColor}
              textColor={display.textColor}
            />
          )}

          {/* 블라인드 (break 아닐 때만 표시) */}
          {!isCurrentBreak && (
            <div className="mt-6 text-center">
              <div className="text-[10px] tracking-[0.3em] mb-2" style={{ color: display.textColor, opacity: 0.6 }}>
                BLINDS
              </div>
              <div
                className="font-mono font-extrabold"
                style={{ fontSize: 'clamp(36px, 5vw, 64px)', color: display.blindsColor }}
              >
                {session.smallBlind.toLocaleString()} / {session.bigBlind.toLocaleString()}
              </div>
              {session.ante > 0 && (
                <div className="font-mono text-base mt-2" style={{ color: display.textColor, opacity: 0.6 }}>
                  Ante {session.ante.toLocaleString()}
                </div>
              )}
            </div>
          )}

          {/* 하단 stats — PRIZE POOL 제거 (법적 리스크: 현금 상금 노출 금지) */}
          <div className="mt-10 grid grid-cols-2 gap-12 max-w-3xl">
            <Stat
              label="PLAYERS"
              value={`${session.playersRemaining}/${session.totalPlayers}`}
              sub={`${session.tablesRemaining}테이블`}
              color={display.textColor}
            />
            <Stat
              label="LATE REG"
              value={lateRegDisplay}
              sub={lateClosed ? '' : '남음'}
              highlight={!lateClosed && lateMin <= 5}
              color={display.textColor}
              accentColor={display.accentColor}
            />
          </div>

          {/* 다음 레벨 / 휴식 — 큰 박스로 강조 (관중·플레이어가 즉시 인지) */}
          {nextBlind && (
            <div
              className="mt-10 rounded-2xl px-8 py-5 border-2 backdrop-blur-sm"
              style={{
                background: 'rgba(0,0,0,0.45)',
                borderColor: nextBlind.isBreak ? '#FFD166' : `${display.accentColor}66`,
              }}
            >
              <div
                className="text-[11px] font-extrabold tracking-[0.35em] mb-2 text-center"
                style={{ color: nextBlind.isBreak ? '#FFD166' : display.accentColor }}
              >
                ▶ NEXT
              </div>
              {nextBlind.isBreak ? (
                <div
                  className="font-extrabold text-center"
                  style={{
                    color: '#FFD166',
                    fontSize: 'clamp(28px, 3.5vw, 44px)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  ☕ 휴식 {Math.round(nextBlind.durationSec / 60)}분
                </div>
              ) : (
                <div className="flex items-baseline justify-center gap-4 flex-wrap">
                  <div
                    className="text-xs tracking-[0.25em] font-extrabold opacity-70"
                    style={{ color: display.textColor }}
                  >
                    LV {nextBlind.level}
                  </div>
                  <div
                    className="font-mono font-extrabold tabular-nums leading-none"
                    style={{
                      fontSize: 'clamp(40px, 5.5vw, 72px)',
                      letterSpacing: '-0.03em',
                      color: display.blindsColor,
                    }}
                  >
                    {nextBlind.sb.toLocaleString()}
                    <span style={{ color: display.textColor, opacity: 0.4 }} className="mx-2">
                      /
                    </span>
                    {nextBlind.bb.toLocaleString()}
                  </div>
                  {nextBlind.ante ? (
                    <div
                      className="font-mono font-bold"
                      style={{
                        fontSize: 'clamp(14px, 1.6vw, 20px)',
                        color: display.textColor,
                        opacity: 0.7,
                      }}
                    >
                      ante {nextBlind.ante.toLocaleString()}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 공지 띠 (announcement) */}
      {display.announcement && session && session.status !== 'completed' && (
        <div
          className="relative px-10 py-3 text-center font-bold text-sm border-t"
          style={{
            background: 'rgba(0,0,0,0.35)',
            color: display.timerColor,
            borderColor: 'rgba(255,255,255,0.1)',
          }}
        >
          📢 {display.announcement}
        </div>
      )}

      {/* 워터마크 / 스폰서 */}
      <div className="relative px-10 pb-6 pt-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs" style={{ color: display.textColor, opacity: 0.5 }}>
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: display.accentColor }}
          />
          <span className="font-bold tracking-tight">HoldemNow</span>
          {display.sponsorText && (
            <span className="ml-3 tracking-widest text-[10px]" style={{ opacity: 0.8 }}>
              · {display.sponsorText}
            </span>
          )}
        </div>
        <div className="text-[10px] font-mono" style={{ color: display.textColor, opacity: 0.3 }}>
          display.holdemnow.com/{storeId}/slot/{slot.slotNum}
        </div>
      </div>

      {/* F11 안내 */}
      {showHint && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur text-white px-5 py-3 rounded-xl text-xs flex items-center gap-3 z-30">
          <span>💡 F11 풀스크린 · 화면을 한 번 클릭하면 사운드 활성화</span>
          <button onClick={() => setShowHint(false)} className="text-white/60 hover:text-white">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * TV 디스플레이용 드래그 진행바 — 사장이 매장 TV 옆에서 직접 조작.
 * LivePanel의 DraggableProgressBar와 동일 로직, 다크 테마 + 큰 hitbox.
 */
function DisplayDraggableProgressBar({
  session,
  currentSeconds,
  currentDur,
  progress,
  barColor,
  textColor,
}: {
  session: LiveSession;
  currentSeconds: number;
  currentDur: number;
  progress: number;
  barColor: string;
  textColor: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [previewSec, setPreviewSec] = useState<number | null>(null);

  const displayProgress = dragging && previewSec != null
    ? Math.min(1, Math.max(0, (currentDur - previewSec) / currentDur))
    : progress;

  const pointerToSeconds = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return currentSeconds;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const elapsed = ratio * currentDur;
    const remaining = Math.max(1, currentDur - elapsed);
    return Math.max(1, Math.min(currentDur, Math.round(remaining / 5) * 5));
  };

  const handleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDragging(true);
    setPreviewSec(pointerToSeconds(e.clientX));
  };
  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setPreviewSec(pointerToSeconds(e.clientX));
  };
  const handleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const target = pointerToSeconds(e.clientX);
    setDragging(false);
    setPreviewSec(null);
    setTimeRemainingInSession(session, currentSeconds, target).catch(() => {});
  };
  const handleCancel = () => {
    if (!dragging) return;
    setDragging(false);
    setPreviewSec(null);
  };

  return (
    <div className="mt-5 w-[60%] max-w-[700px] select-none">
      {dragging && previewSec != null && (
        <div
          className="text-xs font-bold tracking-widest mb-2 text-center"
          style={{ color: textColor, opacity: 0.9 }}
        >
          🎯 새 시간: <span className="font-mono">{fmtTime(previewSec)}</span>
        </div>
      )}
      <div
        ref={barRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleCancel}
        className={`relative bg-white/10 rounded-full overflow-hidden cursor-ew-resize transition-all ${
          dragging ? 'h-3 ring-2 ring-white/30' : 'h-1.5 hover:h-2.5'
        }`}
        role="slider"
        aria-label="현재 레벨 남은 시간 드래그 조절"
        aria-valuemin={0}
        aria-valuemax={currentDur}
        aria-valuenow={dragging && previewSec != null ? previewSec : currentSeconds}
        style={{ touchAction: 'none' }}
      >
        <div
          className={`h-full ${dragging ? '' : 'transition-all'}`}
          style={{ width: `${displayProgress * 100}%`, background: barColor }}
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-lg transition-all ${
            dragging ? 'w-5 h-5 opacity-100' : 'w-4 h-4 opacity-0'
          }`}
          style={{ left: `${displayProgress * 100}%`, border: `2px solid ${barColor}` }}
        />
      </div>
    </div>
  );
}

function DarkScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center text-sm">
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
  color,
  accentColor,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  color: string;
  accentColor?: string;
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] tracking-[0.3em] mb-2" style={{ color, opacity: 0.6 }}>
        {label}
      </div>
      <div
        className="font-mono font-extrabold"
        style={{
          fontSize: 'clamp(28px, 3.5vw, 44px)',
          color: highlight && accentColor ? accentColor : color,
        }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-1" style={{ color, opacity: 0.6 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
