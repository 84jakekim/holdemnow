/**
 * / — server wrapper
 *
 * App Hosting 3-backend 분할 시 host 기반 서버 사이드 redirect를 먼저 처리한다.
 * 메인 도메인이면 기존 client dispatcher(HomeClient) 그대로 렌더.
 *
 * 왜 server에서 처리하나:
 *   root('/')는 Next.js가 정적 prerender + CDN s-maxage=31536000으로 캐시한다.
 *   proxy.ts의 redirect는 캐시 hit이면 우회되므로 root에서는 효과 없음.
 *   → root만 force-dynamic + server-side host 분기로 우회한다.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import HomeClient from './HomeClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home() {
  const h = await headers();
  const host = (h.get('host') ?? '').toLowerCase();
  if (host.startsWith('holdemnow-biz--')) {
    redirect('/login/business');
  }
  if (host.startsWith('holdemnow-admin--')) {
    redirect('/platform-login');
  }
  return <HomeClient />;
}
