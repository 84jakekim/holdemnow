'use client';

/**
 * 매장 어드민 사이드바용 푸시 권한 위젯.
 *
 * 매장 owner가 데스크탑 브라우저에서 푸시 알림을 받지 못하면 새 예약 알림이
 * 와도 사장이 인지하지 못함. 이 위젯은:
 *   - 브라우저 알림 권한 상태(granted/denied/default)를 표시
 *   - default(미설정): '🔔 알림 켜기' 버튼 — enableNotifications 호출
 *   - denied: 브라우저 설정에서 차단됨 안내
 *   - granted: '✓ 푸시 ON' 뱃지 (변경 X)
 */

import { useEffect, useState } from 'react';
import { enableNotifications, getNotificationPermission } from '@/lib/messaging';

interface Props {
  ownerUid: string;
}

export default function StorePushPermissionWidget({ ownerUid }: Props) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(getNotificationPermission());
  }, []);

  const handleEnable = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await enableNotifications(ownerUid);
      // enableNotifications 내부에서 Notification.requestPermission 호출 +
      // fcmToken 발급·저장. 결과로 token이 null이면 권한 거부.
      if (token) {
        setPermission('granted');
      } else {
        setPermission(getNotificationPermission());
        setError('알림 권한이 거부되었거나 토큰 발급에 실패했습니다');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (permission === 'unsupported') {
    return (
      <div className="mx-3 my-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
        이 브라우저는 푸시 알림을 지원하지 않습니다
      </div>
    );
  }

  if (permission === 'granted') {
    return (
      <div
        className="mx-3 my-2 rounded-lg px-3 py-2 text-[11px] font-bold flex items-center gap-1.5"
        style={{
          background: 'rgba(16,185,129,0.10)',
          color: '#047857',
          border: '1px solid rgba(16,185,129,0.25)',
        }}
        title="새 예약·LIVE 알림이 푸시로 도착합니다"
      >
        <span aria-hidden>✓</span>
        푸시 알림 ON — 새 예약 수신 중
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div
        className="mx-3 my-2 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
        style={{
          background: 'rgba(239,68,68,0.08)',
          color: '#B91C1C',
          border: '1px solid rgba(239,68,68,0.25)',
        }}
      >
        <div className="font-extrabold mb-0.5">⚠️ 푸시 알림 차단됨</div>
        브라우저 주소창 옆 자물쇠 아이콘 → 알림 → 허용으로 변경한 뒤 새로고침해 주세요. 새 예약 알림을 받을 수 없습니다.
      </div>
    );
  }

  // default — 권한 미설정
  return (
    <div className="mx-3 my-2">
      <button
        onClick={handleEnable}
        disabled={busy}
        className="w-full px-3 py-2 rounded-lg text-[12px] font-extrabold text-white transition disabled:opacity-40"
        style={{
          background: 'linear-gradient(135deg, #FF1F8F 0%, #B91072 100%)',
          boxShadow: '0 2px 8px rgba(255,31,143,0.30)',
        }}
      >
        {busy ? '권한 요청 중…' : '🔔 새 예약 알림 켜기'}
      </button>
      {error && (
        <div className="text-[10.5px] text-red-700 mt-1 leading-relaxed">{error}</div>
      )}
      <div className="text-[10.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>
        켜두면 사용자가 예약 신청하는 즉시 브라우저 푸시로 알림이 도착합니다.
      </div>
    </div>
  );
}
