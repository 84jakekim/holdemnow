// 온보딩 슬라이드는 m/* layout(탭바·배너 등) 영향을 받지 않도록
// 별도 라우트로 분리. 인증 없이도 접근 가능.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function IntroLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
