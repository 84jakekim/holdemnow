'use client';

/**
 * /login/business — 매장 사장·대회사 관계자 전용 로그인 페이지
 *
 * 2026-05-26 Pink Rabbit handoff (pimk-rabbit/screens-others.jsx StoreAuth 793~972)
 *  · 골드/앰버 hero (linear-gradient 135deg #92400E → #F59E0B)
 *  · 🏪 백드롭 emoji + frosted 흰 배지 + OWNER 우상단 배지
 *  · "매장 사장님 환영합니다" + 보조 카피
 *  · 골드 솔리드 CTA + 💡 앰버 안내 박스
 *
 * 분기:
 *  - 비밀번호 찾기:   /login/recover
 *  - 매장 가입신청:   /signup/store
 *  - 대회사 가입신청: /signup/organizer
 *  - 일반 로그인 회귀: /login
 *
 * E2E 보존 (account-separation-and-tv-landscape.spec.ts B):
 *  · placeholder="가입 시 등록한 이메일" 유지
 *  · placeholder="비밀번호" (.first()) 유지
 *  · 버튼 텍스트 /매장.*대회사 로그인/ 매칭 유지
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { loginWithEmailExpecting, WrongRoleError } from '@/lib/emailAuth';

export default function BusinessLoginPage() {
  const router = useRouter();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  // 매장·대회사 자격 없는 계정 로그인 시 — 자동 리다이렉트 대신 안내 표시
  const [noBusinessRole, setNoBusinessRole] = useState(false);

  // 로그인 후 role 기반 라우팅
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    if (userDoc === undefined) return;

    if (userDoc) {
      if (hasRole(userDoc, 'platform_admin') && !userDoc.storeId) {
        router.replace('/platform');
        return;
      }
      if (userDoc.storeId) {
        router.replace(`/admin/${userDoc.storeId}`);
        return;
      }
      if (userDoc.organizerId) {
        router.replace(`/organizer/${userDoc.organizerId}`);
        return;
      }
      // 매장·대회사·본사 자격 없는 일반 사용자가 매장 로그인 페이지로 진입.
      // 자동 /m 리다이렉트는 혼란 유발 — 명시적 안내 표시.
      setNoBusinessRole(true);
    }
  }, [authState, userDoc, router]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoggingIn(true);
    setLoginError(null);
    try {
      // 2026-05-22: 일반 사용자 이메일이 매장·대회사 로그인으로 들어오면 차단.
      // 매장(store) / 대회사(organizer) / 본사(platform_admin) 만 통과.
      await loginWithEmailExpecting(email, password, 'business');
    } catch (err: unknown) {
      if (err instanceof WrongRoleError) {
        if (err.actualKind === 'platform_admin') {
          setLoginError('본사 관리자 계정입니다. 본사 관리자 로그인 페이지(/platform-login)를 이용해 주세요.');
        } else {
          // player — "없는 계정" 톤으로 안내 + 일반 로그인 링크
          setLoginError(
            '이 이메일은 매장·대회사 계정이 아닙니다. 일반 로그인(/login)을 이용하시거나, 매장·대회사 가입 신청을 진행해 주세요.',
          );
        }
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
        setLoginError('이메일 또는 비밀번호가 올바르지 않습니다.');
      } else if (msg.includes('too-many-requests')) {
        setLoginError('로그인 시도가 너무 많습니다. 잠시 후 다시 시도하거나 비밀번호를 재설정하세요.');
      } else {
        setLoginError(msg);
      }
    } finally {
      setLoggingIn(false);
    }
  };

  if (authState.status === 'loading' || (authState.status === 'authenticated' && userDoc === undefined)) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        로딩 중…
      </main>
    );
  }
  // 자격 없는 계정으로 매장 로그인 시도 — 명시적 안내 (자동 /m 리다이렉트 X)
  if (authState.status === 'authenticated' && noBusinessRole) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="text-4xl mb-3">🔒</div>
          <div className="text-base font-extrabold text-gray-900 mb-2">
            매장 어드민 자격이 없는 계정입니다
          </div>
          <div className="text-xs text-gray-600 leading-relaxed mb-5">
            이 계정({authState.user.email})은 매장·대회사·본사 어드민 권한이 없습니다.<br />
            매장을 운영하시려면 매장 가입 신청을 해주세요.<br />
            이미 신청하셨다면 본사 승인을 기다리고 있는 상태일 수 있습니다.
          </div>
          <div className="flex flex-col gap-2">
            <Link
              href="/signup/store"
              className="block w-full px-4 py-2.5 rounded-xl text-white text-sm font-extrabold"
              style={{ background: '#F59E0B' }}
            >
              매장 가입 신청
            </Link>
            <Link
              href="/m"
              className="block w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700"
            >
              사용자 앱으로 이동
            </Link>
            <button
              onClick={async () => { await signOut(auth); setNoBusinessRole(false); }}
              className="text-[11px] text-gray-500 underline mt-1"
            >
              다른 계정으로 로그인
            </button>
          </div>
        </div>
      </main>
    );
  }
  if (authState.status === 'authenticated') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        이동 중…
      </main>
    );
  }

  return (
    <main
      className="min-h-screen flex flex-col relative"
      style={{ background: 'var(--bg)' }}
    >
      {/* 헤더 — RabbitLogo + 매장 로그인 + OWNER 배지 */}
      <header
        style={{
          height: 52,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg)',
        }}
      >
        <Link
          href="/login"
          aria-label="일반 로그인으로 돌아가기"
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-1)',
            textDecoration: 'none',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <div
          style={{
            flex: 1,
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: '-0.015em',
            color: 'var(--text-1)',
          }}
        >
          매장 로그인
        </div>
        <span className="pr-owner-badge">OWNER</span>
      </header>

      <div className="flex-1 flex flex-col">
        {/* 골드/앰버 hero */}
        <div
          className="pr-hero-gold"
          style={{ borderRadius: 0, padding: '28px 20px 24px' }}
        >
          <div className="pr-hero-gold-emoji" aria-hidden>🏪</div>
          <div style={{ position: 'relative' }}>
            <div className="pr-hero-gold-badge" aria-hidden>🏪</div>
            <div
              style={{
                fontSize: 19,
                fontWeight: 900,
                marginTop: 12,
                letterSpacing: '-0.02em',
                color: '#fff',
              }}
            >
              매장 사장님 환영합니다
            </div>
            <div
              style={{
                fontSize: 11,
                opacity: 0.92,
                marginTop: 4,
                lineHeight: 1.5,
                color: '#fff',
              }}
            >
              토너 운영 · TV 디스플레이 · 광고 관리를 한 곳에서
            </div>
          </div>
        </div>

        <div className="flex-1 px-5 pt-5 pb-8 max-w-md w-full mx-auto">
          {/* 로그인 폼 */}
          <form onSubmit={handleEmailLogin}>
            <div>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--text-2)',
                  letterSpacing: '0.04em',
                  marginBottom: 6,
                  display: 'block',
                }}
              >
                이메일
              </label>
              <input
                type="email"
                className="pr-gold-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="가입 시 등록한 이메일"
                autoComplete="email"
                required
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--text-2)',
                  letterSpacing: '0.04em',
                  marginBottom: 6,
                  display: 'block',
                }}
              >
                비밀번호
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  className="pr-gold-input"
                  style={{ paddingRight: 64 }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((p) => !p)}
                  className="absolute"
                  style={{
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-3)',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: 4,
                  }}
                  tabIndex={-1}
                >
                  {showPw ? '숨기기' : '보기'}
                </button>
              </div>
            </div>

            {loginError && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  borderRadius: 12,
                  padding: 12,
                  fontSize: 12,
                  color: '#B91C1C',
                  lineHeight: 1.5,
                }}
              >
                {loginError}
              </div>
            )}

            {/* 비밀번호 찾기 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <Link
                href="/login/recover"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#B45309',
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                }}
              >
                비밀번호를 잊으셨나요?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loggingIn || !email.trim() || !password}
              className="pr-cta-gold"
              style={{ marginTop: 14 }}
            >
              {loggingIn ? '로그인 중…' : '매장 / 대회사 로그인'}
            </button>
          </form>

          {/* 💡 안내 박스 */}
          <div className="pr-gold-hint">
            <span style={{ fontSize: 16, lineHeight: 1 }} aria-hidden>💡</span>
            <div>
              <b>처음이신가요?</b> 사업자등록증을 미리 준비하시면 입점 신청이 빠릅니다.
              본사 검토 후 1–2일 내 승인됩니다.
            </div>
          </div>

          {/* 가입신청 카드 */}
          <div
            style={{
              marginTop: 20,
              background: 'var(--surface-2)',
              borderRadius: 14,
              padding: 14,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: 'var(--text-2)',
                letterSpacing: '0.10em',
                marginBottom: 8,
              }}
            >
              아직 가입하지 않으셨나요?
            </div>
            <Link
              href="/signup/store"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 12,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                textDecoration: 'none',
                color: 'var(--text-1)',
                marginBottom: 8,
                transition: 'border-color .15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#F59E0B')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>매장 가입 신청</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>
                  홀덤펍 사장님·매니저 전용
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden style={{ color: 'var(--text-3)' }}>
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </Link>
            <Link
              href="/signup/organizer"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 12,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                textDecoration: 'none',
                color: 'var(--text-1)',
                transition: 'border-color .15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#F59E0B')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>대회사 가입 신청</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>
                  홀덤 대회 운영 법인·단체
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden style={{ color: 'var(--text-3)' }}>
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </Link>
          </div>

          {/* 본사 로그인 보조 링크 */}
          <div
            style={{
              marginTop: 18,
              textAlign: 'center',
              fontSize: 10,
              color: 'var(--text-3)',
            }}
          >
            본사 관리자이신가요?{' '}
            <Link
              href="/platform-login"
              style={{
                color: 'var(--text-2)',
                textDecoration: 'underline',
                fontWeight: 700,
              }}
            >
              본사 로그인 →
            </Link>
          </div>
        </div>
      </div>

      <p
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          textAlign: 'center',
          paddingBottom: 24,
          lineHeight: 1.6,
        }}
      >
        로그인 시 이용약관 및 개인정보 처리방침에 동의합니다.
        <br />
        정보 제공 플랫폼 (사행성 매개 X)
      </p>

    </main>
  );
}
