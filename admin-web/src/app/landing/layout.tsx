import type { Metadata } from 'next';

/**
 * /landing 전용 메타데이터 — 링크 공유(카카오톡·문자·SNS) 시 미리보기 카드 생성.
 *
 * 루트 layout에는 openGraph가 없어 미리보기에 이미지가 안 떴음(앱이름·주소만 노출).
 * 여기서 og:title/description/url + og:image(opengraph-image.tsx 자동 연결)를 채워
 * 풍부한 미리보기 카드가 생성되도록 한다. metadataBase로 상대경로 → 절대 URL 변환.
 *
 * 랜딩은 메인 백엔드(holdemnow--…hosted.app)가 서빙하므로 그 origin을 base로 고정.
 */

const ORIGIN = 'https://holdemnow--holdemnow-prod.us-east4.hosted.app';

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: 'HoldemNow · 전국 홀덤펍, 이제 실시간으로 본다',
  description:
    '어느 매장이 지금 게임 도는지, 토너는 언제 시작하는지 — 앱 하나로. 정식 출시 전 사전등록 진행 중. 매장 사장님 등록 / 플레이어 출시 알림 신청.',
  applicationName: 'HoldemNow',
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'HoldemNow',
    locale: 'ko_KR',
    url: `${ORIGIN}/landing`,
    title: '전국 홀덤펍, 이제 실시간으로 본다 · 사전등록 OPEN',
    description:
      '지금 게임 도는 홀덤펍·토너를 실시간으로. 매장 사장님 사전등록 / 플레이어 출시 알림 신청 진행 중.',
  },
  twitter: {
    card: 'summary_large_image',
    title: '전국 홀덤펍, 이제 실시간으로 본다 · 사전등록 OPEN',
    description: '지금 게임 도는 홀덤펍·토너를 실시간으로. 사전등록 진행 중.',
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
