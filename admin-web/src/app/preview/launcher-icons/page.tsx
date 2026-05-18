'use client';

/**
 * /preview/launcher-icons — PWA 런처 아이콘 시안 미리보기
 *
 * 사용자가 모바일 폰 한 화면에서 10개 시안을 육안 비교 후 선택할 수 있도록 설계.
 * - viewBox 192x192 (PWA 표준 런처 사이즈)
 * - Maskable 안전: 시각 중요 요소는 중앙 60% (offset 38.4 ~ 153.6) 안
 * - 브랜드: 핫핑크 #FF1F8F, 흰 토끼
 * - 시안 10개가 명확히 구분되는 디자인 방향으로 분산
 *
 * 채택 후 manifest 적용은 별도 작업.
 */

import { useState, type ReactNode } from 'react';

const PINK = '#FF1F8F';
const PINK_DARK = '#E01077';
const PINK_LIGHT = '#FFB8DC';
const PINK_SHADOW = '#7A0840';
const WHITE = '#FFFFFF';
const WHITE_SHADOW = '#E8E8EE';

type IconDef = {
  id: number;
  label: string;
  category: '미니멀' | '일러스트' | '추상' | '기하학';
  svg: ReactNode;
};

// 공통 viewBox: 192x192
// Safe zone (maskable): 중심 (96,96) 기준 반경 약 76.8 (=192*0.4) 내부
// 중요 요소는 x,y ∈ [38.4, 153.6]

/* #1 — 정면 미니멀 토끼 머리 / 솔리드 핑크 */
const Icon1 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <rect width="192" height="192" fill={PINK} />
    {/* 양쪽 귀 */}
    <ellipse cx="72" cy="76" rx="14" ry="32" fill={WHITE} />
    <ellipse cx="120" cy="76" rx="14" ry="32" fill={WHITE} />
    <ellipse cx="72" cy="78" rx="6" ry="20" fill={PINK_LIGHT} />
    <ellipse cx="120" cy="78" rx="6" ry="20" fill={PINK_LIGHT} />
    {/* 얼굴 */}
    <ellipse cx="96" cy="118" rx="38" ry="34" fill={WHITE} />
    {/* 눈 */}
    <circle cx="82" cy="114" r="3.2" fill={PINK_SHADOW} />
    <circle cx="110" cy="114" r="3.2" fill={PINK_SHADOW} />
    {/* 코·입 */}
    <ellipse cx="96" cy="126" rx="3" ry="2" fill={PINK_DARK} />
  </svg>
);

/* #2 — 귀만 (절제된 시그니처) / 라이트 그라데이션 */
const Icon2 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={PINK} />
        <stop offset="100%" stopColor={PINK_DARK} />
      </linearGradient>
    </defs>
    <rect width="192" height="192" fill="url(#g2)" />
    {/* 큰 토끼 귀 두 개만, 중앙 정렬 */}
    <path
      d="M 76 152 C 60 152 56 130 60 100 C 64 70 70 50 80 50 C 90 50 92 70 92 100 C 92 130 92 152 76 152 Z"
      fill={WHITE}
    />
    <path
      d="M 116 152 C 100 152 100 130 100 100 C 100 70 102 50 112 50 C 122 50 128 70 132 100 C 136 130 132 152 116 152 Z"
      fill={WHITE}
    />
    {/* 귀 안쪽 핑크 */}
    <path
      d="M 76 138 C 70 138 70 124 72 104 C 74 84 78 70 82 70 C 86 70 86 84 86 104 C 86 124 82 138 76 138 Z"
      fill={PINK_LIGHT}
    />
    <path
      d="M 116 138 C 110 138 110 124 110 104 C 110 84 110 70 114 70 C 118 70 122 84 124 104 C 126 124 122 138 116 138 Z"
      fill={PINK_LIGHT}
    />
  </svg>
);

/* #3 — 카드 든 점프 토끼 / 일러스트 */
const Icon3 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g3" cx="0.5" cy="0.35" r="0.8">
        <stop offset="0%" stopColor={PINK_LIGHT} />
        <stop offset="60%" stopColor={PINK} />
        <stop offset="100%" stopColor={PINK_DARK} />
      </radialGradient>
    </defs>
    <rect width="192" height="192" fill="url(#g3)" />
    {/* 토끼 몸 (역동적 점프) */}
    <ellipse cx="96" cy="120" rx="32" ry="26" fill={WHITE} transform="rotate(-15 96 120)" />
    {/* 머리 */}
    <ellipse cx="120" cy="86" rx="20" ry="18" fill={WHITE} />
    {/* 귀 — 뒤로 흩날림 */}
    <ellipse cx="110" cy="58" rx="6" ry="20" fill={WHITE} transform="rotate(-25 110 58)" />
    <ellipse cx="124" cy="56" rx="6" ry="20" fill={WHITE} transform="rotate(-10 124 56)" />
    <ellipse cx="110" cy="60" rx="2.5" ry="14" fill={PINK_LIGHT} transform="rotate(-25 110 60)" />
    {/* 눈 */}
    <circle cx="124" cy="84" r="2.5" fill={PINK_SHADOW} />
    <ellipse cx="118" cy="86" rx="2" ry="1.5" fill={PINK_DARK} />
    {/* 발 */}
    <ellipse cx="72" cy="138" rx="12" ry="6" fill={WHITE} transform="rotate(-20 72 138)" />
    <ellipse cx="80" cy="148" rx="10" ry="5" fill={WHITE} />
    {/* 카드 (입에 살짝) */}
    <rect
      x="134"
      y="82"
      width="18"
      height="24"
      rx="2"
      fill={WHITE}
      stroke={PINK_SHADOW}
      strokeWidth="1.5"
      transform="rotate(20 143 94)"
    />
    <path d="M 140 94 L 143 90 L 146 94 L 143 100 Z" fill={PINK_DARK} transform="rotate(20 143 94)" />
  </svg>
);

/* #4 — 기하학 원·삼각 조합 / 추상 토끼 */
const Icon4 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <rect width="192" height="192" fill={PINK} />
    {/* 얼굴: 큰 원 */}
    <circle cx="96" cy="110" r="42" fill={WHITE} />
    {/* 귀: 두 개의 길쭉한 캡슐 (둥근 직사각) */}
    <rect x="64" y="42" width="20" height="56" rx="10" fill={WHITE} />
    <rect x="108" y="42" width="20" height="56" rx="10" fill={WHITE} />
    {/* 귀 안쪽 핑크 (더 작은 캡슐) */}
    <rect x="70" y="52" width="8" height="38" rx="4" fill={PINK} />
    <rect x="114" y="52" width="8" height="38" rx="4" fill={PINK} />
    {/* 눈: 두 점 */}
    <circle cx="82" cy="108" r="4" fill={PINK_SHADOW} />
    <circle cx="110" cy="108" r="4" fill={PINK_SHADOW} />
    {/* 코: 작은 삼각형 */}
    <path d="M 92 122 L 100 122 L 96 128 Z" fill={PINK_DARK} />
  </svg>
);

/* #5 — 토끼 실루엣 안에 슈트 패턴 / 추상 브랜드 마크 */
const Icon5 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="bunnyClip5">
        {/* 토끼 실루엣 (귀 + 얼굴 합쳐진 패스) */}
        <path d="M 70 38 C 64 38 62 56 64 80 C 66 96 70 100 76 100 L 76 100 C 60 102 46 116 46 138 C 46 158 70 168 96 168 C 122 168 146 158 146 138 C 146 116 132 102 116 100 C 122 100 126 96 128 80 C 130 56 128 38 122 38 C 116 38 112 56 110 80 C 108 88 104 94 96 94 C 88 94 84 88 82 80 C 80 56 76 38 70 38 Z" />
      </clipPath>
    </defs>
    <rect width="192" height="192" fill={PINK_DARK} />
    <g clipPath="url(#bunnyClip5)">
      <rect x="0" y="0" width="192" height="192" fill={WHITE} />
      {/* 슈트 패턴 (스페이드/하트/다이아/클로버) */}
      {/* 스페이드 */}
      <path d="M 64 50 L 56 60 L 60 66 L 64 64 L 64 70 L 64 64 L 68 66 L 72 60 Z" fill={PINK} />
      {/* 하트 */}
      <path
        d="M 116 54 C 113 50 107 50 107 55 C 107 58 110 62 116 68 C 122 62 125 58 125 55 C 125 50 119 50 116 54 Z"
        fill={PINK}
      />
      {/* 다이아 */}
      <path d="M 80 130 L 86 122 L 92 130 L 86 138 Z" fill={PINK} />
      {/* 클로버 */}
      <circle cx="114" cy="128" r="4" fill={PINK} />
      <circle cx="118" cy="132" r="4" fill={PINK} />
      <circle cx="110" cy="132" r="4" fill={PINK} />
      <rect x="113" y="134" width="2" height="6" fill={PINK} />
      {/* 작은 도트들 */}
      <circle cx="60" cy="110" r="2" fill={PINK_LIGHT} />
      <circle cx="130" cy="110" r="2" fill={PINK_LIGHT} />
      <circle cx="96" cy="150" r="2" fill={PINK_LIGHT} />
    </g>
  </svg>
);

/* #6 — 'H' 모노그램 + 귀 / 미니멀 모던 */
const Icon6 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <rect width="192" height="192" fill={PINK} />
    {/* 귀: H 위로 살짝 솟아오름 */}
    <rect x="62" y="40" width="14" height="42" rx="7" fill={WHITE} />
    <rect x="116" y="40" width="14" height="42" rx="7" fill={WHITE} />
    <rect x="66" y="48" width="6" height="28" rx="3" fill={PINK_LIGHT} />
    <rect x="120" y="48" width="6" height="28" rx="3" fill={PINK_LIGHT} />
    {/* H 모노그램 */}
    <rect x="56" y="78" width="16" height="76" rx="3" fill={WHITE} />
    <rect x="120" y="78" width="16" height="76" rx="3" fill={WHITE} />
    <rect x="56" y="108" width="80" height="16" fill={WHITE} />
    {/* 가운데 가로바에 작은 슈트 마커 */}
    <path
      d="M 96 110 C 93 107 88 107 88 112 C 88 115 91 118 96 122 C 101 118 104 115 104 112 C 104 107 99 107 96 110 Z"
      fill={PINK_DARK}
    />
  </svg>
);

/* #7 — 카드 슈트 모양 귀 (스페이드 귀) / 그라데이션 */
const Icon7 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g7" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={PINK_LIGHT} />
        <stop offset="100%" stopColor={PINK_DARK} />
      </linearGradient>
    </defs>
    <rect width="192" height="192" fill="url(#g7)" />
    {/* 얼굴 */}
    <ellipse cx="96" cy="118" rx="40" ry="36" fill={WHITE} />
    {/* 왼쪽 귀 = 스페이드 모양 */}
    <path
      d="M 70 44 C 56 56 50 70 56 82 C 60 90 68 90 72 86 L 72 96 L 80 96 L 80 86 C 84 90 92 90 96 82 C 102 70 96 56 82 44 C 78 40 74 40 70 44 Z"
      fill={WHITE}
    />
    {/* 오른쪽 귀 = 하트 모양 */}
    <path
      d="M 110 50 C 105 44 95 44 95 56 C 95 64 102 72 116 86 C 130 72 137 64 137 56 C 137 44 127 44 122 50 C 119 53 117 53 116 53 C 115 53 113 53 110 50 Z"
      fill={WHITE}
    />
    {/* 귀 안쪽 강조 */}
    <circle cx="76" cy="68" r="6" fill={PINK} />
    <circle cx="116" cy="64" r="6" fill={PINK} />
    {/* 눈 */}
    <circle cx="82" cy="116" r="3" fill={PINK_SHADOW} />
    <circle cx="110" cy="116" r="3" fill={PINK_SHADOW} />
    {/* 코 */}
    <ellipse cx="96" cy="128" rx="3" ry="2" fill={PINK_DARK} />
  </svg>
);

/* #8 — 윙크하는 얼굴 + 작은 별 / 친근한 일러스트 */
const Icon8 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <rect width="192" height="192" fill={PINK} />
    {/* 작은 별 디테일 */}
    <path d="M 40 56 L 42 62 L 48 62 L 43 66 L 45 72 L 40 68 L 35 72 L 37 66 L 32 62 L 38 62 Z" fill={PINK_LIGHT} />
    <path d="M 156 144 L 158 150 L 164 150 L 159 154 L 161 160 L 156 156 L 151 160 L 153 154 L 148 150 L 154 150 Z" fill={PINK_LIGHT} />
    {/* 귀 */}
    <ellipse cx="74" cy="68" rx="13" ry="30" fill={WHITE} transform="rotate(-8 74 68)" />
    <ellipse cx="118" cy="68" rx="13" ry="30" fill={WHITE} transform="rotate(8 118 68)" />
    <ellipse cx="74" cy="72" rx="5" ry="18" fill={PINK_LIGHT} transform="rotate(-8 74 72)" />
    <ellipse cx="118" cy="72" rx="5" ry="18" fill={PINK_LIGHT} transform="rotate(8 118 72)" />
    {/* 얼굴 */}
    <ellipse cx="96" cy="116" rx="40" ry="36" fill={WHITE} />
    {/* 윙크 — 왼눈 곡선, 오른눈 점 */}
    <path d="M 76 112 Q 82 108 88 112" stroke={PINK_SHADOW} strokeWidth="3" fill="none" strokeLinecap="round" />
    <circle cx="110" cy="114" r="3.5" fill={PINK_SHADOW} />
    {/* 볼터치 */}
    <circle cx="74" cy="126" r="4" fill={PINK_LIGHT} opacity="0.7" />
    <circle cx="118" cy="126" r="4" fill={PINK_LIGHT} opacity="0.7" />
    {/* 코·웃는 입 */}
    <ellipse cx="96" cy="124" rx="2.5" ry="1.8" fill={PINK_DARK} />
    <path d="M 92 130 Q 96 134 100 130" stroke={PINK_DARK} strokeWidth="2" fill="none" strokeLinecap="round" />
  </svg>
);

/* #9 — 칩 스택 위 측면 토끼 / 기하학 + 포커 */
const Icon9 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g9" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={PINK} />
        <stop offset="100%" stopColor={PINK_SHADOW} />
      </linearGradient>
    </defs>
    <rect width="192" height="192" fill="url(#g9)" />
    {/* 칩 스택 (3겹) */}
    <ellipse cx="96" cy="150" rx="44" ry="9" fill={WHITE} />
    <rect x="52" y="142" width="88" height="8" fill={WHITE} />
    <ellipse cx="96" cy="142" rx="44" ry="9" fill={WHITE_SHADOW} />
    <ellipse cx="96" cy="138" rx="44" ry="9" fill={WHITE} />
    <rect x="52" y="130" width="88" height="8" fill={WHITE} />
    <ellipse cx="96" cy="130" rx="44" ry="9" fill={WHITE_SHADOW} />
    {/* 칩 마킹 (점선) */}
    <circle cx="60" cy="142" r="2" fill={PINK} />
    <circle cx="78" cy="142" r="2" fill={PINK} />
    <circle cx="96" cy="142" r="2" fill={PINK} />
    <circle cx="114" cy="142" r="2" fill={PINK} />
    <circle cx="132" cy="142" r="2" fill={PINK} />
    {/* 측면 토끼 (앉아있음) */}
    <ellipse cx="96" cy="98" rx="28" ry="24" fill={WHITE} />
    {/* 머리 (앞쪽) */}
    <circle cx="118" cy="86" r="16" fill={WHITE} />
    {/* 귀 (위로 솟음) */}
    <ellipse cx="112" cy="62" rx="5" ry="18" fill={WHITE} />
    <ellipse cx="122" cy="62" rx="5" ry="18" fill={WHITE} />
    <ellipse cx="122" cy="64" rx="2" ry="12" fill={PINK_LIGHT} />
    {/* 눈 */}
    <circle cx="124" cy="86" r="2.5" fill={PINK_SHADOW} />
    {/* 코 */}
    <circle cx="132" cy="90" r="1.8" fill={PINK_DARK} />
    {/* 꼬리 (작은 원) */}
    <circle cx="72" cy="104" r="6" fill={WHITE_SHADOW} />
  </svg>
);

/* #10 — 듀얼톤 추상 토끼 (브랜드 마크) */
const Icon10 = (
  <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
    {/* 배경: 대각선 듀얼톤 */}
    <rect width="192" height="192" fill={PINK} />
    <path d="M 0 0 L 192 0 L 192 192 Z" fill={PINK_DARK} />
    {/* 토끼: 두 개의 단순 도형 — 두 귀(긴 캡슐) + 얼굴(원) — 모두 흰색 */}
    {/* 추상화된 'B' 같은 형태 */}
    <g>
      {/* 왼쪽 귀 */}
      <path
        d="M 70 44 Q 64 44 64 64 L 64 96 Q 64 104 72 104 Q 80 104 80 96 L 80 64 Q 80 44 70 44 Z"
        fill={WHITE}
      />
      {/* 오른쪽 귀 */}
      <path
        d="M 122 44 Q 116 44 116 64 L 116 96 Q 116 104 124 104 Q 132 104 132 96 L 132 64 Q 132 44 122 44 Z"
        fill={WHITE}
      />
      {/* 얼굴: 모서리 둥근 squircle 느낌 */}
      <path
        d="M 96 96 Q 50 96 50 130 Q 50 158 96 158 Q 142 158 142 130 Q 142 96 96 96 Z"
        fill={WHITE}
      />
      {/* 단 하나의 디테일: 작은 분홍 점(코) — 미니멀 */}
      <circle cx="96" cy="130" r="6" fill={PINK} />
    </g>
  </svg>
);

const ICONS: IconDef[] = [
  { id: 1, label: '정면 미니멀 / 솔리드 핫핑크', category: '미니멀', svg: Icon1 },
  { id: 2, label: '귀만 — 절제된 시그니처 / 듀얼 그라데이션', category: '미니멀', svg: Icon2 },
  { id: 3, label: '카드 든 점프 토끼 / 친근한 일러스트', category: '일러스트', svg: Icon3 },
  { id: 4, label: '캡슐 귀 + 둥근 얼굴 / 기하학 도형 조합', category: '기하학', svg: Icon4 },
  { id: 5, label: '토끼 실루엣 안 슈트 패턴 / 추상 브랜드', category: '추상', svg: Icon5 },
  { id: 6, label: '"H" 모노그램 + 귀 / 모던 미니멀', category: '미니멀', svg: Icon6 },
  { id: 7, label: '스페이드·하트 귀 / 핑크 그라데이션', category: '기하학', svg: Icon7 },
  { id: 8, label: '윙크 + 작은 별 / 친근한 일러스트', category: '일러스트', svg: Icon8 },
  { id: 9, label: '칩 스택 위 측면 토끼 / 포커 결합', category: '기하학', svg: Icon9 },
  { id: 10, label: '듀얼톤 추상 토끼 / 브랜드 마크', category: '추상', svg: Icon10 },
];

const CATEGORY_COLOR: Record<IconDef['category'], string> = {
  미니멀: 'bg-slate-100 text-slate-700',
  일러스트: 'bg-amber-100 text-amber-800',
  추상: 'bg-violet-100 text-violet-800',
  기하학: 'bg-emerald-100 text-emerald-800',
};

export default function LauncherIconsPreviewPage() {
  const [selected, setSelected] = useState<IconDef | null>(null);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white border-b border-neutral-200">
        <div className="max-w-md mx-auto px-4 py-4">
          <h1 className="text-lg font-bold tracking-tight">런처 아이콘 시안 10</h1>
          <p className="text-xs text-neutral-500 mt-1">
            홈 화면 바로가기 아이콘 후보. 카드를 탭하면 크게 볼 수 있어요.
          </p>
        </div>
      </header>

      {/* 2열 그리드 */}
      <section className="max-w-md mx-auto px-3 py-4">
        <div className="grid grid-cols-2 gap-3">
          {ICONS.map((icon) => (
            <button
              key={icon.id}
              type="button"
              onClick={() => setSelected(icon)}
              className="flex flex-col bg-white rounded-2xl p-3 shadow-sm border border-neutral-200 active:scale-[0.98] transition-transform"
            >
              {/* 아이콘 컨테이너 — 정사각 */}
              <div className="relative w-full aspect-square rounded-[28%] overflow-hidden bg-neutral-100">
                {icon.svg}
              </div>
              {/* 라벨 */}
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-neutral-900">#{icon.id}</span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${CATEGORY_COLOR[icon.category]}`}
                >
                  {icon.category}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-neutral-600 text-left">
                {icon.label}
              </p>
            </button>
          ))}
        </div>

        {/* 푸터 안내 */}
        <p className="text-[11px] text-neutral-400 text-center mt-6 pb-8">
          채택 후 PWA manifest 적용은 별도 작업 진행
        </p>
      </section>

      {/* 모달 — 큰 미리보기 */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-3xl p-5 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold">#{selected.id}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${CATEGORY_COLOR[selected.category]}`}
                >
                  {selected.category}
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
            {/* 정사각 풀 미리보기 (마스크 없음) */}
            <div className="w-full aspect-square rounded-3xl overflow-hidden border border-neutral-200">
              {selected.svg}
            </div>
            {/* 마스킹 비교 (원형/squircle 적용 시 실제 OS에서 보이는 모습) */}
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
            <p className="mt-4 text-xs text-neutral-700 leading-relaxed">{selected.label}</p>
          </div>
        </div>
      )}
    </main>
  );
}
