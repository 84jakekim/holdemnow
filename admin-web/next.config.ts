import type { NextConfig } from "next";

/**
 * Next.js 16 config.
 *
 * headers():
 *  - `/firebase-messaging-sw.js`는 PWA 자동 갱신의 진입점이라 절대 캐시되면 안 된다.
 *    브라우저가 SW JS를 캐싱하면 새 빌드를 영원히 못 받음(닭과 달걀 문제).
 *    Cache-Control: no-cache, no-store, must-revalidate + Pragma + Expires로 3중 보장.
 *  - `/manifest.webmanifest`도 build-id 폴백 비교에 쓰이므로 no-cache.
 *  - PWA install URL인 `/m`도 매번 fresh HTML을 받게 해 옛 chunk 참조를 줄임.
 */
const nextConfig: NextConfig = {
  async headers() {
    const noCacheHeaders = [
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate, max-age=0' },
      { key: 'Pragma', value: 'no-cache' },
      { key: 'Expires', value: '0' },
    ];
    return [
      {
        source: '/firebase-messaging-sw.js',
        headers: noCacheHeaders,
      },
      {
        source: '/manifest.webmanifest',
        headers: noCacheHeaders,
      },
    ];
  },
};

export default nextConfig;
