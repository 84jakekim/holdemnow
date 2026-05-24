'use client';

/**
 * BottomSheet — 공통 바텀시트 컴포넌트
 *
 * 모바일 우선 패턴. 핸들 바 + 오버레이 + slideUp 220ms.
 * 토큰화: bg-[var(--surface-1)] / text-[var(--text-*)] 사용 → 다크 모드 자동.
 *
 * 사용 예시:
 *   <BottomSheet open={open} onClose={() => setOpen(false)} ariaLabel="로그아웃 확인">
 *     <p className="...">콘텐츠</p>
 *   </BottomSheet>
 *
 * 디자인 시스템 v1: 시그니처 컴포넌트 — LogoutConfirmSheet, 향후 ReservationSheet,
 * FilterSheet 등의 무대로 사용. 핸들/오버레이/슬라이드는 한 곳에서 관리.
 */

import { useEffect, useRef } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  ariaLabel?: string;
  /** 시트 최대 너비. 기본 max-w-md (모바일 우선). */
  maxWidth?: 'sm' | 'md' | 'lg';
  /** 핸들 바 노출. 기본 true. */
  showHandle?: boolean;
  /** 오버레이 클릭 시 닫기. 기본 true. */
  closeOnOverlayClick?: boolean;
  children: React.ReactNode;
};

const MAX_WIDTH_CLASS: Record<NonNullable<Props['maxWidth']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export default function BottomSheet({
  open,
  onClose,
  ariaLabel,
  maxWidth = 'md',
  showHandle = true,
  closeOnOverlayClick = true,
  children,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // 오픈 시 body 스크롤 잠금 + ESC 닫기
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (closeOnOverlayClick && e.target === overlayRef.current) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className={`w-full ${MAX_WIDTH_CLASS[maxWidth]} bg-[var(--surface-1)] rounded-t-3xl px-5 pt-5`}
        style={{
          paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))',
          animation: 'pr-sheet-slide-up 0.22s ease-out',
          boxShadow: 'var(--shadow-float)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {showHandle && (
          <div
            className="w-10 h-1 rounded-full bg-[var(--surface-3)] mx-auto mb-4"
            aria-hidden="true"
          />
        )}
        {children}
      </div>

      <style>{`
        @keyframes pr-sheet-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="dialog"] > div { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
