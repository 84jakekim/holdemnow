'use client';

/**
 * DailyPostsCarousel — 홈 최상단의 "오늘의 매장 소식" 1.5장 peek 슬라이더.
 *
 * 목적 (Sprint 2 Phase A):
 *  - 홈에서는 가벼움 + 차별화 우선. 본문 첫 줄 + 매장명만 (이미지 X).
 *  - 매장찾기(/m/find) 섹션은 2장 portrait + 이미지 — 깊이있는 둘러보기.
 *  - LIVE 히어로 자리에 위치하지만, LIVE 자체는 /m/find로 이동(섹션 헤더 + 큰 카드).
 *
 * 동작:
 *  - 1.5장 peek (우측 fade), 5초 자동 페이드 진행, 8장 캡.
 *  - 본사 pinned 글 있으면 상단에 슬림 stripe로 표시 (피쳐플래그처럼).
 *  - posts 0건이면 컴포넌트 자체 미렌더(섹션 사라짐).
 *  - 카드 탭 → /m/store/{storeId} 이동.
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

const MAX_POSTS = 8;
const ROTATE_INTERVAL_MS = 5000;

export default function DailyPostsCarousel() {
  const [posts, setPosts] = useState<StorePost[]>([]);
  const [pinned, setPinned] = useState<PinnedPost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

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

  // 5초 페이드 자동 진행 (디스플레이 dot 없음 — 인디케이터는 fade affordance로)
  useEffect(() => {
    if (posts.length <= 1) return;
    const id = window.setInterval(() => {
      setActiveIdx((i) => (i + 1) % posts.length);
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [posts.length]);

  // activeIdx 변경 시 스크롤 동기화
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.children[activeIdx] as HTMLElement | undefined;
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }, [activeIdx]);

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
              <PostCard key={p.id} post={p} active={idx === activeIdx} />
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
// 카드 — 본문 첫 줄 + 매장명 (이미지 X)
// ─────────────────────────────────────────────────────────────

function PostCard({ post, active }: { post: StorePost; active: boolean }) {
  // 본문 첫 줄 (개행 기준, 최대 60자)
  const firstLine = useMemo(() => {
    const line = (post.body || '').split('\n')[0]?.trim() ?? '';
    return line.length > 60 ? line.slice(0, 60) + '…' : line;
  }, [post.body]);

  return (
    <Link
      href={`/m/store/${post.storeId}`}
      className="snap-start flex-shrink-0 rounded-2xl transition active:opacity-70"
      style={{
        width: 'calc(66vw)',
        maxWidth: '280px',
        minWidth: '220px',
        background: 'var(--surface-1)',
        border: active ? '1.5px solid var(--brand)' : '1px solid var(--border)',
        padding: '14px 14px 12px',
        opacity: active ? 1 : 0.78,
      }}
      aria-label={`${post.storeName ?? '매장'} 소식 보기`}
    >
      {/* 본문 첫 줄 */}
      <div
        className="text-[14px] font-semibold leading-[1.45] mb-2.5"
        style={{
          color: 'var(--text-1)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: '40px',
        }}
      >
        {firstLine || '오늘의 매장 소식'}
      </div>
      {/* 구분선 + 매장명 */}
      <div
        className="pt-2 mt-1 flex items-center gap-1.5"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--text-2)' }}>
          {post.storeName || '매장'}
        </div>
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
