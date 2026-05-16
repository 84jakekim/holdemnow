'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type TournamentInstance,
  subscribeStoreTournaments,
  createTournament,
  cancelTournament,
  deleteTournament,
} from '@/lib/tournaments';
import {
  type TournamentTemplate,
  subscribeTemplates,
  posterStyleFor,
} from '@/lib/templates';

interface Props {
  storeId: string;
  storeName: string;
}

export default function TournamentsPanel({ storeId, storeName }: Props) {
  const [tournaments, setTournaments] = useState<TournamentInstance[]>([]);
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    const unsubT = subscribeStoreTournaments(
      storeId,
      (items) => {
        setTournaments(items);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    const unsubTpl = subscribeTemplates(storeId, setTemplates, () => {});
    return () => {
      unsubT();
      unsubTpl();
    };
  }, [storeId]);

  const grouped = useMemo(() => {
    const groups: Record<string, TournamentInstance[]> = {};
    for (const t of tournaments) {
      const date = t.startsAt.toDate();
      const key = date.toISOString().slice(0, 10); // YYYY-MM-DD
      (groups[key] ||= []).push(t);
    }
    return Object.entries(groups).sort();
  }, [tournaments]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">📅 예정 토너</h1>
          <p className="text-sm text-gray-500 mt-1">시작 시간 지정 후 모바일 캘린더에 즉시 노출</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          disabled={templates.length === 0}
          className="bg-black text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-gray-900 disabled:opacity-40"
        >
          + 토너 등록
        </button>
      </div>

      {templates.length === 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          💡 먼저 좌측 <b>🎲 토너 템플릿</b>에서 토너를 등록해야 합니다.
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : tournaments.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">📅</div>
          <div className="font-bold text-gray-900 mb-2">등록된 예정 토너가 없습니다</div>
          <div className="text-xs text-gray-500">
            "+ 토너 등록"으로 사전 등록하세요. 모바일 캘린더에 자동 노출됩니다.
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([dateKey, items]) => {
            const d = new Date(dateKey + 'T00:00:00');
            const label = `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
            return (
              <div key={dateKey}>
                <div className="text-sm font-bold text-gray-900 mb-2">{label}</div>
                <div className="space-y-2">
                  {items.map((t) => (
                    <TournamentRow key={t.id} t={t} storeId={storeId} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <AddTournamentModal
          templates={templates}
          onPick={async (template, startsAt) => {
            try {
              await createTournament(storeId, storeName, template, startsAt);
              setShowAddModal(false);
            } catch (e: unknown) {
              alert(`등록 실패: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}
          onCancel={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

function TournamentRow({ t, storeId }: { t: TournamentInstance; storeId: string }) {
  const poster = posterStyleFor(t.posterStyle);
  const time = t.startsAt.toDate();
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3">
      <div
        className="w-12 h-16 rounded-md flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
        style={{ background: poster.bg, color: poster.color }}
      >
        {t.name.split(' ').slice(0, 2).join(' ')}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-gray-900 truncate">{t.name}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          <span className="font-mono font-bold text-gray-900">
            {hh}:{mm}
          </span>{' '}
          시작 · 바이인 ₩{t.buyIn.toLocaleString()} · {t.totalPlayers}명
        </div>
        {t.status === 'live' && (
          <div className="inline-flex items-center gap-1 bg-red-50 text-red-600 rounded-md px-1.5 py-0.5 mt-1.5">
            <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[9px] font-extrabold">LIVE 진행 중</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          onClick={() => {
            if (window.confirm('이 예정 토너를 취소할까요? (캘린더에서 제외)')) {
              cancelTournament(storeId, t.id);
            }
          }}
          className="text-[10px] font-bold border border-gray-200 rounded-md px-2 py-1 hover:bg-gray-50"
        >
          취소
        </button>
        <button
          onClick={() => {
            if (window.confirm('완전 삭제할까요?')) deleteTournament(storeId, t.id);
          }}
          className="text-[10px] font-bold border border-red-200 text-red-600 rounded-md px-2 py-1 hover:bg-red-50"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function AddTournamentModal({
  templates,
  onPick,
  onCancel,
}: {
  templates: TournamentTemplate[];
  onPick: (t: TournamentTemplate, when: Date) => void;
  onCancel: () => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  // 기본값: 오늘 + 2시간
  const defaultDt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  defaultDt.setSeconds(0, 0);
  const defaultStr = `${defaultDt.getFullYear()}-${String(defaultDt.getMonth() + 1).padStart(2, '0')}-${String(defaultDt.getDate()).padStart(2, '0')}T${String(defaultDt.getHours()).padStart(2, '0')}:${String(defaultDt.getMinutes()).padStart(2, '0')}`;
  const [whenStr, setWhenStr] = useState(defaultStr);

  const picked = templates.find((t) => t.id === templateId);

  return (
    <div onClick={onCancel} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 className="font-extrabold text-gray-900 mb-1">예정 토너 등록</h3>
        <p className="text-xs text-gray-500 mb-4">템플릿 + 시작 시간을 지정하세요</p>

        <div className="space-y-3 mb-4">
          <div>
            <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">토너 템플릿</div>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="form-input"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · ₩{t.buyIn.toLocaleString()} · {t.totalPlayers}명
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">시작 일시</div>
            <input
              type="datetime-local"
              value={whenStr}
              onChange={(e) => setWhenStr(e.target.value)}
              className="form-input font-mono"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border-[1.5px] border-gray-200 font-bold text-sm"
          >
            취소
          </button>
          <button
            onClick={() => {
              if (!picked) return;
              const when = new Date(whenStr);
              if (isNaN(when.getTime())) {
                alert('시작 시간을 확인하세요');
                return;
              }
              onPick(picked, when);
            }}
            disabled={!picked}
            className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm disabled:opacity-40"
          >
            등록
          </button>
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
    </div>
  );
}
