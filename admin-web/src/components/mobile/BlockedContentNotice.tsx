'use client';

/**
 * 모더레이션 차단된 게시물에 일반 사용자가 직접 URL로 진입했을 때
 * 본문 대신 보여주는 안내 페이지.
 *
 * 사용 컨텍스트:
 *  - 매장 소식(stores/{sid}/posts/{pid}.status='hidden')
 *  - 구인/딜러/중고(community/{id}.status='hidden')
 *  - 본사 공지(pinnedPosts/{id}.active=false)
 *  - 홈 광고(homeAds/{id}.isActive=false)
 *
 * platform_admin은 모더레이션 페이지에서 hidden 글도 볼 수 있어야 하므로,
 * 페이지 상위에서 권한 분기 후 이 컴포넌트는 일반 사용자 경로에만 표시.
 */

import Link from 'next/link';

interface Props {
  /** "이 소식은 더 이상..." 같은 메인 문구. */
  title?: string;
  /** 보조 안내. */
  description?: string;
  /** 돌아갈 경로 (기본 /m/find). */
  backHref?: string;
  /** 돌아가기 버튼 라벨 (기본 "매장찾기로"). */
  backLabel?: string;
}

export default function BlockedContentNotice({
  title = '더 이상 노출되지 않는 게시물입니다',
  description = '작성자가 내렸거나 본사 모더레이션에 의해 차단되었습니다.',
  backHref = '/m/find',
  backLabel = '매장찾기로',
}: Props) {
  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center gap-3 px-8 py-12"
      style={{ background: 'var(--bg)' }}
    >
      <div className="text-5xl mb-2" aria-hidden="true">🚫</div>
      <div
        className="font-extrabold text-[17px] text-center"
        style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}
      >
        {title}
      </div>
      <div
        className="text-[13px] leading-relaxed text-center max-w-xs"
        style={{ color: 'var(--text-3)' }}
      >
        {description}
      </div>
      <Link
        href={backHref}
        className="mt-3 px-5 py-2.5 rounded-xl text-sm font-extrabold"
        style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
      >
        {backLabel}
      </Link>
    </main>
  );
}
