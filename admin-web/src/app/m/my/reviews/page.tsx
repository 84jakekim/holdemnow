'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import AnonymousPrompt from '@/components/mobile/AnonymousPrompt';
import ReviewWriteSheet from '@/components/mobile/ReviewWriteSheet';
import {
  subscribeMyReviews,
  deleteReview,
  type Review,
} from '@/lib/reviews';

interface StoreSummary {
  name: string;
  photoUrl?: string;
}

/**
 * 내가 쓴 리뷰 페이지.
 *
 * - subscribeMyReviews(uid)로 실시간 구독.
 * - 매장 이름은 review에 들어있지 않으므로 storeId → stores/{id} doc.name lookup.
 * - 베타: 마운트 시 모든 관련 storeId batch fetch (Firestore `in` 쿼리, 10개씩 청크).
 */
export default function MyReviewsPage() {
  const authState = useAuth();
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [storeMap, setStoreMap] = useState<Record<string, StoreSummary>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Review | null>(null);

  useEffect(() => {
    if (authState.status !== 'authenticated') {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeMyReviews(
      authState.user.uid,
      (items) => { setReviews(items); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, [authState]);

  // 신규 storeId 발견 시 stores 정보 batch fetch
  useEffect(() => {
    const missing = Array.from(new Set(reviews.map((r) => r.storeId)))
      .filter((id) => id && !(id in storeMap));
    if (missing.length === 0) return;
    (async () => {
      try {
        const next: Record<string, StoreSummary> = {};
        // Firestore `in` 쿼리는 한 번에 10개까지 — 청크해서 호출
        for (let i = 0; i < missing.length; i += 10) {
          const chunk = missing.slice(i, i + 10);
          const snap = await getDocs(query(collection(db, 'stores'), where(documentId(), 'in', chunk)));
          snap.forEach((d) => {
            const data = d.data() as { name?: string; photoUrls?: string[] };
            next[d.id] = { name: data.name ?? '(이름 없음)', photoUrl: data.photoUrls?.[0] };
          });
        }
        if (Object.keys(next).length > 0) {
          setStoreMap((prev) => ({ ...prev, ...next }));
        }
      } catch {
        /* 무시 */
      }
    })();
  }, [reviews, storeMap]);

  const handleDelete = async (r: Review) => {
    if (!window.confirm('리뷰를 삭제할까요?')) return;
    try {
      await deleteReview(r.storeId, r.id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  if (authState.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      </div>
    );
  }
  if (authState.status === 'anonymous') {
    return (
      <AnonymousPrompt
        title="내가 쓴 리뷰"
        icon="✎"
        desc="내가 작성한 매장 리뷰를 한곳에서 관리하려면 로그인하세요."
      />
    );
  }

  const uid = authState.user.uid;
  const authorName =
    authState.user.displayName ?? authState.user.email ?? '플레이어';

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* ── 헤더 ── */}
      <header
        className="px-5 h-14 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.back()}
            aria-label="뒤로"
            className="w-9 h-9 -ml-2 flex items-center justify-center rounded-xl transition active:scale-90"
            style={{ color: 'var(--text-2)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <span className="text-xl font-extrabold tracking-tight font-serif" style={{ color: 'var(--text-1)' }}>
            내가 쓴 리뷰
          </span>
        </div>
        <span className="text-xs font-bold" style={{ color: 'var(--text-3)' }}>
          {reviews.length}개
        </span>
      </header>

      {loading ? (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      ) : reviews.length === 0 ? (
        <div className="p-8 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            aria-hidden="true"
          >
            ✎
          </div>
          <div className="font-bold mb-2" style={{ color: 'var(--text-1)' }}>
            아직 작성한 리뷰가 없어요
          </div>
          <div className="text-xs leading-relaxed mb-6" style={{ color: 'var(--text-3)' }}>
            방문한 매장 상세 화면에서 <strong>리뷰 쓰기</strong> 버튼을 눌러<br />
            다른 분들에게 후기를 공유해 보세요
          </div>
          <Link
            href="/m/discover"
            className="inline-flex items-center gap-1.5 px-5 py-3 rounded-xl font-bold text-sm transition active:scale-[0.97]"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            매장 둘러보기
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
          </Link>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {reviews.map((r) => {
            const store = storeMap[r.storeId];
            return (
              <MyReviewCard
                key={r.id}
                review={r}
                storeName={store?.name ?? '(매장 정보 로딩 중)'}
                storePhotoUrl={store?.photoUrl}
                onEdit={() => setEditing(r)}
                onDelete={() => handleDelete(r)}
              />
            );
          })}
        </div>
      )}

      {editing && (
        <ReviewWriteSheet
          storeId={editing.storeId}
          storeName={storeMap[editing.storeId]?.name ?? '매장'}
          authorUid={uid}
          authorName={authorName}
          existingReview={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function MyReviewCard({
  review,
  storeName,
  storePhotoUrl,
  onEdit,
  onDelete,
}: {
  review: Review;
  storeName: string;
  storePhotoUrl?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const created = review.createdAt?.toMillis?.() ?? 0;
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      {/* 매장 라인 — 클릭 시 상세로 이동 */}
      <Link
        href={`/m/store/${review.storeId}`}
        className="flex items-center gap-3 px-4 py-3 transition active:bg-gray-50"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div
          className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden"
          style={{ background: 'var(--surface-2)' }}
        >
          {storePhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={storePhotoUrl} alt={storeName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}>
              <span className="text-[14px] font-extrabold" style={{ color: 'var(--brand)', opacity: 0.5 }}>
                {storeName.charAt(0)}
              </span>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
            {storeName}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  aria-hidden="true"
                  style={{
                    fontSize: 11,
                    lineHeight: 1,
                    color: n <= review.rating ? '#FFC83D' : 'var(--surface-3)',
                  }}
                >
                  ★
                </span>
              ))}
            </div>
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {created ? formatYmd(created) : ''}
              {review.editedAt && <span> · 수정됨</span>}
            </span>
          </div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </Link>

      {/* 본문 미리보기 */}
      <div className="px-4 py-3">
        <div
          className="text-[13px] leading-relaxed line-clamp-2"
          style={{ color: 'var(--text-1)' }}
        >
          {review.body}
        </div>
        {review.photoUrls && review.photoUrls.length > 0 && (
          <div className="flex gap-1.5 mt-2.5 overflow-x-auto scrollbar-none">
            {review.photoUrls.slice(0, 3).map((url) => (
              <div
                key={url}
                className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="리뷰 사진" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 액션 */}
      <div
        className="px-4 py-2.5 flex items-center justify-end gap-2"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <button
          onClick={onEdit}
          className="text-[12px] font-bold px-3 py-1.5 rounded-lg transition active:scale-95"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
        >
          수정
        </button>
        <button
          onClick={onDelete}
          className="text-[12px] font-bold px-3 py-1.5 rounded-lg transition active:scale-95"
          style={{ background: 'var(--surface-2)', color: 'var(--live)', border: '1px solid var(--border)' }}
        >
          삭제
        </button>
      </div>
    </div>
  );
}

function formatYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
