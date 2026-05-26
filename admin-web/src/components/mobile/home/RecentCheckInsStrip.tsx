'use client';

/**
 * RecentCheckInsStrip — 홈 "지금 다녀온 사람들" 섹션 (소셜 v0.1)
 *
 * 메모리: project_social_feature_plan v0.1
 *  - 별도 탭 신설 X. 홈 한 섹션으로만 노출.
 *  - 매장찾기/토너 영역과 데이터·UI 분리 (유저↔유저 도메인).
 *
 * 패턴:
 *  - DailyPostsCarousel과 동일한 톤(.pr-chat-* 토큰 재활용)으로 채팅방 일관성 확보.
 *  - 5건 horizontal scroll. 카드 클릭 → 매장 상세 이동.
 *  - 빈 상태: 섹션 자체 렌더 안 함 (홈 노이즈 최소화).
 *
 * Out of scope (v0.5+): 좋아요/댓글/팔로우/알림/실시간 ping.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { subscribeRecentCheckIns, type CheckIn } from '@/lib/checkIns';
import { formatRelativeKo, useTickingNow } from '@/lib/relativeTime';

const MAX_ITEMS = 5;

export default function RecentCheckInsStrip() {
  const [items, setItems] = useState<CheckIn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const now = useTickingNow(30_000);

  useEffect(() => {
    const unsub = subscribeRecentCheckIns(
      MAX_ITEMS,
      (next) => {
        setItems(next);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
    return unsub;
  }, []);

  const list = useMemo(() => items.slice(0, MAX_ITEMS), [items]);

  // 로딩 중에도 섹션 자체를 렌더하지 않는다.
  // 헤더 텍스트가 0건 확정 전에 잠깐 깜빡이는 문제 차단 (2026-05-27 사용자 보고).
  // 데이터가 확인된 뒤에만 헤더 + 카드 동시 등장 — 약간의 layout shift는 노이즈보다 덜 거슬림.
  if (!loaded || list.length === 0) return null;

  return (
    <section aria-label="지금 다녀온 사람들" className="px-4 py-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-extrabold leading-tight" style={{ color: 'var(--text-1)' }}>
          <span aria-hidden style={{ marginRight: 6 }}>✅</span>
          지금 다녀온 사람들
        </h2>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>
          최근 24시간
        </span>
      </div>

      <div
        className="flex gap-2 overflow-x-auto no-scrollbar"
        style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
      >
        {list.map((c) => {
          const ms = c.createdAt.toMillis();
          const rel = formatRelativeKo(ms, now);
          const initial = (c.displayName || '?').trim().charAt(0).toUpperCase() || '?';
          return (
            <Link
              key={c.id}
              href={`/m/store/${c.storeId}`}
              prefetch={false}
              aria-label={`${c.storeName} 다녀온 ${c.displayName}`}
              className="lift tap"
              style={{
                width: 180,
                flexShrink: 0,
                scrollSnapAlign: 'start',
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                textDecoration: 'none',
                color: 'inherit',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              {/* 헤더 — 아바타 + 닉네임 + 시간 */}
              <div className="flex items-center gap-2">
                {c.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.avatarUrl}
                    alt=""
                    width={28}
                    height={28}
                    style={{ width: 28, height: 28, borderRadius: 99, objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <div
                    aria-hidden
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 99,
                      flexShrink: 0,
                      background: 'linear-gradient(135deg,#FF1F8F,#FF6BB5)',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {initial}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[12px] font-bold truncate"
                    style={{ color: 'var(--text-1)' }}
                  >
                    {c.displayName}
                  </div>
                  <div
                    className="text-[10px] font-semibold"
                    style={{ color: 'var(--text-3)' }}
                  >
                    {rel}
                  </div>
                </div>
              </div>

              {/* 매장명 */}
              <div
                className="text-[12px] font-extrabold truncate"
                style={{ color: '#FF1F8F' }}
              >
                {c.storeName}
              </div>

              {/* 한 줄 후기 (선택) */}
              {c.comment && (
                <div
                  className="text-[11px] leading-snug"
                  style={{
                    color: 'var(--text-2)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {c.comment}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
