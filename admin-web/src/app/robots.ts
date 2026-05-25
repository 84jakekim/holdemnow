import type { MetadataRoute } from 'next';

/**
 * variant별 robots.txt 동적 생성.
 *
 *  - app   → 일반 색인 허용 (홈 + /m/* 만)
 *  - biz   → 전체 Disallow (사업자 콘솔)
 *  - admin → 전체 Disallow (본사 콘솔)
 */
export default function robots(): MetadataRoute.Robots {
  const variant = (process.env.NEXT_PUBLIC_APP_VARIANT ?? 'app').trim().toLowerCase();

  if (variant === 'biz' || variant === 'admin') {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    };
  }

  return {
    rules: [
      { userAgent: '*', allow: ['/', '/m/'], disallow: ['/admin/', '/platform/', '/platform-login', '/admin-login'] },
    ],
  };
}
