import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '서비스 이용약관 · Pink Rabbit',
};

const EFFECTIVE_DATE = '2026-05-25';

export default function TermsPage() {
  return (
    <article className="prose-tone space-y-6 text-[14px] leading-7 text-[var(--text-1)]">
      <header>
        <h2 className="text-[22px] font-extrabold tracking-tight mb-1">서비스 이용약관</h2>
        <p className="text-[12px] text-[var(--text-3)]">시행일: {EFFECTIVE_DATE}</p>
      </header>

      <Notice />

      <Section title="제1조 (목적)">
        본 약관은 Pink Rabbit(이하 "회사")이 제공하는 홀덤펍·토너먼트 정보 디스커버리
        서비스(이하 "서비스")의 이용과 관련하여 회사와 회원 간의 권리·의무·책임사항을
        규정함을 목적으로 합니다.
      </Section>

      <Section title="제2조 (정의)">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>"서비스"란 회사가 제공하는 모바일/웹 기반의 홀덤펍·토너먼트 정보 검색,
              매장 안내, 실시간 LIVE 토너먼트 디스커버리 등 일체의 기능을 의미합니다.</li>
          <li>"회원"이란 본 약관에 동의하고 서비스에 가입한 개인 또는 사업자를 말합니다.</li>
          <li>"매장 회원"이란 자신의 사업장 정보를 등록·관리하는 사업자 회원을 말합니다.</li>
          <li>"대회사 회원"이란 토너먼트 운영자로 가입한 사업자 회원을 말합니다.</li>
          <li>"콘텐츠"란 회원이 서비스에 게시·등록한 텍스트, 이미지, 영상, 매장 정보 등
              일체의 데이터를 의미합니다.</li>
        </ul>
      </Section>

      <Section title="제3조 (서비스의 성격 및 제한)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>Pink Rabbit은 <strong>정보 디스커버리</strong> 서비스이며, 베팅·환금·도박 행위를
              매개하거나 알선하지 않습니다.</li>
          <li>본 서비스에 등록되는 홀덤펍·토너먼트는 「게임산업진흥에 관한 법률」 및 관련 법령에
              따라 합법적으로 운영되는 사업장을 대상으로 하며, 회사는 게재 매장의 법적 자격을
              직접 검증하지 않습니다.</li>
          <li>회원은 만 19세 이상이어야 합니다. 미성년자의 가입은 금지됩니다.</li>
          <li>회사는 사행성 조장이 우려되는 콘텐츠를 발견하는 즉시 사전 통지 없이 삭제·차단할 수
              있습니다.</li>
        </ol>
      </Section>

      <Section title="제4조 (회원가입 및 계정)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>회원가입은 본 약관에 동의하고 회사가 정한 가입 양식에 정보를 기입한 후, 회사가
              승인함으로써 성립됩니다. 일반 회원은 가입 즉시 활성화됩니다.</li>
          <li>매장·대회사 회원은 회사의 검토를 거쳐 승인될 수 있습니다(현재 v0.1에서는 즉시
              활성화). 허위 정보로 가입한 경우 사전 통지 없이 해지될 수 있습니다.</li>
          <li>회원은 본인의 계정 정보를 안전하게 관리할 책임이 있으며, 제3자에게 양도·대여할 수
              없습니다.</li>
          <li>비밀번호 분실 시 가입 시 입력한 이메일 또는 비밀번호 힌트를 통해 재설정할 수
              있습니다.</li>
        </ol>
      </Section>

      <Section title="제5조 (서비스의 제공 및 변경)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>회사는 24시간 연중무휴로 서비스를 제공함을 원칙으로 하나, 시스템 점검·장애 등의
              사유로 일시 중단될 수 있습니다.</li>
          <li>회사는 서비스 개선, 정책 변경 등의 사유로 서비스의 일부 또는 전부를 변경할 수
              있으며, 중요한 변경은 사전에 공지합니다.</li>
          <li>무료 서비스의 경우 회사는 사전 통지 후 서비스를 종료할 수 있습니다.</li>
        </ol>
      </Section>

      <Section title="제6조 (회원의 의무)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>회원은 관련 법령, 본 약관, 이용안내 및 회사가 통지하는 사항을 준수해야 합니다.</li>
          <li>회원은 다음 행위를 해서는 안 됩니다:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>허위 정보 등록, 타인 정보 도용</li>
              <li>회사 또는 제3자의 지적재산권을 침해하는 행위</li>
              <li>욕설·비방·음란물·사행성 조장 콘텐츠 게시</li>
              <li>도박·환금·베팅을 알선·유도하는 콘텐츠 게시</li>
              <li>자동화된 방법으로 서비스에 접근하는 행위(크롤링, 봇 등)</li>
              <li>서비스의 정상적 운영을 방해하는 일체의 행위</li>
            </ul>
          </li>
        </ol>
      </Section>

      <Section title="제7조 (콘텐츠의 권리 및 책임)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>회원이 게시한 콘텐츠의 저작권은 해당 회원에게 귀속됩니다.</li>
          <li>회원은 회사가 서비스 운영·홍보·개선 목적으로 게시 콘텐츠를 무상으로 사용할 수
              있는 비독점적·취소불가능한 라이선스를 회사에 부여합니다.</li>
          <li>게시된 콘텐츠의 내용에 대한 법적 책임은 게시자 본인에게 있으며, 회사는 콘텐츠에
              대한 모니터링 의무를 부담하지 않습니다.</li>
        </ol>
      </Section>

      <Section title="제8조 (서비스 이용의 제한)">
        다음의 경우 회사는 사전 통지 없이 회원의 서비스 이용을 제한하거나 계정을 해지할 수
        있습니다:
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>제6조의 회원 의무 위반</li>
          <li>관련 법령 위반</li>
          <li>타 회원에게 심대한 피해를 주는 행위</li>
          <li>서비스 운영을 의도적으로 방해하는 행위</li>
        </ul>
      </Section>

      <Section title="제9조 (면책)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>회사는 회원 간 또는 회원과 제3자 간에 발생한 분쟁에 개입할 의무가 없으며, 이로
              인한 손해를 배상할 책임이 없습니다.</li>
          <li>회사는 회원이 게시한 매장 정보, 토너먼트 일정, LIVE 진행 상황 등의 정확성을
              보장하지 않으며, 회원이 이를 신뢰하여 발생한 손해에 대해 책임지지 않습니다.</li>
          <li>천재지변, 전쟁, 폭동, 정전, 통신두절 등 불가항력으로 인한 서비스 중단에 대해
              회사는 책임지지 않습니다.</li>
        </ol>
      </Section>

      <Section title="제10조 (약관의 변경)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>회사는 필요한 경우 본 약관을 변경할 수 있으며, 변경된 약관은 시행 7일 전(회원에게
              불리한 변경의 경우 30일 전)부터 공지합니다.</li>
          <li>회원이 변경된 약관에 동의하지 않는 경우 서비스 이용을 중단하고 탈퇴할 수
              있습니다.</li>
          <li>변경 공지 후 회원이 명시적으로 거부 의사를 표시하지 않는 경우 변경된 약관에
              동의한 것으로 봅니다.</li>
        </ol>
      </Section>

      <Section title="제11조 (관할 법원 및 준거법)">
        본 약관과 관련된 분쟁은 대한민국 법령에 따라 해석되며, 회사의 본점 소재지를 관할하는
        법원을 1심 관할법원으로 합니다.
      </Section>

      <footer className="pt-6 border-t border-[var(--border)] text-[12px] text-[var(--text-3)]">
        시행일: {EFFECTIVE_DATE} · 운영자: Pink Rabbit 본사
      </footer>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[16px] font-extrabold tracking-tight text-[var(--text-1)] mb-2">{title}</h3>
      <div className="text-[var(--text-2)]">{children}</div>
    </section>
  );
}

function Notice() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-6 text-amber-900">
      본 약관은 회사의 베타 출시 시점(2026-05) 기준 표준 문안이며, 정식 출시 전 법률 자문을 거쳐
      개정될 수 있습니다. 현재 시점에 변호사 검토를 받지 않은 초안임을 알려드립니다.
    </div>
  );
}
