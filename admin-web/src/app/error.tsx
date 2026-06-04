'use client';

/**
 * 전역 라우트 에러 바운더리 (2026-06-04).
 *
 * 배경: error.tsx 부재로 클라이언트 예외 시 Next.js 기본 검정 화면
 * ("Application error...")이 그대로 노출됨 — 대표가 인기매장 목록↔지도 왕복
 * 테스트 중 목격. 주원인은 잦은 배포로 인한 stale chunk(구버전 클라이언트가
 * 새 빌드의 해시 청크를 404로 받음 → ChunkLoadError).
 *
 * 처리:
 *  - chunk 로드류 에러 → 세션당 1회 자동 새로고침 (새 빌드 받으면 해결).
 *    무한 리로드 방지: sessionStorage 플래그.
 *  - 그 외/재발 → 친화적 한국어 UI (다시 시도 / 새로고침).
 */

import { useEffect } from 'react';

const RELOAD_FLAG = 'hn:chunkReloaded';

function isChunkLoadError(error: { name?: string; message?: string }): boolean {
  const s = `${error?.name ?? ''} ${error?.message ?? ''}`;
  return /ChunkLoadError|Loading chunk|CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|_next\/static/i.test(s);
}

export default function RouteError({
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
      // sessionStorage 불가 — 자동 리로드 생략 (아래 UI로)
    }
  }, [error]);

  return (
    <div
      style={{
        minHeight: '60vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 44, marginBottom: 12 }}>🐰</div>
      <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>
        일시적인 오류가 발생했어요
      </div>
      <div style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.6, marginBottom: 20, maxWidth: 320 }}>
        새 버전이 배포되는 중이었을 수 있어요.
        <br />
        새로고침하면 대부분 해결됩니다.
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
            border: '1.5px solid rgba(128,128,128,0.35)', background: 'transparent',
            fontWeight: 700, fontSize: 14, cursor: 'pointer', color: 'inherit',
          }}
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
