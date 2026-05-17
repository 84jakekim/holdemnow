'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type LiveSession,
  subscribeStoreLiveSessions,
  startLiveSession,
  togglePauseSession,
  goToLevelInSession,
  addSecondsToSession,
  eliminatePlayerInSession,
  toggleLateRegInSession,
  stopLiveSession,
  nextLevelTick,
  computeLateRegMinutes,
  fmtTime,
  useLiveCountdown,
} from '@/lib/live';
import {
  type TournamentTemplate,
  subscribeTemplates,
  posterStyleFor,
} from '@/lib/templates';

interface Props {
  storeId: string;
  storeName: string;
}

export default function LivePanel({ storeId, storeName }: Props) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  useEffect(() => {
    const unsubSessions = subscribeStoreLiveSessions(
      storeId,
      (items) => {
        setSessions(items);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    const unsubTemplates = subscribeTemplates(
      storeId,
      (items) => setTemplates(items),
      () => {},
    );
    return () => {
      unsubSessions();
      unsubTemplates();
    };
  }, [storeId]);

  // 선택 동기화
  useEffect(() => {
    if (sessions.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!sessions.some((s) => s.id === selectedId)) {
      setSelectedId(sessions[0].id);
    }
  }, [sessions, selectedId]);

  const selected = sessions.find((s) => s.id === selectedId) || sessions[0] || null;

  const handleStart = async (template: TournamentTemplate) => {
    try {
      const id = await startLiveSession(storeId, storeName, template);
      setSelectedId(id);
      setShowNewModal(false);
    } catch (e: unknown) {
      alert(`LIVE 시작 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500">로딩 중…</div>;
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">🎬 LIVE 운영</h1>
          <p className="text-sm text-gray-500 mt-1">
            {sessions.length === 0
              ? '진행 중인 LIVE 없음'
              : `${sessions.length}개 LIVE 진행 중 · 사용자 액션만 Firestore 저장 (카운트다운은 클라이언트)`}
          </p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          disabled={templates.length === 0}
          className="bg-red-500 text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-red-600 disabled:opacity-40"
        >
          + 새 LIVE 시작
        </button>
      </div>

      {templates.length === 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          💡 먼저 좌측 메뉴 <b>🎲 토너 템플릿</b>에서 토너를 등록해야 LIVE를 시작할 수 있습니다.
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🎬</div>
          <div className="font-bold text-gray-900 mb-2">진행 중인 LIVE가 없습니다</div>
          <div className="text-xs text-gray-500">
            오른쪽 위 "+ 새 LIVE 시작"으로 토너를 띄우세요. 모바일·TV에 즉시 노출됩니다.
          </div>
        </div>
      ) : (
        <>
          {/* 세션 탭바 */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
            {sessions.map((s) => (
              <SessionTab
                key={s.id}
                session={s}
                active={s.id === selected?.id}
                onClick={() => setSelectedId(s.id)}
              />
            ))}
          </div>
          {selected && <SessionControls session={selected} />}
        </>
      )}

      {showNewModal && (
        <NewLiveModal
          templates={templates}
          onPick={handleStart}
          onCancel={() => setShowNewModal(false)}
        />
      )}
    </div>
  );
}

function SessionTab({
  session,
  active,
  onClick,
}: {
  session: LiveSession;
  active: boolean;
  onClick: () => void;
}) {
  // 절대 시각(levelEndsAt) 기반 카운트다운
  const seconds = useLiveCountdown(session);
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 min-w-[150px] text-left p-3 rounded-xl border-[1.5px] transition ${
        active ? 'bg-black text-white border-black' : 'bg-white border-gray-200 hover:border-gray-400'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider mb-1">
        {session.status === 'ready' ? (
          <span className={active ? 'text-emerald-300' : 'text-emerald-700'}>● READY</span>
        ) : session.status === 'paused' ? (
          <span className={active ? 'text-amber-300' : 'text-amber-700'}>⏸ PAUSED</span>
        ) : (
          <>
            <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-red-300' : 'bg-red-500'} animate-pulse`} />
            <span className={active ? 'text-red-200' : 'text-red-600'}>LIVE</span>
          </>
        )}
      </div>
      <div className="text-xs font-bold truncate max-w-[140px]">{session.tournamentName}</div>
      <div className={`font-mono text-base font-extrabold ${active ? 'text-white' : 'text-gray-900'}`}>
        {fmtTime(seconds)}
      </div>
      <div className={`text-[10px] mt-0.5 ${active ? 'text-gray-300' : 'text-gray-500'}`}>
        Lv {session.currentLevel} · {session.playersRemaining}명
      </div>
    </button>
  );
}

function SessionControls({ session }: { session: LiveSession }) {
  const seconds = useLiveCountdown(session);
  const isReady = session.status === 'ready';
  const isPaused = session.status === 'paused';
  const isRunning = session.status === 'running';
  const lowTime = seconds <= 10 && isRunning;
  const structure = session.blindStructure;
  const nextBlind = structure.find((l) => l.level === session.currentLevel + 1);
  const lateMin = computeLateRegMinutes(session, seconds);

  // 0 도달 시 자동 다음 레벨 (한 클라이언트만 실행하는 것이 이상적 — v0.1은 first-write-wins).
  // ready/paused 상태에서는 절대 자동 진행 금지.
  const advanceLockRef = useRef(false);
  useEffect(() => {
    if (!isRunning) return;
    if (seconds > 0) {
      advanceLockRef.current = false;
      return;
    }
    if (advanceLockRef.current) return;
    advanceLockRef.current = true;
    nextLevelTick(session).catch(() => {
      advanceLockRef.current = false;
    });
  }, [seconds, isRunning, session]);

  // ready/paused → '시작' 버튼이 가장 눈에 띄게. running → '일시정지'.
  const primaryLabel = isReady ? '▶ 시작' : isPaused ? '▶ 재개' : '⏸ 일시정지';
  const primaryVariant: 'primary' | 'ghost' = isRunning ? 'ghost' : 'primary';

  return (
    <div className="space-y-3">
      {/* 거대 타이머 */}
      <div className="bg-white border-[1.5px] border-gray-200 rounded-2xl p-6 text-center">
        <div className="text-[10px] font-bold text-gray-500 tracking-widest mb-1">
          {isReady && <span className="text-emerald-700 mr-2">● 시작 대기</span>}
          LEVEL {session.currentLevel} · {session.smallBlind}/{session.bigBlind}
          {session.ante ? ` · ante ${session.ante}` : ''}
        </div>
        <div
          className={`font-mono font-extrabold leading-none transition-colors ${
            lowTime ? 'text-red-500' : isRunning ? 'text-gray-900' : 'text-gray-400'
          }`}
          style={{ fontSize: '64px', letterSpacing: '-0.04em' }}
        >
          {fmtTime(seconds)}
        </div>
        {nextBlind && (
          <div className="text-[10px] text-gray-400 mt-2">
            다음: Lv {nextBlind.level} · {nextBlind.sb}/{nextBlind.bb}
          </div>
        )}
        {isReady && (
          <div className="text-[11px] text-emerald-700 mt-2 font-bold">
            ▶ 시작을 누르면 카운트다운이 시작되고 모바일·지도에 LIVE로 노출됩니다
          </div>
        )}
      </div>

      {/* 컨트롤 그리드 */}
      <div className="grid grid-cols-3 gap-2">
        <ControlBtn
          variant={primaryVariant}
          onClick={() => togglePauseSession(session, seconds)}
        >
          {primaryLabel}
        </ControlBtn>
        <ControlBtn
          disabled={session.currentLevel <= 1}
          onClick={() => goToLevelInSession(session, -1, seconds)}
        >
          ⏮ 이전
        </ControlBtn>
        <ControlBtn disabled={!nextBlind} onClick={() => goToLevelInSession(session, +1, seconds)}>
          ⏭ 다음
        </ControlBtn>
        <ControlBtn onClick={() => addSecondsToSession(session, seconds, +60)}>+ 1분</ControlBtn>
        <ControlBtn
          disabled={seconds < 60}
          onClick={() => addSecondsToSession(session, seconds, -60)}
        >
          − 1분
        </ControlBtn>
        <ControlBtn
          disabled={session.playersRemaining <= 1}
          onClick={() => eliminatePlayerInSession(session, seconds)}
        >
          ✕ 탈락
        </ControlBtn>
      </div>

      {/* 정보 박스 */}
      <div className="grid grid-cols-2 gap-2">
        <InfoBox label="잔여 인원" value={`${session.playersRemaining}/${session.totalPlayers}명`} />
        <InfoBox label="상금 풀" value={`₩${(session.prizePool / 10000).toFixed(0)}만`} />
        <InfoBox
          label={session.lateRegClosed ? '늦은 등록' : '등록 마감까지'}
          value={session.lateRegClosed ? '마감됨' : `${lateMin}분`}
          warn={!session.lateRegClosed && lateMin <= 5}
        />
        <InfoBox label="시청자" value={`${session.viewerCount}명`} />
      </div>

      {/* 보조 액션 */}
      <div className="flex gap-2">
        <button
          onClick={() => toggleLateRegInSession(session, seconds)}
          className="flex-1 py-2.5 rounded-lg border-[1.5px] border-gray-200 font-bold text-xs"
        >
          {session.lateRegClosed ? '등록 재오픈' : '늦은 등록 마감'}
        </button>
        <button
          onClick={() => {
            if (window.confirm(`"${session.tournamentName}" 종료할까요?`)) {
              stopLiveSession(session, seconds);
            }
          }}
          className="flex-1 py-2.5 rounded-lg border-[1.5px] border-red-200 text-red-600 font-bold text-xs"
        >
          ■ 이 세션 종료
        </button>
      </div>
    </div>
  );
}

function ControlBtn({
  children,
  onClick,
  disabled,
  variant = 'ghost',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
}) {
  const cls =
    variant === 'primary'
      ? 'bg-red-500 text-white'
      : 'bg-white text-gray-900 border-[1.5px] border-gray-200';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${cls} py-3 rounded-xl font-bold text-sm disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function InfoBox({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`bg-white border rounded-lg px-3 py-2.5 ${warn ? 'border-red-200' : 'border-gray-200'}`}>
      <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1">{label}</div>
      <div className={`font-mono text-sm font-extrabold ${warn ? 'text-red-500' : 'text-gray-900'}`}>
        {value}
      </div>
    </div>
  );
}

function NewLiveModal({
  templates,
  onPick,
  onCancel,
}: {
  templates: TournamentTemplate[];
  onPick: (t: TournamentTemplate) => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl"
      >
        <h3 className="font-extrabold text-gray-900 mb-1">새 LIVE 시작</h3>
        <p className="text-xs text-gray-500 mb-4">어떤 토너를 시작할까요?</p>
        <div className="space-y-2 max-h-80 overflow-y-auto mb-3">
          {templates.map((t) => {
            const poster = posterStyleFor(t.posterStyle);
            return (
              <button
                key={t.id}
                onClick={() => onPick(t)}
                className="w-full flex items-center gap-3 p-3 border-[1.5px] border-gray-200 rounded-xl hover:border-black bg-white text-left"
              >
                <div
                  className="w-11 h-14 rounded-md flex items-center justify-center text-center font-extrabold text-[9px] leading-tight flex-shrink-0 p-1"
                  style={{ background: poster.bg, color: poster.color }}
                >
                  {t.name.split(' ')[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-900">{t.name}</div>
                  <div className="text-[11px] text-gray-500">
                    바이인 ₩{t.buyIn.toLocaleString()} · {t.totalPlayers}명 ·{' '}
                    {t.blindStructure.length}레벨
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <button
          onClick={onCancel}
          className="w-full py-2.5 rounded-lg border-[1.5px] border-gray-200 text-gray-500 font-bold text-sm"
        >
          취소
        </button>
      </div>
    </div>
  );
}
