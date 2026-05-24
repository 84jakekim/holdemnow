import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '매장 광고 운영 정책 · Pink Rabbit',
};

const EFFECTIVE_DATE = '2026-05-25';

export default function StoreAdsPolicyPage() {
  return (
    <article className="space-y-6 text-[14px] leading-7 text-[var(--text-1)]">
      <header>
        <h2 className="text-[22px] font-extrabold tracking-tight mb-1">매장 광고 운영 정책</h2>
        <p className="text-[12px] text-[var(--text-3)]">시행일: {EFFECTIVE_DATE}</p>
      </header>

      <p className="text-[var(--text-2)]">
        Pink Rabbit에 매장·토너먼트 정보를 등록하시는 매장 회원·대회사 회원에게 적용되는
        운영 정책입니다.
      </p>

      <Section title="1. 게재 가능 매장">
        <ul className="list-disc pl-5 space-y-1">
          <li>「게임산업진흥에 관한 법률」에 따라 합법적으로 운영되는 홀덤펍·아미게임장</li>
          <li>사업자등록증을 보유한 실제 영업 사업장</li>
          <li>만 19세 미만 출입 금지 정책을 명시한 매장</li>
        </ul>
      </Section>

      <Section title="2. 금지 콘텐츠">
        다음 콘텐츠는 사전 통지 없이 즉시 삭제·게재 차단됩니다:
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>현금 환금, 베팅 알선, 도박 권유성 표현</li>
          <li>"상금 보장", "100% 수익" 등 사행성 조장 문구</li>
          <li>미성년자를 대상으로 한 콘텐츠</li>
          <li>타 매장·플레이어 비방, 욕설</li>
          <li>음란물, 폭력적 이미지</li>
          <li>저작권 침해 콘텐츠 (무단 이미지·영상)</li>
          <li>허위·과장 광고 (실제 운영 정보와 다른 안내)</li>
        </ul>
      </Section>

      <Section title="3. LIVE 토너먼트 운영 안내">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>실시간 LIVE 표시는 매장이 직접 운영 중인 토너먼트에 한해 활성화할 수 있습니다.</li>
          <li>참가비·블라인드 구조·상금 분배는 매장 회원이 직접 입력하며, 그 내용에 대한
              책임은 매장 회원에게 있습니다.</li>
          <li>회사는 LIVE 정보의 정확성을 보장하지 않으며, 실제 운영과 다를 경우 발생하는
              분쟁에 대해 책임지지 않습니다.</li>
          <li>상금 표기는 사용자 앱에서는 가려지며(사행성 노출 방지), 매장 내부 디스플레이에서만
              표시됩니다.</li>
        </ol>
      </Section>

      <Section title="4. 데일리 포스트 (오늘의 소식)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>매장 회원은 하루 단위로 "오늘의 소식"을 게시할 수 있습니다 (24시간 후 자동 만료).</li>
          <li>이벤트·정기 토너·공지·긴급 등 9색 카드 팔레트 중 선택해 발행 가능합니다.</li>
          <li>욕설·비방·사행성 표현은 자동 모더레이션 시스템에 의해 차단됩니다.</li>
          <li>회사는 정책 위반 콘텐츠를 사전 통지 없이 삭제할 수 있습니다.</li>
        </ol>
      </Section>

      <Section title="5. 광고 상품 (출시 예정)">
        <p>
          베타 기간(현재) 동안 모든 매장 등록·콘텐츠 게시는 <strong>무료</strong>입니다. 정식 출시
          이후 다음의 유료 상품이 도입될 예정입니다:
        </p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>Free · Light(월 15,000원) · Pro(월 39,000원) · Tournament Pack(월 20,000원)</li>
          <li>상위 노출, 추가 데일리 포스트 슬롯, 예약 알림 우선순위 등</li>
          <li>결제 방식: 카드(PG) — 향후 안내 예정</li>
        </ul>
      </Section>

      <Section title="6. 위반 시 조치">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>1회 위반: 콘텐츠 삭제 + 매장 회원에게 알림</li>
          <li>2회 위반: 7일간 콘텐츠 게시 제한</li>
          <li>3회 이상 위반: 매장 회원 자격 정지</li>
          <li>중대한 위반 (도박 알선, 미성년자 콘텐츠 등): 즉시 영구 정지</li>
        </ol>
      </Section>

      <Section title="7. 문의">
        <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 text-[13px]">
          <p>운영 정책 관련 문의는 다음으로 연락 바랍니다:</p>
          <p className="mt-1.5"><strong>이메일</strong>: support@pinkrabbit.kr (개설 예정)</p>
          <p><strong>본사 운영자</strong>: 부산·경남 홀덤펍 카톡방 방장 (현재 베타 운영자)</p>
        </div>
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
