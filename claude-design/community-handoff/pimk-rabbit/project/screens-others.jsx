// screens-others.jsx — 02 매장어드민 · 03 본사어드민 · 04 TV디스플레이 · 05 인증

const { useState: useStateO, useEffect: useEffectO, useMemo: useMemoO } = React;

// ──────────────────────────────────────────────────────
// 02. 매장 어드민 — 모바일 control center (토너 운영)
// ──────────────────────────────────────────────────────
function StoreAdmin() {
  const [running, setRunning] = useStateO(true);
  const [breakMode, setBreakMode] = useStateO(false);
  const [seconds, setSeconds] = useStateO(554); // 09:14

  useEffectO(() => {
    if (!running || breakMode) return;
    const id = setInterval(() => setSeconds(s => s > 0 ? s - 1 : 0), 1000);
    return () => clearInterval(id);
  }, [running, breakMode]);

  const mm = String(Math.floor(seconds/60)).padStart(2,'0');
  const ss = String(seconds%60).padStart(2,'0');

  return (
    <div className="phone" style={{ background:'#0F1419', color:'#fff' }}>
      {/* header */}
      <header style={{
        height:56, padding:'0 14px', display:'flex', alignItems:'center', gap:8,
        borderBottom:'1px solid rgba(255,255,255,.08)',
      }}>
        <button className="tap" style={{ width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,.06)', border:'none', borderRadius:8, color:'#fff', cursor:'pointer' }}>☰</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:10, color:'rgba(255,255,255,.5)', letterSpacing:'.06em', fontWeight:700 }}>STORE ADMIN</div>
          <div style={{ fontSize:14, fontWeight:900, letterSpacing:'-.015em' }}>화명동 깜깜이 펍</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:99, background:'rgba(16,185,129,.15)', border:'1px solid rgba(16,185,129,.3)' }}>
          <span style={{ width:6, height:6, borderRadius:99, background:'#10B981', animation:'pulse 1.6s infinite' }} />
          <span style={{ fontSize:10, fontWeight:800, color:'#10B981', letterSpacing:'.04em' }}>운영중</span>
        </div>
      </header>

      {/* 토너 운영 control center */}
      <section style={{ padding:14 }}>
        <div style={{ fontSize:11, fontWeight:800, color:'rgba(255,255,255,.5)', letterSpacing:'.12em', marginBottom:8 }}>🎬 진행중 토너</div>
        <div style={{
          background:'linear-gradient(135deg,rgba(255,31,143,.15),rgba(255,31,143,.04))',
          border:'1px solid rgba(255,31,143,.3)',
          borderRadius:16, padding:16,
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
            {breakMode
              ? <BreakBadge />
              : <LiveBadge />}
            <div style={{ fontSize:12, fontWeight:700 }}>데일리 히든에이스 30T</div>
          </div>

          {/* 거대 타이머 */}
          <div style={{ textAlign:'center', padding:'10px 0' }}>
            <div style={{ fontSize:9, color:'rgba(255,255,255,.4)', letterSpacing:'.18em', fontWeight:700 }}>{breakMode ? 'BREAK' : 'LEVEL 6 · BLINDS'}</div>
            <div className="mono" style={{
              fontSize:64, fontWeight:800, lineHeight:1, marginTop:4,
              color: breakMode ? '#F59E0B' : '#FF1F8F',
              textShadow: breakMode ? '0 4px 18px rgba(245,158,11,.4)' : '0 4px 18px rgba(255,31,143,.4)',
            }}>{mm}:{ss}</div>
            <div className="mono" style={{ fontSize:16, fontWeight:800, marginTop:6 }}>1,000 / 2,000</div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,.5)', marginTop:2 }}>ANTE 250</div>
          </div>

          {/* 컨트롤 버튼들 */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:10 }}>
            <button onClick={() => setRunning(r => !r)} className="tap" style={{
              padding:'10px', borderRadius:10,
              background: running ? 'rgba(255,255,255,.08)' : 'rgba(245,158,11,.18)',
              border:`1px solid ${running ? 'rgba(255,255,255,.15)' : 'rgba(245,158,11,.4)'}`,
              color:'#fff', fontSize:12, fontWeight:800, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            }}>
              {running ? '⏸ 일시정지' : '▶ 재개'}
            </button>
            <button onClick={() => { setBreakMode(b => !b); setSeconds(breakMode ? 554 : 298); }} className="tap" style={{
              padding:'10px', borderRadius:10,
              background: breakMode ? 'rgba(245,158,11,.18)' : 'rgba(255,255,255,.08)',
              border:`1px solid ${breakMode ? 'rgba(245,158,11,.4)' : 'rgba(255,255,255,.15)'}`,
              color:'#fff', fontSize:12, fontWeight:800, cursor:'pointer',
            }}>
              {breakMode ? '☕ BREAK 종료' : '☕ BREAK 시작'}
            </button>
          </div>

          {/* 3 지표 */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, marginTop:12 }}>
            {[
              { label:'PLAYERS', val:'24/30', sub:'REBUY 7' },
              { label:'LATE REG', val:'42:18', sub:'Lv 8까지', color:'#F59E0B' },
              { label:'PRIZE POOL', val:'1.1M', sub:'1·2·3등' },
            ].map(s => (
              <div key={s.label} style={{ background:'rgba(255,255,255,.06)', borderRadius:10, padding:'8px 6px', textAlign:'center', border:'1px solid rgba(255,255,255,.06)' }}>
                <div className="mono" style={{ fontSize:16, fontWeight:800, color:s.color || '#fff' }}>{s.val}</div>
                <div style={{ fontSize:8, color:'rgba(255,255,255,.5)', letterSpacing:'.08em', marginTop:2, fontWeight:700 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 빠른 액션 그리드 */}
      <section style={{ padding:'0 14px 14px' }}>
        <div style={{ fontSize:11, fontWeight:800, color:'rgba(255,255,255,.5)', letterSpacing:'.12em', marginBottom:8 }}>⚡ 빠른 액션</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
          {[
            { e:'📺', l:'TV 화면' },
            { e:'📢', l:'소식 작성' },
            { e:'👥', l:'참가자' },
            { e:'🎟️', l:'리바이' },
            { e:'📊', l:'통계' },
            { e:'⚙️', l:'설정' },
          ].map(a => (
            <button key={a.l} className="tap lift" style={{
              padding:'14px 8px', borderRadius:12,
              background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)',
              color:'#fff', cursor:'pointer',
            }}>
              <div style={{ fontSize:22 }}>{a.e}</div>
              <div style={{ fontSize:10, fontWeight:700, marginTop:5 }}>{a.l}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 오늘의 알림 */}
      <section style={{ padding:'0 14px 16px' }}>
        <div style={{ fontSize:11, fontWeight:800, color:'rgba(255,255,255,.5)', letterSpacing:'.12em', marginBottom:8 }}>🔔 알림 · 3건</div>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {[
            { icon:'⚠️', msg:'Late Reg 종료 10분 전', time:'방금', warn:true },
            { icon:'👤', msg:'신규 참가자 3명 등록', time:'5분 전' },
            { icon:'💰', msg:'리바이 7건 처리 완료', time:'12분 전' },
          ].map((n, i) => (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:10,
              background: n.warn ? 'rgba(245,158,11,.10)' : 'rgba(255,255,255,.04)',
              border:`1px solid ${n.warn ? 'rgba(245,158,11,.25)' : 'rgba(255,255,255,.06)'}`,
            }}>
              <div style={{ fontSize:16 }}>{n.icon}</div>
              <div style={{ flex:1, fontSize:11, fontWeight:600 }}>{n.msg}</div>
              <div className="mono" style={{ fontSize:9, color:'rgba(255,255,255,.5)' }}>{n.time}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 03. 본사 어드민 — 다크 관제센터
// ──────────────────────────────────────────────────────
function PlatformAdmin() {
  return (
    <div className="phone" style={{ background:'#0A0D12', color:'#fff' }}>
      <header style={{
        height:56, padding:'0 14px', display:'flex', alignItems:'center', gap:8,
        borderBottom:'1px solid rgba(255,255,255,.06)',
      }}>
        <div style={{ width:30, height:30, borderRadius:8, background:'linear-gradient(135deg,#FF1F8F,#FF6BAA)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <RabbitLogo size={26} variant="mark" />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:'rgba(255,255,255,.4)', letterSpacing:'.16em', fontWeight:800 }}>PLATFORM CONTROL CENTER</div>
          <div style={{ fontSize:13, fontWeight:900, letterSpacing:'-.01em' }}>Pink Rabbit 본사</div>
        </div>
        <span style={{ fontSize:9, fontWeight:800, padding:'3px 8px', borderRadius:4, background:'#10B981', color:'#fff' }}>ADMIN</span>
      </header>

      {/* KPI 카드 4종 */}
      <section style={{ padding:'14px 14px 0' }}>
        <div style={{ fontSize:10, color:'rgba(255,255,255,.4)', letterSpacing:'.14em', fontWeight:800, marginBottom:8 }}>REAL-TIME KPI</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {[
            { label:'활성 매장', val:'47', sub:'+3 (지난주)', color:'#FF1F8F' },
            { label:'LIVE 토너', val:'6', sub:'동시 진행중', color:'#E53E3E', live:true },
            { label:'DAU', val:'2,847', sub:'+12.4%', color:'#10B981' },
            { label:'오늘 매출', val:'₩3.2M', sub:'GMV 14.8M', color:'#F59E0B' },
          ].map(k => (
            <div key={k.label} style={{
              background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.08)',
              borderRadius:12, padding:'12px 12px',
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <div style={{ fontSize:9, color:'rgba(255,255,255,.5)', letterSpacing:'.1em', fontWeight:700 }}>{k.label}</div>
                {k.live && <span style={{ width:5, height:5, borderRadius:99, background:k.color, animation:'pulse 1.6s infinite' }} />}
              </div>
              <div className="mono" style={{ fontSize:24, fontWeight:800, color:k.color, marginTop:4, letterSpacing:'-.01em' }}>{k.val}</div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,.5)', marginTop:2 }}>{k.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* LIVE 모니터링 */}
      <section style={{ padding:'14px 14px 0' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <div style={{ fontSize:10, color:'rgba(255,255,255,.4)', letterSpacing:'.14em', fontWeight:800 }}>🔴 LIVE 모니터링</div>
          <button className="tap" style={{ fontSize:10, fontWeight:700, color:'#FF6BAA', background:'transparent', border:'none', cursor:'pointer' }}>전체 →</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {[
            { store:'화명동 깜깜이 펍', name:'데일리 30T', time:'09:14', lvl:'Lv 6', ppl:'24/30', status:'LIVE' },
            { store:'서면 로얄홀덤', name:'ROYAL CUP Day1', time:'15:42', lvl:'Lv 8', ppl:'32/40', status:'LIVE' },
            { store:'동래 ACE KING', name:'평일 30T', time:'04:58', lvl:'BREAK', ppl:'18/30', status:'BREAK' },
          ].map((s, i) => (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:10, padding:'10px',
              background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)', borderRadius:10,
            }}>
              <span style={{
                fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:4,
                background: s.status === 'LIVE' ? '#E53E3E' : '#F59E0B', color:'#fff',
              }}>{s.status}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:11, fontWeight:800, letterSpacing:'-.01em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.store}</div>
                <div style={{ fontSize:9, color:'rgba(255,255,255,.5)', marginTop:1 }}>{s.name} · {s.lvl} · 👥 {s.ppl}</div>
              </div>
              <div className="mono" style={{ fontSize:14, fontWeight:800, color: s.status === 'LIVE' ? '#FF6BAA' : '#F59E0B' }}>{s.time}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 광고 발급 4등급 */}
      <section style={{ padding:'14px 14px 16px' }}>
        <div style={{ fontSize:10, color:'rgba(255,255,255,.4)', letterSpacing:'.14em', fontWeight:800, marginBottom:8 }}>💎 광고 등급</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
          {[
            { tier:'PLAT', count:3, color:'#A78BFA', revenue:'1.2M' },
            { tier:'GOLD', count:8, color:'#F59E0B', revenue:'2.1M' },
            { tier:'SILV', count:14, color:'#9CA3AF', revenue:'1.4M' },
            { tier:'BASE', count:22, color:'#10B981', revenue:'0.8M' },
          ].map(t => (
            <div key={t.tier} style={{
              padding:'10px 6px', borderRadius:10, textAlign:'center',
              background:'rgba(255,255,255,.03)',
              border:`1px solid ${t.color}33`,
            }}>
              <div style={{ fontSize:8, fontWeight:800, color:t.color, letterSpacing:'.06em' }}>{t.tier}</div>
              <div className="mono" style={{ fontSize:18, fontWeight:800, color:'#fff', marginTop:2 }}>{t.count}</div>
              <div style={{ fontSize:8, color:'rgba(255,255,255,.5)', marginTop:1 }}>₩{t.revenue}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 사이드 메뉴 (간략) */}
      <section style={{ padding:'0 14px 14px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
          {['회원관리','피드 반경','홈 큐레이션','금지어','결제정산','광고검수','매장승인','로그'].map(m => (
            <button key={m} className="tap" style={{
              padding:'10px 4px', borderRadius:10, background:'rgba(255,255,255,.03)',
              border:'1px solid rgba(255,255,255,.06)', color:'rgba(255,255,255,.85)',
              fontSize:10, fontWeight:700, cursor:'pointer',
            }}>{m}</button>
          ))}
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 04. TV 디스플레이 — 가로 모드, LIVE↔BREAK 토글, 프리셋
// ──────────────────────────────────────────────────────
function TVDisplay({ preset = 'dark', breakMode = false, onToggleBreak }) {
  const p = TV_PRESETS[preset] || TV_PRESETS.dark;
  const [seconds, setSeconds] = useStateO(554); // 09:14
  const [running, setRunning] = useStateO(true);

  useEffectO(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds(s => s > 0 ? s - 1 : 600), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffectO(() => {
    setSeconds(breakMode ? 298 : 554);
  }, [breakMode]);

  const displaySeconds = breakMode ? Math.min(seconds, 298) : seconds;
  const mm = String(Math.floor(displaySeconds/60)).padStart(2,'0');
  const ss = String(displaySeconds%60).padStart(2,'0');

  // BREAK 모드는 amber gradient
  const bg = breakMode
    ? 'linear-gradient(135deg,#3d1c00,#7c2d12,#92400e)'
    : p.bg;
  const textColor = p.textColor;
  const subText = p.subTextColor;
  const timerColor = breakMode ? '#FFFFFF' : p.timerColor;

  return (
    <div style={{
      aspectRatio:'16/9',
      borderRadius:20, overflow:'hidden',
      border: p.light ? '1px solid var(--border)' : '1px solid rgba(0,0,0,.6)',
      boxShadow:'var(--shadow-hero)',
      background: bg,
      color: breakMode ? '#fff' : textColor,
      position:'relative',
      display:'grid',
      gridTemplateColumns: breakMode ? '1fr' : '180px 1fr 200px',
      gap: 12,
      padding: 14,
    }}>
      {/* BREAK mode → 중앙 거대 BREAK 화면 */}
      {breakMode ? (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center' }}>
          <div style={{ fontSize:9, fontWeight:700, opacity:.75, letterSpacing:'.16em' }}>화명동 깜깜이 펍</div>
          <div style={{ fontSize:13, fontWeight:900, marginTop:3 }}>데일리 히든에이스 30T</div>
          <div style={{ marginTop:6, padding:'3px 10px', borderRadius:99, fontSize:10, fontWeight:800, background:'rgba(255,255,255,.25)', backdropFilter:'blur(6px)' }}>⏸ BREAK</div>
          <div style={{ fontSize:48, marginTop:6, filter:'drop-shadow(0 4px 12px rgba(0,0,0,.3))' }}>☕</div>
          <div className="mono" style={{ fontSize:80, fontWeight:800, lineHeight:1, marginTop:4, textShadow:'0 6px 22px rgba(0,0,0,.3)' }}>{mm}:{ss}</div>
          <div style={{ fontSize:11, marginTop:6, opacity:.85 }}>곧 Lv 7 시작 · <span className="mono" style={{ fontWeight:800 }}>1,500 / 3,000</span></div>
          <div style={{ marginTop:10, padding:'8px 18px', borderRadius:12, background:'rgba(0,0,0,.3)', border:'1px solid rgba(255,255,255,.1)' }}>
            <div style={{ fontSize:8, opacity:.7, fontWeight:700, letterSpacing:'.12em' }}>PRIZE POOL</div>
            <div className="mono" style={{ fontSize:16, fontWeight:800, marginTop:1 }}>₩1,100,000</div>
          </div>
        </div>
      ) : (
        <>
          {/* 좌: STRUCTURE */}
          <aside style={{
            background: p.panelBg, border:`1px solid ${p.panelBorder}`,
            borderRadius:12, padding:'10px 8px', display:'flex', flexDirection:'column',
            color: textColor,
          }}>
            <div style={{ fontSize:8, fontWeight:800, color: subText, letterSpacing:'.16em', marginBottom:5 }}>STRUCTURE</div>
            <div style={{ fontSize:9, fontWeight:800, marginBottom:6, letterSpacing:'-.01em' }}>데일리 30T</div>
            <div className="mono" style={{ flex:1, display:'flex', flexDirection:'column', gap:1, fontSize:8, overflow:'hidden' }}>
              {[
                { lv:1, blinds:'100/200', ante:'—', sel:false },
                { lv:2, blinds:'200/400', ante:'—', sel:false },
                { lv:3, blinds:'300/600', ante:'100', sel:false },
                { lv:4, blinds:'500/1k', ante:'100', sel:false },
                { lv:5, blinds:'800/1.5k', ante:'200', sel:false },
                { lv:6, blinds:'1k/2k', ante:'250', sel:true },
                { lv:7, blinds:'1.5k/3k', ante:'400', sel:false },
                { lv:'B', blinds:'☕ BREAK 5\'', ante:'', breakRow:true },
                { lv:9, blinds:'2k/4k', ante:'500', sel:false },
              ].map((r,i) => (
                <div key={i} style={{
                  display:'flex', justifyContent:'space-between', padding:'2px 5px', borderRadius:4,
                  background: r.sel ? (p.light ? 'rgba(255,31,143,.12)' : 'rgba(255,31,143,.18)') : 'transparent',
                  color: r.sel ? p.accentColor : r.breakRow ? '#F59E0B' : subText,
                  fontWeight: r.sel || r.breakRow ? 800 : 500,
                }}>
                  <span>{r.sel ? `${r.lv} ←` : r.lv}</span>
                  <span>{r.blinds}</span>
                  <span>{r.ante}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop:`1px solid ${p.panelBorder}`, paddingTop:6, marginTop:6 }}>
              <div style={{ fontSize:7, fontWeight:800, color: subText, letterSpacing:'.14em' }}>NEXT</div>
              <div className="mono" style={{ fontSize:11, fontWeight:800, marginTop:2 }}>Lv 7 · 1.5k/3k</div>
            </div>
          </aside>

          {/* 중앙: 거대 타이머 */}
          <section style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'space-between', padding:'4px 0' }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:8, fontWeight:800, color: subText, letterSpacing:'.16em' }}>화명동 깜깜이 펍</div>
              <div style={{ fontSize:13, fontWeight:900, marginTop:2, letterSpacing:'-.015em' }}>데일리 히든에이스 30T</div>
              <div style={{ marginTop:5 }}><LiveBadge /></div>
            </div>
            <div style={{ textAlign:'center', flex:1, display:'flex', flexDirection:'column', justifyContent:'center' }}>
              <div style={{ fontSize:9, fontWeight:800, color: subText, letterSpacing:'.18em' }}>LEVEL 6 · BLINDS</div>
              <div className="mono" style={{
                fontSize: 130, fontWeight:800, lineHeight:1, marginTop:2,
                color: timerColor,
                textShadow: p.glow ? p.glow : (preset === 'dark' ? '0 4px 24px rgba(255,31,143,.4)' : 'none'),
              }}>{mm}:{ss}</div>
              <div className="mono" style={{ fontSize:24, fontWeight:800, marginTop:4 }}>1,000 / 2,000</div>
              <div style={{ fontSize:10, color: subText, marginTop:2 }} className="mono">ANTE 250</div>
            </div>
            <div style={{ textAlign:'center', fontSize:9, color: subText, fontWeight:700 }}>
              <span style={{ letterSpacing:'.14em' }}>SPONSORED · </span>홀덤킹 KOREA TOUR 2026
            </div>
          </section>

          {/* 우: 3카드 */}
          <aside style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {[
              { label:'PLAYERS', val:'24', sub:'/30', meta:'REBUY 7 · ADDON 0' },
              { label:'LATE REG', val:'42:18', sub:'', meta:'Lv 8까지 가능', color: p.accentColor },
              { label:'PRIZE POOL', val:'₩1.1M', sub:'', meta:'1등 60% · 2등 25% · 3등 15%', emph:true },
            ].map((c,i) => (
              <div key={i} style={{
                flex:1,
                background: c.emph ? `linear-gradient(135deg, ${p.accentColor}22, ${p.accentColor}06)` : p.panelBg,
                border: `1px solid ${c.emph ? p.accentColor+'55' : p.panelBorder}`,
                borderRadius:12, padding:'8px 10px', textAlign:'center',
                display:'flex', flexDirection:'column', justifyContent:'center',
              }}>
                <div style={{ fontSize:8, fontWeight:800, color: c.emph ? p.accentColor : subText, letterSpacing:'.16em' }}>{c.label}</div>
                <div className="mono" style={{ fontSize: c.label === 'LATE REG' ? 22 : 28, fontWeight:800, marginTop:2, color: c.color || textColor }}>
                  {c.val}{c.sub && <span style={{ fontSize:14, opacity:.5 }}>{c.sub}</span>}
                </div>
                <div style={{ fontSize:8, color: subText, marginTop:3, lineHeight:1.35 }}>{c.meta}</div>
              </div>
            ))}
          </aside>
        </>
      )}

      {/* 우상단 LIVE↔BREAK 토글 */}
      <button onClick={onToggleBreak} className="tap" style={{
        position:'absolute', top:10, right:10,
        padding:'5px 12px', borderRadius:99,
        background: breakMode ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.10)',
        border:'1px solid rgba(255,255,255,.18)', backdropFilter:'blur(8px)',
        color:'#fff', fontSize:10, fontWeight:800, cursor:'pointer',
        letterSpacing:'.04em',
      }}>
        {breakMode ? '▶ LIVE 복귀' : '☕ BREAK'}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 05. 인증 — 사용자 메인 + 매장 push + 본사 별도
// ──────────────────────────────────────────────────────

function AuthScreen() {
  // view: 'main' (사용자 로그인/가입) | 'store' (매장 로그인)
  const [view, setView] = useStateO('main');

  return (
    <div className="phone" style={{ background:'var(--bg)', overflow:'hidden', display:'flex', flexDirection:'column', position:'relative' }}>
      {/* 메인 - 사용자 로그인/가입 */}
      <UserAuthMain onGoStore={() => setView('store')} />

      {/* 매장 로그인 — push (slide right→left) */}
      {view === 'store' && (
        <div style={{
          position:'absolute', inset:0, background:'var(--bg)', zIndex:20,
          animation:'authPushIn .28s cubic-bezier(.2,.8,.2,1)',
          display:'flex', flexDirection:'column',
        }}>
          <StoreAuth onBack={() => setView('main')} />
        </div>
      )}
    </div>
  );
}

// ── 사용자 메인 (로그인 ↔ 가입 토글) ──────────────────
function UserAuthMain({ onGoStore }) {
  const [mode, setMode] = useStateO('login');

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* 핑크 그라데이션 헤더 */}
      <div style={{
        background:'linear-gradient(160deg, #FF1F8F 0%, #FF6BAA 100%)',
        padding: '40px 20px 36px',
        color:'#fff', position:'relative', overflow:'hidden',
      }}>
        <div style={{ position:'absolute', top:-20, right:-30, opacity:.18 }}>
          <RabbitLogo size={200} variant="mark" />
        </div>
        <div style={{ position:'relative' }}>
          <RabbitLogo size={56} variant="badge" />
          {mode === 'login' ? (
            <>
              <div style={{ fontSize:24, fontWeight:900, marginTop:14, letterSpacing:'-.025em' }}>다시 만나서 반가워요</div>
              <div style={{ fontSize:12, opacity:.92, marginTop:6, lineHeight:1.5 }}>
                오늘의 매장 소식과 토너가 기다리고 있어요
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize:24, fontWeight:900, marginTop:14, letterSpacing:'-.025em' }}>안녕하세요!<br/>Pink Rabbit입니다 🐰</div>
              <div style={{ fontSize:12, opacity:.92, marginTop:6, lineHeight:1.5 }}>
                부산·경남 홀덤펍 소식을 가장 먼저 받아보세요
              </div>
            </>
          )}
        </div>
      </div>

      {/* 모드 토글 */}
      <div style={{ padding:'16px 20px 0' }}>
        <div style={{
          display:'grid', gridTemplateColumns:'1fr 1fr', gap:4,
          background:'var(--surface-2)', borderRadius:12, padding:4,
        }}>
          {[{ id:'login', label:'로그인' }, { id:'signup', label:'회원가입' }].map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} className="tap" style={{
              padding:'9px 0', borderRadius:9, border:'none', cursor:'pointer',
              background: mode === m.id ? 'var(--bg)' : 'transparent',
              color: mode === m.id ? 'var(--brand)' : 'var(--text-2)',
              fontSize:13, fontWeight:800, letterSpacing:'-.01em',
              boxShadow: mode === m.id ? 'var(--shadow-card)' : 'none',
              transition:'all .15s ease',
            }}>{m.label}</button>
          ))}
        </div>
      </div>

      {/* 본문 */}
      <div className="no-scrollbar" style={{ flex:1, overflowY:'auto' }}>
        {mode === 'login' ? <UserLoginPanel /> : <UserSignupPanel onSwitchToLogin={() => setMode('login')} />}

        {/* 매장 사장님 안내 카드 */}
        <section style={{ padding:'4px 20px 24px' }}>
          <div onClick={onGoStore} className="tap lift" style={{
            display:'flex', alignItems:'center', gap:12,
            padding:'14px 14px', borderRadius:14,
            background:'linear-gradient(135deg,#FFF8EC,#FFE9D6)',
            border:'1px solid #F5D9A6', cursor:'pointer',
          }}>
            <div style={{
              width:42, height:42, borderRadius:12, flexShrink:0,
              background:'#fff', display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:22, boxShadow:'var(--shadow-card)',
            }}>🏪</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:900, letterSpacing:'-.015em', color:'#78350F' }}>매장 사장님이세요?</div>
              <div style={{ fontSize:11, color:'#92400E', marginTop:2, lineHeight:1.45 }}>매장 어드민 로그인은 별도 페이지로</div>
            </div>
            <span style={{ color:'#92400E' }}>{Icons.arrow(16)}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── 사용자 로그인 패널 ────────────────────────────────
function UserLoginPanel() {
  const [phone, setPhone] = useStateO('');
  const [pw, setPw] = useStateO('');
  const [showPw, setShowPw] = useStateO(false);
  const [remember, setRemember] = useStateO(true);
  const [error, setError] = useStateO(null);
  const [loading, setLoading] = useStateO(false);

  const phoneOk = phone.replace(/\D/g,'').length >= 10;
  const valid = phoneOk && pw.length >= 4;

  const handleLogin = () => {
    if (!valid) return;
    setError(null); setLoading(true);
    setTimeout(() => {
      setLoading(false);
      if (pw !== 'demo') setError('비밀번호가 올바르지 않습니다');
    }, 800);
  };

  return (
    <section style={{ padding:'18px 20px 0' }}>
      {/* 휴대폰 */}
      <div>
        <div style={{ fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.04em', marginBottom:6 }}>휴대폰 번호</div>
        <input
          value={phone}
          onChange={e => { setPhone(e.target.value); setError(null); }}
          placeholder="010-0000-0000"
          style={{
            width:'100%', padding:'12px 14px', borderRadius:12,
            border:`1.5px solid ${error ? '#E53E3E' : 'var(--border)'}`,
            background:'var(--bg)', boxSizing:'border-box',
            fontSize:14, fontWeight:700, color:'var(--text-1)', fontFamily:'inherit',
            outline:'none', transition:'border-color .15s ease',
          }}
          onFocus={e => !error && (e.target.style.borderColor = 'var(--brand)')}
          onBlur={e => !error && (e.target.style.borderColor = 'var(--border)')}
        />
      </div>

      {/* 비밀번호 */}
      <div style={{ marginTop:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
          <span style={{ fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.04em' }}>비밀번호</span>
          <span style={{ fontSize:10, color:'var(--text-3)' }} className="mono">힌트: <b style={{ color:'var(--brand)' }}>demo</b></span>
        </div>
        <div style={{ position:'relative' }}>
          <input
            value={pw}
            type={showPw ? 'text' : 'password'}
            onChange={e => { setPw(e.target.value); setError(null); }}
            placeholder="비밀번호 입력"
            style={{
              width:'100%', padding:'12px 44px 12px 14px', borderRadius:12,
              border:`1.5px solid ${error ? '#E53E3E' : 'var(--border)'}`,
              background:'var(--bg)', boxSizing:'border-box',
              fontSize:14, fontWeight:700, color:'var(--text-1)', fontFamily:'inherit',
              outline:'none', transition:'border-color .15s ease',
            }}
            onFocus={e => !error && (e.target.style.borderColor = 'var(--brand)')}
            onBlur={e => !error && (e.target.style.borderColor = 'var(--border)')}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
          />
          <button onClick={() => setShowPw(v => !v)} className="tap" style={{
            position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
            background:'transparent', border:'none', cursor:'pointer',
            color:'var(--text-3)', padding:8, display:'flex', alignItems:'center', justifyContent:'center',
          }} aria-label="비밀번호 표시">
            {showPw
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        </div>
        {error && (
          <div style={{ marginTop:8, fontSize:11, color:'#E53E3E', fontWeight:700, display:'flex', alignItems:'center', gap:4 }}>
            <span>⚠</span>{error}
          </div>
        )}
      </div>

      {/* 자동 로그인 + 비번 찾기 */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:14 }}>
        <label className="tap" style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
          <Checkbox checked={remember} onChange={setRemember} small />
          <span style={{ fontSize:12, color:'var(--text-1)', fontWeight:600 }}>자동 로그인</span>
        </label>
        <button className="tap" style={{ background:'transparent', border:'none', fontSize:11, fontWeight:700, color:'var(--text-2)', cursor:'pointer' }}>
          비밀번호 찾기
        </button>
      </div>

      {/* CTA */}
      <button onClick={handleLogin} disabled={!valid || loading} className="tap" style={{
        marginTop:16, width:'100%', padding:'14px 0', borderRadius:14,
        background: valid && !loading ? 'var(--brand)' : 'var(--surface-3)',
        color: valid && !loading ? '#fff' : 'var(--text-3)',
        fontSize:14, fontWeight:900, letterSpacing:'-.01em',
        border:'none', cursor: valid && !loading ? 'pointer' : 'not-allowed',
        boxShadow: valid && !loading ? 'var(--shadow-brand)' : 'none',
        transition:'all .2s ease',
        display:'flex', alignItems:'center', justifyContent:'center', gap:8,
      }}>
        {loading && <span style={{
          width:14, height:14, borderRadius:99,
          border:'2px solid rgba(255,255,255,.4)', borderTopColor:'#fff',
          animation:'authSpin .8s linear infinite', display:'inline-block',
        }} />}
        {loading ? '로그인 중...' : '로그인'}
      </button>

      {/* SNS 간편 로그인 */}
      <div style={{ display:'flex', alignItems:'center', gap:10, margin:'20px 0 14px' }}>
        <div style={{ flex:1, height:1, background:'var(--border)' }} />
        <div style={{ fontSize:10, color:'var(--text-3)', fontWeight:700, letterSpacing:'.06em' }}>SNS 간편 로그인</div>
        <div style={{ flex:1, height:1, background:'var(--border)' }} />
      </div>
      <button className="tap lift" style={{
        width:'100%', padding:'13px 0', borderRadius:14,
        background:'#FEE500', color:'#391B1B',
        fontSize:13, fontWeight:800, border:'none', cursor:'pointer',
        display:'flex', alignItems:'center', justifyContent:'center', gap:8,
      }}>
        <KakaoIcon /> 카카오로 시작하기
      </button>
      <div style={{ display:'flex', gap:8, marginTop:8 }}>
        <button className="tap lift" style={{
          flex:1, padding:'11px 0', borderRadius:14,
          background:'#03C75A', color:'#fff',
          fontSize:12, fontWeight:800, border:'none', cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center', gap:6,
        }}>
          <NaverIcon /> 네이버
        </button>
        <button className="tap lift" style={{
          flex:1, padding:'11px 0', borderRadius:14,
          background:'#000', color:'#fff',
          fontSize:12, fontWeight:800, border:'none', cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center', gap:6,
        }}>
          <AppleIcon /> Apple
        </button>
      </div>
    </section>
  );
}

// ── 사용자 가입 패널 ──────────────────────────────────
function UserSignupPanel({ onSwitchToLogin }) {
  const [phone, setPhone] = useStateO('010-');
  const [code, setCode] = useStateO('');
  const [codeSent, setCodeSent] = useStateO(false);
  const [agree, setAgree] = useStateO({ all:false, t1:false, t2:false, t3:false });

  const handleAllAgree = (v) => setAgree({ all:v, t1:v, t2:v, t3:v });
  const handleOne = (k, v) => setAgree(prev => {
    const next = { ...prev, [k]:v };
    next.all = next.t1 && next.t2 && next.t3;
    return next;
  });

  const phoneOk = phone.replace(/\D/g,'').length >= 10;
  const valid = phoneOk && agree.t1 && agree.t2 && (!codeSent || code.length === 6);

  return (
    <section style={{ padding:'18px 20px 0' }}>
      <div>
        <div style={{ fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.04em', marginBottom:6 }}>휴대폰 번호</div>
        <div style={{ display:'flex', gap:6 }}>
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="010-0000-0000"
            style={{
              flex:1, minWidth:0, padding:'12px 14px', borderRadius:12,
              border:'1.5px solid var(--border)', background:'var(--bg)',
              fontSize:14, fontWeight:700, color:'var(--text-1)', fontFamily:'inherit',
              outline:'none',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--brand)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
          <button onClick={() => phoneOk && setCodeSent(true)} className="tap" style={{
            padding:'0 14px', borderRadius:12, fontSize:12, fontWeight:800,
            background: phoneOk ? 'var(--brand)' : 'var(--surface-2)',
            border: phoneOk ? 'none' : '1.5px solid var(--border)',
            color: phoneOk ? '#fff' : 'var(--text-3)',
            cursor: phoneOk ? 'pointer' : 'not-allowed',
            whiteSpace:'nowrap',
          }}>{codeSent ? '재전송' : '인증요청'}</button>
        </div>
      </div>

      {codeSent && (
        <div style={{ marginTop:12, animation:'fadeIn .25s ease' }}>
          <div style={{ fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.04em', marginBottom:6, display:'flex', justifyContent:'space-between' }}>
            <span>인증번호 6자리</span>
            <span className="mono" style={{ color:'#E53E3E' }}>03:00</span>
          </div>
          <input
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,6))}
            placeholder="000000"
            className="mono"
            style={{
              width:'100%', padding:'12px 14px', borderRadius:12,
              border:'1.5px solid var(--border)', background:'var(--bg)', boxSizing:'border-box',
              fontSize:18, fontWeight:800, color:'var(--text-1)',
              outline:'none', letterSpacing:'.3em', textAlign:'center',
            }}
          />
        </div>
      )}

      <div style={{ marginTop:16, background:'var(--surface-2)', borderRadius:12, padding:'12px 14px' }}>
        <label className="tap" style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
          <Checkbox checked={agree.all} onChange={handleAllAgree} />
          <span style={{ fontSize:13, fontWeight:800, letterSpacing:'-.01em' }}>전체 동의 (선택 포함)</span>
        </label>
        <div style={{ height:1, background:'var(--border)', margin:'10px 0' }} />
        {[
          { k:'t1', label:'서비스 이용약관 (필수)' },
          { k:'t2', label:'개인정보 처리방침 (필수)' },
          { k:'t3', label:'마케팅 정보 수신 (선택)' },
        ].map(t => (
          <label key={t.k} className="tap" style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'4px 0' }}>
            <Checkbox checked={agree[t.k]} onChange={(v) => handleOne(t.k, v)} small />
            <span style={{ fontSize:12, color:'var(--text-1)', flex:1 }}>{t.label}</span>
            <span style={{ fontSize:11, color:'var(--text-3)' }}>{Icons.arrow(11)}</span>
          </label>
        ))}
      </div>

      <button disabled={!valid} className="tap" style={{
        marginTop:16, width:'100%', padding:'14px 0', borderRadius:14,
        background: valid ? 'var(--brand)' : 'var(--surface-3)',
        color: valid ? '#fff' : 'var(--text-3)',
        fontSize:14, fontWeight:900, letterSpacing:'-.01em',
        border:'none', cursor: valid ? 'pointer' : 'not-allowed',
        boxShadow: valid ? 'var(--shadow-brand)' : 'none',
        transition:'all .2s ease',
      }}>시작하기</button>

      <div style={{ marginTop:14, marginBottom:8, fontSize:11, color:'var(--text-2)', textAlign:'center' }}>
        이미 계정이 있나요?{' '}
        <button onClick={onSwitchToLogin} style={{
          background:'transparent', border:'none', color:'var(--brand)',
          fontWeight:800, cursor:'pointer', fontFamily:'inherit', fontSize:'inherit', padding:0,
        }}>로그인 →</button>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────
// 매장 사장 로그인 (사용자 phone 안에서 push 또는 별도 phone)
// ──────────────────────────────────────────────────────
function StoreAuth({ onBack }) {
  const [mode, setMode] = useStateO('login'); // login | apply
  const [bizNo, setBizNo] = useStateO('');
  const [pw, setPw] = useStateO('');
  const [showPw, setShowPw] = useStateO(false);

  const bizOk = bizNo.replace(/\D/g,'').length === 10;
  const valid = bizOk && pw.length >= 4;

  return (
    <>
      {/* 헤더 */}
      <header style={{
        height:52, padding:'0 12px', display:'flex', alignItems:'center', gap:8,
        borderBottom:'1px solid var(--border)', background:'var(--bg)',
      }}>
        {onBack ? (
          <button onClick={onBack} className="tap" style={{
            width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center',
            background:'transparent', border:'none', color:'var(--text-1)', cursor:'pointer',
          }}>{Icons.back()}</button>
        ) : (
          <div style={{ width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <RabbitLogo size={28} variant="badge" />
          </div>
        )}
        <div style={{ flex:1, fontSize:15, fontWeight:800, letterSpacing:'-.015em' }}>매장 로그인</div>
        <span style={{ fontSize:9, fontWeight:800, padding:'3px 7px', borderRadius:4, background:'#FEF3C7', color:'#92400E', letterSpacing:'.04em' }}>OWNER</span>
      </header>

      {/* 골드/앰버 톤 헤더 */}
      <div style={{
        background:'linear-gradient(135deg,#92400E 0%,#F59E0B 100%)',
        padding:'28px 20px 24px', color:'#fff', position:'relative', overflow:'hidden',
      }}>
        <div style={{ position:'absolute', top:-20, right:-20, fontSize:160, opacity:.08 }}>🏪</div>
        <div style={{ position:'relative' }}>
          <div style={{
            width:46, height:46, borderRadius:12, background:'rgba(255,255,255,.2)',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:24,
            backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,.3)',
          }}>🏪</div>
          <div style={{ fontSize:19, fontWeight:900, marginTop:12, letterSpacing:'-.02em' }}>매장 사장님 환영합니다</div>
          <div style={{ fontSize:11, opacity:.92, marginTop:4, lineHeight:1.5 }}>
            토너 운영 · TV 디스플레이 · 광고 관리를 한 곳에서
          </div>
        </div>
      </div>

      {/* mode 토글 */}
      <div style={{ padding:'14px 20px 0' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, background:'var(--surface-2)', borderRadius:12, padding:4 }}>
          {[{ id:'login', label:'로그인' }, { id:'apply', label:'입점 신청' }].map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} className="tap" style={{
              padding:'9px 0', borderRadius:9, border:'none', cursor:'pointer',
              background: mode === m.id ? 'var(--bg)' : 'transparent',
              color: mode === m.id ? '#92400E' : 'var(--text-2)',
              fontSize:13, fontWeight:800, letterSpacing:'-.01em',
              boxShadow: mode === m.id ? 'var(--shadow-card)' : 'none',
              transition:'all .15s ease',
            }}>{m.label}</button>
          ))}
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex:1, overflowY:'auto' }}>
        {mode === 'login' ? (
          <section style={{ padding:'18px 20px 24px' }}>
            <div>
              <div style={{ fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.04em', marginBottom:6 }}>사업자등록번호</div>
              <input
                value={bizNo}
                onChange={e => setBizNo(e.target.value)}
                placeholder="123-45-67890"
                style={{
                  width:'100%', padding:'12px 14px', borderRadius:12,
                  border:'1.5px solid var(--border)', background:'var(--bg)',
                  fontSize:14, fontWeight:700, color:'var(--text-1)', fontFamily:'inherit',
                  outline:'none', boxSizing:'border-box',
                }}
                onFocus={e => e.target.style.borderColor = '#F59E0B'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <div style={{ marginTop:12 }}>
              <div style={{ fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.04em', marginBottom:6 }}>비밀번호</div>
              <div style={{ position:'relative' }}>
                <input
                  value={pw} type={showPw ? 'text' : 'password'}
                  onChange={e => setPw(e.target.value)}
                  placeholder="매장 로그인 비밀번호"
                  style={{
                    width:'100%', padding:'12px 44px 12px 14px', borderRadius:12,
                    border:'1.5px solid var(--border)', background:'var(--bg)', boxSizing:'border-box',
                    fontSize:14, fontWeight:700, color:'var(--text-1)', fontFamily:'inherit',
                    outline:'none',
                  }}
                  onFocus={e => e.target.style.borderColor = '#F59E0B'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                />
                <button onClick={() => setShowPw(v => !v)} className="tap" style={{
                  position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
                  background:'transparent', border:'none', cursor:'pointer',
                  color:'var(--text-3)', padding:8,
                }}>
                  {showPw
                    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            <button disabled={!valid} className="tap" style={{
              marginTop:16, width:'100%', padding:'14px 0', borderRadius:14,
              background: valid ? '#F59E0B' : 'var(--surface-3)',
              color: valid ? '#fff' : 'var(--text-3)',
              fontSize:14, fontWeight:900, letterSpacing:'-.01em',
              border:'none', cursor: valid ? 'pointer' : 'not-allowed',
              boxShadow: valid ? '0 4px 14px rgba(245,158,11,.3)' : 'none',
              transition:'all .2s ease',
            }}>매장 어드민 진입</button>

            <div style={{ marginTop:16, padding:'12px 14px', borderRadius:12, background:'#FEF3C7', border:'1px solid #FDE68A', display:'flex', gap:10 }}>
              <span style={{ fontSize:16 }}>💡</span>
              <div style={{ fontSize:11, color:'#78350F', lineHeight:1.55 }}>
                <b>처음이신가요?</b> 사업자등록증을 미리 준비하시면 입점 신청이 빠릅니다. 본사 검토 후 1-2일 내 승인됩니다.
              </div>
            </div>
          </section>
        ) : (
          <section style={{ padding:'18px 20px 24px' }}>
            <div style={{ fontSize:14, fontWeight:900, letterSpacing:'-.02em', marginBottom:4 }}>입점 신청서</div>
            <div style={{ fontSize:11, color:'var(--text-2)', marginBottom:14 }}>본사 검토 후 영업일 1-2일 내 승인 알림이 전송됩니다</div>

            {[
              { label:'매장명', ph:'예: 화명동 깜깜이 펍' },
              { label:'사업자등록번호', ph:'123-45-67890' },
              { label:'담당자 휴대폰', ph:'010-0000-0000' },
              { label:'매장 주소', ph:'부산광역시 ...' },
            ].map((f, i) => (
              <div key={i} style={{ marginBottom:10 }}>
                <div style={{ fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.04em', marginBottom:4 }}>{f.label}</div>
                <input placeholder={f.ph} style={{
                  width:'100%', padding:'11px 12px', borderRadius:10,
                  border:'1.5px solid var(--border)', background:'var(--bg)', boxSizing:'border-box',
                  fontSize:13, fontWeight:600, color:'var(--text-1)', fontFamily:'inherit',
                  outline:'none',
                }}
                onFocus={e => e.target.style.borderColor = '#F59E0B'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'} />
              </div>
            ))}

            {/* 사업자등록증 첨부 */}
            <div style={{ marginTop:6 }}>
              <div style={{ fontSize:11, fontWeight:800, color:'var(--text-2)', letterSpacing:'.04em', marginBottom:6 }}>사업자등록증 사진</div>
              <button className="tap" style={{
                width:'100%', padding:'18px 0', borderRadius:12,
                background:'transparent', border:'2px dashed var(--border-strong)',
                color:'var(--text-2)', fontSize:12, fontWeight:700, cursor:'pointer',
              }}>📎 파일 첨부</button>
            </div>

            <button className="tap" style={{
              marginTop:16, width:'100%', padding:'14px 0', borderRadius:14,
              background:'#F59E0B', color:'#fff',
              fontSize:14, fontWeight:900, letterSpacing:'-.01em',
              border:'none', cursor:'pointer',
              boxShadow:'0 4px 14px rgba(245,158,11,.3)',
            }}>입점 신청서 제출</button>
          </section>
        )}
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────
// 본사 로그인 (별도 phone) — 다크 / 보안 강조
// ──────────────────────────────────────────────────────
function PlatformLoginScreen() {
  const [email, setEmail] = useStateO('');
  const [pw, setPw] = useStateO('');
  const [otp, setOtp] = useStateO('');
  const [showPw, setShowPw] = useStateO(false);

  const emailOk = /\S+@\S+/.test(email);
  const valid = emailOk && pw.length >= 4 && otp.length === 6;

  return (
    <div className="phone" style={{
      background:'#0A0D12', overflow:'hidden', color:'#fff',
      display:'flex', flexDirection:'column',
    }}>
      {/* 헤더 - 보안 톤 */}
      <header style={{
        height:52, padding:'0 14px', display:'flex', alignItems:'center', gap:8,
        borderBottom:'1px solid rgba(255,255,255,.06)',
      }}>
        <div style={{ width:30, height:30, borderRadius:8, background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <RabbitLogo size={24} variant="mark" />
        </div>
        <div style={{ flex:1 }}>
          <div className="mono" style={{ fontSize:9, color:'rgba(255,255,255,.4)', letterSpacing:'.16em', fontWeight:800 }}>PLATFORM CONTROL</div>
        </div>
        <span style={{ fontSize:9, fontWeight:800, padding:'3px 7px', borderRadius:4, background:'rgba(229,62,62,.15)', color:'#FCA5A5', letterSpacing:'.05em', border:'1px solid rgba(229,62,62,.3)' }}>SECURE</span>
      </header>

      {/* 보안 배지 */}
      <div style={{ padding:'24px 20px 16px', textAlign:'center', position:'relative' }}>
        <div style={{
          position:'absolute', inset:0, opacity:.06,
          backgroundImage:'radial-gradient(circle at 20% 30%, #FF1F8F 0, transparent 40%), radial-gradient(circle at 80% 70%, #3B82F6 0, transparent 40%)',
        }} />
        <div style={{ position:'relative' }}>
          <div style={{
            width:64, height:64, borderRadius:18, margin:'0 auto',
            background:'linear-gradient(135deg, rgba(255,31,143,.18), rgba(59,130,246,.18))',
            border:'1px solid rgba(255,255,255,.12)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:30, backdropFilter:'blur(20px)',
          }}>🔒</div>
          <div style={{ fontSize:18, fontWeight:900, marginTop:14, letterSpacing:'-.02em' }}>본사 관제센터 진입</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,.55)', marginTop:6, lineHeight:1.55, maxWidth:280, marginLeft:'auto', marginRight:'auto' }}>
            관리자 전용 페이지입니다. <span style={{ color:'#FCA5A5' }}>IP 화이트리스트</span>가 적용되며 모든 접근은 감사 로그가 남습니다.
          </div>
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex:1, overflowY:'auto' }}>
        <section style={{ padding:'8px 20px 24px' }}>
          {/* 이메일 */}
          <div>
            <div style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,.5)', letterSpacing:'.08em', marginBottom:6 }}>ADMIN EMAIL</div>
            <input
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="admin@pinkrabbit.kr"
              style={{
                width:'100%', padding:'12px 14px', borderRadius:10,
                border:'1px solid rgba(255,255,255,.12)',
                background:'rgba(255,255,255,.04)', boxSizing:'border-box',
                fontSize:13, fontWeight:600, color:'#fff', fontFamily:'inherit',
                outline:'none',
              }}
              onFocus={e => e.target.style.borderColor = '#FF6BAA'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
            />
          </div>

          {/* 비번 */}
          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,.5)', letterSpacing:'.08em', marginBottom:6 }}>PASSWORD</div>
            <div style={{ position:'relative' }}>
              <input
                value={pw} type={showPw ? 'text' : 'password'}
                onChange={e => setPw(e.target.value)}
                placeholder="••••••••"
                style={{
                  width:'100%', padding:'12px 44px 12px 14px', borderRadius:10,
                  border:'1px solid rgba(255,255,255,.12)',
                  background:'rgba(255,255,255,.04)', boxSizing:'border-box',
                  fontSize:13, fontWeight:600, color:'#fff', fontFamily:'inherit',
                  outline:'none',
                }}
                onFocus={e => e.target.style.borderColor = '#FF6BAA'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
              />
              <button onClick={() => setShowPw(v => !v)} className="tap" style={{
                position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
                background:'transparent', border:'none', cursor:'pointer',
                color:'rgba(255,255,255,.5)', padding:8,
              }}>
                {showPw
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>

          {/* OTP */}
          <div style={{ marginTop:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
              <span style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,.5)', letterSpacing:'.08em' }}>OTP (Google Authenticator)</span>
              <span className="mono" style={{ fontSize:10, color:'#FF6BAA' }}>00:23</span>
            </div>
            <input
              value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g,'').slice(0,6))}
              placeholder="000000"
              className="mono"
              style={{
                width:'100%', padding:'12px 14px', borderRadius:10,
                border:'1px solid rgba(255,255,255,.12)',
                background:'rgba(255,255,255,.04)', boxSizing:'border-box',
                fontSize:18, fontWeight:800, color:'#fff', textAlign:'center', letterSpacing:'.3em',
                outline:'none',
              }}
              onFocus={e => e.target.style.borderColor = '#FF6BAA'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.12)'}
            />
          </div>

          {/* CTA */}
          <button disabled={!valid} className="tap" style={{
            marginTop:18, width:'100%', padding:'14px 0', borderRadius:12,
            background: valid ? 'linear-gradient(135deg,#FF1F8F,#FF6BAA)' : 'rgba(255,255,255,.06)',
            color: valid ? '#fff' : 'rgba(255,255,255,.3)',
            fontSize:13, fontWeight:900, letterSpacing:'.04em',
            border: valid ? 'none' : '1px solid rgba(255,255,255,.08)',
            cursor: valid ? 'pointer' : 'not-allowed',
            transition:'all .2s ease', textTransform:'uppercase',
          }}>{valid ? 'Sign in to Control Center' : '모든 항목 입력'}</button>

          {/* 보안 정책 */}
          <div style={{ marginTop:18, fontSize:10, color:'rgba(255,255,255,.4)', lineHeight:1.6, paddingTop:14, borderTop:'1px solid rgba(255,255,255,.06)' }}>
            <div style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:8 }}>
              <span>•</span><span>회사 VPN 또는 등록된 IP에서만 접근 가능</span>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:8 }}>
              <span>•</span><span>5회 실패 시 계정 잠금 · 슈퍼관리자 승인 필요</span>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
              <span>•</span><span>접근 기록: <span className="mono">audit.holdemnow.com</span></span>
            </div>
          </div>

          {/* URL 표시 */}
          <div style={{ marginTop:18, textAlign:'center' }}>
            <div className="mono" style={{ fontSize:10, color:'rgba(255,255,255,.3)', letterSpacing:'.04em' }}>
              platform.holdemnow.com / signin
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// auth용 push animation + spinner
if (!document.getElementById('__auth-push-style')) {
  const s = document.createElement('style');
  s.id = '__auth-push-style';
  s.textContent = `
    @keyframes authPushIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
    @keyframes authSpin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(s);
}

// 로그인 페이지용 SNS 아이콘
function KakaoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3C6.48 3 2 6.48 2 10.8c0 2.85 1.92 5.36 4.8 6.78l-1.2 4.42 5.12-3.4c.42.06.84.1 1.28.1 5.52 0 10-3.48 10-7.8S17.52 3 12 3z"/>
    </svg>
  );
}
function NaverIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.273 12.845L7.376 0H0v24h7.726V11.155L16.624 24H24V0h-7.727z"/>
    </svg>
  );
}
function AppleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
  );
}

// 간단한 커스텀 체크박스
function Checkbox({ checked, onChange, small }) {
  const sz = small ? 18 : 22;
  return (
    <span onClick={(e) => { e.preventDefault(); onChange && onChange(!checked); }} style={{
      width:sz, height:sz, borderRadius:99, display:'flex', alignItems:'center', justifyContent:'center',
      background: checked ? 'var(--brand)' : 'var(--bg)',
      border: `1.5px solid ${checked ? 'var(--brand)' : 'var(--border-strong)'}`,
      flexShrink:0, cursor:'pointer', transition:'all .15s ease',
    }}>
      {checked && (
        <svg width={sz*0.55} height={sz*0.55} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
    </span>
  );
}

Object.assign(window, { StoreAdmin, PlatformAdmin, TVDisplay, AuthScreen, PlatformLoginScreen, StoreLoginScreen });

// ── 매장 사장 로그인 — 별도 phone 래퍼 ─────────────────
function StoreLoginScreen() {
  return (
    <div className="phone" style={{ background:'var(--bg)', overflow:'hidden', display:'flex', flexDirection:'column' }}>
      <StoreAuth onBack={null} />
    </div>
  );
}
