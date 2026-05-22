/**
 * /platform/videos — 폐기됨.
 * 자동 큐레이션 설정은 /platform/home-content 의 '인기 유튜브 영상' 탭에 통합.
 * 기존 링크 호환을 위해 redirect만 남김.
 */
import { redirect } from 'next/navigation';

export default function PlatformVideosRedirect() {
  redirect('/platform/home-content?tab=videos');
}
