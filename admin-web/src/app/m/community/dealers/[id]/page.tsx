/**
 * /m/community/dealers/[id] — 딜러 상세 (모바일 접근 차단)
 *
 * 정책 v0.3: 딜러 프로필 열람은 매장 owner 전용 (어드민에서만).
 * 일반 사용자 유입은 커뮤니티 인덱스로 redirect.
 */
import { redirect } from 'next/navigation';

export default function DealerDetailRedirect() {
  redirect('/m/community');
}
