'use client';

import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  Timestamp,
  type DocumentSnapshot,
  type QueryConstraint,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';
import { compressImageForUpload } from './imageCompress';
import { stripUndefined } from './firestoreUtil';

/**
 * 대회(Event) — 국내외 메이저 토너먼트 이벤트.
 * 매장 단위 토너(`stores/{id}/tournaments/`)와 구분됨.
 *
 * 등록자:
 *  - 대회사(organizer) — 본인이 운영하는 대회
 *  - 본사(platform_admin) — 글로벌·국내 큐레이션 대회 (WSOP, EPT 등)
 */

export type EventCategory = 'domestic' | 'international';
export type EventStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

export interface EventDoc {
  id: string;
  name: string;
  shortName?: string;
  description?: string;
  posterUrl?: string;

  category: EventCategory;
  organizerId?: string;
  organizerName?: string;
  isPlatformPosted?: boolean;

  startDate: Timestamp;
  endDate?: Timestamp;
  registrationDeadline?: Timestamp;

  /** 개최 도시 — 지역 뱃지 표시용. 국내: 서울/부산/제주 등, 국외: 라스베이거스/마카오/마닐라 등 */
  city?: string;
  venueName?: string;
  venueAddress?: string;
  lat?: number;
  lng?: number;

  buyIn?: number;
  prizePool?: number;
  guaranteedPrize?: number;
  expectedPlayers?: number;
  currency?: string;

  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;

  registrationUrl?: string;
  officialUrl?: string;
  livestreamUrl?: string;

  status: EventStatus;

  ownerUid: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  domestic: '국내',
  international: '국외',
};

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: '예정',
  ongoing: '진행 중',
  completed: '종료',
  cancelled: '취소',
};

function eventsCol() {
  return collection(db, 'events');
}

function fromSnap(snap: DocumentSnapshot): EventDoc | null {
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<EventDoc, 'id'>) };
}

/* ============================================================
 * 조회
 * ========================================================== */

export interface SubscribeOptions {
  category?: EventCategory;
  status?: EventStatus;
  organizerId?: string;
  /** 정렬 — 기본 startDate 오름차순 */
  orderByField?: 'startDate' | 'name' | 'buyIn';
  orderDir?: 'asc' | 'desc';
}

export function subscribeEvents(
  options: SubscribeOptions,
  onChange: (items: EventDoc[]) => void,
  onError?: (e: Error) => void,
) {
  const constraints: QueryConstraint[] = [];
  if (options.category) constraints.push(where('category', '==', options.category));
  if (options.status) constraints.push(where('status', '==', options.status));
  if (options.organizerId) constraints.push(where('organizerId', '==', options.organizerId));

  const field = options.orderByField ?? 'startDate';
  const dir = options.orderDir ?? 'asc';
  constraints.push(orderBy(field, dir));

  const q = query(eventsCol(), ...constraints);
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EventDoc, 'id'>) }))),
    (err) => onError?.(err as Error),
  );
}

export function subscribeEvent(
  eventId: string,
  onChange: (e: EventDoc | null) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(eventsCol(), eventId),
    (snap) => onChange(fromSnap(snap)),
    (err) => onError?.(err as Error),
  );
}

export async function getEvent(eventId: string): Promise<EventDoc | null> {
  const snap = await getDoc(doc(eventsCol(), eventId));
  return fromSnap(snap);
}

/* ============================================================
 * 쓰기
 * ========================================================== */

export type EventInput = Omit<EventDoc, 'id' | 'createdAt' | 'updatedAt'>;

export async function createEvent(input: EventInput): Promise<string> {
  const ref = await addDoc(eventsCol(), {
    ...stripUndefined(input as Record<string, unknown>),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateEvent(eventId: string, patch: Partial<EventInput>): Promise<void> {
  await updateDoc(doc(eventsCol(), eventId), {
    ...stripUndefined(patch as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteEvent(eventId: string): Promise<void> {
  await deleteDoc(doc(eventsCol(), eventId));
}

/* ============================================================
 * 포스터 업로드 (Storage)
 * ========================================================== */

export async function uploadEventPoster(eventId: string, file: File): Promise<string> {
  file = await compressImageForUpload(file, 2048, 0.9);
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('사진 용량이 커서 업로드할 수 없습니다. 더 작은 사진(JPG 권장)으로 다시 시도해 주세요.');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 업로드 가능합니다');
  }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `events/${eventId}/poster_${Date.now()}.${ext}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type });
  return await getDownloadURL(ref);
}

export async function deleteEventPosterByUrl(url: string): Promise<void> {
  try {
    const ref = storageRef(storage, url);
    await deleteObject(ref);
  } catch (e) {
    console.warn('Event poster delete skipped:', e);
  }
}

/* ============================================================
 * 헬퍼
 * ========================================================== */

/** 일정 표시: "5/20 ~ 5/25" 또는 "5/20" */
export function formatEventDateRange(start: Timestamp, end?: Timestamp): string {
  const s = start.toDate();
  const sStr = `${s.getMonth() + 1}/${s.getDate()}`;
  if (!end) return sStr;
  const e = end.toDate();
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate()) {
    return sStr;
  }
  return `${sStr} ~ ${e.getMonth() + 1}/${e.getDate()}`;
}

/** D-day 계산 — 양수면 며칠 후, 0이면 오늘, 음수면 지남 */
export function daysFromNow(ts: Timestamp): number {
  const ms = ts.toDate().getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** 상금 포맷: 1억 / 5,000만 / 100만 */
export function formatPrize(amount?: number): string {
  if (!amount || amount <= 0) return '미정';
  if (amount >= 100_000_000) return `${(amount / 100_000_000).toFixed(1)}억`;
  if (amount >= 10_000) return `${Math.floor(amount / 10_000).toLocaleString()}만`;
  return amount.toLocaleString();
}
