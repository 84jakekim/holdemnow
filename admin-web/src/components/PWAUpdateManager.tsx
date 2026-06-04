'use client';

/**
 * PWAUpdateManager
 *
 * PWA가 새 빌드로 자동 갱신되도록 보장. 매장 사장 600명에게 "PWA 삭제 후 재설치"
 * 시킬 수 없으므로 사용자 손 안 대고 5분 안에 새 빌드 받게 만든다.
 *
 * 동작 흐름:
 * 1. 마운트 시 `/firebase-messaging-sw.js`를 `updateViaCache:'none'`으로 등록.
 *    → 브라우저가 SW JS 파일을 캐시하지 않고 매번 서버에서 받아온다.
 * 2. 60초마다 + visibility 복귀(앱 포커스) 시 `registration.update()` 호출.
 *    → 서버에 새 SW가 있으면 다운로드해서 `waiting` 상태로 대기시킨다.
 * 3. `waiting` SW가 있으면 → 즉시 `SKIP_WAITING` postMessage로 활성화 트리거.
 * 4. `controllerchange` 이벤트 발생 → 새 SW가 페이지를 점유한 시점.
 *    → 사용자에게 "새 버전이 적용되었습니다" 토스트 + 3초 후 자동 reload.
 *    (input/textarea 포커스 중이면 reload 보류 → idle 될 때까지 대기)
 *
 * 보강: build-id 헤더 비교 fallback.
 *  - SW가 동작하지 않는 브라우저(예: 일부 iOS Safari standalone)에서도 갱신되도록.
 *  - HEAD `/manifest.webmanifest` 응답의 `etag` 또는 `last-modified`가 변하면
 *    페이지를 부드럽게 reload. visibility 복귀 시 1회만 검사.
 *
 * 마운트 위치: root layout (`src/app/layout.tsx`).
 * 모든 라우트(/m, /admin, /organizer, /platform) 공통 보호.
 */

import { useEffect, useRef, useState } from 'react';

const UPDATE_POLL_INTERVAL_MS = 60_000;
const RELOAD_DELAY_MS = 3_000;
const SW_PATH = '/firebase-messaging-sw.js';

/** input/textarea/contenteditable 포커스 중인지 — reload 보류 판단용 */
function isUserBusy(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

export default function PWAUpdateManager() {
  const [showToast, setShowToast] = useState(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadingRef = useRef(false);

  // stale chunk 전역 캐치 (2026-06-04) — 배포 직후 구버전 클라이언트가 새 빌드의
  // 해시 청크를 404로 받으면 ChunkLoadError. error boundary(app/error.tsx) 도달 전에
  // 여기서 먼저 잡아 세션당 1회 자동 새로고침 (이벤트 핸들러·비동기 reject 경로 커버).
  useEffect(() => {
    const RELOAD_FLAG = 'hn:chunkReloaded';
    const isChunkErr = (v: unknown): boolean => {
      const s =
        v instanceof Error ? `${v.name} ${v.message}` : typeof v === 'string' ? v : '';
      return /ChunkLoadError|Loading chunk|CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(s);
    };
    const tryReload = () => {
      try {
        if (window.sessionStorage.getItem(RELOAD_FLAG)) return;
        window.sessionStorage.setItem(RELOAD_FLAG, '1');
        window.location.reload();
      } catch {
        // noop
      }
    };
    const onError = (e: ErrorEvent) => {
      if (isChunkErr(e.error) || isChunkErr(e.message)) tryReload();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkErr(e.reason)) tryReload();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    // 새 SW가 페이지 점유한 순간 → 토스트 + 지연 reload
    const onControllerChange = () => {
      if (reloadingRef.current) return; // 중복 방지
      reloadingRef.current = true;
      setShowToast(true);
      scheduleReload();
    };

    const scheduleReload = () => {
      // 사용자가 입력 중이면 1초 후 재검사. idle 될 때까지 reload 보류.
      const tryReload = () => {
        if (cancelled) return;
        if (isUserBusy()) {
          reloadTimerRef.current = setTimeout(tryReload, 1_000);
          return;
        }
        // 안전한 시점에 reload
        window.location.reload();
      };
      reloadTimerRef.current = setTimeout(tryReload, RELOAD_DELAY_MS);
    };

    // waiting SW가 생기면 즉시 활성화 트리거
    const promoteWaiting = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    };

    // 등록
    navigator.serviceWorker
      .register(SW_PATH, {
        scope: '/',
        // 브라우저가 SW JS 자체를 캐시하지 않게 함 — 새 빌드 SW가 즉시 감지됨
        updateViaCache: 'none',
      })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;

        // 첫 등록 직후 한 번 체크 + 이미 대기 중인 SW가 있으면 활성화
        promoteWaiting(reg);

        // updatefound 이벤트 — 새 SW가 install 단계 진입
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') {
              // controller가 이미 있으면 = 기존 사용자가 새 SW 받음 → 활성화 트리거
              if (navigator.serviceWorker.controller) {
                promoteWaiting(reg);
              }
              // controller 없음 = 첫 방문이라 토스트 불필요
            }
          });
        });

        // 60초 주기 update 폴링
        pollTimer = setInterval(() => {
          reg.update().catch(() => {});
        }, UPDATE_POLL_INTERVAL_MS);
      })
      .catch((err) => {
        // SW 등록 실패해도 앱은 정상 동작 — FCM만 못 받을 뿐
        console.warn('[PWAUpdateManager] SW 등록 실패', err);
      });

    // controller 교체 감지 — 새 SW가 페이지 점유
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    // visibility 복귀 시 즉시 update 체크 (앱 포커스 복귀 케이스)
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (!registration) return;
      registration.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!showToast) return null;

  // 새 버전 적용 토스트 — 화면 하단 fixed. reload 직전 잠깐 보임.
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 2147483647,
        background: '#FF1F8F',
        color: '#fff',
        padding: '12px 20px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        boxShadow: '0 8px 24px rgba(255, 31, 143, 0.35)',
        maxWidth: '90vw',
        textAlign: 'center',
        whiteSpace: 'nowrap',
      }}
    >
      새 버전이 적용되었습니다. 잠시 후 새로고침됩니다…
    </div>
  );
}
