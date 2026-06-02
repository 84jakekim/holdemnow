'use client';

/**
 * PlayerCsActionCell — 회원관리 '일반 사용자' 탭의 행 인라인 비번 CS 액션.
 * (구 /platform/users의 핵심 동선을 흡수 통합)
 *
 * - 이메일/비번 가입자 → [🔑 재설정 메일] (발송 후 ✅)
 * - Google/카카오 가입자 → [📋 안내 복사] (카톡 전달용 문구 클립보드 복사)
 * - 발송 시 알고 보니 소셜 계정이면(no_password) 자동으로 안내 복사 모드로 전환
 *
 * 행 전체가 상세로 이동하는 클릭 영역이라, 내부 버튼은 stopPropagation 처리.
 */

import { useState } from 'react';
import { sendPasswordResetByAdmin } from '@/lib/userAdmin';
import { inferAuthKind, noticeFor, type AuthKind } from '@/lib/passwordCs';

interface Props {
  uid: string;
  email?: string | null;
  providers?: string[];
}

export default function PlayerCsActionCell({ uid, email, providers }: Props) {
  const [kind, setKind] = useState<AuthKind>(() => inferAuthKind({ uid, email, providers }));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<'sent' | 'copied' | null>(null);
  const [error, setError] = useState(false);

  const showFlash = (v: 'sent' | 'copied') => {
    setFlash(v);
    setTimeout(() => setFlash(null), 2500);
  };

  const handleReset = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`${email ?? uid} 에게 비밀번호 재설정 메일을 보낼까요?`)) return;
    setBusy(true);
    setError(false);
    try {
      const res = await sendPasswordResetByAdmin({ targetUid: uid });
      if (!res.success && res.reason === 'no_password') {
        // 알고 보니 소셜 계정 — 안내 복사 모드로 전환
        const social: AuthKind =
          (res.providers ?? []).some((p) => p.includes('kakao')) ? 'kakao'
          : (res.providers ?? []).some((p) => p.includes('google')) ? 'google'
          : 'unknown';
        setKind(social);
      } else {
        showFlash('sent');
      }
    } catch {
      setError(true);
      setTimeout(() => setError(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = noticeFor(kind);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showFlash('copied');
    } catch {
      setError(true);
      setTimeout(() => setError(false), 2500);
    }
  };

  if (error) {
    return <span className="text-[10px] font-bold text-red-600">실패</span>;
  }
  if (flash === 'sent') {
    return <span className="text-[10px] font-bold text-green-600">✅ 발송됨</span>;
  }
  if (flash === 'copied') {
    return <span className="text-[10px] font-bold text-green-600">📋 복사됨</span>;
  }

  if (kind === 'google' || kind === 'kakao') {
    return (
      <button
        onClick={handleCopy}
        title={kind === 'google' ? 'Google 계정 안내 문구 복사' : '카카오 계정 안내 문구 복사'}
        className="text-[10px] font-bold rounded px-2 py-1 border whitespace-nowrap transition"
        style={
          kind === 'google'
            ? { background: '#EFF6FF', color: '#1D4ED8', borderColor: '#BFDBFE' }
            : { background: '#FEF9C3', color: '#A16207', borderColor: '#FDE68A' }
        }
      >
        📋 {kind === 'google' ? '구글' : '카카오'} 안내
      </button>
    );
  }

  // email / unknown — 재설정 메일
  return (
    <button
      onClick={handleReset}
      disabled={busy}
      title="비밀번호 재설정 메일 발송"
      className="text-[10px] font-bold rounded px-2 py-1 border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 whitespace-nowrap transition disabled:opacity-40"
    >
      {busy ? '발송 중…' : '🔑 재설정'}
    </button>
  );
}
