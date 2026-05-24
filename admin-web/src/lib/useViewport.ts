// ─── useViewport — 디스플레이/타이머 화면 환경 정확 판정 (2026-05-24 PM 핫픽스) ───
//
// 배경 (사용자 보고):
//   "PWA 재설치해도 모바일 최적화 안 됨. 타이머는 PC/모바일 등 각 사용자 환경에 맞춰져야."
//   직전 단일 가로 layout이 PC 기준이라 모바일 폭에서 폰트/패딩 부적합.
//
// 정책:
//   ① matchMedia 우선 — 'pointer:coarse' + 'hover:none' = 터치 전용 모바일/태블릿
//      iPad Safari가 'hover:hover'로 잡힐 수 있어 UA 보조 사용.
//   ② 폭 보조 — w<=1024 + landscape는 모바일 가로로 간주 (iPhone Plus 가로/접이폰).
//   ③ landscape 판정 — innerWidth > innerHeight (단순/안정).
//   ④ SSR 안전 — 서버에서는 모두 false 반환, 클라 mount 후 첫 measure 즉시 sync.
//
// 결과 카테고리 (3-way 명확 분리):
//   - mobilePortrait   : 모바일 + 세로
//   - mobileLandscape  : 모바일 + 가로 (PC와 분리 → 컴팩트 폰트)
//   - desktop          : PC/태블릿 가로 (기존 풀 layout 유지)
//
// 또한 isDesktopPointer 신호로 PC 전용 UI (F11 안내, hover-only 컨트롤) 게이트.

import { useEffect, useState } from 'react';

export interface ViewportInfo {
  /** SSR/mount 전 false. 첫 measure 후 true. */
  ready: boolean;
  /** window.innerWidth */
  width: number;
  /** window.innerHeight */
  height: number;
  /** landscape (w > h) */
  isLandscape: boolean;
  /** 터치 전용 모바일/태블릿 (pointer:coarse + hover:none + UA 보조) */
  isMobile: boolean;
  /** PC/노트북 (hover:hover + pointer:fine) — F11 안내 게이트 */
  isDesktopPointer: boolean;
  /** 3-way 카테고리: 'mobile-portrait' | 'mobile-landscape' | 'desktop' */
  category: ViewportCategory;
}

export type ViewportCategory = 'mobile-portrait' | 'mobile-landscape' | 'desktop';

function detectMobileByUA(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPad iOS 13+ 는 desktop UA 반환하므로 maxTouchPoints 보조
  const isIPadOS =
    /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  return isIPadOS || /Android|iPhone|iPod|iPad|Mobile|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

function detectMobileByMedia(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(pointer: coarse) and (hover: none)').matches;
  } catch {
    return false;
  }
}

function detectDesktopPointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}

export function classifyViewport(w: number, h: number): {
  isMobile: boolean;
  isDesktopPointer: boolean;
  isLandscape: boolean;
  category: ViewportCategory;
} {
  const isLandscape = w > h;
  const mediaMobile = detectMobileByMedia();
  const uaMobile = detectMobileByUA();
  const isDesktopPointer = detectDesktopPointer();
  // 폭 보조: 1024px 이하 + 터치 신호 어느 쪽이라도 → 모바일/태블릿 간주
  //   (큰 데스크탑 모니터는 항상 1024 초과)
  const small = w <= 1024;
  const isMobile = (mediaMobile || uaMobile) && (small || !isDesktopPointer);

  let category: ViewportCategory;
  if (isMobile && !isLandscape) category = 'mobile-portrait';
  else if (isMobile && isLandscape) category = 'mobile-landscape';
  else category = 'desktop';

  return { isMobile, isDesktopPointer, isLandscape, category };
}

export function useViewport(): ViewportInfo {
  const [info, setInfo] = useState<ViewportInfo>({
    ready: false,
    width: 0,
    height: 0,
    isLandscape: false,
    isMobile: false,
    isDesktopPointer: false,
    category: 'desktop',
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const c = classifyViewport(w, h);
      setInfo({
        ready: true,
        width: w,
        height: h,
        isLandscape: c.isLandscape,
        isMobile: c.isMobile,
        isDesktopPointer: c.isDesktopPointer,
        category: c.category,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return info;
}
