'use client';

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  getDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { stripUndefined } from './firestoreUtil';

export interface BlindLevel {
  level: number;
  sb: number;
  bb: number;
  ante: number;
  durationSec: number;
  isBreak?: boolean;
}

export type TournamentType =
  | 'freezeout'
  | 'rebuy'
  | 'turbo'
  | 'bounty'
  | 'satellite'
  | 'cash';

/** 앤티 적용 방식 — Phase 4 (2026-05-21).
 *  사용자 요구: "엔티적용시 SB 금액 / BB 금액 / 직접입력 중 선택".
 *  - 'sb': 각 레벨의 ante = sb (자동, 입력 비활성)
 *  - 'bb': 각 레벨의 ante = bb (자동, 입력 비활성)
 *  - 'manual': 각 레벨마다 직접 입력 (기존 방식, BB의 1/10 추천값 자동 채움)
 *  디폴트: 'manual' (기존 템플릿 호환). */
export type AnteMode = 'sb' | 'bb' | 'manual';

/** 상금 표시 단위 — Phase 4 (2026-05-21).
 *  사용자 요구: "금액으로 표시할것인지 티켓으로 표시할것인지 선택".
 *  - 'amount': "27만원" 형식 (₩ 기호 사용 안 함)
 *  - 'ticket': "27T" 형식 (1T = 10,000원 기준)
 *  디폴트: 'ticket' (입력 단위와 일관). */
export type PrizeDisplayUnit = 'amount' | 'ticket';

export interface TournamentTemplate {
  id: string;
  name: string;
  type: TournamentType;
  buyIn: number;
  guarantee: number;
  totalPlayers: number;
  prizePool: number;
  startingStack: number;
  lateRegEndLevel: number;
  posterStyle: string;
  blindStructure: BlindLevel[];
  /** 앤티 사용 여부 토글. OFF면 저장 시 모든 레벨 ante=0. */
  anteEnabled?: boolean;
  /** 앤티 적용 방식 — sb/bb/manual. 디폴트 'manual'.
   *  anteEnabled=true일 때만 의미 있음. 'sb'/'bb'면 저장 시점에 각 레벨 ante = sb 또는 bb로 강제. */
  anteMode?: AnteMode;
  /** 사장님이 자주 쓰는 템플릿 ★ 표시 — TournamentControlCenter 좌측 사이드의 빠른 선택용 */
  favorite?: boolean;
  /** 마지막으로 LIVE 시작에 사용된 시각 — recent 정렬에 사용 (Timestamp.toMillis 호환 number) */
  lastUsedAt?: number;
  /** 상금 분배표 — Phase 2.
   *  ITM(In The Money) 기준 1~N등 비율 분배. 매장 TV·어드민 전용 노출, 사용자 앱에는 노출 안 됨.
   *  payouts.length 등수만큼. ratio는 [0,1] 합계 1.0. preset='auto'면 ITM 자동 계산. */
  prizeDistribution?: PrizeDistribution;
  /** 상금풀 분배 정책 — Phase 3 (2026-05-21).
   *  사용자 요구: "탑 헤비 / 스탠다드 / 균등 + 시상등수 + 참가비 자동 계산".
   *  설정되지 않으면 기존 prizePool 수동 입력 + computeAutoITM fallback. */
  payoutStructure?: PayoutStructure;
  /** 상금 표시 단위 — Phase 4 (2026-05-21). 매장 TV·어드민 분배표/프라이즈풀 표기에 사용.
   *  사용자 모바일 앱(/m/*)은 어떤 상금 정보도 표시하지 않으므로 영향 없음. 디폴트 'ticket'. */
  prizeDisplayUnit?: PrizeDisplayUnit;
  /** 매장 TV 디스플레이에 프라이즈풀(우측 stat 카드)을 노출할지 여부 — 2026-05-23.
   *  사용자 정책: "프라이즈풀을 화면에 표시할지말지는 선택사항으로 언제든 넣었다 뺏다".
   *  필수 설정은 name(스트럭쳐 이름)과 blindStructure뿐. showPrizePool 포함 그 외 노출 옵션은 선택.
   *  - true (디폴트, 기존 데이터 호환): TV 우측 stat에 PRIZE POOL 표시
   *  - false: PRIZE POOL 카드 자체 숨김 (PLAYERS / LATE REG만 노출)
   *  사용자 모바일 앱(/m/*)은 어떤 상금도 노출 안 하므로 영향 없음. */
  showPrizePool?: boolean;
}

/**
 * 기존 데이터(showPrizePool 누락)는 true로 추론 — 백워드 호환.
 * 사용자가 새 토글로 명시적으로 false 저장 시에만 PRIZE POOL 카드 숨김.
 */
export function resolveShowPrizePool(v: boolean | undefined): boolean {
  return v !== false;
}

/** 상금 분배표 정의. */
export interface PrizeDistribution {
  /** 'auto' = ITM 자동 계산 (등록 인원 × 15% 페이드, 상위에 가중), 'custom' = payouts 그대로 사용. */
  preset: 'auto' | 'custom';
  /** 등수별 비율 (합계 1.0). 1등이 index 0. */
  payouts: Array<{ rank: number; ratio: number }>;
}

// =====================================================================
// 상금풀 분배 정책 (Phase 3 — 2026-05-21, Phase 5 — 2026-05-21 단일화)
// =====================================================================
/**
 * 사용자 요구 — 사장이 토너 템플릿마다 상금 분배 정책을 설정:
 *  ① 프라이즈풀 = 참가비 × 인원 × 시상비율(payoutPercent %) = 자동 계산 (단일 모드)
 *  ② 시상 등수 (top N) — 정수 or 'auto' (인원의 15%)
 *  ③ 분배 방식 — top-heavy / standard / flat / custom(직접 편집)
 *
 * Phase 5 (2026-05-21): 'manual' 모드 제거. 사용자 결정 — "참가비 기반 자동계산은 계산이 잘되고있고,
 * 수동입력은 어떤기능인지 이해가 어려움". UI 단순화 우선.
 * 백워드 호환: 기존 mode='manual' 데이터는 읽을 때 무시되고 항상 auto-percent로 추론됨
 * (resolvePayoutStructure 헬퍼 사용).
 *
 * UI 위치: 토너 템플릿 편집기.
 * 노출: 매장 어드민 + 매장 TV (사용자 앱 X).
 */
export interface PayoutStructure {
  /** 시상 비율 (0~100). 예: 90이면 10% rake. prizePool = buyIn × players × payoutPercent / 100. */
  payoutPercent: number;
  /** 시상 등수. 정수 or 'auto' (인원의 15%로 자동 산출, computeAutoITM과 동일 룰). */
  itmCount: number | 'auto';
  /** 분배 방식. 'custom'은 customPercents 사용. */
  distribution: 'top-heavy' | 'standard' | 'flat' | 'custom';
  /** distribution='custom'일 때 등수별 % 배열 (합계 100). 예: [50, 30, 20]. */
  customPercents?: number[];
}

/**
 * 백워드 호환 정규화 — 기존 데이터(mode='manual', payoutPercent 누락)를 안전한 auto-percent로 변환.
 * Phase 5 단일 모드 전환 시점에 추가. UI/세션 생성 모두 이 헬퍼를 통과시켜 사용한다.
 */
export function resolvePayoutStructure(
  ps: PayoutStructure | Partial<PayoutStructure> | Record<string, unknown> | null | undefined,
): PayoutStructure {
  if (!ps || typeof ps !== 'object') return { ...DEFAULT_PAYOUT_STRUCTURE };
  const raw = ps as Record<string, unknown>;
  const payoutPercent = raw.payoutPercent;
  const itmCount = raw.itmCount;
  const distribution = raw.distribution;
  const customPercents = raw.customPercents;
  return {
    payoutPercent:
      typeof payoutPercent === 'number' && payoutPercent >= 0 && payoutPercent <= 100
        ? payoutPercent
        : 90,
    itmCount:
      itmCount === 'auto' || typeof itmCount === 'number' ? (itmCount as number | 'auto') : 'auto',
    distribution:
      distribution === 'top-heavy' ||
      distribution === 'standard' ||
      distribution === 'flat' ||
      distribution === 'custom'
        ? (distribution as PayoutStructure['distribution'])
        : 'standard',
    customPercents: Array.isArray(customPercents) ? (customPercents as number[]) : undefined,
  };
}

/**
 * 프리셋 기준 비율 테이블 (1등~기준등수까지). 합계는 1.0.
 * 출처: 업계 표준(WSOP / Hendon Mob / Tournament Director Mavens 평균)을 PM이 채택.
 *  - top-heavy: 1등에 강한 가중 (소규모 펍 토너 시상의 흥행 강조)
 *  - standard: 토너 중상위 균형 (가장 흔한 분배)
 *  - flat: 모든 시상자 동일 분배 (예선·새틀라이트 스타일)
 */
export const PRESET_PAYOUT_TABLES: Record<'top-heavy' | 'standard' | 'flat', number[]> = {
  // 1등 60 / 2등 25 / 3등 15 — 4등 이상은 끝 항목 0.5%로 채우고 normalize
  'top-heavy': [0.60, 0.25, 0.15, 0.08, 0.05, 0.04, 0.02, 0.01],
  // 1등 50 / 2등 30 / 3등 20 — 4등 이상은 표준 페이드
  'standard': [0.50, 0.30, 0.20, 0.10, 0.06, 0.04, 0.03, 0.02],
  // 균등 — itmCount만큼 1/N 분배 (런타임 계산)
  'flat': [1.0],
};

/**
 * ITM 인원 자동 산출 — totalPlayers × 0.15, 최소 1명.
 * computeAutoITM과 동일 룰. payoutStructure.itmCount='auto'일 때 사용.
 */
export function computeAutoItmCount(totalPlayers: number): number {
  const players = Math.max(1, Math.floor(totalPlayers || 0));
  return Math.max(1, Math.round(players * 0.15));
}

/**
 * 프리셋 기반 등수별 비율 산출.
 * 반환: [{rank, ratio}] 합계 1.0. 인원수에 맞춰 잘라내거나 패딩 후 normalize.
 */
export function computePresetPayouts(
  distribution: 'top-heavy' | 'standard' | 'flat',
  itmCount: number,
): Array<{ rank: number; ratio: number }> {
  const n = Math.max(1, Math.floor(itmCount));
  if (distribution === 'flat') {
    const r = 1 / n;
    return Array.from({ length: n }, (_, i) => ({ rank: i + 1, ratio: r }));
  }
  const base = PRESET_PAYOUT_TABLES[distribution];
  let ratios: number[];
  if (n <= base.length) {
    ratios = base.slice(0, n);
  } else {
    // 기본 테이블 + 나머지는 끝쪽 0.5%로 채움
    ratios = [...base];
    const tail = 0.005;
    for (let i = base.length; i < n; i++) ratios.push(tail);
  }
  const sum = ratios.reduce((a, b) => a + b, 0);
  return ratios.map((r, i) => ({ rank: i + 1, ratio: r / sum }));
}

/**
 * payoutStructure 기반으로 분배표 계산 — 매장 TV/어드민 통합 진입점.
 * - 'custom'이면 customPercents를 정규화 후 사용
 * - 그 외 프리셋은 computePresetPayouts
 * - itmCount='auto'면 totalPlayers 기준 자동 산출
 */
export function computePayoutsFromStructure(
  ps: PayoutStructure,
  totalPlayers: number,
): Array<{ rank: number; ratio: number }> {
  const itmN = ps.itmCount === 'auto' ? computeAutoItmCount(totalPlayers) : Math.max(1, ps.itmCount);
  if (ps.distribution === 'custom') {
    const arr = (ps.customPercents ?? []).slice(0, itmN).map((p) => Math.max(0, p));
    if (arr.length === 0) return computePresetPayouts('standard', itmN);
    const sum = arr.reduce((a, b) => a + b, 0) || 1;
    return arr.map((p, i) => ({ rank: i + 1, ratio: p / sum }));
  }
  return computePresetPayouts(ps.distribution, itmN);
}

/**
 * 참가비 기반 prizePool 자동 계산 — payoutStructure.mode='auto-percent'일 때.
 * 예: buyIn 10,000 × 30명 × 90% = 270,000원 (10% 매장 rake)
 *
 * Phase 4 (2026-05-21): 만원 단위 내림 강제.
 *  사용자 정책: "프라이즈풀의 계산은 만원단위로 끊어야한다."
 *  buyIn이 1만원 단위가 아닐 수 있으므로 (예: 50,000 × 23 × 90% = 1,035,000 → 103만원),
 *  최종 결과를 floor(/10000)*10000로 잘라 만원 단위 보장.
 */
export function computeAutoPrizePool(
  buyIn: number,
  totalPlayers: number,
  payoutPercent: number,
): number {
  const bi = Math.max(0, Math.floor(buyIn || 0));
  const n = Math.max(0, Math.floor(totalPlayers || 0));
  const pct = Math.min(100, Math.max(0, payoutPercent || 0));
  const raw = Math.floor((bi * n * pct) / 100);
  // 만원 단위 내림 — 천/백/십/원 단위 절단
  return Math.floor(raw / 10000) * 10000;
}

/** payoutStructure 기본값 — 새 템플릿 생성 시 자동 부착. Phase 5: 자동 계산 단일 모드. */
export const DEFAULT_PAYOUT_STRUCTURE: PayoutStructure = {
  payoutPercent: 90,
  itmCount: 'auto',
  distribution: 'standard',
};

/** 분배 방식 라벨 (UI 표시용). */
export const DISTRIBUTION_LABELS: Record<PayoutStructure['distribution'], string> = {
  'top-heavy': '탑 헤비 (1등 몰빵)',
  'standard': '스탠다드 (일반)',
  'flat': '균등 분배',
  'custom': '직접 편집',
};

/**
 * ITM 자동 계산 — 등록 인원 기준 ITM 인원과 표준 비율 산출.
 * Mavens Tournament Payout Calculator 표준을 단순화한 버전:
 *  - ITM 인원 = max(1, round(totalPlayers * 0.15))
 *  - 상위 비중: [1등 40%, 2등 25%, 3등 15%, 4등 8%, 5등 5%, 6등 4%, 7등 2%, 8등 1%] 기본.
 *    ITM 인원이 더 많으면 끝쪽을 균등 분배. 적으면 잘라서 normalize.
 */
export function computeAutoITM(totalPlayers: number): Array<{ rank: number; ratio: number }> {
  const players = Math.max(1, Math.floor(totalPlayers || 0));
  const itmCount = Math.max(1, Math.round(players * 0.15));
  const standard = [0.40, 0.25, 0.15, 0.08, 0.05, 0.04, 0.02, 0.01];
  let ratios: number[] = [];
  if (itmCount <= standard.length) {
    ratios = standard.slice(0, itmCount);
  } else {
    // 8등까지 표준 + 나머지는 끝 ratio를 균등 분배
    ratios = [...standard];
    const remaining = itmCount - standard.length;
    const tail = 0.005; // 0.5%씩
    for (let i = 0; i < remaining; i++) ratios.push(tail);
  }
  // normalize 합계 1.0
  const sum = ratios.reduce((a, b) => a + b, 0);
  return ratios.map((r, i) => ({ rank: i + 1, ratio: r / sum }));
}

/** 1티켓 = 10,000원 (사용자 정의, 부산·경남 표준). UI에서만 T 단위 노출, 저장은 원 단위 유지. */
export const TICKET_WON = 10000;

/** 상금 분배표 만원 단위 강제 — Phase 4 (2026-05-21).
 *  사용자 정책: "프라이즈풀의 계산은 만원단위로 끊어야한다. 천/백/십/원 단위는 허용되지 않는다."
 *
 *  알고리즘 (PM 결정):
 *   1. 각 등수: floor(prizePool × ratio / 10000) × 10000  — 만원 단위 내림
 *   2. 잔여 = prizePool - sum(각 등수 내림값)  — 0 ~ (등수 수 × 9999)원 범위
 *   3. 잔여를 1등에 모두 추가 (만원 단위 유지: 잔여도 만원 단위로 떨어짐.
 *      prizePool 자체가 만원 단위가 아니면 1원 단위 오차 발생할 수 있으나
 *      computeAutoPrizePool/매장 어드민 입력 모두 만원 단위 강제이므로 사실상 0)
 *
 *  '내림' 선택 이유: 총합이 prizePool을 초과하면 매장이 자기 돈 보태야 함 → 안전한 내림.
 *  1등 잔여 추가: 1등 흥행 강화 + 합계 = 정확히 prizePool 보장.
 *
 *  @returns 등수별 만원 단위 금액 (원). 합계 = prizePool (만원 단위일 때).
 */
export function computePayoutAmounts(
  prizePool: number,
  payouts: Array<{ rank: number; ratio: number }>,
): Array<{ rank: number; amount: number }> {
  if (prizePool <= 0 || payouts.length === 0) {
    return payouts.map((p) => ({ rank: p.rank, amount: 0 }));
  }
  const UNIT = 10000;
  // 1단계: 각 등수 만원 단위 내림
  const floored = payouts.map((p) => ({
    rank: p.rank,
    amount: Math.floor((prizePool * p.ratio) / UNIT) * UNIT,
  }));
  // 2단계: 잔여 = prizePool - sum(내림값). 만원 단위 prizePool이면 잔여도 만원 단위.
  const used = floored.reduce((s, x) => s + x.amount, 0);
  const remainder = Math.max(0, prizePool - used);
  // 3단계: 잔여를 1등에 추가
  if (remainder > 0 && floored.length > 0) {
    floored[0] = { ...floored[0], amount: floored[0].amount + remainder };
  }
  return floored;
}

/** 금액(원)을 사용자 정책에 따라 표시.
 *  Phase 4 (2026-05-21) — ₩ 기호 완전 제거. 단위 사용자 선택.
 *  - 'amount': "27만원" (만원 단위). 만원 미만은 "1만원 미만" 보호.
 *  - 'ticket': "27T" (1T = 10,000원). 정확히 정수가 아니면 소수점 1자리.
 *  amount=0/null이면 빈 문자열. */
export function fmtPrizeDisplay(won: number, unit: PrizeDisplayUnit): string {
  if (!won || won <= 0) return '';
  if (unit === 'ticket') {
    const exact = won / TICKET_WON;
    if (Number.isInteger(exact)) return `${exact}T`;
    return `${exact.toFixed(1)}T`;
  }
  // 'amount' — 만원 단위 표기
  const man = Math.round(won / 10000);
  if (man <= 0) return '1만원 미만';
  return `${man.toLocaleString()}만원`;
}

/** 표시 단위 라벨 (UI 선택용). */
export const PRIZE_DISPLAY_UNIT_LABELS: Record<PrizeDisplayUnit, string> = {
  amount: '금액 (만원)',
  ticket: '티켓 (T)',
};

/** 앤티 모드 라벨 (UI 선택용). */
export const ANTE_MODE_LABELS: Record<AnteMode, string> = {
  sb: 'SB와 동일',
  bb: 'BB와 동일',
  manual: '직접 입력',
};

/** 앤티 모드 기반 자동 ante 산출. anteMode에 따라 sb/bb 매핑. manual은 입력값 그대로. */
export function resolveAnte(level: BlindLevel, mode: AnteMode): number {
  if (mode === 'sb') return Math.max(0, level.sb || 0);
  if (mode === 'bb') return Math.max(0, level.bb || 0);
  return Math.max(0, level.ante || 0);
}

/** 원 → 티켓 (정수 표시. 1만원 단위 가정). */
export function wonToTickets(won: number): number {
  return Math.round((won || 0) / TICKET_WON);
}

/** 티켓 → 원. */
export function ticketsToWon(tickets: number): number {
  return Math.max(0, Math.floor(tickets || 0)) * TICKET_WON;
}

/** 표시용 — "3T (3만원)" 같은 라벨 (어드민 템플릿 편집 화면 전용).
 *  Phase 4 (2026-05-21): ₩ 기호 제거 — 사용자 정책 "한화 w 표시는 없애야". */
export function fmtBuyIn(won: number): string {
  const t = wonToTickets(won);
  const man = Math.round((won || 0) / 10000);
  return `${t}T (${man.toLocaleString()}만원)`;
}

/**
 * 사용자 앱(모바일) 전용 — "5 Ticket" 형태로 표기.
 * 1만원 단위가 아닌 값은 소수점 1자리 (예: 25,000원 → "2.5 Ticket").
 * 0원 이하는 빈 문자열.
 */
export function fmtBuyInTicketsMobile(won: number): string {
  if (!won || won <= 0) return '';
  const exact = won / TICKET_WON;
  // 정확히 정수면 정수 표시, 아니면 소수점 1자리
  const label = Number.isInteger(exact) ? String(exact) : exact.toFixed(1);
  return `${label} Ticket`;
}

export function templatesCollection(storeId: string) {
  return collection(db, 'stores', storeId, 'tournamentTemplates');
}

export function subscribeTemplates(
  storeId: string,
  onChange: (items: TournamentTemplate[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(templatesCollection(storeId), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TournamentTemplate, 'id'>) })),
      ),
    (err) => onError(err as Error),
  );
}

export async function createTemplate(
  storeId: string,
  tpl: Omit<TournamentTemplate, 'id'>,
) {
  const clean = stripUndefined(tpl);
  const ref = await addDoc(templatesCollection(storeId), {
    ...clean,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateTemplate(
  storeId: string,
  templateId: string,
  updates: Partial<Omit<TournamentTemplate, 'id'>>,
) {
  const clean = stripUndefined(updates);
  await updateDoc(doc(templatesCollection(storeId), templateId), {
    ...clean,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTemplate(storeId: string, templateId: string) {
  await deleteDoc(doc(templatesCollection(storeId), templateId));
}

export async function duplicateTemplate(storeId: string, templateId: string) {
  const ref = doc(templatesCollection(storeId), templateId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as Omit<TournamentTemplate, 'id'>;
  return await createTemplate(storeId, {
    ...data,
    name: `${data.name} (복사)`,
  });
}

/** 신규 템플릿 기본 블라인드 구조 — 100 단위 +linear, 1레벨당 10분(600초). */
export const DEFAULT_BLIND_STRUCTURE: BlindLevel[] = [
  { level: 1, sb: 100, bb: 200, ante: 0, durationSec: 600 },
  { level: 2, sb: 200, bb: 400, ante: 0, durationSec: 600 },
  { level: 3, sb: 300, bb: 600, ante: 0, durationSec: 600 },
  { level: 4, sb: 400, bb: 800, ante: 0, durationSec: 600 },
  { level: 5, sb: 500, bb: 1000, ante: 0, durationSec: 600 },
];

/** 신규 레벨 추가 시 기본 시간(초) — 10분. */
export const DEFAULT_LEVEL_DURATION_SEC = 600;

/** 신규 브레이크 추가 시 기본 시간(초) — 10분 (포커 표준 권장). */
export const DEFAULT_BREAK_DURATION_SEC = 600;

/** SB 증분 단위 — "10단위·1단위 블라인드업은 없다" 사용자 정책. */
export const BLIND_STEP = 100;

export const POSTER_STYLES = [
  { value: 'poster-dark', label: 'Dark', bg: 'linear-gradient(135deg, #1A1A1A 0%, #2D2D2D 100%)', color: '#fff' },
  { value: 'poster-cream', label: 'Cream', bg: 'linear-gradient(135deg, #F0E6D2 0%, #E5D7B8 100%)', color: '#1A1A1A' },
  { value: 'poster-green', label: 'Green', bg: 'linear-gradient(135deg, #0E3D2C 0%, #1A5641 100%)', color: '#fff' },
  { value: 'poster-blue', label: 'Blue', bg: 'linear-gradient(135deg, #003049 0%, #1A4D6A 100%)', color: '#fff' },
  { value: 'poster-rust', label: 'Rust', bg: 'linear-gradient(135deg, #C04A31 0%, #E07258 100%)', color: '#fff' },
  { value: 'poster-pink', label: 'Pink', bg: 'linear-gradient(135deg, #FFE5EC 0%, #FFC2D1 100%)', color: '#1A1A1A' },
];

export function posterStyleFor(name: string) {
  return POSTER_STYLES.find((p) => p.value === name) ?? POSTER_STYLES[0];
}

export const TYPE_LABELS: Record<TournamentType, string> = {
  freezeout: '프리징',
  rebuy: '리바이',
  turbo: '터보',
  bounty: '바운티',
  satellite: '위성 예선',
  cash: '캐쉬',
};
