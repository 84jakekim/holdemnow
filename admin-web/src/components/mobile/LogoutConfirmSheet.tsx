'use client';

/**
 * LogoutConfirmSheet — 바텀시트 로그아웃 확인
 *
 * "로그아웃" 클릭 → signOut(auth) 호출 → sheet 닫기.
 * AuthGate가 anonymous 감지 → /login으로 자동 redirect.
 * 이 컴포넌트 안에서 router.replace 불필요.
 */

import { useEffect, useRef } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { disableCurrentDeviceNotifications } from '@/lib/messaging';

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function LogoutConfirmSheet({ open, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // 오픈 시 스크롤 잠금
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const handleLogout = async () => {
    onClose();
    // 1. 디바이스 FCM 토큰을 현재 uid에서 제거 — 다른 사용자가 같은 디바이스에 로그인했을 때
    //    옛 사용자에게 잘못된 알림이 가는 cross-user 토큰 잔존 차단.
    const uid = auth.currentUser?.uid;
    if (uid) {
      await disableCurrentDeviceNotifications(uid).catch(() => {});
    }
    // 2. signOut → AuthGate가 anonymous 감지 후 /login replace
    await signOut(auth);
  };

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="로그아웃 확인"
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl px-5 pt-5 pb-8"
        style={{
          paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))',
          animation: 'slideUp 0.22s ease-out',
        }}
      >
        {/* 핸들 바 */}
        <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" aria-hidden="true" />

        <p className="text-[17px] font-extrabold text-gray-900 text-center mb-1.5">
          로그아웃 하시겠어요?
        </p>
        <p className="text-[13px] text-gray-500 text-center mb-7">
          다시 로그인하면 언제든지 이용할 수 있어요.
        </p>

        <div className="space-y-2.5">
          <button
            onClick={handleLogout}
            className="w-full py-4 rounded-2xl font-extrabold text-[15px] text-white transition-opacity active:opacity-80"
            style={{ background: '#FF1F8F' }}
          >
            로그아웃
          </button>
          <button
            onClick={onClose}
            className="w-full py-4 rounded-2xl font-bold text-[15px] text-gray-700 transition-colors"
            style={{ background: '#f3f4f6' }}
          >
            취소
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
