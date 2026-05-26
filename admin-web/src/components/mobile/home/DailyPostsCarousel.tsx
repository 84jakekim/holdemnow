'use client';

/**
 * DailyPostsCarousel — 홈 최상단의 "오늘의 매장 소식" 세로 슬라이드 캐러셀.
 *
 * Phase H (2026-05-22) — 3장 동시 노출 + 한 칸씩 위로 shift (사용자 호소: 카드가 너무 크다):
 *  - 카드 3장을 세로로 stack. 카드당 슬림 한 줄(헤드라인 + 매장명 + 거리 + 시간 + 이모지).
 *  - 8초마다 가장 위 카드가 위로 사라지고, 하단에서 새 카드가 올라옴 (채팅방 톤).
 *  - 본문/이미지 X — 풀 내용은 채팅방(/m/posts) / 매장 상세에서.
 *
 * Phase H++ 정정 (2026-05-22, PM 단독) — 새 글 슬롯 위치 반전:
 *  - 사용자 호소: "새 글은 밑에서 올라와야 한다. 맨 위에 나타나면 안 된다."
 *  - 기존: 최신 글(rel=0) → top slot에 fade-in → 잘못됨.
 *  - 변경: 최신 글(rel=0) → **bottom slot**에 fade-in → 위로 한 칸씩 shift →
 *    최상단(rel=VISIBLE_SLOTS-1)에 도달 후 그 다음 shift에서 위로 사라짐.
 *  - 슬롯 매핑: translateY = (VISIBLE_SLOTS - 1 - rel) * SLOT_STRIDE
 *  - 위로 사라지는 카드(rel == VISIBLE_SLOTS): translateY = -SLOT_STRIDE
 *  - 카운터는 그대로 (최신 글이 1번이므로 "1–3 / 8" 의미는 유지).
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
 *  - subscribeActivePostsAll: collectionGroup('posts'), 활성 글 실시간 구독 (onSnapshot).
 *    채팅방(/m/posts)과 동일 소스를 사용해, 매장이 새 글을 올리면 새로고침 없이 즉시 반영됨.
 *    채팅방은 ASC(말풍선 시간순)이지만, 홈은 최신 글이 위로 노출되도록 클라이언트 측에서 DESC 재정렬.
 *
 * Phase H+ hotfix (2026-05-22) — 새 글 도착 감지:
 *  - posts[0].id 변경 = 새 글 도착 신호 → activeIdx=0 리셋 (최신 글이 top slot으로).
 *  - 자동 슬라이드가 이미 정지 상태(autoDone=true)였어도 재시작 (autoRoundsRef=0, autoDone=false).
 *  - 단 사용자가 swipe up으로 직접 정지시켰다면(userInteractedRef=true) 의도 존중하여 재시작 X.
 *  - 첫 mount는 false positive 방지를 위해 prevLatestIdRef 초기값만 설정하고 리셋하지 않음.
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
  subscribeActivePostsAll,
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

  // 새 글 도착 감지용 — 직전 latest post id 보관 (첫 mount는 false positive 방지)
  const prevLatestIdRef = useRef<string | null>(null);

  // 1) posts 실시간 구독 (onSnapshot) — 매장이 새 글 올리면 새로고침 없이 즉시 반영.
  //    채팅방(/m/posts)과 동일 소스 사용. ASC로 들어오므로 홈 노출용 DESC로 재정렬.
  //    새 글 도착(posts[0].id 변경) → activeIdx=0 리셋 + 자동 슬라이드 재시작
  //    (사용자가 swipe up으로 직접 정지시킨 경우는 의도 존중하여 재시작 X).
  useEffect(() => {
    const unsub = subscribeActivePostsAll(
      (items) => {
        // 채팅방은 시간순(ASC), 홈은 최신순(DESC)로 노출
        const sorted = [...items].sort((a, b) => {
          const am = a.createdAt?.toMillis?.() ?? 0;
          const bm = b.createdAt?.toMillis?.() ?? 0;
          return bm - am;
        });

        const nextLatestId = sorted[0]?.id ?? null;
        const prevLatestId = prevLatestIdRef.current;

        // 첫 mount(prev=null)는 초기값만 기록하고 리셋하지 않음 — false positive 방지
        if (prevLatestId !== null && nextLatestId !== null && nextLatestId !== prevLatestId) {
          // 새 글 도착 — 최신 글이 top slot에 보이도록 activeIdx=0 리셋
          setActiveIdx(0);
          // 사용자가 직접 정지시키지 않았다면 자동 슬라이드 재시작
          if (!userInteractedRef.current) {
            autoRoundsRef.current = 0;
            setAutoDone(false);
          }
        }
        prevLatestIdRef.current = nextLatestId;

        setPosts(sorted);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
    return () => unsub();
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

  // 6) 거리 필터 + 자동 확장 라더 (채팅방 정책 동일).
  //
  // 2026-05-23 hotfix #5 — "홈/채팅방 새 글 안 보임" 근본 fix:
  //  - 좌표 없는 매장 글(stores doc에 lat/lng 미입력)이 위치 허용 사용자에게
  //    영구 차단되던 버그. 매장찾기 DailyPostsFeed는 거리 필터가 없어 보였지만,
  //    홈 카루셀/채팅방은 c=null이면 locationDenied일 때만 노출했음.
  //  - 출시 초기 매장이 좌표 입력을 빠뜨리는 케이스가 매우 잦음 + 거리 100km로
  //    cfg.defaultRadiusKm가 잡혀있어도 부산 → 서울 같은 케이스에서 0건이 흔함.
  //  - 정책: 좌표 없는 글은 **항상 노출**(전국 카테고리 취급). 좌표 있는 글은
  //    기존 ladder 자동 확장. 마지막 단계(999=전국)에서도 0건이면 좌표 있는 글
  //    전체 노출(거리 필터 무시) — 매장찾기와 동일 톤.
  const visiblePosts = useMemo(() => {
    if (posts.length === 0) return [] as StorePost[];

    const origin = userLocation ?? HQ_FALLBACK;
    const baseRadius = cfg.defaultRadiusKm;

    // 좌표 있는 글 / 없는 글 분리
    const postsWithCoord = posts.filter((p) => storeCoords.has(p.storeId));
    const postsNoCoord = posts.filter((p) => !storeCoords.has(p.storeId));

    // 좌표 있는 글에 한해 거리 필터
    const inRadius = (km: number): StorePost[] => {
      if (km >= 999) return postsWithCoord;
      const meters = km * 1000;
      return postsWithCoord.filter((p) => {
        const c = storeCoords.get(p.storeId)!;
        return haversineMeters(origin, { lat: c.lat, lng: c.lng }) <= meters;
      });
    };

    // 좌표 없는 글은 항상 통과 (매장 신규가입 직후 좌표 입력 누락 케이스)
    const baseAlways = postsNoCoord;

    // 위치 거부 → 전국 모드 (좌표 무관 전체 노출)
    if (locationDenied) {
      return [...baseAlways, ...postsWithCoord].slice(0, MAX_POSTS);
    }

    // 단계별 자동 확장 — 좌표 있는 글이 0건이면 다음 단계로
    const ladder = Array.from(new Set([baseRadius, ...cfg.radiusOptions])).sort((a, b) => a - b);
    let withinRange: StorePost[] = inRadius(baseRadius);
    if (withinRange.length === 0) {
      for (const km of ladder) {
        if (km <= baseRadius) continue;
        const next = inRadius(km);
        if (next.length > 0) { withinRange = next; break; }
      }
    }
    // 최종 fallback: 그래도 0건이면 좌표 있는 글 전체 (전국)
    if (withinRange.length === 0) withinRange = postsWithCoord;

    return [...baseAlways, ...withinRange].slice(0, MAX_POSTS);
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

  // 다음 카드로 이동 (자동/수동 공용) — wrap-around.
  // Phase H++ 정정: 위로 흐르는 모션이므로 activeIdx를 -1 방향으로 진행.
  // activeIdx는 현재 bottom slot에 보이는 글의 인덱스 (0 = 최신).
  // shift 후 bottom에 더 오래된 글(idx+1)이 진입 → 단, 모듈로 처리상 i-1로 감소.
  // (rel = (idx - activeIdx + total) % total. activeIdx가 1 감소하면 모든 카드의
  //  rel이 +1 → 한 슬롯 위로 올라가는 모션.)
  const goNext = useCallback(() => {
    setActiveIdx((i) => {
      const total = visiblePosts.length;
      if (total <= VISIBLE_SLOTS) return i; // 모두 보이면 shift 의미 없음
      return (i - 1 + total) % total;
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
  // 카운터 — bottom slot에 보이는 글의 1-based 인덱스. (Phase H++ 정정:
  // 슬롯 매핑이 반전되어 "최신부터 N번째" 형태 표시가 더 직관적.
  // activeIdx=0 → "1 / 8" (bottom에 최신 글))
  const counterNumber = total > 0 ? activeIdx + 1 : 0;

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
              // rel 값의 의미 (Phase H++ 정정 — 새 글은 bottom slot에서 fade-in):
              //   rel = 0           → bottom slot (최신 글이 여기서 올라옴)
              //   rel = 1           → middle slot
              //   rel = VISIBLE_SLOTS-1 (=2) → top slot (다음 shift에 사라질 카드)
              //   rel = VISIBLE_SLOTS (=3)   → 위로 사라지는 카드 (직전 top)
              //   rel ≥ VISIBLE_SLOTS+1      → 화면 밖 아래 대기
              const isAbove = rel === VISIBLE_SLOTS && total > VISIBLE_SLOTS;
              const isVisible = rel < VISIBLE_SLOTS;

              let translateY: number;
              let opacity: number;
              let pointerEvents: 'auto' | 'none';
              if (isAbove) {
                translateY = -SLOT_STRIDE; // 위로 한 칸 사라짐
                opacity = 0;
                pointerEvents = 'none';
              } else if (isVisible) {
                // 최신 글(rel=0)을 bottom slot에 배치, 위로 갈수록 작은 translateY.
                translateY = (VISIBLE_SLOTS - 1 - rel) * SLOT_STRIDE;
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

          {/* 진행 카운터 — 점 인디케이터 금지 정책에 따라 카운터 사용.
              Phase H++ 정정: bottom slot 글의 단일 인덱스. */}
          {total > VISIBLE_SLOTS && (
            <div
              className="mt-2 flex items-center justify-end gap-1 text-[11px] font-bold"
              style={{ color: 'var(--text-3)' }}
              aria-live="polite"
            >
              <span style={{ color: 'var(--text-1)' }}>
                {counterNumber}
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

/**
 * SlimPostCard — 홈 상단 띠 카드 (핸드오프 v3.1: 채팅 말풍선 톤).
 *
 * 디자인 결정 (2026-05-26, PM 단독):
 *  - 채팅방(/m/posts) 톤과 통일. 핸드오프 screens-user.jsx 시그니처 적용.
 *  - 구조: [28px 아바타] · [헤드라인 1줄 + 매장명·거리·시간 1줄] (좌측 아래 꼬리)
 *  - radius 14/14/14/4 → 카톡 말풍선 꼬리 (홈 띠에도 동일 패턴 적용).
 *  - 좌측 accent bar 4px 폐기 — 아바타와 말풍선이 색상 시그널 역할.
 *  - .pr-chat-tape 토큰 사용 (globals.css v3.1).
 */
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
  const avatarEmoji = emojis[0] || '🃏';

  return (
    <Link
      href={`/m/store/${post.storeId}`}
      className="pr-chat-tape tap"
      style={{
        height: `${height}px`,
        background: style.surface,
        borderColor: style.border,
        textDecoration: 'none',
      }}
      aria-label={`${post.storeName ?? '매장'} 소식 보기`}
    >
      {/* 좌측 mini 아바타 (28px, 매장 컬러) */}
      <div
        className="pr-chat-tape-avatar"
        style={{ background: style.surface, borderColor: style.border, color: style.textPrimary }}
        aria-hidden
      >
        {avatarEmoji}
      </div>

      {/* 본문 (헤드라인 1줄 + 메타 1줄) */}
      <div className="pr-chat-tape-body">
        <div
          className="pr-chat-tape-headline"
          style={{ color: style.textPrimary }}
        >
          {oneLiner || '오늘의 매장 소식'}
        </div>
        <div
          className="pr-chat-tape-meta"
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
  // 핸드오프 v3.1 — 본사 pinned 띠도 채팅 말풍선 꼬리 톤 적용 (14/14/14/4)
  const inner = (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{
        background: 'linear-gradient(135deg, rgba(255,31,143,0.10) 0%, rgba(255,31,143,0.02) 100%)',
        border: '1px solid rgba(255,31,143,0.22)',
        borderRadius: '14px 14px 14px 4px',
        boxShadow: '0 2px 8px -6px rgba(255,31,143,0.30)',
      }}
    >
      <span
        className="text-[10px] font-extrabold px-1.5 py-0.5 rounded"
        style={{ background: '#FF1F8F', color: '#fff', letterSpacing: '0.04em' }}
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
