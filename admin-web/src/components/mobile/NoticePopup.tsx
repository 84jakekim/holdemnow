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
    const tid = setTimeout(() => setDismissed(readDismissed()), 0);
    const unsub = subscribeActiveNotices(
      (items) => setNotices(items),
      () => {},
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
      <button
        aria-label="닫기"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-2xl">
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

      {/* 제목 + 본문 */}
      <div className="px-5 py-4 flex-1">
        <div className="font-extrabold text-lg text-gray-900 mb-2">{notice.title}</div>
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
