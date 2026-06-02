'use client';

/**
 * /platform/members/user/[uid] — 일반 사용자 상세
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

// =====================================================================
// 타입
// =====================================================================

interface UserDetail {
  uid: string;
  email?: string;
  username?: string;
  loginId?: string;
  displayName?: string;
  realName?: string;
  nickname?: string;
  phone?: string;
  providers?: string[];
  signupSource?: string;
  signupAt?: { toDate: () => Date } | null;
  createdAt?: { toDate: () => Date } | null;
  lastLoginAt?: { toDate: () => Date } | null;
  status?: MemberStatus;
  role?: string;
  roles?: string[];
  passwordHint?: string;
  recoveryLast4?: string;
  kycCompletedAt?: { toDate: () => Date } | null;
  kycSource?: string;
  agreeMarketing?: boolean;
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

// =====================================================================
// 메인
// =====================================================================

export default function UserDetailPage() {
  const params = useParams<{ uid: string }>();
  const uid = params?.uid ?? '';

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!uid) return;
    getDoc(doc(db, 'users', uid)).then((snap) => {
      if (snap.exists()) {
        setUser({ uid, ...snap.data() } as UserDetail);
      }
      setLoading(false);
    });
  }, [uid]);

  const handleStatusChange = async (newStatus: MemberStatus) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', uid), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      await logAdminAction({
        action: 'change_status',
        target: { type: 'user', id: uid },
        metadata: { from: user.status, to: newStatus },
      });
      setUser((u) => u ? { ...u, status: newStatus } : u);
      showToast(`상태가 "${newStatus}"로 변경되었습니다.`);
    } catch {
      showToast('상태 변경에 실패했습니다.', 'error');
    }
  };

  const handleSendPasswordReset = async () => {
    if (!user?.email) return;
    try {
      await sendPasswordReset(user.email);
      await logAdminAction({
        action: 'send_password_reset',
        target: { type: 'user', id: uid },
        metadata: { email: user.email },
      });
      showToast('비밀번호 재설정 메일을 발송했습니다.');
    } catch {
      showToast('메일 발송에 실패했습니다.', 'error');
    }
  };

  const handleRoleToggle = async () => {
    if (!user) return;
    const currentRoles = user.roles ?? [];
    const isPlatformAdmin = currentRoles.includes('platform_admin');
    const newRoles = isPlatformAdmin
      ? currentRoles.filter((r) => r !== 'platform_admin')
      : [...currentRoles, 'platform_admin'];
    const action = isPlatformAdmin ? '해제' : '부여';
    if (!window.confirm(`platform_admin 권한을 ${action}하시겠습니까? 이 작업은 민감한 권한 변경입니다.`)) return;
    try {
      await updateDoc(doc(db, 'users', uid), {
        roles: newRoles,
        role: newRoles[newRoles.length - 1] ?? 'player',
        updatedAt: serverTimestamp(),
      });
      await logAdminAction({
        action: 'change_role',
        target: { type: 'user', id: uid },
        metadata: { from: currentRoles, to: newRoles },
      });
      setUser((u) => u ? { ...u, roles: newRoles } : u);
      showToast(`platform_admin 권한을 ${action}했습니다.`);
    } catch {
      showToast('권한 변경에 실패했습니다.', 'error');
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500 p-8">로딩 중…</div>;
  }
  if (!user) {
    return <div className="text-sm text-red-500 p-8">사용자를 찾을 수 없습니다.</div>;
  }

  const isEmailProvider = (user.providers ?? []).includes('password');
  const isPlatformAdmin = (user.roles ?? []).includes('platform_admin');

  return (
    <div className="max-w-5xl">
      {/* 토스트 */}
      {toast && (
        <div
          role="alert"
          className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl text-sm font-bold text-white shadow-lg transition ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <MemberDetailHeader
        name={user.displayName ?? user.realName ?? user.nickname ?? '(이름 없음)'}
        email={user.email}
        status={user.status ?? 'active'}
        type="user"
        providers={user.providers}
        onStatusChange={handleStatusChange}
        onSendPasswordReset={isEmailProvider ? handleSendPasswordReset : undefined}
        isEmailProvider={isEmailProvider}
      />

      {/* 데스크탑: 2컬럼 / 모바일: 단일 컬럼 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 좌측 메인 */}
        <div className="lg:col-span-2 space-y-5">
          {/* 계정 정보 카드 */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-gray-900 mb-3">계정 정보</h3>
            <div className="space-y-2.5">
              {(user.loginId ?? user.username) && (
                <InfoRow label="로그인 아이디" value={user.loginId ?? user.username} />
              )}
              <InfoRow label="이메일" value={user.email} />
              <InfoRow label="실명" value={user.realName} />
              <InfoRow label="닉네임" value={user.nickname ?? user.displayName} />
              <InfoRow label="휴대폰" value={user.phone} />
              <InfoRow label="가입 경로" value={user.signupSource} />
              <InfoRow label="가입일시" value={fmtDate(user.signupAt ?? user.createdAt)} />
              {user.kycCompletedAt && (
                <InfoRow label="KYC 완료" value={fmtDate(user.kycCompletedAt)} />
              )}
              {user.kycSource && (
                <InfoRow label="KYC 방법" value={user.kycSource} />
              )}
            </div>
          </div>

          {/* 본인 확인 카드 — email provider만 */}
          {isEmailProvider && (
            <IdentityVerificationCard
              email={user.email ?? ''}
              loginId={user.loginId ?? user.username ?? user.email}
              passwordHint={user.passwordHint}
              recoveryLast4={user.recoveryLast4}
              onSendPasswordReset={handleSendPasswordReset}
              targetUid={uid}
            />
          )}

          {/* 약관 동의 */}
          <ConsentSummaryCard
            consent={{
              agreeService: true, // OAuth 사용자는 가입 시 동의로 간주
              agreePrivacy: true,
              agreeMarketing: user.agreeMarketing,
              submittedAt: fmtDate(user.signupAt ?? user.createdAt),
            }}
          />
        </div>

        {/* 우측 사이드 */}
        <div className="space-y-5">
          {/* 통계 */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-gray-900 mb-3">활동 통계</h3>
            <StatRow label="현재 role" value={(user.roles ?? [user.role ?? 'player']).join(', ')} />
          </div>

          {/* 위험 액션 */}
          <div className="bg-white border border-red-100 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-red-700 mb-3">관리자 전용 액션</h3>
            <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
              아래 액션은 되돌리기 어렵습니다. 신중하게 실행하세요.
            </p>
            <button
              onClick={handleRoleToggle}
              className="w-full py-2.5 rounded-xl text-xs font-bold bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition"
            >
              {isPlatformAdmin
                ? 'platform_admin 권한 해제'
                : 'platform_admin 권한 부여'}
            </button>
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
