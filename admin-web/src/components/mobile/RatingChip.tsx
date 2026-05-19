'use client';

import { formatRating } from '@/lib/reviews';

/**
 * 매장 카드용 별점 칩 — 배민/카카오맵 스타일.
 * 리뷰 0개면 아무것도 렌더링하지 않는다 (호출부에서 분기할 필요 없음).
 *
 * Usage:
 *   <RatingChip rating={store.averageRating} count={store.reviewCount} />
 *   <RatingChip rating={r} count={c} size="sm" />          // 작게
 *   <RatingChip rating={r} count={c} variant="overlay" />  // 사진 위 (어두운 배경)
 */
export function RatingChip({
  rating,
  count,
  size = 'md',
  variant = 'default',
}: {
  rating?: number;
  count?: number;
  size?: 'sm' | 'md';
  variant?: 'default' | 'overlay';
}) {
  if (!count || count <= 0) return null;

  const fontSize = size === 'sm' ? 11 : 12;
  const gap = size === 'sm' ? 3 : 4;
  const starSize = size === 'sm' ? 11 : 12;

  if (variant === 'overlay') {
    return (
      <span
        className="inline-flex items-center font-bold rounded-full"
        style={{
          fontSize,
          gap,
          padding: size === 'sm' ? '2px 6px' : '3px 8px',
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      >
        <span aria-hidden="true" style={{ color: '#FFC83D', fontSize: starSize, lineHeight: 1 }}>★</span>
        <span className="font-mono">{formatRating(rating ?? 0)}</span>
        <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
          ({count.toLocaleString()})
        </span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center font-bold"
      style={{ fontSize, gap, color: 'var(--text-2)' }}
    >
      <span aria-hidden="true" style={{ color: '#FFC83D', fontSize: starSize, lineHeight: 1 }}>★</span>
      <span className="font-mono" style={{ color: 'var(--text-1)' }}>{formatRating(rating ?? 0)}</span>
      <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>
        ({count.toLocaleString()})
      </span>
    </span>
  );
}
