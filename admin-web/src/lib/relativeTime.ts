/**
 * relativeTime — "5분 전" 같은 한국어 상대 시각 표기 (Phase F, 2026-05-22).
 *
 * 정책:
 *  - 1분 미만 → "방금 전"
 *  - 1~59분  → "N분 전"
 *  - 1~23시간 → "N시간 전"
 *  - 24시간 이상 → "1일 전" (24h 만료 정책이라 곧 사라짐 안내)
 *
 * 의존성 없이 자체 구현 — date-fns/dayjs 미설치 정책 유지.
 * useCurrentTime 훅으로 1분마다 자동 갱신 가능.
 */
import { useEffect, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export function formatRelativeKo(target: number | Date | Timestamp | undefined | null, now = Date.now()): string {
  if (target == null) return '';
  let ms: number;
  if (typeof target === 'number') ms = target;
  else if (target instanceof Date) ms = target.getTime();
  else if (typeof (target as Timestamp).toMillis === 'function') ms = (target as Timestamp).toMillis();
  else return '';

  const diff = Math.max(0, now - ms);
  if (diff < MIN) return '방금 전';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}분 전`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)}시간 전`;
  return '1일 전';
}

/**
 * 컴포넌트가 마운트되어 있는 동안 60초마다 now를 갱신.
 * 카드가 화면에 노출 중일 때 "5분 전" → "6분 전" 자연 흐름 보장.
 */
export function useTickingNow(intervalMs = 60 * 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
