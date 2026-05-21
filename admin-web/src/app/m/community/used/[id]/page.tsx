'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type UsedListing,
  USED_CATEGORY_LABELS,
  USED_CONDITION_LABELS,
  DEAL_STATUS_LABELS,
  formatUsedPrice,
  formatRelativeTime,
  subscribeUsedListing,
} from '@/lib/community';

/* ============================================================
 * /m/community/used/[id] — 중고거래 상세
 * 이미지 갤러리 + 본문 + 매장 헤더 + 면책 배너 + 연락 CTA
 * 권한: 열람 = 누구나
 * ========================================================== */

function daysLeft(expiresAt?: string | Date): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
}

export default function UsedDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [item, setItem] = useState<UsedListing | null | undefined>(undefined);
  const [photoIndex, setPhotoIndex] = useState(0);

  useEffect(() => {
    const unsub = subscribeUsedListing(
      id,
      (it) => setItem(it),
      () => setItem(null),
    );
    return unsub;
  }, [id]);

  if (item === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>불러오는 중…</div>
      </div>
    );
  }

  if (item === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center" style={{ background: 'var(--bg)' }}>
        <div className="text-5xl mb-4" aria-hidden="true">🛒</div>
        <p className="text-[16px] font-bold mb-2" style={{ color: 'var(--text-1)' }}>글을 찾을 수 없습니다</p>
        <button onClick={() => router.back()} className="mt-4 text-[13px] font-bold" style={{ color: '#FF1F8F' }}>
          돌아가기
        </button>
      </div>
    );
  }

  const images = item.images ?? [];
  const expired = daysLeft(item.expiresAt) === 0;
  const isSold = item.dealStatus === 'sold';
  const isReserved = item.dealStatus === 'reserved';
  const dimmed = expired || isSold;
  const hasKakao = !!item.contact?.kakaoOpenChat;
  const hasPhone = !!item.contact?.phone;

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* ── 헤더 ── */}
      <header
        className="sticky top-0 z-30 flex items-center h-14 px-4 gap-3"
        style={{
          background: 'rgba(255,255,255,0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          className="w-9 h-9 flex items-center justify-center rounded-full transition active:bg-[var(--surface-2)] flex-shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <h1 className="flex-1 text-center text-[17px] font-extrabold tracking-tight line-clamp-1" style={{ color: 'var(--text-1)' }}>
          중고거래
        </h1>
        <div className="w-9 h-9 flex-shrink-0" aria-hidden="true" />
      </header>

      <div className="pb-36">
        {/* ── 이미지 갤러리 ── */}
        <div
          className="relative w-full bg-black"
          style={{ aspectRatio: '4/3' }}
        >
          {images.length > 0 ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={images[photoIndex]}
                alt={`${item.title} 사진 ${photoIndex + 1}`}
                className="w-full h-full object-contain"
                style={{ filter: dimmed ? 'grayscale(0.7) brightness(0.8)' : 'none' }}
              />
              {/* 이미지 인디케이터 */}
              {images.length > 1 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setPhotoIndex(i)}
                      aria-label={`사진 ${i + 1}`}
                      className="rounded-full transition"
                      style={{
                        width: i === photoIndex ? 20 : 6,
                        height: 6,
                        background: i === photoIndex ? '#FF1F8F' : 'rgba(255,255,255,0.60)',
                      }}
                    />
                  ))}
                </div>
              )}
              {/* 좌우 스와이프 버튼 */}
              {images.length > 1 && (
                <>
                  {photoIndex > 0 && (
                    <button
                      onClick={() => setPhotoIndex((p) => p - 1)}
                      aria-label="이전 사진"
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.40)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M15 18l-6-6 6-6"/>
                      </svg>
                    </button>
                  )}
                  {photoIndex < images.length - 1 && (
                    <button
                      onClick={() => setPhotoIndex((p) => p + 1)}
                      aria-label="다음 사진"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.40)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 18l6-6-6-6"/>
                      </svg>
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl" aria-hidden="true">
              {item.category === 'chip' ? '🪙' : item.category === 'card' ? '🃏' : item.category === 'timer' ? '⏱' : '📦'}
            </div>
          )}

          {/* 만료/판매완료 오버레이 */}
          {dimmed && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span
                className="text-white text-[14px] font-extrabold px-4 py-2 rounded-full"
                style={{ background: 'rgba(0,0,0,0.55)' }}
              >
                {isSold ? '판매완료' : '기간만료'}
              </span>
            </div>
          )}
        </div>

        {/* ── 매장 헤더 ── */}
        {item.storeId && (
          <Link
            href={`/m/store/${item.storeId}`}
            className="flex items-center gap-3 px-4 py-3 transition active:bg-[var(--surface-2)]"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 overflow-hidden"
              style={{ background: 'var(--surface-2)' }}
            >
              {item.storePhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.storePhotoUrl} alt={item.storeName ?? ''} className="w-full h-full object-cover" />
              ) : (
                <span aria-hidden="true">🏠</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                {item.storeName ?? '매장'}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>매장 페이지 보기</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </Link>
        )}

        {/* ── 핵심 정보 ── */}
        <div className="px-4 pt-4 pb-4" style={{ borderBottom: '6px solid var(--surface-2)' }}>
          {/* 카테고리 + 상태 배지 */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
            >
              {USED_CATEGORY_LABELS[item.category]}
            </span>
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={
                isSold
                  ? { background: '#F3F4F6', color: '#9CA3AF' }
                  : isReserved
                  ? { background: 'rgba(251,191,36,0.15)', color: '#B45309' }
                  : expired
                  ? { background: '#F3F4F6', color: '#9CA3AF' }
                  : { background: 'rgba(255,31,143,0.10)', color: '#FF1F8F' }
              }
            >
              {expired ? '기간만료' : DEAL_STATUS_LABELS[item.dealStatus]}
            </span>
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
            >
              {USED_CONDITION_LABELS[item.condition]}
            </span>
          </div>

          <h2 className="text-[19px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
            {item.title}
          </h2>

          {/* 가격 */}
          <div className="text-[24px] font-extrabold mt-2 stat-number" style={{ color: dimmed ? 'var(--text-3)' : '#FF1F8F' }}>
            {formatUsedPrice(item.price, item.priceNegotiable)}
          </div>

          {/* 지역 + 등록일 + 만료일 */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {item.region && (
              <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                {item.region}
              </span>
            )}
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {formatRelativeTime(item.createdAt)} 등록
            </span>
            {item.expiresAt && !expired && (
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                · {daysLeft(item.expiresAt)}일 후 만료
              </span>
            )}
          </div>
        </div>

        {/* ── 상품 설명 ── */}
        {item.body && (
          <div className="px-4 py-5" style={{ borderBottom: '6px solid var(--surface-2)' }}>
            <h3 className="text-[13px] font-extrabold mb-3" style={{ color: 'var(--text-3)' }}>상품 설명</h3>
            <p
              className="text-[14px] leading-loose whitespace-pre-wrap"
              style={{ color: 'var(--text-1)' }}
            >
              {item.body}
            </p>
          </div>
        )}

        {/* ── 거래 면책 배너 ── */}
        <div
          className="mx-4 mt-4 px-4 py-3 rounded-xl text-[12px] leading-relaxed"
          style={{
            background: 'var(--surface-2)',
            color: 'var(--text-3)',
            border: '1px solid var(--border)',
          }}
          role="note"
          aria-label="거래 안내"
        >
          Pink Rabbit는 판매자와 구매자의 만남을 주선합니다. 실제 거래 및 배송 책임은 거래 당사자에게 있습니다.
        </div>
      </div>

      {/* ── 하단 고정 CTA ── */}
      {(hasKakao || hasPhone) && !dimmed && (
        <div
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-30 px-4 pb-6 pt-3"
          style={{ background: 'linear-gradient(to top, var(--bg) 80%, transparent 100%)' }}
        >
          <div className="flex gap-2">
            {hasKakao && (
              <a
                href={item.contact!.kakaoOpenChat!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl text-[14px] font-bold transition active:opacity-75"
                style={{ background: '#FEE500', color: '#191919' }}
                aria-label="카카오 오픈채팅으로 연락"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 3C6.477 3 2 6.58 2 11c0 2.75 1.57 5.17 3.97 6.67L5 21l3.32-1.77C9.39 19.72 10.67 20 12 20c5.523 0 10-3.58 10-9s-4.477-8-10-8z"/>
                </svg>
                카카오로 문의
              </a>
            )}
            {hasPhone && (
              <a
                href={`tel:${item.contact!.phone}`}
                className="flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl text-[14px] font-bold transition active:opacity-75"
                style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
                aria-label={`전화 ${item.contact!.phone}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.7A2 2 0 012.18 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.15a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                </svg>
                전화 문의
              </a>
            )}
          </div>
        </div>
      )}

      {/* 판매완료/만료 시 CTA 대체 안내 */}
      {dimmed && (
        <div
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-30 px-4 pb-6 pt-3"
          style={{ background: 'linear-gradient(to top, var(--bg) 80%, transparent 100%)' }}
        >
          <div
            className="w-full h-12 flex items-center justify-center rounded-2xl text-[14px] font-bold"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
          >
            {isSold ? '판매가 완료된 상품입니다' : '기간이 만료된 게시글입니다'}
          </div>
        </div>
      )}
    </div>
  );
}
