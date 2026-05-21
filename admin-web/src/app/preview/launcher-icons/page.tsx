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

/* low-poly 다각형 색상 팔레트
 * 사장님 원안의 청록·블루 5톤을 핑크 5톤으로 1:1 매핑.
 *   원안 가장 밝은 민트  → vh  (#FFB8DC)
 *   원안 밝은 시안       → hi  (#FF6B9D)
 *   원안 미들 블루       → main(#FF1F8F)
 *   원안 짙은 블루       → vdk (#C8276A)
 *   원안 최심 다크 블루  → deep(#7A0840)
 */
const POLY = {
  vh: '#FFB8DC',  // 원안 최밝은 민트 대응
  hi: '#FF6B9D',  // 원안 밝은 시안 대응
  main: '#FF1F8F',// 원안 미들 블루 대응
  vdk: '#C8276A', // 원안 짙은 블루 대응
  deep: '#7A0840',// 원안 최심부 다크 블루 대응
};

/* 폴리곤 외곽선 — 원안에 외곽선 거의 없음, 매우 미세하게만 */
const EDGE = 'rgba(122,8,64,0.18)';
const EDGE_W = 0.4;

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
        사장님 원안 (sample.png 우상단) mesh 1:1 복원.
        - 길고 좁은 귀 2개 (얼굴 높이와 비등)
        - 머리는 위 좁고 아래 살짝 넓은 사다리꼴
        - 한 귀당 폴리곤 3개 (외측·내측·안쪽 V그림자)
        - 얼굴은 큰 면 위주 약 7개
        - 총 13개 폴리곤 (절제미)
        - 빛 방향: 좌상→우하 (왼쪽 밝음, 오른쪽 짙음)
        - 자체해석 금지: 다이아 cut/반짝임/추가 분할 없음
      */}

      {/* ══════ 왼귀 (3 폴리곤) — 길고 좁음, 좌상이 가장 밝음 ══════ */}
      {/* L-귀 외측면 (빛 받는 면 — 가장 밝은 핑크) */}
      <polygon {...p} points="74,22 82,30 86,96 70,94" fill={POLY.vh} />
      {/* L-귀 내측면 (중간 톤) */}
      <polygon {...p} points="82,30 90,40 92,96 86,96" fill={POLY.main} />
      {/* L-귀 안쪽 V 그림자 (최심부) */}
      <polygon {...p} points="82,30 90,40 86,96" fill={POLY.deep} />

      {/* ══════ 오른귀 (3 폴리곤) — 빛 반대측이라 한 단계 짙음 ══════ */}
      {/* R-귀 외측면 */}
      <polygon {...p} points="118,22 110,30 106,96 122,94" fill={POLY.hi} />
      {/* R-귀 내측면 */}
      <polygon {...p} points="110,30 102,40 100,96 106,96" fill={POLY.vdk} />
      {/* R-귀 안쪽 V 그림자 (최심부) */}
      <polygon {...p} points="110,30 102,40 106,96" fill={POLY.deep} />

      {/* ══════ 얼굴 (7 폴리곤) — 사다리꼴, 큰 면 위주 ══════ */}
      {/* 이마 좌측 (빛 받는 밝은 면) */}
      <polygon {...p} points="70,94 96,90 96,118 60,118" fill={POLY.vh} />
      {/* 이마 우측 (한 톤 짙음) */}
      <polygon {...p} points="122,94 96,90 96,118 132,118" fill={POLY.main} />
      {/* 좌 뺨·턱 (중간 핑크) */}
      <polygon {...p} points="60,118 96,118 92,156 66,148" fill={POLY.hi} />
      {/* 우 뺨·턱 (짙은 핑크) */}
      <polygon {...p} points="132,118 96,118 100,156 126,148" fill={POLY.vdk} />
      {/* 턱 하단 좌 */}
      <polygon {...p} points="66,148 92,156 96,166" fill={POLY.main} />
      {/* 턱 하단 우 (가장 짙음) */}
      <polygon {...p} points="126,148 100,156 96,166" fill={POLY.deep} />
      {/* 코·중앙 분할선 (얇은 중심 면 — 좌우 대비 강조) */}
      <polygon {...p} points="96,90 96,166 100,156 96,118" fill={POLY.vdk} />

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
    signature: '흰 배경 · 사장님 원안 mesh 1:1 (13 폴리곤) · 색만 핑크 변환',
    palette: '핑크 5톤 (#FFB8DC → #FF6B9D → #FF1F8F → #C8276A → #7A0840) · 검정 텍스트',
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
          <span className="text-[9px] text-white/90 font-semibold">핑크래빗</span>
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
