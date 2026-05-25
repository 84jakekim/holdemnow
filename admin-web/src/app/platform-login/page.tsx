'use client';

/**
 * /platform/login — 본사(platform_admin) 관리자 전용 로그인 페이지
 *
 * - 매장/대회사용 /login/business 와 별도. 본사 운영자만 사용.
 * - 가입 카드 없음 (본사 계정은 가입 폼 없음 — 본사 내부 운영용 사전 발급)
 * - OAuth 진입 없음 — Email/Password 만
 * - 로그인 성공 후 platform_admin role 보유 검증 → /platform.
 *   role 없으면 안내 + 로그아웃 옵션 (잘못된 계정으로 진입한 매장 사장 등).
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
        <main className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-400 text-sm">
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
      <main className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-400 text-sm">
        로딩 중…
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col bg-gray-900 relative">
      {/* 우측 상단 — 잘못 들어왔을 때 매장/대회사 로그인 페이지로 안내 */}
      <Link
        href="/login/business"
        className="absolute top-3 right-3 text-[11px] font-medium text-gray-300 hover:text-white px-3 py-1.5 rounded-full hover:bg-gray-800 transition"
      >
        매장·대회사 로그인 →
      </Link>

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-12">
        {/* 로고 — Pink Rabbit handoff: badge variant + glow (다크 톤) */}
        <div className="flex flex-col items-center mb-8 mt-6">
          <RabbitLogo size={88} variant="badge" glow aria-label="Pink Rabbit Platform" />
          <div
            className="mt-3 font-black"
            style={{
              fontSize: 20,
              letterSpacing: '-0.03em',
              background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BAA 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              color: 'transparent',
            }}
          >
            Pink Rabbit
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full tracking-widest border border-amber-400/30">
              🏢 본사 관리자 전용
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            본사 운영자만 사용 가능합니다.
          </p>
        </div>

        <div className="w-full max-w-sm">
          {wrongAccountInfo ? (
            <div className="bg-amber-900/30 border border-amber-700/50 rounded-2xl p-5 mb-4">
              <div className="text-amber-300 font-bold text-sm mb-2">⚠️ 본사 관리자 계정이 아닙니다</div>
              <div className="text-[12px] text-amber-200 leading-relaxed mb-4">{wrongAccountInfo}</div>
              <div className="flex flex-col gap-2">
                <Link
                  href="/login/business"
                  className="block w-full text-center py-3 rounded-xl font-bold text-sm text-white"
                  style={{ background: '#FF1F8F' }}
                >
                  매장·대회사 로그인으로 이동
                </Link>
                <button
                  onClick={handleSignoutWrongAccount}
                  className="block w-full text-center py-2 text-xs text-amber-300 hover:text-white underline underline-offset-2"
                >
                  다른 본사 계정으로 다시 로그인
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Google 로그인 — Google OAuth로 가입한 본사 관리자용 */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loggingIn}
                className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: '#FFFFFF', color: '#1F2937', border: '1px solid #E5E7EB' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC04" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {loggingIn ? '로그인 중…' : 'Google로 본사 로그인'}
              </button>
              <p className="text-[10px] text-gray-500 text-center my-3">
                Google 계정은 platform_admin role이 부여된 사용자만 진입 가능
              </p>
              <div className="flex items-center gap-3 my-3">
                <div className="flex-1 h-px bg-gray-700" />
                <span className="text-[10px] text-gray-500 font-bold">또는</span>
                <div className="flex-1 h-px bg-gray-700" />
              </div>
              <form onSubmit={handleEmailLogin} className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-gray-300 block mb-1.5">본사 관리자 아이디 (또는 이메일)</label>
                <input
                  type="text"
                  className="platform-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin01 또는 admin@example.com"
                  autoComplete="username"
                  required
                />
                <div className="text-[10.5px] text-gray-500 mt-1">
                  아이디만 입력하면 자동으로 본사 어드민 계정을 인식합니다.
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-300 block mb-1.5">비밀번호</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="platform-input pr-14"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500 font-medium hover:text-gray-300"
                    tabIndex={-1}
                  >
                    {showPw ? '숨기기' : '보기'}
                  </button>
                </div>
              </div>

              {loginError && (
                <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-3 text-xs text-red-300 leading-relaxed">
                  {loginError}
                </div>
              )}

                <button
                  type="submit"
                  disabled={loggingIn || !email.trim() || !password}
                  className="w-full py-3.5 rounded-xl font-bold text-sm text-gray-900 transition disabled:opacity-40 mt-1"
                  style={{ background: '#FBBF24' }}
                >
                  {loggingIn ? '로그인 중…' : '본사 관리자 로그인'}
                </button>
              </form>
            </>
          )}

          {/* 가입 카드 없음 — 본사 계정은 별도 발급 (이 페이지에 안내만) */}
          <p className="text-[11px] text-gray-500 text-center mt-6 leading-relaxed">
            본사 계정 신규 발급은 시스템 운영자에게 문의하세요.
            <br />
            (이 페이지는 본사 관계자 외에 사용하지 않습니다.)
          </p>
        </div>
      </div>

      <p className="text-[10px] text-gray-500 text-center pb-6 leading-relaxed">
        본사 운영 대시보드 · Pink Rabbit Internal
      </p>

      <style jsx global>{`
        .platform-input {
          background: #111827;
          border: 1.5px solid #374151;
          border-radius: 10px;
          padding: 11px 14px;
          font-size: 14px;
          color: #f3f4f6;
          width: 100%;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.15s;
        }
        .platform-input:focus { border-color: #FBBF24; }
        .platform-input::placeholder { color: #6b7280; }
      `}</style>
    </main>
  );
}
