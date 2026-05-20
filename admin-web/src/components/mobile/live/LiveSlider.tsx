'use client';

/**
 * LiveSlider — 모든 활성 LIVE 세션을 작은 카드로 가로 슬라이드 (둘러보기 행)
 *
 * - sessions 0개 또는 1개 → null (PrimaryLiveCard 단독으로 충분)
 * - sessions 2개 이상 → 한 화면 3개 보이는 가로 슬라이드 (snap = 카드 1개)
 *
 * 큰 카드와 완전히 독립 스크롤. 동일 세션 중복 노출 (위=메인, 아래=둘러보기).
 *
 * 정보 우선순위: 타이머(24~28px) > 레벨/블라인드 > 티켓 > 매장명
 * 배경: 매장 사진(어둡게) 또는 그라디언트
 *
 * 데이터: 부모 subscribeAllLiveSessions 결과를 props로 전달 (신규 fetch 0)
 */

import Link from 'next/link';
import type { LiveSession } from '@/lib/live';
import { useLiveCountdown, fmtTime } from '@/lib/live';

interface Props {
  sessions: LiveSession[];
  thumbnails?: Record<string, string | undefined>;
}

/** 블라인드 축약: 1,000 → 1k, 2,000 → 2k */
function shortBlind(n: number): string {
  if (n >= 1000) return `${n / 1000}k`;
  return String(n);
}

function blindShort(s: LiveSession): string {
  const sb = shortBlind(s.smallBlind ?? 0);
  const bb = shortBlind(s.bigBlind ?? 0);
  return `${sb}/${bb}`;
}

function buyInShort(s: LiveSession): string {
  const b = s.buyIn;
  if (!b || b <= 0) return '';
  if (b >= 10000) return `${Math.floor(b / 10000)}만원`;
  return b.toLocaleString() + '원';
}

/* ──────────────────────────────────────────────
   작은 카드
────────────────────────────────────────────── */

function SmallCard({ session, thumbnail }: { session: LiveSession; thumbnail?: string }) {
  const sec = useLiveCountdown(session);
  const isRunning = session.status === 'running';
  const buyIn = buyInShort(session);

  return (
    <Link
      href={`/m/store/${session.storeId}`}
      className="flex-shrink-0 rounded-xl overflow-hidden transition active:scale-[0.97] block relative"
      style={{
        /* 한 화면 3개 + peek: (뷰포트 - 좌패딩16 - 우여백16 - gap12×2) / 3.3 */
        width: 'calc((100vw - 32px - 24px) / 3.3)',
        minHeight: 120,
        background: 'var(--surface-1)',
        border: '1.5px solid rgba(255,255,255,0.08)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.14)',
        scrollSnapAlign: 'start',
      }}
      aria-label={`${session.storeName} LIVE`}
    >
      {/* 배경 이미지 — 컬러 살림 (큰 카드와 동일 정책) */}
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnail}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: 0.85 }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, #1A0830 0%, #2E0418 100%)' }}
          aria-hidden="true"
        />
      )}
      {/* 하단 그라데이션만 — 회색톤 제거, 텍스트 가독성 영역만 어둡게 */}
      <div
        className="absolute inset-0"
        style={{
          background: thumbnail
            ? 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.70) 65%, rgba(0,0,0,0.92) 100%)'
            : 'rgba(0,0,0,0.25)',
        }}
        aria-hidden="true"
      />

      {/* 콘텐츠 — 하단 정렬 (큰 카드와 동일) */}
      <div className="relative z-10 flex flex-col h-full px-2 pt-2 pb-2 gap-0 justify-end">

        {/* LIVE 배지 */}
        <div className="mb-1">
          <span
            className="inline-flex items-center gap-0.5 text-[8px] font-extrabold px-1 py-0.5 rounded-full"
            style={{ background: 'rgba(220,38,38,0.9)', color: '#fff' }}
          >
            <span
              className="w-1 h-1 rounded-full pulse-live flex-shrink-0"
              style={{ background: '#fff' }}
              aria-hidden="true"
            />
            LIVE
          </span>
        </div>

        {/* 매장명 */}
        <div
          className="text-[11px] font-extrabold leading-tight truncate mb-0.5"
          style={{ color: '#fff' }}
        >
          {session.storeName}
        </div>

        {/* 타이머 — 가장 크게 */}
        <div
          className="font-mono font-extrabold leading-none tabular-nums mb-0.5"
          style={{
            fontSize: '20px',
            color: isRunning ? '#fff' : 'rgba(255,255,255,0.50)',
            letterSpacing: '-0.02em',
          }}
          aria-label={`남은 시간 ${fmtTime(sec)}`}
        >
          {fmtTime(sec)}
        </div>

        {/* 레벨 + 블라인드 */}
        <div
          className="text-[9px] font-bold leading-none mb-1"
          style={{ color: 'rgba(255,255,255,0.80)' }}
        >
          Lv.{session.currentLevel} · {blindShort(session)}
        </div>

        {/* buy-in */}
        {buyIn && (
          <div
            className="text-[9px] font-semibold leading-none"
            style={{ color: 'rgba(255,255,255,0.65)' }}
          >
            🎫 {buyIn}
          </div>
        )}
      </div>
    </Link>
  );
}

/* ──────────────────────────────────────────────
   메인 컴포넌트
────────────────────────────────────────────── */

export default function LiveSlider({ sessions, thumbnails }: Props) {
  // 0개 또는 1개면 PrimaryLiveCard가 단독 처리 → 슬라이더 불필요
  if (sessions.length <= 1) return null;

  return (
    <section aria-label="LIVE 둘러보기" className="pt-2 pb-3">
      {/* 서브 타이틀 */}
      <div className="px-4 mb-2">
        <span
          className="text-[11px] font-semibold"
          style={{ color: 'var(--text-3)' }}
        >
          전체 {sessions.length}개 진행 중
        </span>
      </div>

      {/* 가로 슬라이드 — snap = 카드 1개, 한 화면 3.3개 노출 (peek) */}
      <div className="relative">
        <div
          className="pl-4 flex gap-3 overflow-x-auto pb-1 scrollbar-none"
          style={{
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
          }}
          role="list"
        >
          {sessions.map((s) => (
            <div
              key={s.id}
              role="listitem"
            >
              <SmallCard session={s} thumbnail={thumbnails?.[s.storeId]} />
            </div>
          ))}
          {/* 오른쪽 여백 */}
          <div className="w-3 flex-shrink-0" aria-hidden="true" />
        </div>
        {/* 우측 페이드 — 스와이프 어포던스 */}
        <div
          className="absolute right-0 top-0 bottom-0 w-10 pointer-events-none"
          style={{ background: 'linear-gradient(to right, transparent, var(--bg))' }}
          aria-hidden="true"
        />
      </div>
    </section>
  );
}
