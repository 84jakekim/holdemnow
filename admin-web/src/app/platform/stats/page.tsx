export default function PlatformStatsPage() {
  return (
    <div>
      <div className="mb-6">
        <div className="section-title" style={{ color: 'var(--gold)' }}>PLATFORM METRICS</div>
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>📈 플랫폼 통계</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>전체 노출·매출·매장 활성도</p>
      </div>
      <div
        className="rounded-xl p-12 text-center"
        style={{ background: 'var(--surface-1)', border: '1.5px dashed var(--border)' }}
      >
        <div className="text-4xl mb-3">🚧</div>
        <div className="font-bold mb-2" style={{ color: 'var(--text-1)' }}>v0.2 — Functions 집계</div>
        <div className="text-xs leading-relaxed max-w-md mx-auto" style={{ color: 'var(--text-2)' }}>
          Cloud Functions에서 일일/주간 집계 잡으로 통계 도큐먼트 생성.<br />
          매장별 노출·클릭·길찾기·전화 ROI 리포트.
        </div>
      </div>
    </div>
  );
}
