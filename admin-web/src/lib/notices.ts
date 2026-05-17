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
 * 본사 팝업 공지.
 * - 모바일 진입 시 활성 공지(active=true)들이 슬라이드 팝업으로 표시.
 * - imageUrls가 여러 장이면 한 공지 내부에서 가로 스와이프.
 * - 여러 공지가 동시에 활성화되면 priority desc → createdAt asc 순서로 슬라이드.
 */
export interface Notice {
  id: string;
  title: string;
  body?: string;
  imageUrls: string[];
  active: boolean;
  /** 동시에 여러 공지 활성 시 정렬 순서 (높을수록 먼저). */
  priority: number;
  /** 외부 링크 (선택). 클릭 시 새 창. */
  linkUrl?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

const NOTICES = 'notices';

/** 활성 공지 실시간 구독 — 모바일 팝업이 사용. priority 우선 + 신규 우선. */
export function subscribeActiveNotices(
  onChange: (items: Notice[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    collection(db, NOTICES),
    where('active', '==', true),
    orderBy('priority', 'desc'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Notice, 'id'>) })),
      );
    },
    (e) => onError(e as Error),
  );
}

/** 본사 관리 페이지용 — 전체 공지 (활성/비활성 모두). createdAt desc 정렬. */
export function subscribeAllNotices(
  onChange: (items: Notice[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(collection(db, NOTICES), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Notice, 'id'>) })),
      );
    },
    (e) => onError(e as Error),
  );
}

export async function createNotice(input: {
  title: string;
  body?: string;
  imageUrls?: string[];
  active?: boolean;
  priority?: number;
  linkUrl?: string;
}): Promise<string> {
  const ref = await addDoc(collection(db, NOTICES), {
    title: input.title,
    body: input.body ?? '',
    imageUrls: input.imageUrls ?? [],
    active: input.active ?? true,
    priority: input.priority ?? 0,
    linkUrl: input.linkUrl ?? '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateNotice(
  noticeId: string,
  updates: Partial<Omit<Notice, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  await updateDoc(doc(db, NOTICES, noticeId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteNotice(noticeId: string): Promise<void> {
  // Storage 첨부 이미지 같이 정리 — 실패해도 문서 삭제는 진행.
  try {
    const snap = await getDoc(doc(db, NOTICES, noticeId));
    if (snap.exists()) {
      const data = snap.data() as Notice;
      await Promise.all(
        (data.imageUrls ?? []).map((url) => deleteNoticeImageByUrl(url).catch(() => {})),
      );
    }
  } catch {
    // ignore
  }
  await deleteDoc(doc(db, NOTICES, noticeId));
}

/** 공지 이미지 업로드 → download URL. 5MB 제한 (storage rules). */
export async function uploadNoticeImage(noticeId: string, file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error('이미지는 5MB 이하만 업로드 가능합니다');
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드 가능합니다');
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `notices/${noticeId}/${id}.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}

/** Storage URL로 공지 이미지 삭제. 실패해도 무시(권한 또는 이미 삭제). */
export async function deleteNoticeImageByUrl(url: string): Promise<void> {
  try {
    const fileRef = storageRef(storage, url);
    await deleteObject(fileRef);
  } catch {
    // ignore
  }
}
