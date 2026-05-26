'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createCheckIn,
  CheckInGuardError,
  CHECKIN_COMMENT_MAX,
} from '@/lib/checkIns';
import { completeReservationByCheckIn } from '@/lib/reservations';

/**
 * 매장 체크인 바텀시트 — 소셜 v0.1
 *
 * 메모리: project_social_feature_plan v0.1
 *  - 한 줄 후기(comment)는 선택, 60자 한도
 *  - 1일 1매장 1회 — rate_limit 에러는 친화적 메시지
 *  - 별도 알림/팔로우/좋아요 없음 (범위 외)
 */

interface Props {
  storeId: string;
  storeName: string;
  authorUid: string;
  authorName: string;
  authorAvatarUrl?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function CheckInSheet({
  storeId,
  storeName,
  authorUid,
  authorName,
  authorAvatarUrl,
  onClose,
  onSuccess,
}: Props) {
  const [comment, setComment] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // ESC 닫기 + body 스크롤 잠금
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const remaining = CHECKIN_COMMENT_MAX - comment.length;
  const tooLong = remaining < 0;

  const handleSubmit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await createCheckIn({
        uid: authorUid,
        displayName: authorName || '플레이어',
        avatarUrl: authorAvatarUrl,
        storeId,
        storeName,
        comment: comment.trim() || undefined,
      });
      // 예약 ↔ 체크인 통합 (PM 2026-05-27):
      // 같은 매장 활성 예약(pending/confirmed)을 자동 completed로 전환 → 1매장 잠금 해제.
      // 실패해도 cron(autoCompleteReservations)이 입장시간+2h에 백업 정리.
      completeReservationByCheckIn(authorUid, storeId).catch(() => { /* silent */ });
      onSuccess?.();
      onClose();
    } catch (err) {
      if (err instanceof CheckInGuardError) {
        setError(err.message);
      } else {
        setError('체크인 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${storeName} 체크인`}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* 백드롭 */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} aria-hidden />

      {/* 시트 */}
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-md mx-auto rounded-t-3xl sm:rounded-3xl admin-mobile-sheet"
        style={{
          background: 'var(--surface-1)',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.18)',
          paddingBottom: 'env(safe-area-inset-bottom, 12px)',
        }}
      >
        {/* 핸들 */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--border)' }} />
        </div>

        <div className="px-5 pt-4 pb-5">
          {/* 헤더 */}
          <div className="flex items-center gap-2 mb-3">
            <span aria-hidden style={{ fontSize: 22 }}>✅</span>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-extrabold leading-tight truncate" style={{ color: 'var(--text-1)' }}>
                {storeName} 체크인
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                매장에 다녀온 인증을 친구들에게 공유해요
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="w-9 h-9 flex items-center justify-center rounded-full transition active:scale-95"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* 한 줄 후기 (선택) */}
          <label className="block">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
                한 줄 후기 <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>(선택)</span>
              </span>
              <span
                className="text-[11px] font-semibold tabular-nums"
                style={{ color: tooLong ? 'var(--live)' : 'var(--text-3)' }}
              >
                {comment.length} / {CHECKIN_COMMENT_MAX}
              </span>
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, CHECKIN_COMMENT_MAX + 20))}
              placeholder="오늘 분위기 어땠나요? (예: 사람 많고 분위기 좋아요)"
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl text-[14px] leading-relaxed resize-none outline-none transition"
              style={{
                background: 'var(--surface-2)',
                border: `1.5px solid ${tooLong ? 'var(--live)' : 'var(--border)'}`,
                color: 'var(--text-1)',
              }}
              maxLength={CHECKIN_COMMENT_MAX + 20}
            />
          </label>

          {/* 가이드 */}
          <div
            className="text-[11px] mt-2 leading-relaxed"
            style={{ color: 'var(--text-3)' }}
          >
            체크인은 홈 “지금 다녀온 사람들” 섹션에 24시간 노출됩니다. 한 매장은 24시간에 1번만 체크인할 수 있어요.
          </div>

          {/* 에러 */}
          {error && (
            <div
              role="alert"
              className="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold"
              style={{ background: '#FFE4EC', color: '#9F1239', border: '1px solid #FBB6CE' }}
            >
              {error}
            </div>
          )}

          {/* CTA */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="h-12 rounded-2xl font-bold text-[14px] transition active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={busy || tooLong}
              className="h-12 rounded-2xl font-extrabold text-[14px] text-white transition active:scale-[0.98] disabled:opacity-60"
              style={{
                background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BB5 100%)',
                boxShadow: '0 4px 14px rgba(255,31,143,0.30)',
              }}
            >
              {busy ? '저장 중…' : '체크인'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
