'use client';

/**
 * /signup/player — 플레이어(일반 사용자) 단일 페이지 가입
 *
 * 진입장벽 최소화: 마법사 없음. 한 화면에 모든 필드.
 * 디자인: 흰 배경 + 핑크 액센트. 로그인 페이지와 동일 톤.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks';
import { signupAsPlayer, validatePassword } from '@/lib/emailAuth';

function mapFirebaseError(msg: string): string {
  if (msg.includes('email-already-in-use')) return '이미 사용 중인 이메일입니다.';
  if (msg.includes('invalid-email')) return '이메일 형식이 올바르지 않습니다.';
  if (msg.includes('weak-password')) return '비밀번호가 너무 간단합니다. 8자 이상, 영문·숫자를 포함해 주세요.';
  if (msg.includes('network-request-failed')) return '네트워크 연결을 확인해 주세요.';
  if (msg.includes('too-many-requests')) return '잠시 후 다시 시도해 주세요.';
  return '가입 중 오류가 발생했습니다. 다시 시도해 주세요.';
}

export default function PlayerSignupPage() {
  const router = useRouter();
  const authState = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [nickname, setNickname] = useState('');
  const [passwordHint, setPasswordHint] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showPwConfirm, setShowPwConfirm] = useState(false);

  const [agreeAll, setAgreeAll] = useState(false);
  const [agreeService, setAgreeService] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 이미 로그인된 경우 /m으로
  useEffect(() => {
    if (authState.status === 'authenticated') {
      router.replace('/m');
    }
  }, [authState, router]);

  // 전체 동의 연동
  const handleAgreeAll = (checked: boolean) => {
    setAgreeAll(checked);
    setAgreeService(checked);
    setAgreePrivacy(checked);
    setAgreeMarketing(checked);
  };

  useEffect(() => {
    setAgreeAll(agreeService && agreePrivacy && agreeMarketing);
  }, [agreeService, agreePrivacy, agreeMarketing]);

  const pwError = password ? validatePassword(password) : null;
  const pwMatchError =
    passwordConfirm && password !== passwordConfirm ? '비밀번호가 일치하지 않습니다.' : null;
  const nicknameError =
    nickname && (nickname.length < 2 || nickname.length > 16)
      ? '닉네임은 2~16자로 입력해 주세요.'
      : null;

  const canSubmit =
    email.trim() &&
    !pwError &&
    password &&
    password === passwordConfirm &&
    nickname.trim().length >= 2 &&
    nickname.trim().length <= 16 &&
    agreeService &&
    agreePrivacy &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await signupAsPlayer({
        email,
        password,
        nickname: nickname.trim(),
        passwordHint: passwordHint.trim() || undefined,
        agreeService,
        agreePrivacy,
        agreeMarketing,
      });
      router.replace('/m');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(mapFirebaseError(msg));
    } finally {
      setSubmitting(false);
    }
  };

  if (authState.status === 'loading' || authState.status === 'authenticated') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-sm text-gray-500">로딩 중…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white flex flex-col">
      <div className="flex-1 flex flex-col items-center px-5 pt-10 pb-12">
        {/* 헤더 */}
        <div className="w-full max-w-sm mb-8">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6"
            aria-label="로그인으로 돌아가기"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
            로그인
          </Link>
          <img src="/logo.svg" alt="HoldemNow" width={140} height={24} className="mb-5" />
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">일반 가입</h1>
          <p className="text-sm text-gray-500 mt-1.5">플레이어·일반 사용자로 시작하세요.</p>
        </div>

        {/* 폼 카드 */}
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm space-y-5"
          noValidate
        >
          {/* 이메일 */}
          <div>
            <label className="block text-[13px] font-bold text-gray-700 mb-1.5" htmlFor="email">
              이메일 <span className="text-[#FF1F8F]" aria-hidden="true">*</span>
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              className="player-input"
            />
          </div>

          {/* 비밀번호 */}
          <div>
            <label className="block text-[13px] font-bold text-gray-700 mb-1.5" htmlFor="password">
              비밀번호 <span className="text-[#FF1F8F]" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8자 이상, 영문·숫자 포함"
                className="player-input pr-14"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-gray-400 hover:text-gray-700"
                tabIndex={-1}
                aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}
              >
                {showPw ? '숨기기' : '보기'}
              </button>
            </div>
            {pwError && (
              <p className="text-[12px] text-red-600 mt-1.5 leading-snug">{pwError}</p>
            )}
          </div>

          {/* 비밀번호 확인 */}
          <div>
            <label className="block text-[13px] font-bold text-gray-700 mb-1.5" htmlFor="password-confirm">
              비밀번호 확인 <span className="text-[#FF1F8F]" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <input
                id="password-confirm"
                type={showPwConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="비밀번호를 다시 입력하세요"
                className="player-input pr-14"
              />
              <button
                type="button"
                onClick={() => setShowPwConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-gray-400 hover:text-gray-700"
                tabIndex={-1}
                aria-label={showPwConfirm ? '비밀번호 숨기기' : '비밀번호 보기'}
              >
                {showPwConfirm ? '숨기기' : '보기'}
              </button>
            </div>
            {pwMatchError && (
              <p className="text-[12px] text-red-600 mt-1.5 leading-snug">{pwMatchError}</p>
            )}
          </div>

          {/* 닉네임 */}
          <div>
            <label className="block text-[13px] font-bold text-gray-700 mb-1.5" htmlFor="nickname">
              닉네임 <span className="text-[#FF1F8F]" aria-hidden="true">*</span>
            </label>
            <input
              id="nickname"
              type="text"
              autoComplete="nickname"
              required
              maxLength={16}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="2~16자 자유 입력"
              className="player-input"
            />
            {nicknameError && (
              <p className="text-[12px] text-red-600 mt-1.5 leading-snug">{nicknameError}</p>
            )}
          </div>

          {/* 비밀번호 힌트 (선택) */}
          <div>
            <label className="block text-[13px] font-bold text-gray-700 mb-1.5" htmlFor="pw-hint">
              비밀번호 힌트{' '}
              <span className="text-[11px] font-normal text-gray-400">(선택 — 비밀번호 분실 시 도움)</span>
            </label>
            <input
              id="pw-hint"
              type="text"
              value={passwordHint}
              onChange={(e) => setPasswordHint(e.target.value)}
              placeholder="예: 반려동물 이름"
              className="player-input"
              maxLength={40}
            />
          </div>

          {/* 구분선 */}
          <div className="border-t border-gray-100 pt-1" />

          {/* 약관 동의 */}
          <fieldset>
            <legend className="text-[13px] font-bold text-gray-700 mb-3">약관 동의</legend>
            <div className="space-y-2.5">
              {/* 전체 동의 */}
              <label className="flex items-center gap-3 cursor-pointer py-2 px-3 rounded-xl bg-gray-50 border border-gray-200">
                <CheckBox
                  id="agree-all"
                  checked={agreeAll}
                  onChange={(checked) => handleAgreeAll(checked)}
                />
                <span className="text-[14px] font-bold text-gray-900">전체 동의</span>
              </label>

              <div className="pl-1 space-y-2">
                <label className="flex items-center gap-3 cursor-pointer py-1.5">
                  <CheckBox
                    id="agree-service"
                    checked={agreeService}
                    onChange={setAgreeService}
                  />
                  <span className="text-[13px] text-gray-700">
                    서비스 이용약관 동의{' '}
                    <span className="text-[#FF1F8F] font-bold">(필수)</span>
                  </span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer py-1.5">
                  <CheckBox
                    id="agree-privacy"
                    checked={agreePrivacy}
                    onChange={setAgreePrivacy}
                  />
                  <span className="text-[13px] text-gray-700">
                    개인정보 처리방침 동의{' '}
                    <span className="text-[#FF1F8F] font-bold">(필수)</span>
                  </span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer py-1.5">
                  <CheckBox
                    id="agree-marketing"
                    checked={agreeMarketing}
                    onChange={setAgreeMarketing}
                  />
                  <span className="text-[13px] text-gray-700">
                    마케팅·알림 수신 동의{' '}
                    <span className="text-gray-400">(선택)</span>
                  </span>
                </label>
              </div>
            </div>
          </fieldset>

          {/* 에러 메시지 */}
          {error && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-[13px] text-red-700 leading-relaxed"
            >
              {error}
            </div>
          )}

          {/* 제출 버튼 */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-4 rounded-2xl font-extrabold text-[15px] text-white transition-opacity disabled:opacity-40 mt-2"
            style={{ background: '#FF1F8F' }}
          >
            {submitting ? '가입 중…' : '가입 완료'}
          </button>

          <p className="text-center text-[12px] text-gray-500">
            이미 계정이 있으신가요?{' '}
            <Link href="/login" className="font-bold text-gray-900 underline underline-offset-2">
              로그인
            </Link>
          </p>
        </form>
      </div>

      <p className="text-[10px] text-gray-400 text-center pb-6 leading-relaxed">
        가입 시 이용약관 및 개인정보 처리방침에 동의합니다.
        <br />
        정보 제공 플랫폼 (사행성 매개 X)
      </p>

      <style jsx global>{`
        .player-input {
          background: #fff;
          border: 1.5px solid #e5e7eb;
          border-radius: 10px;
          padding: 12px 14px;
          font-size: 15px;
          color: #111;
          width: 100%;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.15s;
        }
        .player-input:focus {
          border-color: #FF1F8F;
        }
        .player-input::placeholder {
          color: #c1c7d0;
        }
      `}</style>
    </main>
  );
}

function CheckBox({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      id={id}
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors"
      style={{
        borderColor: checked ? '#FF1F8F' : '#d1d5db',
        background: checked ? '#FF1F8F' : '#fff',
      }}
    >
      {checked && (
        <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden="true">
          <path d="M1 4.5L4 7.5L10 1.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}
