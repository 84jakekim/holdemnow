'use client';

import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { db, storage } from './firebase';
import { stripUndefined } from './firestoreUtil';

export const FACILITY_OPTIONS = [
  '주차', '발렛', '식사', '24시간', '흡연실', '룸', '여성전용시간', 'VIP룸',
];

export async function updateStoreInfo(
  storeId: string,
  updates: {
    name?: string;
    address?: string;
    addressDetail?: string;
    lat?: number;
    lng?: number;
    phone?: string;
    hours?: string;
    description?: string;
    facilities?: string[];
    photoUrls?: string[];
  },
) {
  await updateDoc(doc(db, 'stores', storeId), stripUndefined({
    ...updates,
    updatedAt: serverTimestamp(),
  }));
}

/** 매장 사진 1장 업로드 → download URL 반환 */
export async function uploadStorePhoto(storeId: string, file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('사진은 5MB 이하만 업로드 가능합니다');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 업로드 가능합니다');
  }
  const photoId = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `stores/${storeId}/photos/${photoId}.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}

/** 매장 사진 삭제 (Storage URL 기반) */
export async function deleteStorePhotoByUrl(url: string): Promise<void> {
  try {
    // download URL → reference 직접
    const fileRef = storageRef(storage, url);
    await deleteObject(fileRef);
  } catch (e) {
    // 이미 삭제됐거나 권한 없을 수 있음 — 무시 (URL을 firestore에서 빼면 노출 안 됨)
    console.warn('Storage delete skipped:', e);
  }
}
