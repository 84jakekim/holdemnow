'use client';

/**
 * feedConfig — 본사가 운영 중에 조절하는 전역 피드 기본값.
 *
 * 목적 (2026-05-22 신설):
 *  - "오늘의 소식" 채팅방 페이지(/m/posts)의 디폴트 반경, 사용자가 고를 수 있는 옵션을
 *    본사가 코드 배포 없이 실시간 조절하기 위한 단일 진실 원천.
 *  - 모바일 클라이언트는 onSnapshot으로 구독 → 본사가 슬라이더 한 번 움직이면 즉시 반영.
 *
 * 데이터 모델 (meta/feedConfig):
 *  - defaultRadiusKm: number  — 첫 진입 시 기본 반경 (출시 디폴트 100)
 *  - radiusOptions:  number[] — 사용자 드롭다운 선택지 (999=전국)
 *  - updatedAt:      Timestamp
 *  - updatedBy:      string (uid)
 *
 * 변경 이력 (feedConfigHistory/{autoId}):
 *  - 위 4필드 그대로 + 'reason' 옵션 + actorEmail.
 *  - 롤백 용도. 본사 페이지에서 한 줄씩 직전 값으로 되돌리기.
 *
 * Firestore rules:
 *  - meta/* 는 read=public, write=platform_admin (기존 규칙 재사용)
 *  - feedConfigHistory/* 는 platform_admin 전용 read/create (firestore.rules 추가)
 */

import {
  doc,
  collection,
  addDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { stripUndefined } from './firestoreUtil';

export interface FeedConfig {
  /** 채팅방(/m/posts) 첫 진입 디폴트 반경 (km). 999 = 전국. */
  defaultRadiusKm: number;
  /** 드롭다운 선택지. 항상 오름차순 + 999(전국) 포함 권장. */
  radiusOptions: number[];
  updatedAt?: Timestamp;
  updatedBy?: string;
}

/** 본사가 아직 한 번도 저장한 적 없을 때 사용할 안전 디폴트. */
export const FEED_CONFIG_DEFAULT: FeedConfig = {
  defaultRadiusKm: 100,
  radiusOptions: [30, 50, 100, 999],
};

const FEED_CONFIG_REF = doc(db, 'meta', 'feedConfig');
const FEED_CONFIG_HISTORY = collection(db, 'feedConfigHistory');

/** 사용자 앱 어디서든 onSnapshot으로 실시간 구독. */
export function subscribeFeedConfig(
  onChange: (cfg: FeedConfig) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    FEED_CONFIG_REF,
    (snap) => {
      if (!snap.exists()) {
        onChange(FEED_CONFIG_DEFAULT);
        return;
      }
      const data = snap.data() as Partial<FeedConfig>;
      onChange(normalizeConfig(data));
    },
    (e) => {
      onError?.(e as Error);
      onChange(FEED_CONFIG_DEFAULT);
    },
  );
}

/** 한 번만 읽기 (서버 컴포넌트/스크립트용). */
export async function getFeedConfigOnce(): Promise<FeedConfig> {
  try {
    const snap = await getDoc(FEED_CONFIG_REF);
    if (!snap.exists()) return FEED_CONFIG_DEFAULT;
    return normalizeConfig(snap.data() as Partial<FeedConfig>);
  } catch {
    return FEED_CONFIG_DEFAULT;
  }
}

/** 본사 어드민이 저장 — 동시에 history 기록. */
export async function saveFeedConfig(
  next: Pick<FeedConfig, 'defaultRadiusKm' | 'radiusOptions'>,
  meta: { actorUid: string; actorEmail?: string; reason?: string },
): Promise<void> {
  const normalized = normalizeConfig({
    defaultRadiusKm: next.defaultRadiusKm,
    radiusOptions: next.radiusOptions,
  });

  // 변경 전 값 — history 로깅용 (없어도 진행)
  let prev: FeedConfig | null = null;
  try {
    const snap = await getDoc(FEED_CONFIG_REF);
    if (snap.exists()) prev = normalizeConfig(snap.data() as Partial<FeedConfig>);
  } catch {
    // ignore
  }

  await setDoc(
    FEED_CONFIG_REF,
    stripUndefined({
      defaultRadiusKm: normalized.defaultRadiusKm,
      radiusOptions: normalized.radiusOptions,
      updatedAt: serverTimestamp(),
      updatedBy: meta.actorUid,
    }),
    { merge: true },
  );

  // 변경 이력 — silent fail (history가 막혀도 본 설정은 저장됨)
  try {
    await addDoc(
      FEED_CONFIG_HISTORY,
      stripUndefined({
        defaultRadiusKm: normalized.defaultRadiusKm,
        radiusOptions: normalized.radiusOptions,
        previousDefaultRadiusKm: prev?.defaultRadiusKm,
        previousRadiusOptions: prev?.radiusOptions,
        actorUid: meta.actorUid,
        actorEmail: meta.actorEmail ?? '',
        reason: meta.reason ?? '',
        createdAt: serverTimestamp(),
      }),
    );
  } catch {
    // history는 best-effort
  }
}

/** 입력값을 안전한 범위로 정규화 — 본사 페이지/구독 양쪽 공용. */
function normalizeConfig(raw: Partial<FeedConfig>): FeedConfig {
  const def = clampRadius(raw.defaultRadiusKm, FEED_CONFIG_DEFAULT.defaultRadiusKm);
  const opts = Array.isArray(raw.radiusOptions) && raw.radiusOptions.length > 0
    ? Array.from(new Set(raw.radiusOptions.map((n) => clampRadius(n, 100)))).sort((a, b) => a - b)
    : FEED_CONFIG_DEFAULT.radiusOptions;
  // 디폴트가 선택지에 없으면 자동 포함
  if (!opts.includes(def)) opts.push(def);
  opts.sort((a, b) => a - b);
  return {
    defaultRadiusKm: def,
    radiusOptions: opts,
    updatedAt: raw.updatedAt,
    updatedBy: raw.updatedBy,
  };
}

function clampRadius(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  if (n < 1) return 1;
  if (n > 999) return 999;
  return n;
}

/** UI 표시용 — 999는 "전국". */
export function formatRadiusKm(km: number): string {
  if (km >= 999) return '전국';
  return `${km}km`;
}
