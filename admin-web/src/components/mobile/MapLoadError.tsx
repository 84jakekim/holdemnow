'use client';

/**
 * 카카오맵 SDK 로드 실패 fallback 카드.
 * 지도 영역과 동일한 크기로 렌더링 (absolute inset-0 또는 부모 크기 상속).
 * - 아이콘 + 헤드라인 + 설명
 * - 새로고침 버튼 (window.location.reload)
 * - 주소 텍스트 (props.address 있을 때)
 * - 카카오맵 앱 딥링크 (kakaoPlaceId 또는 address 기반)
 */

interface MapLoadErrorProps {
  /** 매장/장소 주소 — 텍스트 표시 + 카카오맵 검색 폴백 */
  address?: string;
  /** 카카오플레이스 ID — 있으면 kakaomap://place?id= 사용 */
  kakaoPlaceId?: string;
  /** 레이아웃 모드: overlay(absolute inset-0) / block(기본 흐름) */
  layout?: 'overlay' | 'block';
  /** 세로 크기 고정이 필요할 때 (block 모드에서 부모 height 없을 때) */
  height?: number;
  /** 컴팩트 모드 — 미니맵 / 예약 인라인용 */
  compact?: boolean;
}

export default function MapLoadError({
  address,
  kakaoPlaceId,
  layout = 'overlay',
  height,
  compact = false,
}: MapLoadErrorProps) {
  const kakaoDeepLink = kakaoPlaceId
    ? `kakaomap://place?id=${kakaoPlaceId}`
    : address
      ? `kakaomap://search?q=${encodeURIComponent(address)}`
      : null;

  const kakaoWebFallback = address
    ? `https://map.kakao.com/link/search/${encodeURIComponent(address)}`
    : 'https://map.kakao.com/';

  const positionClass = layout === 'overlay' ? 'absolute inset-0' : 'w-full';
  const heightStyle = layout === 'block' && height ? { height } : undefined;

  return (
    <div
      className={`${positionClass} flex flex-col items-center justify-center gap-3 px-5`}
      style={{
        background: 'var(--surface-2)',
        ...heightStyle,
      }}
      role="status"
      aria-label="지도를 불러올 수 없음"
    >
      {/* 아이콘 */}
      <div
        className={compact ? 'text-2xl' : 'text-4xl'}
        aria-hidden="true"
        style={{
          filter: 'grayscale(0.3)',
          lineHeight: 1,
        }}
      >
        🗺
      </div>

      {/* 헤드라인 */}
      <div
        className={`font-bold text-center ${compact ? 'text-[13px]' : 'text-[15px]'}`}
        style={{ color: 'var(--text-1)' }}
      >
        지도를 불러올 수 없어요
      </div>

      {/* 설명 */}
      {!compact && (
        <div
          className="text-[12px] text-center leading-relaxed max-w-[220px]"
          style={{ color: 'var(--text-3)' }}
        >
          네트워크 상태나 카카오 서비스 일시 장애일 수 있어요.
        </div>
      )}

      {/* 주소 텍스트 */}
      {address && (
        <div
          className={`flex items-start gap-1.5 px-3 py-2 rounded-xl max-w-full ${compact ? 'text-[11px]' : 'text-[12px]'}`}
          style={{
            background: 'var(--surface-3)',
            color: 'var(--text-2)',
            border: '1px solid var(--border)',
          }}
        >
          <svg
            width="12"
            height="14"
            viewBox="0 0 12 14"
            fill="none"
            aria-hidden="true"
            className="flex-shrink-0 mt-[1px]"
          >
            <path
              d="M6 0C3.24 0 1 2.24 1 5c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z"
              fill="#FF1F8F"
              opacity="0.7"
            />
            <circle cx="6" cy="5" r="2" fill="#fff" />
          </svg>
          <span className="break-all leading-snug font-medium">{address}</span>
        </div>
      )}

      {/* 액션 버튼들 */}
      <div className={`flex flex-col gap-2 w-full ${compact ? 'max-w-[200px]' : 'max-w-[240px]'}`}>
        {/* 새로고침 */}
        <button
          onClick={() => window.location.reload()}
          className="w-full rounded-xl font-bold text-white transition active:scale-[0.97]"
          style={{
            background: 'var(--brand)',
            padding: compact ? '8px 0' : '10px 0',
            fontSize: compact ? '12px' : '13px',
            minHeight: 44,
          }}
        >
          새로고침
        </button>

        {/* 카카오맵 앱에서 보기 */}
        {kakaoDeepLink && (
          <a
            href={kakaoDeepLink}
            onClick={(e) => {
              e.preventDefault();
              // 1.5초 안에 앱으로 전환되면(visibilitychange) 웹 폴백 취소
              const timer = setTimeout(() => {
                window.open(kakaoWebFallback, '_blank', 'noopener,noreferrer');
                document.removeEventListener('visibilitychange', cleanup);
              }, 1500);
              const cleanup = () => {
                clearTimeout(timer);
                document.removeEventListener('visibilitychange', cleanup);
              };
              document.addEventListener('visibilitychange', cleanup, { once: true });
              window.location.href = kakaoDeepLink;
            }}
            className="w-full rounded-xl font-bold transition active:scale-[0.97] flex items-center justify-center gap-1.5"
            style={{
              background: 'var(--surface-1)',
              border: '1.5px solid var(--border)',
              color: 'var(--text-1)',
              padding: compact ? '8px 0' : '10px 0',
              fontSize: compact ? '12px' : '13px',
              minHeight: 44,
              textDecoration: 'none',
            }}
            aria-label={`카카오맵 앱에서 ${address ?? '위치'} 보기`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.04 2 11c0 3.25 1.77 6.1 4.44 7.77L5.5 22l4.13-2.07C10.36 20.3 11.17 20.4 12 20.4c5.52 0 10-4.04 10-9C22 6.04 17.52 2 12 2z" fill="#FAE300"/>
              <path d="M7 10.5h10M7 14h6" stroke="#3A1D1D" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            카카오맵 앱에서 보기
          </a>
        )}
      </div>
    </div>
  );
}
