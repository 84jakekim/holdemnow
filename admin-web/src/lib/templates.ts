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
  /** 사장님이 자주 쓰는 템플릿 ★ 표시 — TournamentControlCenter 좌측 사이드의 빠른 선택용 */
  favorite?: boolean;
  /** 마지막으로 LIVE 시작에 사용된 시각 — recent 정렬에 사용 (Timestamp.toMillis 호환 number) */
  lastUsedAt?: number;
  /** 상금 분배표 — Phase 2.
   *  ITM(In The Money) 기준 1~N등 비율 분배. 매장 TV·어드민 전용 노출, 사용자 앱에는 노출 안 됨.
   *  payouts.length 등수만큼. ratio는 [0,1] 합계 1.0. preset='auto'면 ITM 자동 계산. */
  prizeDistribution?: PrizeDistribution;
}

/** 상금 분배표 정의. */
export interface PrizeDistribution {
  /** 'auto' = ITM 자동 계산 (등록 인원 × 15% 페이드, 상위에 가중), 'custom' = payouts 그대로 사용. */
  preset: 'auto' | 'custom';
  /** 등수별 비율 (합계 1.0). 1등이 index 0. */
  payouts: Array<{ rank: number; ratio: number }>;
}

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

/** 원 → 티켓 (정수 표시. 1만원 단위 가정). */
export function wonToTickets(won: number): number {
  return Math.round((won || 0) / TICKET_WON);
}

/** 티켓 → 원. */
export function ticketsToWon(tickets: number): number {
  return Math.max(0, Math.floor(tickets || 0)) * TICKET_WON;
}

/** 표시용 — "3T (₩30,000)" 같은 라벨 (어드민 템플릿 편집 화면 전용). */
export function fmtBuyIn(won: number): string {
  const t = wonToTickets(won);
  return `${t}T (₩${(won || 0).toLocaleString()})`;
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
  const ref = await addDoc(templatesCollection(storeId), {
    ...tpl,
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
  await updateDoc(doc(templatesCollection(storeId), templateId), {
    ...updates,
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
