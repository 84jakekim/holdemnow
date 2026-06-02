'use client';

/**
 * /landing — HoldemNow 사전등록 랜딩페이지
 *
 * 출처: Claude Design 핸드오프 번들 "pink-rabbit" (랜딩페이지.html + landing-*.jsx)을
 *       Next.js 클라이언트 페이지로 충실히 포팅. 프로토타입의 인라인 스타일·키프레임·
 *       반응형 CSS 변수(--cols/--hub-cols/--pe-cols)를 그대로 재현.
 *
 * 구조: Hero → TrustStrip → FeatureShowcase(4대 킬러기능) → PlayerExperience →
 *       PreRegHub(매장 등록 카드 + 플레이어 알림폼) → StepsSection → Footer
 *
 * 실연동:
 *   - "매장 등록 신청" CTA(히어로/쇼케이스/허브/푸터) → 실제 가입 /signup/store
 *     (사업자번호·본사 승인 심사까지 이어지는 실제 흐름)
 *   - 플레이어 "출시 알림" 폼 → 토스트 + 대기 카운터(프로토타입 동작). 리드 영구저장은 후속.
 *
 * 공개 페이지: /m·/admin·/platform 외 경로라 AuthGate 미적용 → 비로그인 접근 가능.
 */

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, addDoc, doc, onSnapshot, serverTimestamp } from 'firebase/firestore';

const APPLY_HREF = '/signup/store';

// 랜딩 실시간 카운터 — 본사 대시보드(/platform/prereg)가 meta/landingStats에 집계 기록.
// 표시값 = 기준 오프셋(baseStoreCount/baseLeadCount, 본사가 조절) + 실제(storeCount/leadCount).
//   → 초반 실데이터가 적어도 사회적 증거용 기준값을 깔고, 신청이 쌓일수록 실제분이 가산됨.
// 미존재 시 null → 폴백 표기.
interface LandingStats { storeCount: number; leadCount: number; }
function useLandingStats(): LandingStats | null {
  const [stats, setStats] = useState<LandingStats | null>(null);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'meta', 'landingStats'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setStats({
            storeCount: Number(d.storeCount ?? 0) + Number(d.baseStoreCount ?? 0),
            leadCount: Number(d.leadCount ?? 0) + Number(d.baseLeadCount ?? 0),
          });
        } else {
          setStats(null);
        }
      },
      () => setStats(null),
    );
    return unsub;
  }, []);
  return stats;
}

// ─────────────────────────────────────────────────────────────
// SVG 토끼 마크
// ─────────────────────────────────────────────────────────────
function HNMark({ size = 48, variant = 'badge' }: { size?: number; variant?: 'badge' | 'mark' }) {
  const inner = '#FFB3D4';
  if (variant === 'mark') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-label="HoldemNow">
        <ellipse cx="22" cy="20" rx="4.8" ry="11" fill="#FF1F8F" transform="rotate(-12 22 20)" />
        <ellipse cx="42" cy="20" rx="4.8" ry="11" fill="#FF1F8F" transform="rotate(12 42 20)" />
        <circle cx="32" cy="42" r="14" fill="#FF1F8F" />
        <ellipse cx="27" cy="40.5" rx="1.8" ry="2.4" fill="#fff" />
        <ellipse cx="37" cy="40.5" rx="1.8" ry="2.4" fill="#fff" />
      </svg>
    );
  }
  const id = 'hn' + size;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="HoldemNow">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF1F8F" />
          <stop offset="100%" stopColor="#FF6BAA" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={size >= 56 ? 18 : 14} fill={`url(#${id})`} />
      <ellipse cx="22" cy="20" rx="4.8" ry="11" fill="#fff" transform="rotate(-12 22 20)" />
      <ellipse cx="22" cy="22" rx="1.9" ry="6.5" fill={inner} transform="rotate(-12 22 22)" />
      <ellipse cx="42" cy="20" rx="4.8" ry="11" fill="#fff" transform="rotate(12 42 20)" />
      <ellipse cx="42" cy="22" rx="1.9" ry="6.5" fill={inner} transform="rotate(12 42 22)" />
      <circle cx="32" cy="42" r="14" fill="#fff" />
      <circle cx="23" cy="46" r="2" fill={inner} opacity=".8" />
      <circle cx="41" cy="46" r="2" fill={inner} opacity=".8" />
      <ellipse cx="27" cy="40.5" rx="1.8" ry="2.4" fill="#FF1F8F" />
      <ellipse cx="37" cy="40.5" rx="1.8" ry="2.4" fill="#FF1F8F" />
      <circle cx="27.5" cy="40" r=".7" fill="#fff" />
      <circle cx="37.5" cy="40" r=".7" fill="#fff" />
      <ellipse cx="32" cy="45.4" rx="1.4" ry="1" fill="#FF1F8F" />
      <path d="M32 46.6 Q32 48.4 30.3 48.6 M32 46.6 Q32 48.4 33.7 48.6" stroke="#FF1F8F" strokeWidth="1.1" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// 스크롤 페이드인
// ─────────────────────────────────────────────────────────────
function Reveal({ children, delay = 0, style = {} }: {
  children: React.ReactNode; delay?: number; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setShown(true); io.unobserve(el); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{
      ...style,
      opacity: shown ? 1 : 0,
      transform: shown ? 'translateY(0)' : 'translateY(22px)',
      transition: `opacity .7s cubic-bezier(.2,.8,.2,1) ${delay}s, transform .7s cubic-bezier(.2,.8,.2,1) ${delay}s`,
    }}>{children}</div>
  );
}

// ─────────────────────────────────────────────────────────────
// 토스트
// ─────────────────────────────────────────────────────────────
function useToast(): [(msg: string) => void, React.ReactNode] {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(id);
  }, [toast]);
  const node = toast ? (
    <div style={{
      position: 'fixed', bottom: 'calc(24px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, maxWidth: 'min(92vw, 440px)', background: '#0E1525', color: '#fff', borderRadius: 16,
      padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 12px 40px rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.08)',
      animation: 'lpToastIn .35s cubic-bezier(.2,.8,.2,1)',
    }}>
      <span style={{ width: 30, height: 30, borderRadius: 99, flexShrink: 0, background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>🐰</span>
      <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.45 }}>{toast}</div>
    </div>
  ) : null;
  return [setToast, node];
}

// ═══════════════════════════════════════════════ HERO
function Hero({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  const suits = [
    { s: '♠', x: '8%', y: '20%', size: 46, rot: -14, op: .1, d: '0s', pink: false },
    { s: '♥', x: '82%', y: '14%', size: 38, rot: 12, op: .14, d: '.6s', pink: true },
    { s: '♦', x: '88%', y: '64%', size: 30, rot: -8, op: .1, d: '1.1s', pink: true },
    { s: '♣', x: '12%', y: '72%', size: 40, rot: 16, op: .09, d: '.3s', pink: false },
  ];
  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: 'var(--navy)', color: '#fff' }}>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-12%', right: '-18%', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,31,143,.42) 0%, transparent 66%)', filter: 'blur(6px)' }} />
        <div style={{ position: 'absolute', bottom: '-22%', left: '-22%', width: 380, height: 380, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,.32) 0%, transparent 66%)' }} />
        {suits.map((c, i) => (
          <div key={i} style={{ position: 'absolute', left: c.x, top: c.y, fontSize: c.size, color: c.pink ? 'var(--brand)' : '#fff', opacity: c.op, transform: `rotate(${c.rot}deg)`, animation: 'lpFloat 5s ease-in-out infinite', animationDelay: c.d }}>{c.s}</div>
        ))}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)', backgroundSize: '44px 44px', maskImage: 'radial-gradient(ellipse 80% 70% at 50% 30%, black, transparent)', WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 30%, black, transparent)' }} />
      </div>

      <nav style={{ position: 'relative', maxWidth: 1040, margin: '0 auto', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <HNMark size={36} />
        <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-.02em' }}>HoldemNow</span>
        <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 99, background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.14)', letterSpacing: '.06em', marginLeft: 2 }}>BETA</span>
        <button onClick={() => onScrollTo('prereg')} className="tap" style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 800, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.16)', color: '#fff', cursor: 'pointer', backdropFilter: 'blur(8px)' }}>사전등록</button>
      </nav>

      <div style={{ position: 'relative', maxWidth: 1040, margin: '0 auto', padding: '40px 20px 56px', textAlign: 'center' }}>
        <Reveal>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 99, background: 'rgba(255,31,143,.14)', border: '1px solid rgba(255,31,143,.3)', marginBottom: 22 }}>
            <span className="badge-live"><span className="dot" />사전등록 OPEN</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#FFC7E2' }}>정식 출시 전 한정 혜택</span>
          </div>
        </Reveal>
        <Reveal delay={.08}>
          <h1 style={{ margin: 0, fontSize: 'clamp(32px, 8vw, 56px)', fontWeight: 900, letterSpacing: '-.035em', lineHeight: 1.08 }}>
            전국 홀덤펍,<br />
            이제 <span style={{ background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', whiteSpace: 'nowrap' }}>실시간</span>으로 본다
          </h1>
        </Reveal>
        <Reveal delay={.16}>
          <p style={{ margin: '20px auto 0', maxWidth: 480, fontSize: 'clamp(14px, 3.6vw, 17px)', fontWeight: 500, color: 'rgba(255,255,255,.72)', lineHeight: 1.6 }}>
            어느 매장이 지금 게임 도는지, 토너는 언제 시작하는지 — 앱 하나로. 정식 출시 전 <b style={{ color: '#fff' }}>사전등록</b> 진행 중입니다.
          </p>
        </Reveal>
        <Reveal delay={.24}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 30, flexWrap: 'wrap' }}>
            <Link href={APPLY_HREF} className="tap" style={{ padding: '15px 26px', borderRadius: 14, fontSize: 15, fontWeight: 900, letterSpacing: '-.01em', background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 8px 26px rgba(255,31,143,.42)', display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
              🏪 매장 사장님 등록
            </Link>
            <button onClick={() => onScrollTo('prereg')} className="tap" style={{ padding: '15px 26px', borderRadius: 14, fontSize: 15, fontWeight: 900, letterSpacing: '-.01em', background: 'rgba(255,255,255,.1)', color: '#fff', border: '1.5px solid rgba(255,255,255,.22)', cursor: 'pointer', backdropFilter: 'blur(8px)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              🔔 출시 알림 받기
            </button>
          </div>
        </Reveal>
        <Reveal delay={.32}>
          <div style={{ marginTop: 48, display: 'flex', justifyContent: 'center' }}>
            <HeroPhonePeek />
          </div>
        </Reveal>
      </div>

      <div style={{ position: 'relative', height: 40, background: 'var(--paper)', borderRadius: '32px 32px 0 0', marginTop: -8 }} />
    </section>
  );
}

function HeroPhonePeek() {
  return (
    <div style={{ width: 'min(320px, 84vw)', borderRadius: 22, overflow: 'hidden', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', backdropFilter: 'blur(20px)', boxShadow: '0 24px 60px rgba(0,0,0,.4)', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 12px' }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--live)', animation: 'pulse 1.6s infinite' }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>지금 LIVE · 6곳</span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,.5)' }}>내 주변</span>
      </div>
      <div style={{ borderRadius: 14, overflow: 'hidden', position: 'relative', aspectRatio: '16/10', background: 'linear-gradient(135deg,#9F1239,#BE185D,#581C87)' }}>
        <div style={{ position: 'absolute', top: 10, left: 10 }}><span className="badge-live"><span className="dot" />LIVE</span></div>
        <div style={{ position: 'absolute', bottom: 10, left: 12, right: 12, color: '#fff' }}>
          <div style={{ fontSize: 10, fontWeight: 700, opacity: .85 }}>물금 VIP홀덤펍 · 양산</div>
          <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: '-.02em' }}>데일리 히든에이스 30T</div>
          <div className="mono" style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, fontWeight: 700 }}>
            <span>⏱ 09:14</span><span>Lv 6</span><span>👥 24/30</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════ TRUST STRIP
function TrustStrip({ stats }: { stats: LandingStats | null }) {
  const items = [
    { n: stats ? stats.storeCount.toLocaleString() : '47', l: '사전등록 매장' },
    { n: stats ? `${stats.leadCount.toLocaleString()}+` : '1,280+', l: '출시 대기 유저' },
    { n: '전국', l: '서비스 지역' },
    { n: '100%', l: '사업자 인증' },
  ];
  return (
    <div style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '22px 20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {items.map((it, i) => (
          <Reveal key={it.l} delay={i * .06} style={{ textAlign: 'center' }}>
            <div className="mono" style={{ fontSize: 'clamp(18px, 5vw, 26px)', fontWeight: 900, letterSpacing: '-.02em', color: 'var(--brand)' }}>{it.n}</div>
            <div style={{ fontSize: 'clamp(10px, 2.6vw, 12px)', fontWeight: 700, color: 'var(--ink-2)', marginTop: 3 }}>{it.l}</div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════ FEATURE SHOWCASE
function FeatureRow({ flip, badge, badgeColor, title, body, points, visual }: {
  flip: boolean; badge: string; badgeColor: string; title: string; body: string; points: string[]; visual: React.ReactNode;
}) {
  return (
    <Reveal>
      <div className="feature-row" style={{ background: '#fff', borderRadius: 22, border: '1px solid var(--line)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', display: 'grid', gridTemplateColumns: 'var(--cols, 1fr)', alignItems: 'stretch' }}>
        <div style={{ order: flip ? 2 : 1, background: 'linear-gradient(160deg, #0E1525, #1E293B)', padding: '26px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 230, position: 'relative', overflow: 'hidden' }}>
          <div aria-hidden="true" style={{ position: 'absolute', top: '-30%', right: '-20%', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,31,143,.3), transparent 65%)' }} />
          <div style={{ position: 'relative' }}>{visual}</div>
        </div>
        <div style={{ order: flip ? 1 : 2, padding: '24px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', padding: '4px 10px', borderRadius: 99, background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`, color: badgeColor, marginBottom: 12 }}>{badge}</span>
          <div style={{ fontSize: 'clamp(19px, 5vw, 23px)', fontWeight: 900, letterSpacing: '-.025em', lineHeight: 1.25, color: 'var(--ink-1)' }}>{title}</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 10, lineHeight: 1.62 }}>{body}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
            {points.map((p) => (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 18, height: 18, borderRadius: 99, flexShrink: 0, background: 'var(--brand-pale)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900 }}>✓</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function LiveAlertMock() {
  return (
    <div style={{ width: 230, position: 'relative' }}>
      <div style={{ borderRadius: 22, overflow: 'hidden', background: 'linear-gradient(170deg,#6366F1,#A855F7,#EC4899)', padding: '18px 12px 22px', boxShadow: '0 16px 40px rgba(0,0,0,.4)' }}>
        <div style={{ textAlign: 'center', color: '#fff', marginBottom: 14 }}>
          <div className="mono" style={{ fontSize: 11, fontWeight: 700, opacity: .85 }}>금요일 9월 26일</div>
          <div className="mono" style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.1 }}>9:41</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,.92)', borderRadius: 14, padding: '10px 11px', display: 'flex', gap: 9, alignItems: 'flex-start', boxShadow: '0 6px 18px rgba(0,0,0,.18)', animation: 'lpFloat 4s ease-in-out infinite' }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HNMark size={24} variant="mark" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#0E1525' }}>HoldemNow</span>
              <span className="badge-live" style={{ fontSize: 8, padding: '1px 5px' }}><span className="dot" style={{ width: 4, height: 4 }} />LIVE</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, color: '#98A1B2' }}>지금</span>
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#0E1525', marginTop: 3, lineHeight: 1.4 }}>🔴 즐겨찾기 매장에서 게임이 시작됐어요!</div>
            <div style={{ fontSize: 10.5, color: '#5A6478', marginTop: 2 }}>지금 데일리 30T 참가자 모집 중 · 24/30</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TVMock() {
  const [s, setS] = useState(554);
  useEffect(() => {
    const id = setInterval(() => setS((v) => (v > 0 ? v - 1 : 600)), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const rows: [string, string, boolean?][] = [['5', '800/1.5k'], ['6', '1k/2k', true], ['7', '1.5k/3k'], ['B', '☕ BREAK'], ['9', '2k/4k']];
  return (
    <div style={{ width: 280, borderRadius: 14, overflow: 'hidden', background: '#0A0D12', border: '3px solid #1A1F2A', boxShadow: '0 16px 40px rgba(0,0,0,.5)' }}>
      <div style={{ aspectRatio: '16/9', display: 'grid', gridTemplateColumns: '78px 1fr', gap: 8, padding: 10 }}>
        <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: '7px 6px' }}>
          <div style={{ fontSize: 6.5, fontWeight: 800, color: 'rgba(255,255,255,.4)', letterSpacing: '.12em' }}>STRUCTURE</div>
          <div className="mono" style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 5, fontSize: 6.5 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 4px', borderRadius: 3, background: r[2] ? 'rgba(255,31,143,.18)' : 'transparent', color: r[2] ? '#FF6BAA' : r[1].includes('BREAK') ? '#F59E0B' : 'rgba(255,255,255,.55)', fontWeight: r[2] ? 800 : 500 }}>
                <span>{r[0]}</span><span>{r[1]}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#fff' }}>
          <div style={{ fontSize: 7, fontWeight: 800, color: 'rgba(255,255,255,.4)', letterSpacing: '.12em' }}>LEVEL 6 · BLINDS</div>
          <div className="mono" style={{ fontSize: 52, fontWeight: 800, lineHeight: 1, color: '#FF1F8F', textShadow: '0 3px 18px rgba(255,31,143,.5)', letterSpacing: '-.02em' }}>{mm}:{ss}</div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 800, marginTop: 3 }}>1,000 / 2,000</div>
          <div className="mono" style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 7, color: 'rgba(255,255,255,.6)' }}>
            <span>👥 24/30</span><span style={{ color: '#F59E0B' }}>LATE 42:18</span><span>💰 1.1M</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShoutMock() {
  return (
    <div style={{ width: 240, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: 120, height: 92, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ position: 'absolute', width: 56 + i * 26, height: 56 + i * 26, borderRadius: '50%', border: '2px solid rgba(255,31,143,.45)', opacity: 0, animation: 'shoutRing 2.4s ease-out infinite', animationDelay: `${i * .5}s` }} />
        ))}
        <div style={{ width: 50, height: 50, borderRadius: 15, background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, boxShadow: '0 8px 22px rgba(255,31,143,.5)', position: 'relative', zIndex: 1 }}>📢</div>
      </div>
      <div className="mono" style={{ fontSize: 9, fontWeight: 800, color: '#FF6BAA', letterSpacing: '.06em', marginBottom: 8 }}>반경 3km · 동시 외침</div>
      <div style={{ width: 232, borderRadius: 16, overflow: 'hidden', background: '#fff', boxShadow: '0 16px 40px rgba(0,0,0,.35)' }}>
        <div style={{ padding: '8px 11px', borderBottom: '1px solid #EEF0F4', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11 }}>📡</span>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#0E1525' }}>내 주변 외침</span>
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 8.5, color: '#98A1B2' }}>방금</span>
        </div>
        <div style={{ padding: '11px', background: '#F7F8FA' }}>
          <div style={{ display: 'flex', gap: 8, animation: 'lpChipIn .4s ease' }}>
            <div style={{ width: 30, height: 30, borderRadius: 99, flexShrink: 0, background: 'linear-gradient(135deg,#fb7185,#ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>🃏</div>
            <div style={{ flex: 1, minWidth: 0, background: '#fff', border: '1px solid #FFC9DE', borderRadius: '12px 12px 12px 4px', padding: '9px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                <span style={{ fontSize: 7.5, fontWeight: 800, padding: '1px 5px', borderRadius: 4, background: 'var(--brand)', color: '#fff', letterSpacing: '.04em' }}>📢 외침</span>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: '#0E1525' }}>원더카드클럽</span>
                <span style={{ fontSize: 8, color: '#98A1B2' }}>· 0.8km</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', letterSpacing: '-.01em', lineHeight: 1.4 }}>오늘 밤 9시 30T OPEN! 🎲</div>
              <div style={{ fontSize: 9.5, color: '#5A6478', marginTop: 2 }}>바이인 3만 · GTD 100만 · 자리 6개 남음</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlMock() {
  const [running, setRunning] = useState(true);
  const [s, setS] = useState(554);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setS((v) => (v > 0 ? v - 1 : 600)), 1000);
    return () => clearInterval(id);
  }, [running]);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const stats: [string, string][] = [['24/30', 'PLAYERS'], ['7', 'REBUY'], ['1.1M', 'PRIZE']];
  return (
    <div style={{ width: 200, borderRadius: 26, overflow: 'hidden', background: '#0F1419', border: '5px solid #000', boxShadow: '0 16px 40px rgba(0,0,0,.5)' }}>
      <div style={{ padding: '14px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span className="badge-live" style={{ fontSize: 8, padding: '2px 6px' }}><span className="dot" style={{ width: 4, height: 4 }} />LIVE</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>데일리 30T</span>
        </div>
        <div style={{ background: 'linear-gradient(135deg,rgba(255,31,143,.15),rgba(255,31,143,.04))', border: '1px solid rgba(255,31,143,.3)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 7, fontWeight: 700, color: 'rgba(255,255,255,.4)', letterSpacing: '.14em' }}>LEVEL 6 · BLINDS</div>
          <div className="mono" style={{ fontSize: 42, fontWeight: 800, lineHeight: 1, color: '#FF1F8F', marginTop: 3 }}>{mm}:{ss}</div>
          <div className="mono" style={{ fontSize: 11, fontWeight: 800, color: '#fff', marginTop: 4 }}>1,000 / 2,000</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
            <button onClick={() => setRunning((r) => !r)} style={{ padding: '7px', borderRadius: 8, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', color: '#fff', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}>{running ? '⏸ 정지' : '▶ 재개'}</button>
            <button style={{ padding: '7px', borderRadius: 8, background: 'rgba(245,158,11,.18)', border: '1px solid rgba(245,158,11,.4)', color: '#fff', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}>☕ BREAK</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5, marginTop: 8 }}>
          {stats.map((x, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,.05)', borderRadius: 8, padding: '6px 2px', textAlign: 'center', border: '1px solid rgba(255,255,255,.06)' }}>
              <div className="mono" style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{x[0]}</div>
              <div style={{ fontSize: 6, color: 'rgba(255,255,255,.5)', letterSpacing: '.06em', marginTop: 1, fontWeight: 700 }}>{x[1]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureShowcase() {
  const benefits = [
    { icon: '🆓', t: '노출 무료', d: '지금 등록 시 앱 상단 노출 비용 0원' },
    { icon: '📊', t: '손님 분석', d: '단골·예약·후기를 한눈에' },
    { icon: '⭐', t: '리뷰 관리', d: '손님 리뷰에 답글·관리로 신뢰 UP' },
    { icon: '🧑‍🍳', t: '딜러 채용', d: '커뮤니티로 딜러·매니저 모집' },
    { icon: '✅', t: '인증 매장', d: '사업자 인증으로 신뢰도 UP' },
  ];
  return (
    <section style={{ background: 'var(--paper)', padding: '56px 20px 20px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <Reveal style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 99, background: 'var(--brand-pale)', color: 'var(--brand-dim)', fontSize: 11.5, fontWeight: 800, marginBottom: 14 }}>
            ⚡ 사장님이 먼저 등록하는 이유
          </div>
          <h2 style={{ margin: 0, fontSize: 'clamp(24px, 6.4vw, 36px)', fontWeight: 900, letterSpacing: '-.03em', lineHeight: 1.18, color: 'var(--ink-1)' }}>
            전단지·입소문 시대는 끝.<br />
            <span style={{ color: 'var(--brand)' }}>매장 운영이 통째로 디지털</span>로.
          </h2>
          <p style={{ margin: '14px auto 0', maxWidth: 460, fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            손님 모으기부터 토너 운영, 단골 관리까지 — 따로 돈 들이던 걸 앱 하나로 해결합니다.
          </p>
        </Reveal>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 36 }}>
          <FeatureRow flip={false} badge="대표 기능" badgeColor="var(--live)"
            title="게임 켜면, 단골 폰에 자동 알림"
            body="손님이 즐겨찾기한 매장에 게임이 열리면 푸시가 갑니다. 전단지 100장보다 강력한 실시간 LIVE 홍보. 빈 테이블을 손님으로 채우세요."
            points={['즐겨찾기 손님에게 자동 푸시', '게임 ON/OFF만 누르면 끝', '도달률·반응 실시간 확인']}
            visual={<LiveAlertMock />} />
          <FeatureRow flip badge="무료 제공" badgeColor="var(--success)"
            title="매장 TV가 프로 토너 전광판으로"
            body="TV만 연결하면 블라인드 타이머·구조표·프라이즈풀이 뜨는 디지털 전광판이 됩니다. 수십만원짜리 토너 시계 장비, 앱으로 무료."
            points={['거대 타이머 + 자동 레벨업', 'BREAK·Late Reg 자동 표시', '매장 광고도 함께 송출']}
            visual={<TVMock />} />
          <FeatureRow flip={false} badge="외침 메시지" badgeColor="var(--brand)"
            title="외침 한 번에, 근처 손님 모두에게"
            body="매장 소식을 '외침'으로 띄우면 반경 내 유저 피드에 바로 띄워요. 전단지 돌릴 필요 없이, 동네 홀덤러에게 한 번에 닿습니다."
            points={['반경 내 유저 피드에 즉시 노출', '데일리·시리즈·이벤트 외침', '외침 도달 · 반응 실시간 확인']}
            visual={<ShoutMock />} />
          <FeatureRow flip badge="운영 자동화" badgeColor="#7C3AED"
            title="토너 운영, 폰 하나로 컨트롤"
            body="타이머·블라인드·리바이·참가자까지 한 손에. 종이 구조표와 수동 계산은 그만. 딜러도 사장님도 운영이 편해집니다."
            points={['원터치 일시정지·BREAK', '리바이/애드온 집계 자동', '실시간 프라이즈풀 계산']}
            visual={<ControlMock />} />
        </div>

        <Reveal>
          <div style={{ marginTop: 26, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {benefits.map((b) => (
              <div key={b.t} style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--line)', padding: '16px 14px', boxShadow: 'var(--shadow-card)' }}>
                <div style={{ fontSize: 22 }}>{b.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-.02em', marginTop: 8, color: 'var(--ink-1)' }}>{b.t}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.5 }}>{b.d}</div>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal>
          <div style={{ textAlign: 'center', marginTop: 30 }}>
            <Link href={APPLY_HREF} className="tap" style={{ padding: '15px 30px', borderRadius: 14, fontSize: 15.5, fontWeight: 900, letterSpacing: '-.01em', background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 8px 26px rgba(255,31,143,.4)', display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>이 모든 걸 무료로 시작하기 →</Link>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>베타 서비스 출시 시 알려드립니다</div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════ PLAYER EXPERIENCE
function TournamentMock() {
  const list = [
    { e: '🃏', grad: 'linear-gradient(135deg,#34d399,#059669)', name: '데일리 히든에이스 30T', time: '21:00', buy: '3만', seat: '6석', join: true, sel: true },
    { e: '🎰', grad: 'linear-gradient(135deg,#fbbf24,#ea580c)', name: 'ROYAL CUP Day1', time: '22:30', buy: '5만', seat: '12석', join: true, sel: false },
    { e: '🥃', grad: 'linear-gradient(135deg,#60a5fa,#4338ca)', name: '평일 새틀라이트', time: '23:00', buy: '1만', seat: '마감임박', join: false, sel: false },
  ];
  const detail: [string, string][] = [['바이인', '30,000'], ['시작 스택', '30,000'], ['블라인드', '20분 레벨'], ['GTD', '100만'], ['Late Reg', 'Lv 8까지'], ['좌석', '24/30 · 6남음']];
  return (
    <div style={{ width: 248, borderRadius: 28, overflow: 'hidden', background: '#fff', border: '6px solid #0A0F1A', boxShadow: '0 22px 50px rgba(0,0,0,.5)' }}>
      <div style={{ background: 'linear-gradient(120deg,#FF1F8F,#FF6BAA)', padding: '12px 14px', color: '#fff' }}>
        <div style={{ fontSize: 9, fontWeight: 700, opacity: .9 }}>내 주변 · 0.8km</div>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-.02em' }}>오늘 참가 가능 토너</div>
      </div>
      <div style={{ padding: '10px 10px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.map((t, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 10, background: t.sel ? 'var(--brand-pale)' : '#F7F8FA', border: `1px solid ${t.sel ? '#FFC9DE' : '#EEF0F4'}` }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: t.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{t.e}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#0E1525', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
              <div className="mono" style={{ fontSize: 8.5, color: '#5A6478', marginTop: 1 }}>{t.time} · 바이인 {t.buy}</div>
            </div>
            <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 5, background: t.join ? 'rgba(16,185,129,.14)' : 'rgba(229,62,62,.12)', color: t.join ? '#047857' : '#E53E3E', whiteSpace: 'nowrap' }}>{t.join ? '참가가능' : t.seat}</span>
          </div>
        ))}
      </div>
      <div style={{ margin: '6px 10px 12px', borderRadius: 12, border: '1px solid #FFC9DE', overflow: 'hidden' }}>
        <div style={{ background: 'var(--brand-pale)', padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 900, color: '#0E1525' }}>데일리 히든에이스 30T</span>
          <span style={{ marginLeft: 'auto', fontSize: 7.5, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'var(--brand)', color: '#fff' }}>경기정보</span>
        </div>
        <div style={{ padding: '9px 11px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 8px' }}>
          {detail.map((r, i) => (
            <div key={i}>
              <div style={{ fontSize: 7.5, fontWeight: 700, color: '#98A1B2', letterSpacing: '.04em' }}>{r[0]}</div>
              <div className="mono" style={{ fontSize: 10.5, fontWeight: 800, color: '#0E1525', marginTop: 1 }}>{r[1]}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '0 11px 11px' }}>
          <div style={{ padding: '9px 0', borderRadius: 9, background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', color: '#fff', fontSize: 11, fontWeight: 900, textAlign: 'center', boxShadow: '0 4px 12px rgba(255,31,143,.3)' }}>참가 신청하기</div>
        </div>
      </div>
    </div>
  );
}

function PlayerExperience() {
  const items = [
    { icon: '🗺️', t: '실시간 지도 탐색', d: '지금 게임 도는 매장을 지도에서 한눈에. 가까운 순·LIVE 순으로.' },
    { icon: '📡', t: '내 주변 외침 피드', d: '근처 매장이 띄운 외침이 피드로. 오늘 어디서 칠지 바로 결정.' },
    { icon: '🎟️', t: '게임 참가 예약', d: '원터치로 토너 좌석을 미리 예약. 마감 전 자리를 확보하세요.' },
    { icon: '🔴', t: 'LIVE 토너 직관', d: '블라인드·남은 시간·참가자·프라이즈풀을 실시간으로 확인.' },
    { icon: '⭐', t: '리뷰 작성·확인', d: '다녀온 매장 리뷰를 남기고, 다른 손님 후기도 참고하세요.' },
    { icon: '📅', t: '캘린더 알림', d: '데일리·시리즈 일정을 모아보고 즐겨찾기로 알림 받기.' },
  ];
  const checks = ['참가 가능 여부·남은 좌석 실시간', '바이인·스택·GTD·프라이즈 구조 확인', '원터치 게임 참가 예약 · 좌석 확보', '다녀온 뒤 리뷰 작성·평점 확인'];
  return (
    <section style={{ background: 'var(--navy)', color: '#fff', padding: '54px 20px 58px', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden="true" style={{ position: 'absolute', bottom: '-20%', right: '-15%', width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,.28), transparent 66%)' }} />
      <div style={{ position: 'relative', maxWidth: 900, margin: '0 auto' }}>
        <Reveal style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 99, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.16)', fontSize: 11.5, fontWeight: 800, marginBottom: 14 }}>
            🙋 플레이어에게는
          </div>
          <h2 style={{ margin: 0, fontSize: 'clamp(23px, 6vw, 34px)', fontWeight: 900, letterSpacing: '-.03em', lineHeight: 1.18 }}>
            &ldquo;오늘 어디서 치지?&rdquo;<br /><span style={{ background: 'linear-gradient(135deg,#FF6BAA,#FF1F8F)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>고민이 사라집니다</span>
          </h2>
          <p style={{ margin: '14px auto 0', maxWidth: 440, fontSize: 14, color: 'rgba(255,255,255,.7)', lineHeight: 1.6 }}>
            손님이 앱을 즐겨 쓸수록, 우리 매장이 더 자주 보입니다.
          </p>
        </Reveal>

        <Reveal>
          <div className="pe-lead" style={{ display: 'grid', gridTemplateColumns: 'var(--pe-cols, 1fr)', gap: 24, alignItems: 'center', marginBottom: 30 }}>
            <div style={{ display: 'flex', justifyContent: 'center', order: 1 }}>
              <TournamentMock />
            </div>
            <div style={{ order: 2 }}>
              <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', padding: '4px 10px', borderRadius: 99, background: 'rgba(255,31,143,.16)', color: '#FF6BAA', marginBottom: 12 }}>참가 가능 토너 · 경기 정보</span>
              <div style={{ fontSize: 'clamp(20px, 5vw, 25px)', fontWeight: 900, letterSpacing: '-.025em', lineHeight: 1.25 }}>
                지금 참가 가능한 토너,<br />상세 정보까지 한눈에
              </div>
              <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.7)', marginTop: 10, lineHeight: 1.62 }}>
                내 주변에서 지금/오늘 참가할 수 있는 토너를 모아보고, 바이인·스택·블라인드 구조·프라이즈풀·Late Reg·남은 좌석까지 경기 정보를 확인하세요.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                {checks.map((p) => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 99, flexShrink: 0, background: 'rgba(255,31,143,.2)', color: '#FF6BAA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900 }}>✓</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 12 }}>
          {items.map((it, i) => (
            <Reveal key={it.t} delay={i * .07}>
              <div style={{ height: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: '18px 16px', backdropFilter: 'blur(8px)' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{it.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-.02em', marginTop: 12 }}>{it.t}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.65)', marginTop: 6, lineHeight: 1.55 }}>{it.d}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════ PRE-REG HUB
function PreRegHub({ onToast, stats }: { onToast: (msg: string) => void; stats: LandingStats | null }) {
  const [storeName, setStoreName] = useState('');
  const [tel, setTel] = useState('');
  // 표시 대기 수: 실데이터(leadCount) 우선, 미동기화 시 1,280 폴백. 제출 시 낙관적 +1.
  const [bump, setBump] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const waiting = (stats ? stats.leadCount : 1280) + bump;

  const notify = async (e: React.FormEvent) => {
    e.preventDefault();
    const telOk = tel.replace(/\D/g, '').length >= 9;
    if (!storeName.trim()) { onToast('자주 가는 매장명을 입력해 주세요'); return; }
    if (!telOk) { onToast('연락받을 번호를 입력해 주세요'); return; }
    if (submitting) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'preRegLeads'), {
        type: 'player',
        storeName: storeName.trim().slice(0, 100),
        phone: tel.trim().slice(0, 30),
        source: 'landing',
        createdAt: serverTimestamp(),
      });
      setBump((b) => b + 1);
      setStoreName(''); setTel('');
      onToast('신청 완료! 출시되면 가장 먼저 알려드릴게요 🔔');
    } catch {
      onToast('잠시 후 다시 시도해 주세요 🙏');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="prereg" style={{ background: 'var(--paper)', padding: '56px 20px 60px', scrollMarginTop: 12 }}>
      <div style={{ maxWidth: 940, margin: '0 auto' }}>
        <Reveal style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 99, background: 'var(--brand-pale)', color: 'var(--brand-dim)', fontSize: 12, fontWeight: 800, marginBottom: 14 }}>
            <span className="badge-live"><span className="dot" />사전등록 진행 중</span> 출시 전 한정 혜택
          </div>
          <h2 style={{ margin: 0, fontSize: 'clamp(25px, 6.6vw, 36px)', fontWeight: 900, letterSpacing: '-.03em', lineHeight: 1.16, color: 'var(--ink-1)' }}>
            지금 <span style={{ color: 'var(--brand)' }}>사전등록</span>하세요
          </h2>
          <p style={{ margin: '13px auto 0', maxWidth: 460, fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            매장 사장님은 매장 등록을, 플레이어는 출시 알림을 신청하세요.
          </p>
        </Reveal>

        <div className="prereg-grid" style={{ display: 'grid', gridTemplateColumns: 'var(--hub-cols, 1fr)', gap: 16, alignItems: 'stretch' }}>
          <Reveal>
            <Link href={APPLY_HREF} className="tap" style={{ display: 'block', textDecoration: 'none', height: '100%', position: 'relative', overflow: 'hidden', borderRadius: 22, padding: '28px 24px', background: 'linear-gradient(150deg, #FF1F8F 0%, #E01077 55%, #831843 120%)', boxShadow: '0 16px 44px rgba(255,31,143,.4)', color: '#fff' }}>
              <div aria-hidden="true" style={{ position: 'absolute', top: -24, right: -18, opacity: .18 }}><HNMark size={150} variant="mark" /></div>
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 99, background: 'rgba(255,255,255,.2)', fontSize: 11, fontWeight: 800, letterSpacing: '.02em', backdropFilter: 'blur(6px)' }}>🏪 매장 사장님</div>
                <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-.025em', lineHeight: 1.2, marginTop: 16 }}>내 매장 등록 신청</div>
                <div style={{ fontSize: 13, opacity: .92, marginTop: 8, lineHeight: 1.55, maxWidth: 320 }}>TV 전광판·외침·LIVE 알림까지 — 지금 등록하면 모두 <b>무료</b>로 시작합니다.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
                  {['🆓 노출 무료', '📺 무료 전광판', '✅ 사업자 인증'].map((t) => (
                    <span key={t} style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 99, background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.2)' }}>{t}</span>
                  ))}
                </div>
                <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '15px 18px', borderRadius: 14, background: '#fff', color: 'var(--brand-dim)', boxShadow: '0 6px 18px rgba(0,0,0,.18)' }}>
                  <span style={{ fontSize: 15.5, fontWeight: 900, letterSpacing: '-.01em' }}>등록 신청하러 가기</span>
                  <span style={{ fontSize: 18, fontWeight: 900 }}>→</span>
                </div>
                <div style={{ fontSize: 11.5, opacity: .8, marginTop: 10, textAlign: 'center' }}>베타 서비스 출시 시 알려드립니다</div>
              </div>
            </Link>
          </Reveal>

          <Reveal delay={.08}>
            <div style={{ height: '100%', borderRadius: 22, padding: '24px 22px', background: 'var(--navy)', color: '#fff', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div aria-hidden="true" style={{ position: 'absolute', bottom: '-20%', right: '-15%', width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,.3), transparent 66%)' }} />
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 99, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.16)', fontSize: 11, fontWeight: 800 }}>🙋 플레이어</div>
                <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-.025em', lineHeight: 1.25, marginTop: 14 }}>출시 알림 받기</div>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.7)', marginTop: 7, lineHeight: 1.55 }}>자주 가는 매장과 번호를 남겨주세요. 출시 소식과 그 매장 입점 여부를 알려드려요.</div>

                <form onSubmit={notify} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.6)', marginBottom: 6 }}>자주 가는 매장명</div>
                    <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="예: 원더카드클럽"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.06)', color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', outline: 'none' }}
                      onFocus={(e) => (e.target.style.borderColor = '#FF6BAA')} onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,.18)')} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.6)', marginBottom: 6 }}>연락받을 번호</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="010-0000-0000" inputMode="tel"
                        style={{ flex: 1, minWidth: 0, padding: '13px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.06)', color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', outline: 'none' }}
                        onFocus={(e) => (e.target.style.borderColor = '#FF6BAA')} onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,.18)')} />
                      <button type="submit" disabled={submitting} className="tap" style={{ padding: '0 20px', borderRadius: 12, background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap', opacity: submitting ? 0.6 : 1 }}>{submitting ? '…' : '신청'}</button>
                    </div>
                  </div>
                </form>

                <div style={{ marginTop: 'auto', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,.75)' }}>
                  <div style={{ display: 'flex' }}>
                    {['#FF1F8F', '#F59E0B', '#7C3AED', '#10B981'].map((c, i) => (
                      <span key={i} style={{ width: 21, height: 21, borderRadius: 99, background: c, border: '2px solid var(--navy)', marginLeft: i ? -8 : 0, display: 'inline-block' }} />
                    ))}
                  </div>
                  현재 <b className="mono" style={{ color: '#fff' }}>{waiting.toLocaleString()}</b>명 대기 중
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════ STEPS
function StepsSection() {
  const steps = [
    { n: '1', icon: '✍️', title: '사전등록', body: '매장 사장님은 매장을, 유저는 알림을 신청해요.' },
    { n: '2', icon: '🚀', title: '정식 출시', body: '순차적으로 지역을 넓혀가며 앱이 오픈됩니다.' },
    { n: '3', icon: '🔴', title: '실시간 탐색', body: '지금 게임 도는 홀덤펍을 실시간으로 찾아요.' },
  ];
  return (
    <section style={{ background: '#fff', padding: '54px 20px 56px', borderTop: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Reveal style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 900, letterSpacing: '-.03em', color: 'var(--ink-1)' }}>이렇게 작동합니다</h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 30 }}>
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * .1}>
              <div style={{ position: 'relative', height: '100%', background: 'var(--paper)', borderRadius: 18, border: '1px solid var(--line)', padding: '24px 18px', textAlign: 'center' }}>
                <div className="mono" style={{ position: 'absolute', top: 14, right: 16, fontSize: 34, fontWeight: 900, color: 'var(--surface-3)', lineHeight: 1 }}>{s.n}</div>
                <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto', background: 'var(--brand-pale)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 27 }}>{s.icon}</div>
                <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '-.02em', marginTop: 14, color: 'var(--ink-1)' }}>{s.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 6, lineHeight: 1.55 }}>{s.body}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════ FOOTER
function Footer({ onScrollTo }: { onScrollTo: (id: string) => void }) {
  return (
    <footer style={{ background: '#0A0F1A', color: '#fff', padding: '44px 20px 36px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 }}>
          <HNMark size={40} />
          <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-.02em' }}>HoldemNow</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.8)' }}>지금, 새로운 홀덤펍 문화를 시작합니다</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 6, lineHeight: 1.6 }}>건전한 합법 홀덤펍 문화를 위한 디지털 인프라</div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' }}>
          <Link href={APPLY_HREF} className="tap" style={{ padding: '11px 18px', borderRadius: 12, fontSize: 13, fontWeight: 800, background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)', color: '#fff', border: 'none', cursor: 'pointer', textDecoration: 'none' }}>🏪 매장 등록 신청</Link>
          <button onClick={() => onScrollTo('prereg')} className="tap" style={{ padding: '11px 18px', borderRadius: 12, fontSize: 13, fontWeight: 800, background: 'rgba(255,255,255,.1)', color: '#fff', border: '1px solid rgba(255,255,255,.18)', cursor: 'pointer' }}>🔔 알림 받기</button>
        </div>

        <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 26, flexWrap: 'wrap' }}>
          <Link href="/legal/terms" style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.55)', textDecoration: 'none' }}>이용약관</Link>
          <Link href="/legal/privacy" style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.55)', textDecoration: 'none' }}>개인정보처리방침</Link>
          <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.55)', textDecoration: 'none' }}>카카오톡 문의</a>
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'rgba(255,255,255,.3)', marginTop: 22, letterSpacing: '.04em' }}>© 2026 HoldemNow · BETA</div>
      </div>
    </footer>
  );
}

// ═══════════════════════════════════════════════ PAGE
export default function LandingPage() {
  const [toast, toastNode] = useToast();
  const stats = useLandingStats();
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const y = el.getBoundingClientRect().top + window.pageYOffset - 8;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };
  return (
    <div style={{ fontFamily: "'Pretendard','Noto Sans KR',sans-serif", letterSpacing: '-.01em', background: 'var(--paper)', color: 'var(--ink-1)', overflowX: 'hidden' }}>
      <Hero onScrollTo={scrollTo} />
      <TrustStrip stats={stats} />
      <FeatureShowcase />
      <PlayerExperience />
      <PreRegHub onToast={toast} stats={stats} />
      <StepsSection />
      <Footer onScrollTo={scrollTo} />
      {toastNode}

      <style jsx global>{`
        .lp-root, :root {
          --brand:#FF1F8F; --brand-dim:#E01077; --brand-soft:#FF6BAA; --brand-pale:#FFF0F7;
          --live:#E53E3E; --gold:#F59E0B; --success:#10B981;
          --navy:#0E1525; --paper:#F7F8FA;
          --surface-2:#F1F3F6; --surface-3:#E5E7EB; --line:#E5E8EC;
          --ink-1:#0E1525; --ink-2:#5A6478; --ink-3:#98A1B2;
          --shadow-card: 0 1px 3px rgba(14,21,37,.06), 0 1px 2px rgba(14,21,37,.04);
          --shadow-float: 0 10px 30px rgba(14,21,37,.10), 0 3px 8px rgba(14,21,37,.06);
          --mono:'JetBrains Mono','SF Mono',Menlo,monospace;
        }
        .mono{ font-family:var(--mono); font-variant-numeric:tabular-nums; }
        .badge-live{ display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:999px; font-size:10px; font-weight:800; color:#fff; background:var(--live); letter-spacing:.06em; }
        .badge-live .dot{ width:5px; height:5px; border-radius:999px; background:#fff; animation:pulse 1.6s infinite; }
        @keyframes pulse{ 0%,100%{opacity:1} 50%{opacity:.35} }
        .tap{ transition:transform .15s ease, box-shadow .15s ease, background .15s ease; -webkit-tap-highlight-color:transparent; }
        .tap:active{ transform:scale(.97); }
        @keyframes lpFloat{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-10px); } }
        @keyframes lpToastIn{ from{ opacity:0; transform:translate(-50%, 12px); } to{ opacity:1; transform:translate(-50%, 0); } }
        @keyframes lpChipIn{ from{ opacity:0; transform:scale(.85); } to{ opacity:1; transform:scale(1); } }
        @keyframes shoutRing{ 0%{ transform:scale(.5); opacity:.8; } 100%{ transform:scale(1); opacity:0; } }
        @media (min-width: 720px){
          .feature-row{ --cols: 1fr 1.05fr; }
          .prereg-grid{ --hub-cols: 1.05fr 1fr; }
          .pe-lead{ --pe-cols: 0.85fr 1.15fr; }
        }
      `}</style>
    </div>
  );
}
