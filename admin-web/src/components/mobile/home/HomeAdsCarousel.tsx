'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { subscribeHomeAds, type HomeAd } from '@/lib/homeContent';

interface Props {
  position: 'top' | 'bottom';
}

const AUTO_ROTATE_MS = 5000;
const RESUME_DELAY_MS = 5000;

export default function HomeAdsCarousel({ position }: Props) {
  const [ads, setAds] = useState<HomeAd[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = subscribeHomeAds(
      position,
      (data) => {
        // imageUrl 없는 광고는 carousel 노출에서 제외 — <img src=""> 에러 방지
        setAds(data.filter((ad) => !!ad.imageUrl && ad.imageUrl.trim().length > 0));
        setLoaded(true);
      },
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

  // 스크롤로 인디케이터 동기화
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || ads.length < 2) return;

    const handleScroll = () => {
      const cardWidth = el.clientWidth;
      if (cardWidth === 0) return;
      const newIdx = Math.round(el.scrollLeft / cardWidth);
      setActiveIdx(Math.min(newIdx, ads.length - 1));
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [ads.length]);

  // 특정 인덱스로 스크롤
  const scrollTo = useCallback((i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' });
    setActiveIdx(i);
  }, []);

  // 자동 슬라이드
  useEffect(() => {
    if (ads.length < 2 || !inView || paused) return;
    const t = setInterval(() => {
      setActiveIdx((prev) => {
        const next = (prev + 1) % ads.length;
        scrollTo(next);
        return next;
      });
    }, AUTO_ROTATE_MS);
    return () => clearInterval(t);
  }, [ads.length, inView, paused, scrollTo]);

  // 사용자 조작 후 일시 정지 — RESUME_DELAY_MS 뒤 재개
  const handleUserInteraction = useCallback(() => {
    setPaused(true);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setPaused(false), RESUME_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);

  if (!loaded || ads.length === 0) return null;

  const isTop = position === 'top';

  // 모든 광고 카드 클릭은 상세 페이지(/m/ad/[id])로 진입.
  // 상세에서 포스터를 크게 보거나 CTA(linkUrl)를 누르면 외부/내부 이동.
  // — 광고주 입장에선 상세 진입수가 funnel 지표가 되고, 사용자는 포스터를 크게 볼 수 있음.
  const handleAdClick = (ad: HomeAd) => {
    if (!ad.id) return;
    window.location.href = `/m/ad/${ad.id}`;
  };

  // 두 광고(상단/하단) 동일한 카드 스타일 — 좌측 끝선·radius·비율·테두리 통일.
  // 상단만 살짝 어두운 오버레이로 시각적 임팩트 유지.
  return (
    <div ref={containerRef} className="w-full">
      {/* 가로 스크롤 컨테이너 — 카드형, 모서리·테두리·그림자 통일 */}
      <div
        ref={scrollRef}
        className="flex overflow-x-auto scrollbar-none rounded-2xl"
        style={{
          scrollSnapType: 'x mandatory',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-card)',
        }}
        onTouchStart={handleUserInteraction}
        onPointerDown={handleUserInteraction}
        aria-label="광고 슬라이드"
      >
        {ads.map((ad, i) => (
          <button
            key={ad.id ?? i}
            onClick={() => handleAdClick(ad)}
            className="flex-shrink-0 w-full block transition active:opacity-90 text-left"
            style={{ scrollSnapAlign: 'start' }}
            aria-label={ad.title ?? '광고 보기'}
          >
            <div
              className="relative w-full overflow-hidden"
              style={{
                aspectRatio: '16/9',
                background: isTop ? '#0A0A0F' : 'var(--surface-2)',
              }}
            >
              {/* 배경 이미지 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ad.imageUrl}
                alt={ad.title ?? '광고'}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
              />

              {/* 상단: 어두운 오버레이 (텍스트 가독성·임팩트) */}
              {isTop && (
                <div
                  className="absolute inset-0"
                  style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.55) 100%)' }}
                />
              )}

              {/* 광고 텍스트 오버레이 */}
              {(ad.title || ad.subtitle) && (
                <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
                  {ad.title && (
                    <div
                      className="text-[16px] font-extrabold text-white leading-tight"
                      style={{ textShadow: '0 1px 8px rgba(0,0,0,0.60)' }}
                    >
                      {ad.title}
                    </div>
                  )}
                  {ad.subtitle && (
                    <div
                      className="text-[12px] mt-1 text-white/80 leading-snug"
                      style={{ textShadow: '0 1px 4px rgba(0,0,0,0.50)' }}
                    >
                      {ad.subtitle}
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

              {/* 인디케이터 점 — 카드 우하단 (이미지 위) */}
              {ads.length > 1 && (
                <div
                  className="absolute bottom-3 right-3 z-10 flex gap-1"
                  aria-hidden="true"
                >
                  {ads.map((_, dotIdx) => (
                    <span
                      key={dotIdx}
                      className="block rounded-full transition-all duration-200"
                      style={{
                        width: dotIdx === activeIdx ? 14 : 6,
                        height: 6,
                        background: dotIdx === activeIdx
                          ? 'var(--brand)'
                          : 'rgba(255,255,255,0.50)',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
