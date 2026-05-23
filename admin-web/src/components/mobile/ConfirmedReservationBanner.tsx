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
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '@/lib/hooks';
import { subscribeUserReservations, type Reservation } from '@/lib/reservations';

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
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pink Rabbit 출시 최적화: status='authenticated'일 때만 uid 노출.
  // 'loading'·'anonymous' 동안엔 null이 유지되므로 onSnapshot 호출 자체가 발생하지 않음.
  // → 익명 사용자/초기 진입 시 collectionGroup('reservations') 풀스캔 구독 트리거 차단.
  const uid = authState.status === 'authenticated' ? authState.user.uid : null;

  // /m/reservations 페이지와 동일한 헬퍼 사용 — 인덱스·rules 흐름 통일.
  // pending + confirmed만 클라이언트 필터.
  // (subscribeUserReservations은 서버측 where('authorUid','==',uid) 이미 적용 — 본인 doc만 fetch)
  useEffect(() => {
    // 인증 확정 전 (loading/anonymous): 구독 skip. uid 변경되면 자동 재구독.
    if (!uid) {
      setReservations([]);
      setSubscribeError(null);
      return;
    }
    const unsub = subscribeUserReservations(
      uid,
      (list) => {
        const active = list.filter((r) => r.status === 'pending' || r.status === 'confirmed');
        setReservations(active);
        setSubscribeError(null);
      },
      (e) => {
        // silent fail 대신 사용자에게 visible 알림 — 인덱스/권한 문제 디버깅 용이.
        console.warn('[ConfirmedReservationBanner] 구독 오류', e);
        setSubscribeError(e.message);
      },
    );
    // unmount 또는 uid 변경(로그아웃) 시 onSnapshot 리스너 확실히 해제 → 메모리/네트워크 leak 방지.
    return unsub;
  }, [uid]);

  // 만료·표시 갱신을 위한 짧은 tick (5초). 인증 사용자에 한해서만 동작.
  // 익명 사용자에겐 reservations가 항상 빈 배열이므로 tick도 불필요.
  useEffect(() => {
    if (!uid) return;
    intervalRef.current = setInterval(() => {
      setNow(Date.now());
    }, 5_000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [uid]);

  // 인증 확정 전엔 배너 자체를 렌더하지 않음 (DOM·CSS 비용도 0).
  if (!uid) return null;

  const active = reservations.filter((r) => isActive(r, now));

  // 구독 오류는 잠깐 표시 — 인덱스 누락·rules 거부 등의 silent fail 방지.
  if (active.length === 0) {
    if (subscribeError) {
      return (
        <button
          onClick={() => router.push('/m/reservations')}
          className="w-full overflow-hidden text-left"
          style={{
            background: 'linear-gradient(90deg, #B91C1C, #DC2626)',
            height: 32,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
          <span className="text-white text-[11.5px] font-semibold truncate">
            ⚠️ 예약 알림을 불러올 수 없습니다 (탭하여 내 예약 페이지에서 확인)
          </span>
        </button>
      );
    }
    return null;
  }

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
