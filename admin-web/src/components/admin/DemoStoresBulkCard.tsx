'use client';

import { useEffect, useState } from 'react';
import {
  BULK_DEMO_TOTAL,
  BULK_DEMO_DISTRIBUTION,
  countBulkDemoStores,
  seedBulkDemoStores,
  removeBulkDemoStores,
} from '@/lib/seedStoresBulk';

export default function DemoStoresBulkCard({ ownerUid }: { ownerUid: string }) {
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setCount(await countBulkDemoStores());
    } catch {
      setCount(0);
    }
  };

  useEffect(() => {
    let cancelled = false;
    countBulkDemoStores()
      .then((c) => { if (!cancelled) setCount(c); })
      .catch(() => { if (!cancelled) setCount(0); });
    return () => { cancelled = true; };
  }, []);

  const handleSeed = async () => {
    setBusy(true);
    setError(null);
    try {
      await seedBulkDemoStores(ownerUid);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(`bulk100 가상 매장 ${count ?? ''}개를 모두 삭제할까요? (모바일 앱에서 사라짐)`)) return;
    setBusy(true);
    setError(null);
    try {
      await removeBulkDemoStores();
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const seeded = count !== null && count > 0;
  const byRegion = BULK_DEMO_DISTRIBUTION.reduce<Record<string, number>>((acc, a) => {
    acc[a.region] = (acc[a.region] || 0) + a.count;
    return acc;
  }, {});

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs font-bold text-indigo-800 tracking-wider mb-1">
            🛠 본사 관리자 도구 · 가상 매장 (부산·양산·김해 100)
          </div>
          <div className="font-bold text-gray-900">
            {seeded
              ? `가상 매장 ${count}개가 모바일 앱에 노출 중 (bulk100)`
              : `부산·양산·김해 가상 매장 ${BULK_DEMO_TOTAL}개를 한 번에 생성`}
          </div>
          <div className="text-xs text-gray-600 mt-1 leading-relaxed">
            디스커버 페이지 시연용. 본사 관리자(현재 계정) 소유로 등록되어
            <code className="bg-white/60 px-1 rounded mx-1">demoBatch=&apos;bulk100&apos;</code>
            플래그로 한 번에 정리 가능. 사진은 Unsplash 공개 URL 직링크 사용.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {Object.entries(byRegion).map(([region, n]) => (
          <div key={region} className="bg-white rounded-lg border border-indigo-200 p-2 text-center">
            <div className="text-[10px] text-gray-500">{region}</div>
            <div className="text-sm font-extrabold text-gray-900">{n}개</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded p-2 text-[11px] text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        {seeded ? (
          <button
            onClick={handleRemove}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-white border border-red-200 text-red-600 font-bold text-xs disabled:opacity-40"
          >
            {busy ? '삭제 중…' : `✕ bulk100 가상 매장 ${count}개 모두 삭제`}
          </button>
        ) : (
          <button
            onClick={handleSeed}
            disabled={busy || count === null}
            className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white font-bold text-xs disabled:opacity-40"
          >
            {busy ? '생성 중…' : `+ 가상 매장 ${BULK_DEMO_TOTAL}개 한 번에 추가`}
          </button>
        )}
      </div>
    </div>
  );
}
