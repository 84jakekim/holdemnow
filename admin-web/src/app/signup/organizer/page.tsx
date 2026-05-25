'use client';

/**
 * /signup/organizer — 대회사 자체 가입 마법사 (4-step)
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  signupAsOrganizer,
  validatePassword,
  validateBusinessReg,
  formatBusinessReg,
  type OrganizerSignupPayload,
} from '@/lib/emailAuth';

type FormState = Omit<OrganizerSignupPayload, 'agreeService' | 'agreePrivacy' | 'agreeMarketing'> & {
  passwordConfirm: string;
  agreeService: boolean;
  agreePrivacy: boolean;
  agreeMarketing: boolean;
};

const INITIAL: FormState = {
  email: '',
  password: '',
  passwordConfirm: '',
  passwordHint: '',
  recoveryLast4: '',
  companyName: '',
  businessRegistrationNumber: '',
  representativeName: '',
  representativePhone: '',
  companyAddress: '',
  contactPersonName: '',
  contactPersonPosition: '',
  contactPersonPhone: '',
  contactPersonEmail: '',
  tournamentReferences: '',
  agreeService: false,
  agreePrivacy: false,
  agreeMarketing: false,
};

const STEP_LABELS = ['', '계정 정보', '회사 정보', '담당자 정보', '레퍼런스 + 약관'];
const STEP_SUBS = ['', '로그인에 사용할 이메일·비밀번호', '회사명·사업자번호·대표자', '담당자 이름·연락처', '대회 운영 이력 + 약관 동의'];

export default function OrganizerSignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showPwConfirm, setShowPwConfirm] = useState(false);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const canNext = (() => {
    if (step === 1) {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
      const pwOk = validatePassword(form.password) === null;
      const pwMatch = form.password === form.passwordConfirm;
      const hintOk = form.passwordHint.trim().length >= 2;
      const last4Ok = /^\d{4}$/.test(form.recoveryLast4.trim());
      return emailOk && pwOk && pwMatch && hintOk && last4Ok;
    }
    if (step === 2) {
      return (
        form.companyName.trim().length >= 1 &&
        validateBusinessReg(form.businessRegistrationNumber) &&
        form.representativeName.trim().length >= 1 &&
        form.representativePhone.trim().length >= 7
      );
    }
    if (step === 3) {
      return (
        form.contactPersonName.trim().length >= 1 &&
        form.contactPersonPhone.trim().length >= 7
      );
    }
    if (step === 4) {
      return form.agreeService && form.agreePrivacy;
    }
    return false;
  })();

  const handleSubmit = async () => {
    if (!canNext) return;
    setSubmitting(true);
    setError(null);
    try {
      await signupAsOrganizer({
        email: form.email,
        password: form.password,
        passwordHint: form.passwordHint,
        recoveryLast4: form.recoveryLast4,
        companyName: form.companyName,
        businessRegistrationNumber: form.businessRegistrationNumber,
        representativeName: form.representativeName,
        representativePhone: form.representativePhone,
        companyAddress: form.companyAddress,
        contactPersonName: form.contactPersonName,
        contactPersonPosition: form.contactPersonPosition || undefined,
        contactPersonPhone: form.contactPersonPhone,
        contactPersonEmail: form.contactPersonEmail || undefined,
        tournamentReferences: form.tournamentReferences,
        agreeService: form.agreeService,
        agreePrivacy: form.agreePrivacy,
        agreeMarketing: form.agreeMarketing,
      });
      setDone(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('email-already-in-use')) {
        setError('이미 가입된 이메일입니다. 로그인 페이지에서 로그인해 주세요.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-md p-8 text-center lift" style={{ boxShadow: 'var(--shadow-card)' }}>
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M20 6L9 17l-5-5" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="text-xl font-extrabold text-gray-900 mb-2">가입 신청 완료!</div>
          <div className="text-sm text-gray-600 leading-relaxed mb-6">
            <b className="text-gray-900">{form.companyName}</b>의 대회사 가입 신청이 접수되었습니다.
            <br />
            본사 심사 후 승인 안내를 드립니다.
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left text-xs text-amber-800 leading-relaxed mb-6">
            <div className="font-bold text-amber-900 mb-1">심사 안내</div>
            대회사 심사는 영업일 기준 2~5일 소요됩니다. 레퍼런스 확인 후 승인 연락드립니다.
            <br /><br />
            문의: 카카오톡 채널 <b>Pink Rabbit</b> 또는 이메일 <b>admin@holdemnow.com</b>
          </div>
          <Link
            href="/login"
            className="block w-full py-3.5 rounded-xl font-bold text-sm text-white text-center"
            style={{ background: '#FF1F8F' }}
          >
            로그인 페이지로
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-start pt-8 pb-16 px-4">
      <div className="w-full max-w-md mb-4">
        <Link
          href="/login"
          className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          로그인으로 돌아가기
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-md overflow-hidden lift" style={{ boxShadow: 'var(--shadow-card)' }}>
        {/* 헤더 */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-5">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold transition-all ${
                    step === n
                      ? 'text-white'
                      : step > n
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                  style={step === n ? { background: '#FF1F8F' } : undefined}
                >
                  {step > n ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                    </svg>
                  ) : n}
                </div>
                {n < 4 && (
                  <div className={`h-0.5 w-6 rounded ${step > n ? 'bg-gray-900' : 'bg-gray-100'}`} />
                )}
              </div>
            ))}
          </div>
          <div className="text-[10px] font-bold text-gray-400 tracking-widest mb-1">
            STEP {step} / 4 · 대회사 가입 신청
          </div>
          <div className="text-xl font-extrabold text-gray-900">{STEP_LABELS[step]}</div>
          <div className="text-sm text-gray-500 mt-0.5">{STEP_SUBS[step]}</div>
        </div>

        <div className="p-6 space-y-5 max-h-[56vh] overflow-y-auto">
          {/* ── Step 1: 계정 ── */}
          {step === 1 && (
            <>
              <Field label="이메일 (로그인 아이디)">
                <input
                  type="email"
                  className="form-input"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  placeholder="example@company.com"
                  autoComplete="email"
                />
                {form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && (
                  <FieldError>올바른 이메일 형식이 아닙니다</FieldError>
                )}
              </Field>

              <Field label="비밀번호">
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="form-input pr-10"
                    value={form.password}
                    onChange={(e) => update('password', e.target.value)}
                    placeholder="영문+숫자 8자 이상"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"
                  >
                    {showPw ? '숨기기' : '보기'}
                  </button>
                </div>
                {form.password && validatePassword(form.password) && (
                  <FieldError>{validatePassword(form.password)}</FieldError>
                )}
                {form.password && !validatePassword(form.password) && (
                  <FieldOk>안전한 비밀번호입니다</FieldOk>
                )}
              </Field>

              <Field label="비밀번호 확인">
                <div className="relative">
                  <input
                    type={showPwConfirm ? 'text' : 'password'}
                    className="form-input pr-10"
                    value={form.passwordConfirm}
                    onChange={(e) => update('passwordConfirm', e.target.value)}
                    placeholder="비밀번호를 다시 입력"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwConfirm((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"
                  >
                    {showPwConfirm ? '숨기기' : '보기'}
                  </button>
                </div>
                {form.passwordConfirm && form.password !== form.passwordConfirm && (
                  <FieldError>비밀번호가 일치하지 않습니다</FieldError>
                )}
                {form.passwordConfirm && form.password === form.passwordConfirm && (
                  <FieldOk>일치합니다</FieldOk>
                )}
              </Field>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="text-xs font-bold text-blue-900 mb-3">비밀번호 분실 시 본인 확인용</div>
                <Field label="비밀번호 힌트">
                  <input
                    className="form-input"
                    value={form.passwordHint}
                    onChange={(e) => update('passwordHint', e.target.value)}
                    placeholder="예: 회사 창립연도? / 대표자 생년월일?"
                  />
                </Field>
                <Field label="보조 복구 연락처 마지막 4자리" className="mt-3">
                  <input
                    className="form-input font-mono tracking-widest"
                    value={form.recoveryLast4}
                    onChange={(e) => update('recoveryLast4', e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="0000"
                    maxLength={4}
                    inputMode="numeric"
                  />
                  {form.recoveryLast4 && !/^\d{4}$/.test(form.recoveryLast4) && (
                    <FieldError>숫자 4자리를 입력하세요</FieldError>
                  )}
                </Field>
              </div>
            </>
          )}

          {/* ── Step 2: 회사 정보 ── */}
          {step === 2 && (
            <>
              <Field label="회사명">
                <input
                  className="form-input"
                  value={form.companyName}
                  onChange={(e) => update('companyName', e.target.value)}
                  placeholder="예: (주)ABC 홀덤 시리즈"
                />
              </Field>
              <Field label="사업자등록번호">
                <input
                  className="form-input font-mono"
                  value={form.businessRegistrationNumber}
                  onChange={(e) => update('businessRegistrationNumber', formatBusinessReg(e.target.value))}
                  placeholder="000-00-00000"
                  maxLength={12}
                  inputMode="numeric"
                />
                {form.businessRegistrationNumber && !validateBusinessReg(form.businessRegistrationNumber) && (
                  <FieldError>형식: XXX-XX-XXXXX</FieldError>
                )}
                {form.businessRegistrationNumber && validateBusinessReg(form.businessRegistrationNumber) && (
                  <FieldOk>올바른 형식입니다</FieldOk>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="대표자 이름">
                  <input
                    className="form-input"
                    value={form.representativeName}
                    onChange={(e) => update('representativeName', e.target.value)}
                    placeholder="홍길동"
                  />
                </Field>
                <Field label="대표자 연락처">
                  <input
                    className="form-input font-mono"
                    value={form.representativePhone}
                    onChange={(e) => update('representativePhone', e.target.value)}
                    placeholder="010-0000-0000"
                    inputMode="tel"
                  />
                </Field>
              </div>
              <Field label="회사 주소 (선택)">
                <input
                  className="form-input"
                  value={form.companyAddress}
                  onChange={(e) => update('companyAddress', e.target.value)}
                  placeholder="부산시 해운대구 ..."
                />
              </Field>
            </>
          )}

          {/* ── Step 3: 담당자 ── */}
          {step === 3 && (
            <>
              <div className="text-xs text-gray-500 leading-relaxed mb-2">
                심사 진행 시 연락할 담당자 정보를 입력해 주세요.
              </div>
              <Field label="담당자 이름">
                <input
                  className="form-input"
                  value={form.contactPersonName}
                  onChange={(e) => update('contactPersonName', e.target.value)}
                  placeholder="홍길동"
                />
              </Field>
              <Field label="담당자 직책 (선택)">
                <input
                  className="form-input"
                  value={form.contactPersonPosition}
                  onChange={(e) => update('contactPersonPosition', e.target.value)}
                  placeholder="예: 이사, 팀장, 대표"
                />
              </Field>
              <Field label="담당자 연락처">
                <input
                  className="form-input font-mono"
                  value={form.contactPersonPhone}
                  onChange={(e) => update('contactPersonPhone', e.target.value)}
                  placeholder="010-0000-0000"
                  inputMode="tel"
                />
              </Field>
              <Field label="담당자 이메일 (계정 이메일과 달라도 됩니다, 선택)">
                <input
                  type="email"
                  className="form-input"
                  value={form.contactPersonEmail}
                  onChange={(e) => update('contactPersonEmail', e.target.value)}
                  placeholder="contact@company.com"
                />
              </Field>
            </>
          )}

          {/* ── Step 4: 레퍼런스 + 약관 ── */}
          {step === 4 && (
            <>
              <Field label="대회 운영 레퍼런스 (선택)">
                <textarea
                  className="form-input min-h-[100px] resize-none"
                  value={form.tournamentReferences}
                  onChange={(e) => update('tournamentReferences', e.target.value)}
                  placeholder={`과거 운영한 대회를 자유롭게 기재해 주세요.\n예:\n- 2024 부산 홀덤 챔피언십 (참가 200명)\n- 2023 경남 오픈 시리즈 3회차 운영`}
                />
              </Field>

              <div className="space-y-3 mt-2">
                <AgreementItem
                  checked={form.agreeService}
                  onChange={(v) => update('agreeService', v)}
                  required
                  label="서비스 이용약관 동의 (필수)"
                  detail="본 서비스는 홀덤 정보 제공·중개 플랫폼이며, 베팅·환금 매개를 하지 않습니다. 대회사는 관련 법규를 준수해야 합니다."
                  linkHref="/legal/terms"
                />
                <AgreementItem
                  checked={form.agreePrivacy}
                  onChange={(v) => update('agreePrivacy', v)}
                  required
                  label="개인정보 처리방침 동의 (필수)"
                  detail="수집 항목: 이메일, 대표자 정보, 담당자 정보, 사업자등록번호. 목적: 서비스 제공 및 대회사 운영. 보유: 탈퇴 시까지."
                  linkHref="/legal/privacy"
                />
                <AgreementItem
                  checked={form.agreeMarketing}
                  onChange={(v) => update('agreeMarketing', v)}
                  required={false}
                  label="마케팅 정보 수신 동의 (선택)"
                  detail="서비스 업데이트, 대회 프로모션 정보를 이메일로 받습니다."
                />
              </div>

              <div className="bg-gray-50 rounded-xl p-4 space-y-1.5 text-xs text-gray-600 mt-2">
                <div className="font-bold text-gray-900 mb-2 text-sm">신청 정보 요약</div>
                <SummaryRow label="이메일" value={form.email} />
                <SummaryRow label="회사명" value={form.companyName} />
                <SummaryRow label="사업자번호" value={form.businessRegistrationNumber} />
                <SummaryRow label="담당자" value={form.contactPersonName} />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* 하단 액션 */}
        <div className="p-5 border-t border-gray-100 flex gap-2.5">
          {step > 1 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex-1 py-3.5 rounded-xl border-[1.5px] border-gray-200 font-bold text-sm text-gray-700 hover:bg-gray-50 transition"
            >
              이전
            </button>
          )}
          {step < 4 && (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext}
              className="flex-1 py-3.5 rounded-xl font-bold text-sm text-white transition disabled:opacity-40"
              style={{ background: '#FF1F8F' }}
            >
              다음
            </button>
          )}
          {step === 4 && (
            <button
              onClick={handleSubmit}
              disabled={!canNext || submitting}
              className="flex-1 py-3.5 rounded-xl font-bold text-sm text-white transition disabled:opacity-40"
              style={{ background: '#FF1F8F' }}
            >
              {submitting ? '신청 중…' : '대회사 가입 신청'}
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-6 text-center leading-relaxed max-w-xs">
        매장 가입은{' '}
        <Link href="/signup/store" className="underline">매장 가입 페이지</Link>에서.
        <br />
        이미 계정이 있으신가요?{' '}
        <Link href="/login" className="underline">로그인</Link>
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

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs font-bold text-gray-700 mb-1.5">{label}</div>
      {children}
    </div>
  );
}
function FieldError({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-red-600 mt-1 font-medium">{children}</div>;
}
function FieldOk({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-green-600 mt-1 font-medium">{children}</div>;
}
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-400 shrink-0 w-16">{label}</span>
      <span className="text-gray-700 font-medium break-all">{value || '—'}</span>
    </div>
  );
}
function AgreementItem({
  checked, onChange, required, label, detail, linkHref,
}: {
  checked: boolean; onChange: (v: boolean) => void; required: boolean; label: string; detail: string; linkHref?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`border rounded-xl p-4 transition ${checked ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white'}`}>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 accent-gray-900" />
        <div className="text-sm font-bold text-gray-900">{label}</div>
      </label>
      <button type="button" onClick={() => setExpanded((p) => !p)} className="text-[10px] text-gray-400 underline mt-2 ml-7">
        {expanded ? '접기' : '내용 보기'}
      </button>
      {expanded && (
        <div className="mt-2 ml-7 text-[11px] text-gray-500 leading-relaxed bg-white rounded-lg p-3 border border-gray-100">
          {detail}
          {linkHref && (
            <div className="mt-2">
              <Link
                href={linkHref}
                target="_blank"
                className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#FF1F8F] underline"
              >
                전문 보기 ↗
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
