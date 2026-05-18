'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeActiveNotices, type Notice } from '@/lib/notices';

const DISMISS_STORAGE_KEY = 'holdemnow:noticesDismissedUntil';

interface DismissMap {
  [noticeId: string]: number; // epoch ms — 이 시각까지 노출 안 함
}

function readDismissed(): DismissMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // 만료된 dismiss 자동 제외 — 이후 컴포넌트는 단순히 "키 존재 여부"만 보면 됨.
    const now = Date.now();
    const filtered: DismissMap = {};
    for (const [id, until] of Object.entries(parsed as DismissMap)) {
      if (typeof until === 'number' && until > now) filtered[id] = until;
    }
    return filtered;
  } catch {
    return {};
  }
}

function writeDismissed(map: DismissMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

/**
 * 모바일 진입 시 표시되는 본사 팝업 공지.
 * - 활성 공지가 여러 개면 가로 슬라이드(snap-x snap-mandatory).
 * - 한 공지 안에 이미지가 여러 장이면 공지 내부에서 다시 가로 슬라이드.
 * - "오늘 그만 보기" 시 해당 공지를 24시간 동안 다시 노출하지 않음.
 */
export default function NoticePopup() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<DismissMap>({});

  useEffect(() => {
    const initialDismissed = readDismissed();
    const tid = setTimeout(() => setDismissed(initialDismissed), 0);
    console.log('[NoticePopup] mounted. dismissed keys (still valid):', Object.keys(initialDismissed));
    const unsub = subscribeActiveNotices(
      (items) => {
        console.log('[NoticePopup] active notices received:', items.length, items.map((n) => ({ id: n.id, title: n.title, active: n.active, priority: n.priority })));
        setNotices(items);
      },
      (e) => {
        // 인덱스 누락·권한 문제로 팝업이 안 뜨는 사고를 silent로 묻지 않음.
        console.warn('[NoticePopup] subscribeActiveNotices failed:', e?.message ?? e);
      },
    );
    return () => {
      clearTimeout(tid);
      unsub();
    };
  }, []);

  // readDismissed가 만료된 항목을 이미 필터링하므로, 컴포넌트 본문에서는 키 존재 여부만 본다.
  const visible = notices.filter((n) => !dismissed[n.id]);
  const visibleCount = visible.length;

  useEffect(() => {
    if (notices.length > 0) {
      console.log('[NoticePopup] visibility check:', {
        totalActive: notices.length,
        dismissedCount: notices.filter((n) => dismissed[n.id]).length,
        visibleCount,
      });
    }
  }, [notices, dismissed, visibleCount]);

  useEffect(() => {
    if (visibleCount > 0) {
      const tid = setTimeout(() => setOpen(true), 0);
      return () => clearTimeout(tid);
    }
    if (visibleCount === 0 && open) {
      const tid = setTimeout(() => setOpen(false), 0);
      return () => clearTimeout(tid);
    }
    // open은 의도적으로 dep에서 제외 — 사용자가 직접 닫은 상태 유지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCount]);

  if (!open || visibleCount === 0) return null;

  // 여러 공지 동시 노출 시 가장 큰 사이즈 기준으로 셸을 잡아 가로 슬라이드가 잘리지 않게.
  const sizeRank = { sm: 0, md: 1, lg: 2 } as const;
  const maxSize = visible.reduce<'sm' | 'md' | 'lg'>(
    (acc, n) => (sizeRank[n.size ?? 'md'] > sizeRank[acc] ? (n.size ?? 'md') : acc),
    'sm',
  );
  const maxWClass = maxSize === 'sm' ? 'max-w-xs' : maxSize === 'lg' ? 'max-w-md' : 'max-w-sm';

  const dismissForToday = (noticeId: string) => {
    // event handler — 실행 시점의 절대 시간 사용 (render와 무관).
    // eslint-disable-next-line react-hooks/purity
    const until = Date.now() + 24 * 60 * 60 * 1000;
    const next = { ...readDismissed(), [noticeId]: until };
    writeDismissed(next);
    setDismissed(next);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      {/* 배경 오버레이 탭으로 닫기 */}
      <button
        aria-label="팝업 닫기"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        tabIndex={-1}
      />
      <div className={`relative w-full ${maxWClass} bg-white rounded-2xl overflow-hidden shadow-2xl`}>
        {/* 팝업 핑크 띠 헤더 */}
        <div className="brand-band flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            {/* LIVE 도트 (공지 = 긴급 정보 신호) */}
            <span className="w-2 h-2 rounded-full bg-white pulse-live flex-shrink-0" aria-hidden="true" />
            <span className="text-[13px] font-extrabold tracking-tight text-white">공지사항</span>
            {visible.length > 1 && (
              <span className="text-[10px] font-bold bg-white/25 rounded-full px-2 py-0.5 text-white">
                {visible.length}건
              </span>
            )}
          </div>
          <button
            aria-label="닫기"
            onClick={() => setOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-white/20 text-white transition active:bg-white/30"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* 공지 슬라이드 (여러 공지) */}
        <div className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none">
          {visible.map((notice) => (
            <NoticeCard
              key={notice.id}
              notice={notice}
              onDismissToday={() => dismissForToday(notice.id)}
              onClose={() => setOpen(false)}
              totalCount={visible.length}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function NoticeCard({
  notice,
  onDismissToday,
  onClose,
  totalCount,
}: {
  notice: Notice;
  onDismissToday: () => void;
  onClose: () => void;
  totalCount: number;
}) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const photoScrollRef = useRef<HTMLDivElement | null>(null);

  // 이미지 스크롤 시 인덱스 동기화
  useEffect(() => {
    const el = photoScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      setPhotoIdx(idx);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const openLink = () => {
    if (!notice.linkUrl) return;
    window.open(notice.linkUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="w-full flex-shrink-0 snap-center flex flex-col">
      {/* 이미지 슬라이드 (단일 공지 내부) */}
      {notice.imageUrls.length > 0 && (
        <div className="relative">
          <div
            ref={photoScrollRef}
            className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none"
            style={{ aspectRatio: '4/5' }}
          >
            {notice.imageUrls.map((url, i) => (
              <button
                key={url}
                onClick={openLink}
                className="w-full flex-shrink-0 snap-center bg-gray-900"
                disabled={!notice.linkUrl}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`${notice.title} ${i + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
          {notice.imageUrls.length > 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[10px] font-bold rounded-full px-2.5 py-1 backdrop-blur">
              {photoIdx + 1} / {notice.imageUrls.length}
            </div>
          )}
        </div>
      )}

      {/* 제목 + 본문 — 이미지만 있는 공지는 이 영역 전체 생략 */}
      {(notice.title || notice.body || notice.linkUrl || totalCount > 1) && (
        <div className="px-5 py-4 flex-1">
          {notice.title && (
            <div className="font-extrabold text-lg text-gray-900 mb-2">{notice.title}</div>
          )}
          {notice.body && (
            <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {notice.body}
            </div>
          )}
          {notice.linkUrl && (
            <button
              onClick={openLink}
              className="mt-3 text-xs font-bold text-blue-600 active:text-blue-800"
            >
              자세히 보기 ›
            </button>
          )}
          {totalCount > 1 && (
            <div className="mt-3 text-[11px] text-gray-400 text-center">
              ← 옆으로 넘겨 다음 공지 확인 →
            </div>
          )}
        </div>
      )}

      {/* 하단 액션 */}
      <div className="flex border-t border-gray-100">
        <button
          onClick={onDismissToday}
          className="flex-1 py-3.5 text-xs font-bold text-gray-500 active:bg-gray-50"
        >
          오늘 그만 보기
        </button>
        <div className="w-px bg-gray-100" />
        <button
          onClick={onClose}
          className="flex-1 py-3.5 text-xs font-extrabold text-gray-900 active:bg-gray-50"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
