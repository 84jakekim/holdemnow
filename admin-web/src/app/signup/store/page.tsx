'use client';

/**
 * /signup/store — 매장 자체 가입 마법사 (4-step)
 * Email/Password Firebase Auth + Firestore stores 생성
 * 카카오맵 SDK 미사용 — 다음 우편번호 서비스로 주소 검색
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  signupAsStore,
  validatePassword,
  type StoreSignupPayload,
} from '@/lib/emailAuth';
import BusinessHoursPicker from '@/components/common/BusinessHoursPicker';
import DaumPostcode, { type DaumPostcodeResult } from '@/components/common/DaumPostcode';

// =====================================================================
// 타입
// =====================================================================

type FormState = Omit<StoreSignupPayload, 'signageImageFile' | 'agreeService' | 'agreePrivacy' | 'agreeMarketing' | 'storeAddress'> & {
  passwordConfirm: string;
  signageImageFile: File | null;
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
  storeName: '',
  roadAddress: '',
  detailAddress: '',
  jibunAddress: '',
  zonecode: '',
  storeHours: '',
  storeDescription: '',
  storePhone: '',
  signageImageFile: null,
  representativeName: '',
  representativePhone: '',
  agreeService: false,
  agreePrivacy: false,
  agreeMarketing: false,
};

const MAX_SIGNAGE_BYTES = 5 * 1024 * 1024; // 5MB — Storage rules와 동기

const STEP_LABELS = ['', '계정 정보', '매장 기본 정보', '대표자 정보', '약관 동의'];
const STEP_SUBS = ['', '로그인에 사용할 이메일·비밀번호', '매장명·주소·영업시간', '대표자·사업자 정보', '약관 동의 후 제출'];

// =====================================================================
// 컴포넌트
// =====================================================================

export default function StoreSignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showPwConfirm, setShowPwConfirm] = useState(false);
  const [showPostcode, setShowPostcode] = useState(false);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // 단계별 진행 가능 여부
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
      const signageOk =
        !!form.signageImageFile &&
        form.signageImageFile.size <= MAX_SIGNAGE_BYTES &&
        form.signageImageFile.type.startsWith('image/');
      return (
        form.storeName.trim().length >= 1 &&
        form.roadAddress.trim().length >= 5 &&  // 주소 선택 완료
        form.storePhone.trim().length >= 7 &&
        signageOk
      );
    }
    if (step === 3) {
      return (
        form.representativeName.trim().length >= 1 &&
        form.representativePhone.trim().length >= 7
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
      if (!form.signageImageFile) throw new Error('매장 간판 사진을 첨부해 주세요');
      await signupAsStore({
        email: form.email,
        password: form.password,
        passwordHint: form.passwordHint,
        recoveryLast4: form.recoveryLast4,
        storeName: form.storeName,
        roadAddress: form.roadAddress,
        detailAddress: form.detailAddress,
        jibunAddress: form.jibunAddress,
        zonecode: form.zonecode,
        storeHours: form.storeHours || '협의 후 결정',
        storeDescription: form.storeDescription,
        storePhone: form.storePhone,
        signageImageFile: form.signageImageFile,
        representativeName: form.representativeName,
        representativePhone: form.representativePhone,
        agreeService: form.agreeService,
        agreePrivacy: form.agreePrivacy,
        agreeMarketing: form.agreeMarketing,
      });
      setDone(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('email-already-in-use')) {
        setError('이미 가입된 이메일입니다. 로그인 페이지에서 로그인해 주세요.');
      } else if (msg.includes('invalid-email')) {
        setError('올바른 이메일 형식이 아닙니다.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 완료 화면
  if (done) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm w-full max-w-md p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M20 6L9 17l-5-5" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="text-xl font-extrabold text-gray-900 mb-2">가입 신청 완료!</div>
          <div className="text-sm text-gray-600 leading-relaxed mb-6">
            <b className="text-gray-900">{form.storeName}</b> 매장의 가입 신청이 접수되었습니다.
            <br />
            본사 심사 후 승인 안내를 드립니다.
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left text-xs text-amber-800 leading-relaxed mb-6">
            <div className="font-bold text-amber-900 mb-1">심사 안내</div>
            심사는 영업일 기준 1~3일 소요됩니다. 승인 후 등록하신 이메일로 안내 메일이 발송되며, 어드민 페이지에 접근하실 수 있습니다.
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
      {/* 뒤로 */}
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

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-md overflow-hidden">
        {/* 헤더 + 진행률 */}
        <div className="p-6 border-b border-gray-100">
          {/* 도트 인디케이터 */}
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
                  ) : (
                    n
                  )}
                </div>
                {n < 4 && (
                  <div
                    className={`flex-1 h-0.5 w-6 rounded ${step > n ? 'bg-gray-900' : 'bg-gray-100'}`}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="text-[10px] font-bold text-gray-400 tracking-widest mb-1">
            STEP {step} / 4 · 매장 가입 신청
          </div>
          <div className="text-xl font-extrabold text-gray-900">{STEP_LABELS[step]}</div>
          <div className="text-sm text-gray-500 mt-0.5">{STEP_SUBS[step]}</div>
        </div>

        {/* 본문 */}
        <div className="p-6 space-y-5 max-h-[56vh] overflow-y-auto">
          {/* ── Step 1: 계정 ── */}
          {step === 1 && (
            <>
              <Field label="이메일 (로그인 아이디로 사용)">
                <input
                  type="email"
                  className="form-input"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  placeholder="example@email.com"
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
                    aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}
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
                    placeholder="비밀번호를 다시 입력하세요"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwConfirm((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"
                    aria-label={showPwConfirm ? '비밀번호 숨기기' : '비밀번호 보기'}
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
                <div className="text-xs font-bold text-blue-900 mb-3">
                  비밀번호 분실 시 본인 확인용 정보
                </div>

                <Field label="비밀번호 힌트 (질문 또는 자유 문구)">
                  <input
                    className="form-input"
                    value={form.passwordHint}
                    onChange={(e) => update('passwordHint', e.target.value)}
                    placeholder="예: 초등학교 이름? / 첫 차 번호판?"
                  />
                  <div className="text-[10px] text-gray-400 mt-1">
                    분실 시 이 힌트를 보고 답변을 입력해 본인 확인합니다
                  </div>
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
                  <div className="text-[10px] text-gray-400 mt-1">
                    아래 Step 3에서 입력할 대표 연락처의 뒤 4자리를 그대로 입력하세요
                  </div>
                  {form.recoveryLast4 && !/^\d{4}$/.test(form.recoveryLast4) && (
                    <FieldError>숫자 4자리를 입력하세요</FieldError>
                  )}
                </Field>
              </div>
            </>
          )}

          {/* ── Step 2: 매장 기본 ── */}
          {step === 2 && (
            <>
              <Field label="매장명">
                <input
                  className="form-input"
                  value={form.storeName}
                  onChange={(e) => update('storeName', e.target.value)}
                  placeholder="예: 광안리 카드클럽"
                />
              </Field>

              {/* 주소 검색 — 다음 우편번호 서비스 */}
              <Field label="매장 주소">
                {form.roadAddress ? (
                  /* 선택 완료 상태 */
                  <div className="rounded-xl border-[1.5px] border-green-500 bg-green-50 p-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold text-green-700 mb-0.5">선택된 주소</div>
                        <div className="text-[13px] font-semibold text-gray-900 break-words leading-snug">
                          {form.roadAddress}
                        </div>
                        {form.zonecode && (
                          <div className="text-[10px] text-gray-400 mt-0.5">우편번호: {form.zonecode}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowPostcode(true)}
                        className="flex-shrink-0 text-[11px] font-bold text-white rounded-lg px-3 py-1.5 transition"
                        style={{ background: '#FF1F8F' }}
                      >
                        변경
                      </button>
                    </div>
                  </div>
                ) : (
                  /* 미선택 상태 */
                  <button
                    type="button"
                    onClick={() => setShowPostcode(true)}
                    className="w-full flex items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-gray-300 hover:border-[#FF1F8F] hover:bg-pink-50/40 transition py-4 font-bold text-[14px]"
                    style={{ color: '#FF1F8F' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                      <circle cx="12" cy="10" r="3"/>
                    </svg>
                    주소 검색
                  </button>
                )}
                <div className="text-[10px] text-gray-400 mt-1">
                  버튼을 눌러 도로명 또는 지번으로 검색하세요
                </div>
              </Field>

              {/* 상세주소 (층/호수, 선택) */}
              {form.roadAddress && (
                <Field label="상세 주소 (선택)">
                  <input
                    className="form-input"
                    value={form.detailAddress}
                    onChange={(e) => update('detailAddress', e.target.value)}
                    placeholder="예: 3층, 301호"
                  />
                  <div className="text-[10px] text-gray-400 mt-1">
                    층수·호수 등 상세 위치를 입력해 주세요 (선택 사항)
                  </div>
                </Field>
              )}

              <Field label="영업시간">
                <BusinessHoursPicker
                  value={form.storeHours}
                  onChange={(v) => update('storeHours', v)}
                />
              </Field>

              <Field label="매장 전화">
                <input
                  className="form-input font-mono"
                  value={form.storePhone}
                  onChange={(e) => update('storePhone', e.target.value)}
                  placeholder="예: 051-000-0000"
                  inputMode="tel"
                />
              </Field>

              <Field label="매장 소개 (선택)">
                <textarea
                  className="form-input min-h-[80px] resize-none"
                  value={form.storeDescription}
                  onChange={(e) => update('storeDescription', e.target.value)}
                  placeholder="매장 분위기, 운영 스타일, 특징 등을 자유롭게 소개해 주세요"
                  maxLength={500}
                />
                <div className="text-[10px] text-gray-400 mt-1 text-right">
                  {form.storeDescription.length}/500
                </div>
              </Field>

              <Field label="매장 간판 사진">
                <SignageUploader
                  file={form.signageImageFile}
                  onChange={(f) => update('signageImageFile', f)}
                  maxBytes={MAX_SIGNAGE_BYTES}
                />
                <div className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                  가로형 사진 권장 (예: 1600×900px). 세로 사진은 가운데 부분만 노출됩니다.<br />
                  JPG/PNG, 5MB 이하 · 본사 심사 시 매장 실존 확인에 사용됩니다.
                </div>
              </Field>
            </>
          )}

          {/* ── Step 3: 대표자 ── */}
          {step === 3 && (
            <>
              <Field label="대표자명">
                <input
                  className="form-input"
                  value={form.representativeName}
                  onChange={(e) => update('representativeName', e.target.value)}
                  placeholder="실명을 입력해 주세요"
                />
              </Field>

              <Field label="대표 연락처">
                <input
                  className="form-input font-mono"
                  value={form.representativePhone}
                  onChange={(e) => update('representativePhone', e.target.value)}
                  placeholder="010-0000-0000"
                  inputMode="tel"
                />
                <div className="text-[10px] text-gray-400 mt-1">
                  Step 1에서 입력한 복구 연락처 4자리와 뒷자리가 일치해야 합니다
                </div>
              </Field>

              <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 leading-relaxed">
                매장 실존 확인은 Step 2에서 첨부한 <b className="text-gray-800">매장 간판 사진</b>으로 본사가 검토합니다.
              </div>
            </>
          )}

          {/* ── Step 4: 약관 ── */}
          {step === 4 && (
            <>
              <div className="space-y-3">
                <AgreementItem
                  checked={form.agreeService}
                  onChange={(v) => update('agreeService', v)}
                  required
                  label="서비스 이용약관 동의 (필수)"
                  detail="본 서비스는 홀덤 정보 제공 플랫폼이며, 베팅·환금 매개를 하지 않습니다. 매장은 관련 법규를 준수해야 합니다."
                  linkHref="/legal/terms"
                />
                <AgreementItem
                  checked={form.agreePrivacy}
                  onChange={(v) => update('agreePrivacy', v)}
                  required
                  label="개인정보 처리방침 동의 (필수)"
                  detail="수집 항목: 이메일, 대표자명, 연락처, 사업자등록번호. 목적: 서비스 제공 및 매장 운영. 보유: 탈퇴 시까지."
                  linkHref="/legal/privacy"
                />
                <AgreementItem
                  checked={form.agreeMarketing}
                  onChange={(v) => update('agreeMarketing', v)}
                  required={false}
                  label="마케팅 정보 수신 동의 (선택)"
                  detail="서비스 업데이트, 프로모션 정보를 이메일로 받습니다. 언제든지 철회 가능합니다."
                />
              </div>

              {/* 제출 전 요약 */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-1.5 text-xs text-gray-600 mt-2">
                <div className="font-bold text-gray-900 mb-2 text-sm">신청 정보 요약</div>
                <SummaryRow label="이메일" value={form.email} />
                <SummaryRow label="매장명" value={form.storeName} />
                <SummaryRow label="주소" value={`${form.roadAddress} ${form.detailAddress}`.trim()} />
                <SummaryRow label="대표자" value={form.representativeName} />
                <SummaryRow label="연락처" value={form.representativePhone} />
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
              {submitting ? '신청 중…' : '매장 가입 신청'}
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-6 text-center leading-relaxed max-w-xs">
        대회사 가입은{' '}
        <Link href="/signup/organizer" className="underline">
          대회사 가입 페이지
        </Link>
        에서.
        <br />
        이미 계정이 있으신가요?{' '}
        <Link href="/login" className="underline">
          로그인
        </Link>
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
        .form-input:focus {
          border-color: #FF1F8F;
        }
      `}</style>

      {/* 다음 우편번호 모달 — showPostcode=true일 때만 화면에 표시 */}
      <DaumPostcode
        open={showPostcode}
        onClose={() => setShowPostcode(false)}
        onComplete={(r) => {
          setForm((f) => ({
            ...f,
            roadAddress: r.roadAddress,
            jibunAddress: r.jibunAddress,
            zonecode: r.zonecode,
            // 새 주소 선택 시 상세주소 초기화 (이전 입력이 무관한 새 건물일 수 있음)
            detailAddress: '',
          }));
          setShowPostcode(false);
        }}
      />
    </main>
  );
}

// =====================================================================
// 서브 컴포넌트
// =====================================================================

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
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

function SignageUploader({
  file,
  onChange,
  maxBytes,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  maxBytes: number;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ObjectURL 메모리 누수 방지 — file 변경 시 이전 URL revoke
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('이미지 파일만 첨부 가능합니다 (JPG/PNG)');
      e.target.value = '';
      return;
    }
    if (f.size > maxBytes) {
      setError(`파일 크기는 ${Math.floor(maxBytes / 1024 / 1024)}MB 이하여야 합니다`);
      e.target.value = '';
      return;
    }
    onChange(f);
    e.target.value = '';
  };

  if (file && previewUrl) {
    return (
      <div>
        <div
          className="relative w-full rounded-xl overflow-hidden border-[1.5px] border-gray-200 bg-gray-50"
          style={{ aspectRatio: '4 / 3' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="매장 간판 미리보기"
            className="w-full h-full object-cover"
          />
          <div className="absolute top-2 right-2 flex gap-1.5">
            <label className="bg-white/90 backdrop-blur text-[11px] font-bold text-gray-900 px-2.5 py-1 rounded-full cursor-pointer hover:bg-white transition">
              변경
              <input type="file" accept="image/*" className="hidden" onChange={handlePick} />
            </label>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="bg-white/90 backdrop-blur text-[11px] font-bold text-red-600 px-2.5 py-1 rounded-full hover:bg-white transition"
            >
              제거
            </button>
          </div>
        </div>
        <div className="text-[11px] text-gray-500 mt-1.5 flex justify-between">
          <span className="truncate max-w-[70%]">{file.name}</span>
          <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label
        className="flex flex-col items-center justify-center w-full rounded-xl border-[1.5px] border-dashed border-gray-300 hover:border-[#FF1F8F] hover:bg-pink-50/40 transition cursor-pointer py-8 px-4 text-center"
      >
        <div className="text-3xl mb-2">📸</div>
        <div className="text-sm font-bold text-gray-900 mb-0.5">매장 간판 사진 추가</div>
        <div className="text-[11px] text-gray-500">탭하여 사진 선택</div>
        <input type="file" accept="image/*" className="hidden" onChange={handlePick} />
      </label>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function AgreementItem({
  checked,
  onChange,
  required,
  label,
  detail,
  linkHref,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  required: boolean;
  label: string;
  detail: string;
  linkHref?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`border rounded-xl p-4 transition ${
        checked ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white'
      }`}
    >
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-gray-900"
        />
        <div className="flex-1">
          <div className="text-sm font-bold text-gray-900">{label}</div>
        </div>
      </label>
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="text-[10px] text-gray-400 underline mt-2 ml-7"
      >
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
