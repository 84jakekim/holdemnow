'use client';

/**
 * IdentityVerificationCard — Email/Password 가입자 본인 확인 + 비밀번호 CS 카드
 *
 * - 로그인 아이디(이메일/아이디) 노출 — CS 시 한눈에
 * - 비밀번호 보안 안내 배너 (노란색)
 * - passwordHint 표시
 * - recoveryLast4 마스킹 + 보기 토글
 * - 비밀번호 재설정 메일 발송 버튼
 * - 임시 비밀번호 강제 발급 버튼 (원본 비번 조회 불가 → 임시 비번으로 덮어쓰고 평문 표시)
 */

import { useState } from 'react';
import { setTemporaryPasswordByAdmin } from '@/lib/userAdmin';

interface IdentityVerificationCardProps {
  email: string;
  /** 로그인 아이디 — 본사 어드민은 이메일이 아닌 아이디. 없으면 email 사용 */
  loginId?: string;
  passwordHint?: string;
  recoveryLast4?: string;
  onSendPasswordReset: () => Promise<void>;
  /** 임시 비번 발급 대상 식별 — 둘 중 하나 필요 */
  targetUid?: string;
  targetEmail?: string;
}

export default function IdentityVerificationCard({
  email,
  loginId,
  passwordHint,
  recoveryLast4,
  onSendPasswordReset,
  targetUid,
  targetEmail,
}: IdentityVerificationCardProps) {
  const [showLast4, setShowLast4] = useState(false);
  const [sending, setSending] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tempError, setTempError] = useState<string | null>(null);

  const displayLoginId = loginId || email;

  const handleSendReset = async () => {
    if (!window.confirm(`${email} 으로 비밀번호 재설정 메일을 발송하시겠습니까?`)) return;
    setSending(true);
    try {
      await onSendPasswordReset();
    } finally {
      setSending(false);
    }
  };

  const handleIssueTempPassword = async () => {
    if (!targetUid && !targetEmail) {
      setTempError('대상 사용자 식별 정보가 없습니다');
      return;
    }
    if (
      !window.confirm(
        '임시 비밀번호를 강제로 발급합니다.\n기존 비밀번호는 즉시 무효화되며, 새 임시 비밀번호로만 로그인할 수 있습니다.\n발급된 비밀번호를 사용자에게 안내한 뒤, 로그인하여 직접 변경하도록 유도하세요.\n\n계속하시겠습니까?',
      )
    )
      return;
    setIssuing(true);
    setTempError(null);
    setCopied(false);
    try {
      const res = await setTemporaryPasswordByAdmin({ targetUid, targetEmail });
      setTempPassword(res.tempPassword);
    } catch (e: unknown) {
      setTempError(e instanceof Error ? e.message : String(e));
    } finally {
      setIssuing(false);
    }
  };

  const handleCopy = async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard 미지원 — 사용자가 수동 복사 */
    }
  };

  const maskedLast4 = recoveryLast4
    ? showLast4
      ? recoveryLast4
      : '**** **** ****'
    : null;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {/* 보안 안내 배너 */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex gap-2.5">
        <svg className="flex-shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <p className="text-xs text-amber-900 leading-relaxed">
          <b>보안 안내:</b> 비밀번호 원본은 본사 시스템에서도 조회할 수 없습니다 (Firebase Auth 보안 표준).
          분실 사용자는 아래 ‘비밀번호 재설정 메일’ 또는 ‘임시 비밀번호 발급’으로 도와주세요.
        </p>
      </div>

      <div className="p-4 space-y-3">
        <h3 className="text-sm font-extrabold text-gray-900">본인 확인 · 비밀번호 CS</h3>

        {/* 로그인 아이디 */}
        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-0.5">로그인 아이디</div>
          <div className="text-sm text-gray-800">
            <span className="font-mono bg-gray-50 border border-gray-200 rounded px-2 py-0.5 break-all">{displayLoginId || '-'}</span>
          </div>
        </div>

        {/* 비밀번호 힌트 */}
        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-0.5">비밀번호 힌트</div>
          <div className="text-sm text-gray-800">
            {passwordHint ? (
              <span className="font-mono bg-gray-50 border border-gray-200 rounded px-2 py-0.5">{passwordHint}</span>
            ) : (
              <span className="text-gray-400">등록된 힌트 없음</span>
            )}
          </div>
        </div>

        {/* 복구 연락처 뒤 4자리 */}
        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-0.5">복구 연락처 뒤 4자리</div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-gray-800">
              {maskedLast4 ?? <span className="text-gray-400">등록된 정보 없음</span>}
            </span>
            {recoveryLast4 && (
              <button
                type="button"
                onClick={() => setShowLast4((v) => !v)}
                className="text-[11px] font-bold text-gray-500 hover:text-gray-900 underline underline-offset-2"
                aria-label={showLast4 ? '숨기기' : '보기'}
              >
                {showLast4 ? '숨기기' : '보기'}
              </button>
            )}
          </div>
        </div>

        {/* 발급된 임시 비밀번호 표시 */}
        {tempPassword && (
          <div className="rounded-xl border-[1.5px] border-emerald-300 bg-emerald-50 p-3">
            <div className="text-[11px] font-bold text-emerald-800 mb-1">발급된 임시 비밀번호</div>
            <div className="flex items-center gap-2">
              <span className="flex-1 font-mono text-base font-extrabold text-emerald-900 bg-white border border-emerald-200 rounded-lg px-3 py-2 tracking-wider break-all">
                {tempPassword}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex-shrink-0 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition"
              >
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
            <p className="text-[11px] text-emerald-700 mt-2 leading-relaxed">
              이 비밀번호로 즉시 로그인할 수 있습니다. 사용자에게 안내한 뒤, 로그인하여 <b>본인이 직접 변경</b>하도록 유도하세요.
              이 값은 화면을 벗어나면 다시 볼 수 없습니다.
            </p>
          </div>
        )}

        {tempError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {tempError}
          </div>
        )}

        {/* 액션 버튼들 */}
        <div className="pt-1 space-y-2">
          <button
            type="button"
            onClick={handleSendReset}
            disabled={sending}
            className="w-full py-2.5 rounded-xl text-sm font-bold border-[1.5px] border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 transition disabled:opacity-40"
          >
            {sending ? '발송 중…' : '✉️ 비밀번호 재설정 메일 발송'}
          </button>
          {(targetUid || targetEmail) && (
            <button
              type="button"
              onClick={handleIssueTempPassword}
              disabled={issuing}
              className="w-full py-2.5 rounded-xl text-sm font-extrabold text-white transition disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #FF1F8F 0%, #B91072 100%)' }}
            >
              {issuing ? '발급 중…' : '🔑 임시 비밀번호 강제 발급'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
