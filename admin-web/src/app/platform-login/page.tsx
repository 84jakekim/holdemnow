'use client';

/**
 * /platform-login — 본사(platform_admin) 관리자 전용 로그인 페이지
 *
 * 2026-05-26 Pink Rabbit handoff (pimk-rabbit/screens-others.jsx PlatformLoginScreen 977~1132)
 *  · 다크 #0A0D12 보안 톤
 *  · 헤더: RabbitLogo mark + PLATFORM CONTROL mono + SECURE 빨강 배지
 *  · 🔒 64px 그라데이션 hero + radial 핑크/블루 글로우
 *  · "본사 관제센터 진입" + IP 화이트리스트 안내
 *  · ADMIN EMAIL / PASSWORD (소문자 라벨 + 다크 입력)
 *  · CTA: 핑크 그라데이션 "Sign in to Control Center"
 *  · 하단 보안 정책 3건 + audit URL
 *  · OTP는 시스템 미보유 — 핸드오프 6자리 OTP 입력 필드 생략 (메모리 기록)
 *  · Google 로그인 보존 (다크 톤 화이트 버튼)
 *
 * - 매장/대회사용 /login/business 와 별도. 본사 운영자만 사용.
 * - 가입 카드 없음 — 본사 계정은 사전 발급
 * - 로그인 성공 후 platform_admin role 보유 검증 → /platform
 * - role 없으면 안내 + 로그아웃 옵션
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { loginWithEmailExpecting, WrongRoleError } from '@/lib/emailAuth';
import { usernameToAdminEmail, validateAdminUsername } from '@/lib/platformAdmin';
import { RabbitLogo } from '@/components/ui';

export default function PlatformLoginPage() {
  return (
    <Suspense
      fallback={
        <main
          className="min-h-screen flex items-center justify-center text-sm"
          style={{ background: '#0A0D12', color: 'rgba(255,255,255,0.5)' }}
        >
          로딩 중…
        </main>
      }
    >
      <PlatformLoginInner />
    </Suspense>
  );
}

function PlatformLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [wrongAccountInfo, setWrongAccountInfo] = useState<string | null>(null);

  const nextParam = searchParams?.get('next') ?? '';
  const isSafeNext = nextParam.startsWith('/platform');

  // 로그인 후 platform_admin role 검증 → /platform
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    if (userDoc === undefined) return;

    if (userDoc) {
      if (hasRole(userDoc, 'platform_admin')) {
        // 본사 관리자 — next가 안전 경로면 거기로, 아니면 /platform 대시보드
        router.replace(isSafeNext ? nextParam : '/platform');
        return;
      }
      // 로그인은 됐지만 본사 관리자 권한 없음 — 안내 표시 (자동 redirect X)
      setWrongAccountInfo(
        userDoc.storeId
          ? `매장 사장 계정(${authState.user.email ?? ''})입니다. 매장 어드민은 우측 상단의 다른 로그인 페이지를 이용해 주세요.`
          : userDoc.organizerId
          ? `대회사 계정(${authState.user.email ?? ''})입니다. 대회사 어드민은 우측 상단의 다른 로그인 페이지를 이용해 주세요.`
          : `이 계정(${authState.user.email ?? ''})은 본사 관리자 권한이 없습니다.`,
      );
    }
  }, [authState, userDoc, router, isSafeNext, nextParam]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = email.trim();
    if (!raw || !password) return;
    setLoggingIn(true);
    setLoginError(null);
    setWrongAccountInfo(null);
    try {
      // 입력이 이메일 형식이면 그대로, 아니면 본사 어드민 아이디로 간주해 합성 이메일로 변환.
      let loginEmail = raw;
      if (!raw.includes('@')) {
        const v = validateAdminUsername(raw);
        if (!v.ok) {
          setLoginError(v.error);
          setLoggingIn(false);
          return;
        }
        loginEmail = usernameToAdminEmail(v.value);
      }
      // 2026-05-22: platform_admin 만 통과. 매장·대회사·일반 사용자는 차단.
      await loginWithEmailExpecting(loginEmail, password, 'platform_admin');
    } catch (err: unknown) {
      if (err instanceof WrongRoleError) {
        if (err.actualKind === 'store' || err.actualKind === 'organizer') {
          setLoginError('매장·대회사 계정입니다. 매장·대회사 로그인 페이지(/login/business)를 이용해 주세요.');
        } else {
          setLoginError('이 계정은 본사 관리자 권한이 없습니다. 일반 로그인(/login)을 이용해 주세요.');
        }
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
        setLoginError('아이디(이메일) 또는 비밀번호가 올바르지 않습니다.');
      } else if (msg.includes('too-many-requests')) {
        setLoginError('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
      } else {
        setLoginError(msg);
      }
    } finally {
      setLoggingIn(false);
    }
  };

  const handleSignoutWrongAccount = async () => {
    await signOut(auth);
    setWrongAccountInfo(null);
    setEmail('');
    setPassword('');
  };

  const handleGoogleLogin = async () => {
    setLoggingIn(true);
    setLoginError(null);
    setWrongAccountInfo(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      // 라우팅·권한 검증은 useEffect가 처리 (platform_admin 보유 검증).
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('popup-closed-by-user') && !msg.includes('cancelled-popup-request')) {
        setLoginError(`Google 로그인 실패: ${msg}`);
      }
    } finally {
      setLoggingIn(false);
    }
  };

  if (authState.status === 'loading' || (authState.status === 'authenticated' && userDoc === undefined)) {
    return (
      <main
        className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: '#0A0D12', color: 'rgba(255,255,255,0.5)' }}
      >
        로딩 중…
      </main>
    );
  }

  return (
    <main className="pr-platform-shell">
      {/* 헤더 — RabbitLogo + PLATFORM CONTROL + SECURE */}
      <header className="pr-platform-header">
        <div className="pr-platform-logo-frame">
          <RabbitLogo size={20} variant="mark" />
        </div>
        <div style={{ flex: 1 }}>
          <div className="pr-platform-control-label">PLATFORM CONTROL</div>
        </div>
        <span className="pr-secure-badge">SECURE</span>
        <Link
          href="/login/business"
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.5)',
            textDecoration: 'none',
            padding: '4px 8px',
            marginLeft: 6,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.10)',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.30)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)';
          }}
        >
          매장·대회사 →
        </Link>
      </header>

      <div className="flex-1 flex flex-col items-center" style={{ width: '100%' }}>
        {/* 🔒 보안 hero */}
        <div className="pr-platform-hero" style={{ width: '100%', maxWidth: 440 }}>
          <div className="pr-platform-hero-glow" aria-hidden />
          <div style={{ position: 'relative' }}>
            <div className="pr-platform-lock" aria-hidden>🔒</div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 900,
                marginTop: 14,
                letterSpacing: '-0.02em',
                color: '#fff',
              }}
            >
              본사 관제센터 진입
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.55)',
                marginTop: 6,
                lineHeight: 1.55,
                maxWidth: 320,
                marginLeft: 'auto',
                marginRight: 'auto',
              }}
            >
              관리자 전용 페이지입니다.{' '}
              <span style={{ color: '#FCA5A5' }}>IP 화이트리스트</span>가 적용되며 모든 접근은 감사 로그가 남습니다.
            </div>
          </div>
        </div>

        <section
          style={{
            padding: '8px 20px 24px',
            width: '100%',
            maxWidth: 420,
            boxSizing: 'border-box',
          }}
        >
          {wrongAccountInfo ? (
            <div
              style={{
                background: 'rgba(245, 158, 11, 0.10)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                borderRadius: 14,
                padding: 18,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  color: '#FCD34D',
                  fontWeight: 800,
                  fontSize: 13,
                  marginBottom: 8,
                }}
              >
                ⚠️ 본사 관리자 계정이 아닙니다
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'rgba(252, 211, 77, 0.85)',
                  lineHeight: 1.55,
                  marginBottom: 14,
                }}
              >
                {wrongAccountInfo}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Link
                  href="/login/business"
                  className="pr-cta-pink"
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    textDecoration: 'none',
                    textTransform: 'none',
                    letterSpacing: '-0.01em',
                  }}
                >
                  매장·대회사 로그인으로 이동
                </Link>
                <button
                  type="button"
                  onClick={handleSignoutWrongAccount}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 11,
                    color: 'rgba(252, 211, 77, 0.85)',
                    textDecoration: 'underline',
                    textUnderlineOffset: 2,
                    cursor: 'pointer',
                    padding: 6,
                  }}
                >
                  다른 본사 계정으로 다시 로그인
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Google 로그인 (보존) */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loggingIn}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  borderRadius: 10,
                  background: '#FFFFFF',
                  color: '#1F2937',
                  border: '1px solid rgba(255,255,255,0.20)',
                  fontSize: 13,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: loggingIn ? 'not-allowed' : 'pointer',
                  opacity: loggingIn ? 0.4 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC04" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {loggingIn ? '로그인 중…' : 'Google로 본사 로그인'}
              </button>

              <div className="pr-platform-divider">
                <div className="pr-platform-divider-line" />
                <span className="pr-platform-divider-text">OR</span>
                <div className="pr-platform-divider-line" />
              </div>

              <form onSubmit={handleEmailLogin}>
                {/* ADMIN EMAIL */}
                <div>
                  <label className="pr-input-dark-label">ADMIN EMAIL</label>
                  <input
                    type="text"
                    className="pr-input-dark"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin01 또는 admin@holdemnow.com"
                    autoComplete="username"
                    required
                  />
                  <div
                    style={{
                      fontSize: 10,
                      color: 'rgba(255,255,255,0.35)',
                      marginTop: 6,
                      lineHeight: 1.5,
                    }}
                  >
                    아이디만 입력하면 자동으로 본사 어드민 계정을 인식합니다.
                  </div>
                </div>

                {/* PASSWORD */}
                <div style={{ marginTop: 12 }}>
                  <label className="pr-input-dark-label">PASSWORD</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPw ? 'text' : 'password'}
                      className="pr-input-dark"
                      style={{ paddingRight: 64 }}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((p) => !p)}
                      style={{
                        position: 'absolute',
                        right: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'rgba(255,255,255,0.5)',
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
                      background: 'rgba(229, 62, 62, 0.12)',
                      border: '1px solid rgba(229, 62, 62, 0.35)',
                      borderRadius: 10,
                      padding: 12,
                      fontSize: 12,
                      color: '#FCA5A5',
                      lineHeight: 1.5,
                    }}
                  >
                    {loginError}
                  </div>
                )}

                {/* CTA — 핑크 그라데이션 */}
                <button
                  type="submit"
                  disabled={loggingIn || !email.trim() || !password}
                  className="pr-cta-pink"
                  style={{ marginTop: 18 }}
                >
                  {loggingIn ? 'Signing in…' : 'Sign in to Control Center'}
                </button>
              </form>

              {/* 보안 정책 */}
              <div className="pr-platform-policy">
                <div className="pr-platform-policy-row">
                  <span>•</span>
                  <span>회사 VPN 또는 등록된 IP에서만 접근 가능</span>
                </div>
                <div className="pr-platform-policy-row">
                  <span>•</span>
                  <span>5회 실패 시 계정 잠금 · 슈퍼관리자 승인 필요</span>
                </div>
                <div className="pr-platform-policy-row">
                  <span>•</span>
                  <span>
                    접근 기록:{' '}
                    <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      audit.holdemnow.com
                    </span>
                  </span>
                </div>
              </div>

              {/* URL 표시 */}
              <div className="pr-platform-url">platform.holdemnow.com / signin</div>

              {/* 신규 가입 없음 안내 */}
              <p
                style={{
                  fontSize: 10.5,
                  color: 'rgba(255,255,255,0.30)',
                  textAlign: 'center',
                  marginTop: 18,
                  lineHeight: 1.6,
                }}
              >
                본사 계정 신규 발급은 시스템 운영자에게 문의하세요.
                <br />
                이 페이지는 본사 관계자 외에 사용하지 않습니다.
              </p>
            </>
          )}
        </section>
      </div>

      <p
        style={{
          fontSize: 10,
          color: 'rgba(255,255,255,0.30)',
          textAlign: 'center',
          paddingBottom: 24,
          lineHeight: 1.6,
        }}
      >
        본사 운영 대시보드 · Pink Rabbit Internal
      </p>
    </main>
  );
}
