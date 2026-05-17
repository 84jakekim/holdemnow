import type { Metadata } from 'next';
import { JetBrains_Mono, Fraunces } from 'next/font/google';
import Script from 'next/script';
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
  title: 'HoldemNow',
  description: '전국 홀덤펍 + 토너먼트 디스커버리 플랫폼',
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
        {children}
        {/* Kakao Maps SDK + services 라이브러리 (Geocoder/Places). */}
        {KAKAO_JS_KEY && (
          <Script
            id="kakao-maps-sdk"
            strategy="afterInteractive"
            src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&libraries=services&autoload=false`}
          />
        )}
        {/* Kakao JS SDK (Auth/공유 등) — Maps와 다른 별도 SDK */}
        {KAKAO_JS_KEY && (
          <Script
            id="kakao-js-sdk"
            strategy="afterInteractive"
            src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js"
            integrity="sha384-DKYJZ8NLiK8MN4/C5P2dtSmLQ4KwPaoqAfyA/DfmEc1VDxu4yyC7wy6K1Hs90nka"
            crossOrigin="anonymous"
          />
        )}
      </body>
    </html>
  );
}
