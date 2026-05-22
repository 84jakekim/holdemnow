'use client';

/**
 * DailyPostsCarousel — 홈 최상단의 "오늘의 매장 소식" 세로 슬라이드 캐러셀.
 *
 * Phase G (2026-05-22) — 1장 표시 + 위로 슬라이드 + 30km 거리 필터:
 *  - 한 번에 카드 1장만 표시. 좌우 스와이프 X. 위→아래 translateY 애니메이션으로 교체.
 *    "좌우 스와이프보다 위로 한 장씩 넘어가는 형식이 깔끔" 사용자 정정 반영.
 *  - 거리: 본사 meta/feedConfig.defaultRadiusKm 적용 (채팅방 /m/posts와 동일 소스).
 *    위치 권한 거부 → 전국 fallback. 디폴트 반경 0건 → 라더 자동 확장 (50→100→999).
 *  - 매장찾기 카루셀(/m/find)은 손대지 않음 — 홈 전용 정정.
 *
 * 자동 진행 정책 (그대로 유지):
 *  - 첫 3장만 8초 hold → 자동 교체 → 정지. 이후엔 사용자 제스처만.
 *  - 사용자 위로 swipe up → 즉시 다음 카드 (수동 가속) + 자동 진행 중단.
 *
 * 슬라이드 애니메이션:
 *  - 현재 카드: translateY(0 → -110%) + opacity(1 → 0)
 *  - 다음 카드: translateY(110% → 0)  + opacity(0 → 1)
 *  - duration 420ms cubic-bezier(.22,.61,.36,1) — UX 표준 "ease-out-quint"에 가까운 곡선
 *  - 컨테이너 고정 높이 200px (헤드라인 2줄 + 메타 + 패딩 안정).
 *
 * 데이터:
 *  - loadActivePostsAll: collectionGroup('posts'), 활성 글 fetch
 *  - subscribeActivePinnedPosts: 본사 pinned 띠 (기존 유지)
 *  - subscribeFeedConfig: 본사 디폴트 반경 (채팅방과 동일)
 *  - stores collection(status='active') 1회 fetch → 좌표 map (in-memory, /m/posts와 동일 패턴)
 *
 * 정책:
 *  - Firestore SDK 직접 호출 — 클라이언트 사이드.
 *  - 카카오 SDK 호출 0회 (위치 권한만, 정밀도 낮춤).
 *  - 빈 상태: 섹션 자체 렌더하지 않음 (홈 가벼움).
 */

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  loadActivePostsAll,
  subscribeActivePinnedPosts,
  type StorePost,
  type PinnedPost,
} from '@/lib/posts';
import { resolveCardVisual } from '@/lib/postCardStyle';
import { formatRelativeKo, useTickingNow } from '@/lib/relativeTime';
import { subscribeFeedConfig, FEED_CONFIG_DEFAULT, type FeedConfig } from '@/lib/feedConfig';
import { haversineMeters, type LatLng } from '@/lib/geo';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const MAX_POSTS = 8;
const AUTO_HOLD_MS = 8000;     // 카드 한 장 노출 유지 시간 (8초)
const AUTO_ROUNDS = 3;         // 자동 전환 횟수 — 3장 후 정지
const CARD_HEIGHT = 200;       // 컨테이너 고정 높이 (px) — CLS 방지
const SLIDE_DURATION_MS = 420; // 슬라이드 transition duration
const SWIPE_UP_THRESHOLD = 40; // 사용자 위로 스와이프 임계치 (px)

const HQ_FALLBACK: LatLng = { lat: 35.115, lng: 129.0395 }; // 부산역 — 위치 거부 시 거리 기준

interface StoreCoord {
  id: string;
  lat: number;
  lng: number;
}

export default function DailyPostsCarousel() {
  // 데이터
  const [posts, setPosts] = useState<StorePost[]>([]);
  const [pinned, setPinned] = useState<PinnedPost[]>([]);
  const [storeCoords, setStoreCoords] = useState<Map<string, StoreCoord>>(new Map());
  const [loaded, setLoaded] = useState(false);

  // 본사 피드 설정 + 위치
  const [cfg, setCfg] = useState<FeedConfig>(FEED_CONFIG_DEFAULT);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

  // 슬라이드 상태
  const [activeIdx, setActiveIdx] = useState(0);
  const [autoDone, setAutoDone] = useState(false);
  const autoRoundsRef = useRef(0);
  const userInteractedRef = useRef(false);

  // 1) posts fetch (최신 50건 → MAX_POSTS로 제한은 거리 필터 뒤에서)
  useEffect(() => {
    let cancelled = false;
    loadActivePostsAll()
      .then((items) => {
        if (cancelled) return;
        setPosts(items);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  // 2) pinned subscribe
  useEffect(() => {
    return subscribeActivePinnedPosts(setPinned, () => {});
  }, []);

  // 3) feedConfig 구독 (채팅방과 동일 소스)
  useEffect(() => {
    return subscribeFeedConfig(setCfg);
  }, []);

  // 4) 위치 권한 — best-effort. 거부 시 전국 fallback.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationDenied(true),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  }, []);

  // 5) 매장 좌표 1회 fetch — lat/lng 있는 활성 매장만 (/m/posts와 동일 패턴)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'stores'), where('status', '==', 'active')));
        if (cancelled) return;
        const map = new Map<string, StoreCoord>();
        snap.forEach((d) => {
          const data = d.data() as { lat?: number; lng?: number };
          if (typeof data.lat === 'number' && typeof data.lng === 'number') {
            map.set(d.id, { id: d.id, lat: data.lat, lng: data.lng });
          }
        });
        setStoreCoords(map);
      } catch {
        // 좌표 없어도 페이지는 동작 (전국 fallback)
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 6) 거리 필터 + 자동 확장 라더 (채팅방 정책 동일)
  const visiblePosts = useMemo(() => {
    if (posts.length === 0) return [] as StorePost[];

    const origin = userLocation ?? HQ_FALLBACK;
    const baseRadius = cfg.defaultRadiusKm;

    const inRadius = (km: number): StorePost[] => {
      if (km >= 999) return posts;
      const meters = km * 1000;
      return posts.filter((p) => {
        const c = storeCoords.get(p.storeId);
        if (!c) return locationDenied; // 좌표 없으면 전국 모드에서만 노출
        return haversineMeters(origin, { lat: c.lat, lng: c.lng }) <= meters;
      });
    };

    // 위치 거부 → 전국 자동
    if (locationDenied) return posts.slice(0, MAX_POSTS);

    // 단계별 자동 확장
    const ladder = Array.from(new Set([baseRadius, ...cfg.radiusOptions])).sort((a, b) => a - b);
    const first = inRadius(baseRadius);
    if (first.length > 0) return first.slice(0, MAX_POSTS);
    for (const km of ladder) {
      if (km <= baseRadius) continue;
      const next = inRadius(km);
      if (next.length > 0) return next.slice(0, MAX_POSTS);
    }
    return [] as StorePost[];
  }, [posts, storeCoords, userLocation, locationDenied, cfg]);

  // activeIdx가 visiblePosts 범위를 벗어나면 보정
  useEffect(() => {
    if (visiblePosts.length === 0) {
      if (activeIdx !== 0) setActiveIdx(0);
      return;
    }
    if (activeIdx >= visiblePosts.length) {
      setActiveIdx(0);
      autoRoundsRef.current = 0;
    }
  }, [visiblePosts.length, activeIdx]);

  // 다음 카드로 이동 (자동/수동 공용)
  const goNext = useCallback(() => {
    setActiveIdx((i) => {
      const total = visiblePosts.length;
      if (total <= 1) return i;
      return (i + 1) % total;
    });
  }, [visiblePosts.length]);

  // 7) 자동 슬라이드 — 첫 3장만 진행 후 정지
  useEffect(() => {
    if (visiblePosts.length <= 1 || autoDone) return;
    const id = window.setInterval(() => {
      if (userInteractedRef.current) {
        setAutoDone(true);
        return;
      }
      autoRoundsRef.current += 1;
      if (autoRoundsRef.current >= Math.min(AUTO_ROUNDS, visiblePosts.length)) {
        // 마지막 자동 전환 후 정지
        goNext();
        setAutoDone(true);
        return;
      }
      goNext();
    }, AUTO_HOLD_MS);
    return () => window.clearInterval(id);
  }, [visiblePosts.length, autoDone, goNext]);

  // 8) 사용자 위로 스와이프 감지 → 즉시 다음 카드 + 자동 진행 중단
  const touchStartYRef = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const sy = touchStartYRef.current;
    touchStartYRef.current = null;
    if (sy == null) return;
    const ey = e.changedTouches[0]?.clientY;
    if (ey == null) return;
    const dy = sy - ey;
    if (dy > SWIPE_UP_THRESHOLD) {
      userInteractedRef.current = true;
      setAutoDone(true);
      goNext();
    }
  };
  // wheel(데스크탑) — 아래 방향 스크롤이면 다음 카드
  const onWheel = (e: React.WheelEvent) => {
    if (e.deltaY > 30) {
      userInteractedRef.current = true;
      setAutoDone(true);
      goNext();
    }
  };

  // 빈 상태: 섹션 자체 렌더하지 않음
  if (loaded && visiblePosts.length === 0 && pinned.length === 0) return null;

  const total = visiblePosts.length;
  const current = visiblePosts[activeIdx];

  return (
    <section aria-label="오늘의 매장 소식" className="pt-4 pb-1">
      {/* 본사 pinned stripe — 1줄 띠 (있을 때만) */}
      {pinned.length > 0 && (
        <div className="px-4 mb-2">
          <PinnedStripe item={pinned[0]} />
        </div>
      )}

      {/* 섹션 헤더 — TOSS 톤 */}
      <div className="px-4 mb-2.5 flex items-baseline justify-between">
        <h2 className="text-[16px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          오늘의 매장 소식
        </h2>
        {total > 0 && (
          <Link
            href="/m/posts"
            className="text-[12px] font-semibold transition active:opacity-60"
            style={{ color: 'var(--text-3)' }}
          >
            전체보기 →
          </Link>
        )}
      </div>

      {/* 세로 슬라이드 — 카드 1장씩 위로 교체 */}
      {total > 0 && current && (
        <div className="px-4">
          <div
            className="relative w-full overflow-hidden"
            style={{ height: `${CARD_HEIGHT}px` }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onWheel={onWheel}
            role="region"
            aria-roledescription="세로 슬라이드"
            aria-label="오늘의 매장 소식 카드"
          >
            {visiblePosts.map((p, idx) => {
              const offset = idx - activeIdx;
              // active=0, 위로 사라진=-1 (translateY -110%), 아래 대기=+1 (translateY +110%)
              const isActive = offset === 0;
              const isAbove = offset < 0 || (activeIdx === 0 && idx === total - 1 && total > 1);
              // ↑ wrap-around: 첫 카드일 때 마지막 카드는 "위로 사라진" 상태로 둠 (다음 next 시 일관성)
              let translateY = '0%';
              let opacity = 1;
              let pointerEvents: 'auto' | 'none' = 'none';
              if (isActive) {
                translateY = '0%';
                opacity = 1;
                pointerEvents = 'auto';
              } else if (isAbove) {
                translateY = '-110%';
                opacity = 0;
              } else {
                translateY = '110%';
                opacity = 0;
              }
              return (
                <div
                  key={p.id}
                  className="absolute inset-0"
                  style={{
                    transform: `translateY(${translateY})`,
                    opacity,
                    transition: `transform ${SLIDE_DURATION_MS}ms cubic-bezier(.22,.61,.36,1), opacity ${SLIDE_DURATION_MS}ms ease-out`,
                    pointerEvents,
                  }}
                  aria-hidden={!isActive}
                >
                  <PostCard post={p} height={CARD_HEIGHT} />
                </div>
              );
            })}
          </div>

          {/* 진행 카운터 — 점 인디케이터 금지 정책에 따라 카운터 사용 */}
          {total > 1 && (
            <div
              className="mt-2 flex items-center justify-end gap-1.5 text-[11px] font-bold"
              style={{ color: 'var(--text-3)' }}
              aria-live="polite"
            >
              <span style={{ color: 'var(--text-1)' }}>{activeIdx + 1}</span>
              <span style={{ opacity: 0.5 }}>/</span>
              <span>{total}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 카드 — headline + 이모지 액센트 + 매장명 + 상대시각 (고정 높이)
// ─────────────────────────────────────────────────────────────

function PostCard({ post, height }: { post: StorePost; height: number }) {
  const { style, emojis } = useMemo(() => resolveCardVisual(post), [post]);
  const now = useTickingNow();
  const relative = useMemo(() => formatRelativeKo(post.createdAt, now), [post.createdAt, now]);

  // headline 우선, 없으면 body 첫 줄 fallback (백워드 호환)
  const oneLiner = useMemo(() => {
    const head = (post.headline ?? '').trim();
    if (head) return head;
    const firstLine = (post.body || '').split('\n')[0]?.trim() ?? '';
    return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
  }, [post.headline, post.body]);

  return (
    <Link
      href={`/m/store/${post.storeId}`}
      className="block w-full rounded-2xl transition active:opacity-80"
      style={{
        height: `${height}px`,
        background: style.surface,
        border: `1.5px solid ${style.accent}`,
        padding: '16px 16px 14px',
        boxShadow: `0 6px 18px -10px ${style.accent}`,
        display: 'flex',
        flexDirection: 'column',
      }}
      aria-label={`${post.storeName ?? '매장'} 소식 보기`}
    >
      {/* 상단: 이모지 액센트(최대 3개) + 헤드라인 */}
      <div className="flex items-start gap-2 flex-1 min-h-0">
        {emojis.length > 0 && (
          <div className="flex-shrink-0 flex items-center gap-1" aria-hidden>
            {emojis.map((e, i) => (
              <div
                key={`${e}_${i}`}
                className="flex items-center justify-center rounded-lg"
                style={{
                  width: '32px',
                  height: '32px',
                  background: style.accent,
                  fontSize: '17px',
                }}
              >
                <span style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.15))' }}>{e}</span>
              </div>
            ))}
          </div>
        )}
        <div
          className="text-[17px] font-extrabold leading-[1.35] flex-1"
          style={{
            color: style.textPrimary,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {oneLiner || '오늘의 매장 소식'}
        </div>
      </div>
      {/* 하단: 매장명 + 상대시각 */}
      <div
        className="pt-2.5 mt-2 flex items-center justify-between gap-1.5 flex-shrink-0"
        style={{ borderTop: `1px solid ${style.border}` }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: style.textSecondary, flexShrink: 0 }}
            aria-hidden
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <div className="text-[12px] font-semibold truncate" style={{ color: style.textSecondary }}>
            {post.storeName || '매장'}
          </div>
        </div>
        {relative && (
          <div className="text-[11px] font-medium flex-shrink-0" style={{ color: style.textSecondary, opacity: 0.85 }}>
            {relative}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────
// 본사 pinned stripe — 1줄 띠 (priority 가장 높은 1개만)
// ─────────────────────────────────────────────────────────────

function PinnedStripe({ item }: { item: PinnedPost }) {
  const inner = (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{
        background: 'linear-gradient(135deg, rgba(255,31,143,0.08) 0%, rgba(255,31,143,0.04) 100%)',
        border: '1px solid rgba(255,31,143,0.20)',
      }}
    >
      <span
        className="text-[10px] font-extrabold px-1.5 py-0.5 rounded"
        style={{ background: '#FF1F8F', color: '#fff' }}
      >
        공지
      </span>
      <span
        className="text-[12.5px] font-semibold truncate flex-1"
        style={{ color: 'var(--text-1)' }}
      >
        {item.title}
      </span>
      {item.ctaUrl && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)' }} aria-hidden>
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </div>
  );

  if (item.ctaUrl) {
    return (
      <a
        href={item.ctaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block transition active:opacity-70"
      >
        {inner}
      </a>
    );
  }
  return inner;
}
