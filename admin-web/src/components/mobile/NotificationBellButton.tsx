'use client';

/**
 * NotificationBellButton — 사용자 앱 종 버튼.
 *
 * - /m/notifications 로 라우팅
 * - 안 읽음 카운트 실시간 (onSnapshot)
 * - 비로그인: 클릭 시 /login 으로
 * - 카운트 표시: 1~9 숫자, 10+ 표시, 0 = dot 숨김
 *
 * Pink Rabbit 핸드오프: hero-pink-action 흰색 원형 버튼 톤 유지.
 *
 * 마운트 정책:
 *   - 홈(/m), /m/find, /m/calendar, /m/my 등 주요 페이지 헤더에 일관 노출.
 *   - 종이 어디서든 접근 가능 — 알림 직진 동선 단축.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks';
import { subscribeUnreadCount } from '@/lib/notifications';

interface Props {
  /** 흰 hero 배경 위 (홈 hero 등) — 흰 배경 + 핫핑크 stroke */
  variant?: 'hero' | 'light';
  /** aria-label 커스텀 (페이지별 보조 정보) */
  ariaLabel?: string;
}

export default function NotificationBellButton({
  variant = 'hero',
  ariaLabel = '알림',
}: Props) {
  const authState = useAuth();
  const uid = authState.status === 'authenticated' ? authState.user.uid : null;
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!uid) {
      setUnread(0);
      return;
    }
    const unsub = subscribeUnreadCount(uid, setUnread, {
      onError: () => setUnread(0),
    });
    return () => unsub();
  }, [uid]);

  const href = uid ? '/m/notifications' : '/login';
  const showBadge = unread > 0;
  const badgeText = unread > 9 ? '9+' : String(unread);

  const isHero = variant === 'hero';
  const buttonClass = isHero
    ? 'hero-pink-action w-10 h-10 flex items-center justify-center rounded-full relative'
    : 'w-10 h-10 flex items-center justify-center rounded-full relative';
  const strokeColor = isHero ? '#FFFFFF' : 'var(--text-1)';

  const badgeAriaSuffix = showBadge ? ` (안 읽음 ${unread})` : '';

  return (
    <Link
      href={href}
      aria-label={`${ariaLabel}${badgeAriaSuffix}`}
      className={buttonClass}
      style={
        isHero
          ? undefined
          : {
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
            }
      }
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={strokeColor}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
      {showBadge && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            borderRadius: 99,
            background: '#EF4444',
            color: '#FFFFFF',
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 0 2px var(--brand, #EC4899)',
            lineHeight: 1,
          }}
        >
          {badgeText}
        </span>
      )}
    </Link>
  );
}
