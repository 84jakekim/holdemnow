'use client';

/**
 * /preview/launcher-icons — 사장님 직접 시안 1·2·3번 핑크 변환
 *
 * sample.png (사장님 자필 4개 시안)에서 1·2·3번을 앱 핫핑크 #FF1F8F 테마로 변환.
 * 구도·자세·스타일·글자 배치는 원본 그대로 유지, 색만 교체.
 *
 *  #1 라인아트 정면 토끼 (흰 배경, 원본 오렌지→노랑 stroke → 핑크 그라데이션 stroke)
 *  #2 low-poly 다각형 정면 토끼 (흰 배경, 원본 청록·블루 다각형 → 핑크 톤 다각형)
 *  #3 필드 배경 정면 토끼 (원본 오렌지 배경 → 핑크 배경, 흰색 stroke 유지)
 */

import { useState, type ReactNode } from 'react';

type IconDef = {
  id: number;
  label: string;
  signature: string;
  palette: string;
  svg: ReactNode;
};

const FONT_STACK = "Pretendard, Inter, system-ui, -apple-system, sans-serif";

/* ──────────────────────────────────────────────────────────────────────────
 *  그라데이션 정의
 * ────────────────────────────────────────────────────────────────────────── */

function StrokeGradient1({ id }: { id: string }) {
  // 시안 1: 라인아트 stroke — 밝은핑크 → 메인핑크 → 어두운핑크 triple-stop
  return (
    <linearGradient id={id} x1="40" y1="32" x2="152" y2="132" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF6B9D" />
      <stop offset="0.55" stopColor="#FF1F8F" />
      <stop offset="1" stopColor="#C8276A" />
    </linearGradient>
  );
}

function BgGradient3({ id }: { id: string }) {
  // 시안 3: 필드 배경 — 밝은핑크 → 메인핑크 → 다크핑크
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="192" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FF6B9D" />
      <stop offset="0.5" stopColor="#FF1F8F" />
      <stop offset="1" stopColor="#7A0840" />
    </linearGradient>
  );
}

/* low-poly 다각형 색상 팔레트 (핑크 8톤 — 빛 좌상→우하 음영 표현용) */
const POLY = {
  vvh: '#FFD1E5', // very very highlight (반짝임)
  vh: '#FFB8DC', // very highlight
  hi: '#FF6B9D', // highlight
  mid: '#FF4DA1', // mid-light
  main: '#FF1F8F', // main mid
  dk: '#E01077', // mid-dark
  vdk: '#C8276A', // dark
  deeper: '#A11857', // deeper
  deep: '#7A0840', // very deep
  accent: '#5A0530', // extreme accent (귀 안쪽 최심부)
};

/* 폴리곤 외곽선 — 다이아몬드 cut 효과용 미세 stroke */
const EDGE = 'rgba(122,8,64,0.32)';
const EDGE_W = 0.6;

/* ──────────────────────────────────────────────────────────────────────────
 *  시안 1 — 라인아트 정면 토끼 (흰 배경 + 핑크 그라데이션 stroke)
 *
 *  좌표 (사장님 시안 자세 그대로):
 *   - 둥근 머리, 두 솟은 귀(끝 살짝 안쪽 좁아짐)
 *   - 작은 점 두 개 눈, 미세 코·입
 *   - 하단 "Holde'm Live" 검정 텍스트
 * ────────────────────────────────────────────────────────────────────────── */

function Design1() {
  return (
    <svg
      viewBox="0 0 192 192"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full block"
      role="img"
      aria-label="라인아트 토끼 머리 + Holde'm Live"
    >
      <defs>
        <StrokeGradient1 id="s1" />
      </defs>
      {/* 흰 배경 */}
      <rect width="192" height="192" fill="#FFFFFF" />

      {/* 토끼 외곽 — 한 줄 연속 path, 양 귀 + 둥근 머리 */}
      <path
        d="M 70 32
           C 64 60, 60 84, 64 96
           C 52 102, 44 114, 48 128
           C 52 146, 70 156, 96 156
           C 122 156, 140 146, 144 128
           C 148 114, 140 102, 128 96
           C 132 84, 128 60, 122 32
           C 120 26, 114 26, 112 34
           C 108 56, 108 80, 114 96
           C 102 92, 90 92, 78 96
           C 84 80, 84 56, 80 34
           C 78 26, 72 26, 70 32 Z"
        fill="none"
        stroke="url(#s1)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 점 두 개 눈 */}
      <circle cx="82" cy="118" r="2.6" fill="#7A0840" />
      <circle cx="110" cy="118" r="2.6" fill="#7A0840" />

      {/* 미세 코 + 입 */}
      <circle cx="96" cy="130" r="1.4" fill="#7A0840" />
      <path
        d="M 92 136 Q 96 140 100 136"
        fill="none"
        stroke="#7A0840"
        strokeWidth={1.4}
        strokeLinecap="round"
      />

      {/* 하단 텍스트 */}
      <text
        x="96"
        y="180"
        textAnchor="middle"
        fontFamily={FONT_STACK}
        fontWeight={800}
        fontSize={18}
        fill="#0A0A0A"
        letterSpacing="-0.5"
      >
        Holde&apos;m Live
      </text>
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  시안 2 — low-poly 다각형 정면 토끼
 *
 *  원본 청록·블루·민트 다각형 → 핫핑크 톤 다각형들.
 *  머리·귀를 5~10개 폴리곤으로 구성, 각 폴리곤마다 살짝 다른 핑크.
 * ────────────────────────────────────────────────────────────────────────── */

function Design2() {
  // 폴리곤 공통 props — 다이아몬드 cut 효과용 미세 stroke
  const p = {
    stroke: EDGE,
    strokeWidth: EDGE_W,
    strokeLinejoin: 'round' as const,
  };

  return (
    <svg
      viewBox="0 0 192 192"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full block"
      role="img"
      aria-label="low-poly 다각형 토끼 머리 + Holde'm Live"
    >
      {/* 흰 배경 */}
      <rect width="192" height="192" fill="#FFFFFF" />

      {/*
        토끼 머리 + 귀 low-poly mesh (총 28 폴리곤)
        빛 방향: 좌상단 → 우하단 (135deg)
        - 좌상·코·뺨 위·귀 외측 끝 = 하이라이트
        - 우하·턱 하단·귀 안쪽 = 그림자
      */}

      {/* ═══════════ 왼귀 (6 폴리곤) ═══════════
          외측 = 빛 받는 쪽 (밝음), 안쪽 = 어두움 */}
      {/* L-귀 외측 상단 (가장 밝은 하이라이트 — 빛 정면) */}
      <polygon {...p} points="72,30 80,38 76,58" fill={POLY.vvh} />
      {/* L-귀 외측 중단 */}
      <polygon {...p} points="72,30 76,58 66,68" fill={POLY.vh} />
      {/* L-귀 외측 하단 (얼굴 합류) */}
      <polygon {...p} points="66,68 76,58 80,82 64,92" fill={POLY.hi} />
      {/* L-귀 안쪽 상단 (그림자) */}
      <polygon {...p} points="72,30 80,38 84,52" fill={POLY.vdk} />
      {/* L-귀 안쪽 중단 (더 깊은 그림자) */}
      <polygon {...p} points="80,38 84,52 80,82" fill={POLY.deeper} />
      {/* L-귀 안쪽 최심부 (극강 어두운 액센트) */}
      <polygon {...p} points="76,58 80,82 84,52" fill={POLY.accent} />

      {/* ═══════════ 오른귀 (6 폴리곤) ═══════════
          좌우대칭이되 빛 방향상 왼귀보다 한 톤 어두움 */}
      {/* R-귀 외측 상단 */}
      <polygon {...p} points="120,30 112,38 116,58" fill={POLY.vh} />
      {/* R-귀 외측 중단 */}
      <polygon {...p} points="120,30 116,58 126,68" fill={POLY.hi} />
      {/* R-귀 외측 하단 (얼굴 합류) */}
      <polygon {...p} points="126,68 116,58 112,82 128,92" fill={POLY.mid} />
      {/* R-귀 안쪽 상단 (그림자) */}
      <polygon {...p} points="120,30 112,38 108,52" fill={POLY.deeper} />
      {/* R-귀 안쪽 중단 */}
      <polygon {...p} points="112,38 108,52 112,82" fill={POLY.deep} />
      {/* R-귀 안쪽 최심부 (극강 어두움) */}
      <polygon {...p} points="116,58 112,82 108,52" fill={POLY.accent} />

      {/* ═══════════ 얼굴 상단 (4 폴리곤) ═══════════ */}
      {/* 얼굴 정수리 좌 (이마 하이라이트) */}
      <polygon {...p} points="64,92 80,82 96,84 88,100" fill={POLY.vh} />
      {/* 얼굴 정수리 우 (빛 약함 — 한 톤 어두움) */}
      <polygon {...p} points="128,92 112,82 96,84 104,100" fill={POLY.mid} />
      {/* 이마 중앙 (콧잔등 위쪽 — 돌출 하이라이트) */}
      <polygon {...p} points="88,100 96,84 104,100 96,108" fill={POLY.hi} />
      {/* 이마 정중앙 작은 반짝임 폴리곤 */}
      <polygon {...p} points="88,100 96,108 96,84" fill={POLY.vvh} />

      {/* ═══════════ 얼굴 좌측면 (4 폴리곤) ═══════════ */}
      {/* 좌측 광대 위 (빛 받는 쪽) */}
      <polygon {...p} points="64,92 88,100 78,118 56,108" fill={POLY.mid} />
      {/* 좌측 광대 (뺨 하이라이트 — 작은 면) */}
      <polygon {...p} points="88,100 96,108 86,124 78,118" fill={POLY.hi} />
      {/* 좌측 옆얼굴 (외곽 음영) */}
      <polygon {...p} points="56,108 78,118 70,140 50,128" fill={POLY.main} />
      {/* 좌측 턱 라인 */}
      <polygon {...p} points="78,118 86,124 82,142 70,140" fill={POLY.dk} />

      {/* ═══════════ 얼굴 우측면 (4 폴리곤 — 그림자 측) ═══════════ */}
      {/* 우측 광대 위 */}
      <polygon {...p} points="128,92 104,100 114,118 136,108" fill={POLY.dk} />
      {/* 우측 광대 (뺨) */}
      <polygon {...p} points="104,100 96,108 106,124 114,118" fill={POLY.main} />
      {/* 우측 옆얼굴 (외곽 음영 — 더 어두움) */}
      <polygon {...p} points="136,108 114,118 122,140 142,128" fill={POLY.vdk} />
      {/* 우측 턱 라인 */}
      <polygon {...p} points="114,118 106,124 110,142 122,140" fill={POLY.deeper} />

      {/* ═══════════ 얼굴 중앙 하단 / 턱 (4 폴리곤) ═══════════ */}
      {/* 코·인중 부근 (작은 하이라이트 면) */}
      <polygon {...p} points="86,124 96,108 106,124 96,128" fill={POLY.vh} />
      {/* 중앙 턱 위 */}
      <polygon {...p} points="86,124 96,128 106,124 96,142" fill={POLY.main} />
      {/* 좌 턱 하단 */}
      <polygon {...p} points="82,142 96,142 96,158 70,140" fill={POLY.vdk} />
      {/* 우 턱 하단 (더 어두움) */}
      <polygon {...p} points="110,142 96,142 96,158 122,140" fill={POLY.deep} />

      {/* 하단 텍스트 */}
      <text
        x="96"
        y="180"
        textAnchor="middle"
        fontFamily={FONT_STACK}
        fontWeight={800}
        fontSize={18}
        fill="#0A0A0A"
        letterSpacing="-0.5"
      >
        Holde&apos;m Live
      </text>
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  시안 3 — 필드 배경 정면 토끼 (핑크 배경 + 흰 stroke)
 *
 *  원본 오렌지→노랑 풀필 → 핑크 그라데이션 풀필
 *  토끼 stroke는 흰색 3px 유지 (원본 그대로)
 *  텍스트는 흰색 bold (원본 그대로)
 * ────────────────────────────────────────────────────────────────────────── */

function Design3() {
  return (
    <svg
      viewBox="0 0 192 192"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full block"
      role="img"
      aria-label="핑크 필드 배경 토끼 머리 + Holde'm Live"
    >
      <defs>
        <BgGradient3 id="bg3" />
      </defs>
      {/* 핑크 그라데이션 배경 */}
      <rect width="192" height="192" fill="url(#bg3)" />

      {/* 토끼 외곽 — 시안 1과 동일 자세, 흰색 stroke */}
      <path
        d="M 70 32
           C 64 60, 60 84, 64 96
           C 52 102, 44 114, 48 128
           C 52 146, 70 156, 96 156
           C 122 156, 140 146, 144 128
           C 148 114, 140 102, 128 96
           C 132 84, 128 60, 122 32
           C 120 26, 114 26, 112 34
           C 108 56, 108 80, 114 96
           C 102 92, 90 92, 78 96
           C 84 80, 84 56, 80 34
           C 78 26, 72 26, 70 32 Z"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 점 두 개 눈 (흰색) */}
      <circle cx="82" cy="118" r="2.6" fill="#FFFFFF" />
      <circle cx="110" cy="118" r="2.6" fill="#FFFFFF" />

      {/* 코 + 입 */}
      <circle cx="96" cy="130" r="1.4" fill="#FFFFFF" />
      <path
        d="M 92 136 Q 96 140 100 136"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={1.4}
        strokeLinecap="round"
      />

      {/* 하단 텍스트 — 흰색 */}
      <text
        x="96"
        y="180"
        textAnchor="middle"
        fontFamily={FONT_STACK}
        fontWeight={800}
        fontSize={18}
        fill="#FFFFFF"
        letterSpacing="-0.5"
      >
        Holde&apos;m Live
      </text>
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  시안 메타데이터
 * ────────────────────────────────────────────────────────────────────────── */

const ICONS: IconDef[] = [
  {
    id: 1,
    label: '라인아트 정면 토끼',
    signature: '흰 배경 · 핑크 그라데이션 stroke (밝은핑크→메인→어두운핑크)',
    palette: '#FF6B9D → #FF1F8F → #C8276A · 검정 텍스트',
    svg: <Design1 />,
  },
  {
    id: 2,
    label: 'low-poly 다각형 토끼',
    signature: '흰 배경 · 28 폴리곤 정교한 mesh · 빛 좌상→우하 일관 음영',
    palette: '핑크 10톤 (#FFD1E5 하이라이트 → #5A0530 액센트) · 얇은 외곽 stroke · 검정 텍스트',
    svg: <Design2 />,
  },
  {
    id: 3,
    label: '필드 배경 + 흰 stroke',
    signature: '핑크 그라데이션 풀필 배경 · 흰 토끼 · 흰 텍스트',
    palette: 'bg #FF6B9D → #FF1F8F → #7A0840 · stroke/text 흰색',
    svg: <Design3 />,
  },
];

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
          <h1 className="text-lg font-bold tracking-tight">
            런처 아이콘 — 사장님 시안 핑크 변환 3종
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            1번 라인아트 / 2번 low-poly / 3번 필드 배경
          </p>
          <p className="text-[11px] text-neutral-400 mt-1">
            sample.png 1·2·3번 시안을 앱 핫핑크 #FF1F8F 테마로 변환. 자세·비율·텍스트 그대로.
          </p>
        </div>
      </header>

      {/* 1열 그리드 */}
      <section className="max-w-md mx-auto px-3 py-5">
        <div className="grid grid-cols-1 gap-4">
          {ICONS.map((icon) => (
            <button
              key={icon.id}
              type="button"
              onClick={() => setSelected(icon)}
              className="flex flex-col bg-white rounded-3xl p-4 shadow-sm border border-neutral-200 active:scale-[0.99] transition-transform"
            >
              <div className="relative w-full aspect-square rounded-[28%] overflow-hidden bg-neutral-100 shadow-inner">
                {icon.svg}
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-base font-bold text-neutral-900">#{icon.id}</span>
                <span className="text-sm font-semibold text-neutral-800">{icon.label}</span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-neutral-600 text-left">
                {icon.signature}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-neutral-400 text-left">
                {icon.palette}
              </p>
            </button>
          ))}
        </div>

        <p className="text-[11px] text-neutral-400 text-center mt-5 pb-8">
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
                <span className="text-[11px] text-neutral-600">{selected.label}</span>
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
              <div className="flex items-start gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16 shrink-0 pt-0.5">라벨</span>
                <span className="text-[11px] text-neutral-700">{selected.label}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16 shrink-0 pt-0.5">시그너처</span>
                <span className="text-[11px] text-neutral-700">{selected.signature}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[10px] text-neutral-400 font-semibold w-16 shrink-0 pt-0.5">팔레트</span>
                <span className="text-[11px] text-neutral-700">{selected.palette}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
