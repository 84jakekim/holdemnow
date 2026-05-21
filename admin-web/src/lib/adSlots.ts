'use client';

/**
 * adSlots — 매장 광고 노출권 (Sprint 3 Phase C, 2026-05-21).
 *
 * 데이터 모델:
 *   /adSlots/{adId}: storeId, tier, startAt, endAt, status, paidAmount, paymentRef,
 *                    region, createdAt, updatedAt, impressions, clicks
 *   /stores/{storeId}: + adTier (캐싱), adActiveUntil (필터링용 timestamp)
 *
 * 정책 (F안 하이브리드 분배):
 *   - 슬롯 8장 구성: Premium 2 + Standard 2 + LIVE 1 + 신생(7일) 1 + 최신 2
 *   - 5분 결정론적 라운드로빈 (epoch 5min bucket 기반)
 *   - 광고 매장 0~1일 때 fallback (LIVE/최신으로 채움)
 *   - 광고 ≤ 50% 캡 엄격 (8장 중 4장 최대)
 *   - 캡 초과 시 대기열 자동 승격 (Premium 30/지역, Standard 100/지역)
 *   - 지역 분리 (regionCode 기반 + GPS 30km 이내)
 *   - 즐겨찾기 매장은 슬롯 0 (맨 앞 추가)
 *
 * v0.1: PG 결제 없음. 본사 어드민 수동 부여(/platform/ads).
 * v0.2: PaymentProvider 어댑터 추가 (필드 paymentRef 사전 확보).
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  increment,
} from 'firebase/firestore';
import { db } from './firebase';
import { stripUndefined } from './firestoreUtil';

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export type AdTier = 'premium' | 'standard';
export type AdStatus = 'pending' | 'active' | 'expired' | 'cancelled';

export interface AdSlot {
  id: string;
  storeId: string;
  storeName?: string;
  tier: AdTier;
  status: AdStatus;
  /** ISO 시작 시각 (활성 전엔 예약) */
  startAt: Timestamp;
  /** ISO 종료 시각 */
  endAt: Timestamp;
  /** 결제 금액 (v0.1=0, 수동 부여) */
  paidAmount: number;
  /** 결제 참조 (v0.2 PG 도입 후 채워짐) */
  paymentRef?: string;
  /** 광역 region 키 ('부산' / '경남' / '서울' 등) — 분리 분배에 사용 */
  region: string;
  /** 노출/클릭 카운트 (Cloud Function aggregate 또는 클라 increment) */
  impressions?: number;
  clicks?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  /** 생성/부여한 본사 관리자 uid (감사 추적) */
  grantedBy?: string;
  /** 부여 메모 (선택) */
  note?: string;
}

// ─────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────

const ADS = 'adSlots';

/** 본사 어드민이 수동으로 광고 슬롯 부여 (v0.1). */
export async function grantAdSlot(input: {
  storeId: string;
  storeName?: string;
  tier: AdTier;
  region: string;
  startAt: Date;
  endAt: Date;
  grantedBy: string;
  note?: string;
}): Promise<string> {
  const now = new Date();
  const status: AdStatus = input.startAt <= now ? 'active' : 'pending';
  const ref = await addDoc(collection(db, ADS), stripUndefined({
    storeId: input.storeId,
    storeName: input.storeName ?? '',
    tier: input.tier,
    status,
    startAt: Timestamp.fromDate(input.startAt),
    endAt: Timestamp.fromDate(input.endAt),
    paidAmount: 0,
    paymentRef: undefined, // v0.2 PG 도입 시 채움
    region: input.region,
    impressions: 0,
    clicks: 0,
    grantedBy: input.grantedBy,
    note: input.note ?? '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  // 활성 즉시인 경우 매장에 캐싱 필드 동기화 — Cloud Function이 처리할 수도 있지만 v0.1은 클라에서.
  if (status === 'active') {
    try {
      await updateDoc(doc(db, 'stores', input.storeId), stripUndefined({
        adTier: input.tier,
        adActiveUntil: Timestamp.fromDate(input.endAt),
        updatedAt: serverTimestamp(),
      }));
    } catch {
      /* 비치명 — Function이 backup으로 처리 */
    }
  }

  return ref.id;
}

export async function cancelAdSlot(adId: string): Promise<void> {
  await updateDoc(doc(db, ADS, adId), stripUndefined({
    status: 'cancelled' as AdStatus,
    updatedAt: serverTimestamp(),
  }));
}

export async function deleteAdSlot(adId: string): Promise<void> {
  await deleteDoc(doc(db, ADS, adId));
}

/** 본사 어드민용 — 모든 슬롯 (관리 페이지) */
export function subscribeAllAdSlots(
  onChange: (items: AdSlot[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(collection(db, ADS), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdSlot, 'id'>) }))),
    (e) => onError(e as Error),
  );
}

/** 활성 슬롯(region + status='active' + endAt > now) — 분배 알고리즘에서 사용. */
export async function loadActiveAdSlotsByRegion(regions: string[]): Promise<AdSlot[]> {
  if (regions.length === 0) return [];
  const now = Timestamp.now();
  const ins = regions.slice(0, 10); // Firestore in 캡
  const q = query(
    collection(db, ADS),
    where('status', '==', 'active'),
    where('region', 'in', ins),
    where('endAt', '>', now),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdSlot, 'id'>) }));
}

/** 노출 카운트 증분 (클라이언트에서 호출). */
export async function trackAdImpression(adId: string): Promise<void> {
  try {
    await updateDoc(doc(db, ADS, adId), {
      impressions: increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch {
    /* ignore */
  }
}

/** 클릭 카운트 증분 — 카드 탭 시 호출. */
export async function trackAdClick(adId: string): Promise<void> {
  try {
    await updateDoc(doc(db, ADS, adId), {
      clicks: increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────
// 분배 알고리즘 (F안 하이브리드)
// ─────────────────────────────────────────────────────────────

export const AD_SLOT_TOTAL = 8;
export const AD_CAP_RATIO = 0.5; // 광고는 최대 50%
export const AD_CAP = Math.floor(AD_SLOT_TOTAL * AD_CAP_RATIO); // 4

/**
 * 5분 결정론적 라운드로빈 시드. epoch min/5 단위.
 * Math.random 대신 결정론적 회전으로, 같은 5분 동안은 어떤 사용자가 봐도 같은 슬롯이 나옴
 * (캐시·통계 분석 일관성). 다음 5분이 되면 한 칸 회전.
 */
export function adRoundRobinSeed(date: Date = new Date()): number {
  return Math.floor(date.getTime() / (5 * 60 * 1000));
}

/** 배열을 seed 기준으로 한 칸 회전. */
function rotate<T>(arr: T[], seed: number): T[] {
  if (arr.length === 0) return arr;
  const k = ((seed % arr.length) + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

export interface SlotEntry {
  kind: 'favorite' | 'premium' | 'standard' | 'live' | 'newcomer' | 'recent';
  storeId: string;
  adId?: string; // tier='premium'|'standard'일 때만
}

export interface AllocateInput {
  regionCode: string;
  premiumAds: AdSlot[];   // 이 region의 active premium 광고
  standardAds: AdSlot[];  // 이 region의 active standard 광고
  liveStoreIds: string[]; // LIVE 운영 중 매장 (region 일치)
  newcomerStoreIds: string[]; // 가입 7일 이내 매장
  recentStoreIds: string[]; // 최근 영업/소식 매장
  favoriteStoreIds: string[]; // 사용자 즐겨찾기 (가장 앞)
  date?: Date;
}

/**
 * 슬롯 8장 분배. 광고 50% 캡, 5분 회전, fallback.
 * 출력은 sequential SlotEntry[]. 즐겨찾기는 별도 head로 prepend (총 9개 가능).
 */
export function allocateAdSlots(input: AllocateInput): SlotEntry[] {
  const seed = adRoundRobinSeed(input.date);
  const slots: SlotEntry[] = [];

  // 1) Favorite — 즐겨찾기 1개 (있으면 맨 앞)
  if (input.favoriteStoreIds.length > 0) {
    const rotFav = rotate(input.favoriteStoreIds, seed);
    slots.push({ kind: 'favorite', storeId: rotFav[0] });
  }

  // 2) 광고 슬롯 — 최대 AD_CAP(4)
  const adSlots: SlotEntry[] = [];
  const rotPrem = rotate(input.premiumAds, seed);
  const rotStd = rotate(input.standardAds, Math.floor(seed / 3));

  // Premium 우선 2개
  for (const ad of rotPrem.slice(0, 2)) {
    if (adSlots.length >= AD_CAP) break;
    adSlots.push({ kind: 'premium', storeId: ad.storeId, adId: ad.id });
  }
  // Standard 2개
  for (const ad of rotStd.slice(0, 2)) {
    if (adSlots.length >= AD_CAP) break;
    adSlots.push({ kind: 'standard', storeId: ad.storeId, adId: ad.id });
  }

  // 3) 유기 슬롯 — LIVE 1 + 신생 1 + 최신 2 = 4 (광고 4와 합쳐 8)
  const organicSlots: SlotEntry[] = [];

  const rotLive = rotate(input.liveStoreIds, seed);
  if (rotLive.length > 0) organicSlots.push({ kind: 'live', storeId: rotLive[0] });

  const rotNew = rotate(input.newcomerStoreIds, seed + 1);
  if (rotNew.length > 0) organicSlots.push({ kind: 'newcomer', storeId: rotNew[0] });

  const rotRecent = rotate(input.recentStoreIds, seed + 2);
  for (const sid of rotRecent.slice(0, 2)) {
    organicSlots.push({ kind: 'recent', storeId: sid });
  }

  // 4) 광고 매장 0~1일 때 fallback — 부족분을 LIVE/최신으로 채움
  const targetTotal = AD_SLOT_TOTAL;
  const used = new Set<string>(adSlots.map((s) => s.storeId));
  const merged: SlotEntry[] = [];

  // 교차 배치 — 광고와 유기를 번갈아 (시각적 다양성)
  let ai = 0, oi = 0;
  while (merged.length < targetTotal && (ai < adSlots.length || oi < organicSlots.length)) {
    if (ai < adSlots.length) {
      const s = adSlots[ai++];
      if (!used.has(s.storeId) || merged.length === 0) {
        used.add(s.storeId);
        merged.push(s);
      }
    }
    if (oi < organicSlots.length && merged.length < targetTotal) {
      const s = organicSlots[oi++];
      if (!used.has(s.storeId)) {
        used.add(s.storeId);
        merged.push(s);
      }
    }
  }

  // 5) 여전히 부족하면 — 광고 0인 경우 LIVE/최신만으로 채움
  if (merged.length < targetTotal) {
    for (const sid of rotLive) {
      if (merged.length >= targetTotal) break;
      if (!used.has(sid)) {
        used.add(sid);
        merged.push({ kind: 'live', storeId: sid });
      }
    }
    for (const sid of rotRecent) {
      if (merged.length >= targetTotal) break;
      if (!used.has(sid)) {
        used.add(sid);
        merged.push({ kind: 'recent', storeId: sid });
      }
    }
  }

  return [...slots, ...merged];
}

// ─────────────────────────────────────────────────────────────
// 대기열 캡 — Premium 30/지역, Standard 100/지역
// ─────────────────────────────────────────────────────────────

export const QUEUE_CAP_PREMIUM = 30;
export const QUEUE_CAP_STANDARD = 100;

/** 해당 region에 활성 + 대기 광고 합산 카운트. 캡 초과 시 본사 어드민에 경고 표시용. */
export async function countAdSlotsByRegion(region: string): Promise<{
  activePremium: number;
  activeStandard: number;
  pendingPremium: number;
  pendingStandard: number;
}> {
  const now = Timestamp.now();
  const snap = await getDocs(
    query(
      collection(db, ADS),
      where('region', '==', region),
      where('endAt', '>', now),
    ),
  );

  let activePremium = 0;
  let activeStandard = 0;
  let pendingPremium = 0;
  let pendingStandard = 0;
  snap.forEach((d) => {
    const a = d.data() as { tier?: AdTier; status?: AdStatus };
    if (a.status === 'active') {
      if (a.tier === 'premium') activePremium++;
      else if (a.tier === 'standard') activeStandard++;
    } else if (a.status === 'pending') {
      if (a.tier === 'premium') pendingPremium++;
      else if (a.tier === 'standard') pendingStandard++;
    }
  });

  return { activePremium, activeStandard, pendingPremium, pendingStandard };
}
