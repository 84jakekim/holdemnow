'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import {
  subscribeAllLiveSessions,
  type LiveSession,
  fmtTime,
  computeLateRegMinutes,
  useLiveCountdown,
  togglePauseSession,
  goToLevelInSession,
  addSecondsToSession,
  stopLiveSession,
  startLiveSession,
  computeFinishingGraceSec,
  FINISHING_GRACE_SEC,
} from '@/lib/live';
import { subscribeTemplates, type TournamentTemplate } from '@/lib/templates';

/**
 * 본사 모니터링 — 전국 모든 매장의 LIVE 세션을 지역별로 모아서 표시.
 * 본사 운영팀이 긴급 상황 시 직접 제어 가능 (일시정지·레벨 이동·시간 조정·종료).
 * 진행 중(running/paused/break)인 세션만 — subscribeAllLiveSessions이 이미 필터.
 */

interface StoreInfo {
  name: string;
  address?: string;
  region: string;
}

/** 주소에서 광역 단위 추출. "부산광역시 부산진구 ..." → "부산". */
function regionFromAddress(address?: string): string {
  if (!address) return '미분류';
  const first = address.trim().split(/\s+/)[0];
  if (!first) return '미분류';
  // 부산광역시·서울특별시·세종특별자치시 → 앞 2글자
  if (first.includes('광역시') || first.includes('특별시') || first.includes('특별자치시')) {
    return first.slice(0, 2);
  }
  // 강원특별자치도·전북특별자치도 → '강원'·'전북'
  if (first.includes('특별자치도')) return first.slice(0, 2);
  // 경기도·충북·전남 등 → 끝 '도' 제거
  if (first.endsWith('도') && first.length >= 2) return first.replace(/도$/, '');
  return first.slice(0, 4);
}

export default function PlatformLivePage() {
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [stores, setStores] = useState<Record<string, StoreInfo>>({});
  const [storesError, setStoresError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsedRegions, setCollapsedRegions] = useState<Record<string, boolean>>({});
  const [showStartModal, setShowStartModal] = useState(false);

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(
      (items) => {
        setSessions(items);
        setLoading(false);
      },
      () => setLoading(false),
      { includeReady: true }, // 본사 모니터링은 대기 중인 세션도 표시 (▶ 시작 버튼 제공)
    );
    return unsub;
  }, []);

  // 매장 정보(주소) fetch — 지역 분류용
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'stores'));
        const map: Record<string, StoreInfo> = {};
        snap.forEach((d) => {
          const data = d.data() as { name: string; address?: string };
          map[d.id] = {
            name: data.name,
            address: data.address,
            region: regionFromAddress(data.address),
          };
        });
        setStores(map);
        setStoresError(null);
        console.log('[platform/live] stores loaded:', Object.keys(map).length);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setStoresError(msg);
        console.error('[platform/live] stores fetch failed:', e);
      }
    })();
  }, []);

  // 지역별 그룹화
  const grouped = useMemo(() => {
    const map: Record<string, LiveSession[]> = {};
    for (const s of sessions) {
      const region = stores[s.storeId]?.region ?? '미분류';
      (map[region] ??= []).push(s);
    }
    // 지역별 정렬: 세션 수 많은 순 → 지역명 가나다순
    return Object.entries(map).sort((a, b) => {
      if (a[1].length !== b[1].length) return b[1].length - a[1].length;
      return a[0].localeCompare(b[0], 'ko');
    });
  }, [sessions, stores]);

  const totalCount = sessions.length;
  const totalRunning = sessions.filter((s) => s.status === 'running').length;
  const totalPaused = sessions.filter((s) => s.status === 'paused').length;
  const totalReady = sessions.filter((s) => s.status === 'ready').length;

  return (
    <div>
      {/* 헤더 */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">🎬 전국 LIVE 모니터링</h1>
          <p className="text-sm text-gray-500 mt-1">
            모든 매장의 진행 중인 LIVE 세션을 본사가 직접 모니터링·제어합니다.
          </p>
        </div>
        <button
          onClick={() => {
            console.log('[platform/live] "+ 새 LIVE 시작" clicked. stores:', Object.keys(stores).length, 'user role:', userDoc?.role, 'roles:', userDoc?.roles);
            setShowStartModal(true);
          }}
          className="bg-red-500 text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-red-600"
        >
          + 새 LIVE 시작
        </button>
      </div>

      {/* 진단 패널 — v0.1 디버그용 */}
      <details className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
        <summary className="cursor-pointer font-bold text-amber-900">🔍 진단 정보 (클릭하여 펼침)</summary>
        <div className="mt-2 space-y-1 text-amber-800 font-mono text-[11px]">
          <div>로그인 uid: {authState.status === 'authenticated' ? authState.user.uid : '미로그인'}</div>
          <div>이메일: {authState.status === 'authenticated' ? authState.user.email : '-'}</div>
          <div>role(단일): {userDoc?.role ?? 'unset'}</div>
          <div>roles(배열): {JSON.stringify(userDoc?.roles ?? [])}</div>
          <div>platform_admin: {hasRole(userDoc, 'platform_admin') ? '✓ 있음' : '✗ 없음'}</div>
          <div>storeId: {userDoc?.storeId ?? '-'}</div>
          <div>매장 fetched: {Object.keys(stores).length}개</div>
          <div>활성 세션: {sessions.length}개</div>
          {storesError && (
            <div className="text-red-700">❌ 매장 fetch 실패: {storesError}</div>
          )}
        </div>
      </details>

      {/* 요약 */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <Summary label="총 LIVE" value={totalCount} highlight />
        <Summary label="대기" value={totalReady} color="blue" />
        <Summary label="진행 중" value={totalRunning} color="green" />
        <Summary label="일시정지" value={totalPaused} color="amber" />
        <Summary label="지역" value={grouped.length} />
      </div>

      {/* 새 LIVE 시작 모달 */}
      {showStartModal && (
        <StartLiveModal
          storesMap={stores}
          onClose={() => setShowStartModal(false)}
        />
      )}

      {/* 결과 */}
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">로딩 중…</div>
      ) : grouped.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🎬</div>
          <div className="font-bold text-gray-900 mb-2">현재 진행 중인 LIVE가 없습니다</div>
          <div className="text-xs text-gray-500 leading-relaxed max-w-md mx-auto">
            매장 어드민에서 LIVE 시작 시 이 페이지에 즉시 노출됩니다.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([region, list]) => {
            const collapsed = collapsedRegions[region] ?? false;
            const running = list.filter((s) => s.status === 'running').length;
            const paused = list.filter((s) => s.status === 'paused').length;
            const ready = list.filter((s) => s.status === 'ready').length;
            return (
              <section key={region} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <button
                  onClick={() =>
                    setCollapsedRegions((prev) => ({ ...prev, [region]: !collapsed }))
                  }
                  className="w-full px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between text-left hover:bg-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">📍</span>
                    <span className="font-extrabold text-gray-900">{region}</span>
                    <span className="text-xs text-gray-500">
                      {list.length}개 LIVE
                      {ready > 0 ? ` · 대기 ${ready}` : ''}
                      {running > 0 ? ` · 진행 ${running}` : ''}
                      {paused > 0 ? ` · 일시정지 ${paused}` : ''}
                    </span>
                  </div>
                  <span className="text-gray-400 text-sm">{collapsed ? '▼' : '▲'}</span>
                </button>
                {!collapsed && (
                  <div className="divide-y divide-gray-100">
                    {list.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        storeAddress={stores[s.storeId]?.address}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  highlight,
  color,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  color?: 'green' | 'amber' | 'blue';
}) {
  const valColor =
    color === 'green' ? 'text-green-600'
    : color === 'amber' ? 'text-amber-600'
    : color === 'blue' ? 'text-blue-600'
    : highlight ? 'text-red-600'
    : 'text-gray-900';
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{label}</div>
      <div className={`font-mono text-xl font-extrabold ${valColor}`}>{value.toLocaleString()}</div>
    </div>
  );
}

/* ============================================================
 * 세션 한 행 — 정보 + 컨트롤 버튼
 * ========================================================== */

function SessionRow({ session, storeAddress }: { session: LiveSession; storeAddress?: string }) {
  const sec = useLiveCountdown(session);
  const [busy, setBusy] = useState(false);
  const isReady = session.status === 'ready';
  const isPaused = session.status === 'paused';
  const isRunning = session.status === 'running';
  const lateMin = computeLateRegMinutes(session, sec);
  const graceSec = computeFinishingGraceSec(session);
  const isFinishing = graceSec != null && graceSec > 0;

  // 본사 권한으로 그레이스 만료 시 자동 정리 시도 (매장 사장 부재 안전망).
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

  const wrap = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: unknown) {
      alert(`${label} 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    const verb = isReady ? '취소' : '종료';
    if (!window.confirm(`[${session.storeName}] ${session.tournamentName} LIVE를 ${verb}할까요?`)) return;
    await wrap(() => stopLiveSession(session, sec), verb);
  };

  return (
    <div className={`px-5 py-4 grid grid-cols-12 gap-4 items-center hover:bg-gray-50 ${isFinishing ? 'animate-pulse bg-orange-50' : ''}`}>
      {/* 매장 + 토너 — 4열 */}
      <div className="col-span-4 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          {isFinishing ? (
            <span className="text-[10px] font-extrabold tracking-wider text-orange-700">
              ⚠ 곧 종료 {fmtTime(graceSec)}
            </span>
          ) : isReady ? (
            <span className="text-[10px] font-extrabold tracking-wider text-blue-700">⏳ READY</span>
          ) : isPaused ? (
            <span className="text-[10px] font-extrabold tracking-wider text-amber-700">⏸ PAUSED</span>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] font-extrabold tracking-wider text-red-600">LIVE</span>
            </>
          )}
          <span className="text-sm font-bold text-gray-900 truncate">{session.storeName}</span>
        </div>
        <div className="text-xs text-gray-700 truncate">{session.tournamentName}</div>
        {storeAddress && (
          <div className="text-[10px] text-gray-400 truncate mt-0.5">📍 {storeAddress}</div>
        )}
      </div>

      {/* 핵심 지표 — 5열 */}
      <div className="col-span-5 grid grid-cols-4 gap-2 text-center">
        <div>
          <div className="text-[9px] font-bold text-gray-500 tracking-wider">남은시간</div>
          <div className={`font-mono text-base font-extrabold ${sec <= 60 && isRunning ? 'text-red-500' : isPaused ? 'text-amber-700' : 'text-gray-900'}`}>
            {fmtTime(sec)}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-bold text-gray-500 tracking-wider">레벨</div>
          <div className="text-sm font-extrabold text-gray-900">Lv {session.currentLevel}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold text-gray-500 tracking-wider">블라인드</div>
          <div className="font-mono text-sm font-bold text-gray-900">
            {session.smallBlind}/{session.bigBlind}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-bold text-gray-500 tracking-wider">인원</div>
          <div className="text-sm font-bold text-gray-900">
            {session.playersRemaining}<span className="text-[10px] text-gray-500">/{session.totalPlayers}</span>
          </div>
        </div>
      </div>

      {/* 컨트롤 — 3열 */}
      <div className="col-span-3 flex flex-wrap gap-1 justify-end">
        {isReady ? (
          <>
            <button
              onClick={() => wrap(() => togglePauseSession(session, sec), '시작')}
              disabled={busy}
              className="px-3 py-1.5 rounded text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              title="타이머 시작 (ready → running)"
            >
              ▶ 타이머 시작
            </button>
            <button
              onClick={handleStop}
              disabled={busy}
              className="px-2.5 py-1.5 rounded text-[11px] font-bold bg-red-50 hover:bg-red-100 text-red-700 disabled:opacity-40"
              title="대기 LIVE 취소"
            >
              ⏹ 취소
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => wrap(() => togglePauseSession(session, sec), isPaused ? '재개' : '일시정지')}
              disabled={busy}
              className={`px-2.5 py-1.5 rounded text-[11px] font-bold disabled:opacity-40 ${
                isPaused ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-amber-500 text-white hover:bg-amber-600'
              }`}
              title={isPaused ? '재개' : '일시정지'}
            >
              {isPaused ? '▶ 재개' : '⏸ 일시정지'}
            </button>
            <button
              onClick={() => wrap(() => goToLevelInSession(session, -1, sec), '이전 레벨')}
              disabled={busy || session.currentLevel <= 1}
              className="px-2 py-1.5 rounded text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-900 disabled:opacity-40"
              title="이전 레벨"
            >
              ◀ Lv
            </button>
            <button
              onClick={() => wrap(() => goToLevelInSession(session, 1, sec), '다음 레벨')}
              disabled={busy}
              className="px-2 py-1.5 rounded text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-900 disabled:opacity-40"
              title="다음 레벨"
            >
              Lv ▶
            </button>
            <button
              onClick={() => wrap(() => addSecondsToSession(session, sec, 60), '시간 +60s')}
              disabled={busy}
              className="px-2 py-1.5 rounded text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-900 disabled:opacity-40"
              title="+60초"
            >
              +60s
            </button>
            <button
              onClick={() => wrap(() => addSecondsToSession(session, sec, -60), '시간 -60s')}
              disabled={busy || sec <= 60}
              className="px-2 py-1.5 rounded text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-900 disabled:opacity-40"
              title="-60초"
            >
              -60s
            </button>
            <button
              onClick={handleStop}
              disabled={busy}
              className="px-2.5 py-1.5 rounded text-[11px] font-bold bg-red-50 hover:bg-red-100 text-red-700 disabled:opacity-40"
              title="LIVE 종료"
            >
              ⏹ 종료
            </button>
            {!session.lateRegClosed && lateMin > 0 && isRunning && (
              <div className="text-[10px] text-gray-500 mt-1 w-full text-right">
                등록 {lateMin}분 남음
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * 새 LIVE 시작 모달 — 매장 선택 → 템플릿 선택 → 시작
 * ========================================================== */

function StartLiveModal({
  storesMap,
  onClose,
}: {
  storesMap: Record<string, StoreInfo>;
  onClose: () => void;
}) {
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // 선택된 매장의 템플릿 구독
  useEffect(() => {
    if (!selectedStoreId) {
      setTemplates([]);
      setTemplatesError(null);
      return;
    }
    setLoadingTemplates(true);
    setTemplatesError(null);
    const unsub = subscribeTemplates(
      selectedStoreId,
      (items) => {
        setTemplates(items);
        setLoadingTemplates(false);
      },
      (err) => {
        setTemplatesError(err?.message ?? String(err));
        setLoadingTemplates(false);
      },
    );
    return unsub;
  }, [selectedStoreId]);

  // 매장 검색 필터
  const filteredStores = useMemo(() => {
    const list = Object.entries(storesMap);
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter(([, info]) =>
      info.name.toLowerCase().includes(term) ||
      (info.address ?? '').toLowerCase().includes(term),
    );
  }, [storesMap, search]);

  const selectedStore = selectedStoreId ? storesMap[selectedStoreId] : null;

  const handleStart = async (template: TournamentTemplate) => {
    if (!selectedStoreId || !selectedStore) return;
    if (!window.confirm(`[${selectedStore.name}] "${template.name}" LIVE를 시작할까요?`)) return;
    setStarting(true);
    setStartError(null);
    try {
      await startLiveSession(selectedStoreId, selectedStore.name, template);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[platform/live] startLiveSession failed:', e);
      setStartError(msg);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">새 LIVE 시작</h2>
            <p className="text-xs text-gray-500 mt-0.5">매장 선택 → 토너 템플릿 선택 → 즉시 시작</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 text-xl">✕</button>
        </div>

        <div className="flex-1 grid grid-cols-2 divide-x divide-gray-100 overflow-hidden">
          {/* 좌측: 매장 목록 */}
          <div className="flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 매장명·주소 검색"
                className="w-full bg-gray-100 rounded-lg px-3 py-2 text-sm outline-none"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredStores.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-500">매장 없음</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {filteredStores.map(([id, info]) => (
                    <button
                      key={id}
                      onClick={() => setSelectedStoreId(id)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                        selectedStoreId === id ? 'bg-amber-50' : ''
                      }`}
                    >
                      <div className="text-sm font-bold text-gray-900 truncate">{info.name}</div>
                      <div className="text-[11px] text-gray-500 truncate mt-0.5">
                        📍 {info.address ?? '주소 없음'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 우측: 템플릿 목록 */}
          <div className="flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50">
              <div className="text-[10px] font-bold text-gray-500 tracking-wider">선택된 매장</div>
              <div className="text-sm font-bold text-gray-900 truncate mt-0.5">
                {selectedStore ? selectedStore.name : '좌측에서 매장을 선택하세요'}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {!selectedStoreId ? (
                <div className="p-8 text-center text-xs text-gray-500">매장을 먼저 선택하세요</div>
              ) : loadingTemplates ? (
                <div className="p-8 text-center text-xs text-gray-500">템플릿 로딩 중…</div>
              ) : templatesError ? (
                <div className="p-4 mx-3 my-3 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700 leading-relaxed">
                  <b>템플릿 로딩 실패:</b><br />{templatesError}
                  <div className="text-[10px] text-red-500 mt-2">
                    📌 본사 권한이 firestore.rules에 적용 안 됐을 수 있습니다.
                    아래 절차로 확인:<br />
                    1. 로그아웃 후 다시 로그인 (토큰 갱신)<br />
                    2. /platform 사이드바 메뉴에서 다른 페이지 갔다가 다시 옴<br />
                    3. 새 rules 배포가 끝났는지 확인
                  </div>
                </div>
              ) : templates.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500">
                  이 매장에 등록된 토너 템플릿이 없습니다.
                  <div className="mt-2 text-[10px] text-gray-400">
                    매장 사장이 먼저 토너 템플릿을 등록해야 합니다.
                  </div>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleStart(t)}
                      disabled={starting}
                      className="w-full text-left bg-white border border-gray-200 hover:border-red-400 hover:bg-red-50 rounded-xl p-3 transition disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="text-sm font-extrabold text-gray-900">{t.name}</div>
                        <span className="text-[10px] bg-gray-100 text-gray-700 rounded px-1.5 py-0.5 font-bold">
                          {t.type}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-600 grid grid-cols-3 gap-2">
                        <div>
                          <div className="text-[9px] font-bold text-gray-400">바이인</div>
                          <div className="font-mono font-bold">₩{t.buyIn.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-gray-400">총인원</div>
                          <div className="font-bold">{t.totalPlayers}명</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-gray-400">레벨 수</div>
                          <div className="font-bold">{t.blindStructure.length}</div>
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-red-600 font-bold">▶ 클릭하면 LIVE 시작</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {startError && (
          <div className="mx-4 mb-3 bg-red-50 border border-red-200 rounded-lg p-3 text-[11px] text-red-700">
            <b>LIVE 시작 실패:</b> {startError}
          </div>
        )}

        <div className="p-4 border-t border-gray-100 flex items-center justify-between">
          <div className="text-[11px] text-gray-500">
            💡 본사 권한으로 시작 — 매장에 사장 부재 시 대체 운영용
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg border-[1.5px] border-gray-200 font-bold text-sm"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
