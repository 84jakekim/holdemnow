/**
 * members-xlsx.ts — 회원 목록 엑셀 내보내기
 *
 * exceljs 기반. 3시트(일반/매장/대회사) 통합 1파일.
 * 현재 탭만 데이터 채우고 나머지는 빈 시트.
 * 마스킹 ON 시: 휴대폰 중간 4자리 마스킹, 이메일 앞 1자리+도메인만 표시.
 */

// ExcelJS는 ~240KB(gzip) — 초기 번들에서 제외하기 위해 dynamic import만 사용.
// 타입은 type-only로 가져와 런타임 비용 0.
import type ExcelJS from 'exceljs';

// =====================================================================
// 타입
// =====================================================================

export interface UserExportRow {
  uid: string;
  email?: string;
  realName?: string;
  nickname?: string;
  phone?: string;
  providers?: string[];
  signupSource?: string;
  signupAt?: { toDate: () => Date } | null;
  status?: string;
  passwordHint?: string;
  recoveryLast4?: string;
  favoritesCount?: number;
  postsCount?: number;
}

export interface StoreExportRow {
  id: string;
  ownerEmail?: string;
  representativeName?: string;
  representativePhone?: string;
  name?: string;
  address?: string;
  phone?: string;
  hours?: string;
  status?: string;
  createdAt?: { toDate: () => Date } | null;
  businessRegistrationNumber?: string;
  signageImageUrl?: string;
  signupApplication?: {
    agreeService?: boolean;
    agreePrivacy?: boolean;
    agreeMarketing?: boolean;
  };
}

export interface OrganizerExportRow {
  id: string;
  ownerEmail?: string;
  companyName?: string;
  businessRegistrationNumber?: string;
  representativeName?: string;
  representativePhone?: string;
  companyAddress?: string;
  contactPerson?: {
    name?: string;
    position?: string;
    phone?: string;
    email?: string;
  };
  tournamentReferences?: string;
  status?: string;
  createdAt?: { toDate: () => Date } | null;
}

export interface ExportMembersOpts {
  tab: 'users' | 'stores' | 'organizers';
  users?: UserExportRow[];
  stores?: StoreExportRow[];
  organizers?: OrganizerExportRow[];
  masking: boolean;
}

// =====================================================================
// 마스킹 헬퍼
// =====================================================================

function maskPhone(phone: string | undefined, masking: boolean): string {
  if (!phone) return '';
  if (!masking) return phone;
  // 010-XXXX-XXXX → 010-****-XXXX
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.length === 11) {
    return `${cleaned.slice(0, 3)}-****-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-***-${cleaned.slice(6)}`;
  }
  return '****';
}

function maskEmail(email: string | undefined, masking: boolean): string {
  if (!email) return '';
  if (!masking) return email;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.charAt(0)}***@${domain}`;
}

function maskRecoveryLast4(val: string | undefined, masking: boolean): string {
  if (!val) return '';
  if (!masking) return val;
  return '****';
}

function fmtDate(ts: { toDate: () => Date } | null | undefined): string {
  if (!ts) return '';
  try {
    const d = ts.toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

// =====================================================================
// 스타일 헬퍼
// =====================================================================

function applyHeaderStyle(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF1F8F' }, // 핑크 헤더
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    };
  });
  row.height = 22;
}

// =====================================================================
// 메인 함수
// =====================================================================

export async function exportMembersToXlsx(opts: ExportMembersOpts): Promise<Blob> {
  const { tab, users = [], stores = [], organizers = [], masking } = opts;

  // ExcelJS 동적 로드 — 본사 어드민 export 클릭 시점에만 청크 다운로드 (~240KB).
  // 일반 사용자(/m/*) 페이지엔 절대 포함 안 됨.
  const ExcelJSMod = (await import('exceljs')).default;
  const wb = new ExcelJSMod.Workbook();
  wb.creator = 'Pink Rabbit 본사';
  wb.created = new Date();

  // ── 시트 1: 일반 사용자 ──
  const wsUsers = wb.addWorksheet('일반 사용자');
  wsUsers.columns = [
    { header: 'UID', key: 'uid', width: 28 },
    { header: '이메일', key: 'email', width: 28 },
    { header: '실명', key: 'realName', width: 14 },
    { header: '닉네임', key: 'nickname', width: 14 },
    { header: '휴대폰', key: 'phone', width: 18 },
    { header: '로그인 방법', key: 'providers', width: 16 },
    { header: '가입 경로', key: 'signupSource', width: 16 },
    { header: '가입일시', key: 'signupAt', width: 20 },
    { header: '상태', key: 'status', width: 10 },
    { header: '비밀번호 힌트', key: 'passwordHint', width: 20 },
    { header: '복구 뒤4자리', key: 'recoveryLast4', width: 14 },
    { header: '즐겨찾기 수', key: 'favoritesCount', width: 12 },
    { header: '작성 글 수', key: 'postsCount', width: 12 },
  ];
  applyHeaderStyle(wsUsers.getRow(1));

  if (tab === 'users') {
    for (const u of users) {
      wsUsers.addRow({
        uid: u.uid,
        email: maskEmail(u.email, masking),
        realName: u.realName ?? '',
        nickname: u.nickname ?? '',
        phone: maskPhone(u.phone, masking),
        providers: (u.providers ?? []).join(', '),
        signupSource: u.signupSource ?? '',
        signupAt: fmtDate(u.signupAt),
        status: u.status ?? '',
        passwordHint: u.passwordHint ?? '',
        recoveryLast4: maskRecoveryLast4(u.recoveryLast4, masking),
        favoritesCount: u.favoritesCount ?? 0,
        postsCount: u.postsCount ?? 0,
      });
    }
  }

  // ── 시트 2: 매장 ──
  const wsStores = wb.addWorksheet('매장');
  wsStores.columns = [
    { header: '매장 ID', key: 'id', width: 28 },
    { header: '대표자 이메일', key: 'ownerEmail', width: 28 },
    { header: '대표자명', key: 'representativeName', width: 14 },
    { header: '대표 연락처', key: 'representativePhone', width: 18 },
    { header: '매장명', key: 'name', width: 20 },
    { header: '매장 주소', key: 'address', width: 30 },
    { header: '매장 전화', key: 'phone', width: 16 },
    { header: '영업시간', key: 'hours', width: 20 },
    { header: '상태', key: 'status', width: 10 },
    { header: '신청일시', key: 'createdAt', width: 20 },
    { header: '사업자번호', key: 'businessRegistrationNumber', width: 16 },
    { header: '간판사진 URL', key: 'signageImageUrl', width: 40 },
    { header: '서비스 동의', key: 'agreeService', width: 12 },
    { header: '개인정보 동의', key: 'agreePrivacy', width: 14 },
    { header: '마케팅 동의', key: 'agreeMarketing', width: 12 },
  ];
  applyHeaderStyle(wsStores.getRow(1));

  if (tab === 'stores') {
    for (const s of stores) {
      wsStores.addRow({
        id: s.id,
        ownerEmail: maskEmail(s.ownerEmail, masking),
        representativeName: s.representativeName ?? '',
        representativePhone: maskPhone(s.representativePhone, masking),
        name: s.name ?? '',
        address: s.address ?? '',
        phone: maskPhone(s.phone, masking),
        hours: s.hours ?? '',
        status: s.status ?? '',
        createdAt: fmtDate(s.createdAt),
        businessRegistrationNumber: s.businessRegistrationNumber ?? '',
        signageImageUrl: s.signageImageUrl ?? '',
        agreeService: s.signupApplication?.agreeService ? 'Y' : 'N',
        agreePrivacy: s.signupApplication?.agreePrivacy ? 'Y' : 'N',
        agreeMarketing: s.signupApplication?.agreeMarketing ? 'Y' : 'N',
      });
    }
  }

  // ── 시트 3: 대회사 ──
  const wsOrgs = wb.addWorksheet('대회사');
  wsOrgs.columns = [
    { header: '대회사 ID', key: 'id', width: 28 },
    { header: '대표자 이메일', key: 'ownerEmail', width: 28 },
    { header: '회사명', key: 'companyName', width: 20 },
    { header: '사업자번호', key: 'businessRegistrationNumber', width: 16 },
    { header: '대표자명', key: 'representativeName', width: 14 },
    { header: '대표 연락처', key: 'representativePhone', width: 18 },
    { header: '회사 주소', key: 'companyAddress', width: 30 },
    { header: '담당자명', key: 'contactName', width: 14 },
    { header: '담당자 직책', key: 'contactPosition', width: 14 },
    { header: '담당자 연락처', key: 'contactPhone', width: 16 },
    { header: '담당자 이메일', key: 'contactEmail', width: 24 },
    { header: '대회 레퍼런스', key: 'tournamentReferences', width: 40 },
    { header: '상태', key: 'status', width: 10 },
    { header: '신청일시', key: 'createdAt', width: 20 },
  ];
  applyHeaderStyle(wsOrgs.getRow(1));

  if (tab === 'organizers') {
    for (const o of organizers) {
      wsOrgs.addRow({
        id: o.id,
        ownerEmail: maskEmail(o.ownerEmail, masking),
        companyName: o.companyName ?? '',
        businessRegistrationNumber: o.businessRegistrationNumber ?? '',
        representativeName: o.representativeName ?? '',
        representativePhone: maskPhone(o.representativePhone, masking),
        companyAddress: o.companyAddress ?? '',
        contactName: o.contactPerson?.name ?? '',
        contactPosition: o.contactPerson?.position ?? '',
        contactPhone: maskPhone(o.contactPerson?.phone, masking),
        contactEmail: maskEmail(o.contactPerson?.email, masking),
        tournamentReferences: o.tournamentReferences ?? '',
        status: o.status ?? '',
        createdAt: fmtDate(o.createdAt),
      });
    }
  }

  // ── XLSX Blob 생성 ──
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function getMembersXlsxFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyymmdd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const hhmm = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `holdemnow-members-${yyyymmdd}-${hhmm}.xlsx`;
}
