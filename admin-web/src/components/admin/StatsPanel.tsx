'use client';

import { useMemo } from 'react';

export default function StatsPanel() {
  const days30 = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const dow = i % 7;
      const base = dow === 5 || dow === 6 ? 600 : 350;
      return base + Math.floor(Math.random() * 200);
    });
  }, []);
  const maxBar = Math.max(...days30);
  const total = days30.reduce((a, b) => a + b, 0);

  const campaigns = [
    { name: '추천 대회 노출', cost: '50,000', visits: '34', roi: '+ ₩340K' },
    { name: '지역 타깃 푸시', cost: '80,000', visits: '52', roi: '+ ₩520K' },
    { name: '주간 배너', cost: '300,000', visits: '128', roi: '+ ₩1.28M' },
  ];

  const rankings = [
    { rank: 1, name: '서면 ABC홀덤 (우리 매장)', exp: '4,820', highlight: true },
    { rank: 2, name: '서면 B펍', exp: '3,210' },
    { rank: 3, name: '서면 C카드', exp: '2,890' },
    { rank: 4, name: '서면 D홀덤', exp: '2,140' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">📈 통계 리포트</h1>
        <p className="text-sm text-gray-500 mt-1">최근 30일 노출·클릭·ROI (v0.2 — 실데이터)</p>
      </div>

      {/* 30일 차트 */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6">
        <div className="flex justify-between items-baseline mb-3">
          <div className="text-sm font-bold text-gray-900">30일 노출 추이</div>
          <div className="text-[11px] text-gray-500">총 {total.toLocaleString()}회</div>
        </div>
        <div className="flex items-end gap-0.5 h-24 mb-2">
          {days30.map((v, i) => (
            <div
              key={i}
              className={`flex-1 rounded-t ${i >= 23 ? 'bg-red-500' : 'bg-gray-900'}`}
              style={{ height: `${(v / maxBar) * 100}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between text-[9px] text-gray-400">
          <span>30일 전</span>
          <span className="text-red-600">● 최근 7일</span>
        </div>
      </div>

      {/* ROI 표 */}
      <div className="mb-6">
        <div className="text-xs font-bold text-gray-500 tracking-wider mb-2">광고 캠페인 ROI</div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] font-bold text-gray-500 tracking-wider">
              <tr>
                <th className="text-left p-3">캠페인</th>
                <th className="text-right p-3">비용</th>
                <th className="text-right p-3">추정 방문</th>
                <th className="text-right p-3">ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {campaigns.map((c) => (
                <tr key={c.name}>
                  <td className="p-3">{c.name}</td>
                  <td className="p-3 text-right font-mono font-bold text-gray-900">₩{c.cost}</td>
                  <td className="p-3 text-right font-mono">{c.visits}명</td>
                  <td className="p-3 text-right font-mono font-bold text-green-600">{c.roi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 지역 순위 */}
      <div className="mb-6">
        <div className="text-xs font-bold text-gray-500 tracking-wider mb-2">지역 순위 (서면 15곳 중)</div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {rankings.map((r) => (
                <tr key={r.rank} className={r.highlight ? 'bg-amber-50' : ''}>
                  <td className="p-3 w-12 font-mono font-bold text-center">
                    <span className={r.highlight ? 'text-red-600' : 'text-gray-500'}>#{r.rank}</span>
                  </td>
                  <td className="p-3">
                    <span className={r.highlight ? 'font-bold text-gray-900' : 'text-gray-700'}>
                      {r.name}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono text-gray-700">{r.exp}회</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button
        onClick={() => alert('CSV 다운로드는 v0.2에서 작동합니다')}
        className="w-full py-3 rounded-xl border-[1.5px] border-gray-200 text-sm font-bold text-gray-900 hover:bg-gray-50"
      >
        ⬇ CSV로 내보내기
      </button>

      <div className="mt-4 text-[10px] text-gray-400 text-center">
        v0.2 — Cloud Functions 일일 집계 잡으로 실데이터 표시
      </div>
    </div>
  );
}
