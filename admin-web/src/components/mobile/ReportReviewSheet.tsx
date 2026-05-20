'use client';

/**
 * ReportReviewSheet — 리뷰 신고 바텀시트
 *
 * - 사유 선택(라디오) + 추가 설명(선택)
 * - 제출 시 reportReview(storeId, reviewId, uid, reason, detail) 호출
 * - hasReportedReview 로 이미 신고한 리뷰면 부모가 차단 (이 시트 자체는 항상 새 신고만 처리)
 * - 토스트 안내는 부모에서 출력
 */

import { useEffect, useState } from 'react';
import { reportReview, type ReportReason } from '@/lib/reviews';

type Props = {
  open: boolean;
  storeId: string;
  reviewId: string;
  uid: string;
  onClose: () => void;
  onSubmitted: () => void;
};

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: '스팸·홍보' },
  { value: 'offensive', label: '욕설·비방' },
  { value: 'misinformation', label: '허위 정보' },
  { value: 'advertising', label: '광고' },
  { value: 'other', label: '기타' },
];

export default function ReportReviewSheet({
  open,
  storeId,
  reviewId,
  uid,
  onClose,
  onSubmitted,
}: Props) {
  const [reason, setReason] = useState<ReportReason>('spam');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 오픈 시 스크롤 잠금 + 상태 리셋
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      setReason('spam');
      setDetail('');
      setError(null);
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // ESC로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await reportReview(storeId, reviewId, uid, reason, detail.trim() || undefined);
      onSubmitted();
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
      role="dialog"
      aria-modal="true"
      aria-label="리뷰 신고"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl px-5 pt-3 pb-6"
        style={{
          background: 'var(--surface-1)',
          maxHeight: '92vh',
          overflowY: 'auto',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
          animation: 'reportSlideUp 0.22s ease-out',
        }}
      >
        {/* 핸들 */}
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        <div className="text-[18px] font-extrabold mb-0.5" style={{ color: 'var(--text-1)' }}>
          리뷰 신고
        </div>
        <div className="text-[12px] mb-5" style={{ color: 'var(--text-3)' }}>
          신고된 리뷰는 검토 후 처리됩니다
        </div>

        {/* 사유 */}
        <div className="mb-5">
          <div className="text-[12px] font-bold mb-2" style={{ color: 'var(--text-2)' }}>
            신고 사유 <span style={{ color: '#FF1F8F' }}>*</span>
          </div>
          <div className="space-y-1.5">
            {REASONS.map((r) => {
              const selected = reason === r.value;
              return (
                <label
                  key={r.value}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition active:scale-[0.99]"
                  style={{
                    background: selected ? 'rgba(255,31,143,0.08)' : 'var(--surface-2)',
                    border: `1px solid ${selected ? 'rgba(255,31,143,0.35)' : 'var(--border)'}`,
                  }}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={selected}
                    onChange={() => setReason(r.value)}
                    className="sr-only"
                  />
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      border: `2px solid ${selected ? '#FF1F8F' : 'var(--border)'}`,
                      background: 'var(--surface-1)',
                    }}
                    aria-hidden="true"
                  >
                    {selected && (
                      <span className="w-2 h-2 rounded-full" style={{ background: '#FF1F8F' }} />
                    )}
                  </span>
                  <span
                    className="text-[13px] font-bold"
                    style={{ color: selected ? '#FF1F8F' : 'var(--text-1)' }}
                  >
                    {r.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* 추가 설명 */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-bold" style={{ color: 'var(--text-2)' }}>
              추가 설명 <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>(선택)</span>
            </div>
            <div className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
              {detail.length}/300
            </div>
          </div>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value.slice(0, 300))}
            rows={3}
            placeholder="추가로 알려주실 내용이 있다면 입력해주세요"
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none resize-none leading-relaxed"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
              minHeight: 80,
            }}
          />
        </div>

        {error && (
          <div
            className="mb-3 px-3 py-2 rounded-xl text-[12px] font-bold"
            style={{ background: 'rgba(229,62,62,0.10)', color: 'var(--live)' }}
          >
            {error}
          </div>
        )}

        {/* 액션 */}
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
            disabled={busy}
            className="flex-1 py-3 rounded-xl text-[14px] font-extrabold text-white disabled:opacity-50 transition active:scale-[0.98]"
            style={{ background: '#FF1F8F', boxShadow: '0 4px 12px rgba(255,31,143,0.30)' }}
          >
            {busy ? '신고 중…' : '신고하기'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes reportSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
