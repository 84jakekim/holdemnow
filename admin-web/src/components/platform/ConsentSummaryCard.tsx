'use client';

/**
 * ConsentSummaryCard — 약관 동의 항목 요약 카드
 */

interface ConsentData {
  agreeService?: boolean;
  agreePrivacy?: boolean;
  agreeMarketing?: boolean;
  submittedAt?: string | null;
}

interface ConsentSummaryCardProps {
  consent: ConsentData;
}

function ConsentRow({ label, agreed, required }: { label: string; agreed?: boolean; required?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700">
        {label}
        {required && <span className="ml-1 text-[10px] font-bold text-[#FF1F8F]">(필수)</span>}
      </span>
      <span className={`text-xs font-extrabold px-2 py-0.5 rounded ${agreed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
        {agreed ? '동의' : '미동의'}
      </span>
    </div>
  );
}

export default function ConsentSummaryCard({ consent }: ConsentSummaryCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <h3 className="text-sm font-extrabold text-gray-900 mb-3">약관 동의 현황</h3>
      <ConsentRow label="서비스 이용약관" agreed={consent.agreeService} required />
      <ConsentRow label="개인정보 처리방침" agreed={consent.agreePrivacy} required />
      <ConsentRow label="마케팅·알림 수신" agreed={consent.agreeMarketing} />
      {consent.submittedAt && (
        <div className="mt-2 text-[11px] text-gray-400">
          동의 일시: {consent.submittedAt}
        </div>
      )}
    </div>
  );
}
