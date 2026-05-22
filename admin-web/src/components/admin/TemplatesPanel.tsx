'use client';

import { useEffect, useState } from 'react';
import {
  type TournamentTemplate,
  type TournamentType,
  type BlindLevel,
  type PayoutStructure,
  type AnteMode,
  type PrizeDisplayUnit,
  subscribeTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  DEFAULT_BLIND_STRUCTURE,
  DEFAULT_LEVEL_DURATION_SEC,
  DEFAULT_BREAK_DURATION_SEC,
  DEFAULT_PAYOUT_STRUCTURE,
  DISTRIBUTION_LABELS,
  ANTE_MODE_LABELS,
  PRIZE_DISPLAY_UNIT_LABELS,
  BLIND_STEP,
  POSTER_STYLES,
  posterStyleFor,
  TYPE_LABELS,
  TICKET_WON,
  wonToTickets,
  ticketsToWon,
  fmtBuyIn,
  fmtPrizeDisplay,
  resolveAnte,
  computePayoutsFromStructure,
  computePayoutAmounts,
  computeAutoPrizePool,
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
      <div className="mb-4">
        <p className="text-xs text-gray-500">미리 만들어두고 새 LIVE 시작 시 바로 사용</p>
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
  // 첫 블라인드(브레이크 제외)와 일반 레벨 수 분리 표시
  const playLevels = tpl.blindStructure.filter((b) => !b.isBreak);
  const breakCount = tpl.blindStructure.length - playLevels.length;
  const firstBlind = playLevels[0];
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
          <span className="font-mono">{fmtBuyIn(tpl.buyIn)}</span> · {tpl.totalPlayers}명
          <br />
          {playLevels.length}레벨
          {breakCount > 0 && (
            <span className="text-amber-700 font-bold"> · 휴식 {breakCount}회</span>
          )}{' '}
          · 시작{' '}
          <span className="font-mono">
            {firstBlind?.sb}/{firstBlind?.bb}
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

/** 분(min) → 초(sec) 변환. NaN/음수 보호. */
function minToSec(min: number): number {
  const n = Math.max(0, Math.floor(min || 0));
  return n * 60;
}

/** 초(sec) → 분(min) 표기용. 반올림 (분 단위 입력으로 회귀할 때 정수성 유지). */
function secToMin(sec: number): number {
  return Math.max(0, Math.round((sec || 0) / 60));
}

/** 100 단위로 반올림(min 100). */
function snap100(n: number): number {
  const v = Math.round(Math.max(0, n) / BLIND_STEP) * BLIND_STEP;
  return Math.max(BLIND_STEP, v);
}

/** ante 기본값 추천 — BB의 1/10, 100 단위로 반올림. */
function suggestAnte(bb: number): number {
  const raw = Math.round(bb / 10);
  return Math.max(BLIND_STEP, Math.round(raw / BLIND_STEP) * BLIND_STEP);
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
  // 기존 데이터에 anteEnabled 없으면 ante>0이 하나라도 있는지로 추론
  const initialAnteEnabled =
    initial?.anteEnabled ?? (initial ? initial.blindStructure.some((b) => (b.ante || 0) > 0) : false);
  // 기존 데이터에 anteMode 없으면 'manual' (기존 호환 — ante 값이 직접 박혀있던 케이스)
  const initialAnteMode: AnteMode = initial?.anteMode ?? 'manual';
  // 기존 데이터에 prizeDisplayUnit 없으면 'ticket' (입력 단위와 일관, 디폴트)
  const initialPrizeUnit: PrizeDisplayUnit = initial?.prizeDisplayUnit ?? 'ticket';

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
          anteEnabled: initialAnteEnabled,
          anteMode: initialAnteMode,
          // 기존 템플릿에 payoutStructure 없으면 기본값 부착 (UI에서 즉시 편집 가능)
          payoutStructure: initial.payoutStructure ?? { ...DEFAULT_PAYOUT_STRUCTURE },
          prizeDisplayUnit: initialPrizeUnit,
        }
      : {
          name: '',
          type: 'freezeout',
          buyIn: 5 * TICKET_WON, // 5T = ₩50,000
          guarantee: 0,
          totalPlayers: 20,
          prizePool: 0,
          startingStack: 20000,
          lateRegEndLevel: 3,
          posterStyle: 'poster-dark',
          blindStructure: DEFAULT_BLIND_STRUCTURE.map((b) => ({ ...b })),
          anteEnabled: false,
          anteMode: 'manual',
          payoutStructure: { ...DEFAULT_PAYOUT_STRUCTURE },
          prizeDisplayUnit: 'ticket',
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // 블라인드/브레이크 공통 수정. SB 변경 시 BB = SB*2 자동.
  const updateBlind = (idx: number, k: keyof BlindLevel, v: number) => {
    setForm((f) => ({
      ...f,
      blindStructure: f.blindStructure.map((b, i) => {
        if (i !== idx) return b;
        if (k === 'sb' && !b.isBreak) {
          const sb = snap100(v);
          return { ...b, sb, bb: sb * 2 };
        }
        if (k === 'bb' && !b.isBreak) {
          return { ...b, bb: snap100(v) };
        }
        if (k === 'ante' && !b.isBreak) {
          // ante는 100 단위 강제 + 0 허용 (snap100은 min 100이라 0 별도 처리)
          const n = Math.max(0, Math.round((v || 0) / BLIND_STEP) * BLIND_STEP);
          return { ...b, ante: n };
        }
        return { ...b, [k]: v };
      }),
    }));
  };

  // 일반 레벨 추가 — 마지막 일반 레벨 기준 +100, BB=SB*2
  const addBlind = () => {
    setForm((f) => {
      const lastPlay = [...f.blindStructure].reverse().find((b) => !b.isBreak);
      const baseSb = lastPlay ? lastPlay.sb : 100;
      const newSb = snap100(baseSb + BLIND_STEP);
      const newBb = newSb * 2;
      const newAnte = f.anteEnabled ? suggestAnte(newBb) : 0;
      const dur = lastPlay?.durationSec || DEFAULT_LEVEL_DURATION_SEC;
      return {
        ...f,
        blindStructure: [
          ...f.blindStructure,
          {
            level: f.blindStructure.length + 1, // 임시; 최종 reindex는 저장 시점
            sb: newSb,
            bb: newBb,
            ante: newAnte,
            durationSec: dur,
          },
        ],
      };
    });
  };

  // 브레이크 추가 — 맨 끝에 삽입 (이후 ↑로 옮길 수 있음)
  const addBreak = () => {
    setForm((f) => ({
      ...f,
      blindStructure: [
        ...f.blindStructure,
        {
          level: f.blindStructure.length + 1,
          sb: 0,
          bb: 0,
          ante: 0,
          durationSec: DEFAULT_BREAK_DURATION_SEC,
          isBreak: true,
        },
      ],
    }));
  };

  const removeBlind = (idx: number) => {
    setForm((f) => ({
      ...f,
      blindStructure: f.blindStructure.filter((_, i) => i !== idx),
    }));
  };

  const moveBlind = (idx: number, dir: -1 | 1) => {
    setForm((f) => {
      const next = idx + dir;
      if (next < 0 || next >= f.blindStructure.length) return f;
      const arr = [...f.blindStructure];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return { ...f, blindStructure: arr };
    });
  };

  // 앤티 토글
  const toggleAnte = () => {
    setForm((f) => {
      const next = !f.anteEnabled;
      return {
        ...f,
        anteEnabled: next,
        blindStructure: f.blindStructure.map((b) => {
          if (b.isBreak) return b;
          if (!next) return { ...b, ante: 0 };
          // ON으로 켜질 때, ante 비어있으면 추천값 자동 채움
          if ((b.ante || 0) === 0) return { ...b, ante: suggestAnte(b.bb) };
          return b;
        }),
      };
    });
  };

  const valid = form.name.trim().length > 0 && form.blindStructure.length > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      // Phase 5 (2026-05-21): 'manual' 모드 제거. prizePool은 항상 자동 계산값으로 저장.
      // (매장 TV/LivePanel은 session.prizePool을 직접 읽으므로 사전 계산해서 박아둠).
      const ps = form.payoutStructure ?? DEFAULT_PAYOUT_STRUCTURE;
      const rawPrize = computeAutoPrizePool(form.buyIn, form.totalPlayers, ps.payoutPercent ?? 90);
      const finalPrizePool = Math.floor((rawPrize || 0) / 10000) * 10000; // 만원 단위 강제 내림
      const anteMode: AnteMode = form.anteMode ?? 'manual';
      await onSave({
        ...form,
        prizePool: finalPrizePool,
        anteMode,
        // 게런티/상금풀은 form 값 그대로 저장 — 매장 어드민/매장 TV 디스플레이에서만 노출됨.
        // 사용자 모바일 앱(/m/*)은 prizePool/guarantee 필드 자체를 화면에 표기하지 않으므로 분리 안전.
        blindStructure: form.blindStructure.map((b, i) => {
          if (b.isBreak) {
            return {
              level: i + 1, // 브레이크도 sequence 유지 (LivePanel/display 모두 level 기반)
              sb: 0,
              bb: 0,
              ante: 0,
              durationSec: Math.max(60, b.durationSec || DEFAULT_BREAK_DURATION_SEC),
              isBreak: true,
            };
          }
          const sb = snap100(b.sb);
          const bb = snap100(b.bb || sb * 2);
          // Phase 4: anteMode='sb'/'bb'면 ante를 sb/bb로 강제. 'manual'이면 입력값 그대로 (100 단위 정규화).
          let ante = 0;
          if (form.anteEnabled) {
            if (anteMode === 'sb') ante = sb;
            else if (anteMode === 'bb') ante = bb;
            else ante = Math.max(0, Math.round((b.ante || 0) / BLIND_STEP) * BLIND_STEP);
          }
          return {
            level: i + 1,
            sb,
            bb,
            ante,
            durationSec: Math.max(60, b.durationSec || DEFAULT_LEVEL_DURATION_SEC),
          };
        }),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  // 바이인 T 단위 입력
  const buyInTickets = wonToTickets(form.buyIn);

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
          <input className="form-input" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="예: 프리징 90" />
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

        {/* 게런티(T) — 사용자 모바일 앱에는 노출 안 됨. 매장 어드민/매장 TV 디스플레이 운영용. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="게런티 (T · 1T=1만원)">
            <div className="relative">
              <input
                type="number"
                min={0}
                step={1}
                className="form-input font-mono pr-7"
                value={wonToTickets(form.guarantee)}
                onChange={(e) => update('guarantee', ticketsToWon(parseInt(e.target.value) || 0))}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-gray-400 pointer-events-none">
                T
              </span>
            </div>
            <div className="text-[10px] text-gray-400 mt-1 font-mono">
              ≈ {fmtPrizeDisplay(form.guarantee, form.prizeDisplayUnit ?? 'ticket') || '—'} · 매장 내 TV 타이머 전용
            </div>
          </Field>
          <Field label="상금풀 (T · 1T=1만원)">
            <div className="relative">
              <input
                type="number"
                min={0}
                step={1}
                disabled
                className="form-input font-mono pr-7 disabled:opacity-60 disabled:bg-gray-50"
                value={wonToTickets(
                  computeAutoPrizePool(
                    form.buyIn,
                    form.totalPlayers,
                    form.payoutStructure?.payoutPercent ?? 90,
                  ),
                )}
                readOnly
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-gray-400 pointer-events-none">
                T
              </span>
            </div>
            <div className="text-[10px] text-gray-400 mt-1 font-mono">
              🔄 자동 계산 — 아래 분배 정책에서 시상 비율(%) 조정 (만원 단위 자동)
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="바이인 (T · 1T=1만원)">
            <div className="relative">
              <input
                type="number"
                min={1}
                step={1}
                className="form-input font-mono pr-7"
                value={buyInTickets}
                onChange={(e) => update('buyIn', ticketsToWon(parseInt(e.target.value) || 0))}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-gray-400 pointer-events-none">
                T
              </span>
            </div>
            <div className="text-[10px] text-gray-400 mt-1 font-mono">
              ≈ {fmtPrizeDisplay(form.buyIn, form.prizeDisplayUnit ?? 'ticket') || '—'}
            </div>
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

        {/* 앤티 on/off 토글 + 앤티 적용 방식 (Phase 4 — 2026-05-21) */}
        <div className="bg-white border-[1.5px] border-gray-200 rounded-xl px-3.5 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-extrabold text-gray-900">앤티 사용 여부</div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {form.anteEnabled
                  ? '아래에서 앤티 적용 방식 선택 (SB / BB / 직접 입력)'
                  : '모든 레벨 ante = 0. 입력란 숨김.'}
              </div>
            </div>
            <button
              type="button"
              onClick={toggleAnte}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                form.anteEnabled ? 'bg-gray-900' : 'bg-gray-300'
              }`}
              aria-pressed={form.anteEnabled}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  form.anteEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          {form.anteEnabled && (
            <div>
              <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">
                앤티 적용 방식
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(['sb', 'bb', 'manual'] as const).map((m) => {
                  const active = (form.anteMode ?? 'manual') === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => update('anteMode', m)}
                      className="py-2 rounded text-[11px] font-bold border-[1.5px] transition leading-tight"
                      style={{
                        background: active ? '#111' : '#fff',
                        color: active ? '#fff' : '#111',
                        borderColor: active ? '#111' : '#eaeaea',
                      }}
                    >
                      {ANTE_MODE_LABELS[m]}
                    </button>
                  );
                })}
              </div>
              <div className="text-[10px] text-gray-400 mt-1.5">
                {(form.anteMode ?? 'manual') === 'sb' && '💡 각 레벨 앤티 = 해당 레벨 SB (자동 적용, 아래 표 read-only).'}
                {form.anteMode === 'bb' && '💡 각 레벨 앤티 = 해당 레벨 BB (자동 적용, 아래 표 read-only).'}
                {(form.anteMode ?? 'manual') === 'manual' && '💡 각 레벨마다 앤티를 직접 입력. 빈 값은 BB의 1/10 추천값.'}
              </div>
            </div>
          )}
        </div>

        {/* 상금 표시 단위 — Phase 4 (2026-05-21).
            매장 어드민/매장 TV 분배표·프라이즈풀 표기에 사용. 사용자 앱 X. */}
        <div className="bg-white border-[1.5px] border-gray-200 rounded-xl px-3.5 py-3">
          <div className="text-xs font-extrabold text-gray-900 mb-0.5">💴 상금 표시 단위</div>
          <div className="text-[10px] text-gray-500 mb-2 leading-relaxed">
            매장 TV·어드민 분배표 표기 방식. 사용자 앱에는 어떤 상금 정보도 표시 안 됨.
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(['amount', 'ticket'] as const).map((u) => {
              const active = (form.prizeDisplayUnit ?? 'ticket') === u;
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => update('prizeDisplayUnit', u)}
                  className="py-2 rounded text-[11px] font-bold border-[1.5px] transition"
                  style={{
                    background: active ? '#111' : '#fff',
                    color: active ? '#fff' : '#111',
                    borderColor: active ? '#111' : '#eaeaea',
                  }}
                >
                  {PRIZE_DISPLAY_UNIT_LABELS[u]}
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── 상금 분배 정책 (Phase 3 — 2026-05-21) ──────────────────
            매장 어드민/TV 전용. 사용자 모바일 앱에는 어떤 상금/분배 정보도 노출되지 않음. */}
        <PayoutStructureEditor
          structure={form.payoutStructure ?? DEFAULT_PAYOUT_STRUCTURE}
          buyIn={form.buyIn}
          totalPlayers={form.totalPlayers}
          displayUnit={form.prizeDisplayUnit ?? 'ticket'}
          onChange={(next) => update('payoutStructure', next)}
        />

        {/* 블라인드 구조 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold text-gray-500 tracking-wider">
              블라인드 구조 ({form.blindStructure.filter((b) => !b.isBreak).length}레벨
              {form.blindStructure.some((b) => b.isBreak)
                ? ` + 휴식 ${form.blindStructure.filter((b) => b.isBreak).length}`
                : ''}
              )
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={addBreak}
                className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-1 rounded border border-amber-200"
              >
                + 휴식 추가
              </button>
              <button
                onClick={addBlind}
                className="bg-black text-white text-[10px] font-bold px-2 py-1 rounded"
              >
                + 레벨 추가
              </button>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3 max-h-80 overflow-y-auto">
            {/* 헤더 — anteEnabled 따라 컬럼 변동 */}
            <div
              className={`grid gap-2 text-[10px] font-bold text-gray-500 tracking-wider pb-2 border-b border-gray-100 items-center ${
                form.anteEnabled
                  ? 'grid-cols-[24px_28px_1fr_1fr_1fr_60px_50px]'
                  : 'grid-cols-[24px_28px_1fr_1fr_60px_50px]'
              }`}
            >
              <div></div>
              <div className="text-center">Lv</div>
              <div>SB (100↑)</div>
              <div>BB</div>
              {form.anteEnabled && <div>Ante</div>}
              <div className="text-center">분</div>
              <div></div>
            </div>
            {form.blindStructure.map((b, idx) => {
              const isBreak = b.isBreak === true;
              const minVal = secToMin(b.durationSec);
              return (
                <div
                  key={idx}
                  className={`grid gap-2 items-center py-1 border-b border-gray-50 ${
                    isBreak ? 'bg-amber-50/50' : ''
                  } ${
                    form.anteEnabled
                      ? 'grid-cols-[24px_28px_1fr_1fr_1fr_60px_50px]'
                      : 'grid-cols-[24px_28px_1fr_1fr_60px_50px]'
                  }`}
                >
                  {/* 순서 조정 화살표 */}
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => moveBlind(idx, -1)}
                      disabled={idx === 0}
                      className="text-[9px] leading-none text-gray-400 hover:text-gray-900 disabled:opacity-20"
                      title="위로"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveBlind(idx, +1)}
                      disabled={idx === form.blindStructure.length - 1}
                      className="text-[9px] leading-none text-gray-400 hover:text-gray-900 disabled:opacity-20"
                      title="아래로"
                    >
                      ▼
                    </button>
                  </div>
                  <div
                    className={`text-center font-mono font-bold text-xs ${
                      isBreak ? 'text-amber-700' : ''
                    }`}
                  >
                    {isBreak ? '☕' : idx + 1}
                  </div>
                  {isBreak ? (
                    <div
                      className={`text-xs font-bold text-amber-800 ${
                        form.anteEnabled ? 'col-span-3' : 'col-span-2'
                      }`}
                    >
                      휴식 (BREAK)
                    </div>
                  ) : (
                    <>
                      <input
                        type="number"
                        min={BLIND_STEP}
                        step={BLIND_STEP}
                        className="form-input text-xs font-mono"
                        value={b.sb}
                        onChange={(e) =>
                          updateBlind(idx, 'sb', parseInt(e.target.value) || BLIND_STEP)
                        }
                      />
                      <input
                        type="number"
                        min={BLIND_STEP}
                        step={BLIND_STEP}
                        className="form-input text-xs font-mono"
                        value={b.bb}
                        onChange={(e) =>
                          updateBlind(idx, 'bb', parseInt(e.target.value) || BLIND_STEP * 2)
                        }
                      />
                      {form.anteEnabled && (() => {
                        const mode = form.anteMode ?? 'manual';
                        const auto = mode === 'sb' ? b.sb : mode === 'bb' ? b.bb : null;
                        if (auto !== null) {
                          return (
                            <div
                              className="form-input text-xs font-mono bg-gray-50 text-gray-600 flex items-center"
                              title={`자동: ${mode.toUpperCase()}와 동일`}
                            >
                              {auto.toLocaleString()}
                            </div>
                          );
                        }
                        return (
                          <input
                            type="number"
                            min={0}
                            step={BLIND_STEP}
                            className="form-input text-xs font-mono"
                            value={b.ante || 0}
                            onChange={(e) => updateBlind(idx, 'ante', parseInt(e.target.value) || 0)}
                          />
                        );
                      })()}
                    </>
                  )}
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="form-input text-xs font-mono"
                    value={minVal}
                    onChange={(e) =>
                      updateBlind(idx, 'durationSec', minToSec(parseInt(e.target.value) || 1))
                    }
                  />
                  <button
                    onClick={() => removeBlind(idx)}
                    className="text-red-500 font-bold text-base"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          {/* 다음 레벨 추가 시 미리보기 — 사장님이 "+ 레벨 추가" 누르기 전에 SB/BB가 얼마가 되는지 확인 */}
          {(() => {
            const lastPlay = [...form.blindStructure].reverse().find((b) => !b.isBreak);
            if (!lastPlay) return null;
            const baseSb = lastPlay.sb;
            const nextSb = snap100(baseSb + BLIND_STEP);
            const nextBb = nextSb * 2;
            const mode = form.anteMode ?? 'manual';
            const nextAnte = form.anteEnabled
              ? (mode === 'sb' ? nextSb : mode === 'bb' ? nextBb : suggestAnte(nextBb))
              : 0;
            const playCount = form.blindStructure.filter((b) => !b.isBreak).length;
            return (
              <div className="mt-2 bg-gray-900 text-white rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <div className="text-[10px] font-extrabold tracking-widest text-gray-400">
                  ▶ NEXT (+레벨 추가 시)
                </div>
                <div className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-[10px] text-gray-400 font-bold">Lv {playCount + 1}</span>
                  <span className="text-sm font-extrabold">
                    {nextSb.toLocaleString()}
                    <span className="text-gray-500 mx-0.5">/</span>
                    {nextBb.toLocaleString()}
                  </span>
                  {nextAnte > 0 && (
                    <span className="text-[10px] text-gray-400">ante {nextAnte.toLocaleString()}</span>
                  )}
                </div>
              </div>
            );
          })()}
          <div className="text-[10px] text-gray-400 mt-1 leading-relaxed">
            💡 시간은 <b>분</b> 단위 (예: 10, 15, 20). SB는 100 단위, BB는 자동으로 SB×2.
            <br />☕ 휴식은 ↑/↓로 원하는 위치에 끼워 넣을 수 있어요.
          </div>
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

// =====================================================================
// 상금 분배 정책 편집기 (Phase 3 — 2026-05-21, Phase 5 — 2026-05-21 단일화)
// =====================================================================
/**
 * 사용자 요구:
 *  - 프라이즈풀 = 참가비 × 인원 × 시상비율(%) 자동 계산 (Phase 5: 단일 모드)
 *  - 시상 등수 (top N) — 정수 or 자동
 *  - 분배 방식 — 탑헤비 / 스탠다드 / 균등 / 직접편집 4개 프리셋
 *  - 직접편집 시 등수별 % 자유 조정 + 합계 100% 검증
 *  - 실시간 분배표 미리보기 (등수 · 비율 · 금액)
 *
 * Phase 5 (2026-05-21): 사용자 결정 — "참가비 기반 자동계산은 계산이 잘되고있고, 수동입력은 어떤기능인지 이해가 어려움".
 * '수동 입력' 모드 제거. 항상 자동 계산. UI 단순화.
 *
 * 노출: 매장 어드민/매장 TV. 사용자 앱 X (정책 확립).
 */
function PayoutStructureEditor({
  structure,
  buyIn,
  totalPlayers,
  displayUnit,
  onChange,
}: {
  structure: PayoutStructure;
  buyIn: number;
  totalPlayers: number;
  displayUnit: PrizeDisplayUnit;
  onChange: (next: PayoutStructure) => void;
}) {
  const update = <K extends keyof PayoutStructure>(k: K, v: PayoutStructure[K]) => {
    onChange({ ...structure, [k]: v });
  };

  // 자동 계산 prizePool — Phase 5: 항상 자동 계산 (수동 모드 제거)
  const computedPrize = computeAutoPrizePool(buyIn, totalPlayers, structure.payoutPercent ?? 90);

  // 분배표 계산 — 사장이 변경할 때마다 즉시 업데이트
  const payouts = computePayoutsFromStructure(structure, totalPlayers);
  const itmN = payouts.length;
  const displayPrize = computedPrize; // 표 우측 금액 표시용 (Phase 5: 항상 자동 계산 결과)

  // 분배 방식 변경 시: custom→다른 프리셋으로 가면 customPercents 비움; 다른→custom이면 현재 프리셋 비율을 seed
  const handleDistChange = (next: PayoutStructure['distribution']) => {
    if (next === 'custom') {
      const seed = payouts.map((p) => Math.round(p.ratio * 1000) / 10); // % 1자리
      onChange({ ...structure, distribution: 'custom', customPercents: seed });
    } else {
      onChange({ ...structure, distribution: next, customPercents: undefined });
    }
  };

  // ITM 인원 변경 — auto/수동 토글
  const handleItmAuto = () => {
    onChange({ ...structure, itmCount: 'auto', customPercents: undefined });
  };
  const handleItmManual = (n: number) => {
    const clamped = Math.max(1, Math.min(99, Math.floor(n)));
    onChange({ ...structure, itmCount: clamped });
  };

  // custom 등수별 % 변경
  const updateCustomPercent = (idx: number, v: number) => {
    if (structure.distribution !== 'custom') return;
    const next = [...(structure.customPercents ?? payouts.map((p) => p.ratio * 100))];
    next[idx] = Math.max(0, Math.min(100, v));
    onChange({ ...structure, customPercents: next });
  };

  // custom 모드일 때 합계 검증
  const customSum =
    structure.distribution === 'custom'
      ? (structure.customPercents ?? []).slice(0, itmN).reduce((a, b) => a + (b || 0), 0)
      : 100;
  const customSumOff = structure.distribution === 'custom' && Math.abs(customSum - 100) > 0.5;

  return (
    <div className="bg-white border-[1.5px] border-gray-200 rounded-xl p-3.5 space-y-3">
      <div>
        <div className="text-xs font-extrabold text-gray-900 mb-0.5">💰 상금 분배 (참가비 기반 자동 계산)</div>
        <div className="text-[10px] text-gray-500 leading-relaxed">
          프라이즈풀 = 바이인 × 인원 × 시상비율(%). 매장 TV·어드민에만 노출. 사용자 앱에는 어떤 상금 정보도 표시 안 됨.
        </div>
      </div>

      {/* ① 시상 비율 (참가비 기반 자동 계산) — Phase 5: 단일 모드 */}
      <div>
        <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">
          ① 시상 비율 (% — 나머지는 매장 rake)
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <div className="relative">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              className="form-input font-mono pr-7"
              value={structure.payoutPercent ?? 90}
              onChange={(e) =>
                update('payoutPercent', Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))
              }
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-gray-400 pointer-events-none">
              %
            </span>
          </div>
          <div className="bg-gray-900 text-white rounded-lg px-3 py-2 text-right">
            <div className="text-[9px] font-bold tracking-widest text-gray-400">자동 계산 (만원 단위)</div>
            <div className="font-mono text-sm font-extrabold">
              {fmtPrizeDisplay(computedPrize, displayUnit) || '—'}
            </div>
            <div className="text-[9px] text-gray-400 font-mono">
              {wonToTickets(buyIn)}T × {totalPlayers}명 × {structure.payoutPercent ?? 90}%
            </div>
          </div>
        </div>
      </div>

      {/* ② 시상 등수 */}
      <div>
        <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">
          ② 시상 등수 (ITM, In The Money)
        </div>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={handleItmAuto}
            className="px-3 py-2 rounded text-[11px] font-bold border-[1.5px] transition"
            style={{
              background: structure.itmCount === 'auto' ? '#111' : '#fff',
              color: structure.itmCount === 'auto' ? '#fff' : '#111',
              borderColor: structure.itmCount === 'auto' ? '#111' : '#eaeaea',
            }}
          >
            자동 (인원의 15%)
          </button>
          <span className="text-[10px] text-gray-400">또는</span>
          <div className="relative flex-1 max-w-[120px]">
            <input
              type="number"
              min={1}
              max={99}
              step={1}
              className="form-input font-mono pr-12"
              value={typeof structure.itmCount === 'number' ? structure.itmCount : ''}
              placeholder="직접"
              onChange={(e) => {
                const n = parseInt(e.target.value);
                if (!isNaN(n) && n > 0) handleItmManual(n);
              }}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 pointer-events-none">
              등까지
            </span>
          </div>
          <div className="text-[10px] text-gray-500 font-mono">→ {itmN}명 시상</div>
        </div>
      </div>

      {/* ③ 분배 방식 프리셋 */}
      <div>
        <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">
          ③ 분배 방식
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(['top-heavy', 'standard', 'flat', 'custom'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleDistChange(d)}
              className="py-2 rounded text-[10px] font-bold border-[1.5px] transition leading-tight"
              style={{
                background: structure.distribution === d ? '#FF1F8F' : '#fff',
                color: structure.distribution === d ? '#fff' : '#111',
                borderColor: structure.distribution === d ? '#FF1F8F' : '#eaeaea',
              }}
              title={DISTRIBUTION_LABELS[d]}
            >
              {d === 'top-heavy' ? '탑 헤비' : d === 'standard' ? '스탠다드' : d === 'flat' ? '균등' : '직접 편집'}
            </button>
          ))}
        </div>
      </div>

      {/* ④ 분배표 미리보기 + custom 편집 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] font-bold text-gray-500 tracking-wider">
            ④ 분배표 미리보기 ({itmN}등까지)
          </div>
          {customSumOff && (
            <div className="text-[10px] font-bold text-red-600">
              ⚠ 합계 {customSum.toFixed(1)}% (100% 필요)
            </div>
          )}
        </div>
        <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-[40px_1fr_1fr] text-[10px] font-bold text-gray-500 tracking-wider px-2 py-1.5 border-b border-gray-200 bg-white">
            <div>등수</div>
            <div>비율</div>
            <div className="text-right">금액 (만원 단위)</div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {(() => {
              // Phase 4: 만원 단위 내림 + 잔여 1등 추가 — 합계 = displayPrize 보장
              const amounts = computePayoutAmounts(displayPrize, payouts);
              return payouts.map((p, idx) => {
                const ratioPct = p.ratio * 100;
                const won = amounts[idx]?.amount ?? 0;
                return (
                  <div
                    key={p.rank}
                    className="grid grid-cols-[40px_1fr_1fr] items-center px-2 py-1 text-[11px] border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-mono font-extrabold text-gray-900">
                      {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `${p.rank}`}
                    </div>
                    {structure.distribution === 'custom' ? (
                      <div className="relative max-w-[100px]">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          className="form-input font-mono text-xs pr-6"
                          value={
                            structure.customPercents?.[idx] != null
                              ? structure.customPercents[idx]
                              : Math.round(ratioPct * 10) / 10
                          }
                          onChange={(e) => updateCustomPercent(idx, parseFloat(e.target.value) || 0)}
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 pointer-events-none">
                          %
                        </span>
                      </div>
                    ) : (
                      <div className="font-mono text-gray-700">{ratioPct.toFixed(1)}%</div>
                    )}
                    <div className="text-right font-mono text-gray-900 font-bold">
                      {displayPrize > 0 ? (fmtPrizeDisplay(won, displayUnit) || '—') : '—'}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
