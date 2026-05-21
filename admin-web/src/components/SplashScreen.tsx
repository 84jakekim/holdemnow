'use client';

/**
 * 첫 진입 스플래시 — Pink Rabbit 로고 + 홍보문구.
 * sessionStorage로 세션당 1회만 노출. ~1.6초 표시 후 fade-out.
 * PWA 설치 시 OS가 manifest.icons + background_color로 별도 네이티브
 * 스플래시를 보여주지만, 웹 브라우저 첫 진입 사용자에게도 브랜드 인지를 위해
 * 이 컴포넌트가 추가 노출됨.
 */

import { useEffect, useState } from 'react';

const DISPLAY_MS = 1600;
const FADE_MS = 450;

export default function SplashScreen() {
  const [mounted, setMounted] = useState(false);
  const [hide, setHide] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // 세션당 1회만 — 페이지 이동 시 깜빡임 방지
    if (sessionStorage.getItem('pr-splash-shown')) {
      setRemoved(true);
      return;
    }
    sessionStorage.setItem('pr-splash-shown', '1');
    setMounted(true);

    const t1 = setTimeout(() => setHide(true), DISPLAY_MS);
    const t2 = setTimeout(() => setRemoved(true), DISPLAY_MS + FADE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (removed) return null;

  return (
    <div
      aria-hidden={hide}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background:
          'radial-gradient(ellipse at center, #1A0F14 0%, #08080B 70%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: mounted && !hide ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: hide ? 'none' : 'auto',
      }}
    >
      {/* 로고 — soft glow */}
      <div
        style={{
          width: 156,
          height: 156,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 60px rgba(255,31,143,0.30), 0 0 120px rgba(255,31,143,0.18)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="Pink Rabbit"
          width={156}
          height={156}
          style={{ display: 'block', width: 156, height: 156, objectFit: 'contain' }}
        />
      </div>

      {/* 홍보 문구 */}
      <div style={{ marginTop: 28, textAlign: 'center', padding: '0 24px' }}>
        <div
          style={{
            color: 'rgba(255,255,255,0.78)',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          내 주변 홀덤펍 정보는
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 28,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BAA 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
          }}
        >
          Pink Rabbit
        </div>
      </div>

      {/* 하단 미세 로딩 인디케이터 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: 44,
          display: 'flex',
          gap: 6,
        }}
      >
        <Dot delay={0} />
        <Dot delay={0.15} />
        <Dot delay={0.3} />
      </div>

      <style>{`
        @keyframes pr-splash-dot {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.75); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: '#FF1F8F',
        animation: `pr-splash-dot 1.1s ${delay}s infinite ease-in-out`,
        display: 'inline-block',
      }}
    />
  );
}
