'use client';

/**
 * feedConfig — 본사가 운영 중에 조절하는 전역 피드 기본값.
 *
 * 영역(2026-05-23 확장):
 *  1) 채팅방(/m/posts) 디폴트 반경 — defaultRadiusKm / radiusOptions (기존)
 *  2) 인기 매장 섹션 — popularRadius* (신규, PM 확정: 10km/자동확장)
 *  3) 근처 매장 섹션 — nearbyRadius*  (신규, PM 확정: 20km/자동확장)
 *
 * 모바일 클라이언트는 onSnapshot으로 구독 → 본사가 슬라이더 한 번 움직이면 즉시 반영.
 *
 * 데이터 모델 (meta/feedConfig 단일 doc — 컬렉션 path는 출시 후 보존):
 *  - defaultRadiusKm / radiusOptions          (채팅방용, 기존 유지)
 *  - popularRadiusDefaultKm / popularRadiusOptionsKm / popularAutoExpand / popularAutoExpandMaxKm
 *  - nearbyRadiusDefaultKm  / nearbyRadiusOptionsKm  / nearbyAutoExpand  / nearbyAutoExpandMaxKm
 *  - updatedAt / updatedBy
 *
 * 변경 이력 (feedConfigHistory/{autoId}): 위 필드 그대로 + reason/actorEmail 부착.
 *
 * Firestore rules (firebase/firestore.rules):
 *  - meta/feedConfig: read=public, write=platform_admin (기존 규칙 재사용)
 *  - feedConfigHistory/*: platform_admin 전용 read/create (기존)
 *  - platformConfig/{docId}: 별도 영역, 본 파일과 무관 (rules에 이미 존재)
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
  /** 채팅방 드롭다운 선택지. 항상 오름차순 + 999(전국) 포함 권장. */
  radiusOptions: number[];

  // ===== 인기 매장 섹션 (PM 확정 v0.1) =====
  /** 인기 매장 섹션 첫 진입 디폴트 반경 (km). */
  popularRadiusDefaultKm: number;
  /** 인기 매장 드롭다운 선택지 (오름차순, 양수, 중복 제거). */
  popularRadiusOptionsKm: number[];
  /** 결과 없을 시 자동 확장 여부. */
  popularAutoExpand: boolean;
  /** 자동 확장 시 도달 가능한 최대 반경 (km). */
  popularAutoExpandMaxKm: number;

  // ===== 근처 매장 섹션 =====
  nearbyRadiusDefaultKm: number;
  nearbyRadiusOptionsKm: number[];
  nearbyAutoExpand: boolean;
  nearbyAutoExpandMaxKm: number;

  // ===== 지금 LIVE 전체보기 (/m/live) 섹션 (2026-05-27 신설) =====
  /** 지금 LIVE 전체보기 페이지의 카드 노출 반경 (km). */
  liveListRadiusKm: number;
  /** 추후 사용자 토글용 옵션 (현재는 본사 디폴트만 적용). */
  liveListRadiusOptionsKm: number[];

  // ===== 새로 합류한 매장 섹션 (2026-05-29 신설) =====
  /** "🆕 새로 합류한 매장" 섹션 반경 (km). 사용자 위치 기반 필터. */
  newlyJoinedRadiusKm: number;
  /** 추후 사용자 토글용 옵션. */
  newlyJoinedRadiusOptionsKm: number[];

  updatedAt?: Timestamp;
  updatedBy?: string;
}

/** 본사가 아직 한 번도 저장한 적 없을 때 사용할 안전 디폴트. */
export const FEED_CONFIG_DEFAULT: FeedConfig = {
  defaultRadiusKm: 100,
  radiusOptions: [30, 50, 100, 999],

  popularRadiusDefaultKm: 10,
  popularRadiusOptionsKm: [3, 5, 10, 20, 50],
  popularAutoExpand: true,
  popularAutoExpandMaxKm: 50,

  nearbyRadiusDefaultKm: 20,
  nearbyRadiusOptionsKm: [5, 10, 20, 50, 100],
  nearbyAutoExpand: true,
  nearbyAutoExpandMaxKm: 100,

  liveListRadiusKm: 30,
  liveListRadiusOptionsKm: [10, 20, 30, 50, 100],

  newlyJoinedRadiusKm: 30,
  newlyJoinedRadiusOptionsKm: [10, 20, 30, 50, 100],
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

/** 별칭 — 본사 페이지에서 의미상 'load'로 부르고 싶을 때. */
export const loadFeedConfig = getFeedConfigOnce;

/** 저장 가능한 필드만 골라낸 부분 타입 (updatedAt/updatedBy는 서버 측에서 채움). */
export type FeedConfigInput = Partial<
  Omit<FeedConfig, 'updatedAt' | 'updatedBy'>
>;

/**
 * 본사 어드민이 저장 — 동시에 history 기록.
 *
 * 시그니처 호환:
 *  - 기존 호출부는 { defaultRadiusKm, radiusOptions }만 넘겨도 동작.
 *  - 새 필드는 부분 입력 가능 (생략 시 기존 저장값 유지, 둘 다 없으면 default).
 */
export async function saveFeedConfig(
  next: FeedConfigInput,
  meta: { actorUid: string; actorEmail?: string; reason?: string },
): Promise<void> {
  // 변경 전 값 — history 로깅 및 부분 업데이트 머지용
  let prev: FeedConfig = FEED_CONFIG_DEFAULT;
  try {
    const snap = await getDoc(FEED_CONFIG_REF);
    if (snap.exists()) prev = normalizeConfig(snap.data() as Partial<FeedConfig>);
  } catch {
    // ignore — prev는 default
  }

  // prev 위에 next를 머지한 뒤 정규화. 부분 입력이어도 모든 필드가 유효해짐.
  const merged: Partial<FeedConfig> = {
    defaultRadiusKm: next.defaultRadiusKm ?? prev.defaultRadiusKm,
    radiusOptions: next.radiusOptions ?? prev.radiusOptions,

    popularRadiusDefaultKm:
      next.popularRadiusDefaultKm ?? prev.popularRadiusDefaultKm,
    popularRadiusOptionsKm:
      next.popularRadiusOptionsKm ?? prev.popularRadiusOptionsKm,
    popularAutoExpand:
      next.popularAutoExpand ?? prev.popularAutoExpand,
    popularAutoExpandMaxKm:
      next.popularAutoExpandMaxKm ?? prev.popularAutoExpandMaxKm,

    nearbyRadiusDefaultKm:
      next.nearbyRadiusDefaultKm ?? prev.nearbyRadiusDefaultKm,
    nearbyRadiusOptionsKm:
      next.nearbyRadiusOptionsKm ?? prev.nearbyRadiusOptionsKm,
    nearbyAutoExpand:
      next.nearbyAutoExpand ?? prev.nearbyAutoExpand,
    nearbyAutoExpandMaxKm:
      next.nearbyAutoExpandMaxKm ?? prev.nearbyAutoExpandMaxKm,

    liveListRadiusKm: next.liveListRadiusKm ?? prev.liveListRadiusKm,
    liveListRadiusOptionsKm: next.liveListRadiusOptionsKm ?? prev.liveListRadiusOptionsKm,

    newlyJoinedRadiusKm: next.newlyJoinedRadiusKm ?? prev.newlyJoinedRadiusKm,
    newlyJoinedRadiusOptionsKm: next.newlyJoinedRadiusOptionsKm ?? prev.newlyJoinedRadiusOptionsKm,
  };

  const normalized = normalizeConfig(merged);

  await setDoc(
    FEED_CONFIG_REF,
    stripUndefined({
      defaultRadiusKm: normalized.defaultRadiusKm,
      radiusOptions: normalized.radiusOptions,

      popularRadiusDefaultKm: normalized.popularRadiusDefaultKm,
      popularRadiusOptionsKm: normalized.popularRadiusOptionsKm,
      popularAutoExpand: normalized.popularAutoExpand,
      popularAutoExpandMaxKm: normalized.popularAutoExpandMaxKm,

      nearbyRadiusDefaultKm: normalized.nearbyRadiusDefaultKm,
      nearbyRadiusOptionsKm: normalized.nearbyRadiusOptionsKm,
      nearbyAutoExpand: normalized.nearbyAutoExpand,
      nearbyAutoExpandMaxKm: normalized.nearbyAutoExpandMaxKm,

      // 지금 LIVE 전체보기 (2026-05-27 HOTFIX — 저장 누락 버그 fix)
      liveListRadiusKm: normalized.liveListRadiusKm,
      liveListRadiusOptionsKm: normalized.liveListRadiusOptionsKm,

      // 새로 합류한 매장 (2026-05-29 신설)
      newlyJoinedRadiusKm: normalized.newlyJoinedRadiusKm,
      newlyJoinedRadiusOptionsKm: normalized.newlyJoinedRadiusOptionsKm,

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

        popularRadiusDefaultKm: normalized.popularRadiusDefaultKm,
        popularRadiusOptionsKm: normalized.popularRadiusOptionsKm,
        popularAutoExpand: normalized.popularAutoExpand,
        popularAutoExpandMaxKm: normalized.popularAutoExpandMaxKm,

        nearbyRadiusDefaultKm: normalized.nearbyRadiusDefaultKm,
        nearbyRadiusOptionsKm: normalized.nearbyRadiusOptionsKm,
        nearbyAutoExpand: normalized.nearbyAutoExpand,
        nearbyAutoExpandMaxKm: normalized.nearbyAutoExpandMaxKm,

        previousDefaultRadiusKm: prev.defaultRadiusKm,
        previousRadiusOptions: prev.radiusOptions,
        previousPopularRadiusDefaultKm: prev.popularRadiusDefaultKm,
        previousPopularRadiusOptionsKm: prev.popularRadiusOptionsKm,
        previousPopularAutoExpand: prev.popularAutoExpand,
        previousPopularAutoExpandMaxKm: prev.popularAutoExpandMaxKm,
        previousNearbyRadiusDefaultKm: prev.nearbyRadiusDefaultKm,
        previousNearbyRadiusOptionsKm: prev.nearbyRadiusOptionsKm,
        previousNearbyAutoExpand: prev.nearbyAutoExpand,
        previousNearbyAutoExpandMaxKm: prev.nearbyAutoExpandMaxKm,

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

// ─────────────────────────────────────────────────────────────────────────────
// 정규화 — 입력값을 안전한 범위로 강제. 본사 페이지/구독 양쪽 공용.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeConfig(raw: Partial<FeedConfig>): FeedConfig {
  // 채팅방 (기존 로직 보존: 999=전국 포함, defaultRadiusKm이 옵션에 자동 포함)
  const def = clampRadius(raw.defaultRadiusKm, FEED_CONFIG_DEFAULT.defaultRadiusKm, 999);
  const opts =
    Array.isArray(raw.radiusOptions) && raw.radiusOptions.length > 0
      ? sortUniqPositive(
          raw.radiusOptions.map((n) => clampRadius(n, 100, 999)),
        )
      : [...FEED_CONFIG_DEFAULT.radiusOptions];
  if (!opts.includes(def)) opts.push(def);
  opts.sort((a, b) => a - b);

  // 인기 매장
  const popularOpts = sanitizeOptions(
    raw.popularRadiusOptionsKm,
    FEED_CONFIG_DEFAULT.popularRadiusOptionsKm,
  );
  const popularDef = clampRadius(
    raw.popularRadiusDefaultKm,
    FEED_CONFIG_DEFAULT.popularRadiusDefaultKm,
    500,
  );
  const popularMax = clampRadius(
    raw.popularAutoExpandMaxKm,
    FEED_CONFIG_DEFAULT.popularAutoExpandMaxKm,
    500,
  );

  // 근처 매장
  const nearbyOpts = sanitizeOptions(
    raw.nearbyRadiusOptionsKm,
    FEED_CONFIG_DEFAULT.nearbyRadiusOptionsKm,
  );
  const nearbyDef = clampRadius(
    raw.nearbyRadiusDefaultKm,
    FEED_CONFIG_DEFAULT.nearbyRadiusDefaultKm,
    500,
  );
  const nearbyMax = clampRadius(
    raw.nearbyAutoExpandMaxKm,
    FEED_CONFIG_DEFAULT.nearbyAutoExpandMaxKm,
    500,
  );

  return {
    defaultRadiusKm: def,
    radiusOptions: opts,

    popularRadiusDefaultKm: popularDef,
    popularRadiusOptionsKm: popularOpts,
    popularAutoExpand:
      typeof raw.popularAutoExpand === 'boolean'
        ? raw.popularAutoExpand
        : FEED_CONFIG_DEFAULT.popularAutoExpand,
    popularAutoExpandMaxKm: Math.max(popularMax, popularDef),

    nearbyRadiusDefaultKm: nearbyDef,
    nearbyRadiusOptionsKm: nearbyOpts,
    nearbyAutoExpand:
      typeof raw.nearbyAutoExpand === 'boolean'
        ? raw.nearbyAutoExpand
        : FEED_CONFIG_DEFAULT.nearbyAutoExpand,
    nearbyAutoExpandMaxKm: Math.max(nearbyMax, nearbyDef),

    liveListRadiusKm: clampRadius(
      raw.liveListRadiusKm,
      FEED_CONFIG_DEFAULT.liveListRadiusKm,
      500,
    ),
    liveListRadiusOptionsKm: sanitizeOptions(
      raw.liveListRadiusOptionsKm,
      FEED_CONFIG_DEFAULT.liveListRadiusOptionsKm,
    ),

    newlyJoinedRadiusKm: clampRadius(
      raw.newlyJoinedRadiusKm,
      FEED_CONFIG_DEFAULT.newlyJoinedRadiusKm,
      500,
    ),
    newlyJoinedRadiusOptionsKm: sanitizeOptions(
      raw.newlyJoinedRadiusOptionsKm,
      FEED_CONFIG_DEFAULT.newlyJoinedRadiusOptionsKm,
    ),

    updatedAt: raw.updatedAt,
    updatedBy: raw.updatedBy,
  };
}

/** popular/nearby 옵션 배열 정규화: 양수·정수·중복 제거·오름차순. 비면 default fallback. */
function sanitizeOptions(raw: unknown, fallback: number[]): number[] {
  if (!Array.isArray(raw)) return [...fallback];
  const cleaned = sortUniqPositive(
    raw
      .map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => Math.min(n, 500)),
  );
  return cleaned.length > 0 ? cleaned : [...fallback];
}

function sortUniqPositive(arr: number[]): number[] {
  return Array.from(new Set(arr.filter((n) => n > 0))).sort((a, b) => a - b);
}

function clampRadius(v: unknown, fallback: number, max = 999): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  if (n < 1) return 1;
  if (n > max) return max;
  return n;
}

/** UI 표시용 — 999는 "전국". */
export function formatRadiusKm(km: number): string {
  if (km >= 999) return '전국';
  return `${km}km`;
}
