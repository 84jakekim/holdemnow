'use client';

/**
 * /login — 일반 사용자(플레이어) 위주의 메인 로그인 페이지
 *
 * 레이아웃:
 *  - 핑크 그라데이션 헤더: RabbitLogo badge + 인사말 (핸드오프 v5 기준)
 *  - 로그인/회원가입 segmented toggle
 *  - 메인: ① 이메일/비번(일반 사용자) → ② 카카오/Google 순으로 노출.
 *  - 하단 "매장 사장님이세요?" 골드 카드 → /login/business 이동
 *
 * 분기:
 *  - 비밀번호 찾기:   /login/recover
 *  - 일반 사용자 가입: /signup/player
 *  - 매장 사장·대회사 로그인:  /login/business
 *  - 매장 가입신청:   /signup/store
 *  - 대회사 가입신청: /signup/organizer
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signOut } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { startKakaoLogin } from '@/lib/kakaoAuth';
import { loginAsPlayerWithGoogle, getLoginIntent, clearLoginIntent } from '@/lib/auth';
import { loginWithEmailExpecting, WrongRoleError } from '@/lib/emailAuth';
import { RabbitLogo } from '@/components/ui';

type AuthMode = 'login' | 'signup';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
          로딩 중…
        </main>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [wrongRoleInfo, setWrongRoleInfo] = useState<{
    kind: 'store' | 'organizer' | 'platform_admin';
    email: string;
  } | null>(null);

  // 2026-05-27: 사용자 명령 "로그인 후에는 홈화면으로 무조건 이동".
  // 일반 사용자(player) 로그인은 next 파라미터를 무시하고 항상 /m으로 보낸다.
  const nextParam = searchParams?.get('next') ?? '';
  void nextParam;

  // 로그인 후 role 기반 라우팅
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    const uid = authState.user.uid;
    const userEmail = authState.user.email ?? '(이메일 없음)';

    if (uid.startsWith('kakao:')) {
      if (userDoc === undefined) return;
      if (userDoc?.storeId) {
        setWrongRoleInfo({ kind: 'store', email: userEmail });
        return;
      }
      if (userDoc?.organizerId) {
        setWrongRoleInfo({ kind: 'organizer', email: userEmail });
        return;
      }
      router.replace('/m');
      return;
    }

    if (userDoc === undefined) return;

    if (userDoc) {
      if (hasRole(userDoc, 'platform_admin')) {
        setWrongRoleInfo({ kind: 'platform_admin', email: userEmail });
        return;
      }
      if (userDoc.storeId) {
        setWrongRoleInfo({ kind: 'store', email: userEmail });
        return;
      }
      if (userDoc.organizerId) {
        setWrongRoleInfo({ kind: 'organizer', email: userEmail });
        return;
      }
      router.replace('/m');
      return;
    }

    const intent = getLoginIntent();
    if (intent === 'store') {
      clearLoginIntent();
      router.replace('/signup/store');
      return;
    }
    if (intent === 'organizer') {
      clearLoginIntent();
      router.replace('/signup/organizer');
      return;
    }
    clearLoginIntent();
    setDoc(
      doc(db, 'users', uid),
      {
        uid,
        role: 'player',
        email: authState.user.email ?? null,
        displayName: authState.user.displayName ?? null,
        providers: ['google'],
        signupSource: 'oauth',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {});
  }, [authState, userDoc, router]);

  const handleKakaoLogin = async () => {
    try {
      await startKakaoLogin('/');
    } catch (e: unknown) {
      alert(`카카오 로그인 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await loginAsPlayerWithGoogle();
    } catch (e: unknown) {
      alert(`Google 로그인 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoggingIn(true);
    setLoginError(null);
    try {
      await loginWithEmailExpecting(email, password, 'player');
    } catch (err: unknown) {
      if (err instanceof WrongRoleError) {
        const targetPage =
          err.actualKind === 'platform_admin'
            ? '본사 관리자 로그인 페이지'
            : '매장·대회사 로그인 페이지';
        const targetHref =
          err.actualKind === 'platform_admin' ? '/platform-login' : '/login/business';
        setLoginError(
          `이 이메일은 일반 사용자 계정이 아닙니다. ${targetPage}를 이용해 주세요. (${targetHref})`,
        );
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

  // ── 로딩 상태 ──
  if (authState.status === 'loading' || (authState.status === 'authenticated' && userDoc === undefined)) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        로딩 중…
      </main>
    );
  }

  // ── 잘못된 역할 계정 차단 카드 ──
  if (authState.status === 'authenticated' && wrongRoleInfo) {
    const labels = {
      store: {
        title: '매장 사장 계정',
        desc: '매장·대회사 로그인 페이지를 이용해 주세요.',
        cta: '매장·대회사 로그인으로 이동',
        href: '/login/business',
      },
      organizer: {
        title: '대회사 계정',
        desc: '매장·대회사 로그인 페이지를 이용해 주세요.',
        cta: '매장·대회사 로그인으로 이동',
        href: '/login/business',
      },
      platform_admin: {
        title: '본사 관리자 계정',
        desc: '본사 관리자 로그인 페이지를 이용해 주세요.',
        cta: '본사 관리자 로그인으로 이동',
        href: '/platform-login',
      },
    }[wrongRoleInfo.kind];
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
          <p className="text-base font-extrabold text-gray-900 mb-2">
            {labels.title}으로 로그인하셨습니다
          </p>
          <p className="text-xs text-gray-600 leading-relaxed mb-5">
            이 페이지는 일반 사용자 전용입니다.<br />
            <span className="font-medium text-gray-500">({wrongRoleInfo.email})</span><br />
            {labels.desc}
          </p>
          <div className="flex flex-col gap-2">
            <Link
              href={labels.href}
              className="block w-full px-4 py-3 rounded-xl text-white text-sm font-extrabold text-center"
              style={{ background: '#FF1F8F' }}
            >
              {labels.cta}
            </Link>
            <button
              onClick={async () => {
                await signOut(auth);
                setWrongRoleInfo(null);
              }}
              className="block w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 transition"
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

  const emailValid = email.trim().length > 0;
  const pwValid = password.length >= 1;
  const canSubmit = emailValid && pwValid && !loggingIn;

  return (
    <main className="min-h-screen flex flex-col bg-white">

      {/* ── 글로벌 스타일 ── */}
      <style dangerouslySetInnerHTML={{ __html: `
        .login-field {
          background: #FFFFFF;
          border: 1.5px solid #E5E7EB;
          border-radius: 12px;
          padding: 12px 14px;
          font-size: 14px;
          font-weight: 700;
          color: #111827;
          width: 100%;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.15s ease;
          font-family: inherit;
        }
        .login-field::placeholder {
          color: #9CA3AF;
          font-weight: 400;
        }
        .login-field:focus {
          border-color: #FF1F8F;
        }
        @keyframes loginSpin {
          to { transform: rotate(360deg); }
        }
      ` }} />

      {/* ── 핑크 그라데이션 헤더 (핸드오프 v5) ── */}
      <div
        className="relative overflow-hidden flex-shrink-0"
        style={{
          background: 'linear-gradient(160deg, #FF1F8F 0%, #FF6BAA 100%)',
          padding: '44px 20px 36px',
          color: '#fff',
        }}
      >
        {/* 배경 토끼 워터마크 */}
        <div
          aria-hidden
          style={{
            position: 'absolute', top: -20, right: -30,
            opacity: 0.18, pointerEvents: 'none',
          }}
        >
          <RabbitLogo size={200} variant="mark" />
        </div>
        {/* 우상단 글로우 */}
        <div
          aria-hidden
          style={{
            position: 'absolute', top: -16, right: -16,
            width: 80, height: 80, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 70%)',
            pointerEvents: 'none',
          }}
        />

        <div className="relative" style={{ zIndex: 1 }}>
          <RabbitLogo size={52} variant="badge" aria-label="Pink Rabbit" />
          {mode === 'login' ? (
            <>
              <div
                className="font-black mt-3"
                style={{ fontSize: 24, letterSpacing: '-0.025em', lineHeight: 1.2 }}
              >
                다시 만나서 반가워요
              </div>
              <p
                className="mt-1.5"
                style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.92, fontWeight: 500 }}
              >
                오늘의 매장 소식과 토너가 기다리고 있어요
              </p>
            </>
          ) : (
            <>
              <div
                className="font-black mt-3"
                style={{ fontSize: 24, letterSpacing: '-0.025em', lineHeight: 1.2 }}
              >
                안녕하세요!<br />Pink Rabbit입니다
              </div>
              <p
                className="mt-1.5"
                style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.92, fontWeight: 500 }}
              >
                부산·경남 홀덤펍 소식을 가장 먼저 받아보세요
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── 로그인 / 회원가입 segmented toggle ── */}
      <div className="px-5 pt-4 flex-shrink-0">
        <div
          className="grid grid-cols-2 gap-1 p-1 rounded-xl"
          style={{ background: '#F3F4F6' }}
          role="tablist"
          aria-label="인증 모드 선택"
        >
          {([
            { id: 'login', label: '로그인' },
            { id: 'signup', label: '회원가입' },
          ] as { id: AuthMode; label: string }[]).map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => {
                setMode(m.id);
                setLoginError(null);
              }}
              className="py-2.5 rounded-[9px] text-sm font-extrabold transition-all duration-150"
              style={{
                border: 'none',
                cursor: 'pointer',
                background: mode === m.id ? '#FFFFFF' : 'transparent',
                color: mode === m.id ? '#FF1F8F' : '#6B7280',
                boxShadow: mode === m.id ? '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)' : 'none',
                letterSpacing: '-0.01em',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="flex-1 overflow-y-auto">
        {mode === 'login' ? (
          <LoginPanel
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            showPw={showPw}
            setShowPw={setShowPw}
            loggingIn={loggingIn}
            loginError={loginError}
            canSubmit={canSubmit}
            handleEmailLogin={handleEmailLogin}
            handleKakaoLogin={handleKakaoLogin}
            handleGoogleLogin={handleGoogleLogin}
          />
        ) : (
          <SignupPanel onSwitchToLogin={() => setMode('login')} />
        )}

        {/* ── 매장 사장님 안내 카드 (핸드오프 v5 골드 카드) ── */}
        <section className="px-5 pb-6 pt-1">
          <Link
            href="/login/business"
            className="flex items-center gap-3 p-3.5 rounded-2xl transition-transform active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #FFF8EC, #FFE9D6)',
              border: '1px solid #F5D9A6',
              textDecoration: 'none',
            }}
          >
            <div
              className="flex-shrink-0 flex items-center justify-center rounded-xl text-xl"
              style={{
                width: 42, height: 42,
                background: '#FFFFFF',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}
              aria-hidden
            >
              🏪
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="font-black"
                style={{ fontSize: 13, letterSpacing: '-0.015em', color: '#78350F' }}
              >
                매장 사장님이세요?
              </div>
              <div
                className="mt-0.5"
                style={{ fontSize: 11, color: '#92400E', lineHeight: 1.45 }}
              >
                매장 어드민 로그인은 별도 페이지로
              </div>
            </div>
            <ChevronRight color="#92400E" />
          </Link>
        </section>
      </div>

      {/* ── 하단 법적 고지 ── */}
      <p
        className="text-center pb-6 flex-shrink-0"
        style={{ fontSize: 10, color: '#9CA3AF', lineHeight: 1.6 }}
      >
        로그인 시 이용약관 및 개인정보 처리방침에 동의합니다.
        <br />
        정보 제공 플랫폼 (사행성 매개 X)
      </p>
    </main>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 로그인 패널
// ──────────────────────────────────────────────────────────────────────────────
interface LoginPanelProps {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPw: boolean;
  setShowPw: (fn: (prev: boolean) => boolean) => void;
  loggingIn: boolean;
  loginError: string | null;
  canSubmit: boolean;
  handleEmailLogin: (e: React.FormEvent) => Promise<void>;
  handleKakaoLogin: () => Promise<void>;
  handleGoogleLogin: () => Promise<void>;
}

function LoginPanel({
  email, setEmail,
  password, setPassword,
  showPw, setShowPw,
  loggingIn, loginError,
  canSubmit,
  handleEmailLogin,
  handleKakaoLogin, handleGoogleLogin,
}: LoginPanelProps) {
  return (
    <section className="px-5 pt-5 pb-2">
      <form onSubmit={handleEmailLogin} noValidate>
        {/* 이메일 */}
        <div>
          <label
            htmlFor="login-email"
            className="block mb-1.5 font-extrabold"
            style={{ fontSize: 11, color: '#6B7280', letterSpacing: '0.04em' }}
          >
            이메일
          </label>
          <input
            id="login-email"
            type="email"
            className="login-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일 주소"
            autoComplete="email"
            required
          />
        </div>

        {/* 비밀번호 */}
        <div className="mt-3">
          <label
            htmlFor="login-password"
            className="block mb-1.5 font-extrabold"
            style={{ fontSize: 11, color: '#6B7280', letterSpacing: '0.04em' }}
          >
            비밀번호
          </label>
          <div className="relative">
            <input
              id="login-password"
              type={showPw ? 'text' : 'password'}
              className="login-field"
              style={{ paddingRight: '48px' }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 입력"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPw((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}
              tabIndex={-1}
              aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 표시'}
            >
              {showPw ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>

        {/* 에러 메시지 */}
        {loginError && (
          <div
            className="mt-2 rounded-xl p-3 flex items-start gap-2"
            style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              fontSize: 11,
              color: '#B91C1C',
              lineHeight: 1.55,
            }}
            role="alert"
          >
            <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
            <span>{loginError}</span>
          </div>
        )}

        {/* 비밀번호 찾기 */}
        <div className="flex justify-end mt-3">
          <Link
            href="/login/recover"
            style={{ fontSize: 11, fontWeight: 700, color: '#FF1F8F', textDecoration: 'underline', textUnderlineOffset: '2px' }}
          >
            비밀번호를 잊으셨나요?
          </Link>
        </div>

        {/* 로그인 CTA */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-4 w-full font-black transition-all duration-200"
          style={{
            padding: '14px 0',
            borderRadius: 14,
            border: 'none',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            background: canSubmit ? '#FF1F8F' : '#E5E7EB',
            color: canSubmit ? '#FFFFFF' : '#9CA3AF',
            fontSize: 14,
            letterSpacing: '-0.01em',
            boxShadow: canSubmit ? '0 4px 18px rgba(255,31,143,0.30)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {loggingIn && (
            <span
              style={{
                width: 14, height: 14, borderRadius: 99,
                border: '2px solid rgba(255,255,255,0.4)',
                borderTopColor: '#fff',
                animation: 'loginSpin 0.8s linear infinite',
                display: 'inline-block',
              }}
            />
          )}
          {loggingIn ? '로그인 중…' : '로그인'}
        </button>

        {/* 가입 링크 */}
        <p className="mt-3 text-center" style={{ fontSize: 11, color: '#6B7280' }}>
          아직 계정이 없으신가요?{' '}
          <Link
            href="/signup/player"
            style={{ color: '#FF1F8F', fontWeight: 800, textDecoration: 'none' }}
          >
            일반 가입 →
          </Link>
        </p>
      </form>

      {/* ── SNS 간편 로그인 구분선 ── */}
      <div className="flex items-center gap-3 my-6">
        <div className="flex-1" style={{ height: 1, background: '#E5E7EB' }} />
        <span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 700, letterSpacing: '0.06em' }}>
          SNS 간편 로그인
        </span>
        <div className="flex-1" style={{ height: 1, background: '#E5E7EB' }} />
      </div>

      {/* ── 소셜 로그인 버튼 ── */}
      <div className="space-y-2">
        {/* 카카오 — 메인 단독 */}
        <button
          onClick={handleKakaoLogin}
          className="w-full flex items-center justify-center gap-2 font-extrabold transition-opacity hover:opacity-90 active:scale-[0.98]"
          style={{
            padding: '14px 0',
            borderRadius: 14,
            border: 'none',
            cursor: 'pointer',
            background: '#FEE500',
            color: '#391B1B',
            fontSize: 14,
            letterSpacing: '-0.01em',
          }}
        >
          <KakaoIcon />
          카카오로 시작하기
        </button>

        {/* Google */}
        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-2 font-bold transition hover:bg-gray-50 active:scale-[0.98]"
          style={{
            padding: '13px 0',
            borderRadius: 14,
            border: '1.5px solid #E5E7EB',
            cursor: 'pointer',
            background: '#FFFFFF',
            color: '#111827',
            fontSize: 13,
          }}
        >
          <GoogleIcon />
          Google로 시작하기
        </button>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 회원가입 패널 — /signup/player 페이지로 라우팅
// ──────────────────────────────────────────────────────────────────────────────
function SignupPanel({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  return (
    <section className="px-5 pt-6 pb-2 flex flex-col items-center text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 text-3xl"
        style={{ background: '#FFF0F7' }}
        aria-hidden
      >
        🐰
      </div>
      <h2
        className="font-black mb-1"
        style={{ fontSize: 18, color: '#111827', letterSpacing: '-0.02em' }}
      >
        Pink Rabbit 가입하기
      </h2>
      <p
        className="mb-6"
        style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, maxWidth: 260 }}
      >
        부산·경남 홀덤펍 소식을<br />가장 먼저 받아보세요
      </p>
      <Link
        href="/signup/player"
        className="w-full flex items-center justify-center font-black transition-all duration-200 active:scale-[0.98]"
        style={{
          padding: '14px 0',
          borderRadius: 14,
          background: '#FF1F8F',
          color: '#FFFFFF',
          fontSize: 14,
          letterSpacing: '-0.01em',
          textDecoration: 'none',
          boxShadow: '0 4px 18px rgba(255,31,143,0.30)',
        }}
      >
        이메일로 가입하기
      </Link>

      {/* SNS 가입 */}
      <div className="flex items-center gap-3 my-5 w-full">
        <div className="flex-1" style={{ height: 1, background: '#E5E7EB' }} />
        <span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 700, letterSpacing: '0.06em' }}>
          또는 SNS로 시작
        </span>
        <div className="flex-1" style={{ height: 1, background: '#E5E7EB' }} />
      </div>

      <p className="mt-1" style={{ fontSize: 11, color: '#6B7280' }}>
        이미 계정이 있으신가요?{' '}
        <button
          onClick={onSwitchToLogin}
          style={{ background: 'transparent', border: 'none', color: '#FF1F8F', fontWeight: 800, cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
        >
          로그인 →
        </button>
      </p>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 아이콘 컴포넌트
// ──────────────────────────────────────────────────────────────────────────────
function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function ChevronRight({ color = '#6B7280' }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#3C1E1E"
        d="M9 1.5C4.86 1.5 1.5 4.16 1.5 7.44c0 2.08 1.3 3.91 3.26 4.97L4 14.5l3.2-2.1c.58.1 1.18.15 1.8.15 4.14 0 7.5-2.66 7.5-5.94C16.5 4.16 13.14 1.5 9 1.5z"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

