'use client';

/**
 * 매장 일별 지표 read 헬퍼 (stores/{storeId}/dailyMetrics/{YYYY-MM-DD}).
 * analytics.ts의 bumpStoreMetric이 매번 daily doc도 동시 increment.
 * 본 모듈은 대시보드 일/주/월 합산 + N일 시계열 그래프용 read 전담.
 */

import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from './firebase';

export interface DailyMetricsDoc {
  date: string; // YYYY-MM-DD
  impressions?: number;
  cardClicks?: number;
  liveOpens?: number;
  directionsClicks?: number;
  phoneClicks?: number;
  favoriteAdds?: number;
}

export type MetricField =
  | 'impressions'
  | 'cardClicks'
  | 'liveOpens'
  | 'directionsClicks'
  | 'phoneClicks'
  | 'favoriteAdds';

/** YYYY-MM-DD (브라우저 로컬 = KST 가정) */
function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** N일 전 ~ 오늘 dateKey 배열 (가장 오래된 것부터) */
export function lastNDaysKeys(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push(dateKey(d));
  }
  return out;
}

/** range [fromKey, toKey] 포함 — daily doc 모두 fetch */
export async function loadDailyMetricsRange(
  storeId: string,
  fromKey: string,
  toKey: string,
): Promise<DailyMetricsDoc[]> {
  const ref = collection(db, 'stores', storeId, 'dailyMetrics');
  const q = query(ref, where('date', '>=', fromKey), where('date', '<=', toKey), orderBy('date', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as DailyMetricsDoc);
}

/** N일 시계열 — 빈 날짜는 0으로 채움 */
export async function loadLastNDays(
  storeId: string,
  n: number,
): Promise<DailyMetricsDoc[]> {
  const keys = lastNDaysKeys(n);
  const docs = await loadDailyMetricsRange(storeId, keys[0]!, keys[keys.length - 1]!);
  const byDate = new Map(docs.map((d) => [d.date, d] as const));
  return keys.map((k) => byDate.get(k) ?? { date: k });
}

/** 합산 헬퍼 — 여러 daily doc의 특정 필드 합 */
export function sumField(docs: DailyMetricsDoc[], field: MetricField): number {
  let total = 0;
  for (const d of docs) total += d[field] ?? 0;
  return total;
}

/** 오늘만 / 이번주(7d) / 이번달(30d) 합산 — daily docs 1번 호출로 모두 계산 */
export interface PeriodTotals {
  today: number;
  week: number;
  month: number;
}

export function periodTotals(
  docs30d: DailyMetricsDoc[],
  field: MetricField,
): PeriodTotals {
  const todayKey = lastNDaysKeys(1)[0]!;
  const last7 = lastNDaysKeys(7);
  // last30 = docs30d 전체 (이미 30일치 fetch했다 가정)
  let today = 0,
    week = 0,
    month = 0;
  const last7Set = new Set(last7);
  for (const d of docs30d) {
    const v = d[field] ?? 0;
    month += v;
    if (last7Set.has(d.date)) week += v;
    if (d.date === todayKey) today += v;
  }
  return { today, week, month };
}
