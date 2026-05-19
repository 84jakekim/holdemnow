'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession, fmtTime, useLiveCountdown } from '@/lib/live';
import { subscribeAllTournaments, type TournamentInstance } from '@/lib/tournaments';
import { subscribeAllSeries, type Series } from '@/lib/series';
import { posterStyleFor } from '@/lib/templates';
import { bumpStoreMetric } from '@/lib/analytics';

interface StoreItem {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
  facilities?: string[];
}

export default function SearchPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [tournaments, setTournaments] = useState<TournamentInstance[]>([]);
  const [series, setSeries] = useState<Series[]>([]);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'stores'));
      // 본사 미승인 매장 검색 노출 차단 (isDemo 시드는 항상 노출)
      setStores(
        snap.docs
          .filter((d) => {
            const data = d.data() as { status?: string; isDemo?: boolean };
            return data.status === 'active' || data.isDemo === true;
          })
          .map((d) => {
            const data = d.data() as { name: string; address?: string; photoUrls?: string[]; facilities?: string[] };
            return {
              id: d.id,
              name: data.name,
              address: data.address,
              photoUrl: data.photoUrls?.[0],
              facilities: data.facilities,
            };
          }),
      );
    })();
  }, []);

  useEffect(() => {
    const u1 = subscribeAllLiveSessions(setSessions, () => {});
    const u2 = subscribeAllTournaments(setTournaments, () => {});
    const u3 = subscribeAllSeries(setSeries, () => {});
    return () => { u1(); u2(); u3(); };
  }, []);

  const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/\s/g, '');
  const term = norm(q);

  const results = useMemo(() => {
    if (!term) return null;
    const storesHit = stores.filter(
      (s) => norm(s.name).includes(term) || norm(s.address).includes(term),
    );
    const liveHit = sessions.filter(
      (s) => norm(s.tournamentName).includes(term) || norm(s.storeName).includes(term),
    );
    const upHit = tournaments.filter(
      (t) => norm(t.name).includes(term) || norm(t.storeName).includes(term),
    );
    const seriesHit = series.filter(
      (sr) => norm(sr.name).includes(term) || norm(sr.season).includes(term),
    );
    return { storesHit, liveHit, upHit, seriesHit };
  }, [term, stores, sessions, tournaments, series]);

  const totalHits = results ? results.storesHit.length + results.liveHit.length + results.upHit.length + results.seriesHit.length : 0;

  return (
    <div>
      {/* 상단 검색 바 */}
      <div className="px-4 h-14 flex items-center gap-2 border-b border-gray-100 sticky top-0 bg-white z-10">
        <button onClick={() => router.back()} className="text-xl px-1">←</button>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="매장·토너·시리즈 검색"
          className="flex-1 bg-gray-100 rounded-xl h-10 px-4 text-sm outline-none"
        />
        {q && (
          <button onClick={() => setQ('')} className="text-gray-400 px-2 text-lg">
            ✕
          </button>
        )}
      </div>

      {/* 결과 또는 안내 */}
      {!results ? (
        <div className="p-8 text-center">
          <div className="text-3xl mb-3">🔍</div>
          <div className="text-sm text-gray-500 leading-relaxed">
            매장명·토너명·시리즈명으로 검색<br />
            <span className="text-[11px] text-gray-400 mt-2 block">
              예: 서면 / 프리징 / ABC 시리즈
            </span>
          </div>
        </div>
      ) : totalHits === 0 ? (
        <div className="p-8 text-center text-sm text-gray-500">
          "{q}" 검색 결과가 없습니다
        </div>
      ) : (
        <div className="pb-6">
          {/* 매장 */}
          {results.storesHit.length > 0 && (
            <Section title={`매장 (${results.storesHit.length})`}>
              {results.storesHit.map((st) => (
                <Link
                  key={st.id}
                  href={`/m/store/${st.id}`}
                  onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50"
                >
                  <div className="w-12 h-12 rounded-lg bg-gray-200 flex-shrink-0 overflow-hidden">
                    {st.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-amber-100 to-amber-200" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-900 truncate">
                      <Highlight text={st.name} term={term} />
                    </div>
                    {st.address && (
                      <div className="text-[11px] text-gray-500 truncate mt-0.5">
                        📍 <Highlight text={st.address} term={term} />
                      </div>
                    )}
                  </div>
                  <span className="text-gray-400">›</span>
                </Link>
              ))}
            </Section>
          )}

          {/* LIVE */}
          {results.liveHit.length > 0 && (
            <Section title={`지금 LIVE (${results.liveHit.length})`}>
              {results.liveHit.map((s) => (
                <SearchLiveHit key={s.id} session={s} term={term} />
              ))}
            </Section>
          )}

          {/* 예정 토너 */}
          {results.upHit.length > 0 && (
            <Section title={`예정 토너 (${results.upHit.length})`}>
              {results.upHit.map((t) => {
                const d = t.startsAt.toDate();
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const poster = posterStyleFor(t.posterStyle);
                return (
                  <Link
                    key={t.id}
                    href={`/m/store/${t.storeId}`}
                    onClick={() => bumpStoreMetric(t.storeId, 'cardClicks')}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50"
                  >
                    <div
                      className="w-10 h-12 rounded-md flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
                      style={{ background: poster.bg, color: poster.color }}
                    >
                      {t.name.split(' ')[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">
                        <Highlight text={t.name} term={term} />
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                        {d.getMonth() + 1}/{d.getDate()} {hh}:{mm} · <Highlight text={t.storeName} term={term} />
                      </div>
                    </div>
                    <span className="text-gray-400">›</span>
                  </Link>
                );
              })}
            </Section>
          )}

          {/* 시리즈 */}
          {results.seriesHit.length > 0 && (
            <Section title={`시리즈 (${results.seriesHit.length})`}>
              {results.seriesHit.map((sr) => {
                const poster = posterStyleFor(sr.posterStyle);
                return (
                  <Link key={sr.id} href={`/m/series/${sr.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                    <div
                      className="w-10 h-12 rounded-md flex items-center justify-center text-[8px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
                      style={{ background: poster.bg, color: poster.color }}
                    >
                      🏆
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">
                        <Highlight text={sr.name} term={term} />
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                        {sr.season} · ₩{(sr.finalGuarantee / 100000000).toFixed(1)}억 GTD
                      </div>
                    </div>
                    <span className="text-gray-400">›</span>
                  </Link>
                );
              })}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function SearchLiveHit({ session: s, term }: { session: LiveSession; term: string }) {
  const sec = useLiveCountdown(s);
  const poster = posterStyleFor(s.posterStyle);
  return (
    <Link
      href={`/m/live/${s.id}`}
      onClick={() => bumpStoreMetric(s.storeId, 'liveOpens')}
      className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50"
    >
      <div
        className="w-10 h-12 rounded-md flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
        style={{ background: poster.bg, color: poster.color }}
      >
        {s.tournamentName.split(' ')[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-gray-900 truncate">
          <Highlight text={s.tournamentName} term={term} />
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5 truncate">
          🔴 <Highlight text={s.storeName} term={term} /> · Lv {s.currentLevel}
        </div>
      </div>
      <div className="font-mono text-sm font-extrabold text-red-500">
        {fmtTime(sec)}
      </div>
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b-[6px] border-gray-50 last:border-b-0">
      <div className="px-5 pt-4 pb-2 text-[10px] font-bold text-gray-500 tracking-wider">{title}</div>
      <div className="divide-y divide-gray-50">{children}</div>
    </div>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(term);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-gray-900 rounded px-0.5">{text.slice(idx, idx + term.length)}</mark>
      {text.slice(idx + term.length)}
    </>
  );
}
