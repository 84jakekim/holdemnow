'use client';

/**
 * InAppToast
 *
 * 포그라운드 FCM 예약 확정 알림을 화면 상단에 4초 표시.
 * /m/layout.tsx에 전역 마운트.
 *
 * - 핫핑크 배경 + 흰 텍스트
 * - 클릭 시 deepLink로 이동
 * - 4초 후 자동 사라짐
 * - 여러 토스트 큐 처리 (최신 하나만 표시, 이전 것 교체)
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks';
import { onForegroundMessage } from '@/lib/messaging';
import {
  IN_APP_TOAST_EVENT,
  emitInAppToast,
  type InAppToastPayload,
} from '@/lib/fcmInAppToast';

const TOAST_DURATION = 4000;

export default function InAppToast() {
  const authState = useAuth();
  const router = useRouter();
  const [toast, setToast] = useState<InAppToastPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // FCM 포그라운드 메시지 수신 등록 (인증 사용자만)
  useEffect(() => {
    if (authState.status !== 'authenticated') return;

    let unsubFn: (() => void) | null = null;

    onForegroundMessage((payload) => {
      const data = payload.data ?? {};
      if (data.type !== 'reservation_confirmed') return;

      const storeName = payload.notification?.title?.replace('예약 확정 ', '') ?? data.storeName ?? '매장';
      const body = payload.notification?.body ?? '';
      // body 파싱보다 data 필드 우선
      const time = data.time ?? extractTime(body);
      const deepLink = data.deepLink ?? `/m`;

      emitInAppToast({
        type: 'reservation_confirmed',
        storeName,
        time,
        deepLink,
      });
    }).then((unsub) => {
      unsubFn = unsub;
    });

    return () => {
      unsubFn?.();
    };
  }, [authState.status]);

  // 전역 CustomEvent 수신
  useEffect(() => {
    function handleToastEvent(e: Event) {
      const payload = (e as CustomEvent<InAppToastPayload>).detail;
      showToast(payload);
    }
    window.addEventListener(IN_APP_TOAST_EVENT, handleToastEvent);
    return () => window.removeEventListener(IN_APP_TOAST_EVENT, handleToastEvent);
  }, []);

  function showToast(payload: InAppToastPayload) {
    // 기존 타이머 초기화
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setToast(payload);
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, TOAST_DURATION);
  }

  function handleClick() {
    if (!toast) return;
    router.push(toast.deepLink);
    setToast(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  if (!toast) return null;

  return (
    <button
      onClick={handleClick}
      aria-live="polite"
      className="fixed top-0 left-1/2 z-[100] flex items-center gap-3 px-4 py-3 text-white shadow-lg w-full max-w-md"
      style={{
        transform: 'translateX(-50%)',
        background: 'linear-gradient(90deg, #FF1F8F, #E01077)',
        borderRadius: '0 0 16px 16px',
        animation: 'toast-slide-down 0.3s ease-out',
      }}
    >
      <span className="text-xl flex-shrink-0" aria-hidden>🎉</span>
      <div className="text-left flex-1 min-w-0">
        <div className="text-[13px] font-extrabold leading-tight truncate">
          예약 확정: {toast.storeName}
        </div>
        {toast.time && (
          <div className="text-[11px] opacity-90 mt-0.5 truncate">
            {toast.time} · 방문 시 입장 안내드립니다
          </div>
        )}
      </div>
      <span className="text-[11px] opacity-80 flex-shrink-0">보기 →</span>
      <style jsx>{`
        @keyframes toast-slide-down {
          from { transform: translateX(-50%) translateY(-100%); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
        }
      `}</style>
    </button>
  );
}

function extractTime(body: string): string {
  // "M/D HH:MM" 패턴 추출 시도
  const match = body.match(/\d+\/\d+ \d+:\d+/);
  return match ? match[0] : '';
}
