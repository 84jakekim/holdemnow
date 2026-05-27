// screens-splash.jsx — 앱 실행 시 스플래시 화면 변형들

const { useState: useStateSP, useEffect: useEffectSP } = React;

// ──────────────────────────────────────────────────────
// 메인 스플래시 (브랜드)
// ──────────────────────────────────────────────────────
function SplashMain({ live = true }) {
  const [tick, setTick] = useStateSP(0);
  useEffectSP(() => {
    const id = setInterval(() => setTick(t => t + 1), 16);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="phone" style={{
      background:'linear-gradient(170deg, #831843 0%, #FF1F8F 60%, #FF6BAA 100%)',
      overflow:'hidden', position:'relative',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      height: 760,
    }}>
      {/* 별/입자 */}
      {[...Array(20)].map((_, i) => {
        const left = (i * 37) % 100;
        const top = (i * 19) % 100;
        const size = (i % 3) + 1;
        const delay = (i % 5) * 0.2;
        return (
          <span key={i} style={{
            position:'absolute', left:`${left}%`, top:`${top}%`,
            width:size, height:size, borderRadius:99,
            background:'#fff', opacity:.5,
            animation:`splashTwinkle 2.4s ease-in-out infinite`,
            animationDelay:`${delay}s`,
          }} />
        );
      })}

      {/* 라이트 글로우 */}
      <div style={{
        position:'absolute', top:'30%', left:'50%', transform:'translate(-50%,-50%)',
        width:300, height:300, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(255,255,255,.25) 0%, transparent 70%)',
        animation:'splashGlow 3s ease-in-out infinite',
        pointerEvents:'none',
      }} />

      {/* status bar */}
      <div style={{
        position:'absolute', top:0, left:0, right:0,
        height:42, padding:'0 20px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        color:'#fff', fontSize:12, fontWeight:700,
      }} className="mono">
        <span>9:41</span>
        <span style={{ display:'flex', gap:5 }}>●●●●● 📶 100%</span>
      </div>

      {/* 토끼 마크 */}
      <div style={{
        animation:'splashBounce 1.8s ease-out',
        filter:'drop-shadow(0 12px 32px rgba(0,0,0,.25))',
      }}>
        <AppIcon size={132} shape="ios" glow />
      </div>

      {/* 워드마크 — 페이드인 */}
      <div style={{
        marginTop:24,
        animation:'splashFadeIn .8s ease-out .4s backwards',
        textAlign:'center',
      }}>
        <div style={{
          fontSize:36, fontWeight:900, letterSpacing:'-.03em', color:'#fff',
          textShadow:'0 2px 16px rgba(0,0,0,.2)',
        }}>Pink Rabbit</div>
        <div style={{
          fontSize:12, fontWeight:700, color:'rgba(255,255,255,.85)',
          letterSpacing:'.04em', marginTop:6,
        }}>홀덤펍 디스커버리</div>
      </div>

      {/* LIVE 카운트 — 페이드인 */}
      {live && (
        <div style={{
          marginTop:36,
          animation:'splashFadeIn .8s ease-out .8s backwards',
          display:'flex', alignItems:'center', gap:8,
          padding:'8px 16px', borderRadius:99,
          background:'rgba(255,255,255,.18)', backdropFilter:'blur(12px)',
          border:'1px solid rgba(255,255,255,.22)',
          color:'#fff',
        }}>
          <LiveBadge size="sm" />
          <span style={{ fontSize:12, fontWeight:800, letterSpacing:'-.01em' }}>지금 진행중 토너 6건</span>
        </div>
      )}

      {/* 로딩 인디케이터 */}
      <div style={{ position:'absolute', bottom:80, left:'50%', transform:'translateX(-50%)' }}>
        <SplashSpinner />
      </div>

      {/* footer */}
      <div style={{
        position:'absolute', bottom:24, left:0, right:0,
        textAlign:'center', color:'rgba(255,255,255,.5)',
        fontSize:10, fontWeight:700, letterSpacing:'.06em',
      }} className="mono">
        <span style={{ fontFamily:'inherit' }}>made for </span>BUSAN · GYEONGNAM
      </div>

      {/* iOS home indicator */}
      <div style={{
        position:'absolute', bottom:6, left:'50%', transform:'translateX(-50%)',
        width:120, height:4, borderRadius:99, background:'rgba(255,255,255,.4)',
      }} />
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 미니멀 (Apple-style 1-shot)
// ──────────────────────────────────────────────────────
function SplashMinimal() {
  return (
    <div className="phone" style={{
      background:'#FFFFFF',
      overflow:'hidden', position:'relative',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      height: 760,
    }}>
      <div style={{ animation:'splashScaleIn 1.2s cubic-bezier(.2,.8,.2,1)' }}>
        <AppIcon size={120} shape="ios" />
      </div>
      <div style={{
        marginTop:20,
        fontSize:24, fontWeight:900, letterSpacing:'-.025em',
        background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
        WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
        animation:'splashFadeIn .6s ease-out .3s backwards',
      }}>Pink Rabbit</div>

      <div style={{
        position:'absolute', bottom:60, left:0, right:0, textAlign:'center',
        animation:'splashFadeIn .6s ease-out .6s backwards',
      }}>
        <div style={{ fontSize:10, fontWeight:800, color:'var(--text-3)', letterSpacing:'.16em', fontFamily:'var(--font-mono)' }}>
          v 2.0 · BUSAN MADE
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 다크 (Pro 톤)
// ──────────────────────────────────────────────────────
function SplashDark() {
  return (
    <div className="phone" style={{
      background:'#0F1419',
      overflow:'hidden', position:'relative',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      height: 760,
    }}>
      {/* 그리드 배경 */}
      <div style={{
        position:'absolute', inset:0,
        backgroundImage:
          'linear-gradient(to right, rgba(255,255,255,.03) 1px, transparent 1px),' +
          'linear-gradient(to bottom, rgba(255,255,255,.03) 1px, transparent 1px)',
        backgroundSize:'30px 30px',
        maskImage:'radial-gradient(circle at center, black 0%, transparent 70%)',
        WebkitMaskImage:'radial-gradient(circle at center, black 0%, transparent 70%)',
      }} />

      {/* 핑크 라이트 */}
      <div style={{
        position:'absolute', top:'30%', left:'50%', transform:'translate(-50%,-50%)',
        width:240, height:240, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(255,31,143,.35) 0%, transparent 65%)',
        animation:'splashGlow 3s ease-in-out infinite',
      }} />

      <div style={{ animation:'splashScaleIn 1.0s cubic-bezier(.2,.8,.2,1)', position:'relative' }}>
        <AppIcon size={120} shape="ios" glow />
      </div>

      <div style={{
        marginTop:20, fontSize:28, fontWeight:900, color:'#fff',
        letterSpacing:'-.025em',
        animation:'splashFadeIn .6s ease-out .3s backwards',
      }}>Pink Rabbit</div>

      <div style={{
        marginTop:6, fontSize:11, fontWeight:800, letterSpacing:'.16em',
        color:'#FF6BAA',
        animation:'splashFadeIn .6s ease-out .5s backwards',
      }}>PROFESSIONAL EDITION</div>

      {/* 보안 / 사업자 */}
      <div style={{
        position:'absolute', bottom:60, left:24, right:24,
        textAlign:'center',
        animation:'splashFadeIn .6s ease-out .8s backwards',
      }}>
        <div style={{
          fontSize:9, fontWeight:700, color:'rgba(255,255,255,.5)',
          letterSpacing:'.08em', lineHeight:1.6, fontFamily:'var(--font-mono)',
        }}>
          핑크래빗 (주) · 부산광역시<br/>
          사업자 123-45-67890 · 통신판매업 2026-부산-0001
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// LIVE 알림 스플래시 (Pull-to-refresh / 진입 변형)
// ──────────────────────────────────────────────────────
function SplashLiveAlert() {
  const [seconds, setSeconds] = useStateSP(554);
  useEffectSP(() => {
    const id = setInterval(() => setSeconds(s => s > 0 ? s - 1 : 600), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(seconds/60)).padStart(2,'0');
  const ss = String(seconds%60).padStart(2,'0');

  return (
    <div className="phone" style={{
      background:'linear-gradient(180deg, #1F0A1A 0%, #2A0E1F 40%, #831843 100%)',
      overflow:'hidden', position:'relative',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      height: 760,
    }}>
      {/* 위쪽 LIVE 표시 */}
      <div style={{
        position:'absolute', top:60, left:'50%', transform:'translateX(-50%)',
        animation:'splashFadeIn .5s ease-out backwards',
      }}>
        <LiveBadge label="실시간 토너 6곳 진행중" />
      </div>

      <div style={{ animation:'splashBounce 1.5s ease-out' }}>
        <AppIcon size={100} shape="ios" glow />
      </div>

      <div style={{
        marginTop:22, fontSize:13, fontWeight:700,
        color:'rgba(255,255,255,.7)', letterSpacing:'.04em',
      }}>지금 가장 핫한 토너</div>

      <div style={{
        marginTop:8, fontSize:20, fontWeight:900, color:'#fff',
        letterSpacing:'-.02em', textAlign:'center', lineHeight:1.2,
      }}>화명동 깜깜이 펍<br/>데일리 30T</div>

      {/* 거대 타이머 */}
      <div style={{
        marginTop:24,
        padding:'18px 32px', borderRadius:20,
        background:'rgba(255,255,255,.08)', backdropFilter:'blur(12px)',
        border:'1px solid rgba(255,255,255,.16)',
        animation:'splashFadeIn .6s ease-out .4s backwards',
      }}>
        <div style={{ fontSize:9, fontWeight:800, color:'rgba(255,255,255,.6)', letterSpacing:'.18em', textAlign:'center' }}>LEVEL 6 · BLINDS</div>
        <div className="mono" style={{
          fontSize:64, fontWeight:800, color:'#fff', lineHeight:1, marginTop:4,
          letterSpacing:'-.02em',
          textShadow:'0 4px 22px rgba(255,31,143,.4)',
        }}>{mm}:{ss}</div>
        <div className="mono" style={{ fontSize:14, fontWeight:800, color:'rgba(255,255,255,.85)', textAlign:'center', marginTop:6 }}>1,000 / 2,000</div>
      </div>

      <div style={{
        position:'absolute', bottom:80, left:24, right:24,
        animation:'splashFadeIn .6s ease-out .8s backwards',
      }}>
        <div style={{
          padding:'12px 16px', borderRadius:12,
          background:'rgba(255,255,255,.1)', backdropFilter:'blur(12px)',
          border:'1px solid rgba(255,255,255,.16)',
          display:'flex', alignItems:'center', gap:12,
          color:'#fff',
        }}>
          <span style={{ fontSize:18 }}>🎯</span>
          <div style={{ flex:1, fontSize:11, fontWeight:600, lineHeight:1.4 }}>
            <b style={{ fontSize:12 }}>1.2km 거리 · 24/30명</b><br/>
            <span style={{ opacity:.8 }}>Late Reg 42:18 남음</span>
          </div>
          <span style={{ fontSize:14 }}>›</span>
        </div>
      </div>

      <div style={{
        position:'absolute', bottom:24, left:0, right:0,
        textAlign:'center', color:'rgba(255,255,255,.4)',
        fontSize:10, fontWeight:700, letterSpacing:'.06em',
      }} className="mono">
        탭하여 진입
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 작은 헬퍼: 점 3개 스피너
// ──────────────────────────────────────────────────────
function SplashSpinner() {
  return (
    <div style={{ display:'flex', gap:6 }}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width:8, height:8, borderRadius:99, background:'rgba(255,255,255,.8)',
          animation:'splashDot 1.4s ease-in-out infinite',
          animationDelay:`${i * 0.16}s`,
        }} />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 카탈로그 (4종 한눈에)
// ──────────────────────────────────────────────────────
function SplashCatalog() {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:32 }}>
      {/* 4종 phone 그리드 */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 392px)', gap:18, justifyContent:'center' }}>
        {[
          { Comp: SplashMain, label: '브랜드 메인', tag: 'PRIMARY', desc: '핫핑크 그라데이션 + LIVE 카운트 · 가장 임팩트 강한 진입' },
          { Comp: SplashMinimal, label: '미니멀 화이트', tag: 'MINIMAL', desc: 'Apple-style · 빠른 로딩 · 라이트 모드 사용자 우선' },
          { Comp: SplashDark, label: '다크 프로', tag: 'PRO', desc: '본사·매장 어드민용 · 그리드 패턴 + 핑크 글로우' },
          { Comp: SplashLiveAlert, label: 'LIVE 알림', tag: 'CONTEXT', desc: '특정 시간대 한정 · LIVE 토너 직진입 유도' },
        ].map(({ Comp, label, tag, desc }) => (
          <div key={label}>
            <Comp />
            <div style={{ marginTop:12, padding:'10px 4px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                <span style={{ fontSize:13, fontWeight:900, letterSpacing:'-.015em' }}>{label}</span>
                <span className="mono" style={{ fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:4, background:'var(--brand-pale)', color:'var(--brand)', letterSpacing:'.06em' }}>{tag}</span>
              </div>
              <div style={{ fontSize:11, color:'var(--text-2)', lineHeight:1.5 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 가이드 카드 */}
      <div style={{
        padding:20, borderRadius:18,
        background:'linear-gradient(135deg, var(--surface-1), rgba(255,31,143,.04))',
        border:'1px solid var(--border)',
      }}>
        <div className="section-title" style={{ marginBottom:14 }}>스플래시 사용 규칙</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:18 }}>
          {[
            { e:'⏱', k:'1.5초 룰', v:'핵심 컨텐츠 로딩 동안만 노출 · 절대 2초 초과 금지' },
            { e:'🎯', k:'역할별 분기', v:'사용자 → 브랜드 / 매장 → 다크 / 본사 → 다크 Pro' },
            { e:'📲', k:'네이티브 통합', v:'iOS LaunchScreen · Android SplashScreen API 활용' },
          ].map(g => (
            <div key={g.k} style={{ display:'flex', gap:10 }}>
              <div style={{
                width:34, height:34, borderRadius:10, flexShrink:0,
                background:'var(--brand-pale)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18,
              }}>{g.e}</div>
              <div>
                <div style={{ fontSize:12, fontWeight:900, letterSpacing:'-.01em' }}>{g.k}</div>
                <div style={{ fontSize:11, color:'var(--text-2)', marginTop:3, lineHeight:1.5 }}>{g.v}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 스플래시 애니메이션 keyframes
if (!document.getElementById('__splash-style')) {
  const s = document.createElement('style');
  s.id = '__splash-style';
  s.textContent = `
    @keyframes splashBounce {
      0% { transform: scale(.3); opacity: 0; }
      50% { transform: scale(1.1); opacity: 1; }
      75% { transform: scale(.95); }
      100% { transform: scale(1); }
    }
    @keyframes splashScaleIn {
      from { transform: scale(.7); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    @keyframes splashFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes splashGlow {
      0%, 100% { opacity: .5; transform: translate(-50%,-50%) scale(1); }
      50% { opacity: 1; transform: translate(-50%,-50%) scale(1.15); }
    }
    @keyframes splashTwinkle {
      0%, 100% { opacity: .2; transform: scale(.7); }
      50% { opacity: .9; transform: scale(1.4); }
    }
    @keyframes splashDot {
      0%, 80%, 100% { transform: scale(.4); opacity: .4; }
      40% { transform: scale(1); opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

Object.assign(window, { SplashMain, SplashMinimal, SplashDark, SplashLiveAlert, SplashCatalog });
