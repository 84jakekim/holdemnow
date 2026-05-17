'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import AnonymousPrompt from '@/components/mobile/AnonymousPrompt';
import { doc, setDoc, onSnapshot, serverTimestamp, collection } from 'firebase/firestore';

interface NotificationPrefs {
  favLive: boolean;
  tournamentStart: boolean;
  lateRegImminent: boolean;
  marketing: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  favLive: true,
  tournamentStart: true,
  lateRegImminent: false,
  marketing: false,
};

export default function MyPage() {
  const authState = useAuth();
  const router = useRouter();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [favCount, setFavCount] = useState(0);
  const [seriesSubCount, setSeriesSubCount] = useState(0);
  const [interestCount, setInterestCount] = useState(0);

  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    const uid = authState.user.uid;
    const u1 = onSnapshot(collection(db, 'users', uid, 'favorites'), (s) => setFavCount(s.size));
    const u2 = onSnapshot(collection(db, 'users', uid, 'seriesSubscriptions'), (s) => setSeriesSubCount(s.size));
    const u3 = onSnapshot(collection(db, 'users', uid, 'interests'), (s) => setInterestCount(s.size));
    return () => { u1(); u2(); u3(); };
  }, [authState]);

  useEffect(() => {
    if (authState.status !== 'authenticated') { setLoading(false); return; }
    const uid = authState.user.uid;
    const unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const data = snap.data() as { notificationPrefs?: NotificationPrefs } | undefined;
        if (data?.notificationPrefs) setPrefs(data.notificationPrefs);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [authState]);

  const togglePref = async (key: keyof NotificationPrefs) => {
    if (authState.status !== 'authenticated') return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await setDoc(
      doc(db, 'users', authState.user.uid),
      { notificationPrefs: next, updatedAt: serverTimestamp() },
      { merge: true },
    );
  };

  if (authState.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      </div>
    );
  }
  if (authState.status === 'anonymous') {
    return <AnonymousPrompt title="마이" icon="👤" desc="관심 토너 · 즐겨찾기 · 알림 설정을 위해 로그인하세요." />;
  }

  const user = authState.user;
  const initials = (user.displayName?.[0] ?? user.email?.[0] ?? '?').toUpperCase();

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── 헤더 ── */}
      <header
        className="px-5 h-14 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xl font-extrabold tracking-tight font-serif" style={{ color: 'var(--text-1)' }}>
          마이
        </span>
        <button
          aria-label="알림 설정"
          className="w-9 h-9 flex items-center justify-center rounded-xl"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
        </button>
      </header>

      {/* ── 프로필 ── */}
      <div className="px-5 py-6 flex items-center gap-4" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand-dim) 100%)', boxShadow: 'var(--shadow-brand)' }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold truncate" style={{ color: 'var(--text-1)' }}>
            {user.displayName ?? '플레이어'}
          </div>
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{user.email}</div>
          <div
            className="inline-flex items-center text-[10px] font-bold mt-1.5 px-2 py-0.5 rounded-full"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
          >
            일반 회원
          </div>
        </div>
      </div>

      {/* ── 통계 ── */}
      <div className="px-4 py-5 grid grid-cols-3 gap-2" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        {[
          { label: '즐겨찾기', value: favCount, go: '/m/favorites' },
          { label: '관심 토너', value: interestCount, go: '/m/interests' },
          { label: '시리즈 구독', value: seriesSubCount, go: '/m/subscriptions' },
        ].map((k) => (
          <button
            key={k.label}
            onClick={() => router.push(k.go)}
            className="rounded-xl py-4 text-center transition active:scale-[0.97]"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <div className="font-mono text-xl font-extrabold" style={{ color: 'var(--brand)' }}>{k.value}</div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{k.label}</div>
          </button>
        ))}
      </div>

      {/* ── 알림 설정 ── */}
      <div className="px-5 py-5" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        <div className="text-base font-extrabold mb-4" style={{ color: 'var(--text-1)' }}>알림 설정</div>
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩…</div>
        ) : (
          <div>
            <PrefRow label="즐겨찾기 매장 LIVE 시작" desc="실시간 즉시 알림" value={prefs.favLive} onToggle={() => togglePref('favLive')} />
            <PrefRow label="관심 토너 시작 1시간 전" desc="미리 알려드려요" value={prefs.tournamentStart} onToggle={() => togglePref('tournamentStart')} />
            <PrefRow label="늦은 등록 마감 임박" desc="관심 토너 등록 30분 전" value={prefs.lateRegImminent} onToggle={() => togglePref('lateRegImminent')} />
            <PrefRow label="매장·시리즈 마케팅" desc="광고성 알림 (선택)" value={prefs.marketing} onToggle={() => togglePref('marketing')} />
          </div>
        )}
      </div>

      {/* ── 메뉴 ── */}
      <div className="px-5 py-4" style={{ borderBottom: '6px solid var(--surface-2)' }}>
        {[
          { label: '즐겨찾기 매장', go: '/m/favorites', icon: '♡' },
          { label: '관심 토너', go: '/m/interests', icon: '★' },
          { label: '시리즈 구독', go: '/m/subscriptions', icon: '◎' },
          { label: '내가 쓴 리뷰', tag: 'v0.2', icon: '✎' },
          { label: '계정 설정', tag: '', icon: '⚙' },
          { label: '도움말·문의', tag: '', icon: '?' },
        ].map((m, i) => (
          <button
            key={i}
            onClick={() => m.go && router.push(m.go)}
            className="w-full px-1 py-4 flex items-center justify-between transition"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-3">
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}
              >
                {m.icon}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-1)' }}>{m.label}</span>
            </div>
            {m.tag ? (
              <span
                className="text-[10px] font-bold rounded px-2 py-0.5"
                style={{ background: 'var(--surface-3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
              >
                {m.tag}
              </span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            )}
          </button>
        ))}
      </div>

      {/* ── 로그아웃 ── */}
      <div className="px-5 py-8">
        <button
          onClick={() => signOut(auth)}
          className="w-full py-3 text-sm transition"
          style={{ color: 'var(--text-3)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}

function PrefRow({ label, desc, value, onToggle }: {
  label: string; desc: string; value: boolean; onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex-1 min-w-0 pr-3">
        <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{label}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{desc}</div>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={value}
        className="relative w-11 h-6 rounded-full flex-shrink-0 transition"
        style={{ background: value ? 'var(--brand)' : 'var(--surface-3)' }}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
          style={{ left: value ? '22px' : '2px' }}
        />
      </button>
    </div>
  );
}
