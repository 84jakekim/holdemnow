'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession } from '@/lib/live';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';

interface StoreSummary {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
}

// 데모용 의사난수 좌표 (id 기반으로 같은 위치 유지)
function pseudoPosition(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  const x = (Math.abs(hash) % 60) + 18; // 18~78%
  const y = (Math.abs(hash >> 8) % 60) + 16; // 16~76%
  return { top: `${y}%`, left: `${x}%` };
}

export default function DiscoverPage() {
  const router = useRouter();
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'stores'));
        const list: StoreSummary[] = snap.docs.map((d) => {
          const data = d.data() as { name: string; address?: string; photoUrls?: string[] };
          return {
            id: d.id,
            name: data.name,
            address: data.address,
            photoUrl: data.photoUrls?.[0],
          };
        });
        setStores(list);
        // 지도에 표시되는 매장 = impression (탐색 surface)
        list.forEach((s) => trackImpressionOnce(s.id, 'discover-map'));
        if (list.length > 0) setSelectedId(list[0].id);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(setSessions, () => {});
    return unsub;
  }, []);

  const liveCountByStore = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sessions) map[s.storeId] = (map[s.storeId] || 0) + 1;
    return map;
  }, [sessions]);

  const totalLive = Object.values(liveCountByStore).reduce((a, b) => a + b, 0);
  const selected = stores.find((s) => s.id === selectedId);
  const selectedLiveCount = selected ? liveCountByStore[selected.id] || 0 : 0;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      {/* 상단 헤더 */}
      <div className="px-5 h-14 flex items-center justify-between border-b border-gray-100">
        <span className="text-xl font-extrabold tracking-tight font-serif">
          탐색
        </span>
        <Link href="/m/search" className="text-lg" title="검색">🔍</Link>
      </div>

      {/* 지도 영역 */}
      <div
        className="flex-1 relative overflow-hidden"
        style={{
          background:
            'linear-gradient(135deg, #E8E4DA 0%, #DBD3C0 60%, #C9BEA4 100%)',
        }}
      >
        {/* 격자 */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(0,0,0,0.05) 40px, rgba(0,0,0,0.05) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(0,0,0,0.05) 40px, rgba(0,0,0,0.05) 41px)',
          }}
        />

        {/* 모의 도로 */}
        <div className="absolute top-[47%] left-0 right-0 h-[5px] bg-white/55" />
        <div className="absolute top-0 bottom-0 left-[52%] w-[5px] bg-white/55" />

        {/* 현재 위치 */}
        <div className="absolute top-[50%] left-[48%] -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="w-4 h-4 rounded-full bg-blue-500 border-[3px] border-white shadow-lg animate-pulse" />
        </div>

        {/* 상단 정보 카드 */}
        <div className="absolute top-3 left-3 right-3 bg-white/95 backdrop-blur rounded-xl px-4 py-3 flex items-center justify-between shadow-md z-30">
          <div>
            <div className="text-[11px] text-gray-500">현재 위치 기준 5km</div>
            <div className="text-sm font-bold text-gray-900 mt-0.5">매장 {stores.length}개</div>
          </div>
          {totalLive > 0 ? (
            <div className="bg-red-50 text-red-600 rounded-xl px-3 py-1.5 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-extrabold">LIVE {totalLive}</span>
            </div>
          ) : (
            <div className="text-xs text-gray-500">LIVE 없음</div>
          )}
        </div>

        {/* 매장 핀 */}
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
            로딩 중…
          </div>
        ) : (
          stores.map((s) => {
            const pos = pseudoPosition(s.id);
            const count = liveCountByStore[s.id] || 0;
            const isLive = count > 0;
            const isSelected = s.id === selectedId;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className="absolute -translate-x-1/2 -translate-y-full"
                style={{ top: pos.top, left: pos.left, zIndex: isSelected ? 25 : isLive ? 20 : 15 }}
              >
                {isLive ? (
                  <div
                    className={`bg-red-500 text-white rounded-2xl px-2.5 py-1 font-extrabold text-[10px] tracking-wider whitespace-nowrap shadow-lg ${
                      isSelected ? 'ring-2 ring-black' : 'animate-pulse'
                    }`}
                  >
                    ● LIVE{count > 1 ? ` ${count}` : ''}
                  </div>
                ) : (
                  <div
                    className={`bg-white rounded-full transition shadow ${
                      isSelected ? 'w-6 h-6 border-[2.5px] border-black' : 'w-4 h-4 border-2 border-gray-600'
                    }`}
                  />
                )}
              </button>
            );
          })
        )}

        {/* 하단 매장 카드 */}
        {selected && (
          <button
            onClick={() => {
              bumpStoreMetric(selected.id, 'cardClicks');
              router.push(`/m/store/${selected.id}`);
            }}
            className="absolute bottom-3 left-3 right-3 bg-white rounded-2xl p-3 shadow-lg flex items-center gap-3 text-left z-30 active:scale-[0.98] transition"
          >
            <div
              className="w-16 h-16 rounded-xl flex-shrink-0 bg-gray-200 overflow-hidden"
              style={
                selected.photoUrl
                  ? undefined
                  : { background: 'linear-gradient(135deg, #C9B49A 0%, #A8927A 100%)' }
              }
            >
              {selected.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.photoUrl} alt={selected.name} className="w-full h-full object-cover" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="text-sm font-bold text-gray-900 truncate">{selected.name}</div>
                {selectedLiveCount > 0 && (
                  <div className="inline-flex items-center gap-1 bg-red-50 text-red-600 rounded-md px-1.5 py-0.5">
                    <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[9px] font-extrabold">LIVE{selectedLiveCount > 1 ? ` ${selectedLiveCount}` : ''}</span>
                  </div>
                )}
              </div>
              {selected.address && (
                <div className="text-[11px] text-gray-500 truncate">📍 {selected.address}</div>
              )}
            </div>
            <span className="text-xl text-gray-400">›</span>
          </button>
        )}
      </div>
    </div>
  );
}
