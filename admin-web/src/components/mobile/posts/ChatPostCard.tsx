'use client';

/**
 * ChatPostCard — /m/posts 채팅방 페이지의 매장 카드.
 *
 * 디자인 결정 (2026-05-26, PM 단독 — 3차 정정 · 핸드오프 v3.1):
 *  - claude-design/login-handoff/pimk-rabbit/project/screens-user.jsx
 *    ScreenPosts(화면 3 채팅방) 시그니처 100% 매칭.
 *  - 구조: [아바타] · [매장명/거리 메타 + 말풍선] · [시간 라벨]
 *      말풍선 좌측 외부에 36px 원형 아바타(매장 컬러 bg/border + 이모지).
 *      말풍선 위에 매장명 · 메타가 한 줄로 inline (작은 글씨).
 *      말풍선 우측 외부에 상대 시각 + HH:MM mono.
 *  - 말풍선 라운드: 14/14/14/4 (좌측 아래 꼬리). 이전 좌측 accent border 폐기.
 *  - 같은 매장 연속 행은 아바타 자리만 placeholder (page.tsx 그룹핑에서 결정).
 *  - 본문(상세) clamp 5줄 + 더보기, 세로 포스터 폭 60% maxH 60vh contain (기존 유지).
 *  - 이미지 다중일 때 첫 장만 + 우측 하단 "+N" 배지, 클릭 시 라이트박스 (기존 유지).
 *  - 카드 전체 클릭 → 매장 상세. 이미지/더보기/태그 클릭은 stopPropagation.
 *
 * 정책:
 *  - 사용자 앱 상금 노출 금지: prizeOverride 등 미사용. tags만 (eventTags).
 *  - 카톡 톤 일관성: animation pr-chat-fadein, mono 시간, 매장 컬러 surface.
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
  /** 같은 매장이 직전 행에 있어 아바타를 placeholder로 처리할지 여부 (page.tsx에서 결정) */
  groupedWithPrev?: boolean;
  onImageClick?: (url: string, allUrls: string[]) => void;
}

const BODY_CLAMP_LINES = 5;

export default function ChatPostCard({
  post,
  distanceMeters,
  now,
  groupedWithPrev = false,
  onImageClick,
}: Props) {
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

  const bodyText = useMemo(() => {
    const b = (post.body || '').trim();
    if (!b) return '';
    const firstLine = b.split('\n')[0]?.trim() ?? '';
    if (firstLine === headline && b === firstLine) return '';
    return b;
  }, [post.body, headline]);

  const [bodyExpanded, setBodyExpanded] = useState(false);

  const images = post.imageUrls ?? [];
  const firstImage = images[0];
  const extraCount = Math.max(0, images.length - 1);
  const tags = post.eventTags ?? [];

  // 매장명 표시값 (메타 행에서 사용)
  const storeName = post.storeName || '매장';
  // 아바타 표시 이모지 — 카드 이모지 1순위, fallback은 매장 컬러 defaultEmoji
  const avatarEmoji = emojis[0] || '🃏';

  const handleCardClick = () => {
    router.push(`/m/store/${post.storeId}`);
  };

  return (
    <div className={'pr-chat-row' + (groupedWithPrev ? ' pr-chat-row-grouped' : '')}>
      {/* 좌측 아바타 (or placeholder for grouped) */}
      {groupedWithPrev ? (
        <div className="pr-chat-avatar-spacer" aria-hidden />
      ) : (
        <div
          className="pr-chat-avatar"
          style={{ background: style.surface, borderColor: style.border }}
          aria-hidden
        >
          {avatarEmoji}
        </div>
      )}

      {/* 본문 (메타 + 말풍선) */}
      <div className="min-w-0 flex-1">
        {/* 메타 — 같은 매장 연속 시 생략 (카톡 패턴) */}
        {!groupedWithPrev && (
          <div className="pr-chat-meta">
            <span className="pr-chat-meta-store" style={{ color: 'var(--text-1)' }}>
              {storeName}
            </span>
            {typeof distanceMeters === 'number' && (
              <span className="pr-chat-meta-info">· {formatDistance(distanceMeters)}</span>
            )}
            {relative && <span className="pr-chat-meta-info">· {relative}</span>}
          </div>
        )}

        {/* 말풍선 */}
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
          className="pr-chat-bubble tap cursor-pointer"
          style={{
            background: style.surface,
            borderColor: style.border,
            maxWidth: '100%',
          }}
          aria-label={`${storeName} 소식 보기`}
        >
          {/* 헤드라인 (강조) */}
          <div style={{ padding: '10px 12px 4px' }}>
            {headline && (
              <div
                className="text-[14px] font-bold leading-snug"
                style={{
                  color: style.textPrimary,
                  letterSpacing: '-0.015em',
                  wordBreak: 'break-word',
                }}
              >
                {headline}
              </div>
            )}

            {/* 본문 (상세) */}
            {bodyText && (
              <div
                className="text-[12.5px] mt-1.5"
                style={{
                  color: style.textSecondary,
                  lineHeight: 1.5,
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
                className="text-[11px] font-semibold mt-1 active:opacity-60"
                style={{ color: style.accent }}
                aria-expanded={bodyExpanded}
              >
                {bodyExpanded ? '접기' : '더보기'}
              </button>
            )}

            {/* 이벤트 태그 */}
            {tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {tags.slice(0, 6).map((tag, i) => (
                  <span
                    key={`${tag}_${i}`}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{
                      background: 'rgba(255,255,255,0.7)',
                      color: '#111827',
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 세로 포스터 이미지 — 폭 60% 가운데, 원본 비율 유지 */}
          {firstImage && (
            <div style={{ padding: '0 12px 10px' }} className="flex justify-center">
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
        </div>
      </div>

      {/* 시간 라벨 (말풍선 우측 외부) — 카톡 룩 */}
      <div className="pr-chat-time" aria-hidden>
        {hhmm && <span className="pr-chat-time-hhmm">{hhmm}</span>}
      </div>
    </div>
  );
}

/**
 * 본문이 clamp 줄수를 넘는지 휴리스틱으로 판정 — 정확한 측정은 layout 이후에야 가능.
 */
function needsClamp(text: string, lines: number): boolean {
  if (!text) return false;
  const newlines = (text.match(/\n/g) || []).length;
  if (newlines >= lines) return true;
  const approxCharsPerLine = 20;
  return text.length > approxCharsPerLine * lines;
}
