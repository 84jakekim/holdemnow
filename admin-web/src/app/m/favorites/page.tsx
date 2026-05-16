'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  query,
  where,
  documentId,
} from 'firebase/firestore';
import { subscribeAllLiveSessions, type LiveSession } from '@/lib/live';

interface FavoriteDoc {
  storeId: string;
  storeName: string;
  notifyOnLive: boolean;
}

interface StoreSummary {
  name: string;
  address?: string;
  photoUrl?: string;
}

export default function FavoritesPage() {
  const authState = useAuth();
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavoriteDoc[]>([]);
  const [stores, setStores] = useState<Record<string, StoreSummary>>({});
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);

  // 즐겨찾기 구독
  useEffect(() => {
    if (authState.status !== 'authenticated') {
      setLoading(false);
      return;
    }
    const uid = authState.user.uid;
    const unsub = onSnapshot(
      collection(db, 'users', uid, 'favorites'),
      (snap) => {
        setFavorites(snap.docs.map((d) => d.data() as FavoriteDoc));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [authState]);

  // 즐겨찾기 매장 정보 fetch
  useEffect(() => {
    const ids = favorites.map((f) => f.storeId).filter((id) => !(id in stores));
    if (ids.length === 0) return;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'stores'), where(documentId(), 'in', ids.slice(0, 10))),
        );
        const next: Record<string, StoreSummary> = {};
        snap.forEach((d) => {
          const data = d.data() as { name: string; address?: string; photoUrls?: string[] };
          next[d.id] = { name: data.name, address: data.address, photoUrl: data.photoUrls?.[0] };
        });
        setStores((prev) => ({ ...prev, ...next }));
      } catch {
        // ignore
      }
    })();
  }, [favorites, stores]);

  // LIVE 세션 구독 (즐겨찾기 매장 중 진행 중인지)
  useEffect(() => {
    const unsub = subscribeAllLiveSessions(setSessions, () => {});
    return unsub;
  }, []);

  const liveByStore = sessions.reduce<Record<string, LiveSession[]>>((acc, s) => {
    (acc[s.storeId] ||= []).push(s);
    return acc;
  }, {});

  // 정렬: LIVE 진행 중 매장 우선
  const sorted = [...favorites].sort((a, b) => (liveByStore[b.storeId]?.length || 0) - (liveByStore[a.storeId]?.length || 0));
  const liveCount = sorted.filter((f) => liveByStore[f.storeId]?.length).length;

  const toggleNotify = async (fav: FavoriteDoc) => {
    if (authState.status !== 'authenticated') return;
    await setDoc(
      doc(db, 'users', authState.user.uid, 'favorites', fav.storeId),
      { ...fav, notifyOnLive: !fav.notifyOnLive, updatedAt: serverTimestamp() },
      { merge: true },
    );
  };
  const removeFav = async (storeId: string) => {
    if (authState.status !== 'authenticated') return;
    if (!window.confirm('즐겨찾기에서 제거할까요?')) return;
    await deleteDoc(doc(db, 'users', authState.user.uid, 'favorites', storeId));
  };

  if (authState.status === 'loading') {
    return <div className="p-6 text-center text-sm text-gray-500">로딩 중…</div>;
  }
  if (authState.status === 'anonymous') {
    return (
      <div>
        <div className="px-5 h-14 flex items-center border-b border-gray-100">
          <span className="text-xl font-extrabold tracking-tight font-serif">
            즐겨찾기
          </span>
        </div>
        <div className="p-8 text-center">
          <div className="text-4xl mb-3">⭐</div>
          <div className="font-bold text-gray-900 mb-2">로그인이 필요합니다</div>
          <div className="text-xs text-gray-500 leading-relaxed mb-6">
            매장을 즐겨찾기하고 LIVE 시작 알림을 받으려면 로그인하세요.
          </div>
          <button
            onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
            className="bg-black text-white px-6 py-3 rounded-xl font-bold text-sm"
          >
            Google 로그인
          </button>
          <div className="text-[10px] text-gray-400 mt-4">
            v0.2부터 카카오 로그인 추가
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="px-5 h-14 flex items-center justify-between border-b border-gray-100">
        <span className="text-xl font-extrabold tracking-tight font-serif">
          즐겨찾기
        </span>
        <span className="text-xs text-gray-500">{sorted.length}개</span>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500">로딩 중…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center">
          <div className="text-4xl mb-3">⭐</div>
          <div className="font-bold text-gray-900 mb-2">즐겨찾기한 매장이 없습니다</div>
          <div className="text-xs text-gray-500 leading-relaxed mb-6">
            매장 상세 화면의 ♡ 버튼을 눌러 즐겨찾기하세요 (v0.2 추가 예정).<br />
            데모: 임의 매장을 추가하시려면 ↓
          </div>
          <DemoAddFavorite uid={authState.user.uid} />
        </div>
      ) : (
        <>
          {liveCount > 0 && (
            <div className="px-5 pt-4 text-xs text-red-600 font-bold">
              ● {liveCount}개 매장 LIVE 진행 중
            </div>
          )}
          <div className="p-5 space-y-3">
            {sorted.map((fav) => {
              const store = stores[fav.storeId];
              const sessions = liveByStore[fav.storeId] ?? [];
              const live = sessions[0];
              return (
                <div key={fav.storeId} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                  <Link href={`/m/store/${fav.storeId}`} className="block">
                    <div className="relative h-36 bg-gray-100 overflow-hidden">
                      {store?.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={store.photoUrl} alt={store.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-amber-100 to-amber-200" />
                      )}
                      {sessions.length > 0 && (
                        <div className="absolute top-3 left-3 bg-red-500 text-white rounded-xl px-2.5 py-1 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                          <span className="text-[10px] font-extrabold tracking-wider">
                            LIVE{sessions.length > 1 ? ` ${sessions.length}` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="font-bold text-gray-900 truncate">{fav.storeName}</div>
                      <div className="text-[11px] text-gray-500 mt-1">
                        {live
                          ? `🔴 ${live.tournamentName} · Lv ${live.currentLevel}`
                          : '진행 중인 LIVE 없음'}
                      </div>
                    </div>
                  </Link>
                  <div className="px-3 py-2.5 border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleNotify(fav)}
                        className={`flex items-center gap-1.5 text-xs ${
                          fav.notifyOnLive ? 'text-gray-900 font-bold' : 'text-gray-400'
                        }`}
                      >
                        {fav.notifyOnLive ? '🔔 알림 ON' : '🔕 알림 OFF'}
                      </button>
                    </div>
                    <button
                      onClick={() => removeFav(fav.storeId)}
                      className="text-[11px] text-gray-400 hover:text-red-500"
                    >
                      제거
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// 데모용: 빈 상태에서 임의 매장 즐겨찾기 추가
function DemoAddFavorite({ uid }: { uid: string }) {
  const [adding, setAdding] = useState(false);
  const handleAdd = async () => {
    setAdding(true);
    try {
      const snap = await getDocs(collection(db, 'stores'));
      const docs = snap.docs.slice(0, 3);
      for (const d of docs) {
        const data = d.data() as { name: string };
        await setDoc(doc(db, 'users', uid, 'favorites', d.id), {
          storeId: d.id,
          storeName: data.name,
          notifyOnLive: true,
          createdAt: serverTimestamp(),
        });
      }
    } finally {
      setAdding(false);
    }
  };
  return (
    <button
      onClick={handleAdd}
      disabled={adding}
      className="bg-black text-white px-5 py-2.5 rounded-xl font-bold text-xs disabled:opacity-40"
    >
      {adding ? '추가 중…' : '+ 데모: 매장 3곳 자동 추가'}
    </button>
  );
}
