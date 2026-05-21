'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  subscribeEvents,
  type EventDoc,
  type EventCategory,
  type EventStatus,
  EVENT_CATEGORY_LABEL,
  EVENT_STATUS_LABEL,
  formatEventDateRange,
  daysFromNow,
} from '@/lib/events';

type ViewMode = 'list' | 'large' | 'album';

const VIEW_MODE_STORAGE_KEY = 'hn-events-view-mode';

export default function EventsPage() {
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<EventCategory | 'all'>('all');
  const [status, setStatus] = useState<EventStatus | 'all'>('upcoming');
  const [viewMode, setViewMode] = useState<ViewMode>('large');
  const [cityFilter, setCityFilter] = useState<string | 'all'>('all');

  // 저장된 뷰 모드 복원
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) as ViewMode | null;
    if (saved === 'list' || saved === 'large' || saved === 'album') setViewMode(saved);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    const unsub = subscribeEvents(
      {
        category: category === 'all' ? undefined : category,
        status: status === 'all' ? undefined : status,
        orderByField: 'startDate',
        orderDir: status === 'completed' ? 'desc' : 'asc',
      },
      (items) => {
        setEvents(items);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [category, status]);

  // 도시 옵션 자동 추출 (현재 목록에 존재하는 도시만)
  const availableCities = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => {
      if (e.city) set.add(e.city);
    });
    return Array.from(set).sort();
  }, [events]);

  const sortedEvents = useMemo(() => {
    if (cityFilter === 'all') return events;
    return events.filter((e) => e.city === cityFilter);
  }, [events, cityFilter]);

  return (
    <div className="pb-24">
      {/* 헤더 */}
      <div className="px-5 h-14 flex items-center justify-between border-b border-gray-100 sticky top-0 bg-white z-10">
        <span className="text-xl font-extrabold tracking-tight font-serif">대회</span>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </div>

      {/* 카테고리 필터 (chip) */}
      <div className="px-5 py-3 flex gap-1.5 overflow-x-auto scrollbar-none">
        {([
          { id: 'all', label: '전체' },
          { id: 'domestic', label: EVENT_CATEGORY_LABEL.domestic },
          { id: 'international', label: EVENT_CATEGORY_LABEL.international },
        ] as { id: EventCategory | 'all'; label: string }[]).map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex-shrink-0 border ${
              category === c.id ? 'bg-black text-white border-black' : 'bg-white text-gray-900 border-gray-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* 상태 필터 (chip) */}
      <div className="px-5 pb-3 flex gap-1.5 overflow-x-auto scrollbar-none">
        {([
          { id: 'upcoming', label: EVENT_STATUS_LABEL.upcoming },
          { id: 'ongoing', label: EVENT_STATUS_LABEL.ongoing },
          { id: 'completed', label: EVENT_STATUS_LABEL.completed },
          { id: 'all', label: '전체 상태' },
        ] as { id: EventStatus | 'all'; label: string }[]).map((s) => (
          <button
            key={s.id}
            onClick={() => setStatus(s.id)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap flex-shrink-0 border ${
              status === s.id ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-700 border-gray-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 도시 필터 — 등록된 도시가 있을 때만 표시 */}
      {availableCities.length > 0 && (
        <div className="px-5 pb-3 flex gap-1.5 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setCityFilter('all')}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap flex-shrink-0 border ${
              cityFilter === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'
            }`}
          >
            전체 지역
          </button>
          {availableCities.map((c) => (
            <button
              key={c}
              onClick={() => setCityFilter(c)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap flex-shrink-0 border ${
                cityFilter === c ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'
              }`}
            >
              📍 {c}
            </button>
          ))}
        </div>
      )}

      {/* 결과 */}
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">로딩 중…</div>
      ) : sortedEvents.length === 0 ? (
        <div className="py-16 px-6 text-center">
          <div className="text-4xl mb-3">🏆</div>
          <div className="font-bold text-gray-900 mb-2">조건에 맞는 대회가 없습니다</div>
          <div className="text-xs text-gray-500 leading-relaxed">
            카테고리·상태 필터를 바꿔보세요.
            <br />
            대회사·본사가 등록한 메이저 대회만 표시됩니다.
          </div>
        </div>
      ) : viewMode === 'list' ? (
        <CompactList items={sortedEvents} />
      ) : viewMode === 'large' ? (
        <LargeList items={sortedEvents} />
      ) : (
        <AlbumGrid items={sortedEvents} />
      )}

      <style jsx global>{`
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { scrollbar-width: none; }
      `}</style>
    </div>
  );
}

/* ============================================================
 * 뷰 모드 토글
 * ========================================================== */

function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      <button
        onClick={() => onChange('list')}
        className={`w-7 h-7 rounded text-sm flex items-center justify-center ${
          value === 'list' ? 'bg-white shadow-sm' : 'opacity-50'
        }`}
        title="목록"
      >
        ☰
      </button>
      <button
        onClick={() => onChange('large')}
        className={`w-7 h-7 rounded text-sm flex items-center justify-center ${
          value === 'large' ? 'bg-white shadow-sm' : 'opacity-50'
        }`}
        title="큰 목록"
      >
        ☷
      </button>
      <button
        onClick={() => onChange('album')}
        className={`w-7 h-7 rounded text-sm flex items-center justify-center ${
          value === 'album' ? 'bg-white shadow-sm' : 'opacity-50'
        }`}
        title="앨범"
      >
        ▦
      </button>
    </div>
  );
}

/* ============================================================
 * 뷰 1: 압축 목록 — 한 줄, 정보 밀도 ↑
 * ========================================================== */

function CompactList({ items }: { items: EventDoc[] }) {
  return (
    <div className="divide-y divide-gray-100">
      {items.map((e) => {
        const d = daysFromNow(e.startDate);
        return (
          <Link
            key={e.id}
            href={`/m/events/${e.id}`}
            className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 active:bg-gray-100 transition"
          >
            <div className="w-12 h-12 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
              {e.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.posterUrl} alt={e.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-xl">🏆</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                {e.city && (
                  <span className="text-[10px] font-bold bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">
                    {e.city}
                  </span>
                )}
                <span className="text-sm font-bold text-gray-900 truncate">{e.name}</span>
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {formatEventDateRange(e.startDate, e.endDate)}
                {e.venueName ? ` · ${e.venueName}` : ''}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              {e.status === 'upcoming' && d > 0 && (
                <div className="text-[10px] font-extrabold text-red-500">D-{d}</div>
              )}
              {e.status === 'ongoing' && (
                <div className="text-[10px] font-extrabold text-green-600">진행 중</div>
              )}
              {/* GTD 표기 제거 — 법적 리스크 */}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* ============================================================
 * 뷰 2: 큰 목록 — 포스터 + 상세 정보
 * ========================================================== */

function LargeList({ items }: { items: EventDoc[] }) {
  return (
    <div className="px-5 space-y-3">
      {items.map((e) => {
        const d = daysFromNow(e.startDate);
        return (
          <Link
            key={e.id}
            href={`/m/events/${e.id}`}
            className="block bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-gray-400 active:scale-[0.99] transition"
          >
            <div className="flex">
              {/* 포스터 */}
              <div className="w-28 h-36 bg-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
                {e.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.posterUrl} alt={e.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-4xl opacity-40">🏆</span>
                )}
              </div>
              {/* 정보 */}
              <div className="flex-1 min-w-0 p-3 flex flex-col">
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="text-[10px] font-bold bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">
                    {EVENT_CATEGORY_LABEL[e.category]}
                  </span>
                  {e.city && (
                    <span className="text-[10px] font-bold bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">
                      📍 {e.city}
                    </span>
                  )}
                  {e.status === 'upcoming' && d > 0 && (
                    <span className="text-[10px] font-extrabold text-red-500">D-{d}</span>
                  )}
                  {e.status === 'ongoing' && (
                    <span className="text-[10px] font-extrabold text-green-600">진행 중</span>
                  )}
                  {e.status === 'completed' && (
                    <span className="text-[10px] font-bold text-gray-400">종료</span>
                  )}
                </div>
                <div className="text-sm font-extrabold text-gray-900 leading-tight line-clamp-2 font-serif">
                  {e.name}
                </div>
                <div className="text-[11px] text-gray-500 mt-1.5 truncate">
                  📅 {formatEventDateRange(e.startDate, e.endDate)}
                </div>
                {e.venueName && (
                  <div className="text-[11px] text-gray-500 truncate">📍 {e.venueName}</div>
                )}
                {/* GTD 표기 제거 — 법적 리스크. 바이인(좌석 이용권)만 표시 */}
                <div className="mt-auto pt-2 flex items-center gap-3 text-[11px]">
                  {e.buyIn != null && e.buyIn > 0 && (
                    <span className="text-gray-700 font-mono">
                      바이인 ₩{e.buyIn.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* ============================================================
 * 뷰 3: 앨범 그리드 — 포스터 중심, 2열
 * ========================================================== */

function AlbumGrid({ items }: { items: EventDoc[] }) {
  return (
    <div className="px-5 grid grid-cols-2 gap-3">
      {items.map((e) => {
        const d = daysFromNow(e.startDate);
        return (
          <Link
            key={e.id}
            href={`/m/events/${e.id}`}
            className="block bg-white border border-gray-200 rounded-xl overflow-hidden active:scale-[0.98] transition"
          >
            <div className="aspect-[3/4] bg-gray-100 relative overflow-hidden flex items-center justify-center">
              {e.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.posterUrl} alt={e.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-5xl opacity-40">🏆</span>
              )}
              {/* 좌상단 도시 뱃지 */}
              {e.city && (
                <div className="absolute top-2 left-2 bg-black/60 backdrop-blur text-white text-[10px] font-bold rounded-full px-2 py-0.5">
                  📍 {e.city}
                </div>
              )}
              {e.status === 'upcoming' && d > 0 && d <= 30 && (
                <div className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-extrabold rounded-full px-2 py-0.5">
                  D-{d}
                </div>
              )}
              {e.status === 'ongoing' && (
                <div className="absolute top-2 right-2 bg-green-500 text-white text-[10px] font-extrabold rounded-full px-2 py-0.5 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  LIVE
                </div>
              )}
            </div>
            <div className="p-2.5">
              <div className="text-xs font-extrabold text-gray-900 leading-tight line-clamp-2">
                {e.name}
              </div>
              <div className="text-[10px] text-gray-500 mt-1">
                {formatEventDateRange(e.startDate, e.endDate)}
              </div>
              {/* GTD 표기 제거 — 법적 리스크 */}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
