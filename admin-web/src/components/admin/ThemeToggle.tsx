'use client';

/**
 * ThemeToggle — 3-state 테마 토글 (light / dark / system)
 *
 * 컴팩트 segmented control. 어드민 사이드바 푸터에 들어가는 사이즈.
 *
 * 사용:
 *   const { pref, change } = useTheme('dark-default');
 *   <ThemeToggle value={pref} onChange={change} />
 */

import type { CSSProperties } from 'react';
import type { ThemePref } from '@/lib/theme';

interface Props {
  value: ThemePref;
  onChange: (next: ThemePref) => void;
  className?: string;
}

const OPTIONS: { value: ThemePref; icon: string; label: string }[] = [
  { value: 'light', icon: '☀', label: '라이트' },
  { value: 'system', icon: '⎈', label: '시스템' },
  { value: 'dark', icon: '☾', label: '다크' },
];

export default function ThemeToggle({ value, onChange, className }: Props) {
  const wrapStyle: CSSProperties = {
    display: 'inline-flex',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  };

  return (
    <div style={wrapStyle} className={className} role="group" aria-label="테마 전환">
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        const btnStyle: CSSProperties = {
          flex: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: '5px 8px',
          fontSize: 11,
          fontWeight: 700,
          borderRadius: 7,
          border: 'none',
          cursor: 'pointer',
          background: active ? 'var(--surface-1)' : 'transparent',
          color: active ? 'var(--text-1)' : 'var(--text-3)',
          boxShadow: active ? '0 1px 2px rgba(0,0,0,0.18)' : 'none',
          transition: 'background 120ms, color 120ms',
        };
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => onChange(opt.value)}
            style={btnStyle}
          >
            <span aria-hidden>{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
