'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const TABS = [
  { id: 'home', href: '/m', label: '홈', icon: '🏠' },
  { id: 'discover', href: '/m/discover', label: '탐색', icon: '🗺️' },
  { id: 'calendar', href: '/m/calendar', label: '토너', icon: '📅' },
  { id: 'favorites', href: '/m/favorites', label: '즐겨찾기', icon: '⭐' },
  { id: 'my', href: '/m/my', label: '마이', icon: '👤' },
];

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  // 풀스크린 페이지에서는 탭바 숨김
  const isFullscreen = pathname.startsWith('/m/store/') || pathname.startsWith('/m/live/');

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-md mx-auto min-h-screen bg-white relative">
        <div className={isFullscreen ? '' : 'pb-20'}>{children}</div>
        {!isFullscreen && <TabBar pathname={pathname} />}
      </div>
    </div>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-200 z-40">
      <div className="flex">
        {TABS.map((t) => {
          const active = pathname === t.href || (t.href !== '/m' && pathname.startsWith(t.href));
          return (
            <Link
              key={t.id}
              href={t.href}
              className={`flex-1 flex flex-col items-center py-2.5 ${
                active ? 'text-gray-900' : 'text-gray-400'
              }`}
            >
              <span className="text-lg">{t.icon}</span>
              <span className={`text-[10px] mt-0.5 ${active ? 'font-extrabold' : 'font-medium'}`}>
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
