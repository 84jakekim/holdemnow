/**
 * 인앱 알림 (in-app notifications) 클라이언트 API.
 *
 * 데이터 경로:
 *   notifications/{uid}/items/{notifId}
 *
 * Cloud Function이 doc을 작성하고, 클라이언트는:
 *   - subscribeNotifications: 본인 알림 onSnapshot (limit 50)
 *   - subscribeUnreadCount: 안 읽음 카운트 onSnapshot
 *   - markAsRead(notifId): 단일 read=true
 *   - markAllAsRead(): 모두 read=true (batch)
 *   - deleteNotification(notifId): 사용자 수동 삭제
 *
 * 권한 (firestore.rules):
 *   - read: 본인만
 *   - update: 본인 + (read, readAt) 필드만
 *   - delete: 본인만
 *   - create: admin SDK only (클라이언트 금지)
 *
 * 만료(expiresAt) 처리:
 *   - 클라이언트는 expiresAt > now 필터로 자동 제외 (cron 미신설 — 가벼움 우선).
 *   - 향후 cron 추가 시 클라이언트 필터는 그대로 유지 가능.
 */

import {
  collection,
  doc,
  getDocs,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  deleteDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';

export type InAppNotificationType =
  | 'reservation_confirmed'
  | 'reservation_cancelled_by_store'
  | 'cancel_request_received'
  | 'cancel_request_declined'
  | 'reservation_reminder'
  | 'new_reservation'
  | 'tournament_start'
  | 'late_reg_imminent'
  | 'series_countdown'
  | 'favorite_live'
  | 'new_review'
  | 'marketing';

export interface InAppNotification {
  id: string;
  type: InAppNotificationType | string; // 향후 확장 대비
  title: string;
  body: string;
  linkPath?: string | null;
  payload?: Record<string, string | number | boolean | null> | null;
  read: boolean;
  readAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  expiresAt?: Timestamp | null;
}

function mapDoc(id: string, data: Record<string, unknown>): InAppNotification {
  return {
    id,
    type: (data.type as string) ?? 'marketing',
    title: (data.title as string) ?? '',
    body: (data.body as string) ?? '',
    linkPath: (data.linkPath as string | null | undefined) ?? null,
    payload: (data.payload as Record<string, string | number | boolean | null> | null | undefined) ?? null,
    read: Boolean(data.read),
    readAt: (data.readAt as Timestamp | null | undefined) ?? null,
    createdAt: (data.createdAt as Timestamp | null | undefined) ?? null,
    expiresAt: (data.expiresAt as Timestamp | null | undefined) ?? null,
  };
}

/**
 * 본인 알림 리스트 onSnapshot 구독.
 * - 최신순 (createdAt DESC)
 * - limit 50건 (페이지네이션 신규 추가 시 확장)
 * - expiresAt 만료 항목은 클라 측 필터로 제외
 */
export function subscribeNotifications(
  uid: string,
  callback: (items: InAppNotification[]) => void,
  options?: { limit?: number; onError?: (err: unknown) => void },
): Unsubscribe {
  const lim = options?.limit ?? 50;
  const col = collection(db, 'notifications', uid, 'items');
  const q = query(col, orderBy('createdAt', 'desc'), firestoreLimit(lim));
  return onSnapshot(
    q,
    (snap) => {
      const nowMs = Date.now();
      const items: InAppNotification[] = [];
      snap.forEach((d) => {
        const item = mapDoc(d.id, d.data() as Record<string, unknown>);
        if (item.expiresAt && item.expiresAt.toMillis() < nowMs) return;
        items.push(item);
      });
      callback(items);
    },
    (err) => {
      console.warn('[subscribeNotifications]', err);
      options?.onError?.(err);
    },
  );
}

/**
 * 안 읽음 카운트 onSnapshot — read==false 항목 수.
 * 종 버튼 dot/숫자에 사용.
 */
export function subscribeUnreadCount(
  uid: string,
  callback: (count: number) => void,
  options?: { onError?: (err: unknown) => void },
): Unsubscribe {
  const col = collection(db, 'notifications', uid, 'items');
  // unread만. createdAt index도 활용하므로 orderBy 포함.
  const q = query(col, where('read', '==', false), orderBy('createdAt', 'desc'), firestoreLimit(100));
  return onSnapshot(
    q,
    (snap) => {
      // expiresAt 만료 항목은 카운트에서 제외
      const nowMs = Date.now();
      let count = 0;
      snap.forEach((d) => {
        const data = d.data() as { expiresAt?: Timestamp };
        if (data.expiresAt && data.expiresAt.toMillis() < nowMs) return;
        count++;
      });
      callback(count);
    },
    (err) => {
      console.warn('[subscribeUnreadCount]', err);
      options?.onError?.(err);
    },
  );
}

/**
 * 단일 알림 read=true 마킹.
 * rules가 read/readAt 외 필드 변경을 차단하므로 두 필드만 update.
 */
export async function markAsRead(uid: string, notifId: string): Promise<void> {
  const ref = doc(db, 'notifications', uid, 'items', notifId);
  await updateDoc(ref, {
    read: true,
    readAt: Timestamp.now(),
  });
}

/**
 * 모두 읽음 처리 — 안 읽은 알림 전체 batch update.
 * batch 1회 최대 500 ops. 100건 limit으로 안전.
 */
export async function markAllAsRead(uid: string): Promise<number> {
  const col = collection(db, 'notifications', uid, 'items');
  const q = query(col, where('read', '==', false), firestoreLimit(200));
  const snap = await getDocs(q);
  if (snap.empty) return 0;
  const now = Timestamp.now();
  // 200건이면 batch 1개로 충분 (500 op 한도)
  const batch = writeBatch(db);
  snap.docs.forEach((d) => {
    batch.update(d.ref, { read: true, readAt: now });
  });
  await batch.commit();
  return snap.size;
}

/** 사용자 수동 삭제 — 단일 doc */
export async function deleteNotification(uid: string, notifId: string): Promise<void> {
  await deleteDoc(doc(db, 'notifications', uid, 'items', notifId));
}

/** 알림 type → 아이콘/색 매핑 (UI 유틸) */
export function notificationVisual(type: string): {
  icon: string;
  color: string;
  label: string;
} {
  switch (type) {
    case 'reservation_confirmed':
      return { icon: '✅', color: '#10B981', label: '예약 확정' };
    case 'reservation_cancelled_by_store':
      return { icon: '🚫', color: '#EF4444', label: '예약 취소' };
    case 'cancel_request_received':
      return { icon: '🔔', color: '#F59E0B', label: '취소 신청 접수' };
    case 'cancel_request_declined':
      return { icon: '❌', color: '#F97316', label: '취소 거절' };
    case 'reservation_reminder':
      return { icon: '⏰', color: '#3B82F6', label: '방문 임박' };
    case 'new_reservation':
      return { icon: '🆕', color: '#8B5CF6', label: '새 예약' };
    case 'tournament_start':
      return { icon: '🏆', color: '#EC4899', label: '토너 시작 임박' };
    case 'late_reg_imminent':
      return { icon: '⚡', color: '#F59E0B', label: '등록 마감' };
    case 'series_countdown':
      return { icon: '📅', color: '#8B5CF6', label: '시리즈 카운트다운' };
    case 'favorite_live':
      return { icon: '🔴', color: '#EF4444', label: '즐겨찾기 LIVE' };
    case 'new_review':
      return { icon: '⭐', color: '#F59E0B', label: '새 리뷰' };
    case 'marketing':
      return { icon: '📣', color: '#EC4899', label: '소식' };
    default:
      return { icon: '🔔', color: '#6B7280', label: '알림' };
  }
}
