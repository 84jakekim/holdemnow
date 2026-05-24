/**
 * Card — 디자인 시스템 v1 카탈로그 카드
 *
 * 2026-05-25 일관성 정리. 5 variant.
 * 기존 컴포넌트(PrimaryLiveCard / ChatPostCard / SlimPostCard / SideStatCard 등)는
 * 별도 시그니처 디자인을 가지므로 마이그레이션하지 않음. 본 Card는 **신규** 카드 작성 시 사용.
 *
 *  · base    — `.card` 기본 (var(--surface-1) + var(--border) + shadow-card + r-lg)
 *  · float   — 부유 카드 (shadow-float, 더 강한 그림자, 모달 안 미니카드 등)
 *  · brand   — 핫핑크 액센트 카드 (border-l-4 brand, 강조 알림용)
 *  · live    — LIVE 빨강 액센트 (border-l-4 live + pulse 글로우 옵션)
 *  · ghost   — 외곽선만, 배경 투명 (선택지 카드 등)
 *
 * Props:
 *  · variant: 위 5종 중 하나 (기본 'base')
 *  · interactive: true면 hover/active 효과 (.card-hover 동일)
 *  · as: 'div' (기본) | 'button' | 'a' — semantic 분기
 *  · padded: 기본 padding 적용 (기본 true)
 */

import { forwardRef, type ElementType, type ComponentPropsWithoutRef, type ReactNode } from 'react';

type CardVariant = 'base' | 'float' | 'brand' | 'live' | 'ghost';

type CardProps<E extends ElementType = 'div'> = {
  as?: E;
  variant?: CardVariant;
  interactive?: boolean;
  padded?: boolean;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<E>, 'as' | 'children'>;

function variantClasses(variant: CardVariant): string {
  switch (variant) {
    case 'float':
      return 'bg-[var(--surface-1)] border border-[var(--border)] shadow-[var(--shadow-float)]';
    case 'brand':
      return 'bg-[var(--surface-1)] border border-[var(--border)] shadow-[var(--shadow-card)] border-l-4 border-l-[var(--brand)]';
    case 'live':
      return 'bg-[var(--surface-1)] border border-[var(--border)] shadow-[var(--shadow-card)] border-l-4 border-l-[var(--live)]';
    case 'ghost':
      return 'bg-transparent border border-[var(--border)]';
    case 'base':
    default:
      return 'bg-[var(--surface-1)] border border-[var(--border)] shadow-[var(--shadow-card)]';
  }
}

const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { as, variant = 'base', interactive = false, padded = true, className = '', children, ...rest },
  ref,
) {
  const Tag = (as ?? 'div') as ElementType;
  const cls = [
    'rounded-[var(--r-lg)]',
    variantClasses(variant),
    padded ? 'px-4 py-4' : '',
    interactive ? 'transition-transform duration-75 active:scale-[0.985] cursor-pointer' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} className={cls} {...(rest as any)}>
      {children}
    </Tag>
  );
});

export default Card;
