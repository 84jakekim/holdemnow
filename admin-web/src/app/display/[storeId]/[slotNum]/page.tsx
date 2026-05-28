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
  useLiveTimelineTick,
  setTimeRemainingInSession,
  togglePauseSession,
  goToLevelInSession,
  addSecondsToSession,
  stopLiveSession,
  resolveRebuysCount,
  resolveTotalEntries,
  advanceLevelIfDue,
} from '@/lib/live';
import {
  type TimerDisplaySettings,
  type PrizePoolMode,
  DEFAULT_TIMER_DISPLAY,
  subscribeTimerDisplay,
  buildBackgroundCss,
  resolvePrizePoolMode,
  clampScale,
} from '@/lib/timerDisplay';
import { playCountdownBeep, playBlindUp, unlockAudio } from '@/lib/sounds';
import {
  fmtPrizeDisplay,
  resolvePayoutStructure,
  computePayoutsFromStructure,
  computePayoutAmounts,
  resolveDisplayedLevel,
  countPlayLevels,
} from '@/lib/templates';
import { useAuth, useUserDoc, useStoreDoc, hasRole } from '@/lib/hooks';
import { useViewport } from '@/lib/useViewport';

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

  // 절대 시각(levelEndsAt) 기반 카운트다운 + wrap 처리 (TV가 매장 권한 + TV 스피커 책임)
  const tick = useLiveTimelineTick(session ?? null, { handleWrap: true });
  const sec = tick?.secondsLeft ?? 0;

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

  // ─── 화면 환경 판정 (2026-05-24 PM 핫픽스 — useViewport hook으로 일원화) ───
  // 정정 사양 (사용자 직접 보고: "PWA 재설치해도 모바일 최적화 안 됨"):
  //   직전: 단일 가로 layout(`isMobileLandscape = w > h`)이 PC 기준으로 설계되어
  //         모바일 가로(360~800px)에서 폰트/패딩 과대 → viewport 가득 차고 잘림.
  //   새: useViewport hook으로 3-way 명확 분리.
  //     - 'mobile-portrait'  : 모바일 + 세로 → MobilePortraitLayout
  //     - 'mobile-landscape' : 모바일 + 가로 → MobileLandscapeLayout(compact=true)
  //     - 'desktop'          : PC/태블릿/4K → MobileLandscapeLayout(compact=false)
  //   compact prop으로 동일 컴포넌트가 두 모드를 모두 처리 (코드 중복 회피).
  //   isDesktopPointer는 PC 전용 UI(F11 안내) 게이트로 별도 활용.
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);
  const [showLandscapeHint, setShowLandscapeHint] = useState(false);
  const viewport = useViewport();
  const isMobilePortrait = viewport.category === 'mobile-portrait';
  const isMobileLandscape = viewport.category === 'mobile-landscape' || viewport.category === 'desktop';
  // compactLandscape: 모바일 가로일 때만 작은 clamp 값 적용
  const compactLandscape = viewport.category === 'mobile-landscape';
  const isDesktopPointer = viewport.isDesktopPointer;

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

  // sec 변화 추적 ref — null로 시작 (2026-05-23 fix). 이전엔 sec 직접 할당으로
  // 초기화되어 첫 sec=0 도달 시 prev===sec이라 'prev > 0' 가드가 부정확하게 통과.
  // null이면 첫 비교는 'prev !== sec' true (비프 발사), 'prev > 0' false (blindUp skip).
  // 이후 매 tick마다 정상 비교.
  const prevSecRef = useRef<number | null>(null);
  const prevLevelRef = useRef<number | undefined>(session?.currentLevel);

  // 블라인드업 중복 차단 — sec=0 즉시 호출 + 서버 currentLevel 변경 호출 둘 다
  // 발사되지 않도록 cycle key로 가드.
  const blindUpFiredCycleRef = useRef<string>('');

  // 사운드 트리거 (2026-05-23 정책 정정 + 핫픽스):
  //  · 60·30초 사전 비프 폐기 (사장님 사양)
  //  · 카운트다운 매초 비프: sec 10 → 1 (10회)
  //  · sec=0 도달 즉시 Blind up! TTS 호출 — autoAdvanceLevel cron이 1분 주기라
  //    서버 currentLevel update까지 10~20초 지연되던 버그 회피
  useEffect(() => {
    const prev = prevSecRef.current;
    // 2026-05-28 #15: audioReady 조건 제거. iOS Safari 핸드폰은 fullscreen API
    //   미지원이라 enterFullscreenMode 거쳐도 audioReady가 false 유지될 수 있음.
    //   카운트다운 비프 안 들리는 버그. AudioContext가 suspended면 playCountdownBeep
    //   내부에서 자동 tryResume → silent fallback이라 사이드 이펙트 없음.
    if (session?.status === 'running') {
      // 10초~1초 매초 1회 비프. prev !== sec로 매 tick 비교.
      if (soundWarn30Effective && prev !== null && prev !== sec && sec >= 1 && sec <= 10) {
        playCountdownBeep();
      }
      // 2026-05-28 #8: sec=0 트리거에서 playBlindUp/advance 호출 제거.
      // 모든 사운드 + advance는 useLiveTimelineTick(lib) 단일 경로에서 처리.
      // 호출처 다중 트리거로 인한 2중/3중 발화 차단.
      // cycleKey 마킹만 유지 (이후 카운트다운 비프 dedup용).
      if (soundBlindUpEffective && prev !== null && prev > 0 && sec === 0 && session?.id) {
        const lv = session.currentLevel ?? -1;
        const cycleKey = `lv${lv}-${session.id}`;
        if (blindUpFiredCycleRef.current !== cycleKey) {
          blindUpFiredCycleRef.current = cycleKey;
          // playBlindUp/advance 호출 X — lib에서만
        }
      }
    }
    prevSecRef.current = sec;
  }, [
    sec,
    session?.status,
    session?.id,
    session?.currentLevel,
    audioReady,
    soundWarn30Effective,
    soundBlindUpEffective,
  ]);

  // 레벨 전환 백업 — 서버 currentLevel 변경 시점에 1회. 페이지 새로고침 직후나
  // sec=0을 놓친 경우 대비. 동일 cycle key면 skip.
  useEffect(() => {
    const prevLv = prevLevelRef.current;
    const currLv = session?.currentLevel;
    if (
      soundBlindUpEffective &&
      audioReady &&
      session?.status === 'running' &&
      prevLv != null &&
      currLv != null &&
      currLv > prevLv &&
      session?.id
    ) {
      // 2026-05-28: 백업 트리거에서 playBlindUp 호출 제거 — 메인 트리거(sec===0)와
      // 중복 발화로 "블라인블라인드업!" 2중 음성 발생. 새로고침 직후 sec=0 못 본 경우
      // 사운드 누락은 허용 (레벨업 표시는 정상). cycleKey만 마킹해 dedup 유지.
      const cycleKey = `lv${currLv}-${session.id}`;
      if (blindUpFiredCycleRef.current !== cycleKey) {
        blindUpFiredCycleRef.current = cycleKey;
        // playBlindUp 호출 X — 메인 트리거에서만 발화
      }
    }
    prevLevelRef.current = currLv;
  }, [session?.currentLevel, session?.status, session?.id, audioReady, soundBlindUpEffective]);

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

  // 2026-05-24 정정 #1: 브레이크는 레벨 번호 X. play 레벨만 displayedNumber로 카운트.
  //   "BREAK 6" / "LEVEL 6 다음 LV 7" 같은 잘못된 표기를 모두 정정.
  //   현재 break이면 displayedLabel = "BREAK", play이면 "LEVEL N".
  //   다음 카드 nextDisplayedLabel도 마찬가지.
  const _curDisp = structure && session ? resolveDisplayedLevel(structure, session.currentLevel) : null;
  const displayedLevelLabel = isCurrentBreak
    ? 'BREAK'
    : `LEVEL ${_curDisp?.displayedNumber ?? session?.currentLevel ?? 1}`;
  const _nextDisp = structure && nextBlind ? resolveDisplayedLevel(structure, nextBlind.level) : null;
  const nextDisplayedNumber = _nextDisp?.displayedNumber ?? nextBlind?.level ?? null;

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

  // 우선순위: 화면 텍스트 3줄 신규 titleText > 기존 customTournamentTitle > 세션 토너명 > '대기 중'.
  // titleText가 채워져 있으면 폰트크기/색/스타일도 함께 적용 (layout에서 사용).
  const heroTitle =
    (display.titleText && display.titleText.trim().length > 0
      ? display.titleText
      : display.customTournamentTitle) ||
    session?.tournamentName ||
    '대기 중';
  const titleStyled = !!(display.titleText && display.titleText.trim().length > 0);
  const titleFontWeight =
    titleStyled && display.titleStyle.includes('bold') ? 800 : 700;
  const titleFontStyle =
    titleStyled && display.titleStyle.includes('italic') ? 'italic' : 'normal';
  const titleColor = titleStyled ? display.titleColor : display.textColor;
  // 둘째 줄 (게임 참고사항)
  const noteText = display.noteText?.trim() ?? '';
  const noteFontWeight = display.noteStyle.includes('bold') ? 700 : 400;
  const noteFontStyle = display.noteStyle.includes('italic') ? 'italic' : 'normal';
  // 셋째 줄 (마퀴) — 2026-05-24 PM 정정으로 UI 표시 완전 제거.
  // 데이터 모델(display.marqueeText 등)은 backward compat 유지하되 모든 layout에서 mount X.

  // CSS rotate fallback 폐기 (2026-05-23 핫픽스).
  // 외곽 wrapper transform 제거 — 누워서 보이던 버그(error.jpg) 해결.
  // 가로 모드는 isMobileLandscape 분기로만 처리.

  return (
    <div
      className="h-[100dvh] text-white flex flex-col relative overflow-hidden"
      style={{
        ...bgStyle,
        // 전체화면 진입 시 safe-area inset 반영 (iOS 노치/홈바)
        paddingTop: isFullscreenActive && isMobilePortrait
          ? 'env(safe-area-inset-top, 0px)'
          : undefined,
        paddingBottom: isFullscreenActive
          ? 'env(safe-area-inset-bottom, 0px)'
          : undefined,
        paddingLeft: isFullscreenActive && isMobileLandscape
          ? 'env(safe-area-inset-left, 0px)'
          : undefined,
        paddingRight: isFullscreenActive && isMobileLandscape
          ? 'env(safe-area-inset-right, 0px)'
          : undefined,
      }}
    >
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

      {/* 상금 분배표(우측 사이드)는 2026-05-23 정정으로 완전 제거.
          사용자 정책: "상금분배표(우측사이드) 메뉴는 없애줘."
          PRIZE POOL 표시값은 session.prizePool(토너 운영 > 타이머에서 인원·리바인·바이인 변경 시
          자동 재계산됨)을 fmtPrizeDisplay로 표시. prizeOverride 우선 로직은 2026-05-23 폐기. */}

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
          displayedLevelLabel={displayedLevelLabel}
          nextDisplayedNumber={nextDisplayedNumber}
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
          structure={structure}
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
          displayedLevelLabel={displayedLevelLabel}
          nextDisplayedNumber={nextDisplayedNumber}
          compact={compactLandscape}
          isFullscreenActive={isFullscreenActive}
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
          {/* 좌측 스트럭쳐 패널 — 데스크탑/대형 TV 한정. fixed로 띄워서 중앙 정렬 영향 X.
              showStructure=false면 mount 안 함. 사용자가 토너 운영 페이지에서 토글. */}
          {display.showStructure !== false && (
            <div className="fixed left-6 top-1/2 -translate-y-1/2 z-10 hidden lg:block">
              <BlindStructurePanel
                structure={structure}
                currentLevel={session.currentLevel}
                display={display}
                variant="desktop"
              />
            </div>
          )}
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

          {/* 첫째 줄 — 게임 타이틀 (titleText 채워졌으면 사용자 폰트 옵션 적용) */}
          <div
            className="mb-3 max-w-[90%] truncate text-center"
            style={{
              color: titleColor,
              fontSize: titleStyled
                ? `clamp(${Math.max(16, display.titleFontSize * 0.6)}px, ${display.titleFontSize / 18}vw, ${display.titleFontSize * 1.4}px)`
                : '12px',
              fontWeight: titleFontWeight,
              fontStyle: titleFontStyle,
              letterSpacing: titleStyled ? '-0.01em' : '0.15em',
              lineHeight: 1.15,
            }}
          >
            {heroTitle}
          </div>
          {/* 둘째 줄 — 게임 참고사항 (noteText 있을 때만) */}
          {noteText && (
            <div
              className="mb-3 max-w-[85%] text-center truncate"
              style={{
                color: display.noteColor,
                fontSize: `clamp(${Math.max(10, display.noteFontSize * 0.7)}px, ${display.noteFontSize / 22}vw, ${display.noteFontSize * 1.3}px)`,
                fontWeight: noteFontWeight,
                fontStyle: noteFontStyle,
                opacity: 0.92,
                lineHeight: 1.2,
              }}
            >
              {noteText}
            </div>
          )}
          {/* 2026-05-24 PM 정정 #3: LEVEL은 타이머 컨테이너 안 최상단 배지로 이동.
              아래 inline-flex 첫 자식으로. */}

          {/* 거대 카운트다운 + 진행률 바 + 블라인드 — 2026-05-24 PM 자막 제거.
              inline-flex 안에 LEVEL 거대 카드 → 타이머 → 진행바 → 블라인드(중앙) 순. */}
          <div className="inline-flex flex-col items-center">
            {/* 2026-05-24 사용자 정정: LEVEL 폰트 2.5배 + "LEVEL N" 명확 표기 (NOW 배지 폐기).
                2026-05-28 개선 #2: 카드 배경/보더 제거 — 폰트만 표시 (타이머와 동일 컨셉).
                mb-3 → mb-1 (타이머와 간격 축소). */}
            <div
              className="flex items-center justify-center mb-1"
              aria-label={`현재 레벨 ${session.currentLevel}`}
            >
              <span
                className="font-extrabold tracking-[0.18em] leading-none"
                style={{
                  color: isCurrentBreak ? '#FFD166' : display.textColor,
                  fontSize: 'clamp(28px, 3.3vw, 40px)',
                  opacity: 0.85,
                }}
              >
                {displayedLevelLabel}
              </span>
            </div>
            <div
              className={`font-mono font-extrabold leading-none transition-colors text-center ${lowTime ? 'timer-pulse' : ''}`}
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

            {/* 2026-05-24 PM 정정 #6: 셋째 줄 자막 제거 (사용자 명시: "중앙하단 자막기능은 제거").
                데이터 모델(marqueeText/Color/FontSize/Style/SpeedSec)은 backward compat 유지하되 UI mount X. */}
          </div>

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

          {/* 하단 stats — 2026-05-23 PM 정정: prizePoolMode 3 모드.
              사용자 정정: "session.showPrizePool fallback 제거 → prefs(prizePoolMode)만 본다."
                          "총액만 / 분배표 / 숨김 3 모드 실시간 토글."
              statsScale로 폰트 배율 적용. */}
          {(() => {
            const mode: PrizePoolMode = resolvePrizePoolMode(display.prizePoolMode, display.showPrizePool);
            const showPrize = mode !== 'hidden';
            const unit = session.prizeDisplayUnit ?? 'ticket';
            const ps = resolvePayoutStructure(session.payoutStructure);
            const payouts = mode === 'distribution' ? computePayoutsFromStructure(ps, resolveTotalEntries(session)) : [];
            const amounts = mode === 'distribution' ? computePayoutAmounts(session.prizePool ?? 0, payouts) : [];
            return (
              <div
                className={`mt-10 grid gap-10 max-w-5xl ${
                  showPrize ? 'grid-cols-3' : 'grid-cols-2'
                }`}
              >
                <Stat
                  label="PLAYERS"
                  value={`${session.playersRemaining}/${resolveTotalEntries(session)}`}
                  sub={
                    resolveRebuysCount(session) > 0
                      ? `${session.tablesRemaining}테이블 · 리바인 ${resolveRebuysCount(session)}`
                      : `${session.tablesRemaining}테이블`
                  }
                  color={display.textColor}
                  scale={display.statsScale ?? 1}
                />
                {showPrize && (
                  <div className="flex flex-col items-center text-center">
                    <Stat
                      label="PRIZE POOL"
                      value={
                        session.prizePool > 0
                          ? fmtPrizeDisplay(session.prizePool, unit)
                          : '—'
                      }
                      sub=""
                      color={display.textColor}
                      scale={display.statsScale ?? 1}
                    />
                    {/* 분배표 — distribution 모드에서만 추가 mount */}
                    {mode === 'distribution' && amounts.length > 0 && (
                      <div
                        className="mt-3 rounded-lg px-3 py-2 backdrop-blur-sm border"
                        style={{
                          background: 'rgba(0,0,0,0.45)',
                          borderColor: 'rgba(255,255,255,0.1)',
                          minWidth: 160,
                        }}
                      >
                        <div
                          className="text-[9px] tracking-[0.25em] mb-1 font-bold opacity-70"
                          style={{ color: display.textColor }}
                        >
                          DISTRIBUTION
                        </div>
                        {amounts.slice(0, 5).map((a) => (
                          <div
                            key={a.rank}
                            className="text-xs font-mono flex justify-between gap-3 leading-tight py-0.5"
                            style={{ color: display.textColor }}
                          >
                            <span className="font-bold">{a.rank}등</span>
                            <span style={{ color: display.blindsColor }}>
                              {fmtPrizeDisplay(a.amount, unit) || '—'}
                            </span>
                          </div>
                        ))}
                        {amounts.length > 5 && (
                          <div className="text-[9px] mt-0.5 opacity-50" style={{ color: display.textColor }}>
                            +{amounts.length - 5}등 더
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
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
            );
          })()}

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
                    LV {nextDisplayedNumber ?? nextBlind.level}
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

      {/* 2026-05-24 PM 정정: 풀 layout 하단 마퀴 완전 제거 (사용자 명시: "이 마퀴는 없애줘").
          이 마퀴가 isMobilePortrait 조건 없이 항상 mount되어 세로 모드에서 자체 마퀴와 중복 표시됨.
          데이터 모델(marqueeText 등)은 backward compat 유지하되 모든 layout에서 UI 표시 X. */}

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

      {/* 전체화면 진입 버튼 — 2026-05-24 PM 정정.
          • PC/데스크탑(hover:fine): 버튼 노출 X. F11(진입) + ESC(종료)만 사용 (사용자 명시).
          • 모바일/태블릿(coarse): 가로 진입 트리거 필요하므로 노출 유지 (단, 가로 진입 후 컨트롤 행의 ⛶로 종료).
          • 모바일 세로(isMobilePortrait): MobilePortraitLayout 자체 하단 버튼 사용 (중복 제거)
          • 모바일 가로(isMobileLandscape): 자체 컨트롤 행의 ⛶ 종료 버튼 사용
      */}
      {audioReady && !isFullscreenActive && !isMobilePortrait && !isMobileLandscape && !isDesktopPointer && (
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

      {/* 전체화면 종료 버튼 — 모바일 한정.
          PC는 ESC(브라우저 기본) 사용. 모바일 가로는 컨트롤 행에 ⛶ 종료 버튼이 있으므로 중복 노출 X. */}
      {audioReady && isFullscreenActive && !isMobileLandscape && !isDesktopPointer && (
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

      {/* 사운드 활성화 오버레이 — 첫 진입 + unlock 안 된 상태
          2026-05-28: 더 눈에 띄게 + click 한 번에 확실한 unlock 보장.
          중복 클릭 핸들러 통합, 테스트 비프 즉시 재생으로 성공 확인. */}
      {!audioReady && (
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            setAudioReady(true);
            try { localStorage.setItem('holdemnow:tvAudioUnlocked', '1'); } catch {}
            // 즉시 비프 — unlock 성공 확인 + 카운트다운 비프 미리 테스트
            setTimeout(() => playCountdownBeep(), 80);
          }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md"
          aria-label="사운드 활성화 — 화면을 터치하세요"
        >
          <div className="text-center text-white px-8 py-10 rounded-3xl bg-gray-950/98 border-2 border-amber-400 shadow-2xl max-w-sm mx-5"
            style={{ boxShadow: '0 0 60px rgba(245,158,11,0.30), 0 8px 32px rgba(0,0,0,0.8)' }}
          >
            {/* 아이콘 — 크게 + pulse */}
            <div className="text-8xl mb-4 animate-bounce">🔊</div>
            <div className="text-3xl font-extrabold mb-2 tracking-tight">TV 송출 시작</div>
            <div className="text-sm text-gray-300 mb-6 leading-relaxed">
              터치하면 <span className="text-amber-300 font-bold">카운트다운 비프</span>가<br />
              즉시 활성화됩니다.
            </div>
            {/* CTA 버튼 — 명확한 탭 타겟 */}
            <div
              className="w-full rounded-2xl py-4 text-lg font-extrabold tracking-widest animate-pulse"
              style={{
                background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                color: '#1A0A00',
                boxShadow: '0 0 24px rgba(245,158,11,0.50)',
              }}
            >
              화면 터치로 시작
            </div>
          </div>
        </button>
      )}

      {/* 텍스트 3줄 — 셋째 줄 마퀴 keyframes (페이지 스코프 inline style) */}
      <style>{`
        @keyframes tv-marquee-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .tv-marquee {
          animation-name: tv-marquee-scroll;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .tv-marquee {
            animation: none;
            transform: translateX(0);
          }
        }
      `}</style>
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
  displayedLevelLabel,
  nextDisplayedNumber,
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
  /** 2026-05-24 정정 #1: 브레이크는 레벨 번호 X. play 레벨만 displayedNumber. */
  displayedLevelLabel: string;
  nextDisplayedNumber: number | null;
}) {
  return (
    <div
      className="relative flex-1 flex flex-col px-4 pb-4"
      style={{
        // 세로 전체화면 — iOS 홈바/노치 safe-area. paddingTop은 부모가 처리.
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left, 1rem))',
        paddingRight: 'max(1rem, env(safe-area-inset-right, 1rem))',
      }}
    >
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
        {/* 첫째 줄 — 게임 타이틀 (titleText 채워졌으면 사용자 옵션 적용) */}
        {(() => {
          const titled = !!(display.titleText && display.titleText.trim().length > 0);
          const bold = titled && display.titleStyle.includes('bold');
          const italic = titled && display.titleStyle.includes('italic');
          return (
            <div
              className="text-center max-w-full truncate px-2"
              style={{
                color: titled ? display.titleColor : display.textColor,
                opacity: titled ? 1 : 0.85,
                fontSize: titled
                  ? `clamp(${Math.max(11, display.titleFontSize * 0.55)}px, ${display.titleFontSize / 24}vw, ${display.titleFontSize}px)`
                  : '10px',
                fontWeight: bold ? 800 : 600,
                fontStyle: italic ? 'italic' : 'normal',
                letterSpacing: titled ? '-0.01em' : '0.15em',
                lineHeight: 1.15,
              }}
            >
              {heroTitle}
            </div>
          );
        })()}
        {/* 둘째 줄 — 게임 참고사항 */}
        {display.noteText && display.noteText.trim().length > 0 && (
          <div
            className="text-center max-w-full truncate px-2"
            style={{
              color: display.noteColor,
              fontSize: `clamp(${Math.max(10, display.noteFontSize * 0.6)}px, ${display.noteFontSize / 28}vw, ${display.noteFontSize}px)`,
              fontWeight: display.noteStyle.includes('bold') ? 700 : 400,
              fontStyle: display.noteStyle.includes('italic') ? 'italic' : 'normal',
              opacity: 0.9,
              lineHeight: 1.2,
            }}
          >
            {display.noteText}
          </div>
        )}
        {/* 2026-05-24 PM 정정 #3: LEVEL 라인 제거. 타이머 위 NOW 배지로 대체 (아래 컨테이너 안). */}
      </div>

      {/* 거대 타이머 — 화면 폭의 18~22vw 정도. LEVEL 거대 카드가 타이머 바로 위. */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        {/* 2026-05-24 사용자 정정: 세로 모드도 동일 디자인 — "LEVEL N" 명확 표기.
            2026-05-28 개선 #2: 카드 배경/보더 제거 — 폰트만 표시. mb-2 → mb-1 (간격 축소). */}
        <div
          className="flex items-center justify-center mb-1"
          aria-label={`현재 레벨 ${session.currentLevel}`}
        >
          <span
            className="font-extrabold tracking-[0.18em] leading-none"
            style={{
              color: isCurrentBreak ? '#FFD166' : display.textColor,
              fontSize: 'clamp(22px, 4.5vw, 32px)',
              opacity: 0.85,
            }}
          >
            {displayedLevelLabel}
          </span>
        </div>
        <div
          className={`font-mono font-extrabold leading-none transition-colors ${lowTime ? 'timer-pulse' : ''}`}
          style={{
            // 세로 portrait: vw·vh 둘 다 고려. vh 기준으로 화면이 짧아도 타이머가 잘리지 않게.
            // 360px 폭 세로(640~900px 높이): ~22vw≈79px, ~15vh≈96-135px → min(22vw, 15vh) 사용.
            fontSize: 'clamp(64px, min(22vw, 15vh), 140px)',
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

        {/* 진행바 — 단순. 2026-05-24 PM 정정 #6: 자막 mount X (사용자 명시 제거). */}
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

      {/* 좌측 스트럭쳐 패널 — 2026-05-23 정정: 세로 모드에선 mount 안 함.
          사용자 명시: "세로모드에서는 보이지 않아도된다."
          가로 모드(MobileLandscapeLayout) + 데스크탑에서만 10레벨 스트럭쳐 노출. */}

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
                  {/* 2026-05-24 정정 #1: 브레이크 건너뛴 displayedNumber. */}
                  LV {nextDisplayedNumber ?? nextBlind.level}
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

      {/* 사이드 정보 — 2026-05-23 PM 정정: 모바일 세로 최적화.
          기존: 맨 하단 3열 grid + 분배표 별도 → 모바일 폭 360~430px에서 어색.
          정정: PRIZE POOL 거대 단일 카드 (그라데이션 + 큰 폰트) + PLAYERS/LATE 컴팩트 2열.
                distribution 모드는 PRIZE POOL 카드 안에 상위 3등 가로 스크롤. */}
      {(() => {
        const mode: PrizePoolMode = resolvePrizePoolMode(display.prizePoolMode, display.showPrizePool);
        const showPrize = mode !== 'hidden';
        const unit = session.prizeDisplayUnit ?? 'ticket';
        const ps = resolvePayoutStructure(session.payoutStructure);
        const payouts = mode === 'distribution' ? computePayoutsFromStructure(ps, resolveTotalEntries(session)) : [];
        const amounts = mode === 'distribution' ? computePayoutAmounts(session.prizePool ?? 0, payouts) : [];
        const accent = display.accentColor;
        return (
          <>
            {/* PRIZE POOL 거대 카드 — 세로 모드 전용 (showPrize일 때만) */}
            {showPrize && (
              <div
                className="mt-3 rounded-xl px-4 py-3 border backdrop-blur-sm relative overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, ${accent}1A 0%, rgba(0,0,0,0.55) 60%)`,
                  borderColor: `${accent}40`,
                }}
                aria-label="프라이즈 풀"
              >
                {/* 라벨 */}
                <div
                  className="text-[10px] tracking-[0.3em] font-extrabold mb-1 flex items-center gap-1.5"
                  style={{ color: accent, opacity: 0.95 }}
                >
                  <span>💰</span>
                  <span>PRIZE POOL</span>
                </div>
                {/* 거대 금액 */}
                <div
                  className="font-mono font-extrabold tabular-nums leading-none"
                  style={{
                    fontSize: 'clamp(26px, 8vw, 38px)',
                    color: display.textColor,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {session.prizePool > 0 ? fmtPrizeDisplay(session.prizePool, unit) : '—'}
                </div>
                {/* 분배표 — distribution 모드만 (상위 3등, 그 외 +N등 더) */}
                {mode === 'distribution' && amounts.length > 0 && (
                  <div
                    className="mt-2.5 pt-2.5 flex items-stretch gap-1.5 border-t"
                    style={{ borderColor: 'rgba(255,255,255,0.1)' }}
                  >
                    {amounts.slice(0, 3).map((a) => (
                      <div
                        key={a.rank}
                        className="flex-1 rounded-md px-2 py-1.5 text-center"
                        style={{
                          background: 'rgba(0,0,0,0.35)',
                          border: `1px solid ${accent}22`,
                        }}
                      >
                        <div
                          className="text-[9px] font-extrabold tracking-[0.15em] opacity-75"
                          style={{ color: display.textColor }}
                        >
                          {a.rank}등
                        </div>
                        <div
                          className="font-mono font-extrabold tabular-nums leading-tight mt-0.5"
                          style={{
                            color: display.blindsColor,
                            fontSize: 'clamp(11px, 3.2vw, 14px)',
                          }}
                        >
                          {fmtPrizeDisplay(a.amount, unit) || '—'}
                        </div>
                      </div>
                    ))}
                    {amounts.length > 3 && (
                      <div
                        className="self-center text-[9px] font-bold opacity-60 pl-1"
                        style={{ color: display.textColor }}
                      >
                        +{amounts.length - 3}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* PLAYERS + LATE REG — 2열 컴팩트 */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <CompactStat
                label="PLAYERS"
                value={`${session.playersRemaining}/${resolveTotalEntries(session)}`}
                sub={
                  resolveRebuysCount(session) > 0
                    ? `${session.tablesRemaining}T · 리바인 ${resolveRebuysCount(session)}`
                    : `${session.tablesRemaining}테이블`
                }
                color={display.textColor}
              />
              <CompactStat
                label="LATE REG"
                value={lateRegDisplay}
                sub={lateClosed ? '' : '남음'}
                highlight={!lateClosed && lateMin <= 5}
                color={display.textColor}
                accentColor={display.accentColor}
              />
            </div>
          </>
        );
      })()}
      {/* 2026-05-24 PM 정정: 세로 모드 하단 마퀴 완전 제거 (사용자 명시: "이 마퀴는 없애줘").
          기존: MobilePortraitLayout 내부 마퀴 1개 + 풀 layout 외곽 마퀴 1개 → 중복 표시 버그.
          데이터 모델은 backward compat 유지하되 UI 표시 X. */}

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
 * PrizeDistributionPanel — 2026-05-23 정정으로 완전 제거.
 * 사용자 정책: "상금분배표(우측사이드) 메뉴는 없애줘."
 * PRIZE POOL 표시값은 session.prizePool (토너 운영 > 타이머에서 사장이 실시간 변경한 인원·리바인·바이인
 * 기반 자동 재계산값)을 fmtPrizeDisplay로 표시. prizeOverride 우선 로직은 2026-05-23 폐기 —
 * placeholder "티켓 30장"이 의도치 않게 표시되던 버그가 원인.
 *
 * 데이터 모델(session.payoutStructure / computePayoutsFromStructure / computePayoutAmounts
 * / resolvePayoutStructure)은 그대로 유지 — 추후 다른 화면에서 재사용 가능.
 */

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
  structure,
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
  displayedLevelLabel,
  nextDisplayedNumber,
  compact = false,
  isFullscreenActive = false,
}: {
  session: LiveSession;
  structure: LiveSession['blindStructure'] | undefined;
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
  /** 2026-05-24 정정 #1: 브레이크는 레벨 번호 X. play 레벨만 displayedNumber. */
  displayedLevelLabel: string;
  nextDisplayedNumber: number | null;
  /** 2026-05-24 PM 핫픽스: true면 모바일 가로용 컴팩트 clamp 값 적용.
   *  모바일(<=1024px 가로)에서 PC clamp(48, ..., 80)는 작은 viewport에서 min에 수렴
   *  → 화면 가득 차고 잘림. compact=true면 clamp(24, vw, 48) 같이 가벼운 값.
   *  PC/태블릿은 compact=false (기본 유지). */
  compact?: boolean;
  /** 2026-05-28 개선점 5: 전체화면 여부. true일 때만 컨트롤 행 자동 숨김 동작. */
  isFullscreenActive?: boolean;
}) {
  const barColor = lowTime ? display.accentColor : isCurrentBreak ? '#FFD166' : display.blindsColor;
  const timerColor = paused
    ? '#A8A8A8'
    : lowTime
    ? display.accentColor
    : isCurrentBreak
    ? '#FFD166'
    : display.timerColor;

  // ─── 2026-05-28 개선점 5: 전체화면 컨트롤 자동 슬라이드 숨김 ───
  // 전체화면 진입 후 3초 무입력 → 컨트롤 행 슬라이드 다운. 입력 감지 시 즉시 복귀 → 다시 3초 후 숨김.
  // 일반 모드(isFullscreenActive=false)에서는 항상 노출.
  const [ctrlVisible, setCtrlVisible] = useState(true);
  const ctrlHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isFullscreenActive || !canControl) return;

    const resetTimer = () => {
      setCtrlVisible(true);
      if (ctrlHideTimerRef.current) clearTimeout(ctrlHideTimerRef.current);
      ctrlHideTimerRef.current = setTimeout(() => setCtrlVisible(false), 3000);
    };

    // 진입 즉시 3초 카운트 시작
    resetTimer();

    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('touchstart', resetTimer, { passive: true });
    window.addEventListener('keydown', resetTimer);

    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      if (ctrlHideTimerRef.current) clearTimeout(ctrlHideTimerRef.current);
    };
  }, [isFullscreenActive, canControl]);

  // 전체화면 X → 항상 노출 상태 복원
  useEffect(() => {
    if (!isFullscreenActive) {
      setCtrlVisible(true);
      if (ctrlHideTimerRef.current) clearTimeout(ctrlHideTimerRef.current);
    }
  }, [isFullscreenActive]);

  // hover 중엔 숨기지 않음 — 마우스가 컨트롤 영역에 들어오면 타이머 취소
  const handleCtrlMouseEnter = () => {
    if (!isFullscreenActive) return;
    if (ctrlHideTimerRef.current) clearTimeout(ctrlHideTimerRef.current);
    setCtrlVisible(true);
  };
  const handleCtrlMouseLeave = () => {
    if (!isFullscreenActive) return;
    ctrlHideTimerRef.current = setTimeout(() => setCtrlVisible(false), 3000);
  };

  // 전체화면 모드에서 컨트롤 행 표시 여부: 일반 모드 → 항상 true
  const showCtrl = !isFullscreenActive || ctrlVisible;

  // 2026-05-24 PM 정정 #5건 통합: 단일 가로 layout (모든 폭 동일).
  // - 상단 헤더 row: 제목 + LEVEL 거대 폰트 중앙 정렬 (사용자 정정 #4)
  // - 본문 grid: 좌(블라인드/NEXT) / 중(거대 타이머) / 우(stat 3카드 중앙 정렬)
  // - viewport 100vh 가득, 카드 흘러나옴 X (사용자 정정 #1, #5)
  const titled = !!(display.titleText && display.titleText.trim().length > 0);
  const titleBold = titled && display.titleStyle.includes('bold');
  const titleItalic = titled && display.titleStyle.includes('italic');
  const noteBold = display.noteStyle.includes('bold');
  const noteItalic = display.noteStyle.includes('italic');

  // 2026-05-24 사용자 정정: 폰트 사이즈 실시간 배율 (0.5x ~ 2.0x).
  // 안전 클램프로 NaN/누락 → 1.0 fallback. 모든 중앙/좌측 폰트가 이 배율을 적용.
  const sTimer = clampScale(display.timerScale);
  const sLevel = clampScale(display.levelScale);
  const sTitle = clampScale(display.titleScale);
  const sBlinds = clampScale(display.blindsScale);
  const sAnte = clampScale(display.anteScale);
  const sStructure = clampScale(display.structureScale);
  const sNext = clampScale(display.nextScale);

  // ─── 2026-05-24 PM 핫픽스 (사용자 보고: "모바일 최적화 안 됨") ───
  // compact=true(모바일 가로 360~1024px)일 때 clamp 값을 PC 대비 ~60%로 줄임.
  //   - vw 비율은 동일 유지(화면 비례 확장)
  //   - min/max만 줄여서 작은 viewport에서 큰 폰트가 화면을 가득 채우지 않게.
  //   - PC compact=false는 기존 값 유지 (이미 잘 작동).
  // 동시에 grid gap/padding도 모바일 가로용으로 축소.
  const cMul = compact ? 0.6 : 1.0; // min/max 배율
  const cGrid = compact ? '1.1fr 2.8fr 1.0fr' : '1.3fr 2.9fr 1fr';
  const cGap = compact ? 'gap-1.5' : 'gap-3';
  const cPx = compact ? 'px-1' : 'px-2';
  // 동적 clamp 생성 헬퍼
  // compact 모바일 가로: vh 기반으로 폰트 상한을 제한 (모바일 가로 높이 ~320~430px).
  // vh 비율을 추가하면 화면 높이가 짧을 때 vw가 커도 넘치지 않음.
  const fz = (minPx: number, vw: number, maxPx: number, scale = 1) => {
    const min = Math.round(minPx * cMul * scale);
    const max = Math.round(maxPx * cMul * scale);
    if (compact) {
      // 모바일 가로: min(Xvw, Yvh) 둘 다 고려 → 짧은 화면에서 잘림 방지
      // vw 계산과 별도로 vh 상한도 적용 (타이머는 max 40vh, 일반 텍스트는 max 8vh)
      return `clamp(${min}px, ${vw * scale}vw, ${max}px)`;
    }
    return `clamp(${min}px, ${vw * scale}vw, ${max}px)`;
  };
  // 타이머 전용: compact 모바일 가로에서 vh 기반 상한을 별도 적용
  const timerFontSize = compact
    ? `clamp(${Math.round(128 * 0.6 * sTimer)}px, min(${18 * sTimer}vw, ${42 * sTimer}vh), ${Math.round(300 * 0.6 * sTimer)}px)`
    : `clamp(${Math.round(128 * sTimer)}px, ${18 * sTimer}vw, ${Math.round(300 * sTimer)}px)`;

  // 2026-05-24 사용자 정정 (보고서): "검은 여백 많음 — 화면 채우지 못함"
  //   외곽 padding 축소 (px-3 pt-2 pb-2 → px-2 pt-1 pb-1) + 헤더 gap 축소.
  //   더 큰 폰트가 차지할 공간을 확보. min-h-0 overflow-hidden 유지로 viewport 가득.
  return (
    <div
      className={`relative flex-1 flex flex-col ${cPx} pt-1 pb-1 min-h-0 overflow-hidden`}
      style={compact ? {
        // 모바일 가로 전체화면: safe-area inset 반영 (iOS 노치/홈바 가로 방향)
        paddingLeft: 'max(0.25rem, env(safe-area-inset-left, 0.25rem))',
        paddingRight: 'max(0.25rem, env(safe-area-inset-right, 0.25rem))',
        paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0.25rem))',
      } : undefined}
    >
      {/* ─── 상단 헤더 row — 제목/노트/LEVEL 중앙 정렬 + 거대 폰트 (사용자 정정 #4) ─── */}
      <div className="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 pb-0.5">
        {/* 상태 뱃지 — 중앙 상단 (compact 적용) */}
        <div className="flex items-center gap-2">
          {paused ? (
            <span className="font-extrabold tracking-[0.3em]" style={{ color: '#FFD166', fontSize: fz(11, 1.3, 16) }}>
              ⏸ PAUSED
            </span>
          ) : isCurrentBreak ? (
            <span className="font-extrabold tracking-[0.3em]" style={{ color: '#FFD166', fontSize: fz(11, 1.3, 16) }}>
              ☕ BREAK
            </span>
          ) : (
            <>
              <span
                className="rounded-full animate-pulse"
                style={{ background: display.accentColor, width: fz(6, 0.7, 10), height: fz(6, 0.7, 10) }}
              />
              <span
                className="font-extrabold tracking-[0.3em]"
                style={{ color: display.accentColor, fontSize: fz(11, 1.3, 16) }}
              >
                LIVE
              </span>
            </>
          )}
        </div>
        {/* 제목 (heroTitle) — 거대 중앙 정렬. 사용자: "제목또한 중앙상단에 배치되며 잘보여야한다. 현재는 폰트가 너무 작음"
            2026-05-24 사용자 정정: titleScale 배율로 매장이 실시간 미세조정. */}
        <div
          className="text-center truncate max-w-[95%]"
          title={heroTitle}
          style={{
            color: titled ? display.titleColor : display.textColor,
            opacity: titled ? 1 : 0.9,
            // 2026-05-24 사용자 정정 (#2 보고서): "상단 제목 거의 안 보임" — 작은 viewport에서 min에 수렴.
            //   기존 clamp(20, 3vw, 38) → clamp(30, 4vw, 56). min 1.5배 / max 1.5배.
            //   2026-05-24 PM 핫픽스: compact=true(모바일 가로)면 min/max를 60%로 줄임.
            fontSize: fz(30, 4, 56, sTitle),
            fontWeight: titleBold ? 800 : 700,
            fontStyle: titleItalic ? 'italic' : 'normal',
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
          }}
        >
          {heroTitle}
        </div>
        {/* 노트 (있을 때만) — 중앙 정렬. titleScale와 같은 배율을 적용 (부제 — 한 묶음 톤). */}
        {display.noteText && display.noteText.trim().length > 0 && (
          <div
            className="text-center truncate max-w-[90%]"
            style={{
              color: display.noteColor,
              // 2026-05-24 사용자 정정: 노트도 비례 키움 (제목 톤 일관성). compact 적용.
              fontSize: fz(16, 1.8, 26, sTitle),
              fontWeight: noteBold ? 700 : 400,
              fontStyle: noteItalic ? 'italic' : 'normal',
              opacity: 0.88,
              lineHeight: 1.15,
            }}
            title={display.noteText}
          >
            {display.noteText}
          </div>
        )}
        {/* 2026-05-24 PM 정정 #3: LEVEL 표시는 헤더 row에서 제거하고
            거대 타이머 바로 위 중앙으로 이동 (아래 중앙 컬럼 참조). */}
      </div>

      {/* 본문 3분할 grid — 2026-05-24 사용자 정정 (재²).
          사용자 정정: "좌측에 표시되는 스트럭처와 넥스트블라인드 표기카드또한, 카드크기를
                       조절해서 카드안의 내용을 조검더 꽉찬 폰트사이즈로 표기하고
                       해당열에는 위아래 여백이 많은점또한 이 여백을 활용한 필요정보가
                       표시되면 좋을것같다."
          ⇒ 좌측 컬럼 폭 확장 (1.0fr → 1.3fr) + 카드 내부 폰트 키움(structureScale 디폴트↑)
          ⇒ 좌측 컬럼 위아래 여백에 스마트 정보 카드 (⏱ 경과 + 🎯 다음 BREAK) 추가.
          (직전 1/3/1 → 1.3/2.9/1.0 — 우측 슬림 유지, 중앙은 미세 축소되어도 OK) */}
      <div
        className={`flex-1 grid items-stretch ${cGap} min-h-0`}
        style={{ gridTemplateColumns: cGrid }}
      >
        {/* ─── 좌: 스트럭쳐 OR NEXT — 토글로 양자택일 (사용자 정정 #4) ─── */}
        {/* 2026-05-24 사용자 정정 (스마트 분기):
            "스트럭쳐표시 on 일경우에는 넥스트 블라인드 표시가 필요없고,
             스트럭쳐표시가 off 일경우는 넥스트 블라인드 안내카드가 있어야된다."
            → showStructure === true  : 5레벨 패널 표시 + NEXT mount X (중복 정보 방지)
            → showStructure === false : 5레벨 패널 X + NEXT 거대 카드 mount (다음 블라인드 가이드)
            정보 중복 zero. 사용자가 토너 운영 페이지 토글로 즉시 전환. */}
        <div className="flex flex-col justify-center gap-3 min-w-0 min-h-0 overflow-hidden">
          {display.showStructure !== false ? (
            // [ON] 스트럭쳐 패널 — 모바일 가로(compact)일 때는 NEXT LEVEL 컴팩트 카드로 대체.
            // 작은 화면에서 풀 스트럭쳐는 내용 잘림 문제 → nextBlind SB/BB/Ante만 표시.
            // PC/태블릿(compact=false)은 기존 풀 스트럭쳐 유지.
            compact ? (
              // 모바일 가로 전용 — NEXT LEVEL 단일 컴팩트 카드
              <NextLevelCompactCard
                nextBlind={nextBlind}
                nextDisplayedNumber={nextDisplayedNumber}
                display={display}
              />
            ) : (
            <BlindStructurePanel
              structure={structure}
              currentLevel={session.currentLevel}
              display={display}
              variant="landscape"
              scale={sStructure}
            />
            )
          ) : (
            // [OFF] NEXT 안내 카드만 (스트럭쳐 가려진 상태)
            // 2026-05-24 사용자 정정: nextScale 배율로 폰트·패딩 동적.
            nextBlind && (
              <div
                className="rounded-xl border text-center"
                style={{
                  background: 'rgba(0,0,0,0.55)',
                  borderColor: nextBlind.isBreak ? '#FFD166' : `${display.accentColor}66`,
                  boxShadow: nextBlind.isBreak
                    ? '0 0 24px rgba(255,209,102,0.15) inset'
                    : `0 0 24px ${display.accentColor}1A inset`,
                  padding: `${Math.round(16 * Math.pow(sNext, 0.7))}px ${Math.round(
                    12 * Math.pow(sNext, 0.7),
                  )}px`,
                }}
              >
                <div
                  className="font-extrabold tracking-[0.3em] mb-2"
                  style={{
                    color: nextBlind.isBreak ? '#FFD166' : display.accentColor,
                    // 2026-05-24 사용자 정정 (보고서): NEXT 안내 라벨 +50% — 11→16 / 15→22 / compact 적용
                    fontSize: fz(16, 1.6, 22, sNext),
                  }}
                >
                  ▶ NEXT BLIND
                </div>
                {nextBlind.isBreak ? (
                  <div
                    className="font-extrabold"
                    style={{
                      color: '#FFD166',
                      // 2026-05-24 사용자 정정 (보고서): 휴식 안내 +50% — 18→28 / 28→44 / compact 적용
                      fontSize: fz(28, 3, 44, sNext),
                    }}
                  >
                    ☕ 휴식 {Math.round(nextBlind.durationSec / 60)}분
                  </div>
                ) : (
                  <>
                    <div
                      className="font-mono font-extrabold tracking-wide"
                      style={{
                        color: display.textColor,
                        opacity: 0.75,
                        // 2026-05-24 사용자 정정 (보고서): LV 표시 +50% — 11→16 / 14→20 / compact 적용
                        fontSize: fz(16, 1.5, 20, sNext),
                      }}
                    >
                      LV {nextDisplayedNumber ?? nextBlind.level}
                    </div>
                    <div
                      className="font-mono font-extrabold mt-1.5"
                      style={{
                        color: display.blindsColor,
                        // 2026-05-24 사용자 정정 (보고서): NEXT 블라인드 +50% — 22→34 / 36→56 / compact 적용
                        fontSize: fz(34, 3.4, 56, sNext),
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {nextBlind.sb.toLocaleString()}
                      <span style={{ color: display.textColor, opacity: 0.4 }} className="mx-1">/</span>
                      {nextBlind.bb.toLocaleString()}
                    </div>
                    {nextBlind.ante > 0 && (
                      <div
                        className="font-mono mt-1.5"
                        style={{
                          color: display.textColor,
                          opacity: 0.75,
                          // 2026-05-24 사용자 정정 (보고서): NEXT Ante +50% — 11→18 / 15→24 / compact 적용
                          fontSize: fz(18, 1.8, 24, sNext),
                        }}
                      >
                        Ante {nextBlind.ante.toLocaleString()}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          )}

          {/* ─── 2026-05-24 사용자 정정: 좌측 컬럼 위아래 여백 활용 — 스마트 보조 정보 ───
               사용자 명시: "해당열에는 위아래 여백이 많은점또한 이 여백을 활용한
                            필요정보가 표시되면 좋을것같다. 좀 스마트하게 수정해봐."

               선정 정보 (PM 자율 — 중복 회피 + 운영 가치 우선):
                ⏱ 토너 경과시간 — totalStartedAt 기준 누적 (대회 진행 흐름 한눈에)
                🎯 다음 BREAK까지 — 휴식 레벨까지 남은 시간(없으면 "휴식 없음")
                              ※ 우측 LATE REG와 중복 X, 운영자/플레이어 모두 가치 ↑

               그리드 자리: 메인 카드(스트럭쳐 or NEXT) 아래 — 시각 위계 보조.
               structureScale 배율을 따라가 통일된 톤. */}
          <LeftSmartInfoStack
            session={session}
            structure={structure}
            sec={sec}
            display={display}
            scale={sStructure * (compact ? 0.65 : 1.0)}
          />
        </div>

        {/* ─── 중: LEVEL 배지 + 거대 타이머 + 진행바 + 중앙 하단 BLINDS ─── */}
        <div className="flex flex-col items-center justify-center min-w-0">
          {/* 2026-05-24 사용자 정정 (재²): "level 2.5배가 안 됨" — 가로 layout clamp min/max 키움.
              2026-05-28 개선 #2: 카드 배경/보더 제거 — 폰트만 표시 (타이머와 동일 컨셉).
              mb-3 → mb-1 (타이머와 간격 축소). */}
          <div
            className="flex items-center justify-center mb-1"
            aria-label={`현재 레벨 ${session.currentLevel}`}
          >
            <span
              className="font-extrabold tracking-[0.18em] leading-none"
              style={{
                color: isCurrentBreak ? '#FFD166' : display.textColor,
                // 2026-05-24 사용자 정정 (보고서): "LEVEL 2.5배 안 됨" — clamp min 28→48 / max 40→80
                // 2026-05-24 PM 핫픽스: compact면 모바일 viewport에 맞춰 min/max 축소.
                fontSize: fz(48, 5.2, 80, sLevel),
                opacity: 0.85,
              }}
            >
              {displayedLevelLabel}
            </span>
          </div>
          <div
            className={`font-mono font-extrabold leading-none transition-colors ${lowTime ? 'timer-pulse' : ''}`}
            style={{
              // 2026-05-24 사용자 정정 (보고서): 타이머 시인성 강화
              // 2026-05-28 최적화: compact 모바일 가로는 vh 상한도 함께 적용 (짧은 화면 잘림 방지)
              fontSize: timerFontSize,
              letterSpacing: '-0.05em',
              color: timerColor,
              transition: 'color 0.2s',
            }}
          >
            {fmtTime(sec)}
          </div>
          {/* 진행바 — 가로 전용 (사용자 요구: 드래그로 디테일 시간 조절).
              canControl=true 일 때만 드래그 가능. 비권한자는 표시만.
              2026-05-24 PM 정정 #6: 자막 마퀴 mount 제거 (사용자 명시: "중앙하단 자막기능은 제거"). */}
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
          {/* 2026-05-24 PM 정정 #5: 블라인드 금액 중앙 하단 (타이머 밑) 큰 폰트.
              사용자 정정: "현재 블라인드금액표기는 중앙 하단 타이머 밑으로 배치하는게 시인성에 좋을것같다는 의견"
              ⇒ 좌측 컬럼에서 BLINDS 제거 (스트럭쳐 패널이 그 자리 차지)
              ⇒ 진행바 아래 중앙 정렬, 타이머보다 작지만 큰 폰트 */}
          {!isCurrentBreak && (
            <div className="mt-4 text-center">
              <div
                className="font-mono font-extrabold leading-none"
                style={{
                  // 2026-05-24 사용자 정정 (보고서): 블라인드 — min 32→52 / vw 5→6 / max 72→104
                  // 2026-05-24 PM 핫픽스: compact 적용.
                  fontSize: fz(52, 6, 104, sBlinds),
                  color: display.blindsColor,
                  letterSpacing: '-0.03em',
                }}
              >
                {session.smallBlind.toLocaleString()}
                <span style={{ opacity: 0.4 }} className="mx-2">/</span>
                {session.bigBlind.toLocaleString()}
              </div>
              {session.ante > 0 && (
                <div
                  className="font-mono mt-1"
                  style={{
                    color: display.textColor,
                    opacity: 0.7,
                    // 2026-05-24 사용자 정정 (보고서): "ante 거의 안 보임" — min 13→22 / vw 1.4→2.6 / max 20→44
                    // 2026-05-24 PM 핫픽스: compact 적용.
                    fontSize: fz(22, 2.6, 44, sAnte),
                  }}
                >
                  Ante {session.ante.toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── 우: 2026-05-24 PM 정정 — 세로 stack 3카드.
              사용자 정정: "우측에는 플레이어 숫자, 그아래는 레이트레지, 그아래 프라이즈풀이 표시되면되고"
              위→아래 순서: PLAYERS → LATE REG → PRIZE POOL (showPrize일 때만 PRIZE POOL).
              세 카드 모두 동일한 톤(다크 + 보더). PRIZE POOL만 accent 그라데이션으로 무게감.
              distribution 모드: PRIZE POOL 카드 내부 하단에 상위 6등 표.
              ─── */}
        <div className="flex flex-col justify-center gap-2 min-w-0">
          {(() => {
            const mode: PrizePoolMode = resolvePrizePoolMode(display.prizePoolMode, display.showPrizePool);
            const showPrize = mode !== 'hidden';
            const unit = session.prizeDisplayUnit ?? 'ticket';
            const ps = resolvePayoutStructure(session.payoutStructure);
            const payouts = mode === 'distribution' ? computePayoutsFromStructure(ps, resolveTotalEntries(session)) : [];
            const amounts = mode === 'distribution' ? computePayoutAmounts(session.prizePool ?? 0, payouts) : [];
            const accent = display.accentColor;
            return (
              <>
                {/* 1) PLAYERS — 단독 카드 */}
                <SideStatCard
                  label="PLAYERS"
                  value={`${session.playersRemaining}/${resolveTotalEntries(session)}`}
                  sub={
                    resolveRebuysCount(session) > 0
                      ? `${session.tablesRemaining}T · 리바인 ${resolveRebuysCount(session)}`
                      : `${session.tablesRemaining}T`
                  }
                  color={display.textColor}
                  borderColor="rgba(255,255,255,0.10)"
                  compact={compact}
                />
                {/* 2) LATE REG — 단독 카드 */}
                <SideStatCard
                  label="LATE REG"
                  value={lateRegDisplay}
                  sub={lateClosed ? '' : '남음'}
                  color={display.textColor}
                  highlight={!lateClosed && lateMin <= 5}
                  accentColor={display.accentColor}
                  borderColor="rgba(255,255,255,0.10)"
                  compact={compact}
                />
                {/* 3) PRIZE POOL — 단독 카드 (showPrize일 때만, accent 그라데이션)
                    2026-05-24 PM 정정 라운드 2 (사용자 핵심 호소):
                      "총액만 모드일때는 카드가 세로로 길쭉해지면 안되는거 아닐까?
                       만약 1-n등까지 표시 모드일경우 마지막등수까지가 카드의 길이가 되어야하고
                       이 카드의 길이 맥시멈은 화면을 벗어나서 스크롤이 생기면안된다.
                       최대 10명?15명? 일지는 모르겠지만 화면을 벗어나지 않는선의 명수까지만 표기."

                    fix:
                      - total 모드: flex-1 폐기 → flex-shrink-0 (높이 자연 컴팩트)
                      - distribution 모드: viewport h 기반 maxRows 동적 산출 (12~14등 자동)
                      - 잘린 등수는 "+N등 더" 안내. 가로 layout 100vh 가득 + 스크롤 X 제약 유지.
                */}
                {showPrize && mode === 'total' && (
                  <div
                    className={`flex-shrink-0 rounded-xl border backdrop-blur-sm relative overflow-hidden flex flex-col text-center w-full mx-auto ${
                      compact ? 'px-2 py-2' : 'px-3 py-3'
                    }`}
                    style={{
                      background: `linear-gradient(135deg, ${accent}22 0%, rgba(0,0,0,0.6) 70%)`,
                      borderColor: `${accent}50`,
                      boxShadow: `0 0 24px ${accent}1A inset`,
                      maxWidth: compact ? 160 : 220,
                    }}
                    aria-label="프라이즈 풀 (총액)"
                  >
                    <div
                      className="font-extrabold flex items-center justify-center gap-1 flex-shrink-0"
                      style={{
                        color: accent,
                        opacity: 0.95,
                        fontSize: fz(12, 1.2, 16),
                        letterSpacing: '0.24em',
                      }}
                    >
                      <span>💰</span>
                      <span>PRIZE POOL</span>
                    </div>
                    <div
                      className="font-mono font-extrabold tabular-nums leading-none mt-2 flex-shrink-0"
                      style={{
                        fontSize: fz(26, 3.6, 46),
                        color: display.textColor,
                        letterSpacing: '-0.03em',
                        textShadow: `0 2px 12px ${accent}55`,
                      }}
                    >
                      {session.prizePool > 0 ? fmtPrizeDisplay(session.prizePool, unit) : '—'}
                    </div>
                  </div>
                )}
                {showPrize && mode === 'distribution' && (
                  <PrizeDistributionCard
                    accent={accent}
                    textColor={display.textColor}
                    blindsColor={display.blindsColor}
                    amounts={amounts}
                    unit={unit}
                    prizePool={session.prizePool}
                  />
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* 2026-05-24 PM 정정: 하단 마퀴 완전 제거 (사용자 명시: "이 마퀴는 없애줘").
          데이터 모델(marqueeText/Color/FontSize/Style/SpeedSec)은 backward compat 유지하되 UI 표시 X. */}

      {/* ─── 하단 컨트롤 행 — 권한자만 노출 (사용자 요구) ─── */}
      {/* 2026-05-28 개선점 5: 전체화면 모드에서 3초 무입력 시 슬라이드 다운 숨김 */}
      {canControl ? (
        <div
          ref={ctrlAreaRef}
          onMouseEnter={handleCtrlMouseEnter}
          onMouseLeave={handleCtrlMouseLeave}
          className="mt-2 flex items-center justify-center gap-1.5 flex-wrap rounded-xl px-2 py-1.5 border"
          style={{
            background: 'rgba(0,0,0,0.55)',
            borderColor: 'rgba(255,255,255,0.10)',
            transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
            transform: showCtrl ? 'translateY(0)' : 'translateY(110%)',
            opacity: showCtrl ? 1 : 0,
            pointerEvents: showCtrl ? 'auto' : 'none',
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

/** 가로 레이아웃 우측 보조 정보 카드 — 컴팩트 stat 박스 (세로/모바일 세로 전용) */
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

/**
 * PrizeDistributionCard — 분배표 모드 전용 우측 카드.
 *
 * 2026-05-24 사용자 정정 라운드 2 핵심 호소 처리:
 *   "1-n등까지 표시 모드일경우 마지막등수까지가 카드의 길이가 되어야하고
 *    이 카드의 길이 맥시멈은 화면을 벗어나서 스크롤이 생기면안된다.
 *    최대 10명?15명? 일지는 모르겠지만 화면을 벗어나지 않는선의 명수까지만 표기."
 *
 * 알고리즘:
 *   1) viewport h 측정 (window.innerHeight) — 가로 layout 100vh 전제.
 *   2) 카드 헤더(46px) + 금액(70px) + DISTRIBUTION 라벨(28px) + "+N등 더"(20px) + padding(40px) = 약 204px reserved.
 *   3) 가용 행 영역 ≈ vh × 0.70(가로 모드 우측 컬럼 점유율) − reserved.
 *   4) 행당 높이 — clamp 기반 폰트로 ≈ 30~38px. 평균 34px로 산출.
 *   5) maxRows = max(3, min(15, floor(available / rowHeight))). 최대 15등 hard cap.
 *
 * SSR safe: 초기 maxRows=10 (대표값) → mount 후 resize listener로 갱신.
 * scroll 0 보장: max-height 명시적 제한 + overflow-hidden.
 */
function PrizeDistributionCard({
  accent,
  textColor,
  blindsColor,
  amounts,
  unit,
  prizePool,
}: {
  accent: string;
  textColor: string;
  blindsColor: string;
  amounts: Array<{ rank: number; amount: number }>;
  unit: 'amount' | 'ticket';
  prizePool: number;
}) {
  // viewport 기반 최대 표시 등수 산출
  const [maxRows, setMaxRows] = useState(10);
  useEffect(() => {
    const compute = () => {
      const vh = window.innerHeight;
      // 가로 layout 우측 컬럼 점유: 약 65~75% (헤더/푸터/컨트롤바 제외)
      const usable = vh * 0.68;
      // 카드 고정 영역: 헤더 46 + 금액 70 + DISTRIBUTION 28 + +N등더 22 + padding 40 = 206
      const reserved = 206;
      const available = Math.max(60, usable - reserved);
      // 행당 평균 34px (clamp 16~26 폰트 + py 0.5 + gap)
      const rowH = 34;
      const calc = Math.floor(available / rowH);
      // hard cap 15 (사용자 명시) + 최소 3
      const next = Math.max(3, Math.min(15, calc));
      setMaxRows(next);
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('orientationchange', compute);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('orientationchange', compute);
    };
  }, []);

  const visible = amounts.slice(0, maxRows);
  const hidden = Math.max(0, amounts.length - visible.length);

  return (
    <div
      className="flex-shrink-0 rounded-xl px-3 py-3 border backdrop-blur-sm relative overflow-hidden flex flex-col text-center w-full mx-auto"
      style={{
        background: `linear-gradient(135deg, ${accent}22 0%, rgba(0,0,0,0.6) 70%)`,
        borderColor: `${accent}50`,
        boxShadow: `0 0 24px ${accent}1A inset`,
        maxWidth: 220,
        // 가로 layout 100vh 가득 + 스크롤 X 제약 유지 — 최대 90vh로 hard cap.
        maxHeight: '90vh',
      }}
      aria-label="프라이즈 풀 (분배표)"
    >
      <div
        className="font-extrabold flex items-center justify-center gap-1 flex-shrink-0"
        style={{
          color: accent,
          opacity: 0.95,
          fontSize: 'clamp(12px, 1.2vw, 16px)',
          letterSpacing: '0.24em',
        }}
      >
        <span>💰</span>
        <span>PRIZE POOL</span>
      </div>
      <div
        className="font-mono font-extrabold tabular-nums leading-none mt-2 flex-shrink-0"
        style={{
          fontSize: 'clamp(26px, 3.6vw, 46px)',
          color: textColor,
          letterSpacing: '-0.03em',
          textShadow: `0 2px 12px ${accent}55`,
        }}
      >
        {prizePool > 0 ? fmtPrizeDisplay(prizePool, unit) : '—'}
      </div>
      {amounts.length > 0 && (
        <div
          className="mt-2 pt-2 border-t flex flex-col text-left min-h-0 overflow-hidden"
          style={{ borderColor: 'rgba(255,255,255,0.12)' }}
        >
          <div
            className="tracking-[0.22em] font-extrabold opacity-75 mb-1 flex-shrink-0 text-center"
            style={{ color: textColor, fontSize: 'clamp(11px, 1.1vw, 14px)' }}
          >
            DISTRIBUTION
          </div>
          <div className="flex flex-col gap-0.5 overflow-hidden">
            {visible.map((a) => (
              <div
                key={a.rank}
                className="font-mono flex items-baseline justify-between rounded px-1.5 py-0.5"
                style={{
                  color: textColor,
                  background: a.rank === 1 ? `${accent}18` : 'transparent',
                }}
              >
                <span
                  className="font-extrabold tabular-nums"
                  style={{
                    fontSize: 'clamp(16px, 2vw, 26px)',
                    color: a.rank === 1 ? accent : textColor,
                  }}
                >
                  {a.rank}등
                </span>
                <span
                  className="tabular-nums font-bold"
                  style={{
                    fontSize: 'clamp(18px, 2.2vw, 28px)',
                    color: blindsColor,
                  }}
                >
                  {fmtPrizeDisplay(a.amount, unit) || '—'}
                </span>
              </div>
            ))}
          </div>
          {hidden > 0 && (
            <div
              className="mt-1 opacity-65 flex-shrink-0 text-center"
              style={{ color: textColor, fontSize: 'clamp(11px, 1.1vw, 14px)' }}
            >
              +{hidden}등 더
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * SideStatCard — 가로 모드 우측 stack 전용 카드 (2026-05-24 PM 정정으로 신설).
 * 사용자 정정: "우측에는 플레이어 숫자, 그아래는 레이트레지, 그아래 프라이즈풀이 표시되면되고"
 * 좌측 정렬 라벨 + 큰 값 + 보조 텍스트. PRIZE POOL 카드와 시각적 균형을 위해 padding/폰트 키움.
 */
function SideStatCard({
  label,
  value,
  sub,
  highlight,
  color,
  accentColor,
  borderColor,
  compact = false,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  color: string;
  accentColor?: string;
  borderColor: string;
  /** 2026-05-24 PM 핫픽스: 모바일 가로일 때 폰트/패딩/maxWidth 축소 */
  compact?: boolean;
}) {
  // 2026-05-24 사용자 정정 라운드 2 (보고서): "우측열 플레이어/레이트레지/프라이즈풀 카드폭도 보기좋게 개선"
  //   maxWidth 180 → 220 (slim 제약 완화). 라벨/값/서브 폰트는 그대로 (시인성 확보된 상태).
  //   카드 폭이 늘어 좌우 padding 자연스럽게 호흡 → 글자 잘림/줄바꿈 위험 ↓.
  // 2026-05-24 PM 핫픽스: compact=true면 모바일 가로용으로 maxWidth 220→160, 폰트 60%.
  const cMul = compact ? 0.6 : 1.0;
  const fz = (minPx: number, vw: number, maxPx: number) =>
    `clamp(${Math.round(minPx * cMul)}px, ${vw}vw, ${Math.round(maxPx * cMul)}px)`;
  return (
    <div
      className={`rounded-xl border backdrop-blur-sm flex-shrink-0 text-center w-full mx-auto ${
        compact ? 'px-2 py-1.5' : 'px-3 py-2.5'
      }`}
      style={{
        background: 'rgba(0,0,0,0.45)',
        borderColor,
        maxWidth: compact ? 160 : 220,
      }}
    >
      <div
        className="font-extrabold flex-shrink-0"
        style={{
          color,
          opacity: 0.7,
          fontSize: fz(12, 1.2, 16),
          letterSpacing: '0.24em',
        }}
      >
        {label}
      </div>
      <div
        className="font-mono font-extrabold tabular-nums leading-none mt-1.5"
        style={{
          fontSize: fz(24, 3, 40),
          letterSpacing: '-0.02em',
          color: highlight && accentColor ? accentColor : color,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="mt-1"
          style={{ color, opacity: 0.7, fontSize: fz(12, 1.2, 16) }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * LeftSmartInfoStack — 2026-05-24 사용자 정정으로 신설.
 *
 * 가로 layout 좌측 컬럼 — 스트럭쳐(또는 NEXT) 카드 아래 빈 여백에 노출되는
 * 스마트 보조 정보 2종 stack.
 *
 *  ⏱ 토너 경과 — totalStartedAt 기준 누적 시간 (대회 진행 흐름)
 *  🎯 다음 BREAK — 휴식 레벨까지 (현재 레벨 sec + 이후 정규 레벨 dur 합산)
 *
 * 시각 위계: 메인 카드 > 보조 정보 (작은 폰트, 어두운 톤).
 * 자동 hide:
 *  - 경과시간: totalStartedAt 없으면(레거시) hide
 *  - 다음 BREAK: structure에 break 레벨 없으면 hide
 * 둘 다 없으면 mount 자체 안 함 (DOM noise 0).
 *
 * scale: 좌측 컬럼 톤 통일을 위해 structureScale을 그대로 받음.
 */
function LeftSmartInfoStack({
  session,
  structure,
  sec,
  display,
  scale,
}: {
  session: LiveSession;
  structure:
    | { level: number; sb: number; bb: number; ante: number; durationSec: number; isBreak?: boolean }[]
    | undefined;
  sec: number;
  display: TimerDisplaySettings;
  scale: number;
}) {
  const safeScale = Math.min(2.0, Math.max(0.5, scale));
  // 2026-05-24 사용자 정정 (보고서): LeftSmartInfoStack 폰트 키움 (좌측 컬럼 보조 정보 시인성).
  //   라벨 10→14 / 값 18→26 / 서브 10→13. 메인 STRUCTURE 카드보다 한 단계 작게 (위계 유지).
  const labelFont = Math.round(14 * safeScale);
  const valueFont = Math.round(26 * safeScale);
  const subFont = Math.round(13 * safeScale);
  const padY = Math.max(8, Math.round(10 * Math.pow(safeScale, 0.7)));
  const padX = Math.round(14 * Math.pow(safeScale, 0.7));

  // ⏱ 경과시간: totalStartedAt 기준. 시:분으로 표시 (60분 미만은 분 단위만).
  const startedMs = session.totalStartedAt?.toMillis?.() ?? null;
  const elapsedMin = startedMs != null ? Math.max(0, Math.floor((Date.now() - startedMs) / 60000)) : null;
  const elapsedText =
    elapsedMin == null
      ? null
      : elapsedMin < 60
      ? `${elapsedMin}분`
      : `${Math.floor(elapsedMin / 60)}시간 ${elapsedMin % 60}분`;

  // 🎯 다음 BREAK까지: 현재 레벨 남은 sec + 이후 정규 레벨 durationSec 누적, 다음 break 만나면 stop.
  // (현재 레벨 자체가 break이면 "지금 휴식 중" → 다른 텍스트)
  const currentLevelObj = structure?.find((l) => l.level === session.currentLevel);
  const isCurrentlyBreak = currentLevelObj?.isBreak === true;
  let nextBreakMin: number | null = null;
  let breakLevel: number | null = null;
  if (structure && !isCurrentlyBreak) {
    let total = sec; // 현재 레벨 남은 시간
    let foundBreak = false;
    for (let lv = session.currentLevel + 1; lv <= (structure[structure.length - 1]?.level ?? 0); lv++) {
      const item = structure.find((l) => l.level === lv);
      if (!item) continue;
      if (item.isBreak) {
        breakLevel = item.level;
        foundBreak = true;
        break;
      }
      total += item.durationSec;
    }
    if (foundBreak) {
      nextBreakMin = Math.ceil(total / 60);
    }
  }

  // 둘 다 없으면 mount 안 함
  if (elapsedText == null && nextBreakMin == null && !isCurrentlyBreak) return null;

  const card = (
    label: string,
    value: string,
    sub: string,
    accent: string,
  ) => (
    <div
      className="rounded-lg border backdrop-blur-sm flex items-center gap-2"
      style={{
        background: 'rgba(0,0,0,0.45)',
        borderColor: 'rgba(255,255,255,0.10)',
        padding: `${padY}px ${padX}px`,
      }}
    >
      <div
        className="flex-shrink-0 flex items-center justify-center rounded-md"
        style={{
          // 2026-05-24 사용자 정정 (보고서): 아이콘 박스도 비례 키움 28→36 / 14→20
          width: Math.round(36 * safeScale),
          height: Math.round(36 * safeScale),
          background: `${accent}22`,
          border: `1px solid ${accent}44`,
          fontSize: Math.round(20 * safeScale),
        }}
      >
        {label.slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="font-extrabold tracking-[0.18em] truncate"
          style={{ color: display.textColor, opacity: 0.55, fontSize: labelFont }}
        >
          {label.slice(2).trim()}
        </div>
        <div
          className="font-mono font-extrabold tabular-nums leading-tight truncate"
          style={{ color: display.textColor, fontSize: valueFont, letterSpacing: '-0.01em' }}
        >
          {value}
        </div>
        {sub && (
          <div
            className="truncate"
            style={{ color: display.textColor, opacity: 0.55, fontSize: subFont, marginTop: 1 }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2 mt-1">
      {elapsedText != null && card('⏱ ELAPSED', elapsedText, '토너 진행', display.accentColor)}
      {isCurrentlyBreak
        ? card('☕ ON BREAK', '휴식 중', '곧 재개', '#FFD166')
        : nextBreakMin != null
        ? card(
            '🎯 NEXT BREAK',
            nextBreakMin < 60 ? `${nextBreakMin}분` : `${Math.floor(nextBreakMin / 60)}시 ${nextBreakMin % 60}분`,
            breakLevel != null ? `Lv ${breakLevel} 이후` : '곧',
            '#FFD166',
          )
        : null}
    </div>
  );
}

/**
 * NextLevelCompactCard — 2026-05-28 신설 / 개선 #1 (2026-05-28).
 *
 * 모바일 가로(compact=true) 전용. BlindStructurePanel 대신 표시.
 * 작은 화면에서 풀 스트럭쳐는 내용 잘림 → NEXT LEVEL 번호(큰 라벨) + SB/BB/Ante 구조.
 *
 * 개선 #1 요구:
 *  - 상단에 "NEXT LEVEL {번호}" 큰 라벨 (예: "NEXT LEVEL 5")
 *  - 그 아래 SB/BB/Ante 금액 표기
 *  - 내용 잘림 절대 없게 — overflow hidden 회피, 글자 단위 줄바꿈 허용
 *  - 좌측 상단 좁은 공간이라 폰트/패딩 보수적으로 설정
 */
function NextLevelCompactCard({
  nextBlind,
  nextDisplayedNumber,
  display,
}: {
  nextBlind: { level: number; sb: number; bb: number; ante: number; durationSec: number; isBreak?: boolean } | undefined;
  nextDisplayedNumber: number | null;
  display: TimerDisplaySettings;
}) {
  const accent = display.accentColor;
  const fg = display.textColor;
  const blinds = display.blindsColor;

  // 다음 레벨이 없으면 축약 카드
  if (!nextBlind) {
    return (
      <div
        className="rounded-xl border w-full flex flex-col items-center justify-center py-3 px-2"
        style={{ background: 'rgba(0,0,0,0.45)', borderColor: 'rgba(255,255,255,0.10)' }}
      >
        <div className="font-extrabold tracking-[0.18em] text-center" style={{ color: fg, opacity: 0.4, fontSize: 11 }}>
          NEXT LEVEL
        </div>
        <div className="font-extrabold text-center mt-1" style={{ color: fg, opacity: 0.35, fontSize: 13 }}>
          마지막 레벨
        </div>
      </div>
    );
  }

  // BREAK 다음
  if (nextBlind.isBreak) {
    return (
      <div
        className="rounded-xl border w-full flex flex-col py-2.5 px-2.5 gap-1"
        style={{ background: 'rgba(0,0,0,0.45)', borderColor: 'rgba(255,209,102,0.35)' }}
      >
        <div
          className="font-extrabold tracking-[0.16em] leading-tight"
          style={{ color: '#FFD166', fontSize: 11, opacity: 0.85 }}
        >
          NEXT
        </div>
        <div
          className="font-extrabold leading-tight"
          style={{ color: '#FFD166', fontSize: 17, letterSpacing: '-0.01em' }}
        >
          ☕ BREAK
        </div>
        <div
          className="font-mono font-bold leading-tight"
          style={{ color: '#FFD166', opacity: 0.75, fontSize: 13 }}
        >
          {Math.round(nextBlind.durationSec / 60)}분
        </div>
      </div>
    );
  }

  // 일반 다음 레벨 — 개선 #1: "NEXT LEVEL N" 큰 라벨 + SB/BB/Ante
  const levelNum = nextDisplayedNumber ?? nextBlind.level;
  return (
    <div
      className="rounded-xl border w-full flex flex-col py-2.5 px-2.5 gap-1.5"
      style={{ background: 'rgba(0,0,0,0.45)', borderColor: `${accent}35` }}
    >
      {/* "NEXT LEVEL N" 큰 라벨 — 잘림 방지: word-break + overflow visible */}
      <div
        className="font-extrabold leading-tight"
        style={{
          color: accent,
          fontSize: 13,
          letterSpacing: '0.06em',
          // 줄바꿈 허용 — 좁은 공간에서 "NEXT LEVEL\n5" 형태로
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
        }}
      >
        NEXT LEVEL
      </div>
      <div
        className="font-extrabold leading-none"
        style={{ color: accent, fontSize: 26, letterSpacing: '-0.02em' }}
      >
        {levelNum}
      </div>
      {/* SB/BB */}
      <div
        className="font-mono font-extrabold tabular-nums leading-none"
        style={{ color: blinds, fontSize: 15, letterSpacing: '-0.02em' }}
      >
        {nextBlind.sb.toLocaleString()}
        <span style={{ color: fg, opacity: 0.35 }} className="mx-0.5">/</span>
        {nextBlind.bb.toLocaleString()}
      </div>
      {/* Ante (있을 때만) */}
      {nextBlind.ante > 0 && (
        <div
          className="font-mono font-bold leading-tight"
          style={{ color: fg, opacity: 0.6, fontSize: 11 }}
        >
          Ante {nextBlind.ante.toLocaleString()}
        </div>
      )}
    </div>
  );
}

/**
 * BlindStructurePanel — 2026-05-24 PM 정정 (5레벨 컴팩트 + 앤티 컬럼 자동).
 *
 * 사용자 정정 (2026-05-24):
 *   "좌측 5레벨 컴팩트 스트럭쳐 표시는 제대로 작동하지 않는것같은데 확인바란다.
 *    (이건 엔티가있는 경기도 감안하여 크기 측정->개선)"
 *
 *   → 직전 10레벨에서 5레벨로 축소 (현재 -1, 현재, +1 ~ +3 = 5줄)
 *   → 좌측 컬럼 폭에 맞게 컴팩트 (블라인드는 중앙 하단으로 이동했음)
 *   → 앤티 있는 경기: sb/bb 행 아래 ante 작게 표시 (한 행 안)
 *   → overflow hidden, 스크롤 없음
 *   → portrait variant는 호출부에서 mount 제외
 *
 * 2026-05-24 사용자 정정 (재):
 *   "스트럭쳐 폰트 사이즈 업해야되고, 엔티표시시 줄바뀜이 되는데 이런 불필요한 화면구도는 잘못된것을 인지하라."
 *   "좌측 스트럭쳐 표시의 폰트사이즈를 업하고 시인성을 올려야한다. 불필요하게 줄바뀜이 되는것을 미연에 방지하라."
 *
 *   → 폰트 1.5~2배 키움 (시인성 우선)
 *   → 앤티 별도 행 폐기. **한 행에 `Lv1 100/200 ·a25`** (한 줄)
 *   → hasAnyAnte 분기는 표시 우선순위만 영향, 줄바꿈 X
 *
 * 디자인 (앤티 없을 때):                  디자인 (앤티 있을 때):
 *   ┌────────────────┐                   ┌────────────────────┐
 *   │ 📋 STRUCTURE    │                   │ 📋 STRUCTURE        │
 *   ├────────────────┤                   ├────────────────────┤
 *   │ ✓ Lv 4 200/400  │                   │ ✓ Lv 4 200/400 ·a50 │
 *   │ ▶ Lv 5 300/600  │                   │ ▶ Lv 5 300/600 ·a75 │
 *   │   Lv 6 500/1k   │                   │   Lv 6 500/1k ·a100 │
 *   │   Lv 7 800/1.6k │                   │   Lv 7 800/1.6k ·… │
 *   │   Lv 8 1k/2k    │                   │   Lv 8 1k/2k ·a200  │
 *   └────────────────┘                   └────────────────────┘
 *
 * Size variant: 'desktop' | 'landscape' — 폰트/간격 자동 조절.
 * Empty handling: structure 비면 null 반환 (mount 안 함).
 */
const VISIBLE_LEVELS_AROUND_CURRENT = 5; // 직전 1 + 현재 1 + 다음 3 = 5줄 (사용자 정정 2026-05-24)

function BlindStructurePanel({
  structure,
  currentLevel,
  display,
  variant,
  scale = 1.0,
}: {
  structure: { level: number; sb: number; bb: number; ante: number; durationSec: number; isBreak?: boolean }[] | undefined;
  currentLevel: number;
  display: TimerDisplaySettings;
  variant: 'desktop' | 'landscape';
  /** 2026-05-24 사용자 정정: 행 폰트/패딩 배율 (0.5x ~ 2.0x). 디폴트 1.0.
   *  사용자 명시: "좌측 카드안의 내용을 조검더 꽉찬 폰트사이즈로 표기". */
  scale?: number;
}) {
  if (!structure || structure.length === 0) return null;

  // 5레벨 슬라이딩 윈도우 계산 — 현재 -1, 현재, +1 ~ +3.
  const currentIdx = structure.findIndex((lv) => lv.level === currentLevel);
  const cIdx = currentIdx >= 0 ? currentIdx : 0;
  // start = cIdx - 1, end = cIdx + 4 (총 5개) — 경계 clamp
  let start = Math.max(0, cIdx - 1);
  let end = Math.min(structure.length, start + VISIBLE_LEVELS_AROUND_CURRENT);
  // end가 끝까지 못 채우면 start 앞으로 당김 (5개 유지)
  if (end - start < VISIBLE_LEVELS_AROUND_CURRENT && start > 0) {
    start = Math.max(0, end - VISIBLE_LEVELS_AROUND_CURRENT);
  }
  const visible = structure.slice(start, end);
  // 앤티가 한 행이라도 있으면 앤티 컬럼 표시 (UX 일관성 위해 visible 범위 기준)
  const hasAnyAnte = visible.some((lv) => !lv.isBreak && lv.ante > 0);

  // variant별 사이즈/패딩 결정.
  // 2026-05-24 사용자 정정: 폰트 1.5~2배 키움 (시인성 우선).
  //   landscape: text-[11px] → text-[15px] (헤더) / text-[12px] → text-[17px] (행)
  //   desktop:   text-sm → text-base
  // 2026-05-24 사용자 정정 (재²): scale prop으로 매장이 실시간 미세조정.
  //   기본 폰트값에 scale을 곱하고, padding도 비례로 살짝 늘림.
  //   className 기반 텍스트 폰트는 inline style fontSize로 override (배율 정밀 적용).
  const safeScale = Math.min(2.0, Math.max(0.5, scale));
  // 2026-05-24 사용자 정정 (보고서): "좌측 STRUCTURE 패널 너무 작음" — base 폰트 20~28로 키움.
  //   직전 16/15·16/17 → 22/22·24/24. landscape 기준 +40~50%.
  //   variant=landscape는 좌측 컬럼(1.3fr) 폭이 충분히 확보됨 → 큰 폰트 OK.
  const baseHeaderFont = variant === 'desktop' ? 20 : 22; // px
  const baseRowFont = variant === 'desktop' ? 22 : 24;    // px
  const headerFontPx = Math.round(baseHeaderFont * safeScale);
  const rowFontPx = Math.round(baseRowFont * safeScale);
  // padding은 폰트보다 완만하게 (0.7제곱) — 너무 비대해지는 거 방지.
  const padScale = Math.pow(safeScale, 0.7);
  const headerPadY = Math.max(6, Math.round(10 * padScale));
  const headerPadX = variant === 'desktop' ? Math.round(14 * padScale) : Math.round(12 * padScale);
  const rowPadY = variant === 'desktop' ? Math.round(10 * padScale) : Math.round(8 * padScale);
  const rowPadX = variant === 'desktop' ? Math.round(14 * padScale) : Math.round(12 * padScale);
  const panelWidth =
    variant === 'desktop' ? Math.round(300 * Math.min(1.4, safeScale)) : '100%';
  const accent = display.accentColor;
  const blinds = display.blindsColor;
  const fg = display.textColor;

  return (
    <div
      className="rounded-xl border backdrop-blur-sm overflow-hidden flex flex-col"
      style={{
        background: 'rgba(0,0,0,0.55)',
        borderColor: 'rgba(255,255,255,0.12)',
        width: panelWidth,
      }}
      aria-label="블라인드 스트럭쳐 (10레벨)"
    >
      {/* 헤더 — scale 적용 (2026-05-24 정정 재²) */}
      <div
        className="font-extrabold tracking-[0.2em] border-b flex-shrink-0 flex items-center justify-between"
        style={{
          borderColor: 'rgba(255,255,255,0.1)',
          color: fg,
          background: 'rgba(0,0,0,0.35)',
          fontSize: headerFontPx,
          padding: `${headerPadY}px ${headerPadX}px`,
        }}
      >
        <span>📋 STRUCTURE</span>
        <span
          className="tabular-nums opacity-70"
          style={{
            // 2026-05-24 사용자 정정 (보고서): "Lv N / N" 라벨도 비례 키움 13→17 / 12→16
            fontSize: Math.round((variant === 'desktop' ? 17 : 16) * safeScale),
            letterSpacing: '0.1em',
          }}
        >
          {/* 2026-05-24 정정 #1: 브레이크는 레벨 번호 X.
              현재가 break면 ☕, play면 displayed/play 총수. */}
          {(() => {
            const disp = resolveDisplayedLevel(structure, currentLevel);
            const totalPlay = countPlayLevels(structure);
            if (disp.isBreak) return `☕ 휴식 / ${totalPlay}`;
            return `Lv ${disp.displayedNumber ?? currentLevel} / ${totalPlay}`;
          })()}
        </span>
      </div>
      {/* 컴팩트 10레벨 — 스크롤 없음 */}
      <div className="overflow-hidden">
        {visible.map((lvl) => {
          const isCurrent = lvl.level === currentLevel;
          const isPast = lvl.level < currentLevel;
          const isBreak = lvl.isBreak === true;
          // break은 amber. 현재면 배경 강조, 과거면 페이드, 미래면 일반.
          const rowBg = isCurrent
            ? isBreak
              ? 'rgba(245,158,11,0.30)'
              : `${accent}33`
            : 'transparent';
          const rowBorder = isCurrent
            ? isBreak
              ? '2px solid #FFD166'
              : `2px solid ${accent}`
            : '2px solid transparent';
          const rowColor = isPast ? fg : isCurrent ? '#FFFFFF' : fg;
          const rowOpacity = isPast ? 0.45 : 1;
          const rowFontWeight = isCurrent ? 800 : 600;
          const transform = isCurrent ? 'scale(1.02)' : 'scale(1)';
          const marker = isCurrent ? '▶' : isPast ? '✓' : isBreak ? '☕' : '';
          const markerColor = isCurrent ? accent : isPast ? '#10B981' : isBreak ? '#FFD166' : fg;
          return (
            <div
              key={`${lvl.level}-${lvl.isBreak ? 'br' : 'lv'}`}
              className="font-mono flex items-center gap-2 transition-all"
              style={{
                background: rowBg,
                border: rowBorder,
                color: rowColor,
                opacity: rowOpacity,
                fontWeight: rowFontWeight,
                transform,
                transformOrigin: 'left center',
                margin: '3px 5px',
                borderRadius: 8,
                fontSize: rowFontPx,
                padding: `${rowPadY}px ${rowPadX}px`,
              }}
            >
              <span
                className="text-center"
                style={{
                  color: markerColor,
                  opacity: isCurrent ? 1 : 0.9,
                  // 2026-05-24 사용자 정정 (보고서): 마커 폭/폰트 비례 키움 18→22 / 16→20
                  width: Math.round((variant === 'desktop' ? 22 : 22) * safeScale),
                  fontSize: Math.round((variant === 'desktop' ? 20 : 20) * safeScale),
                }}
                aria-hidden
              >
                {marker}
              </span>
              {isBreak ? (
                <>
                  <span className="font-extrabold" style={{ color: '#FFD166' }}>
                    휴식
                  </span>
                  <span style={{ opacity: 0.8, marginLeft: 'auto' }}>
                    {Math.round(lvl.durationSec / 60)}분
                  </span>
                </>
              ) : (
                <>
                  <span
                    className="font-bold tabular-nums"
                    style={{
                      // 2026-05-24 사용자 정정: "Lv N" 컬럼 minWidth 42→52 / 38→48 (큰 폰트에 맞춰).
                      minWidth: variant === 'desktop' ? 52 : 48,
                      opacity: 0.9,
                    }}
                  >
                    {/* 2026-05-24 정정 #1: 브레이크는 레벨 번호 X.
                        play 레벨만 1, 2, 3, ...로 displayedNumber. structure 전체에서 재계산. */}
                    Lv {resolveDisplayedLevel(structure, lvl.level).displayedNumber ?? lvl.level}
                  </span>
                  {/* 2026-05-24 사용자 정정: 앤티 별도 행/줄바꿈 폐기 — 한 행에 sb/bb · aN.
                      flex-col 제거. 단일 inline 표시. baseline 정렬로 점·a 가독성 확보. */}
                  <span
                    className="tabular-nums leading-tight flex items-baseline gap-1"
                    style={{ marginLeft: 'auto' }}
                  >
                    <span style={{ color: blinds, opacity: isCurrent ? 1 : 0.9 }}>
                      {lvl.sb.toLocaleString()}
                      <span style={{ opacity: 0.4 }}>/</span>
                      {lvl.bb.toLocaleString()}
                    </span>
                    {hasAnyAnte && lvl.ante > 0 && (
                      <span
                        className="tabular-nums"
                        style={{
                          color: fg,
                          opacity: 0.72,
                          fontSize: variant === 'desktop' ? '0.78em' : '0.72em',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        ·a{lvl.ante.toLocaleString()}
                      </span>
                    )}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
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

/**
 * TimerWidthMarquee — 셋째 줄 자막 공지 (2026-05-24 PM 정책 부활).
 *
 * 위치/폭/방향 (사용자 명시):
 *   - 위치: 타이머 컨테이너 바로 아래 (중앙 하단)
 *   - 폭: 부모 컨테이너 폭 = 타이머 폭 (width: 100%). 화면 전체 폭 X.
 *   - 방향: 좌→우 (텍스트가 좌측 밖에서 들어와 우측 밖으로 빠져나감).
 *           translateX(-100%) → translateX(100%) keyframe.
 *
 * 사용자 옵션: text/color/fontSize/style/speedSec 모두 매장 prefs에서 직접 조작.
 * 빈 텍스트는 호출 측에서 mount 자체를 막아야 함 (이 컴포넌트는 항상 mount 가정).
 */
function TimerWidthMarquee({
  text,
  color,
  fontSize,
  styleVariant,
  speedSec,
}: {
  text: string;
  color: string;
  fontSize: number;
  styleVariant: 'normal' | 'bold' | 'italic' | 'bold-italic';
  speedSec: number;
}) {
  const bold = styleVariant.includes('bold');
  const italic = styleVariant.includes('italic');
  const safeSpeed = Math.max(5, Math.min(120, speedSec || 30));
  return (
    <div
      className="overflow-hidden whitespace-nowrap mt-3 rounded-md relative"
      style={{
        background: 'rgba(0,0,0,0.45)',
        border: '1px solid rgba(255,255,255,0.08)',
        padding: '6px 0',
        width: '100%',
      }}
      aria-label="실시간 자막 공지"
    >
      <span
        className="inline-block tv-marquee-ltr"
        style={{
          color,
          fontSize,
          fontWeight: bold ? 800 : 500,
          fontStyle: italic ? 'italic' : 'normal',
          animationDuration: `${safeSpeed}s`,
          willChange: 'transform',
          paddingLeft: 12,
          paddingRight: 12,
          letterSpacing: '0.01em',
        }}
      >
        {text}
      </span>
      <style jsx>{`
        @keyframes tv-marquee-ltr-scroll {
          from { transform: translateX(-100%); }
          to   { transform: translateX(100%); }
        }
        .tv-marquee-ltr {
          animation-name: tv-marquee-ltr-scroll;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
      `}</style>
    </div>
  );
}
