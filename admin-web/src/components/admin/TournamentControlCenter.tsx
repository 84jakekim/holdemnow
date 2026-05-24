'use client';

/**
 * 🎬 토너 운영 — 통합 컨트롤 센터 (Phase 1)
 *
 * 사용자 요구 (2026-05-21):
 *   "live·토너 메뉴, 디스플레이 메뉴, 슬롯관리, 타이머화면설정 → 하나 페이지에서 통합 컨트롤"
 *
 * 구조 — 3분할:
 *   - 좌 (260px): 활성 세션 리스트 + 템플릿 빠른 선택(★ favorites · recent)
 *   - 중앙 (1fr): 타이머 컨트롤 (기존 LivePanel SessionControls 흡수)
 *   - 우 (380px): TV 송출 슬롯 + 디스플레이 설정 (탭 토글) + 실시간 미리보기
 *
 * 기존 컴포넌트와의 관계:
 *   - LivePanel/TemplatesPanel/SlotsPanel/TimerDisplaySettingsEditor의 lib/* 함수들을 재사용
 *   - UI는 새 컴포넌트로 통합. 기존 컴포넌트 파일은 보존 (롤백 안전)
 *
 * Rules of Hooks: 모든 구독·tick 훅을 컴포넌트 최상단에서 호출 (early return 이전).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
  selfHealStaleFinishingAt,
  computeLateRegMinutes,
  fmtTime,
  useLiveCountdown,
  FINISHING_GRACE_SEC,
  computeFinishingGraceSec,
  computeReadyExpirySec,
  resolveCurrentEntries,
  resolveRebuysCount,
  resolveTotalEntries,
  updateSessionTournamentMeta,
  patchSession,
  recomputeSessionPrizePool,
} from '@/lib/live';
import HoldToConfirmButton from './HoldToConfirmButton';
import {
  type TournamentTemplate,
  type PayoutStructure,
  subscribeTemplates,
  updateTemplate,
  fmtBuyIn,
  fmtPrizeDisplay,
  posterStyleFor,
  resolvePayoutStructure,
  wonToTickets,
  ticketsToWon,
  TICKET_WON,
  computePayoutsFromStructure,
  computePayoutAmounts,
  computeAutoItmCount,
  DISTRIBUTION_LABELS,
} from '@/lib/templates';
import {
  type DisplaySlot,
  subscribeSlots,
  setSlotSession,
  addSlot,
  removeSlot,
  renameSlot,
} from '@/lib/slots';
import {
  type TimerDisplaySettings,
  type PrizePoolMode,
  DEFAULT_TIMER_DISPLAY,
  subscribeTimerDisplay,
  saveTimerDisplay,
  buildBackgroundCss,
  subscribeTimerDisplayPresets,
  createTimerDisplayPreset,
  updateTimerDisplayPreset,
  deleteTimerDisplayPreset,
  resolvePrizePoolMode,
  type TimerDisplayPreset,
} from '@/lib/timerDisplay';
import TemplatesPanel from './TemplatesPanel';

interface Props {
  storeId: string;
  storeName: string;
}

type RightTab = 'tv' | 'display' | 'preview';
// 모바일(lg 미만)에서만 활성 — 3분할을 좌/중/우 sub-tab으로 전환
type MobilePane = 'left' | 'center' | 'right';

export default function TournamentControlCenter({ storeId, storeName }: Props) {
  // ─── 데이터 구독 (Rules of Hooks: early return 이전) ──────────────────────
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [slots, setSlots] = useState<DisplaySlot[]>([]);
  const [display, setDisplay] = useState<TimerDisplaySettings>(DEFAULT_TIMER_DISPLAY);
  const [presets, setPresets] = useState<TimerDisplayPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('tv');
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [pickTemplateOpen, setPickTemplateOpen] = useState(false);
  // 모바일 sub-tab — 좌(세션·템플릿) / 중(타이머) / 우(TV·디스플레이·미리보기)
  const [mobilePane, setMobilePane] = useState<MobilePane>('center');

  useEffect(() => {
    const unsubS = subscribeStoreLiveSessions(
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
    // 보조 구독 — 권한 에러가 발생하면 메인 에러 배너에 노출 (이전엔 silent fail이라 사장이 원인 파악 불가).
    const onSubErr = (label: string) => (e: Error) => {
      // eslint-disable-next-line no-console
      console.error(`[TournamentControlCenter] ${label} 구독 실패`, e);
      setError((prev) => prev ?? `${label} 데이터를 불러오지 못했습니다 (${e.message})`);
    };
    const unsubT = subscribeTemplates(storeId, setTemplates, onSubErr('템플릿'));
    const unsubSl = subscribeSlots(storeId, setSlots, onSubErr('TV 슬롯'));
    const unsubD = subscribeTimerDisplay(storeId, setDisplay, onSubErr('디스플레이 설정'));
    const unsubP = subscribeTimerDisplayPresets(storeId, setPresets, onSubErr('프리셋'));
    return () => {
      unsubS();
      unsubT();
      unsubSl();
      unsubD();
      unsubP();
    };
  }, [storeId]);

  // 선택 동기화
  useEffect(() => {
    if (sessions.length === 0) {
      if (selectedSessionId !== null) setSelectedSessionId(null);
      return;
    }
    if (!sessions.some((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  const selected = sessions.find((s) => s.id === selectedSessionId) || null;

  // ─── 템플릿 정렬: favorite ★ → recent (lastUsedAt) → 나머지 ────────────────
  const sortedTemplates = useMemo(() => {
    return [...templates].sort((a, b) => {
      const aFav = a.favorite ? 1 : 0;
      const bFav = b.favorite ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      const aLast = a.lastUsedAt ?? 0;
      const bLast = b.lastUsedAt ?? 0;
      return bLast - aLast;
    });
  }, [templates]);

  const handleStart = async (template: TournamentTemplate) => {
    try {
      const id = await startLiveSession(storeId, storeName, template);
      setSelectedSessionId(id);
      setPickTemplateOpen(false);
      // lastUsedAt 갱신 (best-effort)
      updateTemplate(storeId, template.id, { lastUsedAt: Date.now() }).catch(() => {});
    } catch (e: unknown) {
      alert(`LIVE 시작 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 템플릿 편집 화면이 열린 경우 (별도 풀스크린 모드)
  if (showTemplateEditor) {
    return (
      <div>
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => setShowTemplateEditor(false)}
            className="text-xs font-bold rounded-lg px-3 py-2"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          >
            ← 토너 운영으로
          </button>
          <div className="text-sm font-bold" style={{ color: 'var(--text-2)' }}>
            🎲 토너 템플릿 만들기/편집
          </div>
        </div>
        <TemplatesPanel storeId={storeId} />
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm" style={{ color: 'var(--text-2)' }}>로딩 중…</div>;
  }

  return (
    <div>
      {/* 헤더 — 모바일: 세로 stack / 데스크탑: 기존 가로 */}
      <div className="mb-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 lg:gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
            🎬 토너 운영
          </h1>
          <p className="text-xs lg:text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            템플릿·LIVE·TV 송출·디스플레이 설정을 한 페이지에서 — {storeName}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTemplateEditor(true)}
            className="flex-1 lg:flex-none text-xs font-bold rounded-lg px-3 py-2.5 lg:py-2"
            style={{ background: 'var(--surface-1)', color: 'var(--text-1)', border: '1px solid var(--border)', minHeight: 44 }}
          >
            🎲 템플릿 만들기
          </button>
          <button
            onClick={() => setPickTemplateOpen(true)}
            disabled={templates.length === 0}
            className="flex-1 lg:flex-none text-xs font-bold rounded-lg px-4 py-2.5 lg:py-2 text-white disabled:opacity-40"
            style={{ background: '#FF1F8F', minHeight: 44 }}
          >
            ▶ 새 LIVE 시작
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg p-3 text-xs"
             style={{ background: 'rgba(239,68,68,0.10)', color: '#B91C1C', border: '1px solid rgba(239,68,68,0.30)' }}>
          {error}
        </div>
      )}

      {/* 모바일 sub-tab (lg 미만 전용) — 좌/중/우 전환 */}
      <div className="lg:hidden mb-3 flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <MobilePaneTab
          active={mobilePane === 'left'}
          onClick={() => setMobilePane('left')}
          label="LIVE·템플릿"
          badge={sessions.length > 0 ? sessions.length : undefined}
        />
        <MobilePaneTab
          active={mobilePane === 'center'}
          onClick={() => setMobilePane('center')}
          label="타이머"
          dot={!!selected}
        />
        <MobilePaneTab
          active={mobilePane === 'right'}
          onClick={() => setMobilePane('right')}
          label="TV·화면"
        />
      </div>

      {/* 데스크탑: 3분할 그리드 / 모바일: sub-tab 기반 단일 컬럼 */}
      <div
        className="lg:grid gap-4"
        style={{ gridTemplateColumns: '260px 1fr 380px', minHeight: 'calc(100vh - 220px)' }}
      >
        {/* ─── 좌: 세션 + 빠른 템플릿 ─────────────────────────────── */}
        <aside className={`space-y-3 ${mobilePane === 'left' ? 'block' : 'hidden'} lg:block`}>
          {/* 진행 중 세션 */}
          <Section title={`진행 중 LIVE (${sessions.length})`} pad>
            {sessions.length === 0 ? (
              <div className="text-[11px] py-4 text-center"
                   style={{ color: 'var(--text-3)' }}>
                진행 중 LIVE 없음.
                <br />우측 위 ▶ 새 LIVE 시작
              </div>
            ) : (
              <div className="space-y-1.5">
                {sessions.map((s) => (
                  <SessionListItem
                    key={s.id}
                    session={s}
                    active={s.id === selected?.id}
                    onClick={() => setSelectedSessionId(s.id)}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* 빠른 템플릿 (favorites + recent) */}
          <Section title="⚡ 빠른 시작" pad>
            {sortedTemplates.length === 0 ? (
              <div className="text-[11px] py-4 text-center"
                   style={{ color: 'var(--text-3)' }}>
                템플릿 없음.
                <br />위 🎲 템플릿 만들기
              </div>
            ) : (
              <div className="space-y-1">
                {sortedTemplates.slice(0, 6).map((t) => (
                  <TemplateQuickItem
                    key={t.id}
                    tpl={t}
                    onStart={() => handleStart(t)}
                    onToggleFav={() => updateTemplate(storeId, t.id, { favorite: !t.favorite }).catch(() => {})}
                  />
                ))}
              </div>
            )}
          </Section>
        </aside>

        {/* ─── 중: 타이머 컨트롤 ─────────────────────────────────── */}
        <main className={`${mobilePane === 'center' ? 'block' : 'hidden'} lg:block`}>
          {selected ? (
            <SessionControlPanel
              session={selected}
              storeId={storeId}
              display={display}
            />
          ) : (
            <div
              className="rounded-2xl p-12 text-center"
              style={{ background: 'var(--surface-1)', border: '2px dashed var(--border)' }}
            >
              <div className="text-5xl mb-4">🎬</div>
              <div className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>
                진행 중인 LIVE가 없습니다
              </div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                좌측 <b>⚡ 빠른 시작</b>에서 템플릿을 누르거나,<br />
                우상단 <b>▶ 새 LIVE 시작</b>으로 새 토너를 띄우세요.
                <br />매장 TV와 모바일 앱에 즉시 노출됩니다.
              </div>
            </div>
          )}
        </main>

        {/* ─── 우: TV/디스플레이/미리보기 ───────────────────────── */}
        <aside className={`${mobilePane === 'right' ? 'block' : 'hidden'} lg:block`}>
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
          >
            <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
              <RightTabBtn active={rightTab === 'tv'} onClick={() => setRightTab('tv')} label="📺 TV 송출" />
              <RightTabBtn active={rightTab === 'display'} onClick={() => setRightTab('display')} label="🎨 화면 설정" />
              <RightTabBtn active={rightTab === 'preview'} onClick={() => setRightTab('preview')} label="🖥️ 미리보기" />
            </div>
            <div className="p-3">
              {rightTab === 'tv' && (
                <TvCastingPane
                  storeId={storeId}
                  slots={slots}
                  sessions={sessions}
                  selected={selected}
                />
              )}
              {rightTab === 'display' && (
                <DisplaySettingsPane
                  storeId={storeId}
                  settings={display}
                  presets={presets}
                  onChange={setDisplay}
                />
              )}
              {rightTab === 'preview' && (
                <TimerPreviewPane settings={display} session={selected} />
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* 새 LIVE 시작 모달 */}
      {pickTemplateOpen && (
        <PickTemplateModal
          templates={sortedTemplates}
          onPick={handleStart}
          onCancel={() => setPickTemplateOpen(false)}
        />
      )}
    </div>
  );
}

// =====================================================================
// 좌측 — 세션 리스트 아이템
// =====================================================================
function SessionListItem({
  session,
  active,
  onClick,
}: {
  session: LiveSession;
  active: boolean;
  onClick: () => void;
}) {
  const seconds = useLiveCountdown(session);
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-2.5 rounded-lg transition"
      style={{
        background: active ? 'rgba(255,31,143,0.10)' : 'var(--surface-2)',
        border: active ? '1.5px solid #FF1F8F' : '1px solid var(--border)',
      }}
    >
      <div className="flex items-center gap-1.5 text-[9px] font-extrabold tracking-wider mb-0.5">
        {session.status === 'ready' ? (
          <span style={{ color: '#10B981' }}>● READY</span>
        ) : session.status === 'paused' ? (
          <span style={{ color: '#F59E0B' }}>⏸ PAUSED</span>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span style={{ color: '#EF4444' }}>LIVE</span>
          </>
        )}
      </div>
      <div className="text-[11px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
        {session.tournamentName}
      </div>
      <div className="flex items-baseline justify-between mt-0.5">
        <div className="font-mono text-sm font-extrabold" style={{ color: 'var(--text-1)' }}>
          {fmtTime(seconds)}
        </div>
        <div className="text-[9px]" style={{ color: 'var(--text-2)' }}>
          Lv{session.currentLevel} · {session.playersRemaining}명
        </div>
      </div>
    </button>
  );
}

// =====================================================================
// 좌측 — 빠른 템플릿 아이템 (1-click 시작 + ★ 토글)
// =====================================================================
function TemplateQuickItem({
  tpl,
  onStart,
  onToggleFav,
}: {
  tpl: TournamentTemplate;
  onStart: () => void;
  onToggleFav: () => void;
}) {
  const poster = posterStyleFor(tpl.posterStyle);
  return (
    <div
      className="flex items-center gap-2 p-2 rounded-lg group"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <div
        className="w-7 h-9 rounded flex items-center justify-center text-[8px] font-extrabold leading-tight flex-shrink-0"
        style={{ background: poster.bg, color: poster.color, padding: 2 }}
      >
        {tpl.name.slice(0, 2)}
      </div>
      <button onClick={onStart} className="flex-1 text-left min-w-0">
        <div className="text-[11px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
          {tpl.name}
        </div>
        <div className="text-[9px]" style={{ color: 'var(--text-2)' }}>
          {fmtBuyIn(tpl.buyIn)} · {tpl.totalPlayers}명
        </div>
      </button>
      <button
        onClick={onToggleFav}
        className="text-base px-1 transition"
        title={tpl.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        style={{ color: tpl.favorite ? '#FFB800' : 'var(--text-3)' }}
      >
        {tpl.favorite ? '★' : '☆'}
      </button>
    </div>
  );
}

// =====================================================================
// 중앙 — 세션 컨트롤 패널 (LivePanel SessionControls 흡수)
// =====================================================================
function SessionControlPanel({
  session,
  storeId,
  display,
}: {
  session: LiveSession;
  storeId: string;
  display: TimerDisplaySettings;
}) {
  const seconds = useLiveCountdown(session);
  const [showJump, setShowJump] = useState(false);
  const isReady = session.status === 'ready';
  const isPaused = session.status === 'paused';
  const isRunning = session.status === 'running';
  const lowTime = seconds <= 10 && isRunning;
  const structure =
    session.blindStructureLocked && session.blindStructureLocked.length > 0
      ? session.blindStructureLocked
      : session.blindStructure;
  const currentLevelObj = structure.find((l) => l.level === session.currentLevel);
  const nextBlind = structure.find((l) => l.level === session.currentLevel + 1);
  const lateMin = computeLateRegMinutes(session, seconds);
  const currentDur = currentLevelObj?.durationSec ?? 0;
  const progress = currentDur > 0 ? Math.min(1, Math.max(0, (currentDur - seconds) / currentDur)) : 0;
  const isCurrentBreak = currentLevelObj?.isBreak === true;
  const graceSec = computeFinishingGraceSec(session);
  const isFinishing = graceSec != null && graceSec > 0;
  const readyLeftSec = isReady ? computeReadyExpirySec(session) : null;

  // 마지막 레벨 자동 정리 (sanity guard 포함 — LivePanel과 동일 로직)
  const finishingMs = session.finishingAt?.toMillis?.();
  useEffect(() => {
    if (!finishingMs) return;
    const lastLevelNum = structure && structure.length > 0 ? structure[structure.length - 1].level : -1;
    const isReallyLastLevel = session.currentLevel === lastLevelNum && lastLevelNum > 0;
    const safeStop = () => {
      if (!isReallyLastLevel) {
        // eslint-disable-next-line no-console
        console.warn(
          `[TournamentControlCenter] BLOCKED auto-stop — currentLevel=${session.currentLevel} lastLevelNum=${lastLevelNum}. 자가 치유 시도.`
        );
        selfHealStaleFinishingAt(session).catch(() => {});
        return;
      }
      stopLiveSession(session, 0, 'TournamentControlCenter:auto-finishing').catch(() => {});
    };
    const remainMs = finishingMs + FINISHING_GRACE_SEC * 1000 - Date.now();
    if (remainMs <= 0) {
      safeStop();
      return;
    }
    const t = setTimeout(safeStop, remainMs);
    return () => clearTimeout(t);
  }, [finishingMs, session, structure]);

  const primaryLabel = isReady ? '▶ 시작' : isPaused ? '▶ 재개' : '⏸ 일시정지';
  const primaryStyle: React.CSSProperties = isRunning
    ? { background: 'var(--surface-1)', color: 'var(--text-1)', border: '1.5px solid var(--border)' }
    : { background: '#FF1F8F', color: '#fff', border: 'none' };

  return (
    <div className="space-y-3">
      {/* 거대 타이머 */}
      <div
        className={`rounded-2xl p-6 text-center ${isFinishing ? 'animate-pulse' : ''}`}
        style={{
          background: isFinishing
            ? 'rgba(249,115,22,0.10)'
            : isCurrentBreak
              ? 'rgba(245,158,11,0.10)'
              : 'var(--surface-1)',
          border: `1.5px solid ${isFinishing ? '#F97316' : isCurrentBreak ? '#F59E0B' : 'var(--border)'}`,
        }}
      >
        <div className="text-[10px] font-bold tracking-widest mb-1" style={{ color: 'var(--text-2)' }}>
          {isFinishing ? (
            <span style={{ color: '#C2410C' }} className="mr-2">⚠ 모든 레벨 종료 · {fmtTime(graceSec ?? 0)}</span>
          ) : isReady ? (
            <span style={{ color: '#059669' }} className="mr-2">● 시작 대기</span>
          ) : null}
          {isCurrentBreak ? (
            <span style={{ color: '#C2410C' }}>☕ 휴식 · LV {session.currentLevel}</span>
          ) : (
            <>
              LEVEL {session.currentLevel} · {session.smallBlind}/{session.bigBlind}
              {session.ante ? ` · ante ${session.ante}` : ''}
            </>
          )}
        </div>
        <div
          className="font-mono font-extrabold leading-none transition-colors"
          style={{
            fontSize: '96px',
            letterSpacing: '-0.04em',
            color: isFinishing
              ? '#EA580C'
              : isCurrentBreak
                ? '#D97706'
                : lowTime
                  ? '#EF4444'
                  : isRunning
                    ? 'var(--text-1)'
                    : 'var(--text-3)',
          }}
        >
          {isFinishing ? fmtTime(graceSec ?? 0) : fmtTime(seconds)}
        </div>
        {!isFinishing && currentDur > 0 && (isRunning || isPaused) && (
          <DraggableProgressBar
            session={session}
            currentSeconds={seconds}
            currentDur={currentDur}
            progress={progress}
            color={lowTime ? '#EF4444' : isCurrentBreak ? '#F59E0B' : 'var(--text-1)'}
          />
        )}
        {nextBlind && !isFinishing && (
          <div
            className={`mt-4 rounded-xl px-4 py-3 ${
              nextBlind.isBreak ? '' : 'text-white'
            }`}
            style={{
              background: nextBlind.isBreak ? 'rgba(245,158,11,0.10)' : '#0F172A',
              border: `1.5px solid ${nextBlind.isBreak ? '#F59E0B' : '#0F172A'}`,
            }}
          >
            <div
              className="text-[10px] font-extrabold tracking-widest mb-1"
              style={{ color: nextBlind.isBreak ? '#B45309' : 'rgba(255,255,255,0.5)' }}
            >
              NEXT · 다음 레벨
            </div>
            {nextBlind.isBreak ? (
              <div className="font-extrabold text-base" style={{ color: '#92400E' }}>
                ☕ 휴식 {Math.round(nextBlind.durationSec / 60)}분
              </div>
            ) : (
              <div className="flex items-baseline justify-center gap-3 flex-wrap">
                <div className="text-[10px] font-extrabold tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  Lv {nextBlind.level}
                </div>
                <div className="font-mono font-extrabold tabular-nums" style={{ fontSize: '22px' }}>
                  {nextBlind.sb.toLocaleString()}
                  <span style={{ color: 'rgba(255,255,255,0.4)' }} className="mx-1">/</span>
                  {nextBlind.bb.toLocaleString()}
                </div>
                {nextBlind.ante ? (
                  <div className="font-mono text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    ante {nextBlind.ante.toLocaleString()}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
        {isReady && (
          <div className="text-[11px] mt-2 font-bold leading-relaxed" style={{ color: '#059669' }}>
            ▶ 시작을 누르면 카운트다운이 시작되고 매장 TV·모바일 앱에 LIVE로 노출됩니다.
            {readyLeftSec != null && readyLeftSec > 0 && (
              <div className="mt-1" style={{ color: '#B45309' }}>
                ⏳ {fmtTime(readyLeftSec)} 안에 시작하지 않으면 자동 취소됩니다
              </div>
            )}
          </div>
        )}
      </div>

      {/* 컨트롤 그리드 */}
      <div className="grid grid-cols-3 gap-2">
        <ControlBtn style={primaryStyle} onClick={() => togglePauseSession(session, seconds)}>
          {primaryLabel}
        </ControlBtn>
        <ControlBtn disabled={session.currentLevel <= 1} onClick={() => goToLevelInSession(session, -1, seconds)}>
          ⏮ 이전
        </ControlBtn>
        <ControlBtn disabled={!nextBlind} onClick={() => goToLevelInSession(session, +1, seconds)}>
          ⏭ 다음
        </ControlBtn>
        <ControlBtn onClick={() => addSecondsToSession(session, seconds, +60)}>+ 1분</ControlBtn>
        <ControlBtn disabled={seconds < 60} onClick={() => addSecondsToSession(session, seconds, -60)}>
          − 1분
        </ControlBtn>
        <ControlBtn
          disabled={session.playersRemaining <= 1}
          onClick={() => eliminatePlayerInSession(session, seconds)}
        >
          ✕ 탈락
        </ControlBtn>
      </div>

      {/* 보조 컨트롤 */}
      <div className="grid grid-cols-2 gap-2">
        <ControlBtn disabled={structure.length <= 2} onClick={() => setShowJump(true)}>
          🎯 레벨 점프
        </ControlBtn>
        <button
          onClick={() => {
            const url = `${window.location.origin}/m/live/${session.id}`;
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
          className="py-3 rounded-xl font-bold text-sm text-white"
          style={{ background: '#111' }}
        >
          📱 모바일 LIVE 새 탭
        </button>
      </div>

      {/* 🎫 실시간 토너 컨트롤 — 2026-05-23 신설.
          사용자 정책: "인원과 리바인 바이인 스타팅칩은 매일·하루에도 두세번 변경되므로
          템플릿이 아니라 토너 운영 > 타이머에서 실시간 컨트롤". */}
      <SessionTournamentControlBox session={session} storeId={storeId} display={display} />

      {/* 정보 박스 — 잔여 인원/등록 마감만 표시. PRIZE POOL은 위 컨트롤 박스에 통합. */}
      <div className="grid grid-cols-2 gap-2">
        <InfoBox
          label="잔여 인원"
          value={`${session.playersRemaining}/${resolveTotalEntries(session)}`}
        />
        {(() => {
          const isClosed = session.lateRegClosed || session.currentLevel > session.lateRegEndLevel;
          if (isClosed) return <InfoBox label="등록" value="🔒 마감" />;
          let totalSec = seconds;
          for (let lv = session.currentLevel + 1; lv <= session.lateRegEndLevel; lv++) {
            const item = session.blindStructure.find((l) => l.level === lv);
            if (item) totalSec += item.durationSec;
          }
          const dsp = totalSec < 300 ? fmtTime(Math.max(0, totalSec)) : `${Math.ceil(totalSec / 60)}분`;
          return <InfoBox label="등록 마감까지" value={dsp} warn={lateMin <= 5} />;
        })()}
      </div>

      {/* 보조 액션 */}
      <div className="flex gap-2">
        <button
          onClick={() => toggleLateRegInSession(session, seconds)}
          className="flex-1 py-2.5 rounded-lg font-bold text-xs"
          style={{ background: 'var(--surface-1)', color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
        >
          {session.lateRegClosed ? '등록 재오픈' : '늦은 등록 마감'}
        </button>
        {/* 우발 클릭 방지 — 3초 길게 누르기. 사용자 보고(2026-05-24): 모르게 종료됨 */}
        <HoldToConfirmButton
          label="■ 이 세션 종료 (3초 길게)"
          onConfirm={() => stopLiveSession(session, seconds, 'TournamentControlCenter:user-button')}
          className="flex-1 py-2.5 rounded-lg font-bold text-xs"
        />
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
    </div>
  );
}

// =====================================================================
// 중앙 — 드래그 가능 진행바 (LivePanel과 동일 로직)
// =====================================================================
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

  const displayProgress = dragging && previewSec != null
    ? Math.min(1, Math.max(0, (currentDur - previewSec) / currentDur))
    : progress;

  const pointerToSeconds = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return currentSeconds;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const elapsed = ratio * currentDur;
    const remaining = Math.max(1, currentDur - elapsed);
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
        <div className="text-[10px] font-bold tracking-wider mb-1.5 flex items-center justify-center gap-2" style={{ color: 'var(--text-2)' }}>
          <span>🎯 새 시간</span>
          <span className="font-mono text-sm font-extrabold" style={{ color: 'var(--text-1)' }}>
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
        className={`relative h-4 rounded-full overflow-hidden cursor-ew-resize transition-all ${
          dragging ? 'h-5' : 'hover:h-5'
        }`}
        role="slider"
        aria-label="현재 레벨 남은 시간 드래그 조절"
        aria-valuemin={0}
        aria-valuemax={currentDur}
        aria-valuenow={dragging && previewSec != null ? previewSec : currentSeconds}
        style={{ touchAction: 'none', background: 'var(--surface-2)' }}
      >
        <div className={`h-full ${dragging ? '' : 'transition-all'}`} style={{ width: `${displayProgress * 100}%`, background: color }} />
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 shadow-md transition-opacity ${
            dragging ? 'opacity-100 scale-125' : 'opacity-0'
          }`}
          style={{ left: `${displayProgress * 100}%`, borderColor: 'var(--text-1)' }}
        />
      </div>
      {!dragging && (
        <div className="text-[9px] mt-1 text-center tracking-widest" style={{ color: 'var(--text-3)' }}>
          ⇄ 진행바 드래그로 시간 조절
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 중앙 — 레벨 점프 모달
// =====================================================================
function LevelJumpModal({
  session,
  onClose,
  onJump,
}: {
  session: LiveSession;
  onClose: () => void;
  onJump: (absLevel: number) => void;
}) {
  const structure = session.blindStructureLocked && session.blindStructureLocked.length > 0
    ? session.blindStructureLocked
    : session.blindStructure;
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl p-5 w-full max-w-sm shadow-xl"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <h3 className="font-extrabold mb-1" style={{ color: 'var(--text-1)' }}>🎯 레벨 점프</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--text-2)' }}>
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
                  className="p-2 rounded-lg text-left transition disabled:opacity-50"
                  style={{
                    border: isCurrent ? '1.5px solid #EF4444' : isBreak ? '1.5px solid #F59E0B' : '1.5px solid var(--border)',
                    background: isCurrent ? 'rgba(239,68,68,0.10)' : isBreak ? 'rgba(245,158,11,0.10)' : 'var(--surface-2)',
                  }}
                >
                  <div className="text-[9px] font-bold tracking-widest" style={{ color: 'var(--text-2)' }}>
                    {isBreak ? '☕' : `LV ${lvl.level}`}
                  </div>
                  <div className="font-mono text-[11px] font-extrabold tabular-nums" style={{ color: 'var(--text-1)' }}>
                    {isBreak ? '휴식' : `${lvl.sb.toLocaleString()}/${lvl.bb.toLocaleString()}`}
                  </div>
                  <div className="text-[9px]" style={{ color: 'var(--text-2)' }}>
                    {Math.round(lvl.durationSec / 60)}분
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-lg font-bold text-sm"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }}
        >
          닫기
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// 우측 — TV 송출 슬롯 관리
// =====================================================================
function TvCastingPane({
  storeId,
  slots,
  sessions,
  selected,
}: {
  storeId: string;
  slots: DisplaySlot[];
  sessions: LiveSession[];
  selected: LiveSession | null;
}) {
  const openDisplay = (slotNum: number) => {
    const url = `/display/${storeId}/${slotNum}`;
    window.open(url, '_blank', 'noopener');
  };

  const handleAddSlot = async () => {
    try {
      await addSlot(storeId);
    } catch (e) {
      console.error('[addSlot] failed', e);
      alert(`TV 추가 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSetSession = async (slotNum: number, sessionId: string | null) => {
    try {
      await setSlotSession(storeId, slotNum, sessionId);
    } catch (e) {
      console.error('[setSlotSession] failed', e);
      alert(`송출 변경 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRename = async (slotNum: number, name: string) => {
    try {
      await renameSlot(storeId, slotNum, name);
    } catch (e) {
      console.error('[renameSlot] failed', e);
      alert(`이름 변경 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRemove = async (slotNum: number) => {
    try {
      await removeSlot(storeId, slotNum);
    } catch (e) {
      console.error('[removeSlot] failed', e);
      alert(`TV 삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-bold tracking-wider" style={{ color: 'var(--text-2)' }}>
          매장 TV {slots.length}개
        </div>
        <button
          onClick={handleAddSlot}
          className="text-[11px] font-bold rounded-md px-2 py-1"
          style={{ background: '#111', color: '#fff' }}
        >
          + TV 추가
        </button>
      </div>

      {slots.length === 0 ? (
        <div className="text-[11px] py-4 text-center rounded-lg"
             style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>
          TV 슬롯을 추가하면 매장 모니터에 송출됩니다
        </div>
      ) : (
        slots.map((s) => {
          const matched = sessions.find((ss) => ss.id === s.sessionId);
          const isSelectedAssigned = selected && s.sessionId === selected.id;
          return (
            <div key={s.slotNum} className="p-2.5 rounded-lg"
                 style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div className="flex items-start gap-2">
                <div className="w-8 h-8 rounded-md flex items-center justify-center text-sm font-extrabold flex-shrink-0"
                     style={{ background: 'var(--surface-1)', color: 'var(--text-1)' }}>
                  {s.slotNum}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                    {s.name ?? `${s.slotNum}번 TV`}
                  </div>
                  {matched ? (
                    <div className="text-[10px] truncate" style={{ color: '#EF4444' }}>
                      ● {matched.tournamentName}
                    </div>
                  ) : (
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      비어있음
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => openDisplay(s.slotNum)}
                    className="text-[10px] font-bold rounded px-2 py-1"
                    style={{ background: '#111', color: '#fff' }}
                  >
                    ⛶ 열기
                  </button>
                </div>
              </div>

              {/* 세션 매핑 드롭다운 — 2026-05-23 부활
                  중앙 selectedSessionId와 무관하게 슬롯별로 직접 매핑 가능.
                  메뉴를 왔다갔다하지 않고 우측 TV 송출 탭에서 즉시 매핑/변경. */}
              <div className="mt-2">
                <div className="text-[9px] font-bold tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>
                  📡 송출할 세션
                </div>
                <select
                  value={s.sessionId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    handleSetSession(s.slotNum, v === '' ? null : v);
                  }}
                  className="w-full text-[11px] font-bold rounded px-2 py-1.5"
                  style={{
                    background: 'var(--surface-1)',
                    color: matched ? '#EF4444' : 'var(--text-2)',
                    border: matched ? '1.5px solid rgba(239,68,68,0.40)' : '1px solid var(--border)',
                    appearance: 'auto',
                  }}
                >
                  <option value="">— 비어있음 —</option>
                  {sessions.length === 0 ? (
                    <option value="" disabled>실행 중인 세션이 없습니다</option>
                  ) : (
                    sessions.map((ss) => {
                      const statusLabel =
                        ss.status === 'ready' ? '● READY' :
                        ss.status === 'paused' ? '⏸ PAUSED' :
                        '● LIVE';
                      return (
                        <option key={ss.id} value={ss.id}>
                          {statusLabel}  {ss.tournamentName}
                        </option>
                      );
                    })
                  )}
                </select>
              </div>

              <div className="flex gap-1 mt-1.5">
                {selected && !isSelectedAssigned ? (
                  <button
                    onClick={() => handleSetSession(s.slotNum, selected.id)}
                    className="flex-1 text-[10px] font-bold rounded px-2 py-1.5"
                    style={{ background: '#FF1F8F', color: '#fff' }}
                    title="좌측 리스트에서 선택한 세션을 이 슬롯에 즉시 매핑"
                  >
                    ⚡ 좌측 선택 세션 송출
                  </button>
                ) : selected && isSelectedAssigned ? (
                  <button
                    onClick={() => handleSetSession(s.slotNum, null)}
                    className="flex-1 text-[10px] font-bold rounded px-2 py-1.5"
                    style={{ background: 'rgba(239,68,68,0.10)', color: '#B91C1C', border: '1px solid rgba(239,68,68,0.30)' }}
                  >
                    이 TV 비우기
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    const name = window.prompt('TV 이름', s.name ?? `${s.slotNum}번 TV`);
                    if (name && name.trim()) handleRename(s.slotNum, name.trim());
                  }}
                  className="text-[10px] font-bold rounded px-2 py-1.5"
                  style={{ background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                  title="TV 이름 바꾸기"
                >
                  ✎
                </button>
                <button
                  onClick={() => { if (window.confirm(`${s.slotNum}번 TV 삭제?`)) handleRemove(s.slotNum); }}
                  className="text-[10px] font-bold rounded px-2 py-1.5"
                  style={{ background: 'var(--surface-1)', color: '#B91C1C', border: '1px solid var(--border)' }}
                  title="TV 슬롯 삭제"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })
      )}
      <div className="text-[10px] leading-relaxed mt-2 p-2 rounded"
           style={{ color: 'var(--text-2)', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.20)' }}>
        💡 각 TV 슬롯의 <b>드롭다운</b>으로 송출할 세션을 직접 매핑할 수 있어요.
        매장 TV 브라우저로 슬롯 URL을 열고 화면 한 번 터치 → 자동 풀스크린 + 사운드 활성화.
      </div>
    </div>
  );
}

// =====================================================================
// 우측 — 디스플레이 설정 (간소화 버전 + 다중 프리셋)
// =====================================================================
function DisplaySettingsPane({
  storeId,
  settings,
  presets,
  onChange,
}: {
  storeId: string;
  settings: TimerDisplaySettings;
  presets: TimerDisplayPreset[];
  onChange: (s: TimerDisplaySettings) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [local, setLocal] = useState<TimerDisplaySettings>(settings);

  useEffect(() => {
    if (!dirty) setLocal(settings);
  }, [settings, dirty]);

  const update = <K extends keyof TimerDisplaySettings>(k: K, v: TimerDisplaySettings[K]) => {
    setLocal((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveTimerDisplay(storeId, local);
      onChange(local);
      setDirty(false);
    } catch (e: unknown) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleApplyPreset = (p: TimerDisplayPreset) => {
    setLocal(p.settings);
    setDirty(true);
  };

  const handleSaveAsPreset = async () => {
    const name = window.prompt('프리셋 이름?', '내 프리셋');
    if (!name || !name.trim()) return;
    try {
      await createTimerDisplayPreset(storeId, name.trim(), local);
    } catch (e: unknown) {
      alert(`프리셋 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleUpdatePreset = async (p: TimerDisplayPreset) => {
    if (!window.confirm(`"${p.name}" 프리셋을 현재 설정으로 덮어씁니까?`)) return;
    try {
      await updateTimerDisplayPreset(storeId, p.id, local);
    } catch (e: unknown) {
      alert(`프리셋 덮어쓰기 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeletePreset = async (p: TimerDisplayPreset) => {
    if (!window.confirm(`"${p.name}" 프리셋 삭제?`)) return;
    try {
      await deleteTimerDisplayPreset(storeId, p.id);
    } catch (e: unknown) {
      alert(`프리셋 삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
      {/* 프리셋 슬롯 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] font-bold tracking-wider" style={{ color: 'var(--text-2)' }}>
            저장된 프리셋 {presets.length}개
          </div>
          <button
            onClick={handleSaveAsPreset}
            className="text-[10px] font-bold rounded px-2 py-0.5"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          >
            + 새 프리셋 저장
          </button>
        </div>
        {presets.length === 0 ? (
          <div className="text-[10px] py-2 text-center" style={{ color: 'var(--text-3)' }}>
            아직 저장된 프리셋이 없습니다
          </div>
        ) : (
          <div className="space-y-1">
            {presets.map((p) => (
              <div key={p.id} className="flex items-center gap-1 p-1.5 rounded"
                   style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div
                  className="w-6 h-6 rounded flex-shrink-0"
                  style={{ background: buildBackgroundCss(p.settings) }}
                />
                <div className="flex-1 min-w-0 text-[11px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                  {p.name}
                </div>
                <button onClick={() => handleApplyPreset(p)} className="text-[10px] font-bold px-1.5"
                        style={{ color: '#FF1F8F' }}>적용</button>
                <button onClick={() => handleUpdatePreset(p)} className="text-[10px] font-bold px-1.5"
                        style={{ color: 'var(--text-2)' }}>덮어쓰기</button>
                <button onClick={() => handleDeletePreset(p)} className="text-[10px] font-bold px-1.5"
                        style={{ color: '#B91C1C' }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 배경 */}
      <Section title="🖼️ 배경">
        <div className="flex gap-1 mb-2">
          {(['solid', 'gradient', 'image'] as const).map((t) => (
            <button
              key={t}
              onClick={() => update('backgroundType', t)}
              className="flex-1 py-1.5 rounded text-[11px] font-bold"
              style={{
                background: local.backgroundType === t ? '#111' : 'var(--surface-2)',
                color: local.backgroundType === t ? '#fff' : 'var(--text-1)',
                border: '1.5px solid var(--border)',
              }}
            >
              {t === 'solid' ? '단색' : t === 'gradient' ? '그라데' : '이미지'}
            </button>
          ))}
        </div>
        {local.backgroundType !== 'image' && (
          <div className="grid grid-cols-2 gap-1.5">
            <ColorInput label="첫째색" value={local.backgroundColor} onChange={(v) => update('backgroundColor', v)} />
            {local.backgroundType === 'gradient' && (
              <ColorInput label="둘째색" value={local.backgroundColor2} onChange={(v) => update('backgroundColor2', v)} />
            )}
          </div>
        )}
        {local.backgroundType === 'image' && (
          <input
            value={local.backgroundImageUrl}
            onChange={(e) => update('backgroundImageUrl', e.target.value)}
            placeholder="https://..."
            className="w-full text-[11px] rounded px-2 py-1.5"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          />
        )}
      </Section>

      {/* 컬러 */}
      <Section title="🎨 컬러">
        <div className="grid grid-cols-2 gap-1.5">
          <ColorInput label="타이머" value={local.timerColor} onChange={(v) => update('timerColor', v)} />
          <ColorInput label="블라인드" value={local.blindsColor} onChange={(v) => update('blindsColor', v)} />
          <ColorInput label="텍스트" value={local.textColor} onChange={(v) => update('textColor', v)} />
          <ColorInput label="강조" value={local.accentColor} onChange={(v) => update('accentColor', v)} />
        </div>
      </Section>

      {/* 폰트 사이즈 (Phase 3) */}
      <Section title="🔠 폰트 크기 (TV 시청 거리에 맞춰 조절)">
        <ScaleSlider label="타이머" value={local.timerScale} onChange={(v) => update('timerScale', v)} />
        <ScaleSlider label="블라인드" value={local.blindsScale} onChange={(v) => update('blindsScale', v)} />
        <ScaleSlider label="통계" value={local.statsScale} onChange={(v) => update('statsScale', v)} />
      </Section>

      {/* 💰 상금 분배표(우측 사이드) 옵션 — 2026-05-23 정정으로 완전 폐기.
          사용자 정책: "상금분배표(우측사이드) 메뉴는 없애줘."
          PRIZE POOL 표시값은 화면 설정 → 텍스트 → "💰 화면 우측 PRIZE POOL 표시값"에서 직접 입력. */}

      {/* 텍스트 */}
      <Section title="📝 텍스트">
        <input
          value={local.customTournamentTitle}
          onChange={(e) => update('customTournamentTitle', e.target.value)}
          placeholder="대회명 (비우면 자동)"
          className="w-full text-[11px] rounded px-2 py-1.5 mb-1.5"
          style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
        />
        <input
          value={local.announcement}
          onChange={(e) => update('announcement', e.target.value)}
          placeholder="공지 (TV 하단 띠)"
          className="w-full text-[11px] rounded px-2 py-1.5 mb-1.5"
          style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
        />
        <input
          value={local.sponsorText}
          onChange={(e) => update('sponsorText', e.target.value)}
          placeholder="스폰서 줄"
          className="w-full text-[11px] rounded px-2 py-1.5"
          style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
        />
      </Section>

      {/* 저장 */}
      <button
        onClick={handleSave}
        disabled={!dirty || saving}
        className="w-full py-2.5 rounded-lg font-bold text-xs text-white disabled:opacity-40"
        style={{ background: dirty ? '#FF1F8F' : '#888' }}
      >
        {saving ? '저장 중…' : dirty ? '💾 변경사항 저장 (모든 TV 즉시 반영)' : '저장됨'}
      </button>
    </div>
  );
}

// =====================================================================
// 우측 — 실시간 미리보기
// =====================================================================
function TimerPreviewPane({
  settings,
  session,
}: {
  settings: TimerDisplaySettings;
  session: LiveSession | null;
}) {
  const seconds = useLiveCountdown(session);
  const bg = useMemo(() => buildBackgroundCss(settings), [settings]);

  return (
    <div>
      <div className="text-[11px] font-bold tracking-wider mb-1.5" style={{ color: 'var(--text-2)' }}>
        매장 TV 실시간 미리보기
      </div>
      <div
        className="rounded-xl overflow-hidden relative aspect-video shadow-lg"
        style={{ background: bg }}
      >
        <div className="relative h-full flex flex-col items-center justify-center text-white p-3">
          <div className="flex items-center gap-1 mb-1">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: settings.accentColor }} />
            <span className="text-[8px] font-extrabold tracking-widest" style={{ color: settings.accentColor }}>LIVE</span>
          </div>
          <div className="text-[9px] tracking-widest mb-1.5 truncate max-w-[90%]" style={{ color: settings.textColor }}>
            {settings.customTournamentTitle || session?.tournamentName || '대기 중'}
          </div>
          <div className="text-[8px] tracking-[0.3em]" style={{ color: settings.textColor, opacity: 0.7 }}>
            LEVEL {session?.currentLevel ?? 1}
          </div>
          <div
            className="font-mono font-extrabold leading-none"
            style={{
              fontSize: `${42 * settings.timerScale}px`,
              letterSpacing: '-0.04em',
              color: settings.timerColor,
            }}
          >
            {fmtTime(session ? seconds : 18 * 60 + 30)}
          </div>
          <div
            className="font-mono font-extrabold mt-1.5"
            style={{ fontSize: `${18 * settings.blindsScale}px`, color: settings.blindsColor }}
          >
            {session ? `${session.smallBlind} / ${session.bigBlind}` : '300 / 600'}
          </div>
          {settings.announcement && (
            <div className="absolute bottom-0 left-0 right-0 text-center text-[9px] py-1 font-bold"
                 style={{ background: 'rgba(0,0,0,0.45)', color: settings.timerColor }}>
              📢 {settings.announcement}
            </div>
          )}
        </div>
      </div>
      <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>
        실제 송출은 우측 <b>📺 TV 송출</b> 탭 ⛶ 열기.
      </div>
    </div>
  );
}

// =====================================================================
// 공용 — 새 LIVE 시작 모달
// =====================================================================
function PickTemplateModal({
  templates,
  onPick,
  onCancel,
}: {
  templates: TournamentTemplate[];
  onPick: (t: TournamentTemplate) => void;
  onCancel: () => void;
}) {
  return (
    <div onClick={onCancel} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl p-6 w-full max-w-md shadow-xl"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <h3 className="font-extrabold" style={{ color: 'var(--text-1)' }}>새 LIVE 시작</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-2)' }}>
          어떤 토너를 시작할까요?
        </p>
        <div className="space-y-1.5 max-h-96 overflow-y-auto mb-3">
          {templates.map((t) => {
            const poster = posterStyleFor(t.posterStyle);
            return (
              <button
                key={t.id}
                onClick={() => onPick(t)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                <div className="w-10 h-12 rounded flex items-center justify-center text-[9px] font-extrabold leading-tight flex-shrink-0 p-1"
                     style={{ background: poster.bg, color: poster.color }}>
                  {t.name.split(' ')[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold flex items-center gap-1" style={{ color: 'var(--text-1)' }}>
                    {t.favorite && <span style={{ color: '#FFB800' }}>★</span>}
                    {t.name}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                    {fmtBuyIn(t.buyIn)} · {t.totalPlayers}명 · {t.blindStructure.filter((b) => !b.isBreak).length}레벨
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <button
          onClick={onCancel}
          className="w-full py-2.5 rounded-lg font-bold text-sm"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }}
        >
          취소
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Atoms
// =====================================================================
function Section({ title, children, pad }: { title: string; children: React.ReactNode; pad?: boolean }) {
  return (
    <div
      className={pad ? 'p-3 rounded-xl' : 'p-2.5 rounded-lg'}
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      <div className="text-[10px] font-extrabold tracking-widest mb-2" style={{ color: 'var(--text-2)' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// 모바일 sub-tab — 좌/중/우 전환 (lg 미만 전용)
function MobilePaneTab({
  active,
  onClick,
  label,
  badge,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
  dot?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold transition"
      style={{
        minHeight: 40,
        background: active ? 'var(--surface-1)' : 'transparent',
        color: active ? '#FF1F8F' : 'var(--text-2)',
        border: active ? '1px solid rgba(255,31,143,0.30)' : '1px solid transparent',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.04)' : undefined,
      }}
    >
      <span>{label}</span>
      {typeof badge === 'number' && (
        <span
          className="inline-flex items-center justify-center rounded-full text-[10px] font-extrabold text-white tabular-nums"
          style={{
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            background: '#FF1F8F',
          }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {dot && !badge && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: '#FF1F8F' }}
          aria-hidden
        />
      )}
    </button>
  );
}

function RightTabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-2 text-[11px] font-bold transition"
      style={{
        background: active ? 'var(--surface-1)' : 'transparent',
        color: active ? 'var(--text-1)' : 'var(--text-2)',
        borderBottom: active ? '2px solid #FF1F8F' : '2px solid transparent',
      }}
    >
      {label}
    </button>
  );
}

function ControlBtn({
  children,
  onClick,
  disabled,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="py-3 rounded-xl font-bold text-sm disabled:opacity-40"
      style={style ?? { background: 'var(--surface-1)', color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
    >
      {children}
    </button>
  );
}

function InfoBox({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{
        background: 'var(--surface-1)',
        border: `1px solid ${warn ? 'rgba(239,68,68,0.30)' : 'var(--border)'}`,
      }}
    >
      <div className="text-[10px] font-bold tracking-wider mb-1" style={{ color: 'var(--text-2)' }}>{label}</div>
      <div className="font-mono text-sm font-extrabold" style={{ color: warn ? '#EF4444' : 'var(--text-1)' }}>
        {value}
      </div>
    </div>
  );
}

// =====================================================================
// 🎫 실시간 토너 컨트롤 박스 — 2026-05-23 신설
// =====================================================================
// 사용자 요구: "인원과 게임참가비를 타이머 페이지에서 설정. 리바인 버튼으로 +1하면
// 프라이즈금액이 상향계산. 인원·리바인·바이인·스타팅칩은 매일·하루에도 두세번
// 변경되므로 실시간 컨트롤 가능한 페이지(토너운영>타이머)에서 컨트롤한다."
//
// 동작:
//   - 인원수 [-] [number] [+]    : 실제 등록 entry. playersRemaining과는 별개.
//   - 리바인 [-] [number] [+]    : 누적 리바인 수. prizePool에 즉시 반영.
//   - 바이인 (T)                  : 1T=1만원. 변경 시 prizePool 즉시 재계산.
//   - 스타팅칩                    : 표시용. prizePool 계산엔 영향 없음.
//   - 💰 자동 계산식:
//        (인원+리바인) × 바이인 × payoutPercent%
//        = X T (Y만원, 만원 단위 내림)
//
// 모든 mutator는 updateSessionTournamentMeta를 거쳐 prizePool과 totalPlayers를
// 함께 1샷 patchSession write. TV 디스플레이는 onSnapshot으로 5초 안에 갱신.
function SessionTournamentControlBox({
  session,
  storeId,
  display,
}: {
  session: LiveSession;
  storeId: string;
  display: TimerDisplaySettings;
}) {
  const ps = resolvePayoutStructure(session.payoutStructure);
  const entries = resolveCurrentEntries(session);
  const rebuys = resolveRebuysCount(session);
  const total = entries + rebuys;
  const buyInT = wonToTickets(session.buyIn);
  const buyInWon = session.buyIn ?? 0;
  const startingStack = session.startingStack ?? 0;
  const prizePoolWon = session.prizePool ?? 0;
  const unit = session.prizeDisplayUnit ?? 'ticket';
  // 화면 노출 옵션 — 매장 prefs(timerDisplay)만 본다. session fallback은 폐기됨.
  // 이유: session.showPrizePool은 시작 시점 스냅샷 → 토글이 실시간 안 됨.
  // 사용자 요구: "타이머 진행 중에도 체크를 없애면 없어지고, 체크하면 실시간으로 나타나야".
  const prizeMode: PrizePoolMode = resolvePrizePoolMode(display.prizePoolMode, display.showPrizePool);
  const showStruct = display.showStructure !== false;
  const showPP = prizeMode !== 'hidden';

  // 입력 잠금 상태 (Firestore write 중) — 더블 클릭 방지
  const [busy, setBusy] = useState(false);

  const safe = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[SessionTournamentControlBox] update failed', e);
      alert(`업데이트 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-xl p-3 space-y-2.5"
      style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)' }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-extrabold tracking-wider" style={{ color: 'var(--text-1)' }}>
          🎫 토너 정보 — 실시간 조절
        </div>
        <div className="text-[9px]" style={{ color: 'var(--text-3)' }}>
          변경 즉시 TV 반영
        </div>
      </div>

      {/* 인원 / 리바인 */}
      <div className="grid grid-cols-2 gap-2">
        <StepperRow
          label="인원수 (등록)"
          value={entries}
          unit="명"
          onMinus={() => safe(() => updateSessionTournamentMeta(session, { entriesDelta: -1 }))}
          onPlus={() => safe(() => updateSessionTournamentMeta(session, { entriesDelta: +1 }))}
          onSet={(v) => safe(() => updateSessionTournamentMeta(session, { currentEntries: v }))}
          minusDisabled={busy || entries <= 0}
          plusDisabled={busy}
        />
        <StepperRow
          label="리바인"
          value={rebuys}
          unit="회"
          onMinus={() => safe(() => updateSessionTournamentMeta(session, { rebuysDelta: -1 }))}
          onPlus={() => safe(() => updateSessionTournamentMeta(session, { rebuysDelta: +1 }))}
          onSet={(v) => safe(() => updateSessionTournamentMeta(session, { rebuysCount: v }))}
          minusDisabled={busy || rebuys <= 0}
          plusDisabled={busy}
          accent="#FF1F8F"
        />
      </div>

      {/* 잔여 인원 — 2026-05-24 신설. 사장이 탈락 처리 시 −1.
          clamp: [0, currentEntries]. tablesRemaining 자동 재계산. prizePool 무영향. */}
      <div className="grid grid-cols-1">
        <StepperRow
          label={`잔여 인원 (현재 / 등록 ${entries}명)`}
          value={Math.max(0, Math.min(session.playersRemaining ?? entries, entries))}
          unit="명"
          onMinus={() => safe(() => updateSessionTournamentMeta(session, { playersRemainingDelta: -1 }))}
          onPlus={() => safe(() => updateSessionTournamentMeta(session, { playersRemainingDelta: +1 }))}
          onSet={(v) => safe(() => updateSessionTournamentMeta(session, { playersRemaining: v }))}
          minusDisabled={busy || (session.playersRemaining ?? entries) <= 0}
          plusDisabled={busy || (session.playersRemaining ?? entries) >= entries}
          accent="#0EA5E9"
        />
      </div>

      {/* 바이인 / 스타팅칩 */}
      <div className="grid grid-cols-2 gap-2">
        <NumericRow
          label="바이인"
          value={buyInT}
          unit="T"
          step={1}
          min={0}
          onSet={(v) => safe(() => updateSessionTournamentMeta(session, { buyIn: ticketsToWon(v) }))}
          disabled={busy}
          hint={buyInWon ? `${Math.round(buyInWon / 10000).toLocaleString()}만원` : ''}
        />
        <NumericRow
          label="스타팅칩"
          value={startingStack}
          unit=""
          step={1000}
          min={0}
          onSet={(v) => safe(() => updateSessionTournamentMeta(session, { startingStack: v }))}
          disabled={busy}
          hint={startingStack ? `${startingStack.toLocaleString()}` : ''}
        />
      </div>

      {/* 💰 자동 계산된 PRIZE POOL — 2026-05-24: payoutPercent inline input 부착.
          공식: (인원+리바인) × 바이인T × N% → 사장이 N을 직접 변경하면 prizePool 즉시 재계산. */}
      <div
        className="rounded-lg p-2.5"
        style={{
          background: showPP ? 'rgba(16,185,129,0.08)' : 'var(--surface-2)',
          border: `1px solid ${showPP ? 'rgba(16,185,129,0.30)' : 'var(--border)'}`,
        }}
      >
        <div className="flex items-center justify-between mb-1 gap-2">
          <div className="text-[10px] font-extrabold tracking-wider" style={{ color: showPP ? '#047857' : 'var(--text-3)' }}>
            💰 PRIZE POOL {!showPP && '(TV 노출 OFF)'}
          </div>
          <div className="text-[10px] font-mono flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
            <span style={{ color: 'var(--text-3)' }}>({entries}+{rebuys}) × {buyInT}T ×</span>
            <PayoutPercentInline
              value={ps.payoutPercent}
              disabled={busy}
              onCommit={(pct) => safe(() => updateSessionTournamentMeta(session, { payoutPercent: pct }))}
            />
            <span style={{ color: 'var(--text-3)' }}>%</span>
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-mono text-xl font-extrabold" style={{ color: showPP ? '#065F46' : 'var(--text-2)' }}>
            {fmtPrizeDisplay(prizePoolWon, unit) || '—'}
          </div>
          <div className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
            총 {total}엔트리 · {(buyInWon / TICKET_WON * total).toLocaleString()}T
          </div>
        </div>
      </div>

      {/* 📺 TV 화면 노출 옵션 — 2026-05-23 정정.
          사용자 정책 (3가지 정정):
            ① 스트럭쳐 체크는 실시간 반영 (이미 적용)
            ② 우측 PRIZE POOL: hidden / total / distribution 3 모드
            ③ 분배 정책 펼침 메뉴로 1~N등 비율 설정 + 실시간 미리보기 */}
      <div
        className="rounded-lg p-2"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <div className="text-[10px] font-extrabold tracking-wider mb-2" style={{ color: 'var(--text-2)' }}>
          📺 TV 화면 노출 옵션
        </div>
        {/* 좌측 스트럭쳐 토글 — 단일 체크박스 */}
        <div className="mb-2">
          <DisplayToggleRow
            icon="📋"
            label="좌측 스트럭쳐"
            sub="현재 레벨 강조 · 5레벨 컴팩트"
            checked={showStruct}
            onChange={(v) => {
              saveTimerDisplay(storeId, { showStructure: v }).catch((e) => {
                // eslint-disable-next-line no-console
                console.error('[showStructure toggle] save failed', e);
              });
            }}
          />
        </div>
        {/* 우측 PRIZE POOL 모드 — 3 라디오 */}
        <div
          className="rounded-md p-2 mb-2"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        >
          <div className="text-[10px] font-extrabold mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
            <span>💰</span><span>우측 PRIZE POOL 모드</span>
          </div>
          <PrizePoolModeRadio
            value={prizeMode}
            onChange={(mode) => {
              saveTimerDisplay(storeId, { prizePoolMode: mode }).catch((e) => {
                // eslint-disable-next-line no-console
                console.error('[prizePoolMode save] failed', e);
              });
            }}
          />
        </div>
        {/* 분배 정책 펼침 메뉴 — distribution 모드일 때만 의미가 있지만 항상 노출.
            (사장이 미리 분배표 setup 후 mode='distribution'으로 전환할 수 있도록.) */}
        <PayoutPolicyExpander
          ps={ps}
          totalPlayers={total}
          prizePoolWon={prizePoolWon}
          unit={unit}
          disabled={busy}
          onSave={async (next) => {
            await safe(async () => {
              // payoutStructure 변경 시 prizePool도 재계산 (payoutPercent 변동 가능성).
              const nextSession: LiveSession = { ...session, payoutStructure: next };
              const newPP = recomputeSessionPrizePool(nextSession);
              await patchSession(session.id, {
                payoutStructure: next,
                prizePool: newPP,
              });
            });
          }}
        />
      </div>
    </div>
  );
}

/** PRIZE POOL 모드 — 3 라디오 (hidden / total / distribution). */
function PrizePoolModeRadio({
  value,
  onChange,
}: {
  value: PrizePoolMode;
  onChange: (mode: PrizePoolMode) => void;
}) {
  const options: { id: PrizePoolMode; label: string; sub: string }[] = [
    { id: 'hidden', label: '숨김', sub: '카드 안 보임' },
    { id: 'total', label: '총액만', sub: '"PRIZE POOL 50T"' },
    { id: 'distribution', label: '분배표', sub: '1~N등 표시' },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`text-left rounded-md px-2 py-1.5 border-2 transition-all ${
              selected ? 'shadow-sm' : 'hover:bg-gray-50'
            }`}
            style={{
              background: selected ? 'rgba(16,185,129,0.10)' : 'var(--surface-2)',
              borderColor: selected ? 'rgba(16,185,129,0.55)' : 'var(--border)',
            }}
          >
            <div
              className="text-[11px] font-extrabold"
              style={{ color: selected ? '#047857' : 'var(--text-1)' }}
            >
              {selected ? '●' : '○'} {opt.label}
            </div>
            <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {opt.sub}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** 분배 정책 펼침 메뉴 — <details> 베이스. 시상 등수 + 분배 방식 + 실시간 미리보기. */
function PayoutPolicyExpander({
  ps,
  totalPlayers,
  prizePoolWon,
  unit,
  disabled,
  onSave,
}: {
  ps: PayoutStructure;
  totalPlayers: number;
  prizePoolWon: number;
  unit: 'amount' | 'ticket';
  disabled?: boolean;
  onSave: (next: PayoutStructure) => Promise<void>;
}) {
  // itmCount 표시값 — 'auto'면 자동 산출값으로 미리보기
  const resolvedItm =
    ps.itmCount === 'auto' ? computeAutoItmCount(totalPlayers) : Math.max(1, Math.floor(ps.itmCount));
  const payouts = computePayoutsFromStructure(ps, totalPlayers);
  const amounts = computePayoutAmounts(prizePoolWon, payouts);

  const fmtAmt = (won: number): string => {
    if (!won || won <= 0) return '—';
    if (unit === 'ticket') {
      const t = won / 10000;
      return Number.isInteger(t) ? `${t}T` : `${t.toFixed(1)}T`;
    }
    return `${Math.round(won / 10000)}만원`;
  };

  return (
    <details
      className="rounded-md"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      <summary
        className="cursor-pointer select-none px-2 py-1.5 text-[10px] font-extrabold tracking-wider flex items-center justify-between"
        style={{ color: 'var(--text-2)' }}
      >
        <span>🏆 분배 정책 (펼쳐서 설정)</span>
        <span className="text-[9px] font-mono" style={{ color: 'var(--text-3)' }}>
          {DISTRIBUTION_LABELS[ps.distribution]} · ITM {resolvedItm}등
        </span>
      </summary>
      <div className="p-2 space-y-2 border-t" style={{ borderColor: 'var(--border)' }}>
        {/* 시상 등수 */}
        <div>
          <div className="text-[9px] font-extrabold mb-1" style={{ color: 'var(--text-2)' }}>
            시상 등수 (top N)
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSave({ ...ps, itmCount: 'auto' })}
              className={`text-[10px] px-2 py-1 rounded border-2 font-bold transition-all ${
                ps.itmCount === 'auto' ? '' : 'hover:bg-gray-50'
              }`}
              style={{
                background: ps.itmCount === 'auto' ? 'rgba(16,185,129,0.10)' : 'var(--surface-2)',
                borderColor: ps.itmCount === 'auto' ? 'rgba(16,185,129,0.55)' : 'var(--border)',
                color: ps.itmCount === 'auto' ? '#047857' : 'var(--text-1)',
              }}
            >
              자동 (인원 15%)
            </button>
            {[3, 5, 8, 10].map((n) => (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => onSave({ ...ps, itmCount: n })}
                className={`text-[10px] px-2 py-1 rounded border-2 font-bold transition-all ${
                  ps.itmCount === n ? '' : 'hover:bg-gray-50'
                }`}
                style={{
                  background: ps.itmCount === n ? 'rgba(16,185,129,0.10)' : 'var(--surface-2)',
                  borderColor: ps.itmCount === n ? 'rgba(16,185,129,0.55)' : 'var(--border)',
                  color: ps.itmCount === n ? '#047857' : 'var(--text-1)',
                }}
              >
                {n}등
              </button>
            ))}
          </div>
        </div>
        {/* 분배 방식 */}
        <div>
          <div className="text-[9px] font-extrabold mb-1" style={{ color: 'var(--text-2)' }}>
            분배 방식
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(['top-heavy', 'standard', 'flat', 'custom'] as PayoutStructure['distribution'][]).map((d) => {
              const selected = ps.distribution === d;
              return (
                <button
                  key={d}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSave({ ...ps, distribution: d })}
                  className={`text-[10px] px-2 py-1 rounded border-2 font-bold transition-all ${
                    selected ? '' : 'hover:bg-gray-50'
                  }`}
                  style={{
                    background: selected ? 'rgba(16,185,129,0.10)' : 'var(--surface-2)',
                    borderColor: selected ? 'rgba(16,185,129,0.55)' : 'var(--border)',
                    color: selected ? '#047857' : 'var(--text-1)',
                    textAlign: 'left',
                  }}
                >
                  {selected ? '●' : '○'} {DISTRIBUTION_LABELS[d]}
                </button>
              );
            })}
          </div>
        </div>
        {/* payoutPercent (시상 비율) */}
        <div>
          <div className="text-[9px] font-extrabold mb-1 flex items-center justify-between" style={{ color: 'var(--text-2)' }}>
            <span>시상 비율 (%)</span>
            <span className="font-mono" style={{ color: '#047857' }}>{ps.payoutPercent}%</span>
          </div>
          <input
            type="range"
            min={50}
            max={100}
            step={5}
            value={ps.payoutPercent}
            disabled={disabled}
            onChange={(e) => {
              const v = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
              onSave({ ...ps, payoutPercent: v });
            }}
            className="w-full accent-emerald-600"
          />
        </div>
        {/* 미리보기 */}
        <div
          className="rounded-md p-2"
          style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)' }}
        >
          <div className="text-[9px] font-extrabold mb-1" style={{ color: '#047857' }}>
            미리보기 ({totalPlayers}명 기준)
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {amounts.slice(0, 8).map((a) => (
              <div key={a.rank} className="text-[10px] font-mono flex justify-between" style={{ color: 'var(--text-1)' }}>
                <span className="font-bold">{a.rank}등</span>
                <span style={{ color: '#065F46' }}>{fmtAmt(a.amount)}</span>
              </div>
            ))}
            {amounts.length > 8 && (
              <div className="text-[9px] col-span-2 mt-0.5" style={{ color: 'var(--text-3)' }}>
                + {amounts.length - 8}등 추가...
              </div>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}

/** TV 화면 노출 토글 한 줄 — 컴팩트 톤. */
function DisplayToggleRow({
  icon,
  label,
  sub,
  checked,
  onChange,
}: {
  icon: string;
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-emerald-600"
      />
      <span className="text-sm leading-none">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-extrabold leading-tight" style={{ color: 'var(--text-1)' }}>
          {label}
        </div>
        {sub && (
          <div className="text-[9px] leading-tight mt-0.5" style={{ color: 'var(--text-3)' }}>
            {sub}
          </div>
        )}
      </div>
      <span
        className={`text-[9px] font-extrabold tracking-wider px-1.5 py-0.5 rounded ${
          checked ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {checked ? 'ON' : 'OFF'}
      </span>
    </label>
  );
}

function StepperRow({
  label,
  value,
  unit,
  onMinus,
  onPlus,
  onSet,
  minusDisabled,
  plusDisabled,
  accent,
}: {
  label: string;
  value: number;
  unit: string;
  onMinus: () => void;
  onPlus: () => void;
  onSet: (v: number) => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
  accent?: string;
}) {
  return (
    <div
      className="rounded-lg p-2"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <div className="text-[10px] font-bold tracking-wider mb-1.5" style={{ color: accent ?? 'var(--text-2)' }}>
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onMinus}
          disabled={minusDisabled}
          className="w-8 h-8 rounded-md font-bold text-base disabled:opacity-30"
          style={{ background: 'var(--surface-1)', color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
          aria-label={`${label} 1 감소`}
        >−</button>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v) && v >= 0) onSet(v);
          }}
          className="flex-1 text-center font-mono text-base font-extrabold rounded px-1 py-1.5"
          style={{
            background: 'var(--surface-1)',
            color: accent ?? 'var(--text-1)',
            border: '1.5px solid var(--border)',
            minWidth: 0,
          }}
        />
        <button
          onClick={onPlus}
          disabled={plusDisabled}
          className="w-8 h-8 rounded-md font-bold text-base text-white disabled:opacity-30"
          style={{ background: accent ?? '#111' }}
          aria-label={`${label} 1 증가`}
        >+</button>
      </div>
      {unit && (
        <div className="text-[9px] text-right mt-0.5" style={{ color: 'var(--text-3)' }}>{unit}</div>
      )}
    </div>
  );
}

/** PRIZE POOL 공식 inline에 박히는 미니 % input — 2026-05-24.
 *  사용자 요구: "PRIZE POOL (20+0) × 5T × 60% 표기 부분에서 실시간 % 변경".
 *  - 폭 36px 컴팩트. onBlur/Enter 커밋. clamp 0~100.
 *  - 외부 value 변동(다른 탭/세션 동기화) 시 자동 sync.
 */
function PayoutPercentInline({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (pct: number) => void;
}) {
  const [local, setLocal] = useState<string>(String(value));
  useEffect(() => { setLocal(String(value)); }, [value]);
  const commit = () => {
    const v = parseInt(local, 10);
    if (Number.isFinite(v)) {
      const clamped = Math.max(0, Math.min(100, v));
      if (clamped !== value) onCommit(clamped);
      setLocal(String(clamped));
    } else {
      setLocal(String(value));
    }
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={100}
      step={1}
      value={local}
      disabled={disabled}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
      onFocus={(e) => e.currentTarget.select()}
      aria-label="시상 비율 %"
      className="text-center font-mono font-extrabold rounded px-1 py-0.5"
      style={{
        width: 40,
        background: 'var(--surface-1)',
        color: '#047857',
        border: '1.5px solid rgba(16,185,129,0.45)',
        fontSize: 11,
      }}
    />
  );
}

function NumericRow({
  label,
  value,
  unit,
  step,
  min,
  onSet,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  unit: string;
  step: number;
  min: number;
  onSet: (v: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const [local, setLocal] = useState<string>(String(value));
  // 외부 값 변경 시 동기화 (다른 사장/탭에서 변경된 경우)
  useEffect(() => { setLocal(String(value)); }, [value]);
  return (
    <div
      className="rounded-lg p-2"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-2)' }}>
          {label}
        </div>
        {unit && <div className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>{unit}</div>}
      </div>
      <input
        type="number"
        inputMode="numeric"
        step={step}
        min={min}
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const v = parseInt(local, 10);
          if (Number.isFinite(v) && v >= min) {
            if (v !== value) onSet(v);
          } else {
            setLocal(String(value));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        }}
        className="w-full text-center font-mono text-base font-extrabold rounded px-1 py-1.5"
        style={{
          background: 'var(--surface-1)',
          color: 'var(--text-1)',
          border: '1.5px solid var(--border)',
        }}
      />
      {hint && (
        <div className="text-[9px] text-right mt-0.5 font-mono" style={{ color: 'var(--text-3)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-[9px] font-bold mb-0.5" style={{ color: 'var(--text-2)' }}>{label}</div>
      <div className="flex gap-1 items-center">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 rounded cursor-pointer border-0 p-0" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 text-[10px] font-mono rounded px-1.5 py-1"
          style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
        />
      </div>
    </div>
  );
}

function ScaleSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center justify-between mb-0.5">
        <div className="text-[10px] font-bold" style={{ color: 'var(--text-2)' }}>{label}</div>
        <div className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-1)' }}>
          {value.toFixed(1)}×
        </div>
      </div>
      <input
        type="range"
        min={0.7}
        max={1.6}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}
