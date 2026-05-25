'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { stripUndefined } from '@/lib/firestoreUtil';
import { useAuth } from '@/lib/hooks';
import AnonymousPrompt from '@/components/mobile/AnonymousPrompt';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp,
  getDocs, query, where, documentId,
} from 'firebase/firestore';
import { subscribeAllLiveSessions, type LiveSession } from '@/lib/live';
import { RatingChip } from '@/components/mobile/RatingChip';
import { EmptyState } from '@/components/ui';

interface FavoriteDoc {
  storeId: string;
  storeName: string;
  notifyOnLive: boolean;
}

interface StoreSummary {
  name: string;
  address?: string;
  photoUrl?: string;
  averageRating?: number;
  reviewCount?: number;
}

export default function FavoritesPage() {
  const authState = useAuth();
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavoriteDoc[]>([]);
  const [stores, setStores] = useState<Record<string, StoreSummary>>({});
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authState.status !== 'authenticated') { setLoading(false); return; }
    const uid = authState.user.uid;
    const unsub = onSnapshot(
      collection(db, 'users', uid, 'favorites'),
      (snap) => { setFavorites(snap.docs.map((d) => d.data() as FavoriteDoc)); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, [authState]);

  useEffect(() => {
    const ids = favorites.map((f) => f.storeId).filter((id) => !(id in stores));
    if (ids.length === 0) return;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'stores'), where(documentId(), 'in', ids.slice(0, 10))));
        const next: Record<string, StoreSummary> = {};
        snap.forEach((d) => {
          const data = d.data() as {
            name: string; address?: string; photoUrls?: string[];
            averageRating?: number; reviewCount?: number;
          };
          next[d.id] = {
            name: data.name, address: data.address, photoUrl: data.photoUrls?.[0],
            averageRating: data.averageRating, reviewCount: data.reviewCount,
          };
        });
        setStores((prev) => ({ ...prev, ...next }));
      } catch { /* ignore */ }
    })();
  }, [favorites, stores]);

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(setSessions, () => {});
    return unsub;
  }, []);

  const liveByStore = sessions.reduce<Record<string, LiveSession[]>>((acc, s) => {
    (acc[s.storeId] ||= []).push(s);
    return acc;
  }, {});

  const sorted = [...favorites].sort(
    (a, b) => (liveByStore[b.storeId]?.length || 0) - (liveByStore[a.storeId]?.length || 0),
  );
  const liveCount = sorted.filter((f) => liveByStore[f.storeId]?.length).length;

  const toggleNotify = async (fav: FavoriteDoc) => {
    if (authState.status !== 'authenticated') return;
    await setDoc(
      doc(db, 'users', authState.user.uid, 'favorites', fav.storeId),
      stripUndefined({ ...fav, notifyOnLive: !fav.notifyOnLive, updatedAt: serverTimestamp() }),
      { merge: true },
    );
  };

  const removeFav = async (storeId: string) => {
    if (authState.status !== 'authenticated') return;
    if (!window.confirm('즐겨찾기에서 제거할까요?')) return;
    await deleteDoc(doc(db, 'users', authState.user.uid, 'favorites', storeId));
  };

  if (authState.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      </div>
    );
  }
  if (authState.status === 'anonymous') {
    return <AnonymousPrompt title="즐겨찾기" icon="⭐" desc="매장을 즐겨찾기하고 LIVE 시작 알림을 받으려면 로그인하세요." />;
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── 헤더 ── */}
      <header
        className="px-5 h-14 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xl font-extrabold tracking-tight font-serif" style={{ color: 'var(--text-1)' }}>
          즐겨찾기
        </span>
        <span className="text-xs font-bold" style={{ color: 'var(--text-3)' }}>{sorted.length}개</span>
      </header>

      {loading ? (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      ) : sorted.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon="♡"
            title="즐겨찾기한 매장이 없습니다"
            desc="매장 상세 화면의 ♡ 버튼을 눌러 즐겨찾기하고 LIVE 알림을 받으세요."
            action={<DemoAddFavorite uid={authState.user.uid} />}
          />
        </div>
      ) : (
        <>
          {liveCount > 0 && (
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0 pulse-live" style={{ background: 'var(--live)' }} aria-hidden="true" />
              <span className="text-xs font-bold" style={{ color: 'var(--live)' }}>
                {liveCount}개 매장 LIVE 진행 중
              </span>
            </div>
          )}
          <div className="p-4 space-y-3">
            {sorted.map((fav) => {
              const store = stores[fav.storeId];
              const liveSessions = liveByStore[fav.storeId] ?? [];
              const live = liveSessions[0];
              return (
                <div
                  key={fav.storeId}
                  className="overflow-hidden lift"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-card)' }}
                >
                  <Link href={`/m/store/${fav.storeId}`} className="block tap">
                    <div className="relative h-40 overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                      {store?.photoUrl ? (
                        <img src={store.photoUrl} alt={store.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, #2A1F3D 0%, #1A1028 100%)' }} />
                      )}
                      {/* 하단 그라데이션 */}
                      <div className="absolute bottom-0 left-0 right-0 h-16" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.70) 0%, transparent 100%)' }} aria-hidden="true" />
                      {liveSessions.length > 0 && (
                        <div className="absolute top-3 left-3">
                          <span className="badge-live" style={{ boxShadow: '0 0 12px var(--live-glow)' }}>
                            <span className="dot" />
                            LIVE{liveSessions.length > 1 ? ` ${liveSessions.length}` : ''}
                          </span>
                        </div>
                      )}
                      <div className="absolute bottom-3 left-3">
                        <div className="font-bold text-sm" style={{ color: '#fff' }}>{fav.storeName}</div>
                        {live && (
                          <div className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.70)' }}>
                            {live.tournamentName} · Lv {live.currentLevel}
                          </div>
                        )}
                      </div>
                    </div>
                    {!liveSessions.length && (
                      <div className="px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>{fav.storeName}</div>
                          {(store?.reviewCount ?? 0) > 0 && (
                            <RatingChip rating={store?.averageRating} count={store?.reviewCount} size="sm" />
                          )}
                        </div>
                        <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>진행 중인 LIVE 없음</div>
                      </div>
                    )}
                  </Link>
                  <div
                    className="px-4 py-3 flex items-center justify-between"
                    style={{ borderTop: '1px solid var(--border)' }}
                  >
                    <button
                      onClick={() => toggleNotify(fav)}
                      className="flex items-center gap-1.5 text-xs transition"
                      style={{ color: fav.notifyOnLive ? 'var(--brand)' : 'var(--text-3)' }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill={fav.notifyOnLive ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>
                      {fav.notifyOnLive ? '알림 ON' : '알림 OFF'}
                    </button>
                    <button
                      onClick={() => removeFav(fav.storeId)}
                      className="text-[11px] transition"
                      style={{ color: 'var(--text-3)' }}
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
          storeId: d.id, storeName: data.name, notifyOnLive: true, createdAt: serverTimestamp(),
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
      className="px-5 py-3 rounded-xl font-bold text-sm transition active:scale-[0.97] disabled:opacity-40"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
    >
      {adding ? '추가 중…' : '+ 데모: 매장 3곳 자동 추가'}
    </button>
  );
}
