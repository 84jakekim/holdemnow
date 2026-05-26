// components.jsx — Pink Rabbit 공용 빌딩 블록
// SVG RabbitLogo · LiveBadge · CountdownTimer · 작은 atoms 모음

const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

// ── SVG 토끼 로고 ────────────────────────────────────────
// size: 픽셀 크기 / variant: 'mark' (단독 토끼) | 'badge' (라운드 박스 안)
function RabbitLogo({ size = 48, variant = 'badge', primary = '#FF1F8F', glow = false }) {
  const id = useMemo(() => 'rbt' + Math.random().toString(36).slice(2, 8), []);
  const inner = '#FFB3D4';

  // 토끼 path를 그리는 inner content
  const rabbit = (
    <g>
      {/* 왼쪽 귀 */}
      <ellipse cx="22" cy="20" rx="4.8" ry="11" fill="#fff" transform="rotate(-12 22 20)" />
      <ellipse cx="22" cy="22" rx="1.9" ry="6.5" fill={inner} transform="rotate(-12 22 22)" />
      {/* 오른쪽 귀 */}
      <ellipse cx="42" cy="20" rx="4.8" ry="11" fill="#fff" transform="rotate(12 42 20)" />
      <ellipse cx="42" cy="22" rx="1.9" ry="6.5" fill={inner} transform="rotate(12 42 22)" />
      {/* 머리 */}
      <circle cx="32" cy="42" r="14" fill="#fff" />
      {/* 볼 블러시 */}
      <circle cx="23" cy="46" r="2" fill={inner} opacity=".8" />
      <circle cx="41" cy="46" r="2" fill={inner} opacity=".8" />
      {/* 눈 */}
      <ellipse cx="27" cy="40.5" rx="1.6" ry="2" fill={primary} />
      <ellipse cx="37" cy="40.5" rx="1.6" ry="2" fill={primary} />
      {/* 눈 하이라이트 */}
      <circle cx="27.5" cy="40" r=".6" fill="#fff" />
      <circle cx="37.5" cy="40" r=".6" fill="#fff" />
      {/* 코 */}
      <path d="M30.2 45.4 Q32 47.2 33.8 45.4 Q32 46.8 30.2 45.4Z" fill={primary} />
      {/* 입 */}
      <path d="M32 46.8 Q32 48.2 30.4 48.6 M32 46.8 Q32 48.2 33.6 48.6"
            stroke={primary} strokeWidth=".9" strokeLinecap="round" fill="none" />
    </g>
  );

  if (variant === 'mark') {
    // 토끼만, 배경 없음
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Pink Rabbit">
        <defs>
          <linearGradient id={id+'g'} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={primary}/>
            <stop offset="100%" stopColor="#FF6BAA"/>
          </linearGradient>
        </defs>
        {/* 토끼 색을 핑크로 채운 버전 */}
        <g>
          <ellipse cx="22" cy="20" rx="4.8" ry="11" fill={`url(#${id+'g'})`} transform="rotate(-12 22 20)" />
          <ellipse cx="22" cy="22" rx="1.9" ry="6.5" fill={inner} transform="rotate(-12 22 22)" />
          <ellipse cx="42" cy="20" rx="4.8" ry="11" fill={`url(#${id+'g'})`} transform="rotate(12 42 20)" />
          <ellipse cx="42" cy="22" rx="1.9" ry="6.5" fill={inner} transform="rotate(12 42 22)" />
          <circle cx="32" cy="42" r="14" fill={`url(#${id+'g'})`} />
          <ellipse cx="27" cy="40.5" rx="1.6" ry="2" fill="#fff" />
          <ellipse cx="37" cy="40.5" rx="1.6" ry="2" fill="#fff" />
          <path d="M30.2 45.4 Q32 47.2 33.8 45.4 Q32 46.8 30.2 45.4Z" fill="#fff" />
        </g>
      </svg>
    );
  }

  // badge variant — 라운드 박스 + 그라데이션 배경
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Pink Rabbit"
         style={glow ? { filter: 'drop-shadow(0 6px 18px rgba(255,31,143,.35))' } : undefined}>
      <defs>
        <linearGradient id={id+'g'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={primary}/>
          <stop offset="100%" stopColor="#FF6BAA"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={size >= 56 ? 18 : 14} fill={`url(#${id+'g'})`} />
      {rabbit}
    </svg>
  );
}

// ── Wordmark (로고 + 텍스트) ──────────────────────────────
function PinkRabbitWordmark({ size = 'md' }) {
  const dims = { sm: { logo: 32, text: 14 }, md: { logo: 48, text: 19 }, lg: { logo: 64, text: 28 } }[size] || { logo: 48, text: 19 };
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
      <RabbitLogo size={dims.logo} variant="badge" />
      <span style={{
        fontSize: dims.text, fontWeight: 900, letterSpacing: '-.02em',
        background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
      }}>Pink Rabbit</span>
    </div>
  );
}

// ── LIVE badge ──────────────────────────────────────────
function LiveBadge({ size = 'md', label = 'LIVE' }) {
  const sz = size === 'sm' ? { padding:'2px 7px', fontSize:9, dot:4 }
           : size === 'lg' ? { padding:'5px 12px', fontSize:12, dot:7 }
           :                 { padding:'3px 9px', fontSize:10, dot:5 };
  return (
    <span className="badge-live" style={{ padding: sz.padding, fontSize: sz.fontSize }}>
      <span className="dot" style={{ width: sz.dot, height: sz.dot }} />
      {label}
    </span>
  );
}

// ── BREAK pill ───────────────────────────────────────────
function BreakBadge({ size = 'md' }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding: size === 'sm' ? '2px 7px' : '3px 10px',
      borderRadius:999,
      fontSize: size === 'sm' ? 9 : 10,
      fontWeight:800, color:'#fff',
      background:'#F59E0B', letterSpacing:'.06em',
    }}>
      ⏸ BREAK
    </span>
  );
}

// ── Countdown timer hook — mm:ss 카운트다운 ──────────────
function useCountdown(initialSeconds, running = true, onZero) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const lastTick = useRef(Date.now());

  useEffect(() => { setSeconds(initialSeconds); lastTick.current = Date.now(); }, [initialSeconds]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSeconds(s => {
        if (s <= 0) {
          if (typeof onZero === 'function') onZero();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, onZero]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return { seconds, setSeconds, text: `${mm}:${ss}`, mm, ss };
}

// ── Toast (간단한 in-phone 노티) ──────────────────────────
function Toast({ children, show }) {
  if (!show) return null;
  return (
    <div style={{
      position:'absolute', bottom:84, left:'50%', transform:'translateX(-50%)',
      background:'#111827', color:'#fff', fontSize:12, fontWeight:700,
      padding:'10px 16px', borderRadius:999,
      boxShadow:'0 8px 24px rgba(0,0,0,.3)',
      zIndex:50, whiteSpace:'nowrap',
      animation:'toastIn .25s ease',
    }}>
      {children}
    </div>
  );
}

// CSS for toast
if (!document.getElementById('__toast-style')) {
  const s = document.createElement('style');
  s.id = '__toast-style';
  s.textContent = `@keyframes toastIn{ from { opacity:0; transform: translate(-50%, 6px); } to { opacity:1; transform: translate(-50%, 0); } }`;
  document.head.appendChild(s);
}

// ── Generic chevron / icons (인라인 SVG) ──────────────────
const Icons = {
  back: (sz=20) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>,
  chevDown: (sz=12) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>,
  pin: (sz=14) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  search: (sz=18) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  bell: (sz=18) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
  star: (sz=18, filled=false) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill={filled?'currentColor':'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  home: (sz=18, filled=false) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill={filled?'currentColor':'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12l9-9 9 9"/><path d="M5 10v11h14V10"/></svg>,
  map: (sz=18) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>,
  chat: (sz=18) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>,
  calendar: (sz=18) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  user: (sz=18) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  filter: (sz=14) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>,
  play: (sz=14) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>,
  arrow: (sz=14) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>,
};

// ── 매장 카드 emoji palette (디자인 시스템에 명시된 9종) ────
const CARD_COLORS = ['#FFE4F1','#FFE9D6','#FFF4C2','#D9F5E1','#D6F0FF','#E1D8FF','#F5D8E0','#E5E7EB','#111827'];

// ── TV 디스플레이 프리셋 5종 ─────────────────────────────
const TV_PRESETS = {
  dark: {
    name: '클래식 다크',
    bg: '#0F1419',
    timerColor: '#FF1F8F',
    textColor: '#FFFFFF',
    subTextColor: 'rgba(255,255,255,.6)',
    panelBg: 'rgba(255,255,255,.04)',
    panelBorder: 'rgba(255,255,255,.08)',
    accentColor: '#FF6BAA',
  },
  green: {
    name: '카지노 그린',
    bg: 'radial-gradient(circle at 50% 50%,#1d6b48,#0a3a2a)',
    timerColor: '#F0D97A',
    textColor: '#FFFFFF',
    subTextColor: 'rgba(255,243,200,.7)',
    panelBg: 'rgba(255,255,255,.06)',
    panelBorder: 'rgba(240,217,122,.18)',
    accentColor: '#F0D97A',
    glow: '0 0 40px rgba(240,217,122,.3)',
  },
  blue: {
    name: '로얄 블루',
    bg: 'linear-gradient(135deg,#0a1d4a,#2a4ba8,#1e3a8a)',
    timerColor: '#FFFFFF',
    textColor: '#FFFFFF',
    subTextColor: 'rgba(199,210,254,.8)',
    panelBg: 'rgba(255,255,255,.08)',
    panelBorder: 'rgba(255,255,255,.16)',
    accentColor: '#FFD700',
    glow: '0 0 40px rgba(255,255,255,.25)',
  },
  crimson: {
    name: '크림슨',
    bg: 'linear-gradient(135deg,#3a0814,#9b1c2e,#7f1d1d)',
    timerColor: '#FFFFFF',
    textColor: '#FFFFFF',
    subTextColor: 'rgba(254,205,211,.8)',
    panelBg: 'rgba(0,0,0,.25)',
    panelBorder: 'rgba(255,255,255,.10)',
    accentColor: '#FFD700',
    glow: '0 0 40px rgba(229,62,62,.5)',
  },
  white: {
    name: '미니멀 화이트',
    bg: '#FFFFFF',
    timerColor: '#111827',
    textColor: '#111827',
    subTextColor: '#6B7280',
    panelBg: '#F9FAFB',
    panelBorder: '#E5E7EB',
    accentColor: '#FF1F8F',
    glow: 'none',
    light: true,
  },
};

// expose globally for other files
Object.assign(window, {
  RabbitLogo, PinkRabbitWordmark, LiveBadge, BreakBadge,
  Toast, useCountdown, Icons, CARD_COLORS, TV_PRESETS,
});
