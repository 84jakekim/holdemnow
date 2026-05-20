'use client';

import {
  getMessaging,
  getToken,
  onMessage,
  isSupported,
  type MessagePayload,
} from 'firebase/messaging';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { app, db } from './firebase';

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '';

/** 브라우저가 FCM Web Push를 지원하는지 — iOS Safari 16.4+, Android Chrome 등 */
export async function isMessagingSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/** 현재 알림 권한 상태 */
export function getNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  return Notification.permission;
}

/**
 * 알림 권한 요청 + FCM 토큰 발급 + Firestore 저장.
 * 권한 거부/실패 시 null 반환.
 *
 * @param uid 로그인된 사용자 uid (토큰을 users/{uid}/fcmTokens/{tokenId}에 저장)
 */
export async function enableNotifications(uid: string): Promise<string | null> {
  if (!uid) return null;
  if (!VAPID_KEY) {
    console.warn('VAPID 키 미설정 — NEXT_PUBLIC_FIREBASE_VAPID_KEY 확인');
    return null;
  }
  if (!(await isMessagingSupported())) {
    console.warn('이 브라우저는 FCM Web Push 미지원');
    return null;
  }

  // 1. 권한 요청
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  // 2. Service Worker 등록 (Firebase가 알아서 /firebase-messaging-sw.js를 찾음)
  const messaging = getMessaging(app);

  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) return null;

    // 3. Firestore에 토큰 저장 — tokenId로 토큰 해시 prefix 사용 (멀티 디바이스 지원)
    const tokenId = token.slice(0, 16);
    await setDoc(
      doc(db, 'users', uid, 'fcmTokens', tokenId),
      {
        token,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return token;
  } catch (e) {
    console.warn('FCM 토큰 발급 실패', e);
    return null;
  }
}

/** 토큰 회수 (알림 끄기) — users/{uid}/fcmTokens/{tokenId} 삭제 */
export async function disableNotifications(uid: string, token: string): Promise<void> {
  const tokenId = token.slice(0, 16);
  try {
    await deleteDoc(doc(db, 'users', uid, 'fcmTokens', tokenId));
  } catch {
    // ignore
  }
}

/**
 * 로그아웃 시 호출 — 현재 디바이스의 FCM 토큰을 users/{uid}/fcmTokens에서 제거.
 * 동일 디바이스에 다른 사용자가 로그인하면 그 토큰이 옛 사용자에게 가던 잘못된 알림을 차단.
 */
export async function disableCurrentDeviceNotifications(uid: string): Promise<void> {
  if (!uid) return;
  if (!VAPID_KEY) return;
  if (!(await isMessagingSupported())) return;
  try {
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY }).catch(() => null);
    if (!token) return;
    const tokenId = token.slice(0, 16);
    await deleteDoc(doc(db, 'users', uid, 'fcmTokens', tokenId));
  } catch {
    // 토큰 없거나 권한 거부 — 무시
  }
}

/** 포그라운드 메시지 수신 콜백 등록 */
export async function onForegroundMessage(
  cb: (payload: MessagePayload) => void,
): Promise<(() => void) | null> {
  if (!(await isMessagingSupported())) return null;
  const messaging = getMessaging(app);
  return onMessage(messaging, cb);
}
