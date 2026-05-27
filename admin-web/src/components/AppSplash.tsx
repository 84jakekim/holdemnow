'use client';

/**
 * AppSplash — 앱 cold start 시 토큰 복원 대기 화면 (2026-05-27 핸드오프 적용)
 *
 * 핸드오프: claude-design/logo-handoff/pimk-rabbit/project/screens-splash.jsx (SplashMain)
 * 핫핑크 그라데이션 + 별 입자 + 토끼 글로우 + 워드마크 + 점 3개 스피너 + 푸터.
 *
 * variant:
 *  - 'main' (기본) — 핑크 풀 브랜드 (cold start, /m 진입 등)
 *  - 'minimal' — 흰 배경 + 작은 로고 (빠른 페이지 전환용 — 향후 사용)
 *  - 'dark' — 다크 배경 + 작은 로고 (본사 어드민 첫 진입용 — 향후 사용)
 */

interface Props {
  variant?: 'main' | 'minimal' | 'dark';
  label?: string;
}

export default function AppSplash({ variant = 'main', label = '앱 로딩 중' }: Props) {
  if (variant === 'minimal') {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center z-[9999]"
        style={{ background: '#ffffff' }}
        aria-busy="true"
        aria-label={label}
      >
        <RabbitMark size={88} />
        <SplashSpinner color="#FF1F8F" mt={20} />
      </div>
    );
  }
  if (variant === 'dark') {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center z-[9999]"
        style={{ background: '#0A0E0C' }}
        aria-busy="true"
        aria-label={label}
      >
        <RabbitMark size={100} glow />
        <div className="mt-6 text-[14px] font-extrabold tracking-tight" style={{ color: '#fff', letterSpacing: '-0.02em' }}>
          Pink Rabbit
        </div>
        <SplashSpinner color="#FF1F8F" mt={28} />
      </div>
    );
  }

  // main — 핸드오프 SplashMain
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center z-[9999]"
      style={{
        background: 'linear-gradient(170deg, #831843 0%, #FF1F8F 60%, #FF6BAA 100%)',
        overflow: 'hidden',
        position: 'fixed',
      }}
      aria-busy="true"
      aria-label={label}
    >
      {/* 별 입자 */}
      {Array.from({ length: 20 }).map((_, i) => {
        const left = (i * 37) % 100;
        const top = (i * 19) % 100;
        const size = (i % 3) + 1;
        const delay = (i % 5) * 0.2;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${left}%`,
              top: `${top}%`,
              width: size,
              height: size,
              borderRadius: 99,
              background: '#fff',
              opacity: 0.5,
              animation: `splashTwinkle 2.4s ease-in-out infinite`,
              animationDelay: `${delay}s`,
            }}
          />
        );
      })}

      {/* 라이트 글로우 */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '32%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,.25) 0%, transparent 70%)',
          animation: 'splashGlow 3s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />

      {/* 토끼 로고 */}
      <div
        style={{
          animation: 'splashBounce 1.4s ease-out',
          filter: 'drop-shadow(0 12px 32px rgba(0,0,0,.25))',
        }}
      >
        <RabbitMark size={132} glow />
      </div>

      {/* 워드마크 */}
      <div
        style={{
          marginTop: 24,
          animation: 'splashFadeIn .8s ease-out .3s backwards',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 36,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            color: '#fff',
            textShadow: '0 2px 16px rgba(0,0,0,.2)',
          }}
        >
          Pink Rabbit
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'rgba(255,255,255,.85)',
            letterSpacing: '0.04em',
            marginTop: 6,
          }}
        >
          홀덤펍 디스커버리
        </div>
      </div>

      {/* 점 3개 스피너 */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          animation: 'splashFadeIn .8s ease-out .6s backwards',
        }}
      >
        <SplashSpinner color="rgba(255,255,255,0.9)" />
      </div>

      {/* 푸터 */}
      <div
        className="mono"
        style={{
          position: 'absolute',
          bottom: 28,
          left: 0,
          right: 0,
          textAlign: 'center',
          color: 'rgba(255,255,255,.55)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
        }}
      >
        made for BUSAN · GYEONGNAM
      </div>

      <style>{`
        @keyframes splashTwinkle {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50% { opacity: 0.8; transform: scale(1.1); }
        }
        @keyframes splashGlow {
          0%, 100% { opacity: 0.7; transform: translate(-50%,-50%) scale(1); }
          50% { opacity: 1; transform: translate(-50%,-50%) scale(1.05); }
        }
        @keyframes splashBounce {
          0% { transform: scale(0.85) translateY(8px); opacity: 0; }
          50% { transform: scale(1.04) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes splashFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes splashDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 토끼 마크 (inline SVG — 외부 자산 의존 없음, cold start 보장)
// ──────────────────────────────────────────────────────
function RabbitMark({ size = 132, glow = false }: { size?: number; glow?: boolean }) {
  const r = size * 0.225; // iOS squircle
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-label="Pink Rabbit"
      style={{
        display: 'block',
        boxShadow: glow
          ? '0 12px 38px rgba(255,31,143,.4), 0 0 0 1px rgba(255,255,255,.18) inset'
          : '0 4px 16px rgba(255,31,143,.25)',
        borderRadius: r,
      }}
    >
      <defs>
        <linearGradient id="appSplashBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF1F8F" />
          <stop offset="100%" stopColor="#FF6BAA" />
        </linearGradient>
        <radialGradient id="appSplashGlow" cx="20%" cy="20%" r="60%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="70%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14.4" ry="14.4" fill="url(#appSplashBg)" />
      <rect width="64" height="64" rx="14.4" ry="14.4" fill="url(#appSplashGlow)" />
      {/* 귀 */}
      <ellipse cx="22" cy="20" rx="4.8" ry="11" fill="#fff" transform="rotate(-12 22 20)" />
      <ellipse cx="22" cy="22" rx="1.9" ry="6.5" fill="#FFB3D4" transform="rotate(-12 22 22)" />
      <ellipse cx="42" cy="20" rx="4.8" ry="11" fill="#fff" transform="rotate(12 42 20)" />
      <ellipse cx="42" cy="22" rx="1.9" ry="6.5" fill="#FFB3D4" transform="rotate(12 42 22)" />
      {/* 머리 */}
      <circle cx="32" cy="42" r="14" fill="#fff" />
      {/* 블러시 */}
      <circle cx="23" cy="46" r="2" fill="#FFB3D4" opacity="0.8" />
      <circle cx="41" cy="46" r="2" fill="#FFB3D4" opacity="0.8" />
      {/* 눈 */}
      <ellipse cx="27" cy="40.5" rx="1.8" ry="2.4" fill="#FF1F8F" />
      <ellipse cx="37" cy="40.5" rx="1.8" ry="2.4" fill="#FF1F8F" />
      <circle cx="27.5" cy="40" r="0.7" fill="#fff" />
      <circle cx="37.5" cy="40" r="0.7" fill="#fff" />
      {/* 코 */}
      <ellipse cx="32" cy="45.4" rx="1.4" ry="1" fill="#FF1F8F" />
      {/* 입 */}
      <path
        d="M32 46.6 Q32 48.4 30.3 48.6 M32 46.6 Q32 48.4 33.7 48.6"
        stroke="#FF1F8F"
        strokeWidth="1.1"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function SplashSpinner({ color = '#FF1F8F', mt = 0 }: { color?: string; mt?: number }) {
  return (
    <div style={{ marginTop: mt, display: 'flex', gap: 6, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: color,
            animation: 'splashDot 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.15}s`,
            display: 'inline-block',
          }}
        />
      ))}
    </div>
  );
}
