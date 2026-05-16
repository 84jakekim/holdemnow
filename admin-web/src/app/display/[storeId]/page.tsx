'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeSlots, type DisplaySlot } from '@/lib/slots';
import { subscribeLiveSession, type LiveSession, fmtTime, useLiveCountdown } from '@/lib/live';

export default function DisplayStoreIndex({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = use(params);
  const router = useRouter();
  const [storeName, setStoreName] = useState<string>('매장 디스플레이');
  const [slots, setSlots] = useState<DisplaySlot[] | undefined>(undefined);

  useEffect(() => {
    getDoc(doc(db, 'stores', storeId)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data() as { name?: string };
        if (data.name) setStoreName(data.name);
      }
    });
  }, [storeId]);

  useEffect(() => {
    const unsub = subscribeSlots(
      storeId,
      (items) => setSlots(items),
      () => setSlots([]),
    );
    return unsub;
  }, [storeId]);

  // 슬롯이 정확히 1개면 자동 진입
  useEffect(() => {
    if (slots && slots.length === 1) {
      router.replace(`/display/${storeId}/${slots[0].slotNum}`);
    }
  }, [slots, router, storeId]);

  if (slots === undefined) {
    return <DarkScreen>로딩 중…</DarkScreen>;
  }

  if (slots.length === 0) {
    return (
      <DarkScreen>
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-6">📺</div>
          <div className="text-2xl font-extrabold mb-3">디스플레이 슬롯이 없습니다</div>
          <div className="text-sm text-gray-400 leading-relaxed mb-6">
            매장 어드민 → <b className="text-gray-200">디스플레이</b> 메뉴에서 TV 슬롯을 먼저 추가해주세요.
            슬롯 추가 후 이 페이지를 새로고침하면 자동으로 화면이 나타납니다.
          </div>
          <div className="text-[10px] text-gray-600 font-mono">
            display.holdemnow.com/{storeId}
          </div>
        </div>
      </DarkScreen>
    );
  }

  // 슬롯이 1개일 때는 위 useEffect가 자동 라우팅하므로 잠깐만 보임
  if (slots.length === 1) {
    return <DarkScreen>이동 중…</DarkScreen>;
  }

  // 슬롯 2개 이상 — 선택 화면
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col">
      <div className="px-10 pt-10">
        <div className="text-xs text-gray-500 tracking-widest mb-1">STORE</div>
        <div className="text-3xl font-extrabold tracking-tight font-serif">{storeName}</div>
        <div className="text-sm text-gray-400 mt-2">송출할 디스플레이를 선택하세요</div>
      </div>

      <div className="flex-1 px-10 py-10 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {slots.map((s) => (
          <SlotCard key={s.slotNum} storeId={storeId} slot={s} />
        ))}
      </div>

      <div className="px-10 pb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="font-bold tracking-tight">HoldemNow</span>
        </div>
        <div className="text-[10px] text-gray-600 font-mono">
          display.holdemnow.com/{storeId}
        </div>
      </div>
    </div>
  );
}

function SlotCard({ storeId, slot }: { storeId: string; slot: DisplaySlot }) {
  const [session, setSession] = useState<LiveSession | null>(null);
  useEffect(() => {
    if (!slot.sessionId) {
      setSession(null);
      return;
    }
    const unsub = subscribeLiveSession(slot.sessionId, setSession, () => setSession(null));
    return unsub;
  }, [slot.sessionId]);

  const liveLabel = session && session.status !== 'completed';

  return (
    <Link
      href={`/display/${storeId}/${slot.slotNum}`}
      className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 hover:border-red-500/40 transition group"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs text-gray-500 tracking-widest mb-1">DISPLAY</div>
          <div className="text-xl font-extrabold">{slot.name ?? `${slot.slotNum}번 TV`}</div>
        </div>
        {liveLabel ? (
          <div className="flex items-center gap-1.5 bg-red-500/10 text-red-400 rounded-full px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-extrabold tracking-wider">LIVE</span>
          </div>
        ) : (
          <div className="text-[10px] font-bold text-gray-600 tracking-wider">대기</div>
        )}
      </div>

      {session && session.status !== 'completed' ? (
        <SlotPreviewTimer session={session} />
      ) : (
        <div className="text-sm text-gray-600 leading-relaxed">
          이 슬롯에 매핑된 LIVE가 없습니다.<br />
          어드민에서 세션을 할당하세요.
        </div>
      )}
    </Link>
  );
}

function SlotPreviewTimer({ session }: { session: LiveSession }) {
  const sec = useLiveCountdown(session);
  return (
    <>
      <div className="text-sm font-bold text-gray-200 truncate mb-2">{session.tournamentName}</div>
      <div className="font-mono text-3xl font-extrabold text-white leading-none">
        {fmtTime(sec)}
      </div>
      <div className="text-[11px] text-gray-500 mt-2 font-mono">
        Lv {session.currentLevel} · {session.smallBlind}/{session.bigBlind}
      </div>
    </>
  );
}

function DarkScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center text-sm">
      {children}
    </div>
  );
}
