'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
      className="flex-1 min-w-0 block rounded-2xl overflow-hidden transition active:scale-[0.98]"
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

// ─── 빈 작은 카드 슬롯 ───────────────────────────────────────────
function EmptySmallSlot() {
  return <div className="flex-1 min-w-0" aria-hidden="true" />;
}

// ─── 페이지 (큰 1 + 작은 2) ──────────────────────────────────────
function VideoPage({ group }: { group: HotYoutubeVideo[] }) {
  const big = group[0];
  const small1 = group[1];
  const small2 = group[2];

  return (
    <div
      className="w-full flex-shrink-0 flex flex-col gap-3"
      style={{ scrollSnapAlign: 'start' }}
    >
      {/* 큰 카드 */}
      {big && <BigCard video={big} />}

      {/* 작은 카드 2개 — small1 또는 small2가 있을 때만 렌더 */}
      {(small1 || small2) && (
        <div className="flex gap-3">
          {small1 ? <SmallCard video={small1} /> : <EmptySmallSlot />}
          {small2 ? <SmallCard video={small2} /> : <EmptySmallSlot />}
        </div>
      )}
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────
export default function HotVideosCarousel() {
  const [videos, setVideos] = useState<HotYoutubeVideo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activePage, setActivePage] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  // 3개씩 페이지 chunking
  const pages = useMemo(() => {
    const out: HotYoutubeVideo[][] = [];
    for (let i = 0; i < videos.length; i += 3) out.push(videos.slice(i, i + 3));
    return out;
  }, [videos]);

  // 스크롤 위치로 활성 페이지 추적
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const pageWidth = el.clientWidth;
      if (pageWidth === 0) return;
      const newPage = Math.round(el.scrollLeft / pageWidth);
      setActivePage(Math.min(newPage, pages.length - 1));
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [pages.length]);

  if (!loaded || pages.length === 0) return null;

  const showDots = pages.length >= 2;

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

      {/* 페이지 단위 가로 스크롤 */}
      <div
        ref={scrollRef}
        className="px-4 flex overflow-x-auto scrollbar-none gap-4"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {pages.map((group, i) => (
          <VideoPage key={i} group={group} />
        ))}
      </div>

      {/* 점 인디케이터 — 페이지 2개 이상 */}
      {showDots && (
        <div
          className="flex justify-center gap-1.5 mt-3"
          role="tablist"
          aria-label="페이지 인디케이터"
        >
          {pages.map((_, i) => (
            <span
              key={i}
              role="tab"
              aria-selected={i === activePage}
              aria-label={`${i + 1}번째 페이지`}
              className="block rounded-full transition-all duration-200"
              style={{
                width: i === activePage ? 14 : 6,
                height: 6,
                background:
                  i === activePage
                    ? 'var(--brand)'
                    : 'rgba(255,31,143,0.30)',
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
