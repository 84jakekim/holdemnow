'use client';

/**
 * DailyPostsCarousel — 홈 최상단의 "오늘의 매장 소식" 1.5장 peek 슬라이더.
 *
 * Phase F (2026-05-22) — 가독성 우선 리디자인:
 *  - headline 노출(없으면 body 첫 줄 fallback). cardColor/cardEmoji 시각 다양화.
 *  - 자동 슬라이드 정책: **첫 진입 3장만 8초 hold 자동 페이드 → 정지**.
 *    "휙휙 날라다녀서 정신없음" 사용자 호소 정확 반영. 이후엔 사용자 스와이프만.
 *  - 카드 우측 하단 "5분 전" 상대 시각 (60초 ticking).
 *  - 색상 톤(pink/green/gold/navy/red/white) + 좌측 이모지 액센트.
 *
 * 데이터:
 *  - loadActivePostsAll: collectionGroup('posts'), 최신 50건 fetch
 *  - subscribeActivePinnedPosts: 본사 pinned 실시간 구독 (priority desc)
 *
 * 정책:
 *  - Firestore SDK 직접 호출 — 클라이언트 사이드.
 *  - 카카오 SDK 호출 0회.
 *  - tap=opacity feedback, hover effect 없음 (모바일 우선).
 */

import { useEffect, useMemo, useState, useRef } from 'react';
import Link from 'next/link';
import {
  loadActivePostsAll,
  subscribeActivePinnedPosts,
  type StorePost,
  type PinnedPost,
} from '@/lib/posts';
import { resolveCardVisual } from '@/lib/postCardStyle';
import { formatRelativeKo, useTickingNow } from '@/lib/relativeTime';

const MAX_POSTS = 8;
const AUTO_HOLD_MS = 8000;        // 카드 한 장 노출 유지 시간 (8초)
const AUTO_ROUNDS = 3;            // 자동 전환 횟수 — 3장 후 정지

export default function DailyPostsCarousel() {
  const [posts, setPosts] = useState<StorePost[]>([]);
  const [pinned, setPinned] = useState<PinnedPost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [autoDone, setAutoDone] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const userInteractedRef = useRef(false);

  // posts fetch
  useEffect(() => {
    let cancelled = false;
    loadActivePostsAll()
      .then((items) => {
        if (cancelled) return;
        setPosts(items.slice(0, MAX_POSTS));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  // pinned subscribe
  useEffect(() => {
    return subscribeActivePinnedPosts(setPinned, () => {});
  }, []);

  // 자동 슬라이드 — 첫 3장만 진행 후 정지.
  useEffect(() => {
    if (posts.length <= 1 || autoDone) return;
    const id = window.setInterval(() => {
      // 사용자가 스크롤로 개입하면 자동 진행 중단
      if (userInteractedRef.current) {
        setAutoDone(true);
        return;
      }
      setActiveIdx((i) => {
        const next = i + 1;
        // AUTO_ROUNDS 만큼 진행했으면 정지 (마지막 표시 카드에서 멈춤)
        if (next >= Math.min(AUTO_ROUNDS, posts.length)) {
          setAutoDone(true);
          return next % posts.length;
        }
        return next % posts.length;
      });
    }, AUTO_HOLD_MS);
    return () => window.clearInterval(id);
  }, [posts.length, autoDone]);

  // activeIdx 변경 시 스크롤 동기화 (자동 진행 중일 때만)
  useEffect(() => {
    if (autoDone || userInteractedRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.children[activeIdx] as HTMLElement | undefined;
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }, [activeIdx, autoDone]);

  // 사용자 스크롤/터치 감지 → 자동 진행 중단
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onUserScroll = () => {
      userInteractedRef.current = true;
      setAutoDone(true);
    };
    el.addEventListener('touchstart', onUserScroll, { passive: true });
    el.addEventListener('wheel', onUserScroll, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onUserScroll);
      el.removeEventListener('wheel', onUserScroll);
    };
  }, [loaded]);

  // 빈 상태: 섹션 자체 렌더하지 않음 (홈 가벼움)
  if (loaded && posts.length === 0 && pinned.length === 0) return null;

  return (
    <section aria-label="오늘의 매장 소식" className="pt-4 pb-1">
      {/* 본사 pinned stripe — 1줄 띠 (있을 때만) */}
      {pinned.length > 0 && (
        <div className="px-4 mb-2">
          <PinnedStripe item={pinned[0]} />
        </div>
      )}

      {/* 섹션 헤더 — TOSS 톤 */}
      <div className="px-4 mb-2.5 flex items-baseline justify-between">
        <h2 className="text-[16px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          오늘의 매장 소식
        </h2>
        {posts.length > 0 && (
          <Link
            href="/m/find#daily-posts"
            className="text-[12px] font-semibold transition active:opacity-60"
            style={{ color: 'var(--text-3)' }}
          >
            전체보기
          </Link>
        )}
      </div>

      {/* 1.5장 peek 가로 슬라이더 */}
      {posts.length > 0 && (
        <div className="relative">
          <div
            ref={scrollerRef}
            className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory"
            style={{
              scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {posts.map((p, idx) => (
              <PostCard key={p.id} post={p} active={idx === activeIdx && !autoDone} />
            ))}
            {/* 1.5장 peek을 위한 우측 공간 — 마지막 카드 우측 50% 노출 보장 */}
            <div style={{ minWidth: '12px', flexShrink: 0 }} aria-hidden />
          </div>
          {/* 우측 fade — 더 있다는 신호 */}
          <div
            className="absolute right-0 top-0 bottom-2 w-10 pointer-events-none"
            style={{
              background: 'linear-gradient(to left, var(--bg) 0%, transparent 100%)',
            }}
            aria-hidden
          />
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 카드 — headline + 이모지 액센트 + 매장명 + 상대시각
// ─────────────────────────────────────────────────────────────

function PostCard({ post, active }: { post: StorePost; active: boolean }) {
  const { style, emoji } = useMemo(() => resolveCardVisual(post), [post]);
  const now = useTickingNow();
  const relative = useMemo(() => formatRelativeKo(post.createdAt, now), [post.createdAt, now]);

  // headline 우선, 없으면 body 첫 줄 fallback (백워드 호환)
  const oneLiner = useMemo(() => {
    const head = (post.headline ?? '').trim();
    if (head) return head;
    const firstLine = (post.body || '').split('\n')[0]?.trim() ?? '';
    return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
  }, [post.headline, post.body]);

  return (
    <Link
      href={`/m/store/${post.storeId}`}
      className="snap-start flex-shrink-0 rounded-2xl transition active:opacity-70"
      style={{
        width: 'calc(66vw)',
        maxWidth: '280px',
        minWidth: '220px',
        background: style.surface,
        border: active ? `1.5px solid ${style.accent}` : `1px solid ${style.border}`,
        padding: '14px 14px 12px',
        opacity: active ? 1 : 0.88,
        boxShadow: active ? `0 4px 14px -8px ${style.accent}` : 'none',
      }}
      aria-label={`${post.storeName ?? '매장'} 소식 보기`}
    >
      {/* 상단: 이모지 액센트 + 헤드라인 */}
      <div className="flex items-start gap-2 mb-2.5">
        {emoji && (
          <div
            className="flex-shrink-0 flex items-center justify-center rounded-lg"
            style={{
              width: '28px',
              height: '28px',
              background: style.accent,
              fontSize: '15px',
            }}
            aria-hidden
          >
            <span style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.15))' }}>{emoji}</span>
          </div>
        )}
        <div
          className="text-[14px] font-extrabold leading-[1.4] flex-1"
          style={{
            color: style.textPrimary,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '40px',
          }}
        >
          {oneLiner || '오늘의 매장 소식'}
        </div>
      </div>
      {/* 하단: 매장명 + 상대시각 */}
      <div
        className="pt-2 mt-1 flex items-center justify-between gap-1.5"
        style={{ borderTop: `1px solid ${style.border}` }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: style.textSecondary, flexShrink: 0 }}
            aria-hidden
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <div className="text-[11px] font-semibold truncate" style={{ color: style.textSecondary }}>
            {post.storeName || '매장'}
          </div>
        </div>
        {relative && (
          <div className="text-[10px] font-medium flex-shrink-0" style={{ color: style.textSecondary, opacity: 0.85 }}>
            {relative}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────
// 본사 pinned stripe — 1줄 띠 (priority 가장 높은 1개만)
// ─────────────────────────────────────────────────────────────

function PinnedStripe({ item }: { item: PinnedPost }) {
  const inner = (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{
        background: 'linear-gradient(135deg, rgba(255,31,143,0.08) 0%, rgba(255,31,143,0.04) 100%)',
        border: '1px solid rgba(255,31,143,0.20)',
      }}
    >
      <span
        className="text-[10px] font-extrabold px-1.5 py-0.5 rounded"
        style={{ background: '#FF1F8F', color: '#fff' }}
      >
        공지
      </span>
      <span
        className="text-[12.5px] font-semibold truncate flex-1"
        style={{ color: 'var(--text-1)' }}
      >
        {item.title}
      </span>
      {item.ctaUrl && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)' }} aria-hidden>
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </div>
  );

  if (item.ctaUrl) {
    return (
      <a
        href={item.ctaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block transition active:opacity-70"
      >
        {inner}
      </a>
    );
  }
  return inner;
}
