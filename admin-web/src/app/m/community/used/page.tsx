'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type UsedListing,
  type UsedCategory,
  USED_CATEGORY_LABELS,
  DEAL_STATUS_LABELS,
  formatUsedPrice,
  formatRelativeTime,
  subscribeActiveUsedListings,
} from '@/lib/community';

/* ============================================================
 * /m/community/used — 중고거래 리스트
 * 권한: 열람 = 누구나, 등록 = 매장 owner (/admin/[storeId])
 * 필터: 카테고리 + 지역 2축
 * 2열 그리드 (이미지 우선)
 * ========================================================== */

type CategoryFilter = 'all' | UsedCategory;

const CATEGORY_FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  ...Object.entries(USED_CATEGORY_LABELS).map(([k, v]) => ({ key: k as UsedCategory, label: v })),
];

const REGIONS = ['전체', '부산', '경남'];

/** 만료일까지 남은 일수 */
function daysLeft(expiresAt?: string | Date): number {
  if (!expiresAt) return 0;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

/** 거래 상태 배지 색상 */
function dealStatusStyle(status: UsedListing['dealStatus']): { bg: string; color: string } {
  if (status === 'sold') return { bg: '#F3F4F6', color: '#9CA3AF' };
  if (status === 'reserved') return { bg: 'rgba(251,191,36,0.15)', color: '#B45309' };
  return { bg: 'rgba(255,31,143,0.10)', color: '#FF1F8F' };
}

export default function UsedListPage() {
  const router = useRouter();
  const [items, setItems] = useState<UsedListing[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [regionFilter, setRegionFilter] = useState('전체');

  useEffect(() => {
    const unsub = subscribeActiveUsedListings(
      {},
      (data) => { setItems(data); setLoaded(true); },
      () => setLoaded(true),
    );
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    let list = items;
    if (categoryFilter !== 'all') list = list.filter((i) => i.category === categoryFilter);
    if (regionFilter !== '전체') list = list.filter((i) => i.region?.includes(regionFilter));
    return list;
  }, [items, categoryFilter, regionFilter]);

  return (
    <div style={{ background: 'var(--bg-sub)', minHeight: '100vh' }}>
      {/* ── 헤더 ── */}
      <header
        className="sticky top-0 z-30 flex items-center h-14 px-4 gap-3"
        style={{
          background: 'rgba(255,255,255,0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          className="w-9 h-9 flex items-center justify-center rounded-full transition active:bg-[var(--surface-2)] flex-shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <h1 className="flex-1 text-center text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          🛒 중고거래
        </h1>
        <div className="w-9 h-9 flex-shrink-0" aria-hidden="true" />
      </header>

      {/* ── 필터바 ── */}
      <div
        className="sticky z-20 bg-white px-4 pt-3 pb-2 flex flex-col gap-2"
        style={{ top: 56, borderBottom: '1px solid var(--border)' }}
      >
        {/* 카테고리 칩 */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none" role="group" aria-label="카테고리 필터">
          {CATEGORY_FILTERS.map((f) => {
            const active = categoryFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setCategoryFilter(f.key)}
                aria-pressed={active}
                className="flex-shrink-0 px-3 h-8 rounded-full text-[12px] font-bold transition active:scale-95"
                style={{
                  background: active ? '#FF1F8F' : 'var(--surface-2)',
                  color: active ? '#fff' : 'var(--text-2)',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* 지역 */}
        <div className="flex gap-1.5" role="group" aria-label="지역 필터">
          {REGIONS.map((r) => {
            const active = regionFilter === r;
            return (
              <button
                key={r}
                onClick={() => setRegionFilter(r)}
                aria-pressed={active}
                className="flex-shrink-0 px-3 h-7 rounded-full text-[11px] font-semibold transition active:scale-95"
                style={{
                  background: active ? 'rgba(255,31,143,0.10)' : 'var(--surface-2)',
                  color: active ? '#FF1F8F' : 'var(--text-3)',
                  border: active ? '1px solid rgba(255,31,143,0.25)' : '1px solid transparent',
                }}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 안내 배너 ── */}
      <div
        className="mx-4 mt-3 px-3 py-2.5 rounded-xl text-[11px] leading-relaxed"
        style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
        role="note"
      >
        매장 비품 직거래 공간입니다. 등록은 매장 어드민에서 가능합니다.
      </div>

      {/* ── 2열 그리드 ── */}
      <div className="pb-24 pt-2">
        {!loaded ? (
          <div className="py-12 text-center text-[12px]" style={{ color: 'var(--text-3)' }}>
            불러오는 중…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyUsedState />
        ) : (
          <div className="grid grid-cols-2 gap-3 px-4 pt-2">
            {filtered.map((item) => (
              <UsedGridCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 중고 그리드 카드 (2열) ── */
function UsedGridCard({ item }: { item: UsedListing }) {
  const isExpired = daysLeft(item.expiresAt) === 0;
  const isSold = item.dealStatus === 'sold';
  const dimmed = isExpired || isSold;
  const statusStyle = dealStatusStyle(item.dealStatus);
  const firstImage = item.images?.[0];

  return (
    <Link
      href={`/m/community/used/${item.id}`}
      className="block rounded-2xl overflow-hidden transition active:scale-[0.98]"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        opacity: dimmed ? 0.6 : 1,
      }}
    >
      {/* 이미지 영역 */}
      <div
        className="w-full aspect-square relative overflow-hidden"
        style={{ background: 'var(--surface-2)' }}
      >
        {firstImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={firstImage} alt={item.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl" aria-hidden="true">
            {item.category === 'chip' ? '🪙' : item.category === 'card' ? '🃏' : item.category === 'timer' ? '⏱' : item.category === 'table' ? '🎰' : item.category === 'tray' ? '🗂' : '📦'}
          </div>
        )}

        {/* 상태 배지 */}
        <div className="absolute top-2 left-2">
          <span
            className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full"
            style={statusStyle}
          >
            {isExpired ? '기간만료' : DEAL_STATUS_LABELS[item.dealStatus]}
          </span>
        </div>

        {/* 이미지 수 */}
        {(item.images?.length ?? 0) > 1 && (
          <div
            className="absolute bottom-2 right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(0,0,0,0.50)' }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="white" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="white" strokeWidth="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21" stroke="white" strokeWidth="2" fill="none"/>
            </svg>
            <span className="text-white text-[9px] font-bold">{item.images!.length}</span>
          </div>
        )}

        {/* 만료/판매완료 오버레이 */}
        {dimmed && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.30)' }}>
            <span className="text-white text-[11px] font-extrabold px-2 py-1 rounded-full" style={{ background: 'rgba(0,0,0,0.50)' }}>
              {isSold ? '판매완료' : '기간만료'}
            </span>
          </div>
        )}
      </div>

      {/* 정보 */}
      <div className="p-2.5">
        <div
          className="text-[10px] font-bold mb-0.5 px-1.5 py-0.5 rounded-full inline-block"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
        >
          {USED_CATEGORY_LABELS[item.category]}
        </div>
        <p className="text-[13px] font-bold leading-tight line-clamp-2 mt-0.5" style={{ color: 'var(--text-1)' }}>
          {item.title}
        </p>
        <p className="text-[13px] font-extrabold mt-1" style={{ color: dimmed ? 'var(--text-3)' : '#FF1F8F' }}>
          {formatUsedPrice(item.price, item.priceNegotiable)}
        </p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{item.region ?? ''}</span>
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{formatRelativeTime(item.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}

/* ── 빈 상태 ── */
function EmptyUsedState() {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div className="text-5xl mb-4" aria-hidden="true">🛒</div>
      <p className="text-[16px] font-bold mb-2" style={{ color: 'var(--text-1)' }}>
        아직 등록된 매물이 없습니다
      </p>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
        매장 어드민에서 비품을 등록할 수 있어요
      </p>
    </div>
  );
}
