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
import EmptyState from '@/components/ui/EmptyState';

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
      {/* ── 앰버 hero ── */}
      <header
        className="px-5 pt-5 pb-6 text-white relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #B45309 0%, #F59E0B 55%, #FCD34D 100%)',
        }}
      >
        <div
          aria-hidden
          className="absolute top-[-40px] right-[-40px] w-[220px] h-[220px] rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 65%)',
          }}
        />
        <div className="relative z-10 flex items-start justify-between gap-3">
          <button
            onClick={() => router.back()}
            aria-label="뒤로"
            className="hero-pink-action w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 tap"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase opacity-90">
              USED MARKET
            </div>
            <h1 className="h2 font-serif mt-1.5">🛒 중고거래</h1>
            <p className="text-[13px] font-semibold opacity-90 mt-1.5">
              매장 비품 직거래 (칩·카드·타이머)
            </p>
          </div>
          <div className="w-9 h-9 flex-shrink-0" aria-hidden="true" />
        </div>
      </header>

      {/* ── 필터바 ── */}
      <div className="bg-white px-4 pt-3 pb-2 flex flex-col gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="카테고리 필터">
          {CATEGORY_FILTERS.map((f) => {
            const active = categoryFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setCategoryFilter(f.key)}
                aria-pressed={active}
                className={`tap ${active ? 'pr-pill-brand' : 'pr-pill'}`}
                style={
                  active
                    ? { background: 'var(--gold)', borderColor: 'var(--gold)', boxShadow: '0 2px 12px rgba(245,158,11,0.25)' }
                    : undefined
                }
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="flex gap-1.5" role="group" aria-label="지역 필터">
          {REGIONS.map((r) => {
            const active = regionFilter === r;
            return (
              <button
                key={r}
                onClick={() => setRegionFilter(r)}
                aria-pressed={active}
                className={`tap ${active ? 'pr-pill-brand' : 'pr-pill'}`}
                style={
                  active
                    ? { background: 'var(--gold)', borderColor: 'var(--gold)', boxShadow: '0 2px 12px rgba(245,158,11,0.25)' }
                    : undefined
                }
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 안내 배너 ── */}
      <div
        className="mx-4 mt-3 px-3 py-2.5 rounded-r-md text-[11px] leading-relaxed"
        style={{ background: 'rgba(245,158,11,0.08)', color: 'var(--text-2)', border: '1px solid rgba(245,158,11,0.18)' }}
        role="note"
      >
        💡 매장 비품 직거래 공간입니다. 등록은 매장 어드민에서 가능합니다.
      </div>

      {/* ── 2열 그리드 ── */}
      <div className="pb-24 pt-2">
        {!loaded ? (
          <div className="grid grid-cols-2 gap-3 px-4 pt-2">
            {[0,1,2,3].map((i) => <div key={i} className="skel aspect-square rounded-r-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 pt-6">
            <EmptyState
              icon="🛒"
              title="아직 등록된 매물이 없어요"
              desc="매장 어드민에서 비품을 등록할 수 있어요."
            />
          </div>
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
      className="block rounded-2xl overflow-hidden transition active:scale-[0.98] lift tap"
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

