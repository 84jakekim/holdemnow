'use client';

import { useEffect, useState } from 'react';
import { subscribeHotVideos, type HotYoutubeVideo } from '@/lib/homeContent';
import { youtubeThumbnailUrl } from '@/lib/youtube';

// ─── 채널 아바타 (이니셜 fallback) ───────────────────────────────
function ChannelAvatar({
  avatarUrl,
  channelName,
  size,
}: {
  avatarUrl?: string;
  channelName?: string;
  size: number;
}) {
  const [err, setErr] = useState(false);
  const initial = channelName ? channelName.trim().charAt(0).toUpperCase() : '?';

  if (avatarUrl && !err) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={channelName ?? '채널'}
        width={size}
        height={size}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
        loading="lazy"
        onError={() => setErr(true)}
      />
    );
  }

  return (
    <span
      className="rounded-full flex items-center justify-center flex-shrink-0 font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        background: 'rgba(255,31,143,0.18)',
        color: 'var(--brand)',
      }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

// ─── 썸네일 (imgError fallback) ──────────────────────────────────
function Thumbnail({ video, large }: { video: HotYoutubeVideo; large: boolean }) {
  const [imgError, setImgError] = useState(false);
  const thumb = video.thumbnailUrl || youtubeThumbnailUrl(video.videoId, 'hqdefault');
  const btnSize = large ? 52 : 34;
  const iconSize = large ? 20 : 13;

  return (
    <div
      className="relative w-full overflow-hidden rounded-t-2xl"
      style={{ aspectRatio: '16/9', background: '#0F0F0F' }}
    >
      {!imgError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt={video.title}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <svg
            width={large ? 40 : 28}
            height={large ? 40 : 28}
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="20" height="20" rx="3" />
            <circle cx="9" cy="9" r="2" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
      )}

      {/* 재생 버튼 오버레이 */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.18)' }}
        aria-hidden="true"
      >
        <div
          className="rounded-full flex items-center justify-center"
          style={{
            width: btnSize,
            height: btnSize,
            background: 'rgba(255,0,0,0.90)',
          }}
        >
          <svg
            width={iconSize}
            height={iconSize}
            viewBox="0 0 24 24"
            fill="#fff"
            stroke="none"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>

      {/* YouTube 배지 — 우하단 */}
      <div className="absolute bottom-2 right-2" aria-hidden="true">
        <span
          className="font-extrabold px-1.5 py-0.5 rounded"
          style={{
            fontSize: large ? 10 : 8,
            background: 'rgba(255,0,0,0.90)',
            color: '#fff',
          }}
        >
          YouTube
        </span>
      </div>
    </div>
  );
}

// ─── 큰 카드 ─────────────────────────────────────────────────────
function BigCard({ video }: { video: HotYoutubeVideo }) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

  return (
    <a
      href={youtubeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-2xl overflow-hidden transition active:scale-[0.98]"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
      aria-label={`${video.title} — 유튜브에서 보기`}
    >
      <Thumbnail video={video} large={true} />

      {/* 텍스트 영역 */}
      <div className="px-3 py-2.5">
        <div
          className="text-[14px] font-bold leading-snug line-clamp-2"
          style={{ color: 'var(--text-1)' }}
        >
          {video.title}
        </div>
        {video.channelName && (
          <div className="flex items-center gap-1.5 mt-2">
            <ChannelAvatar
              avatarUrl={video.channelAvatarUrl}
              channelName={video.channelName}
              size={24}
            />
            <span
              className="text-[12px] truncate"
              style={{ color: 'var(--text-3)' }}
            >
              {video.channelName}
            </span>
          </div>
        )}
      </div>
    </a>
  );
}

// ─── 작은 카드 ────────────────────────────────────────────────────
function SmallCard({ video }: { video: HotYoutubeVideo }) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

  return (
    <a
      href={youtubeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-2xl overflow-hidden transition active:scale-[0.98]"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
      aria-label={`${video.title} — 유튜브에서 보기`}
    >
      <Thumbnail video={video} large={false} />

      <div className="px-2 py-2">
        <div
          className="text-[11px] font-bold leading-snug line-clamp-2"
          style={{ color: 'var(--text-1)' }}
        >
          {video.title}
        </div>
        {video.channelName && (
          <div className="flex items-center gap-1 mt-1.5">
            <ChannelAvatar
              avatarUrl={video.channelAvatarUrl}
              channelName={video.channelName}
              size={20}
            />
            <span
              className="text-[10px] truncate"
              style={{ color: 'var(--text-3)' }}
            >
              {video.channelName}
            </span>
          </div>
        )}
      </div>
    </a>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────
export default function HotVideosCarousel() {
  const [videos, setVideos] = useState<HotYoutubeVideo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = subscribeHotVideos(
      (data) => {
        setVideos(data);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
    return unsub;
  }, []);

  if (!loaded || videos.length === 0) return null;

  const hasSmallRow = videos.length >= 2;

  return (
    <section aria-label="인기 유튜브 영상" className="py-5">
      {/* 섹션 헤더 */}
      <div className="px-4 mb-3">
        <div
          className="text-[17px] font-extrabold tracking-tight"
          style={{ color: 'var(--text-1)' }}
        >
          홀덤 관련{' '}
          <span style={{ color: 'var(--brand)' }}>인기 영상</span>
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
          홀덤 필수 시청 콘텐츠
        </div>
      </div>

      {/* 큰 카드 행 — 한 화면 1개, snap = 카드 1개 */}
      <div
        className="px-4 flex overflow-x-auto scrollbar-none gap-3"
        style={{ scrollSnapType: 'x mandatory' }}
        aria-label="큰 영상 카드 가로 스크롤"
      >
        {videos.map((v) => (
          <div
            key={`big-${v.videoId}`}
            className="flex-shrink-0"
            style={{ scrollSnapAlign: 'start', width: 'calc(100vw - 32px)' }}
          >
            <BigCard video={v} />
          </div>
        ))}
      </div>

      {/* 작은 카드 행 — 한 화면 2개, snap = 카드 1개 (영상 2개 이상일 때만) */}
      {hasSmallRow && (
        <div
          className="mt-3 px-4 flex overflow-x-auto scrollbar-none gap-3"
          style={{ scrollSnapType: 'x mandatory' }}
          aria-label="작은 영상 카드 가로 스크롤"
        >
          {videos.map((v) => (
            <div
              key={`small-${v.videoId}`}
              className="flex-shrink-0"
              style={{
                scrollSnapAlign: 'start',
                width: 'calc((100vw - 32px - 12px) / 2)',
              }}
            >
              <SmallCard video={v} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
