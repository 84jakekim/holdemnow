'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import {
  type Organizer,
  subscribeOrganizer,
  updateOrganizer,
} from '@/lib/organizers';
import SeriesPanel from '@/components/admin/SeriesPanel';

const MENUS = [
  { id: 'dashboard', icon: '📊', label: '대시보드' },
  { id: 'series', icon: '🏆', label: '시리즈 관리' },
  { id: 'partners', icon: '🏪', label: '협력 매장' },
  { id: 'broadcast', icon: '📣', label: '일괄 홍보' },
  { id: 'finalists', icon: '🎫', label: '본선 진출자' },
  { id: 'ads', icon: '💼', label: '광고 패키지' },
  { id: 'stats', icon: '📈', label: '통계 리포트' },
];

export default function OrganizerAdminPage({ params }: { params: Promise<{ organizerId: string }> }) {
  const { organizerId } = use(params);
  const router = useRouter();
  const authState = useAuth();
  const [org, setOrg] = useState<Organizer | null | undefined>(undefined);
  const [activeMenu, setActiveMenu] = useState('dashboard');

  useEffect(() => {
    const unsub = subscribeOrganizer(organizerId, setOrg, () => setOrg(null));
    return unsub;
  }, [organizerId]);

  if (authState.status === 'loading' || org === undefined) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">로딩 중…</div>;
  }
  if (authState.status === 'anonymous') {
    if (typeof window !== 'undefined') router.replace('/');
    return null;
  }
  if (org === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="font-bold text-gray-900 mb-2">대회사를 찾을 수 없습니다</div>
          <button onClick={() => router.replace('/')} className="text-xs text-gray-500 underline">
            처음으로
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 좌측 사이드바 — 대회사 톤 (다크 + 골드 액센트) */}
      <aside className="w-56 bg-[#1A1A1A] text-white border-r border-gray-800 flex flex-col">
        <div className="p-5 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="font-extrabold tracking-tight">HoldemNow</span>
          </div>
          <div className="text-[10px] text-amber-400 font-bold tracking-wider">대회사 어드민</div>
        </div>

        <div className="p-3 border-b border-gray-800">
          <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1">대회사</div>
          <div className="text-sm font-bold truncate">{org.name}</div>
          {org.tagline && (
            <div className="text-[10px] text-gray-400 truncate mt-0.5">{org.tagline}</div>
          )}
        </div>

        <nav className="flex-1 p-2 overflow-y-auto">
          {MENUS.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveMenu(m.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 mb-0.5 transition ${
                activeMenu === m.id
                  ? 'bg-amber-400 text-gray-900'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-800 space-y-2">
          <Link
            href="/"
            className="block text-[11px] font-bold text-gray-900 bg-white rounded-md px-2.5 py-1.5 hover:bg-gray-100 text-center"
          >
            ← 매장 어드민으로
          </Link>
          <div className="text-[10px] text-gray-500">{authState.user.email}</div>
          <button onClick={() => signOut(auth)} className="text-xs text-gray-400 underline hover:text-white">
            로그아웃
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-5xl">
          {activeMenu === 'dashboard' && <OrganizerDashboard org={org} onActivate={() => updateOrganizer(org.id, { status: 'active' })} />}
          {activeMenu === 'series' && <SeriesPanel organizerId={org.id} />}
          {activeMenu !== 'dashboard' && activeMenu !== 'series' && (
            <ComingSoon menu={MENUS.find((m) => m.id === activeMenu)!} />
          )}
        </div>
      </main>
    </div>
  );
}

function OrganizerDashboard({ org, onActivate }: { org: Organizer; onActivate: () => Promise<void> }) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">📊 {org.name}</h1>
        <p className="text-sm text-gray-500 mt-1">{org.tagline}</p>
      </div>

      {org.status !== 'active' && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div>
            <div className="font-bold text-amber-900 text-sm">상태: {org.status}</div>
            <div className="text-xs text-amber-800 mt-1">활성화하면 모바일 앱에 시리즈 노출됩니다</div>
          </div>
          <button onClick={onActivate} className="bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-bold">
            활성화
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: '운영 시리즈', value: '0', tag: '시작 안 됨' },
          { label: '협력 매장', value: '0', tag: '시리즈에 매핑' },
          { label: '위성 예선', value: '0/0', tag: '완료/전체' },
          { label: '본선 진출', value: '0', tag: '자동 집계' },
        ].map((k) => (
          <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{k.label}</div>
            <div className="font-mono text-xl font-extrabold text-gray-900">{k.value}</div>
            <div className="text-[10px] text-gray-400 mt-1">{k.tag}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="text-sm font-bold text-gray-900 mb-3">🎯 시작 가이드</div>
        <ol className="text-xs text-gray-600 space-y-2 list-decimal list-inside leading-relaxed">
          <li>좌측 <b>🏆 시리즈 관리</b>에서 첫 시리즈 생성 (이름·시즌·본선 일자·게런티)</li>
          <li>협력 매장 5~15곳 선택 → 위성 예선 일정 일괄 등록 (v0.2)</li>
          <li><b>📣 일괄 홍보</b>로 협력 매장 페이지에 시리즈 배너 자동 게시 (v0.2)</li>
          <li>위성 예선 결과는 매장 어드민에서 입력 → 본선 진출자 자동 집계</li>
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
        <p className="text-sm text-gray-500 mt-1">v0.2에서 추가</p>
      </div>
      <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
        <div className="text-4xl mb-3">🚧</div>
        <div className="font-bold text-gray-900 mb-2">곧 추가됩니다</div>
        <div className="text-xs text-gray-500 leading-relaxed max-w-md mx-auto">
          PRD 7.3에 정의된 대회사 어드민 기능. 시리즈 관리 우선 작동, 나머지는 단계적으로 추가.
        </div>
      </div>
    </div>
  );
}
