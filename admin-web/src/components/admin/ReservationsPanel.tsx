'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  subscribeStoreReservations,
  respondToReservation,
  cancelReservationByStore,
  approveStoreCancellation,
  declineCancellation,
  markReservationRead,
  reservationStatusLabel,
  reservationCancelLabel,
  MAX_CANCEL_REQUEST_DECLINE_REASON_LEN,
  type Reservation,
  type ReservationStatus,
} from '@/lib/reservations';

/* ============================================================
 * ReservationsPanel — 매장 어드민 예약 관리 패널
 * /admin/[storeId] 의 activeMenu === 'reservations' 일 때 렌더
 * 데이터: stores/{storeId}/reservations (실시간 구독)
 *
 * 2026-05-27 일자별 그룹 + 통계 카드 + sticky 날짜 헤더 + 검색.
 *  - 상단: 통계 4카드 (오늘/이번주/이번달/처리 대기)
 *  - 처리 대기 섹션 (취소 신청 + pending) — 일자 무관 최상단
 *  - 일자별 sticky 헤더 + 카드 stack (그룹 내 시간순)
 *  - 날짜 칩 네비게이션 (오늘/내일/이번주/지난)
 *  - 검색: 이름/전화번호
 * ========================================================== */

interface Props {
  storeId: string;
}

type FilterKey = 'all' | 'pending' | 'confirmed' | 'rejected_cancelled' | 'completed';
type DateRangeKey = 'all' | 'today' | 'tomorrow' | 'this_week' | 'past';

const FILTERS: { id: FilterKey; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'pending', label: '대기' },
  { id: 'confirmed', label: '확정' },
  { id: 'rejected_cancelled', label: '거부·취소' },
  { id: 'completed', label: '완료' },
];

const DATE_RANGES: { id: DateRangeKey; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'today', label: '오늘' },
  { id: 'tomorrow', label: '내일' },
  { id: 'this_week', label: '이번 주' },
  { id: 'past', label: '지난' },
];

// 24시간 임박 기준
const SOON_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 일자별 그룹 key: YYYY-MM-DD (로컬 시간 기준)
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 자정 ms (오늘 0시)
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 이번 주의 시작(월요일 0시) ms
function startOfThisWeek(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=일,1=월,...
  const diff = day === 0 ? -6 : 1 - day; // 월요일까지
  d.setDate(d.getDate() + diff);
  return d.getTime();
}

function isInDateRange(reservedMs: number, range: DateRangeKey): boolean {
  if (range === 'all') return true;
  const t0 = startOfToday();
  if (range === 'today') return reservedMs >= t0 && reservedMs < t0 + DAY_MS;
  if (range === 'tomorrow') return reservedMs >= t0 + DAY_MS && reservedMs < t0 + 2 * DAY_MS;
  if (range === 'this_week') {
    const w0 = startOfThisWeek();
    return reservedMs >= w0 && reservedMs < w0 + 7 * DAY_MS;
  }
  if (range === 'past') return reservedMs < t0;
  return true;
}

// 일자 헤더 라벨 (예: "5/27 화 · 오늘", "5/28 수 · 내일", "6/1 일")
const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];
function formatDayHeader(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const t0 = startOfToday();
  const ms = date.getTime();
  const base = `${m}/${d} ${DOW_KR[date.getDay()]}`;
  if (ms === t0) return `${base} · 오늘`;
  if (ms === t0 + DAY_MS) return `${base} · 내일`;
  if (ms === t0 - DAY_MS) return `${base} · 어제`;
  return base;
}

export default function ReservationsPanel({ storeId }: Props) {
  const [items, setItems] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [dateRange, setDateRange] = useState<DateRangeKey>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [rejectTarget, setRejectTarget] = useState<Reservation | null>(null);
  const [storeCancelTarget, setStoreCancelTarget] = useState<Reservation | null>(null);
  const [declineTarget, setDeclineTarget] = useState<Reservation | null>(null);
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

  // 사용자 취소 신청 카운트 (confirmed + cancelRequested=true)
  const cancelRequestCount = useMemo(
    () =>
      items.filter((r) => r.status === 'confirmed' && r.cancelRequested === true).length,
    [items],
  );

  // ─── 통계 (오늘/이번주/이번달/확정/처리 대기) ────────────────────
  const stats = useMemo(() => {
    const t0 = startOfToday();
    const w0 = startOfThisWeek();
    const m0 = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      return d.getTime();
    })();
    let today = 0, week = 0, month = 0, confirmed = 0;
    for (const r of items) {
      const ms = r.reservedFor?.toMillis?.() ?? 0;
      if (!ms) continue;
      // 활성 상태(pending/confirmed)만 카운트 — 취소/거부/완료 제외
      if (r.status !== 'pending' && r.status !== 'confirmed') continue;
      if (ms >= t0 && ms < t0 + DAY_MS) today += 1;
      if (ms >= w0 && ms < w0 + 7 * DAY_MS) week += 1;
      if (ms >= m0) month += 1;
      if (r.status === 'confirmed') confirmed += 1;
    }
    return { today, week, month, confirmed };
  }, [items]);

  // ─── 필터 적용 (status + dateRange + search) ────────────────────
  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return items.filter((r) => {
      // status filter
      if (filter !== 'all') {
        if (filter === 'rejected_cancelled') {
          if (r.status !== 'rejected' && r.status !== 'cancelled') return false;
        } else if (r.status !== filter) {
          return false;
        }
      }
      // date range filter
      const ms = r.reservedFor?.toMillis?.() ?? 0;
      if (!isInDateRange(ms, dateRange)) return false;
      // search filter
      if (term) {
        const name = (r.authorName || '').toLowerCase();
        const phone = (r.authorPhone || '').replace(/[^0-9]/g, '');
        const termDigits = term.replace(/[^0-9]/g, '');
        const nameHit = name.includes(term);
        const phoneHit = termDigits.length > 0 && phone.includes(termDigits);
        if (!nameHit && !phoneHit) return false;
      }
      return true;
    });
  }, [items, filter, dateRange, searchTerm]);

  // ─── "처리 대기" 우선 섹션 + 일자별 그룹 ─────────────────────────
  // 처리 대기 = pending + cancelRequested(confirmed+cancelRequested=true)
  // — 일자 무관. 매장 사장의 즉시 액션 영역.
  const urgentItems = useMemo(() => {
    return filtered.filter(
      (r) =>
        r.status === 'pending' ||
        (r.status === 'confirmed' && r.cancelRequested === true),
    );
  }, [filtered]);

  const restItems = useMemo(() => {
    return filtered.filter(
      (r) =>
        !(
          r.status === 'pending' ||
          (r.status === 'confirmed' && r.cancelRequested === true)
        ),
    );
  }, [filtered]);

  // 일자별 그룹화. 오늘·미래는 ASC(가까운 일자 먼저), 과거는 DESC(최근 먼저).
  const dayGroups = useMemo(() => {
    const t0 = startOfToday();
    const map = new Map<string, Reservation[]>();
    for (const r of restItems) {
      const ms = r.reservedFor?.toMillis?.() ?? 0;
      const k = ms ? dayKey(ms) : 'unknown';
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    // 그룹 내 시간순 ASC
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const aa = a.reservedFor?.toMillis?.() ?? 0;
        const bb = b.reservedFor?.toMillis?.() ?? 0;
        return aa - bb;
      });
    }
    // 그룹 키 정렬: 오늘·미래 ASC → 과거 DESC
    const keys = Array.from(map.keys()).filter((k) => k !== 'unknown');
    const future = keys
      .filter((k) => {
        const [y, m, d] = k.split('-').map(Number);
        return new Date(y, m - 1, d).getTime() >= t0;
      })
      .sort();
    const past = keys
      .filter((k) => {
        const [y, m, d] = k.split('-').map(Number);
        return new Date(y, m - 1, d).getTime() < t0;
      })
      .sort()
      .reverse();
    const ordered: { key: string; items: Reservation[] }[] = [];
    for (const k of [...future, ...past]) {
      ordered.push({ key: k, items: map.get(k)! });
    }
    if (map.has('unknown')) {
      ordered.push({ key: 'unknown', items: map.get('unknown')! });
    }
    return ordered;
  }, [restItems]);

  const totalVisible = urgentItems.length + restItems.length;

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

  async function handleStoreCancel(r: Reservation, reason: string, memo: string) {
    if (busyId) return;
    setBusyId(r.id);
    try {
      await cancelReservationByStore(storeId, r.id, { reason, memo });
      setStoreCancelTarget(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`취소 실패: ${msg}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveCancellation(r: Reservation) {
    if (busyId) return;
    if (!confirm('사용자의 취소 신청을 승인할까요?\n예약이 취소되고 사용자에게 알림이 발송됩니다.')) return;
    setBusyId(r.id);
    try {
      await approveStoreCancellation(storeId, r.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`승인 실패: ${msg}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeclineCancellation(r: Reservation, declineReason: string) {
    if (busyId) return;
    setBusyId(r.id);
    try {
      await declineCancellation(storeId, r.id, declineReason);
      setDeclineTarget(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`거절 실패: ${msg}`);
    } finally {
      setBusyId(null);
    }
  }

  const urgentCount = urgentItems.length;

  return (
    <div>
      {/* 헤더 */}
      <div className="mb-5">
        <div className="section-title" style={{ color: 'var(--brand)' }}>RESERVATIONS</div>
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>
          📅 예약 관리
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
          일자별로 정리된 예약을 확인하고 승인·거부하세요. 90일 이상 지난 종료 예약은 자동 삭제됩니다.
        </p>
      </div>

      {/* 통계 카드 4종 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
        <StatCard label="오늘 예약" value={stats.today} accent="#FF1F8F" />
        <StatCard label="이번 주" value={stats.week} accent="#16a34a" />
        <StatCard label="이번 달" value={stats.month} accent="#3b82f6" />
        <StatCard
          label="처리 대기"
          value={pendingCount + cancelRequestCount}
          accent="#F59E0B"
          emphasize={pendingCount + cancelRequestCount > 0}
        />
      </div>

      {/* 사용자 취소 신청 알림 띠 */}
      {cancelRequestCount > 0 && (
        <div
          className="mb-3 px-3 py-2.5 flex items-center gap-2 text-[13px] font-bold"
          style={{
            background: 'rgba(245,158,11,0.10)',
            border: '1px solid rgba(245,158,11,0.35)',
            color: '#b45309',
            borderRadius: 'var(--r-lg)',
          }}
        >
          <span aria-hidden>🔔</span>
          사용자 취소 신청 {cancelRequestCount}건 대기 중 — 아래 처리 대기 섹션에서 승인/거절을 선택하세요.
        </div>
      )}

      {/* 검색 + 날짜 범위 칩 */}
      <div className="flex flex-col md:flex-row gap-2.5 mb-3">
        <div className="relative flex-1 min-w-0">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="이름 또는 전화번호로 검색…"
            className="w-full pl-9 pr-3 py-2 text-[13px]"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              color: 'var(--text-1)',
              outline: 'none',
            }}
          />
          <span
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px]"
            style={{ color: 'var(--text-3)' }}
          >
            🔍
          </span>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] px-1.5 py-0.5"
              style={{ color: 'var(--text-3)' }}
              aria-label="검색어 지우기"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DATE_RANGES.map((d) => {
            const isActive = dateRange === d.id;
            return (
              <button
                key={d.id}
                onClick={() => setDateRange(d.id)}
                className="px-3 py-1.5 rounded-full text-[11.5px] font-bold transition"
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
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 상태 필터 칩 */}
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

      {/* 본문 — 일자별 그룹 */}
      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text-2)' }}>로딩 중…</div>
      ) : totalVisible === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-5">
          {/* 처리 대기 섹션 (일자 무관 최상단) */}
          {urgentCount > 0 && (
            <section>
              <div
                className="sticky top-0 z-10 -mx-1 px-1 py-2 mb-2 flex items-center gap-2"
                style={{
                  background:
                    'linear-gradient(to bottom, var(--bg, #fafafa) 75%, rgba(250,250,250,0))',
                }}
              >
                <span
                  className="text-[10.5px] font-extrabold tracking-wider px-2 py-0.5 rounded-full"
                  style={{ background: '#F59E0B', color: '#fff' }}
                >
                  🔔 처리 대기 {urgentCount}
                </span>
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  취소 신청 + 새 예약 — 즉시 응답하세요
                </span>
              </div>
              <div className="space-y-3">
                {urgentItems.map((r) => (
                  <ReservationCard
                    key={r.id}
                    reservation={r}
                    storeId={storeId}
                    busy={busyId === r.id}
                    onApprove={() => handleApprove(r)}
                    onRejectOpen={() => setRejectTarget(r)}
                    onStoreCancelOpen={() => setStoreCancelTarget(r)}
                    onApproveCancellation={() => handleApproveCancellation(r)}
                    onDeclineCancellationOpen={() => setDeclineTarget(r)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 일자별 그룹 */}
          {dayGroups.map((g) => (
            <section key={g.key}>
              <div
                className="sticky top-0 z-10 -mx-1 px-1 py-2 mb-2 flex items-center gap-2"
                style={{
                  background:
                    'linear-gradient(to bottom, var(--bg, #fafafa) 75%, rgba(250,250,250,0))',
                }}
              >
                <span
                  className="text-[12.5px] font-extrabold"
                  style={{ color: 'var(--text-1)' }}
                >
                  {g.key === 'unknown' ? '날짜 미정' : formatDayHeader(g.key)}
                </span>
                <span
                  className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                  }}
                >
                  {g.items.length}건
                </span>
              </div>
              <div className="space-y-3">
                {g.items.map((r) => (
                  <ReservationCard
                    key={r.id}
                    reservation={r}
                    storeId={storeId}
                    busy={busyId === r.id}
                    onApprove={() => handleApprove(r)}
                    onRejectOpen={() => setRejectTarget(r)}
                    onStoreCancelOpen={() => setStoreCancelTarget(r)}
                    onApproveCancellation={() => handleApproveCancellation(r)}
                    onDeclineCancellationOpen={() => setDeclineTarget(r)}
                  />
                ))}
              </div>
            </section>
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

      {/* 매장 취소 모달 (확정된 예약을 매장이 취소) */}
      {storeCancelTarget && (
        <StoreCancelModal
          reservation={storeCancelTarget}
          busy={busyId === storeCancelTarget.id}
          onClose={() => setStoreCancelTarget(null)}
          onConfirm={(reason, memo) => handleStoreCancel(storeCancelTarget, reason, memo)}
        />
      )}

      {/* 사용자 취소 신청 거절 모달 */}
      {declineTarget && (
        <DeclineCancellationModal
          reservation={declineTarget}
          busy={busyId === declineTarget.id}
          onClose={() => setDeclineTarget(null)}
          onConfirm={(reason) => handleDeclineCancellation(declineTarget, reason)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 통계 카드
// ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
  emphasize = false,
}: {
  label: string;
  value: number;
  accent: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className="px-3 py-2.5 lift"
      style={{
        background: emphasize
          ? `linear-gradient(135deg, ${accent}14, var(--surface-1))`
          : 'var(--surface-1)',
        borderTop: `1px solid ${emphasize ? `${accent}55` : 'var(--border)'}`,
        borderRight: `1px solid ${emphasize ? `${accent}55` : 'var(--border)'}`,
        borderBottom: `1px solid ${emphasize ? `${accent}55` : 'var(--border)'}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        className="text-[10.5px] font-bold tracking-wider mb-0.5"
        style={{ color: 'var(--text-3)' }}
      >
        {label}
      </div>
      <div
        className="text-[22px] font-extrabold leading-none"
        style={{ color: emphasize ? accent : 'var(--text-1)' }}
      >
        {value}
      </div>
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
  onStoreCancelOpen: () => void;
  onApproveCancellation: () => void;
  onDeclineCancellationOpen: () => void;
}

function ReservationCard({
  reservation: r,
  storeId,
  busy,
  onApprove,
  onRejectOpen,
  onStoreCancelOpen,
  onApproveCancellation,
  onDeclineCancellationOpen,
}: CardProps) {
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
  const hasCancelRequest = r.status === 'confirmed' && r.cancelRequested === true;
  // unread: 신규 pending OR 신규 cancel 신청
  const isUnread = !r.readByStore && (r.status === 'pending' || hasCancelRequest);

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
      className="p-4 lift"
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        background: hasCancelRequest ? 'rgba(245,158,11,0.05)' : tone.bg,
        border: hasCancelRequest
          ? '1px solid rgba(245,158,11,0.40)'
          : `1px solid ${tone.border}`,
        borderLeft: hasCancelRequest
          ? '4px solid #F59E0B'
          : isUnread
            ? '4px solid #F59E0B'
            : `4px solid ${tone.leftBar}`,
        borderRadius: 'var(--r-lg)',
        cursor: 'default',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* 상단 — 상태 + 시간 임박 배지 */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className="text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: tone.chipBg, color: tone.chipFg }}
        >
          {r.status === 'cancelled'
            ? reservationCancelLabel(r.cancelledBy)
            : reservationStatusLabel(r.status)}
        </span>
        {hasCancelRequest && (
          <span
            className="text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: '#F59E0B', color: '#fff' }}
          >
            🔔 사용자 취소 신청
          </span>
        )}
        {isUnread && !hasCancelRequest && (
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

      {/* 사용자 취소 신청 사유/메모 — confirmed + cancelRequested=true */}
      {hasCancelRequest && (
        <div
          className="px-2.5 py-2 text-[12px] mb-2 space-y-1"
          style={{
            background: 'rgba(245,158,11,0.10)',
            border: '1px solid rgba(245,158,11,0.30)',
            borderRadius: '8px',
            color: '#92400E',
          }}
        >
          {r.cancelRequestReason && (
            <div>
              <span className="font-bold mr-1">신청 사유:</span>
              {r.cancelRequestReason}
            </div>
          )}
          {r.cancelRequestNote && (
            <div>
              <span className="font-bold mr-1">메모:</span>
              {r.cancelRequestNote}
            </div>
          )}
          {r.cancelRequestedAt && (
            <div className="text-[10.5px] opacity-75">
              신청 {formatRelative(r.cancelRequestedAt.toMillis?.() ?? 0)}
            </div>
          )}
        </div>
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

      {/* 매장 취소 사유·메모 (cancelled + cancelledBy='store' 또는 'store_approved') */}
      {r.status === 'cancelled' && (r.cancelledBy === 'store' || r.cancelledBy === 'store_approved') && (
        <div
          className="px-2.5 py-1.5 text-[12px] mb-2 space-y-1"
          style={{
            background:
              r.cancelledBy === 'store_approved'
                ? 'rgba(16,185,129,0.06)'
                : 'rgba(107,114,128,0.06)',
            border:
              r.cancelledBy === 'store_approved'
                ? '1px solid rgba(16,185,129,0.20)'
                : '1px solid rgba(107,114,128,0.20)',
            borderRadius: '8px',
            color: 'var(--text-2)',
          }}
        >
          {r.cancelledBy === 'store_approved' && (
            <div className="font-bold" style={{ color: '#047857' }}>
              ✅ 사용자 신청을 매장이 승인
            </div>
          )}
          {(r.cancelRequestReason || r.cancelReason) && (
            <div>
              <span
                className="font-bold mr-1"
                style={{ color: r.cancelledBy === 'store_approved' ? '#047857' : '#6b7280' }}
              >
                사유:
              </span>
              {r.cancelRequestReason || r.cancelReason}
            </div>
          )}
          {r.cancelRequestNote && (
            <div>
              <span
                className="font-bold mr-1"
                style={{ color: r.cancelledBy === 'store_approved' ? '#047857' : '#6b7280' }}
              >
                사용자 메모:
              </span>
              {r.cancelRequestNote}
            </div>
          )}
          {r.cancelMemo && (
            <div>
              <span className="font-bold mr-1" style={{ color: '#6b7280' }}>
                매장 메모:
              </span>
              {r.cancelMemo}
            </div>
          )}
        </div>
      )}

      {/* 액션 — pending: 승인/거부 */}
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

      {/* 액션 — confirmed + cancelRequested=true: 승인 / 거절 */}
      {r.status === 'confirmed' && hasCancelRequest && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={onApproveCancellation}
            disabled={busy}
            className="flex-1 py-2 rounded-lg font-bold text-[13px] text-white transition disabled:opacity-50"
            style={{ background: '#dc2626' }}
            title="사용자 취소 신청을 승인합니다 (예약 취소 완료)"
          >
            ✅ 승인 (취소 완료)
          </button>
          <button
            onClick={onDeclineCancellationOpen}
            disabled={busy}
            className="flex-1 py-2 rounded-lg font-bold text-[13px] transition disabled:opacity-50"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
            title="사용자 취소 신청을 거절합니다 (예약 유지)"
          >
            ❌ 거절
          </button>
        </div>
      )}

      {/* 액션 — confirmed + cancelRequested=false: 매장 직접 취소 (전화 케이스) */}
      {r.status === 'confirmed' && !hasCancelRequest && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={onStoreCancelOpen}
            disabled={busy}
            className="flex-1 py-2 rounded-lg font-bold text-[13px] transition disabled:opacity-50"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid rgba(229,62,62,0.40)',
              color: '#dc2626',
            }}
            title="사용자 변심 / 매장 사정 등으로 확정된 예약을 취소합니다 (전화 통보 대응)"
          >
            🚫 매장 취소
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
// 매장 취소 사유 모달 (confirmed → cancelled)
// ─────────────────────────────────────────────────────────────

const CANCEL_REASON_PRESETS = [
  '사용자 변심 (전화 통보)',
  '매장 사정 (영업 변경·휴무)',
  '시간 조정 요청',
  '기타',
];

function StoreCancelModal({
  reservation: r,
  busy,
  onClose,
  onConfirm,
}: {
  reservation: Reservation;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string, memo: string) => void;
}) {
  const [reason, setReason] = useState<string>(CANCEL_REASON_PRESETS[0]);
  const [memo, setMemo] = useState('');
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
          🚫 확정 예약을 취소할까요?
        </div>
        <div className="text-[12px] mb-3" style={{ color: 'var(--text-2)' }}>
          {r.authorName || '익명'} · {formatWhen(reservedMs)} · {r.partySize}명
        </div>

        <label className="text-[12px] font-bold block mb-1" style={{ color: 'var(--text-1)' }}>
          취소 사유 (선택)
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
                  background: active ? 'rgba(229,62,62,0.08)' : 'var(--surface-1)',
                  border: `1px solid ${active ? 'rgba(229,62,62,0.40)' : 'var(--border)'}`,
                  borderRadius: '8px',
                  color: active ? '#dc2626' : 'var(--text-1)',
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
          매장 메모 (선택)
        </label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value.slice(0, 200))}
          placeholder="예) 사용자가 전화로 일정 변경 요청. 다음 주말 재예약 안내."
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
          {memo.length}/200
        </div>

        <div
          className="mt-3 p-2 rounded text-[11px] leading-relaxed"
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
            color: '#b45309',
          }}
        >
          ⚠️ 취소 시 사용자에게 푸시 알림이 자동 발송되며, 해당 사용자의 다른 매장 예약 잠금이 해제됩니다.
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
            onClick={() => onConfirm(reason.trim(), memo.trim())}
            disabled={busy}
            className="flex-1 py-2 rounded-lg font-bold text-[13px] text-white disabled:opacity-50"
            style={{ background: '#dc2626' }}
          >
            {busy ? '처리 중…' : '🚫 매장 취소'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 사용자 취소 신청 거절 모달
// ─────────────────────────────────────────────────────────────

const DECLINE_REASON_PRESETS = [
  '예약 시간이 임박해 취소 어려움',
  '대기 인원이 있어 유지 필요',
  '매장 사정상 취소 어려움',
  '기타 (직접 입력)',
];

function DeclineCancellationModal({
  reservation: r,
  busy,
  onClose,
  onConfirm,
}: {
  reservation: Reservation;
  busy: boolean;
  onClose: () => void;
  onConfirm: (declineReason: string) => void;
}) {
  const [presetIdx, setPresetIdx] = useState(0);
  const [custom, setCustom] = useState('');
  const reservedMs = r.reservedFor?.toMillis?.() ?? 0;
  const isCustom = presetIdx === DECLINE_REASON_PRESETS.length - 1;
  const effectiveReason = isCustom ? custom.trim() : DECLINE_REASON_PRESETS[presetIdx];

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
          ❌ 취소 신청을 거절할까요?
        </div>
        <div className="text-[12px] mb-3" style={{ color: 'var(--text-2)' }}>
          {r.authorName || '익명'} · {formatWhen(reservedMs)} · {r.partySize}명
        </div>

        <div
          className="mb-3 p-2 rounded text-[11px] leading-relaxed"
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
            color: '#b45309',
          }}
        >
          ⚠️ 거절하면 예약은 그대로 유지되고, 사용자에게 거절 사유가 푸시로 발송됩니다.
        </div>

        <label className="text-[12px] font-bold block mb-1" style={{ color: 'var(--text-1)' }}>
          거절 사유 (선택)
        </label>
        <div className="space-y-1.5 mb-2">
          {DECLINE_REASON_PRESETS.map((p, i) => {
            const active = presetIdx === i;
            return (
              <button
                key={p}
                onClick={() => setPresetIdx(i)}
                className="w-full text-left px-2.5 py-1.5 text-[12px] transition"
                style={{
                  background: active ? 'rgba(229,62,62,0.06)' : 'var(--surface-1)',
                  border: `1px solid ${active ? 'rgba(229,62,62,0.40)' : 'var(--border)'}`,
                  borderRadius: '8px',
                  color: active ? '#dc2626' : 'var(--text-1)',
                  fontWeight: active ? 700 : 500,
                }}
              >
                {active ? '● ' : '○ '}
                {p}
              </button>
            );
          })}
        </div>
        {isCustom && (
          <>
            <textarea
              value={custom}
              onChange={(e) => setCustom(e.target.value.slice(0, MAX_CANCEL_REQUEST_DECLINE_REASON_LEN))}
              placeholder="거절 사유를 입력하세요"
              rows={3}
              className="w-full text-[13px] p-2.5 resize-none mt-2"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text-1)',
                outline: 'none',
              }}
            />
            <div className="text-[10px] text-right mt-0.5" style={{ color: 'var(--text-3)' }}>
              {custom.length}/{MAX_CANCEL_REQUEST_DECLINE_REASON_LEN}
            </div>
          </>
        )}

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
              if (isCustom && !custom.trim()) {
                alert('거절 사유를 입력해주세요.');
                return;
              }
              onConfirm(effectiveReason);
            }}
            disabled={busy}
            className="flex-1 py-2 rounded-lg font-bold text-[13px] text-white disabled:opacity-50"
            style={{ background: '#dc2626' }}
          >
            {busy ? '처리 중…' : '❌ 거절'}
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
