'use client';

/**
 * AdminNotificationBell
 *
 * 매장 어드민 사이드바 상단에 마운트.
 * pending + readByStore=false 예약 개수 카운트 → 빨간 배지.
 * 클릭 → dropdown: 최신 5개 목록 + 카드 클릭 시 readByStore=true 마킹.
 */

import { useEffect, useRef, useState } from 'react';
import {
  subscribeStoreReservations,
  markReservationRead,
  type Reservation,
} from '@/lib/reservations';

interface Props {
  storeId: string;
  onNavigate?: (reservationId: string) => void;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatShort(ms: number): string {
  if (!ms) return '-';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export default function AdminNotificationBell({ storeId, onNavigate }: Props) {
  const [items, setItems] = useState<Reservation[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 매장 예약 구독
  useEffect(() => {
    if (!storeId) return;
    const unsub = subscribeStoreReservations(
      storeId,
      (list) => setItems(list),
      (e) => console.warn('[AdminNotificationBell]', e),
    );
    return unsub;
  }, [storeId]);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // unread pending
  const unread = items.filter((r) => r.status === 'pending' && !r.readByStore);
  const unreadCount = unread.length;

  // dropdown: unread pending 최신 5개 (createdAt 내림차순 — items는 이미 내림차순)
  const dropdownItems = unread.slice(0, 5);

  async function handleCardClick(r: Reservation) {
    try {
      await markReservationRead(storeId, r.id);
    } catch (e) {
      console.warn('[AdminNotificationBell] markRead 실패', e);
    }
    onNavigate?.(r.id);
    setOpen(false);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* 종 버튼 */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`예약 알림 ${unreadCount > 0 ? `${unreadCount}건` : '없음'}`}
        className="relative flex items-center justify-center w-10 h-10 rounded-xl transition"
        style={{
          background: open ? 'rgba(255,31,143,0.12)' : 'transparent',
          color: unreadCount > 0 ? 'var(--brand)' : 'var(--text-2)',
        }}
      >
        {/* 종 아이콘 */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* 배지 */}
        {unreadCount > 0 && (
          <span
            className="absolute top-1 right-1 flex items-center justify-center text-white font-extrabold"
            style={{
              background: '#dc2626',
              borderRadius: '999px',
              fontSize: 9,
              minWidth: 16,
              height: 16,
              padding: '0 3px',
              lineHeight: 1,
            }}
            aria-hidden
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* 드롭다운 */}
      {open && (
        <div
          className="absolute left-0 z-50 mt-1 shadow-xl"
          style={{
            width: 280,
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
          }}
        >
          {/* 헤더 */}
          <div
            className="px-4 py-2.5 flex items-center justify-between"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <span className="text-[12px] font-extrabold" style={{ color: 'var(--text-1)' }}>
              읽지 않은 예약
            </span>
            {unreadCount > 0 && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}
              >
                {unreadCount}건
              </span>
            )}
          </div>

          {/* 목록 */}
          {dropdownItems.length === 0 ? (
            <div className="px-4 py-5 text-center text-[12px]" style={{ color: 'var(--text-2)' }}>
              읽지 않은 예약이 없습니다
            </div>
          ) : (
            <div>
              {dropdownItems.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleCardClick(r)}
                  className="w-full text-left px-4 py-3 transition"
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,31,143,0.15)', color: 'var(--brand)' }}
                    >
                      NEW
                    </span>
                    <span className="text-[12px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                      {r.authorName || '익명'}
                    </span>
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                    {formatShort(r.reservedFor?.toMillis?.() ?? 0)} · {r.partySize}명
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* 하단 — 예약 관리로 이동 */}
          <button
            onClick={() => {
              onNavigate?.('');
              setOpen(false);
            }}
            className="w-full text-center text-[12px] font-bold py-3 transition"
            style={{ color: 'var(--brand)' }}
          >
            예약 관리로 이동 →
          </button>
        </div>
      )}
    </div>
  );
}
