'use client';

/**
 * IdentityVerificationCard — Email/Password 가입자 본인 확인 정보 카드
 *
 * - 비밀번호 보안 안내 배너 (노란색)
 * - passwordHint 표시
 * - recoveryLast4 마스킹 + 보기 토글
 * - 비밀번호 재설정 메일 발송 버튼
 */

import { useState } from 'react';

interface IdentityVerificationCardProps {
  email: string;
  passwordHint?: string;
  recoveryLast4?: string;
  onSendPasswordReset: () => Promise<void>;
}

export default function IdentityVerificationCard({
  email,
  passwordHint,
  recoveryLast4,
  onSendPasswordReset,
}: IdentityVerificationCardProps) {
  const [showLast4, setShowLast4] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSendReset = async () => {
    if (!window.confirm(`${email} 으로 비밀번호 재설정 메일을 발송하시겠습니까?`)) return;
    setSending(true);
    try {
      await onSendPasswordReset();
    } finally {
      setSending(false);
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
          <b>보안 안내:</b> 비밀번호 자체는 본사 시스템에서도 조회할 수 없습니다 (Firebase Auth 보안 표준).
          비밀번호 분실 사용자는 아래 '비밀번호 재설정 메일 발송' 버튼으로 도와주세요.
        </p>
      </div>

      <div className="p-4 space-y-3">
        <h3 className="text-sm font-extrabold text-gray-900">본인 확인 정보</h3>

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

        {/* 재설정 메일 발송 버튼 */}
        <div className="pt-1">
          <button
            type="button"
            onClick={handleSendReset}
            disabled={sending}
            className="w-full py-2.5 rounded-xl text-sm font-bold border-[1.5px] border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 transition disabled:opacity-40"
          >
            {sending ? '발송 중…' : '비밀번호 재설정 메일 발송'}
          </button>
        </div>
      </div>
    </div>
  );
}
