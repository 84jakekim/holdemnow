'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeAllLiveSessions, type LiveSession, fmtTime } from '@/lib/live';
import { subscribeAllTournaments, type TournamentInstance } from '@/lib/tournaments';
import Link from 'next/link';
import { posterStyleFor } from '@/lib/templates';
import TournamentInterestStar from '@/components/mobile/TournamentInterestStar';
import { bumpStoreMetric } from '@/lib/analytics';

export default function CalendarPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [tournaments, setTournaments] = useState<TournamentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  type FilterId = 'all' | 'gtd-large' | 'buyin-low' | 'satellite';
  const [filter, setFilter] = useState<FilterId>('all');

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(
      (items) => {
        setSessions(items);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeAllTournaments(
      (items) => setTournaments(items),
      (e) => console.warn('tournaments subscribe error', e),
    );
    return unsub;
  }, []);

  // 선택된 날짜의 예정 토너 + 필터 적용
  const upcomingForDay = useMemo(() => {
    return tournaments.filter((t) => {
      const d = t.startsAt.toDate();
      if (d.getDate() !== selectedDay || t.status !== 'scheduled') return false;
      if (filter === 'gtd-large' && t.guarantee < 1000000) return false;
      if (filter === 'buyin-low' && t.buyIn > 50000) return false;
      if (filter === 'satellite' && t.type !== 'satellite') return false;
      return true;
    });
  }, [tournaments, selectedDay, filter]);

  // 오늘 + 6일 (총 7일) — 실제 날짜 기반
  const days = useMemo(() => {
    const list = [] as { n: number; dow: string; isToday: boolean; isWeekend: boolean }[];
    const dowNames = ['일', '월', '화', '수', '목', '금', '토'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      list.push({
        n: d.getDate(),
        dow: dowNames[d.getDay()],
        isToday: i === 0,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isToday = selectedDay === today.getDate();

  return (
    <div>
      <div className="px-5 h-14 flex items-center justify-between border-b border-gray-100">
        <span className="text-xl font-extrabold tracking-tight font-serif">
          토너 캘린더
        </span>
        <Link href="/m/search" className="text-lg" title="검색">🔍</Link>
      </div>

      {/* 필터 칩 */}
      <div className="px-5 py-3 flex gap-1.5 overflow-x-auto scrollbar-none">
        {([
          { id: 'all', label: '전체' },
          { id: 'gtd-large', label: '게런티 100만+' },
          { id: 'buyin-low', label: '바이인 5만↓' },
          { id: 'satellite', label: '위성 예선' },
        ] as { id: FilterId; label: string }[]).map((c) => {
          const active = filter === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex-shrink-0 border ${
                active ? 'bg-black text-white border-black' : 'bg-white text-gray-900 border-gray-200'
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="px-5 pb-3 text-sm font-bold text-gray-900">2026년 5월</div>

      {/* 날짜 선택 */}
      <div className="pl-5 pr-2 flex gap-2 overflow-x-auto scrollbar-none pb-5">
        {days.map((d) => (
          <button
            key={d.n}
            onClick={() => setSelectedDay(d.n)}
            className={`w-12 h-16 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${
              selectedDay === d.n ? 'bg-black text-white' : 'bg-gray-100 text-gray-900'
            }`}
          >
            <div
              className={`text-[10px] font-bold ${
                selectedDay === d.n
                  ? 'text-gray-400'
                  : d.isWeekend
                    ? 'text-red-500'
                    : 'text-gray-500'
              }`}
            >
              {d.dow}
            </div>
            <div className="text-lg font-extrabold mt-0.5">{d.n}</div>
            {d.isToday && selectedDay === d.n && (
              <div className="w-1 h-1 rounded-full bg-red-400 mt-1" />
            )}
          </button>
        ))}
      </div>

      {/* 지금 진행 중 LIVE */}
      {sessions.length > 0 && isToday && (
        <div className="px-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-base font-extrabold text-red-600">
              지금 진행 중 ({sessions.length})
            </span>
          </div>
          <div className="space-y-2">
            {sessions.map((s) => {
              const poster = posterStyleFor(s.posterStyle);
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    bumpStoreMetric(s.storeId, 'liveOpens');
                    router.push(`/m/live/${s.id}`);
                  }}
                  className="w-full bg-red-50 rounded-2xl p-3 flex items-center gap-3 text-left active:scale-[0.98] transition"
                >
                  <div
                    className="w-10 h-12 rounded-md flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
                    style={{ background: poster.bg, color: poster.color }}
                  >
                    {s.tournamentName.split(' ')[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-900 truncate">{s.tournamentName}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {s.storeName} · Lv {s.currentLevel} · {s.playersRemaining}명
                    </div>
                  </div>
                  <div
                    className={`font-mono text-base font-extrabold ${
                      s.status === 'paused' ? 'text-amber-600' : 'text-red-600'
                    }`}
                  >
                    {fmtTime(s.levelSecondsLeft)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 예정 토너 */}
      <div className="px-5 mb-4">
        <div className="text-base font-extrabold text-gray-900 mb-2">
          {today.getMonth() + 1}월 {selectedDay}일 예정 토너
        </div>
        {loading ? (
          <div className="text-sm text-gray-500 py-6 text-center">로딩 중…</div>
        ) : upcomingForDay.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-8 text-center">
            <div className="text-3xl mb-2">📅</div>
            <div className="text-sm font-bold text-gray-900 mb-1">예정 토너 없음</div>
            <div className="text-[11px] text-gray-500 leading-relaxed">
              매장 어드민의 "📅 예정 토너"에서 사전 등록 시 여기에 표시됩니다
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingForDay.map((t) => {
              const poster = posterStyleFor(t.posterStyle);
              const time = t.startsAt.toDate();
              const hh = String(time.getHours()).padStart(2, '0');
              const mm = String(time.getMinutes()).padStart(2, '0');
              return (
                <div
                  key={t.id}
                  className="w-full bg-white border border-gray-200 rounded-2xl p-3 flex items-center gap-3"
                >
                  <button
                    onClick={() => {
                      bumpStoreMetric(t.storeId, 'cardClicks');
                      router.push(`/m/store/${t.storeId}`);
                    }}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <div
                      className="w-12 h-16 rounded-md flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
                      style={{ background: poster.bg, color: poster.color }}
                    >
                      {t.name.split(' ').slice(0, 2).join(' ')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">{t.name}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        <span className="font-mono font-bold text-gray-900">
                          {hh}:{mm}
                        </span>{' '}
                        · {t.storeName} · {t.totalPlayers}명
                      </div>
                      <div className="flex gap-1.5 mt-1.5">
                        <span className="text-[10px] font-bold bg-gray-100 text-gray-900 rounded px-1.5 py-0.5">
                          바이인 ₩{(t.buyIn / 1000).toFixed(0)}K
                        </span>
                        {t.guarantee > 0 && (
                          <span className="text-[10px] font-bold bg-red-50 text-red-600 rounded px-1.5 py-0.5">
                            GTD ₩{(t.guarantee / 10000).toFixed(0)}만
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <TournamentInterestStar tournament={t} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style jsx global>{`
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { scrollbar-width: none; }
      `}</style>
    </div>
  );
}
