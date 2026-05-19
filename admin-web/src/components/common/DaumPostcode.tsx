'use client';

/**
 * DaumPostcode.tsx — 다음 우편번호 서비스 wrapper
 *
 * - 모바일: 풀스크린 바텀시트
 * - 데스크탑: center modal (max-w 500px, h 500px)
 * - 카카오맵 SDK와 완전히 무관 (다른 도메인). 한도 영향 없음.
 * - window.daum.Postcode 폴링 방식으로 스크립트 로드 대기.
 */

import { useEffect, useRef } from 'react';

/* =========================================================== */
/* 타입                                                         */
/* =========================================================== */

export interface DaumPostcodeResult {
  roadAddress: string;   // 도로명 주소 (예: 부산광역시 수영구 광안해변로 123)
  jibunAddress: string;  // 지번 주소
  zonecode: string;      // 우편번호
  sido: string;          // 시/도 (예: 부산광역시)
  sigungu: string;       // 시/군/구 (예: 수영구)
  bname: string;         // 법정동 (예: 광안동)
}

export interface DaumPostcodeProps {
  open: boolean;
  onClose: () => void;
  onComplete: (result: DaumPostcodeResult) => void;
}

/* =========================================================== */
/* 스크립트 동적 로드 (한 번만)                                 */
/* =========================================================== */

const SCRIPT_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
let scriptLoaded = false;
let scriptLoading = false;
const waitCallbacks: Array<() => void> = [];

function loadDaumPostcodeScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    waitCallbacks.push(resolve);
    if (scriptLoading) return;
    scriptLoading = true;
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      scriptLoaded = true;
      waitCallbacks.splice(0).forEach((cb) => cb());
    };
    document.head.appendChild(script);
  });
}

/* =========================================================== */
/* 다음 우편번호 타입 (window.daum)                            */
/* =========================================================== */

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: {
        oncomplete: (data: DaumPostcodeResult) => void;
        onclose?: () => void;
        width?: string | number;
        height?: string | number;
      }) => { embed: (el: HTMLElement) => void };
    };
  }
}

/* =========================================================== */
/* 컴포넌트                                                      */
/* =========================================================== */

export default function DaumPostcode({ open, onClose, onComplete }: DaumPostcodeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<boolean>(false);

  useEffect(() => {
    if (!open) {
      instanceRef.current = false;
      return;
    }

    let cancelled = false;

    const init = async () => {
      // 스크립트 로드 대기
      await loadDaumPostcodeScript();
      if (cancelled || !containerRef.current || instanceRef.current) return;

      // 폴링: window.daum?.Postcode가 준비될 때까지 최대 5초
      let waited = 0;
      const TICK = 100;
      const MAX_WAIT = 5000;

      const tryEmbed = () => {
        if (cancelled || !containerRef.current) return;
        if (typeof window.daum?.Postcode !== 'function') {
          if (waited >= MAX_WAIT) return;
          waited += TICK;
          setTimeout(tryEmbed, TICK);
          return;
        }
        if (instanceRef.current) return;
        instanceRef.current = true;

        const pc = new window.daum!.Postcode({
          oncomplete: (data) => {
            onComplete(data);
            onClose();
          },
          onclose: () => onClose(),
          width: '100%',
          height: '100%',
        });
        pc.embed(containerRef.current!);
      };

      tryEmbed();
    };

    init();
    return () => { cancelled = true; };
  }, [open, onComplete, onClose]);

  if (!open) return null;

  return (
    <>
      {/* 배경 오버레이 */}
      <div
        className="fixed inset-0 z-[9998]"
        style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 모달 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="주소 검색"
        className="fixed z-[9999] flex flex-col overflow-hidden bg-white"
        style={{
          /* 모바일 (< 640px): 바텀시트 풀스크린에 가깝게 */
          bottom: 0,
          left: 0,
          right: 0,
          height: '90vh',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          boxShadow: '0 -4px 32px rgba(0,0,0,0.18)',
        }}
        // 데스크탑은 아래 인라인 style override (CSS media query 대신 tailwind sm: 이용 불가하여 JS로)
        ref={(el) => {
          if (!el) return;
          if (window.innerWidth >= 640) {
            // center modal
            el.style.top = '50%';
            el.style.left = '50%';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            el.style.transform = 'translate(-50%, -50%)';
            el.style.width = '500px';
            el.style.height = '540px';
            el.style.borderRadius = '16px';
          }
        }}
      >
        {/* 헤더 */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #E5E7EB' }}
        >
          {/* 핸들 (모바일 시각적 힌트) */}
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 w-9 h-1 rounded-full sm:hidden"
            style={{ background: '#D1D5DB' }}
            aria-hidden="true"
          />
          <span className="text-[15px] font-extrabold text-gray-900">주소 검색</span>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition"
            aria-label="닫기"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 다음 우편번호 embed 영역 */}
        <div
          ref={containerRef}
          className="flex-1 w-full overflow-hidden"
          style={{ minHeight: 0 }}
        />

        {/* 안내 텍스트 */}
        <div
          className="px-5 py-3 flex-shrink-0 text-center"
          style={{ borderTop: '1px solid #F3F4F6' }}
        >
          <p className="text-[11px] text-gray-400">
            도로명 또는 지번 주소로 검색하세요. 아파트·건물명도 입력 가능합니다.
          </p>
        </div>
      </div>
    </>
  );
}
