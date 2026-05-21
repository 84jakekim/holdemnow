import type { MetadataRoute } from 'next';

/**
 * PWA Web App Manifest.
 * Next.js 16의 native API — 빌드 시 자동으로 /manifest.webmanifest 경로로 서빙됨.
 * https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pink Rabbit',
    short_name: 'Pink Rabbit',
    description: '내 주변 홀덤펍 정보는 Pink Rabbit · 전국 홀덤펍·토너먼트 디스커버리',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // 스플래시·상태바 배경 — Pink Rabbit 다크 톤
    background_color: '#0A0E0C',
    theme_color: '#0A0E0C',
    lang: 'ko',
    categories: ['entertainment', 'lifestyle', 'social'],
    icons: [
      // OS 스플래시 — 정사각형 워드마크 SVG (안드로이드 Chrome이 PWA 첫 실행 시
      // background_color 위에 가장 큰 icon을 정중앙 배치. logo.png는 가로형이라
      // 늘어져 보였으므로 정사각형 워드마크를 우선 노출).
      {
        src: '/splash-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/splash-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
      // 홈 화면 앱 아이콘 — Pink Rabbit 토끼 PNG
      {
        src: '/logo.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: '지금 LIVE',
        short_name: 'LIVE',
        description: '진행 중인 LIVE 토너먼트',
        url: '/m',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: '지도 탐색',
        short_name: '탐색',
        description: '주변 매장 지도 보기',
        url: '/m/discover',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
