// screens-onboarding.jsx — 최초 진입 시 앱 소개 슬라이드 가이드

const { useState: useStateOB, useEffect: useEffectOB, useRef: useRefOB } = React;

// ──────────────────────────────────────────────────────
// 온보딩 슬라이드 4장 + 시작 화면
// ──────────────────────────────────────────────────────
const ONBOARDING_SLIDES = [
  {
    id: 1,
    bg: 'linear-gradient(160deg, #FF1F8F 0%, #FF6BAA 100%)',
    accent: '#fff',
    title: '내 주변 홀덤펍을\n한눈에',
    desc: '부산·경남 47개 매장 · 위치·시간·바이인까지\n검색하고 즐겨찾기로 저장하세요',
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
    dark: true, // 텍스트 다크
  },
];

function OnboardingScreen({ initialIdx = 0, onSkip, onDone }) {
  const [idx, setIdx] = useStateOB(initialIdx);
  const slide = ONBOARDING_SLIDES[idx];
  const isLast = idx === ONBOARDING_SLIDES.length - 1;
  const dark = slide.dark;
  const textColor = dark ? '#111827' : '#fff';
  const subColor = dark ? 'rgba(17,24,39,.6)' : 'rgba(255,255,255,.85)';

  const handleNext = () => {
    if (isLast) onDone && onDone();
    else setIdx(i => i + 1);
  };
  const handleSkip = () => {
    if (onSkip) onSkip();
    else if (onDone) onDone();
  };

  return (
    <div className="phone" style={{
      background: slide.bg,
      overflow:'hidden',
      display:'flex', flexDirection:'column',
      position:'relative',
      height: 760,
      transition:'background .5s ease',
    }}>
      {/* 배경 토끼 (블러) */}
      <div style={{
        position:'absolute', top:-40, right:-50,
        opacity: dark ? .12 : .16,
        pointerEvents:'none',
      }}>
        <RabbitLogo size={260} variant="mark" />
      </div>

      {/* status bar 흉내 */}
      <div style={{
        height:38, padding:'0 18px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        color: textColor, fontSize:12, fontWeight:700,
        position:'relative',
      }} className="mono">
        <span>9:41</span>
        <span style={{ display:'flex', gap:5, alignItems:'center' }}>
          <span style={{ fontSize:10 }}>●●●●●</span>
          <span style={{ fontSize:10 }}>📶</span>
          <span style={{ fontSize:10 }}>🔋</span>
        </span>
      </div>

      {/* top bar — skip */}
      <div style={{ display:'flex', justifyContent:'flex-end', padding:'4px 16px 0', position:'relative' }}>
        {!isLast && (
          <button onClick={handleSkip} className="tap" style={{
            padding:'6px 12px', borderRadius:99, fontSize:11, fontWeight:700,
            background: dark ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.18)',
            border: 'none', color: textColor, cursor:'pointer',
            backdropFilter:'blur(8px)',
          }}>건너뛰기</button>
        )}
      </div>

      {/* Illustration zone */}
      <div style={{
        flex:1, display:'flex', alignItems:'center', justifyContent:'center',
        padding:'10px 24px', position:'relative',
      }}>
        <OnboardingIllust kind={slide.illust} accent={slide.accent} dark={dark} />
      </div>

      {/* progress dots */}
      <div style={{ display:'flex', justifyContent:'center', gap:6, padding:'14px 0' }}>
        {ONBOARDING_SLIDES.map((s, i) => (
          <span key={s.id} onClick={() => setIdx(i)} className="tap" style={{
            width: i === idx ? 22 : 6, height:6, borderRadius:99,
            background: i === idx
              ? (dark ? '#111827' : '#fff')
              : (dark ? 'rgba(17,24,39,.2)' : 'rgba(255,255,255,.4)'),
            transition:'all .3s ease',
            cursor:'pointer',
          }} />
        ))}
      </div>

      {/* copy + CTA */}
      <div style={{ padding:'10px 30px 36px', position:'relative' }}>
        <div style={{
          fontSize:26, fontWeight:900, letterSpacing:'-.025em',
          lineHeight:1.2, color: textColor, whiteSpace:'pre-line',
          textShadow: dark ? 'none' : '0 2px 12px rgba(0,0,0,.1)',
        }}>{slide.title}</div>
        <div style={{
          fontSize:13, fontWeight:500, marginTop:10,
          color: subColor, lineHeight:1.6, whiteSpace:'pre-line',
        }}>{slide.desc}</div>

        <button onClick={handleNext} className="tap" style={{
          marginTop:24, width:'100%', padding:'15px 0', borderRadius:14,
          background: dark ? '#FF1F8F' : '#fff',
          color: dark ? '#fff' : (slide.accent === '#fff' ? '#FF1F8F' : '#111827'),
          fontSize:14, fontWeight:900, letterSpacing:'-.01em',
          border:'none', cursor:'pointer',
          boxShadow: dark ? '0 6px 20px rgba(255,31,143,.32)' : '0 8px 24px rgba(0,0,0,.15)',
          display:'flex', alignItems:'center', justifyContent:'center', gap:8,
          transition:'transform .15s ease',
        }}>
          {isLast ? '🐰 시작하기' : '다음'}
          {!isLast && <span style={{ fontSize:14 }}>→</span>}
        </button>

        {isLast && (
          <button onClick={handleSkip} className="tap" style={{
            marginTop:10, width:'100%', padding:'10px 0',
            background:'transparent', border:'none',
            color: textColor, fontSize:12, fontWeight:700,
            cursor:'pointer', opacity:.7,
          }}>로그인하기 →</button>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 슬라이드별 일러스트 (모두 SVG + 컴포넌트로)
// ──────────────────────────────────────────────────────
function OnboardingIllust({ kind, accent, dark }) {
  switch (kind) {
    case 'discover': return <DiscoverIllust dark={dark} />;
    case 'live':     return <LiveIllust dark={dark} />;
    case 'chat':     return <ChatIllust dark={dark} />;
    case 'calendar': return <CalendarIllust dark={dark} />;
    default: return null;
  }
}

// ── 1. 매장 발견 — 지도 + 핀 ─────────────────────────
function DiscoverIllust({ dark }) {
  return (
    <div style={{
      position:'relative', width:260, height:240,
      animation:'obFloat 4s ease-in-out infinite',
    }}>
      {/* phone 흉내 */}
      <div style={{
        position:'absolute', inset:0,
        background:'#fff', borderRadius:24,
        boxShadow:'0 16px 40px rgba(0,0,0,.25)',
        overflow:'hidden',
        transform:'rotate(-3deg)',
      }}>
        {/* 지도 grid */}
        <div style={{
          position:'absolute', inset:0,
          background:'#F3F4F6',
          backgroundImage:
            'linear-gradient(to right, rgba(0,0,0,.05) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(0,0,0,.05) 1px, transparent 1px)',
          backgroundSize:'24px 24px',
        }} />
        {/* 도로 */}
        <div style={{
          position:'absolute', top:'40%', left:0, right:0, height:6,
          background:'rgba(0,0,0,.06)', transform:'skewY(-2deg)',
        }} />
        <div style={{
          position:'absolute', top:0, bottom:0, left:'55%', width:6,
          background:'rgba(0,0,0,.06)',
        }} />

        {/* 핀들 */}
        <Pin x="20%" y="30%" color="#FF1F8F" delay="0s" big />
        <Pin x="62%" y="22%" color="#F59E0B" delay=".3s" />
        <Pin x="44%" y="58%" color="#3B82F6" delay=".6s" />
        <Pin x="74%" y="68%" color="#10B981" delay=".9s" />

        {/* 검색바 흉내 */}
        <div style={{
          position:'absolute', top:10, left:14, right:14,
          height:30, borderRadius:8,
          background:'#fff', boxShadow:'0 2px 8px rgba(0,0,0,.08)',
          display:'flex', alignItems:'center', gap:6,
          padding:'0 10px',
        }}>
          <span style={{ color:'#9CA3AF' }}>{Icons.search(12)}</span>
          <span style={{ fontSize:9, color:'#9CA3AF', fontWeight:700 }}>매장명·지역</span>
        </div>
      </div>

      {/* 떠있는 매장 카드 */}
      <div style={{
        position:'absolute', bottom:-18, right:-30,
        background:'#fff', borderRadius:14, padding:'10px 12px',
        boxShadow:'0 12px 28px rgba(0,0,0,.2)',
        display:'flex', alignItems:'center', gap:8,
        animation:'obPop 3s ease-in-out infinite',
        animationDelay:'.5s',
      }}>
        <div style={{
          width:32, height:32, borderRadius:9,
          background:'linear-gradient(135deg,#fb7185,#ef4444)',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:16,
        }}>🃏</div>
        <div>
          <div style={{ fontSize:10, fontWeight:800, color:'#111827', letterSpacing:'-.01em' }}>화명동 깜깜이 펍</div>
          <div style={{ fontSize:8, color:'#6B7280', marginTop:1, display:'flex', alignItems:'center', gap:4 }}>
            <LiveBadge size="sm" /> 1.2km
          </div>
        </div>
      </div>
    </div>
  );
}

function Pin({ x, y, color, delay, big }) {
  return (
    <div style={{
      position:'absolute', left:x, top:y, transform:'translate(-50%,-100%)',
      animation:'obPinBounce 2s ease-in-out infinite', animationDelay:delay,
    }}>
      <svg width={big ? 28 : 22} height={big ? 36 : 28} viewBox="0 0 24 30" fill={color}>
        <path d="M12 0C5.4 0 0 5.4 0 12c0 8 12 18 12 18s12-10 12-18c0-6.6-5.4-12-12-12z"/>
        <circle cx="12" cy="12" r="4" fill="#fff" />
      </svg>
      {big && (
        <div style={{
          position:'absolute', left:'50%', bottom:-14, transform:'translateX(-50%)',
          width: big ? 40 : 30, height:6, borderRadius:'50%',
          background:'rgba(0,0,0,.15)', filter:'blur(3px)',
        }} />
      )}
    </div>
  );
}

// ── 2. LIVE 토너 — 거대 타이머 + 데이터 카드 ─────────────
function LiveIllust({ dark }) {
  const [s, setS] = useStateOB(554);
  useEffectOB(() => {
    const id = setInterval(() => setS(v => v > 0 ? v - 1 : 600), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');

  return (
    <div style={{ position:'relative', width:260, height:240, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
      {/* 거대 타이머 */}
      <div style={{
        background:'rgba(0,0,0,.4)',
        borderRadius:24, padding:'20px 28px',
        backdropFilter:'blur(12px)',
        border:'1px solid rgba(255,255,255,.18)',
        boxShadow:'0 16px 40px rgba(0,0,0,.3)',
        textAlign:'center',
        animation:'obFloat 4s ease-in-out infinite',
      }}>
        <div style={{ display:'flex', justifyContent:'center', marginBottom:8 }}>
          <LiveBadge label="LIVE 진행중" />
        </div>
        <div className="mono" style={{
          fontSize:62, fontWeight:800, lineHeight:1, color:'#fff',
          textShadow:'0 4px 22px rgba(255,31,143,.5)',
          letterSpacing:'-.02em',
        }}>{mm}:{ss}</div>
        <div className="mono" style={{ fontSize:13, fontWeight:800, color:'rgba(255,255,255,.9)', marginTop:6 }}>1,000 / 2,000</div>
      </div>

      {/* 떠있는 데이터 카드 */}
      <div style={{
        position:'absolute', top:5, left:-10,
        background:'#fff', borderRadius:12, padding:'7px 12px',
        boxShadow:'0 10px 24px rgba(0,0,0,.2)',
        animation:'obFloat 4s ease-in-out infinite reverse',
        animationDelay:'.2s',
      }}>
        <div style={{ fontSize:9, fontWeight:800, color:'#6B7280', letterSpacing:'.08em' }}>PLAYERS</div>
        <div className="mono" style={{ fontSize:18, fontWeight:800, color:'#111827' }}>24<span style={{ fontSize:11, color:'#9CA3AF' }}>/30</span></div>
      </div>

      <div style={{
        position:'absolute', bottom:30, right:-14,
        background:'#fff', borderRadius:12, padding:'7px 12px',
        boxShadow:'0 10px 24px rgba(0,0,0,.2)',
        animation:'obFloat 3.5s ease-in-out infinite',
        animationDelay:'.7s',
      }}>
        <div style={{ fontSize:9, fontWeight:800, color:'#FF1F8F', letterSpacing:'.08em' }}>PRIZE POOL</div>
        <div className="mono" style={{ fontSize:18, fontWeight:800, color:'#111827' }}>₩1.1M</div>
      </div>
    </div>
  );
}

// ── 3. 채팅방 — 말풍선들 ──────────────────────────────
function ChatIllust({ dark }) {
  return (
    <div style={{ width:260, position:'relative' }}>
      {[
        { emoji:'🃏', bg:'#FFE4F1', border:'#FFC9DE', title:'오늘 9시 30T OPEN!', meta:'화명동 · 5분 전', delay:'0s' },
        { emoji:'🎰', bg:'#FFF4C2', border:'#F0D97A', title:'ROYAL CUP 1Day', meta:'서면 · 22분 전', delay:'.3s' },
        { emoji:'🥃', bg:'#D6F0FF', border:'#9DD6F5', title:'딜러 모집중', meta:'김해 · 1시간 전', delay:'.6s' },
      ].map((m, i) => (
        <div key={i} style={{
          display:'flex', gap:8, marginBottom:10,
          animation:'obSlideIn .5s ease-out backwards',
          animationDelay: m.delay,
        }}>
          <div style={{
            width:32, height:32, borderRadius:99,
            background:m.bg, border:`1px solid ${m.border}`,
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:15,
            flexShrink:0,
          }}>{m.emoji}</div>
          <div style={{
            borderRadius:'12px 12px 12px 3px',
            background:m.bg, border:`1px solid ${m.border}`,
            padding:'8px 10px', flex:1, minWidth:0,
          }}>
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:'-.01em', color:'#111827' }}>{m.title}</div>
            <div style={{ fontSize:9, color:'rgba(0,0,0,.55)', marginTop:2 }}>{m.meta}</div>
          </div>
        </div>
      ))}

      {/* "지금 입력중..." 인디케이터 */}
      <div style={{
        display:'flex', gap:8, marginTop:6,
        animation:'obFadeIn .5s ease-out',
        animationDelay:'.9s', opacity:0, animationFillMode:'forwards',
      }}>
        <div style={{ width:32, height:32, borderRadius:99, background:'rgba(255,255,255,.7)', border:'1px solid rgba(255,255,255,.9)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>🎲</div>
        <div style={{
          padding:'10px 14px', borderRadius:'12px 12px 12px 3px',
          background:'rgba(255,255,255,.6)', border:'1px solid rgba(255,255,255,.8)',
          display:'flex', gap:4, alignItems:'center',
        }}>
          {[0,1,2].map(i => (
            <span key={i} style={{
              width:5, height:5, borderRadius:99, background:'#FF1F8F',
              animation:'obTypingDot 1.2s ease-in-out infinite',
              animationDelay: `${i * .15}s`,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 4. 캘린더 — 핑크 강조 그리드 ──────────────────────
function CalendarIllust({ dark }) {
  return (
    <div style={{
      width:260, background:'#fff', borderRadius:18,
      boxShadow:'0 16px 40px rgba(0,0,0,.12)',
      border:'1px solid rgba(255,31,143,.1)',
      padding:'16px 16px 18px',
      animation:'obFloat 4s ease-in-out infinite',
    }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontSize:13, fontWeight:900, color:'#111827', letterSpacing:'-.02em' }}>2026년 5월</span>
        <span style={{ fontSize:10, fontWeight:800, color:'#FF1F8F', padding:'2px 8px', borderRadius:99, background:'#FFF0F7' }}>토너 8건</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:3, marginBottom:8 }}>
        {['일','월','화','수','목','금','토'].map((w, i) => (
          <div key={w} style={{
            fontSize:9, fontWeight:800, textAlign:'center', padding:'2px 0',
            color: i === 0 ? '#E53E3E' : i === 6 ? '#3B82F6' : '#9CA3AF',
          }}>{w}</div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:3 }}>
        {Array.from({ length: 35 }).map((_, i) => {
          const day = i - 4; // 5/1 = friday → offset 5
          if (day < 1 || day > 31) return <div key={i} />;
          const dots = { 4:1, 7:1, 11:1, 18:1, 24:2, 25:1, 28:1 };
          const isToday = day === 25;
          const isWeekend = (i % 7) === 0 || (i % 7) === 6;
          return (
            <div key={i} style={{
              aspectRatio:'1/1', display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'center',
              borderRadius:6, position:'relative',
              background: isToday ? '#FF1F8F' : 'transparent',
              color: isToday ? '#fff' : isWeekend ? ((i%7)===0?'#E53E3E':'#3B82F6') : '#111827',
              fontSize:10, fontWeight: isToday ? 800 : 600,
            }}>
              {day}
              {dots[day] && !isToday && (
                <span style={{ width:3, height:3, borderRadius:99, background: dots[day] === 1 ? '#FF1F8F' : '#F59E0B', marginTop:1 }} />
              )}
            </div>
          );
        })}
      </div>

      {/* 이벤트 카드 */}
      <div style={{
        marginTop:12, padding:'8px 10px', borderRadius:10,
        background:'linear-gradient(135deg,#FFF0F7,#FFE4F1)',
        border:'1px solid rgba(255,31,143,.15)',
        display:'flex', alignItems:'center', gap:8,
      }}>
        <div className="mono" style={{ fontSize:13, fontWeight:800, color:'#FF1F8F' }}>21:00</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:800, color:'#111827', letterSpacing:'-.01em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>데일리 히든에이스 30T</div>
          <div style={{ fontSize:9, color:'#6B7280', marginTop:1 }}>화명동 · 100만 GTD</div>
        </div>
        <span style={{ fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:5, background:'#FF1F8F', color:'#fff' }}>예약</span>
      </div>
    </div>
  );
}

// CSS animations (한 번만)
if (!document.getElementById('__onboarding-style')) {
  const s = document.createElement('style');
  s.id = '__onboarding-style';
  s.textContent = `
    @keyframes obFloat { 0%,100%{ transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes obPop { 0%,100%{ transform: translateY(0) scale(1); } 50%{ transform: translateY(-3px) scale(1.02); } }
    @keyframes obPinBounce { 0%,100%{ transform: translate(-50%,-100%) translateY(0); } 50% { transform: translate(-50%,-100%) translateY(-4px); } }
    @keyframes obSlideIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }
    @keyframes obFadeIn { from { opacity:0; } to { opacity:1; } }
    @keyframes obTypingDot { 0%,80%,100%{ transform: scale(.6); opacity:.4; } 40% { transform: scale(1); opacity:1; } }
  `;
  document.head.appendChild(s);
}

Object.assign(window, { OnboardingScreen, ONBOARDING_SLIDES });
