'use client';

/**
 * DailyPostsCarousel — 홈 최상단의 "오늘의 매장 소식" 세로 슬라이드 캐러셀.
 *
 * Phase H (2026-05-22) — 3장 동시 노출 + 한 칸씩 위로 shift (사용자 호소: 카드가 너무 크다):
 *  - 카드 3장을 세로로 stack. 카드당 슬림 한 줄(헤드라인 + 매장명 + 거리 + 시간 + 이모지).
 *  - 8초마다 가장 위 카드가 위로 사라지고, 하단에서 새 카드가 올라옴 (채팅방 톤).
 *  - 본문/이미지 X — 풀 내용은 채팅방(/m/posts) / 매장 상세에서.
 *
 * Phase G(이전) 정책 — 그대로 유지:
 *  - 거리: 본사 meta/feedConfig.defaultRadiusKm 적용. 위치 거부 → 전국 fallback.
 *  - 디폴트 반경 0건 → 자동 확장 라더 (radiusOptions 기준).
 *  - 매장찾기 카루셀(/m/find)은 손대지 않음 — 홈 전용.
 *
 * 자동 진행 정책 (그대로 유지):
 *  - 첫 3회만 8초 hold → 자동 shift → 정지. 이후엔 사용자 제스처만.
 *  - 사용자 위로 swipe up → 즉시 shift (수동 가속) + 자동 진행 중단.
 *
 * 슬라이드 애니메이션 (3장 stack):
 *  - 한 칸 높이 = CARD_HEIGHT + GAP.
 *  - 컨테이너 안에서 visiblePosts 전체를 stacked positioning.
 *  - activeIdx + 0/+1/+2 카드만 (0/1/2 슬롯에) 표시. 나머지는 화면 밖.
 *  - shift = activeIdx 1 증가 → 슬롯 -1 으로 일제히 translateY(-1칸).
 *
 * 데이터:
 *  - loadActivePostsAll: collectionGroup('posts'), 활성 글 fetch
 *  - subscribeActivePinnedPosts: 본사 pinned 띠 (기존 유지)
 *  - subscribeFeedConfig: 본사 디폴트 반경 (채팅방과 동일)
 *  - stores collection(status='active') 1회 fetch → 좌표 map (in-memory)
 *
 * 정책:
 *  - Firestore SDK 직접 호출 — 클라이언트 사이드.
 *  - 카카오 SDK 호출 0회 (위치 권한만, 정밀도 낮춤).
 *  - 빈 상태: 섹션 자체 렌더하지 않음.
 *  - 점 인디케이터(B) 재도입 금지 — 카운터(우측 N/M)만 사용.
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
const AUTO_ROUNDS = 3;         // 자동 shift 횟수 — 3회 후 정지
const VISIBLE_SLOTS = 3;       // 동시 노출 카드 수 (3장 stack)
const CARD_HEIGHT = 64;        // 카드 1장 높이 (px) — 한 줄 슬림
const CARD_GAP = 8;            // 카드 간 간격 (px)
const SLIDE_DURATION_MS = 420; // 슬라이드 transition duration
const SWIPE_UP_THRESHOLD = 30; // 사용자 위로 스와이프 임계치 (px)

const SLOT_STRIDE = CARD_HEIGHT + CARD_GAP; // 한 칸당 이동 거리
const CONTAINER_HEIGHT = CARD_HEIGHT * VISIBLE_SLOTS + CARD_GAP * (VISIBLE_SLOTS - 1);

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

  // 다음 카드로 이동 (자동/수동 공용) — wrap-around
  const goNext = useCallback(() => {
    setActiveIdx((i) => {
      const total = visiblePosts.length;
      if (total <= VISIBLE_SLOTS) return i; // 모두 보이면 shift 의미 없음
      return (i + 1) % total;
    });
  }, [visiblePosts.length]);

  // 7) 자동 슬라이드 — 첫 3회만 진행 후 정지
  useEffect(() => {
    // 3장 이하면 자동 진행할 필요 없음 (이미 모두 노출)
    if (visiblePosts.length <= VISIBLE_SLOTS || autoDone) return;
    const id = window.setInterval(() => {
      if (userInteractedRef.current) {
        setAutoDone(true);
        return;
      }
      autoRoundsRef.current += 1;
      const cap = Math.min(AUTO_ROUNDS, Math.max(0, visiblePosts.length - VISIBLE_SLOTS));
      if (autoRoundsRef.current >= cap) {
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
  // 보이는 3장 slot의 현재 위치 (1-based for counter)
  const counterStart = total > 0 ? activeIdx + 1 : 0;
  const counterEnd = total > 0 ? Math.min(activeIdx + VISIBLE_SLOTS, total) : 0;

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

      {/* 세로 슬라이드 — 3장 stack + 위로 한 칸씩 shift */}
      {total > 0 && (
        <div className="px-4">
          <div
            className="relative w-full overflow-hidden"
            style={{ height: `${CONTAINER_HEIGHT}px` }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onWheel={onWheel}
            role="region"
            aria-roledescription="세로 슬라이드"
            aria-label="오늘의 매장 소식 카드"
          >
            {visiblePosts.map((p, idx) => {
              // 모듈로 기반 상대 위치: activeIdx 기준으로 어느 slot에 위치하는가
              const rel = ((idx - activeIdx) % total + total) % total;
              // rel 값: 0 = top, 1 = middle, 2 = bottom, 3 = 아래 대기, ...
              // 화면에 보이는 건 rel 0/1/2 (VISIBLE_SLOTS=3)
              // rel == total-1 (직전)는 위로 사라지는 카드
              const isAbove = rel === total - 1 && total > VISIBLE_SLOTS;
              const isVisible = rel < VISIBLE_SLOTS;

              let translateY: number;
              let opacity: number;
              let pointerEvents: 'auto' | 'none';
              if (isAbove) {
                translateY = -SLOT_STRIDE; // 위로 한 칸 사라짐
                opacity = 0;
                pointerEvents = 'none';
              } else if (isVisible) {
                translateY = rel * SLOT_STRIDE;
                opacity = 1;
                pointerEvents = 'auto';
              } else {
                // 화면 밖 아래 대기열
                translateY = VISIBLE_SLOTS * SLOT_STRIDE;
                opacity = 0;
                pointerEvents = 'none';
              }

              const userOrigin = userLocation ?? (locationDenied ? null : HQ_FALLBACK);
              const coord = storeCoords.get(p.storeId);
              const distanceMeters = userOrigin && coord
                ? haversineMeters(userOrigin, { lat: coord.lat, lng: coord.lng })
                : null;

              return (
                <div
                  key={p.id}
                  className="absolute left-0 right-0"
                  style={{
                    top: 0,
                    height: `${CARD_HEIGHT}px`,
                    transform: `translateY(${translateY}px)`,
                    opacity,
                    transition: `transform ${SLIDE_DURATION_MS}ms cubic-bezier(.22,.61,.36,1), opacity ${SLIDE_DURATION_MS}ms ease-out`,
                    pointerEvents,
                    willChange: 'transform, opacity',
                  }}
                  aria-hidden={!isVisible}
                >
                  <SlimPostCard post={p} distanceMeters={distanceMeters} height={CARD_HEIGHT} />
                </div>
              );
            })}
          </div>

          {/* 진행 카운터 — 점 인디케이터 금지 정책에 따라 카운터 사용 */}
          {total > VISIBLE_SLOTS && (
            <div
              className="mt-2 flex items-center justify-end gap-1 text-[11px] font-bold"
              style={{ color: 'var(--text-3)' }}
              aria-live="polite"
            >
              <span style={{ color: 'var(--text-1)' }}>
                {counterStart}–{counterEnd}
              </span>
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
// SlimPostCard — 한 줄 카드: 좌측 accent bar + 이모지 + 헤드라인 + 매장명 · 거리 · 시간
// ─────────────────────────────────────────────────────────────

function formatDistance(meters: number | null): string {
  if (meters == null) return '';
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

function SlimPostCard({
  post,
  distanceMeters,
  height,
}: {
  post: StorePost;
  distanceMeters: number | null;
  height: number;
}) {
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

  const distanceLabel = formatDistance(distanceMeters);
  const topEmoji = emojis[0] ?? '';

  return (
    <Link
      href={`/m/store/${post.storeId}`}
      className="block w-full rounded-xl transition active:opacity-80 overflow-hidden"
      style={{
        height: `${height}px`,
        background: style.surface,
        border: `1px solid ${style.border}`,
        boxShadow: `0 2px 8px -6px ${style.accent}`,
        display: 'flex',
        alignItems: 'stretch',
      }}
      aria-label={`${post.storeName ?? '매장'} 소식 보기`}
    >
      {/* 좌측 accent bar */}
      <div
        aria-hidden
        style={{
          width: '4px',
          background: style.accent,
          flexShrink: 0,
        }}
      />
      {/* 우측 본문 */}
      <div className="flex-1 min-w-0 px-3 py-2 flex flex-col justify-center gap-1">
        {/* 1줄: 이모지 + 헤드라인 */}
        <div className="flex items-center gap-1.5 min-w-0">
          {topEmoji && (
            <span
              aria-hidden
              className="flex-shrink-0"
              style={{ fontSize: '14px', lineHeight: 1 }}
            >
              {topEmoji}
            </span>
          )}
          <div
            className="text-[14px] font-extrabold leading-[1.25] truncate flex-1"
            style={{ color: style.textPrimary }}
          >
            {oneLiner || '오늘의 매장 소식'}
          </div>
        </div>
        {/* 2줄: 매장명 · 거리 · 시간 */}
        <div
          className="flex items-center gap-1 text-[11px] font-semibold min-w-0"
          style={{ color: style.textSecondary }}
        >
          <span className="truncate" style={{ maxWidth: '50%' }}>
            {post.storeName || '매장'}
          </span>
          {distanceLabel && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span className="flex-shrink-0">{distanceLabel}</span>
            </>
          )}
          {relative && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span className="flex-shrink-0" style={{ opacity: 0.85 }}>
                {relative}
              </span>
            </>
          )}
        </div>
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
