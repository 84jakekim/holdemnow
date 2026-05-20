'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  subscribeStoreReservations,
  respondToReservation,
  markReservationRead,
  reservationStatusLabel,
  type Reservation,
  type ReservationStatus,
} from '@/lib/reservations';

/* ============================================================
 * ReservationsPanel — 매장 어드민 예약 관리 패널
 * /admin/[storeId] 의 activeMenu === 'reservations' 일 때 렌더
 * 데이터: stores/{storeId}/reservations (실시간 구독)
 * ========================================================== */

interface Props {
  storeId: string;
}

type FilterKey = 'all' | 'pending' | 'confirmed' | 'rejected_cancelled' | 'completed';

const FILTERS: { id: FilterKey; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'pending', label: '대기' },
  { id: 'confirmed', label: '확정' },
  { id: 'rejected_cancelled', label: '거부·취소' },
  { id: 'completed', label: '완료' },
];

// 24시간 임박 기준
const SOON_MS = 24 * 60 * 60 * 1000;

export default function ReservationsPanel({ storeId }: Props) {
  const [items, setItems] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [rejectTarget, setRejectTarget] = useState<Reservation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeStoreReservations(
      storeId,
      (list) => { setItems(list); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); },
    );
    return unsub;
  }, [storeId]);

  const pendingCount = useMemo(
    () => items.filter((r) => r.status === 'pending').length,
    [items],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'rejected_cancelled') {
      return items.filter((r) => r.status === 'rejected' || r.status === 'cancelled');
    }
    return items.filter((r) => r.status === filter);
  }, [items, filter]);

  // 전체 보기일 때 — pending 먼저, 그다음 나머지
  const sorted = useMemo(() => {
    if (filter !== 'all') return filtered;
    const pending = filtered.filter((r) => r.status === 'pending');
    const rest = filtered.filter((r) => r.status !== 'pending');
    return [...pending, ...rest];
  }, [filtered, filter]);

  async function handleApprove(r: Reservation) {
    if (busyId) return;
    if (!confirm('예약을 승인할까요?')) return;
    setBusyId(r.id);
    try {
      await respondToReservation(storeId, r.id, 'confirm');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`승인 실패: ${msg}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(r: Reservation, responseNote: string) {
    if (busyId) return;
    setBusyId(r.id);
    try {
      await respondToReservation(storeId, r.id, 'reject', responseNote || undefined);
      setRejectTarget(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`거부 실패: ${msg}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {/* 헤더 */}
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          📅 예약 관리
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
          사용자가 보낸 방문 예약을 실시간으로 확인하고 승인·거부하세요.
        </p>
      </div>

      {/* 필터 칩 */}
      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => {
          const isActive = filter === f.id;
          const showBadge = f.id === 'pending' && pendingCount > 0;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="px-3.5 py-1.5 rounded-full text-[12px] font-bold transition flex items-center gap-1.5"
              style={
                isActive
                  ? {
                      background: 'var(--brand)',
                      color: '#fff',
                      border: '1px solid var(--brand)',
                    }
                  : {
                      background: 'var(--surface-1)',
                      color: 'var(--text-1)',
                      border: '1px solid var(--border)',
                    }
              }
            >
              <span>{f.label}</span>
              {showBadge && (
                <span
                  className="text-[10px] font-extrabold rounded-full px-1.5 py-0.5"
                  style={{
                    background: isActive ? 'rgba(255,255,255,0.25)' : 'var(--brand)',
                    color: '#fff',
                    minWidth: 18,
                    textAlign: 'center',
                  }}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div
          className="mb-4 p-3 text-xs"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.30)',
            color: '#dc2626',
            borderRadius: 'var(--r-lg)',
          }}
        >
          예약 데이터를 불러오는 중 오류가 발생했습니다: {error}
        </div>
      )}

      {/* 본문 */}
      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text-2)' }}>로딩 중…</div>
      ) : sorted.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-3">
          {sorted.map((r) => (
            <ReservationCard
              key={r.id}
              reservation={r}
              storeId={storeId}
              busy={busyId === r.id}
              onApprove={() => handleApprove(r)}
              onRejectOpen={() => setRejectTarget(r)}
            />
          ))}
        </div>
      )}

      {/* 거부 사유 모달 */}
      {rejectTarget && (
        <RejectModal
          reservation={rejectTarget}
          busy={busyId === rejectTarget.id}
          onClose={() => setRejectTarget(null)}
          onConfirm={(note) => handleReject(rejectTarget, note)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 빈 상태
// ─────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: FilterKey }) {
  const isAll = filter === 'all';
  return (
    <div
      className="p-10 text-center"
      style={{
        background: 'var(--surface-1)',
        border: '2px dashed var(--border)',
        borderRadius: 'var(--r-lg)',
      }}
    >
      <div className="text-3xl mb-2">📅</div>
      <div className="font-bold mb-1" style={{ color: 'var(--text-1)' }}>
        {isAll ? '아직 예약이 없습니다' : '이 상태의 예약이 없습니다'}
      </div>
      {isAll && (
        <div className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
          사용자 앱에서 매장 상세 → 예약하기로 신청합니다.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 카드
// ─────────────────────────────────────────────────────────────

interface CardProps {
  reservation: Reservation;
  storeId: string;
  busy: boolean;
  onApprove: () => void;
  onRejectOpen: () => void;
}

function ReservationCard({ reservation: r, storeId, busy, onApprove, onRejectOpen }: CardProps) {
  const [noteOpen, setNoteOpen] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tone = statusTone(r.status);
  const reservedMs = r.reservedFor?.toMillis?.() ?? 0;
  const now = Date.now();
  const isFuture = reservedMs > now;
  const isSoon = isFuture && reservedMs - now <= SOON_MS;
  const phone = r.authorPhone?.trim();
  const note = r.note?.trim();
  const responseNote = r.responseNote?.trim();
  const isUnread = !r.readByStore && r.status === 'pending';

  function handleMouseEnter() {
    if (!isUnread) return;
    hoverTimerRef.current = setTimeout(() => {
      markReservationRead(storeId, r.id).catch(() => {});
    }, 1000);
  }

  function handleMouseLeave() {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  function handleCardClick() {
    if (isUnread) {
      markReservationRead(storeId, r.id).catch(() => {});
    }
  }

  return (
    <div
      className="p-4"
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderLeft: isUnread ? '4px solid #F59E0B' : `4px solid ${tone.leftBar}`,
        borderRadius: 'var(--r-lg)',
        cursor: 'default',
      }}
    >
      {/* 상단 — 상태 + 시간 임박 배지 */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className="text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: tone.chipBg, color: tone.chipFg }}
        >
          {reservationStatusLabel(r.status)}
        </span>
        {isUnread && (
          <span
            className="text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: '#F59E0B', color: '#fff' }}
          >
            NEW
          </span>
        )}
        {isSoon && r.status !== 'cancelled' && r.status !== 'rejected' && (
          <span
            className="text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: '#dc2626', color: '#fff' }}
          >
            ⏰ 24시간 이내
          </span>
        )}
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-3)' }}>
          신청 {formatRelative(r.createdAt?.toMillis?.() ?? 0)}
        </span>
      </div>

      {/* 본문 */}
      <div className="mb-2">
        <div className="font-extrabold text-[15px]" style={{ color: 'var(--text-1)' }}>
          {r.authorName || '익명'}
          {phone && (
            <>
              {' '}
              <a
                href={`tel:${phone}`}
                className="font-mono text-[12px] font-bold underline underline-offset-2"
                style={{ color: 'var(--brand)' }}
              >
                ({phone})
              </a>
            </>
          )}
        </div>
        <div className="text-[13px] mt-0.5" style={{ color: 'var(--text-1)' }}>
          <span className="font-bold">{formatWhen(reservedMs)}</span>
          {' · '}
          <span>{r.partySize}명</span>
        </div>
        {r.participatingGame && (
          <div className="text-[12px] mt-1 font-bold" style={{ color: 'var(--brand)' }}>
            🎮 참가 게임: {r.participatingGame}
          </div>
        )}
      </div>

      {/* 사용자 메모 */}
      {note && (
        <button
          onClick={() => setNoteOpen((v) => !v)}
          className="text-left w-full px-2.5 py-1.5 text-[12px] mb-2"
          style={{
            background: 'var(--surface-2, rgba(0,0,0,0.03))',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            color: 'var(--text-2)',
          }}
          title={noteOpen ? '접기' : '펼치기'}
        >
          <span className="mr-1">💬</span>
          <span className={noteOpen ? '' : 'line-clamp-1'}>{note}</span>
        </button>
      )}

      {/* 매장 응답 메모 (있을 때) */}
      {responseNote && (
        <div
          className="px-2.5 py-1.5 text-[12px] mb-2"
          style={{
            background: 'rgba(255,31,143,0.06)',
            border: '1px solid rgba(255,31,143,0.20)',
            borderRadius: '8px',
            color: 'var(--text-2)',
          }}
        >
          <span className="font-bold mr-1" style={{ color: 'var(--brand)' }}>매장 응답:</span>
          {responseNote}
        </div>
      )}

      {/* 액션 — pending만 */}
      {r.status === 'pending' && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={onApprove}
            disabled={busy}
            className="flex-1 py-2 rounded-lg font-bold text-[13px] text-white transition disabled:opacity-50"
            style={{ background: '#16a34a' }}
          >
            ✅ 승인
          </button>
          <button
            onClick={onRejectOpen}
            disabled={busy}
            className="flex-1 py-2 rounded-lg font-bold text-[13px] transition disabled:opacity-50"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          >
            ❌ 거부
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 거부 사유 모달
// ─────────────────────────────────────────────────────────────

function RejectModal({
  reservation: r,
  busy,
  onClose,
  onConfirm,
}: {
  reservation: Reservation;
  busy: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const reservedMs = r.reservedFor?.toMillis?.() ?? 0;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm p-5 shadow-xl"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
        }}
      >
        <div className="font-extrabold text-[15px] mb-1" style={{ color: 'var(--text-1)' }}>
          예약을 거부할까요?
        </div>
        <div className="text-[12px] mb-3" style={{ color: 'var(--text-2)' }}>
          {r.authorName || '익명'} · {formatWhen(reservedMs)} · {r.partySize}명
        </div>

        <label className="text-[12px] font-bold block mb-1" style={{ color: 'var(--text-1)' }}>
          거부 사유 (선택)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          placeholder="예) 해당 시간은 예약이 마감되었습니다. 다른 시간으로 다시 신청 부탁드립니다."
          rows={3}
          className="w-full text-[13px] p-2.5 resize-none"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            color: 'var(--text-1)',
            outline: 'none',
          }}
        />
        <div className="text-[10px] text-right mt-0.5" style={{ color: 'var(--text-3)' }}>
          {note.length}/200
        </div>

        <div className="flex gap-2 mt-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg font-bold text-[13px]"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          >
            취소
          </button>
          <button
            onClick={() => onConfirm(note.trim())}
            disabled={busy}
            className="flex-1 py-2 rounded-lg font-bold text-[13px] text-white disabled:opacity-50"
            style={{ background: '#dc2626' }}
          >
            {busy ? '처리 중…' : '거부'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────

function statusTone(s: ReservationStatus): {
  bg: string;
  border: string;
  leftBar: string;
  chipBg: string;
  chipFg: string;
} {
  switch (s) {
    case 'pending':
      return {
        bg: 'rgba(255,31,143,0.06)',
        border: 'rgba(255,31,143,0.25)',
        leftBar: '#FF1F8F',
        chipBg: 'rgba(255,31,143,0.15)',
        chipFg: '#FF1F8F',
      };
    case 'confirmed':
      return {
        bg: 'var(--surface-1)',
        border: 'rgba(22,163,74,0.30)',
        leftBar: '#16a34a',
        chipBg: 'rgba(22,163,74,0.15)',
        chipFg: '#15803d',
      };
    case 'rejected':
    case 'cancelled':
      return {
        bg: 'var(--surface-1)',
        border: 'var(--border)',
        leftBar: '#9ca3af',
        chipBg: 'rgba(156,163,175,0.20)',
        chipFg: '#6b7280',
      };
    case 'no_show':
      return {
        bg: 'var(--surface-1)',
        border: 'rgba(245,158,11,0.30)',
        leftBar: '#f59e0b',
        chipBg: 'rgba(245,158,11,0.15)',
        chipFg: '#b45309',
      };
    case 'completed':
      return {
        bg: 'var(--surface-1)',
        border: 'var(--border)',
        leftBar: '#3b82f6',
        chipBg: 'rgba(59,130,246,0.15)',
        chipFg: '#1d4ed8',
      };
    default:
      return {
        bg: 'var(--surface-1)',
        border: 'var(--border)',
        leftBar: '#9ca3af',
        chipBg: 'rgba(156,163,175,0.20)',
        chipFg: '#6b7280',
      };
  }
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatWhen(ms: number): string {
  if (!ms) return '-';
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatRelative(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return '방금';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
