/**
 * getYoutubeChannelMeta — YouTube 채널 페이지 메타 추출 (API key 불필요)
 *
 * 채널 URL을 받아 서버에서 HTML fetch + og:title/og:description/og:image 파싱.
 * 클라이언트는 CORS로 직접 fetch 불가하므로 이 callable로 우회.
 *
 * 지원 URL 형식:
 *  - https://www.youtube.com/channel/UCxxxx
 *  - https://www.youtube.com/@handle
 *  - https://www.youtube.com/c/customName
 *  - https://www.youtube.com/user/oldUsername
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import axios from 'axios';

interface Input {
  url: string;
}

interface Output {
  channelName: string;
  description: string;
  avatarUrl: string;
  channelId: string;
}

const META_RE = (prop: string) =>
  new RegExp(`<meta\\s+property=["']${prop}["']\\s+content=["']([^"']+)["']`, 'i');

const CHANNEL_ID_RE = /"channelId":"([^"]+)"/;
const EXTERNAL_ID_RE = /"externalId":"(UC[^"]+)"/;

export const getYoutubeChannelMeta = onCall<Input>(
  { region: 'asia-northeast3', maxInstances: 5, cors: true },
  async (request) => {
    const { url } = request.data || {};
    if (!url || typeof url !== 'string') {
      throw new HttpsError('invalid-argument', 'url 필요');
    }

    const normalized = url.trim();
    if (!/^https?:\/\/(www\.)?youtube\.com\//i.test(normalized)) {
      throw new HttpsError('invalid-argument', '유효한 YouTube 채널 URL이 아닙니다');
    }

    let html: string;
    try {
      const res = await axios.get<string>(normalized, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
        timeout: 8000,
        responseType: 'text',
        // 일부 응답은 gzip — axios가 자동 처리
      });
      html = typeof res.data === 'string' ? res.data : String(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpsError('unavailable', `YouTube 페이지 fetch 실패: ${msg}`);
    }

    const ogTitle = html.match(META_RE('og:title'))?.[1] ?? '';
    const ogDescription = html.match(META_RE('og:description'))?.[1] ?? '';
    const ogImage = html.match(META_RE('og:image'))?.[1] ?? '';
    const channelId =
      html.match(EXTERNAL_ID_RE)?.[1] ?? html.match(CHANNEL_ID_RE)?.[1] ?? '';

    // og:title이 "YouTube"이면 채널 페이지가 아닌 일반 페이지
    if (!ogTitle || ogTitle === 'YouTube') {
      throw new HttpsError('not-found', '채널 정보를 찾지 못했습니다');
    }

    // HTML entities 간단 디코드 (og 메타 값에 자주 등장)
    const decode = (s: string) =>
      s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x2F;/gi, '/');

    const result: Output = {
      channelName: decode(ogTitle).slice(0, 80),
      description: decode(ogDescription).split(/\r?\n/)[0].slice(0, 200),
      avatarUrl: ogImage,
      channelId,
    };

    return result;
  },
);
