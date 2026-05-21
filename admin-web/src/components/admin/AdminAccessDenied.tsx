'use client';

/**
 * AdminAccessDenied — 어드민 접근 권한 없는 사용자에게 표시하는 풀스크린 안내
 * - 빨간 톤 사용 금지 (차분한 회색 + 핑크 버튼)
 * - "로그인" 또는 "내 매장 보기" 버튼 제공
 */

import Link from 'next/link';

export interface AdminAccessDeniedProps {
  /** 현재 로그인 여부 */
  isLoggedIn?: boolean;
  /** 로그인 사용자가 owner인 매장 storeId (있으면 "내 매장 보기" 버튼 표시) */
  myStoreId?: string | null;
}

export default function AdminAccessDenied({ isLoggedIn, myStoreId }: AdminAccessDeniedProps) {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 py-12">
      {/* 아이콘 */}
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center mb-6 flex-shrink-0"
        style={{ background: '#F3F4F6' }}
        aria-hidden="true"
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
          <circle cx="12" cy="16" r="1" fill="#6B7280" stroke="none" />
        </svg>
      </div>

      {/* 제목 */}
      <h1 className="text-[22px] font-extrabold text-gray-900 text-center mb-3 tracking-tight">
        접근 권한이 없습니다
      </h1>

      {/* 설명 */}
      <p className="text-[14px] text-gray-500 leading-relaxed text-center max-w-xs mb-8">
        이 매장의 어드민 페이지에 접근할 권한이 없습니다.
        <br />
        {isLoggedIn
          ? '다른 계정으로 로그인하거나 본인 매장 어드민을 이용해 주세요.'
          : '매장 계정으로 로그인 후 이용해 주세요.'}
      </p>

      {/* 액션 버튼 */}
      <div className="flex flex-col gap-3 w-full max-w-xs">
        {isLoggedIn && myStoreId ? (
          <Link
            href={`/admin/${myStoreId}`}
            className="flex items-center justify-center gap-2 w-full h-14 rounded-2xl font-bold text-[15px] text-white transition active:scale-[0.98]"
            style={{ background: '#FF1F8F' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            내 매장 어드민으로 이동
          </Link>
        ) : (
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 w-full h-14 rounded-2xl font-bold text-[15px] text-white transition active:scale-[0.98]"
            style={{ background: '#FF1F8F' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            매장 계정으로 로그인
          </Link>
        )}

        <Link
          href="/m"
          className="flex items-center justify-center w-full h-12 rounded-2xl font-semibold text-[14px] transition active:scale-[0.98]"
          style={{ background: '#F3F4F6', color: '#374151' }}
        >
          홈으로 돌아가기
        </Link>
      </div>

      {/* 문의 안내 */}
      <p className="text-[11px] text-gray-400 text-center mt-8">
        문의: 카카오톡 채널 Pink Rabbit 또는 admin@holdemnow.com
      </p>
    </main>
  );
}
