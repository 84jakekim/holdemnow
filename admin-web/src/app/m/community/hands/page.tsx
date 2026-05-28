'use client';

/**
 * /m/community/hands — 핸드분석 목록 v0.5
 *
 * 데이터: handAnalysisPosts (top-level Firestore)
 * 페이지네이션: cursor 방식 (더보기 버튼)
 * 검색: 클라이언트 타이틀 필터 (빠른 UX)
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type QueryDocumentSnapshot } from 'firebase/firestore';
import { useAuth } from '@/lib/hooks';
import {
  type HandAnalysisPost,
  loadHandAnalysisPosts,
} from '@/lib/handAnalysis';
import { formatRelativeTime } from '@/lib/community';
import NotificationBellButton from '@/components/mobile/NotificationBellButton';

// ── 위치 레이블 ──────────────────────────────────────────────
const POSITION_COLORS: Record<string, string> = {
  BTN: '#2563EB',
  CO: '#7C3AED',
  HJ: '#0891B2',
  LJ: '#065F46',
  UTG: '#B45309',
  BB: '#DC2626',
  SB: '#BE185D',
};

function positionColor(pos: string) {
  return POSITION_COLORS[pos.toUpperCase()] ?? '#6B7280';
}

const POPULAR_TAGS = ['블러프', '밸류벳', '팟 오즈', '올인', '콜', '폴드', 'AK', '포켓페어'];

export default function HandsListPage() {
  const router = useRouter();
  const authState = useAuth();
  const [posts, setPosts] = useState<HandAnalysisPost[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [q, setQ] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const fetchInitial = useCallback(async () => {
    setLoaded(false);
    const { posts: items, cursor: newCursor } = await loadHandAnalysisPosts({ pageSize: 20, tag: activeTag ?? undefined });
    setPosts(items);
    setCursor(newCursor);
    setHasMore(items.length === 20);
    setLoaded(true);
  }, [activeTag]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  const fetchMore = async () => {
    if (!hasMore || loadingMore || !cursor) return;
    setLoadingMore(true);
    const { posts: more, cursor: newCursor } = await loadHandAnalysisPosts({
      pageSize: 20,
      afterCursor: cursor,
      tag: activeTag ?? undefined,
    });
    setPosts((prev) => [...prev, ...more]);
    setCursor(newCursor);
    setHasMore(more.length === 20);
    setLoadingMore(false);
  };

  // 검색 클라이언트 필터
  const filtered = posts.filter((p) => {
    if (q) {
      const hay = `${p.title} ${p.tags.join(' ')} ${p.position ?? ''} ${p.stakeLevel ?? ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const isLoggedIn = authState.status === 'authenticated';

  return (
    <div className="relative min-h-screen flex flex-col" style={{ background: 'var(--surface-2)' }}>

      {/* ── 헤더 ─────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 flex items-center gap-2 px-3"
        style={{ height: 52, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          className="tap"
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-1)', cursor: 'pointer' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 900, letterSpacing: '-0.015em', color: 'var(--text-1)' }}>
          핸드분석
        </div>
        <NotificationBellButton ariaLabel="알림" />
      </header>

      {/* ── 검색 ─────────────────────────────────────── */}
      <div className="px-3.5 pt-2.5 pb-0" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center gap-2 px-2.5" style={{ background: 'var(--surface-2)', borderRadius: 10, height: 36 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="핸드·블라인드·포지션으로 검색"
            style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 13, color: 'var(--text-1)', fontFamily: 'inherit', minWidth: 0 }}
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="검색어 지우기" className="tap" style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', cursor: 'pointer', fontSize: 14 }}>✕</button>
          )}
        </div>
      </div>

      {/* ── 태그 필터 칩 ─────────────────────────────── */}
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: 6, padding: '10px 14px 8px', overflowX: 'auto', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <button
          onClick={() => setActiveTag(null)}
          className="tap"
          style={{
            flexShrink: 0, padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700,
            border: activeTag === null ? 'none' : '1px solid var(--border)',
            background: activeTag === null ? 'var(--brand)' : 'var(--bg)',
            color: activeTag === null ? '#fff' : 'var(--text-1)',
            cursor: 'pointer',
          }}
        >
          전체
        </button>
        {POPULAR_TAGS.map((tag) => {
          const active = activeTag === tag;
          return (
            <button
              key={tag}
              onClick={() => setActiveTag(active ? null : tag)}
              className="tap"
              style={{
                flexShrink: 0, padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                border: active ? 'none' : '1px solid var(--border)',
                background: active ? 'var(--brand)' : 'var(--bg)',
                color: active ? '#fff' : 'var(--text-1)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              #{tag}
            </button>
          );
        })}
      </div>

      {/* ── 콘텐츠 ───────────────────────────────────── */}
      <div className="no-scrollbar flex-1 overflow-y-auto pb-28">

        {!loaded ? (
          <LoadingSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyHands q={q} />
        ) : (
          <div style={{ padding: '10px 14px 0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map((p) => (
                <HandCard key={p.id} post={p} />
              ))}
            </div>

            {hasMore && (
              <button
                onClick={fetchMore}
                disabled={loadingMore}
                className="tap"
                style={{
                  width: '100%', padding: '12px 0', margin: '14px 0 4px',
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 12, fontSize: 13, fontWeight: 700,
                  color: 'var(--text-2)', cursor: 'pointer',
                }}
              >
                {loadingMore ? '불러오는 중…' : '더 보기'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── FAB ─────────────────────────────────────── */}
      {isLoggedIn && (
        <Link
          href="/m/community/hands/write"
          aria-label="핸드분석 작성"
          className="tap"
          style={{
            position: 'fixed', right: 18, bottom: 86, zIndex: 25,
            width: 54, height: 54, borderRadius: 99,
            background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
            boxShadow: '0 8px 22px rgba(255,31,143,0.42)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', textDecoration: 'none',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>
      )}
    </div>
  );
}

// ── 카드 컴포넌트 ─────────────────────────────────────────────
function HandCard({ post }: { post: HandAnalysisPost }) {
  const thumb = post.imageUrls[0];
  return (
    <Link
      href={`/m/community/hands/${post.id}`}
      className="lift"
      style={{
        background: 'var(--bg)', borderRadius: 14,
        border: '1px solid var(--border)',
        display: 'block', textDecoration: 'none', color: 'inherit',
        overflow: 'hidden',
      }}
    >
      {/* 대표 이미지 */}
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
        />
      )}

      <div style={{ padding: '12px 14px 10px' }}>
        {/* 메타 배지 (포지션 + 블라인드) */}
        <div className="flex items-center gap-1.5 mb-2">
          {post.position && (
            <span
              style={{
                fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 5,
                background: `${positionColor(post.position)}18`,
                color: positionColor(post.position),
              }}
            >
              {post.position.toUpperCase()}
            </span>
          )}
          {post.stakeLevel && (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-2)', padding: '1px 5px', borderRadius: 5, background: 'var(--surface-2)' }}>
              {post.stakeLevel}
            </span>
          )}
        </div>

        {/* 제목 */}
        <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1.35, letterSpacing: '-0.02em', marginBottom: 5, color: 'var(--text-1)' }}>
          {post.title}
        </div>

        {/* 본문 미리보기 */}
        <div
          style={{
            fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 8,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}
        >
          {post.body}
        </div>

        {/* 태그 칩 */}
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-8px" style={{ marginBottom: 8 }}>
            {post.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99,
                  background: 'var(--surface-2)', color: 'var(--text-2)',
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* 푸터 */}
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>
            {post.authorName}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
            {formatRelativeTime(post.createdAt)}
          </span>
          <div className="flex items-center gap-2.5 ml-auto" style={{ fontSize: 10, color: 'var(--text-3)' }}>
            {/* 좋아요 */}
            <span className="flex items-center gap-0.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {post.likeCount}
            </span>
            {/* 댓글 */}
            <span className="flex items-center gap-0.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {post.commentCount}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── 로딩 스켈레톤 ─────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div style={{ padding: '10px 14px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ background: 'var(--bg)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ height: 120, background: 'var(--surface-2)', animation: 'pulse 1.4s ease-in-out infinite' }} />
          <div style={{ padding: '12px 14px' }}>
            <div style={{ height: 14, width: '70%', borderRadius: 6, background: 'var(--surface-2)', marginBottom: 8 }} />
            <div style={{ height: 11, width: '90%', borderRadius: 4, background: 'var(--surface-2)', marginBottom: 4 }} />
            <div style={{ height: 11, width: '55%', borderRadius: 4, background: 'var(--surface-2)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 빈 상태 ───────────────────────────────────────────────────
function EmptyHands({ q }: { q: string }) {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">🃏</div>
      {q ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>검색 결과가 없어요</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
            다른 키워드로 검색해 보세요
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>아직 핸드분석 글이 없어요</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
            첫 번째 핸드를 공유해 보세요.<br />
            우하단 + 버튼을 눌러 작성하세요.
          </div>
        </>
      )}
    </div>
  );
}
