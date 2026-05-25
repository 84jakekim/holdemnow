'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type JobOffer,
  JOB_ROLE_LABELS,
  SHIFT_LABELS,
  formatWage,
  formatRelativeTime,
  subscribeJobItem,
} from '@/lib/community';
import BlockedContentNotice from '@/components/mobile/BlockedContentNotice';

/* ============================================================
 * /m/community/jobs/[id] — 구인 상세
 * 데이터: PLACEHOLDER_JOBS 조회 (부모 에이전트가 Firestore로 교체)
 * ========================================================== */

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [job, setJob] = useState<JobOffer | null | undefined>(undefined);
  const [imgIndex, setImgIndex] = useState(0);

  useEffect(() => {
    const unsub = subscribeJobItem(id, setJob, () => setJob(null));
    return unsub;
  }, [id]);

  if (job === undefined) {
    return (
      <div className="min-h-screen p-5 space-y-3" style={{ background: 'var(--bg)' }}>
        <div className="skel h-14 rounded-r-md" />
        <div className="skel h-48 rounded-r-xl" />
        <div className="skel h-24 rounded-r-xl" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--bg)' }}>
        <div className="empty-state w-full max-w-sm">
          <div className="empty-state-icon" aria-hidden>🔍</div>
          <div>
            <div className="empty-state-title">구인 공고를 찾을 수 없어요</div>
            <div className="empty-state-desc" style={{ marginTop: 6 }}>
              삭제되었거나 마감된 공고일 수 있어요.
            </div>
          </div>
          <button
            onClick={() => router.back()}
            className="btn-brand tap px-5 py-2.5 text-[13px]"
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  // 모더레이션 차단(hidden) — 일반 사용자 직접 URL 진입 방어
  if (job.status === 'hidden') {
    return (
      <BlockedContentNotice
        title="더 이상 노출되지 않는 공고입니다"
        description="작성자가 내렸거나 본사 모더레이션으로 차단되었습니다."
        backHref="/m/community/jobs"
        backLabel="구인 목록으로"
      />
    );
  }

  const isClosed = job.status === 'closed' || job.status === 'expired';
  const hasImages = job.images && job.images.length > 0;
  const hasContact = job.contact?.kakaoOpenChat || job.contact?.phone;

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', paddingBottom: hasContact ? 88 : 32 }}>
      {/* ── 헤더 (핑크 액센트 라인) ── */}
      <header
        className="sticky top-0 z-30 flex items-center h-14 px-4 gap-3"
        style={{
          background: 'rgba(255,255,255,0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '2px solid rgba(255,31,143,0.18)',
        }}
      >
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          className="w-9 h-9 flex items-center justify-center rounded-full tap active:bg-[var(--surface-2)] flex-shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <div className="flex-1 text-center section-title" style={{ margin: 0 }}>
          💼 구인 상세
        </div>
        {/* 공유 */}
        <button
          aria-label="공유"
          className="w-9 h-9 flex items-center justify-center rounded-full transition active:bg-[var(--surface-2)] flex-shrink-0"
          onClick={() => {
            if (typeof navigator !== 'undefined' && navigator.share) {
              navigator.share({ title: job.title, url: window.location.href }).catch(() => {});
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/>
          </svg>
        </button>
      </header>

      {/* ── 마감 배너 (마감된 공고만) ── */}
      {isClosed && (
        <div
          className="px-4 py-3 flex items-center gap-2"
          style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span className="text-[13px] font-bold" style={{ color: 'var(--text-3)' }}>이 공고는 마감되었습니다</span>
        </div>
      )}

      {/* ── 매장 헤더 ── */}
      <div
        className="px-4 py-4 flex items-center gap-3"
        style={{
          background: 'var(--surface-1)',
          borderBottom: '1px solid var(--border)',
          opacity: isClosed ? 0.6 : 1,
        }}
      >
        <div
          className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden"
          style={{ background: 'var(--surface-2)' }}
        >
          {job.storePhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.storePhotoUrl} alt={job.storeName ?? ''} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xl" aria-hidden="true">🏠</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-extrabold truncate" style={{ color: 'var(--text-1)' }}>
            {job.storeName ?? '매장명 미정'}
          </div>
          {job.storeId && (
            <Link
              href={`/m/store/${job.storeId}`}
              className="text-[12px] font-medium flex items-center gap-0.5 mt-0.5 transition active:opacity-60"
              style={{ color: 'var(--brand)' }}
            >
              이 매장 상세 보기
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </Link>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            {formatRelativeTime(job.createdAt)}
          </div>
          {job.region && (
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {job.region}
            </div>
          )}
        </div>
      </div>

      {/* ── 핵심 정보 박스 ── */}
      <div
        className="mx-4 mt-4 rounded-2xl p-4"
        style={{
          background: isClosed ? 'var(--surface-2)' : 'linear-gradient(135deg, rgba(255,31,143,0.06) 0%, rgba(255,31,143,0.02) 100%)',
          border: `1px solid ${isClosed ? 'var(--border)' : 'rgba(255,31,143,0.18)'}`,
          opacity: isClosed ? 0.7 : 1,
        }}
      >
        <h2 className="text-[18px] font-extrabold tracking-tight mb-3" style={{ color: 'var(--text-1)' }}>
          {job.title}
        </h2>

        <div className="flex items-center gap-2 flex-wrap">
          {/* 직무 */}
          <span
            className="text-[12px] font-bold px-2.5 py-1 rounded-full"
            style={{
              background: isClosed ? 'var(--surface-2)' : 'rgba(255,31,143,0.12)',
              color: isClosed ? 'var(--text-3)' : '#FF1F8F',
            }}
          >
            {JOB_ROLE_LABELS[job.role]}
          </span>
          {/* 근무시간 칩 */}
          {job.shift.map((s) => (
            <span
              key={s}
              className="text-[12px] font-medium px-2.5 py-1 rounded-full"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
              {SHIFT_LABELS[s]}
            </span>
          ))}
        </div>

        {/* 시급 — 핵심 강조 */}
        <div
          className="text-[28px] font-extrabold tracking-tight mt-3 stat-number"
          style={{ color: isClosed ? 'var(--text-3)' : '#FF1F8F' }}
        >
          {formatWage(job.wage)}
        </div>
      </div>

      {/* ── 이미지 갤러리 (있을 때만) ── */}
      {hasImages && (
        <div className="mt-4">
          <div className="relative overflow-hidden" style={{ aspectRatio: '16/9' }}>
            {/* 가로 스와이프 — 실제 터치 이벤트는 부모 에이전트가 Swiper 또는 useSwipe로 구현 */}
            <div
              className="flex transition-transform duration-300"
              style={{ transform: `translateX(-${imgIndex * 100}%)`, height: '100%' }}
            >
              {job.images!.slice(0, 4).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt={`구인 이미지 ${i + 1}`}
                  className="flex-shrink-0 w-full h-full object-cover"
                />
              ))}
            </div>
            {/* 인디케이터 도트 */}
            {job.images!.length > 1 && (
              <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1" aria-hidden="true">
                {job.images!.slice(0, 4).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setImgIndex(i)}
                    className="w-1.5 h-1.5 rounded-full transition"
                    style={{ background: i === imgIndex ? '#fff' : 'rgba(255,255,255,0.5)' }}
                    aria-label={`이미지 ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 본문 ── */}
      <div className="px-4 mt-4">
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        >
          <h3 className="text-[13px] font-bold mb-2" style={{ color: 'var(--text-2)' }}>상세 내용</h3>
          <pre
            className="text-[14px] leading-relaxed font-sans"
            style={{
              color: 'var(--text-1)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              opacity: isClosed ? 0.6 : 1,
            }}
          >
            {job.body || '상세 내용이 없습니다.'}
          </pre>
        </div>
      </div>

      {/* ── 만료일 표시 ── */}
      {job.expiresAt && (
        <div className="px-4 mt-2">
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            공고 마감: {new Date(job.expiresAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      )}

      {/* ── sticky CTA (연락처 있을 때만) ── */}
      {hasContact && !isClosed && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 px-4 py-3 flex gap-2"
          style={{
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderTop: '1px solid var(--border)',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          {job.contact?.kakaoOpenChat && (
            <a
              href={job.contact.kakaoOpenChat}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl text-[15px] font-extrabold transition active:opacity-80"
              style={{ background: '#FEE500', color: '#191919' }}
              aria-label="카카오 오픈채팅으로 지원"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 3C6.477 3 2 6.58 2 11c0 2.75 1.57 5.17 3.97 6.67L5 21l3.32-1.77C9.39 19.72 10.67 20 12 20c5.523 0 10-3.58 10-9s-4.477-8-10-8z"/>
              </svg>
              카카오 오픈채팅
            </a>
          )}
          {job.contact?.phone && (
            <a
              href={`tel:${job.contact.phone}`}
              className="flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl text-[15px] font-extrabold transition active:opacity-80"
              style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}
              aria-label={`전화 ${job.contact.phone}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.7A2 2 0 012.18 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.15a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
              </svg>
              전화 연락
            </a>
          )}
        </div>
      )}
    </div>
  );
}
