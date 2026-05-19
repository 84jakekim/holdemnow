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

/* low-poly 다각형 색상 팔레트 (핑크 5톤) */
const POLY = {
  vh: '#FFB8DC', // very highlight
  hi: '#FF6B9D', // highlight
  mid: '#FF4DA1',
  main: '#FF1F8F',
  dk: '#E01077',
  vdk: '#C8276A',
  deep: '#7A0840',
};

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

      {/* 토끼 머리 + 귀 low-poly 다각형들 (안쪽에서 바깥쪽 순) */}

      {/* 왼귀 — 3개 다각형 (안쪽 밝음 → 외측 어두움) */}
      <polygon points="74,36 84,42 80,82" fill={POLY.hi} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />
      <polygon points="74,36 80,82 64,92" fill={POLY.main} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />
      <polygon points="74,36 64,92 60,60" fill={POLY.vdk} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />

      {/* 오른귀 — 3개 다각형 (대칭) */}
      <polygon points="118,36 108,42 112,82" fill={POLY.hi} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />
      <polygon points="118,36 112,82 128,92" fill={POLY.main} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />
      <polygon points="118,36 128,92 132,60" fill={POLY.vdk} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />

      {/* 얼굴 상단 좌 (밝음) */}
      <polygon points="80,82 96,76 96,100 64,92" fill={POLY.vh} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />
      {/* 얼굴 상단 우 (밝음) */}
      <polygon points="112,82 96,76 96,100 128,92" fill={POLY.hi} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />

      {/* 얼굴 좌측면 */}
      <polygon points="64,92 96,100 78,140 50,118" fill={POLY.main} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />
      {/* 얼굴 우측면 */}
      <polygon points="128,92 96,100 114,140 142,118" fill={POLY.mid} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />

      {/* 턱 좌 */}
      <polygon points="50,118 78,140 96,156 74,154" fill={POLY.vdk} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />
      {/* 턱 우 */}
      <polygon points="142,118 114,140 96,156 118,154" fill={POLY.dk} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />

      {/* 턱 중앙 (제일 어두움) */}
      <polygon points="78,140 114,140 96,156" fill={POLY.deep} stroke={POLY.deep} strokeWidth="0.6" strokeLinejoin="round" />

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
    signature: '흰 배경 · 핑크 톤 다각형 면 (5톤 분산)',
    palette: '#FFB8DC / #FF6B9D / #FF1F8F / #E01077 / #C8276A / #7A0840 · 검정 텍스트',
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
