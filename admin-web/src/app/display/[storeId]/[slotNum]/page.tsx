'use client';

import { use, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeSlot, type DisplaySlot } from '@/lib/slots';
import {
  subscribeLiveSession,
  type LiveSession,
  fmtTime,
  computeLateRegMinutes,
} from '@/lib/live';

interface StoreData {
  name: string;
}

export default function DisplayPage({
  params,
}: {
  params: Promise<{ storeId: string; slotNum: string }>;
}) {
  const { storeId, slotNum } = use(params);
  const slotNumInt = parseInt(slotNum, 10);

  const [slot, setSlot] = useState<DisplaySlot | null | undefined>(undefined);
  const [storeName, setStoreName] = useState<string>('매장 디스플레이');
  const [session, setSession] = useState<LiveSession | null | undefined>(undefined);

  useEffect(() => {
    getDoc(doc(db, 'stores', storeId)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data() as StoreData;
        setStoreName(data.name);
      }
    });
  }, [storeId]);

  useEffect(() => {
    const unsub = subscribeSlot(storeId, slotNumInt, setSlot, () => setSlot(null));
    return unsub;
  }, [storeId, slotNumInt]);

  useEffect(() => {
    if (!slot?.sessionId) {
      setSession(null);
      return;
    }
    const unsub = subscribeLiveSession(slot.sessionId, setSession, () => setSession(null));
    return unsub;
  }, [slot?.sessionId]);

  // 클라이언트 자체 카운트다운
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (session) setSec(session.levelSecondsLeft);
  }, [session?.levelSecondsLeft, session?.currentLevel, session?.id, session?.status]);
  useEffect(() => {
    if (!session || session.status !== 'running') return;
    const t = setInterval(() => setSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [session?.status, session?.id]);

  // F11 안내 (한 번만)
  const [showHint, setShowHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(t);
  }, []);

  // 시계 (10초마다 갱신 — 디스플레이용이라 초 단위는 불필요)
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  // 동기화 상태 — navigator.onLine 기반 + 30초 지연
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [showStale, setShowStale] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  useEffect(() => {
    if (online) {
      setShowStale(false);
      return;
    }
    // 끊김 30초 후에만 표시 (짧은 끊김은 노이즈로 간주)
    const t = setTimeout(() => setShowStale(true), 30_000);
    return () => clearTimeout(t);
  }, [online]);

  if (slot === undefined) {
    return <DarkScreen>로딩 중…</DarkScreen>;
  }
  if (slot === null) {
    return (
      <DarkScreen>
        <div className="text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <div className="text-2xl font-bold mb-2">슬롯이 존재하지 않습니다</div>
          <div className="text-sm text-gray-400">
            매장: <span className="font-mono">{storeId}</span> · 슬롯: <span className="font-mono">{slotNum}</span>
          </div>
        </div>
      </DarkScreen>
    );
  }

  const paused = session?.status === 'paused';
  const lowTime = session && sec <= 10 && !paused;
  const nextBlind = session?.blindStructure.find((l) => l.level === session.currentLevel + 1);
  const lateMin = session ? computeLateRegMinutes(session, sec) : 0;

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col">
      {/* 좌상단 매장명 + 우상단 시계 */}
      <div className="px-10 pt-8 flex items-start justify-between gap-6">
        <div>
          <div className="text-xs text-gray-500 tracking-widest mb-1">STORE</div>
          <div className="text-2xl font-extrabold tracking-tight">{storeName}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-gray-500 tracking-widest mb-1">
            {`${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(
              now.getDate(),
            ).padStart(2, '0')}`}{' '}
            ·{' '}
            {['일', '월', '화', '수', '목', '금', '토'][now.getDay()]}
          </div>
          <div className="font-mono text-2xl font-extrabold leading-none">
            {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
          </div>
          <div className="text-[10px] text-gray-500 mt-2">
            {slot.name ?? `${slot.slotNum}번 TV`}
          </div>
        </div>
      </div>

      {/* 동기화 끊김 배너 (30초 이상 오프라인 시) */}
      {showStale && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-20 bg-amber-500/90 text-black px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 backdrop-blur shadow-lg">
          <span className="w-2 h-2 rounded-full bg-black animate-pulse" />
          동기화 중 · 네트워크 확인
        </div>
      )}

      {/* 중앙 */}
      {!session || session.status === 'completed' ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-7xl font-extrabold text-gray-700 mb-6" style={{ letterSpacing: '-0.04em' }}>
            대기 중
          </div>
          <div className="text-sm text-gray-500 max-w-md text-center leading-relaxed">
            어드민에서 이 슬롯에 LIVE 세션을 매핑하면<br />
            이 화면에 실시간 송출됩니다
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-center items-center pb-10">
          {/* LIVE / PAUSED */}
          <div className="flex items-center gap-3 mb-2">
            {paused ? (
              <span className="text-amber-400 font-extrabold tracking-[0.3em] text-sm">⏸ PAUSED</span>
            ) : (
              <>
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-500 font-extrabold tracking-[0.3em] text-sm">LIVE</span>
              </>
            )}
          </div>

          <div className="text-xs text-gray-400 tracking-widest mb-6">{session.tournamentName}</div>
          <div className="text-[10px] text-gray-500 tracking-[0.3em] mb-3">
            LEVEL {session.currentLevel}
          </div>

          {/* 거대 카운트다운 */}
          <div
            className="font-mono font-extrabold leading-none"
            style={{
              fontSize: 'clamp(150px, 18vw, 280px)',
              letterSpacing: '-0.05em',
              color: paused ? '#A8A8A8' : lowTime ? '#FF4757' : '#fff',
              transition: 'color 0.2s',
            }}
          >
            {fmtTime(sec)}
          </div>

          {/* 블라인드 */}
          <div className="mt-6 text-center">
            <div className="text-[10px] text-gray-500 tracking-[0.3em] mb-2">BLINDS</div>
            <div
              className="font-mono font-extrabold"
              style={{ fontSize: 'clamp(36px, 5vw, 64px)', color: '#FFB800' }}
            >
              {session.smallBlind} / {session.bigBlind}
            </div>
            {session.ante > 0 && (
              <div className="font-mono text-base text-gray-500 mt-2">Ante {session.ante}</div>
            )}
          </div>

          {/* 하단 stats */}
          <div className="mt-10 grid grid-cols-3 gap-12 max-w-3xl">
            <Stat
              label="PLAYERS"
              value={`${session.playersRemaining}/${session.totalPlayers}`}
              sub={`${session.tablesRemaining}테이블`}
            />
            <Stat
              label="PRIZE POOL"
              value={`₩${(session.prizePool / 10000).toFixed(0)}만`}
              sub=""
            />
            <Stat
              label="LATE REG"
              value={session.lateRegClosed ? '마감' : `${lateMin}분`}
              sub={session.lateRegClosed ? '' : '남음'}
              highlight={!session.lateRegClosed && lateMin <= 5}
            />
          </div>

          {/* 다음 레벨 */}
          {nextBlind && (
            <div className="mt-10 text-xs text-gray-500 tracking-wider">
              NEXT · LV {nextBlind.level} ·{' '}
              <span className="font-mono">
                {nextBlind.sb}/{nextBlind.bb}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 워터마크 */}
      <div className="px-10 pb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="font-bold tracking-tight">HoldemNow</span>
        </div>
        <div className="text-[10px] text-gray-600 font-mono">
          display.holdemnow.com/{storeId}/slot/{slot.slotNum}
        </div>
      </div>

      {/* F11 안내 (6초 후 사라짐) */}
      {showHint && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur text-white px-5 py-3 rounded-xl text-xs flex items-center gap-3">
          <span>💡 F11로 풀스크린 진입</span>
          <button
            onClick={() => setShowHint(false)}
            className="text-white/60 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function DarkScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center text-sm">
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-gray-500 tracking-[0.3em] mb-2">{label}</div>
      <div
        className={`font-mono font-extrabold ${highlight ? 'text-red-500' : 'text-white'}`}
        style={{ fontSize: 'clamp(28px, 3.5vw, 44px)' }}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
