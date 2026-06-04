'use client';

/**
 * 루트 레이아웃 크래시용 글로벌 에러 바운더리 (2026-06-04).
 * error.tsx와 동일한 chunk 자동복구 + 친화 UI — 단 root layout을 대체하므로
 * <html><body>를 직접 렌더해야 한다 (전역 CSS 미로드 가정, 인라인 스타일만).
 */

import { useEffect } from 'react';

const RELOAD_FLAG = 'hn:chunkReloaded';

function isChunkLoadError(error: { name?: string; message?: string }): boolean {
  const s = `${error?.name ?? ''} ${error?.message ?? ''}`;
  return /ChunkLoadError|Loading chunk|CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|_next\/static/i.test(s);
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!isChunkLoadError(error)) return;
    try {
      if (!window.sessionStorage.getItem(RELOAD_FLAG)) {
        window.sessionStorage.setItem(RELOAD_FLAG, '1');
        window.location.reload();
      }
    } catch {
      // noop
    }
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center',
          background: '#0F1419', color: '#fff',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ fontSize: 44, marginBottom: 12 }}>🐰</div>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>
          일시적인 오류가 발생했어요
        </div>
        <div style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.6, marginBottom: 20, maxWidth: 320 }}>
          새 버전이 배포되는 중이었을 수 있어요. 새로고침하면 대부분 해결됩니다.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 22px', borderRadius: 12, border: 'none',
              background: '#FF1F8F', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
            }}
          >
            새로고침
          </button>
          <button
            onClick={reset}
            style={{
              padding: '12px 22px', borderRadius: 12,
              border: '1.5px solid rgba(255,255,255,0.35)', background: 'transparent',
              color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
