'use client';

/**
 * /m/onboarding/phone — 신규 가입 사용자 전화번호 등록 강제 페이지.
 *
 * 정책:
 * - 모든 신규 가입(Google/Kakao/Email/Player)은 전화번호를 입력해야 앱 사용 가능.
 * - users/{uid}.phone 미등록 사용자는 m/layout.tsx 게이트가 이 페이지로 강제 리다이렉트.
 * - setUserPhone이 phoneIndex 트랜잭션으로 1인 1번호 정책을 보장.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUserDoc } from '@/lib/hooks';
import { normalizePhone, formatPhone } from '@/lib/phone';
import { setUserPhone } from '@/lib/userProfile';

export default function OnboardingPhonePage() {
  const authState = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const uid = authState.status === 'authenticated' ? authState.user.uid : null;
  const userDoc = useUserDoc(uid);

  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 다음 이동 경로 (next 쿼리 또는 /m)
  const nextPath = useMemo(() => {
    const raw = searchParams?.get('next') ?? '';
    // 오픈 리다이렉트 방지 — /m 영역만 허용
    if (raw && raw.startsWith('/m') && !raw.startsWith('/m/onboarding')) return raw;
    return '/m';
  }, [searchParams]);

  // 이미 등록된 사용자는 즉시 통과
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    if (userDoc === undefined) return;
    if (userDoc && userDoc.phone) {
      router.replace(nextPath);
    }
  }, [authState.status, userDoc, router, nextPath]);

  // 입력 정규화 미리보기
  const normalized = useMemo(() => normalizePhone(phone), [phone]);
  const showValidation = phone.replace(/\D/g, '').length >= 3;
  const isValid = normalized !== null;

  const handleSubmit = async () => {
    if (!uid) return;
    setError(null);
    if (!normalized) {
      setError('유효한 전화번호 형식이 아닙니다. 예: 010-1234-5678');
      return;
    }
    setBusy(true);
    try {
      await setUserPhone(uid, phone);
      router.replace(nextPath);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 로딩 상태
  if (authState.status === 'loading' || (authState.status === 'authenticated' && userDoc === undefined)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      </div>
    );
  }
  // anonymous는 AuthGate가 처리

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--bg)' }}
    >
      <div className="flex-1 flex flex-col px-6 pt-12 pb-8 max-w-md mx-auto w-full">
        {/* 헤더 */}
        <div className="mb-6">
          <div className="text-3xl mb-3">📱</div>
          <h1
            className="text-2xl font-extrabold tracking-tight"
            style={{ color: 'var(--text-1)' }}
          >
            전화번호 등록
          </h1>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            HoldemNow 사용을 위해 본인 명의 핸드폰 번호를 등록해 주세요.
          </p>
        </div>

        {/* 안내 카드 */}
        <div
          className="rounded-2xl p-4 mb-6"
          style={{
            background: 'rgba(255, 31, 143, 0.06)',
            border: '1px solid rgba(255, 31, 143, 0.18)',
          }}
        >
          <ul className="text-[12px] leading-relaxed space-y-1.5" style={{ color: 'var(--text-2)' }}>
            <li className="flex gap-2">
              <span style={{ color: 'var(--brand)' }}>·</span>
              <span>1인 1계정 정책 보호</span>
            </li>
            <li className="flex gap-2">
              <span style={{ color: 'var(--brand)' }}>·</span>
              <span>매장 예약·LIVE 알림 등에 사용</span>
            </li>
            <li className="flex gap-2">
              <span style={{ color: 'var(--brand)' }}>·</span>
              <span>본사·매장 외 공개되지 않음</span>
            </li>
          </ul>
        </div>

        {/* 입력 */}
        <div className="mb-6">
          <label
            className="block text-[12px] font-bold mb-2"
            style={{ color: 'var(--text-2)' }}
          >
            핸드폰 번호
          </label>
          <div className="relative">
            <input
              type="tel"
              inputMode="tel"
              autoFocus
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy && isValid) handleSubmit();
              }}
              maxLength={20}
              placeholder="010-1234-5678"
              className="w-full px-4 py-4 rounded-2xl text-lg font-semibold outline-none transition tracking-wide pr-12"
              style={{
                background: 'var(--surface-1)',
                border: showValidation
                  ? `2px solid ${isValid ? '#10B981' : '#E53E3E'}`
                  : '2px solid var(--border)',
                color: 'var(--text-1)',
              }}
            />
            {showValidation && (
              <span
                aria-hidden="true"
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xl font-extrabold"
                style={{ color: isValid ? '#10B981' : '#E53E3E' }}
              >
                {isValid ? '✓' : '✕'}
              </span>
            )}
          </div>
          {showValidation && isValid && normalized && (
            <div className="text-[11px] mt-1.5" style={{ color: '#10B981' }}>
              확인: {formatPhone(normalized)}
            </div>
          )}
          {showValidation && !isValid && (
            <div className="text-[11px] mt-1.5" style={{ color: '#E53E3E' }}>
              유효하지 않은 형식입니다 (예: 010-1234-5678)
            </div>
          )}
        </div>

        {/* 에러 박스 */}
        {error && (
          <div
            className="mb-4 px-4 py-3 rounded-xl text-[12px] font-bold"
            style={{
              background: 'rgba(229, 62, 62, 0.10)',
              border: '1px solid rgba(229, 62, 62, 0.30)',
              color: '#E53E3E',
            }}
          >
            {error}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleSubmit}
          disabled={busy || !isValid}
          className="w-full py-4 rounded-2xl text-base font-extrabold text-white transition active:scale-[0.98] disabled:opacity-40"
          style={{
            background: 'var(--brand)',
            boxShadow: 'var(--shadow-brand)',
          }}
        >
          {busy ? '등록 중…' : '등록하고 계속하기'}
        </button>

        <p
          className="text-[10px] text-center mt-4 leading-relaxed"
          style={{ color: 'var(--text-3)' }}
        >
          입력하신 번호는 매장 예약·알림 발송 용도로만 사용되며,
          <br />
          다른 사용자에게 공개되지 않습니다.
        </p>
      </div>
    </div>
  );
}
