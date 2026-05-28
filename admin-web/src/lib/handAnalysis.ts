/**
 * handAnalysis.ts — 핸드분석 게시판 데이터 레이어
 *
 * 컬렉션: handAnalysisPosts (top-level)
 * 댓글: handAnalysisPosts/{postId}/comments/{commentId}
 * 좋아요: handAnalysisPosts/{postId}/likes/{uid}
 *
 * v0.1 정책:
 *   - 이미지 최대 4장, 5MB 제한
 *   - 태그 최대 5개
 *   - 대댓글 1단 (parentCommentId)
 *   - 작성 한도 없음 (v0.2에서 추가)
 *   - 신고/숨김 없음 (추후 통합)
 */
'use client';

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  increment,
  setDoc,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { db, storage } from './firebase';
import { stripUndefined } from './firestoreUtil';

// ─────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────

export type HandPostStatus = 'published' | 'deleted';

export interface HandAnalysisPost {
  id: string;
  authorUid: string;
  authorName: string;
  authorAvatarUrl?: string;
  title: string;
  body: string;
  imageUrls: string[];
  position?: string;        // BTN / UTG / CO / BB / SB 등
  stakeLevel?: string;      // "1/2", "2/5" 자유 입력
  tags: string[];           // 최대 5개
  createdAt: string;        // ISO 문자열
  updatedAt: string;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  status: HandPostStatus;
}

export interface HandComment {
  id: string;
  authorUid: string;
  authorName: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  parentCommentId?: string; // 대댓글 1단
}

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const COLLECTION = 'handAnalysisPosts';
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────

function toIso(t: unknown): string {
  if (!t) return new Date().toISOString();
  if (t instanceof Timestamp) return t.toDate().toISOString();
  return new Date().toISOString();
}

function docToPost(snap: DocumentSnapshot | QueryDocumentSnapshot): HandAnalysisPost {
  const d = snap.data() as Record<string, unknown>;
  return {
    id: snap.id,
    authorUid: (d.authorUid as string) ?? '',
    authorName: (d.authorName as string) ?? '알 수 없음',
    authorAvatarUrl: d.authorAvatarUrl as string | undefined,
    title: (d.title as string) ?? '',
    body: (d.body as string) ?? '',
    imageUrls: (d.imageUrls as string[]) ?? [],
    position: d.position as string | undefined,
    stakeLevel: d.stakeLevel as string | undefined,
    tags: (d.tags as string[]) ?? [],
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
    likeCount: (d.likeCount as number) ?? 0,
    commentCount: (d.commentCount as number) ?? 0,
    viewCount: (d.viewCount as number) ?? 0,
    status: (d.status as HandPostStatus) ?? 'published',
  };
}

function docToComment(snap: DocumentSnapshot | QueryDocumentSnapshot): HandComment {
  const d = snap.data() as Record<string, unknown>;
  return {
    id: snap.id,
    authorUid: (d.authorUid as string) ?? '',
    authorName: (d.authorName as string) ?? '알 수 없음',
    authorAvatarUrl: d.authorAvatarUrl as string | undefined,
    body: (d.body as string) ?? '',
    createdAt: toIso(d.createdAt),
    parentCommentId: d.parentCommentId as string | undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// 목록 조회 (페이지네이션)
// ─────────────────────────────────────────────────────────────

export interface LoadHandAnalysisPostsOpts {
  pageSize?: number;
  afterCursor?: QueryDocumentSnapshot | null;
  tag?: string;
}

export async function loadHandAnalysisPosts(
  opts: LoadHandAnalysisPostsOpts = {},
): Promise<{ posts: HandAnalysisPost[]; cursor: QueryDocumentSnapshot | null }> {
  const { pageSize = PAGE_SIZE, afterCursor, tag } = opts;
  try {
    const { getDocs } = await import('firebase/firestore');
    // tag 필터: 클라이언트 필터링 (복합 인덱스 최소화)
    const q = afterCursor
      ? query(
          collection(db, COLLECTION),
          where('status', '==', 'published'),
          orderBy('createdAt', 'desc'),
          startAfter(afterCursor),
          limit(pageSize),
        )
      : query(
          collection(db, COLLECTION),
          where('status', '==', 'published'),
          orderBy('createdAt', 'desc'),
          limit(pageSize),
        );
    const snap = await getDocs(q);
    let posts = snap.docs.map(docToPost);
    if (tag) posts = posts.filter((p) => p.tags.includes(tag));
    const cursor = (snap.docs[snap.docs.length - 1] as QueryDocumentSnapshot | undefined) ?? null;
    return { posts, cursor };
  } catch {
    return { posts: [], cursor: null };
  }
}

// ─────────────────────────────────────────────────────────────
// 단일 게시글 실시간 구독
// ─────────────────────────────────────────────────────────────

export function subscribeHandAnalysisPost(
  postId: string,
  onChange: (post: HandAnalysisPost | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, COLLECTION, postId),
    (snap) => {
      if (!snap.exists()) { onChange(null); return; }
      onChange(docToPost(snap));
    },
    () => onChange(null),
  );
}

// ─────────────────────────────────────────────────────────────
// 게시글 생성
// ─────────────────────────────────────────────────────────────

export interface CreateHandAnalysisPostInput {
  authorUid: string;
  authorName: string;
  authorAvatarUrl?: string;
  title: string;
  body: string;
  imageUrls?: string[];
  position?: string;
  stakeLevel?: string;
  tags?: string[];
}

export async function createHandAnalysisPost(
  input: CreateHandAnalysisPostInput,
): Promise<string> {
  const ref = await addDoc(
    collection(db, COLLECTION),
    stripUndefined({
      authorUid: input.authorUid,
      authorName: input.authorName,
      authorAvatarUrl: input.authorAvatarUrl ?? '',
      title: input.title.trim(),
      body: input.body.trim(),
      imageUrls: input.imageUrls ?? [],
      position: input.position ?? '',
      stakeLevel: input.stakeLevel ?? '',
      tags: (input.tags ?? []).slice(0, 5),
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      status: 'published' as HandPostStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  return ref.id;
}

// ─────────────────────────────────────────────────────────────
// 게시글 수정
// ─────────────────────────────────────────────────────────────

export interface UpdateHandAnalysisPostInput {
  title?: string;
  body?: string;
  imageUrls?: string[];
  position?: string;
  stakeLevel?: string;
  tags?: string[];
}

export async function updateHandAnalysisPost(
  postId: string,
  updates: UpdateHandAnalysisPostInput,
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.title !== undefined) patch.title = updates.title.trim();
  if (updates.body !== undefined) patch.body = updates.body.trim();
  if (updates.imageUrls !== undefined) patch.imageUrls = updates.imageUrls;
  if (updates.position !== undefined) patch.position = updates.position;
  if (updates.stakeLevel !== undefined) patch.stakeLevel = updates.stakeLevel;
  if (updates.tags !== undefined) patch.tags = updates.tags.slice(0, 5);
  await updateDoc(doc(db, COLLECTION, postId), patch);
}

// ─────────────────────────────────────────────────────────────
// 게시글 삭제 (소프트 → status='deleted' + 이미지 정리)
// ─────────────────────────────────────────────────────────────

export async function deleteHandAnalysisPost(postId: string): Promise<void> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, postId));
    if (snap.exists()) {
      const data = snap.data() as { imageUrls?: string[] };
      await Promise.all(
        (data.imageUrls ?? []).map((url) =>
          deleteObject(storageRef(storage, url)).catch(() => {}),
        ),
      );
    }
  } catch {
    // ignore storage 오류
  }
  await updateDoc(doc(db, COLLECTION, postId), {
    status: 'deleted' as HandPostStatus,
    updatedAt: serverTimestamp(),
  });
}

// ─────────────────────────────────────────────────────────────
// 조회수 증가 (fire-and-forget)
// ─────────────────────────────────────────────────────────────

export function bumpViewCount(postId: string): void {
  updateDoc(doc(db, COLLECTION, postId), {
    viewCount: increment(1),
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// 좋아요 토글 (likes/{uid} 서브컬렉션 패턴)
// ─────────────────────────────────────────────────────────────

export async function togglePostLike(postId: string, uid: string): Promise<boolean> {
  const likeRef = doc(db, COLLECTION, postId, 'likes', uid);
  const likeSnap = await getDoc(likeRef);
  const postRef = doc(db, COLLECTION, postId);

  if (likeSnap.exists()) {
    await Promise.all([
      deleteDoc(likeRef),
      updateDoc(postRef, { likeCount: increment(-1) }),
    ]);
    return false; // unliked
  } else {
    await Promise.all([
      setDoc(likeRef, { uid, createdAt: serverTimestamp() }),
      updateDoc(postRef, { likeCount: increment(1) }),
    ]);
    return true; // liked
  }
}

export async function getIsLiked(postId: string, uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, postId, 'likes', uid));
    return snap.exists();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// 댓글
// ─────────────────────────────────────────────────────────────

export function subscribeComments(
  postId: string,
  onChange: (comments: HandComment[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, COLLECTION, postId, 'comments'),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(docToComment)),
    () => onChange([]),
  );
}

export interface AddCommentInput {
  postId: string;
  authorUid: string;
  authorName: string;
  authorAvatarUrl?: string;
  body: string;
  parentCommentId?: string;
}

export async function addComment(input: AddCommentInput): Promise<string> {
  const ref = await addDoc(
    collection(db, COLLECTION, input.postId, 'comments'),
    stripUndefined({
      authorUid: input.authorUid,
      authorName: input.authorName,
      authorAvatarUrl: input.authorAvatarUrl ?? '',
      body: input.body.trim(),
      parentCommentId: input.parentCommentId ?? null,
      createdAt: serverTimestamp(),
    }),
  );
  // commentCount 증가
  await updateDoc(doc(db, COLLECTION, input.postId), {
    commentCount: increment(1),
  }).catch(() => {});
  return ref.id;
}

export async function deleteComment(postId: string, commentId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, postId, 'comments', commentId));
  await updateDoc(doc(db, COLLECTION, postId), {
    commentCount: increment(-1),
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// 이미지 업로드
// ─────────────────────────────────────────────────────────────

export async function uploadHandAnalysisImage(uid: string, file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('이미지는 5MB 이하만 업로드 가능합니다');
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드 가능합니다');
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
  const path = `handAnalysis/${uid}/${ts}-${rand}.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}

export { MAX_IMAGES };
