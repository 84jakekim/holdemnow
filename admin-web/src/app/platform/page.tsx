'use client';

/**
 * 본사 대시보드 — 종합 분석 v2
 *
 * firebase-backend가 만든 `@/lib/stats` 7개 함수를 mount 시 병렬 호출 (Promise.all),
 * 30초마다 자동 refresh + 수동 새로고침. 5분류(사용자/매장/대회사/LIVE/리뷰·캠페인·이벤트)
 * 카드 그리드로 구성. 다크 기본 + 골드 액센트 + var(--r-md) 카드.
 *
 * 차트는 v0.2 — 베타 단계는 숫자 카드만.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  loadUserStats,
  loadStoreStats,
  loadOrganizerStats,
  loadLiveStats,
  loadReviewStats,
  loadCampaignStats,
  loadEventStats,
  type UserStats,
  type StoreStats,
  type OrganizerStats,
  type LiveStats,
  type ReviewStats,
  type CampaignStats,
  type EventStats,
} from '@/lib/stats';

interface DashboardData {
  users: UserStats;
  stores: StoreStats;
  organizers: OrganizerStats;
  live: LiveStats;
  reviews: ReviewStats;
  campaigns: CampaignStats;
  events: EventStats;
}

const REFRESH_INTERVAL_MS = 30_000;

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  return n.toLocaleString('ko-KR');
}

function plus(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  return n > 0 ? `+${n.toLocaleString('ko-KR')}` : n.toLocaleString('ko-KR');
}

function star(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n) || n === 0) return '-';
  return `★${n.toFixed(1)}`;
}

function pct(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  return `${n.toFixed(1)}%`;
}

function timeLabel(d: Date | null): string {
  if (!d) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function PlatformDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [users, stores, organizers, live, reviews, campaigns, events] = await Promise.all([
        loadUserStats(),
        loadStoreStats(),
        loadOrganizerStats(),
        loadLiveStats(),
        loadReviewStats(),
        loadCampaignStats(),
        loadEventStats(),
      ]);
      setData({ users, stores, organizers, live, reviews, campaigns, events });
      setLastUpdate(new Date());
    } catch (err) {
      console.warn('[platform/dashboard] refresh failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1
            className="font-extrabold tracking-tight"
            style={{ fontSize: 22, color: 'var(--text-1)' }}
          >
            📊 본사 대시보드
          </h1>
          <p className="mt-1" style={{ fontSize: 12, color: 'var(--text-3)' }}>
            전국 운영 현황 종합 분석 · 30초마다 자동 갱신
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--text-2)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span style={{ color: 'var(--text-3)' }}>마지막 업데이트</span>
            <span
              className="font-mono font-bold"
              style={{ color: 'var(--text-1)' }}
            >
              {timeLabel(lastUpdate)}
            </span>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold disabled:opacity-50"
            style={{
              fontSize: 12,
              background: 'var(--gold)',
              color: '#0F1419',
            }}
            aria-label="새로고침"
          >
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                transition: 'transform 600ms',
                transform: loading ? 'rotate(360deg)' : 'rotate(0)',
              }}
            >
              ↻
            </span>
            <span>새로고침</span>
          </button>
        </div>
      </div>

      {/* ━━ 사용자 ━━ */}
      <SectionHeader title="사용자" subtitle="가입/실시간/마케팅" />
      <CardGrid>
        <StatCard
          label="총 가입자"
          value={fmt(data?.users.total)}
          hint="누적 회원"
          loading={loading && !data}
        />
        <StatCard
          label="실시간 접속"
          value={fmt(data?.users.activeNow)}
          hint="최근 5분"
          accent="live"
          live
          loading={loading && !data}
        />
        <StatCard
          label="오늘 가입"
          value={plus(data?.users.today)}
          hint="신규"
          accent="brand"
          loading={loading && !data}
        />
        <StatCard
          label="이번주 가입"
          value={plus(data?.users.thisWeek)}
          hint="월~일"
          accent="brand"
          loading={loading && !data}
        />
      </CardGrid>
      <CardGrid>
        <StatCard
          label="이번달 가입"
          value={plus(data?.users.thisMonth)}
          hint="1일~말일"
          accent="brand"
          loading={loading && !data}
        />
        <StatCard
          label="올해 가입"
          value={plus(data?.users.thisYear)}
          hint="1/1~12/31"
          accent="brand"
          loading={loading && !data}
        />
        <StatCard
          label="마케팅 동의자"
          value={fmt(data?.users.marketingOptIn)}
          hint="푸시 수신"
          accent="gold"
          loading={loading && !data}
        />
        <StatCard
          label="FCM 토큰"
          value={fmt(data?.users.withFcmTokens)}
          hint="알림 도달 가능"
          accent="gold"
          loading={loading && !data}
        />
      </CardGrid>
      <RoleBreakdown roles={data?.users.byRole} />

      {/* ━━ 매장 ━━ */}
      <SectionHeader title="매장" subtitle="등록/심사/리뷰" />
      <CardGrid>
        <StatCard
          label="총 매장"
          value={fmt(data?.stores.total)}
          hint={`데모 ${fmt(data?.stores.isDemo)} 포함`}
          loading={loading && !data}
        />
        <StatCard
          label="활성"
          value={fmt(data?.stores.active)}
          hint="active"
          accent="success"
          loading={loading && !data}
        />
        <StatCard
          label="심사 대기"
          value={fmt(data?.stores.pending)}
          hint="pending"
          accent={data && data.stores.pending > 0 ? 'brand' : undefined}
          loading={loading && !data}
        />
        <StatCard
          label="거부/정지"
          value={fmt((data?.stores.rejected ?? 0) + (data?.stores.suspended ?? 0))}
          hint={`거부 ${fmt(data?.stores.rejected)} · 정지 ${fmt(data?.stores.suspended)}`}
          loading={loading && !data}
        />
      </CardGrid>
      <CardGrid>
        <StatCard
          label="오늘 등록"
          value={plus(data?.stores.today)}
          hint="신규 매장"
          accent="brand"
          loading={loading && !data}
        />
        <StatCard
          label="이번주 등록"
          value={plus(data?.stores.thisWeek)}
          hint="월~일"
          accent="brand"
          loading={loading && !data}
        />
        <StatCard
          label="리뷰 보유"
          value={fmt(data?.stores.withReviews)}
          hint="리뷰 1+ 매장"
          loading={loading && !data}
        />
        <StatCard
          label="평균 평점"
          value={star(data?.stores.avgRating)}
          hint="가중 평균"
          accent="gold"
          loading={loading && !data}
        />
      </CardGrid>

      {/* ━━ 대회사 ━━ */}
      <SectionHeader title="대회사" subtitle="시리즈 운영사 심사" />
      <CardGrid>
        <StatCard
          label="총 대회사"
          value={fmt(data?.organizers.total)}
          hint="누적"
          loading={loading && !data}
        />
        <StatCard
          label="활성"
          value={fmt(data?.organizers.active)}
          hint="운영 중"
          accent="success"
          loading={loading && !data}
        />
        <StatCard
          label="심사 대기"
          value={fmt(data?.organizers.pending)}
          hint="pending"
          accent={data && data.organizers.pending > 0 ? 'brand' : undefined}
          loading={loading && !data}
        />
        <StatCard
          label="이번달 가입"
          value={plus(data?.organizers.thisMonth)}
          hint="신규 운영사"
          accent="brand"
          loading={loading && !data}
        />
      </CardGrid>

      {/* ━━ LIVE ━━ */}
      <SectionHeader title="LIVE" subtitle="실시간 토너 모니터링" />
      <CardGrid>
        <StatCard
          label="진행 중"
          value={fmt(data?.live.currentRunning)}
          hint="running"
          accent="live"
          live={Boolean(data && data.live.currentRunning > 0)}
          loading={loading && !data}
        />
        <StatCard
          label="대기"
          value={fmt(data?.live.currentReady)}
          hint="ready"
          loading={loading && !data}
        />
        <StatCard
          label="일시정지"
          value={fmt(data?.live.currentPaused)}
          hint="paused"
          accent="gold"
          loading={loading && !data}
        />
        <StatCard
          label="누적 완료"
          value={fmt(data?.live.totalCompleted)}
          hint="전체 history"
          loading={loading && !data}
        />
      </CardGrid>
      <CardGrid>
        <StatCard
          label="오늘 완료"
          value={plus(data?.live.today)}
          hint="completed today"
          accent="brand"
          loading={loading && !data}
        />
        <StatCard
          label="이번주 완료"
          value={plus(data?.live.thisWeek)}
          hint="월~일"
          accent="brand"
          loading={loading && !data}
        />
        <StatCard
          label="이번달 완료"
          value={plus(data?.live.thisMonth)}
          hint="1일~말일"
          accent="brand"
          loading={loading && !data}
        />
        <StatCard
          label="LIVE 보유 매장"
          value={fmt(data?.stores.withLiveSessions)}
          hint="1회+ 운영"
          loading={loading && !data}
        />
      </CardGrid>

      {/* ━━ 리뷰 · 캠페인 · 이벤트 ━━ */}
      <SectionHeader title="리뷰 · 캠페인 · 이벤트" subtitle="콘텐츠 운영 요약" />
      <CardGrid>
        <StatCard
          label="총 리뷰"
          value={fmt(data?.reviews.total)}
          hint={`오늘 ${plus(data?.reviews.today)}`}
          loading={loading && !data}
        />
        <StatCard
          label="리뷰 평점"
          value={star(data?.reviews.avgRating)}
          hint="전체 평균"
          accent="gold"
          loading={loading && !data}
        />
        <StatCard
          label="이번주 리뷰"
          value={plus(data?.reviews.thisWeek)}
          hint="월~일"
          accent="brand"
          loading={loading && !data}
        />
        <StatCard
          label="이번달 리뷰"
          value={plus(data?.reviews.thisMonth)}
          hint="1일~말일"
          accent="brand"
          loading={loading && !data}
        />
      </CardGrid>
      <CardGrid>
        <StatCard
          label="총 캠페인"
          value={fmt(data?.campaigns.total)}
          hint={`발송 ${fmt(data?.campaigns.sent)}`}
          loading={loading && !data}
        />
        <StatCard
          label="예약 캠페인"
          value={fmt(data?.campaigns.scheduled)}
          hint="scheduled"
          accent={data && data.campaigns.scheduled > 0 ? 'gold' : undefined}
          loading={loading && !data}
        />
        <StatCard
          label="총 도달"
          value={fmt(data?.campaigns.totalDelivered)}
          hint={`수신자 ${fmt(data?.campaigns.totalRecipients)}`}
          loading={loading && !data}
        />
        <StatCard
          label="평균 도달률"
          value={pct(data?.campaigns.avgDeliveryRate)}
          hint="delivered/recipients"
          accent="success"
          loading={loading && !data}
        />
      </CardGrid>
      <CardGrid>
        <StatCard
          label="총 이벤트"
          value={fmt(data?.events.total)}
          hint="대회 누적"
          loading={loading && !data}
        />
        <StatCard
          label="진행 중"
          value={fmt(data?.events.ongoing)}
          hint="ongoing"
          accent="live"
          live={Boolean(data && data.events.ongoing > 0)}
          loading={loading && !data}
        />
        <StatCard
          label="예정"
          value={fmt(data?.events.upcoming)}
          hint="upcoming"
          accent="gold"
          loading={loading && !data}
        />
        <StatCard
          label="이번달 이벤트"
          value={plus(data?.events.thisMonth)}
          hint="startDate 기준"
          accent="brand"
          loading={loading && !data}
        />
      </CardGrid>

      {/* 빠른 진입 액션 */}
      <SectionHeader title="빠른 진입" subtitle="우선 처리가 필요한 항목" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
        <QuickAction
          href="/platform/stores"
          icon="🏬"
          title={`매장 심사 ${fmt(data?.stores.pending ?? 0)}건 대기`}
          tone={data && data.stores.pending > 0 ? 'urgent' : 'idle'}
        />
        <QuickAction
          href="/platform/marketing"
          icon="📣"
          title={`캠페인 예약 ${fmt(data?.campaigns.scheduled ?? 0)}건`}
          tone={data && data.campaigns.scheduled > 0 ? 'gold' : 'idle'}
        />
        <QuickAction
          href="/platform/live"
          icon="🎬"
          title={`전국 LIVE ${fmt(data?.live.currentRunning ?? 0)}개 진행 중`}
          tone={data && data.live.currentRunning > 0 ? 'live' : 'idle'}
        />
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 섹션 헤더
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-2 mt-7 mb-3">
      <span
        style={{
          color: 'var(--gold)',
          fontWeight: 800,
          letterSpacing: '0.04em',
        }}
      >
        ━━
      </span>
      <span
        style={{
          fontWeight: 800,
          fontSize: 14,
          color: 'var(--text-1)',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </span>
      <span
        style={{
          color: 'var(--gold)',
          fontWeight: 800,
          letterSpacing: '0.04em',
        }}
      >
        ━━
      </span>
      {subtitle && (
        <span
          className="ml-1"
          style={{ fontSize: 11, color: 'var(--text-3)' }}
        >
          {subtitle}
        </span>
      )}
    </div>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2.5">{children}</div>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// StatCard — 단순 정사각 카드 (label, value, hint, accent)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type Accent = 'brand' | 'gold' | 'live' | 'success';

function StatCard({
  label,
  value,
  hint,
  accent,
  live,
  loading,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: Accent;
  /** 라이브 도트 표시 (실시간 접속자/진행 중 등) */
  live?: boolean;
  loading?: boolean;
}) {
  const valueColor =
    accent === 'brand'
      ? 'var(--brand)'
      : accent === 'gold'
        ? 'var(--gold)'
        : accent === 'live'
          ? 'var(--live)'
          : accent === 'success'
            ? 'var(--success)'
            : 'var(--text-1)';

  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: '12px 14px',
        minHeight: 88,
      }}
    >
      <div
        className="flex items-center gap-1.5"
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: 'var(--text-3)',
          letterSpacing: '0.04em',
          marginBottom: 6,
        }}
      >
        {live && <LiveDot />}
        <span>{label}</span>
      </div>
      <div
        className="font-mono"
        style={{
          fontSize: 24,
          fontWeight: 800,
          lineHeight: 1.1,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
          opacity: loading ? 0.4 : 1,
          transition: 'opacity 200ms',
        }}
      >
        {loading ? '…' : value}
      </div>
      {hint && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            marginTop: 4,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function LiveDot() {
  return (
    <>
      <style jsx>{`
        @keyframes platformLivePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
        .platform-live-dot {
          display: inline-block;
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: var(--live);
          box-shadow: 0 0 6px var(--live-glow);
          animation: platformLivePulse 1.4s ease-in-out infinite;
        }
      `}</style>
      <span className="platform-live-dot" aria-hidden />
    </>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Role 분포 row
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function RoleBreakdown({
  roles,
}: {
  roles: UserStats['byRole'] | undefined;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-2 mt-1 px-3 py-2 rounded-md"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-2)',
      }}
    >
      <span
        style={{
          fontWeight: 800,
          color: 'var(--text-3)',
          letterSpacing: '0.04em',
        }}
      >
        Role
      </span>
      <RoleChip label="player" value={roles?.player} />
      <RoleChip label="매장 사장" value={roles?.storeOwner} />
      <RoleChip label="대회사" value={roles?.organizerOwner} />
      <RoleChip label="본사 관리자" value={roles?.platformAdmin} />
    </div>
  );
}

function RoleChip({ label, value }: { label: string; value: number | undefined }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span
        className="font-mono font-bold"
        style={{
          color: 'var(--text-1)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {fmt(value)}
      </span>
    </span>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QuickAction — 페이지 하단 빠른 진입 카드
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function QuickAction({
  href,
  icon,
  title,
  tone,
}: {
  href: string;
  icon: string;
  title: string;
  tone: 'urgent' | 'gold' | 'live' | 'idle';
}) {
  const accent =
    tone === 'urgent'
      ? 'var(--brand)'
      : tone === 'gold'
        ? 'var(--gold)'
        : tone === 'live'
          ? 'var(--live)'
          : 'var(--text-3)';
  const borderColor =
    tone === 'idle' ? 'var(--border)' : accent;
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 rounded-md px-4 py-3 transition"
      style={{
        background: 'var(--surface-1)',
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--r-md)',
        color: 'var(--text-1)',
        textDecoration: 'none',
      }}
    >
      <span className="flex items-center gap-2.5 min-w-0">
        <span aria-hidden style={{ fontSize: 20 }}>
          {icon}
        </span>
        <span
          className="truncate"
          style={{ fontSize: 13, fontWeight: 700 }}
        >
          {title}
        </span>
      </span>
      <span
        className="font-bold flex-shrink-0"
        style={{
          fontSize: 13,
          color: accent,
        }}
      >
        →
      </span>
    </Link>
  );
}
