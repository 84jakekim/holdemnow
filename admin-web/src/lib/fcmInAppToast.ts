'use client';

/**
 * fcmInAppToast
 *
 * 포그라운드 FCM 메시지 중 type='reservation_confirmed'를 수신해
 * 전역 CustomEvent로 토스트를 트리거한다.
 *
 * 사용법:
 *   - InAppToast 컴포넌트가 window 이벤트를 listen.
 *   - useFcmInAppListener() 훅에서 onForegroundMessage 등록.
 */

export const IN_APP_TOAST_EVENT = 'holdem:inapp_toast';

export interface InAppToastPayload {
  type: 'reservation_confirmed';
  storeName: string;
  time: string;
  deepLink: string;
}

export function emitInAppToast(payload: InAppToastPayload) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IN_APP_TOAST_EVENT, { detail: payload }));
}
