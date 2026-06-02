'use client';

/**
 * 비밀번호 분실 CS 공용 유틸 — 회원관리 '일반 사용자' 탭 인라인 액션에서 사용.
 * (구 /platform/users 페이지의 고유 가치를 회원관리로 흡수 통합하며 분리)
 *
 * 정책:
 *  - 본사는 비밀번호 원본을 볼 수 없음.
 *  - 이메일/비번 가입자 → 재설정 메일 발송(sendPasswordResetByAdmin).
 *  - Google/카카오 가입자 → 해당 서비스에서만 재설정 가능 → 안내 문구를 카톡으로 전달.
 */

export type AuthKind = 'email' | 'google' | 'kakao' | 'unknown';

export const GOOGLE_NOTICE = `안녕하세요, Pink Rabbit입니다.
Google 계정으로 가입하신 분이라 우리 앱에서 비밀번호 재설정을 도와드릴 수 없습니다.
Google 계정 비밀번호 분실 시 아래 페이지에서 재설정 가능합니다:
https://accounts.google.com/signin/recovery`;

export const KAKAO_NOTICE = `안녕하세요, Pink Rabbit입니다.
카카오 계정으로 가입하신 분이라 우리 앱에서 비밀번호 재설정을 도와드릴 수 없습니다.
카카오 계정 비밀번호 분실 시 카카오톡 → 더보기 → 설정 → 카카오계정 → 비밀번호 변경에서 가능합니다.`;

/** Firestore users doc(providers) · uid 접두사 기반으로 가입 방식 추정 */
export function inferAuthKind(input: { uid?: string; email?: string | null; providers?: string[] }): AuthKind {
  if (input.uid?.startsWith('kakao:')) return 'kakao';
  const providers = (input.providers ?? []).map((p) => p.toLowerCase());
  if (providers.includes('google') || providers.includes('google.com')) return 'google';
  if (providers.includes('kakao') || providers.includes('oidc.kakao')) return 'kakao';
  if (providers.includes('password')) return 'email';
  if (input.email) return 'email';
  return 'unknown';
}

export function noticeFor(kind: AuthKind): string | null {
  if (kind === 'google') return GOOGLE_NOTICE;
  if (kind === 'kakao') return KAKAO_NOTICE;
  return null;
}
