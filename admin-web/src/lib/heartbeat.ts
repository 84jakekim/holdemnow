'use client';

import { useEffect } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;  // 5분

/**
 * 사용자 lastActiveAt 5분 heartbeat.
 * - 인증된 사용자만 갱신.
 * - 페이지가 보이는 동안만 동작 (visibilitychange 대응).
 * - 첫 호출 즉시 1회 + 5분마다 갱신.
 * - tab/page hidden 시 일시 정지, visible 복귀 시 즉시 1회 + interval 재개.
 */
export function useHeartbeat(uid: string | null | undefined) {
  useEffect(() => {
    if (!uid) return;
    if (typeof document === 'undefined') return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const beat = () => {
      // visible할 때만 갱신 — 백그라운드 탭의 무의미한 write 방지
      if (document.visibilityState !== 'visible') return;
      setDoc(
        doc(db, 'users', uid),
        { lastActiveAt: serverTimestamp() },
        { merge: true },
      ).catch(() => {
        // silent — 권한·네트워크 실패는 무시
      });
    };

    const start = () => {
      if (intervalId) return;
      beat();  // 즉시 1회
      intervalId = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [uid]);
}
