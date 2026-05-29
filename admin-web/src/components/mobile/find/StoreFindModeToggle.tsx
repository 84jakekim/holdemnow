'use client';

interface Props {
  mode: 'list' | 'map';
  onToggle: (mode: 'list' | 'map') => void;
}

/**
 * [리스트 | 지도] 토글 — /m/find 페이지 상단에 고정
 * 지도 모드 전환 시에만 카카오맵 SDK가 마운트되도록 부모에서 조건부 렌더링 사용
 */
export default function StoreFindModeToggle({ mode, onToggle }: Props) {
  return (
    <div
      className="px-4"
      style={{ paddingTop: 12, paddingBottom: 0, background: 'var(--bg)' }}
    >
      <div
        className="flex rounded-[14px] overflow-hidden"
        style={{ background: 'var(--surface-2)', padding: 4 }}
        role="group"
        aria-label="보기 모드 선택"
      >
        <button
          onClick={() => onToggle('list')}
          aria-pressed={mode === 'list'}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[11px] text-[13px] font-extrabold transition-all"
          style={{
            background: mode === 'list' ? 'var(--bg)' : 'transparent',
            color: mode === 'list' ? 'var(--brand)' : 'var(--text-2)',
            boxShadow: mode === 'list' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
            letterSpacing: '-0.01em',
          }}
        >
          {/* 리스트 아이콘 */}
          <svg
            width="13" height="13" viewBox="0 0 24 24"
            fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
          </svg>
          리스트
        </button>

        <button
          onClick={() => onToggle('map')}
          aria-pressed={mode === 'map'}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[11px] text-[13px] font-extrabold transition-all"
          style={{
            background: mode === 'map' ? 'var(--bg)' : 'transparent',
            color: mode === 'map' ? 'var(--brand)' : 'var(--text-2)',
            boxShadow: mode === 'map' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
            letterSpacing: '-0.01em',
          }}
        >
          {/* 지도 핀 아이콘 */}
          <svg
            width="13" height="13" viewBox="0 0 24 24"
            fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          지도
        </button>
      </div>
    </div>
  );
}
