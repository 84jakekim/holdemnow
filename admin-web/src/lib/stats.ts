'use client';

/**
 * 본사 어드민 종합 분석 API.
 *
 * 본사(platform_admin)가 import해서 모든 통계를 한 번에 불러올 수 있게.
 * 모든 함수는 Promise<number> 또는 Promise<{...}> 반환.
 *
 * 정책:
 *  - count 쿼리는 getCountFromServer 사용 (서버 집계, read 비용 적음).
 *  - 베타 규모(<= 수천 docs)에선 클라이언트 집계가 비용·복잡도 트레이드오프상 OK.
 *  - 캐싱은 호출 측(platform-admin 페이지)이 React state로 처리. 여기는 fetch 함수만.
 *  - KST 기준 (Asia/Seoul) — 브라우저 로컬 시간을 그대로 사용 (어드민은 한국에서만 접근 가정).
 *
 * mobile-ux 작업 필요:
 *  - users/{uid}.lastActiveAt 5분 heartbeat 갱신 (실시간 접속자 산정용)
 *
 * 인덱스:
 *  - 단일 필드 inequality (createdAt, lastActiveAt 등)는 자동 인덱스로 충분.
 *  - equality + inequality 조합(status=='active' AND createdAt>=...)은 Firebase가
 *    자동 제안. 첫 호출 시 콘솔 링크가 에러로 뜨면 클릭 한 번에 추가.
 */

import {
  collection,
  collectionGroup,
  query,
  where,
  getCountFromServer,
  getDocs,
  Timestamp,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 시간 범위 헬퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DateRange {
  start: Date;
  end: Date;
}

/** 오늘 00:00:00 ~ 23:59:59.999 (브라우저 로컬 = KST 가정) */
export function rangeToday(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}

/** 이번 주: 월요일 00:00 ~ 일요일 23:59:59.999 */
export function rangeThisWeek(): DateRange {
  const now = new Date();
  const day = now.getDay(); // 0=일, 1=월, ..., 6=토
  // 월요일까지 거슬러 갈 일수 (일요일이면 6일 전, 월요일이면 0일 전)
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMonday, 0, 0, 0, 0);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
  return { start: monday, end: sunday };
}

/** 이번 달: 1일 00:00 ~ 말일 23:59:59.999 */
export function rangeThisMonth(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  // 다음달 0일 = 이번달 말일
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/** 올해: 1/1 00:00 ~ 12/31 23:59:59.999 */
export function rangeThisYear(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end };
}

/** 최근 N일: (now - N일) ~ now */
export function rangeLastNDays(n: number): DateRange {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - n, 0, 0, 0, 0);
  return { start, end };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 공통 count 헬퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function countDocs(
  collectionName: string,
  constraints: QueryConstraint[] = [],
): Promise<number> {
  const q = query(collection(db, collectionName), ...constraints);
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

async function countInRange(
  collectionName: string,
  field: string,
  range: DateRange,
  extraWhere: QueryConstraint[] = [],
): Promise<number> {
  return countDocs(collectionName, [
    where(field, '>=', Timestamp.fromDate(range.start)),
    where(field, '<=', Timestamp.fromDate(range.end)),
    ...extraWhere,
  ]);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 사용자 통계
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UserStats {
  total: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  thisYear: number;
  /** 실시간 접속자 — lastActiveAt >= now - 5min */
  activeNow: number;
  /** 마케팅 푸시 동의 (notificationPrefs.marketing == true) */
  marketingOptIn: number;
  /** FCM 토큰을 1개 이상 보유한 사용자 수 (수신 가능) — 토큰 doc 수의 근사치 */
  withFcmTokens: number;
  byRole: {
    player: number;
    storeOwner: number;
    organizerOwner: number;
    platformAdmin: number;
  };
}

export async function loadUserStats(): Promise<UserStats> {
  const today = rangeToday();
  const week = rangeThisWeek();
  const month = rangeThisMonth();
  const year = rangeThisYear();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const [
    total,
    todayCount,
    weekCount,
    monthCount,
    yearCount,
    activeNow,
    marketingOptIn,
    playerSingle,
    playerArr,
    storeMasterSingle,
    storeMasterArr,
    orgMasterSingle,
    orgMasterArr,
    platformAdminSingle,
    platformAdminArr,
    fcmTokenCount,
  ] = await Promise.all([
    countDocs('users'),
    countInRange('users', 'createdAt', today),
    countInRange('users', 'createdAt', week),
    countInRange('users', 'createdAt', month),
    countInRange('users', 'createdAt', year),
    countDocs('users', [where('lastActiveAt', '>=', Timestamp.fromDate(fiveMinAgo))]).catch(() => 0),
    countDocs('users', [where('notificationPrefs.marketing', '==', true)]).catch(() => 0),
    countDocs('users', [where('role', '==', 'player')]).catch(() => 0),
    countDocs('users', [where('roles', 'array-contains', 'player')]).catch(() => 0),
    countDocs('users', [where('role', '==', 'store_master')]).catch(() => 0),
    countDocs('users', [where('roles', 'array-contains', 'store_master')]).catch(() => 0),
    countDocs('users', [where('role', '==', 'organizer_master')]).catch(() => 0),
    countDocs('users', [where('roles', 'array-contains', 'organizer_master')]).catch(() => 0),
    countDocs('users', [where('role', '==', 'platform_admin')]).catch(() => 0),
    countDocs('users', [where('roles', 'array-contains', 'platform_admin')]).catch(() => 0),
    // fcmTokens 서브컬렉션 — collectionGroup으로 토큰 doc 수 카운트 (사용자 1명이 멀티 디바이스 가능)
    // 정확한 "사용자 수"가 아닌 "토큰 등록 수"의 근사치. 베타 단계는 이걸로 충분.
    (async () => {
      try {
        const snap = await getCountFromServer(query(collectionGroup(db, 'fcmTokens')));
        return snap.data().count;
      } catch {
        return 0;
      }
    })(),
  ]);

  return {
    total,
    today: todayCount,
    thisWeek: weekCount,
    thisMonth: monthCount,
    thisYear: yearCount,
    activeNow,
    marketingOptIn,
    withFcmTokens: fcmTokenCount,
    byRole: {
      // single role + roles 배열 합산 (중복 가능성 있으나 베타 단순화)
      player: playerSingle + playerArr,
      storeOwner: storeMasterSingle + storeMasterArr,
      organizerOwner: orgMasterSingle + orgMasterArr,
      platformAdmin: platformAdminSingle + platformAdminArr,
    },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 매장 통계
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface StoreStats {
  total: number;
  active: number;
  pending: number;
  rejected: number;
  suspended: number;
  isDemo: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  withReviews: number;
  withLiveSessions: number;
  /** 전 매장 가중 평균 평점 (sum(rating*reviewCount) / sum(reviewCount)) */
  avgRating: number;
}

export async function loadStoreStats(): Promise<StoreStats> {
  const today = rangeToday();
  const week = rangeThisWeek();
  const month = rangeThisMonth();

  const [
    total,
    active,
    pending,
    rejected,
    suspended,
    isDemo,
    todayCount,
    weekCount,
    monthCount,
    storesSnap,
  ] = await Promise.all([
    countDocs('stores'),
    countDocs('stores', [where('status', '==', 'active')]).catch(() => 0),
    countDocs('stores', [where('status', '==', 'pending')]).catch(() => 0),
    countDocs('stores', [where('status', '==', 'rejected')]).catch(() => 0),
    countDocs('stores', [where('status', '==', 'suspended')]).catch(() => 0),
    countDocs('stores', [where('isDemo', '==', true)]).catch(() => 0),
    countInRange('stores', 'createdAt', today).catch(() => 0),
    countInRange('stores', 'createdAt', week).catch(() => 0),
    countInRange('stores', 'createdAt', month).catch(() => 0),
    // reviewCount/liveSessionCount/avgRating 집계는 전체 fetch — 베타 규모(<= 수백 매장) 가정
    getDocs(query(collection(db, 'stores'))),
  ]);

  let withReviews = 0;
  let withLiveSessions = 0;
  let weightedRatingSum = 0;
  let weightedRatingDenom = 0;

  storesSnap.forEach((d) => {
    const data = d.data() as {
      reviewCount?: number;
      liveSessionCount?: number;
      averageRating?: number;
    };
    const rc = data.reviewCount ?? 0;
    const lc = data.liveSessionCount ?? 0;
    const ar = data.averageRating ?? 0;
    if (rc > 0) {
      withReviews += 1;
      weightedRatingSum += ar * rc;
      weightedRatingDenom += rc;
    }
    if (lc > 0) withLiveSessions += 1;
  });

  const avgRating = weightedRatingDenom > 0 ? weightedRatingSum / weightedRatingDenom : 0;

  return {
    total,
    active,
    pending,
    rejected,
    suspended,
    isDemo,
    today: todayCount,
    thisWeek: weekCount,
    thisMonth: monthCount,
    withReviews,
    withLiveSessions,
    avgRating,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 대회사 통계
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface OrganizerStats {
  total: number;
  active: number;
  pending: number;
  rejected: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
}

export async function loadOrganizerStats(): Promise<OrganizerStats> {
  const today = rangeToday();
  const week = rangeThisWeek();
  const month = rangeThisMonth();

  const [total, active, pending, rejected, todayCount, weekCount, monthCount] = await Promise.all([
    countDocs('organizers'),
    countDocs('organizers', [where('status', '==', 'active')]).catch(() => 0),
    countDocs('organizers', [where('status', '==', 'pending')]).catch(() => 0),
    countDocs('organizers', [where('status', '==', 'rejected')]).catch(() => 0),
    countInRange('organizers', 'createdAt', today).catch(() => 0),
    countInRange('organizers', 'createdAt', week).catch(() => 0),
    countInRange('organizers', 'createdAt', month).catch(() => 0),
  ]);

  return {
    total,
    active,
    pending,
    rejected,
    today: todayCount,
    thisWeek: weekCount,
    thisMonth: monthCount,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIVE 통계
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface LiveStats {
  currentRunning: number;
  currentReady: number;
  currentPaused: number;
  /** 오늘 완료된 세션 (status='completed' + endedAt 오늘) */
  today: number;
  thisWeek: number;
  thisMonth: number;
  totalCompleted: number;
}

export async function loadLiveStats(): Promise<LiveStats> {
  const today = rangeToday();
  const week = rangeThisWeek();
  const month = rangeThisMonth();

  const [
    currentRunning,
    currentReady,
    currentPaused,
    todayCount,
    weekCount,
    monthCount,
    totalCompleted,
  ] = await Promise.all([
    countDocs('liveSessions', [where('status', '==', 'running')]).catch(() => 0),
    countDocs('liveSessions', [where('status', '==', 'ready')]).catch(() => 0),
    countDocs('liveSessions', [where('status', '==', 'paused')]).catch(() => 0),
    countInRange('liveSessions', 'endedAt', today, [
      where('status', '==', 'completed'),
    ]).catch(() => 0),
    countInRange('liveSessions', 'endedAt', week, [
      where('status', '==', 'completed'),
    ]).catch(() => 0),
    countInRange('liveSessions', 'endedAt', month, [
      where('status', '==', 'completed'),
    ]).catch(() => 0),
    countDocs('liveSessions', [where('status', '==', 'completed')]).catch(() => 0),
  ]);

  return {
    currentRunning,
    currentReady,
    currentPaused,
    today: todayCount,
    thisWeek: weekCount,
    thisMonth: monthCount,
    totalCompleted,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 활성 사용자(DAU/WAU/MAU) + 실가입 활성 매장 — 유료 전환 게이지용
// (2026-06-04 회의: 유료 재노출 트리거 = 활성 매장 ≥40 / 주간 LIVE ≥50 / WAU ≥300 중 2개 + PG)
// lastActiveAt은 사용자앱 5분 heartbeat(lib/heartbeat.ts)가 갱신.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface EngagementStats {
  /** lastActiveAt >= 24시간 전 */
  dau: number;
  /** lastActiveAt >= 7일 전 */
  wau: number;
  /** lastActiveAt >= 30일 전 */
  mau: number;
  /** status='active' AND 데모 제외 — 실제 가입 활성 매장 */
  activeRealStores: number;
}

export async function loadEngagementStats(): Promise<EngagementStats> {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const t1 = Timestamp.fromDate(new Date(now - DAY));
  const t7 = Timestamp.fromDate(new Date(now - 7 * DAY));
  const t30 = Timestamp.fromDate(new Date(now - 30 * DAY));

  const [dau, wau, mau, activeTotal, activeDemo] = await Promise.all([
    countDocs('users', [where('lastActiveAt', '>=', t1)]).catch(() => 0),
    countDocs('users', [where('lastActiveAt', '>=', t7)]).catch(() => 0),
    countDocs('users', [where('lastActiveAt', '>=', t30)]).catch(() => 0),
    countDocs('stores', [where('status', '==', 'active')]).catch(() => 0),
    // 실매장엔 isDemo 필드가 없을 수 있어 ==false 쿼리는 누락 위험 → active 전체 − active 데모 차감.
    // (status, isDemo) 복합 인덱스는 firestore.indexes.json에 이미 존재.
    countDocs('stores', [where('status', '==', 'active'), where('isDemo', '==', true)]).catch(() => 0),
  ]);

  return { dau, wau, mau, activeRealStores: Math.max(0, activeTotal - activeDemo) };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 리뷰 통계
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ReviewStats {
  total: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  /** 전 리뷰 평균 평점 */
  avgRating: number;
  ratingDistribution: { '1': number; '2': number; '3': number; '4': number; '5': number };
}

export async function loadReviewStats(): Promise<ReviewStats> {
  const today = rangeToday();
  const week = rangeThisWeek();
  const month = rangeThisMonth();

  // 리뷰는 stores/{storeId}/reviews 서브컬렉션 — collectionGroup으로 전체 조회.
  // total/today/week/month는 count, 평균/분포는 stores 집계 필드(reviewCount/averageRating)
  // 합산이 더 비용 효율적. 베타에선 stores 전체 fetch + 집계 사용.

  const reviewsGroup = collectionGroup(db, 'reviews');

  const [totalSnap, todaySnap, weekSnap, monthSnap, storesSnap] = await Promise.all([
    getCountFromServer(query(reviewsGroup)).catch(() => ({ data: () => ({ count: 0 }) })),
    getCountFromServer(
      query(
        reviewsGroup,
        where('createdAt', '>=', Timestamp.fromDate(today.start)),
        where('createdAt', '<=', Timestamp.fromDate(today.end)),
      ),
    ).catch(() => ({ data: () => ({ count: 0 }) })),
    getCountFromServer(
      query(
        reviewsGroup,
        where('createdAt', '>=', Timestamp.fromDate(week.start)),
        where('createdAt', '<=', Timestamp.fromDate(week.end)),
      ),
    ).catch(() => ({ data: () => ({ count: 0 }) })),
    getCountFromServer(
      query(
        reviewsGroup,
        where('createdAt', '>=', Timestamp.fromDate(month.start)),
        where('createdAt', '<=', Timestamp.fromDate(month.end)),
      ),
    ).catch(() => ({ data: () => ({ count: 0 }) })),
    getDocs(query(collection(db, 'stores'))),
  ]);

  // 매장 집계에서 평점 분포·평균 합산
  const dist: { '1': number; '2': number; '3': number; '4': number; '5': number } = {
    '1': 0, '2': 0, '3': 0, '4': 0, '5': 0,
  };
  let weightedSum = 0;
  let weightedDenom = 0;

  storesSnap.forEach((d) => {
    const data = d.data() as {
      reviewCount?: number;
      averageRating?: number;
      ratingDistribution?: { '1'?: number; '2'?: number; '3'?: number; '4'?: number; '5'?: number };
    };
    const rc = data.reviewCount ?? 0;
    if (rc > 0) {
      weightedSum += (data.averageRating ?? 0) * rc;
      weightedDenom += rc;
    }
    const rd = data.ratingDistribution;
    if (rd) {
      dist['1'] += rd['1'] ?? 0;
      dist['2'] += rd['2'] ?? 0;
      dist['3'] += rd['3'] ?? 0;
      dist['4'] += rd['4'] ?? 0;
      dist['5'] += rd['5'] ?? 0;
    }
  });

  return {
    total: totalSnap.data().count,
    today: todaySnap.data().count,
    thisWeek: weekSnap.data().count,
    thisMonth: monthSnap.data().count,
    avgRating: weightedDenom > 0 ? weightedSum / weightedDenom : 0,
    ratingDistribution: dist,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 캠페인 통계
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CampaignStats {
  total: number;
  sent: number;
  scheduled: number;
  totalDelivered: number;
  totalRecipients: number;
  /** 평균 도달률 (%) — 전체 sent 캠페인 대상 가중 평균 */
  avgDeliveryRate: number;
}

export async function loadCampaignStats(): Promise<CampaignStats> {
  // total/sent/scheduled는 count 쿼리, delivered/recipients는 sent 전체 fetch + 합산
  const [total, sent, scheduled, sentSnap] = await Promise.all([
    countDocs('platformCampaigns'),
    countDocs('platformCampaigns', [where('status', '==', 'sent')]).catch(() => 0),
    countDocs('platformCampaigns', [where('status', '==', 'scheduled')]).catch(() => 0),
    getDocs(
      query(collection(db, 'platformCampaigns'), where('status', '==', 'sent')),
    ).catch(() => null),
  ]);

  let totalDelivered = 0;
  let totalRecipients = 0;
  if (sentSnap) {
    sentSnap.forEach((d) => {
      const data = d.data() as { deliveredCount?: number; recipientCount?: number };
      totalDelivered += data.deliveredCount ?? 0;
      totalRecipients += data.recipientCount ?? 0;
    });
  }

  const avgDeliveryRate = totalRecipients > 0 ? (totalDelivered / totalRecipients) * 100 : 0;

  return {
    total,
    sent,
    scheduled,
    totalDelivered,
    totalRecipients,
    avgDeliveryRate,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 이벤트(대회) 통계
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface EventStats {
  total: number;
  /** 시작 전 (startDate >= now) */
  upcoming: number;
  /** 진행 중 (startDate <= now <= endDate) */
  ongoing: number;
  thisMonth: number;
}

export async function loadEventStats(): Promise<EventStats> {
  const now = Timestamp.fromDate(new Date());
  const month = rangeThisMonth();

  const [total, upcoming, startedBeforeNow, thisMonthCount] = await Promise.all([
    countDocs('events'),
    countDocs('events', [where('startDate', '>=', now)]).catch(() => 0),
    // ongoing 계산: startDate <= now 인 doc 중 endDate >= now인 것만.
    // Firestore는 동일 쿼리 내 두 필드 inequality 제한 있어 — startDate <= now만 쿼리 후
    // 클라이언트에서 endDate 필터링.
    getDocs(query(collection(db, 'events'), where('startDate', '<=', now))).catch(() => null),
    countInRange('events', 'startDate', month).catch(() => 0),
  ]);

  let ongoing = 0;
  if (startedBeforeNow) {
    const nowMs = Date.now();
    startedBeforeNow.forEach((d) => {
      const data = d.data() as { endDate?: Timestamp };
      // endDate 없으면 단일 일짜 이벤트 — startDate 이후엔 ongoing 취급 안 함 (이미 시작했으므로
      // upcoming 아님, completed로 간주). endDate 있고 아직 안 지났으면 ongoing.
      if (data.endDate && typeof data.endDate.toMillis === 'function') {
        if (data.endDate.toMillis() >= nowMs) ongoing += 1;
      }
    });
  }

  return {
    total,
    upcoming,
    ongoing,
    thisMonth: thisMonthCount,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 시계열 데이터 — 일별 추이 (sparkline·라인 차트용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TimeSeriesPoint {
  /** 'YYYY-MM-DD' (Asia/Seoul 브라우저 로컬 기준) */
  date: string;
  /** 그 날 카운트 */
  value: number;
}

/** 'YYYY-MM-DD' 형식 키 생성 (브라우저 로컬 = KST 가정) */
function formatDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 공통 시계열 빌더 — 한 번에 fetch 후 클라이언트에서 일별 bucket 채우기.
 * 베타 규모(<= 수천 docs/N일)에선 비용·복잡도상 OK.
 */
async function buildTimeSeries(
  collectionPath: string,
  dateField: string,
  days: number,
  isCollectionGroup = false,
  extraWhere: QueryConstraint[] = [],
): Promise<TimeSeriesPoint[]> {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const ref = isCollectionGroup
    ? collectionGroup(db, collectionPath)
    : collection(db, collectionPath);
  const q = query(
    ref,
    where(dateField, '>=', Timestamp.fromDate(start)),
    where(dateField, '<=', Timestamp.fromDate(end)),
    ...extraWhere,
  );
  const snap = await getDocs(q);

  // 일별 bucket 초기화 — N일 전부 0으로 채워두고 발생분만 더하기
  const buckets: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    buckets[formatDateKey(d)] = 0;
  }

  snap.forEach((doc) => {
    const ts = doc.data()[dateField] as Timestamp | undefined;
    if (!ts || typeof ts.toMillis !== 'function') return;
    const key = formatDateKey(ts.toDate());
    if (buckets[key] !== undefined) buckets[key] += 1;
  });

  return Object.entries(buckets)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 최근 N일 일별 신규 가입자 수 (오늘 포함, 가장 옛날부터 정렬) */
export async function loadUsersTimeSeries(days: number): Promise<TimeSeriesPoint[]> {
  return buildTimeSeries('users', 'createdAt', days).catch(() => []);
}

/** 최근 N일 일별 신규 매장 등록 (createdAt 기준) */
export async function loadStoresTimeSeries(days: number): Promise<TimeSeriesPoint[]> {
  return buildTimeSeries('stores', 'createdAt', days).catch(() => []);
}

/** 최근 N일 일별 완료된 LIVE 세션 (endedAt 기준, status='completed') */
export async function loadLiveTimeSeries(days: number): Promise<TimeSeriesPoint[]> {
  return buildTimeSeries('liveSessions', 'endedAt', days, false, [
    where('status', '==', 'completed'),
  ]).catch(() => []);
}

/** 최근 N일 일별 작성된 리뷰 수 (collectionGroup) */
export async function loadReviewsTimeSeries(days: number): Promise<TimeSeriesPoint[]> {
  return buildTimeSeries('reviews', 'createdAt', days, true).catch(() => []);
}

/** 최근 N일 일별 발송 캠페인 수 (status='sent', sentAt 기준) */
export async function loadCampaignsTimeSeries(days: number): Promise<TimeSeriesPoint[]> {
  return buildTimeSeries('platformCampaigns', 'sentAt', days, false, [
    where('status', '==', 'sent'),
  ]).catch(() => []);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 증감률 — 오늘 vs 어제, 이번 주 vs 지난 주
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface GrowthRate {
  current: number;
  previous: number;
  /** +12.5 / -3.2, current==0 && previous==0 이면 0 */
  changePct: number;
  direction: 'up' | 'down' | 'flat';
}

export interface GrowthRates {
  /** 오늘 vs 어제 가입자 */
  usersDaily: GrowthRate;
  /** 이번 주 vs 지난 주 가입자 */
  usersWeekly: GrowthRate;
  storesDaily: GrowthRate;
  storesWeekly: GrowthRate;
  /** 오늘 vs 어제 완료된 LIVE 세션 */
  liveDaily: GrowthRate;
  reviewsDaily: GrowthRate;
}

/** 어제 00:00 ~ 23:59:59.999 */
function rangeYesterday(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
  return { start, end };
}

/** 지난 주 월요일 00:00 ~ 지난 주 일요일 23:59:59.999 */
function rangeLastWeek(): DateRange {
  const thisWeek = rangeThisWeek();
  const start = new Date(thisWeek.start);
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function calcGrowth(current: number, previous: number): GrowthRate {
  let changePct: number;
  if (previous > 0) {
    changePct = ((current - previous) / previous) * 100;
  } else {
    changePct = current > 0 ? 100 : 0;
  }
  // 소수점 한 자리 반올림 (UI 친화적)
  changePct = Math.round(changePct * 10) / 10;
  const direction: 'up' | 'down' | 'flat' =
    changePct > 1 ? 'up' : changePct < -1 ? 'down' : 'flat';
  return { current, previous, changePct, direction };
}

/**
 * 단일 지표 증감 빌더 — current/previous 각각 카운트 후 calcGrowth.
 * 리뷰처럼 collectionGroup이 필요한 경우 isCollectionGroup=true.
 */
async function buildGrowth(
  collectionPath: string,
  dateField: string,
  currentRange: DateRange,
  previousRange: DateRange,
  isCollectionGroup = false,
  extraWhere: QueryConstraint[] = [],
): Promise<GrowthRate> {
  const ref = isCollectionGroup
    ? collectionGroup(db, collectionPath)
    : collection(db, collectionPath);

  const buildQ = (r: DateRange) =>
    query(
      ref,
      where(dateField, '>=', Timestamp.fromDate(r.start)),
      where(dateField, '<=', Timestamp.fromDate(r.end)),
      ...extraWhere,
    );

  const [curSnap, prevSnap] = await Promise.all([
    getCountFromServer(buildQ(currentRange)).catch(() => ({ data: () => ({ count: 0 }) })),
    getCountFromServer(buildQ(previousRange)).catch(() => ({ data: () => ({ count: 0 }) })),
  ]);

  return calcGrowth(curSnap.data().count, prevSnap.data().count);
}

export async function loadGrowthRates(): Promise<GrowthRates> {
  const today = rangeToday();
  const yesterday = rangeYesterday();
  const thisWeek = rangeThisWeek();
  const lastWeek = rangeLastWeek();

  const completedWhere: QueryConstraint[] = [where('status', '==', 'completed')];

  const [
    usersDaily,
    usersWeekly,
    storesDaily,
    storesWeekly,
    liveDaily,
    reviewsDaily,
  ] = await Promise.all([
    buildGrowth('users', 'createdAt', today, yesterday),
    buildGrowth('users', 'createdAt', thisWeek, lastWeek),
    buildGrowth('stores', 'createdAt', today, yesterday),
    buildGrowth('stores', 'createdAt', thisWeek, lastWeek),
    buildGrowth('liveSessions', 'endedAt', today, yesterday, false, completedWhere),
    buildGrowth('reviews', 'createdAt', today, yesterday, true),
  ]);

  return {
    usersDaily,
    usersWeekly,
    storesDaily,
    storesWeekly,
    liveDaily,
    reviewsDaily,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Top N 매장 (v0.1)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TopStore {
  id: string;
  name: string;
  /** 호출 함수가 무슨 지표를 담느냐에 따라 다름 (평점·LIVE 세션 수 등) */
  metric: number;
}

/**
 * 인기 매장 Top N — averageRating 내림차순.
 * 동률 처리·reviewCount 가중치는 베타 단순화로 클라이언트에서 secondary sort.
 * Firestore는 동일 쿼리에 두 orderBy 가능하지만 인덱스 추가 필요 — 일단 클라 sort.
 */
export async function loadTopStoresByRating(limit: number): Promise<TopStore[]> {
  try {
    const { orderBy: fbOrderBy, limit: fbLimit } = await import('firebase/firestore');
    // 평점 기준 상위 N*2 fetch 후 reviewCount 동률 처리 (베타 단순화)
    const fetchN = Math.max(limit * 2, limit);
    const q = query(
      collection(db, 'stores'),
      fbOrderBy('averageRating', 'desc'),
      fbLimit(fetchN),
    );
    const snap = await getDocs(q);
    const rows: Array<TopStore & { reviewCount: number }> = [];
    snap.forEach((d) => {
      const data = d.data() as {
        name?: string;
        averageRating?: number;
        reviewCount?: number;
      };
      rows.push({
        id: d.id,
        name: data.name ?? '(이름 없음)',
        metric: data.averageRating ?? 0,
        reviewCount: data.reviewCount ?? 0,
      });
    });
    rows.sort((a, b) => {
      if (b.metric !== a.metric) return b.metric - a.metric;
      return b.reviewCount - a.reviewCount;
    });
    return rows.slice(0, limit).map(({ id, name, metric }) => ({ id, name, metric }));
  } catch {
    return [];
  }
}

/** 활동 매장 Top N — liveSessionCount 내림차순 */
export async function loadTopStoresByLiveCount(limit: number): Promise<TopStore[]> {
  try {
    const { orderBy: fbOrderBy, limit: fbLimit } = await import('firebase/firestore');
    const q = query(
      collection(db, 'stores'),
      fbOrderBy('liveSessionCount', 'desc'),
      fbLimit(limit),
    );
    const snap = await getDocs(q);
    const rows: TopStore[] = [];
    snap.forEach((d) => {
      const data = d.data() as { name?: string; liveSessionCount?: number };
      rows.push({
        id: d.id,
        name: data.name ?? '(이름 없음)',
        metric: data.liveSessionCount ?? 0,
      });
    });
    return rows;
  } catch {
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 본사 통합: 인기/비인기 매장 Top N (metric별)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 본사 관리에서 임의 메트릭으로 정렬할 수 있는 통합 Top N 타입.
 * - rating / reviewCount / liveSessionCount: stores doc 필드 (orderBy 직접 가능)
 * - cardClicks / impressions / favoriteAdds: stores/{id}/metrics/global 서브 doc 필드
 *   (Firestore는 서브doc 필드로 orderBy 불가 → 전체 fetch 후 클라이언트 정렬)
 */
export type StoreMetricField =
  | 'rating'
  | 'reviewCount'
  | 'liveSessionCount'
  | 'cardClicks'
  | 'impressions'
  | 'favoriteAdds';

const STORE_DOC_FIELDS: ReadonlySet<StoreMetricField> = new Set<StoreMetricField>([
  'rating',
  'reviewCount',
  'liveSessionCount',
]);

/**
 * 인기/비인기 매장 Top N (metric별).
 * ascending=true 이면 가장 낮은 순(비인기 매장 발굴용).
 *
 * 구현:
 *  - rating/reviewCount/liveSessionCount: orderBy + limit (인덱스 자동 생성).
 *    rating은 stores doc의 `averageRating` 필드를 사용.
 *  - cardClicks/impressions/favoriteAdds: 모든 매장의 metrics/global 병렬 fetch 후 정렬.
 *    베타 규모(< 수백 매장) 가정.
 */
export async function loadTopStoresByMetric(
  metric: StoreMetricField,
  limit: number,
  ascending = false,
): Promise<TopStore[]> {
  if (limit <= 0) return [];
  const direction: 'asc' | 'desc' = ascending ? 'asc' : 'desc';

  // 1) stores doc 필드 — orderBy 직접 사용
  if (STORE_DOC_FIELDS.has(metric)) {
    try {
      const { orderBy: fbOrderBy, limit: fbLimit } = await import('firebase/firestore');
      // 'rating'은 실제 doc 필드명은 'averageRating'
      const docField = metric === 'rating' ? 'averageRating' : metric;
      const q = query(
        collection(db, 'stores'),
        fbOrderBy(docField, direction),
        fbLimit(limit),
      );
      const snap = await getDocs(q);
      const rows: TopStore[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const v = data[docField];
        rows.push({
          id: d.id,
          name: (data.name as string) ?? '(이름 없음)',
          metric: typeof v === 'number' ? v : 0,
        });
      });
      return rows;
    } catch {
      return [];
    }
  }

  // 2) metrics/global 서브doc 필드 — 전체 fetch 후 클라 정렬
  try {
    const storesSnap = await getDocs(query(collection(db, 'stores')));
    const stores: Array<{ id: string; name: string }> = [];
    storesSnap.forEach((d) => {
      const data = d.data() as { name?: string };
      stores.push({ id: d.id, name: data.name ?? '(이름 없음)' });
    });

    const results = await Promise.all(
      stores.map(async (s) => {
        try {
          const { doc: fbDoc, getDoc: fbGetDoc } = await import('firebase/firestore');
          const mSnap = await fbGetDoc(fbDoc(db, 'stores', s.id, 'metrics', 'global'));
          const m = (mSnap.exists() ? mSnap.data() : {}) as Record<string, unknown>;
          const v = m[metric];
          return {
            id: s.id,
            name: s.name,
            metric: typeof v === 'number' ? v : 0,
          };
        } catch {
          return { id: s.id, name: s.name, metric: 0 };
        }
      }),
    );

    results.sort((a, b) => (ascending ? a.metric - b.metric : b.metric - a.metric));
    return results.slice(0, limit);
  } catch {
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 본사 통합: 전 매장 누적 메트릭 행 (대시보드·매장 분석)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface StoreMetricsRow {
  storeId: string;
  storeName: string;
  impressions: number;
  cardClicks: number;
  liveOpens: number;
  directionsClicks: number;
  phoneClicks: number;
  favoriteAdds: number;
  rating: number;
  reviewCount: number;
  liveSessionCount: number;
}

/**
 * 전 매장 누적 메트릭 (stores doc + analytics metrics/global 결합).
 * 본사 대시보드·매장 분석 페이지에서 한 번에 다운로드해 정렬·필터.
 * 베타 규모(< 수백 매장)에선 전체 병렬 fetch가 단순·충분.
 */
export async function loadAllStoresMetrics(): Promise<StoreMetricsRow[]> {
  try {
    const storesSnap = await getDocs(query(collection(db, 'stores')));
    const stores: Array<{
      id: string;
      name: string;
      rating: number;
      reviewCount: number;
      liveSessionCount: number;
    }> = [];
    storesSnap.forEach((d) => {
      const data = d.data() as {
        name?: string;
        averageRating?: number;
        reviewCount?: number;
        liveSessionCount?: number;
      };
      stores.push({
        id: d.id,
        name: data.name ?? '(이름 없음)',
        rating: data.averageRating ?? 0,
        reviewCount: data.reviewCount ?? 0,
        liveSessionCount: data.liveSessionCount ?? 0,
      });
    });

    const { doc: fbDoc, getDoc: fbGetDoc } = await import('firebase/firestore');

    const rows = await Promise.all(
      stores.map(async (s): Promise<StoreMetricsRow> => {
        let m: Record<string, unknown> = {};
        try {
          const mSnap = await fbGetDoc(fbDoc(db, 'stores', s.id, 'metrics', 'global'));
          if (mSnap.exists()) m = mSnap.data() as Record<string, unknown>;
        } catch {
          // metrics 없으면 0
        }
        const num = (k: string): number => {
          const v = m[k];
          return typeof v === 'number' ? v : 0;
        };
        return {
          storeId: s.id,
          storeName: s.name,
          impressions: num('impressions'),
          cardClicks: num('cardClicks'),
          liveOpens: num('liveOpens'),
          directionsClicks: num('directionsClicks'),
          phoneClicks: num('phoneClicks'),
          favoriteAdds: num('favoriteAdds'),
          rating: s.rating,
          reviewCount: s.reviewCount,
          liveSessionCount: s.liveSessionCount,
        };
      }),
    );

    return rows;
  } catch {
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 본사 통합: 최근 가입 사용자 N명 (사용자 관리)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UserSummary {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  role?: string | null;
  roles?: string[];
  createdAt?: { toDate(): Date } | null;
  lastActiveAt?: { toDate(): Date } | null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 지역 분석 (본사 BI — 영업·마케팅 의사결정용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 한국 주소에서 광역 단위 추출.
 * 예) "부산광역시 부산진구..." → "부산"
 *     "서울특별시 강남구..." → "서울"
 *     "경기도 성남시..." → "경기"
 *     "제주특별자치도 ..." → "제주"
 */
export function regionFromAddress(address?: string | null): string {
  if (!address) return '미분류';
  const first = address.trim().split(/\s+/)[0];
  if (!first) return '미분류';
  if (first.includes('광역시') || first.includes('특별시') || first.includes('특별자치시')) {
    return first.slice(0, 2);
  }
  if (first.includes('특별자치도')) return first.slice(0, 2);
  if (first.endsWith('도') && first.length >= 2) return first.replace(/도$/, '');
  return first.slice(0, 4);
}

export interface RegionDistribution {
  /** '부산' / '서울' / '경기' / '미분류' */
  region: string;
  count: number;
}

/**
 * 정렬된 RegionDistribution 배열 빌더 — Map<region, count>에서 내림차순 배열로.
 */
function toSortedDistribution(map: Map<string, number>): RegionDistribution[] {
  return Array.from(map.entries())
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 지역별 매장 수 분포.
 * 매장 status='active' || isDemo=true 만 카운트.
 */
export async function loadStoreRegionDistribution(): Promise<RegionDistribution[]> {
  try {
    const snap = await getDocs(query(collection(db, 'stores')));
    const buckets = new Map<string, number>();
    snap.forEach((d) => {
      const data = d.data() as {
        address?: string | null;
        status?: string;
        isDemo?: boolean;
      };
      const isVisible = data.status === 'active' || data.isDemo === true;
      if (!isVisible) return;
      const region = regionFromAddress(data.address);
      buckets.set(region, (buckets.get(region) ?? 0) + 1);
    });
    return toSortedDistribution(buckets);
  } catch {
    return [];
  }
}

/**
 * 사용자별 "주 활동 지역" 추정 — 즐겨찾기 매장들의 region 중 최다 빈도.
 * 즐겨찾기 없는 사용자는 '미분류'.
 *
 * 구현 비용: 모든 favorites(collectionGroup) + 모든 stores fetch. 베타 규모(< 수천 사용자) OK.
 */
export async function loadUserRegionDistribution(): Promise<RegionDistribution[]> {
  try {
    // 1) stores 전체 → storeId → region 매핑
    const storesSnap = await getDocs(query(collection(db, 'stores')));
    const storeRegion = new Map<string, string>();
    storesSnap.forEach((d) => {
      const data = d.data() as { address?: string | null };
      storeRegion.set(d.id, regionFromAddress(data.address));
    });

    // 2) collectionGroup('favorites') → uid + storeId 추출
    //    Firestore path: users/{uid}/favorites/{storeId}
    const favsSnap = await getDocs(query(collectionGroup(db, 'favorites')));
    // uid → (region → count)
    const userRegionCounts = new Map<string, Map<string, number>>();
    const totalUsers = new Set<string>();

    favsSnap.forEach((d) => {
      const ref = d.ref;
      const parent = ref.parent.parent; // users/{uid}
      if (!parent) return;
      const uid = parent.id;
      totalUsers.add(uid);
      const storeId = d.id;
      const region = storeRegion.get(storeId) ?? '미분류';
      let inner = userRegionCounts.get(uid);
      if (!inner) {
        inner = new Map<string, number>();
        userRegionCounts.set(uid, inner);
      }
      inner.set(region, (inner.get(region) ?? 0) + 1);
    });

    // 3) uid별 최다 region 선정
    const regionTotals = new Map<string, number>();
    userRegionCounts.forEach((inner) => {
      let best = '미분류';
      let bestCount = -1;
      inner.forEach((count, region) => {
        if (count > bestCount) {
          best = region;
          bestCount = count;
        }
      });
      regionTotals.set(best, (regionTotals.get(best) ?? 0) + 1);
    });

    // 4) 즐겨찾기 없는 사용자 → '미분류'에 합산
    //    전체 users count → 즐겨찾기 보유자 수
    try {
      const usersCount = await countDocs('users');
      const uncategorized = Math.max(0, usersCount - totalUsers.size);
      if (uncategorized > 0) {
        regionTotals.set('미분류', (regionTotals.get('미분류') ?? 0) + uncategorized);
      }
    } catch {
      // users count 실패 시 — 즐겨찾기 기반 분포만 반환
    }

    return toSortedDistribution(regionTotals);
  } catch {
    return [];
  }
}

/**
 * 지역별 LIVE 누적 운영 (매장 liveSessionCount 합산).
 * 활동성 지표 — 지역별 시장 활성도.
 */
export async function loadLiveRegionDistribution(): Promise<RegionDistribution[]> {
  try {
    const snap = await getDocs(query(collection(db, 'stores')));
    const buckets = new Map<string, number>();
    snap.forEach((d) => {
      const data = d.data() as {
        address?: string | null;
        liveSessionCount?: number;
      };
      const region = regionFromAddress(data.address);
      const lc = data.liveSessionCount ?? 0;
      if (lc <= 0) return;
      buckets.set(region, (buckets.get(region) ?? 0) + lc);
    });
    return toSortedDistribution(buckets);
  } catch {
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 지역별 영업 우선순위 매트릭스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RegionOpportunity {
  region: string;
  /** 그 지역 사용자 수 (즐겨찾기 기반 추정) */
  userCount: number;
  /** 그 지역 매장 수 (active || isDemo) */
  storeCount: number;
  /** 매장당 사용자 비율 — 높을수록 매장 부족 = 영업 기회 */
  userToStoreRatio: number;
  /** 누적 LIVE 세션 (활성도) */
  liveSessionsTotal: number;
  /** 0~100 — 매장 부족 + 사용자 많음 + 활성도 가중 조합 */
  opportunityScore: number;
}

/**
 * 지역별 영업 기회 분석.
 *
 * opportunityScore 계산:
 *  - normUser  = userCount / maxUserCount
 *  - normRatio = (userCount / max(storeCount, 1)) / maxRatio   ← 매장 부족 정도
 *  - normLive  = liveSessionsTotal / max(maxLive, 1)           ← 시장 활성도 (보너스)
 *  - 가중 평균: 0.4 * normUser + 0.5 * normRatio + 0.1 * normLive
 *  - 결과를 0~100 스케일.
 *
 * "사용자는 많은데 매장이 적은" 지역일수록 점수 높음.
 */
export async function loadRegionOpportunities(): Promise<RegionOpportunity[]> {
  try {
    const [storeDist, userDist, liveDist] = await Promise.all([
      loadStoreRegionDistribution(),
      loadUserRegionDistribution(),
      loadLiveRegionDistribution(),
    ]);

    const storeMap = new Map(storeDist.map((r) => [r.region, r.count]));
    const userMap = new Map(userDist.map((r) => [r.region, r.count]));
    const liveMap = new Map(liveDist.map((r) => [r.region, r.count]));

    const regions = new Set<string>([
      ...storeMap.keys(),
      ...userMap.keys(),
      ...liveMap.keys(),
    ]);

    const rows = Array.from(regions).map((region) => {
      const userCount = userMap.get(region) ?? 0;
      const storeCount = storeMap.get(region) ?? 0;
      const liveSessionsTotal = liveMap.get(region) ?? 0;
      const userToStoreRatio = userCount / Math.max(storeCount, 1);
      return {
        region,
        userCount,
        storeCount,
        userToStoreRatio,
        liveSessionsTotal,
        opportunityScore: 0,
      };
    });

    const maxUser = Math.max(1, ...rows.map((r) => r.userCount));
    const maxRatio = Math.max(1, ...rows.map((r) => r.userToStoreRatio));
    const maxLive = Math.max(1, ...rows.map((r) => r.liveSessionsTotal));

    rows.forEach((r) => {
      const normUser = r.userCount / maxUser;
      const normRatio = r.userToStoreRatio / maxRatio;
      const normLive = r.liveSessionsTotal / maxLive;
      const score = 0.4 * normUser + 0.5 * normRatio + 0.1 * normLive;
      r.opportunityScore = Math.round(score * 1000) / 10; // 0~100, 소수 1자리
    });

    rows.sort((a, b) => b.opportunityScore - a.opportunityScore);
    return rows;
  } catch {
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 지역별 시계열 — 어느 지역 가입자 증가 추세인가
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RegionTimeSeries {
  region: string;
  series: TimeSeriesPoint[];
}

/**
 * 최근 N일 지역별 신규 사용자 추이.
 *
 * 지역 추정은 가입 시점이 아닌 "현재 즐겨찾기" 기반 — 정밀도 한계 있음 (베타 단순화).
 * 향후 사용자에 region 필드 저장하면 정확도 개선 가능.
 *
 * 구현:
 *  - stores fetch → storeId → region 매핑
 *  - collectionGroup('favorites') fetch → uid별 region 추정
 *  - users createdAt >= now-N일 fetch → 일별 bucket + region 카운트
 *  - 결과: region별 series (오래된 날짜 → 최신 날짜 정렬)
 */
export async function loadUserRegionTimeSeries(days: number): Promise<RegionTimeSeries[]> {
  try {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    // 1) stores → region 매핑
    const storesSnap = await getDocs(query(collection(db, 'stores')));
    const storeRegion = new Map<string, string>();
    storesSnap.forEach((d) => {
      const data = d.data() as { address?: string | null };
      storeRegion.set(d.id, regionFromAddress(data.address));
    });

    // 2) favorites → uid → 최다 region
    const favsSnap = await getDocs(query(collectionGroup(db, 'favorites')));
    const userRegionCounts = new Map<string, Map<string, number>>();
    favsSnap.forEach((d) => {
      const parent = d.ref.parent.parent;
      if (!parent) return;
      const uid = parent.id;
      const region = storeRegion.get(d.id) ?? '미분류';
      let inner = userRegionCounts.get(uid);
      if (!inner) {
        inner = new Map<string, number>();
        userRegionCounts.set(uid, inner);
      }
      inner.set(region, (inner.get(region) ?? 0) + 1);
    });
    const userRegion = new Map<string, string>();
    userRegionCounts.forEach((inner, uid) => {
      let best = '미분류';
      let bestCount = -1;
      inner.forEach((count, region) => {
        if (count > bestCount) {
          best = region;
          bestCount = count;
        }
      });
      userRegion.set(uid, best);
    });

    // 3) 최근 N일 가입자 fetch
    const usersSnap = await getDocs(
      query(
        collection(db, 'users'),
        where('createdAt', '>=', Timestamp.fromDate(start)),
        where('createdAt', '<=', Timestamp.fromDate(end)),
      ),
    );

    // region → date(YYYY-MM-DD) → count
    const grid = new Map<string, Map<string, number>>();
    // 모든 region에 대해 일별 0 bucket 초기화 함수
    const initBuckets = (region: string) => {
      let inner = grid.get(region);
      if (!inner) {
        inner = new Map<string, number>();
        for (let i = 0; i < days; i++) {
          const d = new Date(start);
          d.setDate(d.getDate() + i);
          inner.set(formatDateKey(d), 0);
        }
        grid.set(region, inner);
      }
      return inner;
    };

    usersSnap.forEach((d) => {
      const data = d.data() as { createdAt?: Timestamp };
      if (!data.createdAt || typeof data.createdAt.toMillis !== 'function') return;
      const dateKey = formatDateKey(data.createdAt.toDate());
      const region = userRegion.get(d.id) ?? '미분류';
      const inner = initBuckets(region);
      if (inner.has(dateKey)) {
        inner.set(dateKey, (inner.get(dateKey) ?? 0) + 1);
      }
    });

    const intermediate: Array<{ region: string; series: TimeSeriesPoint[]; total: number }> = [];
    grid.forEach((inner, region) => {
      const series = Array.from(inner.entries())
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const total = series.reduce((acc, p) => acc + p.value, 0);
      intermediate.push({ region, series, total });
    });

    // 누적 신규 가입자가 많은 지역 우선
    intermediate.sort((a, b) => b.total - a.total);
    return intermediate.map(({ region, series }) => ({ region, series }));
  } catch {
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 최근 가입 사용자 (사용자 관리)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 최근 가입 사용자 N명 — 본사 사용자 관리 페이지용.
 * users 컬렉션 createdAt 내림차순 (자동 인덱스).
 */
export async function loadRecentUsers(limit: number): Promise<UserSummary[]> {
  if (limit <= 0) return [];
  try {
    const { orderBy: fbOrderBy, limit: fbLimit } = await import('firebase/firestore');
    const q = query(
      collection(db, 'users'),
      fbOrderBy('createdAt', 'desc'),
      fbLimit(limit),
    );
    const snap = await getDocs(q);
    const rows: UserSummary[] = [];
    snap.forEach((d) => {
      const data = d.data() as {
        displayName?: string | null;
        email?: string | null;
        role?: string | null;
        roles?: string[];
        createdAt?: Timestamp | null;
        lastActiveAt?: Timestamp | null;
      };
      rows.push({
        uid: d.id,
        displayName: data.displayName ?? null,
        email: data.email ?? null,
        role: data.role ?? null,
        roles: Array.isArray(data.roles) ? data.roles : [],
        createdAt: data.createdAt ?? null,
        lastActiveAt: data.lastActiveAt ?? null,
      });
    });
    return rows;
  } catch {
    return [];
  }
}
