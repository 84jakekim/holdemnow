'use client';

/**
 * /m/reservations — 사용자 본인 예약 종합 페이지 (PM 회의 결정안)
 *
 * 핵심 변경 (vs 베이스라인):
 *  - 매장정보·지도·전화·길찾기·취소가 한 카드 안에 통합 (별도 페이지 이동 X)
 *  - 2탭: 예정(pending+confirmed) / 지난 예약(나머지). 임박 카드 sticky 펄스.
 *  - 상태별 톤·액션 분기 (pending 노랑·confirmed 녹색·cancelled 회색 등)
 *  - 인라인 카카오맵 (매장 마커 + 사용자 위치 + 거리 라벨)
 *  - 빈 상태 이중 CTA (지금 LIVE / 근처 매장 둘러보기)
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth, useStoreDoc } from '@/lib/hooks';
import AnonymousPrompt from '@/components/mobile/AnonymousPrompt';
import {
  cancelReservation,
  reservationStatusLabel,
  subscribeUserReservations,
  type Reservation,
  type ReservationStatus,
} from '@/lib/reservations';
import { callPhone, openDirections } from '@/lib/actions';
import { ensureStoreCoords } from '@/lib/storeGeocode';
import InlineStoreMap from '@/components/mobile/reservations/InlineStoreMap';

type Tab = 'upcoming' | 'past';

const UPCOMING_STATUSES: ReservationStatus[] = ['pending', 'confirmed'];

export default function ReservationsPage() {
  const authState = useAuth();
  const [items, setItems] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');

  useEffect(() => {
    if (authState.status !== 'authenticated') {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeUserReservations(
      authState.user.uid,
      (list) => { setItems(list); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); },
    );
    return unsub;
  }, [authState]);

  const { upcoming, past } = useMemo(() => {
    const u: Reservation[] = [];
    const p: Reservation[] = [];
    for (const r of items) {
      if (UPCOMING_STATUSES.includes(r.status)) u.push(r);
      else p.push(r);
    }
    u.sort((a, b) => (a.reservedFor?.toMillis?.() ?? 0) - (b.reservedFor?.toMillis?.() ?? 0));
    p.sort((a, b) => (b.reservedFor?.toMillis?.() ?? 0) - (a.reservedFor?.toMillis?.() ?? 0));
    return { upcoming: u, past: p };
  }, [items]);

  const visibleList = tab === 'upcoming' ? upcoming : past;

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
        className="px-5 h-14 flex items-center justify-between sticky top-0 z-20"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xl font-extrabold tracking-tight font-serif" style={{ color: 'var(--text-1)' }}>
          내 예약
        </span>
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
          예정 {upcoming.length} · 지난 {past.length}
        </span>
      </header>

      {/* 탭 */}
      <div
        className="sticky z-10 px-4 flex gap-1"
        style={{ top: 56, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        {([
          { id: 'upcoming' as Tab, label: '예정', count: upcoming.length },
          { id: 'past' as Tab, label: '지난 예약', count: past.length },
        ]).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-3 py-2.5 text-[13px] font-extrabold transition relative"
              style={{
                color: active ? 'var(--brand)' : 'var(--text-3)',
                letterSpacing: '-0.01em',
              }}
            >
              {t.label}
              <span className="ml-1 text-[11px] font-mono">{t.count}</span>
              {active && (
                <span
                  aria-hidden
                  className="absolute left-2 right-2 bottom-0 h-[2.5px] rounded-full"
                  style={{ background: 'var(--brand)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div
          className="mx-5 mt-4 px-3 py-2 rounded-xl text-[12px] font-bold"
          style={{ background: 'rgba(229,62,62,0.10)', color: 'var(--live)' }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
          예약 불러오는 중…
        </div>
      ) : visibleList.length === 0 ? (
        <EmptyState tab={tab} hasAny={items.length > 0} />
      ) : (
        <div className="px-4 pt-4 pb-24 space-y-3">
          {visibleList.map((r) => (
            <ReservationCard key={r.id} reservation={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 빈 상태 — 이중 CTA
 * ─────────────────────────────────────────────────────────────*/
function EmptyState({ tab, hasAny }: { tab: Tab; hasAny: boolean }) {
  if (tab === 'past' && hasAny) {
    return (
      <div className="py-16 px-8 text-center">
        <div className="text-[36px] mb-3" aria-hidden>📭</div>
        <div className="text-[14px] font-bold" style={{ color: 'var(--text-2)' }}>
          지난 예약이 없어요
        </div>
      </div>
    );
  }
  return (
    <div className="py-14 px-8 text-center">
      <div className="text-[44px] mb-3" aria-hidden>📅</div>
      <div className="text-[15px] font-extrabold mb-1.5" style={{ color: 'var(--text-1)' }}>
        아직 예약이 없어요
      </div>
      <div className="text-[12px] leading-relaxed mb-6" style={{ color: 'var(--text-3)' }}>
        지금 LIVE 중인 매장에 들러보거나<br />
        근처 매장을 둘러보세요
      </div>
      <div className="flex flex-col gap-2 max-w-[260px] mx-auto">
        <Link
          href="/m/live"
          className="inline-flex items-center justify-center px-5 py-3 rounded-xl text-[13px] font-extrabold text-white transition active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #FF1F8F 0%, #B91072 100%)',
            boxShadow: '0 4px 12px rgba(255,31,143,0.30)',
          }}
        >
          🔴 지금 LIVE 매장 보기
        </Link>
        <Link
          href="/m/find"
          className="inline-flex items-center justify-center px-5 py-3 rounded-xl text-[13px] font-extrabold transition active:scale-95"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          📍 근처 매장 둘러보기
        </Link>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 예약 카드 — 매장 정보 + 인라인 지도 + 액션 통합
 * ─────────────────────────────────────────────────────────────*/

interface CardTone {
  border: string;
  bg: string;
  chipBg: string;
  chipColor: string;
  mapDimmed: boolean;
}

function toneFor(status: ReservationStatus): CardTone {
  switch (status) {
    case 'pending':
      return {
        border: 'rgba(245,158,11,0.40)',
        bg: 'linear-gradient(180deg, rgba(245,158,11,0.04) 0%, transparent 30%)',
        chipBg: 'rgba(245,158,11,0.14)',
        chipColor: '#B45309',
        mapDimmed: true,
      };
    case 'confirmed':
      return {
        border: 'rgba(16,185,129,0.40)',
        bg: 'linear-gradient(180deg, rgba(16,185,129,0.05) 0%, transparent 30%)',
        chipBg: 'rgba(16,185,129,0.14)',
        chipColor: '#047857',
        mapDimmed: false,
      };
    case 'rejected':
      return {
        border: 'rgba(229,62,62,0.30)',
        bg: 'var(--surface-1)',
        chipBg: 'rgba(229,62,62,0.12)',
        chipColor: '#B91C1C',
        mapDimmed: true,
      };
    case 'cancelled':
      return {
        border: 'var(--border)',
        bg: 'var(--surface-1)',
        chipBg: 'var(--surface-3)',
        chipColor: 'var(--text-3)',
        mapDimmed: true,
      };
    case 'no_show':
      return {
        border: 'rgba(229,62,62,0.30)',
        bg: 'var(--surface-1)',
        chipBg: 'rgba(229,62,62,0.12)',
        chipColor: '#B91C1C',
        mapDimmed: true,
      };
    case 'completed':
      return {
        border: 'var(--border)',
        bg: 'var(--surface-1)',
        chipBg: 'var(--surface-2)',
        chipColor: 'var(--text-2)',
        mapDimmed: false,
      };
    default:
      return {
        border: 'var(--border)',
        bg: 'var(--surface-1)',
        chipBg: 'var(--surface-2)',
        chipColor: 'var(--text-2)',
        mapDimmed: true,
      };
  }
}

function ReservationCard({ reservation }: { reservation: Reservation }) {
  const store = useStoreDoc(reservation.storeId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // 매장 좌표 보정 (lat/lng 누락 시 geocode)
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    ensureStoreCoords({
      id: reservation.storeId,
      lat: store.lat,
      lng: store.lng,
      address: store.address,
    }).then((c) => {
      if (cancelled) return;
      if (c) setCoords(c);
    });
    return () => { cancelled = true; };
  }, [store, reservation.storeId]);

  const reservedMs = reservation.reservedFor?.toMillis?.() ?? 0;
  const now = Date.now();
  const isImminent = reservation.status === 'confirmed' && reservedMs - now > 0 && reservedMs - now <= 2 * 60 * 60 * 1000;
  const tone = toneFor(reservation.status);

  // PM 결정: 본인 취소 가능 시간 룰 (rules와 일치)
  // pending: 항상 / confirmed: reservedFor - 1h > now
  const canCancel =
    reservation.status === 'pending' ||
    (reservation.status === 'confirmed' && reservedMs - now > 60 * 60 * 1000);

  const isPastOrEnded = reservation.status === 'cancelled' || reservation.status === 'rejected' ||
    reservation.status === 'no_show' || reservation.status === 'completed';

  const handleCancel = async () => {
    if (!window.confirm('이 예약을 취소할까요?')) return;
    setBusy(true);
    setError(null);
    try {
      await cancelReservation(reservation.storeId, reservation.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const photoUrl = store?.photoUrls?.[0];
  const phone = store?.phone;
  const address = store?.address;
  const storeLat = coords?.lat ?? store?.lat;
  const storeLng = coords?.lng ?? store?.lng;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: tone.bg,
        border: `1.5px solid ${tone.border}`,
        boxShadow: isImminent
          ? '0 0 0 2px rgba(16,185,129,0.18), 0 4px 16px rgba(16,185,129,0.12)'
          : '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
      }}
    >
      <div className="p-4">
        {/* 1행: 상태칩 + 매장명 + D-day */}
        <div className="flex items-center gap-2 mb-2">
          <StatusChip status={reservation.status} tone={tone} />
          <span className="text-[15px] font-extrabold truncate flex-1 min-w-0" style={{ color: 'var(--text-1)' }}>
            {reservation.storeName || '매장'}
          </span>
          <span className="text-[11.5px] font-mono font-bold flex-shrink-0" style={{ color: 'var(--text-2)' }}>
            {dDay(reservedMs)}
          </span>
        </div>

        {/* 2행: 썸네일 + 일시·인원·메모 */}
        <div className="flex gap-3 mb-3">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
              style={{ border: '1px solid var(--border)' }}
            />
          ) : (
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              🏬
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
            <div className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
              🗓 {fmtDateTime(reservedMs)}
            </div>
            <div className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              👥 {reservation.partySize}명 · ⏱ {reservation.durationMinutes ?? 120}분
            </div>
            {reservation.participatingGame && (
              <div className="text-[11.5px] truncate" style={{ color: 'var(--text-3)' }}>
                🎮 {reservation.participatingGame}
              </div>
            )}
          </div>
        </div>

        {/* 사용자 메모 */}
        {reservation.note && (
          <div
            className="text-[12px] leading-relaxed px-3 py-2 rounded-lg mb-3 whitespace-pre-wrap"
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
          >
            📝 {reservation.note}
          </div>
        )}

        {/* 매장 응답 */}
        {reservation.responseNote && (
          <div
            className="text-[12px] leading-relaxed px-3 py-2 rounded-lg mb-3"
            style={{
              background: reservation.status === 'rejected' ? 'rgba(229,62,62,0.06)' : 'rgba(255,31,143,0.06)',
              color: 'var(--text-2)',
              border: `1px solid ${reservation.status === 'rejected' ? 'rgba(229,62,62,0.20)' : 'rgba(255,31,143,0.20)'}`,
            }}
          >
            <span className="font-extrabold mr-1" style={{ color: 'var(--brand)' }}>매장 안내:</span>
            {reservation.responseNote}
          </div>
        )}

        {/* 3행: 인라인 카카오맵 */}
        {!isPastOrEnded && (
          <div className="mb-3">
            <InlineStoreMap
              storeId={reservation.storeId}
              storeName={reservation.storeName ?? '매장'}
              storeLat={storeLat}
              storeLng={storeLng}
              storeAddress={address}
              height={170}
              dimmed={tone.mapDimmed}
            />
          </div>
        )}

        {/* 4행: 주소·전화 텍스트 */}
        {(address || phone) && (
          <div className="text-[11.5px] mb-3 space-y-0.5" style={{ color: 'var(--text-3)' }}>
            {address && <div className="truncate">📍 {address}</div>}
            {phone && <div className="font-mono">📞 {phone}</div>}
          </div>
        )}

        {error && (
          <div
            className="px-3 py-2 rounded-lg text-[11px] font-bold mb-3"
            style={{ background: 'rgba(229,62,62,0.10)', color: 'var(--live)' }}
          >
            {error}
          </div>
        )}

        {/* 5행: 액션 버튼 */}
        <div className="flex gap-1.5 flex-wrap">
          {phone && (
            <ActionButton onClick={() => callPhone(phone)} variant="primary">
              📞 전화
            </ActionButton>
          )}
          {!isPastOrEnded && (
            <ActionButton
              onClick={() => openDirections(reservation.storeName ?? '매장', address)}
              variant="primary"
            >
              🧭 길찾기
            </ActionButton>
          )}
          <ActionButton
            href={`/m/store/${reservation.storeId}`}
            variant="subtle"
          >
            📋 매장 상세
          </ActionButton>
          {canCancel && (
            <ActionButton onClick={handleCancel} disabled={busy} variant="danger">
              {busy ? '취소 중…' : '❌ 예약 취소'}
            </ActionButton>
          )}
          {/* 취소 불가(confirmed 임박) — 사용자가 '취소 버튼 왜 없지' 혼란 방지로
           * disabled 안내 버튼을 노출 + 사유 표시. 방문 1시간 전 부터는 매장 문의 필요. */}
          {!canCancel && !isPastOrEnded && (
            <ActionButton
              onClick={() => alert('방문 1시간 전부터는 직접 취소할 수 없어요.\n매장에 전화로 변경을 요청해 주세요.')}
              variant="disabled"
            >
              ⏰ 취소 불가 · 매장 문의
            </ActionButton>
          )}
          {isPastOrEnded && (
            <ActionButton href={`/m/store/${reservation.storeId}`} variant="primary">
              🔁 재예약
            </ActionButton>
          )}
        </div>

        {/* 취소 불가 안내 문구 — 액션 행 아래 작은 도움말 */}
        {!canCancel && !isPastOrEnded && (
          <div className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
            방문 1시간 전부터는 직접 취소가 불가해요. 변경이 필요하면 위 <b>📞 전화</b> 버튼으로 매장에 알려주세요.
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 공통 UI
 * ─────────────────────────────────────────────────────────────*/

function StatusChip({ status, tone }: { status: ReservationStatus; tone: CardTone }) {
  const dot = status === 'confirmed' ? '✓' : status === 'pending' ? '⌛' : status === 'rejected' ? '✕' : '·';
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] font-extrabold px-2 py-0.5 rounded-full flex-shrink-0"
      style={{
        background: tone.chipBg,
        color: tone.chipColor,
        letterSpacing: '-0.01em',
      }}
    >
      <span aria-hidden>{dot}</span>
      {reservationStatusLabel(status)}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  href,
  disabled,
  variant,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  variant: 'primary' | 'subtle' | 'danger' | 'disabled';
}) {
  const style: React.CSSProperties =
    variant === 'primary'
      ? {
          background: 'linear-gradient(135deg, #FF1F8F 0%, #B91072 100%)',
          color: '#fff',
          boxShadow: '0 1px 4px rgba(255,31,143,0.30)',
        }
      : variant === 'danger'
        ? {
            background: 'rgba(229,62,62,0.08)',
            color: '#B91C1C',
            border: '1px solid rgba(229,62,62,0.25)',
          }
        : variant === 'disabled'
          ? {
              background: 'var(--surface-3)',
              color: 'var(--text-3)',
              border: '1px dashed var(--border)',
              opacity: 0.85,
            }
          : {
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              border: '1px solid var(--border)',
            };
  const cls = 'px-3 py-1.5 rounded-lg text-[12px] font-extrabold transition active:scale-95 disabled:opacity-40 whitespace-nowrap';
  if (href) {
    return (
      <Link href={href} className={cls} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button onClick={onClick} disabled={disabled} className={cls} style={style}>
      {children}
    </button>
  );
}

function dDay(ms: number): string {
  if (!ms) return '';
  const now = Date.now();
  const diff = ms - now;
  if (diff < 0) {
    const passedDays = Math.floor(-diff / (24 * 60 * 60 * 1000));
    return passedDays === 0 ? '오늘' : `${passedDays}일 전`;
  }
  const totalMin = Math.floor(diff / 60_000);
  if (totalMin < 60) return `${totalMin}분 후`;
  const hours = Math.floor(totalMin / 60);
  if (hours < 24) return `${hours}시간 후`;
  const days = Math.floor(hours / 24);
  return `D-${days}`;
}

function fmtDateTime(ms: number): string {
  if (!ms) return '-';
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${mm}/${dd} (${weekday}) ${hh}:${mi}`;
}
