'use client';

/**
 * MembersTabExportButton — 탭별 엑셀 내보내기 버튼 + 모달 트리거
 */

import { useState } from 'react';
import ExportConfirmModal from './ExportConfirmModal';
import { exportMembersToXlsx, getMembersXlsxFilename } from '@/lib/export/members-xlsx';
import type {
  UserExportRow,
  StoreExportRow,
  OrganizerExportRow,
} from '@/lib/export/members-xlsx';
import { logAdminAction } from '@/lib/auditLog';

interface MembersTabExportButtonProps {
  tab: 'players' | 'stores' | 'organizers';
  users?: UserExportRow[];
  stores?: StoreExportRow[];
  organizers?: OrganizerExportRow[];
}

export default function MembersTabExportButton({
  tab,
  users = [],
  stores = [],
  organizers = [],
}: MembersTabExportButtonProps) {
  const [showModal, setShowModal] = useState(false);

  const handleExport = async (masking: boolean) => {
    const xlsxTab: 'users' | 'stores' | 'organizers' =
      tab === 'players' ? 'users' : tab;

    const blob = await exportMembersToXlsx({
      tab: xlsxTab,
      users,
      stores,
      organizers,
      masking,
    });

    // 다운로드 트리거
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getMembersXlsxFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // 감사 로그
    const rowCount =
      tab === 'players' ? users.length : tab === 'stores' ? stores.length : organizers.length;
    await logAdminAction({
      action: 'export_members',
      target: { type: tab === 'players' ? 'user' : tab === 'stores' ? 'store' : 'organizer', id: 'bulk' },
      metadata: { tab, rowCount, masking },
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
        aria-label="엑셀 내보내기"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        엑셀 내보내기
      </button>

      {showModal && (
        <ExportConfirmModal
          tab={tab}
          onConfirm={handleExport}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
