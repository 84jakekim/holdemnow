'use client';

/**
 * BanlistPanel — 본사 회원관리 '차단 관리' 탭.
 * 강제 탈퇴(영구)·본인 탈퇴(쿨다운)로 차단된 연락처(번호/이메일) 목록을 조회하고,
 * 필요 시 차단을 해제(liftUserBan)해 재가입을 다시 허용한다.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { liftUserBan } from '@/lib/userAdmin';

interface BanRow {
  id: string; // = uid
  uid?: string;
  phone?: string | null;
  email?: string | null;
  displayName?: string | null;
  type?: 'force_delete' | 'self_withdrawal';
  reason?: string | null;
  bannedBy?: string | null;
  createdAt?: { toDate: () => Date };
  expiresAt?: { toDate: () => Date; toMillis: () => number } | null;
}

function fmtDate(d?: { toDate: () => Date } | null): string {
  if (!d?.toDate) return '—';
  const x = d.toDate();
  return `${x.getFullYear()}.${String(x.getMonth() + 1).padStart(2, '0')}.${String(x.getDate()).padStart(2, '0')}`;
}

export default function BanlistPanel() {
  const [rows, setRows] = useState<BanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'force_delete' | 'self_withdrawal'>('all');

  useEffect(() => {
    const q = query(collection(db, 'banlist'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BanRow, 'id'>) })));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.type === filter)),
    [rows, filter],
  );

  const now = Date.now();
  const isActive = (r: BanRow) => !r.expiresAt || (r.expiresAt.toMillis?.() ?? 0) > now;

  const handleLift = async (r: BanRow) => {
    const label = r.displayName || r.email || r.phone || r.id;
    if (!window.confirm(`"${label}"의 차단을 해제하시겠습니까?\n동일 번호·이메일로 다시 가입할 수 있게 됩니다.`)) return;
    setBusyId(r.id);
    try {
      await liftUserBan({ uid: r.id });
      setRows((prev) => prev.filter((x) => x.id !== r.id)); // 낙관적 제거
    } catch (e) {
      alert(`차단 해제 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="text-sm text-gray-500">로딩 중…</div>;

  const counts = {
    force: rows.filter((r) => r.type === 'force_delete').length,
    self: rows.filter((r) => r.type === 'self_withdrawal').length,
  };

  return (
    <div>
      <div className="flex gap-1.5 mb-4 flex-wrap items-center">
        {(
          [
            { id: 'all', label: `전체 (${rows.length})` },
            { id: 'force_delete', label: `강제 탈퇴·영구 (${counts.force})` },
            { id: 'self_withdrawal', label: `본인 탈퇴·쿨다운 (${counts.self})` },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
              filter === f.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-gray-500 mb-3">
        강제 탈퇴(영구)·본인 탈퇴(쿨다운 3개월) 차단 목록입니다. 동일 번호·이메일 재가입이 차단됩니다.
        해제하면 즉시 재가입이 가능해집니다.
      </p>

      {filtered.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-10 text-center text-sm text-gray-500">
          차단된 계정이 없습니다
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 720 }}>
            <thead className="bg-gray-50 text-[10px] font-bold text-gray-500 tracking-wider">
              <tr>
                <th className="text-left p-3">대상</th>
                <th className="text-left p-3">유형</th>
                <th className="text-left p-3 hidden md:table-cell">사유</th>
                <th className="text-left p-3 hidden md:table-cell">차단일</th>
                <th className="text-left p-3">상태</th>
                <th className="text-right p-3">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => {
                const active = isActive(r);
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="p-3">
                      <div className="font-bold text-gray-900">{r.displayName || '(이름 없음)'}</div>
                      <div className="text-[11px] text-gray-500 font-mono mt-0.5">{r.email || '—'}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{r.phone || '—'}</div>
                    </td>
                    <td className="p-3">
                      {r.type === 'force_delete' ? (
                        <span className="text-[10px] font-extrabold rounded px-2 py-0.5 bg-red-100 text-red-700">강제·영구</span>
                      ) : (
                        <span className="text-[10px] font-extrabold rounded px-2 py-0.5 bg-amber-100 text-amber-700">본인·쿨다운</span>
                      )}
                    </td>
                    <td className="p-3 hidden md:table-cell text-[12px] text-gray-600">{r.reason || '—'}</td>
                    <td className="p-3 hidden md:table-cell text-[11px] text-gray-500">{fmtDate(r.createdAt)}</td>
                    <td className="p-3">
                      {r.type === 'force_delete' ? (
                        <span className="text-[11px] font-bold text-red-600">영구 차단</span>
                      ) : active ? (
                        <span className="text-[11px] text-gray-700">{fmtDate(r.expiresAt)}까지</span>
                      ) : (
                        <span className="text-[11px] text-gray-400">만료됨(재가입 가능)</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleLift(r)}
                        disabled={busyId === r.id}
                        className="text-[10px] font-bold bg-gray-900 text-white rounded px-2.5 py-1 hover:bg-gray-700 disabled:opacity-40"
                      >
                        {busyId === r.id ? '해제 중…' : '차단 해제'}
                      </button>
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
