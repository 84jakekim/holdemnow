'use client';

/**
 * StoreApprovalGate — 승인되지 않은 매장 owner의 어드민 접속 차단 게이트
 *
 * 정책 (2026-06, 사용자 요구):
 *   "실제로 승인되지 않은 매장은 접속이 불가하도록" — pending/rejected/suspended 상태의
 *   매장 owner가 /admin/{storeId}에 들어오면 어드민 기능 대신 상태 안내 전체화면을 띄운다.
 *   (이전엔 pending도 둘러보기 허용했으나, 불법 사설업체 차단 정책상 하드 게이트로 강화)
 *
 *   platform_admin(본사)은 심사를 위해 게이트를 우회한다 — 호출부(admin/[storeId]/page.tsx)에서
 *   isOwner && !isPlatformAdmin 일 때만 이 컴포넌트를 렌더한다.
 *
 * 상태별 화면:
 *   - pending  : ⏳ 심사 대기 중 (영업일 1~3일 안내)
 *   - rejected : ⛔ 반려됨 + 사유 표시 + 재신청 안내
 *   - suspended: 🚫 운영 정지 + 문의 안내
 */

import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

type GateStatus = 'pending' | 'rejected' | 'suspended' | 'paused' | 'closed';

interface Props {
  storeName?: string;
  status: GateStatus;
  rejectionReason?: string;
}

const CONFIG: Record<GateStatus, {
  emoji: string;
  title: string;
  tone: string;
  bg: string;
  border: string;
  desc: string;
}> = {
  pending: {
    emoji: '⏳',
    title: '매장 심사 대기 중',
    tone: '#B45309',
    bg: '#FFFBEB',
    border: '#FDE68A',
    desc: '본사에서 가입 신청을 심사하고 있습니다. 영업일 기준 1~3일 내에 승인 여부를 안내드립니다. 승인되면 이 페이지에서 바로 매장을 운영하실 수 있습니다.',
  },
  rejected: {
    emoji: '⛔',
    title: '가입이 반려되었습니다',
    tone: '#B91C1C',
    bg: '#FEF2F2',
    border: '#FECACA',
    desc: '아래 사유를 확인하신 뒤 보완하여 다시 신청해 주세요.',
  },
  suspended: {
    emoji: '🚫',
    title: '매장 운영이 정지되었습니다',
    tone: '#374151',
    bg: '#F9FAFB',
    border: '#E5E7EB',
    desc: '본사 정책에 따라 매장 운영이 정지되었습니다. 자세한 사항은 본사로 문의해 주세요.',
  },
  paused: {
    emoji: '⏸️',
    title: '매장 운영이 일시 중단되었습니다',
    tone: '#374151',
    bg: '#F9FAFB',
    border: '#E5E7EB',
    desc: '매장 운영이 일시 중단된 상태입니다. 재개를 원하시면 본사로 문의해 주세요.',
  },
  closed: {
    emoji: '📕',
    title: '종료된 매장입니다',
    tone: '#B91C1C',
    bg: '#FEF2F2',
    border: '#FECACA',
    desc: '종료 처리된 매장입니다. 다시 운영을 원하시면 본사로 문의해 주세요.',
  },
};

export default function StoreApprovalGate({ storeName, status, rejectionReason }: Props) {
  const router = useRouter();
  const c = CONFIG[status] ?? CONFIG.pending;

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } finally {
      router.replace('/login/business');
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#F3F4F6' }}>
      <div
        className="rounded-2xl w-full max-w-md p-8 text-center bg-white"
        style={{ border: '1px solid #E5E7EB', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl"
          style={{ background: c.bg, border: `1px solid ${c.border}` }}
        >
          {c.emoji}
        </div>

        {storeName && (
          <div className="text-xs font-bold mb-1" style={{ color: '#9CA3AF' }}>
            {storeName}
          </div>
        )}
        <div className="text-xl font-extrabold mb-2" style={{ color: c.tone }}>
          {c.title}
        </div>
        <p className="text-sm leading-relaxed mb-5" style={{ color: '#6B7280' }}>
          {c.desc}
        </p>

        {status === 'rejected' && rejectionReason && (
          <div
            className="rounded-xl p-4 text-left text-xs leading-relaxed mb-5"
            style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.tone }}
          >
            <div className="font-bold mb-1">반려 사유</div>
            {rejectionReason}
          </div>
        )}

        <div
          className="rounded-xl p-4 text-left text-[11px] leading-relaxed mb-6"
          style={{ background: '#F9FAFB', border: '1px solid #F3F4F6', color: '#6B7280' }}
        >
          <div className="font-bold mb-1" style={{ color: '#374151' }}>문의</div>
          카카오톡 채널 <b>Pink Rabbit</b> 또는 이메일 <b>admin@holdemnow.com</b>
        </div>

        <button
          onClick={handleLogout}
          className="block w-full py-3.5 rounded-xl font-bold text-sm text-white text-center"
          style={{ background: '#FF1F8F' }}
        >
          로그아웃
        </button>
      </div>
    </main>
  );
}
