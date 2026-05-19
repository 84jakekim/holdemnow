'use client';

/**
 * PendingStoreNotice — pending 매장을 타사용자/비로그인이 접근할 때 표시하는 안내 화면
 * (owner 본인과 platform_admin은 이 화면을 보지 않음)
 */

import Link from 'next/link';

export default function PendingStoreNotice() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: 'var(--bg)' }}
    >
      {/* 아이콘 */}
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center mb-6 flex-shrink-0"
        style={{ background: '#FEF3C7' }}
        aria-hidden="true"
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </div>

      {/* 제목 */}
      <h1
        className="text-[20px] font-extrabold text-center mb-3 tracking-tight"
        style={{ color: 'var(--text-1)' }}
      >
        심사 중인 매장입니다
      </h1>

      {/* 설명 */}
      <p
        className="text-[14px] leading-relaxed text-center max-w-xs mb-8"
        style={{ color: 'var(--text-2)' }}
      >
        이 매장은 현재 본사 심사 중입니다.
        <br />
        승인 완료 후 정보를 확인하실 수 있습니다.
      </p>

      {/* 행동 버튼 */}
      <Link
        href="/m"
        className="flex items-center justify-center gap-2 w-full max-w-xs h-14 rounded-2xl font-bold text-[15px] text-white transition active:scale-[0.98]"
        style={{ background: '#FF1F8F' }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5M5 12l7-7M5 12l7 7" />
        </svg>
        다른 매장 보기
      </Link>

      {/* 서브 텍스트 */}
      <p
        className="text-[11px] text-center mt-5"
        style={{ color: 'var(--text-3)' }}
      >
        매장 사장님이라면{' '}
        <Link
          href="/login"
          className="font-bold underline underline-offset-2"
          style={{ color: 'var(--brand)' }}
        >
          로그인
        </Link>
        하여 어드민에서 심사 현황을 확인하세요.
      </p>
    </div>
  );
}
