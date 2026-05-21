'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import PendingStoreNotice from '@/components/mobile/PendingStoreNotice';
import { subscribeStoreLiveSessions, type LiveSession, fmtTime, computeLateRegMinutes, useLiveTimelineTick, computeReadyExpirySec, computeFinishingGraceSec } from '@/lib/live';
import { subscribeStoreTournaments, type TournamentInstance } from '@/lib/tournaments';
import { posterStyleFor, fmtBuyInTicketsMobile } from '@/lib/templates';
import { callPhone, openDirections, shareContent } from '@/lib/actions';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { enableNotifications, getNotificationPermission } from '@/lib/messaging';
import { loadKakaoMaps, geocodeAddress } from '@/lib/kakao';
import TournamentInterestStar from '@/components/mobile/TournamentInterestStar';
import { subscribeStoreActivePost, type StorePost } from '@/lib/posts';
import {
  type UsedListing,
  USED_CATEGORY_LABELS,
  formatUsedPrice,
  subscribeStoreUsedListings,
} from '@/lib/community';
import {
  subscribeStoreReviews,
  deleteReview,
  formatRating,
  hasReportedReview,
  type Review,
} from '@/lib/reviews';
import ReviewWriteSheet from '@/components/mobile/ReviewWriteSheet';
import ReportReviewSheet from '@/components/mobile/ReportReviewSheet';
import ReservationSheet from '@/components/mobile/ReservationSheet';
import { recordRecentVisit } from '@/lib/recentVisits';

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
  status?: 'pending' | 'active' | 'rejected' | 'suspended';
  isDemo?: boolean;
  ownerUid?: string;
  reviewCount?: number;
  averageRating?: number;
  ratingDistribution?: { '1'?: number; '2'?: number; '3'?: number; '4'?: number; '5'?: number };
}

export default function MobileStorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = use(params);
  const router = useRouter();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  const isPlatformAdmin = hasRole(userDoc, 'platform_admin');
  const [store, setStore] = useState<StoreData | null | undefined>(undefined);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [tournaments, setTournaments] = useState<TournamentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [activePost, setActivePost] = useState<StorePost | null>(null);
  const [usedListings, setUsedListings] = useState<UsedListing[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewWriteOpen, setReviewWriteOpen] = useState(false);
  const [reviewEditing, setReviewEditing] = useState<Review | null>(null);
  const [reviewsExpanded, setReviewsExpanded] = useState(false);
  const [reportTarget, setReportTarget] = useState<Review | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [reservationOpen, setReservationOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeStoreTournaments(storeId, setTournaments, () => {});
    return unsub;
  }, [storeId]);

  // 매장 데일리 홍보 — 활성(미만료, published) 최신 1건
  useEffect(() => {
    const unsub = subscribeStoreActivePost(storeId, setActivePost, () => {});
    return unsub;
  }, [storeId]);

  // 이 매장 중고 판매 중 (최대 5개)
  useEffect(() => {
    const unsub = subscribeStoreUsedListings(storeId, setUsedListings, () => {});
    return unsub;
  }, [storeId]);

  useEffect(() => { trackImpressionOnce(storeId, 'store-detail'); }, [storeId]);

  // 최근 방문 기록 — 매장 데이터가 로드된 후 1회 기록
  useEffect(() => {
    if (!store) return;
    recordRecentVisit({
      storeId,
      storeName: store.name,
      photoUrl: store.photoUrls?.[0],
      visitedAt: new Date().toISOString(),
    });
  // store.name/photoUrls가 바뀌면 재기록하지 않도록 storeId만 의존
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, store?.name]);

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
    // 매장 doc 구독 — Cloud Function이 갱신하는 reviewCount/averageRating/ratingDistribution
    // 등의 집계 필드가 실시간 반영되도록.
    const unsub = onSnapshot(
      doc(db, 'stores', storeId),
      (snap) => setStore(snap.exists() ? (snap.data() as StoreData) : null),
      () => setStore(null),
    );
    return unsub;
  }, [storeId]);

  // 매장 리뷰 구독
  useEffect(() => {
    setReviewsLoading(true);
    const unsub = subscribeStoreReviews(
      storeId,
      (items) => { setReviews(items); setReviewsLoading(false); },
      () => setReviewsLoading(false),
    );
    return unsub;
  }, [storeId]);

  // 신고한 리뷰 ID 집합 — 본인이 이미 신고한 리뷰 표시용
  useEffect(() => {
    const uid = authState.status === 'authenticated' ? authState.user.uid : null;
    if (!uid || reviews.length === 0) {
      setReportedIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const next = new Set<string>();
      await Promise.all(
        reviews.map(async (r) => {
          if (r.authorUid === uid) return; // 본인 리뷰는 조회 skip
          try {
            const reported = await hasReportedReview(storeId, r.id, uid);
            if (reported) next.add(r.id);
          } catch { /* ignore */ }
        }),
      );
      if (!cancelled) setReportedIds(next);
    })();
    return () => { cancelled = true; };
  }, [authState, reviews, storeId]);

  // 토스트 자동 해제
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

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
        <div className="skeleton" style={{ aspectRatio: '16/9', width: '100%' }} />
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

  // 본사 미승인 매장 — owner 본인 또는 platform_admin이 아니면 안내 화면만 노출
  const currentUid = authState.status === 'authenticated' ? authState.user.uid : null;
  const isOwner = !!currentUid && store.ownerUid === currentUid;
  const isVisible = store.status === 'active' || store.isDemo === true || isOwner || isPlatformAdmin;
  if (!isVisible) {
    return <PendingStoreNotice />;
  }

  const photos = store.photoUrls ?? [];
  const hasPhotos = photos.length > 0;

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', paddingBottom: 80 }}>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          히어로 사진 영역 — 가로형 사진 (16:9 비율)
          헤더는 사진 위에 오버레이 (투명 그라데이션)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="relative" style={{ aspectRatio: '16/9' }}>

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
          CTA 버튼 — 예약하기+길찾기 상단 / 전화+공유 하단
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="px-5 py-5" style={{ borderBottom: '8px solid var(--bg-sub)' }}>
        {/* 메인 CTA — 예약하기 (좌) + 길찾기 (우) */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {/* 예약하기 */}
          <button
            onClick={() => {
              if (!currentUid) {
                signInWithPopup(auth, new GoogleAuthProvider()).catch(() => {});
                return;
              }
              setReservationOpen(true);
            }}
            className="h-[52px] flex items-center justify-center gap-2 rounded-2xl font-bold text-[15px] transition active:scale-[0.98] text-white"
            style={{
              background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BB5 100%)',
              boxShadow: '0 4px 14px rgba(255,31,143,0.30)',
            }}
            aria-label={currentUid ? `${store.name} 예약하기` : '로그인하고 예약하기'}
          >
            <span aria-hidden="true" style={{ fontSize: 17 }}>📅</span>
            {currentUid ? '예약하기' : '로그인 후 예약'}
          </button>
          {/* 길찾기 */}
          <button
            onClick={() => { bumpStoreMetric(storeId, 'directionsClicks'); openDirections(store.name, store.address); }}
            className="h-[52px] flex items-center justify-center gap-2.5 rounded-2xl font-bold text-[15px] transition active:scale-[0.98]"
            style={{ background: 'var(--text-1)', color: '#fff' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="3 11 22 2 13 21 11 13 3 11"/>
            </svg>
            길찾기
          </button>
        </div>

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
          이 매장 판매 중 — 중고거래 가로 스크롤 (최대 5개)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {usedListings.length > 0 && (
        <div className="py-5" style={{ borderBottom: '8px solid var(--bg-sub)' }}>
          <div className="flex items-center justify-between px-5 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-extrabold" style={{ color: 'var(--text-1)' }}>이 매장 판매 중</span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(255,31,143,0.10)', color: '#FF1F8F' }}
              >
                {usedListings.length}
              </span>
            </div>
            <Link
              href="/m/community/used"
              className="text-[12px] font-bold"
              style={{ color: 'var(--text-3)' }}
            >
              전체 보기
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-none px-5">
            {usedListings.map((item) => (
              <Link
                key={item.id}
                href={`/m/community/used/${item.id}`}
                className="flex-shrink-0 w-36 rounded-2xl overflow-hidden transition active:scale-[0.98]"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}
              >
                {/* 이미지 */}
                <div
                  className="w-full aspect-square flex items-center justify-center text-3xl"
                  style={{ background: 'var(--surface-2)' }}
                >
                  {item.images?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.images[0]} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <span aria-hidden="true">
                      {item.category === 'chip' ? '🪙' : item.category === 'card' ? '🃏' : item.category === 'timer' ? '⏱' : '📦'}
                    </span>
                  )}
                </div>
                {/* 정보 */}
                <div className="p-2">
                  <div className="text-[9px] font-bold mb-0.5" style={{ color: 'var(--text-3)' }}>
                    {USED_CATEGORY_LABELS[item.category]}
                  </div>
                  <p className="text-[12px] font-bold leading-tight line-clamp-2" style={{ color: 'var(--text-1)' }}>
                    {item.title}
                  </p>
                  <p className="text-[12px] font-extrabold mt-1" style={{ color: '#FF1F8F' }}>
                    {formatUsedPrice(item.price, item.priceNegotiable)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          리뷰 섹션
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <ReviewsSection
        storeId={storeId}
        storeName={store.name}
        reviewCount={store.reviewCount ?? 0}
        averageRating={store.averageRating ?? 0}
        ratingDistribution={store.ratingDistribution}
        reviews={reviews}
        loading={reviewsLoading}
        expanded={reviewsExpanded}
        onToggleExpand={() => setReviewsExpanded((v) => !v)}
        currentUid={currentUid}
        onWriteClick={() => {
          if (!currentUid) {
            // 비로그인 — 구글 로그인으로 유도
            signInWithPopup(auth, new GoogleAuthProvider()).catch(() => {});
            return;
          }
          setReviewEditing(null);
          setReviewWriteOpen(true);
        }}
        onReserveClick={() => {
          if (!currentUid) {
            signInWithPopup(auth, new GoogleAuthProvider()).catch(() => {});
            return;
          }
          setReservationOpen(true);
        }}
        onEdit={(r) => { setReviewEditing(r); setReviewWriteOpen(true); }}
        onDelete={(r) => {
          if (!window.confirm('리뷰를 삭제할까요?')) return;
          deleteReview(storeId, r.id).catch((e) => alert(e instanceof Error ? e.message : String(e)));
        }}
        onReport={(r) => {
          if (!currentUid) {
            signInWithPopup(auth, new GoogleAuthProvider()).catch(() => {});
            return;
          }
          setReportTarget(r);
        }}
        reportedIds={reportedIds}
      />

      {reviewWriteOpen && currentUid && (
        <ReviewWriteSheet
          storeId={storeId}
          storeName={store.name}
          authorUid={currentUid}
          authorName={authState.status === 'authenticated' ? (authState.user.displayName ?? authState.user.email ?? '플레이어') : '플레이어'}
          existingReview={reviewEditing}
          onClose={() => { setReviewWriteOpen(false); setReviewEditing(null); }}
        />
      )}

      {/* 예약 신청 시트 */}
      {reservationOpen && currentUid && (
        <ReservationSheet
          storeId={storeId}
          storeName={store.name}
          authorUid={currentUid}
          authorName={authState.status === 'authenticated' ? (authState.user.displayName ?? authState.user.email ?? '플레이어') : '플레이어'}
          defaultPhone={(userDoc as { phone?: string } | null)?.phone ?? ''}
          onClose={() => setReservationOpen(false)}
        />
      )}

      {/* 리뷰 신고 시트 */}
      {reportTarget && currentUid && (
        <ReportReviewSheet
          open={true}
          storeId={storeId}
          reviewId={reportTarget.id}
          uid={currentUid}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => {
            const id = reportTarget.id;
            setReportedIds((prev) => {
              const next = new Set(prev);
              next.add(id);
              return next;
            });
            setToast('신고가 접수되었습니다. 검토 후 처리됩니다');
          }}
        />
      )}

      {/* 신고 토스트 */}
      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-2xl text-[13px] font-bold text-white"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
            background: 'rgba(20,20,20,0.92)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.30)',
            backdropFilter: 'blur(8px)',
            maxWidth: 'calc(100vw - 32px)',
          }}
          role="status"
          aria-live="polite"
        >
          {toast}
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
  const gap = cols === 1 ? 'gap-3' : cols === 2 ? 'gap-2.5' : 'gap-2';
  return (
    <div className={`grid ${gap}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {sessions.map((s) => <TimerCard key={s.id} session={s} cols={cols} />)}
    </div>
  );
}

/** 포스터 컬러 박스 — 토너 정체성 시각화 */
function PosterBadge({ session, size }: { session: LiveSession; size: 'lg' | 'md' }) {
  const poster = posterStyleFor(session.posterStyle);
  const firstWord = (session.tournamentName || '').split(' ')[0] || '';
  const dims = size === 'lg'
    ? { w: 64, h: 80, fs: 11, radius: 14 }
    : { w: 44, h: 56, fs: 9, radius: 12 };
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center font-extrabold text-center leading-tight"
      style={{
        width: dims.w,
        height: dims.h,
        background: poster.bg,
        color: poster.color,
        fontSize: dims.fs,
        borderRadius: dims.radius,
        padding: 4,
        boxShadow: '0 1px 3px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      {firstWord.slice(0, 6)}
    </div>
  );
}

function TimerCard({ session, cols }: { session: LiveSession; cols: number }) {
  const tick = useLiveTimelineTick(session);
  const sec = tick?.secondsLeft ?? 0;
  const liveLevel = tick?.level ?? session.currentLevel;
  const sb = tick?.sb ?? session.smallBlind;
  const bb = tick?.bb ?? session.bigBlind;
  const ante = tick?.ante ?? session.ante;

  const paused = session.status === 'paused';
  const ready = session.status === 'ready';
  const lowTime = sec <= 10 && !paused && !ready && session.status !== 'completed';
  const lateMin = computeLateRegMinutes(session, sec);
  const readyLeft = ready ? Math.max(0, computeReadyExpirySec(session) ?? 0) : 0;
  const finishingLeft = computeFinishingGraceSec(session);
  const finishing = !ready && !paused && finishingLeft !== null && finishingLeft >= 0;

  // 다음 블라인드 — 잠긴 구조 우선
  const structureForNext = (session.blindStructureLocked && session.blindStructureLocked.length > 0)
    ? session.blindStructureLocked
    : session.blindStructure;
  const currentLevelDef = structureForNext?.find((l) => l.level === liveLevel);
  const nextBlind = structureForNext?.find((l) => l.level === liveLevel + 1 && !l.isBreak);
  const levelDurationSec = Math.max(1, currentLevelDef?.durationSec ?? 600);

  // 레벨 진행률 (0~100) — 흐른 비율
  const levelProgress = ready
    ? 0
    : paused
      ? Math.max(0, Math.min(100, 100 - (sec / levelDurationSec) * 100))
      : Math.max(0, Math.min(100, 100 - (sec / levelDurationSec) * 100));

  // 잔여 인원 비율 (0~100)
  const total = Math.max(1, session.totalPlayers || 0);
  const remaining = Math.max(0, session.playersRemaining || 0);
  const survivePct = Math.max(0, Math.min(100, (remaining / total) * 100));

  // ── 참가 가능/마감 판정 (홈의 PrimaryLiveCard와 동일 정책)
  // 마감: lateRegClosed === true || currentLevel > lateRegEndLevel
  // 가능: 마감이 아니면서 lateMin > 0 (분 단위로 남았을 때만 "가능"으로 노출)
  const isLateRegClosed =
    session.lateRegClosed === true ||
    (typeof session.lateRegEndLevel === 'number' && liveLevel > session.lateRegEndLevel);
  const isLateRegOpen = !isLateRegClosed && lateMin > 0;

  // 등록 임박 (5분 이하) — 시각적으로 "지금 가야 함" 강조
  const lateRegUrgent = isLateRegOpen && lateMin <= 5;

  // 상태별 컬러 토큰
  const accent = ready
    ? '#2563eb'
    : paused
      ? 'var(--gold)'
      : lowTime || finishing
        ? 'var(--live)'
        : 'var(--text-1)';

  const tintBg = ready
    ? 'rgba(59,130,246,0.06)'
    : paused
      ? 'rgba(245,158,11,0.06)'
      : finishing
        ? 'rgba(229,62,62,0.08)'
        : lowTime
          ? 'rgba(229,62,62,0.06)'
          : 'var(--surface-2)';

  const tintBorder = ready
    ? 'rgba(59,130,246,0.28)'
    : paused
      ? 'rgba(245,158,11,0.24)'
      : finishing
        ? 'rgba(229,62,62,0.36)'
        : lowTime
          ? 'rgba(229,62,62,0.22)'
          : 'var(--border)';

  // 진행률 막대 색
  const barColor = lowTime || finishing
    ? 'var(--live)'
    : paused
      ? 'var(--gold)'
      : 'var(--brand)';

  const statusBadge = ready ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[9px] font-extrabold tracking-wider"
      style={{ background: 'rgba(59,130,246,0.12)', color: '#2563eb' }}>
      <span>READY</span>
    </span>
  ) : paused ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[9px] font-extrabold tracking-wider"
      style={{ background: 'rgba(245,158,11,0.14)', color: 'var(--gold)' }}>
      <span>PAUSED</span>
    </span>
  ) : finishing ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[9px] font-extrabold tracking-wider"
      style={{ background: 'rgba(229,62,62,0.14)', color: 'var(--live)' }}>
      <span className="w-1.5 h-1.5 rounded-full pulse-live" style={{ background: 'var(--live)' }} aria-hidden="true" />
      <span>곧 종료</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[9px] font-extrabold tracking-wider"
      style={{ background: 'rgba(229,62,62,0.14)', color: 'var(--live)' }}>
      <span className="w-1.5 h-1.5 rounded-full pulse-live" style={{ background: 'var(--live)' }} aria-hidden="true" />
      <span>LIVE</span>
    </span>
  );

  // ── 참가 가능/마감 뱃지 — 한눈에 예약 판단
  //   · 녹색(에메랄드) = 참가 가능
  //   · 회색 = 참가 마감
  // 라이트 톤 + 단단한 컬러 토큰. ready/paused는 LIVE 상태 자체가 우선이라 노출하지 않음.
  const entryBadge = ready || paused
    ? null
    : isLateRegOpen ? (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[9px] font-extrabold tracking-wide"
          style={{
            background: lateRegUrgent ? 'rgba(229,62,62,0.14)' : 'rgba(16,185,129,0.14)',
            color: lateRegUrgent ? 'var(--live)' : '#059669',
          }}
          aria-label={lateRegUrgent ? `참가 마감 임박 ${lateMin}분` : '참가 가능'}
        >
          {lateRegUrgent ? '마감 임박' : '참가 가능'}
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[9px] font-extrabold tracking-wide"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
          aria-label="참가 마감"
        >
          참가 마감
        </span>
      );

  // ─────────────────────────────────────────────
  // 3열 — 컴팩트 카드
  // ─────────────────────────────────────────────
  if (cols === 3) {
    const poster = posterStyleFor(session.posterStyle);
    return (
      <Link
        href={`/m/live/${session.id}`}
        className="relative block rounded-2xl overflow-hidden transition active:scale-[0.97]"
        style={{
          background: tintBg,
          border: `1px solid ${tintBorder}`,
          padding: '10px 10px 8px',
        }}
      >
        {/* 좌측 포스터 컬러 라인 (3열엔 라인만) */}
        <div className="absolute left-0 top-0 bottom-0" style={{ width: 3, background: poster.bg }} aria-hidden="true" />
        <div className="flex items-center justify-between mb-1 pl-1.5">
          {statusBadge}
          <span className="font-mono text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>
            Lv{liveLevel}
          </span>
        </div>
        {/* 참가 가능/마감 뱃지 — 한 줄 분리. 3열 폭에서 status 옆에 두기엔 좁아서 별도 라인 */}
        {entryBadge && (
          <div className="mb-1 pl-1.5">{entryBadge}</div>
        )}
        <div className="font-bold truncate pl-1.5" style={{ fontSize: 11, color: 'var(--text-1)' }}>
          {session.tournamentName}
        </div>
        <div
          className={`font-mono font-extrabold leading-none mt-1 pl-1.5 ${lowTime ? 'animate-pulse' : ''}`}
          style={{ fontSize: 22, letterSpacing: '-0.03em', color: accent }}
        >
          {ready ? fmtTime(readyLeft) : fmtTime(sec)}
        </div>
        {/* 진행률 막대 */}
        <div className="mt-1.5 pl-1.5 pr-0.5">
          <div className="w-full rounded-full overflow-hidden" style={{ height: 3, background: 'var(--surface-3, rgba(0,0,0,0.06))' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${levelProgress}%`, background: barColor }}
              aria-hidden="true"
            />
          </div>
        </div>
        <div className="mt-1.5 pl-1.5 flex items-center gap-1.5" style={{ fontSize: 10, color: 'var(--text-3)' }}>
          <span className="font-mono font-semibold" style={{ color: 'var(--text-2)' }}>
            {sb.toLocaleString()}/{bb.toLocaleString()}
          </span>
          <span>·</span>
          <span>{remaining}/{total}</span>
        </div>
      </Link>
    );
  }

  // ─────────────────────────────────────────────
  // 2열 — 중간 카드
  // ─────────────────────────────────────────────
  if (cols === 2) {
    return (
      <Link
        href={`/m/live/${session.id}`}
        className="block rounded-2xl overflow-hidden transition active:scale-[0.98]"
        style={{
          background: tintBg,
          border: `1px solid ${tintBorder}`,
          padding: 12,
        }}
      >
        <div className="flex items-start gap-2.5">
          <PosterBadge session={session} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <div className="flex items-center gap-1 min-w-0">
                {statusBadge}
                {entryBadge}
              </div>
              <span className="font-mono text-[10px] font-bold flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                Lv {liveLevel}
              </span>
            </div>
            <div className="font-bold truncate" style={{ fontSize: 13, color: 'var(--text-1)' }}>
              {session.tournamentName}
            </div>
            <div
              className={`font-mono font-extrabold leading-none mt-1.5 ${lowTime ? 'animate-pulse' : ''}`}
              style={{ fontSize: 30, letterSpacing: '-0.03em', color: accent }}
            >
              {ready ? fmtTime(readyLeft) : fmtTime(sec)}
            </div>
          </div>
        </div>

        {/* 진행률 막대 */}
        <div className="mt-2.5">
          <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: 'var(--surface-3, rgba(0,0,0,0.06))' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${ready ? 0 : levelProgress}%`, background: barColor }}
              aria-hidden="true"
            />
          </div>
        </div>

        {/* 메트릭 2x2 — 상금 제거. 등록(레지) 상태가 사용자 의사결정에 더 직접적.
            우선순위: 블라인드 → 인원 → 다음 블라인드 → 등록 */}
        <div className="grid grid-cols-2 gap-1.5 mt-2.5">
          <MetricCell
            label="블라인드"
            value={`${sb.toLocaleString()}/${bb.toLocaleString()}`}
            sub={ante > 0 ? `ante ${ante.toLocaleString()}` : ''}
          />
          <MetricCell
            label="인원"
            value={`${remaining}/${total}`}
            sub={`${Math.round(survivePct)}% 생존`}
          />
          <MetricCell
            label="다음 블라인드"
            value={nextBlind ? `${nextBlind.sb.toLocaleString()}/${nextBlind.bb.toLocaleString()}` : '최종'}
            sub={nextBlind ? `Lv ${liveLevel + 1}` : ''}
          />
          <MetricCell
            label="등록"
            value={isLateRegClosed ? '마감' : `${lateMin}분`}
            sub={isLateRegClosed ? '' : (lateRegUrgent ? '마감 임박' : '남음')}
            accent={isLateRegClosed ? 'muted' : (lateRegUrgent ? 'urgent' : 'positive')}
          />
        </div>
      </Link>
    );
  }

  // ─────────────────────────────────────────────
  // 1열 — Hero 큰 카드
  // ─────────────────────────────────────────────
  return (
    <Link
      href={`/m/live/${session.id}`}
      className="block rounded-2xl overflow-hidden transition active:scale-[0.99]"
      style={{
        background: tintBg,
        border: `1px solid ${tintBorder}`,
        padding: 16,
        boxShadow: finishing || lowTime
          ? '0 0 0 1px rgba(229,62,62,0.10), 0 6px 18px -8px rgba(229,62,62,0.25)'
          : '0 1px 2px rgba(0,0,0,0.03)',
      }}
    >
      {/* 헤더 — 포스터 + 토너명/배지 */}
      <div className="flex items-start gap-3">
        <PosterBadge session={session} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-1.5 mb-1">
            {statusBadge}
            {entryBadge}
            {ready && (
              <span className="text-[10px] font-semibold" style={{ color: 'var(--text-3)' }}>
                · 시작 대기
              </span>
            )}
          </div>
          <div className="font-extrabold truncate" style={{ fontSize: 16, color: 'var(--text-1)', lineHeight: 1.2 }}>
            {session.tournamentName}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {(() => {
              const t = fmtBuyInTicketsMobile(session.buyIn || 0);
              return t ? `바이인 ${t}` : '바이인 –';
            })()}
            {' · '}Lv {liveLevel}
            {' / '}{structureForNext?.length ?? '–'}
          </div>
        </div>
      </div>

      {/* 타이머 + 진행률 */}
      <div className="mt-3 flex items-end gap-3">
        <div
          className={`font-mono font-extrabold leading-none ${lowTime ? 'animate-pulse' : ''}`}
          style={{ fontSize: 48, letterSpacing: '-0.04em', color: accent }}
        >
          {ready ? fmtTime(readyLeft) : fmtTime(sec)}
        </div>
        <div className="flex-1 pb-1.5">
          <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: 'var(--text-3)' }}>
            <span className="font-semibold">
              {ready ? '자동 취소 만료' : paused ? '일시정지 중' : finishing ? '곧 종료' : '레벨 진행률'}
            </span>
            <span className="font-mono font-bold" style={{ color: 'var(--text-2)' }}>
              {ready ? '–' : `${Math.round(levelProgress)}%`}
            </span>
          </div>
          <div className="w-full rounded-full overflow-hidden" style={{ height: 6, background: 'var(--surface-3, rgba(0,0,0,0.06))' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${ready ? 0 : levelProgress}%`, background: barColor }}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      {/* 4분할 메트릭 — 상금풀 제거. 등록(레지) 상태를 별도 셀로 격상해
          "지금 가야 하나" 판단을 가장 직접적으로 지원. 컬러는 가능=초록, 임박=빨강, 마감=회색. */}
      <div className="grid grid-cols-4 gap-1.5 mt-3">
        <MetricCell
          label="블라인드"
          value={`${sb.toLocaleString()}/${bb.toLocaleString()}`}
          sub={ante > 0 ? `ante ${ante.toLocaleString()}` : '—'}
        />
        <MetricCell
          label="다음 블라인드"
          value={nextBlind ? `${nextBlind.sb.toLocaleString()}/${nextBlind.bb.toLocaleString()}` : '최종'}
          sub={nextBlind ? `Lv ${liveLevel + 1}` : '마지막 레벨'}
        />
        <MetricCell
          label="인원"
          value={`${remaining}/${total}`}
          sub={`${Math.round(survivePct)}% 생존`}
        />
        <MetricCell
          label="등록"
          value={isLateRegClosed ? '마감' : `${lateMin}분`}
          sub={isLateRegClosed ? '재참가 불가' : (lateRegUrgent ? '마감 임박' : '남음')}
          accent={isLateRegClosed ? 'muted' : (lateRegUrgent ? 'urgent' : 'positive')}
        />
      </div>
    </Link>
  );
}

/** 메트릭 셀 — 2/4분할 grid 공용.
 *  accent: 'positive' (참가 가능: 에메랄드) | 'urgent' (마감 임박: 라이브 레드) | 'muted' (마감/종료: 회색).
 *  기본은 무채색. 등록 셀에서 상태 즉각 인지용. */
function MetricCell({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'positive' | 'urgent' | 'muted';
}) {
  const styled =
    accent === 'positive'
      ? { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.32)', valueColor: '#059669' }
      : accent === 'urgent'
        ? { bg: 'rgba(229,62,62,0.08)', border: 'rgba(229,62,62,0.32)', valueColor: 'var(--live)' }
        : accent === 'muted'
          ? { bg: 'var(--surface-2)', border: 'var(--border)', valueColor: 'var(--text-3)' }
          : { bg: 'var(--surface-1)', border: 'var(--border)', valueColor: 'var(--text-1)' };
  return (
    <div
      className="rounded-xl px-2 py-1.5 min-w-0"
      style={{
        background: styled.bg,
        border: `1px solid ${styled.border}`,
      }}
    >
      <div className="text-[9px] font-extrabold tracking-wider uppercase truncate" style={{ color: 'var(--text-3)' }}>
        {label}
      </div>
      <div className="font-mono font-extrabold truncate" style={{ fontSize: 13, color: styled.valueColor, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {sub ? (
        <div className="text-[9px] font-semibold truncate" style={{ color: 'var(--text-3)' }}>
          {sub}
        </div>
      ) : null}
    </div>
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

/* ============================================================
 * 리뷰 섹션 — 별점 분포 + 작성 CTA + 리스트
 * ========================================================== */
const REVIEWS_INITIAL_COUNT = 5;

function ReviewsSection({
  storeId,
  storeName,
  reviewCount,
  averageRating,
  ratingDistribution,
  reviews,
  loading,
  expanded,
  onToggleExpand,
  currentUid,
  onWriteClick,
  onReserveClick,
  onEdit,
  onDelete,
  onReport,
  reportedIds,
}: {
  storeId: string;
  storeName: string;
  reviewCount: number;
  averageRating: number;
  ratingDistribution?: { '1'?: number; '2'?: number; '3'?: number; '4'?: number; '5'?: number };
  reviews: Review[];
  loading: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  currentUid: string | null;
  onWriteClick: () => void;
  onReserveClick: () => void;
  onEdit: (r: Review) => void;
  onDelete: (r: Review) => void;
  onReport: (r: Review) => void;
  reportedIds: Set<string>;
}) {
  const ratingLabel = (() => {
    if (!reviewCount || reviewCount === 0) return '첫 리뷰를 남겨주세요';
    if (averageRating >= 4.5) return '매우 좋음';
    if (averageRating >= 3.5) return '좋음';
    if (averageRating >= 2.5) return '보통';
    if (averageRating >= 1.5) return '아쉬움';
    return '별로';
  })();

  // 분포 막대용 최대값 (모든 별점 중 가장 많은 개수)
  const dist = ratingDistribution ?? {};
  const counts: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: dist['1'] ?? 0,
    2: dist['2'] ?? 0,
    3: dist['3'] ?? 0,
    4: dist['4'] ?? 0,
    5: dist['5'] ?? 0,
  };
  const maxBar = Math.max(1, counts[1], counts[2], counts[3], counts[4], counts[5]);

  const shown = expanded ? reviews : reviews.slice(0, REVIEWS_INITIAL_COUNT);
  const hasMore = reviews.length > REVIEWS_INITIAL_COUNT;

  // 매장에 표시된 reviewCount보다 reviews 실시간 길이가 더 정확할 수 있음 (Function 갱신 지연)
  const displayCount = Math.max(reviewCount, reviews.length);

  return (
    <div className="px-5 py-5" style={{ borderBottom: '8px solid var(--bg-sub)' }}>
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }} aria-hidden="true">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        <span className="text-[14px] font-extrabold" style={{ color: 'var(--text-1)' }}>
          리뷰 ({displayCount.toLocaleString()})
        </span>
      </div>

      {/* 요약 카드 — 별점 큰 표시 + 분포 막대 */}
      <div
        className="rounded-2xl p-4 mb-4"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-baseline gap-3 mb-1">
          <div
            className="font-extrabold font-mono leading-none"
            style={{ fontSize: 40, color: 'var(--text-1)', letterSpacing: '-0.02em' }}
          >
            {formatRating(averageRating)}
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  aria-hidden="true"
                  style={{
                    fontSize: 16,
                    lineHeight: 1,
                    color: n <= Math.round(averageRating) ? '#FFC83D' : 'var(--surface-3)',
                  }}
                >
                  ★
                </span>
              ))}
            </div>
            <div className="text-[12px] font-bold mt-1" style={{ color: 'var(--text-2)' }}>
              {ratingLabel}
            </div>
          </div>
        </div>

        {/* 분포 막대 */}
        <div className="mt-4 space-y-1.5">
          {[5, 4, 3, 2, 1].map((star) => {
            const n = counts[star as 1 | 2 | 3 | 4 | 5];
            const pct = Math.round((n / maxBar) * 100);
            return (
              <div key={star} className="flex items-center gap-2">
                <span className="text-[10px] font-bold w-6 flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                  {star}점
                </span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: star >= 4 ? '#FFC83D' : star === 3 ? '#FFA800' : 'var(--text-3)' }}
                  />
                </div>
                <span className="text-[10px] font-mono font-bold w-8 text-right flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                  {n}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 리뷰 쓰기 버튼 */}
      <button
        onClick={onWriteClick}
        className="w-full h-12 flex items-center justify-center gap-2 rounded-2xl font-extrabold text-[14px] transition active:scale-[0.98] mb-4"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-1)',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 16, color: '#FF1F8F' }}>✎</span>
        {currentUid ? '리뷰 쓰기' : '로그인하고 리뷰 쓰기'}
      </button>

      {/* 리스트 */}
      {loading ? (
        <div className="py-6 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>리뷰 로딩 중…</div>
      ) : reviews.length === 0 ? (
        <div className="py-8 text-center">
          <div className="text-[40px] mb-2" aria-hidden="true">💬</div>
          <div className="text-[14px] font-bold mb-1" style={{ color: 'var(--text-1)' }}>
            아직 리뷰가 없어요
          </div>
          <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
            {storeName}의 첫 리뷰를 남겨보세요
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {shown.map((r) => (
              <ReviewCard
                key={r.id}
                review={r}
                isMine={!!currentUid && r.authorUid === currentUid}
                onEdit={() => onEdit(r)}
                onDelete={() => onDelete(r)}
                onReport={() => onReport(r)}
                alreadyReported={reportedIds.has(r.id)}
              />
            ))}
          </div>
          {hasMore && (
            <button
              onClick={onToggleExpand}
              className="mt-4 w-full py-3 rounded-2xl text-[13px] font-bold transition active:scale-[0.99]"
              style={{
                background: expanded ? 'var(--surface-2)' : 'var(--brand-pale)',
                border: `1px solid ${expanded ? 'var(--border)' : 'rgba(240,71,155,0.25)'}`,
                color: expanded ? 'var(--text-2)' : '#C8276A',
              }}
              aria-expanded={expanded}
            >
              {expanded ? '접기' : `리뷰 더 보기 (+${reviews.length - REVIEWS_INITIAL_COUNT})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ReviewCard({
  review,
  isMine,
  onEdit,
  onDelete,
  onReport,
  alreadyReported,
}: {
  review: Review;
  isMine: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
  alreadyReported: boolean;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const createdMs = review.createdAt?.toMillis?.() ?? 0;
  const visitMs = review.visitDate?.toMillis?.() ?? 0;
  const initials = (review.authorName?.[0] ?? '?').toUpperCase();

  // 외부 클릭으로 메뉴 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = () => setMenuOpen(false);
    // 살짝 지연 — 같은 클릭에 즉시 닫히지 않도록
    const t = setTimeout(() => window.addEventListener('click', onClickOutside, { once: true }), 0);
    return () => { clearTimeout(t); window.removeEventListener('click', onClickOutside); };
  }, [menuOpen]);

  return (
    <div
      className="relative rounded-2xl p-4"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      {/* 우상단 ⋮ 메뉴 — 본인 리뷰엔 숨김 */}
      {!isMine && (
        <div className="absolute top-3 right-3 z-10">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            aria-label="리뷰 메뉴"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition active:scale-90"
            style={{ background: menuOpen ? 'var(--surface-2)' : 'transparent', color: 'var(--text-3)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
            </svg>
          </button>
          {menuOpen && (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              className="absolute top-9 right-0 rounded-xl py-1 min-w-[140px]"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
              }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={alreadyReported}
                onClick={() => {
                  setMenuOpen(false);
                  if (!alreadyReported) onReport();
                }}
                className="w-full text-left px-3 py-2 text-[13px] font-bold disabled:opacity-50"
                style={{ color: alreadyReported ? 'var(--text-3)' : 'var(--live)' }}
              >
                {alreadyReported ? '이미 신고됨' : '리뷰 신고'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BB5 100%)' }}
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
              {review.authorName || '익명'}
            </span>
            {isMine && (
              <span
                className="text-[9px] font-extrabold rounded-full px-1.5 py-0.5"
                style={{ background: 'rgba(255,31,143,0.10)', color: 'var(--brand)' }}
              >
                내 리뷰
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  aria-hidden="true"
                  style={{
                    fontSize: 11,
                    lineHeight: 1,
                    color: n <= review.rating ? '#FFC83D' : 'var(--surface-3)',
                  }}
                >
                  ★
                </span>
              ))}
            </div>
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {createdMs ? formatRelativeTime(createdMs) : ''}
              {review.editedAt && <span> · 수정됨</span>}
            </span>
          </div>
        </div>
        {isMine && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onEdit}
              className="text-[11px] font-bold px-2 py-1 rounded-lg transition active:scale-95"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
            >
              수정
            </button>
            <button
              onClick={onDelete}
              className="text-[11px] font-bold px-2 py-1 rounded-lg transition active:scale-95"
              style={{ background: 'var(--surface-2)', color: 'var(--live)', border: '1px solid var(--border)' }}
            >
              삭제
            </button>
          </div>
        )}
      </div>

      {/* 본문 */}
      <div
        className="mt-3 text-[13px] whitespace-pre-wrap leading-relaxed"
        style={{ color: 'var(--text-1)' }}
      >
        {review.body}
      </div>

      {/* 사진 */}
      {review.photoUrls && review.photoUrls.length > 0 && (
        <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-none">
          {review.photoUrls.map((url) => (
            <button
              key={url}
              onClick={() => setLightboxUrl(url)}
              className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 transition active:scale-95"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              aria-label="사진 크게 보기"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="리뷰 사진" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* 방문일 */}
      {visitMs > 0 && (
        <div className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
          방문일: {formatYmd(visitMs)}
        </div>
      )}

      {/* 라이트박스 */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="리뷰 사진 확대" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  if (day < 30) return `${Math.floor(day / 7)}주 전`;
  if (day < 365) return `${Math.floor(day / 30)}개월 전`;
  return `${Math.floor(day / 365)}년 전`;
}

function formatYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
