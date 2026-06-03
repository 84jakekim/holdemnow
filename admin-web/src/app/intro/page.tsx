'use client';

/**
 * /intro — 온보딩 슬라이드 가이드 (4 slides + 시작 CTA)
 *
 * 핸드오프: claude-design/intro-handoff/pimk-rabbit/project/screens-onboarding.jsx
 * 진입: /m 첫 마운트 시 localStorage('hn:onboardingSeen') 미설정이면 redirect.
 * 종료: 마지막 슬라이드 "🐰 시작하기" 또는 어디서든 "건너뛰기" → markOnboardingSeen + /m.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RabbitLogo } from '@/components/ui';
import { markOnboardingSeen } from '@/lib/onboarding';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';

interface Slide {
  id: number;
  bg: string;
  accent: string;
  title: string;
  desc: string;
  illust: 'discover' | 'live' | 'chat' | 'calendar';
  dark?: boolean;
}

const ONBOARDING_SLIDES: Slide[] = [
  {
    id: 1,
    bg: 'linear-gradient(160deg, #FF1F8F 0%, #FF6BAA 100%)',
    accent: '#fff',
    title: '내 주변 홀덤펍을\n한눈에',
    desc: '부산·경남 홀덤펍 · 위치·시간·바이인까지\n검색하고 즐겨찾기로 저장하세요',
    illust: 'discover',
  },
  {
    id: 2,
    bg: 'linear-gradient(160deg, #831843 0%, #BE185D 50%, #FF1F8F 100%)',
    accent: '#FF6BAA',
    title: 'LIVE로 진행되는\n토너 실시간 확인',
    desc: '지금 어디서 무슨 토너가 도는지\n남은 레벨·인원·프라이즈풀까지 한번에',
    illust: 'live',
  },
  {
    id: 3,
    bg: 'linear-gradient(160deg, #FFE9D6 0%, #FFB3D4 50%, #FF6BAA 100%)',
    accent: '#FF1F8F',
    title: '오늘의 매장 소식,\n채팅방처럼',
    desc: '카카오톡 오픈채팅 톤 ·\n매장이 직접 보내는 따끈한 데일리·시리즈 공지',
    illust: 'chat',
  },
  {
    id: 4,
    bg: 'linear-gradient(160deg, #FFF8EC 0%, #FFE4F1 50%, #fff 100%)',
    accent: '#FF1F8F',
    title: '캘린더에서\n다음 토너 미리 예약',
    desc: '데일리·시리즈·새틀라이트까지\n날짜 한번에 모아보고 즐겨찾기로 알림',
    illust: 'calendar',
    dark: true,
  },
];

export default function IntroPage() {
  const router = useRouter();
  const [idx, setIdx] = useState(0);

  // ⚠️ 역할 게이트 — 사용자 온보딩은 플레이어/방문자 전용.
  //    매장·대회사·본사 계정이 (어떤 경로로든) /intro에 닿으면 자기 홈으로 즉시 돌려보낸다.
  //    "매장 아이디로 일반 사용자앱 화면을 보면 안 된다"는 핵심 정책의 안전망.
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    if (userDoc === undefined || !userDoc) return;
    if (userDoc.storeId) { router.replace(`/admin/${userDoc.storeId}`); return; }
    if (userDoc.organizerId) { router.replace(`/organizer/${userDoc.organizerId}`); return; }
    if (hasRole(userDoc, 'platform_admin')) { router.replace('/platform'); return; }
  }, [authState.status, userDoc, router]);

  // 스와이프 (터치/마우스 드래그)
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragDelta, setDragDelta] = useState(0);

  const slide = ONBOARDING_SLIDES[idx];
  const isLast = idx === ONBOARDING_SLIDES.length - 1;
  const dark = !!slide.dark;
  const textColor = dark ? '#111827' : '#fff';
  const subColor = dark ? 'rgba(17,24,39,.6)' : 'rgba(255,255,255,.85)';

  const handleNext = () => {
    if (isLast) {
      markOnboardingSeen();
      router.replace('/m');
    } else {
      setIdx((i) => i + 1);
    }
  };
  const handleSkip = () => {
    markOnboardingSeen();
    router.replace('/m');
  };

  const onStart = (clientX: number) => {
    setDragStart(clientX);
    setDragDelta(0);
  };
  const onMove = (clientX: number) => {
    if (dragStart === null) return;
    setDragDelta(clientX - dragStart);
  };
  const onEnd = () => {
    if (dragStart === null) return;
    const threshold = 60;
    if (dragDelta < -threshold && idx < ONBOARDING_SLIDES.length - 1) {
      setIdx((i) => i + 1);
    } else if (dragDelta > threshold && idx > 0) {
      setIdx((i) => i - 1);
    }
    setDragStart(null);
    setDragDelta(0);
  };

  // 키보드 ←/→ (데스크탑)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        if (idx < ONBOARDING_SLIDES.length - 1) setIdx((i) => i + 1);
        else handleNext();
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        setIdx((i) => i - 1);
      } else if (e.key === 'Escape') {
        handleSkip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  return (
    <div
      style={{
        background: slide.bg,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        transition: 'background .5s ease',
        userSelect: 'none',
      }}
      onTouchStart={(e) => onStart(e.touches[0].clientX)}
      onTouchMove={(e) => onMove(e.touches[0].clientX)}
      onTouchEnd={onEnd}
      onMouseDown={(e) => onStart(e.clientX)}
      onMouseMove={(e) => {
        if (dragStart !== null) onMove(e.clientX);
      }}
      onMouseUp={onEnd}
      onMouseLeave={onEnd}
    >
      {/* 배경 토끼 (블러) */}
      <div
        style={{
          position: 'absolute',
          top: -40,
          right: -50,
          opacity: dark ? 0.12 : 0.16,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        <RabbitLogo size={260} variant="mark" />
      </div>

      {/* top bar — 건너뛰기 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '16px 18px 0',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {!isLast && (
          <button
            onClick={handleSkip}
            className="tap"
            style={{
              padding: '8px 14px',
              borderRadius: 99,
              fontSize: 12,
              fontWeight: 700,
              background: dark ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.18)',
              border: 'none',
              color: textColor,
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
            }}
          >
            건너뛰기
          </button>
        )}
      </div>

      {/* Illustration zone */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px 24px',
          position: 'relative',
        }}
      >
        <OnboardingIllust kind={slide.illust} />
      </div>

      {/* progress dots */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 6,
          padding: '14px 0',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {ONBOARDING_SLIDES.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setIdx(i)}
            aria-label={`슬라이드 ${i + 1}`}
            className="tap"
            style={{
              width: i === idx ? 24 : 6,
              height: 6,
              borderRadius: 99,
              background:
                i === idx
                  ? dark
                    ? '#111827'
                    : '#fff'
                  : dark
                  ? 'rgba(17,24,39,.2)'
                  : 'rgba(255,255,255,.4)',
              transition: 'all .3s ease',
              cursor: 'pointer',
              border: 'none',
              padding: 0,
            }}
          />
        ))}
      </div>

      {/* copy + CTA */}
      <div style={{ padding: '12px 30px 40px', position: 'relative', zIndex: 1 }}>
        <div
          style={{
            fontSize: 26,
            fontWeight: 900,
            letterSpacing: '-0.025em',
            lineHeight: 1.2,
            color: textColor,
            whiteSpace: 'pre-line',
            textShadow: dark ? 'none' : '0 2px 12px rgba(0,0,0,.1)',
          }}
        >
          {slide.title}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            marginTop: 10,
            color: subColor,
            lineHeight: 1.6,
            whiteSpace: 'pre-line',
          }}
        >
          {slide.desc}
        </div>

        <button
          onClick={handleNext}
          className="tap"
          style={{
            marginTop: 24,
            width: '100%',
            padding: '15px 0',
            borderRadius: 14,
            background: dark ? '#FF1F8F' : '#fff',
            color: dark ? '#fff' : slide.accent === '#fff' ? '#FF1F8F' : '#111827',
            fontSize: 14,
            fontWeight: 900,
            letterSpacing: '-0.01em',
            border: 'none',
            cursor: 'pointer',
            boxShadow: dark
              ? '0 6px 20px rgba(255,31,143,.32)'
              : '0 8px 24px rgba(0,0,0,.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'transform .15s ease',
          }}
        >
          {isLast ? '🐰 시작하기' : '다음'}
          {!isLast && <span style={{ fontSize: 14 }}>→</span>}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 슬라이드별 일러스트
// ──────────────────────────────────────────────────────

function OnboardingIllust({ kind }: { kind: Slide['illust'] }) {
  switch (kind) {
    case 'discover':
      return <DiscoverIllust />;
    case 'live':
      return <LiveIllust />;
    case 'chat':
      return <ChatIllust />;
    case 'calendar':
      return <CalendarIllust />;
  }
}

// 1. 지도 + 핀
function DiscoverIllust() {
  return (
    <div
      style={{
        position: 'relative',
        width: 260,
        height: 240,
        animation: 'obFloat 4s ease-in-out infinite',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: '#fff',
          borderRadius: 24,
          boxShadow: '0 16px 40px rgba(0,0,0,.25)',
          overflow: 'hidden',
          transform: 'rotate(-3deg)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#F3F4F6',
            backgroundImage:
              'linear-gradient(to right, rgba(0,0,0,.05) 1px, transparent 1px),' +
              'linear-gradient(to bottom, rgba(0,0,0,.05) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '40%',
            left: 0,
            right: 0,
            height: 6,
            background: 'rgba(0,0,0,.06)',
            transform: 'skewY(-2deg)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '55%',
            width: 6,
            background: 'rgba(0,0,0,.06)',
          }}
        />
        <Pin x="20%" y="30%" color="#FF1F8F" delay="0s" big />
        <Pin x="62%" y="22%" color="#F59E0B" delay=".3s" />
        <Pin x="44%" y="58%" color="#3B82F6" delay=".6s" />
        <Pin x="74%" y="68%" color="#10B981" delay=".9s" />

        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 14,
            right: 14,
            height: 30,
            borderRadius: 8,
            background: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,.08)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 10px',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 700 }}>매장명·지역</span>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: -18,
          right: -30,
          background: '#fff',
          borderRadius: 14,
          padding: '10px 12px',
          boxShadow: '0 12px 28px rgba(0,0,0,.2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          animation: 'obPop 3s ease-in-out infinite',
          animationDelay: '.5s',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: 'linear-gradient(135deg,#fb7185,#ef4444)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            color: '#fff',
          }}
        >
          🃏
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#111827', letterSpacing: '-0.01em' }}>
            화명동 깜깜이 펍
          </div>
          <div style={{ fontSize: 8, color: '#6B7280', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MiniLiveBadge /> 1.2km
          </div>
        </div>
      </div>
    </div>
  );
}

function Pin({ x, y, color, delay, big }: { x: string; y: string; color: string; delay: string; big?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-50%,-100%)',
        animation: 'obPinBounce 2s ease-in-out infinite',
        animationDelay: delay,
      }}
    >
      <svg width={big ? 28 : 22} height={big ? 36 : 28} viewBox="0 0 24 30" fill={color}>
        <path d="M12 0C5.4 0 0 5.4 0 12c0 8 12 18 12 18s12-10 12-18c0-6.6-5.4-12-12-12z" />
        <circle cx="12" cy="12" r="4" fill="#fff" />
      </svg>
      {big && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -14,
            transform: 'translateX(-50%)',
            width: 40,
            height: 6,
            borderRadius: '50%',
            background: 'rgba(0,0,0,.15)',
            filter: 'blur(3px)',
          }}
        />
      )}
    </div>
  );
}

function MiniLiveBadge() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 4px',
        borderRadius: 4,
        background: 'rgba(220,38,38,0.9)',
        color: '#fff',
        fontSize: 7,
        fontWeight: 800,
      }}
    >
      <span
        style={{
          width: 3,
          height: 3,
          borderRadius: 99,
          background: '#fff',
          animation: 'pulse 1.4s ease-in-out infinite',
        }}
      />
      LIVE
    </span>
  );
}

// 2. LIVE — 거대 타이머
function LiveIllust() {
  const [s, setS] = useState(554);
  useEffect(() => {
    const id = setInterval(() => setS((v) => (v > 0 ? v - 1 : 600)), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');

  return (
    <div
      style={{
        position: 'relative',
        width: 260,
        height: 240,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'rgba(0,0,0,.4)',
          borderRadius: 24,
          padding: '20px 28px',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,.18)',
          boxShadow: '0 16px 40px rgba(0,0,0,.3)',
          textAlign: 'center',
          animation: 'obFloat 4s ease-in-out infinite',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 99,
              background: 'rgba(220,38,38,0.9)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: 99,
                background: '#fff',
                animation: 'pulse 1.4s ease-in-out infinite',
              }}
            />
            LIVE 진행중
          </span>
        </div>
        <div
          className="mono"
          style={{
            fontSize: 62,
            fontWeight: 800,
            lineHeight: 1,
            color: '#fff',
            textShadow: '0 4px 22px rgba(255,31,143,.5)',
            letterSpacing: '-0.02em',
          }}
        >
          {mm}:{ss}
        </div>
        <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,.9)', marginTop: 6 }}>
          1,000 / 2,000
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          top: 5,
          left: -10,
          background: '#fff',
          borderRadius: 12,
          padding: '7px 12px',
          boxShadow: '0 10px 24px rgba(0,0,0,.2)',
          animation: 'obFloat 4s ease-in-out infinite reverse',
          animationDelay: '.2s',
        }}
      >
        <div style={{ fontSize: 9, fontWeight: 800, color: '#6B7280', letterSpacing: '.08em' }}>PLAYERS</div>
        <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>
          24<span style={{ fontSize: 11, color: '#9CA3AF' }}>/30</span>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 30,
          right: -14,
          background: '#fff',
          borderRadius: 12,
          padding: '7px 12px',
          boxShadow: '0 10px 24px rgba(0,0,0,.2)',
          animation: 'obFloat 3.5s ease-in-out infinite',
          animationDelay: '.7s',
        }}
      >
        <div style={{ fontSize: 9, fontWeight: 800, color: '#FF1F8F', letterSpacing: '.08em' }}>PRIZE POOL</div>
        <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>
          ₩1.1M
        </div>
      </div>
    </div>
  );
}

// 3. 채팅
function ChatIllust() {
  const msgs = [
    { emoji: '🃏', bg: '#FFE4F1', border: '#FFC9DE', title: '오늘 9시 30T OPEN!', meta: '화명동 · 5분 전', delay: '0s' },
    { emoji: '🎰', bg: '#FFF4C2', border: '#F0D97A', title: 'ROYAL CUP 1Day', meta: '서면 · 22분 전', delay: '.3s' },
    { emoji: '🥃', bg: '#D6F0FF', border: '#9DD6F5', title: '딜러 모집중', meta: '김해 · 1시간 전', delay: '.6s' },
  ];
  return (
    <div style={{ width: 260, position: 'relative' }}>
      {msgs.map((m, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 10,
            animation: 'obSlideIn .5s ease-out backwards',
            animationDelay: m.delay,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 99,
              background: m.bg,
              border: `1px solid ${m.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            {m.emoji}
          </div>
          <div
            style={{
              borderRadius: '12px 12px 12px 3px',
              background: m.bg,
              border: `1px solid ${m.border}`,
              padding: '8px 10px',
              flex: 1,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '-0.01em', color: '#111827' }}>{m.title}</div>
            <div style={{ fontSize: 9, color: 'rgba(0,0,0,.55)', marginTop: 2 }}>{m.meta}</div>
          </div>
        </div>
      ))}

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 6,
          animation: 'obFadeIn .5s ease-out',
          animationDelay: '.9s',
          opacity: 0,
          animationFillMode: 'forwards',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 99,
            background: 'rgba(255,255,255,.7)',
            border: '1px solid rgba(255,255,255,.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
          }}
        >
          🎲
        </div>
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '12px 12px 12px 3px',
            background: 'rgba(255,255,255,.6)',
            border: '1px solid rgba(255,255,255,.8)',
            display: 'flex',
            gap: 4,
            alignItems: 'center',
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: 99,
                background: '#FF1F8F',
                animation: 'obTypingDot 1.2s ease-in-out infinite',
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// 4. 캘린더
function CalendarIllust() {
  const dots: Record<number, number> = { 4: 1, 7: 1, 11: 1, 18: 1, 24: 2, 25: 1, 28: 1 };
  return (
    <div
      style={{
        width: 260,
        background: '#fff',
        borderRadius: 18,
        boxShadow: '0 16px 40px rgba(0,0,0,.12)',
        border: '1px solid rgba(255,31,143,.1)',
        padding: '16px 16px 18px',
        animation: 'obFloat 4s ease-in-out infinite',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: '#111827', letterSpacing: '-0.02em' }}>2026년 5월</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: '#FF1F8F',
            padding: '2px 8px',
            borderRadius: 99,
            background: '#FFF0F7',
          }}
        >
          토너 8건
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 8 }}>
        {['일', '월', '화', '수', '목', '금', '토'].map((w, i) => (
          <div
            key={w}
            style={{
              fontSize: 9,
              fontWeight: 800,
              textAlign: 'center',
              padding: '2px 0',
              color: i === 0 ? '#E53E3E' : i === 6 ? '#3B82F6' : '#9CA3AF',
            }}
          >
            {w}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
        {Array.from({ length: 35 }).map((_, i) => {
          const day = i - 4;
          if (day < 1 || day > 31) return <div key={i} />;
          const dotCount = dots[day] ?? 0;
          const isToday = day === 25;
          const isWeekend = i % 7 === 0 || i % 7 === 6;
          return (
            <div
              key={i}
              style={{
                aspectRatio: '1/1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                position: 'relative',
                background: isToday ? '#FF1F8F' : 'transparent',
                color: isToday ? '#fff' : isWeekend ? (i % 7 === 0 ? '#E53E3E' : '#3B82F6') : '#111827',
                fontSize: 10,
                fontWeight: isToday ? 800 : 600,
              }}
            >
              {day}
              {dotCount > 0 && !isToday && (
                <span
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: 99,
                    background: dotCount === 1 ? '#FF1F8F' : '#F59E0B',
                    marginTop: 1,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 12,
          padding: '8px 10px',
          borderRadius: 10,
          background: 'linear-gradient(135deg,#FFF0F7,#FFE4F1)',
          border: '1px solid rgba(255,31,143,.15)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: '#FF1F8F' }}>
          21:00
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: '#111827',
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            데일리 히든에이스 30T
          </div>
          <div style={{ fontSize: 9, color: '#6B7280', marginTop: 1 }}>
            화명동 · 100만 GTD
          </div>
        </div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            padding: '2px 6px',
            borderRadius: 5,
            background: '#FF1F8F',
            color: '#fff',
          }}
        >
          예약
        </span>
      </div>
    </div>
  );
}
