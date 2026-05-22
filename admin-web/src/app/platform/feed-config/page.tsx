'use client';

/**
 * /platform/feed-config — 본사 어드민 사용자 반경 설정
 *
 * 3 섹션 카드:
 *  1) 💬 채팅방 반경 (/m/posts) — 디폴트 + 옵션 + 매장수·24h 글수 미리보기
 *  2) ⭐ 내 주변 인기 매장 (/m/find 인기 매장 섹션) — 디폴트 + 옵션 + 자동확장
 *  3) 📍 내 주변 매장 (/m/find 매장 리스트) — 디폴트 + 옵션 + 자동확장
 *
 * 단일 doc(meta/feedConfig) 머지 저장. 모든 모바일 클라이언트에 즉시 반영.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  FEED_CONFIG_DEFAULT,
  formatRadiusKm,
  saveFeedConfig,
  subscribeFeedConfig,
  type FeedConfig,
} from '@/lib/feedConfig';
import {
  collection,
  collectionGroup,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { haversineMeters } from '@/lib/geo';
import { useAuth } from '@/lib/hooks';

const HQ_ORIGIN = { lat: 35.115, lng: 129.0395 }; // 부산역 — 본사 카톡방 기준점
const MAX_RADIUS_KM = 999;

interface StoreCoord { id: string; lat: number; lng: number; }

export default function FeedConfigPage() {
  const auth = useAuth();
  const actorUid = auth.status === 'authenticated' ? auth.user.uid : '';
  const actorEmail = auth.status === 'authenticated' ? (auth.user.email ?? '') : '';

  const [cfg, setCfg] = useState<FeedConfig>(FEED_CONFIG_DEFAULT);
  const [loaded, setLoaded] = useState(false);

  // ─── draft state — 3 섹션 ───
  // 1) 채팅방
  const [chatDefault, setChatDefault] = useState<number>(FEED_CONFIG_DEFAULT.defaultRadiusKm);
  const [chatOptions, setChatOptions] = useState<number[]>(FEED_CONFIG_DEFAULT.radiusOptions);
  // 2) 인기 매장
  const [popularDefault, setPopularDefault] = useState<number>(FEED_CONFIG_DEFAULT.popularRadiusDefaultKm);
  const [popularOptions, setPopularOptions] = useState<number[]>(FEED_CONFIG_DEFAULT.popularRadiusOptionsKm);
  const [popularAuto, setPopularAuto] = useState<boolean>(FEED_CONFIG_DEFAULT.popularAutoExpand);
  const [popularAutoMax, setPopularAutoMax] = useState<number>(FEED_CONFIG_DEFAULT.popularAutoExpandMaxKm);
  // 3) 주변 매장
  const [nearbyDefault, setNearbyDefault] = useState<number>(FEED_CONFIG_DEFAULT.nearbyRadiusDefaultKm);
  const [nearbyOptions, setNearbyOptions] = useState<number[]>(FEED_CONFIG_DEFAULT.nearbyRadiusOptionsKm);
  const [nearbyAuto, setNearbyAuto] = useState<boolean>(FEED_CONFIG_DEFAULT.nearbyAutoExpand);
  const [nearbyAutoMax, setNearbyAutoMax] = useState<number>(FEED_CONFIG_DEFAULT.nearbyAutoExpandMaxKm);

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 채팅방 메트릭
  const [storeCoords, setStoreCoords] = useState<StoreCoord[]>([]);
  const [postsLast24h, setPostsLast24h] = useState<number | null>(null);

  // 1) feedConfig 구독 + 최초 1회 draft 동기화
  useEffect(() => {
    return subscribeFeedConfig(
      (next) => {
        setCfg(next);
        if (!loaded) {
          setChatDefault(next.defaultRadiusKm);
          setChatOptions(next.radiusOptions);
          setPopularDefault(next.popularRadiusDefaultKm);
          setPopularOptions(next.popularRadiusOptionsKm);
          setPopularAuto(next.popularAutoExpand);
          setPopularAutoMax(next.popularAutoExpandMaxKm);
          setNearbyDefault(next.nearbyRadiusDefaultKm);
          setNearbyOptions(next.nearbyRadiusOptionsKm);
          setNearbyAuto(next.nearbyAutoExpand);
          setNearbyAutoMax(next.nearbyAutoExpandMaxKm);
          setLoaded(true);
        }
      },
      (e) => setError(e.message),
    );
  }, [loaded]);

  // 매장 좌표 1회 fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'stores'), where('status', '==', 'active')));
        if (cancelled) return;
        const arr: StoreCoord[] = [];
        snap.forEach((d) => {
          const data = d.data() as { lat?: number; lng?: number };
          if (typeof data.lat === 'number' && typeof data.lng === 'number') {
            arr.push({ id: d.id, lat: data.lat, lng: data.lng });
          }
        });
        setStoreCoords(arr);
      } catch (e) {
        if (!cancelled) setError(`매장 좌표 로딩 실패: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 24h 새 글 수
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
        const q = query(
          collectionGroup(db, 'posts'),
          where('status', '==', 'published'),
          where('createdAt', '>=', since),
          orderBy('createdAt', 'desc'),
          limit(100),
        );
        const snap = await getDocs(q);
        if (!cancelled) setPostsLast24h(snap.size);
      } catch {
        if (!cancelled) setPostsLast24h(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const chatStoresInRadius = useMemo(() => {
    if (chatDefault >= MAX_RADIUS_KM) return storeCoords.length;
    const meters = chatDefault * 1000;
    return storeCoords.filter((s) => haversineMeters(HQ_ORIGIN, s) <= meters).length;
  }, [chatDefault, storeCoords]);
  const chatEmptyRisk = chatStoresInRadius < 5;

  const hasChanges = useMemo(() => {
    if (!loaded) return false;
    const eqArr = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    return (
      chatDefault !== cfg.defaultRadiusKm ||
      !eqArr(chatOptions, cfg.radiusOptions) ||
      popularDefault !== cfg.popularRadiusDefaultKm ||
      !eqArr(popularOptions, cfg.popularRadiusOptionsKm) ||
      popularAuto !== cfg.popularAutoExpand ||
      popularAutoMax !== cfg.popularAutoExpandMaxKm ||
      nearbyDefault !== cfg.nearbyRadiusDefaultKm ||
      !eqArr(nearbyOptions, cfg.nearbyRadiusOptionsKm) ||
      nearbyAuto !== cfg.nearbyAutoExpand ||
      nearbyAutoMax !== cfg.nearbyAutoExpandMaxKm
    );
  }, [
    loaded, cfg,
    chatDefault, chatOptions,
    popularDefault, popularOptions, popularAuto, popularAutoMax,
    nearbyDefault, nearbyOptions, nearbyAuto, nearbyAutoMax,
  ]);

  const onSave = async () => {
    if (!actorUid) { setError('로그인 필요'); return; }
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      await saveFeedConfig(
        {
          defaultRadiusKm: chatDefault,
          radiusOptions: chatOptions,
          popularRadiusDefaultKm: popularDefault,
          popularRadiusOptionsKm: popularOptions,
          popularAutoExpand: popularAuto,
          popularAutoExpandMaxKm: popularAutoMax,
          nearbyRadiusDefaultKm: nearbyDefault,
          nearbyRadiusOptionsKm: nearbyOptions,
          nearbyAutoExpand: nearbyAuto,
          nearbyAutoExpandMaxKm: nearbyAutoMax,
        },
        { actorUid, actorEmail },
      );
      setSavedMsg('저장 완료 — 모바일 클라이언트에 즉시 반영됩니다');
      window.setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) {
      setError(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* 헤더 */}
      <header>
        <h1 className="text-xl font-extrabold mb-1" style={{ color: 'var(--text-1)' }}>
          📍 반경 설정
        </h1>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
          채팅방 · 내 주변 인기 매장 · 내 주변 매장 — 모바일 사용자에게 노출되는 거리 정책을
          한 곳에서 관리합니다. 저장 즉시 모든 클라이언트에 반영.
        </p>
      </header>

      {/* 섹션 1 — 채팅방 반경 */}
      <RadiusSectionCard
        icon="💬"
        title="채팅방 반경"
        subtitle="/m/posts (오늘의 매장 소식 채팅방)"
        defaultKm={chatDefault}
        onDefault={setChatDefault}
        options={chatOptions}
        onOptions={setChatOptions}
        showSlider
        sliderMax={MAX_RADIUS_KM}
        sliderHint={chatEmptyRisk ? '반경 안 매장이 5곳 미만 — 빈상태 위험' : undefined}
      >
        <div className="grid grid-cols-3 gap-2 mt-4">
          <Metric label="반경 안 매장" value={`${chatStoresInRadius}곳`} sub={`전체 ${storeCoords.length}곳`} danger={chatEmptyRisk} />
          <Metric label="24h 새 글" value={postsLast24h == null ? '…' : `${postsLast24h}건`} sub="전국 기준" />
          <Metric label="빈상태 위험" value={chatEmptyRisk ? '높음' : '낮음'} sub={chatEmptyRisk ? '<5곳' : '5곳 이상'} danger={chatEmptyRisk} />
        </div>
      </RadiusSectionCard>

      {/* 섹션 2 — 내 주변 인기 매장 */}
      <RadiusSectionCard
        icon="⭐"
        title="내 주변 인기 매장"
        subtitle="/m/find 인기 매장 섹션 · LIVE 가중치 정렬"
        defaultKm={popularDefault}
        onDefault={setPopularDefault}
        options={popularOptions}
        onOptions={setPopularOptions}
        sliderMax={100}
        showSlider
      >
        <AutoExpandRow
          enabled={popularAuto}
          onToggle={setPopularAuto}
          maxKm={popularAutoMax}
          onMaxKm={setPopularAutoMax}
          defaultKm={popularDefault}
        />
      </RadiusSectionCard>

      {/* 섹션 3 — 내 주변 매장 */}
      <RadiusSectionCard
        icon="📍"
        title="내 주변 매장"
        subtitle="/m/find 매장 리스트 + 지도 모드"
        defaultKm={nearbyDefault}
        onDefault={setNearbyDefault}
        options={nearbyOptions}
        onOptions={setNearbyOptions}
        sliderMax={200}
        showSlider
      >
        <AutoExpandRow
          enabled={nearbyAuto}
          onToggle={setNearbyAuto}
          maxKm={nearbyAutoMax}
          onMaxKm={setNearbyAutoMax}
          defaultKm={nearbyDefault}
        />
      </RadiusSectionCard>

      {/* 액션 */}
      <section className="flex items-center gap-3 sticky bottom-4 z-10">
        <button
          type="button"
          onClick={onSave}
          disabled={!hasChanges || saving}
          className="rounded-xl px-6 py-3 text-sm font-bold disabled:opacity-40"
          style={{ background: 'var(--gold)', color: '#0F1419', boxShadow: '0 4px 14px rgba(0,0,0,0.15)' }}
        >
          {saving ? '저장 중…' : '저장 (3 섹션 일괄 · 즉시 반영)'}
        </button>
        {savedMsg && <span className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>✓ {savedMsg}</span>}
        {error && <span className="text-xs font-semibold" style={{ color: '#E03030' }}>⚠ {error}</span>}
      </section>

      {/* 현재 적용 값 (요약) */}
      <section
        className="rounded-2xl p-4 text-xs"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
      >
        <div className="font-bold mb-2" style={{ color: 'var(--text-1)' }}>현재 적용 중인 값</div>
        <div className="space-y-1">
          <div>💬 채팅방: <b>{formatRadiusKm(cfg.defaultRadiusKm)}</b> · {cfg.radiusOptions.map(formatRadiusKm).join(' · ')}</div>
          <div>⭐ 인기 매장: <b>{formatRadiusKm(cfg.popularRadiusDefaultKm)}</b> · {cfg.popularRadiusOptionsKm.map(formatRadiusKm).join(' · ')} · 자동확장 {cfg.popularAutoExpand ? `ON(최대 ${formatRadiusKm(cfg.popularAutoExpandMaxKm)})` : 'OFF'}</div>
          <div>📍 주변 매장: <b>{formatRadiusKm(cfg.nearbyRadiusDefaultKm)}</b> · {cfg.nearbyRadiusOptionsKm.map(formatRadiusKm).join(' · ')} · 자동확장 {cfg.nearbyAutoExpand ? `ON(최대 ${formatRadiusKm(cfg.nearbyAutoExpandMaxKm)})` : 'OFF'}</div>
        </div>
        {cfg.updatedAt && (
          <div className="mt-2" style={{ color: 'var(--text-3)' }}>
            최근 업데이트: {cfg.updatedAt.toDate().toLocaleString('ko-KR')}
          </div>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 섹션 카드 (3개 공통)
 * ─────────────────────────────────────────────────────────────*/

function RadiusSectionCard({
  icon,
  title,
  subtitle,
  defaultKm,
  onDefault,
  options,
  onOptions,
  showSlider,
  sliderMax,
  sliderHint,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  defaultKm: number;
  onDefault: (n: number) => void;
  options: number[];
  onOptions: (arr: number[]) => void;
  showSlider?: boolean;
  sliderMax: number;
  sliderHint?: string;
  children?: React.ReactNode;
}) {
  const [optionInput, setOptionInput] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const addOption = () => {
    const n = Number(optionInput);
    if (!Number.isFinite(n) || n < 1 || n > MAX_RADIUS_KM) {
      setErr('1~999 사이 km를 입력하세요');
      return;
    }
    const rounded = Math.round(n);
    if (options.includes(rounded)) return;
    onOptions(Array.from(new Set([...options, rounded])).sort((a, b) => a - b));
    setOptionInput('');
    setErr(null);
  };

  const removeOption = (v: number) => {
    if (options.length <= 1) {
      setErr('옵션은 최소 1개 이상 유지해야 합니다');
      return;
    }
    onOptions(options.filter((x) => x !== v));
  };

  return (
    <section
      className="rounded-2xl p-5"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-baseline justify-between mb-1 flex-wrap">
        <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          {title}
        </h2>
        <span className="text-xl font-extrabold" style={{ color: 'var(--gold)' }}>
          {formatRadiusKm(defaultKm)}
        </span>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>{subtitle}</p>

      {showSlider && (
        <>
          <input
            type="range"
            min={1}
            max={sliderMax}
            step={1}
            value={Math.min(defaultKm, sliderMax)}
            onChange={(e) => onDefault(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'var(--gold)' }}
            aria-label={`${title} 디폴트 반경`}
          />
          <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
            <span>1km</span>
            <span>{sliderMax}km</span>
          </div>
          {sliderHint && (
            <div className="text-[11px] mt-1" style={{ color: '#E03030' }}>⚠ {sliderHint}</div>
          )}
        </>
      )}

      {/* 옵션 칩 */}
      <div className="mt-4">
        <div className="text-[11px] font-bold mb-2" style={{ color: 'var(--text-2)' }}>사용자 드롭다운 옵션</div>
        <div className="flex flex-wrap gap-2 mb-2">
          {options.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => removeOption(v)}
              className="rounded-full text-xs font-semibold px-3 py-1.5 transition active:scale-95"
              style={{
                background: v === defaultKm ? 'var(--gold)' : 'var(--surface-2)',
                color: v === defaultKm ? '#0F1419' : 'var(--text-1)',
                border: '1px solid var(--border)',
              }}
              title={v === defaultKm ? '현재 디폴트' : '클릭하여 제거'}
            >
              {formatRadiusKm(v)} {v === defaultKm ? '★' : '✕'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_RADIUS_KM}
            placeholder="km 입력"
            value={optionInput}
            onChange={(e) => setOptionInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addOption(); }}
            className="rounded-lg px-3 py-2 text-sm flex-1"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          />
          <button
            type="button"
            onClick={addOption}
            className="rounded-lg px-4 py-2 text-sm font-bold"
            style={{ background: 'var(--gold)', color: '#0F1419' }}
          >
            추가
          </button>
        </div>
        {err && <div className="text-[11px] mt-1" style={{ color: '#E03030' }}>{err}</div>}
      </div>

      {children}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 자동확장 토글 행 (인기·주변 섹션 공통)
 * ─────────────────────────────────────────────────────────────*/

function AutoExpandRow({
  enabled,
  onToggle,
  maxKm,
  onMaxKm,
  defaultKm,
}: {
  enabled: boolean;
  onToggle: (b: boolean) => void;
  maxKm: number;
  onMaxKm: (n: number) => void;
  defaultKm: number;
}) {
  return (
    <div
      className="mt-4 rounded-xl p-3 flex items-center gap-3 flex-wrap"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4"
          style={{ accentColor: 'var(--gold)' }}
        />
        <div className="min-w-0">
          <div className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>자동확장</div>
          <div className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
            반경 안 결과가 적으면 단계적으로 확장
          </div>
        </div>
      </label>
      <div className="flex items-center gap-1.5">
        <label className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>최대</label>
        <input
          type="number"
          min={defaultKm}
          max={500}
          value={maxKm}
          onChange={(e) => onMaxKm(Math.max(defaultKm, Math.min(500, Number(e.target.value) || defaultKm)))}
          disabled={!enabled}
          className="w-20 rounded-lg px-2 py-1.5 text-sm font-bold tabular-nums disabled:opacity-40"
          style={{ background: 'var(--surface-1)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
        />
        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>km</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Metric 카드 (채팅방 미리보기용)
 * ─────────────────────────────────────────────────────────────*/

function Metric({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: 'var(--surface-2)',
        border: `1px solid ${danger ? 'rgba(224,48,48,0.4)' : 'var(--border)'}`,
      }}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>
        {label}
      </div>
      <div className="text-lg font-extrabold" style={{ color: danger ? '#E03030' : 'var(--text-1)' }}>
        {value}
      </div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  );
}
