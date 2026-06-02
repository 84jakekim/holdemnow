'use client';

/**
 * NoticeBoardSection — 본사 공지사항 게시판 (내정보 탭용)
 *
 * - 홈 최상단 한 줄씩 노출되던 본사 고정 공지(pinnedPosts)를 게시판 형태로 모아 보여줌.
 * - active=true 공지를 priority desc · 최신순으로 최대 MAX_DISPLAY개 표시.
 * - 각 항목 탭 → /m/notice/{id} (기존 공지 상세 페이지 재사용).
 * - 활성 공지가 0개면 섹션 전체 숨김 (빈 게시판 미노출).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeActivePinnedPosts, type PinnedPost } from '@/lib/posts';

const MAX_DISPLAY = 4;

function fmtDate(p: PinnedPost): string {
  const ts = p.createdAt;
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    const d = ts.toDate();
    const diff = Date.now() - d.getTime();
    const day = Math.floor(diff / 86_400_000);
    if (day <= 0) return '오늘';
    if (day < 7) return `${day}일 전`;
    return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

function NoticeRow({ post, onClick }: { post: PinnedPost; onClick: () => void }) {
  const thumb = post.imageUrls?.[0];
  const preview = (post.body ?? '').trim().split('\n')[0];
  const date = fmtDate(post);

  return (
    <button
      onClick={onClick}
      className="w-full tap flex items-center gap-3 px-3.5 py-3 text-left transition active:opacity-70"
      style={{ background: 'transparent', border: 'none' }}
      aria-label={`공지: ${post.title}`}
    >
      {/* 썸네일 또는 📢 아이콘 */}
      {thumb ? (
        <div
          className="flex-shrink-0 rounded-lg overflow-hidden"
          style={{ width: 44, height: 44, background: 'var(--surface-3)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb} alt="" aria-hidden="true" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div
          className="flex-shrink-0 flex items-center justify-center rounded-lg"
          style={{ width: 44, height: 44, background: 'var(--brand-pale, #FFF0F7)', fontSize: 20 }}
          aria-hidden="true"
        >
          📢
        </div>
      )}

      {/* 제목 + 미리보기 */}
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-bold leading-snug truncate" style={{ color: 'var(--text-1)' }}>
          {post.title}
        </div>
        {preview && (
          <div className="text-[11.5px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
            {preview}
          </div>
        )}
      </div>

      {/* 날짜 */}
      {date && (
        <span className="flex-shrink-0 text-[10.5px] font-semibold" style={{ color: 'var(--text-3)' }}>
          {date}
        </span>
      )}

      {/* 셰브론 */}
      <svg
        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

export default function NoticeBoardSection() {
  const router = useRouter();
  const [posts, setPosts] = useState<PinnedPost[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = subscribeActivePinnedPosts(
      (items) => {
        setPosts(items.slice(0, MAX_DISPLAY));
        setLoaded(true);
      },
      () => setLoaded(true),
    );
    return unsub;
  }, []);

  // 로딩 전 또는 활성 공지 0개 → 섹션 숨김 (빈 게시판 미노출)
  if (!loaded || posts.length === 0) return null;

  return (
    <section
      aria-label="공지사항"
      className="py-5"
      style={{ borderBottom: '6px solid var(--surface-2)' }}
    >
      {/* 섹션 헤더 */}
      <div className="px-5 flex items-center gap-2 mb-3">
        <span className="text-[16px]" aria-hidden="true">📢</span>
        <span className="text-[16px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          공지사항
        </span>
        <span
          className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full"
          style={{ background: 'var(--surface-3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
        >
          {posts.length}
        </span>
      </div>

      {/* 게시판 리스트 */}
      <div
        className="mx-5 rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
      >
        {posts.map((p, i) => (
          <div
            key={p.id}
            style={{ borderBottom: i < posts.length - 1 ? '1px solid var(--border)' : 'none' }}
          >
            <NoticeRow post={p} onClick={() => router.push(`/m/notice/${p.id}`)} />
          </div>
        ))}
      </div>
    </section>
  );
}
