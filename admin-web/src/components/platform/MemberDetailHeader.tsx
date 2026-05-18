'use client';

/**
 * MemberDetailHeader — 회원 상세 페이지 상단 헤더
 * 아바타, 이름, 상태 배지, 상단 액션 버튼(뒤로, 비번 재설정, 상태 변경)
 */

import { useRouter } from 'next/navigation';

export type MemberStatus = 'active' | 'pending' | 'suspended' | 'rejected';

interface MemberDetailHeaderProps {
  name: string;
  email?: string;
  status: MemberStatus;
  type: 'user' | 'store' | 'organizer';
  providers?: string[];
  onStatusChange?: (newStatus: MemberStatus) => Promise<void>;
  onSendPasswordReset?: () => Promise<void>;
  isEmailProvider?: boolean;
}

const STATUS_LABEL: Record<MemberStatus, string> = {
  active: '활성',
  pending: '심사 대기',
  suspended: '정지',
  rejected: '반려',
};

const STATUS_CLASS: Record<MemberStatus, string> = {
  active: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  suspended: 'bg-gray-200 text-gray-600',
  rejected: 'bg-red-100 text-red-700',
};

function AvatarCircle({ name }: { name: string }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <div
      className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-extrabold text-white flex-shrink-0"
      style={{ background: '#FF1F8F' }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

export default function MemberDetailHeader({
  name,
  email,
  status,
  type,
  providers = [],
  onStatusChange,
  onSendPasswordReset,
  isEmailProvider = false,
}: MemberDetailHeaderProps) {
  const router = useRouter();

  const handleStatusToggle = async () => {
    if (!onStatusChange) return;
    const newStatus: MemberStatus = status === 'active' ? 'suspended' : 'active';
    const label = newStatus === 'suspended' ? '정지' : '활성 복구';
    if (!window.confirm(`이 ${type === 'user' ? '사용자' : type === 'store' ? '매장' : '대회사'}를 ${label}하시겠습니까?`)) return;
    await onStatusChange(newStatus);
  };

  const handleApprove = async () => {
    if (!onStatusChange) return;
    if (!window.confirm('승인하시겠습니까?')) return;
    await onStatusChange('active');
  };

  const handleReject = async () => {
    if (!onStatusChange) return;
    if (!window.confirm('반려하시겠습니까?')) return;
    await onStatusChange('rejected');
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-5">
      {/* 뒤로가기 */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4 transition-colors"
        aria-label="뒤로가기"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
        회원 목록
      </button>

      <div className="flex items-start gap-4">
        <AvatarCircle name={name || '?'} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-xl font-extrabold text-gray-900 truncate">{name}</h1>
            <span className={`text-[11px] font-extrabold rounded px-2 py-0.5 ${STATUS_CLASS[status]}`}>
              {STATUS_LABEL[status]}
            </span>
          </div>
          {email && (
            <div className="text-sm text-gray-500 font-mono truncate mb-2">{email}</div>
          )}
          {providers.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {providers.map((p) => (
                <ProviderBadge key={p} provider={p} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 액션 버튼 영역 */}
      <div className="flex gap-2 flex-wrap mt-4 pt-4 border-t border-gray-100">
        {/* 비밀번호 재설정 — email provider만 */}
        {isEmailProvider && onSendPasswordReset && (
          <button
            onClick={onSendPasswordReset}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 transition"
          >
            비밀번호 재설정 메일 발송
          </button>
        )}

        {/* pending → 승인/반려 */}
        {status === 'pending' && type !== 'user' && (
          <>
            <button
              onClick={handleApprove}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-green-600 text-white hover:bg-green-700 transition"
            >
              승인
            </button>
            <button
              onClick={handleReject}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 transition"
            >
              반려
            </button>
          </>
        )}

        {/* active ↔ suspended */}
        {(status === 'active' || status === 'suspended') && onStatusChange && (
          <button
            onClick={handleStatusToggle}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition ${
              status === 'active'
                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {status === 'active' ? '정지' : '활성 복구'}
          </button>
        )}
      </div>
    </div>
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
