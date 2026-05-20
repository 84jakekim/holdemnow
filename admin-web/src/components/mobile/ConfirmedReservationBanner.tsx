'use client';

/**
 * ConfirmedReservationBanner
 *
 * 사용자 앱 홈 상단 녹색 마퀴 띠.
 * - 인증 사용자 자신의 confirmed 예약 중 아직 유효한 것만 표시
 *   (reservedFor + durationMinutes*60s > now)
 * - 우→좌 CSS 마퀴 12s 무한 반복
 * - 60초마다 만료 체크, active 0개면 null 반환
 * - prefers-reduced-motion: 정적 표시
 * - 클릭 시 매장 상세로 이동
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
          .filter((d) => (d.data() as { status?: string }).status === 'confirmed')
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
            status: 'confirmed' as const,
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

  // 60초마다 만료 체크
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const active = reservations.filter((r) => isActive(r, now));
  if (active.length === 0) return null;

  // 마퀴 내용 생성
  const marqueeText = active
    .map(
      (r) =>
        `🎉 ${r.storeName} ${formatKSTShort(r.reservedFor)} 예약 확정 · 인원 ${r.partySize}명 · 도착 시 입장 안내드립니다`,
    )
    .join('   ·   ');

  // 여러 예약 있을 때 첫 번째 클릭 대상
  const primaryStoreId = active[0].storeId;

  return (
    <>
      <button
        onClick={() => router.push(`/m/store/${primaryStoreId}`)}
        aria-label="예약 확정 — 매장 상세로 이동"
        className="w-full overflow-hidden"
        style={{
          background: 'linear-gradient(90deg, #059669, #10B981, #34D399)',
          height: 36,
          display: 'flex',
          alignItems: 'center',
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
