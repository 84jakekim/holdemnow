'use client';

import { useEffect, useState } from 'react';
import { subscribeStoreMetrics, type StoreMetrics } from '@/lib/analytics';

export default function StatsPanel({ storeId }: { storeId: string }) {
  const [metrics, setMetrics] = useState<StoreMetrics>({});
  useEffect(() => {
    const unsub = subscribeStoreMetrics(storeId, setMetrics);
    return unsub;
  }, [storeId]);

  const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

  // 일별 차트는 dailyMetrics 컬렉션 필요 — v0.2 Cloud Functions 배치 잡으로 추가 예정
  // 지금은 누적 카운터만 표시

  const rows: { label: string; value: string; sub?: string }[] = [
    {
      label: '누적 노출',
      value: fmt(metrics.impressions),
      sub: '홈·탐색·검색 결과에 카드 표시된 횟수 (세션당 중복 제거)',
    },
    {
      label: '카드 클릭 → 매장 상세',
      value: fmt(metrics.cardClicks),
      sub: '디스커버리 → 매장 페이지 진입',
    },
    {
      label: 'LIVE 풀스크린 열기',
      value: fmt(metrics.liveOpens),
      sub: '실시간 LIVE 카드 → 풀스크린',
    },
    {
      label: '길찾기 클릭',
      value: fmt(metrics.directionsClicks),
      sub: '카카오맵 길찾기 호출 — 실제 방문 의도 지표',
    },
    {
      label: '전화 클릭',
      value: fmt(metrics.phoneClicks),
      sub: 'tel: 호출',
    },
    {
      label: '즐겨찾기 추가',
      value: fmt(metrics.favoriteAdds),
      sub: 'LIVE 시작 시 알림 받는 사용자 수',
    },
  ];

  // 클릭 전환율 (impression → cardClick)
  const ctr =
    metrics.impressions && metrics.impressions > 0
      ? (((metrics.cardClicks ?? 0) / metrics.impressions) * 100).toFixed(1)
      : '–';
  // 전환률 (cardClick → directionsClick)
  const visitRate =
    metrics.cardClicks && metrics.cardClicks > 0
      ? (((metrics.directionsClicks ?? 0) / metrics.cardClicks) * 100).toFixed(1)
      : '–';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">📈 통계 리포트</h1>
        <p className="text-sm text-gray-500 mt-1">실시간 누적 지표 · 일별/주별 추이는 v0.2</p>
      </div>

      {/* CTR 카드 */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 rounded-2xl p-5">
          <div className="text-[10px] font-bold text-amber-800 tracking-wider mb-1.5">
            카드 클릭률 (CTR)
          </div>
          <div className="font-mono text-3xl font-extrabold text-gray-900">
            {ctr}{typeof ctr === 'string' && ctr !== '–' ? '%' : ''}
          </div>
          <div className="text-[11px] text-gray-600 mt-2 leading-relaxed">
            노출 → 카드 클릭 비율. 5%↑이면 양호, 10%↑면 우수.
          </div>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-5">
          <div className="text-[10px] font-bold text-green-800 tracking-wider mb-1.5">
            방문 전환율
          </div>
          <div className="font-mono text-3xl font-extrabold text-gray-900">
            {visitRate}{typeof visitRate === 'string' && visitRate !== '–' ? '%' : ''}
          </div>
          <div className="text-[11px] text-gray-600 mt-2 leading-relaxed">
            카드 클릭 → 길찾기 비율. 실제 방문 의도 지표.
          </div>
        </div>
      </div>

      {/* 6개 지표 */}
      <div className="space-y-2 mb-6">
        {rows.map((r) => (
          <div
            key={r.label}
            className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 lift"
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-900">{r.label}</div>
              {r.sub && <div className="text-[11px] text-gray-500 mt-0.5">{r.sub}</div>}
            </div>
            <div className="font-mono text-xl font-extrabold text-gray-900 tabular-nums">
              {r.value}
            </div>
          </div>
        ))}
      </div>

      {/* CSV / 일별 차트는 v0.2 안내 */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-bold text-gray-900 mb-1">📅 v0.2 추가 예정</div>
        <ul className="space-y-1 list-disc list-inside">
          <li>일별·주별 추이 차트 (Cloud Functions 자정 배치)</li>
          <li>지역 평균 대비 비교</li>
          <li>CSV / Excel 다운로드</li>
          <li>광고 캠페인 ROI 자동 산출</li>
        </ul>
      </div>
    </div>
  );
}
