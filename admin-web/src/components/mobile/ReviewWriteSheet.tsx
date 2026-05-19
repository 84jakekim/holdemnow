'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createReview,
  updateReview,
  uploadReviewImage,
  MAX_REVIEW_PHOTOS,
  MAX_REVIEW_BODY_LEN,
  type Review,
} from '@/lib/reviews';

/**
 * 리뷰 작성/수정 바텀시트.
 *
 * - existingReview 있으면 수정 모드, 없으면 작성 모드.
 * - 별점 1~5 필수, 본문 5~500자 필수, 사진 최대 3장 (5MB/장), 방문일 선택.
 * - 사진 업로드는 createReview 전이라도 가능 (reviews/temp_xxx/ path 사용).
 * - 저장 성공 시 onClose() 호출 — 부모는 subscribeStoreReviews 등으로 자동 갱신.
 */
export default function ReviewWriteSheet({
  storeId,
  storeName,
  authorUid,
  authorName,
  existingReview,
  onClose,
}: {
  storeId: string;
  storeName: string;
  authorUid: string;
  authorName: string;
  existingReview?: Review | null;
  onClose: () => void;
}) {
  const isEdit = !!existingReview;

  const [rating, setRating] = useState<number>(existingReview?.rating ?? 0);
  const [body, setBody] = useState<string>(existingReview?.body ?? '');
  const [photoUrls, setPhotoUrls] = useState<string[]>(existingReview?.photoUrls ?? []);
  const [visitDate, setVisitDate] = useState<string>(() => {
    const d = existingReview?.visitDate?.toDate?.();
    if (!d) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 작성 모드에서 사진 임시 경로용 키 — 컴포넌트 라이프타임 동안 일관 유지
  const tempKeyRef = useRef<string>(
    existingReview?.id ?? `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );

  // ESC로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const remaining = MAX_REVIEW_PHOTOS - photoUrls.length;
      if (remaining <= 0) {
        setError(`사진은 최대 ${MAX_REVIEW_PHOTOS}장까지 업로드 가능합니다`);
        return;
      }
      const arr = Array.from(files).slice(0, remaining);
      const next: string[] = [];
      for (const f of arr) {
        const url = await uploadReviewImage(tempKeyRef.current, f);
        next.push(url);
      }
      setPhotoUrls((prev) => [...prev, ...next]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePhoto = (url: string) => {
    setPhotoUrls((prev) => prev.filter((u) => u !== url));
  };

  const submit = async () => {
    setError(null);
    if (rating < 1) { setError('별점을 선택해주세요'); return; }
    const trimmed = body.trim();
    if (trimmed.length < 5) { setError('리뷰 본문은 5자 이상 입력해주세요'); return; }
    if (trimmed.length > MAX_REVIEW_BODY_LEN) {
      setError(`리뷰 본문은 ${MAX_REVIEW_BODY_LEN}자 이내로 작성해주세요`); return;
    }
    setBusy(true);
    try {
      const visitDateObj = visitDate ? new Date(visitDate) : null;
      if (isEdit && existingReview) {
        await updateReview(storeId, existingReview.id, {
          rating,
          body: trimmed,
          photoUrls,
          visitDate: visitDateObj,
        });
      } else {
        await createReview({
          storeId,
          authorUid,
          authorName,
          rating,
          body: trimmed,
          photoUrls,
          visitDate: visitDateObj,
        });
      }
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl px-5 pt-3 pb-6"
        style={{
          background: 'var(--surface-1)',
          maxHeight: '92vh',
          overflowY: 'auto',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
        }}
      >
        {/* 핸들 */}
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        <div className="text-[18px] font-extrabold mb-0.5" style={{ color: 'var(--text-1)' }}>
          {isEdit ? '리뷰 수정' : '리뷰 쓰기'}
        </div>
        <div className="text-[12px] mb-5" style={{ color: 'var(--text-3)' }}>{storeName}</div>

        {/* 별점 */}
        <div className="mb-5">
          <div className="text-[12px] font-bold mb-2" style={{ color: 'var(--text-2)' }}>
            별점 <span style={{ color: '#FF1F8F' }}>*</span>
          </div>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className="transition active:scale-90"
                aria-label={`${n}점`}
                style={{
                  fontSize: 36,
                  lineHeight: 1,
                  color: n <= rating ? '#FFC83D' : 'var(--surface-3)',
                  WebkitTextStroke: n <= rating ? '0' : '1px var(--border)',
                }}
              >
                ★
              </button>
            ))}
            {rating > 0 && (
              <span className="ml-2 text-[14px] font-extrabold font-mono" style={{ color: 'var(--text-1)' }}>
                {rating}.0
              </span>
            )}
          </div>
        </div>

        {/* 본문 */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-bold" style={{ color: 'var(--text-2)' }}>
              리뷰 내용 <span style={{ color: '#FF1F8F' }}>*</span>
            </div>
            <div className="text-[11px] font-mono" style={{ color: body.length > MAX_REVIEW_BODY_LEN ? 'var(--live)' : 'var(--text-3)' }}>
              {body.length}/{MAX_REVIEW_BODY_LEN}
            </div>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MAX_REVIEW_BODY_LEN + 50}
            rows={5}
            placeholder="이 매장은 어땠나요? 다른 분들에게 도움이 되는 내용을 남겨주세요. (5자 이상)"
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none resize-none leading-relaxed"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
              minHeight: 120,
            }}
          />
        </div>

        {/* 방문일 */}
        <div className="mb-5">
          <div className="text-[12px] font-bold mb-2" style={{ color: 'var(--text-2)' }}>
            방문일 <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>(선택)</span>
          </div>
          <input
            type="date"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          />
        </div>

        {/* 사진 */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-bold" style={{ color: 'var(--text-2)' }}>
              사진 <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>(선택)</span>
            </div>
            <div className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
              {photoUrls.length}/{MAX_REVIEW_PHOTOS}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {photoUrls.map((url) => (
              <div
                key={url}
                className="relative w-20 h-20 rounded-xl overflow-hidden"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="리뷰 사진" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(url)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold leading-none"
                  style={{ background: 'rgba(0,0,0,0.65)', color: '#fff', backdropFilter: 'blur(4px)' }}
                  aria-label="사진 제거"
                >
                  ×
                </button>
              </div>
            ))}
            {photoUrls.length < MAX_REVIEW_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-20 h-20 rounded-xl flex flex-col items-center justify-center gap-1 transition active:scale-95 disabled:opacity-40"
                style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
              >
                <span className="text-[20px] leading-none" style={{ color: 'var(--text-3)' }}>+</span>
                <span className="text-[10px] font-semibold" style={{ color: 'var(--text-3)' }}>
                  {uploading ? '업로드…' : '사진'}
                </span>
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>
            한 장당 5MB 이하 · 최대 {MAX_REVIEW_PHOTOS}장
          </div>
        </div>

        {error && (
          <div
            className="mb-3 px-3 py-2 rounded-xl text-[12px] font-bold"
            style={{ background: 'rgba(229,62,62,0.10)', color: 'var(--live)' }}
          >
            {error}
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-3 rounded-xl text-[14px] font-bold disabled:opacity-40 transition active:scale-[0.98]"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || uploading}
            className="flex-1 py-3 rounded-xl text-[14px] font-extrabold text-white disabled:opacity-50 transition active:scale-[0.98]"
            style={{ background: '#FF1F8F', boxShadow: '0 4px 12px rgba(255,31,143,0.30)' }}
          >
            {busy ? '저장 중…' : isEdit ? '수정 완료' : '리뷰 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
