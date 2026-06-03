/**
 * splashAds — 본사 등록 풀스크린 스플래시 광고
 *
 * 컬렉션: splashAds/{id}
 * - 본사 어드민 페이지(/platform/splash-ads)에서 이미지+기간+가중치로 등록.
 * - 사용자 앱 cold start(/m 진입 직전) 시 활성 광고 1건 픽 → SponsoredSplash 노출.
 * - 광고 0건이면 일반 AppSplash 사용(현재 동작 100% 유지 — fallback 보장).
 * - 활성 윈도우: now ∈ [startsAt, endsAt] && isActive==true.
 * - 여러 건 활성 시 weight 가중 random pick.
 * - impression/click 카운트는 어드민 통계용 (CTR 표시).
 *
 * 정책:
 * - 19+ / 도박 / 상금 직접 노출 콘텐츠 등록 금지 (어드민 폼에 경고 명시).
 * - 광고 라벨("SPONSORED" 또는 "광고") 강제 — 공정거래위 가이드.
 *
 * Storage 경로: splashAds/{id}/{filename}
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { compressImageForUpload } from '@/lib/imageCompress';
import { stripUndefined } from '@/lib/firestoreUtil';

// ─── 타입 ────────────────────────────────────────────────────

export interface SplashAd {
  id: string;
  imageUrl: string;
  imageStoragePath?: string;
  title: string;
  description?: string;
  /** 클릭 시 이동. 비어 있으면 단순 노출만 (자동 dismiss). */
  linkUrl?: string;
  /** 노출 라벨 — 기본값 '광고'. */
  sponsoredLabel?: string;
  startsAt: Timestamp;
  endsAt: Timestamp;
  isActive: boolean;
  /** 동시 활성 광고 가중치 (1~10). 기본 1. */
  weight: number;
  /** 노출 시간 ms (1000~10000). 기본 3000. */
  displayDurationMs: number;
  /** "건너뛰기" 노출 지연 ms (0~5000). 기본 1500. */
  skipAfterMs: number;
  impressions: number;
  clicks: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  createdBy?: string;
}

export const SPLASH_AD_DEFAULTS = {
  weight: 1,
  displayDurationMs: 3000,
  skipAfterMs: 1500,
  sponsoredLabel: '광고',
  isActive: true,
} as const;

// ─── 어드민 구독: 전체 ───────────────────────────────────────

export function subscribeAllSplashAds(
  onData: (ads: SplashAd[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(collection(db, 'splashAds'));
  return onSnapshot(
    q,
    (snap) => {
      const ads = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as SplashAd))
        .sort((a, b) => {
          // 활성 우선 → 시작 시각 내림차순
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          const aStart = a.startsAt?.toMillis() ?? 0;
          const bStart = b.startsAt?.toMillis() ?? 0;
          return bStart - aStart;
        });
      onData(ads);
    },
    (err) => onError?.(err),
  );
}

// ─── 사용자 앱: 활성 광고 1건 픽 (단발 fetch) ─────────────────

/**
 * 현재 시각 기준 활성 광고 1건을 weight 가중 random으로 픽.
 * - 활성 광고 없으면 null.
 * - 한 번 호출하면 cold start 동안만 사용 (구독 안 함 — 깜빡임/번들 무게 방지).
 */
export async function pickActiveSplashAd(): Promise<SplashAd | null> {
  try {
    const snap = await getDocs(
      query(collection(db, 'splashAds'), where('isActive', '==', true)),
    );
    const now = Date.now();
    const candidates = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as SplashAd))
      .filter((ad) => {
        const start = ad.startsAt?.toMillis() ?? 0;
        const end = ad.endsAt?.toMillis() ?? 0;
        return now >= start && now <= end && !!ad.imageUrl;
      });
    if (candidates.length === 0) return null;

    // weight 가중 random
    const totalWeight = candidates.reduce(
      (sum, a) => sum + Math.max(1, a.weight ?? 1),
      0,
    );
    let r = Math.random() * totalWeight;
    for (const ad of candidates) {
      r -= Math.max(1, ad.weight ?? 1);
      if (r <= 0) return ad;
    }
    return candidates[candidates.length - 1];
  } catch {
    return null;
  }
}

// ─── CRUD ─────────────────────────────────────────────────────

export interface CreateSplashAdInput {
  title: string;
  description?: string;
  linkUrl?: string;
  sponsoredLabel?: string;
  startsAt: Timestamp;
  endsAt: Timestamp;
  isActive: boolean;
  weight: number;
  displayDurationMs: number;
  skipAfterMs: number;
  createdBy?: string;
}

/** doc 먼저 생성(이미지 없는 상태), 이후 uploadSplashAdImage로 imageUrl 채움. */
export async function createSplashAd(input: CreateSplashAdInput): Promise<string> {
  const docRef = await addDoc(
    collection(db, 'splashAds'),
    stripUndefined({
      ...input,
      imageUrl: '',
      impressions: 0,
      clicks: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  return docRef.id;
}

export async function updateSplashAd(
  id: string,
  patch: Partial<Omit<SplashAd, 'id' | 'createdAt' | 'impressions' | 'clicks'>>,
): Promise<void> {
  await updateDoc(
    doc(db, 'splashAds', id),
    stripUndefined({ ...patch, updatedAt: serverTimestamp() }) as Record<string, unknown>,
  );
}

export async function deleteSplashAd(ad: SplashAd): Promise<void> {
  // Storage 이미지 best-effort 삭제
  if (ad.imageStoragePath) {
    try {
      await deleteObject(storageRef(storage, ad.imageStoragePath));
    } catch {
      // 이미 삭제됐거나 경로 오류 — 무시 (doc 삭제 우선).
    }
  }
  await deleteDoc(doc(db, 'splashAds', ad.id));
}

// ─── 이미지 업로드 ───────────────────────────────────────────

export async function uploadSplashAdImage(
  adId: string,
  file: File,
): Promise<{ url: string; path: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `splashAds/${adId}/cover.${ext}`;
  file = await compressImageForUpload(file, 2048, 0.9); // 전면 광고 — 고해상도
  const r = storageRef(storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  const url = await getDownloadURL(r);
  return { url, path };
}

// ─── 통계 카운터 (사용자 앱에서 호출) ────────────────────────

export async function bumpSplashAdImpression(adId: string): Promise<void> {
  try {
    await setDoc(
      doc(db, 'splashAds', adId),
      stripUndefined({
        impressions: increment(1),
        updatedAt: serverTimestamp(),
      }) as Record<string, unknown>,
      { merge: true },
    );
  } catch {
    // 카운트 실패는 광고 노출 자체를 막지 않음.
  }
}

export async function bumpSplashAdClick(adId: string): Promise<void> {
  try {
    await setDoc(
      doc(db, 'splashAds', adId),
      stripUndefined({
        clicks: increment(1),
        updatedAt: serverTimestamp(),
      }) as Record<string, unknown>,
      { merge: true },
    );
  } catch {
    // 카운트 실패 무시 — 클릭 이동은 정상 진행.
  }
}

// ─── 단일 fetch (디버그/검증 용) ──────────────────────────────

export async function getSplashAd(id: string): Promise<SplashAd | null> {
  const snap = await getDoc(doc(db, 'splashAds', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as SplashAd;
}
