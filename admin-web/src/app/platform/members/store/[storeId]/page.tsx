'use client';

/**
 * /platform/members/store/[storeId] — 매장 사장 상세
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sendPasswordReset } from '@/lib/emailAuth';
import { logAdminAction } from '@/lib/auditLog';
import MemberDetailHeader, { type MemberStatus } from '@/components/platform/MemberDetailHeader';
import IdentityVerificationCard from '@/components/platform/IdentityVerificationCard';
import ConsentSummaryCard from '@/components/platform/ConsentSummaryCard';
import StoreInfoCard from '@/components/platform/StoreInfoCard';

// =====================================================================
// 타입
// =====================================================================

type StoreStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'paused' | 'closed';

interface StoreDetail {
  id: string;
  ownerUid?: string;
  name?: string;
  address?: string;
  phone?: string;
  hours?: string;
  description?: string;
  signageImageUrl?: string;
  representativeName?: string;
  representativePhone?: string;
  businessRegistrationNumber?: string;
  status?: StoreStatus;
  createdAt?: { toDate: () => Date } | null;
  signupApplication?: {
    submittedAt?: string;
    agreeService?: boolean;
    agreePrivacy?: boolean;
    agreeMarketing?: boolean;
  };
}

interface OwnerUser {
  email?: string;
  displayName?: string;
  realName?: string;
  providers?: string[];
  passwordHint?: string;
  recoveryLast4?: string;
  signupAt?: { toDate: () => Date } | null;
  createdAt?: { toDate: () => Date } | null;
  kycCompletedAt?: { toDate: () => Date } | null;
  kycSource?: string;
}

function fmtDate(ts?: { toDate: () => Date } | null): string {
  if (!ts) return '-';
  try {
    const d = ts.toDate();
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '-';
  }
}

function toMemberStatus(s?: StoreStatus): MemberStatus {
  if (s === 'active') return 'active';
  if (s === 'pending') return 'pending';
  if (s === 'suspended') return 'suspended';
  if (s === 'rejected') return 'rejected';
  return 'active';
}

// =====================================================================
// 메인
// =====================================================================

export default function StoreDetailPage() {
  const params = useParams<{ storeId: string }>();
  const storeId = params?.storeId ?? '';

  const [store, setStore] = useState<StoreDetail | null>(null);
  const [owner, setOwner] = useState<OwnerUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!storeId) return;
    (async () => {
      const snap = await getDoc(doc(db, 'stores', storeId));
      if (snap.exists()) {
        const data = { id: storeId, ...snap.data() } as StoreDetail;
        setStore(data);
        // owner 정보 fetch
        if (data.ownerUid) {
          const ownerSnap = await getDoc(doc(db, 'users', data.ownerUid));
          if (ownerSnap.exists()) setOwner(ownerSnap.data() as OwnerUser);
        }
      }
      setLoading(false);
    })();
  }, [storeId]);

  const handleStatusChange = async (newStatus: MemberStatus) => {
    if (!store) return;
    try {
      await updateDoc(doc(db, 'stores', storeId), {
        status: newStatus,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAdminAction({
        action: 'change_status',
        target: { type: 'store', id: storeId },
        metadata: { from: store.status, to: newStatus },
      });
      setStore((s) => s ? { ...s, status: newStatus as StoreStatus } : s);
      showToast(`매장 상태가 "${newStatus}"로 변경되었습니다.`);
    } catch {
      showToast('상태 변경에 실패했습니다.', 'error');
    }
  };

  const handleSendPasswordReset = async () => {
    if (!owner?.email) return;
    try {
      await sendPasswordReset(owner.email);
      await logAdminAction({
        action: 'send_password_reset',
        target: { type: 'store', id: storeId },
        metadata: { email: owner.email },
      });
      showToast('비밀번호 재설정 메일을 발송했습니다.');
    } catch {
      showToast('메일 발송에 실패했습니다.', 'error');
    }
  };

  if (loading) return <div className="text-sm text-gray-500 p-8">로딩 중…</div>;
  if (!store) return <div className="text-sm text-red-500 p-8">매장을 찾을 수 없습니다.</div>;

  const isEmailProvider = (owner?.providers ?? []).includes('password');
  const currentStatus = toMemberStatus(store.status);

  return (
    <div className="max-w-5xl">
      {toast && (
        <div
          role="alert"
          className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl text-sm font-bold text-white shadow-lg ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <MemberDetailHeader
        name={store.name ?? '(매장명 없음)'}
        email={owner?.email}
        status={currentStatus}
        type="store"
        providers={owner?.providers}
        onStatusChange={handleStatusChange}
        onSendPasswordReset={isEmailProvider ? handleSendPasswordReset : undefined}
        isEmailProvider={isEmailProvider}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 좌측 메인 */}
        <div className="lg:col-span-2 space-y-5">
          {/* 계정 정보 */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-gray-900 mb-3">계정 정보</h3>
            <div className="space-y-2.5">
              <InfoRow label="이메일" value={owner?.email} />
              <InfoRow label="대표자명" value={owner?.realName ?? store.representativeName} />
              <InfoRow label="KYC 완료" value={owner?.kycCompletedAt ? fmtDate(owner.kycCompletedAt) : undefined} />
              <InfoRow label="KYC 방법" value={owner?.kycSource} />
              <InfoRow label="가입일시" value={fmtDate(store.createdAt)} />
            </div>
          </div>

          {/* 매장 상세 정보 */}
          <StoreInfoCard
            name={store.name}
            address={store.address}
            hours={store.hours}
            phone={store.phone}
            description={store.description}
            signageImageUrl={store.signageImageUrl}
            representativeName={store.representativeName}
            representativePhone={store.representativePhone}
            businessRegistrationNumber={store.businessRegistrationNumber}
            signupApplication={store.signupApplication}
          />

          {/* 본인 확인 카드 */}
          {isEmailProvider && (
            <IdentityVerificationCard
              email={owner?.email ?? ''}
              passwordHint={owner?.passwordHint}
              recoveryLast4={owner?.recoveryLast4}
              onSendPasswordReset={handleSendPasswordReset}
            />
          )}

          {/* 약관 동의 */}
          <ConsentSummaryCard
            consent={{
              agreeService: store.signupApplication?.agreeService,
              agreePrivacy: store.signupApplication?.agreePrivacy,
              agreeMarketing: store.signupApplication?.agreeMarketing,
              submittedAt: store.signupApplication?.submittedAt,
            }}
          />
        </div>

        {/* 우측 사이드 */}
        <div className="space-y-5">
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-gray-900 mb-3">매장 통계</h3>
            <StatRow label="현재 상태" value={store.status ?? '-'} />
            <div className="pt-3 mt-3 border-t border-gray-100">
              <a
                href={`/admin/${storeId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-2.5 text-center rounded-xl text-xs font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
              >
                매장 어드민으로 이동 ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-[11px] font-bold text-gray-500 flex-shrink-0 w-20 pt-0.5">{label}</span>
      <span className="text-gray-800 flex-1">{value ?? <span className="text-gray-400">-</span>}</span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-[12px] text-gray-600">{label}</span>
      <span className="text-[12px] font-bold text-gray-900">{value}</span>
    </div>
  );
}
