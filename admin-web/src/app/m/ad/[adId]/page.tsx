'use client';

/**
 * /m/ad/[adId] — 홈 광고(homeAds) 상세 페이지
 *
 * 홈 광고 캐러셀 카드 탭 → 진입.
 * - 풀스크린(탭바 숨김 — m/layout의 isFullscreen 분기)
 * - 포스터(이미지) 16:9 + 16:9 클릭 시 풀스크린 뷰어로 확대
 * - title / subtitle 노출
 * - linkUrl 있으면 CTA 버튼 (linkType=external은 새창, 그 외 same tab)
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { HomeAd } from '@/lib/homeContent';
import BlockedContentNotice from '@/components/mobile/BlockedContentNotice';

export default function AdDetailPage({
  params,
}: {
  params: Promise<{ adId: string }>;
}) {
  const { adId } = use(params);
  const [ad, setAd] = useState<HomeAd | null | undefined>(undefined);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'homeAds', adId),
      (snap) => {
        if (!snap.exists()) {
          setAd(null);
          return;
        }
        setAd({ id: snap.id, ...(snap.data() as Omit<HomeAd, 'id'>) });
      },
      () => setAd(null),
    );
    return unsub;
  }, [adId]);

  if (ad === undefined) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      </main>
    );
  }

  if (ad === null) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-10" style={{ background: 'var(--bg)' }}>
        <div className="text-4xl">📢</div>
        <div className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>광고를 찾을 수 없습니다</div>
        <Link
          href="/m"
          className="text-sm px-4 py-2 rounded-xl font-semibold mt-2"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          홈으로
        </Link>
      </main>
    );
  }

  const openCta = () => {
    if (!ad.linkUrl) return;
    if (ad.linkType === 'external') {
      window.open(ad.linkUrl, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = ad.linkUrl;
    }
  };

  const now = Date.now();
  const startMs = ad.startAt?.toMillis() ?? 0;
  const endMs = ad.endAt?.toMillis() ?? Infinity;
  const isInRange = now >= startMs && now <= endMs;
  const isInactive = !ad.isActive || !isInRange;

  // 비활성 / 기간 종료 광고 — 일반 사용자 직접 URL 진입 방어
  if (isInactive) {
    return (
      <BlockedContentNotice
        title="종료된 광고입니다"
        description="본사가 광고를 종료했거나 노출 기간이 지났습니다."
        backHref="/m"
        backLabel="홈으로"
      />
    );
  }

  return (
    <main style={{ background: 'var(--bg)', minHeight: '100vh', paddingBottom: 40 }}>
      {/* 헤더 */}
      <header
        className="sticky top-0 z-20 px-4 h-12 flex items-center justify-between"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <Link href="/m" aria-label="뒤로" className="text-xl px-1" style={{ color: 'var(--text-1)' }}>
          ←
        </Link>
        <span className="text-[13px] font-extrabold" style={{ color: 'var(--text-1)' }}>광고</span>
        <div className="w-6" />
      </header>

      {isInactive && (
        <div
          className="mx-4 mt-3 px-3 py-2 text-[11px] font-bold rounded-lg"
          style={{ background: 'rgba(245,158,11,0.10)', color: 'var(--gold)', border: '1px solid rgba(245,158,11,0.30)' }}
        >
          ⚠️ 종료/비활성 상태인 광고입니다 (사용자 홈에 노출되지 않음)
        </div>
      )}

      {/* 포스터 — 클릭 시 풀스크린 뷰어 */}
      {ad.imageUrl && (
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="block w-full rounded-2xl overflow-hidden active:opacity-90"
            style={{ background: 'var(--surface-2)', aspectRatio: '16/9' }}
            aria-label="포스터 크게 보기"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ad.imageUrl} alt={ad.title ?? '광고 포스터'} className="w-full h-full object-cover" />
          </button>
          <div className="text-[11px] mt-1.5 text-center" style={{ color: 'var(--text-3)' }}>
            포스터를 탭하면 크게 볼 수 있어요
          </div>
        </div>
      )}

      {/* 제목·소제목·상세설명 */}
      <div className="px-5 py-5">
        {ad.title && (
          <div className="text-[20px] font-extrabold leading-snug mb-2" style={{ color: 'var(--text-1)' }}>
            {ad.title}
          </div>
        )}
        {ad.subtitle && (
          <div
            className="text-[14px] leading-relaxed whitespace-pre-wrap mb-3"
            style={{ color: 'var(--text-2)' }}
          >
            {ad.subtitle}
          </div>
        )}
        {ad.description && (
          <div
            className="text-[14px] leading-relaxed whitespace-pre-wrap"
            style={{ color: 'var(--text-2)' }}
          >
            {ad.description}
          </div>
        )}
      </div>

      {/* CTA */}
      {ad.linkUrl && (
        <div className="px-5 pb-2">
          <button
            onClick={openCta}
            className="w-full py-3.5 rounded-xl font-extrabold text-sm text-white"
            style={{
              background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand-dim) 100%)',
              boxShadow: '0 2px 12px rgba(255,31,143,0.25)',
            }}
          >
            자세히 보기 ›
          </button>
          <div className="mt-2 text-[10px] text-center" style={{ color: 'var(--text-3)' }}>
            {ad.linkType === 'external' ? '외부 사이트로 이동' : '앱 내 이동'}
          </div>
        </div>
      )}

      {/* 풀스크린 뷰어 */}
      {zoom && ad.imageUrl && (
        <div
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.95)' }}
          role="dialog"
          aria-label="포스터 크게 보기"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ad.imageUrl}
            alt={ad.title ?? '광고 포스터'}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setZoom(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center text-white text-xl font-bold"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            aria-label="닫기"
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}
