'use client';

/**
 * ChatPostCard — /m/posts 채팅방 페이지의 매장 카드 (말풍선 톤).
 *
 * 디자인 결정 (2026-05-22, PM 단독):
 *  - 카카오톡 오픈채팅 말풍선처럼 좌측 정렬, 폭 85%.
 *  - 매장 이름 + 거리 메타 한 줄(상단), 헤드라인(가운데), 인라인 이미지(있을 때),
 *    하단에 상대시각 + HH:MM 절대시각 (1분 ticking).
 *  - cardColor 톤은 말풍선 surface로 적용. 액센트가 강한 색은 좌측 보더 띠로.
 *  - 카드 전체 클릭 시 매장 상세 페이지로 이동.
 *  - 이미지 클릭 시 라이트박스 (page에서 처리).
 */

import { useMemo } from 'react';
import Link from 'next/link';
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

export default function ChatPostCard({ post, distanceMeters, now, onImageClick }: Props) {
  const { style, emojis } = useMemo(() => resolveCardVisual(post), [post]);
  const relative = useMemo(() => formatRelativeKo(post.createdAt, now), [post.createdAt, now]);
  const hhmm = useMemo(() => {
    const ms = post.createdAt?.toMillis?.();
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [post.createdAt]);

  const oneLiner = useMemo(() => {
    const head = (post.headline ?? '').trim();
    if (head) return head;
    const firstLine = (post.body || '').split('\n')[0]?.trim() ?? '';
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
  }, [post.headline, post.body]);

  const images = post.imageUrls ?? [];

  return (
    <div className="flex items-end gap-1.5 mb-2.5" style={{ maxWidth: '85%' }}>
      {/* 말풍선 본체 */}
      <div className="min-w-0 flex-1">
        <Link
          href={`/m/store/${post.storeId}`}
          className="block rounded-2xl transition active:opacity-75"
          style={{
            background: style.surface,
            border: `1px solid ${style.border}`,
            borderLeft: `3px solid ${style.accent}`,
            padding: '10px 12px 8px',
            borderTopLeftRadius: '6px', // 말풍선 꼬리 효과
          }}
          aria-label={`${post.storeName ?? '매장'} 소식 보기`}
        >
          {/* 상단: 매장명 + 거리 */}
          <div className="flex items-center gap-1.5 mb-1.5">
            <div
              className="text-[11px] font-extrabold truncate"
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
          </div>

          {/* 헤드라인 + 이모지 액센트 */}
          <div className="flex items-start gap-1.5">
            {emojis.length > 0 && (
              <div className="flex-shrink-0 flex flex-wrap gap-0.5 mt-0.5" aria-hidden>
                {emojis.slice(0, 3).map((e, i) => (
                  <span key={`${e}_${i}`} style={{ fontSize: 14 }}>{e}</span>
                ))}
              </div>
            )}
            <div
              className="text-[13px] font-bold leading-snug flex-1"
              style={{ color: style.textPrimary }}
            >
              {oneLiner || '오늘의 매장 소식'}
            </div>
          </div>

          {/* 인라인 이미지 — 1장 16:9, 2~4장 그리드 */}
          {images.length > 0 && (
            <div
              className="mt-2 rounded-lg overflow-hidden"
              style={{ background: 'rgba(0,0,0,0.04)' }}
              onClickCapture={(e) => {
                // Link 진입 차단 — 이미지 클릭은 라이트박스로
                const t = e.target as HTMLElement;
                if (t.tagName === 'IMG' && onImageClick) {
                  e.preventDefault();
                  e.stopPropagation();
                  const url = t.getAttribute('data-url') ?? '';
                  if (url) onImageClick(url, images);
                }
              }}
            >
              {images.length === 1 && (
                <img
                  src={images[0]}
                  data-url={images[0]}
                  alt="첨부 이미지"
                  className="w-full block"
                  style={{ aspectRatio: '16/9', objectFit: 'cover', cursor: 'zoom-in' }}
                />
              )}
              {images.length > 1 && (
                <div
                  className="grid gap-0.5"
                  style={{
                    gridTemplateColumns: images.length === 2 ? '1fr 1fr' : 'repeat(2, 1fr)',
                    gridAutoRows: '1fr',
                  }}
                >
                  {images.slice(0, 4).map((url, i) => (
                    <img
                      key={`${url}_${i}`}
                      src={url}
                      data-url={url}
                      alt={`첨부 이미지 ${i + 1}`}
                      className="block w-full"
                      style={{ aspectRatio: '1/1', objectFit: 'cover', cursor: 'zoom-in' }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </Link>
      </div>

      {/* 시간 라벨 (말풍선 우측 외부) — 카톡 룩 */}
      <div className="flex flex-col items-start text-[9.5px] pb-1 flex-shrink-0" style={{ color: 'var(--text-3)' }}>
        {relative && <span className="font-semibold">{relative}</span>}
        {hhmm && <span style={{ opacity: 0.7 }}>{hhmm}</span>}
      </div>
    </div>
  );
}
