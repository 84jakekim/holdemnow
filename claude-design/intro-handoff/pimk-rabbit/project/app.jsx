// app.jsx — Pink Rabbit 메인 컴포넌트
// 디자인 시스템 + 5개 카테고리 프로토타입 + Tweaks 패널 통합

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "fontBody": "Pretendard",
  "tvPreset": "dark"
}/*EDITMODE-END*/;

const FONT_OPTIONS = {
  'Pretendard': "'Pretendard','Noto Sans KR',sans-serif",
  'Noto Sans KR': "'Noto Sans KR',sans-serif",
  'Spoqa Han Sans': "'Spoqa Han Sans Neo','Pretendard',sans-serif",
  'Gowun Dodum': "'Gowun Dodum','Pretendard',serif",
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [breakMode, setBreakMode] = React.useState(false);

  // 다크 모드 + 폰트 적용
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.dark ? 'dark' : 'light');
  }, [t.dark]);

  React.useEffect(() => {
    const ff = FONT_OPTIONS[t.fontBody] || FONT_OPTIONS.Pretendard;
    document.documentElement.style.setProperty('--font-body', ff);
  }, [t.fontBody]);

  const fontBodyCss = FONT_OPTIONS[t.fontBody] || FONT_OPTIONS.Pretendard;

  return (
    <div data-screen-label="Pink Rabbit DS + Prototype" className="page-wrap">

      {/* ── 페이지 헤더 ─────────────────────────────────── */}
      <header style={{ marginBottom:32 }}>
        <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', borderRadius:99, background:'var(--surface-1)', border:'1px solid var(--border)' }}>
            <span style={{ width:6, height:6, borderRadius:99, background:'var(--brand)', boxShadow:'0 0 8px var(--brand)' }} />
            <span className="mono" style={{ fontSize:11, fontWeight:800, letterSpacing:'.06em' }}>DESIGN SYSTEM · v2.0</span>
          </div>
          <div style={{ fontSize:11, color:'var(--text-3)' }} className="mono">2026-05-25 · 부산·경남</div>
        </div>
        <h1 className="h1" style={{ marginTop:16 }}>
          Pink Rabbit{' '}
          <span style={{
            background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
          }}>디자인 시스템</span>
          {' · '}프로토타입
        </h1>
        <div style={{ fontSize:14, color:'var(--text-2)', marginTop:8, maxWidth:680, lineHeight:1.6 }}>
          부산·경남 홀덤펍 디스커버리 + 토너 디지털 인프라 플랫폼의 디자인 시스템.
          5개 카테고리 — 사용자 앱 · 매장 어드민 · 본사 어드민 · TV 디스플레이 · 인증.
          오른쪽 하단의 <b style={{ color:'var(--brand)' }}>Tweaks</b> 버튼으로 다크 모드 · TV 프리셋 · 폰트를 전환해보세요.
        </div>
      </header>

      {/* ── 디자인 시스템 카탈로그 ───────────────────── */}
      <DesignSystemCatalog fontBody={fontBodyCss} />

      {/* ── 5개 카테고리 프로토타입 ──────────────────── */}
      <section style={{ marginTop:64 }}>
        <h2 className="h2" data-screen-label="prototype-gallery">5개 카테고리 프로토타입</h2>
        <div style={{ fontSize:13, color:'var(--text-2)', marginTop:6, marginBottom:32 }}>
          단일 phone 모형(392px) · 사용자 앱과 TV는 인터랙티브 — 탭을 눌러보고, BREAK ↔ LIVE를 토글해보세요.
        </div>

        {/* 00. 온보딩 */}
        <CategoryBlock
          num="00"
          title="온보딩 가이드"
          path="앱 최초 접속 시"
          subtitle="4장 슬라이드로 핵심 기능 소개 — 매장 발견 / LIVE 토너 / 채팅방 소식 / 캘린더 예약"
          hint="phone 안에서 다음/건너뛰기 버튼 동작 · 4장 모두 별도로도 미리보기 가능"
          wide
        >
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:32 }}>
            {/* 인터랙티브 phone */}
            <div>
              <div style={{ textAlign:'center', fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.06em', marginBottom:10 }}>인터랙티브 — 다음/건너뛰기 클릭</div>
              <OnboardingScreen
                initialIdx={0}
                onSkip={() => window.alert('→ 로그인 페이지로 (05 카테고리)')}
                onDone={() => window.alert('→ 회원가입 페이지로 (05 카테고리)')}
              />
            </div>

            {/* 4장 미리보기 (정적) */}
            <div style={{ width:'100%' }}>
              <div style={{ textAlign:'center', fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.06em', marginBottom:14 }}>4장 슬라이드 한눈에</div>
              <div style={{ display:'flex', gap:16, justifyContent:'center', flexWrap:'wrap' }}>
                {[0,1,2,3].map(i => (
                  <div key={i} style={{ transform:'scale(.72)', transformOrigin:'top center', marginRight:-110, marginBottom:-200 }}>
                    <OnboardingScreen initialIdx={i} onSkip={() => {}} onDone={() => {}} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CategoryBlock>

        {/* 01. 사용자 앱 */}
        <CategoryBlock
          num="01"
          title="사용자 앱"
          path="/m/*"
          subtitle="홈 · 매장찾기 · 채팅방 · 캘린더 · 마이 — 하단 탭으로 화면 전환"
          hint="👇 하단 탭을 클릭하면 화면이 전환됩니다"
        >
          <UserApp />
        </CategoryBlock>

        {/* 02. 매장 어드민 */}
        <CategoryBlock
          num="02"
          title="매장 어드민"
          path="/admin/[storeId]"
          subtitle="모바일 control center · 토너 운영의 핵심 — 타이머 / BREAK / 리바이"
          hint="⏸ 일시정지, ☕ BREAK 버튼이 동작합니다"
        >
          <StoreAdmin />
        </CategoryBlock>

        {/* 03. 본사 어드민 */}
        <CategoryBlock
          num="03"
          title="본사 어드민"
          path="/platform/*"
          subtitle="다크 관제센터 · KPI · LIVE 모니터링 · 광고 4등급"
        >
          <PlatformAdmin />
        </CategoryBlock>

        {/* 04. TV 디스플레이 */}
        <CategoryBlock
          num="04"
          title="TV 디스플레이"
          path="display.holdemnow.com/[storeId]"
          subtitle="매장 운영의 얼굴 · 가로 16:9 · 좌 STRUCTURE · 중 거대 타이머 · 우 3카드"
          hint="우상단 BREAK 버튼을 누르면 amber 상태로 전환됩니다. Tweaks에서 프리셋 5종 변경 가능."
          wide
        >
          <TVDisplay preset={t.tvPreset} breakMode={breakMode} onToggleBreak={() => setBreakMode(b => !b)} />
        </CategoryBlock>

        {/* 05. 인증 */}
        <CategoryBlock
          num="05"
          title="로그인 / 가입"
          path="3개의 분리된 진입점"
          subtitle="사용자 메인 (소셜 로그인) · 매장 사장님 전용 · 본사 관제센터 — 각자 다른 URL · 다른 톤"
          hint="사용자 phone에서 '매장 사장님이세요?' 카드 클릭 시에도 매장 로그인 push 가능"
          wide
        >
          <div style={{ display:'flex', gap:24, alignItems:'flex-start', justifyContent:'center', flexWrap:'wrap' }}>
            <div>
              <div style={{ textAlign:'center', fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.06em', marginBottom:10 }}>일반 사용자 · pinkrabbit.kr</div>
              <AuthScreen />
            </div>
            <div>
              <div style={{ textAlign:'center', fontSize:11, fontWeight:800, color:'#92400E', letterSpacing:'.06em', marginBottom:10 }}>🏪 매장 사장 · /owner/signin</div>
              <StoreLoginScreen />
            </div>
            <div>
              <div style={{ textAlign:'center', fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.06em', marginBottom:10 }}>🔒 본사 관제 · platform.holdemnow.com</div>
              <PlatformLoginScreen />
            </div>
          </div>
        </CategoryBlock>

      </section>

      {/* ── Footer ────────────────────────────────────── */}
      <footer style={{ marginTop:80, padding:'24px 0', borderTop:'1px solid var(--border)', textAlign:'center' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:8 }}>
          <RabbitLogo size={28} variant="badge" />
          <span style={{ fontSize:14, fontWeight:900, letterSpacing:'-.01em' }}>Pink Rabbit</span>
          <span style={{ fontSize:10, color:'var(--text-3)' }} className="mono">v2.0 · BETA</span>
        </div>
        <div style={{ fontSize:11, color:'var(--text-3)' }}>
          부산·경남 홀덤펍 디스커버리 + 토너 디지털 인프라 · 디자인 시스템 + 프로토타입
        </div>
      </footer>

      {/* ── Tweaks 패널 ──────────────────────────────────── */}
      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakToggle
          label="다크 모드"
          value={t.dark}
          onChange={(v) => setTweak('dark', v)}
        />

        <TweakSection label="Typography" />
        <TweakSelect
          label="본문 폰트"
          value={t.fontBody}
          options={Object.keys(FONT_OPTIONS)}
          onChange={(v) => setTweak('fontBody', v)}
        />

        <TweakSection label="TV 디스플레이 프리셋" />
        <TweakRadioVisual
          value={t.tvPreset}
          onChange={(v) => setTweak('tvPreset', v)}
        />
      </TweaksPanel>
    </div>
  );
}

// ── 카테고리 블록 (각 phone 둘러쌈) ─────────────────────
function CategoryBlock({ num, title, path, subtitle, hint, wide, children }) {
  return (
    <section data-screen-label={`${num} ${title}`} style={{ marginBottom:64 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:14, flexWrap:'wrap', marginBottom:8 }}>
        <div className="mono" style={{
          fontSize:42, fontWeight:800, letterSpacing:'-.04em',
          color:'transparent',
          background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
          WebkitBackgroundClip:'text',
          lineHeight:1,
        }}>{num}</div>
        <div>
          <h3 style={{ margin:0, fontSize:22, fontWeight:900, letterSpacing:'-.02em' }}>{title}</h3>
          <div className="mono" style={{ fontSize:11, color:'var(--text-3)', marginTop:4 }}>{path}</div>
        </div>
      </div>
      <div style={{ fontSize:13, color:'var(--text-2)', marginBottom:6, marginLeft:60, maxWidth:560 }}>{subtitle}</div>
      {hint && (
        <div style={{
          display:'inline-flex', alignItems:'center', gap:6,
          fontSize:11, color:'var(--brand)', fontWeight:700,
          marginLeft:60, marginBottom:18,
          padding:'4px 10px', borderRadius:99,
          background:'var(--brand-pale)', border:'1px solid rgba(255,31,143,.15)',
        }}>{hint}</div>
      )}
      <div style={{
        marginTop: hint ? 12 : 20,
        display:'flex', justifyContent:'center', padding: wide ? '24px 12px' : '24px 12px',
        background: 'var(--bg-sub)',
        borderRadius: 24,
        border:'1px solid var(--border)',
        overflow: wide ? 'auto' : 'visible',
      }}>
        <div style={{ width: wide ? '100%' : 'auto', maxWidth: wide ? 1100 : 'none' }}>
          {children}
        </div>
      </div>
    </section>
  );
}

// ── Tweaks: TV 프리셋 시각 라디오 ─────────────────────
function TweakRadioVisual({ value, onChange }) {
  const presets = [
    { id:'dark', label:'클래식 다크', bg:'#0F1419', accent:'#FF1F8F' },
    { id:'green', label:'카지노 그린', bg:'radial-gradient(circle at 50% 50%,#1d6b48,#0a3a2a)', accent:'#F0D97A' },
    { id:'blue', label:'로얄 블루', bg:'linear-gradient(135deg,#0a1d4a,#1e3a8a)', accent:'#FFD700' },
    { id:'crimson', label:'크림슨', bg:'linear-gradient(135deg,#3a0814,#7f1d1d)', accent:'#FFD700' },
    { id:'white', label:'미니멀 화이트', bg:'#fff', accent:'#FF1F8F', light:true },
  ];
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:4 }}>
      {presets.map(p => {
        const active = value === p.id;
        return (
          <button key={p.id} onClick={() => onChange(p.id)} style={{
            position:'relative', aspectRatio:'16/10', borderRadius:6,
            background:p.bg, cursor:'pointer',
            border: active ? '2px solid #FF1F8F' : (p.light ? '1px solid #E5E7EB' : '1px solid rgba(255,255,255,.1)'),
            outline:'none', overflow:'hidden',
            transition: 'transform .12s',
            transform: active ? 'scale(1.05)' : 'scale(1)',
          }} title={p.label}>
            <div style={{
              position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
              fontSize:9, fontWeight:800, color:p.accent,
              fontFamily:'var(--font-mono)',
            }}>09:14</div>
          </button>
        );
      })}
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
