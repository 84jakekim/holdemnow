import Link from 'next/link';

export default function LegalIndex() {
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-[var(--text-2)] leading-relaxed">
        Pink Rabbit 서비스 이용과 관련된 약관·정책을 안내합니다.
      </p>
      <div className="space-y-2">
        <LegalCard
          href="/legal/terms"
          title="서비스 이용약관"
          desc="회원가입·서비스 이용 시 적용되는 약관"
        />
        <LegalCard
          href="/legal/privacy"
          title="개인정보처리방침"
          desc="수집·이용·보관·제3자 제공 정책"
        />
        <LegalCard
          href="/legal/store-ads"
          title="매장 광고 운영 정책"
          desc="매장·대회사 게재 정책, 금지 콘텐츠"
        />
      </div>
    </div>
  );
}

function LegalCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-4 hover:border-[var(--brand)] transition-colors"
    >
      <p className="text-[15px] font-extrabold text-[var(--text-1)] mb-0.5">{title}</p>
      <p className="text-[12.5px] text-[var(--text-2)]">{desc}</p>
    </Link>
  );
}
