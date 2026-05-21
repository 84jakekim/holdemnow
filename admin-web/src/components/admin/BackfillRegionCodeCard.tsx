'use client';

import { useState } from 'react';
import { backfillRegionCodeForAllStores, type BackfillResult } from '@/lib/backfillRegionCode';

/**
 * 본사 어드민용 1회성 도구 — 모든 매장에 regionCode 필드를 채워넣는다.
 *
 * 사용 시점:
 *   - Sprint 1 Phase B 첫 배포 직후, 기존 seedStores·signup 가입 매장에 일괄 적용.
 *   - 신규 매장은 가입·정보수정 시점에 자동으로 채워지므로 이 버튼은 1회만 누르면 됨.
 *
 * 안전:
 *   - 이미 정상 regionCode가 있으면 skip (idempotent).
 *   - Firestore batch write — 500개씩 쪼개서 일관성 보장.
 */
export default function BackfillRegionCodeCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (busy) return;
    if (!window.confirm('모든 매장의 regionCode를 주소로부터 다시 계산해 채웁니다. 진행할까요?')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await backfillRegionCodeForAllStores();
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-extrabold text-gray-900">🗺 regionCode 백필</h2>
          <p className="text-xs text-gray-500 mt-1">
            기존 매장의 광역 단위 키(부산/경남 등)를 주소로부터 다시 계산합니다. 신규 매장은 가입·수정 시 자동 채워지므로 한 번만 실행하면 됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={busy}
          className="text-xs font-bold px-3 py-2 rounded-lg bg-gray-900 text-white disabled:opacity-50"
        >
          {busy ? '실행 중…' : '백필 실행'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2 mt-2">
          {error}
        </div>
      )}

      {result && (
        <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md p-3 mt-2 space-y-1">
          <div>스캔: <b>{result.scanned}</b></div>
          <div>갱신: <b>{result.updated}</b> (이 중 미분류: {result.unmatched})</div>
          <div>스킵(이미 정상): <b>{result.skipped}</b></div>
          {result.errors > 0 && <div className="text-red-600">오류: <b>{result.errors}</b></div>}
          {Object.keys(result.byRegion).length > 0 && (
            <div className="pt-1.5 mt-1.5 border-t border-gray-200">
              <div className="font-bold mb-1">광역 분포</div>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(result.byRegion)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <div key={k}>{k}: {v}</div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
