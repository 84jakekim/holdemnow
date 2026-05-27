'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  updateDoc,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';
import {
  type TournamentInstance,
  subscribeStoreTournaments,
  createTournament,
  cancelTournament,
  deleteTournament,
  tournamentsCol,
} from '@/lib/tournaments';
import {
  type TournamentTemplate,
  subscribeTemplates,
  posterStyleFor,
} from '@/lib/templates';
import TournamentGuide from './TournamentGuide';

interface Props {
  storeId: string;
  storeName: string;
}

export default function TournamentsPanel({ storeId, storeName }: Props) {
  const [tournaments, setTournaments] = useState<TournamentInstance[]>([]);
  const [expiredTournaments, setExpiredTournaments] = useState<TournamentInstance[]>([]);
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

    // expired 토너 별도 구독 — 매장 사장이 인지할 수 있게
    const expiredQ = query(
      tournamentsCol(storeId),
      where('status', '==', 'expired'),
      orderBy('startsAt', 'desc'),
    );
    const unsubExpired = onSnapshot(
      expiredQ,
      (snap) => {
        const items = snap.docs.map(
          (d) =>
            ({
              id: d.id,
              storeId,
              ...(d.data() as Omit<TournamentInstance, 'id' | 'storeId'>),
            }) as TournamentInstance,
        );
        setExpiredTournaments(items);
      },
      (err) => {
        // 비치명: 자동 만료 섹션만 비어 보일 수 있음
        console.warn('[TournamentsPanel] expired subscribe failed:', err);
      },
    );

    const unsubTpl = subscribeTemplates(storeId, setTemplates, (e) => {
      // eslint-disable-next-line no-console
      console.warn('[TournamentsPanel] 템플릿 구독 실패', e);
    });
    return () => {
      unsubT();
      unsubExpired();
      unsubTpl();
    };
  }, [storeId]);

  const scheduled = useMemo(
    () => tournaments.filter((t) => t.status === 'scheduled'),
    [tournaments],
  );
  const liveOnes = useMemo(
    () => tournaments.filter((t) => t.status === 'live'),
    [tournaments],
  );

  const scheduledGrouped = useMemo(() => {
    const groups: Record<string, TournamentInstance[]> = {};
    for (const t of scheduled) {
      const date = t.startsAt.toDate();
      const key = date.toISOString().slice(0, 10); // YYYY-MM-DD
      (groups[key] ||= []).push(t);
    }
    return Object.entries(groups).sort();
  }, [scheduled]);

  async function handleRestore(t: TournamentInstance) {
    const ok = window.confirm(
      '이 토너를 복원할까요?\n\n복원 후엔 "예정" 상태로 돌아가지만,\n시작 시간이 과거이므로 새 시작 시각으로 수정해야 LIVE 시작이 가능합니다.',
    );
    if (!ok) return;
    try {
      await updateDoc(doc(tournamentsCol(storeId), t.id), {
        status: 'scheduled',
        expiredAt: deleteField(),
        autoExpiredReason: deleteField(),
        updatedAt: serverTimestamp(),
      });
      alert('복원되었습니다. 시작 시각을 다시 지정해주세요.');
    } catch (e: unknown) {
      alert(`복원 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const totalActive = scheduled.length + liveOnes.length;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="section-title" style={{ color: 'var(--brand)' }}>SCHEDULED TOURNAMENTS</div>
          <h1 className="h2" style={{ color: 'var(--text-1)' }}>📅 예정 토너</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>시작 시간 지정 후 모바일 캘린더에 즉시 노출</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          disabled={templates.length === 0}
          className="btn-brand px-4 py-2.5 text-sm tap disabled:opacity-40"
          style={{ borderRadius: 'var(--r-md)' }}
        >
          + 토너 등록
        </button>
      </div>

      {templates.length === 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          💡 먼저 좌측 <b>🎲 토너 템플릿</b>에서 토너를 등록해야 합니다.
        </div>
      )}

      {/* ── 활용 가이드 (2026-05-27 사용자 요청) ── */}
      <TournamentGuide />


      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* 자동 만료 경고 배너 */}
      {expiredTournaments.length > 0 && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
          <span className="text-base">⚠️</span>
          <div className="text-xs text-amber-800 leading-relaxed">
            <b>자동 만료된 토너 {expiredTournaments.length}건</b>이 있습니다. 시작 후 3시간 동안
            LIVE 시작이 없어 자동으로 만료 처리되었습니다. 아래 <b>자동 만료</b> 섹션에서 복원하거나
            삭제하세요.
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : (
        <div className="space-y-8">
          {/* LIVE 진행 중 */}
          {liveOnes.length > 0 && (
            <section>
              <SectionHeader
                icon={
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    LIVE
                  </span>
                }
                title="진행 중"
                count={liveOnes.length}
                tone="live"
              />
              <div className="space-y-2">
                {liveOnes.map((t) => (
                  <TournamentRow key={t.id} t={t} storeId={storeId} />
                ))}
              </div>
            </section>
          )}

          {/* 예정 */}
          <section>
            <SectionHeader icon="📅" title="예정" count={scheduled.length} tone="default" />
            {scheduled.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
                <div className="text-3xl mb-2">📅</div>
                <div className="font-bold text-gray-900 mb-1 text-sm">등록된 예정 토너가 없습니다</div>
                <div className="text-xs text-gray-500">
                  "+ 토너 등록"으로 사전 등록하세요. 모바일 캘린더에 자동 노출됩니다.
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {scheduledGrouped.map(([dateKey, items]) => {
                  const d = new Date(dateKey + 'T00:00:00');
                  const label = `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
                  return (
                    <div key={dateKey}>
                      <div className="text-xs font-bold text-gray-700 mb-2">{label}</div>
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
          </section>

          {/* 자동 만료 */}
          {expiredTournaments.length > 0 && (
            <section>
              <SectionHeader
                icon="⚠️"
                title="자동 만료"
                count={expiredTournaments.length}
                tone="warn"
                hint="시작 후 3시간 동안 LIVE 미시작"
              />
              <div className="space-y-2">
                {expiredTournaments.map((t) => (
                  <ExpiredTournamentRow
                    key={t.id}
                    t={t}
                    storeId={storeId}
                    onRestore={() => handleRestore(t)}
                  />
                ))}
              </div>
            </section>
          )}

          {totalActive === 0 && expiredTournaments.length === 0 && (
            <div className="text-xs text-gray-400 mt-2">현재 표시할 토너가 없습니다.</div>
          )}
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

function SectionHeader({
  icon,
  title,
  count,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  tone: 'default' | 'live' | 'warn';
  hint?: string;
}) {
  const toneStyle =
    tone === 'live'
      ? { color: '#dc2626' }
      : tone === 'warn'
        ? { color: '#b45309' }
        : { color: 'var(--text-1)' };
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span className="text-sm font-extrabold" style={toneStyle}>
        {icon} {title}
      </span>
      <span className="text-[11px] font-bold text-gray-500">({count}건)</span>
      {hint && <span className="text-[11px] text-gray-400">· {hint}</span>}
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

function ExpiredTournamentRow({
  t,
  storeId,
  onRestore,
}: {
  t: TournamentInstance;
  storeId: string;
  onRestore: () => void;
}) {
  const time = t.startsAt.toDate();
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  const mo = time.getMonth() + 1;
  const da = time.getDate();
  const expiredAtStr = t.expiredAt
    ? (() => {
        const d = t.expiredAt.toDate();
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      })()
    : null;

  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{
        background: '#fafafa',
        border: '1px solid #e5e7eb',
        opacity: 0.92,
      }}
    >
      <div
        className="w-12 h-16 rounded-md flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
        style={{ background: '#e5e7eb', color: '#6b7280' }}
      >
        {t.name.split(' ').slice(0, 2).join(' ')}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-amber-600 text-sm" aria-hidden>
            ⚠️
          </span>
          <span className="font-bold text-gray-700 truncate line-through decoration-gray-300">
            {t.name}
          </span>
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          예정 <span className="font-mono">{mo}/{da} {hh}:{mm}</span> · 바이인 ₩
          {t.buyIn.toLocaleString()}
        </div>
        <div className="text-[10px] text-amber-700 mt-1 font-medium">
          {t.autoExpiredReason ?? '시작 후 3시간 동안 LIVE 미시작'}
          {expiredAtStr && <span className="text-gray-400 ml-1">(만료 {expiredAtStr})</span>}
        </div>
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          onClick={onRestore}
          className="text-[10px] font-bold border border-gray-300 bg-white rounded-md px-2 py-1 hover:bg-gray-50"
          title="다시 예정 상태로 되돌리기"
        >
          복원
        </button>
        <button
          onClick={() => {
            if (window.confirm('완전 삭제할까요? (되돌릴 수 없습니다)'))
              deleteTournament(storeId, t.id);
          }}
          className="text-[10px] font-bold border border-red-200 text-red-600 rounded-md px-2 py-1 hover:bg-red-50"
        >
          삭제
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
