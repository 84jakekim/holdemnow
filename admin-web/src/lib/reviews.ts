'use client';

import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { db, storage } from './firebase';

/**
 * 매장 방문 리뷰 (stores/{storeId}/reviews/{reviewId} 서브컬렉션).
 *
 * 정책 (PM 합의):
 * - 별점 1~5 정수, 본문 max 500자, 사진 max 3장 (5MB/장).
 * - 본인만 수정·삭제 (Firestore rules에서 강제).
 * - 매장 집계 필드(reviewCount / averageRating / ratingDistribution)는
 *   Cloud Function `aggregateReviewStats`가 onDocumentWritten 트리거로 자동 갱신.
 * - 내 리뷰 전체 보기는 collectionGroup('reviews') + authorUid 필터.
 */

export const MAX_REVIEW_PHOTOS = 3;
export const MAX_REVIEW_BODY_LEN = 500;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface Review {
  id: string;
  storeId: string;
  authorUid: string;
  authorName: string;
  rating: number;
  body: string;
  photoUrls?: string[];
  visitDate?: Timestamp | null;
  helpfulCount?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  editedAt?: Timestamp | null;
}

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────

function reviewsCol(storeId: string) {
  return collection(db, 'stores', storeId, 'reviews');
}

function toReview(id: string, data: Record<string, unknown>, storeIdFallback?: string): Review {
  return {
    id,
    storeId: (data.storeId as string) ?? storeIdFallback ?? '',
    authorUid: (data.authorUid as string) ?? '',
    authorName: (data.authorName as string) ?? '',
    rating: (data.rating as number) ?? 0,
    body: (data.body as string) ?? '',
    photoUrls: (data.photoUrls as string[]) ?? [],
    visitDate: (data.visitDate as Timestamp | null | undefined) ?? null,
    helpfulCount: (data.helpfulCount as number) ?? 0,
    createdAt: data.createdAt as Timestamp | undefined,
    updatedAt: data.updatedAt as Timestamp | undefined,
    editedAt: (data.editedAt as Timestamp | null | undefined) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// 구독
// ─────────────────────────────────────────────────────────────

/** 매장 리뷰 목록 구독 (최신순) */
export function subscribeStoreReviews(
  storeId: string,
  onChange: (items: Review[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(reviewsCol(storeId), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => toReview(d.id, d.data() as Record<string, unknown>, storeId)));
    },
    (e) => onError(e as Error),
  );
}

/** 내 리뷰 전체 구독 (collectionGroup, 최신순) */
export function subscribeMyReviews(
  uid: string,
  onChange: (items: Review[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(
    collectionGroup(db, 'reviews'),
    where('authorUid', '==', uid),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs.map((d) => {
          const storeIdFromPath = d.ref.parent.parent?.id ?? '';
          return toReview(d.id, d.data() as Record<string, unknown>, storeIdFromPath);
        }),
      );
    },
    (e) => onError(e as Error),
  );
}

// ─────────────────────────────────────────────────────────────
// 쓰기
// ─────────────────────────────────────────────────────────────

/** 리뷰 작성 — returns reviewId */
export async function createReview(input: {
  storeId: string;
  authorUid: string;
  authorName: string;
  rating: number;
  body: string;
  photoUrls?: string[];
  visitDate?: Date | null;
}): Promise<string> {
  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('별점은 1~5 사이 정수여야 합니다.');
  }
  const body = (input.body ?? '').trim();
  if (!body) throw new Error('리뷰 본문을 입력해주세요.');
  if (body.length > MAX_REVIEW_BODY_LEN) {
    throw new Error(`리뷰 본문은 ${MAX_REVIEW_BODY_LEN}자 이내로 작성해주세요.`);
  }
  const photoUrls = (input.photoUrls ?? []).slice(0, MAX_REVIEW_PHOTOS);

  const ref = await addDoc(reviewsCol(input.storeId), {
    storeId: input.storeId,
    authorUid: input.authorUid,
    authorName: input.authorName ?? '',
    rating,
    body,
    photoUrls,
    visitDate: input.visitDate ? Timestamp.fromDate(input.visitDate) : null,
    helpfulCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    editedAt: null,
  });
  return ref.id;
}

/** 리뷰 수정 (본인만 — rules에서 강제) */
export async function updateReview(
  storeId: string,
  reviewId: string,
  updates: Partial<{
    rating: number;
    body: string;
    photoUrls: string[];
    visitDate: Date | null;
  }>,
): Promise<void> {
  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    editedAt: serverTimestamp(),
  };

  if (typeof updates.rating === 'number') {
    const rating = Math.max(1, Math.min(5, Math.round(updates.rating)));
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('별점은 1~5 사이 정수여야 합니다.');
    }
    patch.rating = rating;
  }
  if (typeof updates.body === 'string') {
    const body = updates.body.trim();
    if (!body) throw new Error('리뷰 본문을 입력해주세요.');
    if (body.length > MAX_REVIEW_BODY_LEN) {
      throw new Error(`리뷰 본문은 ${MAX_REVIEW_BODY_LEN}자 이내로 작성해주세요.`);
    }
    patch.body = body;
  }
  if (Array.isArray(updates.photoUrls)) {
    patch.photoUrls = updates.photoUrls.slice(0, MAX_REVIEW_PHOTOS);
  }
  if (updates.visitDate !== undefined) {
    patch.visitDate = updates.visitDate ? Timestamp.fromDate(updates.visitDate) : null;
  }

  await updateDoc(doc(reviewsCol(storeId), reviewId), patch);
}

/** 리뷰 삭제 (본인만) — Storage 사진 같이 정리 */
export async function deleteReview(storeId: string, reviewId: string): Promise<void> {
  try {
    const snap = await getDoc(doc(reviewsCol(storeId), reviewId));
    if (snap.exists()) {
      const data = snap.data() as Review;
      await Promise.all(
        (data.photoUrls ?? []).map((url) => deleteReviewImageByUrl(url).catch(() => {})),
      );
    }
  } catch {
    // ignore — Storage 정리 실패해도 doc 삭제는 진행
  }
  await deleteDoc(doc(reviewsCol(storeId), reviewId));
}

// ─────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────

/** 리뷰 사진 업로드 — reviews/{reviewIdOrTemp}/{filename} */
export async function uploadReviewImage(
  reviewIdOrTemp: string,
  file: File,
): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('이미지는 5MB 이하만 업로드 가능합니다');
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드 가능합니다');
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `reviews/${reviewIdOrTemp}/${id}.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}

async function deleteReviewImageByUrl(url: string): Promise<void> {
  try {
    await deleteObject(storageRef(storage, url));
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────
// formatters
// ─────────────────────────────────────────────────────────────

/** averageRating 표시용 포맷 (예: 4.5 → "4.5", 5 → "5.0", 0 → "0.0") */
export function formatRating(rating: number): string {
  if (!Number.isFinite(rating)) return '0.0';
  return (Math.round(rating * 10) / 10).toFixed(1);
}
