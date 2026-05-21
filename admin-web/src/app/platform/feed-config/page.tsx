'use client';

/**
 * /platform/feed-config — 본사 어드민의 "오늘의 소식" 피드 반경 컨트롤
 *
 * 목적 (2026-05-22 신설, PRD: 채팅방 페이지 인프라):
 *  - /m/posts 채팅방의 디폴트 반경과 사용자 드롭다운 옵션을 코드 배포 없이 조정.
 *  - 슬라이더로 디폴트 반경을 잡으면 즉시 메트릭 미리보기 갱신 → 저장.
 *
 * 미리보기 메트릭:
 *  - 반경 안 활성 매장 수 (stores where status='active' && lat/lng 보유 && 거리<=반경)
 *  - 24h 새 글 수 (posts collectionGroup, createdAt >= now-24h)
 *  - 추정 빈상태율: 매장 수가 적을수록 위험 — 5건 미만이면 경고 톤.
 *
 * 본사 기준 좌표 = 부산역 (lat 35.115, lng 129.0395)
 *  - 본사 카톡방이 부산·경남 중심이므로 미리보기 메트릭의 기준점.
 *  - 향후 본사 좌표를 별도 컬렉션으로 분리하면 더 정확하지만 v0.1은 하드코딩.
 *
 * Firestore rules:
 *  - meta/feedConfig — read public, write platform_admin
 *  - feedConfigHistory — platform_admin 전용 read/create
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

interface PreviewMetrics {
  storesInRadius: number;
  totalActiveStores: number;
  postsLast24h: number;
  loading: boolean;
  loadedAt?: number;
}

interface StoreCoord { id: string; lat: number; lng: number; status?: string; }

export default function FeedConfigPage() {
  const auth = useAuth();
  const actorUid = auth.status === 'authenticated' ? auth.user.uid : '';
  const actorEmail = auth.status === 'authenticated' ? (auth.user.email ?? '') : '';

  const [cfg, setCfg] = useState<FeedConfig>(FEED_CONFIG_DEFAULT);
  const [draftDefault, setDraftDefault] = useState<number>(FEED_CONFIG_DEFAULT.defaultRadiusKm);
  const [draftOptions, setDraftOptions] = useState<number[]>(FEED_CONFIG_DEFAULT.radiusOptions);
  const [optionInput, setOptionInput] = useState<string>('');
  const [prevConfig, setPrevConfig] = useState<FeedConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 메트릭 캐시 — 매장 좌표는 한 번만 fetch (~1초)
  const [storeCoords, setStoreCoords] = useState<StoreCoord[]>([]);
  const [metrics, setMetrics] = useState<PreviewMetrics>({
    storesInRadius: 0,
    totalActiveStores: 0,
    postsLast24h: 0,
    loading: true,
  });

  // 1) feedConfig 실시간 구독
  useEffect(() => {
    return subscribeFeedConfig(
      (next) => {
        setCfg(next);
        // 첫 로드 또는 외부 변경 시에만 draft 동기화 (사용자 편집 중에는 덮어쓰지 않음)
        setDraftDefault((d) => (d === FEED_CONFIG_DEFAULT.defaultRadiusKm && !prevConfig ? next.defaultRadiusKm : d));
        setDraftOptions((arr) => (arr === FEED_CONFIG_DEFAULT.radiusOptions && !prevConfig ? next.radiusOptions : arr));
      },
      (e) => setError(e.message),
    );
    // prevConfig는 사용자가 저장한 직후 갱신되므로 effect dep에서 제외 (의도적)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 첫 진입 시 draft를 현재 값으로 동기화
  useEffect(() => {
    setDraftDefault(cfg.defaultRadiusKm);
    setDraftOptions(cfg.radiusOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) 매장 좌표 일괄 fetch — status='active' 한정. lat/lng 있는 것만.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'stores'), where('status', '==', 'active')));
        if (cancelled) return;
        const arr: StoreCoord[] = [];
        snap.forEach((d) => {
          const data = d.data() as { lat?: number; lng?: number; status?: string };
          if (typeof data.lat === 'number' && typeof data.lng === 'number') {
            arr.push({ id: d.id, lat: data.lat, lng: data.lng, status: data.status });
          }
        });
        setStoreCoords(arr);
      } catch (e) {
        if (!cancelled) setError(`매장 좌표 로딩 실패: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 3) 24h 새 글 수 — collectionGroup('posts'), status='published' && createdAt >= now-24h
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
        if (cancelled) return;
        setMetrics((m) => ({ ...m, postsLast24h: snap.size, loading: false, loadedAt: Date.now() }));
      } catch (e) {
        if (!cancelled) {
          setMetrics((m) => ({ ...m, loading: false, loadedAt: Date.now() }));
          setError((prev) => prev ?? `24h 글 수 로딩 실패: ${(e as Error).message}`);
        }
      }
    })();
  }, []);

  // 4) 슬라이더 변경 시 반경 안 매장 수 즉시 재계산 (클라 메모리만, Firestore 호출 없음)
  const storesInRadius = useMemo(() => {
    if (draftDefault >= MAX_RADIUS_KM) return storeCoords.length;
    const meters = draftDefault * 1000;
    return storeCoords.filter((s) => haversineMeters(HQ_ORIGIN, { lat: s.lat, lng: s.lng }) <= meters).length;
  }, [draftDefault, storeCoords]);

  useEffect(() => {
    setMetrics((m) => ({ ...m, storesInRadius, totalActiveStores: storeCoords.length }));
  }, [storesInRadius, storeCoords.length]);

  const hasChanges = useMemo(() => {
    if (draftDefault !== cfg.defaultRadiusKm) return true;
    if (draftOptions.length !== cfg.radiusOptions.length) return true;
    return draftOptions.some((v, i) => v !== cfg.radiusOptions[i]);
  }, [draftDefault, draftOptions, cfg]);

  const onSave = async () => {
    if (!actorUid) { setError('로그인 필요'); return; }
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      setPrevConfig(cfg); // 직전 값 저장 → 롤백 가능
      await saveFeedConfig(
        { defaultRadiusKm: draftDefault, radiusOptions: draftOptions },
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

  const onRollback = async () => {
    if (!prevConfig) return;
    setSaving(true);
    setError(null);
    try {
      await saveFeedConfig(
        {
          defaultRadiusKm: prevConfig.defaultRadiusKm,
          radiusOptions: prevConfig.radiusOptions,
        },
        { actorUid, actorEmail, reason: '롤백' },
      );
      setDraftDefault(prevConfig.defaultRadiusKm);
      setDraftOptions(prevConfig.radiusOptions);
      setPrevConfig(null);
      setSavedMsg('직전 값으로 복원되었습니다');
      window.setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) {
      setError(`롤백 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const addOption = () => {
    const n = Number(optionInput);
    if (!Number.isFinite(n) || n < 1 || n > MAX_RADIUS_KM) {
      setError('1~999 사이 km를 입력하세요 (999=전국)');
      return;
    }
    if (draftOptions.includes(Math.round(n))) return;
    setDraftOptions((arr) => Array.from(new Set([...arr, Math.round(n)])).sort((a, b) => a - b));
    setOptionInput('');
    setError(null);
  };

  const removeOption = (v: number) => {
    if (draftOptions.length <= 1) {
      setError('옵션은 최소 1개 이상 유지해야 합니다');
      return;
    }
    setDraftOptions((arr) => arr.filter((x) => x !== v));
  };

  const emptyStateRisk = metrics.storesInRadius < 5;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* 헤더 */}
      <header>
        <h1 className="text-xl font-extrabold mb-1" style={{ color: 'var(--text-1)' }}>
          📍 채팅방 반경 설정
        </h1>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
          /m/posts 채팅방의 디폴트 반경과 사용자 드롭다운 옵션을 관리합니다.
          저장 즉시 모든 모바일 클라이언트에 반영됩니다.
        </p>
      </header>

      {/* 디폴트 반경 슬라이더 */}
      <section
        className="rounded-2xl p-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
            첫 진입 디폴트 반경
          </h2>
          <span
            className="text-2xl font-extrabold"
            style={{ color: emptyStateRisk ? 'var(--warning, #E03030)' : 'var(--gold)' }}
          >
            {formatRadiusKm(draftDefault)}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={MAX_RADIUS_KM}
          step={1}
          value={draftDefault}
          onChange={(e) => setDraftDefault(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: 'var(--gold)' }}
          aria-label="디폴트 반경 슬라이더"
        />
        <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
          <span>1km</span>
          <span>100km</span>
          <span>전국(999)</span>
        </div>

        {/* 메트릭 미리보기 */}
        <div className="grid grid-cols-3 gap-2 mt-5">
          <Metric
            label="반경 안 매장"
            value={metrics.loading ? '…' : `${metrics.storesInRadius}곳`}
            sub={`전체 ${metrics.totalActiveStores}곳 중`}
            danger={emptyStateRisk}
          />
          <Metric
            label="24h 새 글"
            value={metrics.loading ? '…' : `${metrics.postsLast24h}건`}
            sub="전국 기준"
          />
          <Metric
            label="빈상태 위험"
            value={emptyStateRisk ? '높음' : '낮음'}
            sub={emptyStateRisk ? '<5곳' : '5곳 이상'}
            danger={emptyStateRisk}
          />
        </div>
      </section>

      {/* 옵션 관리 */}
      <section
        className="rounded-2xl p-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>
          사용자 드롭다운 옵션
        </h2>
        <p className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>
          사용자가 직접 고를 수 있는 반경 옵션입니다. 999는 "전국"으로 표시됩니다.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {draftOptions.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => removeOption(v)}
              className="rounded-full text-xs font-semibold px-3 py-1.5 transition active:scale-95"
              style={{
                background: v === draftDefault ? 'var(--gold)' : 'var(--surface-2)',
                color: v === draftDefault ? '#0F1419' : 'var(--text-1)',
                border: '1px solid var(--border)',
              }}
              aria-label={`옵션 ${v}km 제거`}
              title={v === draftDefault ? '현재 디폴트' : '클릭하여 제거'}
            >
              {formatRadiusKm(v)} {v === draftDefault ? '★' : '✕'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_RADIUS_KM}
            placeholder="km 입력 (1~999)"
            value={optionInput}
            onChange={(e) => setOptionInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addOption(); }}
            className="rounded-lg px-3 py-2 text-sm flex-1"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
              border: '1px solid var(--border)',
            }}
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
      </section>

      {/* 액션 */}
      <section className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={!hasChanges || saving}
          className="rounded-xl px-6 py-3 text-sm font-bold disabled:opacity-40"
          style={{ background: 'var(--gold)', color: '#0F1419' }}
        >
          {saving ? '저장 중…' : '저장 (즉시 반영)'}
        </button>
        {prevConfig && (
          <button
            type="button"
            onClick={onRollback}
            disabled={saving}
            className="rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-40"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
              border: '1px solid var(--border)',
            }}
            title="이 세션에서 마지막으로 저장한 값으로 되돌립니다"
          >
            ↶ 직전 값으로 롤백
          </button>
        )}
        {savedMsg && (
          <span className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>
            ✓ {savedMsg}
          </span>
        )}
        {error && (
          <span className="text-xs font-semibold" style={{ color: '#E03030' }}>
            ⚠ {error}
          </span>
        )}
      </section>

      {/* 현재 적용 값 (읽기 전용 카드) */}
      <section
        className="rounded-2xl p-4 text-xs"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
      >
        <div className="font-bold mb-1" style={{ color: 'var(--text-1)' }}>현재 적용 중인 값</div>
        <div>디폴트: <b>{formatRadiusKm(cfg.defaultRadiusKm)}</b></div>
        <div>옵션: {cfg.radiusOptions.map(formatRadiusKm).join(' · ')}</div>
        {cfg.updatedAt && (
          <div className="mt-1" style={{ color: 'var(--text-3)' }}>
            최근 업데이트: {cfg.updatedAt.toDate().toLocaleString('ko-KR')}
          </div>
        )}
      </section>
    </div>
  );
}

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
      {sub && (
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</div>
      )}
    </div>
  );
}
