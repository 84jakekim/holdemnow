'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeHomeAds, type HomeAd } from '@/lib/homeContent';

interface Props {
  position: 'top' | 'bottom';
}

const AUTO_ROTATE_MS = 4000;

export default function HomeAdsCarousel({ position }: Props) {
  const [ads, setAds] = useState<HomeAd[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsub = subscribeHomeAds(
      position,
      (data) => { setAds(data); setLoaded(true); },
      () => setLoaded(true),
    );
    return unsub;
  }, [position]);

  // viewport 가시성 추적
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const ob = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? true),
      { threshold: 0.4 },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  // 자동 회전
  useEffect(() => {
    if (ads.length < 2 || !inView || paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % ads.length), AUTO_ROTATE_MS);
    return () => clearInterval(t);
  }, [ads.length, inView, paused]);

  if (!loaded || ads.length === 0) return null;

  const safeIdx = Math.min(idx, ads.length - 1);
  const current = ads[safeIdx];
  const isTop = position === 'top';

  const handleClick = () => {
    if (!current.linkUrl) return;
    if (current.linkType === 'external') {
      window.open(current.linkUrl, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = current.linkUrl;
    }
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={() => setPaused(true)}
      onPointerDown={() => setPaused(true)}
      className={isTop ? 'mb-0' : 'px-4 pb-5'}
    >
      {/* 광고 카드 */}
      <button
        onClick={handleClick}
        disabled={!current.linkUrl}
        className="w-full block transition active:opacity-90 text-left"
        aria-label={current.title ?? '광고 보기'}
      >
        <div
          className={`relative w-full overflow-hidden ${isTop ? 'rounded-none' : 'rounded-2xl'}`}
          style={{
            aspectRatio: isTop ? '16/9' : '21/9',
            background: isTop ? '#0A0A0F' : 'var(--surface-2)',
          }}
        >
          {/* 배경 이미지 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.imageUrl}
            alt={current.title ?? '광고'}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />

          {/* 상단: 어두운 오버레이 (콘텐츠 구분) */}
          {isTop && (
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.55) 100%)' }}
            />
          )}

          {/* 광고 텍스트 오버레이 (제목/부제 있을 때) */}
          {(current.title || current.subtitle) && (
            <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
              {current.title && (
                <div
                  className="text-[16px] font-extrabold text-white leading-tight"
                  style={{ textShadow: '0 1px 8px rgba(0,0,0,0.60)' }}
                >
                  {current.title}
                </div>
              )}
              {current.subtitle && (
                <div
                  className="text-[12px] mt-1 text-white/80 leading-snug"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.50)' }}
                >
                  {current.subtitle}
                </div>
              )}
            </div>
          )}

          {/* 광고 라벨 — 우상단 */}
          <div className="absolute top-2 right-2 z-10">
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.7)' }}
            >
              광고
            </span>
          </div>
        </div>
      </button>

      {/* 인디케이터 — 2개 이상일 때 */}
      {ads.length > 1 && (
        <div
          className="flex justify-center gap-1.5 mt-2"
          role="tablist"
          aria-label="광고 인디케이터"
        >
          {ads.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === safeIdx}
              aria-label={`${i + 1}번째 광고`}
              onClick={() => { setPaused(true); setIdx(i); }}
              className="flex items-center justify-center"
              style={{ width: 24, height: 20 }}
            >
              <span
                className="block rounded-full transition-all"
                style={{
                  width: i === safeIdx ? 14 : 4,
                  height: 4,
                  background: i === safeIdx ? 'var(--brand)' : 'rgba(255,31,143,0.25)',
                }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
