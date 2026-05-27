'use client';

/**
 * SponsoredSplash — 본사 등록 풀스크린 스플래시 광고
 *
 * 동작:
 *  - /m 앱 진입 시 1회 mount (MobileLayout 최상단).
 *  - sessionStorage 키 'pr:splashAdShown'으로 세션당 1회만 노출 (페이지 이동 시 재노출 방지).
 *  - 마운트 즉시 pickActiveSplashAd() — 활성 광고 없으면 즉시 dismiss (UI 비표시).
 *  - skipAfterMs 후 "건너뛰기" 버튼 노출, displayDurationMs 후 자동 dismiss.
 *  - 이미지 클릭 시 linkUrl 이동 (있을 때) + clicks++.
 *  - 노출되는 순간 impressions++.
 *
 * 정책:
 *  - 광고 라벨("광고")은 항상 강제 노출 — 공정거래위 가이드.
 *  - 광고 0건이면 절대 UI 노출 안 함 — 기본 AppSplash 동작 100% 유지.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  bumpSplashAdClick,
  bumpSplashAdImpression,
  pickActiveSplashAd,
  type SplashAd,
} from '@/lib/splashAds';

const SESSION_KEY = 'pr:splashAdShown';

export default function SponsoredSplash() {
  const router = useRouter();
  const [ad, setAd] = useState<SplashAd | null>(null);
  const [skipReady, setSkipReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const impressionFiredRef = useRef(false);

  // 세션 1회 — mount 시 즉시 결정
  useEffect(() => {
    // SSR 안전
    if (typeof window === 'undefined') return;
    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === '1') {
        setDismissed(true);
        return;
      }
    } catch {
      // sessionStorage 차단 환경 — 그냥 진행 (한 번 보고 끝)
    }

    let cancelled = false;
    (async () => {
      const picked = await pickActiveSplashAd();
      if (cancelled) return;
      if (!picked) {
        setDismissed(true);
        try { window.sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
        return;
      }
      setAd(picked);
      try { window.sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
    })();

    return () => { cancelled = true; };
  }, []);

  // 노출 시 impression + 타이머 설정
  useEffect(() => {
    if (!ad || dismissed) return;

    if (!impressionFiredRef.current) {
      impressionFiredRef.current = true;
      bumpSplashAdImpression(ad.id).catch(() => { /* ignore */ });
    }

    const skipAt = Math.max(0, ad.skipAfterMs ?? 1500);
    const dismissAt = Math.max(skipAt + 500, ad.displayDurationMs ?? 3000);

    const skipTimer = window.setTimeout(() => setSkipReady(true), skipAt);
    const dismissTimer = window.setTimeout(() => setDismissed(true), dismissAt);

    return () => {
      window.clearTimeout(skipTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [ad, dismissed]);

  if (!ad || dismissed) return null;

  const handleClick = () => {
    if (!ad.linkUrl) return;
    bumpSplashAdClick(ad.id).catch(() => { /* ignore */ });
    setDismissed(true);
    // 외부 URL은 새 창, 내부는 SPA navigate
    if (/^https?:\/\//i.test(ad.linkUrl)) {
      window.open(ad.linkUrl, '_blank', 'noopener,noreferrer');
    } else {
      router.push(ad.linkUrl);
    }
  };

  const handleSkip = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
  };

  const label = ad.sponsoredLabel?.trim() || '광고';
  const clickable = !!ad.linkUrl;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ background: '#000' }}
      aria-busy="true"
      aria-label="스플래시 광고"
      role="dialog"
    >
      {/* 광고 이미지 (풀스크린) */}
      <button
        type="button"
        onClick={clickable ? handleClick : undefined}
        className="absolute inset-0 w-full h-full"
        style={{
          padding: 0,
          border: 'none',
          background: '#000',
          cursor: clickable ? 'pointer' : 'default',
        }}
        aria-label={clickable ? `${ad.title} — 자세히 보기` : ad.title}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ad.imageUrl}
          alt={ad.title}
          className="w-full h-full"
          style={{
            objectFit: 'cover',
            objectPosition: 'center',
            animation: 'sponsoredSplashFadeIn .25s ease-out',
          }}
        />
      </button>

      {/* 광고 라벨 (좌상단) — 공정거래위 가이드 */}
      <div
        aria-hidden
        className="absolute top-3 left-3 pointer-events-none"
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.08em',
          color: '#fff',
          background: 'rgba(0,0,0,0.55)',
          padding: '3px 8px',
          borderRadius: 4,
        }}
      >
        {label}
      </div>

      {/* 건너뛰기 (우상단) — skipAfterMs 이후 활성 */}
      <button
        type="button"
        onClick={handleSkip}
        disabled={!skipReady}
        className="absolute top-3 right-3"
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#fff',
          background: skipReady ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.35)',
          padding: '6px 12px',
          borderRadius: 999,
          opacity: skipReady ? 1 : 0.55,
          cursor: skipReady ? 'pointer' : 'default',
          transition: 'opacity .2s, background .2s',
        }}
        aria-label="광고 건너뛰기"
      >
        건너뛰기
      </button>

      <style>{`
        @keyframes sponsoredSplashFadeIn {
          from { opacity: 0.6; transform: scale(1.02); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
