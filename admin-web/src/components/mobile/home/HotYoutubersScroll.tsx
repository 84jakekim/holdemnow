'use client';

import { useEffect, useState } from 'react';
import { subscribeHotYoutubers, type HotYoutuber } from '@/lib/homeContent';

export default function HotYoutubersScroll() {
  const [youtubers, setYoutubers] = useState<HotYoutuber[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = subscribeHotYoutubers(
      (data) => { setYoutubers(data); setLoaded(true); },
      () => setLoaded(true),
    );
    return unsub;
  }, []);

  if (!loaded || youtubers.length === 0) return null;

  // 6개 이상이면 더 진한 페이드
  const fadeWidth = youtubers.length >= 6 ? 'w-12' : 'w-8';

  // 좌우 padding·세로 padding은 부모 HomeSection이 담당.
  // 가로 스크롤은 음수 마진으로 padding을 뚫고 viewport 끝까지 스크롤 가능.
  return (
    <>
      {/* 섹션 헤더 — 모든 섹션과 동일한 톤 */}
      <div className="mb-3">
        <div
          className="text-[17px] font-extrabold tracking-tight"
          style={{ color: 'var(--text-1)' }}
        >
          인기 유튜버
        </div>
        <div className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>
          홀덤 크리에이터 채널 구독하기
        </div>
      </div>

      {/* 원형 아바타 가로 스크롤 — 페이드 오버레이용 relative
         -mx-4 + pl-4 = 좌측 끝선은 부모 px-4와 일치, 우측은 viewport까지 스크롤 가능 */}
      <div className="relative -mx-4">
        <div className="pl-4 flex gap-4 overflow-x-auto scrollbar-none pb-1">
          {youtubers.map((yt) => (
            <YoutuberAvatarItem key={yt.id} youtuber={yt} />
          ))}
          <div className="w-4 flex-shrink-0" aria-hidden="true" />
        </div>

        {/* 우측 페이드 오버레이 — 6개 이상이면 더 진하게 */}
        <div
          className={`absolute right-0 top-0 bottom-1 ${fadeWidth} pointer-events-none`}
          style={{ background: 'linear-gradient(to right, transparent, var(--bg))' }}
          aria-hidden="true"
        />
      </div>
    </>
  );
}

function YoutuberAvatarItem({ youtuber }: { youtuber: HotYoutuber }) {
  const [imgError, setImgError] = useState(false);

  return (
    <a
      href={youtuber.channelUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center gap-1.5 flex-shrink-0 transition active:scale-95"
      style={{ width: 64 }}
      aria-label={`${youtuber.channelName} 유튜브 채널 보기`}
    >
      {/* 아바타 링 — 빨간 유튜브 컬러 */}
      <div
        className="relative"
        style={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          padding: 2,
          background: 'linear-gradient(135deg, #FF0000 0%, #CC0000 100%)',
          boxShadow: '0 2px 8px rgba(255,0,0,0.25)',
        }}
      >
        <div
          className="w-full h-full overflow-hidden"
          style={{
            borderRadius: '50%',
            border: '2px solid var(--bg)',
          }}
        >
          {!imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={youtuber.avatarUrl}
              alt={youtuber.channelName}
              className="w-full h-full object-cover"
              style={{ borderRadius: '50%' }}
              loading="lazy"
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #FF0000 0%, #880000 100%)',
                borderRadius: '50%',
              }}
            >
              <span className="text-[16px] font-extrabold text-white">
                {youtuber.channelName.charAt(0)}
              </span>
            </div>
          )}
        </div>

        {/* 빨간 ▶ 배지 — 매장 아바타(핑크)와 구분 */}
        <span
          className="absolute bottom-0 right-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center flex-shrink-0"
          style={{
            background: '#FF0000',
            borderColor: 'var(--bg)',
          }}
          aria-hidden="true"
        >
          <svg
            width="7" height="7" viewBox="0 0 24 24"
            fill="#fff" stroke="none"
          >
            <path d="M8 5v14l11-7z"/>
          </svg>
        </span>
      </div>

      {/* 채널명 */}
      <span
        className="text-[11px] font-semibold text-center leading-tight"
        style={{
          color: 'var(--text-2)',
          width: 64,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {youtuber.channelName}
      </span>
    </a>
  );
}
