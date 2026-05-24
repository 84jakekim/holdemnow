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
} from '@/lib/timerDisplay';
import { playCountdownBeep, playBlindUp, unlockAudio } from '@/lib/sounds';
import {
  fmtPrizeDisplay,
  resolvePayoutStructure,
  computePayoutsFromStructure,
  computePayoutAmounts,
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
  const [isDesktopPointer, setIsDesktopPointer] = useState(false);
  const [showLandscapeHint, setShowLandscapeHint] = useState(false);

  // 화면 회전 감지 — 첫 진입 + resize 시 갱신.
  // 세로(h>w + 모바일폭): isMobilePortrait → 컴팩트 세로 레이아웃
  // 가로(w>h): isMobileLandscape → 가로 통합 레이아웃 (모든 폭 동일)
  //   ※ 2026-05-24 PM 정정: 폭/매체 분기 폐기. 모바일 가로·태블릿 가로·데스크탑·4K 모두 동일 layout.
  //     같은 grid 구도를 모든 viewport에서 유지하여 카드가 중앙으로 흘러나오는 문제 해결.
  //   ※ 또한 isDesktopPointer 신호로 PC 우상단 전체화면 버튼만 별도 게이트.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const isPortraitMobile = w <= 768 && h > w;
      // 가로(landscape): 모든 폭에서 통합 layout 사용
      const isLandscape = w > h;
      // PC/데스크탑 hover-pointer 매체: 우상단 전체화면 버튼 노출 X (F11/ESC로 충분)
      const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      setIsMobilePortrait(isPortraitMobile);
      setIsMobileLandscape(isLandscape);
      setIsDesktopPointer(isDesktop);
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
    if (session?.status === 'running' && audioReady) {
      // 10초~1초 매초 1회 비프. prev !== sec로 매 tick 비교.
      if (soundWarn30Effective && prev !== null && prev !== sec && sec >= 1 && sec <= 10) {
        playCountdownBeep();
      }
      // sec=0 도달 즉시 blindUp (cron 대기 X). prev가 1 이상에서 0으로 떨어진 순간.
      // 첫 mount 시 prev=null이면 skip — 백업 effect(레벨 변경)가 처리.
      if (soundBlindUpEffective && prev !== null && prev > 0 && sec === 0 && session?.id) {
        const lv = session.currentLevel ?? -1;
        const cycleKey = `lv${lv}-${session.id}`;
        if (blindUpFiredCycleRef.current !== cycleKey) {
          blindUpFiredCycleRef.current = cycleKey;
          playBlindUp();
          // 서버 currentLevel을 클라 transaction으로 즉시 +1 — autoAdvanceLevel cron
          // (1분 주기) 의존 제거. 권한·동시성 충돌 시 false 반환, cron이 fallback 처리.
          void advanceLevelIfDue(session.id, lv).catch(() => {});
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
      const cycleKey = `lv${currLv}-${session.id}`;
      if (blindUpFiredCycleRef.current !== cycleKey) {
        blindUpFiredCycleRef.current = cycleKey;
        playBlindUp();
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
    <div className="h-screen text-white flex flex-col relative overflow-hidden" style={bgStyle}>
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
              inline-flex 안에 NOW 배지 → 타이머 → 진행바 → 블라인드(중앙) 순. */}
          <div className="inline-flex flex-col items-center">
            {/* NOW 배지 — 타이머 바로 위 */}
            <div
              className="rounded-full px-3 py-1 mb-3 border flex items-center gap-1.5"
              style={{
                background: isCurrentBreak
                  ? 'linear-gradient(135deg, rgba(255,209,102,0.2), rgba(0,0,0,0.5))'
                  : `linear-gradient(135deg, ${display.accentColor}26, rgba(0,0,0,0.5))`,
                borderColor: isCurrentBreak ? '#FFD16688' : `${display.accentColor}66`,
              }}
            >
              <span
                className="font-extrabold tracking-[0.18em] text-xs"
                style={{ color: isCurrentBreak ? '#FFD166' : display.accentColor }}
              >
                ▶ NOW
              </span>
              <span className="text-xs opacity-40" style={{ color: display.textColor }}>·</span>
              <span
                className="font-extrabold tracking-[0.18em] text-sm"
                style={{ color: display.textColor }}
              >
                {isCurrentBreak ? `BREAK · LV ${session.currentLevel}` : `LV ${session.currentLevel}`}
              </span>
            </div>
            <div
              className={`font-mono font-extrabold leading-none transition-colors text-center ${veryLow ? 'animate-pulse' : ''}`}
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
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

      {/* 거대 타이머 — 화면 폭의 18~22vw 정도. NOW 배지가 타이머 바로 위. */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div
          className="rounded-full px-2.5 py-0.5 mb-2 border flex items-center gap-1"
          style={{
            background: isCurrentBreak
              ? 'linear-gradient(135deg, rgba(255,209,102,0.2), rgba(0,0,0,0.5))'
              : `linear-gradient(135deg, ${display.accentColor}26, rgba(0,0,0,0.5))`,
            borderColor: isCurrentBreak ? '#FFD16688' : `${display.accentColor}66`,
          }}
        >
          <span
            className="font-extrabold tracking-[0.18em] text-[9px]"
            style={{ color: isCurrentBreak ? '#FFD166' : display.accentColor }}
          >
            ▶ NOW
          </span>
          <span className="text-[9px] opacity-40" style={{ color: display.textColor }}>·</span>
          <span
            className="font-extrabold tracking-[0.16em] text-[11px]"
            style={{ color: display.textColor }}
          >
            {isCurrentBreak ? `BREAK · LV ${session.currentLevel}` : `LV ${session.currentLevel}`}
          </span>
        </div>
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
}) {
  const barColor = lowTime ? display.accentColor : isCurrentBreak ? '#FFD166' : display.blindsColor;
  const timerColor = paused
    ? '#A8A8A8'
    : lowTime
    ? display.accentColor
    : isCurrentBreak
    ? '#FFD166'
    : display.timerColor;

  // 2026-05-24 PM 정정 #5건 통합: 단일 가로 layout (모든 폭 동일).
  // - 상단 헤더 row: 제목 + LEVEL 거대 폰트 중앙 정렬 (사용자 정정 #4)
  // - 본문 grid: 좌(블라인드/NEXT) / 중(거대 타이머) / 우(stat 3카드 중앙 정렬)
  // - viewport 100vh 가득, 카드 흘러나옴 X (사용자 정정 #1, #5)
  const titled = !!(display.titleText && display.titleText.trim().length > 0);
  const titleBold = titled && display.titleStyle.includes('bold');
  const titleItalic = titled && display.titleStyle.includes('italic');
  const noteBold = display.noteStyle.includes('bold');
  const noteItalic = display.noteStyle.includes('italic');

  return (
    <div className="relative flex-1 flex flex-col px-3 pt-2 pb-2 min-h-0 overflow-hidden">
      {/* ─── 상단 헤더 row — 제목/노트/LEVEL 중앙 정렬 + 거대 폰트 (사용자 정정 #4) ─── */}
      <div className="flex-shrink-0 flex flex-col items-center justify-center gap-1 pb-1">
        {/* 상태 뱃지 — 중앙 상단 */}
        <div className="flex items-center gap-2">
          {paused ? (
            <span className="font-extrabold tracking-[0.3em]" style={{ color: '#FFD166', fontSize: 'clamp(11px, 1.3vw, 16px)' }}>
              ⏸ PAUSED
            </span>
          ) : isCurrentBreak ? (
            <span className="font-extrabold tracking-[0.3em]" style={{ color: '#FFD166', fontSize: 'clamp(11px, 1.3vw, 16px)' }}>
              ☕ BREAK
            </span>
          ) : (
            <>
              <span
                className="rounded-full animate-pulse"
                style={{ background: display.accentColor, width: 'clamp(6px, 0.7vw, 10px)', height: 'clamp(6px, 0.7vw, 10px)' }}
              />
              <span
                className="font-extrabold tracking-[0.3em]"
                style={{ color: display.accentColor, fontSize: 'clamp(11px, 1.3vw, 16px)' }}
              >
                LIVE
              </span>
            </>
          )}
        </div>
        {/* 제목 (heroTitle) — 거대 중앙 정렬. 사용자: "제목또한 중앙상단에 배치되며 잘보여야한다. 현재는 폰트가 너무 작음" */}
        <div
          className="text-center truncate max-w-[95%]"
          title={heroTitle}
          style={{
            color: titled ? display.titleColor : display.textColor,
            opacity: titled ? 1 : 0.9,
            fontSize: 'clamp(20px, 3vw, 38px)',
            fontWeight: titleBold ? 800 : 700,
            fontStyle: titleItalic ? 'italic' : 'normal',
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
          }}
        >
          {heroTitle}
        </div>
        {/* 노트 (있을 때만) — 중앙 정렬 */}
        {display.noteText && display.noteText.trim().length > 0 && (
          <div
            className="text-center truncate max-w-[90%]"
            style={{
              color: display.noteColor,
              fontSize: 'clamp(11px, 1.3vw, 18px)',
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

      {/* 본문 3분할 grid — 2026-05-24 PM 정정 #1~#6 통합.
          좌: 5레벨 컴팩트 스트럭쳐 + NEXT (BLINDS는 중앙 하단으로 이동)
          중: LEVEL 카드(타이머 위 작게) + 거대 타이머 + 진행바 + BLINDS(중앙 하단)
          우: PLAYERS/LATE REG/PRIZE POOL 세로 stack (30~40% 축소)
          grid: 좌 1fr / 중 2.6fr / 우 1.4fr — 모든 폭에서 동일. */}
      <div
        className="flex-1 grid items-stretch gap-3 min-h-0"
        style={{ gridTemplateColumns: '1fr 2.6fr 1.4fr' }}
      >
        {/* ─── 좌: 5레벨 컴팩트 스트럭쳐 + NEXT ─── */}
        <div className="flex flex-col justify-center gap-3 min-w-0 min-h-0 overflow-hidden">
          {/* 2026-05-24 PM 정정 #4: 좌측 5레벨 스트럭쳐 부활 (가로 통합 layout).
              showStructure 토글 존중. 앤티 있으면 자동으로 ante 행 추가. */}
          {display.showStructure !== false && (
            <BlindStructurePanel
              structure={structure}
              currentLevel={session.currentLevel}
              display={display}
              variant="landscape"
            />
          )}
          {/* NEXT 박스 — 중앙 정렬 */}
          {nextBlind && (
            <div
              className="rounded-lg px-2 py-2 border text-center"
              style={{
                background: 'rgba(0,0,0,0.45)',
                borderColor: nextBlind.isBreak ? '#FFD166' : `${display.accentColor}55`,
              }}
            >
              <div
                className="font-extrabold tracking-[0.3em] mb-1"
                style={{
                  color: nextBlind.isBreak ? '#FFD166' : display.accentColor,
                  fontSize: 'clamp(9px, 1vw, 12px)',
                }}
              >
                ▶ NEXT
              </div>
              {nextBlind.isBreak ? (
                <div
                  className="font-extrabold"
                  style={{ color: '#FFD166', fontSize: 'clamp(13px, 1.5vw, 18px)' }}
                >
                  ☕ 휴식 {Math.round(nextBlind.durationSec / 60)}분
                </div>
              ) : (
                <div
                  className="font-mono font-extrabold"
                  style={{ color: display.blindsColor, fontSize: 'clamp(14px, 1.6vw, 20px)' }}
                >
                  LV {nextBlind.level} · {nextBlind.sb.toLocaleString()}
                  <span style={{ color: display.textColor, opacity: 0.4 }} className="mx-1">/</span>
                  {nextBlind.bb.toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── 중: LEVEL 배지 + 거대 타이머 + 진행바 + 중앙 하단 BLINDS ─── */}
        <div className="flex flex-col items-center justify-center min-w-0">
          {/* 2026-05-24 PM 정정 #3: LEVEL은 거대 타이머 바로 위 중앙에 작은 카드/배지로.
              사용자 정정: "중앙상단에 레벨 표시는 제목쪽보단 타이머 시간위에 표시되거나
                            좌측 플라인드 윗쪽으로 표시되는게 깔끔할것같다.
                            (카드형태로 돋보이게 now 표시를 넣어도되고 안넣어도되고)"
              ⇒ 작은 배지: ▶ NOW · LV N (또는 BREAK · LV N)
              ⇒ 배경 그라데이션 + 보더로 카드형. */}
          <div
            className="rounded-full px-3 py-1 mb-2 border flex items-center gap-1.5"
            style={{
              background: isCurrentBreak
                ? 'linear-gradient(135deg, rgba(255,209,102,0.2), rgba(0,0,0,0.5))'
                : `linear-gradient(135deg, ${display.accentColor}26, rgba(0,0,0,0.5))`,
              borderColor: isCurrentBreak ? '#FFD16688' : `${display.accentColor}66`,
            }}
          >
            <span
              className="font-extrabold tracking-[0.18em]"
              style={{
                color: isCurrentBreak ? '#FFD166' : display.accentColor,
                fontSize: 'clamp(9px, 1vw, 12px)',
              }}
            >
              ▶ NOW
            </span>
            <span
              className="font-extrabold tracking-[0.15em]"
              style={{
                color: display.textColor,
                opacity: 0.4,
                fontSize: 'clamp(9px, 0.9vw, 11px)',
              }}
            >
              ·
            </span>
            <span
              className="font-extrabold tracking-[0.18em]"
              style={{
                color: display.textColor,
                fontSize: 'clamp(11px, 1.3vw, 16px)',
              }}
            >
              {isCurrentBreak ? `BREAK · LV ${session.currentLevel}` : `LV ${session.currentLevel}`}
            </span>
          </div>
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
                  fontSize: 'clamp(32px, 5vw, 72px)',
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
                    opacity: 0.65,
                    fontSize: 'clamp(13px, 1.4vw, 20px)',
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
                />
                {/* 3) PRIZE POOL — 단독 카드 (showPrize일 때만, accent 그라데이션)
                    2026-05-24 PM 정정 #3: 헤더+금액 중앙 정렬.
                    DISTRIBUTION 분배표 행은 라벨좌/금액우 정렬 유지 (사용자 명시). */}
                {showPrize && (
                  <div
                    className="flex-1 rounded-xl px-2.5 py-2 border backdrop-blur-sm relative overflow-hidden flex flex-col min-h-0 text-center"
                    style={{
                      background: `linear-gradient(135deg, ${accent}22 0%, rgba(0,0,0,0.6) 70%)`,
                      borderColor: `${accent}50`,
                      boxShadow: `0 0 24px ${accent}1A inset`,
                    }}
                    aria-label="프라이즈 풀"
                  >
                    <div
                      className="font-extrabold flex items-center justify-center gap-1 flex-shrink-0"
                      style={{
                        color: accent,
                        opacity: 0.95,
                        fontSize: 'clamp(8px, 0.85vw, 11px)',
                        letterSpacing: '0.28em',
                      }}
                    >
                      <span>💰</span>
                      <span>PRIZE POOL</span>
                    </div>
                    {/* 2026-05-24 PM 정정 #1: PRIZE POOL 금액 30~40% 축소.
                        4.5vw → 2.9vw, max 52px → 32px (-38%) */}
                    <div
                      className="font-mono font-extrabold tabular-nums leading-none mt-1.5 flex-shrink-0"
                      style={{
                        fontSize: 'clamp(18px, 2.9vw, 32px)',
                        color: display.textColor,
                        letterSpacing: '-0.03em',
                        textShadow: `0 2px 12px ${accent}55`,
                      }}
                    >
                      {session.prizePool > 0 ? fmtPrizeDisplay(session.prizePool, unit) : '—'}
                    </div>
                    {/* 2026-05-24 PM 정정 #2: DISTRIBUTION 분배표 폰트 키움 (시인성 우선).
                        rank 라벨 1.3vw→1.7vw / 금액 1.4vw→1.9vw, max 14px→20px.
                        정렬은 라벨좌/금액우 유지 (사용자 명시) */}
                    {mode === 'distribution' && amounts.length > 0 && (
                      <div
                        className="mt-1.5 pt-1.5 border-t flex-1 min-h-0 overflow-hidden flex flex-col text-left"
                        style={{ borderColor: 'rgba(255,255,255,0.12)' }}
                      >
                        <div
                          className="text-[9px] tracking-[0.22em] font-extrabold opacity-65 mb-1 flex-shrink-0 text-center"
                          style={{ color: display.textColor }}
                        >
                          DISTRIBUTION
                        </div>
                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-0.5">
                          {amounts.slice(0, 6).map((a) => (
                            <div
                              key={a.rank}
                              className="font-mono flex items-baseline justify-between rounded px-1.5 py-0.5"
                              style={{
                                color: display.textColor,
                                background: a.rank === 1 ? `${accent}18` : 'transparent',
                              }}
                            >
                              <span
                                className="font-extrabold tabular-nums"
                                style={{
                                  fontSize: 'clamp(12px, 1.7vw, 18px)',
                                  color: a.rank === 1 ? accent : display.textColor,
                                }}
                              >
                                {a.rank}등
                              </span>
                              <span
                                className="tabular-nums font-bold"
                                style={{
                                  fontSize: 'clamp(13px, 1.9vw, 20px)',
                                  color: display.blindsColor,
                                }}
                              >
                                {fmtPrizeDisplay(a.amount, unit) || '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                        {amounts.length > 6 && (
                          <div
                            className="text-[10px] mt-1 opacity-55 flex-shrink-0 text-center"
                            style={{ color: display.textColor }}
                          >
                            +{amounts.length - 6}등 더
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* 2026-05-24 PM 정정: 하단 마퀴 완전 제거 (사용자 명시: "이 마퀴는 없애줘").
          데이터 모델(marqueeText/Color/FontSize/Style/SpeedSec)은 backward compat 유지하되 UI 표시 X. */}

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
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  color: string;
  accentColor?: string;
  borderColor: string;
}) {
  // 2026-05-24 PM 정정 #1 (재정정): 우측 카드 30~40% 축소.
  //   사용자 정정: "우측 나열되는 카드들의 크기가 비효율적으로 크다. 30~40% 줄여도 될것같은데"
  //   값 폰트  3.8vw → 2.4vw (-37%) / max 44px → 28px (-36%)
  //   라벨 폰트 1.1vw → 0.85vw (-23%) / max 14px → 11px (-21%)
  //   sub 폰트  1.05vw → 0.85vw (-19%) / max 13px → 11px (-15%)
  //   패딩     py-3 → py-2 (-33%) / px-3 → px-2.5 (-17%)
  //   gap     mt-2 → mt-1, mt-1.5 → mt-1 (-33~50%)
  return (
    <div
      className="rounded-xl px-2.5 py-2 border backdrop-blur-sm flex-shrink-0 text-center"
      style={{
        background: 'rgba(0,0,0,0.45)',
        borderColor,
      }}
    >
      <div
        className="font-extrabold flex-shrink-0"
        style={{
          color,
          opacity: 0.6,
          fontSize: 'clamp(8px, 0.85vw, 11px)',
          letterSpacing: '0.28em',
        }}
      >
        {label}
      </div>
      <div
        className="font-mono font-extrabold tabular-nums leading-none mt-1"
        style={{
          fontSize: 'clamp(16px, 2.4vw, 28px)',
          letterSpacing: '-0.02em',
          color: highlight && accentColor ? accentColor : color,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="mt-1"
          style={{ color, opacity: 0.6, fontSize: 'clamp(8px, 0.85vw, 11px)' }}
        >
          {sub}
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
 * 디자인 (앤티 없을 때):                  디자인 (앤티 있을 때):
 *   ┌────────────────┐                   ┌──────────────────┐
 *   │ 📋 STRUCTURE    │                   │ 📋 STRUCTURE      │
 *   ├────────────────┤                   ├──────────────────┤
 *   │ ✓ Lv 4  200/400 │                   │ ✓ Lv 4  200/400   │
 *   │ ▶ Lv 5  300/600 │                   │       ante 100    │
 *   │   Lv 6  500/1k  │                   │ ▶ Lv 5  300/600   │
 *   │   Lv 7  800/1.6k│                   │       ante 200    │
 *   │   Lv 8  1k/2k   │                   │ ...               │
 *   └────────────────┘                   └──────────────────┘
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
}: {
  structure: { level: number; sb: number; bb: number; ante: number; durationSec: number; isBreak?: boolean }[] | undefined;
  currentLevel: number;
  display: TimerDisplaySettings;
  variant: 'desktop' | 'landscape';
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

  // variant별 사이즈/패딩 결정 — 컴팩트(좌측 컬럼 폭 맞춤)
  const headerSize =
    variant === 'desktop' ? 'text-sm px-3 py-2' : 'text-[11px] px-2 py-1.5';
  const rowSize =
    variant === 'desktop' ? 'px-2.5 py-1.5 text-sm' : 'px-2 py-1 text-[12px]';
  const panelWidth =
    variant === 'desktop' ? 240 : '100%';
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
      {/* 헤더 */}
      <div
        className={`${headerSize} font-extrabold tracking-[0.2em] border-b flex-shrink-0 flex items-center justify-between`}
        style={{
          borderColor: 'rgba(255,255,255,0.1)',
          color: fg,
          background: 'rgba(0,0,0,0.35)',
        }}
      >
        <span>📋 STRUCTURE</span>
        <span
          className="tabular-nums opacity-60"
          style={{ fontSize: variant === 'desktop' ? 11 : 9, letterSpacing: '0.1em' }}
        >
          Lv {currentLevel} / {structure.length}
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
              className={`${rowSize} font-mono flex items-center gap-2 transition-all`}
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
              }}
            >
              <span
                className="text-center"
                style={{
                  color: markerColor,
                  opacity: isCurrent ? 1 : 0.85,
                  width: variant === 'desktop' ? 16 : 14,
                  fontSize: variant === 'desktop' ? 14 : 12,
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
                  <span style={{ opacity: 0.7, marginLeft: 'auto' }}>
                    {Math.round(lvl.durationSec / 60)}분
                  </span>
                </>
              ) : (
                <>
                  <span
                    className="font-bold tabular-nums"
                    style={{
                      minWidth: variant === 'desktop' ? 38 : 32,
                      opacity: 0.85,
                    }}
                  >
                    Lv {lvl.level}
                  </span>
                  <div className="flex flex-col items-end" style={{ marginLeft: 'auto' }}>
                    <span
                      className="tabular-nums leading-tight"
                      style={{
                        color: blinds,
                        opacity: isCurrent ? 1 : 0.9,
                      }}
                    >
                      {lvl.sb.toLocaleString()}
                      <span style={{ opacity: 0.4 }}>/</span>
                      {lvl.bb.toLocaleString()}
                    </span>
                    {hasAnyAnte && (
                      <span
                        className="tabular-nums leading-tight"
                        style={{
                          color: fg,
                          opacity: lvl.ante > 0 ? 0.7 : 0.3,
                          fontSize: variant === 'desktop' ? 10 : 9,
                          marginTop: 1,
                        }}
                      >
                        a{lvl.ante > 0 ? lvl.ante.toLocaleString() : '—'}
                      </span>
                    )}
                  </div>
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
