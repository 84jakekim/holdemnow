'use client';

/**
 * /m/posts — "오늘의 매장 소식" 채팅방 페이지
 *
 * 디자인 결정 (2026-05-22, PM 단독):
 *  - 카카오톡 오픈채팅처럼 시간순으로 흘러내리는 단일 피드.
 *  - 본사 pinned는 상단 핑크 박스 1~2개 (24h 만료 무시).
 *  - 매장 카드는 말풍선 톤(ChatPostCard).
 *  - 30분 단위 시간 디바이더로 흐름 가독성 확보.
 *  - 사용자 헤더 우측 드롭다운으로 반경 즉시 변경.
 *  - 30km 0건 → 50km → 100km → 전국 자동 확장 (반경 옵션 따라).
 *  - 위치 권한 거부 시 전국 모드 자동 + 헤더에 "📍 위치 켜기" 띠.
 *  - 새 글 N건 플로팅: 사용자가 맨 아래에서 100px 이상 떨어졌을 때 표시.
 *  - 스크롤 위치 sessionStorage 보존.
 *
 * 데이터:
 *  - subscribeActivePostsAll: posts collectionGroup asc 정렬
 *  - subscribeActivePinnedPosts: 본사 핑크 박스
 *  - stores collection 1회 fetch(status='active') — coords map 구축
 *  - subscribeFeedConfig: 본사 디폴트 반경 옵션
 *
 * 정책:
 *  - 카카오 SDK 호출 0회 (geocoding은 매장 어드민/사용자 위치 권한에서만).
 *  - Firebase rules: meta/* read public + posts collectionGroup read public 이미 OK.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  subscribeActivePostsAll,
  subscribeActivePinnedPosts,
  type StorePost,
  type PinnedPost,
} from '@/lib/posts';
import { subscribeFeedConfig, FEED_CONFIG_DEFAULT, formatRadiusKm, type FeedConfig } from '@/lib/feedConfig';
import { haversineMeters, type LatLng } from '@/lib/geo';
import { useTickingNow } from '@/lib/relativeTime';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import ChatPostCard from '@/components/mobile/posts/ChatPostCard';

const SCROLL_KEY = '/m/posts:scroll';
const NEW_BADGE_THRESHOLD = 2;
const STICKY_BOTTOM_PX = 100;
const TIME_BUCKET_MS = 30 * 60 * 1000;
const HQ_FALLBACK: LatLng = { lat: 35.115, lng: 129.0395 }; // 부산역 — 위치 거부 시 거리 기준

// 채팅방 톤 보장 — 첫 진입 직후 이미지 lazy/네트워크/라더 자동확장으로 scrollHeight가
// 늦게 늘어나는 케이스가 있어, 사용자 인터랙션 없을 때만 250ms 간격으로 5초간 강제로
// 맨 아래로 따라감. 사용자가 위로 스크롤하거나 다른 인터랙션을 시작하면 즉시 중단.
const STICK_BOTTOM_DURATION_MS = 5000;
const STICK_BOTTOM_INTERVAL_MS = 250;

const POSTS_DEBUG =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_POSTS_DEBUG === '1';
function dbg(...args: unknown[]) {
  if (POSTS_DEBUG && typeof console !== 'undefined') console.log('[m/posts]', ...args);
}

interface StoreCoord {
  id: string;
  name?: string;
  lat: number;
  lng: number;
}

export default function PostsPage() {
  const router = useRouter();
  const now = useTickingNow();

  // 본사 피드 설정 + 사용자가 선택한 반경
  const [cfg, setCfg] = useState<FeedConfig>(FEED_CONFIG_DEFAULT);
  const [selectedRadius, setSelectedRadius] = useState<number | null>(null);
  const [autoExpandedTo, setAutoExpandedTo] = useState<number | null>(null);

  // 사용자 위치 (위치 권한)
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

  // 데이터
  const [posts, setPosts] = useState<StorePost[]>([]);
  const [pinned, setPinned] = useState<PinnedPost[]>([]);
  const [storeCoords, setStoreCoords] = useState<Map<string, StoreCoord>>(new Map());
  const [loaded, setLoaded] = useState(false);

  // UI 상태
  const [radiusDropdownOpen, setRadiusDropdownOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; all: string[]; idx: number } | null>(null);
  const [newPostsBadge, setNewPostsBadge] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSeenCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  // 1) feedConfig 구독 + 초기 디폴트 반경 적용
  useEffect(() => {
    return subscribeFeedConfig((next) => {
      setCfg(next);
      setSelectedRadius((cur) => (cur == null ? next.defaultRadiusKm : cur));
    });
  }, []);

  // 2) 위치 권한 — best-effort. 거부 시 전국 모드 자동.
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationDenied(true),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  }, []);

  // 3) 매장 좌표 1회 fetch — lat/lng 있는 활성 매장만
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'stores'), where('status', '==', 'active')));
        if (cancelled) return;
        const map = new Map<string, StoreCoord>();
        snap.forEach((d) => {
          const data = d.data() as { name?: string; lat?: number; lng?: number };
          if (typeof data.lat === 'number' && typeof data.lng === 'number') {
            map.set(d.id, { id: d.id, name: data.name, lat: data.lat, lng: data.lng });
          }
        });
        setStoreCoords(map);
      } catch {
        // 좌표 없어도 페이지는 동작 (거리 표시만 생략)
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 4) posts + pinned 실시간 구독
  useEffect(() => {
    let emitCount = 0;
    const unsub1 = subscribeActivePostsAll(
      (items) => {
        emitCount += 1;
        dbg('subscribeActivePostsAll emit', { emit: emitCount, count: items.length });
        setPosts(items);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
    const unsub2 = subscribeActivePinnedPosts(setPinned, () => {});
    return () => { unsub1(); unsub2(); };
  }, []);

  // 5) 스크롤 위치 — 채팅방 톤
  //    - 첫 데이터 로드 시: 무조건 맨 아래(최신 글)로 즉시 jump. smooth X (카톡과 동일).
  //    - 매장 상세 다녀와서 복귀(sessionStorage에 위치 있고 같은 세션 내 navigation): 그 위치 복원.
  //    - 정책: 첫 진입 = 항상 맨 아래. sessionStorage는 페이지 내 이탈→복귀 케이스에서만 작동.
  //
  //    `sessionStorage`의 SCROLL_KEY는 onbeforeunload가 아닌 onscroll로 매 프레임 기록되므로,
  //    "최초 진입인지"를 메모리 ref(initialScrollDoneRef)로 판정. 페이지 첫 mount 시점에는
  //    SCROLL_KEY가 남아있어도 강제로 맨 아래로 이동.
  const initialScrollDoneRef = useRef(false);
  const isFirstMountRef = useRef(true);

  useEffect(() => {
    // 페이지 첫 mount 시점에 sessionStorage를 비워 "이번 진입은 최초"임을 보장
    // (이전 세션의 SCROLL_KEY가 남아있으면 그 위치로 복원되어 맨 위 고정 버그 재발)
    if (isFirstMountRef.current) {
      sessionStorage.removeItem(SCROLL_KEY);
      isFirstMountRef.current = false;
    }
  }, []);

  // 거리 필터링 — 결과 + 자동 확장 계산
  // (스크롤 useEffect보다 위에 선언 — visiblePostsAndExpansion.items.length를
  //  dependency로 사용하므로 TDZ 회피를 위해 선언 순서 유지 필수)
  const visiblePostsAndExpansion = useMemo(() => {
    // 사용 가능한 origin
    const origin = userLocation ?? HQ_FALLBACK;
    const baseRadius = selectedRadius ?? cfg.defaultRadiusKm;

    // 999 = 전국 → 전체 통과
    const inRadius = (km: number) => {
      if (km >= 999) return posts;
      const meters = km * 1000;
      return posts.filter((p) => {
        const c = storeCoords.get(p.storeId);
        if (!c) return locationDenied; // 좌표 없으면 전국 모드에서만 노출
        return haversineMeters(origin, { lat: c.lat, lng: c.lng }) <= meters;
      });
    };

    // 위치 거부 → 전국 자동
    if (locationDenied) {
      return { items: posts, effectiveRadius: 999, autoExpanded: false };
    }

    // 단계별 자동 확장 (옵션 정렬, baseRadius 이상 단계만)
    const ladder = Array.from(new Set([baseRadius, ...cfg.radiusOptions])).sort((a, b) => a - b);
    let lastResult = inRadius(baseRadius);
    if (lastResult.length > 0) {
      return { items: lastResult, effectiveRadius: baseRadius, autoExpanded: false };
    }
    for (const km of ladder) {
      if (km <= baseRadius) continue;
      const next = inRadius(km);
      if (next.length > 0) {
        return { items: next, effectiveRadius: km, autoExpanded: true };
      }
      lastResult = next;
    }
    // 모든 단계 0건
    return { items: lastResult, effectiveRadius: 999, autoExpanded: ladder[ladder.length - 1] > baseRadius };
  }, [posts, storeCoords, userLocation, locationDenied, selectedRadius, cfg]);

  // 자동확장 결과를 부수효과로만 기록 (UI 안내용)
  useEffect(() => {
    setAutoExpandedTo(visiblePostsAndExpansion.autoExpanded ? visiblePostsAndExpansion.effectiveRadius : null);
  }, [visiblePostsAndExpansion.autoExpanded, visiblePostsAndExpansion.effectiveRadius]);

  // 시간 버킷 그룹핑 (30분) — (B) 스크롤 effect가 groupedItems.length를 dep으로
  // 사용하므로 effect 위에 선언 (TDZ 회피).
  const groupedItems = useMemo(() => {
    type Group = { bucket: number; label: string; items: StorePost[] };
    const groups: Group[] = [];
    for (const p of visiblePostsAndExpansion.items) {
      const ms = p.createdAt?.toMillis?.() ?? 0;
      const bucket = Math.floor(ms / TIME_BUCKET_MS) * TIME_BUCKET_MS;
      const last = groups[groups.length - 1];
      if (!last || last.bucket !== bucket) {
        groups.push({ bucket, label: formatBucket(bucket, now), items: [p] });
      } else {
        last.items.push(p);
      }
    }
    return groups;
  }, [visiblePostsAndExpansion.items, now]);

  // ──────────────────────────────────────────────────────────────────────
  // 스크롤 — 채팅방 톤(카톡 오픈채팅)을 위해 3개 effect로 분리.
  //
  // (A) 마운트 1회: scroll listener + ResizeObserver를 한 번만 부착해
  //     컴포넌트 수명 동안 유지. (deps=[] 보장 — 새 글 도착 때마다 disconnect/
  //     reattach 되던 race를 차단.)
  //
  // (B) 첫 데이터 + 첫 paint 직후: useLayoutEffect로 paint 직전 강제 jump.
  //     이후 5초간 250ms 간격으로 "사용자 인터랙션 없으면" 다시 맨 아래로 보정.
  //     이미지 lazy decode·라더 자동확장으로 scrollHeight가 늦게 늘어나는 케이스 커버.
  //
  // (C) 새 글 도착 (visiblePosts 길이 증가): lock 상태면 자동 따라감,
  //     아니면 NEW 배지로 알림. (기존 새 글 토스트 effect 유지)
  // ──────────────────────────────────────────────────────────────────────

  // (A) — listener/observer 1회 부착
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      if (initialScrollDoneRef.current) {
        sessionStorage.setItem(SCROLL_KEY, String(el.scrollTop));
      }
      const bottomDist = el.scrollHeight - (el.scrollTop + el.clientHeight);
      isNearBottomRef.current = bottomDist <= STICKY_BOTTOM_PX;
      if (isNearBottomRef.current) setNewPostsBadge(0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    // ResizeObserver — scrollHeight 변경 시 잠금 상태면 자동 따라감.
    // 이미지 lazy load + 자동 확장 라더 진행 모두 커버.
    const ro = new ResizeObserver(() => {
      const node = scrollRef.current;
      if (!node) return;
      if (!isNearBottomRef.current) return; // 사용자 스크롤 의도 존중
      node.scrollTop = node.scrollHeight;
    });
    ro.observe(el);
    const firstChild = el.firstElementChild;
    if (firstChild) ro.observe(firstChild);

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  // (B) — 첫 데이터 도착 + paint 직전 강제 jump + 5초 안전망
  //   useLayoutEffect: paint 직전이라 flicker가 없고, 첫 렌더 직후 scrollHeight가
  //   확정된 상태에서 점프 가능.
  useLayoutEffect(() => {
    if (!loaded) return;
    if (initialScrollDoneRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    // groupedItems가 아직 0이면 안전망에 맡김 (포스트 0건은 EmptyState 노출, jump 불필요)
    if (groupedItems.length === 0) return;

    // 즉시 jump (paint 직전)
    el.scrollTop = el.scrollHeight;
    isNearBottomRef.current = true;
    initialScrollDoneRef.current = true;
    dbg('initial jump', { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight });

    // 5초 안전망 — 250ms 간격으로 lock 상태면 강제로 맨 아래로 보정.
    // 사용자가 위로 스크롤하거나 인터랙션 시작하면 isNearBottomRef.current=false →
    // 자동 중단.
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - startedAt > STICK_BOTTOM_DURATION_MS) {
        window.clearInterval(interval);
        return;
      }
      const node = scrollRef.current;
      if (!node) return;
      if (!isNearBottomRef.current) {
        window.clearInterval(interval);
        return;
      }
      const bottomDist = node.scrollHeight - (node.scrollTop + node.clientHeight);
      if (bottomDist > 1) {
        node.scrollTop = node.scrollHeight;
        dbg('safety re-stick', { bottomDist, scrollHeight: node.scrollHeight });
      }
    }, STICK_BOTTOM_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [loaded, groupedItems.length]);

  // (C) 새 글 도착 — lock 상태면 자동 따라감 (rAF 2겹으로 이미지 layout 후
  //     scrollHeight 확정 보장), 아니면 NEW 배지로 알림.
  useEffect(() => {
    const total = visiblePostsAndExpansion.items.length;
    const last = lastSeenCountRef.current;
    if (total > last) {
      dbg('new posts arrived', { total, prev: last, locked: isNearBottomRef.current });
      if (isNearBottomRef.current) {
        // rAF 2겹 — 첫 frame에 React commit, 두 번째 frame에 layout 확정된 scrollHeight 사용
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
        });
      } else {
        const delta = total - last;
        if (delta >= NEW_BADGE_THRESHOLD || newPostsBadge > 0) {
          setNewPostsBadge((n) => n + delta);
        }
      }
    }
    lastSeenCountRef.current = total;
  }, [visiblePostsAndExpansion.items.length, newPostsBadge]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewPostsBadge(0);
  }, []);

  const onSelectRadius = (km: number) => {
    setSelectedRadius(km);
    setRadiusDropdownOpen(false);
  };

  return (
    <div
      className="fixed inset-0 mx-auto flex flex-col"
      style={{
        maxWidth: '28rem', // max-w-md
        background: 'var(--bg)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* 새 카드 페이드인 keyframes — 카톡방 톤 (ChatPostCard에서 참조) */}
      <style>{`@keyframes m-posts-fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      {/* 헤더 */}
      <header
        className="flex items-center gap-2 px-3"
        style={{
          height: 52,
          background: 'var(--surface-1)',
          borderBottom: '1px solid var(--border)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center justify-center rounded-md"
          style={{ width: 36, height: 36, color: 'var(--text-1)' }}
          aria-label="뒤로"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="flex-1 text-base font-extrabold truncate" style={{ color: 'var(--text-1)' }}>
          오늘의 매장 소식
        </h1>
        {/* 반경 드롭다운 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setRadiusDropdownOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition active:scale-95"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
              border: '1px solid var(--border)',
            }}
            aria-label="반경 선택"
          >
            📍 {formatRadiusKm(selectedRadius ?? cfg.defaultRadiusKm)}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {radiusDropdownOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setRadiusDropdownOpen(false)} aria-hidden />
              <div
                className="absolute right-0 top-full mt-1 z-40 rounded-xl overflow-hidden"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  minWidth: 120,
                  boxShadow: '0 8px 24px -8px rgba(0,0,0,0.25)',
                }}
              >
                {cfg.radiusOptions.map((km) => (
                  <button
                    key={km}
                    type="button"
                    onClick={() => onSelectRadius(km)}
                    className="block w-full text-left text-xs font-semibold px-3 py-2.5 transition active:opacity-60"
                    style={{
                      color: km === selectedRadius ? 'var(--brand)' : 'var(--text-1)',
                      background: km === selectedRadius ? 'rgba(255,31,143,0.08)' : 'transparent',
                    }}
                  >
                    {formatRadiusKm(km)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </header>

      {/* 위치 거부 안내 띠 */}
      {locationDenied && (
        <div
          className="px-3 py-2 text-[11px] flex items-center gap-2"
          style={{
            background: 'rgba(255,31,143,0.06)',
            borderBottom: '1px solid rgba(255,31,143,0.20)',
            color: 'var(--text-2)',
          }}
        >
          <span>📍</span>
          <span className="flex-1">위치 권한 거부됨 — 전국 모드로 표시 중</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-[11px] font-bold underline"
            style={{ color: 'var(--brand)' }}
          >
            위치 켜기
          </button>
        </div>
      )}

      {/* 자동 확장 안내 띠 */}
      {autoExpandedTo && !locationDenied && (
        <div
          className="px-3 py-1.5 text-[11px] text-center"
          style={{
            background: 'rgba(245,158,11,0.06)',
            borderBottom: '1px solid rgba(245,158,11,0.18)',
            color: 'var(--text-2)',
          }}
        >
          가까운 매장 소식이 없어 <b>{formatRadiusKm(autoExpandedTo)}</b>로 자동 확장했어요
        </div>
      )}

      {/* 본사 pinned 상단 박스 */}
      {pinned.length > 0 && (
        <div className="px-3 py-2 flex flex-col gap-1.5" style={{ background: 'rgba(255,31,143,0.04)' }}>
          {pinned.slice(0, 2).map((item) => (
            <PinnedBox key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* 스크롤 영역 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 pt-3"
        style={{ background: 'var(--bg)' }}
      >
        {loaded && groupedItems.length === 0 ? (
          <EmptyState
            onExpandToNational={() => setSelectedRadius(999)}
            onRetry={() => window.location.reload()}
          />
        ) : (
          groupedItems.map((g) => (
            <div key={g.bucket}>
              <TimeDivider label={g.label} />
              {g.items.map((p) => {
                const c = storeCoords.get(p.storeId);
                const dist = c && userLocation
                  ? haversineMeters(userLocation, { lat: c.lat, lng: c.lng })
                  : undefined;
                // 매장명 fallback (post 본문에 없으면 stores 캐시에서)
                const name = p.storeName || c?.name;
                return (
                  <ChatPostCard
                    key={p.id}
                    post={{ ...p, storeName: name } as StorePost}
                    distanceMeters={dist}
                    now={now}
                    onImageClick={(url, all) =>
                      setLightbox({ url, all, idx: all.indexOf(url) })
                    }
                  />
                );
              })}
            </div>
          ))
        )}
        <div style={{ height: 12 }} />
      </div>

      {/* 새 글 N건 플로팅 */}
      {newPostsBadge >= NEW_BADGE_THRESHOLD && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute left-1/2 -translate-x-1/2 rounded-full font-bold transition active:scale-95"
          style={{
            bottom: 16,
            padding: '8px 16px',
            background: 'var(--brand, #FF1F8F)',
            color: '#fff',
            fontSize: 12,
            boxShadow: '0 4px 16px -4px rgba(255,31,143,0.45)',
          }}
        >
          ↓ 새 글 {newPostsBadge}건
        </button>
      )}

      {/* 라이트박스 */}
      {lightbox && (
        <Lightbox
          item={lightbox}
          onClose={() => setLightbox(null)}
          onPrev={() => setLightbox((p) => p && p.idx > 0 ? { ...p, url: p.all[p.idx - 1], idx: p.idx - 1 } : p)}
          onNext={() => setLightbox((p) => p && p.idx < p.all.length - 1 ? { ...p, url: p.all[p.idx + 1], idx: p.idx + 1 } : p)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 시간 디바이더
// ─────────────────────────────────────────────────────────────

function TimeDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-2.5">
      <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
      <div
        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{
          color: 'var(--text-3)',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
        }}
      >
        {label}
      </div>
      <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
    </div>
  );
}

function formatBucket(bucket: number, now: number): string {
  if (!bucket) return '';
  const d = new Date(bucket);
  const dayDiff = Math.floor((now - bucket) / (24 * 60 * 60 * 1000));
  const pad = (n: number) => n.toString().padStart(2, '0');
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (dayDiff <= 0) return `오늘 ${hhmm}`;
  if (dayDiff === 1) return `어제 ${hhmm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
}

// ─────────────────────────────────────────────────────────────
// Pinned 박스 (상단)
// ─────────────────────────────────────────────────────────────

function PinnedBox({ item }: { item: PinnedPost }) {
  const inner = (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{
        background: 'linear-gradient(135deg, rgba(255,31,143,0.12) 0%, rgba(255,31,143,0.04) 100%)',
        border: '1px solid rgba(255,31,143,0.25)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded"
          style={{ background: '#FF1F8F', color: '#fff' }}
        >
          공지
        </span>
        <span className="text-[12px] font-extrabold truncate" style={{ color: 'var(--text-1)' }}>
          {item.title}
        </span>
      </div>
      {item.body && (
        <div className="text-[11px] line-clamp-2" style={{ color: 'var(--text-2)' }}>
          {item.body}
        </div>
      )}
    </div>
  );
  if (item.ctaUrl) {
    return (
      <a href={item.ctaUrl} target="_blank" rel="noopener noreferrer" className="block transition active:opacity-70">
        {inner}
      </a>
    );
  }
  return inner;
}

// ─────────────────────────────────────────────────────────────
// 빈 상태
// ─────────────────────────────────────────────────────────────

function EmptyState({
  onExpandToNational,
  onRetry,
}: {
  onExpandToNational: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div style={{ fontSize: 54 }} aria-hidden>📭</div>
      <div className="font-extrabold text-base mt-3" style={{ color: 'var(--text-1)' }}>
        아직 소식이 없어요
      </div>
      <div className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
        반경을 넓혀보거나 잠시 후 다시 확인해주세요
      </div>
      <div className="flex gap-2 mt-5">
        <button
          type="button"
          onClick={onExpandToNational}
          className="rounded-full px-5 py-2.5 text-xs font-bold transition active:scale-95"
          style={{ background: 'var(--brand, #FF1F8F)', color: '#fff' }}
        >
          전국 보기
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full px-5 py-2.5 text-xs font-bold transition active:scale-95"
          style={{
            background: 'var(--surface-2)',
            color: 'var(--text-1)',
            border: '1px solid var(--border)',
          }}
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 라이트박스
// ─────────────────────────────────────────────────────────────

function Lightbox({
  item,
  onClose,
  onPrev,
  onNext,
}: {
  item: { url: string; all: string[]; idx: number };
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  // 터치 스와이프 — 다중 이미지에서 좌우 넘기기
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const SWIPE_THRESHOLD = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartXRef.current = t.clientX;
    touchStartYRef.current = t.clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const sx = touchStartXRef.current;
    const sy = touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    if (sx == null || sy == null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    // 수평 이동이 더 크고 임계치 초과 시 스와이프로 인식
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
      if (dx < 0) onNext();
      else onPrev();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 20 }}
        aria-label="닫기"
      >
        ✕
      </button>
      <img
        src={item.url}
        alt="확대 이미지"
        style={{ maxWidth: '94vw', maxHeight: '86vh', objectFit: 'contain' }}
        onClick={(e) => e.stopPropagation()}
      />
      {item.all.length > 1 && (
        <>
          {item.idx > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPrev(); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 18 }}
              aria-label="이전"
            >
              ‹
            </button>
          )}
          {item.idx < item.all.length - 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onNext(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 18 }}
              aria-label="다음"
            >
              ›
            </button>
          )}
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs font-bold px-3 py-1 rounded-full"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
          >
            {item.idx + 1} / {item.all.length}
          </div>
        </>
      )}
    </div>
  );
}
