'use client';

import { useEffect, useState } from 'react';
import {
  type TournamentTemplate,
  type TournamentType,
  type BlindLevel,
  subscribeTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  DEFAULT_BLIND_STRUCTURE,
  POSTER_STYLES,
  posterStyleFor,
  TYPE_LABELS,
} from '@/lib/templates';

interface Props {
  storeId: string;
}

export default function TemplatesPanel({ storeId }: Props) {
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeTemplates(
      storeId,
      (items) => {
        setTemplates(items);
        setLoading(false);
        setError(null);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [storeId]);

  if (editingId !== null) {
    const editing = editingId === 'new' ? null : templates.find((t) => t.id === editingId) ?? null;
    return (
      <TemplateEditor
        initial={editing}
        onSave={async (tpl) => {
          if (editingId === 'new') {
            await createTemplate(storeId, tpl);
          } else {
            await updateTemplate(storeId, editingId, tpl);
          }
          setEditingId(null);
        }}
        onCancel={() => setEditingId(null)}
        onDelete={
          editing
            ? async () => {
                if (!window.confirm(`"${editing.name}" 템플릿을 삭제할까요?`)) return;
                await deleteTemplate(storeId, editing.id);
                setEditingId(null);
              }
            : null
        }
      />
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">🎲 토너 템플릿</h1>
        <p className="text-sm text-gray-500 mt-1">미리 만들어두고 새 LIVE 시작 시 바로 사용</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={() => setEditingId('new')}
        className="mb-4 bg-black text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-gray-900"
      >
        + 새 템플릿 만들기
      </button>

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : templates.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🎲</div>
          <div className="font-bold text-gray-900 mb-2">등록된 템플릿이 없습니다</div>
          <div className="text-xs text-gray-500">"+ 새 템플릿 만들기"로 첫 토너를 등록하세요</div>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              tpl={t}
              onEdit={() => setEditingId(t.id)}
              onDuplicate={() => duplicateTemplate(storeId, t.id)}
              onDelete={async () => {
                if (window.confirm(`"${t.name}" 삭제할까요?`)) {
                  await deleteTemplate(storeId, t.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  tpl,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  tpl: TournamentTemplate;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const poster = posterStyleFor(tpl.posterStyle);
  const firstLevel = tpl.blindStructure?.[0];
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex gap-4 items-center">
      <div
        className="w-16 h-20 rounded-lg flex items-center justify-center text-center font-extrabold text-xs leading-tight flex-shrink-0"
        style={{ background: poster.bg, color: poster.color, padding: 6 }}
      >
        {tpl.name.split(' ').slice(0, 2).join(' ')}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-gray-900 mb-1">{tpl.name}</div>
        <div className="text-xs text-gray-500 leading-relaxed">
          <span className="text-gray-900 font-bold">{TYPE_LABELS[tpl.type]}</span> · 바이인{' '}
          <span className="font-mono">₩{tpl.buyIn.toLocaleString()}</span> · {tpl.totalPlayers}명
          <br />
          {tpl.blindStructure.length}레벨 · 시작{' '}
          <span className="font-mono">
            {firstLevel?.sb}/{firstLevel?.bb}
          </span>{' '}
          · 늦은 등록 Lv {tpl.lateRegEndLevel}까지
        </div>
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button onClick={onEdit} className="text-xs font-bold border border-gray-200 rounded-md px-3 py-1 hover:bg-gray-50">
          ✏️ 편집
        </button>
        <button onClick={onDuplicate} className="text-xs font-bold border border-gray-200 rounded-md px-3 py-1 hover:bg-gray-50">
          📋 복제
        </button>
        <button onClick={onDelete} className="text-xs font-bold border border-red-200 text-red-600 rounded-md px-3 py-1 hover:bg-red-50">
          ✕ 삭제
        </button>
      </div>
    </div>
  );
}

function TemplateEditor({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: TournamentTemplate | null;
  onSave: (tpl: Omit<TournamentTemplate, 'id'>) => Promise<void>;
  onCancel: () => void;
  onDelete: (() => Promise<void>) | null;
}) {
  const [form, setForm] = useState<Omit<TournamentTemplate, 'id'>>(
    initial
      ? {
          name: initial.name,
          type: initial.type,
          buyIn: initial.buyIn,
          guarantee: initial.guarantee,
          totalPlayers: initial.totalPlayers,
          prizePool: initial.prizePool,
          startingStack: initial.startingStack,
          lateRegEndLevel: initial.lateRegEndLevel,
          posterStyle: initial.posterStyle,
          blindStructure: initial.blindStructure,
        }
      : {
          name: '',
          type: 'freezeout',
          buyIn: 50000,
          guarantee: 0,
          totalPlayers: 20,
          prizePool: 0,
          startingStack: 20000,
          lateRegEndLevel: 3,
          posterStyle: 'poster-dark',
          blindStructure: DEFAULT_BLIND_STRUCTURE.map((b) => ({ ...b })),
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const updateBlind = (idx: number, k: keyof BlindLevel, v: number) => {
    setForm((f) => ({
      ...f,
      blindStructure: f.blindStructure.map((b, i) => (i === idx ? { ...b, [k]: v } : b)),
    }));
  };
  const addBlind = () => {
    setForm((f) => {
      const last = f.blindStructure[f.blindStructure.length - 1] || {
        level: 0,
        sb: 100,
        bb: 200,
        ante: 0,
        durationSec: 1200,
      };
      return {
        ...f,
        blindStructure: [
          ...f.blindStructure,
          {
            level: last.level + 1,
            sb: Math.round(last.sb * 1.5),
            bb: Math.round(last.bb * 1.5),
            ante: Math.round((last.ante || 0) * 1.3),
            durationSec: last.durationSec,
          },
        ],
      };
    });
  };
  const removeBlind = (idx: number) => {
    setForm((f) => ({
      ...f,
      blindStructure: f.blindStructure.filter((_, i) => i !== idx).map((b, i) => ({ ...b, level: i + 1 })),
    }));
  };

  const valid = form.name.trim().length > 0 && form.blindStructure.length > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...form,
        blindStructure: form.blindStructure.map((b, i) => ({
          level: i + 1,
          sb: Math.max(1, b.sb),
          bb: Math.max(1, b.bb),
          ante: Math.max(0, b.ante || 0),
          durationSec: Math.max(30, b.durationSec || 1200),
        })),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <button onClick={onCancel} className="text-xs text-gray-500 underline mb-2 block">
          ← 템플릿 목록
        </button>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
          {initial ? '✏️ 템플릿 편집' : '＋ 새 템플릿'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{initial ? '저장 시 즉시 반영' : '모든 필드 입력 후 저장'}</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <Field label="토너 제목">
          <input className="form-input" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="예: 프리징 90GTD" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="타입">
            <select className="form-input" value={form.type} onChange={(e) => update('type', e.target.value as TournamentType)}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="포스터 색">
            <select className="form-input" value={form.posterStyle} onChange={(e) => update('posterStyle', e.target.value)}>
              {POSTER_STYLES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="바이인 (₩)">
            <input
              type="number"
              className="form-input font-mono"
              value={form.buyIn}
              onChange={(e) => update('buyIn', parseInt(e.target.value) || 0)}
            />
          </Field>
          <Field label="게런티 (₩)">
            <input
              type="number"
              className="form-input font-mono"
              value={form.guarantee}
              onChange={(e) => update('guarantee', parseInt(e.target.value) || 0)}
            />
          </Field>
          <Field label="인원">
            <input
              type="number"
              className="form-input font-mono"
              value={form.totalPlayers}
              onChange={(e) => update('totalPlayers', parseInt(e.target.value) || 0)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="시작 칩">
            <input
              type="number"
              className="form-input font-mono"
              value={form.startingStack}
              onChange={(e) => update('startingStack', parseInt(e.target.value) || 0)}
            />
          </Field>
          <Field label="늦은 등록 마감 레벨">
            <input
              type="number"
              min={1}
              max={form.blindStructure.length}
              className="form-input font-mono"
              value={form.lateRegEndLevel}
              onChange={(e) => update('lateRegEndLevel', parseInt(e.target.value) || 1)}
            />
          </Field>
        </div>

        {/* 블라인드 구조 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold text-gray-500 tracking-wider">
              블라인드 구조 ({form.blindStructure.length}레벨)
            </div>
            <button
              onClick={addBlind}
              className="bg-black text-white text-[10px] font-bold px-2 py-1 rounded"
            >
              + 레벨 추가
            </button>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3 max-h-72 overflow-y-auto">
            <div className="grid grid-cols-[28px_1fr_1fr_1fr_1fr_28px] gap-2 text-[10px] font-bold text-gray-500 tracking-wider pb-2 border-b border-gray-100">
              <div className="text-center">Lv</div>
              <div>SB</div>
              <div>BB</div>
              <div>Ante</div>
              <div>시간(초)</div>
              <div></div>
            </div>
            {form.blindStructure.map((b, idx) => (
              <div key={idx} className="grid grid-cols-[28px_1fr_1fr_1fr_1fr_28px] gap-2 items-center py-1 border-b border-gray-50">
                <div className="text-center font-mono font-bold text-xs">{idx + 1}</div>
                <input type="number" className="form-input text-xs font-mono" value={b.sb} onChange={(e) => updateBlind(idx, 'sb', parseInt(e.target.value) || 0)} />
                <input type="number" className="form-input text-xs font-mono" value={b.bb} onChange={(e) => updateBlind(idx, 'bb', parseInt(e.target.value) || 0)} />
                <input type="number" className="form-input text-xs font-mono" value={b.ante || 0} onChange={(e) => updateBlind(idx, 'ante', parseInt(e.target.value) || 0)} />
                <input type="number" className="form-input text-xs font-mono" value={b.durationSec} onChange={(e) => updateBlind(idx, 'durationSec', parseInt(e.target.value) || 60)} />
                <button onClick={() => removeBlind(idx)} className="text-red-500 font-bold text-base">
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-gray-400 mt-1">💡 시간은 초 단위. 일반 운영 1200(20분), 터보 600(10분).</div>
        </div>

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
            disabled={!valid || saving}
            className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm disabled:opacity-40"
          >
            {saving ? '저장 중…' : initial ? '저장' : '템플릿 만들기'}
          </button>
        </div>
      </div>

      <style jsx global>{`
        .form-input {
          background: #fff;
          border: 1.5px solid #eaeaea;
          border-radius: 8px;
          padding: 7px 11px;
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
