'use client';

/**
 * 매장별 타이머 디스플레이 설정 (TV 송출용 풀스크린 토너 타이머 커스터마이징).
 *
 * 경로: stores/{storeId}/timerDisplay/default
 *
 * 매장 단위 prefs를 관리. 세션마다 다시 설정할 필요 없이 매장 차원에서 한 번
 * 셋팅하면 그 매장의 모든 LIVE TV에 동일하게 적용됨.
 *
 * - backgroundType: 단색 / 그라데이션 / 이미지 URL
 * - 색 팔레트: timer/blinds/text/accent 4컬러 — 매장 브랜드 컬러 반영
 * - announcement: 자유 텍스트 (예: "10분 후 식사 휴식")
 * - sponsorText: 작은 후원 텍스트 (이미지 업로드는 v0.2)
 * - 사운드: 60s/30s/0s 비프음 on/off
 */

import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import { db } from './firebase';

export type BackgroundType = 'solid' | 'gradient' | 'image';

export interface TimerDisplaySettings {
  /** 배경 유형 */
  backgroundType: BackgroundType;
  /** 단색일 때 사용 — CSS color */
  backgroundColor: string;
  /** 그라데이션 두 번째 색 (linear-gradient 135deg first→second) */
  backgroundColor2: string;
  /** 이미지 URL (Firebase Storage 또는 외부) */
  backgroundImageUrl: string;
  /** 이미지 위에 까는 어둠 overlay 0~1 */
  overlayOpacity: number;

  /** 카운트다운 숫자 색 */
  timerColor: string;
  /** 블라인드 숫자 색 (sb/bb) */
  blindsColor: string;
  /** 본문 텍스트 색 (라벨·통계) */
  textColor: string;
  /** 강조 색 (LIVE 점·진행률바·warning) */
  accentColor: string;

  /** TV 상단에 큰 글씨로 표시할 대회명 (비우면 session.tournamentName 사용) */
  customTournamentTitle: string;
  /** 자유 공지 텍스트 (TV 하단 띠로 노출 — 비우면 표시 안 함) */
  announcement: string;
  /** 후원/스폰서 줄 (예: "Powered by HoldemNow · 부산 협회") */
  sponsorText: string;
  /** 상금 텍스트 오버라이드 — 보장상금 등 자유롭게 (비우면 prizePool 자동 표기) */
  prizeOverride: string;

  /** 60초 경고 비프 사운드 (기본 false — 사장님이 명시적으로 켜야 작동) */
  soundWarn60: boolean;
  /** 30초 경고 비프 사운드 (기본 true) — 10초부터 매초 카운트다운 비프도 함께 발동 */
  soundWarn30: boolean;
  /** 레벨 종료(0초/1초) 차임 사운드 (기본 true) */
  soundLevelEnd: boolean;
  /** 블라인드업 알림 사운드 (기본 true) */
  soundBlindUp: boolean;

  /** 매장 로고 URL (좌상단 작은 배지에 표시) */
  storeLogoUrl: string;

  /** ─── 폰트 사이즈 배율 (Phase 3) ────────────────────────────────
   *  각 텍스트 영역별 독립 배율. 기본 1.0, 슬라이더 0.7 ~ 1.6.
   *  CSS clamp 결과 값에 곱해 매장 TV 환경(거리·각도)에 따라 조정. */
  timerScale: number;
  blindsScale: number;
  statsScale: number;

  /** ─── 상금 분배표 노출 (Phase 2) ──────────────────────────────
   *  matchups: 'left' | 'right' | 'hidden'. TV 송출 시 상금 분배표 위치/노출 결정.
   *  데이터는 LiveSession.prizeDistribution 또는 fallback으로 LiveSession.prizePool에서 계산. */
  prizeDistributionLayout: 'left' | 'right' | 'hidden';
}

export const DEFAULT_TIMER_DISPLAY: TimerDisplaySettings = {
  backgroundType: 'gradient',
  backgroundColor: '#0A0A0A',
  backgroundColor2: '#1A1A2E',
  backgroundImageUrl: '',
  overlayOpacity: 0.55,

  timerColor: '#FFFFFF',
  blindsColor: '#FFB800',
  textColor: '#E5E5E5',
  accentColor: '#FF4757',

  customTournamentTitle: '',
  announcement: '',
  sponsorText: '',
  prizeOverride: '',

  soundWarn60: false,
  soundWarn30: true,
  soundLevelEnd: true,
  soundBlindUp: true,

  storeLogoUrl: '',

  timerScale: 1.0,
  blindsScale: 1.0,
  statsScale: 1.0,

  prizeDistributionLayout: 'hidden',
};

/** ─── 다중 프리셋 저장 (Phase 2) ─────────────────────────────────
 *  스토어당 여러 디스플레이 프리셋을 저장하고 빠르게 전환.
 *  경로: stores/{storeId}/timerDisplayPresets/{presetId}
 *  default 프리셋은 기존 stores/{storeId}/timerDisplay/default 유지 (fallback).
 *  presetId='default'면 기존 경로 그대로 사용. */
export interface TimerDisplayPreset {
  id: string;
  name: string;
  settings: TimerDisplaySettings;
  createdAt?: number;
  updatedAt?: number;
}

function presetsCol(storeId: string) {
  return collection(db, 'stores', storeId, 'timerDisplayPresets');
}

/** 매장의 프리셋 목록 실시간 구독. */
export function subscribeTimerDisplayPresets(
  storeId: string,
  onChange: (items: TimerDisplayPreset[]) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    presetsCol(storeId),
    (snap) => {
      const items: TimerDisplayPreset[] = snap.docs.map((d) => {
        const data = d.data() as Partial<TimerDisplayPreset> & { settings?: Partial<TimerDisplaySettings> };
        return {
          id: d.id,
          name: data.name ?? d.id,
          settings: { ...DEFAULT_TIMER_DISPLAY, ...(data.settings ?? {}) },
        };
      });
      onChange(items);
    },
    (err) => onError?.(err as Error),
  );
}

/** 프리셋 신규 추가 (현재 default 설정을 복제). */
export async function createTimerDisplayPreset(
  storeId: string,
  name: string,
  baseSettings: TimerDisplaySettings,
) {
  await setDoc(doc(presetsCol(storeId), name.replace(/\s+/g, '-').toLowerCase().slice(0, 40)), {
    name,
    settings: baseSettings,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** 프리셋 업데이트. */
export async function updateTimerDisplayPreset(
  storeId: string,
  presetId: string,
  settings: TimerDisplaySettings,
  name?: string,
) {
  await setDoc(
    doc(presetsCol(storeId), presetId),
    {
      ...(name !== undefined ? { name } : {}),
      settings,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** 프리셋 삭제. */
export async function deleteTimerDisplayPreset(storeId: string, presetId: string) {
  await import('firebase/firestore').then(({ deleteDoc }) => deleteDoc(doc(presetsCol(storeId), presetId)));
}

/** 프리셋을 default로 적용 — TV 화면에 즉시 반영. */
export async function applyPresetAsDefault(
  storeId: string,
  settings: TimerDisplaySettings,
) {
  await saveTimerDisplay(storeId, settings);
}

function timerDisplayDoc(storeId: string) {
  return doc(db, 'stores', storeId, 'timerDisplay', 'default');
}

/** 매장 타이머 디스플레이 설정 실시간 구독. 없으면 DEFAULT 반환. */
export function subscribeTimerDisplay(
  storeId: string,
  onChange: (s: TimerDisplaySettings) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    timerDisplayDoc(storeId),
    (snap) => {
      if (!snap.exists()) {
        onChange(DEFAULT_TIMER_DISPLAY);
        return;
      }
      const data = snap.data() as Partial<TimerDisplaySettings>;
      onChange({ ...DEFAULT_TIMER_DISPLAY, ...data });
    },
    (err) => onError?.(err as Error),
  );
}

/** 한 번만 조회 (TV가 초기 페인트에서 즉시 채워야 할 때). */
export async function getTimerDisplay(storeId: string): Promise<TimerDisplaySettings> {
  const snap = await getDoc(timerDisplayDoc(storeId));
  if (!snap.exists()) return DEFAULT_TIMER_DISPLAY;
  const data = snap.data() as Partial<TimerDisplaySettings>;
  return { ...DEFAULT_TIMER_DISPLAY, ...data };
}

/** 부분 업데이트 (서버 머지). */
export async function saveTimerDisplay(
  storeId: string,
  patch: Partial<TimerDisplaySettings>,
) {
  await setDoc(
    timerDisplayDoc(storeId),
    { ...patch, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** 배경 CSS 한 줄로 컴포넌트에 적용. */
export function buildBackgroundCss(s: TimerDisplaySettings): string {
  if (s.backgroundType === 'image' && s.backgroundImageUrl) {
    return `url("${s.backgroundImageUrl}") center/cover no-repeat, #0A0A0A`;
  }
  if (s.backgroundType === 'gradient') {
    return `linear-gradient(135deg, ${s.backgroundColor} 0%, ${s.backgroundColor2} 100%)`;
  }
  return s.backgroundColor || '#0A0A0A';
}
