/**
 * 전화번호 정규화·검증 헬퍼.
 *
 * 정책:
 * - 1인 1계정: 어떤 가입 방식(Google/Kakao/Email)이든 전화번호 직접 입력 강제.
 * - 정규화 포맷: 010XXXXXXXX (하이픈·공백·국가코드 제거).
 * - +82 국제 표기 → 0 접두 한국 로컬 포맷으로 변환.
 * - 안전망으로 011~019 옛 번호도 통과시키되, 현행 010만 신규 발급된다.
 */

/** 다양한 형식의 한국 핸드폰 번호를 010XXXXXXXX 형태로 정규화. 유효하지 않으면 null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // 모든 비숫자 제거
  const digits = raw.replace(/\D/g, '');
  // +82 제거 (820 또는 82로 시작)
  let local = digits;
  if (local.startsWith('820')) local = '0' + local.slice(3);  // 8210... → 010...
  else if (local.startsWith('82')) local = '0' + local.slice(2);  // 8210... → 010...
  // 010-XXXX-XXXX (010 시작 + 총 11자리)
  if (/^010\d{8}$/.test(local)) return local;
  // 011~019 옛 번호도 받기 (안전망)
  if (/^01[16789]\d{7,8}$/.test(local)) return local;
  return null;
}

/** "01012345678" → "010-1234-5678" 표시용 */
export function formatPhone(normalized: string): string {
  if (!normalized || normalized.length < 10) return normalized;
  const head = normalized.slice(0, 3);
  const mid = normalized.length === 11 ? normalized.slice(3, 7) : normalized.slice(3, 6);
  const tail = normalized.length === 11 ? normalized.slice(7) : normalized.slice(6);
  return `${head}-${mid}-${tail}`;
}

/** 마스킹 표시 — 010-12**-5678 */
export function maskPhone(normalized: string): string {
  if (!normalized || normalized.length < 10) return normalized;
  const head = normalized.slice(0, 3);
  const tail = normalized.slice(-4);
  return `${head}-${'*'.repeat(normalized.length - 7)}-${tail}`;
}
