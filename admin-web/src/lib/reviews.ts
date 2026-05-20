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
  limit as fbLimit,
  setDoc,
  serverTimestamp,
  Timestamp,
  type DocumentData,
} from 'firebase/firestore';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { auth, db, storage } from './firebase';

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
  /** 본사가 숨김 처리한 리뷰 — 모바일 노출은 client-side에서 필터링. */
  hidden?: boolean;
  hiddenAt?: Timestamp | null;
  hiddenBy?: string | null;
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
    hidden: (data.hidden as boolean | undefined) ?? false,
    hiddenAt: (data.hiddenAt as Timestamp | null | undefined) ?? null,
    hiddenBy: (data.hiddenBy as string | null | undefined) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// 구독
// ─────────────────────────────────────────────────────────────

/**
 * 매장 리뷰 목록 구독 (최신순).
 * hidden=true 리뷰는 모바일 사용자에게 노출 차단 (본사가 숨김 처리한 리뷰).
 * 본사 관리 UI에서 hidden 포함 전체 목록이 필요하면 subscribeRecentReviews 사용.
 */
export function subscribeStoreReviews(
  storeId: string,
  onChange: (items: Review[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(reviewsCol(storeId), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => toReview(d.id, d.data() as Record<string, unknown>, storeId))
        .filter((r) => r.hidden !== true);
      onChange(items);
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

// ─────────────────────────────────────────────────────────────
// 본사 리뷰 관리 (platform_admin 전용 — rules에서 강제)
// ─────────────────────────────────────────────────────────────

/**
 * 리뷰 숨김 — 모바일 사용자에게 노출 차단.
 * 원본 데이터는 보존, hidden 플래그만 토글. platform_admin만 호출 가능
 * (Firestore rules에서 강제).
 */
export async function hideReview(storeId: string, reviewId: string): Promise<void> {
  const uid = auth.currentUser?.uid ?? null;
  await setDoc(
    doc(reviewsCol(storeId), reviewId),
    {
      hidden: true,
      hiddenAt: serverTimestamp(),
      hiddenBy: uid,
    },
    { merge: true },
  );
}

/** 숨김 해제 — hidden=false 로 토글. */
export async function unhideReview(storeId: string, reviewId: string): Promise<void> {
  const uid = auth.currentUser?.uid ?? null;
  await setDoc(
    doc(reviewsCol(storeId), reviewId),
    {
      hidden: false,
      hiddenAt: null,
      hiddenBy: uid,
    },
    { merge: true },
  );
}

/**
 * 전 매장 최근 N건 리뷰 구독 (collectionGroup, 최신순).
 * 본사 관리 페이지에서 hidden 포함 모든 리뷰 모니터링.
 * 인덱스: collectionGroup('reviews') orderBy('createdAt' desc) — Firebase 자동 인덱스로 OK.
 */
export function subscribeRecentReviews(
  limit: number,
  onChange: (items: Review[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(
    collectionGroup(db, 'reviews'),
    orderBy('createdAt', 'desc'),
    fbLimit(limit),
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
// 신고 (reports 컬렉션) — Phase B
// ─────────────────────────────────────────────────────────────

export type ReportReason = 'spam' | 'offensive' | 'misinformation' | 'advertising' | 'other';

/**
 * reports/{reportId} — collectionGroup 친화 단일 컬렉션.
 * Cloud Function `autoHideOnReports`가 동일 targetId의 신고 수가
 * 임계값(REPORT_THRESHOLD=3) 이상이면 자동으로 대상 리뷰의 hidden=true 설정.
 */
export interface Report {
  id: string;
  targetType: 'review' | 'community' | 'user';
  /** 리뷰 신고 시 reviewId */
  targetId: string;
  /** 대상 doc full path — 예: 'stores/{storeId}/reviews/{reviewId}' */
  targetParentPath: string;
  /** review 신고 시 매장 ID (대시보드 그룹화·필터용) */
  storeId?: string;
  reporterUid: string;
  reason: ReportReason;
  detail?: string;
  createdAt?: Timestamp;
  /** 본사 처리 여부 */
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Timestamp | null;
  resolution?: 'hide' | 'restore' | 'dismiss';
}

function toReport(id: string, data: DocumentData): Report {
  return {
    id,
    targetType: (data.targetType as Report['targetType']) ?? 'review',
    targetId: (data.targetId as string) ?? '',
    targetParentPath: (data.targetParentPath as string) ?? '',
    storeId: (data.storeId as string | undefined) ?? undefined,
    reporterUid: (data.reporterUid as string) ?? '',
    reason: (data.reason as ReportReason) ?? 'other',
    detail: (data.detail as string | undefined) ?? undefined,
    createdAt: data.createdAt as Timestamp | undefined,
    resolved: (data.resolved as boolean | undefined) ?? false,
    resolvedBy: (data.resolvedBy as string | undefined) ?? undefined,
    resolvedAt: (data.resolvedAt as Timestamp | null | undefined) ?? null,
    resolution: (data.resolution as Report['resolution']) ?? undefined,
  };
}

/**
 * 리뷰 신고. 같은 사용자는 같은 리뷰 1회만 가능.
 * reportId = `${reviewId}_${reporterUid}` → setDoc으로 멱등 보장
 * (이미 신고했다면 같은 reason으로 갱신되되 createdAt은 보존).
 */
export async function reportReview(
  storeId: string,
  reviewId: string,
  reporterUid: string,
  reason: ReportReason,
  detail?: string,
): Promise<void> {
  if (!storeId || !reviewId || !reporterUid) {
    throw new Error('storeId·reviewId·reporterUid는 필수입니다.');
  }
  const reportId = `${reviewId}_${reporterUid}`;
  const ref = doc(db, 'reports', reportId);

  // 이미 신고했다면 무시 (중복 방지)
  const existing = await getDoc(ref);
  if (existing.exists()) return;

  const payload: Record<string, unknown> = {
    targetType: 'review',
    targetId: reviewId,
    targetParentPath: `stores/${storeId}/reviews/${reviewId}`,
    storeId,
    reporterUid,
    reason,
    resolved: false,
    createdAt: serverTimestamp(),
  };
  if (detail && detail.trim()) payload.detail = detail.trim().slice(0, 500);

  await setDoc(ref, payload, { merge: false });
}

/** 이 사용자가 이 리뷰 이미 신고했나? — 신고 버튼 비활성화용 */
export async function hasReportedReview(
  _storeId: string,
  reviewId: string,
  uid: string,
): Promise<boolean> {
  if (!reviewId || !uid) return false;
  try {
    const ref = doc(db, 'reports', `${reviewId}_${uid}`);
    const snap = await getDoc(ref);
    return snap.exists();
  } catch {
    return false;
  }
}

/**
 * 본사 모더레이션 페이지 — 최근 신고 N건 구독 (최신순).
 * 인덱스: orderBy('createdAt' desc) — 단일 필드 자동 인덱스.
 */
export function subscribeRecentReports(
  limit: number,
  onChange: (items: Report[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(
    collection(db, 'reports'),
    orderBy('createdAt', 'desc'),
    fbLimit(limit),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => toReport(d.id, d.data()))),
    (e) => onError(e as Error),
  );
}
