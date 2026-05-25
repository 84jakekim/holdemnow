'use client';

/**
 * 본사 어드민 — 리뷰 관리 페이지 (관제센터).
 *
 * - collectionGroup('reviews') 최근 100건 실시간 모니터링
 * - 노출 상태(전체/공개/숨김) · 별점(1~5) 필터
 * - hideReview / unhideReview (platform_admin rules에서 강제)
 * - 카드 클릭 시 매장 상세(/m/store/{storeId})로 이동, 본문은 펼침
 *
 * 시각:
 *   - 다크 본사 어드민 톤
 *   - 카드: surface-1 + 핑크 border-left 4px
 *   - 숨김 리뷰: opacity 0.55 + "숨김 처리됨" 배지
 *   - 상대시각 (3일 전) + hover 절대시각
 *
 * 모바일 폭 미대응 — 어드민 데스크탑 위주.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Timestamp, doc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import {
  subscribeRecentReviews,
  subscribeRecentReports,
  hideReview,
  unhideReview,
  type Review,
  type Report,
  type ReportReason,
} from '@/lib/reviews';

type VisibilityFilter = 'all' | 'visible' | 'hidden';
type RatingFilter = 'all' | 1 | 2 | 3 | 4 | 5;

const PINK = '#EC4899';

// 신고 사유 라벨 (UI 표시용)
const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  spam: '스팸/도배',
  offensive: '욕설/혐오',
  misinformation: '허위정보',
  advertising: '광고/홍보',
  other: '기타',
};

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────

function tsToMs(t?: Timestamp | null): number | null {
  if (!t || typeof t.toMillis !== 'function') return null;
  try {
    return t.toMillis();
  } catch {
    return null;
  }
}

function tsToDate(t?: Timestamp | null): Date | null {
  if (!t || typeof t.toDate !== 'function') return null;
  try {
    return t.toDate();
  } catch {
    return null;
  }
}

/** "3일 전", "15분 전" 같은 상대시각. 미래/이상치는 "방금". */
function relTime(t?: Timestamp | null): string {
  const ms = tsToMs(t);
  if (ms == null) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return '방금';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}일 전`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}개월 전`;
  return `${Math.floor(mon / 12)}년 전`;
}

/** "2026/05/20 14:23:11" hover 표시용. */
function absTime(t?: Timestamp | null): string {
  const d = tsToDate(t);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function StarRow({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span aria-label={`별점 ${r}`} style={{ color: 'var(--gold)', letterSpacing: 1 }}>
      {'★'.repeat(r)}
      <span style={{ color: 'var(--text-3)' }}>{'★'.repeat(5 - r)}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────────

export default function PlatformReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  const [rating, setRating] = useState<RatingFilter>('all');

  useEffect(() => {
    const unsub = subscribeRecentReviews(
      100,
      (items) => {
        setReviews(items);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeRecentReports(
      200,
      (items) => {
        // 리뷰 신고만 필터
        setReports(items.filter((r) => r.targetType === 'review'));
      },
      () => {
        // 신고 구독 실패는 페이지 렌더 자체는 막지 않음 (리뷰는 계속 표시)
      },
    );
    return unsub;
  }, []);

  // reviewId(=targetId) 기준 신고 그룹핑 — 미처리(resolved=false)만 카운트
  const reportsByReviewId = useMemo(() => {
    const map = new Map<string, Report[]>();
    for (const rep of reports) {
      if (rep.resolved) continue;
      const list = map.get(rep.targetId) ?? [];
      list.push(rep);
      map.set(rep.targetId, list);
    }
    return map;
  }, [reports]);

  const filtered = useMemo(() => {
    return reviews.filter((r) => {
      if (visibility === 'visible' && r.hidden === true) return false;
      if (visibility === 'hidden' && r.hidden !== true) return false;
      if (rating !== 'all' && Math.round(r.rating) !== rating) return false;
      return true;
    });
  }, [reviews, visibility, rating]);

  const totalCount = reviews.length;
  const hiddenCount = reviews.filter((r) => r.hidden === true).length;
  const visibleCount = totalCount - hiddenCount;
  const reportedCount = reportsByReviewId.size;

  return (
    <div>
      {/* 헤더 */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="section-title" style={{ color: 'var(--gold)' }}>REVIEW MODERATION</div>
          <h1 className="h2" style={{ color: 'var(--text-1)' }}>
            ⭐ 리뷰 관리
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
            최근 100건 실시간 · 부적절 리뷰는 숨김 처리하여 모바일 노출을 차단합니다.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
          <span>
            전체 <b style={{ color: 'var(--text-1)' }}>{totalCount}</b>
          </span>
          <span style={{ color: 'var(--text-3)' }}>·</span>
          <span>
            공개 <b style={{ color: 'var(--text-1)' }}>{visibleCount}</b>
          </span>
          <span style={{ color: 'var(--text-3)' }}>·</span>
          <span>
            숨김 <b style={{ color: PINK }}>{hiddenCount}</b>
          </span>
          <span style={{ color: 'var(--text-3)' }}>·</span>
          <span>
            신고 <b style={{ color: reportedCount > 0 ? '#EF4444' : 'var(--text-1)' }}>{reportedCount}</b>
          </span>
        </div>
      </div>

      {/* 필터 바 */}
      <div
        className="mb-5 flex flex-wrap items-center gap-3 p-3 rounded-xl"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
        }}
      >
        {/* 노출 상태 토글 */}
        <FilterGroup label="노출 상태">
          <SegBtn active={visibility === 'all'} onClick={() => setVisibility('all')}>
            전체
          </SegBtn>
          <SegBtn active={visibility === 'visible'} onClick={() => setVisibility('visible')}>
            공개
          </SegBtn>
          <SegBtn active={visibility === 'hidden'} onClick={() => setVisibility('hidden')}>
            숨김
          </SegBtn>
        </FilterGroup>

        <div style={{ width: 1, height: 24, background: 'var(--border)' }} aria-hidden />

        {/* 별점 토글 */}
        <FilterGroup label="별점">
          <SegBtn active={rating === 'all'} onClick={() => setRating('all')}>
            전체
          </SegBtn>
          {[1, 2, 3, 4, 5].map((n) => (
            <SegBtn key={n} active={rating === n} onClick={() => setRating(n as RatingFilter)}>
              {n}★
            </SegBtn>
          ))}
        </FilterGroup>
      </div>

      {/* 본문 */}
      {error && (
        <div
          className="mb-4 p-3 rounded-lg text-xs"
          style={{
            background: 'rgba(236, 72, 153, 0.08)',
            border: '1px solid rgba(236, 72, 153, 0.4)',
            color: PINK,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>
          로딩 중…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState reason={reviews.length === 0 ? 'none' : 'filtered'} />
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <ReviewCard
              key={`${r.storeId}/${r.id}`}
              review={r}
              reports={reportsByReviewId.get(r.id) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 카드
// ─────────────────────────────────────────────────────────────

function ReviewCard({ review, reports }: { review: Review; reports: Report[] }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const hidden = review.hidden === true;
  const reportCount = reports.length;
  // 자동 숨김 추정: hidden=true 이면서 hiddenBy가 null/system 또는 신고 ≥ 3건
  // (Cloud Function `autoHideOnReports`가 hidden=true 설정 시 hiddenBy를 'system' 또는 null로 둔다는 가정)
  const isAutoHidden =
    hidden &&
    reportCount > 0 &&
    (!review.hiddenBy || review.hiddenBy === 'system' || review.hiddenBy === 'auto');

  /** 미처리 신고 N건을 일괄 resolved 처리 (writeBatch) */
  const resolveReports = async (resolution: 'hide' | 'restore' | 'dismiss') => {
    if (reports.length === 0) return;
    const uid = auth.currentUser?.uid ?? null;
    const batch = writeBatch(db);
    for (const rep of reports) {
      batch.update(doc(db, 'reports', rep.id), {
        resolved: true,
        resolvedBy: uid,
        resolvedAt: serverTimestamp(),
        resolution,
      });
    }
    await batch.commit();
  };

  const onHide = async () => {
    if (!window.confirm(`이 리뷰를 숨김 처리할까요?\n모바일 사용자에게 노출되지 않습니다.`)) return;
    setBusy(true);
    try {
      await hideReview(review.storeId, review.id);
      // 신고가 있다면 함께 resolved 처리 (hide)
      await resolveReports('hide').catch(() => {});
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onUnhide = async () => {
    setBusy(true);
    try {
      await unhideReview(review.storeId, review.id);
      // 자동 숨김 잘못된 경우 — 신고도 restore로 처리
      await resolveReports('restore').catch(() => {});
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 자동 숨김 → 본사가 정식 숨김 확정 (hidden 유지 + reports.resolution='hide') */
  const onConfirmHide = async () => {
    if (!window.confirm(`자동 숨김된 리뷰를 본사 확정으로 숨김 처리할까요?`)) return;
    setBusy(true);
    try {
      // hiddenBy를 admin uid로 덮어써서 "사람 검토 완료" 마킹
      const uid = auth.currentUser?.uid ?? null;
      await updateDoc(doc(db, 'stores', review.storeId, 'reviews', review.id), {
        hidden: true,
        hiddenBy: uid,
        hiddenAt: serverTimestamp(),
      });
      await resolveReports('hide');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const photos = (review.photoUrls ?? []).slice(0, 3);
  const bodyTrimmed = review.body.length > 140 && !expanded ? review.body.slice(0, 140) + '…' : review.body;

  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${PINK}`,
        borderRadius: 12,
        padding: 16,
        opacity: hidden ? 0.55 : 1,
        transition: 'opacity 120ms',
      }}
    >
      {/* 자동 숨김 배지 (카드 상단) */}
      {isAutoHidden && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            fontWeight: 800,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'var(--surface-2)',
            color: 'var(--text-2)',
            border: '1px solid var(--border)',
            marginBottom: 8,
          }}
          title={
            reports
              .map((r) => `· ${REPORT_REASON_LABEL[r.reason]}${r.detail ? ` — ${r.detail.slice(0, 40)}` : ''}`)
              .join('\n') || '자동 숨김된 리뷰'
          }
        >
          <span aria-hidden>🤖</span>
          <span>자동 숨김 (신고 {reportCount}건)</span>
        </div>
      )}

      {/* 메타 라인 */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Link
          href={`/m/store/${review.storeId}`}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: 'var(--text-1)',
            textDecoration: 'none',
            borderBottom: '1px dashed var(--border)',
          }}
          title={`매장 상세 열기 (${review.storeId})`}
        >
          🏬 {review.storeId.slice(0, 8)}…
        </Link>
        <span style={{ color: 'var(--text-3)' }}>·</span>
        <StarRow rating={review.rating} />
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {review.rating.toFixed(1)}
        </span>
        <span style={{ color: 'var(--text-3)' }}>·</span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {review.authorName || <span style={{ color: 'var(--text-3)' }}>익명</span>}
        </span>
        <span style={{ color: 'var(--text-3)' }}>·</span>
        <span
          style={{ fontSize: 11, color: 'var(--text-3)', cursor: 'help' }}
          title={absTime(review.createdAt)}
        >
          {relTime(review.createdAt) || '시각 미상'}
        </span>
        {reportCount > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.04em',
              padding: '2px 8px',
              borderRadius: 999,
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#EF4444',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              marginLeft: hidden ? 0 : 'auto',
            }}
            title={
              reports
                .map((r) => `· ${REPORT_REASON_LABEL[r.reason]}${r.detail ? ` — ${r.detail.slice(0, 40)}` : ''}`)
                .join('\n') || `신고 ${reportCount}건`
            }
          >
            🚩 {reportCount}
          </span>
        )}
        {hidden && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.08em',
              padding: '2px 8px',
              borderRadius: 999,
              background: 'var(--surface-2)',
              color: 'var(--text-3)',
              border: '1px solid var(--border)',
              marginLeft: reportCount > 0 ? 0 : 'auto',
            }}
            title={
              review.hiddenAt
                ? `숨김 처리: ${absTime(review.hiddenAt)}${review.hiddenBy ? ` (by ${review.hiddenBy.slice(0, 6)}…)` : ''}`
                : '숨김 처리됨'
            }
          >
            🚫 숨김 처리됨
          </span>
        )}
      </div>

      {/* 본문 */}
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--text-1)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {bodyTrimmed}
        {review.body.length > 140 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginLeft: 6,
              fontSize: 11,
              fontWeight: 700,
              color: PINK,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {expanded ? '접기' : '더보기'}
          </button>
        )}
      </div>

      {/* 사진 */}
      {photos.length > 0 && (
        <div className="mt-3 flex gap-2">
          {photos.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'block',
                width: 96,
                height: 96,
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                flexShrink: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="리뷰 사진"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </a>
          ))}
          {photos.length < (review.photoUrls?.length ?? 0) && (
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-3)',
                fontSize: 11,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              +{(review.photoUrls?.length ?? 0) - photos.length}
            </div>
          )}
        </div>
      )}

      {/* 액션 바 */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {!hidden ? (
          <button
            onClick={onHide}
            disabled={busy}
            style={{
              fontSize: 12,
              fontWeight: 800,
              padding: '7px 14px',
              borderRadius: 8,
              background: 'rgba(236, 72, 153, 0.12)',
              color: PINK,
              border: `1px solid ${PINK}`,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            👁️ 숨김 처리
          </button>
        ) : isAutoHidden ? (
          <>
            <button
              onClick={onConfirmHide}
              disabled={busy}
              title="자동 숨김된 리뷰를 본사가 정식 숨김으로 확정 (resolution=hide)"
              style={{
                fontSize: 12,
                fontWeight: 800,
                padding: '7px 14px',
                borderRadius: 8,
                background: 'rgba(236, 72, 153, 0.12)',
                color: PINK,
                border: `1px solid ${PINK}`,
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              ✅ 확정 숨김
            </button>
            <button
              onClick={onUnhide}
              disabled={busy}
              title="자동 숨김이 잘못된 경우 복원 (resolution=restore)"
              style={{
                fontSize: 12,
                fontWeight: 800,
                padding: '7px 14px',
                borderRadius: 8,
                background: 'rgba(245, 158, 11, 0.12)',
                color: 'var(--gold)',
                border: '1px solid var(--gold)',
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              ↻ 복원
            </button>
          </>
        ) : (
          <button
            onClick={onUnhide}
            disabled={busy}
            style={{
              fontSize: 12,
              fontWeight: 800,
              padding: '7px 14px',
              borderRadius: 8,
              background: 'rgba(245, 158, 11, 0.12)',
              color: 'var(--gold)',
              border: '1px solid var(--gold)',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            ↻ 복원
          </button>
        )}
        <Link
          href={`/m/store/${review.storeId}`}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '7px 12px',
            borderRadius: 8,
            background: 'var(--surface-2)',
            color: 'var(--text-2)',
            border: '1px solid var(--border)',
            textDecoration: 'none',
          }}
        >
          매장 상세 →
        </Link>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: 'var(--text-3)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
          title={`리뷰 ID: ${review.id}`}
        >
          {review.id.slice(0, 10)}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 필터 UI
// ─────────────────────────────────────────────────────────────

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.12em',
          color: 'var(--text-3)',
        }}
      >
        {label}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12,
        fontWeight: 700,
        padding: '6px 12px',
        borderRadius: 8,
        background: active ? 'rgba(236, 72, 153, 0.12)' : 'transparent',
        color: active ? PINK : 'var(--text-2)',
        border: active ? `1px solid ${PINK}` : '1px solid var(--border)',
        cursor: 'pointer',
        transition: 'all 120ms',
      }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// 빈 상태
// ─────────────────────────────────────────────────────────────

function EmptyState({ reason }: { reason: 'none' | 'filtered' }) {
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '2px dashed var(--border)',
        borderRadius: 16,
        padding: 48,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 8 }}>⭐</div>
      <div style={{ fontWeight: 800, color: 'var(--text-1)', marginBottom: 6 }}>
        {reason === 'none' ? '최근 리뷰 없음' : '조건에 맞는 리뷰가 없습니다'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
        {reason === 'none'
          ? '아직 등록된 매장 리뷰가 없습니다. 사용자 활동이 시작되면 이 화면에 자동으로 나타납니다.'
          : '필터를 조정해 다시 시도해보세요.'}
      </div>
    </div>
  );
}
