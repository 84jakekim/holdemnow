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
  togglePauseSession,
  goToLevelInSession,
  addSecondsToSession,
  stopLiveSession,
} from '@/lib/live';
import {
  type TimerDisplaySettings,
  DEFAULT_TIMER_DISPLAY,
  subscribeTimerDisplay,
  buildBackgroundCss,
} from '@/lib/timerDisplay';
import { playCountdownBeep, playFinalBeep, playBlindUp, unlockAudio } from '@/lib/sounds';
import {
  computeAutoITM,
  computePayoutsFromStructure,
  computePayoutAmounts,
  fmtPrizeDisplay,
  resolvePayoutStructure,
} from '@/lib/templates';
import { useAuth, useUserDoc, useStoreDoc, hasRole } from '@/lib/hooks';

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

  // ─── 사운드 활성화 + Wake Lock (모바일 최적화 재설계 — 2026-05-22 PM 단독) ───
  // 정정 사양 (사용자 외출 모드 긴급 보고):
  //  ⚠️ 이전 5bcc1b8에서 "첫 터치 시 자동 가로 강제"가 race 발생 → 가로 → 다시 세로로
  //     돌아오는 버그가 있었음. 또한 자동 강제는 사용자 의도에 반함 (모바일에서
  //     세로로 정보 확인만 하려는 경우도 있음).
  //  ✅ 새 동작:
  //     ① 첫 터치 = audio unlock 만. fullscreen/orientation은 X.
  //     ② "전체화면" 버튼이 화면 우상단에 노출 — 사용자가 명시적으로 누를 때만
  //        fullscreen + orientation lock('landscape') + wakeLock 묶음 진입.
  //     ③ 세로 모드 = 모바일 폭(≤768px) 전용 컴팩트 레이아웃으로 자동 전환.
  //        타이머/블라인드/NEXT 모두 세로 stack, 폰트는 화면에 맞춰 자동 축소.
  //     ④ 가로 모드 진입 후 race 차단: needsCssRotate=true 상태에선 orientation
  //        재시도 안 함. fullscreenchange가 false로 떨어질 때만 자연 종료.
  const [audioReady, setAudioReady] = useState<boolean>(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Wake Lock 재획득 — 탭이 다시 visible 될 때 (모바일/태블릿에서 wakeLock이 자동 해제됨)
  useEffect(() => {
    const reacquire = async () => {
      if (document.visibilityState !== 'visible' || wakeLockRef.current != null) return;
      try {
        const nav = navigator as Navigator & { wakeLock?: WakeLock };
        if (nav.wakeLock?.request) {
          wakeLockRef.current = await nav.wakeLock.request('screen');
          wakeLockRef.current.addEventListener('release', () => {
            wakeLockRef.current = null;
          });
        }
      } catch {
        // 일부 브라우저는 WakeLock API 미지원
      }
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => {
      document.removeEventListener('visibilitychange', reacquire);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

  // ─── 모바일 화면 모드 (2026-05-23 PM 핫픽스 — CSS rotate fallback 폐기) ───
  // 정정 사양 (사용자 외출 모드 긴급 보고 — error.jpg 첨부 분석):
  //  ❌ 이전 5bcc1b8: CSS `transform: rotate(90deg)` fallback이 활성화되면
  //      전체 컨테이너(세로 layout 포함)가 그대로 90도 누워서 표시됨.
  //      또한 isMobileLandscape 조건이 needsCssRotate에도 OR로 묶여있어
  //      CSS rotate가 적용된 상태에서 가로 layout이 한 번 더 회전하는 race도 발생.
  //  ✅ 새 동작:
  //     ① CSS rotate fallback 폐기. orientation lock 실패 시에도 누이지 않음.
  //        대신 사용자에게 "기기를 가로로 회전해 주세요" 안내 띠 (자체 회전 X).
  //     ② 가로(landscape) 감지 = window.innerWidth > window.innerHeight 단독.
  //        폭 제한 폐기 — 폰/태블릿/PC 모두 가로면 MobileLandscapeLayout. 큰 TV는
  //        충분히 가로지만 컨트롤이 노출돼도 무해 (어차피 canControl 검증 통과 필요).
  //        ※ 데스크탑 TV 매핑 페이지에서 더 풍부한 풀 레이아웃이 필요하면 폭 >=1280
  //          + 마우스 hover 가능 매체일 때 풀 레이아웃 유지하도록 분기.
  //     ③ 모바일 세로(<=768px + h>w) = MobilePortraitLayout 자체 컴팩트.
  //     ④ fullscreen + orientation lock 시도는 사용자 명시적 클릭에서만.
  //        race 차단을 위해 fullscreenchange만 자연 종료 트리거로 사용.
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);
  const [isMobilePortrait, setIsMobilePortrait] = useState(false);
  const [isMobileLandscape, setIsMobileLandscape] = useState(false);
  const [showLandscapeHint, setShowLandscapeHint] = useState(false);

  // 모바일 폭 + 세로/가로 감지 — 첫 진입 + resize 시 갱신.
  // 세로(h>w + 모바일폭): isMobilePortrait → 컴팩트 세로 레이아웃
  // 가로(w>h): isMobileLandscape → 가로 전용 풀폭 레이아웃
  //   ※ 폭 제한 제거 — 폰 가로(844x390 등)도, 태블릿 가로(1024x768)도, 모두 진입.
  //   ※ 데스크탑 풀 레이아웃은 매우 큰 화면(>=1366px) AND 마우스 가능일 때만 유지.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const isPortraitMobile = w <= 768 && h > w;
      // 가로(landscape)만 보면 됨. 데스크탑 풀 레이아웃은 hover:fine + 큰 폭 한정.
      const isCoarseOrSmall = !window.matchMedia('(hover: hover) and (pointer: fine)').matches || w < 1366;
      const isLandscapeForMobileLayout = w > h && isCoarseOrSmall;
      setIsMobilePortrait(isPortraitMobile);
      setIsMobileLandscape(isLandscapeForMobileLayout);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  // 첫 진입 — audio unlock 자동 적용 (이전에 unlock 했다면). fullscreen/orientation은 X.
  useEffect(() => {
    let unlockedBefore = false;
    try {
      unlockedBefore = localStorage.getItem('holdemnow:tvAudioUnlocked') === '1';
    } catch {}
    if (unlockedBefore) {
      unlockAudio();
      setAudioReady(true);
    }
  }, []);

  // 사운드 unlock 핸들러 — 화면 어디든 첫 터치 시 자동. fullscreen은 트리거 X.
  useEffect(() => {
    if (audioReady) return;
    const unlock = () => {
      unlockAudio();
      setAudioReady(true);
      try {
        localStorage.setItem('holdemnow:tvAudioUnlocked', '1');
      } catch {}
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [audioReady]);

  // fullscreenchange — exit 시 orientation unlock + state sync. CSS rotate 폐기.
  useEffect(() => {
    const onFullscreenChange = () => {
      const isActive = !!document.fullscreenElement;
      setIsFullscreenActive(isActive);
      if (!isActive) {
        // exit — orientation 해제만. CSS rotate 폐기됐으므로 별도 해제 불필요.
        try {
          const scr = screen as Screen & {
            orientation?: ScreenOrientation & { unlock?: () => void };
          };
          scr.orientation?.unlock?.();
        } catch {}
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
    };
  }, []);

  // ─── 전체화면(가로) 진입 핸들러 — 사용자 명시적 클릭으로만 호출 ─────────────
  // 2026-05-23 핫픽스: CSS rotate fallback 폐기. orientation lock 실패 시에는
  // 화면을 누이지 않고 안내 띠만 표시 → 사용자가 기기를 직접 가로로 회전.
  // 사용자 제스처 내에서 실행되어야 fullscreen + orientation 모두 권한 통과.
  const enterFullscreenMode = async () => {
    // 사운드도 같이 unlock (혹시 첫 클릭이라면)
    if (!audioReady) {
      unlockAudio();
      setAudioReady(true);
      try {
        localStorage.setItem('holdemnow:tvAudioUnlocked', '1');
      } catch {}
    }

    // ① fullscreen 진입
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      msRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        else if (el.msRequestFullscreen) await el.msRequestFullscreen();
      }
    } catch {
      // fullscreen 거부 — orientation lock도 보통 실패하지만 안내 띠로 사용자 직접 회전 유도
    }

    // ② orientation lock — 모바일 세로일 때만 가로 강제 시도
    const isPortrait = window.innerHeight > window.innerWidth;
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    let orientationLocked = false;
    if (isPortrait && isTouch) {
      try {
        const scr = screen as Screen & {
          orientation?: ScreenOrientation & { lock?: (o: string) => Promise<void> };
        };
        if (scr.orientation?.lock) {
          await scr.orientation.lock('landscape');
          orientationLocked = true;
        }
      } catch {
        // iOS Safari 등 — orientation lock 미지원 또는 거부
      }
      // orientation lock 실패 시 안내 띠 노출 (CSS rotate fallback 폐기)
      if (!orientationLocked) {
        setShowLandscapeHint(true);
        // 6초 후 자동 숨김
        setTimeout(() => setShowLandscapeHint(false), 6000);
      }
    }

    // ③ wakeLock — 화면 꺼짐 방지
    try {
      const nav = navigator as Navigator & { wakeLock?: WakeLock };
      if (nav.wakeLock?.request && wakeLockRef.current == null) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      }
    } catch {
      // Wake Lock API 미지원
    }
  };

  // 전체화면 종료 — 사용자가 명시적으로 누를 때 + ESC 자동 처리
  const exitFullscreenMode = async () => {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
    } catch {}
    // orientation/CSS rotate 해제는 onFullscreenChange가 자동 처리
  };

  // 매장 설정 보강: 명시적 false가 아니면 기본 true. 사장님이 설정 UI를 모를 수도 있으므로
  // TV에서는 카운트다운/블라인드업 사운드가 기본 작동해야 함. soundWarn60만 기본 false.
  const soundWarn60Effective = display.soundWarn60 === true;
  const soundWarn30Effective = display.soundWarn30 !== false;
  const soundLevelEndEffective = display.soundLevelEnd !== false;
  const soundBlindUpEffective = display.soundBlindUp !== false;

  // sec 변화 추적 ref — 사운드 useEffect와 분리해서 항상 최신값 유지
  const prevSecRef = useRef<number>(sec);
  const prevLevelRef = useRef<number | undefined>(session?.currentLevel);

  // 사운드 트리거 — 사장님 사양: 10초부터 매초 비프 (10,9,...,2), 1초/0초 final beep.
  useEffect(() => {
    const prev = prevSecRef.current;
    if (session?.status === 'running' && audioReady) {
      // 60초 — 옵션이 명시적으로 켜졌을 때만 1회
      if (soundWarn60Effective && prev > 60 && sec <= 60) playCountdownBeep();
      // 30초 1회 (옵션)
      if (soundWarn30Effective && prev > 30 && sec <= 30) playCountdownBeep();
      // 10초부터 매초 카운트다운 비프 (sec: 10,9,8,...,2)
      if (soundWarn30Effective && prev !== sec && sec >= 2 && sec <= 10) {
        playCountdownBeep();
      }
      // 1초 final beep
      if (soundLevelEndEffective && prev !== sec && sec === 1) playFinalBeep();
      // 0초 도달 — 레벨 끝 final beep
      if (soundLevelEndEffective && prev > 0 && sec <= 0) playFinalBeep();
    }
    prevSecRef.current = sec;
  }, [
    sec,
    session?.status,
    audioReady,
    soundWarn60Effective,
    soundWarn30Effective,
    soundLevelEndEffective,
  ]);

  // 레벨 전환 시 블라인드업 차임 — 레벨이 + 방향으로 변경됐을 때만
  useEffect(() => {
    const prevLv = prevLevelRef.current;
    const currLv = session?.currentLevel;
    if (
      soundBlindUpEffective &&
      audioReady &&
      session?.status === 'running' &&
      prevLv != null &&
      currLv != null &&
      currLv > prevLv
    ) {
      playBlindUp();
    }
    prevLevelRef.current = currLv;
  }, [session?.currentLevel, session?.status, audioReady, soundBlindUpEffective]);

  // ─── 컨트롤 권한 판정 (2026-05-23 PM 핫픽스) ─────────────────
  // 가로 모드 컨트롤 버튼은 매장 owner/staff / platform_admin만 노출.
  // 일반 사용자(player)·anonymous는 read-only로 타이머만 본다.
  //  • platform_admin: 모든 매장 컨트롤 가능
  //  • store_master AND (store.ownerUid === uid OR userDoc.storeId === storeId): 자기 매장
  //  • store_staff AND userDoc.storeId === storeId: 자기 매장
  //  • role 필드는 없어도 storeDoc.ownerUid === uid 면 매장 사장으로 인정 (legacy fallback)
  //  • 그 외: 거부
  //
  // ⚠️ 핫픽스: thethego 처럼 role 필드가 비어있거나 'player'로 잘못 박힌 owner 계정도
  //    storeDoc.ownerUid 와 uid가 일치하면 통과시키기.
  const authState = useAuth();
  const authLoading = authState.status === 'loading';
  const authedUid = authState.status === 'authenticated' ? authState.user.uid : null;
  const userDoc = useUserDoc(authedUid);
  const storeDoc = useStoreDoc(storeId);
  const canControl = useMemo(() => {
    if (!authedUid) return false;
    // platform_admin 단독 통과 (userDoc.role/roles)
    if (userDoc && hasRole(userDoc, 'platform_admin')) return true;
    // store_master + store.ownerUid 또는 storeId 일치
    if (userDoc && hasRole(userDoc, 'store_master')) {
      if (storeDoc?.ownerUid && storeDoc.ownerUid === authedUid) return true;
      if (userDoc.storeId && userDoc.storeId === storeId) return true;
    }
    // store_staff + storeId 일치
    if (userDoc && hasRole(userDoc, 'store_staff')) {
      if (userDoc.storeId && userDoc.storeId === storeId) return true;
    }
    // legacy/role-missing fallback: storeDoc.ownerUid === uid 면 무조건 owner 인정
    // (thethego 같은 prod 마이그레이션 잔재 계정 대응)
    if (storeDoc?.ownerUid && storeDoc.ownerUid === authedUid) return true;
    return false;
  }, [authedUid, userDoc, storeDoc, storeId]);

  // ─── 가로 모드 컨트롤 핸들러 ────────────────────────────────────
  // 각 핸들러는 권한 검증 + sec snapshot + try/catch 묶음으로 안전 호출.
  // confirm 모달은 종료에만 (실수 방지).
  const handleSetTimeRemaining = async (targetSec: number) => {
    if (!session || !canControl) return;
    try {
      await setTimeRemainingInSession(session, sec, targetSec);
    } catch {}
  };
  const handleTogglePause = async () => {
    if (!session || !canControl) return;
    try {
      await togglePauseSession(session, sec);
    } catch {
      // silent — Firestore rules에서 거부되면 콘솔 에러는 보임
    }
  };
  const handlePrevLevel = async () => {
    if (!session || !canControl) return;
    if (session.currentLevel <= 1) return;
    try {
      await goToLevelInSession(session, -1, sec);
    } catch {}
  };
  const handleNextLevel = async () => {
    if (!session || !canControl) return;
    try {
      await goToLevelInSession(session, +1, sec);
    } catch {}
  };
  const handleAddMinute = async (delta: number) => {
    if (!session || !canControl) return;
    try {
      await addSecondsToSession(session, sec, delta);
    } catch {}
  };
  const handleStopSession = async () => {
    if (!session || !canControl) return;
    const ok = window.confirm('세션을 종료할까요?\n\n종료하면 현재 LIVE 타이머가 중단되고\n슬롯의 매핑도 해제됩니다.');
    if (!ok) return;
    try {
      await stopLiveSession(session, sec, 'display/TV-landscape:user-button');
    } catch {}
  };

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

  // CSS rotate fallback 폐기 (2026-05-23 핫픽스).
  // 외곽 wrapper transform 제거 — 누워서 보이던 버그(error.jpg) 해결.
  // 가로 모드는 isMobileLandscape 분기로만 처리.

  return (
    <div className="min-h-screen text-white flex flex-col relative overflow-hidden" style={bgStyle}>
      {/* 이미지 배경 시 어둠 overlay */}
      {display.backgroundType === 'image' && display.backgroundImageUrl && (
        <div className="absolute inset-0 pointer-events-none" style={{ background: `rgba(0,0,0,${display.overlayOpacity})` }} />
      )}

      {/* 상단: 좌상단 매장명/로고 · 우상단 시계
          모바일 가로 모드에선 자체 헤더가 좌측 컬럼에 있으므로 숨김. */}
      <div
        className={`relative px-10 pt-8 flex items-start justify-between gap-6 ${
          isMobileLandscape ? 'hidden' : ''
        }`}
      >
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

      {/* 상금 분배표 — Phase 2. display.prizeDistributionLayout=='left'/'right' 일 때만 렌더 */}
      {session && session.status !== 'completed' &&
        (display.prizeDistributionLayout === 'left' || display.prizeDistributionLayout === 'right') && (
          <PrizeDistributionPanel
            session={session}
            display={display}
            side={display.prizeDistributionLayout}
          />
        )}

      {/* 동기화 끊김 배너 */}
      {showStale && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-20 bg-amber-500/90 text-black px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 backdrop-blur shadow-lg">
          <span className="w-2 h-2 rounded-full bg-black animate-pulse" />
          동기화 중 · 네트워크 확인
        </div>
      )}

      {/* ─── 모바일 세로 컴팩트 레이아웃 (2026-05-22 PM 단독 신설) ───
          isMobilePortrait=true 일 때 본문을 컴팩트 버전으로 교체.
          가로 진입 시(isMobilePortrait=false) 자동으로 가로 전용 레이아웃 또는 풀 레이아웃 복귀.
          모바일 폭(<=768px) + 세로 화면 한정. */}
      {isMobilePortrait && session && session.status !== 'completed' ? (
        <MobilePortraitLayout
          session={session}
          sec={sec}
          paused={paused}
          isRunning={isRunning}
          isCurrentBreak={isCurrentBreak}
          lowTime={lowTime ?? false}
          veryLow={veryLow ?? false}
          currentDur={currentDur}
          progress={progress}
          nextBlind={nextBlind}
          lateRegDisplay={lateRegDisplay}
          lateClosed={lateClosed}
          lateMin={lateMin}
          heroTitle={heroTitle}
          display={display}
          onEnterFullscreen={enterFullscreenMode}
        />
      ) : isMobileLandscape && session && session.status !== 'completed' ? (
        /* ─── 모바일/태블릿 가로 전용 레이아웃 (2026-05-23 PM 단독 신설) ───
            isMobileLandscape=true (가로 + 폭 ≤1024px 또는 CSS rotate fallback) 일 때.
            좌측: 토너 정보 (레벨/블라인드/NEXT)
            중앙: 거대 타이머 + 진행바
            우측: 보조 정보 (PLAYERS/PRIZE POOL/LATE REG)
            하단: 컨트롤 버튼 행 — 권한자만 노출
            데스크탑/대형 TV(>1024px 가로)는 기존 풀 레이아웃 유지. */
        <MobileLandscapeLayout
          session={session}
          sec={sec}
          paused={paused}
          isRunning={isRunning}
          isCurrentBreak={isCurrentBreak}
          lowTime={lowTime ?? false}
          veryLow={veryLow ?? false}
          currentDur={currentDur}
          progress={progress}
          currentLevelObj={currentLevelObj}
          nextBlind={nextBlind}
          lateRegDisplay={lateRegDisplay}
          lateClosed={lateClosed}
          lateMin={lateMin}
          heroTitle={heroTitle}
          display={display}
          canControl={canControl}
          authLoading={authLoading}
          authedUid={authedUid}
          onSetTimeRemaining={handleSetTimeRemaining}
          onTogglePause={handleTogglePause}
          onPrevLevel={handlePrevLevel}
          onNextLevel={handleNextLevel}
          onAddMinute={handleAddMinute}
          onStopSession={handleStopSession}
          onExitFullscreen={exitFullscreenMode}
        />
      ) : !session || session.status === 'completed' ? (
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

          {/* 거대 카운트다운 — display.timerScale로 매장 환경별 폰트 배율 (Phase 3) */}
          <div
            className={`font-mono font-extrabold leading-none transition-colors ${veryLow ? 'animate-pulse' : ''}`}
            style={{
              fontSize: `clamp(${150 * (display.timerScale ?? 1)}px, ${18 * (display.timerScale ?? 1)}vw, ${280 * (display.timerScale ?? 1)}px)`,
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
                style={{
                  fontSize: `clamp(${36 * (display.blindsScale ?? 1)}px, ${5 * (display.blindsScale ?? 1)}vw, ${64 * (display.blindsScale ?? 1)}px)`,
                  color: display.blindsColor,
                }}
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

          {/* 하단 stats — 매장 TV 운영 화면. PRIZE POOL은 매장 내 노출 전용
              (사용자 모바일 앱 /m/* 에는 어떤 상금 필드도 렌더링하지 않음).
              statsScale로 폰트 배율 적용 (Phase 3). */}
          <div className="mt-10 grid grid-cols-3 gap-10 max-w-5xl">
            <Stat
              label="PLAYERS"
              value={`${session.playersRemaining}/${session.totalPlayers}`}
              sub={`${session.tablesRemaining}테이블`}
              color={display.textColor}
              scale={display.statsScale ?? 1}
            />
            <Stat
              label="PRIZE POOL"
              value={
                display.prizeOverride && display.prizeOverride.trim().length > 0
                  ? display.prizeOverride
                  : session.prizePool > 0
                  ? `₩${session.prizePool.toLocaleString()}`
                  : '—'
              }
              sub=""
              color={display.textColor}
              scale={display.statsScale ?? 1}
            />
            <Stat
              label="LATE REG"
              value={lateRegDisplay}
              sub={lateClosed ? '' : '남음'}
              highlight={!lateClosed && lateMin <= 5}
              color={display.textColor}
              accentColor={display.accentColor}
              scale={display.statsScale ?? 1}
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

      {/* 워터마크 / 스폰서 — 모바일 가로 모드에선 공간 부족하므로 숨김 */}
      {!isMobileLandscape && (
        <div className="relative px-10 pb-6 pt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs" style={{ color: display.textColor, opacity: 0.5 }}>
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: display.accentColor }}
            />
            <span className="font-bold tracking-tight">Pink Rabbit</span>
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
      )}

      {/* 가로 회전 안내 띠 — orientation lock 실패 시(iOS Safari 등) 사용자 직접 회전 유도 */}
      {showLandscapeHint && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-40 bg-amber-500/95 text-black px-5 py-3 rounded-2xl text-sm font-extrabold flex items-center gap-2 backdrop-blur shadow-2xl border-2 border-amber-300">
          <span className="text-xl">📱↻</span>
          <span>기기를 가로로 돌려주세요</span>
        </div>
      )}

      {/* 풀스크린 안내 — 데스크탑/대형 TV 한정. 모바일 세로는 자체 큰 버튼,
          모바일 가로는 자체 컨트롤 행에 ⛶ 종료 버튼 있음 → 안내 불필요. */}
      {showHint && !isMobilePortrait && !isMobileLandscape && !isFullscreenActive && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur text-white px-5 py-3 rounded-xl text-xs flex items-center gap-3 z-30">
          <span>💡 F11 또는 우측 상단 <span className="text-amber-300 font-bold">⛶ 전체화면</span> 버튼</span>
          <button onClick={() => setShowHint(false)} className="text-white/60 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* 전체화면 진입 버튼 — 2026-05-23 PM 단독 정리.
          • 우측 상단 진입 버튼은 데스크탑/대형 TV(>1024px 가로) 에서만 노출.
          • 모바일 세로(isMobilePortrait): MobilePortraitLayout 자체 하단 버튼 사용 (중복 제거 — 사용자 요구)
          • 모바일 가로(isMobileLandscape): 자체 컨트롤 행의 ⛶ 종료 버튼 사용
      */}
      {audioReady && !isFullscreenActive && !isMobilePortrait && !isMobileLandscape && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            enterFullscreenMode();
          }}
          className="fixed top-3 right-3 bg-amber-500/90 hover:bg-amber-400 text-black font-extrabold rounded-lg backdrop-blur z-30 border-2 border-amber-300 shadow-lg flex items-center gap-2 transition-all active:scale-95 px-3 py-2 text-xs"
          title="전체화면 + 가로 모드 진입"
          aria-label="전체화면 진입"
        >
          <span className="text-base">⛶</span>
          <span>전체화면</span>
        </button>
      )}

      {/* 전체화면 종료 버튼 — 데스크탑/대형 TV 한정.
          모바일 가로는 컨트롤 행에 ⛶ 종료 버튼이 있으므로 중복 노출 X. */}
      {audioReady && isFullscreenActive && !isMobileLandscape && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            exitFullscreenMode();
          }}
          className="fixed top-3 right-3 bg-white/10 hover:bg-white/25 text-white text-xs font-bold px-3 py-2 rounded-lg backdrop-blur z-30 border border-white/30 flex items-center gap-2"
          title="전체화면 종료 (ESC)"
          aria-label="전체화면 종료"
        >
          <span>✕</span>
          <span>종료</span>
        </button>
      )}

      {/* 사운드 테스트 버튼 — 운영자가 사운드 작동 확인용. 좌상단 시계 옆.
          모바일 가로 모드에선 컨트롤 행에 통합 또는 숨김 (공간 절약). */}
      {audioReady && !isMobileLandscape && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            playBlindUp();
          }}
          className="fixed top-3 left-3 bg-white/10 hover:bg-white/25 text-white/80 text-[11px] font-bold px-2.5 py-1.5 rounded-lg backdrop-blur z-30 border border-white/20"
          title="블라인드업 사운드 테스트"
        >
          🔊 테스트
        </button>
      )}

      {/* 사운드 활성화 오버레이 — 첫 진입 + unlock 안 된 상태 */}
      {!audioReady && (
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            setAudioReady(true);
            try {
              localStorage.setItem('holdemnow:tvAudioUnlocked', '1');
            } catch {}
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          aria-label="사운드 활성화"
        >
          <div className="text-center text-white p-10 rounded-3xl bg-gray-900/95 border-2 border-amber-400 shadow-2xl max-w-md mx-6"
            onClick={(e) => {
              // 오버레이 내부 클릭 시에도 unlock + 테스트 비프 한 번 즉시
              e.stopPropagation();
              unlockAudio();
              setAudioReady(true);
              try { localStorage.setItem('holdemnow:tvAudioUnlocked', '1'); } catch {}
              setTimeout(() => playCountdownBeep(), 100);
            }}
          >
            <div className="text-7xl mb-5">🔊</div>
            <div className="text-2xl font-extrabold mb-3">TV 송출 시작</div>
            <div className="text-sm text-gray-300 mb-5 leading-relaxed">
              화면을 터치하면 사운드가 활성화됩니다.<br />
              세로/가로 전환은 우측 상단 <span className="text-amber-300 font-bold">전체화면</span> 버튼으로.
            </div>
            <div className="text-[12px] text-gray-400 mb-6 leading-relaxed">
              📱 모바일은 기본 세로 레이아웃으로 표시.<br />
              가로(landscape) 풀스크린은 사용자가 명시적으로 전환합니다.<br />
              <span className="text-amber-300/70">기본값은 가로 강제 X — race 차단</span>
            </div>
            <div className="text-amber-400 text-base font-bold animate-pulse">
              화면 아무 곳이나 터치
            </div>
          </div>
        </button>
      )}
    </div>
  );
}

/**
 * 모바일 세로 컴팩트 레이아웃 — 2026-05-22 PM 단독 신설.
 *
 * 모바일 폭(<=768px) + 세로 화면 한정. 사용자가 핸드폰만 들고 봐도
 * 타이머/블라인드/NEXT/사이드 정보가 모두 한 화면에 들어오도록.
 *
 * 레이아웃:
 *   ┌─────────────────────────┐
 *   │ STATE 뱃지 (LIVE/PAUSED)│
 *   │ LEVEL 표시              │
 *   │                         │
 *   │   00:00 (거대 타이머)   │
 *   │   ▰▰▰░░░░░ (진행바)     │
 *   │                         │
 *   │ SB / BB / ANTE          │
 *   │                         │
 *   │ ─────────────────────   │
 *   │ ▶ NEXT 다음 블라인드    │
 *   │ ─────────────────────   │
 *   │ PLAYERS · LATE REG      │
 *   │                         │
 *   │ [⛶ 전체화면 가로 모드]  │
 *   └─────────────────────────┘
 */
function MobilePortraitLayout({
  session,
  sec,
  paused,
  isRunning,
  isCurrentBreak,
  lowTime,
  veryLow,
  currentDur,
  progress,
  nextBlind,
  lateRegDisplay,
  lateClosed,
  lateMin,
  heroTitle,
  display,
  onEnterFullscreen,
}: {
  session: LiveSession;
  sec: number;
  paused: boolean;
  isRunning: boolean;
  isCurrentBreak: boolean;
  lowTime: boolean;
  veryLow: boolean;
  currentDur: number;
  progress: number;
  nextBlind: LiveSession['blindStructure'][number] | undefined;
  lateRegDisplay: string;
  lateClosed: boolean;
  lateMin: number;
  heroTitle: string;
  display: TimerDisplaySettings;
  onEnterFullscreen: () => void;
}) {
  return (
    <div className="relative flex-1 flex flex-col px-4 pb-4">
      {/* 상단: 상태 뱃지 + 토너 타이틀 + 레벨 */}
      <div className="flex flex-col items-center gap-2 mt-3">
        <div className="flex items-center gap-2">
          {paused ? (
            <span className="font-extrabold tracking-[0.25em] text-xs" style={{ color: '#FFD166' }}>
              ⏸ PAUSED
            </span>
          ) : isCurrentBreak ? (
            <span className="font-extrabold tracking-[0.25em] text-xs" style={{ color: '#FFD166' }}>
              ☕ BREAK
            </span>
          ) : (
            <>
              <span
                className="w-2.5 h-2.5 rounded-full animate-pulse"
                style={{ background: display.accentColor }}
              />
              <span
                className="font-extrabold tracking-[0.25em] text-xs"
                style={{ color: display.accentColor }}
              >
                LIVE
              </span>
            </>
          )}
        </div>
        <div
          className="text-[10px] tracking-widest text-center max-w-full truncate px-2"
          style={{ color: display.textColor, opacity: 0.85 }}
        >
          {heroTitle}
        </div>
        <div className="text-[9px] tracking-[0.3em]" style={{ color: display.textColor, opacity: 0.7 }}>
          {isCurrentBreak ? `BREAK · ${session.currentLevel}레벨` : `LEVEL ${session.currentLevel}`}
        </div>
      </div>

      {/* 거대 타이머 — 화면 폭의 18~22vw 정도 */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div
          className={`font-mono font-extrabold leading-none transition-colors ${veryLow ? 'animate-pulse' : ''}`}
          style={{
            fontSize: `clamp(72px, 22vw, 140px)`,
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

        {/* 진행바 — 컴팩트 */}
        {(isRunning || paused) && currentDur > 0 && (
          <div className="mt-3 w-full max-w-xs">
            <div className="relative h-1.5 bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full transition-all"
                style={{
                  width: `${progress * 100}%`,
                  background: lowTime ? display.accentColor : isCurrentBreak ? '#FFD166' : display.blindsColor,
                }}
              />
            </div>
          </div>
        )}

        {/* 블라인드 */}
        {!isCurrentBreak && (
          <div className="mt-5 text-center">
            <div className="text-[9px] tracking-[0.3em] mb-1.5" style={{ color: display.textColor, opacity: 0.6 }}>
              BLINDS
            </div>
            <div
              className="font-mono font-extrabold"
              style={{
                fontSize: 'clamp(28px, 8vw, 44px)',
                color: display.blindsColor,
              }}
            >
              {session.smallBlind.toLocaleString()} / {session.bigBlind.toLocaleString()}
            </div>
            {session.ante > 0 && (
              <div
                className="font-mono text-xs mt-1"
                style={{ color: display.textColor, opacity: 0.6 }}
              >
                Ante {session.ante.toLocaleString()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* NEXT 박스 — 컴팩트 한 줄 */}
      {nextBlind && (
        <div
          className="mt-4 rounded-xl px-3 py-2 border backdrop-blur-sm"
          style={{
            background: 'rgba(0,0,0,0.45)',
            borderColor: nextBlind.isBreak ? '#FFD166' : `${display.accentColor}66`,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div
              className="text-[9px] font-extrabold tracking-[0.3em]"
              style={{ color: nextBlind.isBreak ? '#FFD166' : display.accentColor }}
            >
              ▶ NEXT
            </div>
            {nextBlind.isBreak ? (
              <div
                className="font-extrabold text-right"
                style={{
                  color: '#FFD166',
                  fontSize: '15px',
                  letterSpacing: '-0.02em',
                }}
              >
                ☕ 휴식 {Math.round(nextBlind.durationSec / 60)}분
              </div>
            ) : (
              <div className="flex items-baseline gap-2">
                <div
                  className="text-[10px] tracking-[0.2em] font-extrabold opacity-70"
                  style={{ color: display.textColor }}
                >
                  LV {nextBlind.level}
                </div>
                <div
                  className="font-mono font-extrabold tabular-nums leading-none"
                  style={{
                    fontSize: '17px',
                    letterSpacing: '-0.02em',
                    color: display.blindsColor,
                  }}
                >
                  {nextBlind.sb.toLocaleString()}
                  <span style={{ color: display.textColor, opacity: 0.4 }} className="mx-1">
                    /
                  </span>
                  {nextBlind.bb.toLocaleString()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 사이드 정보 — 2열 grid: PLAYERS / LATE REG */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div
          className="rounded-xl px-3 py-2.5 text-center border"
          style={{ background: 'rgba(0,0,0,0.35)', borderColor: 'rgba(255,255,255,0.1)' }}
        >
          <div className="text-[9px] tracking-[0.25em] mb-1" style={{ color: display.textColor, opacity: 0.6 }}>
            PLAYERS
          </div>
          <div
            className="font-mono font-extrabold text-xl"
            style={{ color: display.textColor }}
          >
            {session.playersRemaining}/{session.totalPlayers}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: display.textColor, opacity: 0.55 }}>
            {session.tablesRemaining}테이블
          </div>
        </div>
        <div
          className="rounded-xl px-3 py-2.5 text-center border"
          style={{ background: 'rgba(0,0,0,0.35)', borderColor: 'rgba(255,255,255,0.1)' }}
        >
          <div className="text-[9px] tracking-[0.25em] mb-1" style={{ color: display.textColor, opacity: 0.6 }}>
            LATE REG
          </div>
          <div
            className="font-mono font-extrabold text-xl"
            style={{
              color: !lateClosed && lateMin <= 5 ? display.accentColor : display.textColor,
            }}
          >
            {lateRegDisplay}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: display.textColor, opacity: 0.55 }}>
            {lateClosed ? '' : '남음'}
          </div>
        </div>
      </div>

      {/* 전체화면 진입 안내 띠 — 2026-05-23 PM 정정: 타이머 컨셉에 맞게 subtle 톤으로.
          이전: 노란 풀필 → 너무 튐. 정정: 다크 ghost 버튼, 작은 회색 텍스트.
          정보 위계에 자연스럽게 녹아들도록. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEnterFullscreen();
        }}
        className="mt-3 w-full bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-[0.99] rounded-lg py-2 flex items-center justify-center gap-1.5 border transition-all"
        style={{
          color: display.textColor,
          borderColor: 'rgba(255,255,255,0.12)',
          opacity: 0.7,
        }}
        aria-label="전체화면 + 가로 모드 진입"
      >
        <span className="text-xs opacity-80">⛶</span>
        <span className="text-[11px] tracking-[0.18em] font-bold">전체화면 (가로)</span>
      </button>
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
  scale = 1,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  color: string;
  accentColor?: string;
  scale?: number;
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] tracking-[0.3em] mb-2" style={{ color, opacity: 0.6 }}>
        {label}
      </div>
      <div
        className="font-mono font-extrabold"
        style={{
          fontSize: `clamp(${28 * scale}px, ${3.5 * scale}vw, ${44 * scale}px)`,
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

/**
 * 상금 분배표 — TV 화면 좌/우 사이드에 노출 (Phase 2 + Phase 3).
 *
 * 데이터 소스 우선순위:
 *  ① session.payoutStructure (Phase 3 — 사장이 템플릿에 설정한 분배 정책 스냅샷)
 *  ② fallback: totalPlayers 기준 computeAutoITM (Phase 2)
 *
 * prizePool이 0이면 표시 안 함.
 * 위치는 display.prizeDistributionLayout='left'|'right' 결정. 'hidden'이면 렌더 안 함.
 */
function PrizeDistributionPanel({
  session,
  display,
  side,
}: {
  session: LiveSession;
  display: TimerDisplaySettings;
  side: 'left' | 'right';
}) {
  if (session.prizePool <= 0) return null;
  // Phase 3 우선: 세션에 박힌 분배 정책 사용. 없으면 Phase 2 auto ITM fallback.
  // Phase 5 (2026-05-21): resolvePayoutStructure로 레거시 mode='manual' 데이터 안전 정규화.
  const payouts = session.payoutStructure
    ? computePayoutsFromStructure(resolvePayoutStructure(session.payoutStructure), session.totalPlayers)
    : computeAutoITM(session.totalPlayers);
  // Phase 4: 만원 단위 내림 + 1등 잔여 추가로 합계=prizePool 보장
  const amountsAll = computePayoutAmounts(session.prizePool, payouts);
  const rows = payouts.slice(0, 8); // 8등까지만 노출 (그 이상은 화면 공간 부족)
  // Phase 4: 세션 스냅샷의 표시 단위 사용 (없으면 'ticket')
  const unit = session.prizeDisplayUnit ?? 'ticket';
  const prizePoolLabel = fmtPrizeDisplay(session.prizePool, unit) || '—';
  return (
    <div
      className="fixed top-1/2 -translate-y-1/2 z-10 rounded-2xl backdrop-blur-sm border-2"
      style={{
        [side]: '24px' as never,
        background: 'rgba(0,0,0,0.45)',
        borderColor: `${display.accentColor}66`,
        minWidth: 200,
        maxWidth: 260,
      }}
    >
      <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
        <div
          className="text-[10px] font-extrabold tracking-[0.3em] text-center"
          style={{ color: display.accentColor }}
        >
          💰 PRIZE POOL
        </div>
        <div
          className="font-mono text-lg font-extrabold text-center mt-1"
          style={{ color: display.blindsColor }}
        >
          {prizePoolLabel}
        </div>
      </div>
      <div className="p-2">
        {rows.map((p, idx) => {
          const won = amountsAll[idx]?.amount ?? 0;
          return (
            <div
              key={p.rank}
              className="flex items-center justify-between py-1 px-2 rounded"
              style={{ color: display.textColor }}
            >
              <div className="text-[11px] font-extrabold tracking-wider">
                {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `${p.rank}등`}
              </div>
              <div className="font-mono text-[12px] font-bold">
                {fmtPrizeDisplay(won, unit) || '—'}
              </div>
            </div>
          );
        })}
      </div>
      <div
        className="px-3 py-1.5 text-[9px] tracking-widest text-center border-t"
        style={{ color: display.textColor, opacity: 0.5, borderColor: 'rgba(255,255,255,0.10)' }}
      >
        ITM {payouts.length}명 · {session.payoutStructure ? '템플릿 정책' : '자동 계산'}
      </div>
    </div>
  );
}

/**
 * 모바일/태블릿 가로 전용 레이아웃 — 2026-05-23 PM 단독 신설.
 *
 * 사용자 요구:
 *  "가로모드전향시, 가로모드에 최적화되지 않았어. 세로모드는 최적화된 화면이지만,
 *   가로모드엔 옆으로 누어있는 화면이야"
 *  → 세로 레이아웃을 그대로 가로로 누어놓지 말고, 가로 폭을 가득 사용하는 전용 레이아웃.
 *
 * 레이아웃 (3분할 grid):
 *   ┌───────────────────────────────────────────────┐
 *   │ [좌] 토너 정보  │ [중] 거대 타이머 │ [우] 보조 │
 *   │   LEVEL N      │   88:88         │   PLAYERS │
 *   │   BLINDS       │   ── 진행률 ──   │   PRIZE   │
 *   │   NEXT          │                 │   LATE    │
 *   ├───────────────────────────────────────────────┤
 *   │ [컨트롤 행 — 권한자만]                          │
 *   │ ⏮  ⏸/▶  ⏭   −1분  +1분   ⏹ 종료   ⛶ 전체화면종료 │
 *   └───────────────────────────────────────────────┘
 *
 * 권한:
 *  • canControl=true (owner/staff/admin): 모든 컨트롤 버튼 노출
 *  • canControl=false: 컨트롤 행 자체를 숨김 (read-only)
 */
function MobileLandscapeLayout({
  session,
  sec,
  paused,
  isRunning,
  isCurrentBreak,
  lowTime,
  veryLow,
  currentDur,
  progress,
  currentLevelObj,
  nextBlind,
  lateRegDisplay,
  lateClosed,
  lateMin,
  heroTitle,
  display,
  canControl,
  authLoading,
  authedUid,
  onSetTimeRemaining,
  onTogglePause,
  onPrevLevel,
  onNextLevel,
  onAddMinute,
  onStopSession,
  onExitFullscreen,
}: {
  session: LiveSession;
  sec: number;
  paused: boolean;
  isRunning: boolean;
  isCurrentBreak: boolean;
  lowTime: boolean;
  veryLow: boolean;
  currentDur: number;
  progress: number;
  currentLevelObj: LiveSession['blindStructure'][number] | undefined;
  nextBlind: LiveSession['blindStructure'][number] | undefined;
  lateRegDisplay: string;
  lateClosed: boolean;
  lateMin: number;
  heroTitle: string;
  display: TimerDisplaySettings;
  canControl: boolean;
  authLoading: boolean;
  authedUid: string | null;
  onSetTimeRemaining: (targetSec: number) => void;
  onTogglePause: () => void;
  onPrevLevel: () => void;
  onNextLevel: () => void;
  onAddMinute: (delta: number) => void;
  onStopSession: () => void;
  onExitFullscreen: () => void;
}) {
  const barColor = lowTime ? display.accentColor : isCurrentBreak ? '#FFD166' : display.blindsColor;
  const timerColor = paused
    ? '#A8A8A8'
    : lowTime
    ? display.accentColor
    : isCurrentBreak
    ? '#FFD166'
    : display.timerColor;

  return (
    <div className="relative flex-1 flex flex-col px-3 pt-2 pb-2 min-h-0">
      {/* 본문 3분할 grid — 좌 25% / 중 50% / 우 25% */}
      <div
        className="flex-1 grid items-stretch gap-3 min-h-0"
        style={{ gridTemplateColumns: '1fr 2fr 1fr' }}
      >
        {/* ─── 좌: 토너 정보 ─── */}
        <div className="flex flex-col justify-center gap-2 min-w-0">
          {/* 상태 뱃지 */}
          <div className="flex items-center gap-1.5">
            {paused ? (
              <span className="font-extrabold tracking-[0.25em] text-[10px]" style={{ color: '#FFD166' }}>
                ⏸ PAUSED
              </span>
            ) : isCurrentBreak ? (
              <span className="font-extrabold tracking-[0.25em] text-[10px]" style={{ color: '#FFD166' }}>
                ☕ BREAK
              </span>
            ) : (
              <>
                <span
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ background: display.accentColor }}
                />
                <span
                  className="font-extrabold tracking-[0.25em] text-[10px]"
                  style={{ color: display.accentColor }}
                >
                  LIVE
                </span>
              </>
            )}
          </div>
          {/* 토너 이름 (truncate) */}
          <div
            className="text-[11px] tracking-wider font-bold truncate"
            style={{ color: display.textColor, opacity: 0.9 }}
            title={heroTitle}
          >
            {heroTitle}
          </div>
          {/* 레벨 */}
          <div className="text-[9px] tracking-[0.3em] mt-1" style={{ color: display.textColor, opacity: 0.6 }}>
            {isCurrentBreak ? `BREAK · ${session.currentLevel}레벨` : `LEVEL ${session.currentLevel}`}
          </div>
          {/* 블라인드 */}
          {!isCurrentBreak && (
            <div>
              <div className="text-[9px] tracking-[0.3em] mb-1" style={{ color: display.textColor, opacity: 0.55 }}>
                BLINDS
              </div>
              <div
                className="font-mono font-extrabold leading-tight"
                style={{
                  fontSize: 'clamp(20px, 3.4vw, 32px)',
                  color: display.blindsColor,
                  letterSpacing: '-0.02em',
                }}
              >
                {session.smallBlind.toLocaleString()}
                <span style={{ opacity: 0.45 }} className="mx-1">/</span>
                {session.bigBlind.toLocaleString()}
              </div>
              {session.ante > 0 && (
                <div className="font-mono text-[10px] mt-0.5" style={{ color: display.textColor, opacity: 0.6 }}>
                  Ante {session.ante.toLocaleString()}
                </div>
              )}
            </div>
          )}
          {/* NEXT 박스 — 컴팩트 */}
          {nextBlind && (
            <div
              className="rounded-lg px-2 py-1.5 border mt-1"
              style={{
                background: 'rgba(0,0,0,0.45)',
                borderColor: nextBlind.isBreak ? '#FFD166' : `${display.accentColor}55`,
              }}
            >
              <div
                className="text-[8px] font-extrabold tracking-[0.3em] mb-0.5"
                style={{ color: nextBlind.isBreak ? '#FFD166' : display.accentColor }}
              >
                ▶ NEXT
              </div>
              {nextBlind.isBreak ? (
                <div className="font-extrabold text-[11px]" style={{ color: '#FFD166' }}>
                  ☕ 휴식 {Math.round(nextBlind.durationSec / 60)}분
                </div>
              ) : (
                <div className="font-mono font-extrabold text-[12px]" style={{ color: display.blindsColor }}>
                  LV {nextBlind.level} · {nextBlind.sb.toLocaleString()}
                  <span style={{ color: display.textColor, opacity: 0.4 }} className="mx-1">/</span>
                  {nextBlind.bb.toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── 중: 거대 타이머 + 진행바 ─── */}
        <div className="flex flex-col items-center justify-center min-w-0">
          <div
            className={`font-mono font-extrabold leading-none transition-colors ${veryLow ? 'animate-pulse' : ''}`}
            style={{
              fontSize: `clamp(80px, 16vw, 220px)`,
              letterSpacing: '-0.05em',
              color: timerColor,
              transition: 'color 0.2s',
            }}
          >
            {fmtTime(sec)}
          </div>
          {/* 진행바 — 가로 전용 (사용자 요구: 드래그로 디테일 시간 조절).
              canControl=true 일 때만 드래그 가능. 비권한자는 표시만. */}
          {(isRunning || paused) && currentDur > 0 && (
            <div className="mt-4 w-full max-w-2xl px-4">
              {canControl ? (
                <LandscapeDraggableProgressBar
                  currentSeconds={sec}
                  currentDur={currentDur}
                  progress={progress}
                  barColor={barColor}
                  textColor={display.textColor}
                  onCommit={onSetTimeRemaining}
                />
              ) : (
                <div className="relative h-1.5 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${progress * 100}%`,
                      background: barColor,
                    }}
                  />
                </div>
              )}
              {currentLevelObj && (
                <div className="flex justify-between text-[9px] mt-1 font-mono" style={{ color: display.textColor, opacity: 0.5 }}>
                  <span>0:00</span>
                  <span>{fmtTime(currentLevelObj.durationSec)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── 우: 보조 정보 ─── */}
        <div className="flex flex-col justify-center gap-2 min-w-0">
          <CompactStat
            label="PLAYERS"
            value={`${session.playersRemaining}/${session.totalPlayers}`}
            sub={`${session.tablesRemaining}테이블`}
            color={display.textColor}
          />
          <CompactStat
            label="PRIZE POOL"
            value={
              display.prizeOverride && display.prizeOverride.trim().length > 0
                ? display.prizeOverride
                : session.prizePool > 0
                ? fmtPrizeDisplay(session.prizePool, session.prizeDisplayUnit ?? 'ticket')
                : '—'
            }
            sub=""
            color={display.textColor}
          />
          <CompactStat
            label="LATE REG"
            value={lateRegDisplay}
            sub={lateClosed ? '' : '남음'}
            color={display.textColor}
            highlight={!lateClosed && lateMin <= 5}
            accentColor={display.accentColor}
          />
        </div>
      </div>

      {/* ─── 하단 컨트롤 행 — 권한자만 노출 (사용자 요구) ─── */}
      {canControl ? (
        <div
          className="mt-2 flex items-center justify-center gap-1.5 flex-wrap rounded-xl px-2 py-1.5 border"
          style={{
            background: 'rgba(0,0,0,0.55)',
            borderColor: 'rgba(255,255,255,0.10)',
          }}
        >
          <CtrlButton
            label="⏮"
            sub="이전"
            onClick={onPrevLevel}
            disabled={session.currentLevel <= 1}
            color={display.textColor}
          />
          <CtrlButton
            label={paused || session.status === 'ready' ? '▶' : '⏸'}
            sub={paused || session.status === 'ready' ? '재개' : '정지'}
            onClick={onTogglePause}
            color={display.textColor}
            primary
            accentColor={display.accentColor}
          />
          <CtrlButton
            label="⏭"
            sub="다음"
            onClick={onNextLevel}
            color={display.textColor}
          />
          <div className="w-px h-7 bg-white/15 mx-0.5" />
          <CtrlButton
            label="−1분"
            onClick={() => onAddMinute(-60)}
            color={display.textColor}
            compact
          />
          <CtrlButton
            label="+1분"
            onClick={() => onAddMinute(+60)}
            color={display.textColor}
            compact
          />
          <div className="w-px h-7 bg-white/15 mx-0.5" />
          <CtrlButton
            label="⏹"
            sub="종료"
            onClick={onStopSession}
            color={'#FF6B6B'}
            danger
          />
          <CtrlButton
            label="⛶"
            sub="화면"
            onClick={onExitFullscreen}
            color={display.textColor}
            compact
          />
        </div>
      ) : authLoading ? (
        /* 인증 로딩 중 — 빈 칸 유지 (깜빡임 방지) */
        <div className="mt-2 h-9" />
      ) : !authedUid ? (
        /* 비로그인 — 클릭 시 매장 로그인 페이지로. 컨트롤하려면 owner 로그인 필요. */
        <div
          className="mt-2 flex items-center justify-center gap-2 rounded-xl px-3 py-1.5 border"
          style={{
            background: 'rgba(0,0,0,0.45)',
            borderColor: 'rgba(255,255,255,0.10)',
          }}
        >
          <span className="text-[10px] tracking-[0.18em] font-bold" style={{ color: display.textColor, opacity: 0.8 }}>
            매장 사장님이신가요?
          </span>
          <a
            href="/login/business"
            className="text-[10px] font-extrabold tracking-[0.18em] px-3 py-1 rounded-md transition-all active:scale-95"
            style={{
              background: `${display.accentColor}22`,
              border: `1px solid ${display.accentColor}66`,
              color: display.accentColor,
            }}
          >
            로그인 →
          </a>
        </div>
      ) : (
        /* 로그인됐지만 권한 없음 — 다른 매장 owner 가능성. subtle 안내 */
        <div
          className="mt-2 text-center py-1.5 rounded-lg border text-[9px] tracking-[0.18em]"
          style={{
            background: 'rgba(0,0,0,0.35)',
            borderColor: 'rgba(255,255,255,0.08)',
            color: display.textColor,
            opacity: 0.45,
          }}
        >
          이 매장의 owner 계정으로 로그인하면 컨트롤이 표시됩니다
        </div>
      )}
    </div>
  );
}

/**
 * 가로 모드 전용 드래그 진행바 — 사용자 요구 핵심:
 *  "타이머시간바로 디테일 시간조절"
 *
 * 컴팩트 가로 layout에 맞춰 hitbox만 키우고 thumb은 작게.
 * 5초 단위 round, 1초 미만/현재 dur 초과 자동 clamp.
 * Commit은 pointer up 시점에 onCommit(targetSec) 호출.
 */
function LandscapeDraggableProgressBar({
  currentSeconds,
  currentDur,
  progress,
  barColor,
  textColor,
  onCommit,
}: {
  currentSeconds: number;
  currentDur: number;
  progress: number;
  barColor: string;
  textColor: string;
  onCommit: (targetSec: number) => void;
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
    onCommit(target);
  };
  const handleCancel = () => {
    if (!dragging) return;
    setDragging(false);
    setPreviewSec(null);
  };

  return (
    <div className="select-none">
      {dragging && previewSec != null && (
        <div
          className="text-[10px] font-bold tracking-widest mb-1 text-center"
          style={{ color: textColor, opacity: 0.9 }}
        >
          🎯 <span className="font-mono">{fmtTime(previewSec)}</span>
        </div>
      )}
      <div
        ref={barRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleCancel}
        className={`relative bg-white/15 rounded-full overflow-hidden cursor-ew-resize transition-all ${
          dragging ? 'h-3 ring-2 ring-white/30' : 'h-2 hover:h-2.5'
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
            dragging ? 'w-4 h-4 opacity-100' : 'w-3 h-3 opacity-0'
          }`}
          style={{ left: `${displayProgress * 100}%`, border: `2px solid ${barColor}` }}
        />
      </div>
    </div>
  );
}

/** 가로 레이아웃 우측 보조 정보 카드 — 컴팩트 stat 박스 */
function CompactStat({
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
    <div
      className="rounded-lg px-2 py-1.5 text-center border"
      style={{ background: 'rgba(0,0,0,0.35)', borderColor: 'rgba(255,255,255,0.10)' }}
    >
      <div className="text-[8px] tracking-[0.3em] mb-0.5" style={{ color, opacity: 0.6 }}>
        {label}
      </div>
      <div
        className="font-mono font-extrabold leading-tight"
        style={{
          fontSize: 'clamp(14px, 2vw, 22px)',
          color: highlight && accentColor ? accentColor : color,
        }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[9px] mt-0.5" style={{ color, opacity: 0.55 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** 가로 레이아웃 컨트롤 버튼 — 통일된 톤. ⏸/▶는 primary, ⏹는 danger */
function CtrlButton({
  label,
  sub,
  onClick,
  disabled,
  color,
  primary,
  danger,
  compact,
  accentColor,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
  disabled?: boolean;
  color: string;
  primary?: boolean;
  danger?: boolean;
  compact?: boolean;
  accentColor?: string;
}) {
  const baseBg = primary
    ? `${accentColor ?? '#22D3EE'}22`
    : danger
    ? 'rgba(255,107,107,0.12)'
    : 'rgba(255,255,255,0.06)';
  const baseBorder = primary
    ? `${accentColor ?? '#22D3EE'}66`
    : danger
    ? 'rgba(255,107,107,0.45)'
    : 'rgba(255,255,255,0.12)';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
      className={`rounded-lg flex flex-col items-center justify-center transition-all active:scale-95 ${
        compact ? 'px-2 py-1' : 'px-3 py-1.5'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : 'hover:brightness-125'}`}
      style={{
        background: baseBg,
        border: `1px solid ${baseBorder}`,
        color,
        minWidth: compact ? 44 : 52,
      }}
    >
      <span className={compact ? 'text-sm font-extrabold' : 'text-base font-extrabold leading-none'}>
        {label}
      </span>
      {sub && (
        <span className="text-[8px] tracking-[0.2em] mt-0.5 opacity-75 font-bold">
          {sub}
        </span>
      )}
    </button>
  );
}
