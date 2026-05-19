'use client';

/**
 * AdminIdentityBadge — 어드민 좌상단 식별 영역 공용 컴포넌트
 *
 * 본사/매장/대회사 모두 동일한 인터페이스로 사용.
 * 라이트/다크 모두 또렷이 — 배경은 컨텍스트 컬러의 10% 틴트, 테두리는 컨텍스트 컬러.
 *
 * 사용:
 *   <AdminIdentityBadge context="platform" name="홍길동" email="x@y.com" />
 *   <AdminIdentityBadge context="store"    name="펀치홀덤" subLabel="active" />
 *   <AdminIdentityBadge context="organizer" name="WSOP KR" />
 */

import type { CSSProperties } from 'react';

export type IdentityContext = 'store' | 'platform' | 'organizer';

interface Props {
  context: IdentityContext;
  name: string;
  email?: string;
  subLabel?: string;
  className?: string;
}

const CONFIG: Record<
  IdentityContext,
  { icon: string; label: string; color: string; bg: string }
> = {
  store: {
    icon: '🏬',
    label: '매장 사장',
    color: '#FF1F8F',
    bg: 'rgba(255,31,143,0.10)',
  },
  platform: {
    icon: '👑',
    label: '총관리자',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.10)',
  },
  organizer: {
    icon: '🏆',
    label: '대회사',
    color: '#A855F7',
    bg: 'rgba(168,85,247,0.10)',
  },
};

export default function AdminIdentityBadge({
  context,
  name,
  email,
  subLabel,
  className,
}: Props) {
  const config = CONFIG[context];

  const wrapStyle: CSSProperties = {
    background: config.bg,
    border: `1px solid ${config.color}`,
    borderRadius: 12,
    padding: '10px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };

  return (
    <div style={wrapStyle} className={className}>
      <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }} aria-hidden>
        {config.icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 13,
            color: 'var(--text-1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: config.color,
            letterSpacing: '0.06em',
            marginTop: 2,
          }}
        >
          {config.label}
        </div>
        {email && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-3)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {email}
          </div>
        )}
        {subLabel && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-2)',
              marginTop: 2,
            }}
          >
            {subLabel}
          </div>
        )}
      </div>
    </div>
  );
}
