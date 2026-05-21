'use client';

import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  limit,
} from 'firebase/firestore';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { db, storage } from './firebase';
import { stripUndefined } from './firestoreUtil';

/**
 * 매장 데일리 홍보 ("오늘의 소식") + 본사 pinned 공지.
 *
 * 정책 (memory: project_holdemnow_daily_posts):
 * - 매장당 1일 1글, createdAt + 24h 자동 만료
 * - 이미지 최대 4장 (5MB/장)
 * - 자유 이벤트 태그
 * - 본사 pinned 글은 top-level `pinnedPosts` 컬렉션 (홈 최상단 고정)
 * - authorType 필드로 추후 SNS 'user' 게시글과 호환
 */

const POST_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_POST_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type PostAuthorType = 'store' | 'platform' | 'user'; // user는 v1.0 SNS 확장용
export type PostStatus = 'published' | 'hidden' | 'pending';

export interface StorePost {
  id: string;
  storeId: string;
  storeName?: string;
  body: string;
  imageUrls: string[];
  eventTags: string[];
  ctaUrl?: string;
  ctaLabel?: string;
  authorType: PostAuthorType;
  authorUid: string;
  status: PostStatus;
  flagCount: number;
  createdAt?: Timestamp;
  expiresAt?: Timestamp;
}

export interface PinnedPost {
  id: string;
  title: string;
  body: string;
  imageUrls: string[];
  ctaUrl?: string;
  ctaLabel?: string;
  active: boolean;
  priority: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─────────────────────────────────────────────────────────────
// 매장 posts (stores/{storeId}/posts/{postId})
// ─────────────────────────────────────────────────────────────

function postsCol(storeId: string) {
  return collection(db, 'stores', storeId, 'posts');
}

function expiresFromNow(): Timestamp {
  return Timestamp.fromMillis(Date.now() + POST_TTL_MS);
}

/** 매장 어드민용 — 자기 매장 글 전체(만료/숨김 포함) */
export function subscribeStorePostsAll(
  storeId: string,
  onChange: (items: StorePost[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(postsCol(storeId), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StorePost, 'id'>),
        })),
      );
    },
    (e) => onError(e as Error),
  );
}

/** 매장 상세 페이지용 — 활성(미만료, published) 최신 1건 */
export function subscribeStoreActivePost(
  storeId: string,
  onChange: (post: StorePost | null) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    postsCol(storeId),
    where('status', '==', 'published'),
    orderBy('createdAt', 'desc'),
    limit(1),
  );
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onChange(null);
        return;
      }
      const d = snap.docs[0];
      const data = { id: d.id, ...(d.data() as Omit<StorePost, 'id'>) };
      // 클라이언트 측 만료 필터 — expiresAt 지났으면 안 보여줌
      const expMs = data.expiresAt?.toMillis() ?? 0;
      if (expMs && expMs <= Date.now()) {
        onChange(null);
        return;
      }
      onChange(data);
    },
    (e) => onError(e as Error),
  );
}

/** 홈용 — 전체 매장의 활성(미만료) 글 collectionGroup. 거리/위치 필터는 호출자에서. */
export async function loadActivePostsAll(maxAgeMs = POST_TTL_MS): Promise<StorePost[]> {
  const since = Timestamp.fromMillis(Date.now() - maxAgeMs);
  const q = query(
    collectionGroup(db, 'posts'),
    where('status', '==', 'published'),
    where('createdAt', '>=', since),
    orderBy('createdAt', 'desc'),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    storeId: d.ref.parent.parent?.id ?? '',
    ...(d.data() as Omit<StorePost, 'id' | 'storeId'>),
  }));
}

export async function createStorePost(input: {
  storeId: string;
  storeName?: string;
  body: string;
  imageUrls?: string[];
  eventTags?: string[];
  ctaUrl?: string;
  ctaLabel?: string;
  authorUid: string;
}): Promise<string> {
  const ref = await addDoc(postsCol(input.storeId), stripUndefined({
    storeId: input.storeId,
    storeName: input.storeName ?? '',
    body: input.body,
    imageUrls: input.imageUrls ?? [],
    eventTags: input.eventTags ?? [],
    ctaUrl: input.ctaUrl ?? '',
    ctaLabel: input.ctaLabel ?? '',
    authorType: 'store' as PostAuthorType,
    authorUid: input.authorUid,
    status: 'published' as PostStatus,
    flagCount: 0,
    createdAt: serverTimestamp(),
    expiresAt: expiresFromNow(),
  }));
  return ref.id;
}

export async function updateStorePost(
  storeId: string,
  postId: string,
  updates: Partial<Omit<StorePost, 'id' | 'storeId' | 'authorType' | 'authorUid' | 'createdAt' | 'expiresAt'>>,
): Promise<void> {
  await updateDoc(doc(postsCol(storeId), postId), stripUndefined(updates));
}

export async function deleteStorePost(storeId: string, postId: string): Promise<void> {
  try {
    const snap = await getDoc(doc(postsCol(storeId), postId));
    if (snap.exists()) {
      const data = snap.data() as StorePost;
      await Promise.all(
        (data.imageUrls ?? []).map((url) => deletePostImageByUrl(url).catch(() => {})),
      );
    }
  } catch {
    // ignore
  }
  await deleteDoc(doc(postsCol(storeId), postId));
}

/** 포스트 이미지 업로드 — posts/{storeId}/{postId}/{filename} */
export async function uploadPostImage(
  storeId: string,
  postIdOrTemp: string,
  file: File,
): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('이미지는 5MB 이하만 업로드 가능합니다');
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드 가능합니다');
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `posts/${storeId}/${postIdOrTemp}/${id}.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}

export async function deletePostImageByUrl(url: string): Promise<void> {
  try {
    await deleteObject(storageRef(storage, url));
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────
// 본사 pinned 글 (pinnedPosts/{id}) — 홈 최상단 고정 공지
// ─────────────────────────────────────────────────────────────

const PINNED = 'pinnedPosts';

export function subscribeActivePinnedPosts(
  onChange: (items: PinnedPost[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    collection(db, PINNED),
    where('active', '==', true),
    orderBy('priority', 'desc'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PinnedPost, 'id'>) })));
    },
    (e) => onError(e as Error),
  );
}

export function subscribeAllPinnedPosts(
  onChange: (items: PinnedPost[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(collection(db, PINNED), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PinnedPost, 'id'>) })));
    },
    (e) => onError(e as Error),
  );
}

export async function createPinnedPost(input: {
  title: string;
  body?: string;
  imageUrls?: string[];
  ctaUrl?: string;
  ctaLabel?: string;
  active?: boolean;
  priority?: number;
}): Promise<string> {
  const ref = await addDoc(collection(db, PINNED), stripUndefined({
    title: input.title,
    body: input.body ?? '',
    imageUrls: input.imageUrls ?? [],
    ctaUrl: input.ctaUrl ?? '',
    ctaLabel: input.ctaLabel ?? '',
    active: input.active ?? true,
    priority: input.priority ?? 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  return ref.id;
}

export async function updatePinnedPost(
  id: string,
  updates: Partial<Omit<PinnedPost, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  await updateDoc(doc(db, PINNED, id), stripUndefined({
    ...updates,
    updatedAt: serverTimestamp(),
  }));
}

export async function deletePinnedPost(id: string): Promise<void> {
  try {
    const snap = await getDoc(doc(db, PINNED, id));
    if (snap.exists()) {
      const data = snap.data() as PinnedPost;
      await Promise.all(
        (data.imageUrls ?? []).map((url) => deletePostImageByUrl(url).catch(() => {})),
      );
    }
  } catch {
    // ignore
  }
  await deleteDoc(doc(db, PINNED, id));
}

/** pinned 글 이미지 업로드 — posts/_pinned/{postIdOrTemp}/{filename} */
export async function uploadPinnedImage(postIdOrTemp: string, file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('이미지는 5MB 이하만 업로드 가능합니다');
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드 가능합니다');
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `posts/_pinned/${postIdOrTemp}/${id}.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}
