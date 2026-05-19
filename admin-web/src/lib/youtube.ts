/**
 * YouTube 유틸리티
 * - videoId 추출 (youtube.com/watch?v=, youtu.be/, shorts/, embed/)
 * - 썸네일 URL 생성 (4가지 품질)
 * - 채널 URL → 채널 메타 자동 추출 (YouTube Data API v3)
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

// ─── YouTube 채널 메타 자동 추출 ───────────────────────────────

export interface YoutubeChannelMeta {
  channelId: string;
  channelName: string;
  description: string;   // 채널 설명 첫 줄, 200자 제한
  avatarUrl: string;
}

/**
 * YouTube 채널 URL에서 channelId / handle / username을 파싱합니다.
 * 반환 형태:
 *   { type: 'id',       value: 'UCxxxx' }
 *   { type: 'handle',   value: '@handle' }
 *   { type: 'custom',   value: 'customName' }
 *   { type: 'user',     value: 'oldUsername' }
 *   null — 파싱 불가
 */
export function parseYoutubeChannelUrl(
  url: string,
): { type: 'id' | 'handle' | 'custom' | 'user'; value: string } | null {
  if (!url) return null;
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const path = parsed.pathname;

    // /channel/UCxxxx
    const idMatch = path.match(/^\/channel\/(UC[A-Za-z0-9_-]+)/);
    if (idMatch) return { type: 'id', value: idMatch[1] };

    // /@handle
    const handleMatch = path.match(/^\/@([\w.%-]+)/);
    if (handleMatch) return { type: 'handle', value: `@${handleMatch[1]}` };

    // /user/oldUsername
    const userMatch = path.match(/^\/user\/([\w.%-]+)/);
    if (userMatch) return { type: 'user', value: userMatch[1] };

    // /c/customName
    const customMatch = path.match(/^\/c\/([\w.%-]+)/);
    if (customMatch) return { type: 'custom', value: customMatch[1] };
  } catch {
    // URL 파싱 실패
  }

  return null;
}

/**
 * YouTube 채널 메타 자동 추출 (API key 불필요).
 *
 * 동작:
 * - Cloud Function `getYoutubeChannelMeta` 호출 (CORS 우회 + og:meta 파싱)
 * - 서버에서 채널 페이지 HTML fetch → og:title / og:description / og:image / channelId 추출
 * - 클라이언트는 URL만 전달하면 끝
 *
 * 지원 URL 패턴: youtube.com/channel/UCxxxx, /@handle, /c/customName, /user/oldUsername
 * 실패 시 null 반환 (graceful fallback — 수동 입력으로 회귀).
 */
export async function fetchYoutubeChannelMeta(
  channelUrl: string,
): Promise<YoutubeChannelMeta | null> {
  if (!channelUrl?.trim()) return null;

  try {
    // 동적 import — SSR/server 환경에서도 안전, firebase functions client lazy load
    const [{ httpsCallable, getFunctions }, { app }] = await Promise.all([
      import('firebase/functions'),
      import('./firebase'),
    ]);

    const functions = getFunctions(app, 'asia-northeast3');
    const callable = httpsCallable<
      { url: string },
      { channelName: string; description: string; avatarUrl: string; channelId: string }
    >(functions, 'getYoutubeChannelMeta');

    const res = await callable({ url: channelUrl.trim() });
    const data = res.data;

    if (!data?.channelName) return null;

    return {
      channelId: data.channelId ?? '',
      channelName: data.channelName,
      description: data.description ?? '',
      avatarUrl: data.avatarUrl ?? '',
    };
  } catch {
    // Function 미배포 / 네트워크 오류 / 채널 페이지 fetch 실패 — 조용히 null
    return null;
  }
}
