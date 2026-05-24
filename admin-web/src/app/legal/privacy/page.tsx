import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '개인정보처리방침 · Pink Rabbit',
};

const EFFECTIVE_DATE = '2026-05-25';

export default function PrivacyPage() {
  return (
    <article className="space-y-6 text-[14px] leading-7 text-[var(--text-1)]">
      <header>
        <h2 className="text-[22px] font-extrabold tracking-tight mb-1">개인정보처리방침</h2>
        <p className="text-[12px] text-[var(--text-3)]">시행일: {EFFECTIVE_DATE}</p>
      </header>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-6 text-amber-900">
        본 방침은 회사의 베타 출시 시점(2026-05) 기준 표준 문안이며, 정식 출시 전 법률 자문을
        거쳐 개정될 수 있습니다. 현재 시점에 변호사 검토를 받지 않은 초안임을 알려드립니다.
      </div>

      <p className="text-[var(--text-2)]">
        Pink Rabbit(이하 "회사")은 「개인정보 보호법」을 준수하며, 회원의 개인정보를 보호하기
        위해 다음과 같은 처리방침을 운영합니다.
      </p>

      <Section title="제1조 (수집하는 개인정보 항목)">
        <Sub title="필수 항목 (회원가입 시)">
          <ul className="list-disc pl-5 space-y-1">
            <li>일반 회원: 이메일, 비밀번호(해시 저장), 닉네임, 약관 동의 여부</li>
            <li>매장 회원: 위 항목 + 매장명, 사업자 연락처(끝 4자리), 매장 위치, 대표 이미지</li>
            <li>대회사 회원: 위 항목 + 대회사명, 담당자 연락처</li>
            <li>소셜 로그인 시: 카카오/구글에서 제공하는 식별자(uid), 프로필명, 프로필 이미지</li>
          </ul>
        </Sub>
        <Sub title="선택 항목">
          <ul className="list-disc pl-5 space-y-1">
            <li>비밀번호 힌트 (계정 분실 시 본인 확인용)</li>
            <li>마케팅 정보 수신 동의</li>
            <li>위치 정보 (서비스 사용 중 거리 기반 매장 검색 시 — 매번 사용자 허용 후 사용)</li>
            <li>FCM 푸시 토큰 (알림 수신 동의 시)</li>
          </ul>
        </Sub>
        <Sub title="자동 수집 항목">
          <ul className="list-disc pl-5 space-y-1">
            <li>접속 일시, IP 주소, 브라우저/디바이스 정보 (서비스 운영·통계 목적)</li>
            <li>Firebase Analytics를 통한 익명 사용 패턴 정보</li>
          </ul>
        </Sub>
      </Section>

      <Section title="제2조 (개인정보의 수집 및 이용 목적)">
        <ul className="list-disc pl-5 space-y-1">
          <li>회원 식별 및 계정 관리, 본인 확인</li>
          <li>서비스 제공 (홀덤펍·토너먼트 정보 검색, 매장 등록, 예약 등)</li>
          <li>거리 기반 매장 검색 (사용자 허용 시 1회성 위치 정보 처리, 서버 저장 안 함)</li>
          <li>알림 발송 (예약 알림, LIVE 시작 알림 등 — 사용자 동의 시)</li>
          <li>서비스 개선을 위한 통계 분석 (개인 식별 정보 분리)</li>
          <li>약관 위반 콘텐츠 모니터링 및 조치</li>
        </ul>
      </Section>

      <Section title="제3조 (개인정보의 보유 및 이용 기간)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>회원 탈퇴 시 즉시 파기를 원칙으로 하되, 다음의 경우 일정 기간 보관합니다:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>관련 법령에 따른 보존 의무 기간 (전자상거래법 등)</li>
              <li>부정 이용 방지를 위한 기록 — 탈퇴 후 30일</li>
            </ul>
          </li>
          <li>매장 운영 데이터(예약 기록, 리뷰 등)는 매장 회원 탈퇴 시까지 보관됩니다.</li>
        </ol>
      </Section>

      <Section title="제4조 (개인정보의 제3자 제공)">
        <p>
          회사는 회원의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만 다음의 경우 예외로
          합니다:
        </p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>회원이 사전에 동의한 경우 (예: 매장 예약 시 매장 운영자에게 닉네임·연락처 제공)</li>
          <li>법령에 의한 경우 (수사기관의 영장 등)</li>
          <li>긴급한 생명·신체의 위해 방지를 위해 필요한 경우</li>
        </ul>
      </Section>

      <Section title="제5조 (개인정보 처리 위탁)">
        <p>서비스 제공을 위해 다음과 같이 개인정보 처리를 위탁하고 있습니다:</p>
        <div className="mt-2 rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[var(--surface-2)] text-[var(--text-2)]">
              <tr>
                <th className="px-3 py-2 text-left">수탁업체</th>
                <th className="px-3 py-2 text-left">위탁 업무</th>
                <th className="px-3 py-2 text-left">위탁 항목</th>
              </tr>
            </thead>
            <tbody>
              <Row a="Google LLC (Firebase)" b="계정 관리, 데이터 저장, 푸시 알림" c="이메일, uid, 콘텐츠" />
              <Row a="Google LLC (App Hosting)" b="웹 호스팅, CDN" c="접속 로그" />
              <Row a="카카오 (선택)" b="소셜 로그인, 지도 SDK" c="카카오 uid, 위치 검색 키워드" />
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="제6조 (회원의 권리)">
        <p>회원은 언제든지 다음의 권리를 행사할 수 있습니다:</p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>개인정보 열람·정정·삭제 요청</li>
          <li>개인정보 처리 정지 요청</li>
          <li>회원 탈퇴 (마이페이지에서 직접 또는 본사 문의)</li>
          <li>마케팅 정보 수신 거부 (마이페이지 설정 또는 수신 이메일 내 거부 링크)</li>
        </ul>
      </Section>

      <Section title="제7조 (개인정보의 파기)">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>전자적 파일: 복구 불가능한 방법으로 영구 삭제 (Firestore 문서 delete)</li>
          <li>인쇄물·종이 문서: 분쇄 또는 소각 (해당 시)</li>
          <li>파기 기한: 보유 기간 경과 즉시 또는 회원 탈퇴 요청 후 30일 이내</li>
        </ol>
      </Section>

      <Section title="제8조 (안전조치)">
        <ul className="list-disc pl-5 space-y-1">
          <li>비밀번호 단방향 해시 저장 (Firebase Auth)</li>
          <li>HTTPS 전체 적용 (SSL/TLS)</li>
          <li>Firestore 보안 규칙으로 접근 제어 (본인 또는 권한 보유자만 접근 가능)</li>
          <li>관리자 권한 분리, 접근 로그 기록</li>
        </ul>
      </Section>

      <Section title="제9조 (만 14세 미만 아동의 개인정보)">
        회사는 만 14세 미만 아동의 회원가입을 받지 않으며, 실수로 수집된 정보가 확인되는 경우
        즉시 파기합니다. 본 서비스는 만 19세 이상 이용을 권장합니다.
      </Section>

      <Section title="제10조 (개인정보 보호책임자)">
        <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
          <p><strong>개인정보 보호책임자</strong>: Pink Rabbit 본사 운영팀</p>
          <p><strong>이메일</strong>: privacy@pinkrabbit.kr (개설 예정)</p>
          <p className="text-[12px] text-[var(--text-3)] mt-2">
            현재 베타 기간 동안은 운영자 카카오톡 또는 본사 문의 채널로 연락 바랍니다.
          </p>
        </div>
      </Section>

      <Section title="제11조 (방침의 변경)">
        본 방침은 시행일부터 적용되며, 법령·정책·서비스 변경 시 사전 공지 후 개정됩니다.
        변경된 방침은 시행 7일 전부터 공지됩니다.
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

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <p className="text-[13.5px] font-bold text-[var(--text-1)] mb-1">{title}</p>
      <div className="text-[var(--text-2)]">{children}</div>
    </div>
  );
}

function Row({ a, b, c }: { a: string; b: string; c: string }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="px-3 py-2 align-top text-[var(--text-1)]">{a}</td>
      <td className="px-3 py-2 align-top text-[var(--text-2)]">{b}</td>
      <td className="px-3 py-2 align-top text-[var(--text-2)]">{c}</td>
    </tr>
  );
}
