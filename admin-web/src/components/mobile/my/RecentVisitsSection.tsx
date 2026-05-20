'use client';

/**
 * RecentVisitsSection — 최근 방문 매장 가로 슬라이드 (내정보 탭용)
 *
 * - localStorage에서 getRecentVisits() 읽기
 * - 0개면 빈 상태 안내 카드 표시
 * - 최대 5개 표시 (슬라이드)
 * - 각 카드: 매장 사진 + 매장명 + "리뷰 쓰기 →" 버튼 (placeholder)
 * - 카드 클릭 → /m/store/{storeId}
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getRecentVisits, type RecentVisit } from '@/lib/recentVisits';

const MAX_DISPLAY = 5;

function VisitCard({ visit }: { visit: RecentVisit }) {
  const dateLabel = (() => {
    try {
      const d = new Date(visit.visitedAt);
      const diff = Date.now() - d.getTime();
      const min = Math.floor(diff / 60_000);
      if (min < 60) return `${min}분 전`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr}시간 전`;
      const day = Math.floor(hr / 24);
      if (day < 7) return `${day}일 전`;
      return `${d.getMonth() + 1}/${d.getDate()}`;
    } catch {
      return '';
    }
  })();

  return (
    <div
      className="flex-shrink-0 w-[140px] rounded-xl overflow-hidden"
      style={{
        border: '1.5px solid var(--border)',
        background: 'var(--surface-1)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
      {/* 카드 전체를 매장 상세로 이동 */}
      <Link
        href={`/m/store/${visit.storeId}`}
        className="block transition active:scale-[0.97]"
        aria-label={`${visit.storeName} 매장 상세`}
      >
        {/* 매장 사진 */}
        <div
          className="relative w-full"
          style={{ aspectRatio: '4 / 3', background: 'var(--surface-3)' }}
        >
          {visit.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={visit.photoUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #1A0830 0%, #2E0418 100%)' }}
              aria-hidden="true"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </div>
          )}
          {/* 방문 날짜 배지 */}
          {dateLabel && (
            <span
              className="absolute bottom-1.5 right-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.9)' }}
            >
              {dateLabel}
            </span>
          )}
        </div>

        {/* 매장명 */}
        <div className="px-2.5 pt-2 pb-1">
          <div
            className="text-[13px] font-bold leading-tight truncate"
            style={{ color: 'var(--text-1)' }}
          >
            {visit.storeName}
          </div>
        </div>
      </Link>

      {/* 리뷰 쓰기 버튼 — placeholder (v0.5+ 활성화) */}
      <div className="px-2.5 pb-2.5">
        <Link
          href={`/m/store/${visit.storeId}`}
          className="block w-full text-center text-[11px] font-semibold py-1.5 rounded-lg transition active:opacity-70"
          style={{
            border: '1px solid var(--border)',
            color: 'var(--text-3)',
            background: 'var(--surface-2)',
          }}
          aria-label={`${visit.storeName} 리뷰 쓰기`}
        >
          리뷰 쓰기 →
        </Link>
      </div>
    </div>
  );
}

export default function RecentVisitsSection() {
  const [visits, setVisits] = useState<RecentVisit[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setVisits(getRecentVisits().slice(0, MAX_DISPLAY));
  }, []);

  // SSR 중엔 렌더 스킵 (localStorage 미접근)
  if (!mounted) return null;

  return (
    <section
      aria-label="최근 방문 매장"
      className="py-5"
      style={{ borderBottom: '6px solid var(--surface-2)' }}
    >
      {/* 섹션 헤더 */}
      <div className="px-5 flex items-center gap-2 mb-3">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
        </svg>
        <span className="text-[16px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          최근 방문 매장
        </span>
        {visits.length > 0 && (
          <span
            className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full"
            style={{ background: 'var(--surface-3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
          >
            {visits.length}
          </span>
        )}
      </div>

      {visits.length === 0 ? (
        /* 빈 상태 */
        <div className="mx-5 rounded-xl px-4 py-5 flex flex-col items-center text-center gap-2"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
          role="status"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <div className="text-[13px] font-bold" style={{ color: 'var(--text-2)' }}>
            아직 방문 기록이 없어요
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            매장을 방문하면 여기서 확인할 수 있어요.
          </div>
          <Link
            href="/m/find"
            className="mt-1 text-[12px] font-bold px-3 py-1.5 rounded-xl transition active:opacity-70"
            style={{ background: 'var(--brand)', color: '#fff' }}
          >
            매장 둘러보기
          </Link>
        </div>
      ) : (
        /* 가로 슬라이드 */
        <div className="pl-5 flex gap-2.5 overflow-x-auto scrollbar-none pb-1" role="list">
          {visits.map((v) => (
            <div key={v.storeId} role="listitem">
              <VisitCard visit={v} />
            </div>
          ))}
          <div className="w-3 flex-shrink-0" aria-hidden="true" />
        </div>
      )}
    </section>
  );
}
