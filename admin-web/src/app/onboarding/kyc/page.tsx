'use client';

/**
 * /onboarding/kyc — KYC Soft-wall 본인 확인 페이지
 *
 * OAuth 가입자 또는 기존 사용자 중 realName/phone 미입력자를 위한
 * 한 번만 입력하는 필수 본인 확인 페이지.
 *
 * - 닫기/스킵 불가 (X 버튼 → 로그아웃 confirm)
 * - 제출 후 returnTo (sessionStorage) 또는 role 기반 라우팅
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';

function formatPhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export default function KycPage() {
  const authState = useAuth();
  const router = useRouter();

  const [realName, setRealName] = useState('');
  const [phone, setPhone] = useState('');
  const [agreeMarketing, setAgreeMarketing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneRaw = phone.replace(/[^0-9]/g, '');

  const realNameError =
    realName && (realName.trim().length < 2 || realName.trim().length > 10)
      ? '실명은 2~10자로 입력해 주세요.'
      : null;
  const phoneError =
    phone && (phoneRaw.length < 8 || phoneRaw.length > 11)
      ? '휴대폰 번호를 정확히 입력해 주세요.'
      : null;

  const canSubmit =
    realName.trim().length >= 2 &&
    realName.trim().length <= 10 &&
    phoneRaw.length >= 8 &&
    !phoneError &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || authState.status !== 'authenticated') return;
    setError(null);
    setSubmitting(true);

    const uid = authState.user.uid;
    const isOAuth =
      (authState.user.providerData ?? []).some(
        (p) => p.providerId === 'google.com' || p.providerId === 'kakao',
      );
    const kycSource = isOAuth ? 'oauth-onboarding' : 'migration';

    try {
      await setDoc(
        doc(db, 'users', uid),
        {
          realName: realName.trim(),
          phone: phone.trim(),
          kycCompletedAt: serverTimestamp(),
          kycSource,
          agreeMarketing,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      // returnTo 복원
      let returnTo = '/m';
      try {
        const stored = sessionStorage.getItem('kycReturnTo');
        if (stored && (stored.startsWith('/m') || stored.startsWith('/admin') || stored.startsWith('/platform') || stored.startsWith('/organizer'))) {
          returnTo = stored;
          sessionStorage.removeItem('kycReturnTo');
        }
      } catch {
        // sessionStorage 실패 무시
      }

      router.replace(returnTo);
    } catch {
      setError('저장 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async () => {
    if (!window.confirm('본인 확인을 완료하지 않으면 서비스를 이용할 수 없습니다.\n로그아웃하시겠습니까?')) return;
    await signOut(auth);
    router.replace('/login');
  };

  if (authState.status === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-sm text-gray-500">로딩 중…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 pt-8 pb-4">
        <div />
        <h1 className="text-base font-extrabold text-gray-900">본인 확인이 필요합니다</h1>
        <button
          type="button"
          onClick={handleClose}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 transition rounded-full"
          aria-label="닫기 (로그아웃)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center px-5 pb-12">
        <div className="w-full max-w-sm">
          {/* 안내 */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-6 text-center">
            <div className="text-3xl mb-2">🔐</div>
            <p className="text-sm text-gray-700 leading-relaxed">
              원활한 서비스 이용을 위해 실명·휴대폰 정보를 한 번만 입력해주세요.
              <br />
              <span className="text-gray-500 text-[12px]">약 30초 소요됩니다.</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* 실명 */}
            <div>
              <label className="block text-[13px] font-bold text-gray-700 mb-1.5" htmlFor="kyc-real-name">
                실명 <span className="text-[#FF1F8F]" aria-hidden="true">*</span>
              </label>
              <input
                id="kyc-real-name"
                type="text"
                autoComplete="name"
                required
                maxLength={10}
                value={realName}
                onChange={(e) => setRealName(e.target.value)}
                placeholder="2~10자 (한글 또는 영문)"
                className="kyc-input"
                autoFocus
              />
              {realNameError && (
                <p className="text-[12px] text-red-600 mt-1.5">{realNameError}</p>
              )}
            </div>

            {/* 휴대폰 */}
            <div>
              <label className="block text-[13px] font-bold text-gray-700 mb-1.5" htmlFor="kyc-phone">
                휴대폰 번호 <span className="text-[#FF1F8F]" aria-hidden="true">*</span>
              </label>
              <input
                id="kyc-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="010-0000-0000"
                className="kyc-input"
                maxLength={13}
              />
              {phoneError && (
                <p className="text-[12px] text-red-600 mt-1.5">{phoneError}</p>
              )}
            </div>

            {/* 마케팅 동의 (선택 — OAuth 가입자가 이전에 동의하지 않은 경우) */}
            <label className="flex items-start gap-3 cursor-pointer py-2 px-3 rounded-xl bg-gray-50 border border-gray-100">
              <button
                type="button"
                role="checkbox"
                aria-checked={agreeMarketing}
                onClick={() => setAgreeMarketing((v) => !v)}
                className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors"
                style={{
                  borderColor: agreeMarketing ? '#FF1F8F' : '#d1d5db',
                  background: agreeMarketing ? '#FF1F8F' : '#fff',
                }}
              >
                {agreeMarketing && (
                  <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden="true">
                    <path d="M1 4.5L4 7.5L10 1.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
              <span className="text-[13px] text-gray-700">
                마케팅·알림 수신 동의{' '}
                <span className="text-gray-400">(선택)</span>
              </span>
            </label>

            {/* 개인정보 안내 */}
            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
              입력한 실명·휴대폰은 본인 확인 목적으로만 사용되며<br />
              외부 제3자에게 제공되지 않습니다.
            </p>

            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-3 text-[13px] text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-4 rounded-2xl font-extrabold text-[15px] text-white transition-opacity disabled:opacity-40 mt-2"
              style={{ background: '#FF1F8F' }}
            >
              {submitting ? '저장 중…' : '확인 완료'}
            </button>
          </form>
        </div>
      </div>

      <style jsx global>{`
        .kyc-input {
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
        .kyc-input:focus {
          border-color: #FF1F8F;
        }
        .kyc-input::placeholder {
          color: #c1c7d0;
        }
      `}</style>
    </main>
  );
}
