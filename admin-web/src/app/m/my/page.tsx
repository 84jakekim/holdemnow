'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks';
import AnonymousPrompt from '@/components/mobile/AnonymousPrompt';
import {
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  collection,
} from 'firebase/firestore';

interface NotificationPrefs {
  favLive: boolean;
  tournamentStart: boolean;
  lateRegImminent: boolean;
  marketing: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  favLive: true,
  tournamentStart: true,
  lateRegImminent: false,
  marketing: false,
};

export default function MyPage() {
  const authState = useAuth();
  const router = useRouter();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [favCount, setFavCount] = useState(0);
  const [seriesSubCount, setSeriesSubCount] = useState(0);
  const [interestCount, setInterestCount] = useState(0);

  // 즐겨찾기 / 시리즈 구독 / 관심 토너 카운트 실시간
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    const uid = authState.user.uid;
    const u1 = onSnapshot(collection(db, 'users', uid, 'favorites'), (s) => setFavCount(s.size));
    const u2 = onSnapshot(collection(db, 'users', uid, 'seriesSubscriptions'), (s) => setSeriesSubCount(s.size));
    const u3 = onSnapshot(collection(db, 'users', uid, 'interests'), (s) => setInterestCount(s.size));
    return () => {
      u1();
      u2();
      u3();
    };
  }, [authState]);

  // user document 구독 — notificationPrefs 동기화
  useEffect(() => {
    if (authState.status !== 'authenticated') {
      setLoading(false);
      return;
    }
    const uid = authState.user.uid;
    const unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const data = snap.data() as { notificationPrefs?: NotificationPrefs } | undefined;
        if (data?.notificationPrefs) setPrefs(data.notificationPrefs);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [authState]);

  const togglePref = async (key: keyof NotificationPrefs) => {
    if (authState.status !== 'authenticated') return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await setDoc(
      doc(db, 'users', authState.user.uid),
      { notificationPrefs: next, updatedAt: serverTimestamp() },
      { merge: true },
    );
  };

  if (authState.status === 'loading') {
    return <div className="p-6 text-center text-sm text-gray-500">로딩 중…</div>;
  }

  if (authState.status === 'anonymous') {
    return <AnonymousPrompt title="마이" icon="👤" desc="관심 토너 · 즐겨찾기 · 알림 설정을 위해 로그인하세요." />;
  }

  const user = authState.user;

  return (
    <div>
      <div className="px-5 h-14 flex items-center justify-between border-b border-gray-100">
        <span className="text-xl font-extrabold tracking-tight font-serif">
          마이
        </span>
        <span className="text-lg">🔔</span>
      </div>

      {/* 프로필 */}
      <div className="px-5 py-6 flex items-center gap-4 border-b-[6px] border-gray-50">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-900 to-gray-700 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
          {user.displayName?.[0] ?? user.email?.[0] ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-gray-900 truncate">
            {user.displayName ?? '플레이어'}
          </div>
          <div className="text-xs text-gray-500 truncate mt-0.5">{user.email}</div>
          <div className="text-[10px] text-gray-400 mt-1">일반 회원</div>
        </div>
      </div>

      {/* 통계 — 실데이터 (favorites + seriesSubscriptions + interests) */}
      <div className="px-5 py-5 grid grid-cols-3 gap-2 border-b-[6px] border-gray-50">
        {[
          { label: '즐겨찾기', value: String(favCount), go: '/m/favorites' as string | null },
          { label: '관심 토너', value: String(interestCount), go: '/m/interests' as string | null },
          { label: '시리즈 구독', value: String(seriesSubCount), go: '/m/subscriptions' as string | null },
        ].map((k) => (
          <button
            key={k.label}
            onClick={() => k.go && router.push(k.go)}
            className="bg-gray-50 rounded-xl py-4 text-center hover:bg-gray-100 transition"
            disabled={!k.go}
          >
            <div className="font-mono text-xl font-extrabold text-gray-900">{k.value}</div>
            <div className="text-[10px] text-gray-500 mt-1">{k.label}</div>
          </button>
        ))}
      </div>

      {/* 알림 설정 */}
      <div className="px-5 py-5 border-b-[6px] border-gray-50">
        <div className="text-base font-extrabold text-gray-900 mb-3">알림 설정</div>
        {loading ? (
          <div className="text-sm text-gray-500">로딩…</div>
        ) : (
          <div className="space-y-1">
            <PrefRow
              label="즐겨찾기 매장 LIVE 시작"
              desc="실시간 즉시 알림"
              value={prefs.favLive}
              onToggle={() => togglePref('favLive')}
            />
            <PrefRow
              label="관심 토너 시작 1시간 전"
              desc="미리 알려드려요"
              value={prefs.tournamentStart}
              onToggle={() => togglePref('tournamentStart')}
            />
            <PrefRow
              label="늦은 등록 마감 임박"
              desc="관심 토너 등록 30분 전"
              value={prefs.lateRegImminent}
              onToggle={() => togglePref('lateRegImminent')}
            />
            <PrefRow
              label="매장·시리즈 마케팅"
              desc="광고성 알림 (선택)"
              value={prefs.marketing}
              onToggle={() => togglePref('marketing')}
            />
          </div>
        )}
      </div>

      {/* 메뉴 */}
      <div className="px-5 py-4">
        {[
          { icon: '⭐', label: '즐겨찾기 매장', go: '/m/favorites' },
          { icon: '🃏', label: '관심 토너', go: '/m/interests' },
          { icon: '🏆', label: '시리즈 구독', go: '/m/subscriptions' },
          { icon: '⭐', label: '내가 쓴 리뷰', tag: 'v0.2' },
          { icon: '⚙️', label: '계정 설정', tag: '' },
          { icon: '❓', label: '도움말·문의', tag: '' },
        ].map((m, i) => (
          <button
            key={i}
            onClick={() => m.go && router.push(m.go)}
            className="w-full px-1 py-3.5 flex items-center justify-between border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">{m.icon}</span>
              <span className="text-sm text-gray-900">{m.label}</span>
            </div>
            {m.tag ? (
              <span className="text-[10px] bg-gray-100 text-gray-500 rounded px-2 py-0.5 font-bold">{m.tag}</span>
            ) : (
              <span className="text-gray-400">›</span>
            )}
          </button>
        ))}
      </div>

      {/* 로그아웃 */}
      <div className="px-5 py-6">
        <button
          onClick={() => signOut(auth)}
          className="w-full py-3 text-sm text-gray-500 underline"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}

function PrefRow({
  label,
  desc,
  value,
  onToggle,
}: {
  label: string;
  desc: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-b-0">
      <div className="flex-1 min-w-0 pr-3">
        <div className="text-sm font-bold text-gray-900">{label}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">{desc}</div>
      </div>
      <button
        onClick={onToggle}
        className={`relative w-11 h-6 rounded-full transition flex-shrink-0 ${
          value ? 'bg-black' : 'bg-gray-300'
        }`}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
          style={{ left: value ? '22px' : '2px' }}
        />
      </button>
    </div>
  );
}
