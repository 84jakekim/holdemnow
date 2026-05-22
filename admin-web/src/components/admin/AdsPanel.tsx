'use client';

/**
 * 매장 어드민 — 광고 / 플랜 페이지 (2026-05-22 v2).
 *
 * 정책:
 * - 4등급: Free(기본) / Light / Pro / Tournament Pack
 * - 가격 산정 기준: 부산·경남 홀덤펍 일평균 매출 100~300만원, 광고비는 매출의 0.3~0.7%
 *   → 월 1.5만 ~ 5만원대로 부담 ↓, 본사 BEP는 매장 100곳 결제로 솔로 빌더 운영비 충당
 * - 결제는 **준비 중** — PG(토스페이먼츠) 심사 통과 후 v0.3에 활성화. 지금은 UI만 노출.
 * - 현재 본사 어드민(/platform/ads)에서 수동 발급된 슬롯은 "🎁 본사 시범 발급" 영역으로 표시
 *
 * 매장이 부담 없이 가입 → 무료 등급으로 충분히 효과 체감 → Light/Pro 자연 전환 유도.
 */

import { useEffect, useMemo, useState } from 'react';
import { type AdSlot, subscribeAdSlotsByStore } from '@/lib/adSlots';

interface Props {
  storeId: string;
  storeName: string;
}

export default function AdsPanel({ storeId, storeName }: Props) {
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDetail, setShowDetail] = useState<PlanId | null>(null);

  useEffect(() => {
    const unsub = subscribeAdSlotsByStore(
      storeId,
      (items) => { setSlots(items); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, [storeId]);

  const activeSlot = useMemo(() => {
    const now = Date.now();
    return slots.find((s) => s.status === 'active' && (s.endAt?.toMillis?.() ?? 0) > now) ?? null;
  }, [slots]);

  const currentPlanId: PlanId = activeSlot
    ? activeSlot.tier === 'premium'
      ? 'pro'
      : 'light'
    : 'free';

  return (
    <div className="max-w-4xl">
      {/* 헤더 */}
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">📣 광고 / 플랜</h1>
        <p className="text-sm text-gray-500 mt-1">
          {storeName}의 노출을 더 강화할 수 있는 플랜이에요. 부담 없이 시작 가능합니다.
        </p>
      </div>

      {/* 현재 상태 카드 */}
      <CurrentStatusCard loading={loading} activeSlot={activeSlot} planId={currentPlanId} />

      {/* 안내 배너 — 결제 비활성 */}
      <div
        className="mb-6 rounded-xl p-3 flex items-start gap-3"
        style={{ background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)', border: '1px solid #F59E0B' }}
      >
        <div className="text-xl flex-shrink-0">🔒</div>
        <div className="text-xs leading-relaxed" style={{ color: '#78350F' }}>
          <b>유료 플랜은 준비 중입니다.</b> 토스페이먼츠 심사 통과 후 v0.3에 결제가 열려요.<br />
          그동안 본사가 시범으로 광고 슬롯을 부여할 수 있습니다. 카톡방에서 요청해 주세요.
        </div>
      </div>

      {/* 4개 플랜 카드 */}
      <div className="mb-6">
        <div className="text-xs font-bold text-gray-500 tracking-wider mb-3">매장 플랜</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={plan.id === currentPlanId}
              onDetail={() => setShowDetail(plan.id)}
            />
          ))}
        </div>
      </div>

      {/* ROI 가늠자 */}
      <RoiEstimator />

      {/* 비교표 */}
      <ComparisonTable currentPlanId={currentPlanId} />

      {/* FAQ */}
      <Faq />

      {showDetail && (
        <PlanDetailModal
          plan={PLANS.find((p) => p.id === showDetail)!}
          onClose={() => setShowDetail(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 플랜 정의 (PM 단독 결재 2026-05-22)
// ─────────────────────────────────────────────────────────────

type PlanId = 'free' | 'light' | 'pro' | 'tournament';

interface Plan {
  id: PlanId;
  name: string;
  tag: string;
  priceText: string;
  priceUnit?: string;
  monthlyKRW: number; // 본사 매출 시뮬레이션용
  tone: 'free' | 'light' | 'pro' | 'event';
  badge?: string;
  features: string[];
  /** 매장 입장 ROI 한 줄 요약 */
  roiHint: string;
  /** 상세 모달용 — 더 풍부한 설명 */
  detail: {
    target: string;
    valueProp: string[];
    expectedKpi: string;
  };
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'FREE',
    tag: '모든 매장 기본',
    priceText: '무료',
    monthlyKRW: 0,
    tone: 'free',
    features: [
      '매장 등록 + 기본 노출',
      '오늘의 소식 1일 3건',
      'LIVE 토너 운영 + 타이머 송출',
      '매장 TV 풀스크린',
      '예약 받기 + 알림',
      '딜러풀·구인 무제한',
      '이번 주 통계',
    ],
    roiHint: '핵심 기능은 무료. 효과 보고 다음 단계로.',
    detail: {
      target: '이제 막 가입한 매장, 작은 운영실',
      valueProp: [
        '광고비 0원으로 카톡방 600명 + 앱 사용자에게 노출',
        '예약/LIVE/디스플레이 등 운영 도구 전부 사용 가능',
        '본사 시범 광고 발급 대상에 자동 포함',
      ],
      expectedKpi: '주간 노출 200~800회, 길찾기 5~30건',
    },
  },
  {
    id: 'light',
    name: 'LIGHT',
    tag: '동네 단골 강화',
    priceText: '15,000',
    priceUnit: '원/월',
    monthlyKRW: 15000,
    tone: 'light',
    badge: '입문 추천',
    features: [
      'FREE 전체 +',
      '검색 결과 상위 회전 노출 (Standard)',
      '오늘의 소식 1일 5건',
      '월간 통계 + 길찾기 추이',
      '매장 인증 배지 ✅',
      '본사 푸시 알림 월 1회',
    ],
    roiHint: '매장 매출의 약 0.2% — 길찾기 +15건이면 본전',
    detail: {
      target: '월매출 700만 이상, 단골 비중이 높은 동네 펍',
      valueProp: [
        '동네 사용자에게 5분 회전 슬롯으로 꾸준히 노출',
        '"인증 매장" 배지로 신뢰감 ↑',
        '월 1회 본사 푸시로 신규 토너/이벤트 홍보',
      ],
      expectedKpi: '주간 노출 1,500~3,000회, 길찾기 +15~40건, ROI 약 4~8배',
    },
  },
  {
    id: 'pro',
    name: 'PRO',
    tag: '신규 확보 + 대회 부킹',
    priceText: '39,000',
    priceUnit: '원/월',
    monthlyKRW: 39000,
    tone: 'pro',
    badge: '추천',
    features: [
      'LIGHT 전체 +',
      '검색 상단 보장 노출 (Premium)',
      '오늘의 소식 1일 10건',
      '홈 캐러셀 우선 노출권',
      '90일 통계 + CSV 다운로드',
      '본사 푸시 알림 월 3회',
      '딜러 프로필 상단 보장',
    ],
    roiHint: '매장 매출의 약 0.5% — 신규 +25명이면 ROI 5배 이상',
    detail: {
      target: '월매출 1,500만 이상, 정기 토너 운영 매장',
      valueProp: [
        'Premium 슬롯으로 부산·경남 검색 상단 보장',
        '홈 캐러셀 우선 노출 — 신규 사용자 첫 화면에 노출',
        'CSV 통계로 마케팅 정량 분석 가능',
        '딜러 프로필 상단 → 좋은 딜러 채용 유리',
      ],
      expectedKpi: '주간 노출 5,000~10,000회, 길찾기 +40~80건, 신규 +20~40명',
    },
  },
  {
    id: 'tournament',
    name: 'TOURNEY PACK',
    tag: '대회 단발성',
    priceText: '20,000',
    priceUnit: '원/회',
    monthlyKRW: 0, // 단발성이라 월 BEP 산정에는 별도
    tone: 'event',
    features: [
      '대회 시작 24시간 전부터 노출 강화',
      '홈 캐러셀 핀 고정 (지역 1순위)',
      '본사 푸시 알림 1회 (대회 D-1)',
      '대회 종료까지 Premium 슬롯',
      'LIGHT/PRO 가입 매장은 50% 할인',
    ],
    roiHint: '큰 대회 1회당 2만원 — 참가자 +3명이면 본전',
    detail: {
      target: '월 1~2회 큰 대회를 여는 매장, 시즈널 이벤트',
      valueProp: [
        '대회 D-1 본사 푸시로 부산·경남 1,200명에게 안내',
        '대회 시작 24시간 홈 우선 노출',
        '단발성이라 부담 없음. 효과 확인 후 정기 플랜 검토 가능',
      ],
      expectedKpi: '대회 1회 참가 +3~10명, 매장 인지도 +α',
    },
  },
];

// ─────────────────────────────────────────────────────────────
// 현재 상태 카드
// ─────────────────────────────────────────────────────────────

function CurrentStatusCard({
  loading,
  activeSlot,
  planId,
}: {
  loading: boolean;
  activeSlot: AdSlot | null;
  planId: PlanId;
}) {
  if (loading) {
    return (
      <div className="mb-5 rounded-xl bg-gray-100 p-4 text-sm text-gray-500">
        현재 상태 확인 중…
      </div>
    );
  }

  if (activeSlot) {
    const endMs = activeSlot.endAt?.toMillis?.() ?? 0;
    const daysLeft = Math.max(0, Math.ceil((endMs - Date.now()) / (24 * 60 * 60 * 1000)));
    const tierLabel = activeSlot.tier === 'premium' ? 'Premium (PRO 등급)' : 'Standard (LIGHT 등급)';

    return (
      <div
        className="mb-5 rounded-xl p-4 flex items-center gap-4"
        style={{ background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)', border: '1px solid #10B981' }}
      >
        <div className="text-3xl flex-shrink-0">🎁</div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-extrabold tracking-wider text-emerald-700">
            본사 시범 발급 광고 진행 중
          </div>
          <div className="font-extrabold text-gray-900 mt-0.5">{tierLabel}</div>
          <div className="text-xs text-gray-700 mt-1">
            남은 기간 <b className="font-mono">{daysLeft}일</b> · 노출{' '}
            <b className="font-mono">{activeSlot.impressions ?? 0}</b>회 · 클릭{' '}
            <b className="font-mono">{activeSlot.clicks ?? 0}</b>회
            {activeSlot.paidAmount === 0 && (
              <span className="ml-2 text-emerald-700 font-bold">· 무료 시범</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mb-5 rounded-xl p-4 flex items-center gap-4"
      style={{ background: '#F3F4F6', border: '1px solid #D1D5DB' }}
    >
      <div className="text-3xl flex-shrink-0">🏪</div>
      <div className="flex-1">
        <div className="text-[11px] font-extrabold tracking-wider text-gray-600">현재 플랜</div>
        <div className="font-extrabold text-gray-900 mt-0.5">FREE</div>
        <div className="text-xs text-gray-600 mt-1">
          모든 핵심 기능을 무료로 사용 중. 본사 시범 광고 발급 대상에 자동 포함됩니다.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 플랜 카드
// ─────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  isCurrent,
  onDetail,
}: {
  plan: Plan;
  isCurrent: boolean;
  onDetail: () => void;
}) {
  const toneStyles: Record<Plan['tone'], { bg: string; border: string; accent: string }> = {
    free: { bg: '#F9FAFB', border: '#D1D5DB', accent: '#6B7280' },
    light: { bg: 'linear-gradient(135deg, #ECFEFF 0%, #CFFAFE 100%)', border: '#06B6D4', accent: '#0E7490' },
    pro: { bg: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)', border: '#F59E0B', accent: '#92400E' },
    event: { bg: 'linear-gradient(135deg, #FCE7F3 0%, #FBCFE8 100%)', border: '#EC4899', accent: '#9F1239' },
  };
  const s = toneStyles[plan.tone];
  const isLockedPaid = plan.id !== 'free';

  return (
    <div
      className="relative rounded-2xl border-2 p-4 flex flex-col"
      style={{ background: s.bg, borderColor: isCurrent ? '#10B981' : s.border }}
    >
      {plan.badge && (
        <div
          className="absolute -top-2 right-3 text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white"
          style={{ background: s.accent }}
        >
          {plan.badge}
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-2 left-3 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500 text-white">
          ✓ 현재
        </div>
      )}

      <div className="text-[11px] font-extrabold tracking-widest mb-1" style={{ color: s.accent }}>
        {plan.name}
      </div>
      <div className="text-[10px] text-gray-500 mb-2">{plan.tag}</div>
      <div className="flex items-baseline gap-1 mb-3">
        <span className="font-mono text-2xl font-extrabold text-gray-900">{plan.priceText}</span>
        {plan.priceUnit && <span className="text-xs text-gray-500">{plan.priceUnit}</span>}
      </div>

      <ul className="text-xs space-y-1 mb-3 flex-1">
        {plan.features.slice(0, 4).map((f, i) => (
          <li key={i} className="text-gray-700 leading-tight">
            <span className="text-emerald-600 mr-1">✓</span>{f}
          </li>
        ))}
        {plan.features.length > 4 && (
          <li className="text-[10px] text-gray-500">+ {plan.features.length - 4}개 더</li>
        )}
      </ul>

      <div
        className="text-[10px] mb-3 rounded p-2 leading-snug"
        style={{ background: 'rgba(255,255,255,0.5)', color: s.accent }}
      >
        💡 {plan.roiHint}
      </div>

      <button
        onClick={onDetail}
        className="w-full py-2 rounded-lg text-xs font-bold border-2 mb-2"
        style={{ borderColor: s.accent, color: s.accent, background: 'rgba(255,255,255,0.6)' }}
      >
        자세히 보기
      </button>

      {isLockedPaid ? (
        <button
          disabled
          className="w-full py-2 rounded-lg text-xs font-bold bg-gray-200 text-gray-500 cursor-not-allowed"
          title="PG 결제 도입 후 활성화"
        >
          🔒 준비 중
        </button>
      ) : (
        <button
          disabled
          className="w-full py-2 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-700 cursor-default"
        >
          현재 사용 중
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ROI 가늠자
// ─────────────────────────────────────────────────────────────

function RoiEstimator() {
  const [monthlyRevenue, setMonthlyRevenue] = useState(1500); // 만원 단위
  const [planId, setPlanId] = useState<'light' | 'pro'>('pro');

  const plan = PLANS.find((p) => p.id === planId)!;
  const planPrice = plan.monthlyKRW;
  const ratio = monthlyRevenue > 0 ? (planPrice / (monthlyRevenue * 10000)) * 100 : 0;
  // 보수적 추정: LIGHT 길찾기 +20건/월, PRO +60건/월. 방문 전환 50%, 객단가 = 매출/방문수 가정
  // 매장 평균 방문수를 매출/3만 으로 가정
  const visitsPerMonth = Math.max(1, Math.round((monthlyRevenue * 10000) / 30000));
  const directionsGain = planId === 'light' ? 20 : 60;
  const newVisits = Math.round(directionsGain * 0.5);
  const avgTicket = Math.round((monthlyRevenue * 10000) / visitsPerMonth);
  const revenueGain = newVisits * avgTicket;
  const roiX = planPrice > 0 ? (revenueGain / planPrice).toFixed(1) : '∞';

  return (
    <div className="mb-6 rounded-xl border-2 border-gray-200 bg-white p-4">
      <div className="text-xs font-bold text-gray-500 tracking-wider mb-3">💰 우리 매장 ROI 가늠해보기</div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-[200px]">
          <label className="text-[11px] text-gray-600 block mb-1">월매출 (만원)</label>
          <input
            type="range"
            min={300}
            max={5000}
            step={100}
            value={monthlyRevenue}
            onChange={(e) => setMonthlyRevenue(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-sm font-mono font-bold text-gray-900 mt-1">
            ₩{(monthlyRevenue * 10000).toLocaleString()}
          </div>
        </div>
        <div>
          <label className="text-[11px] text-gray-600 block mb-1">플랜</label>
          <div className="flex gap-2">
            {(['light', 'pro'] as const).map((id) => (
              <button
                key={id}
                onClick={() => setPlanId(id)}
                className={`px-3 py-1.5 rounded text-xs font-bold ${
                  planId === id
                    ? 'bg-black text-white'
                    : 'bg-gray-100 text-gray-700 border border-gray-300'
                }`}
              >
                {id.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        <Metric label="플랜 비용" value={`₩${planPrice.toLocaleString()}`} hint={`매출의 ${ratio.toFixed(2)}%`} />
        <Metric label="길찾기 +" value={`+${directionsGain}건`} hint="월간 추정" />
        <Metric label="신규 방문 +" value={`+${newVisits}명`} hint="50% 전환 가정" />
        <Metric
          label="ROI"
          value={`${roiX}배`}
          hint={`+₩${revenueGain.toLocaleString()}`}
          accent
        />
      </div>

      <div className="text-[10px] text-gray-400 mt-3 leading-relaxed">
        * 부산·경남 홀덤펍 평균 데이터 기준 보수적 추정치. 실제 효과는 매장 위치·시간대·시즌에 따라 다릅니다.
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-lg p-2"
      style={{
        background: accent ? '#FEF3C7' : '#F9FAFB',
        border: accent ? '1px solid #F59E0B' : '1px solid #E5E7EB',
      }}
    >
      <div className="text-[10px] text-gray-500 font-bold">{label}</div>
      <div className={`font-mono font-extrabold text-sm mt-0.5 ${accent ? 'text-amber-900' : 'text-gray-900'}`}>
        {value}
      </div>
      {hint && <div className="text-[9px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 비교표
// ─────────────────────────────────────────────────────────────

interface FeatureRow {
  label: string;
  values: Record<PlanId, string>;
}

const FEATURE_TABLE: FeatureRow[] = [
  {
    label: '매장 등록 + 기본 노출',
    values: { free: '✓', light: '✓', pro: '✓', tournament: '✓' },
  },
  {
    label: '오늘의 소식 (1일)',
    values: { free: '3건', light: '5건', pro: '10건', tournament: '+무제한 (대회기간)' },
  },
  {
    label: '검색 노출',
    values: { free: '기본', light: 'Standard 회전', pro: 'Premium 보장', tournament: 'Premium (24h)' },
  },
  {
    label: '홈 캐러셀',
    values: { free: '랜덤', light: '랜덤', pro: '우선', tournament: '핀 고정' },
  },
  {
    label: '통계',
    values: { free: '이번 주', light: '월간', pro: '90일 + CSV', tournament: '대회 리포트' },
  },
  {
    label: '인증 배지',
    values: { free: '—', light: '✅', pro: '✅✅', tournament: '—' },
  },
  {
    label: '본사 푸시 알림',
    values: { free: '—', light: '월 1회', pro: '월 3회', tournament: '대회 D-1' },
  },
  {
    label: '딜러풀 우선 노출',
    values: { free: '—', light: '—', pro: '상단', tournament: '—' },
  },
];

function ComparisonTable({ currentPlanId }: { currentPlanId: PlanId }) {
  return (
    <div className="mb-6 rounded-xl border-2 border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="text-xs font-bold text-gray-500 tracking-wider">📋 플랜 비교표</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-3 py-2 font-bold text-gray-600">기능</th>
              {(['free', 'light', 'pro', 'tournament'] as PlanId[]).map((id) => (
                <th
                  key={id}
                  className={`text-center px-3 py-2 font-extrabold ${
                    id === currentPlanId ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700'
                  }`}
                >
                  {id === 'tournament' ? 'TOURNEY' : id.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURE_TABLE.map((row) => (
              <tr key={row.label} className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-700">{row.label}</td>
                {(['free', 'light', 'pro', 'tournament'] as PlanId[]).map((id) => (
                  <td
                    key={id}
                    className={`text-center px-3 py-2 ${
                      id === currentPlanId ? 'bg-emerald-50' : ''
                    }`}
                  >
                    {row.values[id]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FAQ
// ─────────────────────────────────────────────────────────────

function Faq() {
  const items = [
    {
      q: '결제는 언제부터 되나요?',
      a: '토스페이먼츠 PG 심사 통과 후 v0.3에 활성화됩니다. 그동안 본사가 시범으로 광고 슬롯을 부여할 수 있어요.',
    },
    {
      q: '광고비가 부담스럽지 않나요?',
      a: 'PRO도 매장 매출의 0.3~0.7% 수준입니다. 길찾기 +40건이면 본전이고, 평균 ROI는 4~8배예요.',
    },
    {
      q: '중간에 해지할 수 있나요?',
      a: '월 단위 결제라 다음달 자동 갱신을 끄면 그달까지 사용 후 자동 해지됩니다.',
    },
    {
      q: '환불 정책은요?',
      a: '광고 노출 시작 전이면 100% 환불, 노출 시작 후엔 사용 일수 차감 환불입니다.',
    },
    {
      q: '여러 매장 운영 중인데 할인되나요?',
      a: '같은 사장님 명의 2개 매장 동시 가입 시 두 번째 매장 30% 할인 (v0.3 도입 예정).',
    },
  ];

  return (
    <div className="mb-6">
      <div className="text-xs font-bold text-gray-500 tracking-wider mb-3">❓ 자주 묻는 질문</div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <details
            key={i}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
          >
            <summary className="font-bold text-gray-800 cursor-pointer">{item.q}</summary>
            <div className="mt-2 text-gray-600 leading-relaxed">{item.a}</div>
          </details>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 상세 모달
// ─────────────────────────────────────────────────────────────

function PlanDetailModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const toneColors: Record<Plan['tone'], string> = {
    free: '#6B7280',
    light: '#0E7490',
    pro: '#92400E',
    event: '#9F1239',
  };
  const color = toneColors[plan.tone];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[10px] font-extrabold tracking-widest" style={{ color }}>
              {plan.name}
            </div>
            <div className="text-xs text-gray-500">{plan.tag}</div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="flex items-baseline gap-1 mb-4">
          <span className="font-mono text-3xl font-extrabold text-gray-900">{plan.priceText}</span>
          {plan.priceUnit && <span className="text-sm text-gray-500">{plan.priceUnit}</span>}
        </div>

        <Section title="이런 매장에 추천해요">
          <div className="text-sm text-gray-700">{plan.detail.target}</div>
        </Section>

        <Section title="가치 제안">
          <ul className="text-sm text-gray-700 space-y-1.5">
            {plan.detail.valueProp.map((v, i) => (
              <li key={i}>
                <span className="text-emerald-600 mr-1">✓</span>{v}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="포함 기능 전체">
          <ul className="text-xs text-gray-700 space-y-1">
            {plan.features.map((f, i) => (
              <li key={i}>• {f}</li>
            ))}
          </ul>
        </Section>

        <Section title="예상 효과">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            📊 {plan.detail.expectedKpi}
          </div>
        </Section>

        {plan.id !== 'free' && (
          <div className="mt-5">
            <button
              disabled
              className="w-full py-3 rounded-lg bg-gray-200 text-gray-500 font-bold text-sm cursor-not-allowed"
              title="PG 결제 도입 후 활성화"
            >
              🔒 결제 준비 중 — v0.3에 열려요
            </button>
            <div className="text-[10px] text-gray-400 text-center mt-2">
              지금은 본사가 시범으로 발급해드릴 수 있어요. 카톡방에서 요청해 주세요.
            </div>
          </div>
        )}
        {plan.id === 'free' && (
          <div className="mt-5">
            <button
              disabled
              className="w-full py-3 rounded-lg bg-emerald-100 text-emerald-700 font-bold text-sm cursor-default"
            >
              현재 사용 중인 플랜
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] font-extrabold tracking-widest text-gray-500 mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}

