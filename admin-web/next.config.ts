import type { NextConfig } from "next";

/**
 * Next.js 16 config.
 *
 * headers():
 *  - `/firebase-messaging-sw.js`는 PWA 자동 갱신의 진입점이라 절대 캐시되면 안 된다.
 *    브라우저가 SW JS를 캐싱하면 새 빌드를 영원히 못 받음(닭과 달걀 문제).
 *    Cache-Control: no-cache, no-store, must-revalidate + Pragma + Expires로 3중 보장.
 *  - `/manifest.webmanifest`도 build-id 폴백 비교에 쓰이므로 no-cache.
 *
 *  HTML 캐시 정책 (2026-05-25 일괄 정정):
 *  - `/m/*`, `/admin/*`, `/platform/*`, `/display/*`, `/login/*`, `/platform-login`, `/signup/*`
 *    모든 앱 라우트는 CDN/브라우저 HTML 캐시 비활성화 (`no-cache, must-revalidate`).
 *  - Firebase App Hosting CDN이 prerender HTML을 1년 캐시하던 문제로 새 디자인이
 *    배포돼도 사용자에게 안 보이던 사고가 반복됐다. SW 갱신 + 헤더 강제로 해결.
 *  - `/_next/static/*` chunks는 hash 기반 cache busting이라 immutable 유지 — 본 규칙
 *    안 건드림 (Next.js 빌드가 자동으로 immutable 1년 헤더 부여).
 *  - `/api/*`는 응답마다 핸들러가 직접 Cache-Control 결정 — 본 규칙 안 건드림.
 */
const nextConfig: NextConfig = {
  async headers() {
    const noCacheHeaders = [
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate, max-age=0' },
      { key: 'Pragma', value: 'no-cache' },
      { key: 'Expires', value: '0' },
    ];
    // HTML 라우트 (CDN 캐시 금지, must-revalidate)
    const htmlNoCacheHeaders = [
      { key: 'Cache-Control', value: 'no-cache, must-revalidate, max-age=0' },
    ];
    const htmlRoutes = [
      '/m/:path*',
      '/admin/:path*',
      '/platform/:path*',
      '/display/:path*',
      '/login/:path*',
      '/platform-login',
      '/signup/:path*',
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
      // 모든 앱 라우트 HTML — CDN/브라우저 캐시 금지
      ...htmlRoutes.map((source) => ({ source, headers: htmlNoCacheHeaders })),
    ];
  },
};

export default nextConfig;
