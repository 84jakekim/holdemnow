import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * App Hosting 백엔드 3분할 proxy (Next.js 16, 2026-05-26)
 * ------------------------------------------------
 * (Next.js 16에서 `middleware` 파일 컨벤션은 `proxy`로 rename. 동작 동일.)
 * 같은 코드베이스를 다른 백엔드(`holdemnow` / `holdemnow-biz` / `holdemnow-admin`)에
 * 배포한 뒤, 각 백엔드에 `NEXT_PUBLIC_APP_VARIANT` 환경변수로 역할을 부여한다.
 *
 *   - variant = 'app'   → 일반 사용자(`/m/*`, `/login`, `/onboarding/*`, 일반 가입)
 *   - variant = 'biz'   → 매장·대회사(`/login/business`, `/admin/*`, 사업자 가입)
 *   - variant = 'admin' → 본사 운영(`/platform-login`, `/platform/*`)
 *
 * 미설정 = 'app' (현재 단일 백엔드 backwards-compatible)
 *
 * 다른 도메인의 경로로 진입한 경우:
 *   - 해당 백엔드 URL 환경변수가 설정돼 있으면 → 동일 path로 redirect (?from=variant)
 *   - 환경변수가 비어 있으면 → 404 안내 페이지(/_blocked)로 rewrite (정보 누설 방지)
 *
 * /api/*, /_next/*, 정적 자원, root('/')는 항상 통과시킨다.
 * 정적 자원이 통과돼야 안내 페이지 자체가 정상 렌더링된다.
 */

type Variant = 'app' | 'biz' | 'admin';

/**
 * VARIANT 해석:
 *   - 'app' | 'biz' | 'admin' → 해당 백엔드로 가드 활성
 *   - null = 통합 모드 (모든 라우트 통과, backwards-compat / 로컬 dev)
 *
 * 운영에서는 각 백엔드의 apphosting yaml에 명시한다.
 * .env.local 미설정 / 로컬 dev / 단일 백엔드 운영 시 = null = 모든 라우트 허용.
 */
const VARIANT: Variant | null = (() => {
  const raw = (process.env.NEXT_PUBLIC_APP_VARIANT ?? '').trim().toLowerCase();
  if (raw === 'app' || raw === 'biz' || raw === 'admin') return raw;
  return null;
})();

const BACKEND_URLS: Record<Variant, string | undefined> = {
  app: process.env.NEXT_PUBLIC_BACKEND_APP_URL?.trim() || undefined,
  biz: process.env.NEXT_PUBLIC_BACKEND_BIZ_URL?.trim() || undefined,
  admin: process.env.NEXT_PUBLIC_BACKEND_ADMIN_URL?.trim() || undefined,
};

/** 경로 → 의도된 variant 분류. 매칭 안 되는 경로는 'app'(기본). */
function classifyPath(pathname: string): Variant {
  // 본사 운영 — /platform-login, /platform/*
  if (pathname === '/platform-login' || pathname.startsWith('/platform/') || pathname === '/platform') {
    return 'admin';
  }
  // 매장·대회사 — /admin/*, /admin-login, /login/business, 사업자 signup, organizer
  if (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/admin-login' ||
    pathname === '/login/business' ||
    pathname.startsWith('/login/business/') ||
    pathname === '/signup/store' ||
    pathname.startsWith('/signup/store/') ||
    pathname === '/signup/organizer' ||
    pathname.startsWith('/signup/organizer/') ||
    pathname === '/organizer' ||
    pathname.startsWith('/organizer/') ||
    pathname === '/organizer-login' ||
    pathname === '/organizer-signup'
  ) {
    return 'biz';
  }
  // 그 외 (`/m/*`, `/login`, `/onboarding/*`, `/signup`, `/signup/player`, `/auth/*`,
  // `/legal/*`, `/preview/*`, `/display/*` 등 일반 사용자 + 공용) → app
  return 'app';
}

/** 항상 통과시키는 경로 패턴. */
function isAlwaysAllowed(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname === '/_blocked') return true;
  if (pathname.startsWith('/api/')) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.startsWith('/static/')) return true;
  if (
    pathname === '/favicon.ico' ||
    pathname === '/manifest.json' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname === '/firebase-messaging-sw.js' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml'
  ) {
    return true;
  }
  // 정적 자원 (확장자 매칭)
  if (/\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|woff2?|ttf|otf|mp3|wav|txt|xml)$/i.test(pathname)) {
    return true;
  }
  return false;
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 통합 모드(VARIANT 미지정) — 모든 라우트 통과 (단일 백엔드 / 로컬 dev backwards-compat)
  if (VARIANT === null) {
    return NextResponse.next();
  }

  // root('/') 특수 처리 — variant별로 적절한 시작 화면으로 redirect
  if (pathname === '/') {
    if (VARIANT === 'biz') {
      const url = req.nextUrl.clone();
      url.pathname = '/login/business';
      return NextResponse.redirect(url, 307);
    }
    if (VARIANT === 'admin') {
      const url = req.nextUrl.clone();
      url.pathname = '/platform-login';
      return NextResponse.redirect(url, 307);
    }
    // app variant — 기존 dispatcher 통과
    const res = NextResponse.next();
    applyRobotsHeader(res);
    return res;
  }

  if (isAlwaysAllowed(pathname)) {
    const res = NextResponse.next();
    applyRobotsHeader(res);
    return res;
  }

  const intended = classifyPath(pathname);

  // 의도 백엔드와 현재 백엔드 일치 → 통과
  if (intended === VARIANT) {
    const res = NextResponse.next();
    applyRobotsHeader(res);
    return res;
  }

  // 잘못된 도메인 — 의도 백엔드 URL이 있으면 redirect, 없으면 차단 안내
  const target = BACKEND_URLS[intended];
  if (target) {
    try {
      const url = new URL(pathname + search, target);
      url.searchParams.set('from', VARIANT);
      return NextResponse.redirect(url, 307);
    } catch {
      // URL 파싱 실패 시 안내 페이지로
    }
  }

  // 안내 페이지로 rewrite (URL은 유지 — 200 OK + noindex)
  const blocked = req.nextUrl.clone();
  blocked.pathname = '/_blocked';
  blocked.searchParams.set('intended', intended);
  blocked.searchParams.set('current', VARIANT);
  blocked.searchParams.set('path', pathname);
  const res = NextResponse.rewrite(blocked);
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

function applyRobotsHeader(res: NextResponse) {
  // app variant만 색인 허용. biz/admin은 noindex.
  if (VARIANT === 'biz' || VARIANT === 'admin') {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
}

export const config = {
  // 정적 자원 매처 제외는 isAlwaysAllowed에서 처리 (이중 안전망).
  // 모든 요청에 proxy 적용하되 _next/static 만 제외해 오버헤드 최소화.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
