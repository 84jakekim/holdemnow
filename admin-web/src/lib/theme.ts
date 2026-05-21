'use client';

/**
 * Pink Rabbit 어드민 공용 테마 시스템
 *
 * 본사 어드민(다크 기본)과 매장 어드민(라이트 기본)이 동일한 인프라를 공유.
 * 3-state 토글: light / dark / system.
 *
 * 사용:
 *   const { pref, resolved, change } = useTheme('dark-default');
 *   // pref: 사용자 선호 ('light' | 'dark' | 'system')
 *   // resolved: 실제 적용된 테마 ('light' | 'dark')
 *   // change(next): 변경
 *
 * 데이터 모델:
 *   - localStorage 키 'holdemnow:theme' 에 'light' | 'dark' 만 저장.
 *   - 'system' 선택 시 키 제거 → resolveTheme이 prefers-color-scheme 따름.
 */

import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export type ThemeContext = 'light-default' | 'dark-default' | 'auto';

const KEY = 'holdemnow:theme';

export function getStoredTheme(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * useTheme hook
 *
 * initialContext:
 *   - 'light-default' : 매장 어드민 등 라이트 기본 (저장된 값 없을 때)
 *   - 'dark-default'  : 본사 어드민 등 다크 기본
 *   - 'auto'          : 시스템 설정 그대로
 *
 * 우선순위: localStorage > initialContext > system
 */
export function useTheme(initialContext: ThemeContext = 'auto') {
  const [pref, setPref] = useState<ThemePref>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  // 마운트 시 1회: 저장된 선호 또는 컨텍스트 기본 적용
  useEffect(() => {
    const stored = getStoredTheme();
    let initial: ThemePref = stored;
    if (stored === 'system') {
      if (initialContext === 'dark-default') initial = 'dark';
      else if (initialContext === 'light-default') initial = 'light';
      else initial = 'system';
    }
    setPref(initial);
    const r = resolveTheme(initial);
    setResolved(r);
    applyTheme(r);
    setMounted(true);
  }, [initialContext]);

  // system 선호 시 OS 변경 추적
  useEffect(() => {
    if (!mounted) return;
    if (pref !== 'system') return;
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const r = resolveTheme('system');
      setResolved(r);
      applyTheme(r);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [pref, mounted]);

  const change = (next: ThemePref) => {
    setPref(next);
    try {
      if (next === 'system') window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, next);
    } catch {
      // private mode etc. - silently ignore
    }
    const r = resolveTheme(next);
    setResolved(r);
    applyTheme(r);
  };

  return { pref, resolved, change, mounted };
}
