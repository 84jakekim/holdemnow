/**
 * RabbitLogo — Pink Rabbit 시그니처 토끼 로고 SVG 컴포넌트
 *
 * 2026-05-25 신설. Claude Design 핸드오프(claude-design/pimk-rabbit/project/components.jsx)에서
 * 추출한 단일 SVG. 라이트/다크/TV 프리셋과 무관하게 동일한 마크.
 *
 * Variants:
 *  · 'badge' (기본) — 라운드 박스 안에 흰 토끼. 헤더/로그인/스플래시 등에 사용.
 *  · 'mark'         — 배경 없이 핑크 그라데이션으로 채운 토끼만. 워드마크 옆 또는
 *                     이미 진한 배경 위에서 사용.
 *
 * Props:
 *  · size?: number = 48          — 정사각 픽셀 (width=height)
 *  · variant?: 'badge' | 'mark'  — 위 설명 참조
 *  · primary?: string            — 메인 핑크 색 (기본 #FF1F8F = --brand)
 *  · glow?: boolean              — true면 핑크 drop-shadow 추가 (badge variant 전용)
 *
 * 사용 예시:
 *   <RabbitLogo size={56} variant="badge" glow />
 *   <RabbitLogo size={32} variant="mark" />
 *
 * 주의: viewBox 0 0 64 64 고정. 색 변경은 primary prop으로만.
 */

'use client';

import { useId } from 'react';

export type RabbitLogoVariant = 'badge' | 'mark';

type Props = {
  size?: number;
  variant?: RabbitLogoVariant;
  primary?: string;
  glow?: boolean;
  className?: string;
  'aria-label'?: string;
};

const SOFT_PINK = '#FF6BAA';
const INNER_PINK = '#FFB3D4';

export default function RabbitLogo({
  size = 48,
  variant = 'badge',
  primary = '#FF1F8F',
  glow = false,
  className,
  'aria-label': ariaLabel = 'HoldemNow',
}: Props) {
  // SSR-safe 고유 id (그라데이션 중복 회피)
  const rawId = useId();
  const id = `rbt-${rawId.replace(/[:]/g, '')}`;
  const gradId = `${id}-g`;

  if (variant === 'mark') {
    // 배경 없는 토끼 — 핑크 그라데이션 fill
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-label={ariaLabel}
        role="img"
        className={className}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={primary} />
            <stop offset="100%" stopColor={SOFT_PINK} />
          </linearGradient>
        </defs>
        <g>
          {/* 왼쪽 귀 */}
          <ellipse cx="22" cy="20" rx="4.8" ry="11" fill={`url(#${gradId})`} transform="rotate(-12 22 20)" />
          <ellipse cx="22" cy="22" rx="1.9" ry="6.5" fill={INNER_PINK} transform="rotate(-12 22 22)" />
          {/* 오른쪽 귀 */}
          <ellipse cx="42" cy="20" rx="4.8" ry="11" fill={`url(#${gradId})`} transform="rotate(12 42 20)" />
          <ellipse cx="42" cy="22" rx="1.9" ry="6.5" fill={INNER_PINK} transform="rotate(12 42 22)" />
          {/* 머리 */}
          <circle cx="32" cy="42" r="14" fill={`url(#${gradId})`} />
          {/* 눈 (흰) */}
          <ellipse cx="27" cy="40.5" rx="1.6" ry="2" fill="#fff" />
          <ellipse cx="37" cy="40.5" rx="1.6" ry="2" fill="#fff" />
          {/* 코 (흰) */}
          <path d="M30.2 45.4 Q32 47.2 33.8 45.4 Q32 46.8 30.2 45.4Z" fill="#fff" />
        </g>
      </svg>
    );
  }

  // badge variant — 라운드 박스 + 그라데이션 배경 + 흰 토끼
  const cornerR = size >= 56 ? 18 : 14;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-label={ariaLabel}
      role="img"
      className={className}
      style={glow ? { filter: 'drop-shadow(0 6px 18px rgba(255,31,143,0.35))' } : undefined}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={primary} />
          <stop offset="100%" stopColor={SOFT_PINK} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={cornerR} fill={`url(#${gradId})`} />
      <g>
        {/* 왼쪽 귀 */}
        <ellipse cx="22" cy="20" rx="4.8" ry="11" fill="#fff" transform="rotate(-12 22 20)" />
        <ellipse cx="22" cy="22" rx="1.9" ry="6.5" fill={INNER_PINK} transform="rotate(-12 22 22)" />
        {/* 오른쪽 귀 */}
        <ellipse cx="42" cy="20" rx="4.8" ry="11" fill="#fff" transform="rotate(12 42 20)" />
        <ellipse cx="42" cy="22" rx="1.9" ry="6.5" fill={INNER_PINK} transform="rotate(12 42 22)" />
        {/* 머리 */}
        <circle cx="32" cy="42" r="14" fill="#fff" />
        {/* 볼 블러시 */}
        <circle cx="23" cy="46" r="2" fill={INNER_PINK} opacity="0.8" />
        <circle cx="41" cy="46" r="2" fill={INNER_PINK} opacity="0.8" />
        {/* 눈 (핑크) */}
        <ellipse cx="27" cy="40.5" rx="1.6" ry="2" fill={primary} />
        <ellipse cx="37" cy="40.5" rx="1.6" ry="2" fill={primary} />
        {/* 눈 하이라이트 */}
        <circle cx="27.5" cy="40" r="0.6" fill="#fff" />
        <circle cx="37.5" cy="40" r="0.6" fill="#fff" />
        {/* 코 */}
        <path d="M30.2 45.4 Q32 47.2 33.8 45.4 Q32 46.8 30.2 45.4Z" fill={primary} />
        {/* 입 */}
        <path
          d="M32 46.8 Q32 48.2 30.4 48.6 M32 46.8 Q32 48.2 33.6 48.6"
          stroke={primary}
          strokeWidth="0.9"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  );
}
