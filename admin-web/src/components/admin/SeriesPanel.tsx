'use client';

import { useEffect, useState } from 'react';
import { Timestamp, collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import {
  type Series,
  type SeriesStatus,
  subscribeMySeries,
  subscribeSeriesByOrganizer,
  createSeries,
  updateSeries,
  deleteSeries,
  addFinalistsBatch,
  subscribeFinalists,
  type Finalist,
} from '@/lib/series';
import { POSTER_STYLES, posterStyleFor } from '@/lib/templates';
import EmptyState from '@/components/ui/EmptyState';

export default function SeriesPanel({ organizerId }: { organizerId?: string } = {}) {
  const authState = useAuth();
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);

  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    const unsub = organizerId
      ? subscribeSeriesByOrganizer(
          organizerId,
          (items) => {
            setSeries(items);
            setLoading(false);
          },
          () => setLoading(false),
        )
      : subscribeMySeries(
          authState.user.uid,
          (items) => {
            setSeries(items);
            setLoading(false);
          },
          () => setLoading(false),
        );
    return unsub;
  }, [authState, organizerId]);

  if (authState.status !== 'authenticated') {
    return <div className="text-sm text-gray-500">로그인이 필요합니다</div>;
  }

  if (editingId) {
    const target = editingId === 'new' ? null : series.find((s) => s.id === editingId) ?? null;
    return (
      <SeriesEditor
        initial={target}
        onSave={async (data) => {
          if (editingId === 'new') {
            await createSeries(authState.user.uid, {
              ...data,
              ...(organizerId ? { organizerId } : {}),
            });
          } else {
            await updateSeries(editingId, data);
          }
          setEditingId(null);
        }}
        onCancel={() => setEditingId(null)}
        onDelete={
          target
            ? async () => {
                if (!window.confirm(`"${target.name}" 시리즈 삭제?`)) return;
                await deleteSeries(target.id);
                setEditingId(null);
              }
            : null
        }
      />
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">🏆 시리즈</h1>
          <p className="text-sm text-gray-500 mt-1">
            대회사 모드 — 시리즈 생성·협력 매장 매핑·위성 예선 자동 집계
          </p>
        </div>
        <button
          onClick={() => setEditingId('new')}
          className="bg-black text-white px-4 py-2.5 rounded-xl font-bold text-sm"
        >
          + 새 시리즈
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : series.length === 0 ? (
        <EmptyState
          icon="🏆"
          title="등록된 시리즈가 없습니다"
          desc='"+ 새 시리즈"로 시즌 단위 시리즈를 등록하세요. 협력 매장 매핑 후 위성 예선 결과를 입력하면 본선 진출자가 자동 집계됩니다.'
        />
      ) : (
        <div className="space-y-3">
          {series.map((s) => (
            <SeriesRow key={s.id} s={s} onEdit={() => setEditingId(s.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SeriesRow({ s, onEdit }: { s: Series; onEdit: () => void }) {
  const poster = posterStyleFor(s.posterStyle);
  const statusLabel = s.status === 'active' ? '진행 중' : s.status === 'upcoming' ? '예정' : '종료';
  const statusColor =
    s.status === 'active' ? '#00B074' : s.status === 'upcoming' ? '#FFB800' : '#767676';
  const finalDateLabel = s.finalDate
    ? s.finalDate.toDate().toISOString().slice(0, 10)
    : '미정';

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-4 flex items-center gap-3" style={{ background: poster.bg, color: poster.color }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[9px] font-extrabold rounded-full px-2 py-0.5"
              style={{ background: statusColor, color: '#fff' }}
            >
              {statusLabel}
            </span>
            <span className="text-[10px] opacity-80">{s.season}</span>
          </div>
          <div className="font-extrabold text-base truncate">{s.name}</div>
        </div>
      </div>
      <div className="p-3 grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="협력 매장" value={`${s.partnerStoreIds.length}곳`} />
        <Stat label="위성 예선" value={`${s.satelliteCompleted}/${s.satelliteCount}`} />
        <Stat label="본선 확정" value={`${s.finalistCount}명`} />
      </div>
      <div className="px-3 pb-3 text-[11px] text-gray-500">
        본선 {finalDateLabel} · ₩{(s.finalGuarantee / 100000000).toFixed(1)}억 GTD
      </div>
      <div className="px-3 pb-3 flex gap-2">
        <button
          onClick={onEdit}
          className="flex-1 py-2 rounded-lg border border-gray-200 text-xs font-bold hover:bg-gray-50"
        >
          ✏️ 편집
        </button>
        <SatelliteResultButton seriesId={s.id} partnerStoreIds={s.partnerStoreIds} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-base font-extrabold text-gray-900">{value}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function SatelliteResultButton({ seriesId, partnerStoreIds }: { seriesId: string; partnerStoreIds: string[] }) {
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    if (partnerStoreIds.length === 0) {
      alert('먼저 협력 매장을 추가하세요');
      return;
    }
    setBusy(true);
    try {
      // 데모: 임의 매장 1곳의 위성 예선 결과 2명 추가
      const storeId = partnerStoreIds[Math.floor(Math.random() * partnerStoreIds.length)];
      const snap = await getDocs(collection(db, 'stores'));
      const storeDoc = snap.docs.find((d) => d.id === storeId);
      const storeName = (storeDoc?.data() as { name?: string })?.name ?? storeId;
      const today = Timestamp.now();
      await addFinalistsBatch(seriesId, [
        { nickname: `Player${Math.floor(Math.random() * 999)}`, storeId, storeName, rank: 1, satelliteDate: today },
        { nickname: `Player${Math.floor(Math.random() * 999)}`, storeId, storeName, rank: 2, satelliteDate: today },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleAdd}
      disabled={busy}
      className="flex-1 py-2 rounded-lg bg-black text-white text-xs font-bold disabled:opacity-40"
    >
      {busy ? '...' : '+ 위성 결과 (데모)'}
    </button>
  );
}

function SeriesEditor({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: Series | null;
  onSave: (data: Omit<Series, 'id' | 'ownerUid' | 'satelliteCount' | 'satelliteCompleted' | 'finalistCount'>) => Promise<void>;
  onCancel: () => void;
  onDelete: (() => Promise<void>) | null;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [season, setSeason] = useState(initial?.season ?? '2026 Spring');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState<SeriesStatus>(initial?.status ?? 'upcoming');
  const [posterStyle, setPosterStyle] = useState(initial?.posterStyle ?? 'poster-rust');
  const [finalDate, setFinalDate] = useState(
    initial?.finalDate ? initial.finalDate.toDate().toISOString().slice(0, 10) : '',
  );
  const [finalVenue, setFinalVenue] = useState(initial?.finalVenue ?? '');
  const [finalBuyIn, setFinalBuyIn] = useState(initial?.finalBuyIn ?? 1000000);
  const [finalGuarantee, setFinalGuarantee] = useState(initial?.finalGuarantee ?? 100000000);
  const [seedRule, setSeedRule] = useState(initial?.seedRule ?? '각 매장 위성 예선 상위 2명 본선 직행');
  const [partnerStoreIds, setPartnerStoreIds] = useState<string[]>(initial?.partnerStoreIds ?? []);

  const [allStores, setAllStores] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'stores'));
      setAllStores(snap.docs.map((d) => ({ id: d.id, name: (d.data() as { name: string }).name })));
    })();
  }, []);

  const togglePartner = (id: string) => {
    setPartnerStoreIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        season,
        description,
        status,
        posterStyle,
        finalDate: finalDate ? Timestamp.fromDate(new Date(finalDate)) : undefined,
        finalVenue,
        finalBuyIn,
        finalGuarantee,
        seedRule,
        partnerStoreIds,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <button onClick={onCancel} className="text-xs text-gray-500 underline mb-2 block">
        ← 시리즈 목록
      </button>
      <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
        {initial ? '✏️ 시리즈 편집' : '＋ 새 시리즈'}
      </h1>
      <p className="text-sm text-gray-500 mb-6 mt-1">대회사 단위 시즌 시리즈</p>

      <div className="space-y-4">
        <Field label="시리즈 이름">
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="시즌">
            <input className="form-input" value={season} onChange={(e) => setSeason(e.target.value)} />
          </Field>
          <Field label="상태">
            <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value as SeriesStatus)}>
              <option value="upcoming">예정</option>
              <option value="active">진행 중</option>
              <option value="completed">종료</option>
            </select>
          </Field>
        </div>

        <Field label="소개">
          <textarea
            className="form-input min-h-[60px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field label="포스터 색">
          <select className="form-input" value={posterStyle} onChange={(e) => setPosterStyle(e.target.value)}>
            {POSTER_STYLES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="본선 일자">
            <input
              type="date"
              className="form-input"
              value={finalDate}
              onChange={(e) => setFinalDate(e.target.value)}
            />
          </Field>
          <Field label="본선 장소">
            <input className="form-input" value={finalVenue} onChange={(e) => setFinalVenue(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="본선 바이인 (₩)">
            <input
              type="number"
              className="form-input font-mono"
              value={finalBuyIn}
              onChange={(e) => setFinalBuyIn(parseInt(e.target.value) || 0)}
            />
          </Field>
          <Field label="본선 게런티 (₩)">
            <input
              type="number"
              className="form-input font-mono"
              value={finalGuarantee}
              onChange={(e) => setFinalGuarantee(parseInt(e.target.value) || 0)}
            />
          </Field>
        </div>

        <Field label="시드 규칙">
          <input className="form-input" value={seedRule} onChange={(e) => setSeedRule(e.target.value)} />
        </Field>

        <Field label={`협력 매장 (${partnerStoreIds.length}곳 선택)`}>
          {allStores.length === 0 ? (
            <div className="text-xs text-gray-500 py-2">등록된 매장이 없습니다</div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {allStores.map((st) => (
                <label
                  key={st.id}
                  className={`flex items-center gap-2 p-2 border-[1.5px] rounded-lg cursor-pointer ${
                    partnerStoreIds.includes(st.id) ? 'border-black bg-gray-50' : 'border-gray-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={partnerStoreIds.includes(st.id)}
                    onChange={() => togglePartner(st.id)}
                  />
                  <span className="text-sm font-bold">{st.name}</span>
                  <span className="text-[10px] text-gray-500 font-mono ml-auto">{st.id}</span>
                </label>
              ))}
            </div>
          )}
        </Field>

        <div className="flex gap-2 pt-2">
          {onDelete && (
            <button
              onClick={onDelete}
              className="flex-1 py-2.5 rounded-lg border-[1.5px] border-red-200 text-red-600 font-bold text-sm"
            >
              삭제
            </button>
          )}
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border-[1.5px] border-gray-200 font-bold text-sm"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm disabled:opacity-40"
          >
            {saving ? '저장 중…' : initial ? '저장' : '시리즈 만들기'}
          </button>
        </div>
      </div>

      <style jsx global>{`
        .form-input {
          background: #fff;
          border: 1.5px solid #eaeaea;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 13px;
          color: #111;
          width: 100%;
          box-sizing: border-box;
          outline: none;
        }
        .form-input:focus { border-color: #111; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}
