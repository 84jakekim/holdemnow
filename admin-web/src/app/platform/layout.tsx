'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import AuthGate from '@/components/AuthGate';

const MENUS = [
  { id: 'dashboard', icon: '📊', label: '대시보드', href: '/platform' },
  { id: 'live', icon: '🎬', label: '전국 LIVE', href: '/platform/live' },
  { id: 'members', icon: '👥', label: '회원 관리', href: '/platform/members' },
  { id: 'events', icon: '🎫', label: '대회 큐레이션', href: '/platform/events' },
  { id: 'notices', icon: '📢', label: '팝업 공지', href: '/platform/notices' },
  { id: 'pinned', icon: '📌', label: '홈 고정 공지', href: '/platform/pinned' },
  { id: 'demo', icon: '🛠', label: '데모 데이터', href: '/platform/demo' },
  { id: 'stats', icon: '📈', label: '플랫폼 통계', href: '/platform/stats' },
];

function PlatformLayoutInner({ children }: { children: React.ReactNode }) {
  const authState = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  const [claiming, setClaiming] = useState(false);

  if (authState.status !== 'authenticated' || userDoc === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
        로딩 중…
      </div>
    );
  }

  // platform_admin role 없으면 자기 할당 안내 (v0.1 데모 단계 — 자동 부여 옵션)
  const isPlatformAdmin = hasRole(userDoc, 'platform_admin');
  if (!isPlatformAdmin) {
    const claim = async () => {
      if (authState.status !== 'authenticated') return;
      setClaiming(true);
      try {
        await setDoc(
          doc(db, 'users', authState.user.uid),
          {
            uid: authState.user.uid,
            roles: [...(userDoc?.roles ?? []), 'platform_admin'],
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } finally {
        setClaiming(false);
      }
    };
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border border-amber-200 rounded-2xl p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-3">🏢</div>
          <div className="font-extrabold text-gray-900 mb-2">본사 어드민 권한 필요</div>
          <div className="text-xs text-gray-600 leading-relaxed mb-6">
            현재 계정에 <code className="bg-gray-100 px-1 rounded">platform_admin</code> role이 없습니다.<br />
            v0.1 데모 단계에서는 자기 자신에게 부여 가능 (운영 단계는 Functions Custom Claims).
          </div>
          <button
            onClick={claim}
            disabled={claiming}
            className="bg-amber-600 text-white px-6 py-3 rounded-xl font-bold text-sm disabled:opacity-40"
          >
            {claiming ? '부여 중…' : '본사 관리자 권한 부여받기 (데모)'}
          </button>
          <button
            onClick={() => router.replace('/')}
            className="block mx-auto mt-4 text-xs text-gray-500 underline"
          >
            매장 어드민으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 좌측 사이드바 — 본사 어드민 톤 (다크 액센트) */}
      <aside className="w-56 bg-gray-900 text-white border-r border-gray-800 flex flex-col">
        <div className="p-5 border-b border-gray-800">
          {/* 다크 사이드바용 — 흰 필터로 로고 반전 */}
          <div className="mb-1">
            <img
              src="/logo-white.svg"
              alt="HoldemNow"
              width={150}
              height={25}
              style={{ display: 'block' }}
            />
          </div>
          <div className="text-[10px] text-amber-400 font-bold tracking-wider">본사 어드민</div>
        </div>

        <div className="p-3 border-b border-gray-800">
          <div className="text-[10px] font-bold text-gray-400 tracking-wider mb-1">관리자</div>
          <div className="text-sm font-bold truncate">{authState.user.displayName ?? '본사 관리자'}</div>
          <div className="text-[10px] text-gray-400 truncate mt-0.5">{authState.user.email}</div>
        </div>

        <nav className="flex-1 p-2 overflow-y-auto">
          {MENUS.map((m) => {
            const active =
              pathname === m.href ||
              (m.href !== '/platform' && pathname.startsWith(m.href));
            return (
              <Link
                key={m.id}
                href={m.href}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 mb-0.5 transition ${
                  active
                    ? 'bg-amber-500 text-gray-900'
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <span>{m.icon}</span>
                <span>{m.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-800 space-y-2">
          <Link
            href="/"
            className="block text-[11px] font-bold text-gray-900 bg-white rounded-md px-2.5 py-1.5 hover:bg-gray-100 text-center"
          >
            ← 매장 어드민으로
          </Link>
          <button
            onClick={() => signOut(auth)}
            className="text-xs text-gray-400 underline hover:text-white block"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <PlatformLayoutInner>{children}</PlatformLayoutInner>
    </AuthGate>
  );
}
