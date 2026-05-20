'use client';

/**
 * LiveSlider — 모든 활성 LIVE 세션 가로 슬라이드
 *
 * - sessions 0개 또는 1개 → null (PrimaryLiveCard만으로 충분)
 * - sessions 2개 이상 → 가로 스크롤 카드 렌더
 *
 * 데이터: 부모 subscribeAllLiveSessions 결과를 props로 전달 (신규 호출 0)
 */

import Link from 'next/link';
import type { LiveSession } from '@/lib/live';
import { useLiveCountdown } from '@/lib/live';

interface Props {
  sessions: LiveSession[];
  thumbnails?: Record<string, string | undefined>;
}

function statusDot(s: LiveSession): string {
  if (s.status === 'running') return '#22c55e';
  if (s.status === 'break') return '#f59e0b';
  if (s.status === 'paused') return '#94a3b8';
  return 'var(--live)';
}

function MiniCountdown({ session }: { session: LiveSession }) {
  const sec = useLiveCountdown(session);
  if (session.status !== 'running') return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (
    <span className="font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

function SliderCard({ session, thumbnail }: { session: LiveSession; thumbnail?: string }) {
  const dotColor = statusDot(session);

  return (
    <Link
      href={`/m/store/${session.storeId}`}
      className="flex-shrink-0 w-[148px] rounded-xl overflow-hidden transition active:scale-[0.97]"
      style={{
        border: '1.5px solid var(--border)',
        background: 'var(--surface-1)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
      }}
      aria-label={`${session.storeName} LIVE`}
    >
      {/* 썸네일 */}
      <div
        className="relative w-full"
        style={{ aspectRatio: '4 / 3', background: 'var(--surface-3)' }}
      >
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(135deg, #1A0830 0%, #2E0418 100%)' }}
            aria-hidden="true"
          />
        )}
        {/* LIVE 배지 */}
        <span
          className="absolute top-1.5 left-1.5 flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full"
          style={{ background: 'rgba(220,38,38,0.92)', color: '#fff' }}
        >
          <span
            className="w-1 h-1 rounded-full flex-shrink-0"
            style={{ background: dotColor }}
            aria-hidden="true"
          />
          LIVE
        </span>
      </div>

      {/* 정보 */}
      <div className="px-2.5 py-2">
        <div
          className="text-[13px] font-bold leading-tight truncate"
          style={{ color: 'var(--text-1)' }}
        >
          {session.storeName}
        </div>
        <div
          className="text-[11px] mt-0.5 truncate"
          style={{ color: 'var(--text-2)' }}
        >
          {session.tournamentName}
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>
            {session.playersRemaining}명 · Lv.{session.currentLevel}
          </span>
          <MiniCountdown session={session} />
        </div>
      </div>
    </Link>
  );
}

export default function LiveSlider({ sessions, thumbnails }: Props) {
  // 0개 또는 1개면 PrimaryLiveCard가 단독 처리 → 슬라이더 불필요
  if (sessions.length <= 1) return null;

  return (
    <section aria-label="전체 LIVE 목록" className="pt-2 pb-3">
      {/* 섹션 헤더 */}
      <div className="px-4 flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0 pulse-live"
            style={{ background: 'var(--live)' }}
            aria-hidden="true"
          />
          <span className="text-[13px] font-extrabold" style={{ color: 'var(--text-1)' }}>
            지금 LIVE
          </span>
          <span
            className="text-[10px] font-extrabold rounded-full px-2 py-0.5"
            style={{ background: 'var(--live)', color: '#fff' }}
          >
            {sessions.length}
          </span>
        </div>
        <Link
          href="/m/live"
          className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60"
          style={{ color: 'var(--brand)' }}
        >
          전체보기
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </Link>
      </div>

      {/* 가로 슬라이드 */}
      <div
        className="pl-4 flex gap-2.5 overflow-x-auto pb-1 scrollbar-none"
        role="list"
      >
        {sessions.map((s) => (
          <div key={s.id} role="listitem">
            <SliderCard session={s} thumbnail={thumbnails?.[s.storeId]} />
          </div>
        ))}
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>
    </section>
  );
}
