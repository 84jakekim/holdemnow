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
  getDocs,
  limit as fsLimit,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { stripUndefined } from './firestoreUtil';

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
  participatingGame?: string | null;
  status: ReservationStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  respondedAt?: Timestamp | null;
  respondedBy?: string | null;
  responseNote?: string | null;
  /** 매장 어드민이 종 알림에서 읽었는지 여부 — false=읽지 않음 */
  readByStore?: boolean;
  /** 예약 유효 시간(분) — 기본 120. 마퀴 띠 만료 판정에 사용 */
  durationMinutes?: number;
  /** 확정 처리 시각 */
  confirmedAt?: Timestamp | null;
  /** 취소 시각 (사용자 본인 또는 매장 owner) */
  cancelledAt?: Timestamp | null;
  /** 취소 주체 — 'user'(본인), 'store'(매장 직접 취소), 'store_approved'(사용자 신청 → 매장 승인), 'platform'(본사) */
  cancelledBy?: 'user' | 'store' | 'store_approved' | 'platform' | null;
  /** 매장 측 취소 사유 (자유 입력 또는 프리셋) — store/store_approved 케이스에서 사용 */
  cancelReason?: string | null;
  /** 매장 측 자유 메모 — store/store_approved 케이스에서 사용 */
  cancelMemo?: string | null;

  // ─────────── 사용자 발의 → 매장 승인 흐름 (PM 2026-05-27) ───────────
  /** 사용자가 취소 신청을 했는지 여부 (status='confirmed' 상태에서만 유효) */
  cancelRequested?: boolean;
  /** 취소 신청 시각 */
  cancelRequestedAt?: Timestamp | null;
  /** 취소 신청 사유 (필수, 100자) */
  cancelRequestReason?: string | null;
  /** 취소 신청 자유 메모 (선택, 200자) */
  cancelRequestNote?: string | null;
  /** 매장이 취소 신청을 거절한 시각 */
  cancelRequestDeclinedAt?: Timestamp | null;
  /** 매장이 거절한 사유 (자유 입력) */
  cancelRequestDeclineReason?: string | null;
}

export const MAX_RESERVATION_NOTE_LEN = 200;
export const MAX_PARTICIPATING_GAME_LEN = 200;
export const MIN_PARTY_SIZE = 1;
export const MAX_PARTY_SIZE = 20;

/**
 * 활성 예약으로 간주되는 상태 — 1인 1매장 1예약 정책의 차단 조건.
 * pending(매장 응답 대기) / confirmed(매장 확정 + 미방문) 두 상태.
 */
export const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = ['pending', 'confirmed'];

/**
 * 입장시간 + 이 시간만큼 지나면 자동으로 "지난 예약"으로 간주 (클라 필터 + cron).
 * 사용자가 매장 도착 늦을 수 있어 grace 2시간 보장.
 */
export const RESERVATION_AUTO_COMPLETE_GRACE_MS = 2 * 60 * 60 * 1000;

/** 활성 예약 여부 — 시간 경과(reservedFor + grace)분은 제외. */
export function isReservationActive(r: Reservation): boolean {
  if (!ACTIVE_RESERVATION_STATUSES.includes(r.status)) return false;
  const reservedMs = r.reservedFor?.toMillis?.() ?? 0;
  if (!reservedMs) return true; // 시각 누락 시 안전하게 active로 간주
  return reservedMs + RESERVATION_AUTO_COMPLETE_GRACE_MS > Date.now();
}

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
    participatingGame: (data.participatingGame as string | null | undefined) ?? null,
    status: (data.status as ReservationStatus) ?? 'pending',
    createdAt: data.createdAt as Timestamp,
    updatedAt: data.updatedAt as Timestamp,
    respondedAt: (data.respondedAt as Timestamp | null | undefined) ?? null,
    respondedBy: (data.respondedBy as string | null | undefined) ?? null,
    responseNote: (data.responseNote as string | null | undefined) ?? null,
    readByStore: (data.readByStore as boolean | undefined) ?? false,
    durationMinutes: (data.durationMinutes as number | undefined) ?? undefined,
    confirmedAt: (data.confirmedAt as Timestamp | null | undefined) ?? null,
    cancelledAt: (data.cancelledAt as Timestamp | null | undefined) ?? null,
    cancelledBy:
      (data.cancelledBy as
        | 'user'
        | 'store'
        | 'store_approved'
        | 'platform'
        | null
        | undefined) ?? null,
    cancelReason: (data.cancelReason as string | null | undefined) ?? null,
    cancelMemo: (data.cancelMemo as string | null | undefined) ?? null,
    cancelRequested: (data.cancelRequested as boolean | undefined) ?? false,
    cancelRequestedAt:
      (data.cancelRequestedAt as Timestamp | null | undefined) ?? null,
    cancelRequestReason:
      (data.cancelRequestReason as string | null | undefined) ?? null,
    cancelRequestNote:
      (data.cancelRequestNote as string | null | undefined) ?? null,
    cancelRequestDeclinedAt:
      (data.cancelRequestDeclinedAt as Timestamp | null | undefined) ?? null,
    cancelRequestDeclineReason:
      (data.cancelRequestDeclineReason as string | null | undefined) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// 쓰기
// ─────────────────────────────────────────────────────────────

/**
 * 1인 1매장 1예약 정책 위반 시 throw되는 에러.
 * UI에서 e.activeStoreName으로 안내 메시지 구성 가능.
 */
export class ActiveReservationConflictError extends Error {
  constructor(public readonly activeStoreName: string) {
    super(
      activeStoreName
        ? `이미 [${activeStoreName}]에 예약 중입니다. 기존 예약을 취소 후 다시 시도하세요.`
        : '이미 다른 매장에 예약 중입니다. 기존 예약을 취소 후 다시 시도하세요.',
    );
    this.name = 'ActiveReservationConflictError';
  }
}

/**
 * 본인 활성 예약 1건 조회 — 1인 1매장 1예약 정책 검증용.
 * 시간 경과(reservedFor + grace)분은 active에서 제외.
 * 반환 null이면 신규 예약 가능.
 */
export async function findActiveReservation(uid: string): Promise<Reservation | null> {
  if (!uid) return null;
  const q = query(
    collectionGroup(db, 'reservations'),
    where('authorUid', '==', uid),
    where('status', 'in', ACTIVE_RESERVATION_STATUSES),
    fsLimit(20),
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const storeIdFromPath = d.ref.parent.parent?.id ?? '';
    const r = toReservation(d.id, d.data() as Record<string, unknown>, storeIdFromPath);
    if (isReservationActive(r)) return r;
  }
  return null;
}

/**
 * 예약 생성 — status='pending'으로 시작. returns reservationId.
 *
 * 가드 (PM 결정 2026-05-27):
 *  - 1인 1매장 1예약: 본인 활성 예약(pending/confirmed + reservedFor+grace 이내) 있으면 차단.
 *    같은 매장 활성 예약이 있어도 차단 (사용자가 시간만 바꾸고 싶으면 기존 예약 취소 먼저).
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
  participatingGame?: string | null;
  durationMinutes?: number;
}): Promise<string> {
  if (!input.storeId) throw new Error('storeId가 필요합니다.');
  if (!input.authorUid) throw new Error('로그인이 필요합니다.');

  // 1인 1매장 1예약 정책 — 본인 활성 예약 검증.
  // collectionGroup query에 본인 read rules가 허용되므로 클라에서 사전 검증 가능.
  const existing = await findActiveReservation(input.authorUid);
  if (existing) {
    throw new ActiveReservationConflictError(existing.storeName || '다른 매장');
  }

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

  const participatingGame = (input.participatingGame ?? '').trim();
  if (participatingGame.length > MAX_PARTICIPATING_GAME_LEN) {
    throw new Error(`참가 게임은 ${MAX_PARTICIPATING_GAME_LEN}자 이내로 작성해주세요.`);
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
    participatingGame: participatingGame || null,
    status: 'pending' as ReservationStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    respondedAt: null,
    respondedBy: null,
    responseNote: null,
    readByStore: false,
    durationMinutes: input.durationMinutes ?? 120,
    confirmedAt: null,
  };

  const ref = await addDoc(reservationsCol(input.storeId), stripUndefined(payload));
  return ref.id;
}

/**
 * 예약 취소 — 본인만 가능 (rules에서 강제).
 * status='cancelled' + cancelledBy='user' + cancelledAt + updatedAt.
 *
 * PM 2026-05-27 정책 변경: confirmed 예약은 더 이상 단독 취소 불가.
 * confirmed의 경우 requestCancellation()으로 매장 승인 게이트를 거쳐야 함.
 * 이 함수는 pending에만 호출되어야 한다 (UI/rules 양쪽 보장).
 */
export async function cancelReservation(
  storeId: string,
  reservationId: string,
): Promise<void> {
  if (!storeId || !reservationId) {
    throw new Error('storeId·reservationId는 필수입니다.');
  }
  await updateDoc(
    doc(reservationsCol(storeId), reservationId),
    stripUndefined({
      status: 'cancelled',
      cancelledBy: 'user',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
}

/**
 * 매장 측 예약 취소 — owner/member만 가능 (rules에서 강제).
 * 사용자가 전화 등으로 변심을 알린 경우 매장이 직접 cancelled 처리.
 * cancelReason/cancelMemo는 자유 입력 (선택).
 * PM 결정 2026-05-27.
 */
export async function cancelReservationByStore(
  storeId: string,
  reservationId: string,
  input?: { reason?: string; memo?: string },
): Promise<void> {
  if (!storeId || !reservationId) {
    throw new Error('storeId·reservationId는 필수입니다.');
  }
  const uid = auth.currentUser?.uid ?? null;
  const reason = (input?.reason ?? '').trim();
  const memo = (input?.memo ?? '').trim();

  if (reason.length > 100) {
    throw new Error('취소 사유는 100자 이내로 작성해주세요.');
  }
  if (memo.length > 200) {
    throw new Error('취소 메모는 200자 이내로 작성해주세요.');
  }

  await updateDoc(
    doc(reservationsCol(storeId), reservationId),
    stripUndefined({
      status: 'cancelled' as ReservationStatus,
      cancelledBy: 'store' as const,
      cancelledAt: serverTimestamp(),
      cancelReason: reason || null,
      cancelMemo: memo || null,
      respondedAt: serverTimestamp(),
      respondedBy: uid,
      readByStore: true,
      updatedAt: serverTimestamp(),
    }),
  );
}

// ─────────────────────────────────────────────────────────────
// 사용자 발의 → 매장 승인 취소 흐름 (PM 2026-05-27)
// confirmed 예약은 사용자가 단독 취소 불가. 매장 승인 게이트.
// ─────────────────────────────────────────────────────────────

export const MAX_CANCEL_REQUEST_REASON_LEN = 100;
export const MAX_CANCEL_REQUEST_NOTE_LEN = 200;
export const MAX_CANCEL_REQUEST_DECLINE_REASON_LEN = 200;

/**
 * 사용자 — confirmed 예약에 취소 신청.
 * status는 그대로 'confirmed' 유지, cancelRequested=true 마킹만.
 * 매장 어드민에 NEW 배지로 노출 + FCM 푸시 발송 (Cloud Function).
 *
 * 가드:
 * - 본인만 호출 (rules 강제)
 * - resource.status === 'confirmed' (rules 강제)
 * - cancelRequested false → true (rules에서 중복 신청 차단 가능)
 */
export async function requestCancellation(
  storeId: string,
  reservationId: string,
  input: { reason: string; note?: string },
): Promise<void> {
  if (!storeId || !reservationId) {
    throw new Error('storeId·reservationId는 필수입니다.');
  }
  const reason = (input.reason ?? '').trim();
  const note = (input.note ?? '').trim();

  if (!reason) {
    throw new Error('취소 신청 사유는 필수입니다.');
  }
  if (reason.length > MAX_CANCEL_REQUEST_REASON_LEN) {
    throw new Error(
      `취소 사유는 ${MAX_CANCEL_REQUEST_REASON_LEN}자 이내로 작성해주세요.`,
    );
  }
  if (note.length > MAX_CANCEL_REQUEST_NOTE_LEN) {
    throw new Error(
      `취소 메모는 ${MAX_CANCEL_REQUEST_NOTE_LEN}자 이내로 작성해주세요.`,
    );
  }

  await updateDoc(
    doc(reservationsCol(storeId), reservationId),
    stripUndefined({
      cancelRequested: true,
      cancelRequestedAt: serverTimestamp(),
      cancelRequestReason: reason,
      cancelRequestNote: note || null,
      // 재신청 케이스 — 이전 거절 흔적 지움
      cancelRequestDeclinedAt: null,
      cancelRequestDeclineReason: null,
      // 매장 어드민의 "읽음" 다시 unread로 — pending과 동일 UX
      readByStore: false,
      updatedAt: serverTimestamp(),
    }),
  );
}

/**
 * 매장 owner — 사용자 취소 신청을 승인.
 * status='cancelled' + cancelledBy='store_approved' 전환.
 * cancelReason은 사용자가 신청한 reason 그대로 보존 (cancelRequestReason 복제).
 * 1매장 락 해제 (status가 active를 벗어나므로).
 */
export async function approveStoreCancellation(
  storeId: string,
  reservationId: string,
): Promise<void> {
  if (!storeId || !reservationId) {
    throw new Error('storeId·reservationId는 필수입니다.');
  }
  const uid = auth.currentUser?.uid ?? null;

  await updateDoc(
    doc(reservationsCol(storeId), reservationId),
    stripUndefined({
      status: 'cancelled' as ReservationStatus,
      cancelledBy: 'store_approved' as const,
      cancelledAt: serverTimestamp(),
      // 사용자가 신청한 사유를 cancelReason으로 옮김 (cancelRequestReason은 그대로 둠 — 이력 보존)
      // 클라에서 별도 read 없이 한 번에 update — 단, cancelReason 값은 후속 단계에서 cancelRequestReason 복제용으로
      // 매장 어드민 UI에서 직접 전달받지 않고, 여기서는 cancelRequested=false 토글 + cancelReason 누락 시
      // rules에서 따로 검증하지 않음 (display 측에서 cancelRequestReason를 보여줌).
      cancelRequested: false,
      respondedAt: serverTimestamp(),
      respondedBy: uid,
      readByStore: true,
      updatedAt: serverTimestamp(),
    }),
  );
}

/**
 * 매장 owner — 사용자 취소 신청을 거절.
 * status='confirmed' 그대로 유지. cancelRequested=false, declinedAt/declineReason 기록.
 * 사용자는 거절 사유 보고 재신청 가능.
 */
export async function declineCancellation(
  storeId: string,
  reservationId: string,
  declineReason: string,
): Promise<void> {
  if (!storeId || !reservationId) {
    throw new Error('storeId·reservationId는 필수입니다.');
  }
  const reason = (declineReason ?? '').trim();
  if (reason.length > MAX_CANCEL_REQUEST_DECLINE_REASON_LEN) {
    throw new Error(
      `거절 사유는 ${MAX_CANCEL_REQUEST_DECLINE_REASON_LEN}자 이내로 작성해주세요.`,
    );
  }
  const uid = auth.currentUser?.uid ?? null;

  await updateDoc(
    doc(reservationsCol(storeId), reservationId),
    stripUndefined({
      cancelRequested: false,
      cancelRequestDeclinedAt: serverTimestamp(),
      cancelRequestDeclineReason: reason || null,
      // status='confirmed' 유지 (변경 X)
      respondedAt: serverTimestamp(),
      respondedBy: uid,
      readByStore: true,
      updatedAt: serverTimestamp(),
    }),
  );
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
    readByStore: true,
    ...(status === 'confirmed' ? { confirmedAt: serverTimestamp() } : {}),
  };

  await updateDoc(doc(reservationsCol(storeId), reservationId), stripUndefined(patch));
}

/**
 * 체크인 자동 완료 — 본인이 같은 매장에 체크인하면 활성 예약 1건을 completed로 전환.
 * PM 결정 2026-05-27: 같은 매장 + 활성 상태(pending/confirmed)일 때만 트리거.
 * 다른 매장 체크인은 활성 예약 건드리지 않음 (정책 위반).
 *
 * 호출 위치: CheckInSheet.handleSubmit 성공 후 best-effort 호출 (실패 silent).
 * 호출 실패해도 cron(autoCompleteReservations)이 입장시간+2h에 정리.
 */
export async function completeReservationByCheckIn(
  uid: string,
  storeId: string,
): Promise<{ completed: number }> {
  if (!uid || !storeId) return { completed: 0 };
  const q = query(
    collectionGroup(db, 'reservations'),
    where('authorUid', '==', uid),
    where('storeId', '==', storeId),
    where('status', 'in', ACTIVE_RESERVATION_STATUSES),
    fsLimit(10),
  );
  const snap = await getDocs(q);
  if (snap.empty) return { completed: 0 };
  let completed = 0;
  for (const d of snap.docs) {
    try {
      await updateDoc(
        d.ref,
        stripUndefined({
          status: 'completed' as ReservationStatus,
          completedAt: serverTimestamp(),
          completionReason: 'check_in',
          updatedAt: serverTimestamp(),
        }),
      );
      completed += 1;
    } catch {
      // 매장 owner update 권한이 없는 케이스도 있을 수 있음 — silent.
      // rules: 본인은 status='cancelled'만 허용이라 update 차단될 수 있다.
      // 그 경우 cron(autoCompleteReservations)이 입장시간+2h에 정리하므로 OK.
    }
  }
  return { completed };
}

/**
 * 매장 어드민이 예약을 읽음 처리 — readByStore: true.
 */
export async function markReservationRead(
  storeId: string,
  reservationId: string,
): Promise<void> {
  if (!storeId || !reservationId) return;
  await updateDoc(doc(reservationsCol(storeId), reservationId), {
    readByStore: true,
    updatedAt: serverTimestamp(),
  });
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
      return '예약 취소';
    case 'no_show':
      return '노쇼';
    case 'completed':
      return '방문 완료';
    default:
      return s;
  }
}

/** 취소 주체별 라벨 — cancelled 상태 카드에 표시 */
export function reservationCancelLabel(
  cancelledBy?: 'user' | 'store' | 'store_approved' | 'platform' | null,
): string {
  switch (cancelledBy) {
    case 'store':
      return '매장 취소';
    case 'store_approved':
      return '매장 승인 취소';
    case 'platform':
      return '본사 취소';
    case 'user':
      return '사용자 취소';
    default:
      return '예약 취소';
  }
}
