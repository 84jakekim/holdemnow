'use client';

/**
 * StoreInfoCard — 매장 상세 정보 카드
 * 매장명, 주소, 영업시간, 전화, 소개, 간판사진, 대표자, 사업자 번호
 */

import { useState } from 'react';

interface StoreInfoCardProps {
  name?: string;
  address?: string;
  hours?: string;
  phone?: string;
  description?: string;
  signageImageUrl?: string;
  representativeName?: string;
  representativePhone?: string;
  businessRegistrationNumber?: string;
  signupApplication?: {
    submittedAt?: string;
    agreeService?: boolean;
    agreePrivacy?: boolean;
    agreeMarketing?: boolean;
  };
}

export default function StoreInfoCard({
  name,
  address,
  hours,
  phone,
  description,
  signageImageUrl,
  representativeName,
  representativePhone,
  businessRegistrationNumber,
  signupApplication,
}: StoreInfoCardProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {/* 간판사진 미리보기 */}
      {signageImageUrl && !imgError && (
        <div className="relative w-full bg-gray-100 overflow-hidden" style={{ aspectRatio: '16/9' }}>
          <img
            src={signageImageUrl}
            alt="매장 간판 사진"
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        </div>
      )}

      <div className="p-4 space-y-3">
        <h3 className="text-sm font-extrabold text-gray-900">매장 정보</h3>

        <InfoRow label="매장명" value={name} />
        <InfoRow label="주소" value={address} />
        <InfoRow label="영업시간" value={hours} />
        <InfoRow label="매장 전화" value={phone} />
        {description && (
          <div>
            <div className="text-[11px] font-bold text-gray-500 mb-0.5">소개</div>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{description}</p>
          </div>
        )}
        <div className="border-t border-gray-100 pt-3">
          <h4 className="text-[11px] font-bold text-gray-500 mb-2">대표자 정보</h4>
          <InfoRow label="대표자명" value={representativeName} />
          <InfoRow label="대표 연락처" value={representativePhone} />
          {businessRegistrationNumber && (
            <InfoRow label="사업자번호" value={businessRegistrationNumber} />
          )}
        </div>

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
