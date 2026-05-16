'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, useStoreDoc, useUserDoc, hasRole } from '@/lib/hooks';
import TemplatesPanel from '@/components/admin/TemplatesPanel';
import LivePanel from '@/components/admin/LivePanel';
import SlotsPanel from '@/components/admin/SlotsPanel';
import Link from 'next/link';
import StoreInfoPanel from '@/components/admin/StoreInfoPanel';
import TournamentsPanel from '@/components/admin/TournamentsPanel';
import AdsPanel from '@/components/admin/AdsPanel';
import StatsPanel from '@/components/admin/StatsPanel';
import { subscribeStoreMetrics, type StoreMetrics } from '@/lib/analytics';

const MENUS = [
  { id: 'dashboard', icon: '📊', label: '대시보드' },
  { id: 'live', icon: '🎬', label: 'LIVE 운영' },
  { id: 'tournaments', icon: '📅', label: '예정 토너' },
  { id: 'templates', icon: '🎲', label: '토너 템플릿' },
  { id: 'store', icon: '🏬', label: '매장 정보' },
  { id: 'slots', icon: '📺', label: '디스플레이' },
  { id: 'ads', icon: '📣', label: '광고' },
  { id: 'stats', icon: '📈', label: '통계' },
];

export default function AdminPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = use(params);
  const router = useRouter();
  const authState = useAuth();
  const store = useStoreDoc(storeId);
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  const isPlatformAdmin = hasRole(userDoc, 'platform_admin');
  const [activeMenu, setActiveMenu] = useState('dashboard');

  if (authState.status === 'loading' || store === undefined) {
    return <main className="min-h-screen flex items-center justify-center text-sm text-gray-500">로딩 중…</main>;
  }
  if (authState.status === 'anonymous') {
    if (typeof window !== 'undefined') router.replace('/');
    return null;
  }
  if (store === null) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="font-bold text-gray-900 mb-2">매장을 찾을 수 없습니다</div>
          <div className="text-xs text-gray-500 mb-6">URL이 잘못됐거나 매장이 삭제됐을 수 있습니다.</div>
          <button onClick={() => router.replace('/')} className="bg-black text-white px-5 py-2 rounded-lg text-sm font-bold">
            처음으로
          </button>
        </div>
      </main>
    );
  }

  const isPending = store.status === 'pending';

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 좌측 사이드바 */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="font-extrabold tracking-tight">HoldemNow</span>
          </div>
          <div className="text-[10px] text-gray-500">어드민 v0.1</div>
        </div>

        <div className="p-3 border-b border-gray-100">
          <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1">매장</div>
          <div className="text-sm font-bold text-gray-900 truncate">{store.name}</div>
          {isPending && (
            <div className="mt-1.5 inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded">
              ⏳ 심사 대기
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 overflow-y-auto">
          {MENUS.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveMenu(m.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 mb-0.5 transition ${
                activeMenu === m.id
                  ? 'bg-black text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100 space-y-2">
          {isPlatformAdmin && (
            <Link
              href="/platform"
              className="block text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 hover:bg-amber-100"
              title="본사 총관리자 화면으로 전환"
            >
              🏢 본사 관리자로 전환
            </Link>
          )}
          {userDoc?.organizerId && (
            <Link
              href={`/organizer/${userDoc.organizerId}`}
              className="block text-[11px] font-bold text-gray-900 bg-amber-100 border border-amber-300 rounded-md px-2.5 py-1.5 hover:bg-amber-200"
              title="대회사 어드민"
            >
              🏆 대회사 어드민으로 전환
            </Link>
          )}
          <div className="text-[10px] text-gray-500">{authState.user.email}</div>
          <button
            onClick={() => signOut(auth)}
            className="text-xs text-gray-500 underline hover:text-gray-900"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-4xl">
          {isPending && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <div className="text-xl">⏳</div>
              <div>
                <div className="font-bold text-amber-900 text-sm">매장 심사 대기 중</div>
                <div className="text-xs text-amber-800 mt-1 leading-relaxed">
                  지금은 데모용으로 즉시 어드민 진입했지만, v0.2부터 플랫폼 운영팀 확인 후 활성화됩니다.
                  아래 메뉴는 모두 작동하며, 모바일 앱 노출만 승인 후 시작됩니다.
                </div>
              </div>
            </div>
          )}

          {activeMenu === 'dashboard' && <DashboardContent storeId={storeId} storeName={store.name} />}
          {activeMenu === 'templates' && <TemplatesPanel storeId={storeId} />}
          {activeMenu === 'live' && <LivePanel storeId={storeId} storeName={store.name} />}
          {activeMenu === 'tournaments' && <TournamentsPanel storeId={storeId} storeName={store.name} />}
          {activeMenu === 'slots' && <SlotsPanel storeId={storeId} />}
          {activeMenu === 'store' && <StoreInfoPanel storeId={storeId} />}
          {activeMenu === 'ads' && <AdsPanel />}
          {activeMenu === 'stats' && <StatsPanel storeId={storeId} />}
          {!['dashboard', 'templates', 'live', 'tournaments', 'slots', 'store', 'ads', 'stats'].includes(activeMenu) && (
            <ComingSoon menu={MENUS.find((m) => m.id === activeMenu)!} />
          )}
        </div>
      </main>
    </div>
  );
}

function DashboardContent({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [metrics, setMetrics] = useState<StoreMetrics>({});
  useEffect(() => {
    const unsub = subscribeStoreMetrics(storeId, setMetrics);
    return unsub;
  }, [storeId]);

  const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();
  const kpis = [
    { label: '누적 노출', value: fmt(metrics.impressions), tag: '카드 표시 수' },
    { label: '카드 클릭', value: fmt(metrics.cardClicks), tag: '상세 진입' },
    { label: '길찾기', value: fmt(metrics.directionsClicks), tag: '카카오맵 호출' },
    { label: '전화', value: fmt(metrics.phoneClicks), tag: 'tel: 호출' },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">📊 대시보드</h1>
        <p className="text-sm text-gray-500 mt-1">{storeName} · 실시간 누적 지표</p>
      </div>

      <div className="bg-gradient-to-br from-red-50 to-rose-50 border border-red-100 rounded-xl p-5 mb-6">
        <div className="text-xs font-bold text-red-700 tracking-wider mb-1">🎉 환영합니다</div>
        <div className="font-bold text-gray-900 mb-2">매장 가입이 완료되었습니다.</div>
        <div className="text-sm text-gray-600 leading-relaxed">
          좌측 메뉴에서 토너 템플릿을 먼저 만들고 LIVE 운영을 시작해보세요.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{k.label}</div>
            <div className="font-mono text-xl font-extrabold text-gray-900">{k.value}</div>
            <div className="text-[10px] text-gray-400 mt-1">{k.tag}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'LIVE 풀스크린 열기', value: fmt(metrics.liveOpens) },
          { label: '즐겨찾기 추가', value: fmt(metrics.favoriteAdds) },
        ].map((k) => (
          <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{k.label}</div>
            <div className="font-mono text-xl font-extrabold text-gray-900">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="text-sm font-bold text-gray-900 mb-3">🎯 시작 가이드</div>
        <ol className="text-xs text-gray-600 space-y-2 list-decimal list-inside leading-relaxed">
          <li>좌측 <b>🎲 토너 템플릿</b>에서 매장의 토너 종류를 등록하세요 (블라인드 구조 포함)</li>
          <li><b>📺 디스플레이</b>에서 매장 TV 슬롯을 추가하세요</li>
          <li><b>🎬 LIVE 운영</b>에서 첫 LIVE를 시작하면 모바일 앱에 즉시 노출됩니다</li>
          <li><b>🏬 매장 정보</b>에서 사진을 업로드하면 디스커버리 효과 +180% 추정</li>
        </ol>
      </div>
    </>
  );
}

function ComingSoon({ menu }: { menu: { icon: string; label: string; id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
          {menu.icon} {menu.label}
        </h1>
        <p className="text-sm text-gray-500 mt-1">다음 마일스톤에서 구현 예정</p>
      </div>
      <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
        <div className="text-4xl mb-3">🚧</div>
        <div className="font-bold text-gray-900 mb-2">곧 추가됩니다</div>
        <div className="text-xs text-gray-500 leading-relaxed max-w-md mx-auto">
          프로토타입에서 검증된 {menu.label} UI를 이 페이지에 Firestore 실시간 연동으로 옮기는 작업이 진행 중입니다.
        </div>
      </div>
    </div>
  );
}
