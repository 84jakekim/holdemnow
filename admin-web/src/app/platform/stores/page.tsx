'use client';

import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface StoreRow {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  status: 'pending' | 'active' | 'paused' | 'closed';
  ownerUid: string;
  isDemo?: boolean;
  createdAt?: { toDate: () => Date };
}

export default function PlatformStoresPage() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'demo'>('pending');

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'stores'), orderBy('createdAt', 'desc')),
      (snap) => {
        setStores(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StoreRow, 'id'>) })));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  const filtered = stores.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'demo') return s.isDemo === true;
    return s.status === filter;
  });

  const approve = async (id: string) => {
    await updateDoc(doc(db, 'stores', id), { status: 'active', updatedAt: serverTimestamp() });
  };
  const pause = async (id: string) => {
    await updateDoc(doc(db, 'stores', id), { status: 'paused', updatedAt: serverTimestamp() });
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`매장 "${name}" 삭제? (복구 불가)`)) return;
    await deleteDoc(doc(db, 'stores', id));
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">🏬 매장 심사·관리</h1>
        <p className="text-sm text-gray-500 mt-1">가입 매장 승인·일시 중단·삭제</p>
      </div>

      <div className="flex gap-1.5 mb-4">
        {([
          { id: 'pending', label: `심사 대기 (${stores.filter((s) => s.status === 'pending').length})` },
          { id: 'active', label: `활성 (${stores.filter((s) => s.status === 'active').length})` },
          { id: 'demo', label: `데모 (${stores.filter((s) => s.isDemo).length})` },
          { id: 'all', label: `전체 (${stores.length})` },
        ] as const).map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border ${
              filter === c.id
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-900 border-gray-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-10 text-center text-sm text-gray-500">
          해당 조건의 매장이 없습니다
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] font-bold text-gray-500 tracking-wider">
              <tr>
                <th className="text-left p-3">매장</th>
                <th className="text-left p-3 hidden md:table-cell">연락처</th>
                <th className="text-left p-3">상태</th>
                <th className="text-right p-3">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="p-3">
                    <div className="font-bold text-gray-900">
                      {s.name}
                      {s.isDemo && (
                        <span className="ml-1.5 text-[9px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-extrabold">
                          DEMO
                        </span>
                      )}
                    </div>
                    {s.address && (
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate">{s.address}</div>
                    )}
                  </td>
                  <td className="p-3 hidden md:table-cell text-xs text-gray-600">
                    {s.phone ?? '-'}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex gap-1 justify-end">
                      {s.status === 'pending' && (
                        <button
                          onClick={() => approve(s.id)}
                          className="text-[10px] font-bold bg-green-600 text-white rounded px-2 py-1 hover:bg-green-700"
                        >
                          승인
                        </button>
                      )}
                      {s.status === 'active' && (
                        <button
                          onClick={() => pause(s.id)}
                          className="text-[10px] font-bold bg-gray-200 text-gray-700 rounded px-2 py-1 hover:bg-gray-300"
                        >
                          중단
                        </button>
                      )}
                      {s.status === 'paused' && (
                        <button
                          onClick={() => approve(s.id)}
                          className="text-[10px] font-bold bg-green-600 text-white rounded px-2 py-1 hover:bg-green-700"
                        >
                          재개
                        </button>
                      )}
                      <button
                        onClick={() => remove(s.id, s.name)}
                        className="text-[10px] font-bold bg-white border border-red-200 text-red-600 rounded px-2 py-1 hover:bg-red-50"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StoreRow['status'] }) {
  const styles: Record<StoreRow['status'], string> = {
    pending: 'bg-amber-100 text-amber-700',
    active: 'bg-green-100 text-green-700',
    paused: 'bg-gray-200 text-gray-700',
    closed: 'bg-red-100 text-red-700',
  };
  const labels: Record<StoreRow['status'], string> = {
    pending: '심사 대기',
    active: '활성',
    paused: '중단',
    closed: '종료',
  };
  return (
    <span className={`text-[10px] font-extrabold rounded px-2 py-1 ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
