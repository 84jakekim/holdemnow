import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '약관 및 정책 · Pink Rabbit',
  description: 'Pink Rabbit 이용약관, 개인정보처리방침, 매장 광고 운영 정책',
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[var(--text-1)]">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-[var(--border)]">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
          <a
            href="/"
            className="text-[13px] font-semibold text-[var(--text-2)] hover:text-[var(--brand)]"
            aria-label="홈으로"
          >
            ← 홈
          </a>
          <h1 className="text-[15px] font-extrabold tracking-tight">Pink Rabbit · 약관 및 정책</h1>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-5 py-6 pb-20">{children}</main>
      <footer className="max-w-2xl mx-auto px-5 pb-10 text-[12px] text-[var(--text-3)]">
        <nav className="flex flex-wrap gap-4 mb-3">
          <a href="/legal/terms" className="hover:text-[var(--brand)]">서비스 이용약관</a>
          <a href="/legal/privacy" className="hover:text-[var(--brand)]">개인정보처리방침</a>
          <a href="/legal/store-ads" className="hover:text-[var(--brand)]">매장 광고 정책</a>
        </nav>
        <p>운영자: Pink Rabbit 본사 · 문의: support@pinkrabbit.kr (예정)</p>
      </footer>
    </div>
  );
}
