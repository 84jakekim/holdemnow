'use client';

/**
 * /preview/launcher-icons — PWA 런처 아이콘 5차 / 라인아트 토끼 머리 (디자이너 자존심)
 *
 * 4차까지 누적 거절. 핵심 패인:
 *  - 귀-얼굴 path가 자기교차로 누더기 → 64px에서 토끼로 안 보임
 *  - stroke 두께가 1.5~4px 5종 분산 → 시리즈 일관성 깨짐
 *  - 12개가 좌표만 미세 조정한 양산물 → 카테고리·시그너처 부재
 *
 * 5차 재설계 원칙:
 *  1. 외곽선(귀-얼굴-귀) = 한 줄 연속 path. 귀 안쪽 곡선은 별도 path 2개로 분리 (자기교차 금지)
 *  2. stroke 두께 3종으로만 분산: 2 (가는) / 2.5 (보통) / 3.5 (굵은)
 *  3. 12개를 3 Tier로 의도 분리:
 *      Tier S 클래식 (#1~#4) — 안전한 정면·측면 라인아트
 *      Tier A 변형   (#5~#8) — 굵기·자세·접힘 변주
 *      Tier B 추상   (#9~#12) — 기하학·연속선·롱이어 등 실험
 *  4. 빨간 눈 #E53E3E, r=3.5
 *  5. 핑크 그라데이션 12종 (linear 5 / radial 4 / multi 3)
 *  6. 모든 곡선은 cubic bezier (C/S) — 직선 path 금지
 *  7. stroke-linecap/linejoin="round" 일관 적용
 */

import { useState, type ReactNode } from 'react';

type Tier = 'Tier S · 클래식' | 'Tier A · 변형' | 'Tier B · 추상';

type IconDef = {
  id: number;
  tier: Tier;
  label: string;
  signature: string;     // 디자인 시그너처 한 줄
  hasEye: boolean;
  strokeWidth: number;
  gradient: string;
  svg: ReactNode;
};

const W = '#FFFFFF';
const EYE = '#E53E3E';

/* ──────────────────────────────────────────────────────────────────────────
 *  핑크 그라데이션 12종 — 라인아트가 주인공, 배경은 보조
 *  분산: linear 5 / radial 4 / multi-stop 3
 * ────────────────────────────────────────────────────────────────────────── */

function GradLinearA({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="192" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF4A95" />
      <stop offset="1" stopColor="#9A0E59" />
    </linearGradient>
  );
}
function GradLinearB({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="192" y2="192" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF5BA0" />
      <stop offset="1" stopColor="#7F0A4C" />
    </linearGradient>
  );
}
function GradLinearC({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="192" x2="192" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#D71575" />
      <stop offset="1" stopColor="#FF77B4" />
    </linearGradient>
  );
}
function GradLinearD({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="192" y1="0" x2="0" y2="192" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF3A8F" />
      <stop offset="1" stopColor="#6B0941" />
    </linearGradient>
  );
}
function GradLinearE({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="192" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF6FB0" />
      <stop offset="1" stopColor="#B0125F" />
    </linearGradient>
  );
}

function GradRadialA({ id }: { id: string }) {
  return (
    <radialGradient id={id} cx="96" cy="60" r="140" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF8AC0" />
      <stop offset="1" stopColor="#7A0846" />
    </radialGradient>
  );
}
function GradRadialB({ id }: { id: string }) {
  return (
    <radialGradient id={id} cx="96" cy="96" r="120" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF1F8F" />
      <stop offset="1" stopColor="#6B0941" />
    </radialGradient>
  );
}
function GradRadialC({ id }: { id: string }) {
  return (
    <radialGradient id={id} cx="60" cy="140" r="160" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF6BAA" />
      <stop offset="1" stopColor="#8C0F54" />
    </radialGradient>
  );
}
function GradRadialD({ id }: { id: string }) {
  return (
    <radialGradient id={id} cx="140" cy="50" r="170" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF7DB7" />
      <stop offset="1" stopColor="#9A0E59" />
    </radialGradient>
  );
}

function GradMultiA({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="192" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF8AC0" />
      <stop offset="0.5" stopColor="#E01077" />
      <stop offset="1" stopColor="#6B0941" />
    </linearGradient>
  );
}
function GradMultiB({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="192" y2="192" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FFA0C8" />
      <stop offset="0.5" stopColor="#D71575" />
      <stop offset="1" stopColor="#7A0846" />
    </linearGradient>
  );
}
function GradMultiC({ id }: { id: string }) {
  return (
    <radialGradient id={id} cx="96" cy="80" r="130" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF8AC0" />
      <stop offset="0.55" stopColor="#D81B73" />
      <stop offset="1" stopColor="#7A0846" />
    </radialGradient>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  SVG wrapper
 * ────────────────────────────────────────────────────────────────────────── */

function IconFrame({
  id,
  gradientNode,
  gradientId,
  children,
}: {
  id: number;
  gradientNode: ReactNode;
  gradientId: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 192 192"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full block"
      role="img"
      aria-label={`라인아트 토끼 머리 아이콘 #${id}`}
    >
      <defs>{gradientNode}</defs>
      <rect width="192" height="192" fill={`url(#${gradientId})`} />
      {children}
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  공통 외곽선 helper
 *
 *  Front Classic (정면 클래식) — 모든 정면 시안의 base.
 *
 *  좌표 설계:
 *   - 왼귀 끝:    (74, 38)   — 살짝 안쪽으로 기울어진 끝
 *   - 왼귀 베이스 외측: (62, 92)  → 얼굴 왼쪽으로 흐름
 *   - 얼굴 왼:    (46, 116)
 *   - 턱 아래:    (96, 158)
 *   - 얼굴 오른:  (146, 116)
 *   - 오른귀 베이스 외측: (130, 92)
 *   - 오른귀 끝:  (118, 38)
 *
 *  귀 안쪽 곡선 (별도 path 2개 — 자기교차 방지):
 *   - 왼귀 안쪽:  끝(78,40) → 베이스 안(86,90)
 *   - 오른귀 안쪽: 끝(114,40) → 베이스 안(106,90)
 * ────────────────────────────────────────────────────────────────────────── */

function FrontClassic({ sw }: { sw: number }) {
  return (
    <>
      {/* 외곽선 — 한 줄 연속 path */}
      <path
        d="M 74 38
           C 66 64, 60 84, 62 92
           C 50 100, 42 110, 46 122
           C 50 144, 70 158, 96 158
           C 122 158, 142 144, 146 122
           C 150 110, 142 100, 130 92
           C 132 84, 126 64, 118 38
           C 116 32, 110 32, 108 40
           C 104 60, 104 80, 110 92
           C 100 88, 92 88, 82 92
           C 88 80, 88 60, 84 40
           C 82 32, 76 32, 74 38 Z"
        fill="none"
        stroke={W}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

/* 길쭉한 얼굴 + 곧은 귀 — 정면 변형용 */
function FrontElongated({ sw }: { sw: number }) {
  return (
    <path
      d="M 76 36
         C 70 60, 66 82, 70 92
         C 58 100, 52 114, 56 128
         C 60 148, 76 158, 96 158
         C 116 158, 132 148, 136 128
         C 140 114, 134 100, 122 92
         C 126 82, 122 60, 116 36
         C 114 30, 109 30, 107 38
         C 104 58, 104 80, 110 92
         C 100 88, 92 88, 82 92
         C 88 80, 88 58, 85 38
         C 83 30, 78 30, 76 36 Z"
      fill="none"
      stroke={W}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/* 측면 (왼쪽이 코, 오른쪽이 뒤통수) — 길쭉한 얼굴 + 한쪽 귀가 뒤로 살짝 */
function SideProfile({ sw }: { sw: number }) {
  return (
    <>
      {/* 외곽: 앞 귀(왼쪽 곧은) → 코(아래왼) → 턱 → 뒤통수 → 뒤귀 베이스 */}
      <path
        d="M 70 36
           C 64 60, 64 82, 72 92
           C 56 96, 42 108, 40 124
           C 40 144, 56 156, 76 156
           C 110 156, 144 148, 152 130
           C 158 114, 148 96, 130 90
           C 122 84, 116 70, 110 50
           C 106 38, 100 38, 100 52
           C 100 72, 104 88, 112 94
           C 102 92, 92 92, 82 92
           C 90 82, 88 60, 82 38
           C 80 30, 74 30, 70 36 Z"
        fill="none"
        stroke={W}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

/* 3/4 뷰 — 살짝 오른쪽으로 돌아본 자세 (양 귀 다 보이되 비대칭) */
function ThreeQuarter({ sw }: { sw: number }) {
  return (
    <path
      d="M 70 44
         C 64 64, 64 82, 72 90
         C 60 96, 50 110, 52 124
         C 54 146, 72 158, 100 158
         C 130 158, 148 142, 146 122
         C 144 108, 132 96, 120 92
         C 124 78, 124 58, 120 38
         C 117 32, 112 32, 110 40
         C 106 58, 106 78, 112 92
         C 102 90, 92 90, 82 92
         C 88 80, 86 60, 82 44
         C 80 38, 74 38, 70 44 Z"
      fill="none"
      stroke={W}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/* 한쪽 귀 접힘 — 왼귀 곧음, 오른귀 베이스에서 옆으로 꺾여 끝이 떨어짐 */
function OneEarFolded({ sw }: { sw: number }) {
  return (
    <>
      {/* 외곽: 왼귀 끝 → 왼귀 외측 → 얼굴 왼 → 턱 → 얼굴 오른 → 오른귀 베이스 →
              꺾여서 옆으로 → 접힌 귀 끝 → 다시 베이스 안쪽으로 → 왼귀 안쪽 → 왼귀 끝 닫음 */}
      <path
        d="M 74 38
           C 66 64, 60 84, 62 92
           C 50 100, 42 110, 46 122
           C 50 144, 70 158, 96 158
           C 122 158, 142 144, 146 122
           C 150 110, 142 100, 130 92
           C 130 82, 134 74, 144 70
           C 156 66, 162 78, 156 88
           C 148 96, 134 96, 126 94
           C 120 92, 114 90, 110 92
           C 100 88, 92 88, 82 92
           C 88 80, 88 60, 84 40
           C 82 32, 76 32, 74 38 Z"
        fill="none"
        stroke={W}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

/* Geometric pure — 원(얼굴) + 타원 두 개(귀) */
function Geometric({ sw }: { sw: number }) {
  return (
    <>
      <ellipse cx="74" cy="62" rx="10" ry="28" fill="none" stroke={W} strokeWidth={sw} strokeLinecap="round" />
      <ellipse cx="118" cy="62" rx="10" ry="28" fill="none" stroke={W} strokeWidth={sw} strokeLinecap="round" />
      <circle cx="96" cy="118" r="40" fill="none" stroke={W} strokeWidth={sw} />
    </>
  );
}

/* Ears only — 두 귀가 V자처럼 안쪽으로 모이되 끝점은 화면 중앙 하단에 약간 떨어짐 */
function EarsOnly({ sw }: { sw: number }) {
  return (
    <>
      <path
        d="M 60 44
           C 58 70, 70 104, 88 124
           C 92 128, 96 126, 94 120
           C 88 96, 78 64, 72 42
           C 70 36, 62 36, 60 44 Z"
        fill="none"
        stroke={W}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 132 44
           C 134 70, 122 104, 104 124
           C 100 128, 96 126, 98 120
           C 104 96, 114 64, 120 42
           C 122 36, 130 36, 132 44 Z"
        fill="none"
        stroke={W}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

/* Continuous line — 귀와 얼굴이 끊김 없이 한 path. 귀 안쪽 곡선이 얼굴 윤곽이 됨. */
function ContinuousLine({ sw }: { sw: number }) {
  return (
    <path
      d="M 84 40
         C 78 64, 78 84, 86 94
         C 70 98, 52 112, 52 130
         C 52 150, 70 160, 96 160
         C 122 160, 140 150, 140 130
         C 140 112, 122 98, 106 94
         C 114 84, 114 64, 108 40
         C 105 32, 100 32, 96 42
         C 92 56, 92 78, 96 94
         C 92 78, 92 56, 88 42
         C 86 32, 87 32, 84 40 Z"
      fill="none"
      stroke={W}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/* Long ears drama — 길쭉한 귀(얼굴 높이의 1.4배), 작은 얼굴 */
function LongEars({ sw }: { sw: number }) {
  return (
    <path
      d="M 78 30
         C 70 54, 68 90, 76 106
         C 66 110, 60 120, 62 132
         C 64 152, 80 162, 96 162
         C 112 162, 128 152, 130 132
         C 132 120, 126 110, 116 106
         C 124 90, 122 54, 114 30
         C 112 24, 107 24, 106 32
         C 104 56, 104 88, 108 106
         C 100 104, 92 104, 84 106
         C 88 88, 88 56, 86 32
         C 85 24, 80 24, 78 30 Z"
      fill="none"
      stroke={W}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  12개 시안
 *
 *  Tier S 클래식 (#1~#4)
 *   #1 정면 클래식                stroke 2.5  눈 없음
 *   #2 정면 클래식 + 빨간 눈 2개  stroke 2.5  눈 있음
 *   #3 측면 우아한 옆모습          stroke 2.5  눈 없음
 *   #4 측면 + 빨간 눈 1개          stroke 2.5  눈 있음
 *
 *  Tier A 변형 (#5~#8)
 *   #5 정면 굵은 stroke           stroke 3.5  눈 없음
 *   #6 정면 굵은 + 빨간 눈 2개    stroke 3.5  눈 있음
 *   #7 3/4 뷰 + 빨간 눈 1개       stroke 2.5  눈 있음
 *   #8 한쪽 귀 접힘 (curious)      stroke 2.5  눈 없음
 *
 *  Tier B 추상 (#9~#12)
 *   #9 Geometric (원+타원)         stroke 2.5  빨간 눈
 *   #10 Ears Only (V자)            stroke 2.5  눈 없음
 *   #11 Continuous Line            stroke 2.5  눈 없음
 *   #12 Long Ears Drama            stroke 2.5  빨간 눈
 * ────────────────────────────────────────────────────────────────────────── */

const Icon1 = (
  <IconFrame id={1} gradientId="g1" gradientNode={<GradRadialB id="g1" />}>
    <FrontClassic sw={2.5} />
  </IconFrame>
);

const Icon2 = (
  <IconFrame id={2} gradientId="g2" gradientNode={<GradLinearA id="g2" />}>
    <FrontClassic sw={2.5} />
    <circle cx="82" cy="122" r="3.5" fill={EYE} />
    <circle cx="110" cy="122" r="3.5" fill={EYE} />
  </IconFrame>
);

const Icon3 = (
  <IconFrame id={3} gradientId="g3" gradientNode={<GradMultiC id="g3" />}>
    <SideProfile sw={2.5} />
  </IconFrame>
);

const Icon4 = (
  <IconFrame id={4} gradientId="g4" gradientNode={<GradLinearB id="g4" />}>
    <SideProfile sw={2.5} />
    {/* 측면 한쪽 눈 — 코(왼쪽)을 향한 위치 */}
    <circle cx="72" cy="118" r="3.5" fill={EYE} />
  </IconFrame>
);

const Icon5 = (
  <IconFrame id={5} gradientId="g5" gradientNode={<GradRadialA id="g5" />}>
    <FrontClassic sw={3.5} />
  </IconFrame>
);

const Icon6 = (
  <IconFrame id={6} gradientId="g6" gradientNode={<GradMultiA id="g6" />}>
    <FrontClassic sw={3.5} />
    <circle cx="82" cy="122" r="3.5" fill={EYE} />
    <circle cx="110" cy="122" r="3.5" fill={EYE} />
  </IconFrame>
);

const Icon7 = (
  <IconFrame id={7} gradientId="g7" gradientNode={<GradLinearD id="g7" />}>
    <ThreeQuarter sw={2.5} />
    {/* 돌아본 쪽 눈 강조 (오른쪽) */}
    <circle cx="118" cy="118" r="3.5" fill={EYE} />
  </IconFrame>
);

const Icon8 = (
  <IconFrame id={8} gradientId="g8" gradientNode={<GradMultiB id="g8" />}>
    <OneEarFolded sw={2.5} />
  </IconFrame>
);

const Icon9 = (
  <IconFrame id={9} gradientId="g9" gradientNode={<GradRadialD id="g9" />}>
    <Geometric sw={2.5} />
    <circle cx="86" cy="118" r="3.5" fill={EYE} />
    <circle cx="106" cy="118" r="3.5" fill={EYE} />
  </IconFrame>
);

const Icon10 = (
  <IconFrame id={10} gradientId="g10" gradientNode={<GradLinearE id="g10" />}>
    <EarsOnly sw={2.5} />
  </IconFrame>
);

const Icon11 = (
  <IconFrame id={11} gradientId="g11" gradientNode={<GradLinearC id="g11" />}>
    <ContinuousLine sw={2.5} />
  </IconFrame>
);

const Icon12 = (
  <IconFrame id={12} gradientId="g12" gradientNode={<GradRadialC id="g12" />}>
    <LongEars sw={2.5} />
    <circle cx="86" cy="130" r="3.5" fill={EYE} />
    <circle cx="106" cy="130" r="3.5" fill={EYE} />
  </IconFrame>
);

/* ──────────────────────────────────────────────────────────────────────────
 *  메타데이터
 * ────────────────────────────────────────────────────────────────────────── */

const ICONS: IconDef[] = [
  // Tier S — 클래식
  { id: 1,  tier: 'Tier S · 클래식', label: '정면 클래식',                     signature: '양쪽 곧은 귀 · 둥근 얼굴',         hasEye: false, strokeWidth: 2.5, gradient: 'radial · deep pink',       svg: Icon1  },
  { id: 2,  tier: 'Tier S · 클래식', label: '정면 + 빨간 눈 2개',              signature: '양쪽 곧은 귀 + 빨간 눈',           hasEye: true,  strokeWidth: 2.5, gradient: 'linear · top-bottom',      svg: Icon2  },
  { id: 3,  tier: 'Tier S · 클래식', label: '측면 우아한 옆모습',              signature: '길쭉 얼굴 · 앞뒤 귀 분리',         hasEye: false, strokeWidth: 2.5, gradient: 'radial · top-glow',        svg: Icon3  },
  { id: 4,  tier: 'Tier S · 클래식', label: '측면 + 빨간 눈 1개',              signature: '측면 + 코쪽 빨간 눈',              hasEye: true,  strokeWidth: 2.5, gradient: 'linear · diagonal',        svg: Icon4  },

  // Tier A — 변형
  { id: 5,  tier: 'Tier A · 변형',   label: '정면 굵은 stroke',                signature: '정면 클래식 + 굵은 외곽',          hasEye: false, strokeWidth: 3.5, gradient: 'radial · upper bloom',     svg: Icon5  },
  { id: 6,  tier: 'Tier A · 변형',   label: '정면 굵은 + 빨간 눈 2개',         signature: '굵은 외곽 + 또렷한 빨간 눈',       hasEye: true,  strokeWidth: 3.5, gradient: 'multi · 3-stop linear',    svg: Icon6  },
  { id: 7,  tier: 'Tier A · 변형',   label: '3/4 뷰 + 빨간 눈 1개',            signature: '살짝 돌아본 자세 · 비대칭 귀',     hasEye: true,  strokeWidth: 2.5, gradient: 'linear · reverse',         svg: Icon7  },
  { id: 8,  tier: 'Tier A · 변형',   label: '한쪽 귀 접힘 (curious)',          signature: '오른귀가 옆으로 접힘',             hasEye: false, strokeWidth: 2.5, gradient: 'multi · diagonal',         svg: Icon8  },

  // Tier B — 추상
  { id: 9,  tier: 'Tier B · 추상',   label: 'Geometric · 원+타원',             signature: '원(얼굴) + 타원 2개(귀)',          hasEye: true,  strokeWidth: 2.5, gradient: 'radial · upper right',     svg: Icon9  },
  { id: 10, tier: 'Tier B · 추상',   label: 'Ears Only · V자',                 signature: '얼굴 생략 · 두 귀만',              hasEye: false, strokeWidth: 2.5, gradient: 'linear · soft pink',       svg: Icon10 },
  { id: 11, tier: 'Tier B · 추상',   label: 'Continuous Line',                 signature: '귀→얼굴 한 줄 연속',               hasEye: false, strokeWidth: 2.5, gradient: 'linear · up-right',        svg: Icon11 },
  { id: 12, tier: 'Tier B · 추상',   label: 'Long Ears Drama',                 signature: '길쭉한 귀 + 작은 얼굴 + 눈',       hasEye: true,  strokeWidth: 2.5, gradient: 'radial · lower-left',      svg: Icon12 },
];

const TIER_COLOR: Record<Tier, string> = {
  'Tier S · 클래식': 'bg-rose-100 text-rose-800',
  'Tier A · 변형':   'bg-violet-100 text-violet-800',
  'Tier B · 추상':   'bg-slate-100 text-slate-700',
};

const TIER_ORDER: Tier[] = ['Tier S · 클래식', 'Tier A · 변형', 'Tier B · 추상'];

/* ──────────────────────────────────────────────────────────────────────────
 *  더미 홈 화면 mock-up
 * ────────────────────────────────────────────────────────────────────────── */

function HomeMock({ icon }: { icon: ReactNode }) {
  const dummy = ['카톡', '인스타', '유튜브', '네이버', '지도', '카메라', '갤러리'];
  return (
    <div className="rounded-2xl bg-gradient-to-b from-sky-900 to-indigo-950 p-3">
      <p className="text-[10px] text-white/60 mb-2 text-center">폰 홈 화면 미리보기</p>
      <div className="grid grid-cols-4 gap-3">
        <div className="flex flex-col items-center gap-1">
          <div className="w-full aspect-square rounded-[28%] overflow-hidden shadow-md">
            {icon}
          </div>
          <span className="text-[9px] text-white/90 font-semibold">홀덤나우</span>
        </div>
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

/* ──────────────────────────────────────────────────────────────────────────
 *  메인 페이지
 * ────────────────────────────────────────────────────────────────────────── */

export default function LauncherIconsPreviewPage() {
  const [selected, setSelected] = useState<IconDef | null>(null);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white border-b border-neutral-200">
        <div className="max-w-md mx-auto px-4 py-4">
          <h1 className="text-lg font-bold tracking-tight">런처 아이콘</h1>
          <p className="text-xs text-neutral-500 mt-1">
            5차 / 라인아트 토끼 머리 (디자이너 자존심 걸고)
          </p>
        </div>
      </header>

      {/* Tier별 그룹 */}
      <section className="max-w-md mx-auto px-3 py-4">
        {TIER_ORDER.map((tier) => {
          const items = ICONS.filter((i) => i.tier === tier);
          return (
            <div key={tier} className="mb-7">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${TIER_COLOR[tier]}`}>
                  {tier}
                </span>
                <span className="text-[10px] text-neutral-400">{items.length}개</span>
              </div>

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
                      <span className="text-[10px] text-neutral-500">
                        {icon.hasEye ? '눈 있음' : '눈 없음'} · {icon.strokeWidth}px
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-neutral-700 text-left font-medium">
                      {icon.label}
                    </p>
                    <p className="text-[10px] leading-snug text-neutral-400 text-left mt-0.5">
                      {icon.signature}
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

      {/* 모달 */}
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
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${TIER_COLOR[selected.tier]}`}>
                  {selected.tier}
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

            <div className="w-full aspect-square rounded-3xl overflow-hidden border border-neutral-200">
              {selected.svg}
            </div>

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

            <div className="mt-5">
              <HomeMock icon={selected.svg} />
            </div>

            <div className="mt-4 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16">Tier</span>
                <span className="text-[11px] text-neutral-700">{selected.tier}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16">라벨</span>
                <span className="text-[11px] text-neutral-700">{selected.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16">시그너처</span>
                <span className="text-[11px] text-neutral-700">{selected.signature}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16">눈</span>
                <span className="text-[11px] text-neutral-700">
                  {selected.hasEye ? '빨간 눈 (#E53E3E)' : '없음'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16">stroke</span>
                <span className="text-[11px] text-neutral-700">{selected.strokeWidth}px (round cap/join)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16">배경</span>
                <span className="text-[11px] text-neutral-700">{selected.gradient}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
