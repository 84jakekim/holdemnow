// 동적 렌더 강제 — CDN/Next.js prerender 캐시로 옛 HTML 반환 방지
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
