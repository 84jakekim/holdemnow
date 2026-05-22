'use client';

/**
 * /m/post/[storeId]/[postId] — 매장 "오늘의 소식" 상세 페이지
 *
 * /m/find 의 세로 포스터 캐러셀 카드를 탭하면 진입.
 * - 풀스크린(탭바 숨김 — m/layout의 isFullscreen 분기)
 * - 포스터 세로 비율(원본 비율 유지) + 탭 시 풀스크린 뷰어로 확대
 * - 본문(body) 전체 노출, 이벤트 태그, 링크 CTA
 * - 만료/숨김 상태 안내
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { StorePost } from '@/lib/posts';
import { bumpStoreMetric } from '@/lib/analytics';
import BlockedContentNotice from '@/components/mobile/BlockedContentNotice';

export default function StorePostDetailPage({
  params,
}: {
  params: Promise<{ storeId: string; postId: string }>;
}) {
  const { storeId, postId } = use(params);
  const [post, setPost] = useState<StorePost | null | undefined>(undefined);
  const [zoomIdx, setZoomIdx] = useState<number | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'stores', storeId, 'posts', postId),
      (snap) => {
        if (!snap.exists()) {
          setPost(null);
          return;
        }
        setPost({ id: snap.id, ...(snap.data() as Omit<StorePost, 'id'>) });
      },
      () => setPost(null),
    );
    return unsub;
  }, [storeId, postId]);

  if (post === undefined) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      </main>
    );
  }

  if (post === null) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-10" style={{ background: 'var(--bg)' }}>
        <div className="text-4xl">📭</div>
        <div className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>소식을 찾을 수 없습니다</div>
        <Link
          href="/m/find"
          className="text-sm px-4 py-2 rounded-xl font-semibold mt-2"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          매장찾기로 돌아가기
        </Link>
      </main>
    );
  }

  const now = Date.now();
  const expMs = post.expiresAt?.toMillis() ?? 0;
  const isExpired = expMs > 0 && expMs <= now;
  const isHidden = post.status === 'hidden';
  const isInactive = isExpired || isHidden;

  // 모더레이션 차단된 글은 본문 대신 안내 페이지로 — 일반 사용자 직접 URL 진입 방어.
  if (isHidden) {
    return (
      <BlockedContentNotice
        title="더 이상 노출되지 않는 소식입니다"
        description="작성자가 내렸거나 본사 모더레이션으로 차단되었습니다."
        backHref="/m/find"
        backLabel="매장찾기로"
      />
    );
  }

  const openCta = () => post.ctaUrl && window.open(post.ctaUrl, '_blank', 'noopener,noreferrer');

  return (
    <main style={{ background: 'var(--bg)', minHeight: '100vh', paddingBottom: 40 }}>
      {/* 헤더 */}
      <header
        className="sticky top-0 z-20 px-4 h-12 flex items-center justify-between"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <Link href="/m/find" aria-label="뒤로" className="text-xl px-1" style={{ color: 'var(--text-1)' }}>
          ←
        </Link>
        <span className="text-[13px] font-extrabold" style={{ color: 'var(--text-1)' }}>오늘의 소식</span>
        <Link
          href={`/m/store/${storeId}`}
          onClick={() => bumpStoreMetric(storeId, 'cardClicks')}
          className="text-[11px] font-bold px-2 py-1 rounded-md"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          매장 보기
        </Link>
      </header>

      {/* 매장명 */}
      {post.storeName && (
        <div className="px-5 pt-4 text-[13px] font-bold" style={{ color: 'var(--brand)' }}>
          🏪 {post.storeName}
        </div>
      )}

      {/* 비활성 안내 */}
      {isInactive && (
        <div
          className="mx-4 mt-3 px-3 py-2 text-[11px] font-bold rounded-lg"
          style={{ background: 'rgba(245,158,11,0.10)', color: 'var(--gold)', border: '1px solid rgba(245,158,11,0.30)' }}
        >
          ⚠️ {isExpired ? '24시간 만료된 소식입니다' : '숨김 처리된 소식입니다'} (사용자 화면에는 노출되지 않음)
        </div>
      )}

      {/* 포스터 — 원본 비율 유지, 탭 시 풀스크린 확대 */}
      {post.imageUrls.length > 0 && (
        <div className="px-4 pt-4 space-y-3">
          {post.imageUrls.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setZoomIdx(i)}
              className="block w-full rounded-2xl overflow-hidden active:opacity-90"
              style={{ background: 'var(--surface-2)' }}
              aria-label={`포스터 ${i + 1} 크게 보기`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`${post.storeName ?? '매장'} 포스터 ${i + 1}`}
                className="w-full h-auto block"
              />
            </button>
          ))}
          <div className="text-[11px] text-center" style={{ color: 'var(--text-3)' }}>
            포스터를 탭하면 크게 볼 수 있어요
          </div>
        </div>
      )}

      {/* 이벤트 태그 */}
      {post.eventTags && post.eventTags.length > 0 && (
        <div className="px-5 pt-4 flex flex-wrap gap-1.5">
          {post.eventTags.map((t) => (
            <span
              key={t}
              className="text-[11px] font-bold px-2 py-0.5 rounded-md"
              style={{ background: 'rgba(255,31,143,0.10)', color: 'var(--brand)' }}
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* 본문 */}
      {post.body && (
        <div className="px-5 py-5">
          <div
            className="text-[14px] leading-relaxed whitespace-pre-wrap"
            style={{ color: 'var(--text-2)' }}
          >
            {post.body}
          </div>
        </div>
      )}

      {/* CTA */}
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

      {/* 풀스크린 뷰어 */}
      {zoomIdx != null && post.imageUrls[zoomIdx] && (
        <div
          onClick={() => setZoomIdx(null)}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.95)' }}
          role="dialog"
          aria-label="포스터 크게 보기"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.imageUrls[zoomIdx]}
            alt={post.storeName ?? '포스터'}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setZoomIdx(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center text-white text-xl font-bold"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            aria-label="닫기"
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}
