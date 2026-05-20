'use client';

/**
 * PrimaryLiveCard — 가장 HOT한 LIVE 세션 1개를 큰 카드로 표시
 *
 * Hot 판정 우선순위:
 *   1. playersRemaining 가장 많은 세션
 *   2. 동률 시 startedAt 가장 최근
 *
 * - sessions 0개 → null
 * - sessions 1개 이상 → HOT 1개만 렌더
 *
 * 데이터: 부모에서 subscribeAllLiveSessions 구독 후 props로 전달 (신규 호출 0)
 */

import Link from 'next/link';
import type { LiveSession } from '@/lib/live';
import { useLiveCountdown, computeLateRegMinutes, computeRemainingSec } from '@/lib/live';

interface Props {
  sessions: LiveSession[];
  /** storeId → 매장 썸네일 URL (이미 로드된 캐시) */
  thumbnails?: Record<string, string | undefined>;
}

/** sessions 중 Hot 1개 선정 */
function pickHot(sessions: LiveSession[]): LiveSession | null {
  if (sessions.length === 0) return null;
  return [...sessions].sort((a, b) => {
    // 1차: playersRemaining 내림차순
    const diff = (b.playersRemaining ?? 0) - (a.playersRemaining ?? 0);
    if (diff !== 0) return diff;
    // 2차: startedAt 최근순 (Timestamp 또는 없음)
    const aMs = (a.startedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    const bMs = (b.startedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    return bMs - aMs;
  })[0];
}

function statusLabel(s: LiveSession): string {
  if (s.status === 'running') return '진행 중';
  if (s.status === 'paused') return '일시정지';
  if (s.status === 'break') return '브레이크';
  return 'LIVE';
}

function LevelCountdown({ session }: { session: LiveSession }) {
  const sec = useLiveCountdown(session);
  if (session.status !== 'running') return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (
    <span className="font-mono text-[11px]" style={{ color: 'rgba(255,255,255,0.85)' }}>
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

export default function PrimaryLiveCard({ sessions, thumbnails }: Props) {
  const runningSessions = sessions.filter((s) => s.status === 'running');
  const hot = pickHot(runningSessions);

  // 빈 상태 placeholder — 시그니처 자리 항상 가시화
  if (!hot) {
    return (
      <section aria-label="LIVE" className="px-4 pt-4 pb-1">
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

  const thumb = thumbnails?.[hot.storeId];
  const lateRegMin = computeLateRegMinutes(hot, computeRemainingSec(hot));
  const isLateRegOpen = !hot.lateRegClosed && lateRegMin > 0;

  return (
    <section aria-label="HOT LIVE" className="px-4 pt-4 pb-1">
      <Link
        href={`/m/store/${hot.storeId}`}
        className="block relative rounded-2xl overflow-hidden transition active:scale-[0.985]"
        style={{
          aspectRatio: '16 / 9',
          background: 'var(--surface-1)',
          border: '1.5px solid var(--border)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        }}
        aria-label={`${hot.storeName} LIVE — ${hot.tournamentName}`}
      >
        {/* 배경 이미지 */}
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(135deg, #1A0830 0%, #2E0418 50%, #0A0E0C 100%)' }}
            aria-hidden="true"
          />
        )}

        {/* 그라디언트 오버레이 */}
        <div
          className="absolute inset-0"
          style={{
            background: thumb
              ? 'linear-gradient(to bottom, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.68) 100%)'
              : 'linear-gradient(to bottom, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.55) 100%)',
          }}
          aria-hidden="true"
        />

        {/* 상단: LIVE 배지 + 레벨 타이머 */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* HOT 배지 */}
            <span
              className="text-[10px] font-extrabold px-2 py-0.5 rounded-full tracking-wide"
              style={{ background: 'rgba(255,31,143,0.92)', color: '#fff', boxShadow: '0 1px 6px rgba(255,31,143,0.5)' }}
            >
              HOT
            </span>
            {/* LIVE 배지 */}
            <span
              className="flex items-center gap-1 text-[11px] font-extrabold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(220,38,38,0.92)', color: '#fff' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full pulse-live flex-shrink-0"
                style={{ background: '#fff' }}
                aria-hidden="true"
              />
              LIVE
            </span>
          </div>
          {/* 레벨 카운트다운 */}
          <LevelCountdown session={hot} />
        </div>

        {/* 하단: 매장명 + 토너 정보 */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 pt-6">
          {/* 매장명 */}
          <div
            className="text-[18px] font-extrabold leading-tight tracking-tight truncate"
            style={{ color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
          >
            {hot.storeName}
          </div>

          {/* 토너명 + 상태 */}
          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[12px] font-medium truncate"
              style={{ color: 'rgba(255,255,255,0.82)' }}
            >
              {hot.tournamentName}
            </span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.9)' }}
            >
              {statusLabel(hot)}
            </span>
          </div>

          {/* 하단 메타: 참가자·블라인드·레이트렉 */}
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            {/* 남은 참가자 */}
            <div className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75"/>
              </svg>
              <span className="text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {hot.playersRemaining}명
              </span>
            </div>

            {/* 현재 블라인드 */}
            <div className="flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
              <span className="text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
                Lv.{hot.currentLevel} · {hot.smallBlind}/{hot.bigBlind}
              </span>
            </div>

            {/* 레이트렉 */}
            {isLateRegOpen && (
              <span
                className="text-[10px] font-extrabold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(34,197,94,0.85)', color: '#fff' }}
              >
                레이트렉 {lateRegMin}분
              </span>
            )}
          </div>
        </div>
      </Link>
    </section>
  );
}
