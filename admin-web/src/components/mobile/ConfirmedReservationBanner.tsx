'use client';

/**
 * ConfirmedReservationBanner
 *
 * 사용자 앱 홈 상단 예약 알림 마퀴 띠.
 * - 사용자가 예약 신청(pending) 직후부터 매퀴 표시 — 노랑 톤(확인 대기)
 * - 매장이 확정하면 녹색 톤으로 자동 전환
 * - 인증 사용자 자신의 예약 중 reservedFor + duration 지나지 않은 것만 표시
 * - 60초마다 만료 체크, active 0개면 null
 * - 우→좌 CSS 마퀴 18s 무한 반복, prefers-reduced-motion: 정적 표시
 * - 클릭 시 내 예약 목록(/m/reservations)로 이동
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collectionGroup, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import type { Reservation } from '@/lib/reservations';

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatKSTShort(ts: Timestamp): string {
  const d = new Date(ts.toMillis());
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isActive(r: Reservation, now: number): boolean {
  const reservedMs = r.reservedFor?.toMillis?.() ?? 0;
  const durationMs = (r.durationMinutes ?? 120) * 60 * 1000;
  return reservedMs + durationMs > now;
}

export default function ConfirmedReservationBanner() {
  const authState = useAuth();
  const router = useRouter();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const uid = authState.status === 'authenticated' ? authState.user.uid : null;

  // confirmed 예약 구독 (collectionGroup — authorUid == uid, status == confirmed)
  useEffect(() => {
    if (!uid) {
      setReservations([]);
      return;
    }

    // composite index 회피 — authorUid single where 만 적용, status 클라이언트 필터
    // (기존 index 'authorUid+createdAt' 재사용. authorUid+status 신규 index 불필요)
    const q = query(
      collectionGroup(db, 'reservations'),
      where('authorUid', '==', uid),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs
          .filter((d) => {
            const s = (d.data() as { status?: string }).status;
            // pending(신청 대기) + confirmed(확정) 둘 다 banner 노출.
            // cancelled/rejected/no_show 는 제외.
            return s === 'pending' || s === 'confirmed';
          })
          .map((d) => {
          const data = d.data() as Record<string, unknown>;
          const storeIdFromPath = d.ref.parent.parent?.id ?? '';
          return {
            id: d.id,
            storeId: (data.storeId as string) ?? storeIdFromPath,
            storeName: (data.storeName as string) ?? '',
            authorUid: (data.authorUid as string) ?? '',
            authorName: (data.authorName as string) ?? '',
            authorPhone: (data.authorPhone as string | null | undefined) ?? null,
            reservedFor: data.reservedFor as Timestamp,
            partySize: (data.partySize as number) ?? 1,
            note: (data.note as string | null | undefined) ?? null,
            participatingGame: (data.participatingGame as string | null | undefined) ?? null,
            status: ((data.status as string) ?? 'pending') as Reservation['status'],
            createdAt: data.createdAt as Timestamp,
            updatedAt: data.updatedAt as Timestamp,
            respondedAt: (data.respondedAt as Timestamp | null | undefined) ?? null,
            respondedBy: (data.respondedBy as string | null | undefined) ?? null,
            responseNote: (data.responseNote as string | null | undefined) ?? null,
            readByStore: (data.readByStore as boolean | undefined) ?? false,
            durationMinutes: (data.durationMinutes as number | undefined) ?? 120,
            confirmedAt: (data.confirmedAt as Timestamp | null | undefined) ?? null,
          } satisfies Reservation;
        });
        setReservations(items);
      },
      (e) => {
        console.warn('[ConfirmedReservationBanner] 구독 오류', e);
      },
    );

    return unsub;
  }, [uid]);

  // 만료·표시 갱신을 위한 짧은 tick (5초). onSnapshot이 status 변화는 즉시
  // 전달하지만 reservedFor + duration 만료 같은 시간 기반 필터는 tick으로 재평가.
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setNow(Date.now());
    }, 5_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const active = reservations.filter((r) => isActive(r, now));
  if (active.length === 0) return null;

  // pending이 하나라도 있으면 노랑(amber) 톤. 모두 confirmed면 녹색 톤.
  const hasPending = active.some((r) => r.status === 'pending');
  const background = hasPending
    ? 'linear-gradient(90deg, #D97706, #F59E0B, #FBBF24)'
    : 'linear-gradient(90deg, #059669, #10B981, #34D399)';

  // 상태별 메시지
  const marqueeText = active
    .map((r) => {
      const when = formatKSTShort(r.reservedFor);
      const people = `${r.partySize}명`;
      if (r.status === 'pending') {
        return `✋ ${r.storeName} ${when} 예약 신청 · ${people} · 매장 확인을 기다리는 중`;
      }
      return `🎉 ${r.storeName} ${when} 예약 확정 · ${people} · 도착 시 입장 안내드립니다`;
    })
    .join('   ·   ');

  // 클릭 시 내 예약 목록으로 (여러 예약 한 곳에서 확인 가능)
  return (
    <>
      <button
        onClick={() => router.push('/m/reservations')}
        aria-label={hasPending ? '예약 확인 대기 — 내 예약 보기' : '예약 확정 — 내 예약 보기'}
        className="w-full overflow-hidden"
        style={{
          background,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          // 노랑→녹색 색 전환을 부드럽게 시각화 (사용자가 확정을 인지하도록).
          transition: 'background 600ms ease',
        }}
      >
        <span
          className="whitespace-nowrap text-white font-medium text-[13px] inline-block marquee-text"
          style={{ willChange: 'transform' }}
          aria-hidden
        >
          {/* 두 번 반복하면 끝에서 이음새 없이 이어짐 */}
          {marqueeText}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{marqueeText}
        </span>
        {/* 스크린 리더용 정적 텍스트 */}
        <span className="sr-only">{marqueeText}</span>
      </button>

      <style jsx>{`
        @keyframes marquee-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .marquee-text {
          animation: marquee-scroll 18s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-text {
            animation: none;
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
}
