'use client';

/**
 * OrganizerInfoCard — 대회사 상세 정보 카드
 * 회사명, 사업자번호, 대표자, 주소, 담당자 풀, 대회 레퍼런스
 */

interface ContactPerson {
  name?: string;
  position?: string;
  phone?: string;
  email?: string;
}

interface OrganizerInfoCardProps {
  companyName?: string;
  businessRegistrationNumber?: string;
  representativeName?: string;
  representativePhone?: string;
  companyAddress?: string;
  contactPerson?: ContactPerson;
  tournamentReferences?: string;
  signupApplication?: {
    submittedAt?: string;
    agreeService?: boolean;
    agreePrivacy?: boolean;
    agreeMarketing?: boolean;
  };
}

export default function OrganizerInfoCard({
  companyName,
  businessRegistrationNumber,
  representativeName,
  representativePhone,
  companyAddress,
  contactPerson,
  tournamentReferences,
  signupApplication,
}: OrganizerInfoCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
      <h3 className="text-sm font-extrabold text-gray-900">대회사 정보</h3>

      <InfoRow label="회사명" value={companyName} />
      <InfoRow label="사업자번호" value={businessRegistrationNumber} />
      <InfoRow label="회사 주소" value={companyAddress} />

      <div className="border-t border-gray-100 pt-3">
        <h4 className="text-[11px] font-bold text-gray-500 mb-2">대표자 정보</h4>
        <InfoRow label="대표자명" value={representativeName} />
        <InfoRow label="대표 연락처" value={representativePhone} />
      </div>

      {contactPerson && (
        <div className="border-t border-gray-100 pt-3">
          <h4 className="text-[11px] font-bold text-gray-500 mb-2">담당자 정보</h4>
          <InfoRow label="담당자명" value={contactPerson.name} />
          <InfoRow label="직책" value={contactPerson.position} />
          <InfoRow label="연락처" value={contactPerson.phone} />
          <InfoRow label="이메일" value={contactPerson.email} />
        </div>
      )}

      {tournamentReferences && (
        <div className="border-t border-gray-100 pt-3">
          <h4 className="text-[11px] font-bold text-gray-500 mb-2">대회 레퍼런스</h4>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl px-3 py-2.5">
            {tournamentReferences}
          </p>
        </div>
      )}

      {signupApplication && (
        <div className="border-t border-gray-100 pt-3">
          <h4 className="text-[11px] font-bold text-gray-500 mb-2">신청 정보</h4>
          {signupApplication.submittedAt && (
            <InfoRow label="신청일" value={signupApplication.submittedAt} />
          )}
          <div className="flex gap-2 flex-wrap mt-1">
            <ConsentBadge label="서비스" agreed={signupApplication.agreeService} />
            <ConsentBadge label="개인정보" agreed={signupApplication.agreePrivacy} />
            <ConsentBadge label="마케팅" agreed={signupApplication.agreeMarketing} />
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-[11px] font-bold text-gray-500 flex-shrink-0 w-20 pt-0.5">{label}</span>
      <span className="text-gray-800 flex-1">{value}</span>
    </div>
  );
}

function ConsentBadge({ label, agreed }: { label: string; agreed?: boolean }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${agreed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
      {label} {agreed ? 'Y' : 'N'}
    </span>
  );
}
