/**
 * postCardStyle — Daily Post 카드 색상/이모지 매핑 (Phase F, 2026-05-22).
 *
 * 정책:
 *  - 매장 어드민이 작성 시 선택한 cardColor에 따라 카드 표면 색을 결정.
 *  - cardEmoji가 비어있으면 cardColor 기본 이모지 적용 (시각 다양화).
 *  - 톤은 라이트(파스텔)와 다크(브랜드 컬러) 두 톤 보유. 홈 캐러셀=다크 라벨, find=라이트 surface.
 *  - 모든 색상은 var(--bg) 대비 충분한 가독성을 위해 텍스트 색을 동시 반환.
 */

import type { PostCardColor } from './posts';

export interface CardStyle {
  /** 카드 surface 그라데이션 또는 단색 (배경) */
  surface: string;
  /** 표면 위 텍스트 1차 (헤드라인) */
  textPrimary: string;
  /** 표면 위 텍스트 2차 (매장명/메타) */
  textSecondary: string;
  /** 좌측 라벨/배지 색 (강조용) */
  accent: string;
  /** 액센트 라벨의 텍스트 색 */
  accentText: string;
  /** 카드 보더 색 */
  border: string;
  /** 색상 미지정 시의 기본 이모지 (cardEmoji 없을 때 fallback) */
  defaultEmoji: string;
  /** 색상별 라벨 한국어 — 작성 폼 칩에서 사용 */
  label: string;
}

export const CARD_STYLES: Record<PostCardColor, CardStyle> = {
  white: {
    surface: 'var(--surface-1)',
    textPrimary: 'var(--text-1)',
    textSecondary: 'var(--text-2)',
    accent: 'var(--text-3)',
    accentText: '#fff',
    border: 'var(--border)',
    defaultEmoji: '',
    label: '기본',
  },
  pink: {
    surface: 'linear-gradient(135deg, #FFE3F1 0%, #FFF1F8 100%)',
    textPrimary: '#80003C',
    textSecondary: '#A8326F',
    accent: '#FF1F8F',
    accentText: '#fff',
    border: '#FFC1DE',
    defaultEmoji: '🎉',
    label: '이벤트',
  },
  green: {
    surface: 'linear-gradient(135deg, #D6F4E2 0%, #EBFAF1 100%)',
    textPrimary: '#0D4A2E',
    textSecondary: '#2E7A55',
    accent: '#10A05F',
    accentText: '#fff',
    border: '#A8E6C3',
    defaultEmoji: '🃏',
    label: '정기 토너',
  },
  gold: {
    surface: 'linear-gradient(135deg, #FFE9B0 0%, #FFF5D6 100%)',
    textPrimary: '#5B3D00',
    textSecondary: '#8A6300',
    accent: '#D49100',
    accentText: '#fff',
    border: '#F0CC5C',
    defaultEmoji: '💎',
    label: '프리미엄',
  },
  navy: {
    surface: 'linear-gradient(135deg, #1F2A4D 0%, #2D3A66 100%)',
    textPrimary: '#FFFFFF',
    textSecondary: '#C3CCEA',
    accent: '#FFD84D',
    accentText: '#1F2A4D',
    border: '#3D4A7A',
    defaultEmoji: '📢',
    label: '공지',
  },
  red: {
    surface: 'linear-gradient(135deg, #FFD9D9 0%, #FFECEC 100%)',
    textPrimary: '#7A0000',
    textSecondary: '#A83232',
    accent: '#E03030',
    accentText: '#fff',
    border: '#F0A8A8',
    defaultEmoji: '🔥',
    label: '긴급',
  },
  // ── 확장 3색 (2026-05-22) ──────────────────────────────────
  purple: {
    surface: 'linear-gradient(135deg, #ECDDFF 0%, #F7EEFF 100%)',
    textPrimary: '#3B1466',
    textSecondary: '#6B3FA0',
    accent: '#8B3FE0',
    accentText: '#fff',
    border: '#D4B8F4',
    defaultEmoji: '🃏',
    label: '라운지',
  },
  cyan: {
    surface: 'linear-gradient(135deg, #CFEFF5 0%, #E6F8FB 100%)',
    textPrimary: '#003F4D',
    textSecondary: '#1F6D7A',
    accent: '#0FA0B8',
    accentText: '#fff',
    border: '#9DDDE8',
    defaultEmoji: '✨',
    label: '오픈/청량',
  },
  orange: {
    surface: 'linear-gradient(135deg, #FFD9B0 0%, #FFE9CC 100%)',
    textPrimary: '#5A2B00',
    textSecondary: '#8C4F1A',
    accent: '#FF7A1A',
    accentText: '#fff',
    border: '#F4B97A',
    defaultEmoji: '⚡',
    label: '주말/활기',
  },
};

/**
 * post로부터 적용할 스타일 + 표시할 이모지 결정.
 *
 * - cardEmojis(배열, 신규) 우선 → cardEmoji(단일, 레거시) → 색상 기본 이모지 순.
 * - 단일/다중 양쪽을 한 번에 처리하므로 호출부는 emojis[]만 보면 됩니다.
 * - 비어있으면 emojis=[fallback] 1개를 반환해서 카드 비주얼 깨짐 방지.
 */
export function resolveCardVisual(post: {
  cardColor?: PostCardColor;
  cardEmoji?: string;
  cardEmojis?: string[];
}): { style: CardStyle; emoji: string; emojis: string[] } {
  const color: PostCardColor = (post.cardColor && CARD_STYLES[post.cardColor]) ? post.cardColor : 'white';
  const style = CARD_STYLES[color];

  const list: string[] = [];
  if (Array.isArray(post.cardEmojis)) {
    for (const e of post.cardEmojis) {
      if (typeof e === 'string' && e.trim()) list.push(e);
    }
  }
  if (list.length === 0 && post.cardEmoji && post.cardEmoji.trim()) {
    list.push(post.cardEmoji);
  }
  const emojis = list.length > 0 ? list : (style.defaultEmoji ? [style.defaultEmoji] : []);
  const emoji = emojis[0] ?? '';
  return { style, emoji, emojis };
}
