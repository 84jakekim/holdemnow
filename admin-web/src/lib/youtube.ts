/**
 * YouTube 유틸리티
 * - videoId 추출 (youtube.com/watch?v=, youtu.be/, shorts/, embed/)
 * - 썸네일 URL 생성 (4가지 품질)
 */

/** YouTube URL에서 videoId를 추출합니다. 실패 시 null 반환. */
export function extractYoutubeVideoId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();

  // 이미 videoId만 입력한 경우 (11자 영문+숫자+_-)
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);

    // youtu.be/VIDEO_ID
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).split(/[?&]/)[0];
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }

    // youtube.com/watch?v=VIDEO_ID
    if (parsed.searchParams.has('v')) {
      const id = parsed.searchParams.get('v')!;
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }

    // youtube.com/embed/VIDEO_ID
    // youtube.com/shorts/VIDEO_ID
    const pathMatch = parsed.pathname.match(/\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
    if (pathMatch) return pathMatch[1];
  } catch {
    // URL 파싱 실패 — 정규식으로 fallback
  }

  // 정규식 fallback
  const re = /(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([A-Za-z0-9_-]{11})/;
  const m = trimmed.match(re);
  return m ? m[1] : null;
}

export type YoutubeThumbnailQuality = 'maxresdefault' | 'hqdefault' | 'mqdefault' | 'default';

/** YouTube 썸네일 URL 생성. quality가 없으면 hqdefault 사용. */
export function youtubeThumbnailUrl(
  videoId: string,
  quality: YoutubeThumbnailQuality = 'hqdefault',
): string {
  return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
}
