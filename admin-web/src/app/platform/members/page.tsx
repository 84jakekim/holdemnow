'use client';

/**
 * /platform/members — 본사 회원 통합 관리
 * Tab 1: 일반 사용자 (OAuth) | Tab 2: 매장 가입자 | Tab 3: 대회사 가입자
 */

import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';

// =====================================================================
// 타입
// =====================================================================

type Tab = 'players' | 'stores' | 'organizers';

interface PlayerRow {
  id: string;
  email?: string;
  displayName?: string;
  providers?: string[];
  signupSource?: string;
  status?: 'active' | 'suspended';
  createdAt?: { toDate: () => Date };
}

interface StoreRow {
  id: string;
  name: string;
  ownerUid?: string;
  address?: string;
  phone?: string;
  representativeName?: string;
  representativePhone?: string;
  status?: 'pending' | 'active' | 'rejected' | 'suspended' | 'paused' | 'closed';
  isDemo?: boolean;
  createdAt?: { toDate: () => Date };
  // ownerEmail은 별도 fetch 필요 — v0.1: users/{ownerUid}.email로 표시
  ownerEmail?: string;
}

interface OrganizerRow {
  id: string;
  companyName?: string;
  name?: string;
  representativeName?: string;
  contactPerson?: { name?: string; phone?: string };
  ownerUid?: string;
  status?: 'pending' | 'active' | 'rejected' | 'suspended' | 'paused';
  createdAt?: { toDate: () => Date };
}

// =====================================================================
// 메인
// =====================================================================

function MembersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get('tab') ?? 'players') as Tab;
  const [activeTab, setActiveTab] = useState<Tab>(tabParam);

  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [organizers, setOrganizers] = useState<OrganizerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [storeFilter, setStoreFilter] = useState<'all' | 'pending' | 'active' | 'rejected' | 'suspended'>('pending');
  const [orgFilter, setOrgFilter] = useState<'all' | 'pending' | 'active' | 'rejected'>('pending');
  const [playerSearch, setPlayerSearch] = useState('');

  const [rejectModal, setRejectModal] = useState<{ id: string; type: 'store' | 'organizer'; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    router.replace(`/platform/members?tab=${tab}`, { scroll: false });
  };

  // 실시간 구독
  useEffect(() => {
    setLoading(true);
    const unsubs: (() => void)[] = [];

    // 일반 사용자 — signupSource='oauth' 또는 providers에 google/kakao
    // v0.1: users 전체 읽어서 클라이언트 필터 (인덱스 비용 절감)
    const uq = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    unsubs.push(
      onSnapshot(
        uq,
        (snap) => {
          const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PlayerRow, 'id'>) }));
          setPlayers(
            all.filter((u) => {
              const src = u.signupSource;
              const prov = u.providers ?? [];
              return (
                src === 'oauth' ||
                src === undefined ||
                prov.includes('google') ||
                prov.includes('kakao') ||
                (!src && !prov.includes('password'))
              );
            }),
          );
          setLoading(false);
        },
        () => setLoading(false),
      ),
    );

    // 매장 전체
    const sq = query(collection(db, 'stores'), orderBy('createdAt', 'desc'));
    unsubs.push(
      onSnapshot(
        sq,
        (snap) => setStores(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StoreRow, 'id'>) }))),
        () => {},
      ),
    );

    // 대회사 전체
    const oq = query(collection(db, 'organizers'), orderBy('createdAt', 'desc'));
    unsubs.push(
      onSnapshot(
        oq,
        (snap) => setOrganizers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrganizerRow, 'id'>) }))),
        () => {},
      ),
    );

    return () => unsubs.forEach((u) => u());
  }, []);

  // 탭별 카운트
  const pendingStores = stores.filter((s) => s.status === 'pending').length;
  const pendingOrgs = organizers.filter((o) => o.status === 'pending').length;

  // 승인
  const approveStore = async (id: string) => {
    await updateDoc(doc(db, 'stores', id), { status: 'active', reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  };
  const approveOrg = async (id: string) => {
    await updateDoc(doc(db, 'organizers', id), { status: 'active', reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  };

  // 반려
  const rejectStore = async (id: string, reason: string) => {
    await updateDoc(doc(db, 'stores', id), { status: 'rejected', rejectionReason: reason, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  };
  const rejectOrg = async (id: string, reason: string) => {
    await updateDoc(doc(db, 'organizers', id), { status: 'rejected', rejectionReason: reason, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  };

  // 정지
  const suspendStore = async (id: string) => {
    await updateDoc(doc(db, 'stores', id), { status: 'suspended', updatedAt: serverTimestamp() });
  };
  const suspendOrg = async (id: string) => {
    await updateDoc(doc(db, 'organizers', id), { status: 'suspended', updatedAt: serverTimestamp() });
  };
  const suspendPlayer = async (id: string) => {
    await updateDoc(doc(db, 'users', id), { status: 'suspended', updatedAt: serverTimestamp() });
  };
  const activatePlayer = async (id: string) => {
    await updateDoc(doc(db, 'users', id), { status: 'active', updatedAt: serverTimestamp() });
  };

  // 반려 모달 처리
  const handleRejectSubmit = async () => {
    if (!rejectModal) return;
    if (rejectModal.type === 'store') {
      await rejectStore(rejectModal.id, rejectReason);
    } else {
      await rejectOrg(rejectModal.id, rejectReason);
    }
    setRejectModal(null);
    setRejectReason('');
  };

  // 필터
  const filteredStores = stores.filter((s) => {
    if (storeFilter === 'all') return true;
    return s.status === storeFilter;
  });

  const filteredOrgs = organizers.filter((o) => {
    if (orgFilter === 'all') return true;
    return o.status === orgFilter;
  });

  const filteredPlayers = players.filter((p) => {
    const q = playerSearch.toLowerCase();
    if (!q) return true;
    return (
      (p.email ?? '').toLowerCase().includes(q) ||
      (p.displayName ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* 페이지 헤더 */}
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">회원 관리</h1>
        <p className="text-sm text-gray-500 mt-1">일반 사용자, 매장, 대회사 통합 관리</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1.5 mb-6 border-b border-gray-100 pb-0">
        {(
          [
            { id: 'players' as Tab, label: '일반 사용자', count: players.length, badge: 0 },
            { id: 'stores' as Tab, label: '매장', badge: pendingStores, count: stores.length },
            { id: 'organizers' as Tab, label: '대회사', badge: pendingOrgs, count: organizers.length },
          ]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`relative px-5 py-2.5 text-sm font-bold rounded-t-lg border-b-2 transition ${
              activeTab === t.id
                ? 'text-gray-900 border-gray-900'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-[10px] text-gray-400">({t.count})</span>
            {t.badge > 0 ? (
              <span className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] rounded-full text-[9px] font-extrabold flex items-center justify-center px-1 text-white" style={{ background: '#FF1F8F' }}>
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-gray-500">로딩 중…</div>}

      {/* ── Tab 1: 일반 사용자 ── */}
      {activeTab === 'players' && !loading && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <input
              className="form-input max-w-xs"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              placeholder="이메일 또는 이름 검색"
            />
            <span className="text-xs text-gray-500">{filteredPlayers.length}명</span>
          </div>

          {filteredPlayers.length === 0 ? (
            <EmptyState label="일반 사용자가 없습니다" />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[10px] font-bold text-gray-500 tracking-wider">
                  <tr>
                    <th className="text-left p-3">사용자</th>
                    <th className="text-left p-3 hidden md:table-cell">로그인 방법</th>
                    <th className="text-left p-3 hidden md:table-cell">가입일</th>
                    <th className="text-left p-3">상태</th>
                    <th className="text-right p-3">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredPlayers.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="p-3">
                        <div className="font-bold text-gray-900">{p.displayName ?? '(이름 없음)'}</div>
                        <div className="text-[11px] text-gray-500 font-mono">{p.email ?? p.id.slice(0, 16) + '…'}</div>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <div className="flex gap-1 flex-wrap">
                          {(p.providers ?? []).map((pv) => (
                            <ProviderBadge key={pv} provider={pv} />
                          ))}
                          {(!p.providers || p.providers.length === 0) && (
                            <span className="text-[10px] text-gray-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 hidden md:table-cell text-[11px] text-gray-500">
                        {p.createdAt ? formatDate(p.createdAt.toDate()) : '-'}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={p.status ?? 'active'} type="user" />
                      </td>
                      <td className="p-3 text-right">
                        {p.status === 'suspended' ? (
                          <button
                            onClick={() => activatePlayer(p.id)}
                            className="text-[10px] font-bold bg-green-600 text-white rounded px-2 py-1 hover:bg-green-700"
                          >
                            복구
                          </button>
                        ) : (
                          <button
                            onClick={() => { if (window.confirm('이 사용자를 정지하시겠습니까?')) suspendPlayer(p.id); }}
                            className="text-[10px] font-bold bg-gray-200 text-gray-700 rounded px-2 py-1 hover:bg-gray-300"
                          >
                            정지
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab 2: 매장 ── */}
      {activeTab === 'stores' && !loading && (
        <div>
          <div className="flex gap-1.5 mb-4 flex-wrap">
            {(
              [
                { id: 'pending', label: `심사 대기 (${stores.filter((s) => s.status === 'pending').length})` },
                { id: 'active', label: `활성 (${stores.filter((s) => s.status === 'active').length})` },
                { id: 'rejected', label: `반려 (${stores.filter((s) => s.status === 'rejected').length})` },
                { id: 'suspended', label: `정지 (${stores.filter((s) => s.status === 'suspended').length})` },
                { id: 'all', label: `전체 (${stores.length})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setStoreFilter(f.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                  storeFilter === f.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredStores.length === 0 ? (
            <EmptyState label="해당 조건의 매장이 없습니다" />
          ) : (
            <div className="space-y-3">
              {filteredStores.map((s) => (
                <StoreCard
                  key={s.id}
                  store={s}
                  onApprove={() => approveStore(s.id)}
                  onReject={() => setRejectModal({ id: s.id, type: 'store', name: s.name })}
                  onSuspend={() => { if (window.confirm(`"${s.name}" 매장을 정지하시겠습니까?`)) suspendStore(s.id); }}
                  onReactivate={() => approveStore(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 3: 대회사 ── */}
      {activeTab === 'organizers' && !loading && (
        <div>
          <div className="flex gap-1.5 mb-4 flex-wrap">
            {(
              [
                { id: 'pending', label: `심사 대기 (${organizers.filter((o) => o.status === 'pending').length})` },
                { id: 'active', label: `활성 (${organizers.filter((o) => o.status === 'active').length})` },
                { id: 'rejected', label: `반려 (${organizers.filter((o) => o.status === 'rejected').length})` },
                { id: 'all', label: `전체 (${organizers.length})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setOrgFilter(f.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                  orgFilter === f.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredOrgs.length === 0 ? (
            <EmptyState label="해당 조건의 대회사가 없습니다" />
          ) : (
            <div className="space-y-3">
              {filteredOrgs.map((o) => (
                <OrganizerCard
                  key={o.id}
                  org={o}
                  onApprove={() => approveOrg(o.id)}
                  onReject={() => setRejectModal({ id: o.id, type: 'organizer', name: o.companyName ?? o.name ?? o.id })}
                  onSuspend={() => { if (window.confirm(`"${o.companyName ?? o.name}" 대회사를 정지하시겠습니까?`)) suspendOrg(o.id); }}
                  onReactivate={() => approveOrg(o.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 반려 모달 */}
      {rejectModal && (
        <div
          onClick={() => setRejectModal(null)}
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-6 max-w-sm w-full"
          >
            <h3 className="font-extrabold text-gray-900 mb-1">반려 처리</h3>
            <p className="text-xs text-gray-500 mb-4">
              <b>{rejectModal.name}</b>의 신청을 반려합니다. 반려 사유를 입력하세요.
            </p>
            <textarea
              className="form-input min-h-[80px] resize-none"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="반려 사유 (가입자에게 전달됩니다)"
            />
            <div className="flex gap-2.5 mt-4">
              <button onClick={() => setRejectModal(null)} className="flex-1 py-2.5 rounded-xl border-[1.5px] border-gray-200 font-bold text-sm">
                취소
              </button>
              <button
                onClick={handleRejectSubmit}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-700"
              >
                반려
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .form-input {
          background: #fff;
          border: 1.5px solid #e5e7eb;
          border-radius: 10px;
          padding: 9px 12px;
          font-size: 13px;
          color: #111;
          width: 100%;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.15s;
        }
        .form-input:focus { border-color: #111; }
      `}</style>
    </div>
  );
}

export default function MembersPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 p-8">로딩 중…</div>}>
      <MembersPageInner />
    </Suspense>
  );
}

// =====================================================================
// 서브 컴포넌트
// =====================================================================

function StoreCard({
  store,
  onApprove,
  onReject,
  onSuspend,
  onReactivate,
}: {
  store: StoreRow;
  onApprove: () => void;
  onReject: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-bold text-gray-900">{store.name}</div>
            <StatusBadge status={store.status ?? 'pending'} type="store" />
            {store.isDemo && (
              <span className="text-[9px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-extrabold">DEMO</span>
            )}
          </div>
          <div className="mt-1.5 space-y-0.5 text-xs text-gray-500">
            {store.representativeName && (
              <div>대표자: <b className="text-gray-700">{store.representativeName}</b> {store.representativePhone && `· ${store.representativePhone}`}</div>
            )}
            {store.phone && <div>매장 전화: {store.phone}</div>}
            {store.address && <div className="truncate">{store.address}</div>}
            {store.createdAt && <div>신청일: {formatDate(store.createdAt.toDate())}</div>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 flex-shrink-0">
          {store.status === 'pending' && (
            <>
              <button onClick={onApprove} className="text-[10px] font-bold bg-green-600 text-white rounded-lg px-3 py-1.5 hover:bg-green-700 whitespace-nowrap">
                승인
              </button>
              <button onClick={onReject} className="text-[10px] font-bold bg-white border border-red-200 text-red-600 rounded-lg px-3 py-1.5 hover:bg-red-50 whitespace-nowrap">
                반려
              </button>
            </>
          )}
          {store.status === 'active' && (
            <button onClick={onSuspend} className="text-[10px] font-bold bg-gray-200 text-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-300 whitespace-nowrap">
              정지
            </button>
          )}
          {(store.status === 'suspended' || store.status === 'rejected') && (
            <button onClick={onReactivate} className="text-[10px] font-bold bg-green-600 text-white rounded-lg px-3 py-1.5 hover:bg-green-700 whitespace-nowrap">
              재개
            </button>
          )}
          <a
            href={`/admin/${store.id}`}
            target="_blank"
            rel="noopener"
            className="text-[10px] font-bold border border-gray-200 text-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-50 whitespace-nowrap text-center"
          >
            어드민 ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function OrganizerCard({
  org,
  onApprove,
  onReject,
  onSuspend,
  onReactivate,
}: {
  org: OrganizerRow;
  onApprove: () => void;
  onReject: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
}) {
  const displayName = org.companyName ?? org.name ?? '(이름 없음)';
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-bold text-gray-900">{displayName}</div>
            <StatusBadge status={org.status ?? 'pending'} type="org" />
          </div>
          <div className="mt-1.5 space-y-0.5 text-xs text-gray-500">
            {org.representativeName && <div>대표자: <b className="text-gray-700">{org.representativeName}</b></div>}
            {org.contactPerson?.name && (
              <div>담당자: {org.contactPerson.name} {org.contactPerson.phone && `· ${org.contactPerson.phone}`}</div>
            )}
            {org.createdAt && <div>신청일: {formatDate(org.createdAt.toDate())}</div>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 flex-shrink-0">
          {org.status === 'pending' && (
            <>
              <button onClick={onApprove} className="text-[10px] font-bold bg-green-600 text-white rounded-lg px-3 py-1.5 hover:bg-green-700 whitespace-nowrap">
                승인
              </button>
              <button onClick={onReject} className="text-[10px] font-bold bg-white border border-red-200 text-red-600 rounded-lg px-3 py-1.5 hover:bg-red-50 whitespace-nowrap">
                반려
              </button>
            </>
          )}
          {org.status === 'active' && (
            <button onClick={onSuspend} className="text-[10px] font-bold bg-gray-200 text-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-300 whitespace-nowrap">
              정지
            </button>
          )}
          {(org.status === 'suspended' || org.status === 'rejected') && (
            <button onClick={onReactivate} className="text-[10px] font-bold bg-green-600 text-white rounded-lg px-3 py-1.5 hover:bg-green-700 whitespace-nowrap">
              재개
            </button>
          )}
          <a
            href={`/organizer/${org.id}`}
            target="_blank"
            rel="noopener"
            className="text-[10px] font-bold border border-gray-200 text-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-50 whitespace-nowrap text-center"
          >
            어드민 ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  type,
}: {
  status: string;
  type: 'store' | 'org' | 'user';
}) {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    active: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    suspended: 'bg-gray-200 text-gray-600',
    paused: 'bg-gray-200 text-gray-600',
    closed: 'bg-red-100 text-red-700',
  };
  const labels: Record<string, string> = {
    pending: '심사 대기',
    active: '활성',
    rejected: '반려',
    suspended: '정지',
    paused: '중단',
    closed: '종료',
  };
  return (
    <span className={`text-[10px] font-extrabold rounded px-2 py-0.5 ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[status] ?? status}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const styles: Record<string, string> = {
    google: 'bg-blue-50 text-blue-700',
    kakao: 'bg-yellow-100 text-yellow-800',
    password: 'bg-gray-100 text-gray-700',
  };
  const labels: Record<string, string> = {
    google: 'Google',
    kakao: '카카오',
    password: '이메일',
  };
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${styles[provider] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[provider] ?? provider}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-10 text-center text-sm text-gray-500">
      {label}
    </div>
  );
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
