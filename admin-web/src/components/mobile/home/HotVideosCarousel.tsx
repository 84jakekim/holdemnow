'use client';

import { useEffect, useState } from 'react';
import { subscribeHotVideos, type HotYoutubeVideo } from '@/lib/homeContent';
import { youtubeThumbnailUrl } from '@/lib/youtube';

export default function HotVideosCarousel() {
  const [videos, setVideos] = useState<HotYoutubeVideo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = subscribeHotVideos(
      (data) => { setVideos(data); setLoaded(true); },
      () => setLoaded(true),
    );
    return unsub;
  }, []);

  if (!loaded || videos.length === 0) return null;

  return (
    <section aria-label="인기 유튜브 영상" className="py-5">
      {/* 섹션 헤더 */}
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div
            className="text-[17px] font-extrabold tracking-tight flex items-center gap-1.5"
            style={{ color: 'var(--text-1)' }}
          >
            <span aria-hidden="true">▶</span>
            <span>인기 유튜브 영상</span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            홀덤 필수 시청 콘텐츠
          </div>
        </div>
      </div>

      {/* 가로 스크롤 카드 */}
      <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
        {videos.map((v) => (
          <VideoCard key={v.id} video={v} />
        ))}
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>
    </section>
  );
}

function VideoCard({ video }: { video: HotYoutubeVideo }) {
  const thumb = video.thumbnailUrl || youtubeThumbnailUrl(video.videoId, 'hqdefault');
  const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
  const [imgError, setImgError] = useState(false);

  return (
    <a
      href={youtubeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="w-[200px] flex-shrink-0 block rounded-2xl overflow-hidden transition active:scale-95"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
      aria-label={`${video.title} 유튜브에서 보기`}
    >
      {/* 썸네일 — 16:9 */}
      <div
        className="relative w-full overflow-hidden"
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
              width="28" height="28" viewBox="0 0 24 24"
              fill="none" stroke="rgba(255,255,255,0.3)"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="2" width="20" height="20" rx="3"/>
              <circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>
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
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,0,0,0.88)' }}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24"
              fill="#fff" stroke="none" aria-hidden="true"
            >
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>

        {/* YouTube 로고 — 우하단 */}
        <div className="absolute bottom-2 right-2" aria-hidden="true">
          <span
            className="text-[9px] font-extrabold px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(255,0,0,0.88)', color: '#fff' }}
          >
            YouTube
          </span>
        </div>
      </div>

      {/* 텍스트 영역 */}
      <div className="px-3 py-2.5">
        <div
          className="text-[12px] font-bold leading-snug line-clamp-2"
          style={{ color: 'var(--text-1)' }}
        >
          {video.title}
        </div>
        {video.channelName && (
          <div
            className="text-[11px] mt-1 truncate"
            style={{ color: 'var(--text-3)' }}
          >
            {video.channelName}
          </div>
        )}
      </div>
    </a>
  );
}
