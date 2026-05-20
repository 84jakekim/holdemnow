'use client';

/**
 * 매장 예약 (stores/{storeId}/reservations/{reservationId} 서브컬렉션).
 *
 * 정책 (PM 합의):
 * - partySize 1~20, reservedFor 미래 시각, note ≤ 200자 — 클라이언트 + rules 양쪽 검증.
 * - 본인만 cancel 가능 (rules에서 강제, status='cancelled'로만 update).
 * - 매장 owner/member만 confirm/reject/no_show/completed 갱신 가능.
 * - 본사(platform_admin)만 delete — 매장이 임의로 못 지우게 이력 보존.
 * - 매장명·작성자명은 예약 시점 스냅샷(denorm) — 추후 변경되어도 예약 이력 보존.
 *
 * 알림: 새 예약 생성 시 매장 owner에게 FCM 푸시 — Cloud Function notifyStoreOnReservation.
 */

import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'no_show'
  | 'completed';

export interface Reservation {
  id: string;
  storeId: string;
  storeName: string;
  authorUid: string;
  authorName: string;
  authorPhone?: string | null;
  reservedFor: Timestamp;
  partySize: number;
  note?: string | null;
  status: ReservationStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  respondedAt?: Timestamp | null;
  respondedBy?: string | null;
  responseNote?: string | null;
}

export const MAX_RESERVATION_NOTE_LEN = 200;
export const MIN_PARTY_SIZE = 1;
export const MAX_PARTY_SIZE = 20;

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────

function reservationsCol(storeId: string) {
  return collection(db, 'stores', storeId, 'reservations');
}

function toReservation(
  id: string,
  data: Record<string, unknown>,
  storeIdFallback?: string,
): Reservation {
  return {
    id,
    storeId: (data.storeId as string) ?? storeIdFallback ?? '',
    storeName: (data.storeName as string) ?? '',
    authorUid: (data.authorUid as string) ?? '',
    authorName: (data.authorName as string) ?? '',
    authorPhone: (data.authorPhone as string | null | undefined) ?? null,
    reservedFor: data.reservedFor as Timestamp,
    partySize: (data.partySize as number) ?? 1,
    note: (data.note as string | null | undefined) ?? null,
    status: (data.status as ReservationStatus) ?? 'pending',
    createdAt: data.createdAt as Timestamp,
    updatedAt: data.updatedAt as Timestamp,
    respondedAt: (data.respondedAt as Timestamp | null | undefined) ?? null,
    respondedBy: (data.respondedBy as string | null | undefined) ?? null,
    responseNote: (data.responseNote as string | null | undefined) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// 쓰기
// ─────────────────────────────────────────────────────────────

/**
 * 예약 생성 — status='pending'으로 시작. returns reservationId.
 */
export async function createReservation(input: {
  storeId: string;
  storeName: string;
  authorUid: string;
  authorName: string;
  authorPhone?: string | null;
  reservedFor: Date;
  partySize: number;
  note?: string | null;
}): Promise<string> {
  if (!input.storeId) throw new Error('storeId가 필요합니다.');
  if (!input.authorUid) throw new Error('로그인이 필요합니다.');

  const partySize = Math.round(input.partySize);
  if (!Number.isInteger(partySize) || partySize < MIN_PARTY_SIZE || partySize > MAX_PARTY_SIZE) {
    throw new Error(`인원은 ${MIN_PARTY_SIZE}~${MAX_PARTY_SIZE}명 사이여야 합니다.`);
  }

  if (!(input.reservedFor instanceof Date) || isNaN(input.reservedFor.getTime())) {
    throw new Error('방문 예정 시각이 올바르지 않습니다.');
  }
  if (input.reservedFor.getTime() <= Date.now()) {
    throw new Error('방문 예정 시각은 현재 이후여야 합니다.');
  }

  const note = (input.note ?? '').trim();
  if (note.length > MAX_RESERVATION_NOTE_LEN) {
    throw new Error(`메모는 ${MAX_RESERVATION_NOTE_LEN}자 이내로 작성해주세요.`);
  }

  const phone = (input.authorPhone ?? '').trim();

  const payload: Record<string, unknown> = {
    storeId: input.storeId,
    storeName: input.storeName ?? '',
    authorUid: input.authorUid,
    authorName: input.authorName ?? '',
    authorPhone: phone || null,
    reservedFor: Timestamp.fromDate(input.reservedFor),
    partySize,
    note: note || null,
    status: 'pending' as ReservationStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    respondedAt: null,
    respondedBy: null,
    responseNote: null,
  };

  const ref = await addDoc(reservationsCol(input.storeId), payload);
  return ref.id;
}

/**
 * 예약 취소 — 본인만 가능 (rules에서 강제).
 * status='cancelled' + updatedAt.
 */
export async function cancelReservation(
  storeId: string,
  reservationId: string,
): Promise<void> {
  if (!storeId || !reservationId) {
    throw new Error('storeId·reservationId는 필수입니다.');
  }
  await updateDoc(doc(reservationsCol(storeId), reservationId), {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
  });
}

/**
 * 매장 응답 — owner/member만 가능 (rules에서 강제).
 * action='confirm' → status='confirmed', action='reject' → status='rejected'.
 * respondedAt/respondedBy/responseNote 기록.
 */
export async function respondToReservation(
  storeId: string,
  reservationId: string,
  action: 'confirm' | 'reject',
  responseNote?: string,
): Promise<void> {
  if (!storeId || !reservationId) {
    throw new Error('storeId·reservationId는 필수입니다.');
  }
  const status: ReservationStatus = action === 'confirm' ? 'confirmed' : 'rejected';
  const uid = auth.currentUser?.uid ?? null;
  const note = (responseNote ?? '').trim();

  const patch: Record<string, unknown> = {
    status,
    updatedAt: serverTimestamp(),
    respondedAt: serverTimestamp(),
    respondedBy: uid,
    responseNote: note || null,
  };

  await updateDoc(doc(reservationsCol(storeId), reservationId), patch);
}

// ─────────────────────────────────────────────────────────────
// 구독
// ─────────────────────────────────────────────────────────────

/**
 * 매장 owner/member용 — 매장의 모든 예약 (status 무관, 최신순).
 * 인덱스: stores/{storeId}/reservations orderBy('createdAt' desc) — Firebase 자동 인덱스.
 */
export function subscribeStoreReservations(
  storeId: string,
  onChange: (items: Reservation[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(reservationsCol(storeId), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) =>
        toReservation(d.id, d.data() as Record<string, unknown>, storeId),
      );
      onChange(items);
    },
    (e) => onError(e as Error),
  );
}

/**
 * 사용자 본인용 — collectionGroup으로 본인 authorUid 모든 매장 예약 (최신순).
 * 인덱스: collectionGroup('reservations') (authorUid asc, createdAt desc) — composite 필요.
 */
export function subscribeUserReservations(
  uid: string,
  onChange: (items: Reservation[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(
    collectionGroup(db, 'reservations'),
    where('authorUid', '==', uid),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs.map((d) => {
          const storeIdFromPath = d.ref.parent.parent?.id ?? '';
          return toReservation(d.id, d.data() as Record<string, unknown>, storeIdFromPath);
        }),
      );
    },
    (e) => onError(e as Error),
  );
}

// ─────────────────────────────────────────────────────────────
// formatters
// ─────────────────────────────────────────────────────────────

/** 상태 → 한국어 라벨 */
export function reservationStatusLabel(s: ReservationStatus): string {
  switch (s) {
    case 'pending':
      return '예약 대기';
    case 'confirmed':
      return '예약 확정';
    case 'rejected':
      return '매장 거부';
    case 'cancelled':
      return '사용자 취소';
    case 'no_show':
      return '노쇼';
    case 'completed':
      return '방문 완료';
    default:
      return s;
  }
}
