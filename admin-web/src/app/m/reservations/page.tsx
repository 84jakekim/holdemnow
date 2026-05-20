'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks';
import AnonymousPrompt from '@/components/mobile/AnonymousPrompt';
import {
  cancelReservation,
  reservationStatusLabel,
  subscribeUserReservations,
  type Reservation,
  type ReservationStatus,
} from '@/lib/reservations';

/**
 * 내 예약 목록 페이지.
 *
 * 섹션:
 *   🕐 대기 (pending)
 *   ✅ 확정 (confirmed)
 *   ❌ 거부·취소 (rejected, cancelled, no_show)
 *   🏁 완료 (completed)
 *
 * pending·confirmed 카드만 [취소] 버튼 노출 → confirm 후 cancelReservation.
 */

type GroupKey = 'pending' | 'confirmed' | 'rejected' | 'completed';

const STATUS_GROUP: Record<ReservationStatus, GroupKey> = {
  pending: 'pending',
  confirmed: 'confirmed',
  rejected: 'rejected',
  cancelled: 'rejected',
  no_show: 'rejected',
  completed: 'completed',
};

const SECTION_META: Record<GroupKey, { icon: string; label: string; empty: string; color: string; bg: string }> = {
  pending: {
    icon: '🕐',
    label: '대기',
    empty: '확인 대기 중인 예약이 없어요',
    color: '#B45309',
    bg: 'rgba(245,158,11,0.10)',
  },
  confirmed: {
    icon: '✅',
    label: '확정',
    empty: '확정된 예약이 없어요',
    color: '#047857',
    bg: 'rgba(16,185,129,0.10)',
  },
  rejected: {
    icon: '❌',
    label: '거부·취소',
    empty: '거부·취소된 예약이 없어요',
    color: 'var(--text-3)',
    bg: 'var(--surface-2)',
  },
  completed: {
    icon: '🏁',
    label: '완료',
    empty: '방문 완료된 예약이 없어요',
    color: 'var(--text-2)',
    bg: 'var(--surface-2)',
  },
};

const SECTION_ORDER: GroupKey[] = ['pending', 'confirmed', 'rejected', 'completed'];

export default function ReservationsPage() {
  const authState = useAuth();
  const [items, setItems] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authState.status !== 'authenticated') {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeUserReservations(
      authState.user.uid,
      (list) => {
        setItems(list);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [authState]);

  const grouped = useMemo(() => {
    const g: Record<GroupKey, Reservation[]> = {
      pending: [], confirmed: [], rejected: [], completed: [],
    };
    items.forEach((r) => {
      const key = STATUS_GROUP[r.status] ?? 'rejected';
      g[key].push(r);
    });
    // pending·confirmed: 임박 순(reservedFor asc), 그 외: 최근 순
    g.pending.sort((a, b) => (a.reservedFor?.toMillis?.() ?? 0) - (b.reservedFor?.toMillis?.() ?? 0));
    g.confirmed.sort((a, b) => (a.reservedFor?.toMillis?.() ?? 0) - (b.reservedFor?.toMillis?.() ?? 0));
    g.rejected.sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
    g.completed.sort((a, b) => (b.reservedFor?.toMillis?.() ?? 0) - (a.reservedFor?.toMillis?.() ?? 0));
    return g;
  }, [items]);

  if (authState.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      </div>
    );
  }
  if (authState.status === 'anonymous') {
    return <AnonymousPrompt title="내 예약" icon="📅" desc="매장 방문 예약 내역을 보려면 로그인하세요." />;
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* 헤더 */}
      <header
        className="px-5 h-14 flex items-center justify-between sticky top-0 z-10"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xl font-extrabold tracking-tight font-serif" style={{ color: 'var(--text-1)' }}>
          내 예약
        </span>
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
          {items.length.toLocaleString()}건
        </span>
      </header>

      {error && (
        <div
          className="mx-5 mt-4 px-3 py-2 rounded-xl text-[12px] font-bold"
          style={{ background: 'rgba(229,62,62,0.10)', color: 'var(--live)' }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>예약 불러오는 중…</div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="pb-24">
          {SECTION_ORDER.map((key) => {
            const meta = SECTION_META[key];
            const list = grouped[key];
            if (list.length === 0) return null;
            return (
              <section key={key} className="px-5 pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <span aria-hidden="true" style={{ fontSize: 16 }}>{meta.icon}</span>
                  <h2 className="text-[14px] font-extrabold" style={{ color: 'var(--text-1)' }}>
                    {meta.label}
                  </h2>
                  <span
                    className="ml-1 text-[10px] font-extrabold font-mono px-1.5 py-0.5 rounded"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    {list.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {list.map((r) => (
                    <ReservationCard key={r.id} reservation={r} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-16 px-8 text-center">
      <div className="text-[42px] mb-3" aria-hidden="true">📅</div>
      <div className="text-[15px] font-extrabold mb-1.5" style={{ color: 'var(--text-1)' }}>
        아직 예약이 없어요
      </div>
      <div className="text-[12px] leading-relaxed mb-5" style={{ color: 'var(--text-3)' }}>
        매장 상세 페이지에서 예약하기 버튼을 눌러보세요
      </div>
      <Link
        href="/m/find"
        className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-[13px] font-extrabold text-white transition active:scale-95"
        style={{ background: '#FF1F8F', boxShadow: '0 4px 12px rgba(255,31,143,0.30)' }}
      >
        매장 둘러보기
      </Link>
    </div>
  );
}

function ReservationCard({ reservation }: { reservation: Reservation }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reservedMs = reservation.reservedFor?.toMillis?.() ?? 0;
  const canCancel = reservation.status === 'pending' || reservation.status === 'confirmed';

  const handleCancel = async () => {
    if (!window.confirm('이 예약을 취소할까요?')) return;
    setBusy(true);
    setError(null);
    try {
      await cancelReservation(reservation.storeId, reservation.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const goStore = () => {
    if (reservation.storeId) router.push(`/m/store/${reservation.storeId}`);
  };

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <button
          type="button"
          onClick={goStore}
          className="flex-1 min-w-0 text-left transition active:scale-[0.99]"
        >
          <div className="text-[15px] font-extrabold truncate" style={{ color: 'var(--text-1)' }}>
            {reservation.storeName || '매장'}
          </div>
        </button>
        <StatusBadge status={reservation.status} />
      </div>

      <div className="space-y-1 text-[12px]" style={{ color: 'var(--text-2)' }}>
        <div className="flex items-center gap-2">
          <span aria-hidden="true">🗓</span>
          <span className="font-mono">{fmtDateTime(reservedMs)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true">👥</span>
          <span>{reservation.partySize}명</span>
        </div>
        {reservation.participatingGame && (
          <div className="flex items-start gap-2">
            <span aria-hidden="true">🎮</span>
            <span className="break-words">{reservation.participatingGame}</span>
          </div>
        )}
        {reservation.note && (
          <div className="flex items-start gap-2 pt-0.5">
            <span aria-hidden="true">📝</span>
            <span style={{ color: 'var(--text-3)' }} className="break-words">{reservation.note}</span>
          </div>
        )}
        {reservation.responseNote && (
          <div
            className="mt-2 px-2.5 py-1.5 rounded-lg text-[11px]"
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
          >
            <span className="font-extrabold mr-1" style={{ color: 'var(--brand)' }}>매장 안내:</span>
            {reservation.responseNote}
          </div>
        )}
      </div>

      {error && (
        <div
          className="mt-3 px-3 py-2 rounded-lg text-[11px] font-bold"
          style={{ background: 'rgba(229,62,62,0.10)', color: 'var(--live)' }}
        >
          {error}
        </div>
      )}

      {canCancel && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-40 transition active:scale-95"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            {busy ? '취소 중…' : '예약 취소'}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ReservationStatus }) {
  const map: Record<ReservationStatus, { bg: string; fg: string }> = {
    pending: { bg: 'rgba(245,158,11,0.14)', fg: '#B45309' },
    confirmed: { bg: 'rgba(16,185,129,0.14)', fg: '#047857' },
    rejected: { bg: 'rgba(229,62,62,0.12)', fg: '#B91C1C' },
    cancelled: { bg: 'var(--surface-3)', fg: 'var(--text-3)' },
    no_show: { bg: 'rgba(229,62,62,0.12)', fg: '#B91C1C' },
    completed: { bg: 'var(--surface-2)', fg: 'var(--text-2)' },
  };
  const c = map[status] ?? map.pending;
  return (
    <span
      className="text-[10px] font-extrabold px-2 py-0.5 rounded-full flex-shrink-0"
      style={{ background: c.bg, color: c.fg }}
    >
      {reservationStatusLabel(status)}
    </span>
  );
}

function fmtDateTime(ms: number): string {
  if (!ms) return '-';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${yyyy}.${mm}.${dd} (${weekday}) ${hh}:${mi}`;
}
