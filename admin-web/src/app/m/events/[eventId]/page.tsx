'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  subscribeEvent,
  type EventDoc,
  EVENT_CATEGORY_LABEL,
  EVENT_STATUS_LABEL,
  formatEventDateRange,
  daysFromNow,
} from '@/lib/events';
import { callPhone, openDirections, shareContent } from '@/lib/actions';
import { loadKakaoMaps } from '@/lib/kakao';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const router = useRouter();
  const [event, setEvent] = useState<EventDoc | null | undefined>(undefined);

  useEffect(() => {
    const unsub = subscribeEvent(eventId, setEvent, () => setEvent(null));
    return unsub;
  }, [eventId]);

  if (event === undefined) {
    return <div className="p-10 text-center text-sm text-gray-500">로딩 중…</div>;
  }
  if (event === null) {
    return (
      <div className="p-10 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <div className="font-bold mb-2">대회를 찾을 수 없습니다</div>
        <button onClick={() => router.replace('/m/events')} className="text-xs text-gray-500 underline">
          대회 목록으로
        </button>
      </div>
    );
  }

  const d = daysFromNow(event.startDate);

  return (
    <div className="pb-24">
      {/* 상단 */}
      <div className="sticky top-0 z-10 bg-white px-5 h-14 flex items-center justify-between border-b border-gray-100">
        <Link href="/m/events" className="text-xl">←</Link>
        <div className="text-xs font-bold text-gray-500">대회 정보</div>
        <button
          onClick={() => shareContent({ title: event.name, text: `${event.name} · ${formatEventDateRange(event.startDate, event.endDate)}` })}
          className="text-lg"
          title="공유"
        >
          ↗
        </button>
      </div>

      {/* 포스터 */}
      <div className="bg-gray-100 relative" style={{ aspectRatio: '3 / 4', maxHeight: '70vh' }}>
        {event.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.posterUrl} alt={event.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-amber-100 via-yellow-50 to-amber-200 flex items-center justify-center">
            <span className="text-7xl opacity-40">🏆</span>
          </div>
        )}
        {/* 상태 배지 */}
        <div className="absolute top-4 left-4 flex items-center gap-1.5 flex-wrap max-w-[80%]">
          <span className="bg-black/60 backdrop-blur text-white text-[10px] font-bold rounded-full px-2.5 py-1">
            {EVENT_CATEGORY_LABEL[event.category]}
          </span>
          {event.city && (
            <span className="bg-blue-500/90 backdrop-blur text-white text-[10px] font-bold rounded-full px-2.5 py-1">
              📍 {event.city}
            </span>
          )}
          {event.status === 'upcoming' && d > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-extrabold rounded-full px-2.5 py-1">
              D-{d}
            </span>
          )}
          {event.status === 'ongoing' && (
            <span className="bg-green-500 text-white text-[10px] font-extrabold rounded-full px-2.5 py-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              진행 중
            </span>
          )}
          {event.status === 'completed' && (
            <span className="bg-gray-500 text-white text-[10px] font-bold rounded-full px-2.5 py-1">
              종료
            </span>
          )}
          {event.status === 'cancelled' && (
            <span className="bg-red-700 text-white text-[10px] font-bold rounded-full px-2.5 py-1">
              취소
            </span>
          )}
        </div>
      </div>

      {/* 제목 + 주최 */}
      <div className="px-5 py-4 border-b-[6px] border-gray-50">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 font-serif leading-tight">
          {event.name}
        </h1>
        {event.shortName && event.shortName !== event.name && (
          <div className="text-xs text-gray-500 mt-1">{event.shortName}</div>
        )}
        {event.organizerName && (
          <div className="text-xs text-gray-600 mt-2 flex items-center gap-1">
            🏢 <span className="font-bold">{event.organizerName}</span>
            {event.isPlatformPosted && <span className="text-[10px] text-gray-400">(본사 큐레이션)</span>}
          </div>
        )}
        {event.description && (
          <div className="text-sm text-gray-700 mt-3 leading-relaxed whitespace-pre-wrap">
            {event.description}
          </div>
        )}
      </div>

      {/* 핵심 정보 */}
      <div className="px-5 py-4 grid grid-cols-2 gap-3 border-b-[6px] border-gray-50">
        <InfoCell label="일정" value={formatEventDateRange(event.startDate, event.endDate)} />
        <InfoCell label="상태" value={EVENT_STATUS_LABEL[event.status]} />
        {event.buyIn != null && event.buyIn > 0 && (
          <InfoCell label="바이인" value={`₩${event.buyIn.toLocaleString()}`} />
        )}
        {/* 개런티/총상금 표기 제거 — 법적 리스크 (현금 상금 노출 금지) */}
        {event.expectedPlayers != null && event.expectedPlayers > 0 && (
          <InfoCell label="예상 인원" value={`${event.expectedPlayers.toLocaleString()}명`} />
        )}
        {event.registrationDeadline && (
          <InfoCell
            label="등록 마감"
            value={formatEventDateRange(event.registrationDeadline)}
          />
        )}
      </div>

      {/* 등록 CTA */}
      {event.registrationUrl && event.status !== 'completed' && (
        <div className="px-5 py-4 border-b-[6px] border-gray-50">
          <a
            href={event.registrationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-black text-white py-3.5 rounded-xl font-bold text-sm text-center"
          >
            🎟 대회 등록하기
          </a>
          <div className="text-[10px] text-gray-400 text-center mt-2">외부 페이지로 이동</div>
        </div>
      )}

      {/* 장소 + 지도 */}
      {(event.venueName || event.venueAddress) && (
        <div className="px-5 py-4 border-b-[6px] border-gray-50">
          <div className="text-xs font-bold text-gray-500 tracking-wider mb-2">📍 대회장</div>
          {event.venueName && (
            <div className="text-base font-bold text-gray-900">{event.venueName}</div>
          )}
          {event.venueAddress && (
            <div className="text-sm text-gray-600 mt-0.5">{event.venueAddress}</div>
          )}
          {event.lat != null && event.lng != null && (
            <VenueMap lat={event.lat} lng={event.lng} name={event.venueName ?? event.name} />
          )}
          {event.venueAddress && (
            <button
              onClick={() => openDirections(event.venueName ?? event.name, event.venueAddress)}
              className="mt-3 w-full bg-white border-[1.5px] border-gray-200 text-gray-900 py-2.5 rounded-xl font-bold text-sm hover:bg-gray-50"
            >
              🗺 카카오맵으로 길찾기
            </button>
          )}
        </div>
      )}

      {/* 담당자 */}
      {(event.contactName || event.contactPhone || event.contactEmail) && (
        <div className="px-5 py-4 border-b-[6px] border-gray-50">
          <div className="text-xs font-bold text-gray-500 tracking-wider mb-2">👤 대회 담당자</div>
          {event.contactName && (
            <div className="text-base font-bold text-gray-900">{event.contactName}</div>
          )}
          <div className="mt-2 space-y-1.5">
            {event.contactPhone && (
              <button
                onClick={() => callPhone(event.contactPhone)}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2"
              >
                📞 {event.contactPhone}
              </button>
            )}
            {event.contactEmail && (
              <a
                href={`mailto:${event.contactEmail}`}
                className="block w-full bg-gray-100 hover:bg-gray-200 text-gray-900 py-2.5 rounded-lg text-sm font-bold text-center"
              >
                ✉ {event.contactEmail}
              </a>
            )}
          </div>
        </div>
      )}

      {/* 외부 링크 */}
      {(event.officialUrl || event.livestreamUrl) && (
        <div className="px-5 py-4 border-b-[6px] border-gray-50 space-y-2">
          {event.officialUrl && (
            <a
              href={event.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-900 py-2.5 rounded-lg text-sm font-bold text-center"
            >
              🌐 공식 사이트
            </a>
          )}
          {event.livestreamUrl && (
            <a
              href={event.livestreamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 py-2.5 rounded-lg text-sm font-bold text-center"
            >
              📺 라이브 스트림 보기
            </a>
          )}
        </div>
      )}

      <div className="px-5 py-6 text-center text-[10px] text-gray-400">
        🏆 Pink Rabbit · 대회 정보
      </div>
    </div>
  );
}

function InfoCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{label}</div>
      <div className={`text-sm font-extrabold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
      </div>
    </div>
  );
}

/* ============================================================
 * 대회장 위치 — 카카오맵 mini view
 * ========================================================== */

function VenueMap({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadKakaoMaps();
        if (cancelled || !containerRef.current) return;
        const center = new maps.LatLng(lat, lng);
        const map = new maps.Map(containerRef.current, { center, level: 4 });
        // 마커
        new maps.Marker({ position: center, map, title: name });
      } catch (e) {
        console.warn('VenueMap load failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lng, name]);

  return <div ref={containerRef} className="mt-3 w-full h-48 rounded-xl overflow-hidden border border-gray-200 bg-gray-100" />;
}
