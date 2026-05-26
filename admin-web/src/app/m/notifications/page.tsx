'use client';

/**
 * /m/notifications — 인앱 알림 풀스크린 페이지
 *
 * PM 결정 (2026-05-27):
 *   - 시트가 아닌 별도 페이지 — 모바일에서 가장 자연스러움 + 무한 스크롤 가능 + 깊은 진입 가능.
 *   - 종 버튼은 어디서든 이 페이지로 라우팅.
 *   - 비로그인 사용자는 로그인 유도 EmptyState.
 *
 * 핵심 UX:
 *   - 핫핑크 hero (다른 /m/* 페이지와 톤 통일)
 *   - 최신순 카드 리스트
 *   - 안 읽음 = 핫핑크 dot + 약한 배경 강조
 *   - 카드 클릭 → linkPath 이동 + read=true 자동
 *   - "모두 읽음 처리" 우상단
 *   - 빈 상태 EmptyState
 *
 * 데이터:
 *   - subscribeNotifications(uid, ..., limit:50) — onSnapshot 실시간
 *   - 만료된 알림은 클라이언트 측 expiresAt 필터로 자동 제외
 *   - markAsRead / markAllAsRead
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks';
import {
  type InAppNotification,
  markAllAsRead,
  markAsRead,
  notificationVisual,
  subscribeNotifications,
} from '@/lib/notifications';
import EmptyState from '@/components/ui/EmptyState';

function relativeTime(ms: number | null | undefined): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return '방금';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function NotificationsPage() {
  const authState = useAuth();
  const router = useRouter();
  const uid = authState.status === 'authenticated' ? authState.user.uid : null;

  const [items, setItems] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkMarking, setBulkMarking] = useState(false);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeNotifications(
      uid,
      (next) => {
        setItems(next);
        setLoading(false);
      },
      { limit: 50, onError: () => setLoading(false) },
    );
    return () => unsub();
  }, [uid]);

  const unreadCount = useMemo(() => items.filter((i) => !i.read).length, [items]);

  async function onCardClick(n: InAppNotification) {
    if (!uid) return;
    // read=true 자동 (linkPath 있어도 fire-and-forget)
    if (!n.read) {
      markAsRead(uid, n.id).catch(() => {});
    }
    if (n.linkPath) {
      router.push(n.linkPath);
    }
  }

  async function onMarkAll() {
    if (!uid || bulkMarking || unreadCount === 0) return;
    setBulkMarking(true);
    try {
      await markAllAsRead(uid);
    } catch (err) {
      console.warn('[markAllAsRead] failed', err);
    } finally {
      setBulkMarking(false);
    }
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* ──────────────────────────────────────────────────────
          Hero — 핫핑크 그라데이션 (다른 /m/* 페이지와 통일)
      ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 pr-home-hero">
        <div className="pr-home-hero-content px-4 h-16 flex items-center justify-between gap-3">
          <Link
            href="/m"
            aria-label="홈으로"
            className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full hero-pink-action transition active:opacity-60"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>

          <div className="flex-1 min-w-0 flex flex-col items-center justify-center leading-tight">
            <div className="text-[14px] font-bold" style={{ color: '#FFFFFF', textShadow: '0 1px 3px rgba(0,0,0,0.18)' }}>
              알림
            </div>
            <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.88)' }}>
              {unreadCount > 0 ? `읽지 않은 알림 ${unreadCount}` : '모두 확인했어요'}
            </div>
          </div>

          <button
            type="button"
            onClick={onMarkAll}
            disabled={unreadCount === 0 || bulkMarking}
            className="flex-shrink-0 px-3 h-9 rounded-full text-[12px] font-semibold transition active:opacity-60"
            style={{
              background: unreadCount === 0 ? 'rgba(255,255,255,0.18)' : '#FFFFFF',
              color: unreadCount === 0 ? 'rgba(255,255,255,0.6)' : 'var(--brand)',
              opacity: bulkMarking ? 0.6 : 1,
              cursor: unreadCount === 0 ? 'default' : 'pointer',
            }}
          >
            {bulkMarking ? '처리 중' : '모두 읽음'}
          </button>
        </div>
      </header>

      {/* ──────────────────────────────────────────────────────
          본문
      ────────────────────────────────────────────────────── */}
      <section className="px-4 py-5">
        {!uid && (
          <EmptyState
            icon="🔔"
            title="로그인 후 알림을 확인할 수 있어요"
            desc="예약·토너 시작·즐겨찾기 매장 LIVE 알림을 받아보세요."
            action={
              <Link href="/login" className="btn-brand">로그인</Link>
            }
          />
        )}

        {uid && loading && (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel" style={{ height: 72, borderRadius: 16 }} />
            ))}
          </div>
        )}

        {uid && !loading && items.length === 0 && (
          <EmptyState
            icon="🌸"
            title="새 알림이 없어요"
            desc="예약·토너·즐겨찾기 매장 소식이 도착하면 여기에서 알려드려요."
          />
        )}

        {uid && !loading && items.length > 0 && (
          <ul className="flex flex-col gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {items.map((n) => {
              const visual = notificationVisual(n.type);
              const createdMs = n.createdAt?.toMillis() ?? null;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onCardClick(n)}
                    className="w-full pr-card lift tap"
                    style={{
                      display: 'flex',
                      gap: 12,
                      alignItems: 'flex-start',
                      padding: 14,
                      textAlign: 'left',
                      background: n.read ? 'var(--surface-1)' : 'rgba(236, 72, 153, 0.06)',
                      border: n.read
                        ? '1px solid var(--border)'
                        : '1.5px solid rgba(236, 72, 153, 0.32)',
                      borderRadius: 16,
                      cursor: 'pointer',
                    }}
                    aria-label={`${visual.label} — ${n.title}${n.read ? '' : ' (안 읽음)'}`}
                  >
                    {/* 아이콘 + 색 띠 */}
                    <div
                      style={{
                        flexShrink: 0,
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        background: `${visual.color}1A`,
                        color: visual.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                      }}
                      aria-hidden
                    >
                      {visual.icon}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="text-[13px] font-bold"
                        style={{
                          color: 'var(--text-1)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          minWidth: 0,
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {n.title}
                        </span>
                        {!n.read && (
                          <span
                            style={{
                              flexShrink: 0,
                              width: 8,
                              height: 8,
                              borderRadius: 99,
                              background: 'var(--brand, #EC4899)',
                            }}
                            aria-hidden
                          />
                        )}
                      </div>
                      <div
                        className="text-[12.5px]"
                        style={{
                          color: 'var(--text-2)',
                          marginTop: 3,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {n.body}
                      </div>
                      <div
                        className="text-[11px]"
                        style={{ color: 'var(--text-3)', marginTop: 5 }}
                      >
                        {relativeTime(createdMs)}
                        {n.linkPath ? ' · 바로가기' : ''}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* 안내 푸터 — 30일 자동 정리 */}
        {uid && !loading && items.length > 0 && (
          <div
            className="text-[11px]"
            style={{ color: 'var(--text-3)', textAlign: 'center', marginTop: 16 }}
          >
            30일 이전 알림은 자동으로 정리됩니다
          </div>
        )}
      </section>
    </div>
  );
}
