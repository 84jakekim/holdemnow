'use client';

/**
 * /platform/ads — 본사 어드민 광고 슬롯 수동 발급/관리 (v0.1).
 *
 * 기능:
 *  - 매장 검색 (이름 prefix) → 등급(Premium/Standard) → 기간(7/14/30일) → 활성화
 *  - PG 결제 없음, paidAmount=0, paymentRef는 v0.2 PG 도입 시 채움
 *  - 활성/대기/만료 슬롯 리스트 + 노출/클릭 카운트 + 취소 버튼
 *  - region별 캡 (Premium 30 / Standard 100) 초과 경고
 *  - rules 상 platform_admin만 write 가능
 *
 * 디자인: 본사 어드민 다크 톤 (--bg/--surface-1/--gold)
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where, limit, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import {
  type AdSlot,
  type AdTier,
  grantAdSlot,
  cancelAdSlot,
  deleteAdSlot,
  subscribeAllAdSlots,
  countAdSlotsByRegion,
  QUEUE_CAP_PREMIUM,
  QUEUE_CAP_STANDARD,
} from '@/lib/adSlots';
import { regionCodeFromAddress, KNOWN_REGION_CODES } from '@/lib/geo';

interface StoreLite {
  id: string;
  name: string;
  address?: string;
  regionCode?: string;
  status?: string;
  adTier?: string;
}

export default function PlatformAdsPage() {
  const authState = useAuth();
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const unsub = subscribeAllAdSlots(
      (items) => { setSlots(items); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); },
    );
    return unsub;
  }, []);

  const grouped = useMemo(() => {
    const active = slots.filter((s) => s.status === 'active');
    const pending = slots.filter((s) => s.status === 'pending');
    const past = slots.filter((s) => s.status === 'expired' || s.status === 'cancelled');
    return { active, pending, past };
  }, [slots]);

  if (authState.status !== 'authenticated') return null;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="section-title" style={{ color: 'var(--gold)' }}>AD SLOTS</div>
          <h1 className="h2" style={{ color: 'var(--text-1)' }}>
            💰 광고 슬롯 관리
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            매장에 광고 노출권을 수동으로 부여합니다. v0.1은 결제 없이 발급, v0.2에서 PG 어댑터 추가 예정.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2.5 text-sm font-bold tap"
          style={{ background: 'var(--gold)', color: '#0F1419', borderRadius: 'var(--r-md)', boxShadow: '0 2px 12px rgba(245,158,11,0.30)' }}
        >
          + 새 광고 발급
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm rounded-lg p-3" style={{ background: 'rgba(239,68,68,0.1)', color: '#FCA5A5' }}>
          {error}
        </div>
      )}

      <RegionCapTable slots={slots} />

      {/* 활성 */}
      <Section title={`🟢 활성 (${grouped.active.length})`}>
        {loading ? (
          <Empty>로딩 중…</Empty>
        ) : grouped.active.length === 0 ? (
          <Empty>활성 광고가 없습니다</Empty>
        ) : (
          grouped.active.map((s) => <SlotRow key={s.id} slot={s} />)
        )}
      </Section>

      {/* 대기 (startAt 미래) */}
      {grouped.pending.length > 0 && (
        <Section title={`⏳ 예약 (${grouped.pending.length})`}>
          {grouped.pending.map((s) => <SlotRow key={s.id} slot={s} />)}
        </Section>
      )}

      {/* 만료/취소 */}
      {grouped.past.length > 0 && (
        <Section title={`📁 종료 (${grouped.past.length})`}>
          {grouped.past.slice(0, 30).map((s) => <SlotRow key={s.id} slot={s} />)}
          {grouped.past.length > 30 && (
            <div className="text-xs text-center py-2" style={{ color: 'var(--text-3)' }}>
              ... 외 {grouped.past.length - 30}건
            </div>
          )}
        </Section>
      )}

      {showCreate && (
        <CreateAdModal
          adminUid={authState.user.uid}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 지역별 캡 테이블
// ─────────────────────────────────────────────────────────────

function RegionCapTable({ slots }: { slots: AdSlot[] }) {
  const byRegion = useMemo(() => {
    const map = new Map<string, { activePrem: number; activeStd: number; pendingPrem: number; pendingStd: number }>();
    for (const s of slots) {
      if (s.status !== 'active' && s.status !== 'pending') continue;
      const r = s.region || '미분류';
      const cur = map.get(r) ?? { activePrem: 0, activeStd: 0, pendingPrem: 0, pendingStd: 0 };
      if (s.status === 'active') {
        if (s.tier === 'premium') cur.activePrem++;
        else cur.activeStd++;
      } else {
        if (s.tier === 'premium') cur.pendingPrem++;
        else cur.pendingStd++;
      }
      map.set(r, cur);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [slots]);

  if (byRegion.length === 0) return null;

  return (
    <div
      className="mb-6 rounded-xl p-4"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      <div className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
        지역별 점유율 (캡: P{QUEUE_CAP_PREMIUM} / S{QUEUE_CAP_STANDARD})
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {byRegion.map(([region, c]) => {
          const pTotal = c.activePrem + c.pendingPrem;
          const sTotal = c.activeStd + c.pendingStd;
          const pOver = pTotal >= QUEUE_CAP_PREMIUM;
          const sOver = sTotal >= QUEUE_CAP_STANDARD;
          return (
            <div
              key={region}
              className="rounded-md p-2"
              style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}
            >
              <div className="font-extrabold mb-0.5">{region}</div>
              <div style={{ color: pOver ? '#FCA5A5' : 'var(--text-2)' }}>
                P: {c.activePrem}/{QUEUE_CAP_PREMIUM} {c.pendingPrem > 0 && `(+${c.pendingPrem})`} {pOver && '⚠'}
              </div>
              <div style={{ color: sOver ? '#FCA5A5' : 'var(--text-2)' }}>
                S: {c.activeStd}/{QUEUE_CAP_STANDARD} {c.pendingStd > 0 && `(+${c.pendingStd})`} {sOver && '⚠'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 슬롯 row
// ─────────────────────────────────────────────────────────────

function SlotRow({ slot }: { slot: AdSlot }) {
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const startMs = slot.startAt?.toMillis?.() ?? 0;
  const endMs = slot.endAt?.toMillis?.() ?? 0;
  const daysLeft = Math.max(0, Math.ceil((endMs - now) / (24 * 60 * 60 * 1000)));

  const onCancel = async () => {
    if (!window.confirm(`${slot.storeName} 광고 슬롯을 취소할까요?`)) return;
    setBusy(true);
    try {
      await cancelAdSlot(slot.id);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!window.confirm(`${slot.storeName} 광고 슬롯 기록을 완전히 삭제할까요? (복구 불가)`)) return;
    setBusy(true);
    try {
      await deleteAdSlot(slot.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="text-[10px] font-extrabold tracking-wider px-1.5 py-0.5 rounded"
            style={{
              background: slot.tier === 'premium' ? 'rgba(245,158,11,0.18)' : 'rgba(6,182,212,0.18)',
              color: slot.tier === 'premium' ? 'var(--gold)' : '#67E8F9',
            }}
          >
            {slot.tier.toUpperCase()}
          </span>
          <span className="font-bold text-sm truncate" style={{ color: 'var(--text-1)' }}>
            {slot.storeName || slot.storeId}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            · {slot.region}
          </span>
        </div>
        <div className="text-[11px] flex gap-3" style={{ color: 'var(--text-3)' }}>
          <span>
            {new Date(startMs).toLocaleDateString()} ~ {new Date(endMs).toLocaleDateString()}
            {slot.status === 'active' && ` (${daysLeft}일 남음)`}
          </span>
          <span>노출 {slot.impressions ?? 0} · 클릭 {slot.clicks ?? 0}</span>
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        {(slot.status === 'active' || slot.status === 'pending') && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          >
            취소
          </button>
        )}
        {(slot.status === 'expired' || slot.status === 'cancelled') && (
          <button
            onClick={onDelete}
            disabled={busy}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            삭제
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 신규 발급 모달 — 매장 검색 → 등급 → 기간
// ─────────────────────────────────────────────────────────────

function CreateAdModal({ adminUid, onClose }: { adminUid: string; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<StoreLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<StoreLite | null>(null);
  const [tier, setTier] = useState<AdTier>('standard');
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const [note, setNote] = useState('');
  const [region, setRegion] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capWarn, setCapWarn] = useState<string | null>(null);

  // 매장 검색 (이름 prefix)
  const handleSearch = async () => {
    const term = search.trim();
    if (!term) { setResults([]); return; }
    setSearching(true);
    try {
      // Firestore는 단일 컬렉션 prefix 검색이 startAt/endAt 패턴
      const q1 = query(
        collection(db, 'stores'),
        orderBy('name'),
        where('name', '>=', term),
        where('name', '<=', term + ''),
        limit(15),
      );
      const snap = await getDocs(q1);
      const items: StoreLite[] = snap.docs.map((d) => {
        const data = d.data() as {
          name: string;
          address?: string;
          regionCode?: string;
          status?: string;
          adTier?: string;
        };
        return {
          id: d.id,
          name: data.name,
          address: data.address,
          regionCode: data.regionCode,
          status: data.status,
          adTier: data.adTier,
        };
      });
      setResults(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  // 매장 선택 시 region 자동 산출 + 캡 체크
  const onPick = async (s: StoreLite) => {
    setPicked(s);
    const r = s.regionCode || regionCodeFromAddress(s.address);
    setRegion(r);
    setCapWarn(null);
    try {
      const counts = await countAdSlotsByRegion(r);
      const p = counts.activePremium + counts.pendingPremium;
      const std = counts.activeStandard + counts.pendingStandard;
      if (tier === 'premium' && p >= QUEUE_CAP_PREMIUM) {
        setCapWarn(`${r} 지역의 Premium 캡(${QUEUE_CAP_PREMIUM}) 도달. 대기 발급으로 진행됩니다.`);
      } else if (tier === 'standard' && std >= QUEUE_CAP_STANDARD) {
        setCapWarn(`${r} 지역의 Standard 캡(${QUEUE_CAP_STANDARD}) 도달. 대기 발급으로 진행됩니다.`);
      }
    } catch {
      /* ignore */
    }
  };

  const submit = async () => {
    if (!picked) { setError('매장을 먼저 선택해주세요'); return; }
    if (!region) { setError('region이 비어있습니다. 매장 주소 확인'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const start = new Date();
      const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
      await grantAdSlot({
        storeId: picked.id,
        storeName: picked.name,
        tier,
        region,
        startAt: start,
        endAt: end,
        grantedBy: adminUid,
        note: note.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto p-6"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
      >
        <div className="font-extrabold text-lg mb-4">새 광고 슬롯 발급</div>

        {/* 1) 매장 검색 */}
        <div className="mb-4">
          <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-2)' }}>1. 매장 검색</label>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              placeholder="매장 이름 일부 입력"
              className="flex-1 px-3 py-2 rounded text-sm"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="px-3 py-2 text-xs font-bold rounded"
              style={{ background: 'var(--gold)', color: '#0F1419' }}
            >
              {searching ? '…' : '검색'}
            </button>
          </div>
          {results.length > 0 && !picked && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded" style={{ border: '1px solid var(--border)' }}>
              {results.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onPick(s)}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-black/10"
                  style={{ color: 'var(--text-1)', borderBottom: '1px solid var(--border)' }}
                >
                  <div className="font-bold">{s.name}</div>
                  <div style={{ color: 'var(--text-3)' }}>{s.address ?? '주소 없음'} · {s.regionCode ?? regionCodeFromAddress(s.address)}</div>
                </button>
              ))}
            </div>
          )}
          {picked && (
            <div className="mt-2 rounded p-2 text-xs" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div className="font-bold">{picked.name}</div>
              <div style={{ color: 'var(--text-3)' }}>{picked.address ?? '주소 없음'} · {region}</div>
              <button onClick={() => { setPicked(null); setRegion(''); setCapWarn(null); }} className="mt-1 underline" style={{ color: 'var(--text-3)' }}>다시 선택</button>
            </div>
          )}
        </div>

        {/* 2) 등급 */}
        <div className="mb-4">
          <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-2)' }}>2. 등급</label>
          <div className="grid grid-cols-2 gap-2">
            {(['premium', 'standard'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTier(t)}
                className="py-2 rounded text-xs font-bold"
                style={{
                  background: tier === t ? 'var(--gold)' : 'var(--surface-2)',
                  color: tier === t ? '#0F1419' : 'var(--text-1)',
                  border: '1px solid var(--border)',
                }}
              >
                {t === 'premium' ? '🥇 PREMIUM' : '🥈 STANDARD'}
              </button>
            ))}
          </div>
        </div>

        {/* 3) 기간 */}
        <div className="mb-4">
          <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-2)' }}>3. 기간</label>
          <div className="grid grid-cols-3 gap-2">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className="py-2 rounded text-xs font-bold"
                style={{
                  background: days === d ? 'var(--gold)' : 'var(--surface-2)',
                  color: days === d ? '#0F1419' : 'var(--text-1)',
                  border: '1px solid var(--border)',
                }}
              >
                {d}일
              </button>
            ))}
          </div>
        </div>

        {/* 4) 메모 */}
        <div className="mb-4">
          <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-2)' }}>4. 메모 (선택)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 시범 발급, 첫 사장님 감사"
            className="w-full px-3 py-2 rounded text-sm"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          />
        </div>

        {capWarn && (
          <div className="mb-3 text-xs rounded p-2" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--gold)' }}>
            ⚠ {capWarn}
          </div>
        )}
        {error && (
          <div className="mb-3 text-xs rounded p-2" style={{ background: 'rgba(239,68,68,0.12)', color: '#FCA5A5' }}>
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 rounded font-bold text-sm"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          >
            취소
          </button>
          <button
            onClick={submit}
            disabled={submitting || !picked}
            className="flex-1 py-2.5 rounded font-bold text-sm disabled:opacity-40"
            style={{ background: 'var(--gold)', color: '#0F1419' }}
          >
            {submitting ? '발급 중…' : '발급'}
          </button>
        </div>

        <div className="mt-4 text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
          <b>v0.1:</b> PG 결제 없이 수동 발급. paymentRef는 v0.2 PG 도입 시 채움.<br />
          <b>지역 캡:</b> 각 지역 Premium {QUEUE_CAP_PREMIUM}건 / Standard {QUEUE_CAP_STANDARD}건. 초과 시 대기열로 발급.<br />
          <b>가능 지역:</b> {KNOWN_REGION_CODES.join(', ')}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 보조
// ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="text-sm font-extrabold mb-2" style={{ color: 'var(--text-1)' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-center text-xs py-6 rounded"
      style={{ color: 'var(--text-3)', background: 'var(--surface-1)', border: '1px dashed var(--border)' }}
    >
      {children}
    </div>
  );
}
