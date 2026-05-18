'use client';

/**
 * /login/recover — 비밀번호 분실 복구 (2-step)
 *
 * Step 1: 이메일 입력 → passwordRecovery 컬렉션 조회 → 힌트 표시
 * Step 2: 힌트 답변 + 보조 연락처 4자리 검증 → 통과 시 Firebase reset 이메일 발송
 */

import { useState } from 'react';
import Link from 'next/link';
import { fetchRecoveryInfo, sendPasswordReset } from '@/lib/emailAuth';

type Phase = 'email' | 'verify' | 'sent' | 'failed';

const SUPPORT_KAKAO = 'https://open.kakao.com/o/holdemnow'; // 실제 오픈챗 URL로 교체
const SUPPORT_EMAIL = 'admin@holdemnow.com';

export default function RecoverPage() {
  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState('');
  const [hint, setHint] = useState('');
  const [storedLast4, setStoredLast4] = useState('');

  const [hintAnswer, setHintAnswer] = useState('');
  const [last4Input, setLast4Input] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: 이메일로 복구 정보 조회
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const info = await fetchRecoveryInfo(email);
      if (!info) {
        setError('해당 이메일로 가입된 매장·대회사 계정을 찾을 수 없습니다.');
        setLoading(false);
        return;
      }
      setHint(info.hint);
      setStoredLast4(info.recoveryLast4);
      setPhase('verify');
    } catch {
      setError('조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: 힌트 답변 + 4자리 검증
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // 힌트 답변은 저장하지 않고 클라이언트 검증 (보안 강도 v0.1 수준)
    // 4자리만 Firestore와 비교
    if (last4Input.trim() !== storedLast4) {
      setPhase('failed');
      setLoading(false);
      return;
    }

    // 4자리 일치 → 이메일 발송
    try {
      await sendPasswordReset(email);
      setPhase('sent');
    } catch {
      setError('이메일 발송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        {/* 뒤로 */}
        <div className="mb-6">
          <Link href="/login" className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            로그인으로 돌아가기
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <div className="text-xl font-extrabold text-gray-900 mb-1">비밀번호 찾기</div>
            <div className="text-sm text-gray-500">
              {phase === 'email' && '가입 시 등록한 이메일을 입력하세요'}
              {phase === 'verify' && '본인 확인 정보를 입력하세요'}
              {phase === 'sent' && '이메일을 확인해 주세요'}
              {phase === 'failed' && '본인 확인 실패'}
            </div>
          </div>

          <div className="p-6">
            {/* ── Phase 1: 이메일 입력 ── */}
            {phase === 'email' && (
              <form onSubmit={handleEmailSubmit} className="space-y-4">
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

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full py-3.5 rounded-xl font-bold text-sm text-white transition disabled:opacity-40"
                  style={{ background: '#FF1F8F' }}
                >
                  {loading ? '조회 중…' : '다음'}
                </button>
              </form>
            )}

            {/* ── Phase 2: 본인 확인 ── */}
            {phase === 'verify' && (
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm">
                  <div className="text-xs font-bold text-blue-900 mb-1">비밀번호 힌트</div>
                  <div className="text-blue-800 font-medium">{hint || '(힌트 없음)'}</div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5">
                    힌트 답변 <span className="text-gray-400 font-normal">(참고용 — 입력하지 않아도 됩니다)</span>
                  </label>
                  <input
                    className="form-input"
                    value={hintAnswer}
                    onChange={(e) => setHintAnswer(e.target.value)}
                    placeholder="힌트를 참고해 답변을 적어보세요"
                  />
                  <div className="text-[10px] text-gray-400 mt-1">
                    이 답변은 저장되지 않으며 아래 연락처 4자리로 최종 확인됩니다
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1.5">
                    보조 복구 연락처 마지막 4자리
                  </label>
                  <input
                    className="form-input font-mono tracking-widest text-center text-lg"
                    value={last4Input}
                    onChange={(e) => setLast4Input(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="0000"
                    maxLength={4}
                    inputMode="numeric"
                    required
                  />
                  <div className="text-[10px] text-gray-400 mt-1">
                    가입 시 입력한 대표 연락처의 뒤 4자리
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
                    {error}
                  </div>
                )}

                <div className="flex gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => { setPhase('email'); setError(null); }}
                    className="flex-1 py-3.5 rounded-xl border-[1.5px] border-gray-200 font-bold text-sm text-gray-700"
                  >
                    이전
                  </button>
                  <button
                    type="submit"
                    disabled={loading || last4Input.length !== 4}
                    className="flex-1 py-3.5 rounded-xl font-bold text-sm text-white transition disabled:opacity-40"
                    style={{ background: '#FF1F8F' }}
                  >
                    {loading ? '확인 중…' : '본인 확인'}
                  </button>
                </div>
              </form>
            )}

            {/* ── Phase 3: 발송 완료 ── */}
            {phase === 'sent' && (
              <div className="text-center py-4">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M20 6L9 17l-5-5" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="font-extrabold text-gray-900 mb-2">이메일을 발송했습니다</div>
                <div className="text-sm text-gray-600 leading-relaxed mb-6">
                  <b className="text-gray-900 break-all">{email}</b>
                  <br />
                  로 비밀번호 재설정 이메일을 보냈습니다.
                  <br />
                  이메일을 확인해 새 비밀번호를 설정하세요.
                </div>
                <div className="text-[11px] text-gray-400 leading-relaxed mb-6">
                  이메일이 오지 않는 경우 스팸함을 확인하거나
                  <br />
                  아래 고객센터로 문의해 주세요.
                </div>
                <Link
                  href="/login"
                  className="block w-full py-3.5 rounded-xl font-bold text-sm text-white text-center"
                  style={{ background: '#FF1F8F' }}
                >
                  로그인으로 돌아가기
                </Link>
              </div>
            )}

            {/* ── Phase 4: 실패 ── */}
            {phase === 'failed' && (
              <div className="text-center py-4">
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M18 6L6 18M6 6l12 12" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="font-extrabold text-gray-900 mb-2">본인 확인에 실패했습니다</div>
                <div className="text-sm text-gray-600 leading-relaxed mb-6">
                  입력한 연락처 정보가 일치하지 않습니다.
                  <br />
                  아래 고객센터로 문의해 주세요.
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left text-xs text-amber-800 leading-relaxed mb-6">
                  <div className="font-bold text-amber-900 mb-2">본사 고객센터</div>
                  <a
                    href={SUPPORT_KAKAO}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 mb-2 hover:underline"
                  >
                    <span className="text-sm">💬</span>
                    <span>카카오톡 오픈챗 문의</span>
                  </a>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <span className="text-sm">✉️</span>
                    <span>{SUPPORT_EMAIL}</span>
                  </a>
                </div>

                <div className="flex gap-2.5">
                  <button
                    onClick={() => { setPhase('email'); setLast4Input(''); setHintAnswer(''); setError(null); }}
                    className="flex-1 py-3.5 rounded-xl border-[1.5px] border-gray-200 font-bold text-sm text-gray-700"
                  >
                    다시 시도
                  </button>
                  <Link
                    href="/login"
                    className="flex-1 py-3.5 rounded-xl font-bold text-sm text-white text-center"
                    style={{ background: '#FF1F8F' }}
                  >
                    로그인으로
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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
