// screens-community.jsx — 커뮤니티 (구인 / 구직 / 중고거래)

const { useState: useStateCM, useEffect: useEffectCM } = React;

// ──────────────────────────────────────────────────────
// 커뮤니티 페이지 — 3개 탭 (구인 / 구직 / 중고거래)
// ──────────────────────────────────────────────────────
function CommunityScreen({ onBack }) {
  const [tab, setTab] = useStateCM('hiring');
  const [q, setQ] = useStateCM('');

  return (
    <div className="phone" style={{ background:'var(--bg-sub)', display:'flex', flexDirection:'column' }}>
      {/* ── 헤더 ─────────────────────────────────────── */}
      <header style={{
        height:52, padding:'0 12px', display:'flex', alignItems:'center', gap:8,
        background:'var(--bg)', borderBottom:'1px solid var(--border)',
        position:'sticky', top:0, zIndex:10,
      }}>
        {onBack && (
          <button onClick={onBack} className="tap" style={{
            width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center',
            background:'transparent', border:'none', color:'var(--text-1)', cursor:'pointer',
          }}>{Icons.back()}</button>
        )}
        <div style={{ flex:1, fontSize:16, fontWeight:900, letterSpacing:'-.015em' }}>커뮤니티</div>
        <button className="tap" style={{ width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:'none', color:'var(--text-1)', cursor:'pointer' }}>{Icons.search(18)}</button>
        <button className="tap" style={{ width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:'none', color:'var(--text-1)', cursor:'pointer', position:'relative' }}>
          {Icons.bell(18)}
          <span style={{ position:'absolute', top:8, right:9, width:6, height:6, borderRadius:99, background:'var(--brand)' }} />
        </button>
      </header>

      {/* ── 탭 (구인 / 구직 / 중고거래) ───────────────── */}
      <nav style={{
        display:'flex', background:'var(--bg)',
        borderBottom:'1px solid var(--border)',
        position:'sticky', top:52, zIndex:9,
      }}>
        {[
          { id:'hiring',  label:'구인', icon:'🙋‍♂️', desc:'딜러 · 매니저 모집' },
          { id:'seeking', label:'구직', icon:'💼', desc:'딜러 이력서' },
          { id:'market',  label:'중고거래', icon:'🃏', desc:'홀덤 용품' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className="tap" style={{
            flex:1, padding:'12px 0 10px', background:'transparent', border:'none', cursor:'pointer',
            position:'relative',
            color: tab === t.id ? 'var(--text-1)' : 'var(--text-3)',
          }}>
            <div style={{ fontSize:18, marginBottom:2 }}>{t.icon}</div>
            <div style={{ fontSize:12, fontWeight: tab === t.id ? 900 : 700, letterSpacing:'-.01em' }}>{t.label}</div>
            <div style={{ fontSize:9, color: tab === t.id ? 'var(--brand)' : 'var(--text-3)', marginTop:1, fontWeight:600 }}>{t.desc}</div>
            {tab === t.id && (
              <span style={{
                position:'absolute', bottom:-1, left:'50%', transform:'translateX(-50%)',
                width:'46%', height:3, borderRadius:99,
                background:'var(--brand)',
                boxShadow:'0 2px 8px rgba(255,31,143,.4)',
              }} />
            )}
          </button>
        ))}
      </nav>

      {/* ── 검색 + 필터 (탭별로 placeholder 다름) ──── */}
      <div style={{ padding:'10px 14px 4px', background:'var(--bg)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surface-2)', borderRadius:10, padding:'0 10px', height:36 }}>
          <span style={{ color:'var(--text-2)' }}>{Icons.search(14)}</span>
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder={
              tab === 'hiring' ? '매장명·지역·포지션' :
              tab === 'seeking' ? '경력·지역으로 검색' :
                                  '카드·칩셋·의자 등'
            }
            style={{ background:'transparent', border:'none', outline:'none', flex:1, fontSize:13, color:'var(--text-1)', fontFamily:'inherit', minWidth:0 }}
          />
          {q && <button onClick={() => setQ('')} className="tap" style={{ background:'transparent', border:'none', color:'var(--text-2)', cursor:'pointer', fontSize:14 }}>✕</button>}
        </div>
      </div>

      {/* ── 컨텐츠 ───────────────────────────────────── */}
      <div className="no-scrollbar" style={{ flex:1, overflowY:'auto', paddingBottom:80 }}>
        {tab === 'hiring' && <HiringList q={q} />}
        {tab === 'seeking' && <SeekingList q={q} />}
        {tab === 'market' && <MarketGrid q={q} />}
      </div>

      {/* ── FAB (글쓰기) ─────────────────────────────── */}
      <button className="tap" style={{
        position:'absolute', right:18, bottom:22, zIndex:20,
        width:54, height:54, borderRadius:99,
        background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
        border:'none', cursor:'pointer',
        boxShadow:'0 8px 22px rgba(255,31,143,.42)',
        display:'flex', alignItems:'center', justifyContent:'center',
        color:'#fff',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 1. 구인 — 매장이 딜러/매니저 구함
// ──────────────────────────────────────────────────────
function HiringList({ q }) {
  const [filter, setFilter] = useStateCM('전체');
  const hiringPosts = [
    {
      id:1, urgent:true, role:'딜러', store:'화명동 깜깜이 펍', emoji:'🃏', grad:'linear-gradient(135deg,#fb7185,#ef4444)',
      region:'부산 화명동 · 1.2km', wage:'시급 18,000원~', exp:'경력 1년+', shift:'주말 야간',
      title:'주말 야간 딜러 급구 · 시급 협의',
      body:'주 2회 (금/토) · 20시~03시\n경력자 우대 · 식대 제공\n바로 출근 가능자 환영',
      tags:['#딜러','#야간','#주말'], posted:'30분 전', views:142,
    },
    {
      id:2, urgent:false, role:'매니저', store:'서면 로얄홀덤', emoji:'🎰', grad:'linear-gradient(135deg,#fbbf24,#ea580c)',
      region:'부산 서면 · 4.5km', wage:'월급 280만원', exp:'경력 3년+', shift:'평일 풀타임',
      title:'토너 운영 매니저 채용',
      body:'토너 진행 · TV 디스플레이 운영\n참가자 관리 · 시리즈 일정 조율\n복지: 4대보험, 식대, 연차',
      tags:['#매니저','#정규직'], posted:'2시간 전', views:387,
    },
    {
      id:3, urgent:false, role:'딜러', store:'김해 BLUE CHIP', emoji:'🥃', grad:'linear-gradient(135deg,#60a5fa,#4338ca)',
      region:'김해 외동 · 8.3km', wage:'시급 16,000원', exp:'신입 가능', shift:'평일 저녁',
      title:'평일 저녁 딜러 모집 (신입OK)',
      body:'주 3-5일 협의 · 19시~01시\n무경력 교육 가능\n분위기 좋아요 ☺️',
      tags:['#딜러','#신입가능'], posted:'어제', views:521,
    },
  ];

  const filtered = hiringPosts.filter(p => {
    if (filter === '딜러' && p.role !== '딜러') return false;
    if (filter === '매니저' && p.role !== '매니저') return false;
    if (filter === '급구' && !p.urgent) return false;
    if (q && !p.title.includes(q) && !p.store.includes(q)) return false;
    return true;
  });

  return (
    <div>
      {/* 필터 chips */}
      <div className="no-scrollbar" style={{ display:'flex', gap:6, padding:'8px 14px 12px', overflowX:'auto', background:'var(--bg)' }}>
        {['전체','🔥 급구','딜러','매니저','📍 가까운순','💰 고시급'].map(f => (
          <button key={f} onClick={() => setFilter(f.replace(/^[^\s]+\s/, ''))} className="tap" style={{
            flexShrink:0, padding:'5px 12px', borderRadius:99, fontSize:11, fontWeight:700,
            border: filter === f.replace(/^[^\s]+\s/, '') ? 'none' : '1px solid var(--border)',
            background: filter === f.replace(/^[^\s]+\s/, '') ? 'var(--brand)' : 'var(--bg)',
            color: filter === f.replace(/^[^\s]+\s/, '') ? '#fff' : 'var(--text-1)',
            cursor:'pointer', whiteSpace:'nowrap',
          }}>{f}</button>
        ))}
      </div>

      {/* 인기 매장 채용 hero */}
      <section style={{ padding:'0 14px 12px' }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:8 }}>
          <div style={{ fontSize:13, fontWeight:900, letterSpacing:'-.015em' }}>🔥 인기 채용</div>
          <span style={{ fontSize:10, fontWeight:700, color:'var(--text-2)' }}>· {filtered.length}건</span>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(p => (
            <article key={p.id} className="lift" style={{
              background:'var(--bg)', borderRadius:14,
              border: p.urgent ? '1px solid #FECDD3' : '1px solid var(--border)',
              padding:'12px 14px', cursor:'pointer',
              position:'relative', overflow:'hidden',
            }}>
              {p.urgent && (
                <div style={{ position:'absolute', top:0, right:0, padding:'2px 10px',
                  background:'linear-gradient(135deg,#E53E3E,#FF1F8F)',
                  color:'#fff', fontSize:9, fontWeight:900, letterSpacing:'.06em',
                  borderRadius:'0 14px 0 10px',
                }}>🔥 급구</div>
              )}

              {/* 매장 행 */}
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                <div style={{ width:38, height:38, borderRadius:11, background:p.grad, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>{p.emoji}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{
                      fontSize:9, fontWeight:800, padding:'1px 6px', borderRadius:5,
                      background: p.role === '딜러' ? '#FFF0F7' : '#FEF3C7',
                      color: p.role === '딜러' ? '#FF1F8F' : '#92400E',
                    }}>{p.role}</span>
                    <span style={{ fontSize:12, fontWeight:800, letterSpacing:'-.01em' }}>{p.store}</span>
                  </div>
                  <div style={{ fontSize:10, color:'var(--text-2)', marginTop:2 }}>{p.region}</div>
                </div>
              </div>

              {/* 타이틀 */}
              <div style={{ fontSize:14, fontWeight:900, lineHeight:1.35, letterSpacing:'-.02em', marginBottom:8 }}>{p.title}</div>

              {/* 정보 grid */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:10 }}>
                {[
                  { e:'💰', l:p.wage, color:'#FF1F8F' },
                  { e:'🕐', l:p.shift },
                  { e:'🏅', l:p.exp },
                  { e:'👁', l:`조회 ${p.views}` },
                ].map((s, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--text-1)' }}>
                    <span>{s.e}</span>
                    <span style={{ fontWeight: s.color ? 800 : 600, color: s.color || 'var(--text-1)' }}>{s.l}</span>
                  </div>
                ))}
              </div>

              {/* body */}
              <div style={{ fontSize:11, color:'var(--text-2)', whiteSpace:'pre-line', lineHeight:1.5, marginBottom:10, paddingBottom:10, borderBottom:'1px solid var(--border)' }}>{p.body}</div>

              {/* 태그 + 시간 + CTA */}
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ display:'flex', gap:4 }}>
                  {p.tags.map(t => <span key={t} style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:5, background:'var(--surface-2)', color:'var(--text-2)' }}>{t}</span>)}
                </div>
                <span style={{ marginLeft:'auto', fontSize:10, color:'var(--text-3)' }} className="mono">{p.posted}</span>
                <button className="tap" style={{
                  padding:'5px 12px', borderRadius:8, fontSize:11, fontWeight:800,
                  background:'var(--brand)', color:'#fff', border:'none', cursor:'pointer',
                  boxShadow:'var(--shadow-brand)',
                }}>지원</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 2. 구직 — 딜러 이력서 카드
// ──────────────────────────────────────────────────────
function SeekingList({ q }) {
  const seekers = [
    {
      id:1, name:'김딜러', avatar:'🐰', gradAva:'linear-gradient(135deg,#FF6BAA,#FF1F8F)',
      exp:'경력 3년', level:'중급', region:'부산 화명동·서면',
      shift:'주말 + 평일 저녁 가능', wage:'시급 18,000원~',
      title:'주말 야간 딜러 자리 찾습니다',
      body:'화명·서면 일대 우대 · 다 시리즈 운영 경험\nWPT/WSOP룰 숙지 · 즉시 출근 가능',
      tags:['#야간OK','#주말','#경력자'], posted:'2시간 전', verified:true, rating:4.8,
    },
    {
      id:2, name:'박포커', avatar:'🃏', gradAva:'linear-gradient(135deg,#fbbf24,#ea580c)',
      exp:'경력 1년', level:'초급', region:'김해 전역',
      shift:'평일 풀타임 가능', wage:'시급 협의',
      title:'성실히 일하는 신입급 딜러입니다',
      body:'BLUE CHIP에서 6개월 근무 경험\n토너 진행 가능 · 캐쉬게임 경험은 부족',
      tags:['#평일','#성실'], posted:'어제', verified:false, rating:null,
    },
    {
      id:3, name:'이매니저', avatar:'💼', gradAva:'linear-gradient(135deg,#60a5fa,#4338ca)',
      exp:'경력 5년', level:'시니어', region:'부산·경남 전역',
      shift:'정규직 희망', wage:'월 300만원~',
      title:'토너 운영 매니저 (시리즈 기획 가능)',
      body:'대형 시리즈 5회 운영 경험\n구조 설계 · 광고 기획 · 본사 인보이스 모두 가능',
      tags:['#매니저','#정규직','#기획'], posted:'3일 전', verified:true, rating:5.0,
    },
  ];

  return (
    <div style={{ padding:'8px 14px 16px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ fontSize:13, fontWeight:900, letterSpacing:'-.015em' }}>💼 구직 중인 딜러 {seekers.length}명</div>
        <button className="tap" style={{ fontSize:11, fontWeight:700, background:'transparent', border:'none', color:'var(--text-2)', cursor:'pointer', display:'flex', alignItems:'center', gap:3 }}>
          {Icons.filter(11)} 필터
        </button>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {seekers.map(s => (
          <article key={s.id} className="lift" style={{
            background:'var(--bg)', borderRadius:14,
            border:'1px solid var(--border)',
            padding:'12px 14px', cursor:'pointer',
          }}>
            {/* 프로필 행 */}
            <div style={{ display:'flex', alignItems:'flex-start', gap:11 }}>
              <div style={{
                width:52, height:52, borderRadius:99, background:s.gradAva,
                display:'flex', alignItems:'center', justifyContent:'center', fontSize:24,
                flexShrink:0, position:'relative',
              }}>
                {s.avatar}
                {s.verified && (
                  <span style={{
                    position:'absolute', bottom:-2, right:-2,
                    width:18, height:18, borderRadius:99,
                    background:'#3B82F6', color:'#fff',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    border:'2px solid var(--bg)', fontSize:9,
                  }}>✓</span>
                )}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ fontSize:14, fontWeight:900, letterSpacing:'-.015em' }}>{s.name}</span>
                  <span style={{
                    fontSize:9, fontWeight:800, padding:'1px 6px', borderRadius:5,
                    background:'var(--brand-pale)', color:'var(--brand)',
                  }}>{s.level}</span>
                  {s.rating && (
                    <span style={{ marginLeft:'auto', fontSize:10, fontWeight:800, color:'var(--gold)', display:'flex', alignItems:'center', gap:2 }}>
                      ⭐ {s.rating}
                    </span>
                  )}
                </div>
                <div style={{ fontSize:11, color:'var(--text-2)', marginTop:3, lineHeight:1.45 }}>
                  {s.exp} · {s.region}
                </div>
              </div>
            </div>

            {/* 타이틀 */}
            <div style={{ fontSize:13, fontWeight:800, marginTop:10, letterSpacing:'-.015em', color:'var(--text-1)' }}>"{s.title}"</div>

            {/* 정보 */}
            <div style={{ background:'var(--surface-2)', borderRadius:10, padding:'8px 10px', marginTop:8 }}>
              <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--text-1)', marginBottom:3 }}>
                <span>🕐</span><span style={{ fontWeight:700 }}>{s.shift}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--text-1)' }}>
                <span>💰</span><span style={{ fontWeight:800, color:'var(--brand)' }}>{s.wage}</span>
              </div>
            </div>

            <div style={{ fontSize:11, color:'var(--text-2)', whiteSpace:'pre-line', lineHeight:1.55, marginTop:8 }}>{s.body}</div>

            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10, paddingTop:10, borderTop:'1px solid var(--border)' }}>
              <div style={{ display:'flex', gap:4 }}>
                {s.tags.map(t => <span key={t} style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:5, background:'var(--surface-2)', color:'var(--text-2)' }}>{t}</span>)}
              </div>
              <span style={{ marginLeft:'auto', fontSize:10, color:'var(--text-3)' }} className="mono">{s.posted}</span>
              <button className="tap" style={{
                padding:'5px 12px', borderRadius:8, fontSize:11, fontWeight:800,
                background:'var(--bg)', color:'var(--text-1)',
                border:'1px solid var(--border-strong)', cursor:'pointer',
              }}>💬 연락</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 3. 중고거래 — 그리드 카드 (당근 톤)
// ──────────────────────────────────────────────────────
function MarketGrid({ q }) {
  const items = [
    { id:1, title:'KEM Arrow 카드 1박스 (신품)', price:'45,000', region:'화명동', time:'5분 전',
      bg:'linear-gradient(135deg,#fb7185,#9F1239)', emoji:'🃏', chat:3, like:8, state:null, hot:true },
    { id:2, title:'포커 칩셋 500개 케이스포함', price:'120,000', region:'서면', time:'1시간 전',
      bg:'linear-gradient(135deg,#fbbf24,#ea580c)', emoji:'🎰', chat:7, like:24, state:null, hot:true },
    { id:3, title:'딜러 셔플러 1년 사용', price:'85,000', region:'김해', time:'어제',
      bg:'linear-gradient(135deg,#10b981,#047857)', emoji:'🤖', chat:1, like:3, state:'예약중' },
    { id:4, title:'홀덤 매트 (200x100)', price:'30,000', region:'동래', time:'2일 전',
      bg:'linear-gradient(135deg,#4338ca,#1e3a8a)', emoji:'🟢', chat:0, like:5, state:null },
    { id:5, title:'딜러 의자 + 테이블 의자 4', price:'180,000', region:'화명동', time:'3일 전',
      bg:'linear-gradient(135deg,#a78bfa,#7c3aed)', emoji:'🪑', chat:2, like:11, state:null },
    { id:6, title:'WSOP 사진 액자 (오리지널)', price:'15,000', region:'사상', time:'1주일 전',
      bg:'linear-gradient(135deg,#f59e0b,#92400e)', emoji:'🖼', chat:0, like:1, state:'완료' },
  ];

  return (
    <div>
      {/* 카테고리 chips */}
      <div className="no-scrollbar" style={{ display:'flex', gap:6, padding:'8px 14px 12px', overflowX:'auto', background:'var(--bg)' }}>
        {['전체','🃏 카드/덱','🎰 칩셋','🤖 셔플러','🪑 의자/테이블','🟢 매트','📚 책/굿즈'].map((f, i) => (
          <button key={f} className="tap" style={{
            flexShrink:0, padding:'5px 12px', borderRadius:99, fontSize:11, fontWeight:700,
            border: i === 0 ? 'none' : '1px solid var(--border)',
            background: i === 0 ? 'var(--brand)' : 'var(--bg)',
            color: i === 0 ? '#fff' : 'var(--text-1)',
            cursor:'pointer', whiteSpace:'nowrap',
          }}>{f}</button>
        ))}
      </div>

      <div style={{ padding:'0 14px 16px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div style={{ fontSize:13, fontWeight:900, letterSpacing:'-.015em' }}>🛒 거래 {items.length}건</div>
          <button className="tap" style={{ fontSize:11, fontWeight:700, background:'transparent', border:'none', color:'var(--text-2)', cursor:'pointer' }}>최신순 ▾</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {items.map(it => (
            <article key={it.id} className="lift tap" style={{
              borderRadius:12, background:'var(--bg)',
              border:'1px solid var(--border)', overflow:'hidden',
              cursor:'pointer',
            }}>
              <div style={{
                aspectRatio:'1/1', position:'relative',
                background:it.bg,
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:42,
              }}>
                <span style={{ filter:'drop-shadow(0 4px 12px rgba(0,0,0,.25))' }}>{it.emoji}</span>

                {it.hot && (
                  <span style={{
                    position:'absolute', top:6, left:6,
                    fontSize:9, fontWeight:900, padding:'2px 6px',
                    background:'rgba(229,62,62,.95)', color:'#fff',
                    borderRadius:5, letterSpacing:'.04em',
                    boxShadow:'0 2px 6px rgba(0,0,0,.2)',
                  }}>🔥 HOT</span>
                )}

                {it.state && (
                  <div style={{
                    position:'absolute', inset:0,
                    background:'rgba(0,0,0,.55)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                  }}>
                    <span style={{
                      padding:'3px 10px', borderRadius:6,
                      background: it.state === '예약중' ? '#F59E0B' : 'rgba(255,255,255,.25)',
                      color:'#fff', fontSize:11, fontWeight:800,
                      backdropFilter:'blur(4px)', letterSpacing:'.04em',
                    }}>{it.state}</span>
                  </div>
                )}

                <button className="tap" style={{
                  position:'absolute', top:6, right:6,
                  width:28, height:28, borderRadius:99,
                  background:'rgba(0,0,0,.35)', border:'none', cursor:'pointer',
                  color:'#fff', display:'flex', alignItems:'center', justifyContent:'center',
                  backdropFilter:'blur(6px)',
                }} aria-label="찜">
                  {Icons.star(14)}
                </button>
              </div>
              <div style={{ padding:'10px 11px 11px' }}>
                <div style={{ fontSize:11.5, fontWeight:700, letterSpacing:'-.01em', lineHeight:1.35, color:'var(--text-1)', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden', minHeight:28 }}>{it.title}</div>
                <div className="mono" style={{ fontSize:14, fontWeight:900, marginTop:4, color: it.state === '완료' ? 'var(--text-3)' : 'var(--text-1)', textDecoration: it.state === '완료' ? 'line-through' : 'none' }}>
                  {it.price}원
                </div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:5 }}>
                  <div style={{ fontSize:10, color:'var(--text-2)', display:'flex', alignItems:'center', gap:3 }}>
                    <span style={{ color:'var(--brand)' }}>{Icons.pin(9)}</span>
                    {it.region} · <span className="mono">{it.time}</span>
                  </div>
                  <div style={{ display:'flex', gap:6, alignItems:'center', fontSize:9, color:'var(--text-3)', fontWeight:700 }}>
                    <span style={{ display:'flex', alignItems:'center', gap:1 }}>💬{it.chat}</span>
                    <span style={{ display:'flex', alignItems:'center', gap:1 }}>♡ {it.like}</span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CommunityScreen });
