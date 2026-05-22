'use client';

/**
 * ChatPostCard — /m/posts 채팅방 페이지의 매장 카드.
 *
 * 디자인 결정 (2026-05-22, PM 단독 — 2차 정정):
 *  - 매장 사장은 카톡방에 세로형 포스터(2:3, 3:4, 9:16)를 자주 올린다.
 *    이전 16:9 cover 렌더링은 포스터를 잘라먹어 정보 손실.
 *  - 카드 구조: 헤더(매장+거리+상대시각) → 헤드라인(강조) → 본문(상세, clamp 5줄+더보기)
 *    → 이미지(원본비율, 폭 60% 가운데) → 태그(eventTags).
 *  - 이미지는 object-fit: contain + 원본 비율 유지로 세로 포스터 잘림 방지.
 *  - 다중 이미지는 첫 장만 노출 + 우측 하단 "+N" 배지, 클릭 시 라이트박스에서 전체 스와이프.
 *  - 헤드라인/본문은 카드 표면(말풍선) 안에서 카톡 톤 유지 — 좌측 액센트 보더 + cardColor surface.
 *  - 본문이 비면 헤드라인만, 이미지가 없으면 텍스트만으로 가볍게 동작.
 *  - 카드 전체 클릭 → 매장 상세. 이미지 클릭 → 라이트박스. "더보기"/태그 클릭은 stopPropagation.
 *
 * 정정 사유 (사용자 피드백 2026-05-22):
 *  - "세로형 포스터를 축소해서 올려주되 터치하면 확대된내용도 볼수있어야"
 *  - "상세본문과 카드노출 한줄도 보여야해"
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StorePost } from '@/lib/posts';
import { resolveCardVisual } from '@/lib/postCardStyle';
import { formatRelativeKo } from '@/lib/relativeTime';
import { formatDistance } from '@/lib/geo';

interface Props {
  post: StorePost;
  distanceMeters?: number;
  now: number;
  onImageClick?: (url: string, allUrls: string[]) => void;
}

const BODY_CLAMP_LINES = 5;

export default function ChatPostCard({ post, distanceMeters, now, onImageClick }: Props) {
  const router = useRouter();
  const { style, emojis } = useMemo(() => resolveCardVisual(post), [post]);
  const relative = useMemo(() => formatRelativeKo(post.createdAt, now), [post.createdAt, now]);
  const hhmm = useMemo(() => {
    const ms = post.createdAt?.toMillis?.();
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [post.createdAt]);

  const headline = useMemo(() => {
    const head = (post.headline ?? '').trim();
    if (head) return head;
    const firstLine = (post.body || '').split('\n')[0]?.trim() ?? '';
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
  }, [post.headline, post.body]);

  // 본문은 헤드라인과 같으면 중복 노출하지 않는다 (헤드라인이 body 첫 줄 fallback인 경우).
  const bodyText = useMemo(() => {
    const b = (post.body || '').trim();
    if (!b) return '';
    // 헤드라인이 body 첫 줄과 동일하고 본문이 한 줄짜리면 중복 → 본문 생략
    const firstLine = b.split('\n')[0]?.trim() ?? '';
    if (firstLine === headline && b === firstLine) return '';
    return b;
  }, [post.body, headline]);

  const [bodyExpanded, setBodyExpanded] = useState(false);

  const images = post.imageUrls ?? [];
  const firstImage = images[0];
  const extraCount = Math.max(0, images.length - 1);
  const tags = post.eventTags ?? [];

  const handleCardClick = () => {
    router.push(`/m/store/${post.storeId}`);
  };

  return (
    <div
      className="flex items-end gap-1.5 mb-2.5"
      style={{
        maxWidth: '85%',
        animation: 'm-posts-fadein 240ms ease-out',
      }}
    >
      {/* 말풍선 본체 */}
      <div className="min-w-0 flex-1">
        <div
          role="button"
          tabIndex={0}
          onClick={handleCardClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCardClick();
            }
          }}
          className="block rounded-2xl transition active:opacity-75 cursor-pointer"
          style={{
            background: style.surface,
            border: `1px solid ${style.border}`,
            borderLeft: `3px solid ${style.accent}`,
            padding: '10px 12px 10px',
            borderTopLeftRadius: '6px', // 말풍선 꼬리 효과
          }}
          aria-label={`${post.storeName ?? '매장'} 소식 보기`}
        >
          {/* 상단: 매장명 + 거리 + 이모지 */}
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <div
              className="text-[11.5px] font-extrabold truncate"
              style={{ color: style.textPrimary, maxWidth: '180px' }}
            >
              {post.storeName || '매장'}
            </div>
            {typeof distanceMeters === 'number' && (
              <div
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{
                  background: 'rgba(0,0,0,0.06)',
                  color: style.textSecondary,
                }}
              >
                📍 {formatDistance(distanceMeters)}
              </div>
            )}
            {emojis.length > 0 && (
              <div className="flex items-center gap-0.5 ml-auto" aria-hidden>
                {emojis.slice(0, 3).map((e, i) => (
                  <span key={`${e}_${i}`} style={{ fontSize: 14, lineHeight: 1 }}>{e}</span>
                ))}
              </div>
            )}
          </div>

          {/* 헤드라인 (강조) */}
          {headline && (
            <div
              className="text-[15px] font-bold leading-snug"
              style={{ color: style.textPrimary, wordBreak: 'break-word' }}
            >
              {headline}
            </div>
          )}

          {/* 본문 (상세) */}
          {bodyText && (
            <div
              className="text-[13px] leading-relaxed mt-1.5"
              style={{
                color: style.textSecondary,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                ...(bodyExpanded
                  ? {}
                  : {
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: BODY_CLAMP_LINES,
                      overflow: 'hidden',
                    }),
              }}
            >
              {bodyText}
            </div>
          )}
          {bodyText && needsClamp(bodyText, BODY_CLAMP_LINES) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setBodyExpanded((v) => !v);
              }}
              className="text-[11.5px] font-semibold mt-1 active:opacity-60"
              style={{ color: style.accent }}
              aria-expanded={bodyExpanded}
            >
              {bodyExpanded ? '접기' : '더보기'}
            </button>
          )}

          {/* 세로 포스터 이미지 — 폭 60% 가운데, 원본 비율 유지 */}
          {firstImage && (
            <div className="mt-2.5 flex justify-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onImageClick) onImageClick(firstImage, images);
                }}
                className="relative block rounded-xl overflow-hidden active:opacity-85 transition"
                style={{
                  width: '60%',
                  maxWidth: 240,
                  minWidth: 160,
                  background: 'rgba(0,0,0,0.06)',
                  // 비율은 이미지가 결정 — 컨테이너는 width만 고정, 높이는 auto
                }}
                aria-label="이미지 확대"
              >
                <img
                  src={firstImage}
                  alt={post.headline || '첨부 이미지'}
                  loading="lazy"
                  decoding="async"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    maxHeight: '60vh',
                    objectFit: 'contain',
                  }}
                />
                {extraCount > 0 && (
                  <div
                    className="absolute bottom-1.5 right-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: 'rgba(0,0,0,0.65)',
                      color: '#fff',
                      backdropFilter: 'blur(2px)',
                    }}
                  >
                    +{extraCount}
                  </div>
                )}
              </button>
            </div>
          )}

          {/* 이벤트 태그 */}
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.slice(0, 6).map((tag, i) => (
                <span
                  key={`${tag}_${i}`}
                  className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    background: 'rgba(0,0,0,0.05)',
                    color: style.textSecondary,
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 시간 라벨 (말풍선 우측 외부) — 카톡 룩 */}
      <div className="flex flex-col items-start text-[9.5px] pb-1 flex-shrink-0" style={{ color: 'var(--text-3)' }}>
        {relative && <span className="font-semibold">{relative}</span>}
        {hhmm && <span style={{ opacity: 0.7 }}>{hhmm}</span>}
      </div>
    </div>
  );
}

/**
 * 본문이 clamp 줄수를 넘는지 휴리스틱으로 판정.
 * - 줄바꿈 수 또는 평균 글자 폭 기반 추정 (정확한 측정은 layout 후에야 가능하므로 근사).
 * - 보수적으로 판정해서 짧은 글에는 "더보기" 안 띄움.
 */
function needsClamp(text: string, lines: number): boolean {
  if (!text) return false;
  const newlines = (text.match(/\n/g) || []).length;
  if (newlines >= lines) return true;
  // 모바일 카드 가로폭 ~270px, 13px 한글 한 줄 ~20자 가정
  const approxCharsPerLine = 20;
  return text.length > approxCharsPerLine * lines;
}
