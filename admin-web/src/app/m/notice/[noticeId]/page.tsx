'use client';

/**
 * /m/notice/[noticeId] — 본사 고정 공지(pinnedPosts) 상세 페이지
 *
 * /m/find의 상단 PinnedBanner를 탭하면 진입.
 * - 풀스크린(탭바 숨김 — m/layout의 isFullscreen 분기)
 * - 이미지·제목·본문·CTA 모두 노출
 * - active=false면 "지난 공지" 안내
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { PinnedPost } from '@/lib/posts';
import BlockedContentNotice from '@/components/mobile/BlockedContentNotice';

export default function NoticeDetailPage({
  params,
}: {
  params: Promise<{ noticeId: string }>;
}) {
  const { noticeId } = use(params);
  const [post, setPost] = useState<PinnedPost | null | undefined>(undefined);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'pinnedPosts', noticeId),
      (snap) => {
        if (!snap.exists()) {
          setPost(null);
          return;
        }
        setPost({ id: snap.id, ...(snap.data() as Omit<PinnedPost, 'id'>) });
      },
      () => setPost(null),
    );
    return unsub;
  }, [noticeId]);

  if (post === undefined) {
    return (
      <main className="min-h-screen p-5 space-y-3" style={{ background: 'var(--bg)' }}>
        <div className="skel h-14 rounded-r-md" />
        <div className="skel h-48 rounded-r-xl" />
      </main>
    );
  }

  if (post === null) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
        <div className="empty-state w-full max-w-sm">
          <div className="empty-state-icon" aria-hidden>📢</div>
          <div>
            <div className="empty-state-title">공지를 찾을 수 없어요</div>
            <div className="empty-state-desc" style={{ marginTop: 6 }}>
              종료되었거나 비활성된 공지일 수 있어요.
            </div>
          </div>
          <Link href="/m/find" className="btn-brand tap px-5 py-2.5 text-[13px]">
            매장찾기로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  // 비활성 공지(active=false) — 일반 사용자 직접 URL 진입 방어 (모더레이션과 운영 비활성 모두 포함)
  if (post.active === false) {
    return (
      <BlockedContentNotice
        title="더 이상 노출되지 않는 공지입니다"
        description="본사가 공지를 비활성화했거나 종료되었습니다."
        backHref="/m"
        backLabel="홈으로"
      />
    );
  }

  const openCta = () => post.ctaUrl && window.open(post.ctaUrl, '_blank', 'noopener,noreferrer');

  return (
    <main style={{ background: 'var(--bg)', minHeight: '100vh', paddingBottom: 40 }}>
      {/* 헤더 — 핑크 액센트 라인 */}
      <header
        className="sticky top-0 z-20 px-4 h-12 flex items-center justify-between bg-white"
        style={{ borderBottom: '2px solid rgba(255,31,143,0.18)' }}
      >
        <Link href="/m/find" aria-label="뒤로" className="text-xl px-1 tap" style={{ color: 'var(--text-1)' }}>
          ←
        </Link>
        <div className="section-title" style={{ margin: 0 }}>📢 본사 공지</div>
        <div className="w-6" />
      </header>

      {!post.active && (
        <div
          className="mx-4 mt-3 px-3 py-2 text-[11px] font-bold rounded-lg"
          style={{ background: 'rgba(245,158,11,0.10)', color: 'var(--gold)', border: '1px solid rgba(245,158,11,0.30)' }}
        >
          ⚠️ 비활성 상태인 공지입니다 (사용자 화면에 노출되지 않음)
        </div>
      )}

      {/* 이미지 */}
      {post.imageUrls.length > 0 && (
        <div className="px-4 pt-4">
          <div className="w-full rounded-2xl overflow-hidden" style={{ background: 'var(--surface-2)', aspectRatio: '16/9' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.imageUrls[0]} alt={post.title} className="w-full h-full object-cover" />
          </div>
          {/* 추가 이미지가 있으면 세로 스택 */}
          {post.imageUrls.slice(1).map((url, i) => (
            <div
              key={url}
              className="w-full rounded-2xl overflow-hidden mt-3"
              style={{ background: 'var(--surface-2)', aspectRatio: '16/9' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`${post.title} ${i + 2}`} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {/* 제목·본문 */}
      <div className="px-5 py-5">
        <div className="text-[20px] font-extrabold leading-snug mb-3" style={{ color: 'var(--text-1)' }}>
          {post.title}
        </div>
        {post.body && (
          <div
            className="text-[14px] leading-relaxed whitespace-pre-wrap"
            style={{ color: 'var(--text-2)' }}
          >
            {post.body}
          </div>
        )}
      </div>

      {/* CTA 버튼 */}
      {post.ctaUrl && (
        <div className="px-5 pb-2">
          <button
            onClick={openCta}
            className="w-full py-3.5 rounded-xl font-extrabold text-sm text-white"
            style={{
              background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand-dim) 100%)',
              boxShadow: '0 2px 12px rgba(255,31,143,0.25)',
            }}
          >
            {post.ctaLabel || '자세히 보기'} ›
          </button>
        </div>
      )}
    </main>
  );
}
