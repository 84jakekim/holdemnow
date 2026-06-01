/**
 * storeReview.ts — 매장 가입 심사 기준 단일 소스(SSOT)
 *
 * 목적:
 *   본사 총괄 어드민이 매장 가입 신청을 심사할 때 "무엇을 보고 승인/반려하는가"의
 *   기준을 코드 한 곳에 정의한다. 두 종류의 기준:
 *
 *   1. 자동 기준(auto)  — 신청 데이터로 즉시 판정 가능. 충족/미충족이 자동 계산됨.
 *      (예: 사업자등록번호 형식 유효, 간판 사진 첨부, 필수 약관 동의 등)
 *   2. 수동 기준(manual) — 본사 담당자가 눈으로 검토 후 체크해야 하는 항목.
 *      (예: 사업자번호 진위·업종 확인, 매장 실존 확인, 불법 사설 영업 정황 없음)
 *      → stores/{id}.reviewChecklist 에 boolean으로 저장.
 *
 * 승인 게이트:
 *   required=true 인 모든 자동 기준이 충족되고, required=true 인 모든 수동 기준이
 *   체크되어야 "승인 가능"(canApprove=true). 미충족 항목이 있으면 본사 어드민에서
 *   승인 버튼이 경고를 띄운다. (불법 사설업체·미비 신청을 거르기 위한 핵심 정책)
 *
 * 이 모듈은 프레임워크 비의존(순수 TS) — 본사 심사 화면과 매장 접속 게이트가 공유한다.
 */

// ─────────────────────────────────────────────────────────────
// 신청 데이터 형태 (stores/{id} 문서의 심사 관련 필드)
// ─────────────────────────────────────────────────────────────
export interface StoreApplicationData {
  name?: string;
  businessRegistrationNumber?: string;
  signageImageUrl?: string;
  photoUrls?: string[];
  address?: string;
  roadAddress?: string;
  regionCode?: string;
  representativeName?: string;
  representativePhone?: string;
  phone?: string;
  hours?: string;
  description?: string;
  signupApplication?: {
    agreeService?: boolean;
    agreePrivacy?: boolean;
    agreeMarketing?: boolean;
    submittedAt?: string;
  };
  /** 수동 심사 체크 결과 — 본사 담당자가 체크. criterionId → 체크 여부 */
  reviewChecklist?: Record<string, boolean>;
}

export type CriterionKind = 'auto' | 'manual';

export interface ReviewCriterion {
  id: string;
  label: string;
  /** 심사자에게 보여줄 짧은 설명 */
  hint: string;
  kind: CriterionKind;
  /** 승인 필수 항목인지 — true면 미충족 시 승인 차단(경고) */
  required: boolean;
}

export interface EvaluatedCriterion extends ReviewCriterion {
  met: boolean;
  /** 자동 기준의 판정 근거 텍스트 (예: "123-45-67890") */
  detail?: string;
}

// ─────────────────────────────────────────────────────────────
// 사업자등록번호 형식 검사 (XXX-XX-XXXXX)
// emailAuth.ts의 validateBusinessReg와 동일 규칙 — 'use client' 의존 없이 재정의.
// ─────────────────────────────────────────────────────────────
export function isBrnFormatValid(brn: string | undefined | null): boolean {
  return /^\d{3}-\d{2}-\d{5}$/.test((brn ?? '').trim());
}

// ─────────────────────────────────────────────────────────────
// 자동 심사 기준 정의
// ─────────────────────────────────────────────────────────────
export const AUTO_CRITERIA: ReviewCriterion[] = [
  { id: 'brn', label: '사업자등록번호', hint: '10자리(XXX-XX-XXXXX) 형식으로 입력됨', kind: 'auto', required: true },
  { id: 'signage', label: '매장 간판 사진', hint: '실존 확인용 간판 사진 첨부됨', kind: 'auto', required: true },
  { id: 'address', label: '매장 주소·지역', hint: '도로명 주소 + 광역 지역코드 산출됨', kind: 'auto', required: true },
  { id: 'rep', label: '대표자 정보', hint: '대표자명 + 연락처 입력됨', kind: 'auto', required: true },
  { id: 'terms', label: '필수 약관 동의', hint: '이용약관·개인정보 처리방침 동의', kind: 'auto', required: true },
  { id: 'contact', label: '매장 연락처', hint: '매장 전화번호 입력됨', kind: 'auto', required: false },
  { id: 'hours', label: '영업시간', hint: '영업시간 입력됨', kind: 'auto', required: false },
];

// ─────────────────────────────────────────────────────────────
// 수동 심사 기준 정의 — 본사 담당자가 검토 후 체크
// ─────────────────────────────────────────────────────────────
export const MANUAL_CRITERIA: ReviewCriterion[] = [
  { id: 'brnVerified', label: '사업자등록번호 진위·업종 확인', hint: '국세청/공개 조회로 실제 등록 + 홀덤펍 관련 업종인지 확인', kind: 'manual', required: true },
  { id: 'realExists', label: '매장 실존 확인', hint: '간판 사진·주소로 실제 운영 매장임을 확인', kind: 'manual', required: true },
  { id: 'legal', label: '불법 사설 영업 정황 없음', hint: '환전·도박 매개 등 불법 사설업체 정황이 없음', kind: 'manual', required: true },
  { id: 'addressMatch', label: '주소·간판 일치', hint: '입력 주소와 간판 사진의 매장이 일치(권장)', kind: 'manual', required: false },
];

export const ALL_CRITERIA: ReviewCriterion[] = [...AUTO_CRITERIA, ...MANUAL_CRITERIA];

// ─────────────────────────────────────────────────────────────
// 자동 기준 평가
// ─────────────────────────────────────────────────────────────
export function evaluateAutoCriteria(s: StoreApplicationData): EvaluatedCriterion[] {
  const brn = (s.businessRegistrationNumber ?? '').trim();
  const brnOk = isBrnFormatValid(brn);
  const signageOk = !!(s.signageImageUrl || (s.photoUrls && s.photoUrls.length > 0));
  const addressOk = (s.roadAddress ?? '').trim().length >= 5 && !!(s.regionCode ?? '').trim();
  const repOk = (s.representativeName ?? '').trim().length >= 1 && (s.representativePhone ?? '').trim().length >= 7;
  const termsOk = !!(s.signupApplication?.agreeService && s.signupApplication?.agreePrivacy);
  const contactOk = (s.phone ?? '').trim().length >= 7;
  const hoursRaw = (s.hours ?? '').trim();
  const hoursOk = hoursRaw.length > 0 && hoursRaw !== '협의 후 결정';

  const metMap: Record<string, { met: boolean; detail?: string }> = {
    brn: { met: brnOk, detail: brn ? brn : '미입력' },
    signage: { met: signageOk, detail: signageOk ? '첨부됨' : '미첨부' },
    address: { met: addressOk, detail: [s.roadAddress, s.regionCode ? `(${s.regionCode})` : ''].filter(Boolean).join(' ') || '미입력' },
    rep: { met: repOk, detail: [s.representativeName, s.representativePhone].filter(Boolean).join(' · ') || '미입력' },
    terms: { met: termsOk, detail: termsOk ? '동의 완료' : '미동의' },
    contact: { met: contactOk, detail: s.phone || '미입력' },
    hours: { met: hoursOk, detail: hoursRaw || '미입력' },
  };

  return AUTO_CRITERIA.map((c) => ({ ...c, met: metMap[c.id]?.met ?? false, detail: metMap[c.id]?.detail }));
}

// ─────────────────────────────────────────────────────────────
// 수동 기준 평가 (reviewChecklist 기반)
// ─────────────────────────────────────────────────────────────
export function evaluateManualCriteria(s: StoreApplicationData): EvaluatedCriterion[] {
  const checklist = s.reviewChecklist ?? {};
  return MANUAL_CRITERIA.map((c) => ({ ...c, met: checklist[c.id] === true }));
}

// ─────────────────────────────────────────────────────────────
// 종합 — 충족 요약 + 승인 가능 여부
// ─────────────────────────────────────────────────────────────
export interface ReviewSummary {
  auto: EvaluatedCriterion[];
  manual: EvaluatedCriterion[];
  /** 충족 항목 수 (자동+수동 전체) */
  metCount: number;
  /** 전체 기준 수 */
  totalCount: number;
  /** 미충족인 필수 항목 목록 (자동+수동) — 승인 차단 사유 */
  unmetRequired: EvaluatedCriterion[];
  /** 승인 가능 여부 — 필수 항목 전부 충족 시 true */
  canApprove: boolean;
}

export function summarizeReview(s: StoreApplicationData): ReviewSummary {
  const auto = evaluateAutoCriteria(s);
  const manual = evaluateManualCriteria(s);
  const all = [...auto, ...manual];
  const metCount = all.filter((c) => c.met).length;
  const unmetRequired = all.filter((c) => c.required && !c.met);
  return {
    auto,
    manual,
    metCount,
    totalCount: all.length,
    unmetRequired,
    canApprove: unmetRequired.length === 0,
  };
}
