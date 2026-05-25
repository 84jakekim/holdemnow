'use client';

/**
 * /login/business — 매장 사장·대회사 관계자 전용 로그인 페이지
 *
 * /login 메인은 일반 사용자(플레이어) 위주.
 * 사장님·대회사 관계자는 우측 상단 진입점을 통해 이곳으로 분기.
 *
 * 분기:
 *  - 비밀번호 찾기:   /login/recover
 *  - 매장 가입신청:   /signup/store
 *  - 대회사 가입신청: /signup/organizer
 *  - 일반 로그인 회귀: /login
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { loginWithEmailExpecting, WrongRoleError } from '@/lib/emailAuth';
import { RabbitLogo } from '@/components/ui';

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
              className="block w-full px-4 py-2.5 rounded-xl bg-[#FF1F8F] text-white text-sm font-extrabold"
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
    <main className="min-h-screen flex flex-col bg-white relative">
      {/* 좌측 상단 — 일반 로그인으로 회귀 */}
      <Link
        href="/login"
        className="absolute top-3 left-3 text-[11px] font-medium text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-full hover:bg-gray-100 transition"
      >
        ← 일반 로그인으로
      </Link>

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10">
        {/* Hero 스플래시 — Pink Rabbit handoff: 핑크 hero 카드 (Business) */}
        <div
          className="relative overflow-hidden w-full max-w-sm mb-8 mt-2"
          style={{
            borderRadius: 28,
            padding: '30px 24px 26px',
            background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BAA 50%, #FFB3D4 100%)',
            color: '#ffffff',
            boxShadow: '0 18px 48px rgba(255,31,143,0.30), 0 4px 14px rgba(0,0,0,0.10)',
          }}
        >
          <div
            aria-hidden
            style={{ position: 'absolute', top: -34, right: -40, opacity: 0.18, pointerEvents: 'none' }}
          >
            <RabbitLogo size={200} variant="mark" />
          </div>
          <div
            aria-hidden
            style={{
              position: 'absolute', top: -18, right: -18, width: 90, height: 90,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 70%)',
              pointerEvents: 'none',
            }}
          />
          <div className="relative flex flex-col items-center" style={{ zIndex: 1 }}>
            <RabbitLogo size={80} variant="badge" glow aria-label="Pink Rabbit Business" />
            <div
              className="mt-3 font-black"
              style={{
                fontSize: 22,
                letterSpacing: '-0.03em',
                color: '#ffffff',
                textShadow: '0 2px 10px rgba(0,0,0,0.18)',
              }}
            >
              Pink Rabbit
            </div>
            <span
              className="mt-2 text-[10px] font-extrabold px-2.5 py-1 rounded-full"
              style={{
                background: 'rgba(255,255,255,0.22)',
                border: '1px solid rgba(255,255,255,0.32)',
                color: '#ffffff',
                letterSpacing: '0.10em',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
              }}
            >
              매장·대회사 전용
            </span>
            <p className="text-[12px] mt-2 font-semibold" style={{ color: 'rgba(255,255,255,0.94)' }}>
              홀덤펍 사장님 · 대회사 관계자 로그인
            </p>
          </div>
        </div>

        <div className="w-full max-w-sm">
          {/* ── 이메일/비밀번호 로그인 ── */}
          <form onSubmit={handleEmailLogin} className="space-y-3">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1.5">이메일</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="가입 시 등록한 이메일"
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
              {loggingIn ? '로그인 중…' : '매장 / 대회사 로그인'}
            </button>
          </form>

          {/* 가입신청 카드 */}
          <div className="mt-6 bg-gray-50 rounded-xl p-4 space-y-2">
            <div className="text-[10px] font-bold text-gray-500 tracking-widest mb-1">아직 가입하지 않으셨나요?</div>
            <Link
              href="/signup/store"
              className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:border-[#FF1F8F] transition"
            >
              <div>
                <div className="text-sm font-bold text-gray-900">매장 가입 신청</div>
                <div className="text-[11px] text-gray-500 mt-0.5">홀덤펍 사장님·매니저 전용</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="text-gray-400">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </Link>
            <Link
              href="/signup/organizer"
              className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:border-[#FF1F8F] transition"
            >
              <div>
                <div className="text-sm font-bold text-gray-900">대회사 가입 신청</div>
                <div className="text-[11px] text-gray-500 mt-0.5">홀덤 대회 운영 법인·단체</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="text-gray-400">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </Link>
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
