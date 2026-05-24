import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Fraunces } from 'next/font/google';
import Script from 'next/script';
import PWAUpdateManager from '@/components/PWAUpdateManager';
import './globals.css';

const KAKAO_JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY ?? '';

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
});

const fraunces = Fraunces({
  variable: '--font-serif',
  subsets: ['latin'],
  weight: ['500', '700', '900'],
});

export const metadata: Metadata = {
  title: 'Pink Rabbit · 내 주변 홀덤펍',
  description: '내 주변 홀덤펍 정보는 Pink Rabbit · 전국 홀덤펍·토너먼트 디스커버리',
  applicationName: 'Pink Rabbit',
  appleWebApp: {
    capable: true,
    title: 'Pink Rabbit',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/logo.png', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcut: [{ url: '/logo.png', type: 'image/png' }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  // 브라우저 상단 (Android), 상태바 (iOS PWA) 배경색 — Felt Black
  themeColor: '#0A0E0C',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${jetbrainsMono.variable} ${fraunces.variable} h-full antialiased`}>
      <head>
        {/* Pretendard (한글) — CDN 로드 */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        {/* PWA 자동 갱신 매니저 — 모든 경로 공통 보호.
            매장 사장님이 PWA 재설치 없이도 새 빌드를 자동으로 받게 한다.
            SW 등록(updateViaCache:'none') + 60초 폴링 + controllerchange 감지 →
            토스트 + 안전한 시점 reload. 사용자 입력 중이면 idle 될 때까지 대기. */}
        <PWAUpdateManager />
        {children}
        {/* Kakao Maps SDK + services + clusterer 라이브러리.
            strategy="afterInteractive" 유지 — beforeInteractive로 바꾸면 Next.js가 head에
            inline 삽입하면서 Referer 누락 → 카카오 API가 도메인 검증 실패하여 400 거부.
            afterInteractive는 클라 DOM에서 script 추가 → Referer 정상 포함 → 도메인 인증 OK. */}
        {KAKAO_JS_KEY && (
          <Script
            id="kakao-maps-sdk"
            strategy="afterInteractive"
            src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&libraries=services,clusterer&autoload=false`}
          />
        )}
        {/* Kakao JS SDK (Auth/공유 등) — Maps와 다른 별도 SDK */}
        {KAKAO_JS_KEY && (
          <Script
            id="kakao-js-sdk"
            strategy="afterInteractive"
            src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js"
            crossOrigin="anonymous"
          />
        )}
      </body>
    </html>
  );
}
