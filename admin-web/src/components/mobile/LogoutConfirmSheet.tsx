'use client';

/**
 * LogoutConfirmSheet — 로그아웃 확인 바텀시트
 *
 * 2026-05-25 일관성 정리:
 *  · BottomSheet 공통 컴포넌트(`@/components/ui/BottomSheet`) 위에 얹음.
 *  · 핸드코딩 `bg-white`/`#FF1F8F` → CSS 토큰(`var(--surface-1)`/`var(--brand)`)으로 교체.
 *  · 다크 모드 자동 분기 (어드민 다크에서도 자연스럽게 보임).
 *
 * 동작: "로그아웃" 클릭 → signOut(auth) → sheet 닫기.
 * AuthGate가 anonymous 감지 → /login replace.
 */

import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { disableCurrentDeviceNotifications } from '@/lib/messaging';
import BottomSheet from '@/components/ui/BottomSheet';

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function LogoutConfirmSheet({ open, onClose }: Props) {
  const handleLogout = async () => {
    onClose();
    // 디바이스 FCM 토큰을 현재 uid에서 제거 — 다른 사용자가 같은 디바이스 로그인 시
    // 옛 사용자에게 잘못된 알림 가는 cross-user 토큰 잔존 차단.
    const uid = auth.currentUser?.uid;
    if (uid) {
      await disableCurrentDeviceNotifications(uid).catch(() => {});
    }
    await signOut(auth);
  };

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="로그아웃 확인">
      <p className="text-[17px] font-extrabold text-[var(--text-1)] text-center mb-1.5">
        로그아웃 하시겠어요?
      </p>
      <p className="text-[13px] text-[var(--text-2)] text-center mb-6">
        다시 로그인하면 언제든지 이용할 수 있어요.
      </p>

      <div className="space-y-2.5">
        <button
          onClick={handleLogout}
          className="w-full py-4 rounded-2xl font-extrabold text-[15px] text-white transition-opacity active:opacity-80"
          style={{
            background: 'var(--brand)',
            boxShadow: 'var(--shadow-brand)',
          }}
        >
          로그아웃
        </button>
        <button
          onClick={onClose}
          className="w-full py-4 rounded-2xl font-bold text-[15px] text-[var(--text-1)] bg-[var(--surface-2)] transition-colors hover:bg-[var(--surface-3)]"
        >
          취소
        </button>
      </div>
    </BottomSheet>
  );
}
