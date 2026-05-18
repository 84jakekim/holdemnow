'use client';

/**
 * /preview/launcher-icons — PWA 런처 아이콘 3차 정제 (16개)
 *
 * 직전 20개 시안 약점:
 *  - 토끼 path가 어색 (덩어리진 윤곽, 부자연스러운 등 라인)
 *  - 그라데이션이 흔함 (단조로운 핑크 linear 위주)
 *  - 디테일 없음 (림 라이트 / drop shadow / inner glow 부재)
 *  - 자세 변화만 있을 뿐 시그너처 없음
 *
 * 이번 3차 원칙:
 *  - bezier curve로 토끼 윤곽 우아하게 다듬음
 *  - 그라데이션 다양화: Soft glow / Triple-stop / Aurora / Soft single / Warm accent
 *  - SVG filter(feGaussianBlur)로 light source / glow / drop shadow
 *  - 시안마다 디테일 1~2가지만 정제해서 적용 (overengineering 방지)
 *
 * 16개 = 5개 시그너처 자세 × 2~4가지 디테일 변형
 *  - 자세 1: 측면 앉은 토끼 (클래식) × 4
 *  - 자세 2: 측면 머리 + 두 귀 클로즈업 × 3
 *  - 자세 3: 측면 점프 (dynamic) × 3
 *  - 자세 4: 측면 풀바디 일어선 × 3
 *  - 자세 5: 추상 (귀 두 개 + 둥근 머리) × 3
 *
 * viewBox 192×192, 안전영역 38~154 (중앙 60%).
 */

import { useState, type ReactNode } from 'react';

type Pose =
  | 'A. 측면 앉은 토끼'
  | 'B. 측면 머리 + 두 귀'
  | 'C. 측면 점프'
  | 'D. 측면 일어선 풀바디'
  | 'E. 추상 (귀+머리)';

type IconDef = {
  id: number;
  pose: Pose;
  detail: string;     // 적용된 디테일 한 줄 라벨
  gradient: string;   // 그라데이션 종류 라벨
  svg: ReactNode;
};

const W = '#FFFFFF';

/* ──────────────────────────────────────────────────────────────────────────
 *  공통 SVG defs — 토끼 path / 그라데이션 / 필터
 *
 *  자세별 토끼 path는 정제한 한 줄 path로 모듈화. id에 시안 번호 붙여 충돌 방지.
 * ────────────────────────────────────────────────────────────────────────── */

/* ── 자세 A: 측면 앉은 토끼 — 정제된 한 줄 path
 *  - 머리(오른쪽) → 등 → 엉덩이(왼쪽 둥글게) → 앞다리 살짝
 *  - bezier로 부드럽게, 어색한 직각 제거
 *  - 귀 한 줄로 따로
 *  - 안전영역 38~154 안
 */
const RABBIT_A_BODY =
  'M 130 138 ' +
  'C 144 138 152 130 152 116 ' +
  'C 152 100 142 88 124 84 ' +
  'C 118 82 112 80 108 76 ' +              // 어깨 - 머리 연결
  'C 108 64 104 56 96 56 ' +                // 머리 위
  'C 84 56 78 68 80 84 ' +                  // 머리 측면 - 등 시작
  'C 64 88 50 100 46 116 ' +                // 등 라인 → 엉덩이
  'C 44 128 50 138 60 138 Z';
const RABBIT_A_EAR_BACK =
  'M 90 60 C 86 36 92 20 100 22 C 108 24 106 44 102 64 Z';
const RABBIT_A_EAR_FRONT =
  'M 100 62 C 100 38 110 22 116 26 C 122 30 114 50 110 66 Z';
const RABBIT_A_TAIL_CX = 48;
const RABBIT_A_TAIL_CY = 122;

/* ── 자세 B: 측면 머리 + 두 귀 클로즈업
 *  - 머리 윤곽이 측면(왼쪽 코, 오른쪽 뒤통수)으로 살짝 타원
 *  - 코끝이 살짝 뾰족, 턱 라인은 부드럽게
 *  - 두 귀는 위로, 한쪽이 앞 (depth)
 */
const RABBIT_B_HEAD =
  'M 56 124 ' +
  'C 50 110 56 92 74 84 ' +                 // 위 곡선 (이마)
  'C 92 76 116 78 132 88 ' +                // 뒤통수
  'C 144 96 144 116 132 126 ' +             // 뒤통수 → 턱
  'C 116 134 96 134 80 132 ' +              // 턱 라인
  'C 66 130 60 130 56 124 Z';               // 코끝 (살짝 뾰족하게 닫힘)
const RABBIT_B_EAR_BACK =
  'M 84 86 C 76 54 82 32 92 32 C 102 32 100 60 96 88 Z';
const RABBIT_B_EAR_FRONT =
  'M 104 82 C 100 50 112 28 122 30 C 132 34 122 58 116 84 Z';

/* ── 자세 C: 측면 점프 — 다이내믹
 *  - 몸은 활처럼 휘어진 호
 *  - 앞다리 펴짐, 뒷다리 접힘
 *  - 귀는 뒤로 휘날림
 */
const RABBIT_C_BODY =
  'M 36 120 ' +
  'C 32 110 40 100 56 98 ' +                // 뒷다리 아래
  'C 70 80 92 70 116 74 ' +                 // 등의 호 (점프 활)
  'C 134 78 148 90 152 104 ' +              // 앞쪽 어깨
  'C 154 116 146 122 134 120 ' +            // 머리 아래
  'L 122 116 ' +
  'L 124 124 ' +
  'C 124 132 116 134 110 128 ' +
  'L 96 120 ' +
  'L 70 124 ' +
  'L 56 132 ' +
  'C 46 134 38 130 36 120 Z';
const RABBIT_C_EAR_BACK =
  'M 116 76 C 104 60 84 50 72 54 C 64 56 66 64 76 70 C 88 74 102 76 116 76 Z';
const RABBIT_C_EAR_FRONT =
  'M 124 72 C 116 56 100 42 88 44 C 80 46 82 54 92 62 C 102 68 114 72 124 72 Z';

/* ── 자세 D: 측면 일어선 풀바디 — 우아하게
 *  - 일어선 토끼, 몸이 세로로 길게 호
 *  - 머리 위로 올라옴, 두 귀 길게
 *  - 발은 살짝만
 */
const RABBIT_D_BODY =
  'M 88 152 ' +
  'C 76 152 70 144 70 132 ' +
  'C 70 116 76 102 82 92 ' +                // 몸 측면
  'C 78 84 78 76 84 70 ' +                  // 어깨 → 목
  'C 88 60 96 56 102 58 ' +
  'C 110 60 112 70 108 80 ' +               // 머리 옆
  'C 114 88 116 100 116 116 ' +             // 등 라인
  'C 116 134 110 148 100 152 Z';
const RABBIT_D_EAR_BACK =
  'M 96 58 C 90 36 92 22 98 22 C 104 22 106 38 102 60 Z';
const RABBIT_D_EAR_FRONT =
  'M 102 60 C 102 38 110 24 116 28 C 122 32 116 50 110 64 Z';
const RABBIT_D_FOOT =
  'M 80 152 C 76 152 74 154 76 158 L 110 158 C 112 154 110 152 106 152 Z';

/* ── 자세 E: 추상 — 큰 머리 + 두 귀
 *  - 머리는 살짝 측면 느낌의 둥근 형태 (정원 X, 한쪽 살짝 평평)
 *  - 두 귀는 균형 있는 길이, 한쪽이 더 앞에 (depth)
 */
const RABBIT_E_HEAD =
  'M 60 116 ' +
  'C 56 96 70 78 96 76 ' +
  'C 122 76 138 92 138 114 ' +
  'C 138 134 122 150 96 150 ' +
  'C 72 150 64 134 60 116 Z';
const RABBIT_E_EAR_BACK =
  'M 84 78 C 78 50 84 28 92 28 C 100 28 100 54 96 80 Z';
const RABBIT_E_EAR_FRONT =
  'M 100 80 C 100 52 110 28 118 30 C 126 34 114 58 110 82 Z';

/* ──────────────────────────────────────────────────────────────────────────
 *  공통 그라데이션 + 필터 빌더
 * ────────────────────────────────────────────────────────────────────────── */

/** Soft glow radial — 토끼 뒤에서 빛이 새어 나오는 듯 */
function GradSoftGlow({ id }: { id: string }) {
  return (
    <radialGradient id={id} cx="0.5" cy="0.42" r="0.72">
      <stop offset="0%" stopColor="#FFB5DB" />
      <stop offset="38%" stopColor="#FF4D9E" />
      <stop offset="100%" stopColor="#8C0E4F" />
    </radialGradient>
  );
}

/** Triple-stop — 핑크 → 또 다른 핑크 → 핑크 (subtle) */
function GradTripleStop({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="#FF80BC" />
      <stop offset="48%" stopColor="#E81E83" />
      <stop offset="100%" stopColor="#9C0F58" />
    </linearGradient>
  );
}

/** Aurora — 핑크 + 자홍·코랄 살짝 */
function GradAurora({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0%" stopColor="#FF8A9E" />
      <stop offset="35%" stopColor="#FF3D8E" />
      <stop offset="68%" stopColor="#C81B7E" />
      <stop offset="100%" stopColor="#6E0C56" />
    </linearGradient>
  );
}

/** Single-direction soft — 한 방향 매우 부드럽게 */
function GradSoftSingle({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#FFA8C8" />
      <stop offset="100%" stopColor="#D11876" />
    </linearGradient>
  );
}

/** Pink + warm accent (코랄·골드 한 점) */
function GradWarmAccent({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="#FFB888" />
      <stop offset="22%" stopColor="#FF6A9E" />
      <stop offset="100%" stopColor="#A8125C" />
    </linearGradient>
  );
}

/** 토끼 자체에 white → soft pink 안쪽 미세 그라데이션 */
function GradRabbitSubtle({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#FFFFFF" />
      <stop offset="100%" stopColor="#FFE6F2" />
    </linearGradient>
  );
}

/** Inner glow filter (토끼 안쪽에 옅은 핑크 림) */
function FilterInnerGlow({ id }: { id: string }) {
  return (
    <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="2" result="blur" />
      <feFlood floodColor="#FF7AB6" floodOpacity="0.55" />
      <feComposite in2="blur" operator="in" result="glow" />
      <feComposite in="SourceGraphic" in2="glow" operator="over" />
    </filter>
  );
}

/** Drop shadow filter (토끼 발치 옅은 그림자) */
function FilterDropShadow({ id }: { id: string }) {
  return (
    <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
      <feOffset dx="0" dy="3" result="offsetblur" />
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.32" />
      </feComponentTransfer>
      <feMerge>
        <feMergeNode />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  );
}

/** Soft background light source (왼쪽 위 하이라이트) */
function FilterLightSource({ id }: { id: string }) {
  return (
    <filter id={id} x="0" y="0" width="100%" height="100%">
      <feGaussianBlur stdDeviation="12" />
    </filter>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  아이콘 16개
 *
 *  각 아이콘은 자세 path + 그라데이션 1종 + 디테일 1~2가지
 * ────────────────────────────────────────────────────────────────────────── */

/* ─────────── 자세 A: 측면 앉은 토끼 × 4 ─────────── */

/* #1 — 앉은 토끼 + Soft glow + 림 라이트 */
const Icon1 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradSoftGlow id="g1-bg" />
    </defs>
    <rect width="192" height="192" fill="url(#g1-bg)" />
    {/* 토끼 본체 */}
    <g>
      <path d={RABBIT_A_BODY} fill={W} />
      <path d={RABBIT_A_EAR_BACK} fill={W} />
      <path d={RABBIT_A_EAR_FRONT} fill={W} />
      <circle cx={RABBIT_A_TAIL_CX} cy={RABBIT_A_TAIL_CY} r="7" fill={W} />
    </g>
    {/* 림 라이트 — 등 위쪽 한 줄, 흰 stroke 옅게 */}
    <path
      d="M 80 84 C 64 88 50 100 46 116"
      fill="none"
      stroke="#FFFFFF"
      strokeOpacity="0.75"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M 90 60 C 86 40 92 24 100 26"
      fill="none"
      stroke="#FFFFFF"
      strokeOpacity="0.6"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

/* #2 — 앉은 토끼 + Triple-stop + Drop shadow (떠 있는 느낌) */
const Icon2 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradTripleStop id="g2-bg" />
      <FilterDropShadow id="g2-shadow" />
    </defs>
    <rect width="192" height="192" fill="url(#g2-bg)" />
    {/* 발치 옅은 그림자 (토끼 밑) */}
    <ellipse cx="98" cy="156" rx="48" ry="5" fill="#000000" fillOpacity="0.25" />
    <g filter="url(#g2-shadow)">
      <path d={RABBIT_A_BODY} fill={W} />
      <path d={RABBIT_A_EAR_BACK} fill={W} />
      <path d={RABBIT_A_EAR_FRONT} fill={W} />
      <circle cx={RABBIT_A_TAIL_CX} cy={RABBIT_A_TAIL_CY} r="7" fill={W} />
    </g>
  </svg>
);

/* #3 — 앉은 토끼 + Aurora + 토끼 자체 그라데이션 (subtle) */
const Icon3 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradAurora id="g3-bg" />
      <GradRabbitSubtle id="g3-rabbit" />
    </defs>
    <rect width="192" height="192" fill="url(#g3-bg)" />
    <g>
      <path d={RABBIT_A_BODY} fill="url(#g3-rabbit)" />
      <path d={RABBIT_A_EAR_BACK} fill="url(#g3-rabbit)" />
      <path d={RABBIT_A_EAR_FRONT} fill="url(#g3-rabbit)" />
      <circle cx={RABBIT_A_TAIL_CX} cy={RABBIT_A_TAIL_CY} r="7" fill="url(#g3-rabbit)" />
    </g>
  </svg>
);

/* #4 — 앉은 토끼 + Warm accent + dual silhouette (뒤에 흐릿한 토끼) */
const Icon4 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradWarmAccent id="g4-bg" />
    </defs>
    <rect width="192" height="192" fill="url(#g4-bg)" />
    {/* 뒤에 흐릿한 토끼 (depth) — 살짝 어긋난 위치, 낮은 opacity */}
    <g transform="translate(-6 -4) scale(1.04 1.04) translate(-4 -4)" opacity="0.22">
      <path d={RABBIT_A_BODY} fill={W} />
      <path d={RABBIT_A_EAR_BACK} fill={W} />
      <path d={RABBIT_A_EAR_FRONT} fill={W} />
    </g>
    <g>
      <path d={RABBIT_A_BODY} fill={W} />
      <path d={RABBIT_A_EAR_BACK} fill={W} />
      <path d={RABBIT_A_EAR_FRONT} fill={W} />
      <circle cx={RABBIT_A_TAIL_CX} cy={RABBIT_A_TAIL_CY} r="7" fill={W} />
    </g>
  </svg>
);

/* ─────────── 자세 B: 측면 머리 + 두 귀 × 3 ─────────── */

/* #5 — 머리 클로즈업 + Soft glow + 림 라이트 */
const Icon5 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradSoftGlow id="g5-bg" />
    </defs>
    <rect width="192" height="192" fill="url(#g5-bg)" />
    <g>
      <path d={RABBIT_B_HEAD} fill={W} />
      <path d={RABBIT_B_EAR_BACK} fill={W} />
      <path d={RABBIT_B_EAR_FRONT} fill={W} />
    </g>
    {/* 림 라이트 — 머리 위쪽 곡선 따라 흰 stroke */}
    <path
      d="M 56 124 C 50 110 56 92 74 84 C 92 76 116 78 132 88"
      fill="none"
      stroke="#FFFFFF"
      strokeOpacity="0.7"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

/* #6 — 머리 클로즈업 + Aurora + drop shadow */
const Icon6 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradAurora id="g6-bg" />
      <FilterDropShadow id="g6-shadow" />
    </defs>
    <rect width="192" height="192" fill="url(#g6-bg)" />
    <ellipse cx="96" cy="142" rx="44" ry="4" fill="#000000" fillOpacity="0.22" />
    <g filter="url(#g6-shadow)">
      <path d={RABBIT_B_HEAD} fill={W} />
      <path d={RABBIT_B_EAR_BACK} fill={W} />
      <path d={RABBIT_B_EAR_FRONT} fill={W} />
    </g>
  </svg>
);

/* #7 — 머리 클로즈업 + Triple-stop + 토끼 자체 그라데이션 */
const Icon7 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradTripleStop id="g7-bg" />
      <GradRabbitSubtle id="g7-rabbit" />
    </defs>
    <rect width="192" height="192" fill="url(#g7-bg)" />
    <g>
      <path d={RABBIT_B_HEAD} fill="url(#g7-rabbit)" />
      <path d={RABBIT_B_EAR_BACK} fill="url(#g7-rabbit)" />
      <path d={RABBIT_B_EAR_FRONT} fill="url(#g7-rabbit)" />
    </g>
  </svg>
);

/* ─────────── 자세 C: 측면 점프 × 3 ─────────── */

/* #8 — 점프 + Aurora + 림 라이트 */
const Icon8 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradAurora id="g8-bg" />
    </defs>
    <rect width="192" height="192" fill="url(#g8-bg)" />
    <g>
      <path d={RABBIT_C_BODY} fill={W} />
      <path d={RABBIT_C_EAR_BACK} fill={W} />
      <path d={RABBIT_C_EAR_FRONT} fill={W} />
    </g>
    {/* 점프 활 위쪽 림 라이트 */}
    <path
      d="M 56 98 C 70 80 92 70 116 74"
      fill="none"
      stroke="#FFFFFF"
      strokeOpacity="0.75"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

/* #9 — 점프 + Soft glow + drop shadow (날아오르는 느낌) */
const Icon9 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradSoftGlow id="g9-bg" />
      <FilterDropShadow id="g9-shadow" />
    </defs>
    <rect width="192" height="192" fill="url(#g9-bg)" />
    {/* 그림자 — 토끼보다 한참 아래 (공중에 떠 있는 느낌) */}
    <ellipse cx="96" cy="166" rx="50" ry="4" fill="#000000" fillOpacity="0.28" />
    <g filter="url(#g9-shadow)">
      <path d={RABBIT_C_BODY} fill={W} />
      <path d={RABBIT_C_EAR_BACK} fill={W} />
      <path d={RABBIT_C_EAR_FRONT} fill={W} />
    </g>
  </svg>
);

/* #10 — 점프 + Warm accent + 토끼 자체 그라데이션 */
const Icon10 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradWarmAccent id="g10-bg" />
      <GradRabbitSubtle id="g10-rabbit" />
    </defs>
    <rect width="192" height="192" fill="url(#g10-bg)" />
    <g>
      <path d={RABBIT_C_BODY} fill="url(#g10-rabbit)" />
      <path d={RABBIT_C_EAR_BACK} fill="url(#g10-rabbit)" />
      <path d={RABBIT_C_EAR_FRONT} fill="url(#g10-rabbit)" />
    </g>
  </svg>
);

/* ─────────── 자세 D: 측면 일어선 풀바디 × 3 ─────────── */

/* #11 — 일어선 + Soft single + 림 라이트 */
const Icon11 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradSoftSingle id="g11-bg" />
    </defs>
    <rect width="192" height="192" fill="url(#g11-bg)" />
    <g>
      <path d={RABBIT_D_BODY} fill={W} />
      <path d={RABBIT_D_FOOT} fill={W} />
      <path d={RABBIT_D_EAR_BACK} fill={W} />
      <path d={RABBIT_D_EAR_FRONT} fill={W} />
    </g>
    {/* 림 라이트 — 측면 한 줄 */}
    <path
      d="M 82 92 C 78 84 78 76 84 70 C 88 60 96 56 102 58"
      fill="none"
      stroke="#FFFFFF"
      strokeOpacity="0.68"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

/* #12 — 일어선 + Aurora + drop shadow */
const Icon12 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradAurora id="g12-bg" />
      <FilterDropShadow id="g12-shadow" />
    </defs>
    <rect width="192" height="192" fill="url(#g12-bg)" />
    <ellipse cx="93" cy="162" rx="28" ry="4" fill="#000000" fillOpacity="0.25" />
    <g filter="url(#g12-shadow)">
      <path d={RABBIT_D_BODY} fill={W} />
      <path d={RABBIT_D_FOOT} fill={W} />
      <path d={RABBIT_D_EAR_BACK} fill={W} />
      <path d={RABBIT_D_EAR_FRONT} fill={W} />
    </g>
  </svg>
);

/* #13 — 일어선 + Triple-stop + dual silhouette */
const Icon13 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradTripleStop id="g13-bg" />
    </defs>
    <rect width="192" height="192" fill="url(#g13-bg)" />
    {/* 흐릿한 뒤 실루엣 */}
    <g transform="translate(8 4)" opacity="0.2">
      <path d={RABBIT_D_BODY} fill={W} />
      <path d={RABBIT_D_EAR_BACK} fill={W} />
      <path d={RABBIT_D_EAR_FRONT} fill={W} />
    </g>
    <g>
      <path d={RABBIT_D_BODY} fill={W} />
      <path d={RABBIT_D_FOOT} fill={W} />
      <path d={RABBIT_D_EAR_BACK} fill={W} />
      <path d={RABBIT_D_EAR_FRONT} fill={W} />
    </g>
  </svg>
);

/* ─────────── 자세 E: 추상 (귀+머리) × 3 ─────────── */

/* #14 — 추상 + Soft glow + 림 라이트 */
const Icon14 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradSoftGlow id="g14-bg" />
    </defs>
    <rect width="192" height="192" fill="url(#g14-bg)" />
    <g>
      <path d={RABBIT_E_HEAD} fill={W} />
      <path d={RABBIT_E_EAR_BACK} fill={W} />
      <path d={RABBIT_E_EAR_FRONT} fill={W} />
    </g>
    {/* 림 라이트 — 머리 윗부분 호 */}
    <path
      d="M 60 116 C 56 96 70 78 96 76 C 122 76 138 92 138 114"
      fill="none"
      stroke="#FFFFFF"
      strokeOpacity="0.72"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

/* #15 — 추상 + Warm accent + drop shadow */
const Icon15 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradWarmAccent id="g15-bg" />
      <FilterDropShadow id="g15-shadow" />
    </defs>
    <rect width="192" height="192" fill="url(#g15-bg)" />
    <ellipse cx="98" cy="160" rx="48" ry="5" fill="#000000" fillOpacity="0.22" />
    <g filter="url(#g15-shadow)">
      <path d={RABBIT_E_HEAD} fill={W} />
      <path d={RABBIT_E_EAR_BACK} fill={W} />
      <path d={RABBIT_E_EAR_FRONT} fill={W} />
    </g>
  </svg>
);

/* #16 — 추상 + Soft single + 토끼 자체 그라데이션 */
const Icon16 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <GradSoftSingle id="g16-bg" />
      <GradRabbitSubtle id="g16-rabbit" />
    </defs>
    <rect width="192" height="192" fill="url(#g16-bg)" />
    <g>
      <path d={RABBIT_E_HEAD} fill="url(#g16-rabbit)" />
      <path d={RABBIT_E_EAR_BACK} fill="url(#g16-rabbit)" />
      <path d={RABBIT_E_EAR_FRONT} fill="url(#g16-rabbit)" />
    </g>
  </svg>
);

const ICONS: IconDef[] = [
  { id: 1,  pose: 'A. 측면 앉은 토끼',     detail: '림 라이트',                gradient: 'Soft glow',     svg: Icon1 },
  { id: 2,  pose: 'A. 측면 앉은 토끼',     detail: 'Drop shadow (부유)',       gradient: 'Triple-stop',   svg: Icon2 },
  { id: 3,  pose: 'A. 측면 앉은 토끼',     detail: '토끼 자체 그라데이션',     gradient: 'Aurora',        svg: Icon3 },
  { id: 4,  pose: 'A. 측면 앉은 토끼',     detail: 'Dual silhouette (depth)',  gradient: 'Warm accent',   svg: Icon4 },
  { id: 5,  pose: 'B. 측면 머리 + 두 귀', detail: '림 라이트',                gradient: 'Soft glow',     svg: Icon5 },
  { id: 6,  pose: 'B. 측면 머리 + 두 귀', detail: 'Drop shadow',              gradient: 'Aurora',        svg: Icon6 },
  { id: 7,  pose: 'B. 측면 머리 + 두 귀', detail: '토끼 자체 그라데이션',     gradient: 'Triple-stop',   svg: Icon7 },
  { id: 8,  pose: 'C. 측면 점프',         detail: '림 라이트',                gradient: 'Aurora',        svg: Icon8 },
  { id: 9,  pose: 'C. 측면 점프',         detail: 'Drop shadow (공중)',       gradient: 'Soft glow',     svg: Icon9 },
  { id: 10, pose: 'C. 측면 점프',         detail: '토끼 자체 그라데이션',     gradient: 'Warm accent',   svg: Icon10 },
  { id: 11, pose: 'D. 측면 일어선 풀바디', detail: '림 라이트',               gradient: 'Soft single',   svg: Icon11 },
  { id: 12, pose: 'D. 측면 일어선 풀바디', detail: 'Drop shadow',             gradient: 'Aurora',        svg: Icon12 },
  { id: 13, pose: 'D. 측면 일어선 풀바디', detail: 'Dual silhouette',         gradient: 'Triple-stop',   svg: Icon13 },
  { id: 14, pose: 'E. 추상 (귀+머리)',    detail: '림 라이트',                gradient: 'Soft glow',     svg: Icon14 },
  { id: 15, pose: 'E. 추상 (귀+머리)',    detail: 'Drop shadow',              gradient: 'Warm accent',   svg: Icon15 },
  { id: 16, pose: 'E. 추상 (귀+머리)',    detail: '토끼 자체 그라데이션',     gradient: 'Soft single',   svg: Icon16 },
];

const POSE_COLOR: Record<Pose, string> = {
  'A. 측면 앉은 토끼':     'bg-rose-100 text-rose-800',
  'B. 측면 머리 + 두 귀':  'bg-violet-100 text-violet-800',
  'C. 측면 점프':           'bg-amber-100 text-amber-800',
  'D. 측면 일어선 풀바디': 'bg-emerald-100 text-emerald-800',
  'E. 추상 (귀+머리)':     'bg-slate-100 text-slate-700',
};

const POSE_ORDER: Pose[] = [
  'A. 측면 앉은 토끼',
  'B. 측면 머리 + 두 귀',
  'C. 측면 점프',
  'D. 측면 일어선 풀바디',
  'E. 추상 (귀+머리)',
];

/* ──────────────────────────────────────────────────────────────────────────
 *  더미 홈 화면 mock-up — 우리 토끼 옆에 다른 앱 (회색)
 * ────────────────────────────────────────────────────────────────────────── */

function HomeMock({ icon }: { icon: ReactNode }) {
  const dummy = ['카톡', '인스타', '유튜브', '네이버', '지도', '카메라', '갤러리'];
  return (
    <div className="rounded-2xl bg-gradient-to-b from-sky-900 to-indigo-950 p-3">
      <p className="text-[10px] text-white/60 mb-2 text-center">폰 홈 화면 미리보기</p>
      <div className="grid grid-cols-4 gap-3">
        {/* 우리 아이콘 — 첫 자리 */}
        <div className="flex flex-col items-center gap-1">
          <div className="w-full aspect-square rounded-[28%] overflow-hidden shadow-md">
            {icon}
          </div>
          <span className="text-[9px] text-white/90 font-semibold">홀덤나우</span>
        </div>
        {/* 더미 회색 아이콘들 */}
        {dummy.map((name) => (
          <div key={name} className="flex flex-col items-center gap-1">
            <div className="w-full aspect-square rounded-[28%] bg-neutral-300/60" />
            <span className="text-[9px] text-white/55">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LauncherIconsPreviewPage() {
  const [selected, setSelected] = useState<IconDef | null>(null);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white border-b border-neutral-200">
        <div className="max-w-md mx-auto px-4 py-4">
          <h1 className="text-lg font-bold tracking-tight">런처 아이콘 — 3차 정제</h1>
          <p className="text-xs text-neutral-500 mt-1">
            심플 × 토끼 실루엣 × 핑크 그라데이션 — 16개 (자세 5종 × 디테일 변형)
          </p>
        </div>
      </header>

      {/* 자세별 그룹 */}
      <section className="max-w-md mx-auto px-3 py-4">
        {POSE_ORDER.map((pose) => {
          const items = ICONS.filter((i) => i.pose === pose);
          return (
            <div key={pose} className="mb-7">
              {/* 섹션 라벨 */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${POSE_COLOR[pose]}`}
                >
                  {pose}
                </span>
                <span className="text-[10px] text-neutral-400">{items.length}개</span>
              </div>

              {/* 2열 그리드 */}
              <div className="grid grid-cols-2 gap-3">
                {items.map((icon) => (
                  <button
                    key={icon.id}
                    type="button"
                    onClick={() => setSelected(icon)}
                    className="flex flex-col bg-white rounded-2xl p-3 shadow-sm border border-neutral-200 active:scale-[0.98] transition-transform"
                  >
                    <div className="relative w-full aspect-square rounded-[28%] overflow-hidden bg-neutral-100 shadow-inner">
                      {icon.svg}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-neutral-900">#{icon.id}</span>
                      <span className="text-[10px] text-neutral-400">·</span>
                      <span className="text-[10px] text-neutral-500">{icon.gradient}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-neutral-600 text-left">
                      {icon.detail}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        <p className="text-[11px] text-neutral-400 text-center mt-2 pb-8">
          탭하면 마스킹 비교 + 홈 화면 시뮬레이션 모달이 뜹니다.
        </p>
      </section>

      {/* 모달 — 큰 미리보기 + 마스킹 + 홈 화면 */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-3xl p-5 w-full max-w-sm my-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold">#{selected.id}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${POSE_COLOR[selected.pose]}`}
                >
                  {selected.pose}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-neutral-500 hover:text-neutral-900 text-sm font-medium"
              >
                닫기
              </button>
            </div>

            {/* 큰 미리보기 */}
            <div className="w-full aspect-square rounded-3xl overflow-hidden border border-neutral-200">
              {selected.svg}
            </div>

            {/* 마스킹 비교 */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center gap-1">
                <div className="w-full aspect-square rounded-[28%] overflow-hidden border border-neutral-200">
                  {selected.svg}
                </div>
                <span className="text-[10px] text-neutral-500">squircle</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="w-full aspect-square rounded-full overflow-hidden border border-neutral-200">
                  {selected.svg}
                </div>
                <span className="text-[10px] text-neutral-500">원형</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="w-full aspect-square rounded-lg overflow-hidden border border-neutral-200">
                  {selected.svg}
                </div>
                <span className="text-[10px] text-neutral-500">정사각</span>
              </div>
            </div>

            {/* 홈 화면 mock-up */}
            <div className="mt-5">
              <HomeMock icon={selected.svg} />
            </div>

            {/* 메타 정보 */}
            <div className="mt-4 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16">자세</span>
                <span className="text-[11px] text-neutral-700">{selected.pose}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16">디테일</span>
                <span className="text-[11px] text-neutral-700">{selected.detail}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16">그라데이션</span>
                <span className="text-[11px] text-neutral-700">{selected.gradient}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
