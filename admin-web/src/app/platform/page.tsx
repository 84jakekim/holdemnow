'use client';

/**
 * 본사 대시보드 — 스마트 분석 v3
 *
 * 회사 회의·사업 영역 확대용 대시보드.
 * 기존 40개 카드 그리드의 "조잡함"을 제거하고
 * Recharts 기반 시각 인지·변동 추세·증감 효과를 강조.
 *
 * 구성 (스크롤 순서):
 *   1. 헤더 (마지막 업데이트 · 새로고침)
 *   2. 핵심 KPI 4 카드 (큰 숫자 + ↑↓→ 증감률 + sparkline 14일)
 *   3. 30일 추이 AreaChart (가입자·매장·LIVE · 7일/30일 토글)
 *   4. 분포 — 매장 상태 DonutChart + 리뷰 별점 BarChart
 *   5. Top 10 매장 (평점 기준)
 *   6. 빠른 진입 액션 3 카드
 *
 * 다크/라이트 모두 지원 — 차트 색은 CSS 변수 + getComputedStyle로 동적 해석.
 * 30초 자동 refresh, 차트는 useMemo로 동일 데이터일 때 재렌더 회피.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  loadUserStats,
  loadStoreStats,
  loadLiveStats,
  loadReviewStats,
  loadCampaignStats,
  loadUsersTimeSeries,
  loadStoresTimeSeries,
  loadLiveTimeSeries,
  loadReviewsTimeSeries,
  loadGrowthRates,
  loadTopStoresByRating,
  type UserStats,
  type StoreStats,
  type LiveStats,
  type ReviewStats,
  type CampaignStats,
  type TimeSeriesPoint,
  type GrowthRate,
  type GrowthRates,
  type TopStore,
} from '@/lib/stats';

const REFRESH_INTERVAL_MS = 30_000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 토큰 — 차트 색 (CSS 변수 매핑)
// recharts의 stroke/fill은 CSS 변수 직접 사용 가능 (예: var(--brand)).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const COLOR_BRAND = '#FF1F8F'; // 핑크 — 가입자
const COLOR_GOLD = '#F59E0B'; // 골드 — 매장
const COLOR_LIVE = '#E53E3E'; // 빨강 — LIVE
const COLOR_SUCCESS = '#10B981';
const COLOR_MUTED = '#9CA3AF';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 포맷 헬퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  return n.toLocaleString('ko-KR');
}

function timeLabel(d: Date | null): string {
  if (!d) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 'YYYY-MM-DD' → 'M/D' (차트 X축용) */
function shortDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 데이터 컨테이너
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface DashboardData {
  users: UserStats;
  stores: StoreStats;
  live: LiveStats;
  reviews: ReviewStats;
  campaigns: CampaignStats;
  usersSeries: TimeSeriesPoint[];
  storesSeries: TimeSeriesPoint[];
  liveSeries: TimeSeriesPoint[];
  reviewsSeries: TimeSeriesPoint[];
  growth: GrowthRates;
  topStores: TopStore[];
}

type RangeToggle = 7 | 30;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 메인
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function PlatformDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [rangeDays, setRangeDays] = useState<RangeToggle>(30);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [
        users,
        stores,
        live,
        reviews,
        campaigns,
        usersSeries,
        storesSeries,
        liveSeries,
        reviewsSeries,
        growth,
        topStores,
      ] = await Promise.all([
        loadUserStats(),
        loadStoreStats(),
        loadLiveStats(),
        loadReviewStats(),
        loadCampaignStats(),
        loadUsersTimeSeries(30),
        loadStoresTimeSeries(30),
        loadLiveTimeSeries(30),
        loadReviewsTimeSeries(30),
        loadGrowthRates(),
        loadTopStoresByRating(10),
      ]);
      setData({
        users,
        stores,
        live,
        reviews,
        campaigns,
        usersSeries,
        storesSeries,
        liveSeries,
        reviewsSeries,
        growth,
        topStores,
      });
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

  // ━━ 차트 데이터 — useMemo로 재계산 최소화 ━━
  const trendData = useMemo(() => {
    if (!data) return [];
    const slice = (s: TimeSeriesPoint[]) => s.slice(-rangeDays);
    const u = slice(data.usersSeries);
    const s = slice(data.storesSeries);
    const l = slice(data.liveSeries);
    // 동일 길이 가정 (loadXxxSeries(30) 동일 결과). 안전하게 dates 기준 join.
    const dateMap: Record<string, { date: string; users: number; stores: number; live: number }> = {};
    u.forEach((p) => {
      dateMap[p.date] = { date: p.date, users: p.value, stores: 0, live: 0 };
    });
    s.forEach((p) => {
      if (!dateMap[p.date]) dateMap[p.date] = { date: p.date, users: 0, stores: 0, live: 0 };
      dateMap[p.date].stores = p.value;
    });
    l.forEach((p) => {
      if (!dateMap[p.date]) dateMap[p.date] = { date: p.date, users: 0, stores: 0, live: 0 };
      dateMap[p.date].live = p.value;
    });
    return Object.values(dateMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => ({ ...p, label: shortDate(p.date) }));
  }, [data, rangeDays]);

  const usersSpark14 = useMemo(() => data?.usersSeries.slice(-14) ?? [], [data]);
  const storesSpark14 = useMemo(() => data?.storesSeries.slice(-14) ?? [], [data]);
  const liveSpark14 = useMemo(() => data?.liveSeries.slice(-14) ?? [], [data]);
  const reviewsSpark14 = useMemo(() => data?.reviewsSeries.slice(-14) ?? [], [data]);

  const storeStatusData = useMemo(() => {
    if (!data) return [];
    const s = data.stores;
    return [
      { name: '활성', value: s.active, color: COLOR_SUCCESS },
      { name: '심사 대기', value: s.pending, color: COLOR_BRAND },
      { name: '거부', value: s.rejected, color: COLOR_LIVE },
      { name: '정지', value: s.suspended, color: COLOR_MUTED },
    ].filter((d) => d.value > 0);
  }, [data]);

  const ratingDistData = useMemo(() => {
    if (!data) return [];
    const d = data.reviews.ratingDistribution;
    return [
      { star: '1★', value: d['1'], color: COLOR_LIVE },
      { star: '2★', value: d['2'], color: '#F87171' },
      { star: '3★', value: d['3'], color: COLOR_MUTED },
      { star: '4★', value: d['4'], color: '#FBBF24' },
      { star: '5★', value: d['5'], color: COLOR_GOLD },
    ];
  }, [data]);

  const totalStoreStatus = useMemo(
    () => storeStatusData.reduce((a, b) => a + b.value, 0),
    [storeStatusData],
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 렌더
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1
            className="font-extrabold tracking-tight"
            style={{ fontSize: 24, color: 'var(--text-1)' }}
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
            <span className="font-mono font-bold" style={{ color: 'var(--text-1)' }}>
              {timeLabel(lastUpdate)}
            </span>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold disabled:opacity-50"
            style={{ fontSize: 12, background: 'var(--gold)', color: '#0F1419' }}
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

      {/* ━━ 1. 핵심 KPI 4 카드 ━━ */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6"
      >
        <KpiCard
          icon="👥"
          label="총 사용자"
          value={data?.users.total}
          growth={data?.growth.usersWeekly}
          growthLabel="이번 주 신규"
          spark={usersSpark14}
          color={COLOR_BRAND}
          loading={loading && !data}
        />
        <KpiCard
          icon="🏬"
          label="총 매장"
          value={data?.stores.total}
          growth={data?.growth.storesWeekly}
          growthLabel="이번 주 신규"
          spark={storesSpark14}
          color={COLOR_GOLD}
          loading={loading && !data}
        />
        <KpiCard
          icon="🎬"
          label="LIVE 세션 (이번 주)"
          value={data?.live.thisWeek}
          growth={data?.growth.liveDaily}
          growthLabel="오늘 vs 어제"
          spark={liveSpark14}
          color={COLOR_LIVE}
          loading={loading && !data}
        />
        <KpiCard
          icon="⭐"
          label="총 리뷰"
          value={data?.reviews.total}
          growth={data?.growth.reviewsDaily}
          growthLabel="오늘 vs 어제"
          spark={reviewsSpark14}
          color={COLOR_GOLD}
          loading={loading && !data}
          subValue={data ? `평균 ★${data.reviews.avgRating.toFixed(1)}` : undefined}
        />
      </div>

      {/* ━━ 2. 30일 추이 AreaChart ━━ */}
      <ChartCard
        title="가입자 · 매장 · LIVE 추이"
        subtitle={`최근 ${rangeDays}일 일별 신규/완료 흐름`}
        right={
          <div
            className="inline-flex items-center rounded-md overflow-hidden"
            style={{ border: '1px solid var(--border)' }}
          >
            <RangeButton active={rangeDays === 7} onClick={() => setRangeDays(7)}>
              7일
            </RangeButton>
            <RangeButton active={rangeDays === 30} onClick={() => setRangeDays(30)}>
              30일
            </RangeButton>
          </div>
        }
      >
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-users" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_BRAND} stopOpacity={0.5} />
                  <stop offset="95%" stopColor={COLOR_BRAND} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-stores" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_GOLD} stopOpacity={0.5} />
                  <stop offset="95%" stopColor={COLOR_GOLD} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="grad-live" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_LIVE} stopOpacity={0.5} />
                  <stop offset="95%" stopColor={COLOR_LIVE} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis
                tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                allowDecimals={false}
                width={32}
              />
              <Tooltip content={<TrendTooltip />} />
              <Area
                type="monotone"
                dataKey="users"
                name="가입자"
                stroke={COLOR_BRAND}
                strokeWidth={2}
                fill="url(#grad-users)"
              />
              <Area
                type="monotone"
                dataKey="stores"
                name="매장"
                stroke={COLOR_GOLD}
                strokeWidth={2}
                fill="url(#grad-stores)"
              />
              <Area
                type="monotone"
                dataKey="live"
                name="LIVE"
                stroke={COLOR_LIVE}
                strokeWidth={2}
                fill="url(#grad-live)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <LegendRow
          items={[
            { color: COLOR_BRAND, label: '가입자' },
            { color: COLOR_GOLD, label: '매장' },
            { color: COLOR_LIVE, label: 'LIVE' },
          ]}
        />
      </ChartCard>

      {/* ━━ 3. 분포 (2열) ━━ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        <ChartCard
          title="매장 상태 분포"
          subtitle="active / pending / rejected / suspended"
        >
          <div className="flex items-center gap-3" style={{ minHeight: 220 }}>
            <div style={{ width: '55%', height: 220, position: 'relative' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={storeStatusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={88}
                    paddingAngle={2}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  >
                    {storeStatusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<SimpleTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  pointerEvents: 'none',
                }}
              >
                <div
                  className="font-mono"
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: 'var(--text-1)',
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                  }}
                >
                  {fmt(totalStoreStatus)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
                  총 매장
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-1.5">
              {storeStatusData.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>데이터 없음</div>
              ) : (
                storeStatusData.map((d) => {
                  const pct = totalStoreStatus > 0 ? (d.value / totalStoreStatus) * 100 : 0;
                  return (
                    <div
                      key={d.name}
                      className="flex items-center justify-between gap-2"
                      style={{ fontSize: 12 }}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span
                          style={{
                            display: 'inline-block',
                            width: 9,
                            height: 9,
                            borderRadius: 2,
                            background: d.color,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ color: 'var(--text-2)' }}>{d.name}</span>
                      </span>
                      <span
                        className="font-mono"
                        style={{
                          color: 'var(--text-1)',
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {fmt(d.value)}
                        <span
                          style={{
                            color: 'var(--text-3)',
                            fontWeight: 500,
                            marginLeft: 4,
                            fontSize: 11,
                          }}
                        >
                          {pct.toFixed(1)}%
                        </span>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </ChartCard>

        <ChartCard
          title="리뷰 별점 분포"
          subtitle={
            data
              ? `평균 ★${data.reviews.avgRating.toFixed(2)} · 총 ${fmt(data.reviews.total)}건`
              : '평균 — · 총 -건'
          }
        >
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ratingDistData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="star"
                  tick={{ fill: 'var(--text-2)', fontSize: 12, fontWeight: 600 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                />
                <YAxis
                  tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  allowDecimals={false}
                  width={32}
                />
                <Tooltip content={<SimpleTooltip />} cursor={{ fill: 'var(--surface-3)', opacity: 0.4 }} />
                <Bar dataKey="value" name="리뷰" radius={[6, 6, 0, 0]}>
                  {ratingDistData.map((entry) => (
                    <Cell key={entry.star} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* ━━ 4. Top 10 매장 ━━ */}
      <ChartCard
        title="Top 10 매장 (평점 기준)"
        subtitle="averageRating 내림차순 · 동률은 리뷰 수로 정렬"
      >
        <TopStoresList stores={data?.topStores ?? []} loading={loading && !data} />
      </ChartCard>

      {/* ━━ 5. 빠른 진입 액션 ━━ */}
      <SectionLabel>빠른 진입</SectionLabel>
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
// KpiCard — 큰 숫자 + 증감률 + sparkline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function KpiCard({
  icon,
  label,
  value,
  growth,
  growthLabel,
  spark,
  color,
  loading,
  subValue,
}: {
  icon: string;
  label: string;
  value: number | undefined;
  growth: GrowthRate | undefined;
  growthLabel: string;
  spark: TimeSeriesPoint[];
  color: string;
  loading?: boolean;
  subValue?: string;
}) {
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: '16px 18px',
        minHeight: 140,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className="flex items-center gap-1.5"
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: 'var(--text-3)',
            letterSpacing: '0.04em',
          }}
        >
          <span aria-hidden style={{ fontSize: 14 }}>
            {icon}
          </span>
          <span>{label}</span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div
            className="font-mono"
            style={{
              fontSize: 32,
              fontWeight: 800,
              lineHeight: 1.05,
              color: 'var(--text-1)',
              fontVariantNumeric: 'tabular-nums',
              opacity: loading ? 0.4 : 1,
              transition: 'opacity 200ms',
            }}
          >
            {loading ? '…' : fmt(value)}
          </div>
          <GrowthBadge growth={growth} label={growthLabel} />
          {subValue && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              {subValue}
            </div>
          )}
        </div>
        <div style={{ width: '40%', maxWidth: 120, height: 40, flexShrink: 0 }}>
          {spark.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GrowthBadge — ↑↓→ + 컬러 분기
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function GrowthBadge({
  growth,
  label,
}: {
  growth: GrowthRate | undefined;
  label: string;
}) {
  if (!growth) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
        {label}
      </div>
    );
  }
  const { current, changePct, direction } = growth;
  const color =
    direction === 'up'
      ? COLOR_SUCCESS
      : direction === 'down'
        ? COLOR_LIVE
        : 'var(--text-3)';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  const sign = current >= 0 ? '+' : '';
  return (
    <div
      className="flex items-center gap-1 mt-1"
      style={{ fontSize: 12, color: 'var(--text-2)' }}
    >
      <span
        className="font-mono font-bold"
        style={{ color, fontVariantNumeric: 'tabular-nums' }}
      >
        {sign}
        {fmt(current)}
      </span>
      <span
        className="font-mono"
        style={{ color, fontWeight: 700 }}
      >
        ({arrow}
        {Math.abs(changePct).toFixed(1)}%)
      </span>
      <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 2 }}>
        {label}
      </span>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ChartCard — 차트 공통 컨테이너
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ChartCard({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: '16px 18px',
        marginBottom: 12,
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: 'var(--text-1)',
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function RangeButton({
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
      className="px-2.5 py-1 font-bold transition"
      style={{
        fontSize: 11,
        background: active ? 'var(--gold)' : 'transparent',
        color: active ? '#0F1419' : 'var(--text-2)',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function LegendRow({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-3 mt-2">
      {items.map((it) => (
        <span
          key={it.label}
          className="inline-flex items-center gap-1.5"
          style={{ fontSize: 11, color: 'var(--text-2)' }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 3,
              background: it.color,
              borderRadius: 2,
            }}
          />
          <span>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tooltip — recharts 커스텀
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface TooltipPayload {
  name?: string;
  value?: number;
  color?: string;
  payload?: { date?: string; label?: string; name?: string; star?: string };
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const date = payload[0]?.payload?.date ?? payload[0]?.payload?.label ?? '';
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 10px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        fontSize: 11,
      }}
    >
      <div
        style={{
          color: 'var(--text-3)',
          marginBottom: 4,
          fontWeight: 700,
          letterSpacing: '0.02em',
        }}
      >
        {date}
      </div>
      {payload.map((p) => (
        <div
          key={p.name ?? ''}
          className="flex items-center justify-between gap-3"
          style={{ color: 'var(--text-2)' }}
        >
          <span className="flex items-center gap-1.5">
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 2,
                background: p.color,
              }}
            />
            {p.name}
          </span>
          <span
            className="font-mono font-bold"
            style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}
          >
            {fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SimpleTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const name = p.payload?.name ?? p.payload?.star ?? p.name ?? '';
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '6px 9px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        fontSize: 11,
        color: 'var(--text-1)',
      }}
    >
      <span style={{ color: 'var(--text-3)' }}>{name}</span>{' '}
      <span
        className="font-mono font-bold"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {fmt(p.value)}
      </span>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TopStoresList — 1~10위 평점 리스트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function TopStoresList({
  stores,
  loading,
}: {
  stores: TopStore[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>
        불러오는 중…
      </div>
    );
  }
  if (stores.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>
        평점 보유 매장이 없습니다.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
      {stores.map((s, i) => {
        const rank = i + 1;
        const isTop3 = rank <= 3;
        const rankColor = rank === 1 ? COLOR_GOLD : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : 'var(--text-3)';
        return (
          <div
            key={s.id}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded"
            style={{
              background: rank === 1 ? 'var(--surface-2)' : 'transparent',
              transition: 'background 120ms',
            }}
          >
            <span
              className="font-mono font-bold flex-shrink-0 text-center"
              style={{
                fontSize: isTop3 ? 14 : 12,
                color: rankColor,
                fontVariantNumeric: 'tabular-nums',
                width: 24,
              }}
            >
              {rank}
            </span>
            <span
              className="flex-1 truncate"
              style={{
                fontSize: 13,
                color: 'var(--text-1)',
                fontWeight: isTop3 ? 700 : 500,
              }}
            >
              {s.name}
            </span>
            <span
              className="font-mono flex-shrink-0"
              style={{
                fontSize: 12,
                color: COLOR_GOLD,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              ★{s.metric.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SectionLabel — "빠른 진입" 같은 작은 헤더
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 mt-2 mb-3"
      style={{
        fontWeight: 800,
        fontSize: 13,
        color: 'var(--text-1)',
        letterSpacing: '-0.01em',
      }}
    >
      <span style={{ color: 'var(--gold)' }}>━━</span>
      {children}
    </div>
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
  const borderColor = tone === 'idle' ? 'var(--border)' : accent;
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
        <span className="truncate" style={{ fontSize: 13, fontWeight: 700 }}>
          {title}
        </span>
      </span>
      <span
        className="font-bold flex-shrink-0"
        style={{ fontSize: 13, color: accent }}
      >
        →
      </span>
    </Link>
  );
}
