'use client';

/**
 * LiveSectionHeader — 🔴 지금 LIVE 섹션 헤더 (재사용)
 *
 * - 좌: 빨간 펄스 점 + "지금 LIVE" + 서브라벨 "진행 중인 토너먼트"
 * - 우: "전체보기 ▸" — brand 색 + 작은 배경으로 시인성 강화
 * - /m/find, /m 양쪽에서 공유
 */

import Link from 'next/link';

interface Props {
  count?: number;
}

export default function LiveSectionHeader({ count }: Props) {
  return (
    <div className="px-4 pt-5 pb-2 flex items-center justify-between">
      {/* 좌: 펄스 + 텍스트 */}
      <div className="flex items-start gap-2">
        {/* 펄스 점 — 상단 텍스트 기준선에 맞춤 */}
        <span
          className="w-2 h-2 rounded-full flex-shrink-0 pulse-live mt-[3px]"
          style={{ background: '#EF4444' }}
          aria-hidden="true"
        />
        <div className="flex flex-col leading-none gap-[3px]">
          <div className="flex items-center gap-1.5">
            <span
              className="text-[17px] font-extrabold leading-none tracking-tight"
              style={{ color: 'var(--text-1)' }}
            >
              지금 LIVE
            </span>
            {count != null && count > 0 && (
              <span
                className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full leading-none"
                style={{ background: '#EF4444', color: '#fff' }}
              >
                {count}
              </span>
            )}
          </div>
          <span
            className="text-[11px] font-normal leading-none"
            style={{ color: 'var(--text-3)' }}
          >
            진행 중인 토너먼트
          </span>
        </div>
      </div>

      {/* 우: 전체보기 — 시인성 강화 (배경 + brand 색 + 굵게) */}
      <Link
        href="/m/live"
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition active:opacity-60"
        style={{
          background: 'rgba(255,31,143,0.10)',
          color: 'var(--brand)',
        }}
        aria-label="LIVE 전체보기"
      >
        <span className="text-[13px] font-extrabold" style={{ color: 'var(--brand)' }}>
          전체보기
        </span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </Link>
    </div>
  );
}
