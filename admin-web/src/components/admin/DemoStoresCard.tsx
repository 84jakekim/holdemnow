'use client';

import { useEffect, useState } from 'react';
import {
  DEMO_STORES,
  countSeededDemoStores,
  seedDemoStores,
  removeDemoStores,
} from '@/lib/seedStores';

export default function DemoStoresCard({ ownerUid }: { ownerUid: string }) {
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const c = await countSeededDemoStores();
      setCount(c);
    } catch {
      setCount(0);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSeed = async () => {
    setBusy(true);
    setError(null);
    try {
      await seedDemoStores(ownerUid);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm('데모 매장 5개를 모두 삭제할까요? (모바일 앱에서 사라짐)')) return;
    setBusy(true);
    setError(null);
    try {
      await removeDemoStores();
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const seeded = count !== null && count > 0;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs font-bold text-amber-800 tracking-wider mb-1">
            🛠 본사 관리자 도구 · 데모 매장
          </div>
          <div className="font-bold text-gray-900">
            {seeded
              ? `데모 매장 ${count}개가 모바일 앱에 노출 중`
              : '모바일 앱에 표시할 데모 매장 5개를 한 번에 생성'}
          </div>
          <div className="text-xs text-gray-600 mt-1 leading-relaxed">
            카톡방 매장 사장님들이 가입하기 전, 모바일 앱 동작 검증용. 본사 관리자(현재 계정) 소유로 등록되어
            언제든지 삭제 가능.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
        {DEMO_STORES.map((s) => (
          <div key={s.id} className="bg-white rounded-lg border border-amber-200 p-2 text-center">
            <div className="text-[11px] font-bold text-gray-900 truncate">{s.name}</div>
            <div className="text-[9px] text-gray-500 truncate mt-0.5">{s.address.split(' ')[1]}</div>
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
            {busy ? '삭제 중…' : '✕ 데모 매장 5개 모두 삭제'}
          </button>
        ) : (
          <button
            onClick={handleSeed}
            disabled={busy || count === null}
            className="flex-1 py-2.5 rounded-lg bg-amber-600 text-white font-bold text-xs disabled:opacity-40"
          >
            {busy ? '생성 중…' : '+ 데모 매장 5개 한 번에 추가'}
          </button>
        )}
      </div>
    </div>
  );
}
