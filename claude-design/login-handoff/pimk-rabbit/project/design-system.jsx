// design-system.jsx — Pink Rabbit 디자인 시스템 카탈로그
// 토큰 · 타이포 · 컴포넌트 · 시그니처 패턴

function DesignSystemCatalog({ fontBody }) {
  return (
    <section style={{ marginBottom:48 }}>

      {/* HERO — 브랜드 소개 */}
      <div style={{
        borderRadius:28, padding:'40px 32px',
        background:'linear-gradient(135deg, #FF1F8F 0%, #FF6BAA 50%, #FFB3D4 100%)',
        position:'relative', overflow:'hidden',
        color:'#fff', marginBottom:32,
      }}>
        {/* 배경 토끼 */}
        <div style={{ position:'absolute', top:-30, right:-40, opacity:.16 }}>
          <RabbitLogo size={280} variant="mark" />
        </div>
        {/* 배경 도형 */}
        <div style={{ position:'absolute', bottom:-60, left:-30, width:200, height:200, borderRadius:99, background:'rgba(255,255,255,.06)' }} />

        <div style={{ position:'relative', maxWidth:680 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:24 }}>
            <RabbitLogo size={72} variant="badge" glow />
            <div style={{
              fontSize:28, fontWeight:900, letterSpacing:'-.025em',
              textShadow:'0 2px 12px rgba(0,0,0,.15)',
            }}>Pink Rabbit</div>
            <span style={{
              fontSize:10, fontWeight:800, padding:'4px 10px', borderRadius:99,
              background:'rgba(255,255,255,.25)', backdropFilter:'blur(8px)', letterSpacing:'.08em',
            }}>BETA · v2.0</span>
          </div>
          <div style={{ fontSize:34, fontWeight:900, letterSpacing:'-.03em', lineHeight:1.1 }}>
            부산·경남 홀덤펍의<br />
            디지털 인프라
          </div>
          <div style={{ fontSize:14, fontWeight:500, marginTop:16, opacity:.95, lineHeight:1.6, maxWidth:480 }}>
            매장 디스커버리 · 토너 운영 · LIVE 디스플레이를 하나로.
            야놀자·토스의 라이트한 DNA에 핫핑크 액센트를 더한 디자인 시스템.
          </div>

          {/* 핵심 메트릭 */}
          <div style={{ display:'flex', gap:24, marginTop:24, flexWrap:'wrap' }}>
            {[
              { val:'5', label:'카테고리' },
              { val:'#FF1F8F', label:'시그니처 핫핑크', mono:true },
              { val:'Pretendard', label:'본문 폰트' },
            ].map(m => (
              <div key={m.label}>
                <div className={m.mono ? 'mono' : ''} style={{ fontSize: m.mono ? 16 : 24, fontWeight:900, letterSpacing:'-.01em' }}>{m.val}</div>
                <div style={{ fontSize:11, opacity:.85, fontWeight:600, marginTop:2 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 메타 정보 */}
      <div style={{
        display:'grid', gridTemplateColumns:'2fr 1fr', gap:16, marginBottom:32,
      }}>
        <div className="ds-card" style={{ padding:24 }}>
          <div className="section-title">유지할 것</div>
          <ul style={{ margin:0, padding:0, listStyle:'none', display:'flex', flexDirection:'column', gap:10 }}>
            {[
              ['브랜드 핫핑크', '#FF1F8F 단 한 가지가 시각적 닻'],
              ['LIVE 빨강', '#E53E3E — 진행중/긴급 의미로만 한정'],
              ['모바일 우선', 'max-w-md(392px) · 한국어 Pretendard'],
              ['TV 3분할 골격', '좌 STRUCTURE · 중 거대 타이머 · 우 3카드'],
              ['채팅방 ASC 흐름', '시간순(오래된 → 최신) — 카카오톡 오픈채팅 톤'],
            ].map(([k, v]) => (
              <li key={k} style={{ display:'flex', gap:12, alignItems:'baseline' }}>
                <span style={{ flexShrink:0, width:6, height:6, borderRadius:99, background:'var(--brand)', marginTop:6 }} />
                <div>
                  <span style={{ fontSize:13, fontWeight:800, letterSpacing:'-.01em' }}>{k}</span>
                  <span style={{ fontSize:13, color:'var(--text-2)', marginLeft:8 }}>{v}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="ds-card" style={{ padding:24, background:'linear-gradient(160deg, var(--surface-1) 0%, rgba(255,31,143,.04) 100%)' }}>
          <div className="section-title">개선 자유 · 금지</div>
          <div style={{ fontSize:12, color:'var(--text-2)', lineHeight:1.65 }}>
            <div style={{ marginBottom:10 }}>
              <span style={{ color:'#10B981', fontWeight:800 }}>✓ 자유</span>{' '}
              카드 비율 · grid · 여백 · 일러스트 · 다크 톤 · 마이크로 인터랙션
            </div>
            <div>
              <span style={{ color:'#E53E3E', fontWeight:800 }}>✕ 금지</span>{' '}
              LIVE 빨강을 다른 카테고리에 재사용 · TV 3분할 골격 변경 · 채팅방 ASC 흐름 변경
            </div>
          </div>
        </div>
      </div>

      {/* COLOR ROLES */}
      <DSSection title="Color · 역할 기반 토큰" subtitle="브랜드 · 시맨틱 · 표면 · 텍스트 · 다크모드">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          {/* Brand + Semantic */}
          <div className="ds-card" style={{ padding:20 }}>
            <div className="section-title" style={{ marginBottom:14 }}>Brand & Semantic</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {[
                { name:'--brand', hex:'#FF1F8F', desc:'시그니처 핫핑크' },
                { name:'--brand-dim', hex:'#E01077', desc:'pressed' },
                { name:'--brand-soft', hex:'#FF6BAA', desc:'그라데이션' },
                { name:'--brand-pale', hex:'#FFF0F7', desc:'아이콘 배경' },
                { name:'--live', hex:'#E53E3E', desc:'진행/긴급' },
                { name:'--gold', hex:'#F59E0B', desc:'BREAK / 시리즈' },
                { name:'--success', hex:'#10B981', desc:'완료 / 운영중' },
              ].map(c => <SwatchRow key={c.name} {...c} />)}
            </div>
          </div>
          {/* Surface + Text + Dark */}
          <div className="ds-card" style={{ padding:20 }}>
            <div className="section-title" style={{ marginBottom:14 }}>Surface & Text</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {[
                { name:'--bg', hex:'#FFFFFF', desc:'화면 배경', border:true },
                { name:'--bg-sub', hex:'#EEF0F4', desc:'캔버스 배경' },
                { name:'--surface-2', hex:'#F3F4F6', desc:'카드 강조' },
                { name:'--border', hex:'#E5E7EB', desc:'구분선' },
                { name:'--text-1', hex:'#111827', desc:'본문' },
                { name:'--text-2', hex:'#6B7280', desc:'보조' },
                { name:'--text-3', hex:'#9CA3AF', desc:'placeholder' },
              ].map(c => <SwatchRow key={c.name} {...c} />)}
            </div>
            <div className="section-title" style={{ marginBottom:10, marginTop:18 }}>Dark Mode</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {[
                { name:'dark --bg', hex:'#0F1419', desc:'본사·TV', darkLabel:true },
                { name:'dark --bg-sub', hex:'#0A0D12', desc:'본사 캔버스', darkLabel:true },
                { name:'dark --surface', hex:'#161B25', desc:'카드', darkLabel:true },
                { name:'dark --border', hex:'#2D3548', desc:'구분선', darkLabel:true },
              ].map(c => <SwatchRow key={c.name} {...c} />)}
            </div>
          </div>
        </div>

        {/* cardEmoji 색상 9종 */}
        <div className="ds-card" style={{ padding:20, marginTop:16 }}>
          <div className="section-title" style={{ marginBottom:14 }}>cardEmoji — 오늘의 소식 9종 배경</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(9,1fr)', gap:8 }}>
            {CARD_COLORS.map((c, i) => (
              <div key={i} style={{ textAlign:'center' }}>
                <div style={{ width:'100%', aspectRatio:'1/1', borderRadius:10, background:c, border:'1px solid rgba(0,0,0,.06)', boxShadow:'var(--shadow-card)' }} />
                <div className="mono" style={{ fontSize:9, color:'var(--text-3)', marginTop:5 }}>{c}</div>
              </div>
            ))}
          </div>
        </div>
      </DSSection>

      {/* TYPOGRAPHY */}
      <DSSection title="Typography" subtitle={`본문: ${fontBody.includes('Pretendard') ? 'Pretendard' : fontBody.split(',')[0].replace(/['"]/g,'')} · 숫자: JetBrains Mono`}>
        <div className="ds-card" style={{ padding:'28px 24px' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {[
              { spec:'Display / 900 / 40', cls:'h1', sample:'홀덤펍 디스커버리' },
              { spec:'Heading / 900 / 28', cls:'h2', sample:'화명동 깜깜이 펍' },
              { spec:'Title / 800 / 18', cls:'h3', sample:'데일리 히든에이스 30T' },
              { spec:'Body / 500 / 14', size:14, weight:500, sample:'바이인 3만원 · GTD 100만원 · 리바이 무제한' },
              { spec:'Caption / 700 / 12', size:12, weight:700, color:'var(--text-2)', sample:'부산 · 30T 라이브 진행중 · 1.2km' },
              { spec:'Micro / 800 / 10 · uppercase', size:10, weight:800, color:'var(--text-3)', spacing:'.12em', upper:true, sample:'SPONSORED · STRUCTURE · LATE REG' },
            ].map((t,i) => (
              <div key={i} style={{ display:'flex', gap:24, alignItems:'baseline', paddingBottom:14, borderBottom: i < 5 ? '1px solid var(--border)' : 'none' }}>
                <div className="mono" style={{ width:200, fontSize:11, color:'var(--text-3)', flexShrink:0 }}>{t.spec}</div>
                {t.cls
                  ? <span className={t.cls} style={{ letterSpacing:'-.02em' }}>{t.sample}</span>
                  : <span style={{ fontSize:t.size, fontWeight:t.weight, color:t.color || 'var(--text-1)', letterSpacing:t.spacing || '-.01em', textTransform: t.upper ? 'uppercase' : 'none' }}>{t.sample}</span>
                }
              </div>
            ))}
            {/* mono 거대 — TV 타이머 */}
            <div style={{ display:'flex', gap:24, alignItems:'baseline', paddingTop:6 }}>
              <div className="mono" style={{ width:200, fontSize:11, color:'var(--text-3)' }}>JetBrains Mono / 800 / 64</div>
              <span className="mono" style={{ fontSize:64, fontWeight:800, color:'var(--brand)', lineHeight:1, letterSpacing:'-.02em' }}>09:14</span>
              <span style={{ fontSize:11, color:'var(--text-2)', alignSelf:'center' }}>TV 거대 타이머 · 매장 운영의 얼굴</span>
            </div>
          </div>
        </div>
      </DSSection>

      {/* SPACING · RADIUS · SHADOW */}
      <DSSection title="Spacing · Radius · Shadow" subtitle="시각적 일관성을 위한 측정 단위">
        <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 1.2fr', gap:16 }}>
          {/* Radius */}
          <div className="ds-card" style={{ padding:20 }}>
            <div className="section-title" style={{ marginBottom:14 }}>Radius</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {[
                { n:'r-xs', v:6, use:'tag · chip' },
                { n:'r-sm', v:10, use:'input · pill' },
                { n:'r-md', v:14, use:'card sm' },
                { n:'r-lg', v:18, use:'card md' },
                { n:'r-xl', v:22, use:'modal · hero' },
                { n:'r-2xl', v:28, use:'phone frame' },
              ].map(r => (
                <div key={r.n} style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:48, height:32, background:'var(--brand-pale)', border:'1px solid var(--border)', borderRadius:r.v, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <span className="mono" style={{ fontSize:11, fontWeight:700 }}>{r.n}</span>
                    <span className="mono" style={{ fontSize:10, color:'var(--text-3)', marginLeft:8 }}>{r.v}px</span>
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-2)' }}>{r.use}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Spacing scale */}
          <div className="ds-card" style={{ padding:20 }}>
            <div className="section-title" style={{ marginBottom:14 }}>Spacing</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {[
                { n:'2', v:8 },
                { n:'3', v:12 },
                { n:'4', v:16 },
                { n:'5', v:20 },
                { n:'6', v:24 },
                { n:'8', v:32 },
                { n:'10', v:40 },
              ].map(s => (
                <div key={s.n} style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div className="mono" style={{ fontSize:11, fontWeight:700, width:24 }}>{s.n}</div>
                  <div style={{ width:s.v, height:16, background:'var(--brand)', borderRadius:3 }} />
                  <span className="mono" style={{ fontSize:10, color:'var(--text-3)' }}>{s.v}px</span>
                </div>
              ))}
            </div>
          </div>

          {/* Shadow */}
          <div className="ds-card" style={{ padding:20 }}>
            <div className="section-title" style={{ marginBottom:14 }}>Shadow</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {[
                { n:'shadow-card', s:'var(--shadow-card)', use:'카드 정적' },
                { n:'shadow-float', s:'var(--shadow-float)', use:'호버 · 떠있음' },
                { n:'shadow-brand', s:'var(--shadow-brand)', use:'CTA · 핑크 글로우' },
                { n:'shadow-hero', s:'var(--shadow-hero)', use:'phone · 모달' },
              ].map(sh => (
                <div key={sh.n} style={{
                  padding:'18px 12px', background:'var(--bg)', borderRadius:14,
                  boxShadow:sh.s, textAlign:'center',
                  border: sh.n === 'shadow-brand' ? '1px solid #FFC9DE' : '1px solid var(--border)',
                }}>
                  <div className="mono" style={{ fontSize:9, fontWeight:700 }}>{sh.n}</div>
                  <div style={{ fontSize:9, color:'var(--text-2)', marginTop:3 }}>{sh.use}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DSSection>

      {/* MOTION */}
      <DSSection title="Motion" subtitle="모든 transition은 .15s ease · 모달은 .28s cubic-bezier(.2,.8,.2,1)">
        <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:16 }}>
          <div className="ds-card" style={{ padding:20 }}>
            <div className="section-title" style={{ marginBottom:14 }}>Timing</div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {[
                { n:'micro', dur:'120ms', use:'tap scale · 버튼 prss' },
                { n:'fast', dur:'150ms', use:'hover · 컬러/배경 전환' },
                { n:'base', dur:'200ms', use:'카드 lift · shadow' },
                { n:'modal', dur:'280ms', use:'슬라이드 업 · 모달' },
                { n:'theme', dur:'250ms', use:'라이트 ↔ 다크' },
              ].map(t => (
                <div key={t.n} style={{ display:'flex', alignItems:'center', gap:14, padding:'6px 0' }}>
                  <span className="mono" style={{ fontSize:11, fontWeight:800, width:50, color:'var(--brand)' }}>{t.n}</span>
                  <span className="mono" style={{ fontSize:11, color:'var(--text-2)', width:60 }}>{t.dur}</span>
                  <span style={{ fontSize:12, color:'var(--text-1)' }}>{t.use}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ds-card" style={{ padding:20, display:'flex', flexDirection:'column' }}>
            <div className="section-title" style={{ marginBottom:14 }}>인터랙션 데모</div>
            <div style={{ display:'flex', flexDirection:'column', gap:12, flex:1, justifyContent:'space-around' }}>
              <div>
                <div style={{ fontSize:11, color:'var(--text-2)', marginBottom:6 }}>tap scale (.97)</div>
                <button className="tap" style={{ padding:'10px 18px', borderRadius:12, background:'var(--brand)', color:'#fff', border:'none', fontSize:13, fontWeight:800, cursor:'pointer', boxShadow:'var(--shadow-brand)' }}>눌러보세요</button>
              </div>
              <div>
                <div style={{ fontSize:11, color:'var(--text-2)', marginBottom:6 }}>card lift (호버 시 -2px + shadow)</div>
                <div className="lift" style={{ padding:'12px 14px', borderRadius:12, background:'var(--surface-1)', border:'1px solid var(--border)', fontSize:12, fontWeight:700, color:'var(--text-1)' }}>호버해보세요 ↑</div>
              </div>
              <div>
                <div style={{ fontSize:11, color:'var(--text-2)', marginBottom:6 }}>pulse (LIVE 닷 1.6s 반복)</div>
                <LiveBadge size="lg" />
              </div>
            </div>
          </div>
        </div>
      </DSSection>

      {/* SIGNATURE COMPONENTS */}
      <DSSection title="Signature Components" subtitle="브랜드 정체성을 만드는 핵심 요소 · 함부로 바꾸지 말 것">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:16 }}>

          {/* 1. LIVE Badge */}
          <SigComponent title="LIVE Badge" badge="펄스 애니메이션">
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <LiveBadge size="sm" />
              <LiveBadge />
              <LiveBadge size="lg" />
            </div>
            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:12, lineHeight:1.5 }}>
              <code style={{ background:'var(--surface-2)', padding:'1px 6px', borderRadius:4, fontFamily:'var(--font-mono)' }}>{'<LiveBadge />'}</code>
              {' '}— LIVE 빨강은 진행/긴급 의미만. 절대 재사용 X.
            </div>
          </SigComponent>

          {/* 2. BREAK Badge */}
          <SigComponent title="BREAK Badge" badge="amber">
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <BreakBadge />
            </div>
            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:12, lineHeight:1.5 }}>
              레벨 사이 휴식 상태. <code style={{ background:'var(--surface-2)', padding:'1px 6px', borderRadius:4, fontFamily:'var(--font-mono)' }}>#F59E0B</code>{' '}gold 톤.
            </div>
          </SigComponent>

          {/* 3. CTA Button */}
          <SigComponent title="Hot Pink CTA" badge="shadow-brand">
            <button className="tap" style={{
              padding:'12px 22px', borderRadius:14, background:'var(--brand)',
              color:'#fff', fontSize:14, fontWeight:900, letterSpacing:'-.01em',
              border:'none', cursor:'pointer', boxShadow:'var(--shadow-brand)',
            }}>예약하기</button>
            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:12 }}>
              모든 주요 액션 — 핑크 풀필 + 핑크 글로우 그림자
            </div>
          </SigComponent>

          {/* 4. 매장 카테고리 아이콘 */}
          <SigComponent title="카테고리 아이콘 wrap">
            <div style={{ display:'flex', gap:8 }}>
              {['🃏','🎰','🥃','🏆','🎲'].map((e,i) => (
                <div key={i} style={{ width:44, height:44, borderRadius:13, background:'var(--brand-pale)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>{e}</div>
              ))}
            </div>
            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:12 }}>
              <code style={{ background:'var(--surface-2)', padding:'1px 6px', borderRadius:4, fontFamily:'var(--font-mono)' }}>--brand-pale</code>{' '}배경 · 이모지 또는 SVG
            </div>
          </SigComponent>

          {/* 5. TV mono Timer */}
          <SigComponent title="TV mono Timer">
            <div className="mono" style={{ fontSize:42, fontWeight:800, color:'var(--brand)', lineHeight:1, letterSpacing:'-.02em' }}>09:14</div>
            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:12 }}>
              JetBrains Mono · tabular-nums · 매장 운영의 시그니처
            </div>
          </SigComponent>

          {/* 6. Tabbar Pill */}
          <SigComponent title="Tabbar Pill Active">
            <div style={{ display:'inline-flex', alignItems:'center', gap:4, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:99, padding:4 }}>
              <span style={{ padding:'5px 11px', fontSize:11, fontWeight:800, color:'#fff', borderRadius:99, background:'var(--brand)' }}>홈</span>
              <span style={{ padding:'5px 11px', fontSize:11, fontWeight:700, color:'var(--text-2)' }}>매장찾기</span>
              <span style={{ padding:'5px 11px', fontSize:11, fontWeight:700, color:'var(--text-2)' }}>채팅방</span>
            </div>
            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:12 }}>
              하단 탭 활성 = 핫핑크 알약 · 비활성 = 그레이 텍스트
            </div>
          </SigComponent>

          {/* 7. Pinned Notice */}
          <SigComponent title="본사 공지 (Pinned)">
            <div style={{
              borderRadius:10, padding:'8px 10px',
              background:'linear-gradient(135deg,rgba(255,31,143,.12),rgba(255,31,143,.02))',
              border:'1px solid rgba(255,31,143,.25)',
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:2 }}>
                <span style={{ fontSize:9, fontWeight:800, padding:'1px 5px', borderRadius:4, background:'var(--brand)', color:'#fff' }}>공지</span>
                <span style={{ fontSize:11, fontWeight:800 }}>6월 신규매장 모집</span>
              </div>
              <div style={{ fontSize:10, color:'var(--text-2)' }}>부산·경남 5곳 한정</div>
            </div>
            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:12 }}>
              채팅방 상단 고정 · 핑크 그라데이션 배경
            </div>
          </SigComponent>

          {/* 8. 매장 카드 */}
          <SigComponent title="ChatPostCard (말풍선)">
            <div style={{ display:'flex', gap:8 }}>
              <div style={{ width:32, height:32, borderRadius:99, background:'#FFE4F1', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>🃏</div>
              <div style={{
                borderRadius:'12px 12px 12px 3px', padding:'8px 10px',
                background:'#FFE4F1', border:'1px solid #FFC9DE',
              }}>
                <div style={{ fontSize:11, fontWeight:800 }}>오늘 9시 30T OPEN!</div>
                <div style={{ fontSize:10, color:'rgba(0,0,0,.6)', marginTop:2 }}>바이인 3만</div>
              </div>
            </div>
            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:12 }}>
              카카오톡 오픈채팅 톤 · 9색 카테고리
            </div>
          </SigComponent>

          {/* 9. SVG 토끼 로고 */}
          <SigComponent title="Pink Rabbit Mark">
            <div style={{ display:'flex', alignItems:'center', gap:16 }}>
              <RabbitLogo size={56} variant="badge" />
              <RabbitLogo size={40} variant="mark" />
              <RabbitLogo size={32} variant="badge" />
            </div>
            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:12 }}>
              badge · mark 2가지 변형 · 화이트 토끼 + 핑크 그라데이션
            </div>
          </SigComponent>

        </div>
      </DSSection>

    </section>
  );
}

// ── 헬퍼 컴포넌트 ────────────────────────────────────────
function DSSection({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom:40 }}>
      <div style={{ marginBottom:14 }}>
        <h2 className="h2">{title}</h2>
        {subtitle && <div style={{ fontSize:13, color:'var(--text-2)', marginTop:4 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function SwatchRow({ name, hex, desc, border, darkLabel }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
      <div className="swatch" style={{
        background:hex, width:40, height:40, borderRadius:10, flexShrink:0,
        border: border ? '1px solid var(--border)' : 'none',
      }} />
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:'-.01em', color:'var(--text-1)' }}>{name}</div>
        <div className="mono" style={{ fontSize:10, color:'var(--text-3)' }}>{hex}</div>
        <div style={{ fontSize:10, color:'var(--text-2)', marginTop:1 }}>{desc}</div>
      </div>
    </div>
  );
}

function SigComponent({ title, badge, children }) {
  return (
    <div className="ds-card" style={{ padding:20, display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.06em', color:'var(--text-2)', textTransform:'uppercase' }}>{title}</div>
        {badge && <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:4, background:'var(--brand-pale)', color:'var(--brand-dim)', letterSpacing:'.04em' }}>{badge}</span>}
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-start' }}>{children}</div>
    </div>
  );
}

Object.assign(window, { DesignSystemCatalog });
