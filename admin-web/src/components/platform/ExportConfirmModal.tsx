'use client';

/**
 * ExportConfirmModal — 엑셀 내보내기 확인 모달
 *
 * - 현재 탭 안내
 * - 마스킹 토글 (기본 ON)
 * - 개인정보 책임 안내
 * - 다운로드 버튼
 */

import { useState } from 'react';

interface ExportConfirmModalProps {
  tab: 'players' | 'stores' | 'organizers';
  onConfirm: (masking: boolean) => Promise<void>;
  onClose: () => void;
}

const TAB_LABELS: Record<string, string> = {
  players: '일반 사용자',
  stores: '매장',
  organizers: '대회사',
};

export default function ExportConfirmModal({
  tab,
  onConfirm,
  onClose,
}: ExportConfirmModalProps) {
  const [masking, setMasking] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      await onConfirm(masking);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
      >
        <h3
          id="export-modal-title"
          className="font-extrabold text-gray-900 text-base mb-1"
        >
          엑셀 내보내기
        </h3>
        <p className="text-sm text-gray-500 mb-5">
          현재 탭(<b>{TAB_LABELS[tab]}</b>)의 회원 정보를 엑셀로 다운로드합니다.
        </p>

        {/* 마스킹 토글 */}
        <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4">
          <div>
            <div className="text-sm font-bold text-gray-900">개인정보 마스킹</div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              휴대폰 중간 4자리·이메일 앞자리 마스킹 처리
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={masking}
            onClick={() => setMasking((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${masking ? 'bg-green-500' : 'bg-gray-300'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${masking ? 'translate-x-5' : 'translate-x-0'}`}
            />
            <span className="sr-only">{masking ? '마스킹 켜짐' : '마스킹 꺼짐'}</span>
          </button>
        </div>

        {/* 개인정보 책임 안내 */}
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5">
          <div className="flex gap-2">
            <svg className="flex-shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="text-[12px] text-red-800 font-bold leading-relaxed">
              개인정보가 포함된 파일입니다. 외부 유출 시 본사 책임.
              신중히 다운로드하세요.
            </p>
          </div>
        </div>

        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border-[1.5px] border-gray-200 font-bold text-sm text-gray-700 hover:bg-gray-50 transition disabled:opacity-40"
          >
            취소
          </button>
          <button
            onClick={handleDownload}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white transition disabled:opacity-40"
            style={{ background: '#FF1F8F' }}
          >
            {loading ? '생성 중…' : '다운로드'}
          </button>
        </div>
      </div>
    </div>
  );
}
