export default function PlatformStatsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">📈 플랫폼 통계</h1>
        <p className="text-sm text-gray-500 mt-1">전체 노출·매출·매장 활성도</p>
      </div>
      <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
        <div className="text-4xl mb-3">🚧</div>
        <div className="font-bold text-gray-900 mb-2">v0.2 — Functions 집계</div>
        <div className="text-xs text-gray-500 leading-relaxed max-w-md mx-auto">
          Cloud Functions에서 일일/주간 집계 잡으로 통계 도큐먼트 생성.<br />
          매장별 노출·클릭·길찾기·전화 ROI 리포트.
        </div>
      </div>
    </div>
  );
}
