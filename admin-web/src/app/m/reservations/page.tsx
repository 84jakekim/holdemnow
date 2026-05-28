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
import dynamic from 'next/dynamic';
import { useAuth, useStoreDoc } from '@/lib/hooks';
import AnonymousPrompt from '@/components/mobile/AnonymousPrompt';
import {
  cancelReservation,
  isReservationActive,
  reservationStatusLabel,
  reservationCancelLabel,
  requestCancellation,
  subscribeUserReservations,
  MAX_CANCEL_REQUEST_REASON_LEN,
  MAX_CANCEL_REQUEST_NOTE_LEN,
  type Reservation,
  type ReservationStatus,
} from '@/lib/reservations';
import { callPhone, openDirections } from '@/lib/actions';
import { ensureStoreCoords } from '@/lib/storeGeocode';
import NotificationBellButton from '@/components/mobile/NotificationBellButton';

// 지도 — 예약 카드 확장 시에만 로드 (#6 lazy)
const InlineStoreMap = dynamic(() => import('@/components/mobile/reservations/InlineStoreMap'), {
  ssr: false,
  loading: () => (
    <div
      className="w-full rounded-xl flex items-center justify-center text-[12px]"
      style={{ height: 160, background: 'var(--surface-2)', color: 'var(--text-3)' }}
    >
      지도 불러오는 중...
    </div>
  ),
});

type Tab = 'upcoming' | 'past';

// 활성 분류는 isReservationActive(r) 헬퍼로 일원화 — status + 시간 경과(grace 2h) 동시 검증.
// 시간 경과한 pending/confirmed는 자동으로 "지난 예약"으로 분류 (cron 도래 전 클라 안전망).

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
      // 1) status 활성(pending/confirmed) + 2) reservedFor + 2h 이내 = 예정
      // 시간 경과한 pending/confirmed는 cron 도래 전이라도 클라에서 "지난"으로 분류.
      if (isReservationActive(r)) u.push(r);
      else p.push(r);
    }
    u.sort((a, b) => (a.reservedFor?.toMillis?.() ?? 0) - (b.reservedFor?.toMillis?.() ?? 0));
    p.sort((a, b) => (b.reservedFor?.toMillis?.() ?? 0) - (a.reservedFor?.toMillis?.() ?? 0));
    return { upcoming: u, past: p };
  }, [items]);

  const visibleList = tab === 'upcoming' ? upcoming : past;

  if (authState.status === 'loading') {
    return (
      <div className="min-h-screen p-5 space-y-3" style={{ background: 'var(--bg)' }}>
        <div className="skel h-20 rounded-r-xl" />
        <div className="skel h-40 rounded-r-xl" />
      </div>
    );
  }
  if (authState.status === 'anonymous') {
    return <AnonymousPrompt title="내 예약" icon="📅" desc="매장 방문 예약 내역을 보려면 로그인하세요." />;
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* 핑크 hero */}
      <header className="pr-home-hero px-5 pt-5 pb-6">
        <div className="pr-home-hero-content flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase opacity-90">
              MY RESERVATIONS
            </div>
            <h1 className="h2 font-serif mt-1.5">📅 내 예약</h1>
            <p className="text-[13px] font-semibold opacity-90 mt-1.5">
              매장 방문 예약과 상태를 한눈에
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="hero-pink-action px-3 py-1.5 rounded-full text-[11px] font-extrabold mono"
              style={{ color: '#fff' }}
            >
              예정 {upcoming.length} · 지난 {past.length}
            </div>
            <NotificationBellButton variant="hero" ariaLabel="알림" />
          </div>
        </div>
      </header>

      {/* 탭 */}
      <div
        className="sticky z-10 px-4 flex gap-1"
        style={{ top: 0, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
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
  const [requestModalOpen, setRequestModalOpen] = useState(false);

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

  // PM 2026-05-27: pending은 본인 즉시 취소. confirmed는 매장 승인 게이트.
  const canCancelDirect = reservation.status === 'pending';
  const canRequestCancellation =
    reservation.status === 'confirmed' &&
    !reservation.cancelRequested &&
    reservedMs - now > 0; // 이미 지난 예약은 신청 불가

  const isPendingApproval =
    reservation.status === 'confirmed' && reservation.cancelRequested === true;
  const wasDeclined =
    reservation.status === 'confirmed' &&
    !reservation.cancelRequested &&
    !!reservation.cancelRequestDeclinedAt;

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

  const handleRequestSubmit = async (reason: string, note: string) => {
    setBusy(true);
    setError(null);
    try {
      await requestCancellation(reservation.storeId, reservation.id, { reason, note });
      setRequestModalOpen(false);
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
      className="rounded-2xl overflow-hidden lift"
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
          <StatusChip
            status={reservation.status}
            tone={tone}
            cancelledBy={reservation.cancelledBy}
          />
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

        {/* 매장 취소 사유·메모 (cancelledBy='store' 직접 / 'store_approved' 승인) */}
        {reservation.status === 'cancelled' &&
          (reservation.cancelledBy === 'store' || reservation.cancelledBy === 'store_approved') && (
          <div
            className="text-[12px] leading-relaxed px-3 py-2 rounded-lg mb-3 space-y-1"
            style={{
              background:
                reservation.cancelledBy === 'store_approved'
                  ? 'rgba(16,185,129,0.06)'
                  : 'rgba(229,62,62,0.06)',
              color: 'var(--text-2)',
              border:
                reservation.cancelledBy === 'store_approved'
                  ? '1px solid rgba(16,185,129,0.20)'
                  : '1px solid rgba(229,62,62,0.20)',
            }}
          >
            <div
              className="font-extrabold"
              style={{ color: reservation.cancelledBy === 'store_approved' ? '#047857' : '#B91C1C' }}
            >
              {reservation.cancelledBy === 'store_approved'
                ? '✅ 매장이 취소 신청을 승인했습니다'
                : '🚫 매장에서 취소된 예약입니다'}
            </div>
            {(reservation.cancelRequestReason || reservation.cancelReason) && (
              <div>
                <span className="font-bold mr-1">사유:</span>
                {reservation.cancelRequestReason || reservation.cancelReason}
              </div>
            )}
            {reservation.cancelRequestNote && (
              <div>
                <span className="font-bold mr-1">메모:</span>
                {reservation.cancelRequestNote}
              </div>
            )}
            {reservation.cancelMemo && (
              <div>
                <span className="font-bold mr-1">매장 메모:</span>
                {reservation.cancelMemo}
              </div>
            )}
          </div>
        )}

        {/* 매장 승인 대기 중 배지 (confirmed + cancelRequested=true) */}
        {isPendingApproval && (
          <div
            className="text-[12px] leading-relaxed px-3 py-2 rounded-lg mb-3 space-y-1"
            style={{
              background: 'rgba(245,158,11,0.10)',
              color: '#92400E',
              border: '1px solid rgba(245,158,11,0.35)',
            }}
          >
            <div className="font-extrabold flex items-center gap-1">
              <span aria-hidden>⏳</span>
              매장 승인 대기 중
            </div>
            {reservation.cancelRequestReason && (
              <div>
                <span className="font-bold mr-1">신청 사유:</span>
                {reservation.cancelRequestReason}
              </div>
            )}
            {reservation.cancelRequestNote && (
              <div>
                <span className="font-bold mr-1">메모:</span>
                {reservation.cancelRequestNote}
              </div>
            )}
            <div className="text-[11px] mt-1 opacity-80">
              매장이 승인하면 자동으로 취소 완료됩니다. 거절 시 알림을 받으세요.
            </div>
          </div>
        )}

        {/* 거절 안내 (confirmed + cancelRequested=false + 거절 이력 있음) */}
        {wasDeclined && (
          <div
            className="text-[12px] leading-relaxed px-3 py-2 rounded-lg mb-3 space-y-1"
            style={{
              background: 'rgba(229,62,62,0.06)',
              color: 'var(--text-2)',
              border: '1px solid rgba(229,62,62,0.25)',
            }}
          >
            <div className="font-extrabold" style={{ color: '#B91C1C' }}>
              ❌ 매장이 취소 신청을 거절했습니다
            </div>
            {reservation.cancelRequestDeclineReason && (
              <div>
                <span className="font-bold mr-1">거절 사유:</span>
                {reservation.cancelRequestDeclineReason}
              </div>
            )}
            <div className="text-[11px] mt-1 opacity-80">
              필요시 다시 취소 신청하거나 매장에 전화로 문의하세요.
            </div>
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
          {canCancelDirect && (
            <ActionButton onClick={handleCancel} disabled={busy} variant="danger">
              {busy ? '취소 중…' : '❌ 예약 취소'}
            </ActionButton>
          )}
          {canRequestCancellation && (
            <ActionButton
              onClick={() => setRequestModalOpen(true)}
              disabled={busy}
              variant="subtle"
            >
              📝 취소 신청
            </ActionButton>
          )}
          {/* confirmed + 대기 중 → 버튼 없음 (배지로 안내만) */}
          {isPendingApproval && (
            <ActionButton variant="disabled" disabled>
              ⏳ 매장 승인 대기 중
            </ActionButton>
          )}
          {isPastOrEnded && (
            <ActionButton href={`/m/store/${reservation.storeId}`} variant="primary">
              🔁 재예약
            </ActionButton>
          )}
        </div>

        {/* confirmed의 안내 문구 */}
        {reservation.status === 'confirmed' && !isPendingApproval && !wasDeclined && reservedMs - now > 0 && (
          <div className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
            매장이 확정한 예약입니다. 변경이 필요하면 <b>취소 신청</b>을 보내주세요 — 매장 승인 후 취소됩니다.
          </div>
        )}
      </div>

      {requestModalOpen && (
        <CancelRequestModal
          reservation={reservation}
          busy={busy}
          onClose={() => setRequestModalOpen(false)}
          onSubmit={handleRequestSubmit}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 취소 신청 모달 — confirmed 예약 발의
 * ─────────────────────────────────────────────────────────────*/

const CANCEL_REASON_PRESETS = [
  '일정 변경 (방문 어려움)',
  '인원 조정 필요',
  '시간 변경 요청',
  '기타',
];

function CancelRequestModal({
  reservation,
  busy,
  onClose,
  onSubmit,
}: {
  reservation: Reservation;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState<string>(CANCEL_REASON_PRESETS[0]);
  const [note, setNote] = useState('');
  const reservedMs = reservation.reservedFor?.toMillis?.() ?? 0;

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
          📝 예약 취소를 신청할까요?
        </div>
        <div className="text-[12px] mb-3" style={{ color: 'var(--text-2)' }}>
          {reservation.storeName || '매장'} · {fmtDateTime(reservedMs)} · {reservation.partySize}명
        </div>

        <div
          className="mb-3 p-2 rounded text-[11px] leading-relaxed"
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
            color: '#b45309',
          }}
        >
          ⚠️ 매장 승인 후 취소가 완료됩니다. 거절될 경우 알림을 받으세요.
        </div>

        <label className="text-[12px] font-bold block mb-1" style={{ color: 'var(--text-1)' }}>
          취소 사유 <span style={{ color: 'var(--brand)' }}>*</span>
        </label>
        <div className="space-y-1.5 mb-3">
          {CANCEL_REASON_PRESETS.map((p) => {
            const active = reason === p;
            return (
              <button
                key={p}
                onClick={() => setReason(p)}
                className="w-full text-left px-2.5 py-1.5 text-[12px] transition"
                style={{
                  background: active ? 'rgba(255,31,143,0.06)' : 'var(--surface-1)',
                  border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
                  borderRadius: '8px',
                  color: active ? 'var(--brand)' : 'var(--text-1)',
                  fontWeight: active ? 700 : 500,
                }}
              >
                {active ? '● ' : '○ '}
                {p}
              </button>
            );
          })}
        </div>

        <label className="text-[12px] font-bold block mb-1" style={{ color: 'var(--text-1)' }}>
          자유 메모 (선택)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, MAX_CANCEL_REQUEST_NOTE_LEN))}
          placeholder="예) 회사 일정 변경으로 방문이 어려워졌습니다."
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
          {note.length}/{MAX_CANCEL_REQUEST_NOTE_LEN}
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
            닫기
          </button>
          <button
            onClick={() => {
              const r = (reason || '').trim().slice(0, MAX_CANCEL_REQUEST_REASON_LEN);
              if (!r) {
                alert('취소 사유를 선택해주세요.');
                return;
              }
              onSubmit(r, note.trim());
            }}
            disabled={busy}
            className="flex-1 py-2 rounded-lg font-bold text-[13px] text-white disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #FF1F8F 0%, #B91072 100%)',
            }}
          >
            {busy ? '처리 중…' : '취소 신청'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 공통 UI
 * ─────────────────────────────────────────────────────────────*/

function StatusChip({
  status,
  tone,
  cancelledBy,
}: {
  status: ReservationStatus;
  tone: CardTone;
  cancelledBy?: 'user' | 'store' | 'store_approved' | 'platform' | null;
}) {
  const dot = status === 'confirmed' ? '✓' : status === 'pending' ? '⌛' : status === 'rejected' ? '✕' : '·';
  const label =
    status === 'cancelled' ? reservationCancelLabel(cancelledBy) : reservationStatusLabel(status);
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
      {label}
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
  const cls = 'px-3 py-1.5 rounded-lg text-[12px] font-extrabold transition active:scale-95 disabled:opacity-40 whitespace-nowrap tap';
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
