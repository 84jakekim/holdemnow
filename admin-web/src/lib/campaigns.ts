'use client';

/**
 * 본사 마케팅 캠페인 (platformCampaigns) 클라이언트 API.
 *
 * - 본사 어드민(`/platform/marketing`) 페이지에서 사용.
 * - 발송 자체는 Cloud Function(`marketingBroadcast`) 호출. 예약 발송은
 *   `processScheduledCampaigns` 스케줄 함수가 매 1분 cron으로 처리.
 *
 * 권한: platformCampaigns rules에서 platform_admin만 read/create/update/delete 허용.
 * Storage 경로: campaigns/{campaignId}/{filename}
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
} from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db, storage } from './firebase';
import { compressImageForUpload } from './imageCompress';
import { stripUndefined } from './firestoreUtil';

const COLLECTION = 'platformCampaigns';

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export interface Campaign {
  id: string;
  title: string;                    // 50자 권장
  body: string;                     // 150자 권장
  imageUrl?: string | null;
  linkUrl?: string | null;
  segment: 'all';                   // v0.1 단일 옵션
  status: CampaignStatus;
  scheduledAt?: Timestamp | null;
  sentAt?: Timestamp | null;
  sentBy: string;
  sentByName: string;
  recipientCount?: number;
  deliveredCount?: number;
  failureCount?: number;
  clickCount?: number;
  isAdvertisement: boolean;
  errorMessage?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ===== 구독 =====

/** 본사 어드민 목록용 — createdAt desc, 모든 상태 포함. */
export function subscribeAllCampaigns(
  onChange: (items: Campaign[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Campaign, 'id'>) })),
      );
    },
    (e) => onError(e as Error),
  );
}

// ===== CRUD =====

/**
 * 캠페인 생성. scheduledAt이 null이면 status='draft'로 생성 후 sendCampaignNow로 즉시 발송.
 * scheduledAt이 있으면 status='scheduled'로 생성 → cron이 자동 발송.
 */
export async function createCampaign(input: {
  title: string;
  body: string;
  imageUrl?: string | null;
  linkUrl?: string | null;
  isAdvertisement: boolean;
  scheduledAt?: Date | null;
  sentBy: string;
  sentByName: string;
}): Promise<string> {
  if (!input.title.trim()) throw new Error('제목은 필수입니다');
  if (!input.body.trim()) throw new Error('본문은 필수입니다');
  if (!input.sentBy) throw new Error('sentBy는 필수입니다');

  const ref = doc(collection(db, COLLECTION));
  const status: CampaignStatus = input.scheduledAt ? 'scheduled' : 'draft';
  await setDoc(ref, stripUndefined({
    title: input.title.trim(),
    body: input.body.trim(),
    imageUrl: input.imageUrl ?? null,
    linkUrl: input.linkUrl ?? null,
    segment: 'all',
    status,
    scheduledAt: input.scheduledAt ? Timestamp.fromDate(input.scheduledAt) : null,
    sentAt: null,
    sentBy: input.sentBy,
    sentByName: input.sentByName ?? '',
    recipientCount: 0,
    deliveredCount: 0,
    failureCount: 0,
    clickCount: 0,
    isAdvertisement: input.isAdvertisement,
    errorMessage: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  return ref.id;
}

/** 예약(scheduled) 또는 초안(draft) 상태에서만 수정 가능 (rules가 검증). */
export async function updateCampaign(
  campaignId: string,
  updates: Partial<
    Pick<
      Campaign,
      'title' | 'body' | 'imageUrl' | 'linkUrl' | 'isAdvertisement'
    >
  > & { scheduledAt?: Date | null },
): Promise<void> {
  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.body !== undefined) patch.body = updates.body;
  if (updates.imageUrl !== undefined) patch.imageUrl = updates.imageUrl;
  if (updates.linkUrl !== undefined) patch.linkUrl = updates.linkUrl;
  if (updates.isAdvertisement !== undefined)
    patch.isAdvertisement = updates.isAdvertisement;
  if (updates.scheduledAt !== undefined) {
    patch.scheduledAt = updates.scheduledAt
      ? Timestamp.fromDate(updates.scheduledAt)
      : null;
  }
  await updateDoc(doc(db, COLLECTION, campaignId), stripUndefined(patch));
}

/**
 * 예약 캠페인 취소. status=scheduled → cancelled.
 * 예약 시각 5분 전까지만 가능 (가드는 클라이언트에서 + rules는 status만 검증).
 */
export async function cancelCampaign(campaignId: string): Promise<void> {
  const snap = await getDoc(doc(db, COLLECTION, campaignId));
  if (!snap.exists()) throw new Error('캠페인을 찾을 수 없습니다');
  const data = snap.data() as Campaign;
  if (data.status !== 'scheduled') {
    throw new Error('예약 상태(scheduled)인 캠페인만 취소할 수 있습니다');
  }
  if (data.scheduledAt && typeof data.scheduledAt.toMillis === 'function') {
    const remaining = data.scheduledAt.toMillis() - Date.now();
    if (remaining < 5 * 60 * 1000) {
      throw new Error('발송 5분 전부터는 취소할 수 없습니다');
    }
  }
  await updateDoc(doc(db, COLLECTION, campaignId), {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
  });
}

/**
 * 캠페인 삭제 (hard delete) — v0.1은 단순 삭제.
 * rules에서 status ∈ {draft, cancelled, failed}만 허용.
 * 첨부 이미지(Storage)도 같이 정리.
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  // Storage 첨부 이미지 정리 — 실패해도 doc 삭제는 진행
  try {
    const dirRef = storageRef(storage, `campaigns/${campaignId}`);
    const listed = await listAll(dirRef);
    await Promise.allSettled(listed.items.map((it) => deleteObject(it)));
  } catch {
    // ignore
  }
  await deleteDoc(doc(db, COLLECTION, campaignId));
}

// ===== Storage =====

/**
 * 캠페인 이미지 업로드. 호출 시 campaignId가 없으면 임시 폴더에 업로드 후
 * 캠페인 생성 시 path를 그대로 imageUrl로 사용.
 * Storage path: campaigns/{campaignIdOrTemp}/{ts_rand}.{ext}
 */
export async function uploadCampaignImage(
  campaignIdOrTemp: string,
  file: File,
): Promise<string> {
  file = await compressImageForUpload(file, 2048, 0.9);
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('사진 용량이 커서 업로드할 수 없습니다. 더 작은 사진(JPG 권장)으로 다시 시도해 주세요.');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 업로드 가능합니다');
  }
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `campaigns/${campaignIdOrTemp}/${id}.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}

// ===== 발송 (Cloud Function 호출) =====

/**
 * 즉시 발송. 캠페인 doc은 이미 만들어진 상태여야 함 (createCampaign에서 status='draft'로 생성).
 * marketingBroadcast Callable을 호출하면 함수가 발송 후 doc.status='sent' + 통계 머지.
 */
export async function sendCampaignNow(campaignId: string): Promise<{
  recipientCount: number;
  deliveredCount: number;
  failureCount: number;
}> {
  const snap = await getDoc(doc(db, COLLECTION, campaignId));
  if (!snap.exists()) throw new Error('캠페인을 찾을 수 없습니다');
  const data = snap.data() as Campaign;
  if (data.status !== 'draft') {
    throw new Error('초안(draft) 상태에서만 즉시 발송할 수 있습니다');
  }

  // sending으로 우선 마킹 (UI 즉시 반영). 함수가 sent로 갱신.
  await updateDoc(doc(db, COLLECTION, campaignId), {
    status: 'sending',
    updatedAt: serverTimestamp(),
  });

  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { recipientCount: number; deliveredCount: number; failureCount: number }
    >(getFunctions(app, 'asia-northeast3'), 'marketingBroadcast');
    const res = await fn({
      campaignId,
      title: data.title,
      body: data.body,
      imageUrl: data.imageUrl ?? undefined,
      linkUrl: data.linkUrl ?? undefined,
      isAdvertisement: data.isAdvertisement,
    });
    return res.data;
  } catch (e) {
    // 실패 시 status=failed로 되돌림
    await updateDoc(doc(db, COLLECTION, campaignId), {
      status: 'failed',
      errorMessage: e instanceof Error ? e.message : String(e),
      updatedAt: serverTimestamp(),
    }).catch(() => {});
    throw e;
  }
}

/**
 * 테스트 발송 — 본인(toUid)에게만 전송. 캠페인 doc은 만들지 않음.
 */
export async function sendTestCampaign(input: {
  title: string;
  body: string;
  imageUrl?: string | null;
  linkUrl?: string | null;
  isAdvertisement: boolean;
  toUid: string;
}): Promise<{
  recipientCount: number;
  deliveredCount: number;
  failureCount: number;
}> {
  if (!input.title.trim()) throw new Error('제목은 필수입니다');
  if (!input.body.trim()) throw new Error('본문은 필수입니다');
  if (!input.toUid) throw new Error('toUid는 필수입니다');

  const fn = httpsCallable<
    Record<string, unknown>,
    { recipientCount: number; deliveredCount: number; failureCount: number }
  >(getFunctions(app, 'asia-northeast3'), 'marketingBroadcast');
  const res = await fn({
    title: input.title.trim(),
    body: input.body.trim(),
    imageUrl: input.imageUrl ?? undefined,
    linkUrl: input.linkUrl ?? undefined,
    isAdvertisement: input.isAdvertisement,
    testUid: input.toUid,
  });
  return res.data;
}

// ===== 유틸 =====

/** 상태 한글 라벨 */
export function campaignStatusLabel(s: CampaignStatus): string {
  switch (s) {
    case 'draft':
      return '초안';
    case 'scheduled':
      return '예약';
    case 'sending':
      return '발송 중';
    case 'sent':
      return '발송 완료';
    case 'failed':
      return '실패';
    case 'cancelled':
      return '취소됨';
    default:
      return s;
  }
}

/** 도달률 (deliveredCount / recipientCount) */
export function campaignDeliveryRate(c: Campaign): number {
  const r = c.recipientCount ?? 0;
  const d = c.deliveredCount ?? 0;
  if (r === 0) return 0;
  return d / r;
}
