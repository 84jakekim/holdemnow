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
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { db, storage } from './firebase';
import { stripUndefined } from './firestoreUtil';

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
  /** 자유 공지 텍스트 (TV 하단 띠로 노출 — 비우면 표시 안 함).
   *  ※ 2026-05-23 이후 marqueeText로 대체. 비어 있으면 marqueeText로 자동 fallback. */
  announcement: string;
  /** 후원/스폰서 줄 (예: "Powered by Pink Rabbit · 부산 협회") */
  sponsorText: string;
  /** 상금 텍스트 오버라이드 — 보장상금 등 자유롭게 (비우면 prizePool 자동 표기) */
  prizeOverride: string;

  /** ─── 텍스트 3줄 신규 (2026-05-23) ───────────────────────────────
   *  TV 디스플레이에 사장이 자유 텍스트 3줄을 띄울 수 있도록.
   *  첫째 줄(title): 상단 중앙 — 경기 타이틀 (예: 🎰 6/15 정기 토너).
   *                  비우면 기존 customTournamentTitle / session.tournamentName fallback.
   *  둘째 줄(note):  본문 보조 위치 — 게임 참고사항 (예: 리바이 3회까지).
   *                  비우면 노출 안 함.
   *  셋째 줄(marquee): 하단 풀폭 — 우→좌 무한 스와이프 (뉴스 chyron 톤).
   *                    비우면 노출 안 함. 기존 announcement → 자동 fallback (resolveTimerDisplay).
   *  각 줄마다 텍스트/폰트크기/색/스타일 독립. 이모지 자유. */
  titleText: string;
  titleFontSize: number;        // px (vw 계산은 layout에서 처리)
  titleColor: string;           // #RRGGBB
  titleStyle: 'normal' | 'bold' | 'italic' | 'bold-italic';

  noteText: string;
  noteFontSize: number;
  noteColor: string;
  noteStyle: 'normal' | 'bold' | 'italic' | 'bold-italic';

  marqueeText: string;
  marqueeFontSize: number;
  marqueeColor: string;
  marqueeStyle: 'normal' | 'bold' | 'italic' | 'bold-italic';
  /** 한 바퀴 도는 시간(초). 기본 30초 — 작을수록 빠름. */
  marqueeSpeedSec: number;

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

  // 텍스트 3줄 — 2026-05-23 신규
  titleText: '',
  titleFontSize: 32,
  titleColor: '#FFFFFF',
  titleStyle: 'bold',

  noteText: '',
  noteFontSize: 18,
  noteColor: '#E5E5E5',
  noteStyle: 'normal',

  marqueeText: '',
  marqueeFontSize: 20,
  marqueeColor: '#FFFFFF',
  marqueeStyle: 'bold',
  marqueeSpeedSec: 30,

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
          settings: resolveTimerDisplay(data.settings ?? null),
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
  await setDoc(doc(presetsCol(storeId), name.replace(/\s+/g, '-').toLowerCase().slice(0, 40)), stripUndefined({
    name,
    settings: baseSettings,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
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
    stripUndefined({
      ...(name !== undefined ? { name } : {}),
      settings,
      updatedAt: serverTimestamp(),
    }),
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

/**
 * Firestore 원본을 화면용 settings로 정규화.
 * - 누락 필드를 DEFAULT_TIMER_DISPLAY로 채움.
 * - backward compat: marqueeText가 비어 있고 기존 announcement만 채워진 매장은
 *   announcement → marqueeText로 자동 노출 (사용자가 따로 재입력하지 않아도 작동).
 * - titleText가 비어 있으면 customTournamentTitle을 fallback으로 사용 가능 — 단,
 *   여기서는 fallback을 강제하지 않고 layout 측에서 빈 문자열로 두면 자체 분기에서
 *   session.tournamentName으로 fallback 한다 (기존 동작 유지).
 */
export function resolveTimerDisplay(
  raw: Partial<TimerDisplaySettings> | null | undefined,
): TimerDisplaySettings {
  const merged: TimerDisplaySettings = { ...DEFAULT_TIMER_DISPLAY, ...(raw ?? {}) };
  // 기존 announcement만 있고 marqueeText가 비어있으면 자동 마이그레이션.
  if ((!merged.marqueeText || merged.marqueeText.trim().length === 0) && merged.announcement) {
    merged.marqueeText = merged.announcement;
  }
  return merged;
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
        onChange(resolveTimerDisplay(null));
        return;
      }
      const data = snap.data() as Partial<TimerDisplaySettings>;
      onChange(resolveTimerDisplay(data));
    },
    (err) => onError?.(err as Error),
  );
}

/** 한 번만 조회 (TV가 초기 페인트에서 즉시 채워야 할 때). */
export async function getTimerDisplay(storeId: string): Promise<TimerDisplaySettings> {
  const snap = await getDoc(timerDisplayDoc(storeId));
  if (!snap.exists()) return resolveTimerDisplay(null);
  const data = snap.data() as Partial<TimerDisplaySettings>;
  return resolveTimerDisplay(data);
}

/** 부분 업데이트 (서버 머지). */
export async function saveTimerDisplay(
  storeId: string,
  patch: Partial<TimerDisplaySettings>,
) {
  await setDoc(
    timerDisplayDoc(storeId),
    stripUndefined({ ...patch, updatedAt: serverTimestamp() }),
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

// ─────────────────────────────────────────────────────────────
// 배경 이미지 업로드 (2026-05-23 추가)
// ─────────────────────────────────────────────────────────────

/** 타이머 배경 이미지 업로드 최대 용량 (5MB). */
export const MAX_TIMER_BACKGROUND_BYTES = 5 * 1024 * 1024;

/**
 * 매장 TV 배경 이미지 업로드.
 * 경로: stores/{storeId}/timerBackgrounds/{timestamp}.{ext}
 * 반환: Firebase Storage download URL — backgroundImageUrl에 그대로 setting 가능.
 *
 * - PC: <input type="file">
 * - 모바일: <input type="file" accept="image/*" capture/galary>
 * - 5MB 초과 / 이미지 외 type은 즉시 throw.
 */
export async function uploadTimerBackground(
  storeId: string,
  file: File,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 업로드 가능합니다 (jpg, png, webp 등)');
  }
  if (file.size > MAX_TIMER_BACKGROUND_BYTES) {
    throw new Error('이미지는 5MB 이하만 업로드 가능합니다');
  }
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
  const path = `stores/${storeId}/timerBackgrounds/${ts}_${rand}.${safeExt}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}

/** Storage URL로 배경 이미지 삭제 (선택). 실패는 무시. */
export async function deleteTimerBackgroundByUrl(url: string): Promise<void> {
  try {
    await deleteObject(storageRef(storage, url));
  } catch {
    // ignore — 이미 지워졌거나 외부 URL일 수 있음
  }
}

// ─────────────────────────────────────────────────────────────
// 샘플 배경 이미지 (2026-05-23 추가)
// 정적 SVG (admin-web/public/timer-backgrounds/sample-{1,2,3}.svg)
// — 네트워크 라운드트립 없이 즉시 로드 + 가로 모드 대응 + 라이센스 안전.
// ─────────────────────────────────────────────────────────────

export interface SampleBackground {
  id: string;
  label: string;
  emoji: string;
  /** 절대 경로 — Next public/ 정적 자산. backgroundImageUrl에 그대로 set. */
  url: string;
  /** 매칭되는 overlay 권장 값 (이미지 위에 까는 어둠 0~1). */
  recommendedOverlay: number;
}

export const SAMPLE_TIMER_BACKGROUNDS: SampleBackground[] = [
  {
    id: 'casino-dark',
    label: '카지노 클래식',
    emoji: '🎰',
    url: '/timer-backgrounds/sample-casino-dark.svg',
    recommendedOverlay: 0.35,
  },
  {
    id: 'green-table',
    label: '포커 그린',
    emoji: '🃏',
    url: '/timer-backgrounds/sample-green-table.svg',
    recommendedOverlay: 0.4,
  },
  {
    id: 'hot-pink',
    label: '핫핑크',
    emoji: '💗',
    url: '/timer-backgrounds/sample-hot-pink.svg',
    recommendedOverlay: 0.45,
  },
];
