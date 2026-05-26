// screens-user.jsx — 01. 사용자 앱 (/m/*) — 탭 전환되는 통합 phone

const { useState: useStateU, useEffect: useEffectU, useMemo: useMemoU } = React;

// ── 헤더 (모든 화면 상단 공통, 변형 가능) ─────────────────
function UserHeader({ title, location = '부산 화명동', showHome = true, onBack }) {
  if (!showHome && title) {
    return (
      <header style={{
        height:52, padding:'0 12px', display:'flex', alignItems:'center', gap:8,
        borderBottom:'1px solid var(--border)', background:'var(--bg)',
        position:'sticky', top:0, zIndex:10,
      }}>
        {onBack && (
          <button onClick={onBack} className="tap" style={{ width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:'none', color:'var(--text-1)' }}>
            {Icons.back()}
          </button>
        )}
        <div style={{ flex:1, fontSize:16, fontWeight:800, letterSpacing:'-.01em' }}>{title}</div>
      </header>
    );
  }
  return (
    <header style={{
      height:64, padding:'0 14px', display:'flex', alignItems:'center', gap:10,
      borderBottom:'1px solid var(--border)', background:'var(--bg)',
      position:'sticky', top:0, zIndex:10,
    }}>
      <div style={{ flexShrink:0 }}><RabbitLogo size={42} variant="badge" /></div>
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', lineHeight:1.1 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'var(--text-1)' }}>호코님 환영합니다</div>
        <button className="tap" style={{ display:'flex', alignItems:'center', gap:2, marginTop:3, background:'transparent', border:'none', padding:0, color:'var(--text-2)', cursor:'pointer' }}>
          <span style={{ color:'var(--brand)' }}>{Icons.pin(10)}</span>
          <span style={{ fontSize:11, fontWeight:600 }}>{location}</span>
          <span style={{ marginLeft:1, color:'var(--text-3)' }}>{Icons.chevDown(10)}</span>
        </button>
      </div>
      <button className="tap" style={{ width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:'none', color:'var(--text-1)', borderRadius:99, cursor:'pointer' }}>{Icons.search(18)}</button>
      <button className="tap" style={{ width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:'none', color:'var(--text-1)', borderRadius:99, position:'relative', cursor:'pointer' }}>
        {Icons.bell(18)}
        <span style={{ position:'absolute', top:8, right:9, width:6, height:6, borderRadius:99, background:'var(--brand)' }} />
      </button>
    </header>
  );
}

// ── 하단 탭바 (제어형) ────────────────────────────────────
function UserTabbar({ active, onChange }) {
  const tabs = [
    { id:'home', label:'홈', icon:Icons.home },
    { id:'find', label:'매장찾기', icon:Icons.map },
    { id:'posts', label:'채팅방', icon:Icons.chat, badge:true },
    { id:'calendar', label:'캘린더', icon:Icons.calendar },
    { id:'my', label:'마이', icon:Icons.user },
  ];
  return (
    <nav style={{
      position:'sticky', bottom:0, background:'var(--bg)',
      borderTop:'1px solid var(--border)',
      padding:'8px 6px env(safe-area-inset-bottom)', display:'flex', justifyContent:'space-around',
    }}>
      {tabs.map(t => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="tabbar-item"
            style={{
              background:'transparent', border:'none', cursor:'pointer',
              display:'flex', flexDirection:'column', alignItems:'center', gap:2,
              padding:'4px 10px', borderRadius:99,
              color: isActive ? '#fff' : 'var(--text-2)',
              backgroundColor: isActive ? 'var(--brand)' : 'transparent',
              transition:'background .15s ease, color .15s ease',
              position:'relative',
            }}>
            <span style={{ position:'relative' }}>
              {t.icon(17, isActive)}
              {t.badge && !isActive && (
                <span style={{ position:'absolute', top:-2, right:-3, width:5, height:5, borderRadius:99, background:'var(--brand)' }} />
              )}
            </span>
            <span style={{ fontSize:10, fontWeight:800, letterSpacing:'-.01em' }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ──────────────────────────────────────────────────────
// 화면 1: 홈
// ──────────────────────────────────────────────────────
function ScreenHome({ onOpenStore, onOpenLive }) {
  const newsCards = [
    { bg:'#FFE4F1', border:'#FFC9DE', emoji:'🃏', store:'화명동 깜깜이 펍', time:'5분 전', title:'오늘 밤 9시 30T 데일리 OPEN!', body:'바이인 3만 · GTD 100만 · 리바이 무제한', tags:['#데일리','#30T'] },
    { bg:'#FFF4C2', border:'#F0D97A', emoji:'🎰', store:'서면 로얄홀덤', time:'23분 전', title:'금토일 시리즈 ROYAL CUP 100만 GTD', body:'5/24~5/26 · 6Day · 토너 일정 확인하세요', tags:['#시리즈'] },
    { bg:'#D6F0FF', border:'#9DD6F5', emoji:'🥃', store:'김해 BLUE CHIP', time:'1시간 전', title:'신규 딜러 모집중 — 주말 시급 협의', body:'경력 1년 이상 우대', tags:['#딜러'] },
  ];
  const youtubers = [
    { name:'홀덤스코프', grad:'linear-gradient(135deg,#fb7185,#ef4444)' },
    { name:'포커브레인', grad:'linear-gradient(135deg,#3b82f6,#4338ca)' },
    { name:'부산딜러', grad:'linear-gradient(135deg,#10b981,#047857)' },
    { name:'에이스킹', grad:'linear-gradient(135deg,#fbbf24,#d97706)' },
    { name:'노리밋박', grad:'linear-gradient(135deg,#a855f7,#db2777)' },
  ];
  return (
    <div>
      <UserHeader />

      {/* 오늘의 매장 소식 carousel */}
      <section style={{ padding:'16px 0 0' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', marginBottom:10 }}>
          <div style={{ fontSize:15, fontWeight:900, letterSpacing:'-.015em' }}>💬 오늘의 매장 소식</div>
          <button className="tap" style={{ background:'transparent', border:'none', fontSize:12, fontWeight:800, color:'var(--brand)', cursor:'pointer' }}>전체 →</button>
        </div>
        <div className="no-scrollbar" style={{ display:'flex', gap:10, overflowX:'auto', padding:'0 16px 6px' }}>
          {newsCards.map((c, i) => (
            <div key={i} className="lift" style={{
              flexShrink:0, width:260, borderRadius:16, padding:14,
              background:c.bg, border:`1px solid ${c.border}`, cursor:'pointer',
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <div style={{ width:28, height:28, borderRadius:99, background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>{c.emoji}</div>
                <div style={{ fontSize:12, fontWeight:800, letterSpacing:'-.01em' }}>{c.store}</div>
                <span className="mono" style={{ marginLeft:'auto', fontSize:10, color:'rgba(0,0,0,.45)' }}>{c.time}</span>
              </div>
              <div style={{ fontSize:13, fontWeight:800, lineHeight:1.35, marginBottom:4, letterSpacing:'-.015em', color:'#111827' }}>{c.title}</div>
              <div style={{ fontSize:11, color:'rgba(0,0,0,.65)', lineHeight:1.5 }}>{c.body}</div>
              <div style={{ display:'flex', gap:4, marginTop:8 }}>
                {c.tags.map(t => <span key={t} style={{ fontSize:10, fontWeight:800, padding:'2px 6px', borderRadius:5, background:'#fff', color:'#111827' }}>{t}</span>)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 그라데이션 디바이더 */}
      <div style={{ height:6, background:'linear-gradient(90deg, #FFCEE3, #FFE8F2, #FFCEE3)', margin:'16px 0' }} />

      {/* 본사 광고 */}
      <section style={{ padding:'0 16px' }}>
        <div className="lift tap" style={{
          aspectRatio:'16/9', borderRadius:16, position:'relative', overflow:'hidden',
          background:'linear-gradient(135deg,#1F2937,#FF1F8F)',
          display:'flex', alignItems:'center', justifyContent:'center',
          color:'#fff',
        }}>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:'.16em', opacity:.7 }}>SPONSORED</div>
            <div style={{ fontSize:18, fontWeight:900, marginTop:4, letterSpacing:'-.02em' }}>홀덤킹 KOREA TOUR 2026</div>
            <div style={{ fontSize:11, opacity:.85, marginTop:2 }}>서울 · 부산 · 1억 GTD · 등록 OPEN</div>
          </div>
          <div style={{ position:'absolute', top:8, right:8, fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:4, background:'rgba(0,0,0,.4)', color:'#fff' }}>광고</div>
        </div>
      </section>

      {/* LIVE 진행중 (홈에서 빠른 진입) */}
      <section style={{ padding:'18px 16px 0' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <LiveBadge label="HOT LIVE" />
          <span style={{ fontSize:12, fontWeight:700, color:'var(--text-2)' }}>지금 진행중 6곳</span>
          <button onClick={onOpenLive} className="tap" style={{ marginLeft:'auto', background:'transparent', border:'none', fontSize:12, fontWeight:800, color:'var(--brand)', cursor:'pointer' }}>전체 →</button>
        </div>
        <div className="lift tap" onClick={() => onOpenStore && onOpenStore('hwamyeong')} style={{
          borderRadius:18, overflow:'hidden',
          border:'1px solid #FECDD3',
          boxShadow:'var(--shadow-float)',
        }}>
          <div style={{
            aspectRatio:'16/10', position:'relative',
            background:'linear-gradient(135deg,#9F1239,#BE185D,#831843)',
          }}>
            <div style={{ position:'absolute', top:10, left:10 }}><LiveBadge /></div>
            <div style={{ position:'absolute', bottom:10, left:12, right:12, color:'#fff' }}>
              <div style={{ fontSize:10, fontWeight:700, opacity:.85 }}>화명동 깜깜이 펍 · 부산</div>
              <div style={{ fontSize:18, fontWeight:900, lineHeight:1.15, letterSpacing:'-.02em' }}>데일리 히든에이스 30T</div>
              <div className="mono" style={{ display:'flex', gap:14, marginTop:4, fontSize:11, fontWeight:700 }}>
                <span>⏱ 09:14</span>
                <span>Lv 6 · 1k/2k</span>
                <span>👥 24/30</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 인기 유튜브 */}
      <section style={{ padding:'18px 0 0', borderTop:'1px solid var(--border)', marginTop:18 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px 10px' }}>
          <div style={{ fontSize:15, fontWeight:900, letterSpacing:'-.015em' }}>▶️ 인기 유튜브</div>
          <button className="tap" style={{ background:'transparent', border:'none', fontSize:12, fontWeight:800, color:'var(--brand)', cursor:'pointer' }}>전체 →</button>
        </div>
        <div className="no-scrollbar" style={{ display:'flex', gap:10, overflowX:'auto', padding:'0 16px 6px' }}>
          {[
            { grad:'linear-gradient(135deg,#dc2626,#7f1d1d)', title:'사이드폿 ALL-IN 3연속! 메인이벤트 하이라이트', meta:'홀덤스코프 · 12만회', dur:'12:34' },
            { grad:'linear-gradient(135deg,#4338ca,#db2777)', title:'초보를 위한 GTO 입문 1편', meta:'포커브레인 · 7만회', dur:'08:21' },
            { grad:'linear-gradient(135deg,#047857,#064e3b)', title:'부산 펍 가이드 — 화명동 vs 서면', meta:'부산딜러 · 5만회', dur:'15:02' },
          ].map((v, i) => (
            <div key={i} className="tap" style={{ flexShrink:0, width:200 }}>
              <div style={{ aspectRatio:'16/9', borderRadius:12, background:v.grad, position:'relative', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <div style={{ width:42, height:42, borderRadius:99, background:'rgba(255,255,255,.95)', display:'flex', alignItems:'center', justifyContent:'center', color:'#111827' }}>{Icons.play(14)}</div>
                <span className="mono" style={{ position:'absolute', bottom:6, right:6, fontSize:10, fontWeight:700, color:'#fff', background:'rgba(0,0,0,.7)', padding:'1px 5px', borderRadius:4 }}>{v.dur}</span>
              </div>
              <div style={{ fontSize:12, fontWeight:700, marginTop:8, lineHeight:1.35, letterSpacing:'-.01em', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{v.title}</div>
              <div style={{ fontSize:10, color:'var(--text-2)', marginTop:3 }}>{v.meta}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 인기 유튜버 */}
      <section style={{ padding:'18px 0 0', borderTop:'1px solid var(--border)', marginTop:18 }}>
        <div style={{ padding:'14px 16px 10px', fontSize:15, fontWeight:900, letterSpacing:'-.015em' }}>🎙️ 인기 유튜버</div>
        <div className="no-scrollbar" style={{ display:'flex', gap:14, overflowX:'auto', padding:'0 16px 8px' }}>
          {youtubers.map(y => (
            <div key={y.name} className="tap" style={{ flexShrink:0, width:60, display:'flex', flexDirection:'column', alignItems:'center' }}>
              <div style={{ width:56, height:56, borderRadius:99, background:y.grad, border:'2px solid var(--bg)', boxShadow:'var(--shadow-card)' }} />
              <span style={{ fontSize:11, fontWeight:700, marginTop:6, color:'var(--text-1)' }}>{y.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 하단 광고 */}
      <section style={{ padding:'18px 16px', borderTop:'1px solid var(--border)', marginTop:18 }}>
        <div className="lift tap" style={{
          borderRadius:18, padding:18, color:'#fff', position:'relative',
          background:'linear-gradient(135deg,#F59E0B,#E53E3E)',
        }}>
          <span style={{ fontSize:10, fontWeight:800, letterSpacing:'.18em', opacity:.85 }}>SPONSORED</span>
          <div style={{ fontSize:16, fontWeight:900, marginTop:4 }}>매장 사장님!</div>
          <div style={{ fontSize:12, opacity:.92, marginTop:2 }}>Pink Rabbit 광고로 평일 매출 40% UP</div>
          <button className="tap" style={{ marginTop:12, fontSize:11, fontWeight:800, background:'#fff', color:'#E53E3E', padding:'6px 12px', borderRadius:99, border:'none', cursor:'pointer' }}>광고 신청 →</button>
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 화면 2: 매장찾기 (검색 + 필터 + 리스트)
// ──────────────────────────────────────────────────────
function ScreenFind({ onOpenStore }) {
  const [q, setQ] = useStateU('');
  const [filter, setFilter] = useStateU('전체');
  const [favs, setFavs] = useStateU(new Set(['blue']));

  const stores = [
    { id:'hwamyeong', rank:1, emoji:'🃏', grad:'linear-gradient(135deg,#fb7185,#ef4444)', name:'화명동 깜깜이 펍', region:'부산 화명동', km:'1.2km', star:4.8, live:true, tags:['데일리'] },
    { id:'royal', rank:2, emoji:'🎰', grad:'linear-gradient(135deg,#fbbf24,#ea580c)', name:'서면 로얄홀덤', region:'부산 서면', km:'4.5km', star:4.7, live:true, tags:['시리즈'] },
    { id:'blue', rank:3, emoji:'🥃', grad:'linear-gradient(135deg,#60a5fa,#4338ca)', name:'김해 BLUE CHIP', region:'김해 외동', km:'8.3km', star:4.6, live:false, tags:['신규'], badge:'NEW' },
    { id:'ace', rank:4, emoji:'🎲', grad:'linear-gradient(135deg,#a78bfa,#7c3aed)', name:'동래 ACE KING', region:'부산 동래', km:'5.7km', star:4.5, live:false, tags:['평일'] },
  ];

  const filtered = stores.filter(s => {
    if (filter === '🔴 LIVE' && !s.live) return false;
    if (filter === '🆕 신규' && s.badge !== 'NEW') return false;
    if (filter === '⭐ 즐겨찾기' && !favs.has(s.id)) return false;
    if (q && !s.name.includes(q) && !s.region.includes(q)) return false;
    return true;
  });

  const toggleFav = (id) => {
    setFavs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <UserHeader title="매장찾기" showHome={false} />

      {/* 토글: 리스트/지도 + 검색 */}
      <div style={{ padding:'12px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
          <div style={{ background:'var(--surface-2)', borderRadius:99, padding:3, display:'flex', flex:1 }}>
            <span style={{ padding:'6px 12px', borderRadius:99, background:'var(--bg)', boxShadow:'var(--shadow-card)', fontSize:11, fontWeight:800 }}>리스트</span>
            <span style={{ padding:'6px 12px', borderRadius:99, fontSize:11, fontWeight:800, color:'var(--text-2)' }}>지도</span>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surface-2)', borderRadius:12, padding:'0 12px', height:40 }}>
          <span style={{ color:'var(--text-2)' }}>{Icons.search(16)}</span>
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="매장명·지역·토너명"
            style={{ background:'transparent', border:'none', outline:'none', flex:1, fontSize:13, color:'var(--text-1)', fontFamily:'inherit' }}
          />
          {q && <button onClick={() => setQ('')} className="tap" style={{ background:'transparent', border:'none', color:'var(--text-2)', cursor:'pointer', fontSize:14 }}>✕</button>}
        </div>
        <div className="no-scrollbar" style={{ display:'flex', gap:6, marginTop:10, overflowX:'auto' }}>
          {['전체','🔴 LIVE','🆕 신규','⭐ 즐겨찾기','📍 가까운순'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className="tap" style={{
              flexShrink:0, padding:'5px 12px', borderRadius:99, fontSize:11, fontWeight:700,
              border: filter === f ? 'none' : '1px solid var(--border)',
              background: filter === f ? 'var(--brand)' : 'var(--bg)',
              color: filter === f ? '#fff' : 'var(--text-1)',
              cursor:'pointer',
            }}>{f}</button>
          ))}
        </div>
      </div>

      {/* HOT LIVE Hero */}
      <section style={{ padding:'14px 16px 0' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <LiveBadge label="HOT LIVE" />
          <span style={{ fontSize:12, fontWeight:700, color:'var(--text-2)' }}>지금 진행중 {stores.filter(s=>s.live).length}곳</span>
        </div>
        <div onClick={() => onOpenStore && onOpenStore('hwamyeong')} className="lift tap" style={{
          borderRadius:18, overflow:'hidden', border:'1px solid #FECDD3', boxShadow:'var(--shadow-float)',
        }}>
          <div style={{ aspectRatio:'16/10', background:'linear-gradient(135deg,#9F1239,#BE185D,#581C87)', position:'relative' }}>
            <div style={{ position:'absolute', top:10, left:10 }}><LiveBadge /></div>
            <div style={{ position:'absolute', bottom:10, left:12, right:12, color:'#fff' }}>
              <div style={{ fontSize:10, fontWeight:700, opacity:.85 }}>화명동 깜깜이 펍 · 부산</div>
              <div style={{ fontSize:17, fontWeight:900, letterSpacing:'-.02em', lineHeight:1.15 }}>데일리 히든에이스 30T</div>
              <div className="mono" style={{ display:'flex', gap:12, marginTop:4, fontSize:11, fontWeight:700 }}>
                <span>⏱ 09:14</span><span>Lv 6 · 1k/2k</span><span>👥 24/30</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 카테고리 */}
      <section style={{ padding:'18px 16px 0' }}>
        <div style={{ fontSize:14, fontWeight:900, marginBottom:10, letterSpacing:'-.015em' }}>⚡ 카테고리</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, textAlign:'center' }}>
          {[
            { e:'🃏', l:'데일리 토너' },
            { e:'🏆', l:'시리즈' },
            { e:'🎰', l:'새틀라이트' },
            { e:'🥃', l:'캐쉬게임' },
          ].map(c => (
            <button key={c.l} className="tap" style={{ background:'transparent', border:'none', cursor:'pointer', padding:0 }}>
              <div style={{ width:48, height:48, borderRadius:14, background:'var(--brand-pale)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, margin:'0 auto' }}>{c.e}</div>
              <div style={{ fontSize:10, fontWeight:700, marginTop:5, color:'var(--text-1)' }}>{c.l}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 인기 매장 리스트 */}
      <section style={{ padding:'18px 16px 24px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div style={{ fontSize:14, fontWeight:900, letterSpacing:'-.015em' }}>🔥 인기 매장 {filter !== '전체' && <span style={{ fontSize:11, fontWeight:700, color:'var(--text-2)', marginLeft:6 }}>· {filter} {filtered.length}곳</span>}</div>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding:'30px 16px', textAlign:'center', color:'var(--text-2)', fontSize:12 }}>
            검색 결과가 없습니다
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {filtered.map(s => (
              <div key={s.id} onClick={() => onOpenStore && onOpenStore(s.id)} className="lift tap" style={{
                display:'flex', alignItems:'center', gap:12, padding:12, borderRadius:14,
                border:'1px solid var(--border)', background:'var(--bg)',
              }}>
                <div style={{ width:54, height:54, borderRadius:14, background:s.grad, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>{s.emoji}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:10, fontWeight:800, color:'#fff', padding:'1px 5px', borderRadius:4, background:'var(--brand)' }}>{s.rank}</span>
                    <div style={{ fontSize:13, fontWeight:800, letterSpacing:'-.01em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.name}</div>
                    {s.live && <LiveBadge size="sm" />}
                    {s.badge && <span style={{ fontSize:10, fontWeight:800, padding:'1px 5px', borderRadius:4, background:'var(--brand-pale)', color:'var(--brand)' }}>🆕 {s.badge}</span>}
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-2)', marginTop:3 }}>{s.region} · {s.km} · ⭐ {s.star}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); toggleFav(s.id); }} className="tap" style={{ background:'transparent', border:'none', cursor:'pointer', color: favs.has(s.id) ? 'var(--brand)' : 'var(--text-3)' }}>
                  {Icons.star(20, favs.has(s.id))}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 화면 3: 채팅방 (오늘의 매장 소식 ASC)
// ──────────────────────────────────────────────────────
function ScreenPosts() {
  const messages = [
    { type:'divider', label:'오늘 20:00' },
    { type:'msg', emoji:'🃏', store:'화명동 깜깜이 펍', meta:'1.2km · 5분 전', bg:'#FFE4F1', border:'#FFC9DE',
      title:'오늘 밤 9시 30T 데일리 OPEN!',
      body:'바이인 3만 · GTD 100만 · 리바이 무제한\n늦참 1레벨까지 가능합니다 🎲',
      tags:['#데일리','#30T'] },
    { type:'msg', emoji:'🎰', store:'서면 로얄홀덤', meta:'4.5km · 22분 전', bg:'#FFF4C2', border:'#F0D97A',
      image:'linear-gradient(135deg,#fbbf24,#eab308)', imageEmoji:'🏆',
      title:'ROYAL CUP 6Day · 100만 GTD',
      body:'5/24~5/26 · Day1 ABCD 진행', tags:[] },
    { type:'divider', label:'오늘 20:30' },
    { type:'msg', emoji:'🥃', store:'김해 BLUE CHIP', meta:'8.3km · 방금', bg:'#D6F0FF', border:'#9DD6F5',
      title:'신규 딜러 모집 · 주말 시급 협의',
      body:'경력 1년 이상 우대 · 카톡 오픈채팅 문의', tags:['#딜러'] },
    { type:'msg', emoji:'🎲', store:'동래 ACE KING', meta:'5.7km · 1시간 전', bg:'#E1D8FF', border:'#C4B5FD',
      title:'평일 30T 매주 화/목 진행중',
      body:'바이인 2만 · 워밍업으로 좋아요', tags:['#평일'] },
  ];
  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
      {/* header */}
      <header style={{
        height:52, padding:'0 12px', display:'flex', alignItems:'center', gap:8,
        borderBottom:'1px solid var(--border)', background:'var(--bg)',
        position:'sticky', top:0, zIndex:10,
      }}>
        <button className="tap" style={{ width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:'none', color:'var(--text-1)' }}>
          {Icons.back()}
        </button>
        <div style={{ flex:1, fontSize:16, fontWeight:800, letterSpacing:'-.01em' }}>오늘의 매장 소식</div>
        <button className="pill" style={{ background:'var(--surface-2)', cursor:'pointer' }}>{Icons.pin(11)} 10km {Icons.chevDown(10)}</button>
      </header>

      {/* 본사 pinned */}
      <div style={{ padding:'10px 12px', background:'rgba(255,31,143,.05)' }}>
        <div style={{
          borderRadius:12, padding:'10px 12px',
          background:'linear-gradient(135deg,rgba(255,31,143,.10),rgba(255,31,143,.02))',
          border:'1px solid rgba(255,31,143,.22)',
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
            <span style={{ fontSize:9, fontWeight:800, padding:'1px 6px', borderRadius:4, background:'var(--brand)', color:'#fff', letterSpacing:'.04em' }}>공지</span>
            <span style={{ fontSize:12, fontWeight:800, color:'var(--text-1)', letterSpacing:'-.01em' }}>Pink Rabbit 6월 신규매장 모집중</span>
          </div>
          <div style={{ fontSize:11, color:'var(--text-2)', lineHeight:1.5 }}>부산·경남 5곳 한정 · 6월 1일까지 입점 신청 시 광고 1개월 무료</div>
        </div>
      </div>

      {/* messages */}
      <div className="no-scrollbar" style={{ flex:1, overflowY:'auto', padding:'8px 12px 16px', background:'var(--bg)' }}>
        {messages.map((m, i) => {
          if (m.type === 'divider') {
            return (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:8, margin:'10px 0' }}>
                <div style={{ flex:1, height:1, background:'var(--border)' }} />
                <div style={{ fontSize:10, fontWeight:700, padding:'2px 10px', borderRadius:99, color:'var(--text-2)', background:'var(--surface-2)', border:'1px solid var(--border)' }}>{m.label}</div>
                <div style={{ flex:1, height:1, background:'var(--border)' }} />
              </div>
            );
          }
          return (
            <div key={i} style={{ display:'flex', gap:8, marginBottom:12 }}>
              <div style={{ width:36, height:36, borderRadius:99, background:m.bg, border:`1px solid ${m.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>{m.emoji}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                  <span style={{ fontSize:11, fontWeight:800, letterSpacing:'-.01em' }}>{m.store}</span>
                  <span style={{ fontSize:10, color:'var(--text-3)' }}>· {m.meta}</span>
                </div>
                <div style={{
                  borderRadius:'14px 14px 14px 4px',
                  background:m.bg, border:`1px solid ${m.border}`,
                  overflow:'hidden', display:'inline-block', maxWidth:'100%',
                }}>
                  {m.image && (
                    <div style={{ aspectRatio:'4/3', background:m.image, display:'flex', alignItems:'center', justifyContent:'center', fontSize:42 }}>{m.imageEmoji}</div>
                  )}
                  <div style={{ padding:'10px 12px' }}>
                    <div style={{ fontSize:13, fontWeight:800, lineHeight:1.35, letterSpacing:'-.015em', color:'#111827' }}>{m.title}</div>
                    {m.body && <div style={{ fontSize:12, color:'rgba(0,0,0,.7)', marginTop:4, lineHeight:1.5, whiteSpace:'pre-line' }}>{m.body}</div>}
                    {m.tags && m.tags.length > 0 && (
                      <div style={{ display:'flex', gap:4, marginTop:6 }}>
                        {m.tags.map(t => <span key={t} style={{ fontSize:10, fontWeight:800, padding:'2px 6px', borderRadius:5, background:'#fff', color:'#111827' }}>{t}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 화면 4: 캘린더
// ──────────────────────────────────────────────────────
function ScreenCalendar() {
  const [selected, setSelected] = useStateU(25);
  const dotDays = { 1:1, 4:1, 7:1, 11:1, 18:1, 24:2, 25:1, 28:1 }; // 1=brand, 2=gold
  const days = Array.from({ length:31 }, (_,i) => i+1);
  // 5/1 is Friday in 2026 (offset 5)
  const offset = 5;

  return (
    <div>
      <UserHeader title="📅 토너 캘린더" showHome={false} />
      <section style={{ padding:'14px 16px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <button className="tap" style={{ background:'transparent', border:'none', fontSize:18, color:'var(--text-2)', cursor:'pointer' }}>‹</button>
          <div style={{ fontSize:16, fontWeight:900, letterSpacing:'-.02em' }}>2026년 5월</div>
          <button className="tap" style={{ background:'transparent', border:'none', fontSize:18, color:'var(--text-2)', cursor:'pointer' }}>›</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:4, textAlign:'center' }}>
          {['일','월','화','수','목','금','토'].map((w, i) => (
            <div key={w} style={{ fontSize:10, fontWeight:800, color: i === 0 ? '#E53E3E' : i === 6 ? '#3B82F6' : 'var(--text-3)', padding:'4px 0' }}>{w}</div>
          ))}
          {Array.from({ length: offset }).map((_,i) => <div key={'p'+i} />)}
          {days.map(d => {
            const isSel = selected === d;
            const dot = dotDays[d];
            const isWeekend = ((d + offset - 1) % 7) === 0 || ((d + offset - 1) % 7) === 6;
            return (
              <button key={d} onClick={() => setSelected(d)} className="tap" style={{
                aspectRatio:'1/1', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                borderRadius:8, border:'none', cursor:'pointer',
                background: isSel ? 'var(--brand)' : 'transparent',
                color: isSel ? '#fff' : (isWeekend ? (((d+offset-1)%7)===0?'#E53E3E':'#3B82F6') : 'var(--text-1)'),
                fontSize:13, fontWeight: isSel ? 800 : 600,
                position:'relative',
              }}>
                {d}
                {dot && !isSel && (
                  <span style={{ width:4, height:4, borderRadius:99, background: dot === 1 ? 'var(--brand)' : 'var(--gold)', marginTop:2 }} />
                )}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop:18 }}>
          <div style={{ fontSize:12, fontWeight:800, color:'var(--text-2)', marginBottom:10 }}>오늘 5/{selected} · 3건</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {[
              { time:'21:00', region:'화명', title:'데일리 히든에이스 30T', meta:'바이인 3만 · 100만 GTD', live:true },
              { time:'22:30', region:'서면', title:'ROYAL CUP 1Day', meta:'바이인 5만', live:false },
              { time:'23:00', region:'김해', title:'평일 새틀라이트', meta:'바이인 1만', live:false },
            ].map((e, i) => (
              <div key={i} className="lift" style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px', borderRadius:12, border:'1px solid var(--border)', background:'var(--bg)' }}>
                <div style={{ textAlign:'center', width:46 }}>
                  <div className="mono" style={{ fontSize:13, fontWeight:800 }}>{e.time}</div>
                  <div style={{ fontSize:9, color:'var(--text-3)' }}>{e.region}</div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:800, letterSpacing:'-.01em' }}>{e.title}</div>
                  <div style={{ fontSize:10, color:'var(--text-2)', marginTop:2 }}>{e.meta}</div>
                </div>
                {e.live ? <LiveBadge size="sm" /> : (
                  <button className="tap" style={{ fontSize:10, fontWeight:800, padding:'4px 10px', borderRadius:6, background:'var(--surface-2)', border:'none', cursor:'pointer', color:'var(--text-1)' }}>예약</button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 화면 5: 마이
// ──────────────────────────────────────────────────────
function ScreenMy() {
  return (
    <div>
      <UserHeader title="마이" showHome={false} />
      <section style={{ padding:'18px 16px' }}>
        {/* 프로필 카드 */}
        <div style={{ background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)', borderRadius:18, padding:'18px 16px', color:'#fff', position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:-20, right:-20, opacity:.18 }}><RabbitLogo size={140} variant="mark" /></div>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:54, height:54, borderRadius:99, background:'rgba(255,255,255,.25)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24 }}>🦊</div>
            <div>
              <div style={{ fontSize:17, fontWeight:900, letterSpacing:'-.02em' }}>호코</div>
              <div style={{ fontSize:11, opacity:.85, marginTop:2 }}>부산 화명동 · 가입 168일째</div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, marginTop:14, position:'relative' }}>
            <div style={{ background:'rgba(255,255,255,.18)', borderRadius:12, padding:'8px 0', textAlign:'center' }}>
              <div className="mono" style={{ fontSize:18, fontWeight:800 }}>23</div>
              <div style={{ fontSize:9, opacity:.85, marginTop:2 }}>참여 토너</div>
            </div>
            <div style={{ background:'rgba(255,255,255,.18)', borderRadius:12, padding:'8px 0', textAlign:'center' }}>
              <div className="mono" style={{ fontSize:18, fontWeight:800 }}>7</div>
              <div style={{ fontSize:9, opacity:.85, marginTop:2 }}>입상</div>
            </div>
            <div style={{ background:'rgba(255,255,255,.18)', borderRadius:12, padding:'8px 0', textAlign:'center' }}>
              <div className="mono" style={{ fontSize:18, fontWeight:800 }}>12</div>
              <div style={{ fontSize:9, opacity:.85, marginTop:2 }}>즐겨찾기</div>
            </div>
          </div>
        </div>

        {/* 메뉴 리스트 */}
        <div style={{ marginTop:18, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
          {[
            { e:'📅', label:'내 예약', sub:'2건', warn:true },
            { e:'⭐', label:'즐겨찾기 매장', sub:'12곳' },
            { e:'🎫', label:'쿠폰함', sub:'3장' },
            { e:'📊', label:'토너 기록', sub:null },
            { e:'💬', label:'커뮤니티', sub:null },
          ].map((it, i, arr) => (
            <div key={i} className="tap" style={{
              display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
              cursor:'pointer',
            }}>
              <div style={{ width:36, height:36, borderRadius:10, background:'var(--brand-pale)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>{it.e}</div>
              <div style={{ flex:1, fontSize:13, fontWeight:700, letterSpacing:'-.01em' }}>{it.label}</div>
              {it.sub && <span style={{ fontSize:11, fontWeight:700, color: it.warn ? 'var(--brand)' : 'var(--text-2)' }}>{it.sub}</span>}
              <span style={{ color:'var(--text-3)' }}>{Icons.arrow(14)}</span>
            </div>
          ))}
        </div>

        {/* 설정 */}
        <div style={{ marginTop:14, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
          {[
            { e:'🔔', label:'알림 설정' },
            { e:'⚙️', label:'환경 설정' },
            { e:'📜', label:'약관 및 정책' },
            { e:'🚪', label:'로그아웃' },
          ].map((it, i, arr) => (
            <div key={i} className="tap" style={{
              display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
              cursor:'pointer',
            }}>
              <div style={{ width:32, fontSize:16, textAlign:'center' }}>{it.e}</div>
              <div style={{ flex:1, fontSize:13, fontWeight:600, color:'var(--text-1)' }}>{it.label}</div>
              <span style={{ color:'var(--text-3)' }}>{Icons.arrow(14)}</span>
            </div>
          ))}
        </div>

        <div style={{ textAlign:'center', marginTop:18, fontSize:10, color:'var(--text-3)' }} className="mono">Pink Rabbit BETA v1.0</div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 매장 상세 모달 (phone 위에 슬라이드 업)
// ──────────────────────────────────────────────────────
const STORE_DB = {
  hwamyeong: { name:'화명동 깜깜이 펍', region:'부산 화명동', km:'1.2km', star:4.8, reviews:213, hours:'19:00 ~ 03:00', grad:'linear-gradient(135deg,#9F1239,#BE185D,#581C87)', live:true, tour:'데일리 히든에이스 30T' },
  royal: { name:'서면 로얄홀덤', region:'부산 서면', km:'4.5km', star:4.7, reviews:182, hours:'18:00 ~ 04:00', grad:'linear-gradient(135deg,#fbbf24,#ea580c,#7c2d12)', live:true, tour:'ROYAL CUP Day1' },
  blue: { name:'김해 BLUE CHIP', region:'김해 외동', km:'8.3km', star:4.6, reviews:97, hours:'19:00 ~ 02:00', grad:'linear-gradient(135deg,#60a5fa,#4338ca,#312e81)', live:false, tour:null },
  ace: { name:'동래 ACE KING', region:'부산 동래', km:'5.7km', star:4.5, reviews:154, hours:'20:00 ~ 03:00', grad:'linear-gradient(135deg,#a78bfa,#7c3aed,#581c87)', live:false, tour:'평일 30T' },
};

function StoreDetailModal({ storeId, onClose, onOpenLive }) {
  const store = STORE_DB[storeId] || STORE_DB.hwamyeong;
  return (
    <div style={{
      position:'absolute', inset:0, background:'rgba(0,0,0,.5)',
      zIndex:30, animation:'fadeIn .2s ease',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        position:'absolute', bottom:0, left:0, right:0,
        background:'var(--bg)', borderRadius:'24px 24px 0 0',
        animation:'slideUp .28s cubic-bezier(.2,.8,.2,1)',
        maxHeight:'94%', display:'flex', flexDirection:'column',
        boxShadow:'0 -8px 32px rgba(0,0,0,.3)',
      }}>
        {/* Hero */}
        <div style={{ aspectRatio:'3/2', background:store.grad, borderRadius:'24px 24px 0 0', position:'relative' }}>
          <button onClick={onClose} className="tap" style={{
            position:'absolute', top:12, left:12, width:36, height:36,
            borderRadius:99, background:'rgba(0,0,0,.4)', border:'none',
            color:'#fff', fontSize:18, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            backdropFilter:'blur(8px)',
          }}>{Icons.back(18)}</button>
          <button className="tap" style={{
            position:'absolute', top:12, right:12, width:36, height:36,
            borderRadius:99, background:'rgba(0,0,0,.4)', border:'none',
            color:'#fff', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            backdropFilter:'blur(8px)',
          }}>{Icons.star(18)}</button>
          {store.live && (
            <div style={{ position:'absolute', top:12, left:'50%', transform:'translateX(-50%)' }}>
              <LiveBadge label="LIVE 진행중" />
            </div>
          )}
          <div style={{ position:'absolute', bottom:16, left:16, right:16, color:'#fff' }}>
            <div style={{ fontSize:11, fontWeight:700, opacity:.85 }}>{store.region}</div>
            <div style={{ fontSize:22, fontWeight:900, letterSpacing:'-.025em', lineHeight:1.1 }}>{store.name}</div>
            <div style={{ fontSize:12, marginTop:5, display:'flex', gap:12 }}>
              <span>⭐ {store.star} ({store.reviews})</span>
              <span>🃏 데일리 / 시리즈</span>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="no-scrollbar" style={{ flex:1, overflowY:'auto' }}>
          {/* LIVE 카드 */}
          {store.live && store.tour && (
            <div style={{ padding:'14px 16px', marginTop:-24, position:'relative', zIndex:1 }}>
              <div style={{
                borderRadius:16, background:'var(--bg)', padding:14,
                border:'1px solid #FECDD3', boxShadow:'var(--shadow-float)',
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                  <LiveBadge />
                  <span style={{ fontSize:12, fontWeight:800, color:'var(--text-1)' }}>{store.tour}</span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, textAlign:'center' }}>
                  {[
                    { val:'09:14', label:'남은 시간' },
                    { val:'Lv 6', label:'1k / 2k' },
                    { val:'24/30', label:'참가자' },
                  ].map((s,i) => (
                    <div key={i}>
                      <div className="mono" style={{ fontSize:20, fontWeight:800, color:'var(--text-1)' }}>{s.val}</div>
                      <div style={{ fontSize:10, color:'var(--text-2)', marginTop:2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <button onClick={onOpenLive} className="tap" style={{
                  width:'100%', marginTop:12, padding:'10px 0', borderRadius:12,
                  background:'#E53E3E', color:'#fff', border:'none', cursor:'pointer',
                  fontSize:13, fontWeight:800, letterSpacing:'-.01em',
                }}>LIVE 풀스크린 보기 →</button>
              </div>
            </div>
          )}

          {/* 매장 정보 */}
          <section style={{ padding:'14px 18px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:8, fontSize:13, color:'var(--text-1)' }}>
              <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                <span style={{ width:20, color:'var(--text-2)' }}>📍</span>
                <div>
                  <div>{store.region} OO로 12, 3층</div>
                  <div style={{ fontSize:11, color:'var(--text-2)', marginTop:2 }}>지하철 도보 7분</div>
                </div>
              </div>
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <span style={{ width:20, color:'var(--text-2)' }}>⏰</span>
                <span>매일 {store.hours}</span>
              </div>
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <span style={{ width:20, color:'var(--text-2)' }}>💬</span>
                <a style={{ color:'var(--brand)', fontWeight:800, textDecoration:'none' }}>카카오톡 오픈채팅 →</a>
              </div>
            </div>
          </section>

          {/* 매장 사진 */}
          <section style={{ padding:'12px 18px', borderTop:'1px solid var(--border)' }}>
            <div style={{ fontSize:13, fontWeight:900, marginBottom:8, letterSpacing:'-.015em' }}>📸 매장 사진</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
              {[
                'linear-gradient(135deg,#9ca3af,#4b5563)',
                'linear-gradient(135deg,#fcd34d,#d97706)',
                'linear-gradient(135deg,#818cf8,#6d28d9)',
                'linear-gradient(135deg,#f472b6,#dc2626)',
              ].map((g,i) => (
                <div key={i} style={{ aspectRatio:'1/1', borderRadius:12, background:g }} />
              ))}
            </div>
          </section>

          {/* 예정 토너 */}
          <section style={{ padding:'12px 18px', borderTop:'1px solid var(--border)' }}>
            <div style={{ fontSize:13, fontWeight:900, marginBottom:8, letterSpacing:'-.015em' }}>📅 예정 토너</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {[
                { title:'화요일 30T 데일리', meta:'매주 화 21:00 · 바이인 3만', hot:false },
                { title:'주말 50T 메인이벤트', meta:'5/26 토 19:00 · 바이인 5만 · GTD 300만', hot:true },
              ].map((e,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px', borderRadius:12, background:'var(--surface-2)' }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:800 }}>{e.title}</div>
                    <div style={{ fontSize:10, color:'var(--text-2)', marginTop:2 }}>{e.meta}</div>
                  </div>
                  <button className="tap" style={{
                    padding:'6px 12px', borderRadius:8, fontSize:11, fontWeight:800,
                    color: e.hot ? '#fff' : 'var(--text-1)',
                    background: e.hot ? 'var(--brand)' : 'var(--bg)',
                    border: e.hot ? 'none' : '1px solid var(--border)',
                    cursor:'pointer',
                  }}>예약</button>
                </div>
              ))}
            </div>
          </section>

          {/* 리뷰 미리보기 */}
          <section style={{ padding:'12px 18px 16px', borderTop:'1px solid var(--border)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:900, letterSpacing:'-.015em' }}>⭐ 리뷰 {store.star} ({store.reviews})</div>
              <button className="tap" style={{ background:'transparent', border:'none', fontSize:11, fontWeight:800, color:'var(--brand)', cursor:'pointer' }}>전체 →</button>
            </div>
            <div style={{ padding:'10px 12px', borderRadius:12, background:'var(--surface-2)' }}>
              <div style={{ fontSize:11, color:'var(--text-2)' }}>홀덤러브 · ⭐ 5 · 어제</div>
              <div style={{ fontSize:12, marginTop:4, color:'var(--text-1)', lineHeight:1.5 }}>테이블 좋고 딜러 친절합니다. 데일리 가성비 최고 👍</div>
            </div>
          </section>
        </div>

        {/* 하단 고정 CTA */}
        <div style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', display:'flex', gap:8, background:'var(--bg)' }}>
          <button className="tap" style={{ padding:'12px 16px', borderRadius:12, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text-1)', fontSize:13, fontWeight:800, cursor:'pointer' }}>💬</button>
          <button className="tap" style={{
            flex:1, padding:'12px 0', borderRadius:12, border:'none',
            background:'var(--brand)', color:'#fff', fontSize:14, fontWeight:900,
            cursor:'pointer', boxShadow:'var(--shadow-brand)',
            letterSpacing:'-.01em',
          }}>예약하기</button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// LIVE 풀스크린 모달 (모바일 사용자용 LIVE 뷰)
// ──────────────────────────────────────────────────────
function LiveFullscreenModal({ onClose }) {
  const [breakMode, setBreakMode] = useStateU(false);
  const [seconds, setSeconds] = useStateU(554);

  useEffectU(() => {
    const id = setInterval(() => setSeconds(s => s > 0 ? s - 1 : 600), 1000);
    return () => clearInterval(id);
  }, []);

  useEffectU(() => { setSeconds(breakMode ? 298 : 554); }, [breakMode]);

  const mm = String(Math.floor(seconds/60)).padStart(2,'0');
  const ss = String(seconds%60).padStart(2,'0');

  const bg = breakMode
    ? 'linear-gradient(180deg,#7C2D12,#F59E0B)'
    : '#0F1419';

  return (
    <div style={{
      position:'absolute', inset:0, zIndex:40,
      background:bg, color:'#fff',
      display:'flex', flexDirection:'column',
      animation:'slideUp .28s cubic-bezier(.2,.8,.2,1)',
    }}>
      {/* header */}
      <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,.1)' }}>
        <button onClick={onClose} className="tap" style={{ background:'transparent', border:'none', color:'rgba(255,255,255,.7)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', width:32, height:32 }}>
          {Icons.back(20)}
        </button>
        {breakMode ? <BreakBadge /> : <LiveBadge />}
        <button className="tap" style={{ background:'transparent', border:'none', color:'rgba(255,255,255,.7)', cursor:'pointer', fontSize:16, width:32, height:32 }}>⛶</button>
      </header>

      <div style={{ flex:1, padding:'24px 24px', display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', overflow:'auto' }} className="no-scrollbar">
        <div style={{ fontSize:11, fontWeight:700, opacity:.7 }}>화명동 깜깜이 펍</div>
        <div style={{ fontSize:16, fontWeight:900, marginTop:3, letterSpacing:'-.015em' }}>데일리 히든에이스 30T</div>

        {breakMode ? (
          <>
            <div style={{ fontSize:11, opacity:.85, marginTop:36, letterSpacing:'.16em', fontWeight:800 }}>BREAK</div>
            <div style={{ fontSize:60, marginTop:14, filter:'drop-shadow(0 6px 18px rgba(0,0,0,.3))' }}>☕</div>
            <div className="mono" style={{ fontSize:86, fontWeight:800, lineHeight:1, marginTop:14, textShadow:'0 4px 22px rgba(0,0,0,.35)' }}>{mm}:{ss}</div>
            <div style={{ fontSize:13, opacity:.85, marginTop:10 }}>곧 Lv 7 시작 · <span className="mono" style={{ fontWeight:800 }}>2,000 / 4,000</span></div>
            <div style={{ marginTop:32, padding:'14px 24px', borderRadius:18, background:'rgba(0,0,0,.25)', backdropFilter:'blur(6px)', width:'100%', maxWidth:240 }}>
              <div style={{ fontSize:10, opacity:.7, fontWeight:700, letterSpacing:'.12em' }}>PRIZE POOL</div>
              <div className="mono" style={{ fontSize:28, fontWeight:800, marginTop:3 }}>₩1,100,000</div>
              <div style={{ fontSize:10, opacity:.7, marginTop:4 }}>1등 60% / 2등 25% / 3등 15%</div>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize:10, marginTop:36, letterSpacing:'.18em', opacity:.5, fontWeight:800 }}>LEVEL 6</div>
            <div className="mono" style={{
              fontSize:96, fontWeight:800, lineHeight:1, marginTop:8,
              color:'#FF1F8F', textShadow:'0 4px 32px rgba(255,31,143,.5)',
            }}>{mm}:{ss}</div>
            <div style={{ fontSize:10, marginTop:14, opacity:.5, letterSpacing:'.14em' }}>BLINDS</div>
            <div className="mono" style={{ fontSize:28, fontWeight:800, marginTop:6 }}>1,000 / 2,000</div>
            <div style={{ fontSize:11, opacity:.5, marginTop:3 }}>앤티 250</div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginTop:32, width:'100%' }}>
              {[
                { v:'24/30', l:'PLAYERS' },
                { v:'7', l:'REBUY' },
                { v:'1.1M', l:'PRIZE POOL' },
              ].map((s,i) => (
                <div key={i} style={{ background:'rgba(255,255,255,.05)', borderRadius:14, padding:'12px 6px', border:'1px solid rgba(255,255,255,.08)' }}>
                  <div className="mono" style={{ fontSize:18, fontWeight:800 }}>{s.v}</div>
                  <div style={{ fontSize:9, opacity:.5, letterSpacing:'.08em', marginTop:3, fontWeight:700 }}>{s.l}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:11, opacity:.5, marginTop:22 }}>NEXT Lv 7 · <span className="mono" style={{ fontWeight:800 }}>1,500 / 3,000</span></div>
          </>
        )}
      </div>

      {/* footer — BREAK 토글 (데모용 — 실제 사용자는 운영자만 가능) */}
      <div style={{ padding:'12px 16px', borderTop:'1px solid rgba(255,255,255,.08)', display:'flex', justifyContent:'center' }}>
        <button onClick={() => setBreakMode(b => !b)} className="tap" style={{
          padding:'8px 18px', borderRadius:99,
          background:'rgba(255,255,255,.10)', border:'1px solid rgba(255,255,255,.18)',
          color:'#fff', fontSize:11, fontWeight:800, cursor:'pointer',
          backdropFilter:'blur(8px)',
        }}>
          {breakMode ? '▶ LIVE 시뮬레이션' : '☕ BREAK 시뮬레이션'}
        </button>
      </div>
    </div>
  );
}

// modal animations (한 번만)
if (!document.getElementById('__modal-style')) {
  const s = document.createElement('style');
  s.id = '__modal-style';
  s.textContent = `
    @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
    @keyframes slideUp { from { transform: translateY(40%); opacity:0; } to { transform: translateY(0); opacity:1; } }
  `;
  document.head.appendChild(s);
}

// ──────────────────────────────────────────────────────
// 통합 사용자 앱 (탭 + 화면 전환 + 모달)
// ──────────────────────────────────────────────────────
function UserApp() {
  const [tab, setTab] = useStateU('home');
  const [toast, setToast] = useStateU(null);
  const [openStoreId, setOpenStoreId] = useStateU(null);
  const [showLive, setShowLive] = useStateU(false);

  useEffectU(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(id);
  }, [toast]);

  const handleOpenStore = (storeId) => {
    setOpenStoreId(storeId);
  };

  const screen = (() => {
    switch (tab) {
      case 'home': return <ScreenHome onOpenStore={handleOpenStore} onOpenLive={() => setShowLive(true)} />;
      case 'find': return <ScreenFind onOpenStore={handleOpenStore} />;
      case 'posts': return <ScreenPosts />;
      case 'calendar': return <ScreenCalendar />;
      case 'my': return <ScreenMy />;
      default: return null;
    }
  })();

  const isPosts = tab === 'posts';

  return (
    <div className="phone" style={{ height: 760, display:'flex', flexDirection:'column', position:'relative' }}>
      <div key={tab} style={{ flex:1, minHeight:0, overflowY: isPosts ? 'hidden' : 'auto', display: isPosts ? 'flex' : 'block', flexDirection: 'column' }} className="no-scrollbar">
        {screen}
      </div>
      <UserTabbar active={tab} onChange={setTab} />
      <Toast show={!!toast}>{toast}</Toast>

      {openStoreId && (
        <StoreDetailModal
          storeId={openStoreId}
          onClose={() => setOpenStoreId(null)}
          onOpenLive={() => setShowLive(true)}
        />
      )}
      {showLive && <LiveFullscreenModal onClose={() => setShowLive(false)} />}
    </div>
  );
}

Object.assign(window, { UserApp, UserHeader, UserTabbar, StoreDetailModal, LiveFullscreenModal });
