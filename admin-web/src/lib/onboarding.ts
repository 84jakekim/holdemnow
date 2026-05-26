/**
 * 온보딩 슬라이드 노출 여부 헬퍼 (localStorage 기반).
 * 처음 /m 진입 시 /intro로 redirect할지 결정.
 */

const KEY = 'hn:onboardingSeen';

export function hasSeenOnboarding(): boolean {
  if (typeof window === 'undefined') return true; // SSR에선 redirect 막기
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
}

export function markOnboardingSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    /* private mode 등 */
  }
}

export function resetOnboarding(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
