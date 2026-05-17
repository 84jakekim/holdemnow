'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import { createOrganizer } from '@/lib/organizers';

export default function OrganizerSignupPage() {
  const router = useRouter();
  const authState = useAuth();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    tagline: '',
    contactEmail: '',
    agree: false,
  });

  if (authState.status === 'loading') {
    return <main className="min-h-screen flex items-center justify-center text-sm text-gray-500">로딩 중…</main>;
  }
  if (authState.status === 'anonymous') {
    if (typeof window !== 'undefined') router.replace('/organizer-login');
    return null;
  }

  const update = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const canProceed = (() => {
    if (step === 1) return form.name.trim().length >= 2 && form.tagline.trim().length >= 2;
    if (step === 2) return form.agree;
    return true;
  })();

  const submit = async () => {
    if (!canProceed) return;
    setSubmitting(true);
    setError(null);
    try {
      const uid = authState.user.uid;
      const organizerId = await createOrganizer(uid, {
        name: form.name.trim(),
        tagline: form.tagline.trim(),
        contactEmail: form.contactEmail.trim() || undefined,
      });
      setStep(4);
      // 다음 화면에서 어드민으로 이동 버튼 제공
      setTimeout(() => router.replace(`/organizer/${organizerId}`), 100);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md mb-3 flex items-center justify-between text-xs">
        <button
          onClick={() => router.replace('/m')}
          className="text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
        >
          ← 일반 사용자로 둘러보기
        </button>
        <button
          onClick={async () => {
            await signOut(auth);
            router.replace('/');
          }}
          className="text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
        >
          다른 계정으로 로그인 →
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-md overflow-hidden">
        {/* 진행 막대 */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex gap-1 mb-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className={`flex-1 h-1 rounded ${
                  step === n ? 'bg-amber-500' : step > n ? 'bg-black' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <div className="text-[10px] font-bold text-gray-500 tracking-wider">
            STEP {Math.min(step, 3)} / 3 · 대회사 가입
          </div>
          <div className="text-base font-extrabold text-gray-900 mt-1">
            {['', '기본 정보', '약관 동의', '완료', '신청 완료'][step]}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {['', '대회사 이름·소개·연락처', '이용약관 동의', '', '심사 후 활성화'][step]}
          </div>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {step === 1 && (
            <>
              <Field label="대회사 이름">
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="예: ABC Holdem Series"
                />
              </Field>
              <Field label="한 줄 소개">
                <input
                  className="form-input"
                  value={form.tagline}
                  onChange={(e) => update('tagline', e.target.value)}
                  placeholder="예: 부산·경남 No.1 시리즈 토너 운영사"
                />
              </Field>
              <Field label="대표 이메일 (선택)">
                <input
                  type="email"
                  className="form-input"
                  value={form.contactEmail}
                  onChange={(e) => update('contactEmail', e.target.value)}
                  placeholder="contact@example.com"
                />
              </Field>
              <div className="text-[10px] text-gray-400 leading-relaxed">
                💡 사업자등록번호·법인 정보·계약서는 v0.2부터. 지금은 데모 가입.
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <label
                className={`flex items-start gap-2 p-3 rounded-lg cursor-pointer ${
                  form.agree ? 'bg-green-50' : 'bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={form.agree}
                  onChange={(e) => update('agree', e.target.checked)}
                  className="mt-0.5"
                />
                <div className="text-xs leading-relaxed">
                  <b className="text-sm">대회사 이용약관 + 개인정보 수집 동의</b>
                  <br />
                  <span className="text-[10px] text-gray-500">
                    본 서비스는 정보 제공·중개 플랫폼이며, 베팅·환금 매개를 절대 하지 않음.
                    대회사는 사행성 규제를 준수해야 합니다.
                  </span>
                </div>
              </label>
              <div className="text-[10px] text-gray-400 leading-relaxed">
                💡 v0.1 데모 — 약관 전문은 v0.2에서.
              </div>
            </>
          )}

          {step === 3 && (
            <div className="text-center py-8">
              <div className="text-2xl mb-3">✅</div>
              <div className="text-sm font-bold text-gray-900 mb-2">제출 준비 완료</div>
              <div className="text-xs text-gray-500 leading-relaxed">
                대회사: <b className="text-gray-900">{form.name}</b>
                <br />
                {form.tagline}
              </div>
              {error && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 text-left">
                  {error}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="text-center py-8">
              <div className="text-5xl mb-3">🎉</div>
              <div className="text-base font-extrabold text-gray-900 mb-2">대회사 신청 완료!</div>
              <div className="text-xs text-gray-500 leading-relaxed mb-4">
                <b className="text-gray-900">{form.name}</b>
                <br />
                Firestore에 저장됨 · 대회사 어드민으로 이동
              </div>
            </div>
          )}
        </div>

        {/* 액션 */}
        <div className="p-4 border-t border-gray-100 flex gap-2">
          {step > 1 && step < 3 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 py-2.5 rounded-lg border-[1.5px] border-gray-200 font-bold text-sm"
            >
              이전
            </button>
          )}
          {step < 3 && (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed}
              className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm disabled:opacity-40"
            >
              다음
            </button>
          )}
          {step === 3 && (
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-amber-500 text-white font-bold text-sm disabled:opacity-40"
            >
              {submitting ? '제출 중…' : '대회사 신청'}
            </button>
          )}
        </div>
      </div>

      <style jsx global>{`
        .form-input {
          background: #fff;
          border: 1.5px solid #eaeaea;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 13px;
          color: #111;
          width: 100%;
          box-sizing: border-box;
          outline: none;
        }
        .form-input:focus { border-color: #111; }
      `}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}
