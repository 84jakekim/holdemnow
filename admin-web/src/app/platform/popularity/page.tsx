'use client';

/**
 * /platform/popularity — 본사 어드민 인기 매장 모니터·컨트롤
 *
 * 정책 (memory: project_holdemnow_popularity):
 *  점수 = favoriteAdds + directionsClicks + liveSessionCount×2 + scoreBoost
 *         + 신규부스트(가입 30일 이내 점수×0.3)
 *         (모니터에선 거리감점 X — 전국 평탄 비교)
 *  가입 24h 이내: 모든 신호 0 (셀프 어뷰징 견제)
 *
 * 기능:
 *  - 전국 활성 매장 점수 분해 + 최종 점수 (순위순)
 *  - 지역(시/도) 필터 + 매장명 검색
 *  - 매장별 scoreBoost 수동 조정 + 저장 (감사 로그 기록)
 */

import { useEffect, useMemo, useState } from 'react';
import { loadAllStoresForMonitor, updateScoreBoost, type PopularityStore } from '@/lib/popularity';
import { logAdminAction } from '@/lib/auditLog';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Row extends PopularityStore {
  region: string;
  /** 입력 중인 부스트 값 (저장 전) */
  draftBoost: string;
  /** 저장 진행 상태 */
  saving?: boolean;
}

function extractRegion(address?: string): string {
  if (!address) return '미설정';
  // "부산 부산진구 ..." 같은 패턴에서 앞 1~2단어 추출
  const parts = address.trim().split(/\s+/);
  if (parts.length === 0) return '미설정';
  return parts[0]; // 시/도 단위
}

export default function PopularityMonitorPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [hideZeroScore, setHideZeroScore] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 최초 로드
  useEffect(() => {
    let cancelled = false;
    loadAllStoresForMonitor()
      .then((stores) => {
        if (cancelled) return;
        const list: Row[] = stores.map((s) => ({
          ...s,
          region: extractRegion(s.address),
          draftBoost: String(s.scoreBoost ?? 0),
        }));
        setRows(list);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e?.message ?? String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // 지역 목록
  const regions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.region));
    return ['all', ...Array.from(set).sort()];
  }, [rows]);

  // 필터 적용
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (regionFilter !== 'all' && r.region !== regionFilter) return false;
      if (hideZeroScore && (r._score ?? 0) === 0) return false;
      if (search) {
        const s = search.toLowerCase();
        const text = `${r.name} ${r.address ?? ''}`.toLowerCase();
        if (!text.includes(s)) return false;
      }
      return true;
    });
  }, [rows, regionFilter, search, hideZeroScore]);

  // 통계
  const totals = useMemo(() => {
    const visible = filtered.length;
    const sumScore = filtered.reduce((acc, r) => acc + (r._score ?? 0), 0);
    const sumBoost = filtered.reduce((acc, r) => acc + (r.scoreBoost ?? 0), 0);
    const liveActive = filtered.filter((r) => (r.liveSessionCount ?? 0) > 0).length;
    return { visible, sumScore, sumBoost, liveActive };
  }, [filtered]);

  // 부스트 저장
  const saveBoost = async (storeId: string) => {
    const row = rows.find((r) => r.id === storeId);
    if (!row) return;
    const parsed = parseInt(row.draftBoost, 10);
    if (isNaN(parsed)) {
      setToast('숫자만 입력하세요');
      return;
    }
    setRows((prev) => prev.map((r) => r.id === storeId ? { ...r, saving: true } : r));
    try {
      await updateScoreBoost(storeId, parsed);
      void logAdminAction({
        action: 'change_score_boost',
        target: { type: 'store', id: storeId },
        metadata: { from: row.scoreBoost ?? 0, to: parsed, storeName: row.name },
      });
      // 로컬 재계산 (점수도 새 boost로 갱신)
      setRows((prev) => prev.map((r) => {
        if (r.id !== storeId) return r;
        const oldBoost = r.scoreBoost ?? 0;
        const delta = parsed - oldBoost;
        return {
          ...r,
          scoreBoost: parsed,
          _score: (r._score ?? 0) + delta,
          saving: false,
        };
      }));
      // 부스트 변동 후 점수 재정렬
      setRows((prev) => [...prev].sort((a, b) => (b._score ?? 0) - (a._score ?? 0)));
      setToast(`${row.name} 부스트 저장 완료 (${parsed > 0 ? '+' : ''}${parsed})`);
      setTimeout(() => setToast(null), 2500);
    } catch (e: any) {
      setRows((prev) => prev.map((r) => r.id === storeId ? { ...r, saving: false } : r));
      setToast(`저장 실패: ${e?.message ?? String(e)}`);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const onBoostChange = (storeId: string, value: string) => {
    setRows((prev) => prev.map((r) => r.id === storeId ? { ...r, draftBoost: value } : r));
  };

  return (
    <div>
      {/* 헤더 */}
      <div className="mb-6">
        <div className="section-title" style={{ color: 'var(--gold)' }}>POPULARITY MONITOR</div>
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>🔥 인기 매장 컨트롤</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
          전국 활성 매장의 인기 점수를 모니터링하고 수동 부스트로 조정합니다.
          점수가 높을수록 사용자 앱 "내 주변 인기 매장" 상위에 노출됩니다.
        </p>
      </div>

      {/* 공식 설명 */}
      <div className="mb-5 p-4 rounded-xl text-xs leading-relaxed" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
        <div className="font-bold mb-2" style={{ color: 'var(--text-1)' }}>점수 공식</div>
        <div className="font-mono">
          점수 = 즐겨찾기 + 길찾기 + LIVE×2 + 수동 부스트<br />
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ 신규 부스트(가입 30일 이내, 점수 × 0.3)
        </div>
        <div className="mt-2" style={{ color: 'var(--text-3)' }}>
          * 가입 24h 이내 매장은 모든 신호 0 처리 (셀프 어뷰징 견제)<br />
          * 본 모니터는 거리감점·반경 필터를 적용하지 않습니다 (전국 평탄 비교용)<br />
          * 수동 부스트는 음수 가능 — 감점도 가능
        </div>
      </div>

      {/* 통계 카드 4종 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: '노출 매장', value: totals.visible.toLocaleString(), suffix: '' },
          { label: '합산 점수', value: Math.round(totals.sumScore).toLocaleString(), suffix: '' },
          { label: 'LIVE 운영 중', value: totals.liveActive.toLocaleString(), suffix: '곳' },
          { label: '수동 부스트 합', value: totals.sumBoost.toLocaleString(), suffix: '' },
        ].map((k) => (
          <div key={k.label} className="p-4 rounded-xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
            <div className="text-[11px] font-bold mb-1" style={{ color: 'var(--text-3)' }}>{k.label}</div>
            <div className="text-xl font-extrabold" style={{ color: 'var(--text-1)' }}>{k.value}<span className="text-xs font-bold ml-1" style={{ color: 'var(--text-3)' }}>{k.suffix}</span></div>
          </div>
        ))}
      </div>

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        <select
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm font-bold"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          {regions.map((r) => (
            <option key={r} value={r}>{r === 'all' ? '전체 지역' : r}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="매장명 또는 주소 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] px-3 py-2 rounded-lg text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        />
        <label className="flex items-center gap-2 text-sm font-bold cursor-pointer px-2" style={{ color: 'var(--text-2)' }}>
          <input
            type="checkbox"
            checked={hideZeroScore}
            onChange={(e) => setHideZeroScore(e.target.checked)}
          />
          0점 매장 숨김
        </label>
      </div>

      {/* 상태별 렌더 */}
      {loading && (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      )}
      {err && (
        <div className="p-4 rounded-xl mb-4" style={{ background: 'rgba(255,59,92,0.10)', color: '#FF3B5C', border: '1px solid rgba(255,59,92,0.3)' }}>
          데이터 로드 실패: {err}
        </div>
      )}

      {/* 목록 */}
      {!loading && !err && (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: 'var(--text-3)' }}>
              조건에 맞는 매장이 없어요
            </div>
          ) : filtered.map((r, idx) => (
            <StoreRow
              key={r.id}
              row={r}
              rank={idx + 1}
              onBoostChange={onBoostChange}
              onSave={saveBoost}
            />
          ))}
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-3 rounded-xl text-sm font-bold z-50"
          style={{ background: 'var(--text-1)', color: 'var(--surface-1)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function StoreRow({
  row,
  rank,
  onBoostChange,
  onSave,
}: {
  row: Row;
  rank: number;
  onBoostChange: (storeId: string, value: string) => void;
  onSave: (storeId: string) => void;
}) {
  const dirty = (parseInt(row.draftBoost, 10) || 0) !== (row.scoreBoost ?? 0);
  const liveCount = row.liveSessionCount ?? 0;
  const fav = row.favoriteAdds ?? 0;
  const dir = row.directionsClicks ?? 0;
  const boost = row.scoreBoost ?? 0;
  const score = row._score ?? 0;
  const isNew = !!row.isNew;

  return (
    <div
      className="grid grid-cols-12 gap-3 items-center p-3 rounded-xl"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      {/* 순위 */}
      <div className="col-span-1 text-center">
        <div className="text-xl font-extrabold" style={{ color: rank <= 3 ? 'var(--brand)' : 'var(--text-2)' }}>
          {rank}
        </div>
      </div>

      {/* 매장 정보 */}
      <div className="col-span-4 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-bold truncate" style={{ color: 'var(--text-1)' }}>{row.name}</span>
          {isNew && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(34,214,126,0.15)', color: '#22D67E' }}>NEW</span>
          )}
          {row.tier === 'demo' && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>DEMO</span>
          )}
        </div>
        <div className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>{row.address || '주소 없음'}</div>
      </div>

      {/* 신호 분해 */}
      <div className="col-span-4 grid grid-cols-3 gap-2 text-center text-[11px]">
        <SignalCell label="즐겨찾기" value={fav} />
        <SignalCell label="길찾기" value={dir} />
        <SignalCell label="LIVE×2" value={liveCount * 2} sub={`(${liveCount}회)`} />
      </div>

      {/* 부스트 입력 */}
      <div className="col-span-2 flex items-center gap-1">
        <input
          type="number"
          value={row.draftBoost}
          onChange={(e) => onBoostChange(row.id, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSave(row.id); }}
          className="w-16 px-2 py-1.5 rounded-lg text-sm text-center font-bold"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        />
        <button
          onClick={() => onSave(row.id)}
          disabled={!dirty || row.saving}
          className="px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-95 disabled:opacity-40"
          style={{
            background: dirty ? 'var(--brand)' : 'var(--surface-2)',
            color: dirty ? '#fff' : 'var(--text-3)',
          }}
        >
          {row.saving ? '...' : '저장'}
        </button>
      </div>

      {/* 최종 점수 */}
      <div className="col-span-1 text-right">
        <div className="text-lg font-extrabold" style={{ color: 'var(--brand)' }}>
          {Math.round(score)}
        </div>
        {boost !== 0 && (
          <div className="text-[10px] font-bold" style={{ color: boost > 0 ? '#22D67E' : '#FF3B5C' }}>
            {boost > 0 ? '+' : ''}{boost}
          </div>
        )}
      </div>
    </div>
  );
}

function SignalCell({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="p-1.5 rounded-lg" style={{ background: 'var(--surface-2)' }}>
      <div className="font-bold" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="font-extrabold" style={{ color: 'var(--text-1)' }}>{value.toLocaleString()}</div>
      {sub && <div className="text-[9px]" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  );
}
