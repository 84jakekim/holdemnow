'use client';

/**
 * /platform/audit-log — 본사 어드민 감사 로그 (auditLogs 컬렉션 뷰어)
 *
 * 기록되는 액션:
 *  - 모더레이션: hide / restore / delete (post / community / dealer / review / comment)
 *  - 멤버 관리: export_members / send_password_reset / change_status / change_role
 *
 * 모든 platform_admin 행위가 timestamp 순으로 누적. firestore.rules에서
 * create-only (update/delete 불가)로 강제되어 위변조 불가.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface AuditRow {
  id: string;
  actor?: string;
  actorUid?: string;
  actorEmail?: string;
  timestamp?: Timestamp;
  action: string;
  // 모더레이션
  targetPath?: string;
  targetType?: 'post' | 'community' | 'dealer' | 'review' | 'comment' | string;
  reason?: string;
  // 멤버 관리
  target?: { type?: string; id?: string };
  metadata?: Record<string, unknown>;
}

type ActionFilter = 'all' | 'moderation' | 'membership' | 'hide' | 'restore' | 'delete';
type TargetFilter = 'all' | 'post' | 'community' | 'dealer' | 'review' | 'comment' | 'user' | 'store' | 'organizer';

const ACTION_LABEL: Record<string, { label: string; tone: 'red' | 'amber' | 'green' | 'gray' | 'blue' }> = {
  hide: { label: '숨김', tone: 'amber' },
  restore: { label: '복구', tone: 'green' },
  delete: { label: '삭제', tone: 'red' },
  export_members: { label: '회원 내보내기', tone: 'blue' },
  send_password_reset: { label: '비번 재설정 메일', tone: 'blue' },
  change_status: { label: '상태 변경', tone: 'amber' },
  change_role: { label: '역할 변경', tone: 'amber' },
};

const TARGET_LABEL: Record<string, string> = {
  post: '매장 소식',
  community: '커뮤니티',
  dealer: '딜러 프로필',
  review: '리뷰',
  comment: '댓글',
  user: '사용자',
  store: '매장',
  organizer: '대회사',
};

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [targetFilter, setTargetFilter] = useState<TargetFilter>('all');
  const [actorSearch, setActorSearch] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(500));
    return onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditRow, 'id'>) })));
        setLoading(false);
      },
      (e) => { setErr(e.message); setLoading(false); },
    );
  }, []);

  const filtered = useMemo(() => {
    const MODERATION_ACTIONS = new Set(['hide', 'restore', 'delete']);
    const MEMBERSHIP_ACTIONS = new Set(['export_members', 'send_password_reset', 'change_status', 'change_role']);
    return items.filter((r) => {
      if (actionFilter === 'moderation' && !MODERATION_ACTIONS.has(r.action)) return false;
      if (actionFilter === 'membership' && !MEMBERSHIP_ACTIONS.has(r.action)) return false;
      if (actionFilter === 'hide' && r.action !== 'hide') return false;
      if (actionFilter === 'restore' && r.action !== 'restore') return false;
      if (actionFilter === 'delete' && r.action !== 'delete') return false;
      if (targetFilter !== 'all') {
        const t = r.targetType ?? r.target?.type;
        if (t !== targetFilter) return false;
      }
      if (actorSearch) {
        const s = actorSearch.toLowerCase();
        const text = `${r.actorEmail ?? ''} ${r.actorUid ?? r.actor ?? ''}`.toLowerCase();
        if (!text.includes(s)) return false;
      }
      return true;
    });
  }, [items, actionFilter, targetFilter, actorSearch]);

  // 통계
  const stats = useMemo(() => {
    let hide = 0, restore = 0, del = 0;
    for (const r of filtered) {
      if (r.action === 'hide') hide++;
      else if (r.action === 'restore') restore++;
      else if (r.action === 'delete') del++;
    }
    return { hide, restore, del };
  }, [filtered]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900">감사 로그 (Audit Log)</h1>
        <p className="text-sm text-gray-500 mt-1">
          본사 관리자(platform_admin) 행위 기록. 위변조 불가(create-only) — 분쟁·법적 증빙용.
        </p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard label="🚫 숨김" value={stats.hide} tone="amber" />
        <StatCard label="↩️ 복구" value={stats.restore} tone="green" />
        <StatCard label="🗑 삭제" value={stats.del} tone="red" />
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-3 mb-4 bg-white border border-gray-200 rounded-xl p-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-gray-600">액션</span>
          {([
            { id: 'all' as ActionFilter, label: '전체' },
            { id: 'moderation' as ActionFilter, label: '모더레이션' },
            { id: 'hide' as ActionFilter, label: '숨김만' },
            { id: 'restore' as ActionFilter, label: '복구만' },
            { id: 'delete' as ActionFilter, label: '삭제만' },
            { id: 'membership' as ActionFilter, label: '멤버관리' },
          ]).map((b) => (
            <button
              key={b.id}
              onClick={() => setActionFilter(b.id)}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition ${
                actionFilter === b.id ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-gray-600 ml-3">대상</span>
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value as TargetFilter)}
            className="px-2 py-1 border border-gray-200 rounded-md text-xs font-bold bg-white"
          >
            <option value="all">전체</option>
            <option value="post">매장 소식</option>
            <option value="community">커뮤니티</option>
            <option value="dealer">딜러 프로필</option>
            <option value="review">리뷰</option>
            <option value="user">사용자</option>
            <option value="store">매장</option>
            <option value="organizer">대회사</option>
          </select>
        </div>
        <input
          value={actorSearch}
          onChange={(e) => setActorSearch(e.target.value)}
          placeholder="작성자 이메일/uid 검색"
          className="flex-1 min-w-[200px] max-w-xs px-3 py-1.5 border border-gray-200 rounded-md text-sm"
        />
        <span className="text-xs text-gray-500 font-mono ml-auto">{filtered.length}건</span>
      </div>

      {err && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">
          불러오기 실패: {err}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">로딩 중…</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center bg-white border-2 border-dashed border-gray-200 rounded-xl">
          <div className="text-3xl mb-2">📋</div>
          <div className="text-sm font-bold text-gray-700">조건에 맞는 감사 로그가 없습니다</div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 600 }}>
            <thead className="bg-gray-50 text-[10px] font-bold text-gray-500 tracking-wider uppercase">
              <tr>
                <th className="text-left p-3">시각</th>
                <th className="text-left p-3">관리자</th>
                <th className="text-left p-3">액션</th>
                <th className="text-left p-3">대상</th>
                <th className="text-left p-3 hidden md:table-cell">경로 / 사유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => {
                const meta = ACTION_LABEL[r.action] ?? { label: r.action, tone: 'gray' as const };
                const tType = r.targetType ?? r.target?.type ?? '';
                const targetLbl = TARGET_LABEL[tType] ?? tType;
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="p-3 text-[11px] text-gray-500 whitespace-nowrap font-mono">
                      {formatTime(r.timestamp)}
                    </td>
                    <td className="p-3">
                      <div className="text-[12px] font-bold text-gray-900">{r.actorEmail ?? '(이메일 없음)'}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{(r.actorUid ?? r.actor ?? '').slice(0, 14)}…</div>
                    </td>
                    <td className="p-3">
                      <ActionBadge label={meta.label} tone={meta.tone} />
                    </td>
                    <td className="p-3 text-[12px]">
                      {targetLbl && <span className="font-bold text-gray-900">{targetLbl}</span>}
                      {r.target?.id && (
                        <div className="text-[10px] text-gray-400 font-mono mt-0.5">{r.target.id.slice(0, 18)}…</div>
                      )}
                    </td>
                    <td className="p-3 hidden md:table-cell text-[11px] text-gray-500 font-mono break-all">
                      {r.targetPath ?? (r.metadata ? JSON.stringify(r.metadata).slice(0, 80) : '-')}
                      {r.reason && (
                        <div className="text-[11px] text-amber-700 mt-1 font-sans">사유: {r.reason}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'green' | 'red' }) {
  const colors = {
    amber: { bg: '#FFFBEB', border: '#FCD34D', text: '#92400E' },
    green: { bg: '#ECFDF5', border: '#6EE7B7', text: '#065F46' },
    red: { bg: '#FEF2F2', border: '#FCA5A5', text: '#991B1B' },
  }[tone];
  return (
    <div className="rounded-xl px-4 py-3 border" style={{ background: colors.bg, borderColor: colors.border }}>
      <div className="text-[11px] font-bold" style={{ color: colors.text }}>{label}</div>
      <div className="text-[26px] font-extrabold tabular-nums mt-0.5" style={{ color: colors.text, letterSpacing: '-0.02em' }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function ActionBadge({ label, tone }: { label: string; tone: 'red' | 'amber' | 'green' | 'gray' | 'blue' }) {
  const cls = {
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-800',
    green: 'bg-emerald-100 text-emerald-800',
    gray: 'bg-gray-200 text-gray-700',
    blue: 'bg-blue-100 text-blue-700',
  }[tone];
  return (
    <span className={`text-[10.5px] font-extrabold tracking-wider px-2 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  );
}

function formatTime(ts?: Timestamp): string {
  if (!ts) return '-';
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
