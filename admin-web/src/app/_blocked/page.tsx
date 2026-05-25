import Link from 'next/link';

/**
 * App Hosting 백엔드 분할 — 잘못된 도메인 진입 안내 페이지.
 *
 * middleware.ts가 의도된 백엔드 URL을 모를 때(`NEXT_PUBLIC_BACKEND_*_URL` 미설정),
 * 사용자에게 친화적으로 알리고 root('/')로 돌아갈 수 있게 한다.
 *
 * URL은 그대로 유지(rewrite)되므로 브라우저 주소창은 원래 입력값. noindex 보장.
 */

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ intended?: string; current?: string; path?: string }>;

const LABEL: Record<string, string> = {
  app: '일반 사용자 앱',
  biz: '매장·대회사 어드민',
  admin: '본사 운영 콘솔',
};

export default async function BlockedPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const intended = (params.intended ?? 'app').toLowerCase();
  const current = (params.current ?? 'app').toLowerCase();
  const path = params.path ?? '/';

  const intendedLabel = LABEL[intended] ?? '다른 도메인';
  const currentLabel = LABEL[current] ?? '현재 도메인';

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--ink-1)] text-[var(--ink-9)] px-6">
      <div className="max-w-md w-full text-center space-y-6 py-12">
        <div className="text-5xl">404</div>
        <h1 className="text-xl font-bold">잘못된 도메인에 접속하셨습니다</h1>
        <p className="text-sm leading-relaxed text-[var(--ink-7)]">
          <code className="font-mono text-[var(--ink-9)]">{path}</code> 은(는){' '}
          <b>{intendedLabel}</b> 도메인 전용 경로입니다.
          <br />
          현재 도메인은 <b>{currentLabel}</b> 입니다.
        </p>
        <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--ink-2)] p-4 text-left text-xs text-[var(--ink-7)]">
          <div className="font-semibold text-[var(--ink-9)] mb-1">안내</div>
          관리자에게 정확한 접속 URL을 문의하거나, 아래 버튼으로 메인 화면으로 돌아가세요.
        </div>
        <div className="flex justify-center gap-3">
          <Link
            href="/"
            className="px-4 py-2 rounded-full bg-[var(--brand)] text-white text-sm font-semibold"
          >
            메인으로
          </Link>
        </div>
      </div>
    </main>
  );
}
