// 동적 렌더 강제 — CDN/Next.js prerender 캐시로 옛 HTML 반환 방지
// (DS v2.0 핑크 hero 적용 후 캐시된 옛 HTML이 1년 살아남는 문제 해결)
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function LoginBusinessLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
