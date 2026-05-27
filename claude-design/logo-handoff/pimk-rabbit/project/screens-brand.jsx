// screens-brand.jsx — Pink Rabbit 브랜드 키트
// 앱 아이콘 사이즈별 · 홈스크린 · 로고 변형 · 배너 · 워드마크

const { useState: useStateBR, useMemo: useMemoBR } = React;

// ──────────────────────────────────────────────────────
// 앱 아이콘 (가장 핵심) — 1024 base, 모든 사이즈로 스케일
// ──────────────────────────────────────────────────────
// iOS는 squircle (continuous corner), Android는 다양
function AppIcon({ size = 180, shape = 'ios', glow = false, label }) {
  const id = useMemoBR(() => 'icn' + Math.random().toString(36).slice(2, 8), []);

  // iOS squircle radius ≈ size * 0.225
  // Android adaptive — 원형
  const r = shape === 'ios' ? size * 0.225
          : shape === 'android' ? size * 0.5
          : shape === 'square' ? 0
          : size * 0.225;

  const wrapStyle = {
    width: size, height: size, borderRadius: r,
    background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BAA 100%)',
    position: 'relative', overflow: 'hidden',
    boxShadow: glow ? '0 12px 38px rgba(255,31,143,.4), 0 0 0 1px rgba(255,255,255,.18) inset' : '0 4px 16px rgba(255,31,143,.25)',
    flexShrink: 0,
  };

  // 작은 사이즈에서는 디테일 제거
  const isTiny = size < 32;
  const isSmall = size < 64;

  return (
    <div style={wrapStyle} title={label}>
      {/* 배경 광채 (큰 사이즈에서만) */}
      {!isSmall && (
        <div style={{
          position:'absolute', top:'-30%', left:'-30%',
          width:'80%', height:'80%', borderRadius:'50%',
          background:'radial-gradient(circle, rgba(255,255,255,.35) 0%, transparent 70%)',
        }} />
      )}

      {/* SVG 토끼 */}
      <svg
        viewBox="0 0 64 64"
        width="100%" height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ position:'relative', zIndex:1 }}
        aria-label="Pink Rabbit"
      >
        {!isTiny ? (
          // 풀 디테일 토끼 (>= 32px)
          <g>
            {/* 왼쪽 귀 */}
            <ellipse cx="22" cy="20" rx="4.8" ry="11" fill="#fff" transform="rotate(-12 22 20)" />
            {!isSmall && <ellipse cx="22" cy="22" rx="1.9" ry="6.5" fill="#FFB3D4" transform="rotate(-12 22 22)" />}
            {/* 오른쪽 귀 */}
            <ellipse cx="42" cy="20" rx="4.8" ry="11" fill="#fff" transform="rotate(12 42 20)" />
            {!isSmall && <ellipse cx="42" cy="22" rx="1.9" ry="6.5" fill="#FFB3D4" transform="rotate(12 42 22)" />}
            {/* 머리 */}
            <circle cx="32" cy="42" r="14" fill="#fff" />
            {/* 볼 블러시 */}
            {!isSmall && (<>
              <circle cx="23" cy="46" r="2" fill="#FFB3D4" opacity=".8" />
              <circle cx="41" cy="46" r="2" fill="#FFB3D4" opacity=".8" />
            </>)}
            {/* 눈 */}
            <ellipse cx="27" cy="40.5" rx="1.8" ry="2.4" fill="#FF1F8F" />
            <ellipse cx="37" cy="40.5" rx="1.8" ry="2.4" fill="#FF1F8F" />
            {/* 눈 하이라이트 */}
            {!isSmall && (<>
              <circle cx="27.5" cy="40" r=".7" fill="#fff" />
              <circle cx="37.5" cy="40" r=".7" fill="#fff" />
            </>)}
            {/* 코 */}
            <ellipse cx="32" cy="45.4" rx="1.4" ry="1" fill="#FF1F8F" />
            {/* 입 */}
            {!isSmall && (
              <path d="M32 46.6 Q32 48.4 30.3 48.6 M32 46.6 Q32 48.4 33.7 48.6"
                    stroke="#FF1F8F" strokeWidth="1.1" strokeLinecap="round" fill="none" />
            )}
          </g>
        ) : (
          // 초간단 (16px 이하): 흰 토끼 실루엣
          <g>
            <ellipse cx="22" cy="22" rx="5" ry="11" fill="#fff" transform="rotate(-12 22 22)" />
            <ellipse cx="42" cy="22" rx="5" ry="11" fill="#fff" transform="rotate(12 42 22)" />
            <circle cx="32" cy="42" r="15" fill="#fff" />
            <circle cx="27" cy="41" r="2.2" fill="#FF1F8F" />
            <circle cx="37" cy="41" r="2.2" fill="#FF1F8F" />
          </g>
        )}
      </svg>

      {/* iOS 하이라이트 (큰 사이즈만) */}
      {shape === 'ios' && !isSmall && (
        <div style={{
          position:'absolute', top:0, left:0, right:0, height:'40%',
          background:'linear-gradient(180deg, rgba(255,255,255,.18) 0%, transparent 100%)',
          pointerEvents:'none', borderRadius: `${r}px ${r}px 0 0`,
        }} />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 1. 메인 워드마크 (배너용 hero)
// ──────────────────────────────────────────────────────
function Wordmark({ size = 'lg', layout = 'horizontal', color = 'gradient', includeRabbit = true, tagline = false }) {
  // size: sm/md/lg/xl
  const sizes = {
    sm: { logo: 32, text: 16, gap: 6, tag: 9 },
    md: { logo: 48, text: 24, gap: 8, tag: 11 },
    lg: { logo: 72, text: 36, gap: 12, tag: 13 },
    xl: { logo: 120, text: 56, gap: 18, tag: 16 },
  }[size];

  const isVertical = layout === 'vertical';

  const textStyle = {
    fontSize: sizes.text,
    fontWeight: 900,
    letterSpacing: '-.03em',
    lineHeight: 1,
    color: color === 'white' ? '#fff' : color === 'black' ? '#111827' : color === 'pink' ? '#FF1F8F' : 'transparent',
    background: color === 'gradient' ? 'linear-gradient(135deg,#FF1F8F,#FF6BAA)' : 'none',
    WebkitBackgroundClip: color === 'gradient' ? 'text' : 'unset',
    WebkitTextFillColor: color === 'gradient' ? 'transparent' : 'unset',
  };

  const tagStyle = {
    fontSize: sizes.tag,
    fontWeight: 700,
    letterSpacing: '.04em',
    color: color === 'white' ? 'rgba(255,255,255,.7)' : color === 'black' ? '#6B7280' : '#FF6BAA',
    marginTop: isVertical ? 4 : 0,
  };

  return (
    <div style={{
      display: 'flex', flexDirection: isVertical ? 'column' : 'row',
      alignItems: 'center', gap: sizes.gap,
    }}>
      {includeRabbit && <AppIcon size={sizes.logo} shape="ios" glow={color === 'white'} />}
      <div style={{ display:'flex', flexDirection:'column', alignItems: isVertical ? 'center' : 'flex-start' }}>
        <div style={textStyle}>Pink Rabbit</div>
        {tagline && <div style={tagStyle}>홀덤펍 디스커버리</div>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 메인 브랜드 페이지 컴포넌트
// ──────────────────────────────────────────────────────
function BrandKitSection() {
  return (
    <section style={{ marginTop: 80 }}>
      {/* ── 헤더 ─────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }} data-screen-label="07 브랜드 키트">
        <div style={{ display:'flex', alignItems:'baseline', gap:14, marginBottom:8 }}>
          <div className="mono" style={{
            fontSize:42, fontWeight:800, letterSpacing:'-.04em',
            color:'transparent',
            background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
            WebkitBackgroundClip:'text', lineHeight:1,
          }}>07</div>
          <div>
            <h3 style={{ margin:0, fontSize:22, fontWeight:900, letterSpacing:'-.02em' }}>브랜드 키트</h3>
            <div className="mono" style={{ fontSize:11, color:'var(--text-3)', marginTop:4 }}>brand.pinkrabbit.kr / kit</div>
          </div>
        </div>
        <div style={{ fontSize:13, color:'var(--text-2)', marginLeft:60, maxWidth:680, lineHeight:1.6 }}>
          앱 아이콘 사이즈 매트릭스 · 홈스크린 미리보기 · 로고 변형 · 배너 키트 · 워드마크 디자인.
          모든 자산은 SVG 기반으로 모든 사이즈에 픽셀퍼펙트하게 적용됩니다.
        </div>
      </div>

      {/* ── 1. APP ICON HERO ────────────────────────── */}
      <BrandSection label="앱 아이콘 · Master" subtitle="1024×1024 master · iOS/Android에서 모든 사이즈로 자동 생성">
        <div style={{
          padding:'40px 24px', borderRadius:24,
          background:'linear-gradient(135deg, #2A0E1F 0%, #831843 50%, #FF1F8F 100%)',
          textAlign:'center', position:'relative', overflow:'hidden',
        }}>
          {/* 배경 라이트 */}
          <div style={{
            position:'absolute', top:'-50%', left:'-30%',
            width:'160%', height:'200%',
            background:'radial-gradient(ellipse at 30% 40%, rgba(255,255,255,.15) 0%, transparent 50%), radial-gradient(ellipse at 70% 60%, rgba(255,107,170,.2) 0%, transparent 50%)',
            pointerEvents:'none',
          }} />

          <div style={{ position:'relative', display:'flex', justifyContent:'center', alignItems:'center', gap:48, flexWrap:'wrap' }}>
            <AppIcon size={220} shape="ios" glow />
            <div style={{ textAlign:'left', color:'#fff', maxWidth:280 }}>
              <div style={{ fontSize:10, fontWeight:800, letterSpacing:'.16em', opacity:.7, fontFamily:'var(--font-mono)' }}>MASTER ICON</div>
              <div style={{ fontSize:34, fontWeight:900, marginTop:8, letterSpacing:'-.025em', lineHeight:1.1 }}>Pink Rabbit</div>
              <div style={{ fontSize:13, marginTop:10, opacity:.85, lineHeight:1.55 }}>
                흰 토끼 + 핫핑크 그라데이션 squircle.
                머리 14r · 귀 11r 회전 ±12° · 눈 #FF1F8F.
              </div>
              <div className="mono" style={{ display:'flex', gap:10, marginTop:18, fontSize:10, fontWeight:700, opacity:.65 }}>
                <span>1024×1024</span><span>·</span><span>PNG · SVG</span><span>·</span><span>sRGB</span>
              </div>
            </div>
          </div>
        </div>
      </BrandSection>

      {/* ── 2. iOS SIZE MATRIX ──────────────────────── */}
      <BrandSection label="iOS — 사이즈 매트릭스" subtitle="App Store 1024 · 홈스크린 180 · 스포트라이트 120 · 설정 87 · 노티 80 · 노티 60 · 알림 40">
        <div style={{
          padding:24, borderRadius:20,
          background:'var(--surface-1)', border:'1px solid var(--border)',
        }}>
          <div style={{ display:'flex', alignItems:'flex-end', gap:24, flexWrap:'wrap', justifyContent:'center' }}>
            {[
              { size:180, label:'iPhone 홈', spec:'180×180' },
              { size:120, label:'스포트라이트', spec:'120×120' },
              { size:87, label:'설정', spec:'87×87' },
              { size:80, label:'노티', spec:'80×80' },
              { size:60, label:'iPad 노티', spec:'60×60' },
              { size:40, label:'알림', spec:'40×40' },
              { size:29, label:'iPad 설정', spec:'29×29' },
            ].map(s => (
              <div key={s.size} style={{ textAlign:'center' }}>
                <AppIcon size={s.size} shape="ios" />
                <div style={{ fontSize:11, fontWeight:800, marginTop:8, color:'var(--text-1)' }}>{s.label}</div>
                <div className="mono" style={{ fontSize:10, color:'var(--text-3)', marginTop:2 }}>{s.spec}</div>
              </div>
            ))}
          </div>
        </div>
      </BrandSection>

      {/* ── 3. Android Adaptive Icon ─────────────────── */}
      <BrandSection label="Android — Adaptive Icon" subtitle="Play Store 512 · Material You · 호스트별 모양 자동 적용 (원/squircle/하트)">
        <div style={{
          padding:24, borderRadius:20,
          background:'var(--surface-1)', border:'1px solid var(--border)',
          display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:16,
        }}>
          {[
            { shape:'android', label:'원형 (Pixel)', sub:'circle 50%' },
            { shape:'ios', label:'Squircle (Samsung)', sub:'r .225' },
            { shape:'rounded-32', label:'라운드 정사각', sub:'r .14' },
            { shape:'square', label:'정사각', sub:'r 0' },
          ].map(v => (
            <div key={v.label} style={{ textAlign:'center', padding:'18px 8px', borderRadius:14, background:'var(--bg-sub)', border:'1px solid var(--border)' }}>
              <div style={{ display:'flex', justifyContent:'center' }}>
                <AppIcon size={108} shape={v.shape} />
              </div>
              <div style={{ fontSize:12, fontWeight:800, marginTop:12 }}>{v.label}</div>
              <div className="mono" style={{ fontSize:10, color:'var(--text-3)', marginTop:2 }}>{v.sub}</div>
            </div>
          ))}
        </div>
      </BrandSection>

      {/* ── 4. HOME SCREEN MOCKUP ──────────────────── */}
      <BrandSection label="홈스크린 미리보기" subtitle="실제 사용자 디바이스에 설치되었을 때의 모습">
        <div style={{ display:'flex', gap:24, justifyContent:'center', flexWrap:'wrap', alignItems:'flex-start' }}>
          {/* iOS 홈스크린 */}
          <HomeScreenIOS />
          {/* Android 홈스크린 */}
          <HomeScreenAndroid />
        </div>
      </BrandSection>

      {/* ── 5. 로고 변형 (Lockups) ─────────────────── */}
      <BrandSection label="로고 락업 (Logo Lockups)" subtitle="용도별 6종 — 가로/세로 · 색상 변형 · 마크/워드마크 단독">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:16 }}>

          {/* 가로 — 풀컬러 (메인) */}
          <LockupCard label="가로 · 풀컬러" tag="PRIMARY" bg="#fff">
            <Wordmark size="md" layout="horizontal" color="gradient" tagline />
          </LockupCard>

          {/* 가로 — 화이트 (다크 배경용) */}
          <LockupCard label="가로 · 화이트" tag="ON DARK" bg="linear-gradient(135deg,#0F1419,#1F2937)">
            <Wordmark size="md" layout="horizontal" color="white" tagline />
          </LockupCard>

          {/* 가로 — 블랙 (모노) */}
          <LockupCard label="가로 · 모노 블랙" tag="MONO" bg="#fff">
            <Wordmark size="md" layout="horizontal" color="black" tagline />
          </LockupCard>

          {/* 세로 */}
          <LockupCard label="세로 락업" tag="STACKED" bg="#fff">
            <Wordmark size="md" layout="vertical" color="gradient" tagline />
          </LockupCard>

          {/* 마크 단독 */}
          <LockupCard label="마크 단독" tag="MARK ONLY" bg="linear-gradient(135deg,#FFE4F1,#FFB3D4)">
            <AppIcon size={84} shape="ios" />
          </LockupCard>

          {/* 워드마크 단독 */}
          <LockupCard label="워드마크 단독" tag="WORDMARK" bg="#fff">
            <div style={{
              fontSize:38, fontWeight:900, letterSpacing:'-.035em',
              background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
              WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
            }}>Pink Rabbit</div>
          </LockupCard>
        </div>
      </BrandSection>

      {/* ── 6. 워드마크 타이포 변형 ──────────────────── */}
      <BrandSection label="워드마크 디자인 5종" subtitle="앱·웹·인쇄·소셜·홍보 — 컨텍스트별 다른 표현">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>

          {/* 1. 기본 그라데이션 */}
          <WordmarkVariant label="기본 그라데이션 · 앱/웹 메인" bg="#fff">
            <div style={{
              fontSize:52, fontWeight:900, letterSpacing:'-.035em',
              background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
              WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
            }}>Pink Rabbit</div>
          </WordmarkVariant>

          {/* 2. 스플릿 컬러 */}
          <WordmarkVariant label="스플릿 컬러 · 인쇄용 강조" bg="#fff">
            <div style={{ fontSize:52, fontWeight:900, letterSpacing:'-.035em', lineHeight:1 }}>
              <span style={{ color:'#FF1F8F' }}>Pink</span>
              <span style={{ color:'#111827', marginLeft:6 }}>Rabbit</span>
            </div>
          </WordmarkVariant>

          {/* 3. 한국어 표기 */}
          <WordmarkVariant label="한국어 · 국문 컨텍스트" bg="linear-gradient(135deg,#FFF0F7,#FFE4F1)">
            <div style={{ fontSize:46, fontWeight:900, letterSpacing:'-.04em', color:'#111827', textAlign:'center' }}>
              핑크<span style={{ color:'#FF1F8F' }}>래빗</span>
              <div style={{ fontSize:12, fontWeight:700, letterSpacing:'.18em', color:'#FF1F8F', marginTop:6 }}>PINK RABBIT</div>
            </div>
          </WordmarkVariant>

          {/* 4. 토끼 통합 */}
          <WordmarkVariant label="토끼 통합 · SNS 프로필" bg="linear-gradient(135deg,#FF1F8F,#FF6BAA)">
            <div style={{ display:'flex', alignItems:'center', gap:14 }}>
              <AppIcon size={64} shape="android" />
              <div style={{ color:'#fff', fontSize:38, fontWeight:900, letterSpacing:'-.035em' }}>Pink Rabbit</div>
            </div>
          </WordmarkVariant>

          {/* 5. 미니멀 */}
          <WordmarkVariant label="미니멀 · 푸터/저작권" bg="#0F1419">
            <div style={{ display:'flex', alignItems:'center', gap:8, color:'#fff' }}>
              <AppIcon size={26} shape="ios" />
              <span style={{ fontSize:16, fontWeight:800, letterSpacing:'-.02em' }}>Pink Rabbit</span>
              <span className="mono" style={{ fontSize:10, fontWeight:700, opacity:.5, marginLeft:6 }}>© 2026</span>
            </div>
          </WordmarkVariant>

          {/* 6. 도장 / 스탬프 */}
          <WordmarkVariant label="도장 스탬프 · 굿즈/스티커" bg="#FFF0F7">
            <div style={{
              border:'3px solid #FF1F8F', borderRadius:99,
              padding:'14px 24px', display:'flex', alignItems:'center', gap:10,
              transform:'rotate(-4deg)',
            }}>
              <span style={{ fontSize:24 }}>🐰</span>
              <div style={{
                fontSize:18, fontWeight:900, color:'#FF1F8F',
                letterSpacing:'.06em', textTransform:'uppercase',
              }}>Pink Rabbit</div>
              <span className="mono" style={{ fontSize:9, fontWeight:800, color:'#FF1F8F', letterSpacing:'.1em' }}>BUSAN · KOREA</span>
            </div>
          </WordmarkVariant>
        </div>
      </BrandSection>

      {/* ── 7. 배너 키트 ─────────────────────────────── */}
      <BrandSection label="배너 키트" subtitle="앱 · 홈페이지 · 소셜 · 이메일 · 인쇄 — 모든 채널을 위한 표준 비율 6종">
        <div style={{ display:'flex', flexDirection:'column', gap:18 }}>

          {/* Hero Web Banner — 1920×600 (3.2:1) */}
          <BannerCard label="웹 히어로 배너" spec="1920 × 600 · 홈페이지 메인">
            <BannerHero />
          </BannerCard>

          {/* 2-column: Email + Web header */}
          <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:18 }}>
            <BannerCard label="이메일 헤더" spec="600 × 200 · 뉴스레터">
              <BannerEmail />
            </BannerCard>
            <BannerCard label="OG 이미지" spec="1200 × 630 · 링크 미리보기">
              <BannerOG />
            </BannerCard>
          </div>

          {/* 3-column: Social Square + Story + App Banner */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 0.7fr 1.4fr', gap:18 }}>
            <BannerCard label="인스타 정사각" spec="1080 × 1080">
              <BannerInsta />
            </BannerCard>
            <BannerCard label="스토리/릴스" spec="1080 × 1920">
              <BannerStory />
            </BannerCard>
            <BannerCard label="앱 내 프로모션" spec="1920 × 700 · 홈 카루셀">
              <BannerAppPromo />
            </BannerCard>
          </div>
        </div>
      </BrandSection>

      {/* ── 8. 사용 가이드 ──────────────────────────── */}
      <BrandSection label="사용 가이드" subtitle="해도 되는 것 · 절대 안 되는 것">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          {/* DO */}
          <div style={{ padding:20, borderRadius:18, background:'rgba(16,185,129,.05)', border:'1px solid rgba(16,185,129,.2)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
              <span style={{ width:24, height:24, borderRadius:99, background:'#10B981', color:'#fff', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:900 }}>✓</span>
              <span style={{ fontSize:14, fontWeight:900, color:'#047857' }}>DO · 사용 OK</span>
            </div>
            <ul style={{ margin:0, padding:0, listStyle:'none', display:'flex', flexDirection:'column', gap:10 }}>
              {[
                ['핫핑크 그라데이션', '#FF1F8F → #FF6BAA · 메인 락업'],
                ['모노 (블랙/화이트)', '인쇄·도장·1색 활용'],
                ['세이프 에리어', '아이콘 주변 12% 여백 유지'],
                ['SVG · @3x PNG', '항상 벡터 우선, 작은 사이즈는 @3x 비트맵'],
              ].map(([k,v]) => (
                <li key={k} style={{ display:'flex', gap:10 }}>
                  <span style={{ flexShrink:0, width:6, height:6, borderRadius:99, background:'#10B981', marginTop:6 }} />
                  <div><span style={{ fontWeight:800, fontSize:12 }}>{k}</span><span style={{ fontSize:12, color:'var(--text-2)', marginLeft:6 }}>{v}</span></div>
                </li>
              ))}
            </ul>
          </div>

          {/* DON'T */}
          <div style={{ padding:20, borderRadius:18, background:'rgba(229,62,62,.05)', border:'1px solid rgba(229,62,62,.2)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
              <span style={{ width:24, height:24, borderRadius:99, background:'#E53E3E', color:'#fff', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:900 }}>✕</span>
              <span style={{ fontSize:14, fontWeight:900, color:'#991B1B' }}>DON'T · 금지</span>
            </div>
            <ul style={{ margin:0, padding:0, listStyle:'none', display:'flex', flexDirection:'column', gap:10 }}>
              {[
                ['컬러 변경', '브랜드 핫핑크 외 색상으로 채우기'],
                ['외곽선 추가', '토끼/스퀴클 테두리 stroke 금지'],
                ['찌그러뜨림', '비율 변경 · 회전(45° 이상)'],
                ['낮은 대비 배경', '핑크 위에 핑크 등 대비 불량'],
              ].map(([k,v]) => (
                <li key={k} style={{ display:'flex', gap:10 }}>
                  <span style={{ flexShrink:0, width:6, height:6, borderRadius:99, background:'#E53E3E', marginTop:6 }} />
                  <div><span style={{ fontWeight:800, fontSize:12 }}>{k}</span><span style={{ fontSize:12, color:'var(--text-2)', marginLeft:6 }}>{v}</span></div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </BrandSection>

    </section>
  );
}

// ──────────────────────────────────────────────────────
// 헬퍼 컴포넌트
// ──────────────────────────────────────────────────────
function BrandSection({ label, subtitle, children }) {
  return (
    <div style={{ marginBottom: 44 }}>
      <div style={{ marginBottom: 14 }}>
        <div className="section-title">{label}</div>
        {subtitle && <div style={{ fontSize: 12, color:'var(--text-3)', marginTop:4, lineHeight:1.5 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function LockupCard({ label, tag, bg, children }) {
  const isDark = typeof bg === 'string' && (bg.includes('#0') || bg.includes('#1') || bg.includes('#2'));
  return (
    <div style={{ borderRadius:14, overflow:'hidden', border:'1px solid var(--border)' }}>
      <div style={{
        background:bg, height:140,
        display:'flex', alignItems:'center', justifyContent:'center',
        padding:'14px 20px',
      }}>{children}</div>
      <div style={{
        padding:'10px 14px', background:'var(--surface-1)',
        borderTop:'1px solid var(--border)',
        display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <span style={{ fontSize:11, fontWeight:800 }}>{label}</span>
        <span className="mono" style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:4, background:'var(--surface-2)', color:'var(--text-2)', letterSpacing:'.06em' }}>{tag}</span>
      </div>
    </div>
  );
}

function WordmarkVariant({ label, bg, children }) {
  return (
    <div style={{ borderRadius:14, overflow:'hidden', border:'1px solid var(--border)' }}>
      <div style={{
        background:bg, height:140,
        display:'flex', alignItems:'center', justifyContent:'center', padding:18,
      }}>{children}</div>
      <div style={{ padding:'10px 14px', background:'var(--surface-1)', borderTop:'1px solid var(--border)', fontSize:11, fontWeight:800 }}>{label}</div>
    </div>
  );
}

function BannerCard({ label, spec, children }) {
  return (
    <div style={{ borderRadius:14, overflow:'hidden', border:'1px solid var(--border)' }}>
      {children}
      <div style={{ padding:'10px 14px', background:'var(--surface-1)', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:12, fontWeight:800 }}>{label}</span>
        <span className="mono" style={{ fontSize:10, color:'var(--text-3)' }}>{spec}</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 홈스크린 미리보기 (iOS)
// ──────────────────────────────────────────────────────
function HomeScreenIOS() {
  const apps = [
    { e:'📷', n:'사진' }, { e:'📩', n:'메시지' }, { e:'📅', n:'캘린더' }, { e:'⏰', n:'시계' },
    { e:'📺', n:'TV' }, { e:'🗺', n:'지도' }, { e:'🎵', n:'음악' }, { e:'🎮', n:'게임' },
    { brand:true }, { e:'🛒', n:'마켓' }, { e:'💬', n:'카톡' }, { e:'⚙️', n:'설정' },
  ];
  return (
    <div style={{ textAlign:'center' }}>
      <div className="mono" style={{ fontSize:10, fontWeight:800, color:'var(--text-2)', letterSpacing:'.1em', marginBottom:10 }}>iOS · iPhone</div>
      <div style={{
        width: 220, height: 460, borderRadius: 40,
        background:'linear-gradient(180deg,#1E293B,#0F172A)',
        padding: 12, position: 'relative',
        boxShadow: '0 20px 50px rgba(0,0,0,.3)',
        border:'1px solid rgba(255,255,255,.08)',
      }}>
        {/* 배경 사진 시뮬레이션 */}
        <div style={{
          position:'absolute', inset: 12, borderRadius: 32,
          background: 'linear-gradient(170deg, #6366F1 0%, #A855F7 50%, #EC4899 100%)',
          overflow: 'hidden',
        }}>
          {/* 별 */}
          {[12,28,44,60,76,140,200].map((x,i) => (
            <span key={i} style={{
              position:'absolute', left:`${x}%`, top:`${(i*17+8)%80}%`,
              width:2, height:2, background:'#fff', borderRadius:99, opacity:.6,
            }} />
          ))}
        </div>

        {/* status bar */}
        <div style={{
          position:'absolute', top:18, left:30, right:30,
          display:'flex', justifyContent:'space-between', color:'#fff',
          fontSize:9, fontWeight:700, fontFamily:'var(--font-mono)',
        }}>
          <span>9:41</span>
          <span>●●●● 📶 100%</span>
        </div>

        {/* notch */}
        <div style={{
          position:'absolute', top:14, left:'50%', transform:'translateX(-50%)',
          width:48, height:14, borderRadius:14, background:'#000',
        }} />

        {/* app grid */}
        <div style={{
          position:'absolute', top:50, left:14, right:14, bottom:90,
          display:'grid', gridTemplateColumns:'repeat(4,1fr)', rowGap:14, columnGap:6,
        }}>
          {apps.map((a, i) => (
            <div key={i} style={{ textAlign:'center' }}>
              {a.brand ? (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', position:'relative' }}>
                  <div style={{ position:'absolute', top:-3, left:'50%', transform:'translateX(-50%) translateY(-100%)', width:32, height:14, borderRadius:6, background:'#FF1F8F', color:'#fff', fontSize:7, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center', letterSpacing:'.04em', boxShadow:'0 2px 6px rgba(255,31,143,.4)' }}>NEW!</div>
                  <AppIcon size={38} shape="ios" />
                  <span style={{ color:'#fff', fontSize:8, fontWeight:600, marginTop:3, textShadow:'0 1px 2px rgba(0,0,0,.6)' }}>Pink Rabbit</span>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                  <div style={{ width:38, height:38, borderRadius:9, background:'rgba(255,255,255,.18)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, border:'1px solid rgba(255,255,255,.1)' }}>{a.e}</div>
                  <span style={{ color:'#fff', fontSize:8, fontWeight:500, marginTop:3, opacity:.85, textShadow:'0 1px 2px rgba(0,0,0,.6)' }}>{a.n}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* dock */}
        <div style={{
          position:'absolute', bottom:12, left:14, right:14, height:62,
          background:'rgba(255,255,255,.18)', backdropFilter:'blur(20px)',
          borderRadius:18, display:'flex', alignItems:'center', justifyContent:'space-around',
          padding:'0 10px', border:'1px solid rgba(255,255,255,.1)',
        }}>
          {['📞','💌','🌐','🎵'].map(e => (
            <div key={e} style={{ width:40, height:40, borderRadius:9, background:'rgba(255,255,255,.25)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>{e}</div>
          ))}
        </div>

        {/* home indicator */}
        <div style={{ position:'absolute', bottom:4, left:'50%', transform:'translateX(-50%)', width:80, height:3, borderRadius:3, background:'#fff' }} />
      </div>
    </div>
  );
}

// ── 홈스크린 미리보기 (Android) ─────────────────────
function HomeScreenAndroid() {
  return (
    <div style={{ textAlign:'center' }}>
      <div className="mono" style={{ fontSize:10, fontWeight:800, color:'var(--text-2)', letterSpacing:'.1em', marginBottom:10 }}>Android · Material You</div>
      <div style={{
        width: 220, height: 460, borderRadius: 28,
        background:'#000', padding: 6, position:'relative',
        boxShadow: '0 20px 50px rgba(0,0,0,.3)',
      }}>
        <div style={{
          position:'absolute', inset: 6, borderRadius: 22, overflow:'hidden',
          background:'linear-gradient(170deg, #1E293B 0%, #475569 100%)',
        }}>
          {/* status bar */}
          <div style={{
            display:'flex', justifyContent:'space-between',
            padding:'10px 16px', color:'#fff',
            fontSize:9, fontWeight:700, fontFamily:'var(--font-mono)',
          }}>
            <span>9:41</span>
            <span>📶 100%</span>
          </div>

          {/* widget */}
          <div style={{ padding:'10px 14px' }}>
            <div style={{
              padding:'14px 14px', borderRadius:16,
              background:'rgba(255,255,255,.08)', backdropFilter:'blur(10px)',
              border:'1px solid rgba(255,255,255,.1)',
              display:'flex', alignItems:'center', gap:10,
            }}>
              <AppIcon size={42} shape="android" />
              <div style={{ flex:1 }}>
                <div style={{ color:'#fff', fontSize:11, fontWeight:900, letterSpacing:'-.01em' }}>Pink Rabbit</div>
                <div style={{ color:'rgba(255,255,255,.7)', fontSize:8, marginTop:2 }}>지금 진행중 6 토너 🔴</div>
              </div>
              <div style={{ width:18, height:18, borderRadius:99, background:'rgba(255,255,255,.18)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11 }}>›</div>
            </div>
          </div>

          {/* apps */}
          <div style={{ padding:'8px 14px', display:'grid', gridTemplateColumns:'repeat(4,1fr)', rowGap:14, columnGap:6 }}>
            {[
              { e:'📞', n:'전화', circle:'#4285F4' },
              { e:'💬', n:'메시지', circle:'#34A853' },
              { e:'🎵', n:'음악', circle:'#EA4335' },
              { brand:true },
              { e:'📷', n:'카메라', circle:'#FBBC04' },
              { e:'🌐', n:'Chrome', circle:'#4285F4' },
              { e:'📩', n:'Gmail', circle:'#EA4335' },
              { e:'🗺', n:'지도', circle:'#34A853' },
              { e:'▶️', n:'유튜브', circle:'#FF0000' },
              { e:'🏪', n:'Play', circle:'#01B47A' },
              { e:'⚙️', n:'설정', circle:'#5F6368' },
              { e:'📁', n:'파일', circle:'#1A73E8' },
            ].map((a, i) => (
              <div key={i} style={{ textAlign:'center' }}>
                {a.brand ? (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                    <AppIcon size={36} shape="android" />
                    <span style={{ color:'#fff', fontSize:8, fontWeight:700, marginTop:3 }}>Pink Rabbit</span>
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                    <div style={{ width:36, height:36, borderRadius:99, background:a.circle, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>{a.e}</div>
                    <span style={{ color:'#fff', fontSize:8, fontWeight:500, marginTop:3, opacity:.9 }}>{a.n}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* nav bar */}
          <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'14px 0 10px', display:'flex', justifyContent:'space-around' }}>
            <div style={{ width:20, height:3, borderRadius:99, background:'#fff' }} />
            <div style={{ width:16, height:16, borderRadius:99, background:'transparent', border:'1.5px solid #fff' }} />
            <div style={{ width:16, height:16, borderRadius:3, background:'transparent', border:'1.5px solid #fff' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 배너 변형들
// ──────────────────────────────────────────────────────

// 1. 웹 히어로 1920×600
function BannerHero() {
  return (
    <div style={{
      aspectRatio:'1920/600', position:'relative', overflow:'hidden',
      background:'linear-gradient(135deg,#831843 0%,#BE185D 50%,#FF1F8F 100%)',
    }}>
      {/* 배경 디자인 — 큰 토끼 + 도형 */}
      <div style={{ position:'absolute', top:-40, right:-60, opacity:.12 }}>
        <AppIcon size={420} shape="ios" />
      </div>
      <div style={{ position:'absolute', top:'10%', right:'8%', width:160, height:160, borderRadius:99, background:'rgba(255,255,255,.06)' }} />
      <div style={{ position:'absolute', bottom:'-20%', left:'18%', width:240, height:240, borderRadius:99, background:'rgba(255,255,255,.04)' }} />

      <div style={{
        position:'absolute', inset:0, padding:'7% 6%',
        display:'flex', flexDirection:'column', justifyContent:'center',
        color:'#fff',
      }}>
        <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:99, background:'rgba(255,255,255,.18)', backdropFilter:'blur(8px)', fontSize:10, fontWeight:800, letterSpacing:'.16em', alignSelf:'flex-start' }}>
          <LiveBadge size="sm" /> BETA OPEN · 부산·경남
        </div>
        <div style={{ fontSize:'min(54px, 7vw)', fontWeight:900, letterSpacing:'-.03em', lineHeight:1.05, marginTop:14, textShadow:'0 4px 24px rgba(0,0,0,.2)' }}>
          홀덤펍 디스커버리,<br/>한 손에.
        </div>
        <div style={{ fontSize:'min(14px, 1.6vw)', marginTop:10, opacity:.92, fontWeight:500 }}>
          매장 47곳 · LIVE 6 · 오늘의 토너 8건 — Pink Rabbit으로 시작하세요
        </div>
      </div>
    </div>
  );
}

// 2. 이메일 헤더 600×200
function BannerEmail() {
  return (
    <div style={{
      aspectRatio:'600/200', position:'relative',
      background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
      display:'flex', alignItems:'center', padding:'0 20px', gap:14, overflow:'hidden',
    }}>
      <div style={{ position:'absolute', top:-30, right:-30, opacity:.15 }}>
        <AppIcon size={160} shape="ios" />
      </div>
      <AppIcon size={56} shape="ios" glow />
      <div style={{ color:'#fff', position:'relative' }}>
        <div style={{ fontSize:22, fontWeight:900, letterSpacing:'-.025em' }}>Pink Rabbit</div>
        <div style={{ fontSize:11, opacity:.92, marginTop:3 }}>홀덤펍 데일리 뉴스레터 · 매주 화요일</div>
      </div>
    </div>
  );
}

// 3. OG 1200×630
function BannerOG() {
  return (
    <div style={{
      aspectRatio:'1200/630', position:'relative',
      background:'#FFFFFF', overflow:'hidden',
      display:'flex', flexDirection:'column', justifyContent:'space-between', padding:24,
    }}>
      <div style={{ position:'absolute', bottom:-60, right:-40, opacity:.08 }}>
        <AppIcon size={300} shape="ios" />
      </div>
      <div style={{ position:'relative' }}>
        <AppIcon size={48} shape="ios" />
      </div>
      <div style={{ position:'relative' }}>
        <div style={{ fontSize:'min(28px,2.6vw)', fontWeight:900, letterSpacing:'-.025em', lineHeight:1.15 }}>
          부산·경남 홀덤펍의<br/>
          <span style={{
            background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
          }}>디지털 인프라.</span>
        </div>
        <div style={{ fontSize:'min(12px,1.2vw)', color:'var(--text-2)', marginTop:6, fontWeight:600 }}>
          pinkrabbit.kr
        </div>
      </div>
    </div>
  );
}

// 4. 인스타 정사각 1080×1080
function BannerInsta() {
  return (
    <div style={{
      aspectRatio:'1/1', position:'relative', overflow:'hidden',
      background:'linear-gradient(160deg, #FFE9D6 0%, #FFB3D4 50%, #FF6BAA 100%)',
      display:'flex', flexDirection:'column', justifyContent:'space-between', padding:18,
    }}>
      <div style={{ position:'absolute', top:'30%', right:-30, opacity:.18 }}>
        <AppIcon size={200} shape="ios" />
      </div>
      <div style={{ position:'relative' }}>
        <AppIcon size={42} shape="ios" />
      </div>
      <div style={{ position:'relative' }}>
        <div style={{
          padding:'3px 8px', borderRadius:99, background:'#fff',
          display:'inline-flex', alignItems:'center', gap:5,
          fontSize:9, fontWeight:900, color:'#FF1F8F', letterSpacing:'.06em',
        }}>
          <span style={{ width:5, height:5, borderRadius:99, background:'#E53E3E', animation:'pulse 1.6s infinite' }} />
          OPEN
        </div>
        <div style={{ fontSize:'min(22px,2.4vw)', fontWeight:900, letterSpacing:'-.025em', lineHeight:1.15, marginTop:8, color:'#111827' }}>
          오늘 어디서<br/>치지?
        </div>
        <div style={{ fontSize:11, color:'#831843', marginTop:6, fontWeight:700 }}>@pinkrabbit_kr</div>
      </div>
    </div>
  );
}

// 5. 스토리/릴스 1080×1920
function BannerStory() {
  return (
    <div style={{
      aspectRatio:'9/16', position:'relative', overflow:'hidden',
      background:'linear-gradient(180deg, #831843 0%, #FF1F8F 60%, #FF6BAA 100%)',
      display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center',
      padding:14,
    }}>
      <div style={{ position:'absolute', top:'10%', left:'50%', transform:'translateX(-50%)' }}>
        <AppIcon size={64} shape="ios" glow />
      </div>
      <div style={{ textAlign:'center', color:'#fff', marginTop:30 }}>
        <div style={{ fontSize:'min(20px,2.5vw)', fontWeight:900, letterSpacing:'-.025em', lineHeight:1.15 }}>
          내 주변<br/>홀덤펍 찾기
        </div>
        <div style={{ fontSize:'min(10px,1.4vw)', opacity:.92, marginTop:6 }}>
          BETA 무료 다운로드
        </div>
      </div>
      <div style={{ position:'absolute', bottom:18, color:'#fff', fontSize:'min(9px,1.2vw)', fontWeight:700, opacity:.85 }}>
        ↑ swipe up
      </div>
    </div>
  );
}

// 6. 앱 내 프로모션 1920×700
function BannerAppPromo() {
  return (
    <div style={{
      aspectRatio:'1920/700', position:'relative', overflow:'hidden',
      background:'linear-gradient(135deg, #1F2937 0%, #FF1F8F 100%)',
      display:'flex', alignItems:'center', padding:'0 24px', gap:16,
    }}>
      <div style={{ position:'absolute', bottom:-40, right:-20, opacity:.18 }}>
        <AppIcon size={180} shape="ios" />
      </div>
      <div style={{ flex:1, color:'#fff', position:'relative' }}>
        <div style={{ fontSize:9, fontWeight:800, letterSpacing:'.16em', opacity:.7 }}>SPONSORED</div>
        <div style={{ fontSize:'min(20px,2.3vw)', fontWeight:900, marginTop:4, letterSpacing:'-.02em' }}>홀덤킹 KOREA TOUR 2026</div>
        <div style={{ fontSize:'min(11px,1.3vw)', opacity:.85, marginTop:2 }}>서울 · 부산 · 1억 GTD · 등록 OPEN</div>
      </div>
      <div style={{ position:'absolute', top:8, right:8, fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:4, background:'rgba(0,0,0,.4)', color:'#fff' }}>광고</div>
    </div>
  );
}

Object.assign(window, { BrandKitSection, AppIcon, Wordmark });
