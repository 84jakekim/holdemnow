'use client';

/**
 * /m/community/dealers — 공개 딜러 리스트 (2026-05-26 절충 정책)
 *
 * 정책 (memory: project_dealer_profile_v03 절충안):
 *   - 매장 owner 전용 v0.3 → 본인이 publicProfile=true 토글 켠 딜러만 사용자에게 노출
 *   - 매장 owner는 어드민에서 전체(공개·비공개) 접근 가능 (subscribeAllDealerProfiles 유지)
 *   - 사용자 페이지는 publicProfile=true인 딜러만 보이며 v1.0 유료 매칭 시장에 미영향
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  type DealerProfile,
  type AvailableShift,
  DEALER_ABILITY_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  AVAILABLE_SHIFT_LABELS,
  subscribePublicDealerProfiles,
} from '@/lib/community';
import EmptyState from '@/components/ui/EmptyState';

const SHIFT_FILTERS: { key: AvailableShift | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'weekday', label: '평일' },
  { key: 'weekend', label: '주말' },
  { key: 'negotiable', label: '협의' },
];

export default function DealersPublicListPage() {
  const router = useRouter();
  const [items, setItems] = useState<DealerProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [shiftFilter, setShiftFilter] = useState<AvailableShift | 'all'>('all');

  useEffect(() => {
    const filter: { availableShift?: AvailableShift } = {};
    if (shiftFilter !== 'all') filter.availableShift = shiftFilter;
    const unsub = subscribePublicDealerProfiles(
      filter,
      (data) => { setItems(data); setLoaded(true); },
      () => setLoaded(true),
    );
    return unsub;
  }, [shiftFilter]);

  return (
    <div style={{ background: 'var(--bg-sub)', minHeight: '100vh' }}>
      <header
        className="px-5 pt-5 pb-6 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BB5 100%)' }}
      >
        <div
          aria-hidden
          className="absolute top-[-40px] right-[-40px] w-[220px] h-[220px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 65%)' }}
        />
        <div className="relative z-10 flex items-start justify-between gap-3">
          <button
            onClick={() => router.back()}
            aria-label="뒤로"
            className="hero-pink-action w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 tap"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase opacity-90">PUBLIC DEALERS</div>
            <h1 className="h2 font-serif mt-1.5">🃏 공개 딜러</h1>
            <p className="text-[13px] font-semibold opacity-90 mt-1.5">
              본인이 공개를 켠 딜러만 표시됩니다
            </p>
          </div>
          <div className="w-9 h-9 flex-shrink-0" aria-hidden />
        </div>
      </header>

      {/* 가용시간 필터 */}
      <div className="bg-white px-4 pt-3 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar" style={{ borderBottom: '1px solid var(--border)' }}>
        {SHIFT_FILTERS.map((f) => {
          const active = shiftFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setShiftFilter(f.key)}
              className={`tap ${active ? 'pr-pill-brand' : 'pr-pill'}`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* 안내 */}
      <div
        className="mx-4 mt-3 px-3 py-2.5 rounded-r-md text-[11px] leading-relaxed"
        style={{ background: 'rgba(255,31,143,0.06)', color: 'var(--text-2)', border: '1px solid rgba(255,31,143,0.15)' }}
      >
        💡 본인이 직접 공개 토글을 켠 딜러만 노출됩니다.
        딜러 프로필 등록은 <Link href="/m/community/dealers/me" className="underline font-bold" style={{ color: '#FF1F8F' }}>여기서</Link>.
      </div>

      <div className="px-4 pt-3 pb-24 space-y-2">
        {!loaded ? (
          <>
            <div className="skel h-24 rounded-r-xl" />
            <div className="skel h-24 rounded-r-xl" />
            <div className="skel h-24 rounded-r-xl" />
          </>
        ) : items.length === 0 ? (
          <EmptyState
            icon="🃏"
            title="공개된 딜러가 아직 없어요"
            desc="딜러 본인이 공개 토글을 켜면 여기에 표시됩니다."
          />
        ) : (
          items.map((p) => <DealerRow key={p.id} item={p} />)
        )}
      </div>
    </div>
  );
}

function DealerRow({ item }: { item: DealerProfile }) {
  const initial = (item.displayName?.[0] ?? '?').toUpperCase();
  return (
    <Link
      href={`/m/community/dealers/${item.id}`}
      className="flex items-center gap-3 p-3 rounded-2xl bg-white tap lift"
      style={{ border: '1px solid var(--border)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}
    >
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BB5 100%)' }}
      >
        {item.profileImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.profileImageUrl} alt={item.displayName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-2xl font-extrabold text-white" aria-hidden="true">{initial}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-[15px] font-extrabold truncate" style={{ color: 'var(--text-1)' }}>
            {item.displayName}
          </div>
          {item.experienceLevel && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,31,143,0.10)', color: '#FF1F8F' }}>
              {EXPERIENCE_LEVEL_LABELS[item.experienceLevel]}
            </span>
          )}
        </div>
        <div className="text-[11px] mt-1 flex flex-wrap gap-1" style={{ color: 'var(--text-3)' }}>
          {(item.abilities ?? []).slice(0, 3).map((a) => (
            <span key={a}>#{DEALER_ABILITY_LABELS[a]}</span>
          ))}
          {(item.availableShifts ?? []).slice(0, 2).map((s) => (
            <span key={s}>·{AVAILABLE_SHIFT_LABELS[s]}</span>
          ))}
        </div>
        {item.region && (
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>📍 {item.region}</div>
        )}
      </div>
      <span style={{ color: 'var(--text-3)' }}>›</span>
    </Link>
  );
}
