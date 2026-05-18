'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import { subscribeStoreLiveSessions, type LiveSession, fmtTime, computeLateRegMinutes, useLiveCountdown, computeReadyExpirySec } from '@/lib/live';
import { subscribeStoreTournaments, type TournamentInstance } from '@/lib/tournaments';
import { posterStyleFor } from '@/lib/templates';
import { callPhone, openDirections, shareContent } from '@/lib/actions';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { enableNotifications, getNotificationPermission } from '@/lib/messaging';
import { loadKakaoMaps, geocodeAddress } from '@/lib/kakao';
import TournamentInterestStar from '@/components/mobile/TournamentInterestStar';
import { subscribeStoreActivePost, type StorePost } from '@/lib/posts';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface StoreData {
  name: string;
  address?: string;
  phone?: string;
  hours?: string;
  description?: string;
  facilities?: string[];
  photoUrls?: string[];
  lat?: number;
  lng?: number;
}

export default function MobileStorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = use(params);
  const router = useRouter();
  const authState = useAuth();
  const [store, setStore] = useState<StoreData | null | undefined>(undefined);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [tournaments, setTournaments] = useState<TournamentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [activePost, setActivePost] = useState<StorePost | null>(null);

  useEffect(() => {
    const unsub = subscribeStoreTournaments(storeId, setTournaments, () => {});
    return unsub;
  }, [storeId]);

  // 매장 데일리 홍보 — 활성(미만료, published) 최신 1건
  useEffect(() => {
    const unsub = subscribeStoreActivePost(storeId, setActivePost, () => {});
    return unsub;
  }, [storeId]);

  useEffect(() => { trackImpressionOnce(storeId, 'store-detail'); }, [storeId]);

  const [isFav, setIsFav] = useState(false);
  const [favBusy, setFavBusy] = useState(false);

  useEffect(() => {
    if (authState.status !== 'authenticated') {
      const tid = setTimeout(() => setIsFav(false), 0);
      return () => clearTimeout(tid);
    }
    const unsub = onSnapshot(
      doc(db, 'users', authState.user.uid, 'favorites', storeId),
      (snap) => setIsFav(snap.exists()),
      () => setIsFav(false),
    );
    return unsub;
  }, [authState, storeId]);

  const toggleFavorite = async () => {
    if (authState.status !== 'authenticated') {
      try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch { return; }
      return;
    }
    if (!store) return;
    setFavBusy(true);
    try {
      const favRef = doc(db, 'users', authState.user.uid, 'favorites', storeId);
      if (isFav) {
        await deleteDoc(favRef);
      } else {
        await setDoc(favRef, { storeId, storeName: store.name, notifyOnLive: true, createdAt: serverTimestamp() });
        bumpStoreMetric(storeId, 'favoriteAdds');
        if (getNotificationPermission() === 'default') {
          enableNotifications(authState.user.uid).catch(() => {});
        }
      }
    } finally {
      setFavBusy(false);
    }
  };

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, 'stores', storeId));
      setStore(snap.exists() ? (snap.data() as StoreData) : null);
    })();
  }, [storeId]);

  useEffect(() => {
    if (!store || !store.address) return;
    if (store.lat != null && store.lng != null) return;
    let cancelled = false;
    (async () => {
      try {
        const coords = await geocodeAddress(store.address!);
        if (cancelled || !coords) return;
        setStore((prev) => (prev ? { ...prev, lat: coords.lat, lng: coords.lng } : prev));
        updateDoc(doc(db, 'stores', storeId), { lat: coords.lat, lng: coords.lng }).catch(() => {});
      } catch { /* skip */ }
    })();
    return () => { cancelled = true; };
  }, [store, storeId]);

  useEffect(() => {
    const unsub = subscribeStoreLiveSessions(
      storeId,
      (items) => { setSessions(items); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, [storeId]);

  /* 로딩 스켈레톤 */
  if (store === undefined) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <div className="skeleton" style={{ aspectRatio: '3/4', width: '100%' }} />
        <div className="p-5 space-y-3">
          <div className="skeleton h-7 w-2/3 rounded-lg" />
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-4 w-4/5 rounded" />
        </div>
      </div>
    );
  }

  if (store === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-10" style={{ background: 'var(--bg)' }}>
        <div className="text-4xl">⚠️</div>
        <div className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>매장을 찾을 수 없습니다</div>
        <button
          onClick={() => router.replace('/m')}
          className="text-sm px-4 py-2 rounded-xl font-semibold transition active:scale-95"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  const photos = store.photoUrls ?? [];
  const hasPhotos = photos.length > 0;

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', paddingBottom: 80 }}>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          히어로 사진 영역 — 야놀자 스타일 큰 사진 (3:4 비율)
          헤더는 사진 위에 오버레이 (투명 그라데이션)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="relative" style={{ aspectRatio: hasPhotos ? '3/4' : '4/3' }}>

        {/* 사진 */}
        {hasPhotos ? (
          <div className="absolute inset-0 overflow-hidden">
            <img
              src={photos[photoIndex]}
              alt={`${store.name} 사진 ${photoIndex + 1}`}
              className="w-full h-full object-cover"
            />
            {/* 상단 그라데이션 (헤더 버튼 가독성) */}
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, transparent 35%, transparent 60%, rgba(0,0,0,0.55) 100%)' }}
              aria-hidden="true"
            />
          </div>
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--brand-pale) 0%, var(--surface-2) 100%)' }}
          >
            <div className="text-sm font-bold" style={{ color: 'var(--text-3)' }}>사진 미등록</div>
          </div>
        )}

        {/* 헤더 오버레이 — 뒤로/공유 */}
        <div className="absolute top-0 left-0 right-0 z-20 px-4 flex items-center justify-between" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)', height: 60 }}>
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition active:scale-90"
            style={{ background: 'rgba(255,255,255,0.90)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            aria-label="뒤로"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-1)' }} aria-hidden="true">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>

          <div className="flex items-center gap-2">
            {/* 즐겨찾기 */}
            <button
              onClick={toggleFavorite}
              disabled={favBusy}
              aria-label={isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition active:scale-90 disabled:opacity-50"
              style={{ background: isFav ? 'rgba(255,31,143,0.90)' : 'rgba(255,255,255,0.90)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill={isFav ? '#fff' : 'none'} stroke={isFav ? '#fff' : 'var(--text-1)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
            </button>
            {/* 공유 */}
            <button
              onClick={() => shareContent({ title: store.name, text: `${store.name} — HoldemNow에서 확인` })}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition active:scale-90"
              style={{ background: 'rgba(255,255,255,0.90)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
              aria-label="공유"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-1)' }} aria-hidden="true">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
            </button>
          </div>
        </div>

        {/* 사진 인디케이터 (여러 장) */}
        {photos.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-20">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={() => setPhotoIndex(i)}
                aria-label={`사진 ${i + 1}`}
                className="transition-all"
                style={{
                  width: i === photoIndex ? 20 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === photoIndex ? '#fff' : 'rgba(255,255,255,0.50)',
                }}
              />
            ))}
          </div>
        )}

        {/* 가로 스와이프 지원 */}
        {photos.length > 1 && (
          <div className="absolute inset-0 flex z-10">
            <button
              className="flex-1 h-full"
              onClick={() => setPhotoIndex((i) => Math.max(0, i - 1))}
              aria-label="이전 사진"
              style={{ background: 'transparent' }}
            />
            <button
              className="flex-1 h-full"
              onClick={() => setPhotoIndex((i) => Math.min(photos.length - 1, i + 1))}
              aria-label="다음 사진"
              style={{ background: 'transparent' }}
            />
          </div>
        )}
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          매장 정보 — 토스 스타일 흰 카드 + 강한 위계
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="px-5 py-5" style={{ borderBottom: '8px solid var(--bg-sub)' }}>
        {/* 매장 이름 + LIVE 상태 */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-[22px] font-extrabold tracking-tight leading-tight flex-1" style={{ color: 'var(--text-1)' }}>
            {store.name}
          </h1>
          {sessions.length > 0 && !loading && (
            <span className="badge-live flex-shrink-0 mt-1" style={{ fontSize: 11, padding: '4px 10px' }}>
              <span className="dot" />
              LIVE
            </span>
          )}
        </div>

        {store.description && (
          <p className="text-[14px] leading-relaxed mt-2 mb-4" style={{ color: 'var(--text-2)' }}>
            {store.description}
          </p>
        )}

        {/* 정보 박스 — 토스 스타일 */}
        <div
          className="rounded-2xl p-4 mt-3 space-y-3"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        >
          {store.address && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-3)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }} aria-hidden="true">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold mb-0.5" style={{ color: 'var(--text-3)' }}>주소</div>
                <div className="text-[13px] font-medium" style={{ color: 'var(--text-1)' }}>{store.address}</div>
              </div>
            </div>
          )}
          {store.hours && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-3)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }} aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold mb-0.5" style={{ color: 'var(--text-3)' }}>영업시간</div>
                <div className="text-[13px] font-medium" style={{ color: 'var(--text-1)' }}>{store.hours}</div>
              </div>
            </div>
          )}
          {store.phone && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-3)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }} aria-hidden="true">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012.18 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.14a16 16 0 006.29 6.29l1.41-1.41a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 15.42v1.5z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold mb-0.5" style={{ color: 'var(--text-3)' }}>전화</div>
                <div className="text-[13px] font-medium" style={{ color: 'var(--text-1)' }}>{store.phone}</div>
              </div>
            </div>
          )}
        </div>

        {/* 시설 태그 */}
        {store.facilities && store.facilities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {store.facilities.map((f) => (
              <span
                key={f}
                className="text-[12px] font-semibold rounded-full px-3 py-1"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
              >
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          CTA 버튼 — 토스 스타일 (길찾기 풀버튼 + 서브 그리드)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="px-5 py-5" style={{ borderBottom: '8px solid var(--bg-sub)' }}>
        {/* 길찾기 — 메인 CTA (토스 스타일 큰 버튼) */}
        <button
          onClick={() => { bumpStoreMetric(storeId, 'directionsClicks'); openDirections(store.name, store.address); }}
          className="w-full h-[52px] flex items-center justify-center gap-2.5 rounded-2xl font-bold text-[15px] transition active:scale-[0.98] mb-3"
          style={{ background: 'var(--text-1)', color: '#fff' }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="3 11 22 2 13 21 11 13 3 11"/>
          </svg>
          길찾기
        </button>

        {/* 서브 액션 — 전화 + 공유 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { bumpStoreMetric(storeId, 'phoneClicks'); callPhone(store.phone); }}
            disabled={!store.phone}
            aria-label={store.phone ? `전화: ${store.phone}` : '전화번호 없음'}
            className="h-12 flex items-center justify-center gap-2 rounded-2xl font-semibold text-[14px] transition active:scale-[0.97] disabled:opacity-40"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012.18 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.14a16 16 0 006.29 6.29l1.41-1.41a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 15.42v1.5z"/>
            </svg>
            전화
          </button>
          <button
            onClick={() => shareContent({ title: store.name, text: `${store.name} — HoldemNow에서 확인` })}
            className="h-12 flex items-center justify-center gap-2 rounded-2xl font-semibold text-[14px] transition active:scale-[0.97]"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            공유
          </button>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          LIVE 세션 타이머
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {loading ? (
        <div className="px-5 py-5" style={{ borderBottom: '8px solid var(--bg-sub)' }}>
          <div className="skeleton h-5 w-24 rounded mb-3" />
          <div className="skeleton h-24 rounded-2xl" />
        </div>
      ) : sessions.length === 0 ? (
        <div
          className="px-5 py-5 flex items-center gap-3"
          style={{ borderBottom: '8px solid var(--bg-sub)' }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--surface-2)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)' }} aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
          </div>
          <div>
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text-2)' }}>현재 진행 중인 LIVE 없음</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>토너 시작 시 알림을 받으려면 즐겨찾기 추가</div>
          </div>
        </div>
      ) : (
        <div className="px-5 py-5" style={{ borderBottom: '8px solid var(--bg-sub)' }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full flex-shrink-0 pulse-live" style={{ background: 'var(--live)' }} aria-hidden="true" />
            <span className="text-[14px] font-extrabold" style={{ color: 'var(--text-1)' }}>
              LIVE 진행 중{sessions.length > 1 ? ` (${sessions.length}개)` : ''}
            </span>
          </div>
          <SessionTimerGrid sessions={sessions} />
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          오늘의 홍보 — 매장이 직접 올린 24h 한정 글
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {activePost && <ActivePostCard post={activePost} />}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          예정 토너
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {tournaments.length > 0 && (
        <div className="px-5 py-5" style={{ borderBottom: '8px solid var(--bg-sub)' }}>
          <div className="flex items-center gap-2 mb-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }} aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2.5"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            <span className="text-[14px] font-extrabold" style={{ color: 'var(--text-1)' }}>
              예정 토너 ({tournaments.length})
            </span>
          </div>
          <div className="space-y-2.5">
            {tournaments.map((t) => {
              const poster = posterStyleFor(t.posterStyle);
              const d = t.startsAt.toDate();
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-2xl p-3.5"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                >
                  {/* 포스터 미니 */}
                  <div
                    className="w-10 h-12 rounded-xl flex items-center justify-center text-[9px] font-extrabold text-center p-1 flex-shrink-0 leading-tight"
                    style={{ background: poster.bg, color: poster.color }}
                  >
                    {t.name.split(' ')[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{t.name}</div>
                    <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      <span className="font-mono font-semibold" style={{ color: 'var(--text-2)' }}>
                        {d.getMonth() + 1}/{d.getDate()} {hh}:{mm}
                      </span>
                      {' '}· 바이인 ₩{t.buyIn.toLocaleString()}
                    </div>
                  </div>
                  {t.guarantee > 0 && (
                    <div
                      className="text-[10px] font-extrabold rounded-full px-2 py-1 flex-shrink-0"
                      style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--gold)' }}
                    >
                      GTD {(t.guarantee / 10000).toFixed(0)}만
                    </div>
                  )}
                  <TournamentInterestStar tournament={t} size="sm" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          위치 미니맵
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {store.lat != null && store.lng != null && (
        <div className="px-5 py-5">
          <div className="flex items-center gap-2 mb-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }} aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span className="text-[14px] font-extrabold" style={{ color: 'var(--text-1)' }}>위치</span>
          </div>
          <StoreMiniMap lat={store.lat} lng={store.lng} name={store.name} />
          {store.address && (
            <div className="text-[12px] mt-2" style={{ color: 'var(--text-3)' }}>{store.address}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 미니맵 — 라이트 테두리
 * ========================================================== */
function StoreMiniMap({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadKakaoMaps();
        if (cancelled || !containerRef.current || mapRef.current) return;
        const center = new maps.LatLng(lat, lng);
        mapRef.current = new maps.Map(containerRef.current, { center, level: 3 });
        const zoomControl = new maps.ZoomControl();
        mapRef.current.addControl(zoomControl, maps.ControlPosition.TOPRIGHT);
        markerRef.current = new maps.Marker({
          position: center, map: mapRef.current,
          image: buildNameBadgeMarker(maps, name), title: name,
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng, name]);

  useEffect(() => {
    const maps = (window as Window & { kakao?: { maps: any } }).kakao?.maps;
    if (!mapRef.current || !maps) return;
    const pos = new maps.LatLng(lat, lng);
    mapRef.current.setCenter(pos);
    if (markerRef.current) markerRef.current.setPosition(pos);
  }, [lat, lng]);

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height: 200, borderRadius: 'var(--r-xl)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
          지도 로드 실패
        </div>
      )}
    </div>
  );
}

function buildNameBadgeMarker(maps: any, name: string) {
  const widthOf = (s: string) => Array.from(s).reduce((sum, ch) => sum + (/[ -~]/.test(ch) ? 8 : 13), 0);
  const PAD_X = 14, TAIL_H = 8, PILL_H = 28;
  const width = Math.max(60, widthOf(name) + PAD_X * 2);
  const height = PILL_H + TAIL_H;
  const cx = width / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0.5" y="0.5" width="${width-1}" height="${PILL_H-1}" rx="${PILL_H/2}" fill="#FF1F8F" stroke="#CC1072" stroke-width="1.5"/><text x="${cx}" y="${PILL_H/2+5}" fill="#fff" font-family="Pretendard,Inter,system-ui,-apple-system,sans-serif" font-size="12" font-weight="800" text-anchor="middle">${escapeSvg(name)}</text><polygon points="${cx-6},${PILL_H} ${cx+6},${PILL_H} ${cx},${PILL_H+TAIL_H}" fill="#FF1F8F" stroke="#CC1072" stroke-width="1.5"/></svg>`;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return new maps.MarkerImage(url, new maps.Size(width, height), { offset: new maps.Point(cx, height) });
}

function escapeSvg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ============================================================
 * 세션 타이머 그리드 — 라이트 카드
 * ========================================================== */
function SessionTimerGrid({ sessions }: { sessions: LiveSession[] }) {
  const cols = sessions.length === 1 ? 1 : sessions.length === 2 ? 2 : 3;
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {sessions.map((s) => <TimerCard key={s.id} session={s} cols={cols} />)}
    </div>
  );
}

function TimerCard({ session, cols }: { session: LiveSession; cols: number }) {
  const sizes = {
    1: { timer: 48, name: 15, meta: 12, p: '20px' },
    2: { timer: 32, name: 13, meta: 11, p: '14px' },
    3: { timer: 22, name: 11, meta: 10, p: '10px' },
  } as const;
  const sz = sizes[cols as 1 | 2 | 3];
  const sec = useLiveCountdown(session);
  const paused = session.status === 'paused';
  const ready = session.status === 'ready';
  const lowTime = sec <= 10 && !paused && !ready;
  const lateMin = computeLateRegMinutes(session, sec);
  const readyLeft = ready ? Math.max(0, computeReadyExpirySec(session) ?? 0) : 0;

  return (
    <Link
      href={`/m/live/${session.id}`}
      className="block rounded-2xl transition active:scale-[0.98]"
      style={{
        background: ready
          ? 'rgba(59,130,246,0.06)'
          : paused
            ? 'rgba(245,158,11,0.06)'
            : lowTime
              ? 'rgba(229,62,62,0.06)'
              : 'var(--surface-2)',
        border: `1px solid ${ready ? 'rgba(59,130,246,0.25)' : paused ? 'rgba(245,158,11,0.20)' : lowTime ? 'rgba(229,62,62,0.20)' : 'var(--border)'}`,
        padding: sz.p,
      }}
    >
      {/* 상태 라벨 */}
      <div className="flex items-center gap-1 mb-1">
        {ready ? (
          <span className="text-[9px] font-extrabold tracking-wider" style={{ color: '#2563eb' }}>⏳ 곧 게임 시작</span>
        ) : paused ? (
          <span className="text-[9px] font-extrabold tracking-wider" style={{ color: 'var(--gold)' }}>⏸ 일시정지</span>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 pulse-live" style={{ background: 'var(--live)' }} aria-hidden="true" />
            <span className="text-[9px] font-extrabold tracking-wider" style={{ color: 'var(--live)' }}>LIVE</span>
          </>
        )}
      </div>
      {/* 토너 이름 */}
      <div className="font-bold truncate" style={{ fontSize: sz.name, color: 'var(--text-1)' }}>
        {session.tournamentName}
      </div>
      {/* 카운트다운 — ready면 시작 만료까지 시간, 그 외엔 현재 레벨 남은 시간 */}
      <div
        className="font-mono font-extrabold leading-none mt-1.5"
        style={{
          fontSize: sz.timer,
          letterSpacing: '-0.03em',
          color: ready ? '#2563eb' : lowTime ? 'var(--live)' : paused ? 'var(--gold)' : 'var(--text-1)',
        }}
      >
        {ready ? fmtTime(readyLeft) : fmtTime(sec)}
      </div>
      {/* 메타 */}
      <div className="mt-1.5" style={{ fontSize: sz.meta, color: 'var(--text-3)' }}>
        {ready ? (
          <span>{cols === 1 ? '시작 대기 — 만료까지 ' : ''}자동 취소까지</span>
        ) : (
          <>
            Lv {session.currentLevel} · {session.playersRemaining}명
            {cols === 1 && (
              <span> · {session.lateRegClosed ? '등록 마감' : `등록 ${lateMin}분`}</span>
            )}
          </>
        )}
      </div>
    </Link>
  );
}

/* ============================================================
 * 오늘의 홍보 카드 — 매장이 직접 올린 24h 한정 글
 * ========================================================== */
function ActivePostCard({ post }: { post: StorePost }) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const expMs = post.expiresAt?.toMillis() ?? 0;
  const hoursLeft = expMs > Date.now() ? Math.max(0, Math.floor((expMs - Date.now()) / (60 * 60 * 1000))) : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setPhotoIdx(Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const openLink = () => post.ctaUrl && window.open(post.ctaUrl, '_blank', 'noopener,noreferrer');

  return (
    <div className="px-5 py-5" style={{ borderBottom: '8px solid var(--bg-sub)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[16px]" aria-hidden="true">📢</span>
        <span className="text-[14px] font-extrabold" style={{ color: 'var(--text-1)' }}>오늘의 홍보</span>
        <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(255,31,143,0.10)', color: 'var(--brand)' }}>
          {hoursLeft}시간 남음
        </span>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
        {post.imageUrls.length > 0 && (
          <div className="relative">
            <div ref={scrollRef} className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none" style={{ aspectRatio: '4/3' }}>
              {post.imageUrls.map((url, i) => (
                <div key={url} className="w-full flex-shrink-0 snap-center" style={{ background: 'var(--surface-2)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`${i + 1}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
            {post.imageUrls.length > 1 && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white text-[10px] font-bold rounded-full px-2 py-1" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
                {photoIdx + 1} / {post.imageUrls.length}
              </div>
            )}
          </div>
        )}
        <div className="px-4 py-4">
          <div className="text-[14px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>{post.body}</div>
          {post.eventTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {post.eventTags.slice(0, 8).map((t) => (
                <span key={t} className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(255,31,143,0.10)', color: 'var(--brand)' }}>#{t}</span>
              ))}
            </div>
          )}
          {post.ctaUrl && (
            <button
              onClick={openLink}
              className="mt-4 w-full py-3 rounded-xl bg-black text-white font-bold text-[13px] flex items-center justify-center gap-1.5 active:opacity-80"
            >
              <span>{post.ctaLabel || '자세히 보기'}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
