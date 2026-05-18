'use client';

/**
 * /platform/members/organizer/[organizerId] — 대회사 상세
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
import OrganizerInfoCard from '@/components/platform/OrganizerInfoCard';

// =====================================================================
// 타입
// =====================================================================

type OrgStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'paused';

interface OrgDetail {
  id: string;
  ownerUid?: string;
  companyName?: string;
  businessRegistrationNumber?: string;
  representativeName?: string;
  representativePhone?: string;
  companyAddress?: string;
  contactPerson?: {
    name?: string;
    position?: string;
    phone?: string;
    email?: string;
  };
  tournamentReferences?: string;
  status?: OrgStatus;
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

function toMemberStatus(s?: OrgStatus): MemberStatus {
  if (s === 'active') return 'active';
  if (s === 'pending') return 'pending';
  if (s === 'suspended') return 'suspended';
  if (s === 'rejected') return 'rejected';
  return 'active';
}

// =====================================================================
// 메인
// =====================================================================

export default function OrganizerDetailPage() {
  const params = useParams<{ organizerId: string }>();
  const organizerId = params?.organizerId ?? '';

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [owner, setOwner] = useState<OwnerUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!organizerId) return;
    (async () => {
      const snap = await getDoc(doc(db, 'organizers', organizerId));
      if (snap.exists()) {
        const data = { id: organizerId, ...snap.data() } as OrgDetail;
        setOrg(data);
        if (data.ownerUid) {
          const ownerSnap = await getDoc(doc(db, 'users', data.ownerUid));
          if (ownerSnap.exists()) setOwner(ownerSnap.data() as OwnerUser);
        }
      }
      setLoading(false);
    })();
  }, [organizerId]);

  const handleStatusChange = async (newStatus: MemberStatus) => {
    if (!org) return;
    try {
      await updateDoc(doc(db, 'organizers', organizerId), {
        status: newStatus,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAdminAction({
        action: 'change_status',
        target: { type: 'organizer', id: organizerId },
        metadata: { from: org.status, to: newStatus },
      });
      setOrg((o) => o ? { ...o, status: newStatus as OrgStatus } : o);
      showToast(`대회사 상태가 "${newStatus}"로 변경되었습니다.`);
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
        target: { type: 'organizer', id: organizerId },
        metadata: { email: owner.email },
      });
      showToast('비밀번호 재설정 메일을 발송했습니다.');
    } catch {
      showToast('메일 발송에 실패했습니다.', 'error');
    }
  };

  if (loading) return <div className="text-sm text-gray-500 p-8">로딩 중…</div>;
  if (!org) return <div className="text-sm text-red-500 p-8">대회사를 찾을 수 없습니다.</div>;

  const isEmailProvider = (owner?.providers ?? []).includes('password');
  const currentStatus = toMemberStatus(org.status);

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
        name={org.companyName ?? '(회사명 없음)'}
        email={owner?.email}
        status={currentStatus}
        type="organizer"
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
              <InfoRow label="대표자명" value={owner?.realName ?? org.representativeName} />
              <InfoRow label="KYC 완료" value={owner?.kycCompletedAt ? fmtDate(owner.kycCompletedAt) : undefined} />
              <InfoRow label="KYC 방법" value={owner?.kycSource} />
              <InfoRow label="신청일시" value={fmtDate(org.createdAt)} />
            </div>
          </div>

          {/* 대회사 상세 */}
          <OrganizerInfoCard
            companyName={org.companyName}
            businessRegistrationNumber={org.businessRegistrationNumber}
            representativeName={org.representativeName}
            representativePhone={org.representativePhone}
            companyAddress={org.companyAddress}
            contactPerson={org.contactPerson}
            tournamentReferences={org.tournamentReferences}
            signupApplication={org.signupApplication}
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
              agreeService: org.signupApplication?.agreeService,
              agreePrivacy: org.signupApplication?.agreePrivacy,
              agreeMarketing: org.signupApplication?.agreeMarketing,
              submittedAt: org.signupApplication?.submittedAt,
            }}
          />
        </div>

        {/* 우측 사이드 */}
        <div className="space-y-5">
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-gray-900 mb-3">대회사 통계</h3>
            <StatRow label="현재 상태" value={org.status ?? '-'} />
            <div className="pt-3 mt-3 border-t border-gray-100">
              <a
                href={`/organizer/${organizerId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-2.5 text-center rounded-xl text-xs font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
              >
                대회사 어드민으로 이동 ↗
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
