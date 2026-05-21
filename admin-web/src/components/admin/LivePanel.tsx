'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type LiveSession,
  subscribeStoreLiveSessions,
  startLiveSession,
  togglePauseSession,
  goToLevelInSession,
  addSecondsToSession,
  setTimeRemainingInSession,
  eliminatePlayerInSession,
  toggleLateRegInSession,
  stopLiveSession,
  nextLevelTick,
  computeLateRegMinutes,
  fmtTime,
  useLiveCountdown,
  FINISHING_GRACE_SEC,
  computeFinishingGraceSec,
  computeReadyExpirySec,
} from '@/lib/live';
import {
  type TournamentTemplate,
  subscribeTemplates,
  posterStyleFor,
  fmtBuyIn,
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
      if (selectedId !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedId(null);
      }
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
      <div className="mb-4 flex items-start justify-between">
        <div className="text-xs text-gray-500">
          {sessions.length === 0
            ? '진행 중인 LIVE 없음'
            : `${sessions.length}개 LIVE 진행 중 · 카운트다운은 클라이언트, 사용자 액션만 Firestore 저장`}
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
          💡 먼저 상단 <b>🎲 토너 템플릿</b> 탭에서 토너를 등록해야 LIVE를 시작할 수 있습니다.
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🎬</div>
          <div className="font-bold text-gray-900 mb-2">진행 중인 LIVE가 없습니다</div>
          <div className="text-xs text-gray-500">
            오른쪽 위 &quot;+ 새 LIVE 시작&quot;으로 토너를 띄우세요. 모바일·TV에 즉시 노출됩니다.
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
  const [showJump, setShowJump] = useState(false);
  const isReady = session.status === 'ready';
  const isPaused = session.status === 'paused';
  const isRunning = session.status === 'running';
  const lowTime = seconds <= 10 && isRunning;
  const structure = session.blindStructure;
  const currentLevelObj = structure.find((l) => l.level === session.currentLevel);
  const nextBlind = structure.find((l) => l.level === session.currentLevel + 1);
  const lateMin = computeLateRegMinutes(session, seconds);
  // 현재 레벨 진행률(0~1) — duration 기준 elapsed/total
  const currentDur = currentLevelObj?.durationSec ?? 0;
  const progress =
    currentDur > 0 ? Math.min(1, Math.max(0, (currentDur - seconds) / currentDur)) : 0;
  const isCurrentBreak = currentLevelObj?.isBreak === true;
  // useLiveCountdown 1초 tick에 묻어 매초 재계산됨 (running 동안). isFinishing 동안에도 표시 갱신.
  const graceSec = computeFinishingGraceSec(session);
  const isFinishing = graceSec != null && graceSec > 0;
  const readyLeftSec = isReady ? computeReadyExpirySec(session) : null;

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

  // 마지막 레벨 종료 후 그레이스 만료 시 자동 stopLiveSession 호출.
  // 매장 사장 클라이언트가 권한을 가지고 있어, 이 페이지가 켜져 있는 동안 정리됨.
  // 만료 후 진입 시(remainMs<=0) 즉시 호출.
  const finishingMs = session.finishingAt?.toMillis?.();
  useEffect(() => {
    if (!finishingMs) return;
    const remainMs = finishingMs + FINISHING_GRACE_SEC * 1000 - Date.now();
    if (remainMs <= 0) {
      stopLiveSession(session, 0).catch(() => {});
      return;
    }
    const t = setTimeout(() => {
      stopLiveSession(session, 0).catch(() => {});
    }, remainMs);
    return () => clearTimeout(t);
  }, [finishingMs, session]);

  // ready/paused → '시작' 버튼이 가장 눈에 띄게. running → '일시정지'.
  const primaryLabel = isReady ? '▶ 시작' : isPaused ? '▶ 재개' : '⏸ 일시정지';
  const primaryVariant: 'primary' | 'ghost' = isRunning ? 'ghost' : 'primary';

  return (
    <div className="space-y-3">
      {/* 거대 타이머 */}
      <div className={`bg-white border-[1.5px] rounded-2xl p-6 text-center ${isFinishing ? 'border-orange-300 bg-orange-50 animate-pulse' : isCurrentBreak ? 'border-amber-300 bg-amber-50/60' : 'border-gray-200'}`}>
        <div className="text-[10px] font-bold text-gray-500 tracking-widest mb-1">
          {isFinishing ? (
            <span className="text-orange-700 mr-2">⚠ 모든 레벨 종료 · 자동 정리까지 {fmtTime(graceSec ?? 0)}</span>
          ) : isReady ? (
            <span className="text-emerald-700 mr-2">● 시작 대기</span>
          ) : null}
          {isCurrentBreak ? (
            <span className="text-amber-700">☕ 휴식 (BREAK) · LV {session.currentLevel}</span>
          ) : (
            <>
              LEVEL {session.currentLevel} · {session.smallBlind}/{session.bigBlind}
              {session.ante ? ` · ante ${session.ante}` : ''}
            </>
          )}
        </div>
        <div
          className={`font-mono font-extrabold leading-none transition-colors ${
            isFinishing ? 'text-orange-600' : isCurrentBreak ? 'text-amber-600' : lowTime ? 'text-red-500' : isRunning ? 'text-gray-900' : 'text-gray-400'
          }`}
          style={{ fontSize: '72px', letterSpacing: '-0.04em' }}
        >
          {isFinishing ? fmtTime(graceSec ?? 0) : fmtTime(seconds)}
        </div>
        {/* 진행률 바 — 드래그로 시간 조절 가능 (running/paused 모두) */}
        {!isFinishing && currentDur > 0 && (isRunning || isPaused) && (
          <DraggableProgressBar
            session={session}
            currentSeconds={seconds}
            currentDur={currentDur}
            progress={progress}
            color={lowTime ? 'bg-red-500' : isCurrentBreak ? 'bg-amber-500' : 'bg-gray-900'}
          />
        )}
        {nextBlind && !isFinishing && (
          <div
            className={`mt-4 rounded-xl px-4 py-3 border-[1.5px] ${
              nextBlind.isBreak
                ? 'bg-amber-50 border-amber-300'
                : 'bg-gray-900 border-gray-900 text-white'
            }`}
          >
            <div
              className={`text-[10px] font-extrabold tracking-[0.25em] mb-1 ${
                nextBlind.isBreak ? 'text-amber-700' : 'text-gray-400'
              }`}
            >
              NEXT · 다음 레벨
            </div>
            {nextBlind.isBreak ? (
              <div className="font-extrabold text-amber-800 text-lg">
                ☕ 휴식 {Math.round(nextBlind.durationSec / 60)}분
              </div>
            ) : (
              <div className="flex items-baseline justify-center gap-3 flex-wrap">
                <div className="text-[11px] font-extrabold tracking-widest text-gray-400">
                  Lv {nextBlind.level}
                </div>
                <div
                  className="font-mono font-extrabold tabular-nums leading-none"
                  style={{ fontSize: '28px', letterSpacing: '-0.02em' }}
                >
                  {nextBlind.sb.toLocaleString()}
                  <span className="text-gray-500 mx-1">/</span>
                  {nextBlind.bb.toLocaleString()}
                </div>
                {nextBlind.ante ? (
                  <div className="font-mono text-xs text-gray-300 font-bold">
                    ante {nextBlind.ante.toLocaleString()}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
        {isReady && (
          <div className="text-[11px] text-emerald-700 mt-2 font-bold leading-relaxed">
            ▶ 시작을 누르면 카운트다운이 시작되고 모바일·지도에 LIVE로 노출됩니다.
            {readyLeftSec != null && readyLeftSec > 0 && (
              <div className="mt-1 text-amber-700">
                ⏳ {fmtTime(readyLeftSec)} 안에 시작하지 않으면 자동 취소됩니다
              </div>
            )}
          </div>
        )}
        {isFinishing && (
          <div className="text-[11px] text-orange-700 mt-2 font-bold">
            토너가 끝났습니다. 위 시간 후 자동으로 LIVE 표시가 사라집니다.<br />
            즉시 마치려면 아래 ⏹ 종료를 누르세요.
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

      {/* 보조 컨트롤 — 레벨 점프 + 매장 TV 미러 */}
      <div className="grid grid-cols-2 gap-2">
        <ControlBtn
          disabled={(session.blindStructureLocked || session.blindStructure).length <= 2}
          onClick={() => setShowJump(true)}
        >
          🎯 레벨 점프
        </ControlBtn>
        <button
          onClick={() => {
            // 새 탭에서 모바일 풀스크린 LIVE 페이지를 그대로 띄움 → 매장 TV/모니터에 드래그
            const url = `${window.location.origin}/m/live/${session.id}`;
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
          className="py-3 rounded-xl font-bold text-sm bg-gray-900 text-white"
        >
          📺 매장 TV 띄우기
        </button>
      </div>

      {showJump && (
        <LevelJumpModal
          session={session}
          onClose={() => setShowJump(false)}
          onJump={(absLevel) => {
            goToLevelInSession(session, { absLevel }, seconds);
            setShowJump(false);
          }}
        />
      )}

      {/* 정보 박스 */}
      <div className="grid grid-cols-2 gap-2">
        <InfoBox label="잔여 인원" value={`${session.playersRemaining}/${session.totalPlayers}명`} />
        <InfoBox label="상금 풀" value={`₩${(session.prizePool / 10000).toFixed(0)}만`} />
        {(() => {
          const isClosed =
            session.lateRegClosed || session.currentLevel > session.lateRegEndLevel;
          if (isClosed) {
            return <InfoBox label="등록" value="🔒 마감" warn={false} />;
          }
          // 분/초 정밀도 — 5분 이내면 mm:ss 표기
          let totalSec = seconds;
          for (let lv = session.currentLevel + 1; lv <= session.lateRegEndLevel; lv++) {
            const item = session.blindStructure.find((l) => l.level === lv);
            if (item) totalSec += item.durationSec;
          }
          const display =
            totalSec < 300
              ? fmtTime(Math.max(0, totalSec))
              : `${Math.ceil(totalSec / 60)}분`;
          return (
            <InfoBox
              label="등록 마감까지"
              value={display}
              warn={lateMin <= 5}
            />
          );
        })()}
        <InfoBox label="시청자" value={`${session.viewerCount}명`} />
      </div>

      {/* 블라인드 스트럭처 — 전체 진행 상황 */}
      <BlindStructureView session={session} currentSeconds={seconds} />

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

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function BlindStructureView({
  session,
  currentSeconds,
}: {
  session: LiveSession;
  currentSeconds: number;
}) {
  const structure =
    session.blindStructureLocked && session.blindStructureLocked.length > 0
      ? session.blindStructureLocked
      : session.blindStructure;
  const currentLv = session.currentLevel;
  const startedMs = session.totalStartedAt?.toMillis();

  // 각 레벨의 누적 시작 오프셋(초) 계산 — reduce로 acc 명시
  const rows = structure.reduce<
    Array<(typeof structure)[number] & { startOffsetSec: number }>
  >((acc, lvl) => {
    const startOffsetSec =
      acc.length === 0 ? 0 : acc[acc.length - 1].startOffsetSec + acc[acc.length - 1].durationSec;
    acc.push({ ...lvl, startOffsetSec });
    return acc;
  }, []);
  const totalSec = rows.length === 0 ? 0 : rows[rows.length - 1].startOffsetSec + rows[rows.length - 1].durationSec;
  const totalMin = Math.round(totalSec / 60);

  return (
    <div className="bg-white border-[1.5px] border-gray-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold text-gray-500 tracking-widest">
            📋 블라인드 스트럭처
          </div>
          <div className="text-sm font-extrabold text-gray-900 mt-0.5">
            {structure.length}레벨 · 총 {totalMin}분
            <span className="text-[11px] font-bold text-gray-500 ml-2">
              · 늦은등록 Lv{session.lateRegEndLevel}까지
            </span>
          </div>
        </div>
        {startedMs && (
          <div className="text-right">
            <div className="text-[9px] font-bold text-gray-400 tracking-widest">토너 시작</div>
            <div className="font-mono text-xs font-extrabold text-gray-700 tabular-nums">
              {(() => {
                const d = new Date(startedMs);
                return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
              })()}
            </div>
          </div>
        )}
      </div>
      {/* 컬럼 헤더 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50/80 border-t border-gray-100 text-[9px] font-bold text-gray-500 tracking-widest">
        <div className="w-4" />
        <div className="w-8">LEVEL</div>
        <div className="flex-1">SB / BB · ante</div>
        <div className="w-10 text-right">기간</div>
        <div className="w-[68px] text-right">상태 · 시각</div>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {rows.map((lvl) => {
          const isPast = lvl.level < currentLv;
          const isCurrent = lvl.level === currentLv;
          const isLateRegEnd = lvl.level === session.lateRegEndLevel;
          const isBreak = lvl.isBreak === true;
          const startAt = startedMs
            ? new Date(startedMs + lvl.startOffsetSec * 1000)
            : null;
          return (
            <div
              key={lvl.level}
              className={`flex items-center gap-2 px-3 py-2.5 border-t border-gray-50 transition ${
                isCurrent ? 'bg-red-50' : isPast ? 'opacity-50 bg-gray-50/50' : isBreak ? 'bg-amber-50/40' : ''
              }`}
            >
              <div
                className={`w-4 text-center text-[11px] ${
                  isCurrent ? 'text-red-600' : isPast ? 'text-gray-400' : 'text-gray-300'
                }`}
              >
                {isPast ? '✓' : isCurrent ? '▶' : '○'}
              </div>
              <div
                className={`w-8 font-mono text-[11px] font-extrabold ${
                  isCurrent ? 'text-red-600' : 'text-gray-900'
                }`}
              >
                {isBreak ? '☕' : `Lv${lvl.level}`}
              </div>
              <div className="flex-1 font-mono text-xs text-gray-700 tabular-nums truncate">
                {isBreak ? (
                  <span className="text-amber-700 font-bold not-italic">휴식 (BREAK)</span>
                ) : (
                  <>
                    {lvl.sb.toLocaleString()}/{lvl.bb.toLocaleString()}
                    {lvl.ante ? ` · ante ${lvl.ante.toLocaleString()}` : ''}
                  </>
                )}
              </div>
              {isLateRegEnd && (
                <div className="text-[9px] bg-amber-100 text-amber-800 rounded-full px-1.5 py-0.5 font-bold whitespace-nowrap">
                  LATE END
                </div>
              )}
              <div className="text-[11px] text-gray-500 tabular-nums w-10 text-right">
                {Math.round(lvl.durationSec / 60)}분
              </div>
              {isCurrent ? (
                <div className="font-mono text-xs font-extrabold text-red-600 tabular-nums w-[68px] text-right">
                  남은 {fmtTime(currentSeconds)}
                </div>
              ) : isPast ? (
                <div className="text-[10px] text-gray-400 tabular-nums w-[68px] text-right">
                  완료
                </div>
              ) : startAt ? (
                <div className="text-[10px] text-gray-500 tabular-nums w-[68px] text-right">
                  시작 {pad2(startAt.getHours())}:{pad2(startAt.getMinutes())}
                </div>
              ) : (
                <div className="w-[68px]" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 드래그 가능 진행바 — 2순위 요구.
 *
 * UX:
 * - 손/마우스 다운 → 좌우 드래그 → 새 시간으로 미리보기 (상단에 mm:ss 라벨)
 * - 손 떼면 setTimeRemainingInSession으로 Firestore에 확정
 * - 진행률은 currentDur 대비 elapsed (0 = 막 시작, 1 = 종료 직전)
 * - 드래그 중 정확도: ±5초 grid로 스냅 (덜덜 떨림 방지)
 */
function DraggableProgressBar({
  session,
  currentSeconds,
  currentDur,
  progress,
  color,
}: {
  session: LiveSession;
  currentSeconds: number;
  currentDur: number;
  progress: number;
  color: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [previewSec, setPreviewSec] = useState<number | null>(null);

  // displayProgress: 드래그 중에는 previewSec 기준, 아니면 실시간 progress
  const displayProgress = dragging && previewSec != null
    ? Math.min(1, Math.max(0, (currentDur - previewSec) / currentDur))
    : progress;

  // pointer 위치 → newSecondsLeft 변환 (5초 단위 스냅)
  const pointerToSeconds = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return currentSeconds;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const elapsed = ratio * currentDur;
    const remaining = Math.max(1, currentDur - elapsed);
    // 5초 스냅
    return Math.max(1, Math.min(currentDur, Math.round(remaining / 5) * 5));
  };

  const handleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDragging(true);
    setPreviewSec(pointerToSeconds(e.clientX));
  };
  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setPreviewSec(pointerToSeconds(e.clientX));
  };
  const handleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const target = pointerToSeconds(e.clientX);
    setDragging(false);
    setPreviewSec(null);
    setTimeRemainingInSession(session, currentSeconds, target).catch(() => {});
  };
  const handleCancel = () => {
    if (!dragging) return;
    setDragging(false);
    setPreviewSec(null);
  };

  return (
    <div className="mt-3 select-none">
      {dragging && previewSec != null && (
        <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5 flex items-center justify-center gap-2">
          <span>🎯 드래그 중 · 새 시간</span>
          <span className="font-mono text-sm text-gray-900 font-extrabold">
            {fmtTime(previewSec)}
          </span>
        </div>
      )}
      <div
        ref={barRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleCancel}
        className={`relative h-4 bg-gray-100 rounded-full overflow-hidden cursor-ew-resize transition-all ${
          dragging ? 'ring-2 ring-black/30 h-5' : 'hover:h-5'
        }`}
        role="slider"
        aria-label="현재 레벨 남은 시간 드래그 조절"
        aria-valuemin={0}
        aria-valuemax={currentDur}
        aria-valuenow={dragging && previewSec != null ? previewSec : currentSeconds}
        style={{ touchAction: 'none' }}
      >
        <div
          className={`h-full ${color} ${dragging ? '' : 'transition-all'}`}
          style={{ width: `${displayProgress * 100}%` }}
        />
        {/* 드래그 핸들 — 진행률 위치 */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-gray-900 shadow-md transition-opacity ${
            dragging ? 'opacity-100 scale-125' : 'opacity-0'
          }`}
          style={{ left: `${displayProgress * 100}%` }}
        />
      </div>
      {!dragging && (
        <div className="text-[9px] text-gray-400 mt-1 text-center tracking-widest">
          ⇄ 진행바를 드래그해 시간 조절
        </div>
      )}
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

/**
 * 레벨 점프 모달 — 100레벨 토너에서 ⏮/⏭ 연타 대신 직접 점프.
 * blindStructureLocked가 있으면 그걸 사용 (시작 시점 스냅샷 우선).
 */
function LevelJumpModal({
  session,
  onClose,
  onJump,
}: {
  session: LiveSession;
  onClose: () => void;
  onJump: (absLevel: number) => void;
}) {
  const structure =
    session.blindStructureLocked && session.blindStructureLocked.length > 0
      ? session.blindStructureLocked
      : session.blindStructure;
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl"
      >
        <h3 className="font-extrabold text-gray-900 mb-1">🎯 레벨 점프</h3>
        <p className="text-xs text-gray-500 mb-3">
          타임라인이 즉시 재정렬됩니다. 잘못 누르면 다시 점프하세요.
        </p>
        <div className="max-h-[360px] overflow-y-auto -mx-1 px-1 mb-3">
          <div className="grid grid-cols-3 gap-2">
            {structure.map((lvl) => {
              const isCurrent = lvl.level === session.currentLevel;
              const isBreak = lvl.isBreak === true;
              return (
                <button
                  key={lvl.level}
                  onClick={() => onJump(lvl.level)}
                  disabled={isCurrent}
                  className={`p-2 rounded-lg border-[1.5px] text-left transition disabled:opacity-50 ${
                    isCurrent
                      ? 'border-red-300 bg-red-50'
                      : isBreak
                      ? 'border-amber-200 bg-amber-50/40 hover:border-amber-400'
                      : 'border-gray-200 hover:border-black'
                  }`}
                >
                  <div className="text-[9px] font-bold text-gray-500 tracking-widest">
                    {isBreak ? '☕' : `LV ${lvl.level}`}
                  </div>
                  <div className="font-mono text-[11px] font-extrabold text-gray-900 tabular-nums">
                    {isBreak ? '휴식' : `${lvl.sb.toLocaleString()}/${lvl.bb.toLocaleString()}`}
                  </div>
                  <div className="text-[9px] text-gray-500">{Math.round(lvl.durationSec / 60)}분</div>
                </button>
              );
            })}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-lg border-[1.5px] border-gray-200 text-gray-500 font-bold text-sm"
        >
          닫기
        </button>
      </div>
    </div>
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
                    바이인 {fmtBuyIn(t.buyIn)} · {t.totalPlayers}명 ·{' '}
                    {t.blindStructure.filter((b) => !b.isBreak).length}레벨
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
