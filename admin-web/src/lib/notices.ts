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
  /** 노출 시작 시각. 없으면 즉시 시작. 모바일 팝업은 now>=startAt일 때만 표시. */
  startAt?: Timestamp | null;
  /** 노출 종료 시각. 없으면 무기한. 모바일 팝업은 now<=endAt일 때만 표시.
   *  active 토글을 끄지 않아도 종료일 지나면 자동으로 안 보임. */
  endAt?: Timestamp | null;
  /** 팝업 너비 사이즈. sm: 320, md: 384(기본), lg: 448 (px max-width). */
  size?: 'sm' | 'md' | 'lg';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type NoticeSize = 'sm' | 'md' | 'lg';

/** 노출 기간 안에 있는지 — startAt/endAt 미설정 시 통과. */
export function isNoticeInWindow(n: Notice, nowMs: number = Date.now()): boolean {
  if (n.startAt && typeof n.startAt.toMillis === 'function' && n.startAt.toMillis() > nowMs) return false;
  if (n.endAt && typeof n.endAt.toMillis === 'function' && n.endAt.toMillis() < nowMs) return false;
  return true;
}

const NOTICES = 'notices';

/** 활성 공지 실시간 구독 — 모바일 팝업이 사용. priority 우선 + 신규 우선.
 * v0.1: where + orderBy 단일 사용으로 자동 인덱스만으로 동작.
 * priority 동률 시의 createdAt 정렬은 클라이언트에서 처리.
 * 노출 기간(startAt/endAt) 필터는 클라이언트에서 처리하고 1분마다 재평가해
 * 시작 시각 도달·종료 시각 만료를 자동 반영. */
export function subscribeActiveNotices(
  onChange: (items: Notice[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    collection(db, NOTICES),
    where('active', '==', true),
    orderBy('priority', 'desc'),
  );
  let last: Notice[] = [];
  const emit = () => {
    const inWindow = last.filter((n) => isNoticeInWindow(n));
    inWindow.sort((a, b) => {
      if (a.priority !== b.priority) return (b.priority ?? 0) - (a.priority ?? 0);
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
    onChange(inWindow);
  };
  const unsubFs = onSnapshot(
    q,
    (snap) => {
      last = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Notice, 'id'>) }));
      emit();
    },
    (e) => onError(e as Error),
  );
  const tick = setInterval(emit, 60_000);
  return () => {
    unsubFs();
    clearInterval(tick);
  };
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
  startAt?: Date | null;
  endAt?: Date | null;
  size?: NoticeSize;
}): Promise<string> {
  const ref = await addDoc(collection(db, NOTICES), {
    title: input.title,
    body: input.body ?? '',
    imageUrls: input.imageUrls ?? [],
    active: input.active ?? true,
    priority: input.priority ?? 0,
    linkUrl: input.linkUrl ?? '',
    startAt: input.startAt ? Timestamp.fromDate(input.startAt) : null,
    endAt: input.endAt ? Timestamp.fromDate(input.endAt) : null,
    size: input.size ?? 'md',
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
