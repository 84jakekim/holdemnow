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
import { subscribeRecentReports, type Report } from '@/lib/reviews';
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
  loadOrganizerStats,
  loadLiveStats,
  loadReviewStats,
  loadCampaignStats,
  loadEventStats,
  loadUsersTimeSeries,
  loadStoresTimeSeries,
  loadLiveTimeSeries,
  loadReviewsTimeSeries,
  loadGrowthRates,
  loadTopStoresByRating,
  loadTopStoresByMetric,
  loadAllStoresMetrics,
  loadRecentUsers,
  loadStoreRegionDistribution,
  loadUserRegionDistribution,
  loadLiveRegionDistribution,
  loadRegionOpportunities,
  loadUserRegionTimeSeries,
  type UserStats,
  type StoreStats,
  type OrganizerStats,
  type LiveStats,
  type ReviewStats,
  type CampaignStats,
  type EventStats,
  type TimeSeriesPoint,
  type GrowthRate,
  type GrowthRates,
  type TopStore,
  type StoreMetricsRow,
  type UserSummary,
  type RegionDistribution,
  type RegionOpportunity,
  type RegionTimeSeries,
} from '@/lib/stats';

const REFRESH_INTERVAL_MS = 30_000;

// 신고 사유 라벨 (대시보드 미니 리스트용)
const DASHBOARD_REASON_LABEL: Record<string, string> = {
  spam: '스팸/도배',
  offensive: '욕설/혐오',
  misinformation: '허위정보',
  advertising: '광고/홍보',
  other: '기타',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 토큰 — 차트 색 (CSS 변수 매핑)
// recharts의 stroke/fill은 CSS 변수 직접 사용 가능 (예: var(--brand)).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const COLOR_BRAND = '#FF1F8F'; // 핑크 — 가입자
const COLOR_GOLD = '#F59E0B'; // 골드 — 매장
const COLOR_LIVE = '#E53E3E'; // 빨강 — LIVE
const COLOR_SUCCESS = '#10B981';
const COLOR_MUTED = '#9CA3AF';

// 지역별 라인차트 팔레트 — 부산(핑크)·서울(골드)·경기(빨강) 후속은 다채로운 톤
const REGION_PALETTE = [
  '#FF1F8F', // 핑크 (Top 1 — 보통 부산)
  '#F59E0B', // 골드 (Top 2)
  '#E53E3E', // 빨강 (Top 3)
  '#10B981', // 그린 (Top 4)
  '#3B82F6', // 블루 (Top 5)
  '#9CA3AF', // 회색 (기타)
];

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

/** 긴 매장명 자르기 (BarChart X축용) */
function truncate(s: string, maxChars: number): string {
  if (!s) return '';
  return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
}

/** Date 또는 Firestore Timestamp-like(.toDate()) → 'M/D HH:mm' */
function formatTs(ts: { toDate(): Date } | Date | null | undefined): string {
  if (!ts) return '-';
  let d: Date;
  if (ts instanceof Date) {
    d = ts;
  } else if (typeof (ts as { toDate?: unknown }).toDate === 'function') {
    try {
      d = (ts as { toDate(): Date }).toDate();
    } catch {
      return '-';
    }
  } else {
    return '-';
  }
  if (Number.isNaN(d.getTime())) return '-';
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${M}/${D} ${hh}:${mm}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 데이터 컨테이너
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface DashboardData {
  users: UserStats;
  stores: StoreStats;
  organizers: OrganizerStats;
  live: LiveStats;
  reviews: ReviewStats;
  campaigns: CampaignStats;
  events: EventStats;
  usersSeries: TimeSeriesPoint[];
  storesSeries: TimeSeriesPoint[];
  liveSeries: TimeSeriesPoint[];
  reviewsSeries: TimeSeriesPoint[];
  growth: GrowthRates;
  topStores: TopStore[];
  topByClicks: TopStore[];
  bottomByImpressions: TopStore[];
  allMetrics: StoreMetricsRow[];
  recentUsers: UserSummary[];
  storeRegion: RegionDistribution[];
  userRegion: RegionDistribution[];
  liveRegion: RegionDistribution[];
  opportunities: RegionOpportunity[];
  regionTimeSeries: RegionTimeSeries[];
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
  const [reports, setReports] = useState<Report[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [
        users,
        stores,
        organizers,
        live,
        reviews,
        campaigns,
        events,
        usersSeries,
        storesSeries,
        liveSeries,
        reviewsSeries,
        growth,
        topStores,
        topByClicks,
        bottomByImpressions,
        allMetrics,
        recentUsers,
        storeRegion,
        userRegion,
        liveRegion,
        opportunities,
        regionTimeSeries,
      ] = await Promise.all([
        loadUserStats(),
        loadStoreStats(),
        loadOrganizerStats(),
        loadLiveStats(),
        loadReviewStats(),
        loadCampaignStats(),
        loadEventStats(),
        loadUsersTimeSeries(30),
        loadStoresTimeSeries(30),
        loadLiveTimeSeries(30),
        loadReviewsTimeSeries(30),
        loadGrowthRates(),
        loadTopStoresByRating(10),
        loadTopStoresByMetric('cardClicks', 10, false),
        loadTopStoresByMetric('impressions', 10, true),
        loadAllStoresMetrics(),
        loadRecentUsers(10),
        loadStoreRegionDistribution(),
        loadUserRegionDistribution(),
        loadLiveRegionDistribution(),
        loadRegionOpportunities(),
        loadUserRegionTimeSeries(30),
      ]);
      setData({
        users,
        stores,
        organizers,
        live,
        reviews,
        campaigns,
        events,
        usersSeries,
        storesSeries,
        liveSeries,
        reviewsSeries,
        growth,
        topStores,
        topByClicks,
        bottomByImpressions,
        allMetrics,
        recentUsers,
        storeRegion,
        userRegion,
        liveRegion,
        opportunities,
        regionTimeSeries,
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

  // ━━ 신고 실시간 구독 — 최근 300건 (모더레이션 위젯용) ━━
  useEffect(() => {
    const unsub = subscribeRecentReports(
      300,
      (items) => setReports(items),
      (e) => console.warn('[platform/dashboard] reports subscribe failed', e),
    );
    return unsub;
  }, []);

  // ━━ 모더레이션 KPI — 클라이언트 집계 ━━
  const moderation = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const inWeek = (ms: number | null | undefined) => ms != null && ms >= weekAgo && ms <= now;
    const tsMs = (t: { toMillis?: () => number } | null | undefined): number | null => {
      if (!t || typeof t.toMillis !== 'function') return null;
      try {
        return t.toMillis();
      } catch {
        return null;
      }
    };

    let pending = 0; // 미처리 신고 (resolved=false)
    let autoHidden = 0; // 이번주 자동 숨김 (resolution undefined + resolved? — 자동은 resolution=null + resolved=false 형태)
    let confirmedHidden = 0; // 이번주 본사 확정 숨김 (resolution='hide')
    let restored = 0; // 이번주 복원 (resolution='restore')

    for (const rep of reports) {
      if (!rep.resolved) pending += 1;

      // 이번 주 처리된 신고
      const resolvedMs = tsMs(rep.resolvedAt ?? null);
      if (inWeek(resolvedMs)) {
        if (rep.resolution === 'hide') confirmedHidden += 1;
        else if (rep.resolution === 'restore') restored += 1;
      }
    }

    // 자동 숨김: 이번 주 생성된 미처리 신고 중 — 동일 targetId 가 3건 이상이면 자동 숨김 트리거된 것으로 간주
    // 신고 createdAt이 이번주에 속하는 targetId set 모음
    const reportsThisWeekByTarget = new Map<string, number>();
    for (const rep of reports) {
      const createdMs = tsMs(rep.createdAt ?? null);
      if (!inWeek(createdMs)) continue;
      reportsThisWeekByTarget.set(rep.targetId, (reportsThisWeekByTarget.get(rep.targetId) ?? 0) + 1);
    }
    for (const cnt of reportsThisWeekByTarget.values()) {
      if (cnt >= 3) autoHidden += 1;
    }

    // 최근 5건 (createdAt desc — subscribeRecentReports 가 이미 desc 정렬)
    const recent = reports.slice(0, 5);

    return { pending, autoHidden, confirmedHidden, restored, recent };
  }, [reports]);

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

  // ━━ 매장 누적 메트릭 합계 (impressions / cardClicks / liveOpens / favoriteAdds) ━━
  const metricTotals = useMemo(() => {
    const rows = data?.allMetrics ?? [];
    return rows.reduce(
      (acc, r) => {
        acc.impressions += r.impressions ?? 0;
        acc.cardClicks += r.cardClicks ?? 0;
        acc.liveOpens += r.liveOpens ?? 0;
        acc.favoriteAdds += r.favoriteAdds ?? 0;
        return acc;
      },
      { impressions: 0, cardClicks: 0, liveOpens: 0, favoriteAdds: 0 },
    );
  }, [data]);

  // ━━ BarChart: 매장별 cardClicks Top 10 ━━
  const clicksBarData = useMemo(() => {
    const rows = data?.allMetrics ?? [];
    return [...rows]
      .sort((a, b) => (b.cardClicks ?? 0) - (a.cardClicks ?? 0))
      .slice(0, 10)
      .map((r) => ({
        name: r.storeName,
        shortName: truncate(r.storeName, 8),
        value: r.cardClicks ?? 0,
      }));
  }, [data]);

  // ━━ 지역 분석 — 막대/테이블/시계열 ━━
  const storeRegionBarData = useMemo(() => {
    const rows = data?.storeRegion ?? [];
    return rows.slice(0, 12).map((r) => ({ name: r.region, value: r.count }));
  }, [data]);

  const userRegionBarData = useMemo(() => {
    const rows = data?.userRegion ?? [];
    return rows.slice(0, 12).map((r) => ({ name: r.region, value: r.count }));
  }, [data]);

  const opportunityRows = useMemo(() => {
    const rows = data?.opportunities ?? [];
    // 이미 백엔드에서 opportunityScore 내림차순 정렬되어 있지만 안전하게 재정렬
    return [...rows]
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 10);
  }, [data]);

  // 지역별 시계열 — Top 5 + '기타' 묶기, recharts용 wide row 변환
  const regionLineSeries = useMemo(() => {
    const all = data?.regionTimeSeries ?? [];
    if (all.length === 0) return { rows: [] as Array<Record<string, number | string>>, regions: [] as string[] };

    // 총합 기준 정렬 (이미 정렬되어 있을 가능성 높지만 방어적)
    const withTotals = all.map((rs) => ({
      ...rs,
      total: rs.series.reduce((acc, p) => acc + p.value, 0),
    }));
    withTotals.sort((a, b) => b.total - a.total);

    const top = withTotals.slice(0, 5);
    const rest = withTotals.slice(5);

    // 모든 date 키 수집 (top 첫 항목 series 기준)
    const dateKeys = top[0]?.series.map((p) => p.date) ?? [];

    // date → row
    const rowMap = new Map<string, Record<string, number | string>>();
    dateKeys.forEach((dk) => {
      rowMap.set(dk, { date: dk, label: shortDate(dk) });
    });

    top.forEach((rs) => {
      rs.series.forEach((p) => {
        const row = rowMap.get(p.date);
        if (row) row[rs.region] = p.value;
      });
    });

    // 기타 묶기
    if (rest.length > 0) {
      dateKeys.forEach((dk) => {
        const row = rowMap.get(dk);
        if (!row) return;
        let acc = 0;
        rest.forEach((rs) => {
          const p = rs.series.find((x) => x.date === dk);
          acc += p?.value ?? 0;
        });
        row['기타'] = acc;
      });
    }

    const regions = top.map((rs) => rs.region);
    if (rest.length > 0) regions.push('기타');

    return {
      rows: Array.from(rowMap.values()).sort((a, b) =>
        String(a.date).localeCompare(String(b.date)),
      ),
      regions,
    };
  }, [data]);

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

      {/* ━━ 2-1. 사용자 상세 row ━━ */}
      <SectionLabel>사용자 상세</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <SubCard label="오늘 신규" value={fmt(data?.users.today)} accent="brand" />
        <SubCard label="이번달 신규" value={fmt(data?.users.thisMonth)} accent="brand" />
        <SubCard label="올해 신규" value={fmt(data?.users.thisYear)} accent="brand" />
        <SubCard label="실시간 접속자" value={fmt(data?.users.activeNow)} accent="live" hint="5분 이내 활동" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <SubCard label="마케팅 동의자" value={fmt(data?.users.marketingOptIn)} accent="gold" />
        <SubCard label="FCM 토큰" value={fmt(data?.users.withFcmTokens)} accent="muted" hint="수신 가능 디바이스" />
        <SubCard label="Role · 플레이어" value={fmt(data?.users.byRole.player)} accent="muted" />
        <SubCard label="Role · 매장 사장" value={fmt(data?.users.byRole.storeOwner)} accent="muted" />
      </div>
      <div
        className="mb-6"
        style={{ fontSize: 11, color: 'var(--text-3)', paddingLeft: 4 }}
      >
        Role: 대회사 사장 <strong style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{fmt(data?.users.byRole.organizerOwner)}</strong>
        {' · '}
        본사 관리자 <strong style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{fmt(data?.users.byRole.platformAdmin)}</strong>
      </div>

      {/* ━━ 2-2. 매장 상세 row ━━ */}
      <SectionLabel>매장 상세</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <SubCard label="활성" value={fmt(data?.stores.active)} accent="success" />
        <SubCard label="심사 대기" value={fmt(data?.stores.pending)} accent="brand" />
        <SubCard label="거부" value={fmt(data?.stores.rejected)} accent="live" />
        <SubCard label="정지" value={fmt(data?.stores.suspended)} accent="muted" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <SubCard label="데모 매장" value={fmt(data?.stores.isDemo)} accent="muted" />
        <SubCard label="오늘 신규" value={fmt(data?.stores.today)} accent="gold" />
        <SubCard label="리뷰 있는 매장" value={fmt(data?.stores.withReviews)} accent="gold" />
        <SubCard label="LIVE 운영 매장" value={fmt(data?.stores.withLiveSessions)} accent="live" />
      </div>

      {/* ━━ 2-3. LIVE 상세 row ━━ */}
      <SectionLabel>LIVE 상세</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <SubCard label="현재 진행" value={fmt(data?.live.currentRunning)} accent="live" />
        <SubCard label="대기 (ready)" value={fmt(data?.live.currentReady)} accent="gold" />
        <SubCard label="일시정지" value={fmt(data?.live.currentPaused)} accent="muted" />
        <SubCard label="누적 완료" value={fmt(data?.live.totalCompleted)} accent="success" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <SubCard label="오늘 완료" value={fmt(data?.live.today)} accent="brand" />
        <SubCard label="이번주 완료" value={fmt(data?.live.thisWeek)} accent="brand" />
        <SubCard label="이번달 완료" value={fmt(data?.live.thisMonth)} accent="brand" />
        <div />
      </div>

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

      {/* ━━ 3-1. 리뷰 상세 row ━━ */}
      <SectionLabel>리뷰 상세</SectionLabel>
      <div className="grid grid-cols-3 gap-2 mb-6">
        <SubCard label="오늘 신규 리뷰" value={fmt(data?.reviews.today)} accent="gold" />
        <SubCard label="이번주 신규" value={fmt(data?.reviews.thisWeek)} accent="gold" />
        <SubCard label="이번달 신규" value={fmt(data?.reviews.thisMonth)} accent="gold" />
      </div>

      {/* ━━ 4. Top 10 매장 ━━ */}
      <ChartCard
        title="Top 10 매장 (평점 기준)"
        subtitle="averageRating 내림차순 · 동률은 리뷰 수로 정렬"
      >
        <TopStoresList stores={data?.topStores ?? []} loading={loading && !data} />
      </ChartCard>

      {/* ━━ 4-A. 매장 랭킹 (인기 · 비인기) ━━ */}
      <SectionLabel>매장 랭킹</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-8">
        <RankTableCard
          title="🏆 인기 매장 Top 10"
          subtitle="cardClicks 내림차순"
          rows={data?.topByClicks ?? []}
          metricLabel="클릭 수"
          loading={loading && !data}
          accent="brand"
        />
        <RankTableCard
          title="📉 노출 적은 매장 Top 10"
          subtitle="impressions 가장 낮은 순"
          rows={data?.bottomByImpressions ?? []}
          metricLabel="노출 수"
          loading={loading && !data}
          accent="muted"
          footnote="신규 매장일 수도 있습니다."
        />
      </div>

      {/* ━━ 4-B. 매장별 접속 통계 ━━ */}
      <SectionLabel>매장별 접속 통계</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <SubCard label="총 노출 (impressions)" value={fmt(metricTotals.impressions)} accent="muted" />
        <SubCard label="총 카드 클릭" value={fmt(metricTotals.cardClicks)} accent="brand" />
        <SubCard label="총 LIVE 진입" value={fmt(metricTotals.liveOpens)} accent="live" />
        <SubCard label="총 즐겨찾기 추가" value={fmt(metricTotals.favoriteAdds)} accent="gold" />
      </div>
      <ChartCard
        title="매장별 카드 클릭 Top 10"
        subtitle="cardClicks 내림차순 — 한눈에 인기 매장 비교"
      >
        {clicksBarData.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>
            {loading && !data ? '불러오는 중…' : '메트릭 데이터가 아직 없습니다.'}
          </div>
        ) : (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={clicksBarData}
                margin={{ top: 10, right: 16, left: 0, bottom: 40 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="shortName"
                  tick={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 600 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  allowDecimals={false}
                  width={36}
                />
                <Tooltip content={<BarStoreTooltip />} cursor={{ fill: 'var(--surface-3)', opacity: 0.4 }} />
                <Bar
                  dataKey="value"
                  name="cardClicks"
                  fill="var(--brand)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      {/* ━━ 4-C. 최근 가입 사용자 ━━ */}
      <SectionLabel>최근 가입 사용자</SectionLabel>
      <div
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: '14px 16px',
          marginBottom: 24,
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            createdAt 내림차순 · 최근 10명
          </div>
          <Link
            href="/platform/users"
            style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 700, textDecoration: 'none' }}
          >
            전체 보기 →
          </Link>
        </div>
        <RecentUsersTable users={data?.recentUsers ?? []} loading={loading && !data} />
      </div>

      {/* ━━ 4-1. 대회사 ━━ */}
      <SectionLabel>대회사</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <SubCard label="총 대회사" value={fmt(data?.organizers.total)} accent="brand" />
        <SubCard label="활성" value={fmt(data?.organizers.active)} accent="success" />
        <SubCard label="심사 대기" value={fmt(data?.organizers.pending)} accent="gold" />
        <SubCard label="거부" value={fmt(data?.organizers.rejected)} accent="live" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <SubCard label="오늘 신규" value={fmt(data?.organizers.today)} accent="muted" />
        <SubCard label="이번주 신규" value={fmt(data?.organizers.thisWeek)} accent="muted" />
        <SubCard label="이번달 신규" value={fmt(data?.organizers.thisMonth)} accent="muted" />
        <div />
      </div>

      {/* ━━ 4-2. 이벤트(대회) ━━ */}
      <SectionLabel>이벤트(대회)</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <SubCard label="총 이벤트" value={fmt(data?.events.total)} accent="brand" />
        <SubCard label="예정 (upcoming)" value={fmt(data?.events.upcoming)} accent="gold" />
        <SubCard label="진행 중 (ongoing)" value={fmt(data?.events.ongoing)} accent="live" />
        <SubCard label="이번달" value={fmt(data?.events.thisMonth)} accent="success" />
      </div>

      {/* ━━ 4-3. 캠페인 ━━ */}
      <SectionLabel>캠페인</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <SubCard label="총 캠페인" value={fmt(data?.campaigns.total)} accent="brand" />
        <SubCard label="발송 완료" value={fmt(data?.campaigns.sent)} accent="success" />
        <SubCard label="예약" value={fmt(data?.campaigns.scheduled)} accent="gold" />
        <SubCard
          label="평균 도달률"
          value={data ? `${data.campaigns.avgDeliveryRate.toFixed(1)}%` : '-'}
          accent="live"
        />
      </div>
      <div
        className="mb-6"
        style={{ fontSize: 11, color: 'var(--text-3)', paddingLeft: 4 }}
      >
        총 발송 수 <strong style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{fmt(data?.campaigns.totalDelivered)}</strong>
        {' · '}
        총 도달 (recipients) <strong style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{fmt(data?.campaigns.totalRecipients)}</strong>
      </div>

      {/* ━━ 4-4. 지역 분석 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: 'var(--text-3)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginTop: 24,
          marginBottom: 10,
          paddingBottom: 6,
          borderBottom: '1px solid var(--border)',
        }}
      >
        ━━ 지역 분석 ━━
      </div>

      {/* 4-4-1. 지역별 분포 (매장 / 사용자) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <ChartCard
          title="지역별 매장 분포"
          subtitle="status=active 또는 isDemo 기준"
        >
          {storeRegionBarData.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>
              {loading && !data ? '불러오는 중…' : '데이터가 아직 없습니다.'}
            </div>
          ) : (
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={storeRegionBarData}
                  margin={{ top: 10, right: 16, left: 0, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    allowDecimals={false}
                    width={32}
                  />
                  <Tooltip content={<SimpleTooltip />} cursor={{ fill: 'var(--surface-3)', opacity: 0.4 }} />
                  <Bar
                    dataKey="value"
                    name="매장 수"
                    fill="var(--brand)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="지역별 사용자 분포"
          subtitle="즐겨찾기 매장 지역 최다 빈도 기반 추정"
        >
          {userRegionBarData.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>
              {loading && !data ? '불러오는 중…' : '데이터가 아직 없습니다.'}
            </div>
          ) : (
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={userRegionBarData}
                  margin={{ top: 10, right: 16, left: 0, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    allowDecimals={false}
                    width={32}
                  />
                  <Tooltip content={<SimpleTooltip />} cursor={{ fill: 'var(--surface-3)', opacity: 0.4 }} />
                  <Bar
                    dataKey="value"
                    name="사용자 수"
                    fill="var(--gold)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      {/* 4-4-2. 영업 기회 매트릭스 */}
      <SectionLabel>영업 기회 매트릭스</SectionLabel>
      <RegionOpportunityTable rows={opportunityRows} loading={loading && !data} />

      {/* 4-4-3. 지역별 가입자 추이 (30일) */}
      <div className="mt-3 mb-8">
        <ChartCard
          title="지역별 신규 가입자 추이 (30일)"
          subtitle="Top 5 지역 + 기타 — 사용자 누적 많은 순"
        >
          {regionLineSeries.rows.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>
              {loading && !data ? '불러오는 중…' : '데이터가 아직 없습니다.'}
            </div>
          ) : (
            <>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={regionLineSeries.rows}
                    margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                  >
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
                    {regionLineSeries.regions.map((region, idx) => (
                      <Line
                        key={region}
                        type="monotone"
                        dataKey={region}
                        name={region}
                        stroke={REGION_PALETTE[idx % REGION_PALETTE.length]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <LegendRow
                items={regionLineSeries.regions.map((region, idx) => ({
                  color: REGION_PALETTE[idx % REGION_PALETTE.length],
                  label: region,
                }))}
              />
            </>
          )}
        </ChartCard>
      </div>

      {/* ━━ 4-5. 콘텐츠 모더레이션 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div
        className="mt-6 mb-2"
        style={{
          fontWeight: 800,
          fontSize: 13,
          color: 'var(--text-1)',
          letterSpacing: '-0.01em',
        }}
      >
        <span style={{ color: 'var(--gold)' }}>━━</span> 콘텐츠 모더레이션 ━━
      </div>

      {/* 4-5-1. 모더레이션 KPI 4 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <SubCard
          label="미처리 신고"
          value={fmt(moderation.pending)}
          accent={moderation.pending > 0 ? 'live' : 'muted'}
          hint="resolved=false 카운트"
        />
        <SubCard
          label="자동 숨김 (이번주)"
          value={fmt(moderation.autoHidden)}
          accent="brand"
          hint="신고 3건 이상 트리거"
        />
        <SubCard
          label="본사 확정 숨김 (이번주)"
          value={fmt(moderation.confirmedHidden)}
          accent="gold"
          hint="resolution=hide"
        />
        <SubCard
          label="복원 (이번주)"
          value={fmt(moderation.restored)}
          accent="success"
          hint="resolution=restore"
        />
      </div>

      {/* 4-5-2. 최근 신고 5건 미니 리스트 */}
      <ChartCard
        title="최근 신고 5건"
        subtitle="자세한 처리는 리뷰 관리 페이지에서"
        right={
          <Link
            href="/platform/reviews"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--brand)',
              textDecoration: 'none',
            }}
          >
            리뷰 관리 →
          </Link>
        }
      >
        {moderation.recent.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-3)',
              padding: '16px 4px',
              textAlign: 'center',
            }}
          >
            최근 신고 없음
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {moderation.recent.map((rep) => (
              <li
                key={rep.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 4px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: 4,
                    background: rep.resolved ? 'var(--surface-2)' : 'rgba(239, 68, 68, 0.12)',
                    color: rep.resolved ? 'var(--text-3)' : '#EF4444',
                    border: rep.resolved ? '1px solid var(--border)' : '1px solid rgba(239, 68, 68, 0.45)',
                    minWidth: 44,
                    textAlign: 'center',
                  }}
                >
                  {rep.resolved ? '처리됨' : '미처리'}
                </span>
                <span style={{ color: 'var(--text-2)', fontWeight: 700, minWidth: 64 }}>
                  {DASHBOARD_REASON_LABEL[rep.reason] ?? rep.reason}
                </span>
                <span style={{ color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {rep.detail ? rep.detail : `${rep.targetType} · ${rep.targetId.slice(0, 12)}…`}
                </span>
                <span style={{ color: 'var(--text-3)', fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {formatTs(rep.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
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
// RankTableCard — 순위 · 매장명 · 메트릭 3열 테이블 카드
// 인기 / 비인기 매장 양쪽에서 재사용.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function RankTableCard({
  title,
  subtitle,
  rows,
  metricLabel,
  loading,
  accent,
  footnote,
}: {
  title: string;
  subtitle?: string;
  rows: TopStore[];
  metricLabel: string;
  loading?: boolean;
  accent: 'brand' | 'gold' | 'muted';
  footnote?: string;
}) {
  const metricColor =
    accent === 'brand'
      ? 'var(--brand)'
      : accent === 'gold'
        ? 'var(--gold)'
        : 'var(--text-2)';
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: '16px 18px',
      }}
    >
      <div className="mb-3">
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
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>
          불러오는 중…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>
          데이터가 아직 없습니다.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <thead>
              <tr style={{ color: 'var(--text-3)', fontSize: 11 }}>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    fontWeight: 700,
                    borderBottom: '1px solid var(--border)',
                    width: 36,
                  }}
                >
                  순위
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    fontWeight: 700,
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  매장명
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: '6px 8px',
                    fontWeight: 700,
                    borderBottom: '1px solid var(--border)',
                    width: 80,
                  }}
                >
                  {metricLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rank = i + 1;
                return (
                  <tr
                    key={r.id}
                    className="group"
                    style={{
                      borderBottom: '1px solid var(--border)',
                      transition: 'background 120ms',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = 'var(--surface-2)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
                    }}
                  >
                    <td
                      style={{
                        padding: '7px 8px',
                        color: 'var(--text-3)',
                        fontWeight: 700,
                      }}
                    >
                      {rank}
                    </td>
                    <td
                      style={{
                        padding: '7px 8px',
                        color: 'var(--text-1)',
                        fontWeight: 600,
                        maxWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.name}
                    </td>
                    <td
                      style={{
                        padding: '7px 8px',
                        color: metricColor,
                        fontWeight: 700,
                        textAlign: 'right',
                      }}
                    >
                      {fmt(r.metric)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {footnote && (
        <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8 }}>
          ※ {footnote}
        </div>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BarStoreTooltip — 매장별 cardClicks 차트용 (전체 이름 표시)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface BarStorePayload {
  name?: string;
  value?: number;
  payload?: { name?: string; shortName?: string };
}

function BarStoreTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: BarStorePayload[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const fullName = p.payload?.name ?? p.payload?.shortName ?? '';
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
      <div style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 2 }}>
        {fullName}
      </div>
      <div
        className="font-mono"
        style={{
          color: 'var(--brand)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        카드 클릭 {fmt(p.value)}회
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RegionOpportunityTable — 지역별 영업 우선순위
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function recommendationLabel(score: number): { text: string; tone: 'urgent' | 'gold' | 'idle' } {
  if (score >= 70) return { text: '🔥 즉시 영업 추천', tone: 'urgent' };
  if (score >= 50) return { text: '📈 영업 검토', tone: 'gold' };
  return { text: '✅ 안정', tone: 'idle' };
}

function opportunityBarColor(score: number): string {
  if (score >= 70) return 'linear-gradient(90deg, #E53E3E 0%, #FCA5A5 100%)';
  if (score >= 50) return 'var(--gold)';
  return 'var(--text-3)';
}

function recommendationStyle(tone: 'urgent' | 'gold' | 'idle'): React.CSSProperties {
  if (tone === 'urgent') {
    return {
      color: '#FCA5A5',
      background: 'rgba(229, 62, 62, 0.12)',
      border: '1px solid rgba(229, 62, 62, 0.4)',
    };
  }
  if (tone === 'gold') {
    return {
      color: '#FCD34D',
      background: 'rgba(245, 158, 11, 0.12)',
      border: '1px solid rgba(245, 158, 11, 0.4)',
    };
  }
  return {
    color: 'var(--text-3)',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
  };
}

function RegionOpportunityTable({
  rows,
  loading,
}: {
  rows: RegionOpportunity[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: '14px 16px',
          fontSize: 12,
          color: 'var(--text-3)',
        }}
      >
        불러오는 중…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: '14px 16px',
          fontSize: 12,
          color: 'var(--text-3)',
        }}
      >
        영업 기회 데이터가 아직 없습니다.
      </div>
    );
  }
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: '8px 4px',
        overflowX: 'auto',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <thead>
          <tr style={{ color: 'var(--text-3)', fontSize: 11 }}>
            <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid var(--border)', width: 48 }}>순위</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>지역</th>
            <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>사용자</th>
            <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>매장</th>
            <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>매장당 사용자</th>
            <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>LIVE 누적</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid var(--border)', minWidth: 180 }}>기회 점수</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid var(--border)', width: 150 }}>추천</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const rec = recommendationLabel(r.opportunityScore);
            const pct = Math.max(0, Math.min(100, r.opportunityScore));
            return (
              <tr key={r.region} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px', color: 'var(--text-3)', fontWeight: 700 }}>{idx + 1}</td>
                <td style={{ padding: '10px', color: 'var(--text-1)', fontWeight: 700 }}>{r.region}</td>
                <td style={{ padding: '10px', textAlign: 'right', color: 'var(--text-1)' }}>{fmt(r.userCount)}</td>
                <td style={{ padding: '10px', textAlign: 'right', color: 'var(--text-1)' }}>{fmt(r.storeCount)}</td>
                <td style={{ padding: '10px', textAlign: 'right', color: 'var(--text-2)' }}>{r.userToStoreRatio.toFixed(1)}</td>
                <td style={{ padding: '10px', textAlign: 'right', color: 'var(--text-2)' }}>{fmt(r.liveSessionsTotal)}</td>
                <td style={{ padding: '10px' }}>
                  <div className="flex items-center gap-2">
                    <div
                      style={{
                        flex: 1,
                        height: 8,
                        background: 'var(--surface-2)',
                        borderRadius: 4,
                        overflow: 'hidden',
                        minWidth: 80,
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: opportunityBarColor(r.opportunityScore),
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <span style={{ width: 40, textAlign: 'right', fontWeight: 700, color: 'var(--text-1)' }}>
                      {r.opportunityScore.toFixed(1)}
                    </span>
                  </div>
                </td>
                <td style={{ padding: '10px' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '3px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      ...recommendationStyle(rec.tone),
                    }}
                  >
                    {rec.text}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RecentUsersTable — 최근 가입 사용자 10명
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function RecentUsersTable({
  users,
  loading,
}: {
  users: UserSummary[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>
        불러오는 중…
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>
        가입 사용자가 없습니다.
      </div>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <thead>
          <tr style={{ color: 'var(--text-3)', fontSize: 11 }}>
            <th
              style={{
                textAlign: 'left',
                padding: '6px 8px',
                fontWeight: 700,
                borderBottom: '1px solid var(--border)',
              }}
            >
              닉네임
            </th>
            <th
              style={{
                textAlign: 'left',
                padding: '6px 8px',
                fontWeight: 700,
                borderBottom: '1px solid var(--border)',
              }}
            >
              이메일
            </th>
            <th
              style={{
                textAlign: 'left',
                padding: '6px 8px',
                fontWeight: 700,
                borderBottom: '1px solid var(--border)',
                width: 120,
              }}
            >
              가입일
            </th>
            <th
              style={{
                textAlign: 'left',
                padding: '6px 8px',
                fontWeight: 700,
                borderBottom: '1px solid var(--border)',
                width: 120,
              }}
            >
              마지막 활동
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.uid}
              style={{
                borderBottom: '1px solid var(--border)',
                transition: 'background 120ms',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = 'var(--surface-2)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
              }}
            >
              <td
                style={{
                  padding: '7px 8px',
                  color: 'var(--text-1)',
                  fontWeight: 600,
                }}
              >
                {u.displayName?.trim() || '-'}
              </td>
              <td
                style={{
                  padding: '7px 8px',
                  color: 'var(--text-2)',
                  maxWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {u.email?.trim() || '-'}
              </td>
              <td style={{ padding: '7px 8px', color: 'var(--text-2)' }}>
                {formatTs(u.createdAt)}
              </td>
              <td style={{ padding: '7px 8px', color: 'var(--text-3)' }}>
                {formatTs(u.lastActiveAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SubCard — 큰 KPI 보조 카드 (label + value + hint)
// 큰 KPI(KpiCard) 절반 사이즈. 회사 회의·인쇄용 정보 밀도 유지.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function SubCard({
  label,
  value,
  hint,
  accent = 'muted',
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: 'brand' | 'gold' | 'live' | 'success' | 'muted';
}) {
  const accentColor =
    accent === 'brand'
      ? 'var(--brand)'
      : accent === 'gold'
        ? 'var(--gold)'
        : accent === 'live'
          ? COLOR_LIVE
          : accent === 'success'
            ? COLOR_SUCCESS
            : 'var(--text-3)';
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 'var(--r-md)',
        padding: '10px 12px',
        minHeight: 72,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: 'var(--text-3)',
          letterSpacing: '0.02em',
          lineHeight: 1.2,
        }}
      >
        {label}
      </div>
      <div
        className="font-mono"
        style={{
          fontSize: 19,
          fontWeight: 800,
          color: 'var(--text-1)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.1 }}>
          {hint}
        </div>
      )}
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
