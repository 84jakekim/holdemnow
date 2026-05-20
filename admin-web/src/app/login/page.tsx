'use client';

/**
 * /login — 일반 사용자(플레이어) 위주의 메인 로그인 페이지
 *
 * 레이아웃:
 *  - 우측 상단: 매장/대회사 진입점 3개 (매장 가입신청 · 대회사 가입신청 · 매장·대회사 로그인).
 *    플레이어가 압도적 다수이므로 사장님·대회사는 별도 페이지(`/login/business`)로 분리.
 *  - 메인: ① 이메일/비번(일반 사용자) → ② 카카오/Google 순으로 노출.
 *  - 일반 사용자가 자체 가입한 계정으로 로그인하는 흐름이 1순위, 소셜 로그인이 2순위.
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
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { startKakaoLogin } from '@/lib/kakaoAuth';
import { loginAsPlayerWithGoogle, getLoginIntent, clearLoginIntent } from '@/lib/auth';
import { loginWithEmail } from '@/lib/emailAuth';

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

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // AuthGate가 redirect할 때 붙여주는 `?next=/admin/...` 등 의도된 목적지 우선 존중.
  // 단, 권한 외 경로로의 오픈 리다이렉트 방지를 위해 안전 prefix만 허용.
  const nextParam = searchParams?.get('next') ?? '';
  const isSafeNext =
    nextParam.startsWith('/m') ||
    nextParam.startsWith('/admin') ||
    nextParam.startsWith('/organizer') ||
    nextParam.startsWith('/platform');

  // 로그인 후 role 기반 라우팅
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    const uid = authState.user.uid;

    // 카카오 — 항상 player. userDoc 로딩이 끝나야 storeId 판정 가능.
    if (uid.startsWith('kakao:')) {
      if (userDoc === undefined) return; // 로딩 중엔 라우팅 보류 (이게 빠져있어 /m으로 잘못 튕기던 버그)
      if (userDoc && userDoc.storeId) {
        router.replace(`/admin/${userDoc.storeId}`);
        return;
      }
      // 카카오 사용자가 매장 사장이 아니면 — next가 안전 경로면 우선, 아니면 /m
      router.replace(isSafeNext ? nextParam : '/m');
      return;
    }

    if (userDoc === undefined) return;

    if (userDoc) {
      if (hasRole(userDoc, 'platform_admin') && !userDoc.storeId) {
        router.replace(isSafeNext ? nextParam : '/platform');
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
      if (userDoc.role === 'player' || userDoc.roles?.includes('player')) {
        router.replace(isSafeNext ? nextParam : '/m');
        return;
      }
      router.replace(isSafeNext ? nextParam : '/m');
      return;
    }

    // 문서 없음 (Google 첫 로그인)
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
      await loginWithEmail(email, password);
    } catch (err: unknown) {
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
  if (authState.status === 'authenticated') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        이동 중…
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col bg-white relative">
      {/*
       * 우측 상단 — 매장/대회사 진입점.
       * 일반 사용자(플레이어)가 1순위 화면이라 메인 영역에서는 의도적으로 숨김.
       * 사장님·대회사 관계자는 여기를 통해 별도 페이지로 이동.
       */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5 z-10">
        <Link
          href="/login/business"
          className="text-[11px] font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1.5 transition"
          title="이미 매장/대회사 계정이 있는 분"
        >
          🏬 매장·대회사 로그인 →
        </Link>
        <div className="flex gap-1.5">
          <Link
            href="/signup/store"
            className="text-[10px] text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
            title="홀덤펍 사장님·매니저 신규 가입"
          >
            매장 가입신청
          </Link>
          <span className="text-[10px] text-gray-300">·</span>
          <Link
            href="/signup/organizer"
            className="text-[10px] text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
            title="홀덤 대회 운영 법인·단체 신규 가입"
          >
            대회사 가입신청
          </Link>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-12">
        {/* 로고 */}
        <div className="flex flex-col items-center mb-8 mt-6">
          <img src="/logo.svg" alt="HoldemNow" width={180} height={30} className="mb-2" />
          <p className="text-xs text-gray-500">전국 홀덤펍 · 토너먼트 디스커버리</p>
        </div>

        <div className="w-full max-w-sm">
          {/* ── ① 이메일 로그인 (일반 사용자) ── */}
          <form onSubmit={handleEmailLogin} className="space-y-3">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1.5">이메일</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일 주소"
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1.5">비밀번호</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="form-input pr-14"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 font-medium"
                  tabIndex={-1}
                >
                  {showPw ? '숨기기' : '보기'}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 leading-relaxed">
                {loginError}
              </div>
            )}

            {/* 비번 찾기 — 폼 안 우측 정렬, 핑크 강조로 분실 사용자가 즉시 발견 */}
            <div className="flex justify-end -mt-1">
              <Link
                href="/login/recover"
                className="text-xs font-bold underline underline-offset-2"
                style={{ color: 'var(--brand, #FF1F8F)' }}
              >
                비밀번호를 잊으셨나요?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loggingIn || !email.trim() || !password}
              className="w-full py-3.5 rounded-xl font-bold text-sm text-white transition disabled:opacity-40 mt-1"
              style={{ background: '#FF1F8F' }}
            >
              {loggingIn ? '로그인 중…' : '로그인'}
            </button>
          </form>

          {/* 보조 링크 — 일반 가입 */}
          <div className="flex items-center justify-center gap-3 mt-3 text-xs text-gray-500">
            <Link href="/signup/player" className="hover:text-gray-900 underline underline-offset-2 font-bold text-[#FF1F8F]">
              일반 가입
            </Link>
          </div>

          {/* ── 구분선 ── */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-[11px] text-gray-400 font-medium">또는 SNS로 시작</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          {/* ── ② 소셜 로그인 ── */}
          <div className="space-y-2.5">
            <button
              onClick={handleKakaoLogin}
              className="w-full bg-[#FEE500] text-[#181600] py-3.5 rounded-xl font-bold text-sm hover:opacity-90 transition flex items-center justify-center gap-2"
            >
              <span className="text-base leading-none">💬</span>
              <span>카카오로 시작하기</span>
            </button>
            <button
              onClick={handleGoogleLogin}
              className="w-full bg-white border border-gray-200 text-gray-900 py-3.5 rounded-xl font-bold text-sm hover:bg-gray-50 transition flex items-center justify-center gap-2"
            >
              <GoogleIcon />
              <span>Google로 시작하기</span>
            </button>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 text-center pb-6 leading-relaxed">
        로그인 시 이용약관 및 개인정보 처리방침에 동의합니다.
        <br />
        정보 제공 플랫폼 (사행성 매개 X)
      </p>

      <style jsx global>{`
        .form-input {
          background: #fff;
          border: 1.5px solid #e5e7eb;
          border-radius: 10px;
          padding: 11px 14px;
          font-size: 14px;
          color: #111;
          width: 100%;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.15s;
        }
        .form-input:focus { border-color: #FF1F8F; }
      `}</style>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
