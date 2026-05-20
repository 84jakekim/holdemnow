'use client';

/**
 * useReservationSoundAlert
 *
 * 매장 어드민에서 새 pending 예약이 도착하면 notification.mp3를 재생.
 *
 * 브라우저 autoplay 정책:
 * - 사용자 제스처(클릭/터치) 없이 Audio.play()는 Promise 거부됨.
 * - localStorage 'notif_sound_primed' 플래그를 사용:
 *   → 첫 사용자 클릭 이벤트에서 silent Audio.play()로 priming.
 *   → 이후 실제 재생은 primed 상태에서 즉시 실행.
 */

import { useEffect, useRef } from 'react';
import { subscribeStoreReservations, type Reservation } from '@/lib/reservations';

const PRIMED_KEY = 'notif_sound_primed';
const SOUND_PATH = '/sounds/notification.mp3';

export function useReservationSoundAlert(storeId: string) {
  const primedRef = useRef<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevPendingCountRef = useRef<number>(-1); // -1 = 초기값(첫 로드 구분용)

  // 오디오 엘리먼트 초기화
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const audio = new Audio(SOUND_PATH);
    audio.preload = 'auto';
    audioRef.current = audio;

    // localStorage에서 primed 상태 복원
    if (localStorage.getItem(PRIMED_KEY) === '1') {
      primedRef.current = true;
    }

    return () => {
      audioRef.current = null;
    };
  }, []);

  // 첫 사용자 제스처로 priming
  useEffect(() => {
    if (typeof window === 'undefined') return;

    function prime() {
      if (primedRef.current) return;
      const audio = audioRef.current;
      if (!audio) return;
      // silent play → pause 패턴으로 autoplay 컨텍스트 획득
      audio.volume = 0;
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
        primedRef.current = true;
        localStorage.setItem(PRIMED_KEY, '1');
      }).catch(() => {
        // 무시
      });
    }

    window.addEventListener('click', prime, { once: true });
    window.addEventListener('touchstart', prime, { once: true });
    return () => {
      window.removeEventListener('click', prime);
      window.removeEventListener('touchstart', prime);
    };
  }, []);

  // 예약 구독 — pending 개수 변화 감지
  useEffect(() => {
    if (!storeId) return;

    const unsub = subscribeStoreReservations(
      storeId,
      (items: Reservation[]) => {
        const pendingCount = items.filter((r) => r.status === 'pending').length;

        // 첫 로드는 알림 없이 카운트만 기록
        if (prevPendingCountRef.current === -1) {
          prevPendingCountRef.current = pendingCount;
          return;
        }

        // 새 pending 예약 도착 감지
        if (pendingCount > prevPendingCountRef.current) {
          playSound();
        }
        prevPendingCountRef.current = pendingCount;
      },
      (e) => {
        console.warn('[useReservationSoundAlert] 구독 오류', e);
      },
    );

    return unsub;
  }, [storeId]);

  function playSound() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!primedRef.current) return; // priming 전엔 재생 안 함

    audio.currentTime = 0;
    audio.volume = 1;
    audio.play().catch((e) => {
      console.warn('[useReservationSoundAlert] play() 실패', e);
    });
  }
}
