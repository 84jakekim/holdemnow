'use client';

import { collection, doc, getDoc, getDocs, Timestamp, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { haversineMeters, type LatLng } from './geo';

/**
 * v0.1 인기 매장 랭킹.
 *
 * 정책 (memory: project_holdemnow_popularity):
 * - score = favoriteAdds×1.0 + directionsClicks×1.0 + liveSessionCount×2.0
 *           + 신규30일부스트(score × 0.3)
 *           − 거리감점(distance_km / 10 × 2.0)
 * - 반경 10km 기본, 결과 < MIN_RESULTS면 20→30km 자동 확장
 * - 가입 24시간 가중치 0 (셀프 어뷰징 견제)
 * - uid dedup은 클라이언트 sessionStorage (analytics.ts), v0.2에서 서버측 dedup으로 강화
 * - LIVE 신호는 stores.liveSessionCount 누적 카운터 사용 (startLiveSession에서 increment)
 */

// 기본값 — 본사 feed-config 미설정 시 사용. config 인자로 덮어쓰기 가능.
const DEFAULT_RADIUS_M = 10_000;
const FALLBACK_EXPAND_STEPS_M = [10_000, 20_000, 50_000] as const;
const MIN_RESULTS = 5;

/** 인기 매장 반경 설정 — feedConfig에서 주입 */
export interface PopularityRadiusConfig {
  /** 기본 반경(km). 자동확장 단계의 첫 값 역할. */
  defaultRadiusKm: number;
  /** 자동확장 단계(km, asc). 자동확장 OFF면 [defaultRadiusKm]만 사용. */
  expandStepsKm: number[];
  /** 자동확장 ON 여부. OFF면 defaultRadiusKm 단일 단계만 시도. */
  autoExpand: boolean;
  /** 자동확장 최대 반경(km). expandStepsKm 중 이 값을 초과하는 단계는 제외. */
  maxKm: number;
}
const TOP_N = 10;
const NEW_BOOST_DAYS = 30;
const NEW_BOOST_FACTOR = 0.3;
const COLD_24H_MS = 24 * 60 * 60 * 1000;

export interface PopularityStore {
  id: string;
  name: string;
  address?: string;
  photoUrls: string[];
  lat?: number;
  lng?: number;
  tier?: string;
  liveSessionCount?: number;
  createdAt?: Timestamp;
  /** 계산된 거리(m) — userLocation 있을 때만 */
  distance?: number;
  /** 인기 점수 — 디버깅/UI에 노출 안 함, 정렬용 */
  _score?: number;
  /** 신규 매장 여부 (가입 30일 이내) */
  isNew?: boolean;
  /** 점수 분해 — 본사 어드민 모니터링 노출용 */
  favoriteAdds?: number;
  directionsClicks?: number;
  /** 본사 어드민 수동 부스트 (가산점). 음수 가능 — 감점도 됨. */
  scoreBoost?: number;
}

interface StoreDocData {
  name: string;
  address?: string;
  photoUrls?: string[];
  lat?: number;
  lng?: number;
  tier?: string;
  status?: string;
  liveSessionCount?: number;
  createdAt?: Timestamp;
  /** 본사 어드민 수동 부스트 */
  scoreBoost?: number;
}

interface MetricsDocData {
  favoriteAdds?: number;
  directionsClicks?: number;
}

/** 활성 매장 + 메트릭 함께 로드. 1시간 캐시는 호출자가 결정 (현재 mount당 1회). */
async function loadActiveStoresWithMetrics(): Promise<{
  store: PopularityStore;
  metrics: MetricsDocData;
}[]> {
  const snap = await getDocs(collection(db, 'stores'));
  const stores = snap.docs
    .map((d) => ({ id: d.id, data: d.data() as StoreDocData }))
    .filter((s) => s.data.status !== 'pending' && s.data.status !== 'rejected');

  // 메트릭은 상위 N개에만 필요하지만, 일단 활성 매장 전체에 대해 병렬 fetch
  // (수백 개 단위까지 감당 가능. 매장 1000+ 시 v0.2 Cloud Function 이관)
  const metricsResults = await Promise.all(
    stores.map((s) =>
      getDoc(doc(db, 'stores', s.id, 'metrics', 'global'))
        .then((m) => (m.exists() ? (m.data() as MetricsDocData) : {}))
        .catch(() => ({} as MetricsDocData)),
    ),
  );

  return stores.map((s, i) => ({
    store: {
      id: s.id,
      name: s.data.name,
      address: s.data.address,
      photoUrls: s.data.photoUrls ?? [],
      lat: s.data.lat,
      lng: s.data.lng,
      tier: s.data.tier,
      liveSessionCount: s.data.liveSessionCount ?? 0,
      createdAt: s.data.createdAt,
      scoreBoost: s.data.scoreBoost ?? 0,
      favoriteAdds: metricsResults[i].favoriteAdds ?? 0,
      directionsClicks: metricsResults[i].directionsClicks ?? 0,
    },
    metrics: metricsResults[i],
  }));
}

function isWithin24h(createdAt?: Timestamp): boolean {
  if (!createdAt) return false;
  return Date.now() - createdAt.toMillis() < COLD_24H_MS;
}

function isNewStore(createdAt?: Timestamp): boolean {
  if (!createdAt) return false;
  return Date.now() - createdAt.toMillis() < NEW_BOOST_DAYS * 24 * 60 * 60 * 1000;
}

function computeBaseScore(metrics: MetricsDocData, liveCount: number, scoreBoost = 0): number {
  const fav = metrics.favoriteAdds ?? 0;
  const dir = metrics.directionsClicks ?? 0;
  return fav * 1.0 + dir * 1.0 + liveCount * 2.0 + scoreBoost;
}

function applyDistancePenalty(score: number, distanceM?: number): number {
  if (distanceM == null) return score;
  const km = distanceM / 1000;
  return score - (km / 10) * 2.0;
}

function applyNewBoost(score: number, createdAt?: Timestamp): number {
  if (!isNewStore(createdAt)) return score;
  return score + score * NEW_BOOST_FACTOR;
}

export interface PopularityResult {
  stores: PopularityStore[];
  /** 실제 사용된 반경(m). 자동 확장됐으면 기본값보다 큼. */
  appliedRadiusM: number;
  /** 자동 확장 발생 여부 — UI에서 "범위를 넓혔어요" 토스트 트리거 */
  expanded: boolean;
}

/**
 * 인기 매장 TOP N 계산.
 * userLocation 없으면 거리감점/반경 필터 없이 누적 점수만으로 정렬.
 */
export async function loadPopularStores(
  userLocation: LatLng | null,
  config?: PopularityRadiusConfig,
): Promise<PopularityResult> {
  const all = await loadActiveStoresWithMetrics();

  // config 정규화 — 첫 단계는 무조건 defaultRadiusKm.
  // autoExpand ON이면 def보다 큰 expandStepsKm 옵션을 추가 단계로(maxKm 이하만).
  // autoExpand OFF면 단일 단계.
  const stepsM: readonly number[] = (() => {
    if (!config) return FALLBACK_EXPAND_STEPS_M;
    const def = Math.max(1, config.defaultRadiusKm);
    const cap = Math.max(def, config.maxKm);
    const steps: number[] = [def];
    if (config.autoExpand) {
      for (const km of config.expandStepsKm) {
        if (km > def && km <= cap && !steps.includes(km)) steps.push(km);
      }
      steps.sort((a, b) => a - b);
    }
    return steps.map((km) => km * 1000);
  })();
  const baseRadiusM = stepsM[0];

  // 좌표 + 거리 부여
  const withDistance = all.map(({ store, metrics }) => {
    const distance =
      userLocation && typeof store.lat === 'number' && typeof store.lng === 'number'
        ? haversineMeters(userLocation, { lat: store.lat, lng: store.lng })
        : undefined;
    return { store: { ...store, distance }, metrics };
  });

  // 위치 없으면 단순 점수 정렬
  if (!userLocation) {
    const scored = withDistance.map(({ store, metrics }) => {
      // 가입 24시간 이내는 신호 무시 (셀프 어뷰징 견제)
      const liveCount = isWithin24h(store.createdAt) ? 0 : (store.liveSessionCount ?? 0);
      const muted = isWithin24h(store.createdAt) ? {} : metrics;
      const base = computeBaseScore(muted, liveCount, store.scoreBoost ?? 0);
      const score = applyNewBoost(base, store.createdAt);
      return { ...store, _score: score, isNew: isNewStore(store.createdAt) };
    });
    scored.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
    return {
      stores: scored.slice(0, TOP_N),
      appliedRadiusM: 0,
      expanded: false,
    };
  }

  // 반경 단계별 시도 — 결과 5개 미만이면 다음 단계로
  for (let i = 0; i < stepsM.length; i++) {
    const radius = stepsM[i];
    const isLast = i === stepsM.length - 1;
    const inRadius = withDistance.filter(
      ({ store }) => store.distance != null && store.distance <= radius,
    );
    if (inRadius.length < MIN_RESULTS && !isLast) {
      continue; // 더 넓게
    }
    const scored = inRadius.map(({ store, metrics }) => {
      const liveCount = isWithin24h(store.createdAt) ? 0 : (store.liveSessionCount ?? 0);
      const muted = isWithin24h(store.createdAt) ? {} : metrics;
      const base = computeBaseScore(muted, liveCount, store.scoreBoost ?? 0);
      const boosted = applyNewBoost(base, store.createdAt);
      const final = applyDistancePenalty(boosted, store.distance);
      return { ...store, _score: final, isNew: isNewStore(store.createdAt) };
    });
    scored.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
    return {
      stores: scored.slice(0, TOP_N),
      appliedRadiusM: radius,
      expanded: radius > baseRadiusM,
    };
  }

  return { stores: [], appliedRadiusM: baseRadiusM, expanded: false };
}

/**
 * "🆕 새로 합류한 매장" 섹션용. 가입 30일 이내, 거리순.
 * 인기 신호와 무관 — 신규 매장 노출 보장.
 */
export async function loadRecentlyJoinedStores(
  userLocation: LatLng | null,
  limitCount = 10,
): Promise<PopularityStore[]> {
  const all = await loadActiveStoresWithMetrics();
  const news = all
    .filter(({ store }) => isNewStore(store.createdAt))
    .map(({ store }) => {
      const distance =
        userLocation && typeof store.lat === 'number' && typeof store.lng === 'number'
          ? haversineMeters(userLocation, { lat: store.lat, lng: store.lng })
          : undefined;
      return { ...store, distance, isNew: true };
    });

  // 위치 있으면 거리순, 없으면 최신 가입순
  news.sort((a, b) => {
    if (userLocation) {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      if (a.distance != null) return -1;
      if (b.distance != null) return 1;
    }
    const aT = a.createdAt?.toMillis() ?? 0;
    const bT = b.createdAt?.toMillis() ?? 0;
    return bT - aT;
  });

  return news.slice(0, limitCount);
}

// ─── 본사 어드민 모니터링 전용 ─────────────────────────────────

/**
 * 본사 어드민 인기 매장 모니터링용 — 활성 매장 전체의 점수 분해 + 최종 점수.
 * 거리감점·반경 필터 X (전국 매장 평탄 비교).
 * 점수 = favoriteAdds + directionsClicks + liveSessionCount×2 + scoreBoost (+ 신규부스트 30%)
 * 가입 24h 이내 매장은 신호 0 처리.
 */
export async function loadAllStoresForMonitor(): Promise<PopularityStore[]> {
  const all = await loadActiveStoresWithMetrics();
  const scored = all.map(({ store, metrics }) => {
    const liveCount = isWithin24h(store.createdAt) ? 0 : (store.liveSessionCount ?? 0);
    const muted = isWithin24h(store.createdAt) ? {} : metrics;
    const base = computeBaseScore(muted, liveCount, store.scoreBoost ?? 0);
    const score = applyNewBoost(base, store.createdAt);
    return { ...store, _score: score, isNew: isNewStore(store.createdAt) };
  });
  scored.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
  return scored;
}

/** 본사 어드민 수동 부스트 저장 — 매장의 scoreBoost 필드 갱신. */
export async function updateScoreBoost(storeId: string, scoreBoost: number): Promise<void> {
  await updateDoc(doc(db, 'stores', storeId), {
    scoreBoost,
    scoreBoostUpdatedAt: serverTimestamp(),
  });
}
