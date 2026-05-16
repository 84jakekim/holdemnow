'use client';

import { useEffect, useState } from 'react';
import { collection, getCountFromServer, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function PlatformDashboard() {
  const [stats, setStats] = useState({
    totalStores: 0,
    activeStores: 0,
    pendingStores: 0,
    demoStores: 0,
    totalSeries: 0,
  });
  const [liveCount, setLiveCount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [total, active, pending, demo, series] = await Promise.all([
          getCountFromServer(collection(db, 'stores')),
          getCountFromServer(query(collection(db, 'stores'), where('status', '==', 'active'))),
          getCountFromServer(query(collection(db, 'stores'), where('status', '==', 'pending'))),
          getCountFromServer(query(collection(db, 'stores'), where('isDemo', '==', true))),
          getCountFromServer(collection(db, 'series')),
        ]);
        setStats({
          totalStores: total.data().count,
          activeStores: active.data().count,
          pendingStores: pending.data().count,
          demoStores: demo.data().count,
          totalSeries: series.data().count,
        });
      } catch {
        // ignore
      }
    })();

    // LIVE 진행 중 실시간
    const unsub = onSnapshot(
      query(collection(db, 'liveSessions'), where('status', 'in', ['running', 'paused'])),
      (s) => setLiveCount(s.size),
      () => {},
    );
    return unsub;
  }, []);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">📊 본사 대시보드</h1>
        <p className="text-sm text-gray-500 mt-1">전체 플랫폼 운영 현황</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="전체 매장" value={stats.totalStores} tag={`데모 ${stats.demoStores} 포함`} />
        <KpiCard label="활성 매장" value={stats.activeStores} tag="active" />
        <KpiCard label="심사 대기" value={stats.pendingStores} tag="pending" highlight={stats.pendingStores > 0} />
        <KpiCard label="실시간 LIVE" value={liveCount} tag="진행 중" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <KpiCard label="등록 시리즈" value={stats.totalSeries} tag="대회사 운영" />
        <KpiCard label="등록 사용자" value={'—'} tag="v0.2 카운터" />
      </div>

      {/* 안내 */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
        <div className="text-xs font-bold text-amber-800 tracking-wider mb-1">🔧 v0.1 본사 어드민 범위</div>
        <ul className="text-xs text-gray-700 space-y-1.5 list-disc list-inside leading-relaxed">
          <li><b>🏬 매장 심사</b>: 가입 후 status=pending 매장 → active 승인</li>
          <li><b>🏆 대회사 심사</b>: 시리즈 운영사 가입 심사 (v0.2)</li>
          <li><b>🛠 데모 데이터</b>: 카톡방 사장님 가입 전 임시 매장 5개 시드</li>
          <li><b>📈 통계</b>: 전체 노출·매출·매장 활성도 (v0.2 — Functions 집계)</li>
        </ul>
      </div>

      <div className="bg-gray-900 text-white rounded-xl p-5">
        <div className="text-xs font-bold text-amber-400 tracking-wider mb-1">⚠ 보안 안내</div>
        <div className="text-sm font-bold mb-2">v0.1 — 모든 인증 사용자가 본사 어드민 진입 가능</div>
        <div className="text-xs text-gray-400 leading-relaxed">
          운영 단계에서는 Firebase Custom Claims로 <code className="bg-gray-800 px-1 rounded">role: &apos;platform_admin&apos;</code> 부여한 계정만 접근 허용.
          Functions 배포 후 정밀 권한 분리.
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tag,
  highlight,
}: {
  label: string;
  value: number | string;
  tag?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 border ${
        highlight ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
      }`}
    >
      <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{label}</div>
      <div className={`font-mono text-2xl font-extrabold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
      </div>
      {tag && <div className="text-[10px] text-gray-500 mt-1">{tag}</div>}
    </div>
  );
}
