'use client';

/**
 * 인앱 캠페인 상세 페이지 — /m/campaigns/[campaignId]
 *
 * 본사가 발송한 마케팅 푸시 알림을 클릭했을 때 진입하는 공개 랜딩.
 * - 비로그인도 접근 가능 (rules에서 sent/sending 상태는 누구나 read 허용).
 * - linkUrl이 자기 자신(/m/campaigns/{id})이면 CTA 숨김.
 * - linkUrl이 외부(http(s)://)면 새 창, 인앱(/m/...) 경로면 Link.
 * - cancelled / failed 등 비공개 상태는 "더 이상 유효하지 않음" 안내.
 *
 * 풀스크린 페이지 — 모바일 layout의 isFullscreen 분기에 포함되어 하단 탭바 숨김.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { type Campaign } from '@/lib/campaigns';
import { shareContent } from '@/lib/actions';

export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const router = useRouter();
  // undefined = 로딩, null = 없음, Campaign = 정상
  const [campaign, setCampaign] = useState<Campaign | null | undefined>(undefined);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'platformCampaigns', campaignId),
      (snap) => {
        if (!snap.exists()) {
          setCampaign(null);
          return;
        }
        setCampaign({ id: snap.id, ...(snap.data() as Omit<Campaign, 'id'>) });
      },
      () => setCampaign(null),
    );
    return unsub;
  }, [campaignId]);

  if (campaign === undefined) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">
        불러오는 중…
      </div>
    );
  }

  if (campaign === null) {
    return (
      <div className="p-10 text-center">
        <div className="text-4xl mb-3">📭</div>
        <div className="font-bold mb-2">공지를 찾을 수 없습니다</div>
        <div className="text-xs text-gray-500 mb-4">
          이미 삭제되었거나 잘못된 링크일 수 있어요.
        </div>
        <button
          onClick={() => router.replace('/m')}
          className="text-xs text-gray-500 underline"
        >
          홈으로 가기
        </button>
      </div>
    );
  }

  // 비공개 상태 (draft/scheduled는 rules에서 차단되어 도달 불가지만, cancelled/failed는 도달 후 안내)
  const isPublic =
    campaign.status === 'sent' || campaign.status === 'sending';

  // 발송 시각: sentAt 우선, 없으면 createdAt
  const ts = campaign.sentAt ?? campaign.createdAt ?? null;
  const relTime = ts ? formatRelativeTime(ts.toMillis()) : '';
  const absTime = ts ? formatDateTime(ts.toMillis()) : '';

  // CTA 표시 여부: linkUrl 존재 + 자기 자신 self-reference 아님
  const linkUrl = campaign.linkUrl?.trim() || '';
  const isSelfReference =
    linkUrl === `/m/campaigns/${campaignId}` ||
    linkUrl.endsWith(`/m/campaigns/${campaignId}`);
  const isExternal = /^https?:\/\//i.test(linkUrl);
  const isInApp = linkUrl.startsWith('/');
  const showCta = !!linkUrl && !isSelfReference && (isExternal || isInApp);

  return (
    <div className="min-h-screen bg-white pb-24">
      {/* 상단 헤더 */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 h-14 flex items-center justify-between border-b border-gray-100">
        <button
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.replace('/m');
          }}
          className="text-xl w-10 h-10 -ml-2 flex items-center justify-center"
          aria-label="뒤로"
        >
          ←
        </button>
        <div className="text-xs font-bold text-gray-500">본사 공지</div>
        <button
          onClick={() =>
            shareContent({
              title: campaign.title,
              text: campaign.body.slice(0, 80),
            })
          }
          className="text-lg w-10 h-10 -mr-2 flex items-center justify-center"
          style={{ color: '#E01077' }}
          aria-label="공유"
        >
          ↗
        </button>
      </div>

      {/* 비공개 상태 (cancelled / failed) 안내 */}
      {!isPublic && (
        <div className="mx-4 mt-4 p-4 bg-gray-50 border border-gray-200 rounded-xl text-center">
          <div className="text-2xl mb-2">⚠️</div>
          <div className="text-sm font-bold text-gray-700 mb-1">
            이 공지는 더 이상 유효하지 않습니다
          </div>
          <div className="text-[11px] text-gray-500">
            취소되었거나 발송에 실패한 공지입니다.
          </div>
        </div>
      )}

      {/* 이미지 (16:9) */}
      {campaign.imageUrl && isPublic && (
        <div
          className="w-full bg-gray-100 relative"
          style={{ aspectRatio: '16 / 9' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={campaign.imageUrl}
            alt={campaign.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* 본문 */}
      {isPublic && (
        <div className="px-5 py-5">
          {/* (광고) 칩 */}
          {campaign.isAdvertisement && (
            <div className="mb-3">
              <span className="inline-block bg-gray-100 text-gray-500 text-[10px] font-bold rounded-full px-2.5 py-1 tracking-wider">
                (광고)
              </span>
            </div>
          )}

          {/* 이미지 없을 때 작은 아이콘 */}
          {!campaign.imageUrl && (
            <div className="text-2xl mb-2" aria-hidden="true">
              📢
            </div>
          )}

          {/* 제목 */}
          <h1 className="text-xl font-extrabold tracking-tight text-gray-900 leading-snug">
            {campaign.title}
          </h1>

          {/* 발송 시각 */}
          {ts && (
            <div
              className="text-xs text-gray-500 mt-2"
              title={absTime}
            >
              {absTime} · {relTime}
            </div>
          )}

          {/* 본문 */}
          <div className="text-[15px] text-gray-800 leading-relaxed whitespace-pre-wrap mt-4">
            {campaign.body}
          </div>

          {/* CTA: "자세히 보기" */}
          {showCta && (
            <div className="mt-6">
              {isExternal ? (
                <a
                  href={linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-3.5 rounded-xl font-bold text-sm text-center text-white transition-all active:scale-[0.98]"
                  style={{ background: '#E01077' }}
                >
                  자세히 보기 →
                </a>
              ) : (
                <Link
                  href={linkUrl}
                  className="block w-full py-3.5 rounded-xl font-bold text-sm text-center text-white transition-all active:scale-[0.98]"
                  style={{ background: '#E01077' }}
                >
                  자세히 보기 →
                </Link>
              )}
              {isExternal && (
                <div className="text-[10px] text-gray-400 text-center mt-2">
                  외부 페이지로 이동
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 광고 안내 푸터 */}
      {isPublic && campaign.isAdvertisement && (
        <div className="px-5 py-4 mt-2 border-t border-gray-100">
          <div className="text-[10px] text-gray-400 leading-relaxed">
            이 공지는 본사가 발송한 광고성 정보입니다. 수신을 원하지 않으시면
            <Link href="/m/my" className="underline ml-1">
              내정보 &gt; 알림 설정
            </Link>
            에서 변경할 수 있습니다.
          </div>
        </div>
      )}

      {/* 푸터 */}
      <div className="px-5 py-8 text-center text-[10px] text-gray-400">
        Pink Rabbit · 본사 공지
      </div>
    </div>
  );
}

/* ============================================================
 * 시각 포맷 헬퍼
 * ========================================================== */

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}주 전`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
}
