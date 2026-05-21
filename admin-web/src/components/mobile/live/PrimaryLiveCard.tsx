'use client';

/**
 * PrimaryLiveCard — 모든 running LIVE 세션을 큰 카드로 가로 스와이프 표시
 *
 * 디자인 원칙: 정보가 메인, 매장 사진은 어두운 배경
 * 우선순위: 타이머(40~48px mono) > 레벨/블라인드(16~18px) > 티켓(14px) > Late reg > 인원
 *
 * - sessions 0개 → 빈 상태 placeholder
 * - sessions 1개 → 단일 큰 카드 (스와이프 없음)
 * - sessions 2개 이상 → 가로 scroll-snap 스와이프 (1개씩)
 *
 * 데이터: 부모 subscribeAllLiveSessions 결과를 props로 전달 (신규 fetch 0)
 */

import Link from 'next/link';
import type { LiveSession } from '@/lib/live';
import {
  useLiveCountdown,
  computeLateRegMinutes,
  computeRemainingSec,
  fmtTime,
} from '@/lib/live';
import { fmtBuyInTicketsMobile } from '@/lib/templates';

interface Props {
  sessions: LiveSession[];
  /** storeId → 매장 썸네일 URL */
  thumbnails?: Record<string, string | undefined>;
}

/** running 세션 정렬: playersRemaining 내림차순 → startedAt 최근순 */
function sortRunning(sessions: LiveSession[]): LiveSession[] {
  return [...sessions].sort((a, b) => {
    const diff = (b.playersRemaining ?? 0) - (a.playersRemaining ?? 0);
    if (diff !== 0) return diff;
    const aMs = (a.startedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    const bMs = (b.startedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    return bMs - aMs;
  });
}

/** 상태 라벨 */
function statusLabel(s: LiveSession): string {
  if (s.status === 'running') return '진행 중';
  if (s.status === 'paused') return '일시정지';
  if (s.status === 'break') return '브레이크';
  return 'LIVE';
}

/** 블라인드 포맷: SB/BB (Ante A) */
function blindLabel(s: LiveSession): string {
  const sb = s.smallBlind?.toLocaleString() ?? '?';
  const bb = s.bigBlind?.toLocaleString() ?? '?';
  const ante = s.ante;
  if (ante && ante > 0) {
    return `${sb}/${bb} (Ante ${ante.toLocaleString()})`;
  }
  return `${sb}/${bb}`;
}

/** buy-in 포맷 — 사용자 앱은 티켓 단위 ("5 Ticket"). 1티켓=10,000원. */
function buyInLabel(s: LiveSession): string {
  return fmtBuyInTicketsMobile(s.buyIn ?? 0);
}

/* ──────────────────────────────────────────────
   개별 큰 카드
────────────────────────────────────────────── */

function BigCard({
  session,
  thumbnail,
}: {
  session: LiveSession;
  thumbnail?: string;
}) {
  const sec = useLiveCountdown(session);
  const lateRegMin = computeLateRegMinutes(session, computeRemainingSec(session));
  const isLateRegOpen = !session.lateRegClosed && session.currentLevel <= session.lateRegEndLevel && lateRegMin > 0;
  const isRunning = session.status === 'running';
  const buyIn = buyInLabel(session);

  return (
    <Link
      href={`/m/store/${session.storeId}`}
      className="relative flex-shrink-0 w-full rounded-2xl overflow-hidden transition active:scale-[0.985] block"
      style={{
        background: 'var(--surface-1)',
        border: '1.5px solid rgba(255,255,255,0.08)',
        boxShadow: '0 6px 28px rgba(0,0,0,0.22)',
        // 고정 높이 — 컨텐츠 양(레이트 레지 줄 유무 등)에 따라 카드 사이즈가 변하지 않도록 통일
        height: 280,
      }}
      aria-label={`${session.storeName} LIVE — ${session.tournamentName}`}
    >
      {/* 배경: 매장 사진 (컬러 살림) 또는 그라디언트 */}
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
          style={{
            background: 'linear-gradient(135deg, #1A0830 0%, #2E0418 50%, #0A0E0C 100%)',
          }}
          aria-hidden="true"
        />
      )}

      {/* 하단 그라데이션 오버레이 — 텍스트 가독성 (상단 사진 컬러는 유지) */}
      <div
        className="absolute inset-0"
        style={{
          background: thumbnail
            ? 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0.65) 55%, rgba(0,0,0,0.90) 100%)'
            : 'rgba(0,0,0,0.35)',
        }}
        aria-hidden="true"
      />

      {/* 콘텐츠 레이어 — 상단 배지/매장명 + 하단 정렬 정보 */}
      <div className="relative z-10 flex flex-col h-full px-4 pt-3.5 pb-4">

        {/* ── 상단: LIVE 배지 + 참가가능/마감 뱃지 + 매장명 (사진 위에 텍스트 그림자로 가독성) ── */}
        <div className="flex flex-col gap-1 min-w-0">
          {/* LIVE 배지 + 상태 + (우측) 참가가능/참가마감 뱃지 */}
          <div className="flex items-center gap-2">
            <span
              className="flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(220,38,38,0.92)', color: '#fff' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full pulse-live flex-shrink-0"
                style={{ background: '#fff' }}
                aria-hidden="true"
              />
              LIVE
            </span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.9)' }}
            >
              {statusLabel(session)}
            </span>
            {/* 우측: 참가가능 / 참가마감 — 사용자가 한눈에 예약 판단 */}
            <span className="ml-auto" />
            {isLateRegOpen ? (
              <span
                className="text-[10px] font-extrabold px-2 py-0.5 rounded-full"
                style={{
                  background: 'rgba(74,222,128,0.95)',
                  color: '#0A1410',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
                }}
                aria-label="참가 가능"
              >
                참가 가능
              </span>
            ) : (
              <span
                className="text-[10px] font-extrabold px-2 py-0.5 rounded-full"
                style={{
                  background: 'rgba(255,255,255,0.18)',
                  color: 'rgba(255,255,255,0.78)',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
                }}
                aria-label="참가 마감"
              >
                참가 마감
              </span>
            )}
          </div>
          {/* 매장명 */}
          <div
            className="text-[19px] font-extrabold leading-tight tracking-tight truncate"
            style={{ color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
          >
            {session.storeName}
          </div>
          {/* 토너먼트명 */}
          <div
            className="text-[12px] font-medium truncate"
            style={{ color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 6px rgba(0,0,0,0.7)' }}
          >
            {session.tournamentName}
          </div>
        </div>

        {/* 중간 여백 — 사진 상단 노출 영역 */}
        <div className="flex-1" />

        {/* ── 하단: 타이머 + 게임 정보 (그라데이션 위에 배치) ── */}
        <div className="flex flex-col gap-0">
          {/* 타이머 (최우선, 가장 크게) */}
          <div className="flex items-baseline gap-2 mb-1">
            <span
              className="font-mono font-extrabold leading-none tabular-nums"
              style={{
                fontSize: '48px',
                color: isRunning ? '#fff' : 'rgba(255,255,255,0.55)',
                textShadow: '0 2px 12px rgba(0,0,0,0.6)',
                letterSpacing: '-0.02em',
              }}
              aria-label={`남은 시간 ${fmtTime(sec)}`}
            >
              {fmtTime(sec)}
            </span>
            {!isRunning && (
              <span
                className="text-[12px] font-bold"
                style={{ color: 'rgba(255,255,255,0.55)' }}
              >
                {session.status === 'paused' ? '일시정지' : '브레이크'}
              </span>
            )}
          </div>

          {/* 레벨 + 블라인드 */}
          <div
            className="text-[16px] font-bold leading-snug mb-2"
            style={{ color: 'rgba(255,255,255,0.92)' }}
            aria-label={`레벨 ${session.currentLevel}, 블라인드 ${blindLabel(session)}`}
          >
            Lv.{session.currentLevel} &nbsp;·&nbsp; {blindLabel(session)}
          </div>

          {/* 구분선 */}
          <div
            className="mb-2"
            style={{ height: 1, background: 'rgba(255,255,255,0.18)' }}
            aria-hidden="true"
          />

          {/* 하단 정보 행 — 카드 높이를 일정하게 유지하기 위해 행 개수 고정.
              · 1행: buy-in (티켓) + 인라인 Late reg 남은 시간 (오픈된 경우만)
              · 2행: 인원
              우측 상단 뱃지(참가 가능/마감)가 마감 여부를 시각화하므로
              하단의 별도 "Late reg 마감" 행은 제거 → 높이 변동 원인 차단. */}
          <div className="flex flex-col gap-1.5">
            {/* buy-in + (인라인) Late reg 시간 */}
            <div className="flex items-center gap-1.5 min-w-0">
              {buyIn ? (
                <>
                  <span style={{ fontSize: 13 }} aria-hidden="true">🎫</span>
                  <span
                    className="text-[14px] font-semibold"
                    style={{ color: 'rgba(255,255,255,0.88)' }}
                    aria-label={`바이인 ${buyIn}`}
                  >
                    {buyIn} buy-in
                  </span>
                </>
              ) : (
                <span
                  className="text-[14px] font-semibold"
                  style={{ color: 'rgba(255,255,255,0.55)' }}
                >
                  무료
                </span>
              )}
              {isLateRegOpen && (
                <>
                  <span
                    style={{ color: 'rgba(255,255,255,0.35)' }}
                    aria-hidden="true"
                    className="text-[13px]"
                  >
                    ·
                  </span>
                  <span style={{ fontSize: 12 }} aria-hidden="true">⏰</span>
                  <span
                    className="text-[13px] font-semibold"
                    style={{ color: '#4ADE80' }}
                    aria-label={`레이트 레지 ${lateRegMin}분 남음`}
                  >
                    등록 {lateRegMin}분
                  </span>
                </>
              )}
            </div>

            {/* 인원 */}
            {typeof session.playersRemaining === 'number' && (
              <div className="flex items-center gap-1.5">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" />
                </svg>
                <span
                  className="text-[12px] font-medium"
                  style={{ color: 'rgba(255,255,255,0.65)' }}
                  aria-label={`잔여 ${session.playersRemaining}명 / 전체 ${session.totalPlayers}명`}
                >
                  잔여 {session.playersRemaining}명
                  {typeof session.totalPlayers === 'number' && session.totalPlayers > 0
                    ? ` / 신청 ${session.totalPlayers}명`
                    : ''}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ──────────────────────────────────────────────
   메인 컴포넌트
────────────────────────────────────────────── */

export default function PrimaryLiveCard({ sessions, thumbnails }: Props) {
  const runningSessions = sortRunning(
    sessions.filter((s) => s.status === 'running' || s.status === 'paused' || s.status === 'break'),
  );

  /* 빈 상태 — 0개 */
  if (runningSessions.length === 0) {
    return (
      <section aria-label="LIVE" className="px-4 pb-1">
        <div
          className="relative rounded-2xl overflow-hidden flex items-center gap-3 px-4 py-4"
          style={{
            background: 'var(--surface-1)',
            border: '1.5px dashed var(--border)',
          }}
        >
          <span
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,0,80,0.10)' }}
            aria-hidden="true"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: 'var(--live, #FF0050)' }}
            />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-extrabold" style={{ color: 'var(--text-1)' }}>
              지금 LIVE 진행 중인 매장이 없습니다
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              LIVE가 시작되면 여기에 가장 먼저 표시됩니다
            </div>
          </div>
          <Link
            href="/m/find"
            className="flex-shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full transition active:opacity-70"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}
          >
            매장 둘러보기 →
          </Link>
        </div>
      </section>
    );
  }

  /* 1개 — 스와이프 없이 단일 카드 */
  if (runningSessions.length === 1) {
    return (
      <section aria-label="HOT LIVE" className="px-4 pb-1">
        <BigCard session={runningSessions[0]} thumbnail={thumbnails?.[runningSessions[0].storeId]} />
      </section>
    );
  }

  /* 2개 이상 — 가로 scroll-snap 스와이프 */
  return (
    <section aria-label="HOT LIVE" className="pb-1">
      {/* 스와이프 컨테이너 + 우측 페이드 */}
      <div className="relative">
        <div
          className="flex overflow-x-auto gap-3 px-4 scrollbar-none"
          style={{
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
          }}
          role="list"
        >
          {runningSessions.map((s) => (
            <div
              key={s.id}
              role="listitem"
              className="flex-shrink-0"
              style={{
                /* 뷰포트 한 폭 - 양쪽 패딩 + 다음 카드 peek */
                width: 'calc(100vw - 48px)',
                scrollSnapAlign: 'start',
              }}
            >
              <BigCard session={s} thumbnail={thumbnails?.[s.storeId]} />
            </div>
          ))}
          {/* 오른쪽 여백 */}
          <div className="w-4 flex-shrink-0" aria-hidden="true" />
        </div>
        {/* 우측 페이드 — 스와이프 어포던스 */}
        <div
          className="absolute right-0 top-0 bottom-0 w-10 pointer-events-none"
          style={{ background: 'linear-gradient(to right, transparent, var(--bg))' }}
          aria-hidden="true"
        />
      </div>

      {/* 페이지 인디케이터 (점) */}
      {runningSessions.length > 1 && (
        <div
          className="flex items-center justify-center gap-1.5 mt-2.5"
          aria-label={`${runningSessions.length}개 LIVE 카드`}
        >
          {runningSessions.map((s, i) => (
            <span
              key={s.id}
              className="rounded-full transition-all"
              style={{
                width: i === 0 ? 16 : 6,
                height: 6,
                background: i === 0 ? 'var(--brand)' : 'var(--border)',
              }}
              aria-hidden="true"
            />
          ))}
        </div>
      )}
    </section>
  );
}
