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
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { loginWithEmail } from '@/lib/emailAuth';

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
    if (!email.trim() || !password) return;
    setLoggingIn(true);
    setLoginError(null);
    setWrongAccountInfo(null);
    try {
      await loginWithEmail(email, password);
      // 라우팅·권한 검증은 useEffect가 처리
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
        setLoginError('이메일 또는 비밀번호가 올바르지 않습니다.');
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
        {/* 로고 + 컨텍스트 라벨 (다크 톤 — 본사 어드민 컨텍스트 유지) */}
        <div className="flex flex-col items-center mb-8 mt-6">
          <img src="/logo-white.svg" alt="HoldemNow" width={180} height={30} className="mb-2" />
          <div className="flex items-center gap-1.5 mt-1.5">
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
            <form onSubmit={handleEmailLogin} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-300 block mb-1.5">본사 관리자 이메일</label>
                <input
                  type="email"
                  className="platform-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@holdemnow.com"
                  autoComplete="email"
                  required
                />
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
        본사 운영 대시보드 · HoldemNow Internal
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
