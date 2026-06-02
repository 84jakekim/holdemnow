import { redirect } from 'next/navigation';

/**
 * /platform/users — 회원관리로 흡수 통합됨 (2026-06-03).
 * 비밀번호 분실 CS(재설정 메일 / 소셜 안내 복사)는 이제 '회원 관리 > 일반 사용자' 탭에서 인라인으로 처리.
 * 기존 북마크·링크 호환을 위해 영구 리다이렉트만 유지.
 */
export default function PlatformUsersRedirect() {
  redirect('/platform/members?tab=players');
}
