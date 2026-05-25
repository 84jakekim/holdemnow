import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * App Hosting 백엔드 3분할 proxy (Next.js 16, 2026-05-26)
 * ------------------------------------------------
 * (Next.js 16에서 `middleware` 파일 컨벤션은 `proxy`로 rename. 동작 동일.)
 * 같은 코드베이스를 다른 백엔드(`holdemnow` / `holdemnow-biz` / `holdemnow-admin`)에
 * 배포한 뒤, **request host로 자동 분기**한다.
 *
 *   - host = holdemnow--…hosted.app          → variant = 'app'
 *   - host = holdemnow-biz--…hosted.app      → variant = 'biz'
 *   - host = holdemnow-admin--…hosted.app    → variant = 'admin'
 *   - 그 외 (localhost 등)                    → variant = null = 통합 모드 (모든 라우트 허용)
 *
 * **NEXT_PUBLIC_APP_VARIANT** 환경변수는 명시 override용(테스트 등).
 *
 * variant별 허용 경로:
 *   - 'app'   → 일반 사용자(`/m/*`, `/login`, `/onboarding/*`, 일반 가입)
 *   - 'biz'   → 매장·대회사(`/login/business`, `/admin/*`, 사업자 가입)
 *   - 'admin' → 본사 운영(`/platform-login`, `/platform/*`)
 *
 * 다른 도메인의 경로로 진입한 경우:
 *   - 동일 호스트 베이스의 의도 백엔드 URL로 동일 path redirect (?from=variant)
 *
 * /api/*, /_next/*, 정적 자원, root('/')는 특수 처리.
 */

type Variant = 'app' | 'biz' | 'admin';

const BACKEND_PREFIXES: Record<Variant, string> = {
  app: 'holdemnow--',
  biz: 'holdemnow-biz--',
  admin: 'holdemnow-admin--',
};

/** host header로 variant 자동 판별. localhost 등은 null 반환. */
function detectVariantFromHost(host: string | null | undefined): Variant | null {
  if (!host) return null;
  const h = host.toLowerCase();
  // 더 긴 prefix 먼저 매칭 (-biz--, -admin-- 이 holdemnow-- 보다 길다)
  if (h.startsWith(BACKEND_PREFIXES.biz)) return 'biz';
  if (h.startsWith(BACKEND_PREFIXES.admin)) return 'admin';
  if (h.startsWith(BACKEND_PREFIXES.app)) return 'app';
  return null;
}

/** 환경변수 override (테스트/명시용). 미설정 = host 자동 판별 우선. */
function detectVariantFromEnv(): Variant | null {
  const raw = (process.env.NEXT_PUBLIC_APP_VARIANT ?? '').trim().toLowerCase();
  if (raw === 'app' || raw === 'biz' || raw === 'admin') return raw;
  return null;
}

/** host에서 base(공통 suffix) 추출. 예: holdemnow-biz--holdemnow-prod.us-east4.hosted.app → holdemnow-prod.us-east4.hosted.app */
function extractHostBase(host: string): string {
  for (const p of Object.values(BACKEND_PREFIXES)) {
    if (host.startsWith(p)) return host.slice(p.length);
  }
  return host;
}

/** 다른 백엔드 URL 계산. host 기반 자동 도출 우선, 실패 시 환경변수 fallback. */
function getBackendUrls(req: NextRequest): Record<Variant, string | undefined> {
  const host = req.headers.get('host') ?? '';
  const proto = req.nextUrl.protocol.replace(':', '') || 'https';
  const base = extractHostBase(host);
  const auto = base && base !== host
    ? {
        app: `${proto}://${BACKEND_PREFIXES.app}${base}`,
        biz: `${proto}://${BACKEND_PREFIXES.biz}${base}`,
        admin: `${proto}://${BACKEND_PREFIXES.admin}${base}`,
      }
    : null;
  return {
    app: auto?.app ?? (process.env.NEXT_PUBLIC_BACKEND_APP_URL?.trim() || undefined),
    biz: auto?.biz ?? (process.env.NEXT_PUBLIC_BACKEND_BIZ_URL?.trim() || undefined),
    admin: auto?.admin ?? (process.env.NEXT_PUBLIC_BACKEND_ADMIN_URL?.trim() || undefined),
  };
}

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

  // host header > 환경변수 override 순서로 variant 결정
  const variant = detectVariantFromHost(req.headers.get('host')) ?? detectVariantFromEnv();

  // 통합 모드(매칭 안 되는 호스트, localhost 등) — 모든 라우트 통과 (단일 백엔드 / 로컬 dev backwards-compat)
  if (variant === null) {
    return NextResponse.next();
  }

  // root('/') 특수 처리 — variant별로 적절한 시작 화면으로 redirect
  if (pathname === '/') {
    if (variant === 'biz') {
      const url = req.nextUrl.clone();
      url.pathname = '/login/business';
      return NextResponse.redirect(url, 307);
    }
    if (variant === 'admin') {
      const url = req.nextUrl.clone();
      url.pathname = '/platform-login';
      return NextResponse.redirect(url, 307);
    }
    // app variant — 기존 dispatcher 통과
    const res = NextResponse.next();
    applyRobotsHeader(res, variant);
    return res;
  }

  if (isAlwaysAllowed(pathname)) {
    const res = NextResponse.next();
    applyRobotsHeader(res, variant);
    return res;
  }

  const intended = classifyPath(pathname);

  // 의도 백엔드와 현재 백엔드 일치 → 통과
  if (intended === variant) {
    const res = NextResponse.next();
    applyRobotsHeader(res, variant);
    return res;
  }

  // 잘못된 도메인 — 의도 백엔드 URL로 redirect
  const backendUrls = getBackendUrls(req);
  const target = backendUrls[intended];
  if (target) {
    try {
      const url = new URL(pathname + search, target);
      url.searchParams.set('from', variant);
      return NextResponse.redirect(url, 307);
    } catch {
      // URL 파싱 실패 시 안내 페이지로
    }
  }

  // 안내 페이지로 rewrite (URL은 유지 — 200 OK + noindex)
  const blocked = req.nextUrl.clone();
  blocked.pathname = '/_blocked';
  blocked.searchParams.set('intended', intended);
  blocked.searchParams.set('current', variant);
  blocked.searchParams.set('path', pathname);
  const res = NextResponse.rewrite(blocked);
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

function applyRobotsHeader(res: NextResponse, variant: Variant) {
  // app variant만 색인 허용. biz/admin은 noindex.
  if (variant === 'biz' || variant === 'admin') {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
}

export const config = {
  // 정적 자원 매처 제외는 isAlwaysAllowed에서 처리 (이중 안전망).
  // 모든 요청에 proxy 적용하되 _next/static 만 제외해 오버헤드 최소화.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
