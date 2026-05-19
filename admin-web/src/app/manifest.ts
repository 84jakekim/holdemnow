import type { MetadataRoute } from 'next';

/**
 * PWA Web App Manifest.
 * Next.js 16의 native API — 빌드 시 자동으로 /manifest.webmanifest 경로로 서빙됨.
 * https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HoldemNow',
    short_name: 'HoldemNow',
    description: '전국 홀덤펍 · 토너먼트 디스커버리 플랫폼',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Midnight Felt 디자인 시스템 (브라우저 상단바, 스플래시 배경)
    background_color: '#0A0E0C',
    theme_color: '#0A0E0C',
    lang: 'ko',
    categories: ['entertainment', 'lifestyle', 'social'],
    icons: [
      // 신규 통합 로고 SVG — 모든 sizes 대응 + maskable 겸용
      {
        src: '/top_right_logo.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/top_right_logo.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
      // 폴백 PNG — 일부 안드로이드 구버전이 SVG 미지원 시 사용
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
    // 모바일 앱에서 자주 가는 경로를 long-press 빠른 진입으로 제공
    shortcuts: [
      {
        name: '지금 LIVE',
        short_name: 'LIVE',
        description: '진행 중인 LIVE 토너먼트',
        url: '/m',
        icons: [{ src: '/top_right_logo.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      {
        name: '지도 탐색',
        short_name: '탐색',
        description: '주변 매장 지도 보기',
        url: '/m/discover',
        icons: [{ src: '/top_right_logo.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    ],
  };
}
