'use client';

/**
 * 매장 어드민 — 리뷰 답글 패널.
 * 매장에 들어온 리뷰 전체를 보여주고 답글을 달거나 수정할 수 있게 함.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  type Review,
  setStoreReplyToReview,
  subscribeStoreReviews,
} from '@/lib/reviews';
import type { Timestamp } from 'firebase/firestore';

interface Props {
  storeId: string;
  storeName: string;
}

export default function ReviewsAdminPanel({ storeId, storeName }: Props) {
  const [items, setItems] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unreplied' | 'replied'>('unreplied');
  const [editing, setEditing] = useState<Review | null>(null);

  useEffect(() => {
    const unsub = subscribeStoreReviews(
      storeId,
      (list) => {
        setItems(list);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [storeId]);

  const filtered = useMemo(() => {
    return items.filter((r) => {
      if (r.hidden) return false; // 본사 숨김 처리된 리뷰는 매장에 노출 X
      if (filter === 'unreplied') return !r.storeReply;
      if (filter === 'replied') return !!r.storeReply;
      return true;
    });
  }, [items, filter]);

  const unrepliedCount = items.filter((r) => !r.hidden && !r.storeReply).length;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">⭐ 리뷰 답글</h1>
          <p className="text-sm text-gray-500 mt-1">
            {storeName}에 작성된 리뷰에 답글을 남겨 단골과 소통하세요. 답글은 사용자에게도 매장 상세에서 인라인으로 노출됩니다.
          </p>
        </div>
      </div>

      <div className="flex gap-1.5 mb-4">
        {([
          { id: 'unreplied' as const, label: `미답변 ${unrepliedCount}` },
          { id: 'all' as const, label: '전체' },
          { id: 'replied' as const, label: '답변 완료' },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`px-3 py-1.5 text-[12px] font-bold rounded-md transition ${
              filter === t.id ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">로딩 중…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-10 text-center">
          <div className="text-3xl mb-2">⭐</div>
          <div className="font-bold text-gray-900 mb-1">
            {filter === 'unreplied' ? '답변할 새 리뷰가 없어요' : '리뷰가 없습니다'}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((r) => (
            <ReviewRow
              key={r.id}
              review={r}
              onReply={() => setEditing(r)}
            />
          ))}
        </div>
      )}

      {editing && (
        <ReplyModal
          review={editing}
          storeId={storeId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ReviewRow({ review, onReply }: { review: Review; onReply: () => void }) {
  const hasReply = !!review.storeReply;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start gap-2 mb-1.5 flex-wrap">
        <span className="font-bold text-gray-900">{review.authorName ?? '익명'}</span>
        <span className="text-amber-500 text-[12px]">
          {'★'.repeat(review.rating)}<span className="text-gray-300">{'★'.repeat(5 - review.rating)}</span>
        </span>
        <span className="text-[11px] text-gray-400 ml-auto">{formatRelative(review.createdAt)}</span>
      </div>
      <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{review.body}</div>
      {review.photoUrls && review.photoUrls.length > 0 && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {review.photoUrls.slice(0, 4).map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="" className="w-14 h-14 rounded-md object-cover" />
          ))}
        </div>
      )}

      {hasReply && (
        <div className="mt-3 ml-3 border-l-2 border-pink-200 pl-3 py-2">
          <div className="text-[11px] font-extrabold text-pink-600 mb-0.5 flex items-center gap-1">
            <span>↳ 매장 답글</span>
            <span className="text-[10px] text-gray-400 font-normal">{formatRelative(review.storeReplyAt)}</span>
          </div>
          <div className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap">{review.storeReply}</div>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button
          onClick={onReply}
          className="text-[11.5px] font-bold px-3 py-1.5 rounded-md border border-pink-200 text-pink-700 bg-pink-50 hover:bg-pink-100"
        >
          {hasReply ? '답글 수정' : '답글 달기'}
        </button>
      </div>
    </div>
  );
}

function ReplyModal({
  review,
  storeId,
  onClose,
}: {
  review: Review;
  storeId: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(review.storeReply ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await setStoreReplyToReview(storeId, review.id, text);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('답글을 삭제할까요?')) return;
    setBusy(true);
    setError(null);
    try {
      await setStoreReplyToReview(storeId, review.id, '');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="font-extrabold text-gray-900">↳ 답글 작성</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {review.authorName} · {'★'.repeat(review.rating)}
          </div>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div
            className="text-[12.5px] text-gray-600 leading-relaxed px-3 py-2 rounded-lg bg-gray-50 max-h-32 overflow-y-auto whitespace-pre-wrap"
          >
            {review.body}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            maxLength={500}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm resize-none"
            placeholder="감사 인사·문의 답변·재방문 안내 등을 작성하세요."
          />
          <div className="text-[10.5px] text-right text-gray-400">{text.length}/500</div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">{error}</div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          {review.storeReply && (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="px-3 py-2.5 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 font-bold text-sm disabled:opacity-40"
            >
              삭제
            </button>
          )}
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-lg border border-gray-200 font-bold text-sm disabled:opacity-40">
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={busy || !text.trim()}
            className="flex-1 py-2.5 rounded-lg bg-pink-600 text-white font-bold text-sm disabled:opacity-40"
          >
            {busy ? '저장 중…' : '답글 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatRelative(ts?: Timestamp | null): string {
  if (!ts) return '';
  const ms = Date.now() - ts.toMillis();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return ts.toDate().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
}
