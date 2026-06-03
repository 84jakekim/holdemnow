'use client';

/**
 * ForceDeleteUserButton — 회원관리 '일반 사용자' 탭의 행 강제 탈퇴 액션.
 *
 * 불법 유도 등 악성 유저를 본사가 강제 탈퇴시킨다.
 * 파괴적·되돌릴 수 없는 작업이므로 2단계 확인(사유 입력 모달 → 최종 확인 체크)을 거친다.
 *
 *  1) 빨간 "강제 탈퇴" 버튼 클릭 → 사유 입력 모달 오픈
 *  2) 사유 입력 + "되돌릴 수 없음" 확인 체크 후 실행 → deleteUserByAdmin 호출
 *  3) 성공 시 onDeleted(uid)로 부모가 낙관적으로 행 제거
 *
 * 안전: platform_admin 행·자기 자신에는 이 버튼을 렌더하지 않는다(호출부 책임).
 * 행 전체가 상세로 이동하는 클릭 영역이라 내부 인터랙션은 stopPropagation 처리.
 */

import { useState } from 'react';
import { forceDeleteUser } from '@/lib/userAdmin';

interface Props {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  /** 성공 시 부모에 알려 행을 낙관적으로 제거 */
  onDeleted: (uid: string) => void;
}

export default function ForceDeleteUserButton({ uid, email, displayName, onDeleted }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = displayName || email || uid.slice(0, 16) + '…';

  const openModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setReason('');
    setConfirmChecked(false);
    setError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (busy) return;
    setModalOpen(false);
  };

  const handleSubmit = async () => {
    if (!confirmChecked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await forceDeleteUser({ targetUid: uid, reason: reason.trim() || undefined });
      if (!res.success) {
        setError(res.reason || '강제 탈퇴에 실패했습니다.');
        setBusy(false);
        return;
      }
      // 성공 — 모달 닫고 부모가 행 제거
      setModalOpen(false);
      setBusy(false);
      onDeleted(uid);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={openModal}
        title="악성 사용자 강제 탈퇴 (되돌릴 수 없음)"
        className="text-[10px] font-bold rounded px-2 py-1 border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 whitespace-nowrap transition"
      >
        강제 탈퇴
      </button>

      {modalOpen && (
        <div
          onClick={(e) => { e.stopPropagation(); closeModal(); }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl w-full max-w-sm p-6"
          >
            <div className="text-lg font-extrabold text-red-700 mb-1">⚠️ 강제 탈퇴</div>
            <p className="text-[13px] text-gray-700 mb-1">
              <b className="font-mono">{label}</b> 계정을 강제로 탈퇴시킵니다.
            </p>
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700 leading-relaxed mb-4">
              이 작업은 <b>되돌릴 수 없습니다.</b> 사용자의 계정·인증 정보가 영구 삭제됩니다.
              불법 유도 등 악성 행위가 확인된 경우에만 사용하세요.
            </div>

            <label className="block text-[11px] font-bold text-gray-700 mb-1">사유 (권장)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 불법 사설 토너 유도 / 사기 신고 누적"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[64px] resize-none outline-none focus:border-red-400"
              disabled={busy}
            />

            <label className="flex items-start gap-2 mt-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={(e) => setConfirmChecked(e.target.checked)}
                disabled={busy}
                className="mt-0.5"
              />
              <span className="text-[12px] text-gray-700">
                위 내용을 확인했으며, <b className="text-red-700">되돌릴 수 없음</b>을 이해합니다.
              </span>
            </label>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 mt-3">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <button
                onClick={closeModal}
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={!confirmChecked || busy}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-extrabold text-sm hover:bg-red-700 disabled:opacity-40 disabled:hover:bg-red-600"
              >
                {busy ? '처리 중…' : '강제 탈퇴'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
