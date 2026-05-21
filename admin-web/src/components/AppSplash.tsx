'use client';

/**
 * AppSplash — iOS PWA cold start 시 토큰 복원 대기 화면
 * 다크 배경(#0A0E0C)으로 manifest theme_color와 seamless하게 연결.
 */
export default function AppSplash() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center z-[9999]"
      style={{ background: '#0A0E0C' }}
      aria-busy="true"
      aria-label="앱 로딩 중"
    >
      <img
        src="/logo-white.svg"
        alt="Pink Rabbit"
        width={160}
        height={28}
        className="mb-8"
        style={{ objectFit: 'contain' }}
      />
      <Spinner />
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="2.5"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="#FF1F8F"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
