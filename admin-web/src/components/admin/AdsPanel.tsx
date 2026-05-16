'use client';

import { useState } from 'react';

export default function AdsPanel() {
  const [purchaseModal, setPurchaseModal] = useState<string | null>(null);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">📣 광고 스토어</h1>
        <p className="text-sm text-gray-500 mt-1">매장 등급 + 단발성 광고 상품</p>
      </div>

      {/* 등급 카드 3개 */}
      <div className="mb-6">
        <div className="text-xs font-bold text-gray-500 tracking-wider mb-3">매장 등급</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TierCard
            tone="current"
            name="BASIC"
            price="무료"
            features={['매장 등록·기본 노출', '무료 타이머·LIVE 송출', '기본 통계 (이번 주만)']}
            cta="현재 사용 중"
            disabled
          />
          <TierCard
            tone="premium"
            name="PREMIUM"
            price="₩99,000"
            priceUnit="/ 월"
            badge="추천"
            features={[
              '검색 결과 상단 노출',
              '30일 통계·ROI 리포트',
              '푸시 알림 월 3회 무료',
              '스태프 계정 3개',
            ]}
            cta="업그레이드 →"
            onClick={() => setPurchaseModal('PREMIUM')}
          />
          <TierCard
            tone="vip"
            name="VIP"
            price="₩299,000"
            priceUnit="/ 월"
            features={[
              '홈 메인 노출 보장',
              '90일 상세 분석 + CSV',
              '푸시 알림 월 10회',
              '스태프 5명 + IP 화이트리스트',
            ]}
            cta="VIP 시작 →"
            onClick={() => setPurchaseModal('VIP')}
          />
        </div>
      </div>

      {/* 단발성 상품 */}
      <div className="mb-6">
        <div className="text-xs font-bold text-gray-500 tracking-wider mb-3">단발성 상품</div>
        <div className="space-y-2">
          {AD_PRODUCTS.map((p) => (
            <div key={p.name} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-lg flex-shrink-0">
                {p.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-900">{p.name}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{p.desc}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm font-extrabold text-gray-900">₩{p.price}</div>
                <button
                  onClick={() => setPurchaseModal(p.name)}
                  className="mt-1 bg-black text-white text-[10px] font-bold rounded px-2.5 py-1"
                >
                  결제
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] text-gray-400 leading-relaxed">
        💡 결제는 토스페이먼츠 연동 (PG 심사 후). 세금계산서 자동 발행. v0.2.
      </div>

      {purchaseModal && (
        <div
          onClick={() => setPurchaseModal(null)}
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
        >
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <div className="text-2xl mb-3">💳</div>
            <div className="font-extrabold text-gray-900 mb-2">결제 시연 (mock)</div>
            <div className="text-xs text-gray-600 leading-relaxed mb-6">
              "<b>{purchaseModal}</b>" 결제 흐름은 v0.2에서 토스페이먼츠 위젯이 열립니다.
            </div>
            <button
              onClick={() => setPurchaseModal(null)}
              className="w-full py-2.5 rounded-lg bg-black text-white font-bold text-sm"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const AD_PRODUCTS = [
  { icon: '🔝', name: '추천 대회 노출', desc: '홈 화면 토너 섹션 7일', price: '50,000' },
  { icon: '🔔', name: '지역 타깃 푸시', desc: '부산 사용자 1,200명', price: '80,000' },
  { icon: '🎫', name: '메인 배너 (주간)', desc: '홈 배너 7일', price: '300,000' },
  { icon: '📺', name: '시리즈 메인 배너', desc: '월 1회 전국 노출', price: '1,500,000' },
];

function TierCard({
  tone,
  name,
  price,
  priceUnit,
  badge,
  features,
  cta,
  onClick,
  disabled,
}: {
  tone: 'current' | 'premium' | 'vip';
  name: string;
  price: string;
  priceUnit?: string;
  badge?: string;
  features: string[];
  cta: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const styles = {
    current: 'bg-green-50 border-green-300',
    premium: 'bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-300',
    vip: 'bg-gradient-to-br from-gray-900 to-gray-800 border-gray-900 text-white',
  } as const;

  const ctaStyles = {
    current: 'bg-white text-green-700 border-2 border-green-700 cursor-default',
    premium: 'bg-black text-white',
    vip: 'bg-amber-400 text-gray-900',
  } as const;

  const isDark = tone === 'vip';

  return (
    <div className={`relative rounded-2xl border-2 p-4 ${styles[tone]}`}>
      {badge && (
        <div className="absolute -top-2 right-3 bg-amber-400 text-gray-900 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
          {badge}
        </div>
      )}
      <div className={`text-[11px] font-extrabold tracking-widest mb-1 ${
        tone === 'current' ? 'text-green-700' : tone === 'premium' ? 'text-amber-700' : 'text-amber-400'
      }`}>
        {name}
      </div>
      <div className="font-mono text-2xl font-extrabold mb-1">
        {price}
        {priceUnit && <span className={`text-xs font-normal ml-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{priceUnit}</span>}
      </div>
      <ul className={`text-xs space-y-1.5 my-4 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        {features.map((f) => (
          <li key={f}>✓ {f}</li>
        ))}
      </ul>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`w-full py-2 rounded-lg text-xs font-bold ${ctaStyles[tone]}`}
      >
        {cta}
      </button>
    </div>
  );
}
