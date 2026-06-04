'use client';

/**
 * kpiTargets — 유료 전환 게이지의 Phase별 목표치 (본사 수정 가능).
 *
 * 배경 (2026-06-04 회의): "전국 단위 앱인데 목표치가 너무 낮다"는 대표 지적 →
 * 전국 홀덤펍 시장조사(모수 2,000~2,800, 플레이어 ~30만) 기반으로 PM이 Phase별 재산정.
 * 코드 배포 없이 대표가 직접 조정할 수 있도록 meta/kpiTargets로 외부화 (feedConfig 패턴).
 *
 * 데이터 모델 (meta/kpiTargets 단일 doc):
 *  - phases[]: { id, label, shortLabel, targets{activeRealStores, weeklyLive, wau}, note }
 *  - currentPhaseId: 게이지가 표시할 현재 단계
 *  - pgEnabled: PG(결제) 활성화 여부 — 트리거 충족 + PG = 유료 도입 검토
 *  - requiredMetCount: 3지표 중 몇 개 충족 시 트리거인지 (기본 2)
 *
 * rules: meta/{docId} 기존 규칙(read=public, write=platform_admin) 재사용 — 변경 불필요.
 */

import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { stripUndefined } from './firestoreUtil';

export interface KpiPhaseTargets {
  activeRealStores: number;
  weeklyLive: number;
  wau: number;
}

export interface KpiPhase {
  id: string;
  label: string;
  /** Phase 칩용 축약 라벨 */
  shortLabel: string;
  targets: KpiPhaseTargets;
  note?: string;
}

export interface KpiTargets {
  phases: KpiPhase[];
  currentPhaseId: string;
  pgEnabled: boolean;
  requiredMetCount: number;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

/**
 * PM 확정 기본값 (2026-06-04 시장조사 기반).
 * P1 = 유료 도입 트리거(거점 임계 질량) / P2·P3 = 전국 비전 마일스톤.
 */
export const KPI_TARGETS_DEFAULT: KpiTargets = {
  phases: [
    {
      id: 'p1',
      label: 'Phase 1 · 거점 안착 (부산·경남) — 유료 도입 트리거',
      shortLabel: 'P1 거점',
      targets: { activeRealStores: 60, weeklyLive: 240, wau: 2400 },
      note: '부산·경남 모수 250~330의 약 20% 침투 · 매장당 주 4회 LIVE · 매장당 주 40명 탐색 유입',
    },
    {
      id: 'p2',
      label: 'Phase 2 · 전국 확장 (침투 ~9%)',
      shortLabel: 'P2 전국',
      targets: { activeRealStores: 180, weeklyLive: 900, wau: 12000 },
      note: '전국 모수 2,000의 9% · 매장당 주 5회 · 플레이어 30만의 4%',
    },
    {
      id: 'p3',
      label: 'Phase 3 · 전국 안착·수익화 (침투 20%)',
      shortLabel: 'P3 수익화',
      targets: { activeRealStores: 400, weeklyLive: 2400, wau: 40000 },
      note: '전국 모수 2,000의 20% · 매장당 주 6회 · 플레이어 30만의 13%',
    },
  ],
  currentPhaseId: 'p1',
  pgEnabled: false,
  requiredMetCount: 2,
};

const REF = doc(db, 'meta', 'kpiTargets');

/** 본사 대시보드에서 onSnapshot 실시간 구독. doc 부재/에러 시 default. */
export function subscribeKpiTargets(
  onChange: (t: KpiTargets) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    REF,
    (snap) => {
      if (!snap.exists()) {
        onChange(KPI_TARGETS_DEFAULT);
        return;
      }
      onChange(normalize(snap.data() as Partial<KpiTargets>));
    },
    (e) => {
      onError?.(e as Error);
      onChange(KPI_TARGETS_DEFAULT);
    },
  );
}

/** 한 번만 읽기. */
export async function getKpiTargetsOnce(): Promise<KpiTargets> {
  try {
    const snap = await getDoc(REF);
    if (!snap.exists()) return KPI_TARGETS_DEFAULT;
    return normalize(snap.data() as Partial<KpiTargets>);
  } catch {
    return KPI_TARGETS_DEFAULT;
  }
}

/** 본사 어드민 저장 — 전체 문서 교체(merge). */
export async function saveKpiTargets(
  next: KpiTargets,
  meta: { actorUid: string },
): Promise<void> {
  const normalized = normalize(next);
  await setDoc(
    REF,
    stripUndefined({
      phases: normalized.phases.map((p) =>
        stripUndefined({
          id: p.id,
          label: p.label,
          shortLabel: p.shortLabel,
          targets: p.targets,
          note: p.note,
        }),
      ),
      currentPhaseId: normalized.currentPhaseId,
      pgEnabled: normalized.pgEnabled,
      requiredMetCount: normalized.requiredMetCount,
      updatedAt: serverTimestamp(),
      updatedBy: meta.actorUid,
    }),
    { merge: true },
  );
}

/** 현재 Phase 조회 — id 불일치 시 첫 Phase. */
export function currentPhaseOf(t: KpiTargets): KpiPhase {
  return t.phases.find((p) => p.id === t.currentPhaseId) ?? t.phases[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// 정규화 — 음수·NaN 방어, Phase 최소 1개 보장, currentPhaseId 유효성.
// ─────────────────────────────────────────────────────────────────────────────

function posInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return n < 1 ? fallback : n;
}

function normalize(raw: Partial<KpiTargets>): KpiTargets {
  const defPhases = KPI_TARGETS_DEFAULT.phases;
  const rawPhases = Array.isArray(raw.phases) && raw.phases.length > 0 ? raw.phases : defPhases;

  const phases: KpiPhase[] = rawPhases.map((p, i) => {
    const def = defPhases[Math.min(i, defPhases.length - 1)];
    const t = (p?.targets ?? {}) as Partial<KpiPhaseTargets>;
    return {
      id: typeof p?.id === 'string' && p.id ? p.id : def.id,
      label: typeof p?.label === 'string' && p.label ? p.label : def.label,
      shortLabel: typeof p?.shortLabel === 'string' && p.shortLabel ? p.shortLabel : def.shortLabel,
      targets: {
        activeRealStores: posInt(t.activeRealStores, def.targets.activeRealStores),
        weeklyLive: posInt(t.weeklyLive, def.targets.weeklyLive),
        wau: posInt(t.wau, def.targets.wau),
      },
      note: typeof p?.note === 'string' ? p.note : def.note,
    };
  });

  const currentPhaseId = phases.some((p) => p.id === raw.currentPhaseId)
    ? (raw.currentPhaseId as string)
    : phases[0].id;

  const rmc = posInt(raw.requiredMetCount, KPI_TARGETS_DEFAULT.requiredMetCount);

  return {
    phases,
    currentPhaseId,
    pgEnabled: typeof raw.pgEnabled === 'boolean' ? raw.pgEnabled : false,
    requiredMetCount: Math.min(3, Math.max(1, rmc)),
    updatedAt: raw.updatedAt,
    updatedBy: raw.updatedBy,
  };
}
