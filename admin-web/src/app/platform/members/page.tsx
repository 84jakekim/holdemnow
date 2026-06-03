'use client';

/**
 * /platform/members — 본사 회원 통합 관리
 * Tab 1: 본사 어드민 | Tab 2: 일반 사용자 (OAuth) | Tab 3: 매장 가입자 | Tab 4: 대회사 가입자
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
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import MembersTabExportButton from '@/components/platform/MembersTabExportButton';
import PlayerCsActionCell from '@/components/platform/PlayerCsActionCell';
import ForceDeleteUserButton from '@/components/platform/ForceDeleteUserButton';
import BanlistPanel from '@/components/platform/BanlistPanel';
import { summarizeReview, type StoreApplicationData } from '@/lib/storeReview';
import {
  createPlatformAdmin,
  validateAdminUsername,
  validateAdminPassword,
} from '@/lib/platformAdmin';
import { FirebaseOptions } from 'firebase/app';

const FIREBASE_CONFIG_FOR_AUX: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// =====================================================================
// 타입
// =====================================================================

type Tab = 'admins' | 'players' | 'stores' | 'organizers' | 'banned';

interface PlayerRow {
  id: string;
  email?: string;
  displayName?: string;
  providers?: string[];
  signupSource?: string;
  status?: 'active' | 'suspended';
  createdAt?: { toDate: () => Date };
  roles?: string[];
  role?: string;
  storeId?: string;
  organizerId?: string;
}

interface AdminRow {
  id: string;
  email?: string;
  username?: string;
  loginId?: string;
  displayName?: string;
  providers?: string[];
  status?: 'active' | 'suspended';
  createdAt?: { toDate: () => Date };
  roles?: string[];
  role?: string;
  storeId?: string;
  organizerId?: string;
}

interface StoreRow extends StoreApplicationData {
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
  const tabParam = (searchParams.get('tab') ?? 'admins') as Tab;
  const [activeTab, setActiveTab] = useState<Tab>(tabParam);

  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [organizers, setOrganizers] = useState<OrganizerRow[]>([]);
  // uid → 로그인 아이디(이메일) 맵 — 매장/대회사 카드에 owner 이메일 노출용 (추가 구독 없이 users 스냅샷 재사용)
  const [ownerEmailByUid, setOwnerEmailByUid] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminModalOpen, setAdminModalOpen] = useState(false);

  // 기본필터 'all' — 과거 'pending'이 기본이라, 심사 대기 0건일 때 활성 매장이 110개여도
  // "해당 조건의 매장이 없습니다"로 빈 화면처럼 보이던 문제. 심사 대기 건수는 탭 배지 +
  // "심사 대기 (N)" 칩으로 이미 노출되므로 'all' 기본이 발견성 손실 없이 혼란만 제거한다.
  const [storeFilter, setStoreFilter] = useState<'all' | 'pending' | 'active' | 'rejected' | 'suspended'>('all');
  const [storeSearch, setStoreSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState<'all' | 'pending' | 'active' | 'rejected'>('all');
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

    // users 전체 — 클라이언트에서 admins / players 분리 (추가 구독 없음)
    const uq = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    unsubs.push(
      onSnapshot(
        uq,
        (snap) => {
          const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PlayerRow, 'id'>) }));

          // platform_admin 판별: roles 배열 또는 role 단일 필드
          const isPlatformAdmin = (u: PlayerRow) =>
            (Array.isArray(u.roles) && u.roles.includes('platform_admin')) ||
            u.role === 'platform_admin';

          setAdmins(all.filter(isPlatformAdmin) as AdminRow[]);

          // uid → email 맵 — 매장/대회사 owner 이메일 노출용
          const emailMap: Record<string, string> = {};
          for (const u of all) {
            if (u.email) emailMap[u.id] = u.email;
          }
          setOwnerEmailByUid(emailMap);

          // 일반 사용자 = 어드민·매장·대회사가 아닌 모든 계정 (명시 필드 기준).
          // 과거엔 providers/signupSource로 간접 추정해서 ① OAuth 가입 매장 사장이
          // 일반 탭에 섞이고 ② 이메일 가입 플레이어(player-signup)는 어느 탭에도
          // 안 보이는 버그가 있었다 (2026-06-04 수정).
          setPlayers(
            all.filter((u) => {
              if (isPlatformAdmin(u)) return false; // 어드민 탭에서 관리
              if (u.storeId || u.organizerId) return false; // 매장/대회사 탭에서 관리
              return true;
            }),
          );
          setLoading(false);
        },
        () => setLoading(false),
      ),
    );

    // 매장 — 회원관리는 "실제 가입 매장"만. 데모 매장(isDemo)은 가입자가 아니므로 제외
    // (데모 100개가 섞여 진짜 가입 매장이 묻히던 문제, 2026-06-04 수정).
    // 데모 매장 관리는 /platform/demo, 심사·전체 모니터링은 /platform/stores 담당.
    const sq = query(collection(db, 'stores'), orderBy('createdAt', 'desc'));
    unsubs.push(
      onSnapshot(
        sq,
        (snap) =>
          setStores(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<StoreRow, 'id'>) }))
              .filter((s) => !s.isDemo),
          ),
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

  // 본사 어드민 정지/복구
  const suspendAdmin = async (id: string) => {
    await updateDoc(doc(db, 'users', id), { status: 'suspended', updatedAt: serverTimestamp() });
  };
  const activateAdmin = async (id: string) => {
    await updateDoc(doc(db, 'users', id), { status: 'active', updatedAt: serverTimestamp() });
  };

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

  // 강제 탈퇴 성공 시 낙관적 행 제거 (서버에서 doc/Auth가 삭제되면 onSnapshot도 곧 따라옴)
  const handleUserDeleted = (id: string) => {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
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

  // 필터 + 검색
  // 매장 코드 = 사업자번호 / doc id (고유값) 도 검색 대상. 연락처·사업자번호는 하이픈 무시 숫자 매칭.
  const filteredStores = stores.filter((s) => {
    if (storeFilter !== 'all' && s.status !== storeFilter) return false;
    const q = storeSearch.trim().toLowerCase();
    if (!q) return true;
    const ownerEmail = s.ownerUid ? ownerEmailByUid[s.ownerUid] : undefined;
    const hay = [
      s.name, s.roadAddress, s.address, s.representativeName,
      s.businessRegistrationNumber, s.regionCode, ownerEmail, s.id,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (hay.includes(q)) return true;
    // 숫자만 입력(연락처·사업자번호 검색)이면 하이픈 제거 후 비교
    const qDigits = q.replace(/\D/g, '');
    if (qDigits.length >= 2) {
      const numHay = [s.phone, s.representativePhone, s.businessRegistrationNumber]
        .filter(Boolean)
        .join(' ')
        .replace(/\D/g, '');
      if (numHay.includes(qDigits)) return true;
    }
    return false;
  });

  const filteredOrgs = organizers.filter((o) => {
    if (orgFilter === 'all') return true;
    return o.status === orgFilter;
  });

  const filteredAdmins = admins.filter((a) => {
    const q = adminSearch.toLowerCase();
    if (!q) return true;
    return (
      (a.loginId ?? '').toLowerCase().includes(q) ||
      (a.username ?? '').toLowerCase().includes(q) ||
      (a.email ?? '').toLowerCase().includes(q) ||
      (a.displayName ?? '').toLowerCase().includes(q)
    );
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
        <div className="section-title" style={{ color: 'var(--gold)' }}>MEMBER MANAGEMENT</div>
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>👥 회원 관리</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>본사 어드민, 일반 사용자, 매장, 대회사 통합 관리</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1.5 mb-6 pb-0" style={{ borderBottom: '1px solid var(--border)' }}>
        {(
          [
            { id: 'admins' as Tab, label: '본사 어드민', count: admins.length, badge: 0 },
            { id: 'players' as Tab, label: '일반 사용자', count: players.length, badge: 0 },
            { id: 'stores' as Tab, label: '매장', badge: pendingStores, count: stores.length },
            { id: 'organizers' as Tab, label: '대회사', badge: pendingOrgs, count: organizers.length },
            { id: 'banned' as Tab, label: '🚫 차단 관리', badge: 0, count: undefined as number | undefined },
          ]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className="relative px-5 py-2.5 text-sm font-bold rounded-t-lg transition tap"
            style={
              activeTab === t.id
                ? { color: 'var(--gold)', borderBottom: '2px solid var(--gold)' }
                : { color: 'var(--text-3)', borderBottom: '2px solid transparent' }
            }
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-[10px] text-gray-400">({t.count})</span>}
            {t.badge > 0 ? (
              <span className="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] rounded-full text-[9px] font-extrabold flex items-center justify-center px-1 text-white" style={{ background: '#FF1F8F' }}>
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-gray-500">로딩 중…</div>}

      {/* ── Tab 1: 본사 어드민 ── */}
      {activeTab === 'admins' && !loading && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <input
              className="form-input max-w-xs"
              value={adminSearch}
              onChange={(e) => setAdminSearch(e.target.value)}
              placeholder="아이디 또는 이름 검색"
            />
            <span className="text-xs text-gray-500">{filteredAdmins.length}명</span>
            <button
              onClick={() => setAdminModalOpen(true)}
              className="ml-auto inline-flex items-center gap-1 px-3 h-9 rounded-lg text-[12px] font-extrabold text-white"
              style={{ background: 'linear-gradient(135deg, #FF1F8F 0%, #B91072 100%)' }}
            >
              + 본사 어드민 추가
            </button>
          </div>

          {filteredAdmins.length === 0 ? (
            <EmptyState label="본사 어드민 계정이 없습니다" />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 420 }}>
                <thead className="bg-gray-50 text-[10px] font-bold text-gray-500 tracking-wider">
                  <tr>
                    <th className="text-left p-3">어드민</th>
                    <th className="text-left p-3 hidden md:table-cell">로그인 방법</th>
                    <th className="text-left p-3 hidden md:table-cell">가입일</th>
                    <th className="text-left p-3">상태</th>
                    <th className="text-right p-3">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredAdmins.map((a) => (
                    <tr
                      key={a.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => router.push(`/platform/members/user/${a.id}`)}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-gray-900">{a.displayName ?? '(이름 없음)'}</span>
                          <RoleBadge user={a} />
                        </div>
                        <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                          {a.loginId ?? a.username ?? a.email ?? a.id.slice(0, 16) + '…'}
                        </div>
                        {a.storeId && (
                          <div className="text-[10px] text-gray-400 mt-0.5">매장도 운영 중</div>
                        )}
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <div className="flex gap-1 flex-wrap">
                          {(a.providers ?? []).map((pv) => (
                            <ProviderBadge key={pv} provider={pv} />
                          ))}
                          {(!a.providers || a.providers.length === 0) && (
                            <span className="text-[10px] text-gray-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 hidden md:table-cell text-[11px] text-gray-500">
                        {a.createdAt ? formatDate(a.createdAt.toDate()) : '-'}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={a.status ?? 'active'} type="user" />
                      </td>
                      <td className="p-3 text-right">
                        {a.status === 'suspended' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); activateAdmin(a.id); }}
                            className="text-[10px] font-bold bg-green-600 text-white rounded px-2 py-1 hover:bg-green-700"
                          >
                            복구
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); if (window.confirm('이 어드민 계정을 정지하시겠습니까?')) suspendAdmin(a.id); }}
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

      {/* ── Tab 2: 일반 사용자 ── */}
      {activeTab === 'players' && !loading && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <input
              className="form-input max-w-xs"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              placeholder="이메일 또는 이름 검색"
            />
            <span className="text-xs text-gray-500">{filteredPlayers.length}명</span>
            <div className="ml-auto">
              <MembersTabExportButton
                tab="players"
                users={filteredPlayers.map((p) => ({
                  uid: p.id,
                  email: p.email,
                  displayName: p.displayName,
                  providers: p.providers,
                  signupSource: p.signupSource,
                  status: p.status,
                  signupAt: p.createdAt,
                }))}
              />
            </div>
          </div>

          {filteredPlayers.length === 0 ? (
            <EmptyState label="일반 사용자가 없습니다" />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 420 }}>
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
                    <tr
                      key={p.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => router.push(`/platform/members/user/${p.id}`)}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-gray-900">{p.displayName ?? '(이름 없음)'}</span>
                          <RoleBadge user={p} />
                        </div>
                        <div className="text-[11px] text-gray-500 font-mono mt-0.5">{p.email ?? p.id.slice(0, 16) + '…'}</div>
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
                      <td className="p-3">
                        <div
                          className="flex items-center justify-end gap-1.5 flex-wrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <PlayerCsActionCell uid={p.id} email={p.email} providers={p.providers} />
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
                          {/* 강제 탈퇴 — platform_admin 행·자기 자신에는 노출하지 않음(파괴적·되돌릴 수 없음) */}
                          {!isRowPlatformAdmin(p) && p.id !== auth.currentUser?.uid && (
                            <ForceDeleteUserButton
                              uid={p.id}
                              email={p.email}
                              displayName={p.displayName}
                              onDeleted={handleUserDeleted}
                            />
                          )}
                        </div>
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
          {/* 검색 — 매장명·주소·대표자·연락처·사업자번호·매장코드 */}
          <div className="mb-3">
            <div className="relative max-w-md">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
              <input
                className="form-input w-full"
                style={{ paddingLeft: 34, paddingRight: 32 }}
                value={storeSearch}
                onChange={(e) => setStoreSearch(e.target.value)}
                placeholder="매장명·주소·대표자·연락처·사업자번호·매장코드 검색"
              />
              {storeSearch && (
                <button
                  onClick={() => setStoreSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs px-1"
                  aria-label="검색 지우기"
                >
                  ✕
                </button>
              )}
            </div>
            {storeSearch.trim() && (
              <div className="text-[11px] text-gray-500 mt-1.5">
                &lsquo;{storeSearch.trim()}&rsquo; 검색 결과 <b className="text-gray-700">{filteredStores.length}</b>곳
                {storeFilter !== 'all' && <span className="text-gray-400"> (현재 상태 필터 적용 중)</span>}
              </div>
            )}
          </div>

          <div className="flex gap-1.5 mb-4 flex-wrap items-center">
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
            <div className="ml-auto">
              <MembersTabExportButton
                tab="stores"
                stores={filteredStores.map((s) => ({
                  id: s.id,
                  ownerEmail: s.ownerEmail,
                  representativeName: s.representativeName,
                  representativePhone: s.representativePhone,
                  name: s.name,
                  address: s.address,
                  phone: s.phone,
                  status: s.status,
                  createdAt: s.createdAt,
                }))}
              />
            </div>
          </div>

          {filteredStores.length === 0 ? (
            <EmptyState label="해당 조건의 매장이 없습니다" />
          ) : (
            <div className="space-y-3">
              {filteredStores.map((s) => (
                <StoreCard
                  key={s.id}
                  store={s}
                  ownerEmail={s.ownerUid ? ownerEmailByUid[s.ownerUid] : undefined}
                  onApprove={() => approveStore(s.id)}
                  onReject={() => setRejectModal({ id: s.id, type: 'store', name: s.name })}
                  onSuspend={() => { if (window.confirm(`"${s.name}" 매장을 정지하시겠습니까?`)) suspendStore(s.id); }}
                  onReactivate={() => approveStore(s.id)}
                  onCardClick={() => router.push(`/platform/members/store/${s.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 3: 대회사 ── */}
      {activeTab === 'organizers' && !loading && (
        <div>
          <div className="flex gap-1.5 mb-4 flex-wrap items-center">
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
            <div className="ml-auto">
              <MembersTabExportButton
                tab="organizers"
                organizers={filteredOrgs.map((o) => ({
                  id: o.id,
                  companyName: o.companyName,
                  representativeName: o.representativeName,
                  contactPerson: o.contactPerson,
                  status: o.status,
                  createdAt: o.createdAt,
                }))}
              />
            </div>
          </div>

          {filteredOrgs.length === 0 ? (
            <EmptyState label="해당 조건의 대회사가 없습니다" />
          ) : (
            <div className="space-y-3">
              {filteredOrgs.map((o) => (
                <OrganizerCard
                  key={o.id}
                  org={o}
                  ownerEmail={o.ownerUid ? ownerEmailByUid[o.ownerUid] : undefined}
                  onApprove={() => approveOrg(o.id)}
                  onReject={() => setRejectModal({ id: o.id, type: 'organizer', name: o.companyName ?? o.name ?? o.id })}
                  onSuspend={() => { if (window.confirm(`"${o.companyName ?? o.name}" 대회사를 정지하시겠습니까?`)) suspendOrg(o.id); }}
                  onReactivate={() => approveOrg(o.id)}
                  onCardClick={() => router.push(`/platform/members/organizer/${o.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 5: 차단 관리 ── */}
      {activeTab === 'banned' && !loading && <BanlistPanel />}

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

      {adminModalOpen && (
        <CreatePlatformAdminModal
          onClose={() => setAdminModalOpen(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 본사 어드민 추가 모달 — 아이디/비밀번호/표시 이름 입력 폼.
 * Firebase Auth에는 합성 이메일(`{id}@admin.pinkrabbit.local`)로 등록.
 * ─────────────────────────────────────────────────────────────*/
function CreatePlatformAdminModal({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ username: string } | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const u = validateAdminUsername(username);
    if (!u.ok) { setError(u.error); return; }
    const p = validateAdminPassword(password);
    if (!p.ok) { setError(p.error); return; }
    if (password !== passwordConfirm) {
      setError('비밀번호 확인이 일치하지 않습니다');
      return;
    }
    setBusy(true);
    try {
      const result = await createPlatformAdmin({
        username,
        password,
        displayName: displayName || undefined,
        memo: memo || undefined,
        firebaseConfig: FIREBASE_CONFIG_FOR_AUX,
      });
      setDone({ username: result.username });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Firebase Auth 흔한 에러를 친절한 한글로 변환
      const friendly = /email-already-in-use/.test(msg)
        ? '이미 같은 아이디로 등록된 어드민이 있습니다'
        : /weak-password/.test(msg)
          ? '비밀번호 정책에 맞지 않습니다 (8자 이상 권장)'
          : msg;
      setError(friendly);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="text-lg font-extrabold text-gray-900">+ 본사 어드민 추가</div>
          <div className="text-[11px] text-gray-500 mt-1">
            아이디·비밀번호로 로그인하는 본사 관리자 계정을 만듭니다.
          </div>
        </div>

        {done ? (
          <div className="p-6">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm">
              <div className="font-bold text-emerald-800 mb-1">✅ 본사 어드민 계정 생성 완료</div>
              <div className="text-emerald-700 text-[13px]">
                아이디 <span className="font-mono font-bold">{done.username}</span> 으로 로그인 가능합니다.
                <br />로그인 페이지에서 동일 아이디·비밀번호로 접속하세요.
              </div>
            </div>
            <button
              onClick={onClose}
              className="mt-5 w-full py-3 rounded-xl text-white font-extrabold text-sm"
              style={{ background: '#111' }}
            >
              완료
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-3.5">
            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">아이디 *</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="예: admin01"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono"
                autoComplete="off"
              />
              <div className="text-[10.5px] text-gray-400 mt-1">
                영문 소문자·숫자·_·- 만 사용, 4~24자
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">비밀번호 *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8자 이상"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">비밀번호 확인 *</label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">표시 이름 (선택)</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="회원 목록·로그에 노출"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">메모 (선택)</label>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="예: 마케팅 담당, 운영팀 김OO"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={busy}
                className="flex-1 py-3 rounded-xl text-white font-extrabold text-sm disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #FF1F8F 0%, #B91072 100%)' }}
              >
                {busy ? '생성 중…' : '계정 생성'}
              </button>
            </div>
          </div>
        )}
      </div>
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
  ownerEmail,
  onApprove,
  onReject,
  onSuspend,
  onReactivate,
  onCardClick,
}: {
  store: StoreRow;
  ownerEmail?: string;
  onApprove: () => void;
  onReject: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onCardClick?: () => void;
}) {
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-gray-300 transition"
      onClick={onCardClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-bold text-gray-900">{store.name}</div>
            <StatusBadge status={store.status ?? 'pending'} type="store" />
            {store.isDemo && (
              <span className="text-[9px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-extrabold">DEMO</span>
            )}
            {store.status === 'pending' && !store.isDemo && <ReviewMetChip store={store} />}
          </div>
          <div className="mt-1.5 space-y-0.5 text-xs text-gray-500">
            {store.businessRegistrationNumber && (
              <div>매장코드(사업자번호): <b className="text-gray-700 font-mono">{store.businessRegistrationNumber}</b></div>
            )}
            {ownerEmail && (
              <div>로그인 아이디: <b className="text-gray-700 font-mono">{ownerEmail}</b></div>
            )}
            {store.representativeName && (
              <div>대표자: <b className="text-gray-700">{store.representativeName}</b> {store.representativePhone && `· ${store.representativePhone}`}</div>
            )}
            {store.phone && <div>매장 전화: {store.phone}</div>}
            {store.address && <div className="truncate">{store.address}</div>}
            {store.createdAt && <div>신청일: {formatDate(store.createdAt.toDate())}</div>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
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
            onClick={(e) => e.stopPropagation()}
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
  ownerEmail,
  onApprove,
  onReject,
  onSuspend,
  onReactivate,
  onCardClick,
}: {
  org: OrganizerRow;
  ownerEmail?: string;
  onApprove: () => void;
  onReject: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onCardClick?: () => void;
}) {
  const displayName = org.companyName ?? org.name ?? '(이름 없음)';
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-gray-300 transition"
      onClick={onCardClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-bold text-gray-900">{displayName}</div>
            <StatusBadge status={org.status ?? 'pending'} type="org" />
          </div>
          <div className="mt-1.5 space-y-0.5 text-xs text-gray-500">
            {ownerEmail && (
              <div>로그인 아이디: <b className="text-gray-700 font-mono">{ownerEmail}</b></div>
            )}
            {org.representativeName && <div>대표자: <b className="text-gray-700">{org.representativeName}</b></div>}
            {org.contactPerson?.name && (
              <div>담당자: {org.contactPerson.name} {org.contactPerson.phone && `· ${org.contactPerson.phone}`}</div>
            )}
            {org.createdAt && <div>신청일: {formatDate(org.createdAt.toDate())}</div>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
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
            onClick={(e) => e.stopPropagation()}
          >
            어드민 ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// platform_admin 판별 — 강제 탈퇴 버튼 가드 등에서 재사용
function isRowPlatformAdmin(user: { roles?: string[]; role?: string }): boolean {
  return (
    (Array.isArray(user.roles) && user.roles.includes('platform_admin')) ||
    user.role === 'platform_admin'
  );
}

// role 배지: platform_admin 우선, 그 다음 storeId/organizerId, 기본 일반
function RoleBadge({ user }: { user: { roles?: string[]; role?: string; storeId?: string; organizerId?: string } }) {
  const isPlatformAdmin =
    (Array.isArray(user.roles) && user.roles.includes('platform_admin')) ||
    user.role === 'platform_admin';

  if (isPlatformAdmin) {
    return (
      <span
        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
        style={{ background: '#EDE9FE', color: '#7C3AED' }}
      >
        본사 어드민
      </span>
    );
  }
  if (user.storeId) {
    return (
      <span
        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
        style={{ background: '#FFE4F3', color: '#FF1F8F' }}
      >
        매장
      </span>
    );
  }
  if (user.organizerId) {
    return (
      <span
        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
        style={{ background: '#DBEAFE', color: '#2563EB' }}
      >
        대회사
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: '#F3F4F6', color: '#6B7280' }}
    >
      일반
    </span>
  );
}

// 심사 충족 요약 칩 — pending 매장 카드에 "충족 N/M" 한눈 표시
function ReviewMetChip({ store }: { store: StoreApplicationData }) {
  const s = summarizeReview(store);
  const ok = s.canApprove;
  return (
    <span
      className="text-[9px] font-extrabold rounded px-1.5 py-0.5"
      style={ok ? { background: '#DCFCE7', color: '#15803D' } : { background: '#FEF3C7', color: '#B45309' }}
      title={ok ? '필수 항목 전부 충족 — 승인 가능' : `필수 미충족 ${s.unmetRequired.length}건`}
    >
      충족 {s.metCount}/{s.totalCount}
    </span>
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
