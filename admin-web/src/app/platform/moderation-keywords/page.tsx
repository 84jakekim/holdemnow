'use client';

/**
 * 본사 어드민 — 금지어 사전 관리 (/platform/moderation-keywords).
 *
 * 매장 어드민 글 작성 / 리뷰 / 커뮤니티 / 데일리 글 작성 시 사용되는 단어 사전.
 * 본사가 단어를 추가/삭제/토글하면 사용자 클라이언트는 1분 캐시 + onSnapshot으로
 * 즉시 새 사전을 적용 (앱 재배포 불필요).
 *
 * 매칭 정책:
 *   - exact: 토큰 전체가 단어와 동일 (예: "시발" 단독 등장만 매칭)
 *   - partial: 토큰 안에 단어 포함 (예: "시발놈"이 "시발" 포함 — 매칭)
 *   - contains: 전체 문자열 normalize 후 substring (도박/환금 같이 우회 시도 잦은 키워드)
 *
 * 디폴트는 partial — 토큰 단위라 정상 명사("오늘 20시 발표")와 충돌 X.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/hooks';
import {
  type ModerationKeyword,
  type ModerationCategory,
  type ModerationMatchMode,
  subscribeAllModerationKeywords,
  createModerationKeyword,
  updateModerationKeyword,
  deleteModerationKeyword,
  seedDefaultKeywords,
  SEED_KEYWORDS,
} from '@/lib/moderationKeywords';
import { LEGAL_BLOCKED_KEYWORDS } from '@/lib/moderation';

const CATEGORY_META: Record<ModerationCategory, { label: string; color: string; emoji: string }> = {
  profanity: { label: '욕설/비속어', color: '#EF4444', emoji: '🚫' },
  gambling:  { label: '도박/사설',   color: '#F59E0B', emoji: '🎰' },
  cashout:   { label: '환금/현금화', color: '#A855F7', emoji: '💸' },
  spam:      { label: '스팸/도배',   color: '#3B82F6', emoji: '📢' },
  other:     { label: '기타',         color: '#6B7280', emoji: '🏷️' },
};

const MATCH_MODE_META: Record<ModerationMatchMode, { label: string; hint: string }> = {
  exact:    { label: '정확',  hint: '토큰 전체 일치 — 단독 등장만 차단' },
  partial:  { label: '부분',  hint: '토큰 안 포함 — "시발놈" 매칭, "20시 발표" 미매칭' },
  contains: { label: '전체',  hint: '전체 문자열 검색 — 도박/환금 우회 방어' },
};

export default function PlatformModerationKeywordsPage() {
  const authState = useAuth();
  const uid = authState.status === 'authenticated' ? authState.user.uid : '';
  const [items, setItems] = useState<ModerationKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ModerationCategory | 'all'>('all');
  const [modeFilter, setModeFilter] = useState<ModerationMatchMode | 'all'>('all');
  const [editing, setEditing] = useState<ModerationKeyword | 'new' | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<{ added: number; skipped: number } | null>(null);

  useEffect(() => {
    const unsub = subscribeAllModerationKeywords(
      (next) => {
        setItems(next);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((k) => {
      if (categoryFilter !== 'all' && k.category !== categoryFilter) return false;
      if (modeFilter !== 'all' && k.matchMode !== modeFilter) return false;
      if (q && !k.word.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, categoryFilter, modeFilter]);

  const grouped = useMemo(() => {
    const out: Record<ModerationCategory, ModerationKeyword[]> = {
      profanity: [], gambling: [], cashout: [], spam: [], other: [],
    };
    for (const k of filtered) out[k.category]?.push(k);
    return out;
  }, [filtered]);

  const counts = useMemo(() => {
    const out: Record<ModerationCategory, { total: number; enabled: number }> = {
      profanity: { total: 0, enabled: 0 },
      gambling:  { total: 0, enabled: 0 },
      cashout:   { total: 0, enabled: 0 },
      spam:      { total: 0, enabled: 0 },
      other:     { total: 0, enabled: 0 },
    };
    for (const k of items) {
      const c = out[k.category];
      if (!c) continue;
      c.total++;
      if (k.enabled !== false) c.enabled++;
    }
    return out;
  }, [items]);

  const enabledTotal = items.filter((k) => k.enabled !== false).length;

  const handleSeed = async () => {
    if (!uid) return;
    if (!window.confirm(
      `기본 사전 ${SEED_KEYWORDS.length}개를 일괄 등록합니다.\n이미 같은 단어는 자동 skip됩니다.\n계속할까요?`,
    )) return;
    setSeeding(true);
    setSeedResult(null);
    try {
      const r = await seedDefaultKeywords(uid);
      setSeedResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)' }}>
            🚫 금지어 사전
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
            매장 글·리뷰·커뮤니티 작성 시 자동 차단됩니다. 변경은 사용자 앱에 즉시 반영.
            <br />
            <span style={{ color: 'var(--gold)' }}>본사 등록 {enabledTotal}개</span>
            <span style={{ color: 'var(--text-3)' }}> / 전체 {items.length}개</span>
            <span style={{ color: 'var(--text-3)' }}> · 법적 차단 {LEGAL_BLOCKED_KEYWORDS.length}개(자동)</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
            style={{
              background: enabledTotal === 0 ? 'var(--gold)' : 'var(--surface-2)',
              color: enabledTotal === 0 ? '#0F1419' : 'var(--text-1)',
              border: enabledTotal === 0 ? '1px solid var(--gold)' : '1px solid var(--border)',
              boxShadow: enabledTotal === 0 ? '0 0 0 3px rgba(255,196,71,0.2)' : undefined,
            }}
            title={`욕설/비속어 기본 사전 ${SEED_KEYWORDS.length}개를 Firestore로 일괄 등록`}
          >
            {seeding ? '시드 중…' : `📦 기본 사전 시드 (${SEED_KEYWORDS.length}개)`}
          </button>
          <button
            onClick={() => setEditing('new')}
            className="px-4 py-2 rounded-lg text-xs font-bold"
            style={{ background: 'var(--gold)', color: '#0F1419' }}
          >
            + 새 단어
          </button>
        </div>
      </div>

      {enabledTotal === 0 && (
        <div
          className="mb-4 rounded-lg p-3 text-xs leading-relaxed"
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.4)',
            color: 'var(--text-1)',
          }}
        >
          ⚠️ <b>본사 등록 단어가 0개입니다.</b> 욕설/비속어는 현재 <b>차단되지 않습니다</b>.
          <br />
          → <b>📦 기본 사전 시드 ({SEED_KEYWORDS.length}개)</b> 버튼으로 한 번에 등록하거나,
          <b>+ 새 단어</b>로 직접 추가하세요.
          <br />
          <span style={{ color: 'var(--text-3)' }}>
            * 환금·도박·환전·사설토토 등 법적 리스크 키워드 {LEGAL_BLOCKED_KEYWORDS.length}개는 코드에 내장되어 항상 차단됩니다.
          </span>
        </div>
      )}

      {seedResult && (
        <div
          className="mb-4 rounded-lg p-3 text-xs"
          style={{
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.4)',
            color: 'var(--text-1)',
          }}
        >
          ✅ 시드 완료: 신규 {seedResult.added}개 등록, 중복 {seedResult.skipped}개 skip.
        </div>
      )}

      {error && (
        <div
          className="mb-4 rounded-lg p-3 text-xs"
          style={{
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.4)',
            color: '#FCA5A5',
          }}
        >
          {error}
        </div>
      )}

      {/* 카테고리 카운트 칩 */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setCategoryFilter('all')}
          className="px-3 py-1.5 rounded-full text-xs font-bold"
          style={{
            background: categoryFilter === 'all' ? 'var(--gold)' : 'var(--surface-2)',
            color: categoryFilter === 'all' ? '#0F1419' : 'var(--text-2)',
            border: '1px solid var(--border)',
          }}
        >
          전체 {items.length}
        </button>
        {(Object.keys(CATEGORY_META) as ModerationCategory[]).map((c) => (
          <button
            key={c}
            onClick={() => setCategoryFilter(c)}
            className="px-3 py-1.5 rounded-full text-xs font-bold"
            style={{
              background: categoryFilter === c ? CATEGORY_META[c].color : 'var(--surface-2)',
              color: categoryFilter === c ? '#fff' : 'var(--text-2)',
              border: `1px solid ${categoryFilter === c ? CATEGORY_META[c].color : 'var(--border)'}`,
            }}
          >
            {CATEGORY_META[c].emoji} {CATEGORY_META[c].label} {counts[c].enabled}/{counts[c].total}
          </button>
        ))}
      </div>

      {/* 검색 + 매칭 모드 필터 */}
      <div className="mb-5 flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="단어 검색"
          className="flex-1 min-w-[180px] px-3 py-2 rounded-lg text-sm"
          style={{
            background: 'var(--surface-1)',
            color: 'var(--text-1)',
            border: '1px solid var(--border)',
          }}
        />
        <select
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value as ModerationMatchMode | 'all')}
          className="px-3 py-2 rounded-lg text-sm"
          style={{
            background: 'var(--surface-1)',
            color: 'var(--text-1)',
            border: '1px solid var(--border)',
          }}
        >
          <option value="all">모든 매칭</option>
          <option value="exact">정확 매칭</option>
          <option value="partial">부분 매칭</option>
          <option value="contains">전체 검색</option>
        </select>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>로딩 중…</div>
      ) : filtered.length === 0 ? (
        <EmptyState onSeed={handleSeed} seeding={seeding} hasAny={items.length > 0} />
      ) : (
        <div className="space-y-6">
          {(Object.keys(CATEGORY_META) as ModerationCategory[]).map((c) => {
            const list = grouped[c];
            if (!list || list.length === 0) return null;
            return (
              <section key={c}>
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ fontSize: 16 }}>{CATEGORY_META[c].emoji}</span>
                  <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
                    {CATEGORY_META[c].label}
                  </h2>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    ({list.length}개)
                  </span>
                </div>
                <div
                  className="rounded-lg overflow-hidden"
                  style={{ border: '1px solid var(--border)' }}
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--surface-2)' }}>
                        <th className="text-left px-3 py-2 font-bold" style={{ color: 'var(--text-3)', fontSize: 11 }}>단어</th>
                        <th className="text-left px-3 py-2 font-bold" style={{ color: 'var(--text-3)', fontSize: 11, width: 130 }}>매칭</th>
                        <th className="text-left px-3 py-2 font-bold" style={{ color: 'var(--text-3)', fontSize: 11, width: 80 }}>활성</th>
                        <th className="text-right px-3 py-2 font-bold" style={{ color: 'var(--text-3)', fontSize: 11, width: 140 }}>액션</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((k) => (
                        <KeywordRow
                          key={k.id}
                          item={k}
                          onEdit={() => setEditing(k)}
                          onToggle={async (next) => {
                            try {
                              await updateModerationKeyword(k.id, { enabled: next });
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                          onDelete={async () => {
                            if (!window.confirm(`"${k.word}" 단어를 삭제할까요?`)) return;
                            try {
                              await deleteModerationKeyword(k.id);
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editing && (
        <EditModal
          item={editing === 'new' ? null : editing}
          uid={uid}
          onClose={() => setEditing(null)}
          onError={(m) => setError(m)}
        />
      )}

      <div
        className="mt-8 rounded-xl p-5 text-xs leading-relaxed"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
        }}
      >
        <div className="font-bold mb-2" style={{ color: 'var(--text-1)' }}>💡 매칭 정책 정리</div>
        <ul className="list-disc list-inside space-y-1">
          <li><b style={{ color: 'var(--text-1)' }}>정확</b>: 토큰 전체가 단어와 동일해야 매칭. 짧은 단어를 안전하게 차단.</li>
          <li><b style={{ color: 'var(--text-1)' }}>부분</b>: 토큰 안에 단어 포함. 예) &quot;시발놈아&quot;는 매칭 / &quot;오늘 20시 발표&quot;는 미매칭.</li>
          <li><b style={{ color: 'var(--text-1)' }}>전체</b>: 띄어쓰기·특수문자 제거 후 전체 문자열에서 검색. 도박/환금 우회 방어용.</li>
          <li>변경은 즉시 모든 사용자 클라이언트에 반영 (onSnapshot + 1분 캐시).</li>
        </ul>
        <div className="font-bold mt-4 mb-2" style={{ color: 'var(--text-1)' }}>
          🔒 법적 차단 키워드 ({LEGAL_BLOCKED_KEYWORDS.length}개 · 항상 적용)
        </div>
        <p className="mb-2" style={{ fontSize: 11 }}>
          아래 키워드는 사용자 앱 노출 시 법적 리스크가 있어 코드에 내장되어 있습니다.
          본사도 토글/삭제할 수 없으며, 위 사전이 비어 있어도 항상 차단됩니다.
        </p>
        <div className="flex flex-wrap gap-1">
          {LEGAL_BLOCKED_KEYWORDS.map((w) => (
            <span
              key={w}
              className="px-2 py-0.5 rounded-full text-[11px]"
              style={{
                background: 'rgba(168,85,247,0.12)',
                color: '#D8B4FE',
                border: '1px solid rgba(168,85,247,0.3)',
                fontFamily: 'monospace',
              }}
            >
              {w}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onSeed, seeding, hasAny }: { onSeed: () => void; seeding: boolean; hasAny: boolean }) {
  return (
    <div
      className="rounded-xl p-10 text-center"
      style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
    >
      <div style={{ fontSize: 36, marginBottom: 8 }}>🚫</div>
      <div className="font-bold mb-1" style={{ color: 'var(--text-1)' }}>
        {hasAny ? '검색 결과가 없습니다' : '등록된 금지어가 없습니다'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
        {hasAny
          ? '필터/검색어를 조정해보세요.'
          : `먼저 기본 사전 ${SEED_KEYWORDS.length}개를 시드하거나, 우상단 "+ 새 단어"로 등록하세요.`}
      </div>
      {!hasAny && (
        <button
          onClick={onSeed}
          disabled={seeding}
          className="px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
          style={{ background: 'var(--gold)', color: '#0F1419' }}
        >
          {seeding ? '시드 중…' : `📦 기본 사전 시드 (${SEED_KEYWORDS.length}개)`}
        </button>
      )}
    </div>
  );
}

function KeywordRow({
  item,
  onEdit,
  onToggle,
  onDelete,
}: {
  item: ModerationKeyword;
  onEdit: () => void;
  onToggle: (next: boolean) => void;
  onDelete: () => void;
}) {
  const enabled = item.enabled !== false;
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td className="px-3 py-2" style={{ color: 'var(--text-1)', fontSize: 13, fontFamily: 'monospace' }}>
        {item.word}
      </td>
      <td className="px-3 py-2" style={{ fontSize: 11, color: 'var(--text-2)' }}>
        <span
          className="px-2 py-0.5 rounded-full"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
          title={MATCH_MODE_META[item.matchMode].hint}
        >
          {MATCH_MODE_META[item.matchMode].label}
        </span>
      </td>
      <td className="px-3 py-2">
        <button
          onClick={() => onToggle(!enabled)}
          className="text-xs font-bold rounded-full px-2.5 py-0.5"
          style={{
            background: enabled ? 'rgba(34,197,94,0.15)' : 'var(--surface-2)',
            color: enabled ? '#86EFAC' : 'var(--text-3)',
            border: `1px solid ${enabled ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
          }}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={onEdit}
          className="mr-2 text-xs underline"
          style={{ color: 'var(--text-2)' }}
        >
          수정
        </button>
        <button
          onClick={onDelete}
          className="text-xs underline"
          style={{ color: '#F87171' }}
        >
          삭제
        </button>
      </td>
    </tr>
  );
}

function EditModal({
  item,
  uid,
  onClose,
  onError,
}: {
  item: ModerationKeyword | null;
  uid: string;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [word, setWord] = useState(item?.word ?? '');
  const [category, setCategory] = useState<ModerationCategory>(item?.category ?? 'profanity');
  const [matchMode, setMatchMode] = useState<ModerationMatchMode>(item?.matchMode ?? 'partial');
  const [enabled, setEnabled] = useState<boolean>(item?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = word.trim();
    if (!trimmed) {
      onError('단어를 입력하세요');
      return;
    }
    setSaving(true);
    try {
      if (item) {
        await updateModerationKeyword(item.id, { word: trimmed, category, matchMode, enabled });
      } else {
        await createModerationKeyword({ word: trimmed, category, matchMode, enabled, createdBy: uid });
      }
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-5 w-full max-w-md"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          color: 'var(--text-1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-bold mb-4" style={{ fontSize: 16 }}>
          {item ? '단어 수정' : '새 단어 등록'}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-2)' }}>
              단어
            </label>
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm font-mono"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-1)',
                border: '1px solid var(--border)',
              }}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-2)' }}>
              카테고리
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ModerationCategory)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-1)',
                border: '1px solid var(--border)',
              }}
            >
              {(Object.keys(CATEGORY_META) as ModerationCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_META[c].emoji} {CATEGORY_META[c].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-2)' }}>
              매칭 방식
            </label>
            <select
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as ModerationMatchMode)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-1)',
                border: '1px solid var(--border)',
              }}
            >
              <option value="partial">부분 (디폴트) — 토큰 안 포함</option>
              <option value="exact">정확 — 토큰 전체 일치</option>
              <option value="contains">전체 — 띄어쓰기 제거 후 substring</option>
            </select>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              {MATCH_MODE_META[matchMode].hint}
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span style={{ fontSize: 13 }}>활성화 (체크 해제 시 일시 비활성)</span>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              border: '1px solid var(--border)',
            }}
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
            style={{ background: 'var(--gold)', color: '#0F1419' }}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
