'use client';

/**
 * useReservationSoundAlert
 *
 * 매장 어드민에서 새 pending 예약이 도착하면 알림 사운드 재생.
 *
 * **사운드 소스 (fallback 체인)**:
 *   1. `/sounds/notification.mp3` — 실제 ding 파일 (있으면 우선)
 *   2. Web Audio API ding (sounds.ts) — placeholder. 파일이 silent여도 들림.
 *
 * 출시 전 placeholder 정책 (2026-05-25):
 * - 현재 notification.mp3는 104B silent placeholder (실제 ding 미배치).
 * - 사용자가 실제 ding 파일로 교체 가능 — 동일 경로 덮어쓰기만 하면 됨.
 * - 교체 안 해도 Web Audio API ding이 폴백으로 항상 들림.
 *
 * 브라우저 autoplay 정책:
 * - 사용자 제스처(클릭/터치) 없이 Audio.play()는 Promise 거부됨.
 * - localStorage 'notif_sound_primed' 플래그 사용:
 *   → 첫 사용자 클릭 이벤트에서 silent Audio.play()로 priming.
 *   → 이후 실제 재생은 primed 상태에서 즉시 실행.
 * - Web Audio API fallback도 같은 user-gesture 게이트 적용.
 */

import { useEffect, useRef } from 'react';
import { subscribeStoreReservations, type Reservation } from '@/lib/reservations';
import { unlockAudio } from '@/lib/sounds';

const PRIMED_KEY = 'notif_sound_primed';
const SOUND_PATH = '/sounds/notification.mp3';
/** mp3 파일 최소 크기 임계 (placeholder 감지). 104B 같은 더미는 silent → fallback 사용. */
const MIN_VALID_MP3_BYTES = 2048;

export function useReservationSoundAlert(storeId: string) {
  const primedRef = useRef<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioFileValidRef = useRef<boolean>(false); // mp3 placeholder 감지
  const prevPendingCountRef = useRef<number>(-1); // -1 = 초기값(첫 로드 구분용)

  // 오디오 엘리먼트 초기화 + 파일 유효성 검사
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const audio = new Audio(SOUND_PATH);
    audio.preload = 'auto';
    audioRef.current = audio;

    // mp3가 placeholder(<2KB)인지 HEAD로 확인 — 그러면 Web Audio API fallback 사용
    fetch(SOUND_PATH, { method: 'HEAD' })
      .then((res) => {
        const len = Number(res.headers.get('content-length') || '0');
        audioFileValidRef.current = len >= MIN_VALID_MP3_BYTES;
        if (!audioFileValidRef.current) {
          console.info(
            '[useReservationSoundAlert] notification.mp3 placeholder 감지 (' +
              len +
              'B). Web Audio API ding 폴백 사용.'
          );
        }
      })
      .catch(() => {
        audioFileValidRef.current = false;
      });

    // localStorage에서 primed 상태 복원
    if (localStorage.getItem(PRIMED_KEY) === '1') {
      primedRef.current = true;
    }

    return () => {
      audioRef.current = null;
    };
  }, []);

  // 첫 사용자 제스처로 priming (mp3 + Web Audio API 둘 다)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    function prime() {
      if (primedRef.current) return;
      // Web Audio API context 깨우기 (fallback 폴백)
      unlockAudio();

      const audio = audioRef.current;
      if (!audio) {
        primedRef.current = true;
        localStorage.setItem(PRIMED_KEY, '1');
        return;
      }
      // silent play → pause 패턴으로 autoplay 컨텍스트 획득
      audio.volume = 0;
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = 1;
          primedRef.current = true;
          localStorage.setItem(PRIMED_KEY, '1');
        })
        .catch(() => {
          // mp3 play 실패해도 Web Audio API fallback은 위에서 unlock됨
          primedRef.current = true;
          localStorage.setItem(PRIMED_KEY, '1');
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
    if (!primedRef.current) return; // priming 전엔 재생 안 함

    // 1순위: 실제 mp3 (≥2KB) — 사용자가 ding 파일 배치한 경우
    if (audioFileValidRef.current && audioRef.current) {
      const audio = audioRef.current;
      audio.currentTime = 0;
      audio.volume = 1;
      audio.play().catch(() => {
        // mp3 실패 → Web Audio API ding fallback
        playFallbackDing();
      });
      return;
    }
    // 2순위: Web Audio API ding (placeholder 또는 mp3 로드 실패)
    playFallbackDing();
  }
}

/** Web Audio API로 즉시 합성하는 알림 ding. notification.mp3 없거나 placeholder일 때 fallback.
 *  C5(523Hz) → E5(659Hz) 짧은 2음 차임 (300ms 총). 카운트다운 비프와 구분되는 톤. */
function playFallbackDing(): void {
  if (typeof window === 'undefined') return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    // 2음 ding: C5 → E5
    const notes: Array<{ freq: number; start: number; dur: number }> = [
      { freq: 523, start: 0, dur: 0.14 },
      { freq: 659, start: 0.1, dur: 0.18 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0, now + n.start);
      gain.gain.linearRampToValueAtTime(0.5, now + n.start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.05);
    }
    // 0.5s 후 context 자동 정리 (메모리 누수 방지)
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 500);
  } catch {
    /* AudioContext 미지원 환경 — silent */
  }
}
