/**
 * Button — 디자인 시스템 v1 4 variant 카탈로그
 *
 * 2026-05-25 일관성 정리. primary/secondary/ghost/danger 4종 + 3 size.
 * 기존 핸드코딩 버튼(`bg-[#FF1F8F]` 등)은 점진적으로 본 컴포넌트로 마이그레이션.
 * 새 화면/페이지는 본 컴포넌트 사용 권장.
 *
 *  · primary   — 핫핑크 CTA (브랜드 메인 액션, 1페이지에 1개 원칙)
 *  · secondary — surface-2 배경 + text-1 (보조 액션, 2~3개 가능)
 *  · ghost     — 외곽선만, 배경 투명 (취소/뒤로 등 약한 액션)
 *  · danger    — 빨강 (#DC2626) 또는 LIVE 톤 (삭제·로그아웃 등 파괴적 액션)
 *
 * Size:
 *  · sm — h-9 px-3 text-[13px]
 *  · md — h-12 px-5 text-[14px] (기본)
 *  · lg — h-14 px-6 text-[15px] (시트 CTA)
 *
 * 활성 상태: 모든 variant 공통 active:scale(0.985) + 80ms transition.
 * Disabled: opacity-40 + cursor-not-allowed.
 *
 * 사용 예시:
 *   <Button variant="primary" size="lg" onClick={handleSubmit}>가입하기</Button>
 *   <Button variant="ghost" size="sm">취소</Button>
 *   <Button variant="danger" loading={isLoggingOut}>로그아웃</Button>
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 전체 너비 채우기 */
  block?: boolean;
  /** 로딩 상태 — 비활성 + "처리 중…" 라벨 또는 children에 따라 */
  loading?: boolean;
  /** 왼쪽 아이콘 */
  iconLeft?: ReactNode;
  /** 오른쪽 아이콘 */
  iconRight?: ReactNode;
};

function variantClasses(variant: ButtonVariant): string {
  switch (variant) {
    case 'primary':
      return 'text-white font-extrabold';
    case 'secondary':
      return 'bg-[var(--surface-2)] text-[var(--text-1)] font-bold hover:bg-[var(--surface-3)]';
    case 'ghost':
      return 'bg-transparent text-[var(--text-1)] font-bold border border-[var(--border)] hover:bg-[var(--surface-2)]';
    case 'danger':
      return 'text-white font-extrabold';
    default:
      return '';
  }
}

function variantInlineStyle(variant: ButtonVariant): React.CSSProperties {
  // 핑크/빨강은 인라인 style로 — 다크 토큰과 무관하게 고정 색 유지
  switch (variant) {
    case 'primary':
      return { background: 'var(--brand)', boxShadow: 'var(--shadow-brand)' };
    case 'danger':
      return { background: 'var(--live)', boxShadow: '0 2px 12px rgba(229,62,62,0.20)' };
    default:
      return {};
  }
}

function sizeClasses(size: ButtonSize): string {
  switch (size) {
    case 'sm':
      return 'h-9 px-3 text-[13px] rounded-xl';
    case 'lg':
      return 'h-14 px-6 text-[15px] rounded-2xl';
    case 'md':
    default:
      return 'h-12 px-5 text-[14px] rounded-xl';
  }
}

const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    block = false,
    loading = false,
    iconLeft,
    iconRight,
    disabled,
    className = '',
    children,
    type = 'button',
    style,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const cls = [
    'inline-flex items-center justify-center gap-2',
    'transition-all duration-75 active:scale-[0.985]',
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
    sizeClasses(size),
    variantClasses(variant),
    block ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      style={{ ...variantInlineStyle(variant), ...style }}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span
          className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-r-transparent animate-spin"
          aria-hidden="true"
        />
      )}
      {!loading && iconLeft}
      <span>{children}</span>
      {!loading && iconRight}
    </button>
  );
});

export default Button;
