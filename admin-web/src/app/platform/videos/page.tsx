'use client';

/**
 * /platform/videos — 인기 유튜브 영상 큐레이션 설정
 *
 * 본사 어드민:
 *  - 포함/제외 키워드, 갯수, 실행 시각, 쇼츠 제외, 최소 길이, 최대 나이 설정
 *  - 마지막 실행 결과 확인
 *  - 즉시 실행 버튼 (triggerYoutubeCurationNow Callable)
 *
 * 매시 정각 실행되는 curateHotVideos Cloud Function이 이 doc을 읽고,
 * scheduleHourKst와 KST 현재 시각이 일치할 때만 실제 큐레이션 수행.
 */

import { useEffect, useMemo, useState } from 'react';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { app } from '@/lib/firebase';
import {
  DEFAULT_CURATION_CONFIG,
  formatKeywordsText,
  parseKeywordsText,
  saveCurationConfig,
  subscribeCurationConfig,
  type YoutubeCurationConfig,
  type YoutubeCurationLastRunResult,
} from '@/lib/curationConfig';
import {
  addManualVideo,
  deleteManualVideo,
  fetchYoutubeOembed,
  shiftManualVideoPriority,
  subscribeAllHotVideos,
  updateManualVideoPriority,
} from '@/lib/hotVideos';
import { useAuth } from '@/lib/hooks';
import { extractYoutubeVideoId, youtubeThumbnailUrl } from '@/lib/youtube';
import type { HotYoutubeVideo } from '@/lib/homeContent';

interface FormState {
  includeText: string;
  excludeText: string;
  maxResults: number;
  scheduleHourKst: number;
  excludeShorts: boolean;
  minDurationSec: number;
  maxAgeDays: number;
  refreshIntervalDays: number;
  expirePreviousOnRefresh: boolean;
  autoVideoMaxAgeDays: number;
}

function configToForm(cfg: YoutubeCurationConfig): FormState {
  return {
    includeText: formatKeywordsText(cfg.includeKeywords),
    excludeText: formatKeywordsText(cfg.excludeKeywords),
    maxResults: cfg.maxResults,
    scheduleHourKst: cfg.scheduleHourKst,
    excludeShorts: cfg.excludeShorts,
    minDurationSec: cfg.minDurationSec,
    maxAgeDays: cfg.maxAgeDays,
    refreshIntervalDays: cfg.refreshIntervalDays ?? 1,
    expirePreviousOnRefresh: cfg.expirePreviousOnRefresh ?? true,
    autoVideoMaxAgeDays: cfg.autoVideoMaxAgeDays ?? 7,
  };
}

function clampInt(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function fmtDate(t?: { toDate?: () => Date } | null): string {
  if (!t || typeof t.toDate !== 'function') return '-';
  return t.toDate().toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDurationMs(ms?: number): string {
  if (!ms || ms <= 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  return `${m}분 ${s % 60}초`;
}

export default function PlatformVideosPage() {
  const [config, setConfig] = useState<YoutubeCurationConfig | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeCurationConfig(
      (cfg) => {
        setConfig(cfg);
        setForm((prev) => (prev === null ? configToForm(cfg) : prev));
      },
      (e) => setError(e.message),
    );
    return unsub;
  }, []);

  const dirty = useMemo(() => {
    if (!config || !form) return false;
    const cur = configToForm(config);
    return (
      cur.includeText !== form.includeText ||
      cur.excludeText !== form.excludeText ||
      cur.maxResults !== form.maxResults ||
      cur.scheduleHourKst !== form.scheduleHourKst ||
      cur.excludeShorts !== form.excludeShorts ||
      cur.minDurationSec !== form.minDurationSec ||
      cur.maxAgeDays !== form.maxAgeDays ||
      cur.refreshIntervalDays !== form.refreshIntervalDays ||
      cur.expirePreviousOnRefresh !== form.expirePreviousOnRefresh ||
      cur.autoVideoMaxAgeDays !== form.autoVideoMaxAgeDays
    );
  }, [config, form]);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await saveCurationConfig({
        includeKeywords: parseKeywordsText(form.includeText),
        excludeKeywords: parseKeywordsText(form.excludeText),
        maxResults: clampInt(form.maxResults, 5, 50, DEFAULT_CURATION_CONFIG.maxResults),
        scheduleHourKst: clampInt(
          form.scheduleHourKst,
          0,
          23,
          DEFAULT_CURATION_CONFIG.scheduleHourKst,
        ),
        excludeShorts: !!form.excludeShorts,
        minDurationSec: clampInt(
          form.minDurationSec,
          0,
          7200,
          DEFAULT_CURATION_CONFIG.minDurationSec,
        ),
        maxAgeDays: clampInt(form.maxAgeDays, 1, 365, DEFAULT_CURATION_CONFIG.maxAgeDays),
        refreshIntervalDays: clampInt(
          form.refreshIntervalDays,
          1,
          90,
          DEFAULT_CURATION_CONFIG.refreshIntervalDays,
        ),
        expirePreviousOnRefresh: !!form.expirePreviousOnRefresh,
        autoVideoMaxAgeDays: clampInt(
          form.autoVideoMaxAgeDays,
          1,
          90,
          DEFAULT_CURATION_CONFIG.autoVideoMaxAgeDays ?? 7,
        ),
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    if (!window.confirm('기본값으로 초기화할까요? (저장 전까지는 적용 안 됨)')) return;
    setForm(configToForm({ ...DEFAULT_CURATION_CONFIG }));
  };

  const handleRunNow = async () => {
    if (
      !window.confirm(
        '지금 즉시 큐레이션을 실행할까요? YouTube Data API 쿼터를 소모합니다.',
      )
    )
      return;
    setRunning(true);
    setRunMessage(null);
    setError(null);
    try {
      const functions = getFunctions(app, 'asia-northeast3');
      const fn = httpsCallable<
        Record<string, never>,
        {
          upserted: number;
          expiredDeleted: number;
          durationMs: number;
          channelsActive: number;
          videoIdsCollected: number;
          apiResponses: number;
          filtered: {
            shortsExcluded: number;
            keywordExcluded: number;
            ageExcluded: number;
            minDurationExcluded: number;
            maxResultsCut: number;
          };
          message?: string;
        }
      >(functions, 'triggerYoutubeCurationNow');
      const res = await fn({});
      const d = res.data;
      setRunMessage(
        `완료 — 큐레이션 ${d.upserted}개 / 삭제 ${d.expiredDeleted}개 / ` +
          `소요 ${fmtDurationMs(d.durationMs)} / 쇼츠 ${d.filtered.shortsExcluded} · 키워드 ${d.filtered.keywordExcluded} 제외`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  if (!config || !form) {
    return <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>;
  }

  const lastRun: YoutubeCurationLastRunResult | undefined = config.lastRunResult;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          🎞️ 인기 영상 큐레이션
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
          홈 화면에 노출되는 인기 유튜브 영상을 매일 자동으로 수집합니다.
          <br />
          키워드·갯수·실행 시각을 설정해 홀덤과 무관한 영상이나 쇼츠를 걸러낼 수 있어요.
        </p>
      </div>

      {error && (
        <div
          className="mb-4 rounded-lg p-3 text-xs"
          style={{
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.35)',
            color: '#fecaca',
          }}
        >
          {error}
        </div>
      )}

      {savedAt !== null && Date.now() - savedAt < 5000 && (
        <div
          className="mb-4 rounded-lg p-3 text-xs"
          style={{
            background: 'rgba(16,185,129,0.10)',
            border: '1px solid rgba(16,185,129,0.35)',
            color: '#bbf7d0',
          }}
        >
          저장되었습니다. 다음 정각 스케줄부터 반영됩니다.
        </div>
      )}

      <div
        className="rounded-2xl p-5 mb-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <div
          className="text-xs font-extrabold mb-3 tracking-widest"
          style={{ color: 'var(--gold)' }}
        >
          큐레이션 설정
        </div>

        {/* 포함 키워드 */}
        <Field
          label="✅ 포함 키워드"
          help="제목·설명에 하나라도 포함되어야 통과. 줄바꿈 또는 쉼표(,)로 구분. 비우면 키워드 필터 비활성."
        >
          <textarea
            value={form.includeText}
            onChange={(e) => setForm({ ...form, includeText: e.target.value })}
            rows={5}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={fieldStyle}
            placeholder="홀덤&#10;포커&#10;poker&#10;토너먼트"
          />
        </Field>

        {/* 제외 키워드 */}
        <Field
          label="🚫 제외 키워드"
          help="제목·설명에 하나라도 들어있으면 제외. 무관한 콘텐츠(예: 카지노, 확률 이론 강의 등)."
        >
          <textarea
            value={form.excludeText}
            onChange={(e) => setForm({ ...form, excludeText: e.target.value })}
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={fieldStyle}
            placeholder="(비워둬도 됨)"
          />
        </Field>

        {/* 갯수 + 시각 grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field label="📊 영상 갯수" help="홈에 노출할 최대 개수 (5~50).">
            <input
              type="number"
              min={5}
              max={50}
              value={form.maxResults}
              onChange={(e) => setForm({ ...form, maxResults: parseInt(e.target.value, 10) || 0 })}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={fieldStyle}
            />
          </Field>
          <Field label="⏰ 실행 시각 (KST)" help="매일 이 시각 정각에 자동 실행 (0~23).">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={23}
                value={form.scheduleHourKst}
                onChange={(e) =>
                  setForm({ ...form, scheduleHourKst: parseInt(e.target.value, 10) || 0 })
                }
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={fieldStyle}
              />
              <span className="text-sm" style={{ color: 'var(--text-3)' }}>시</span>
            </div>
          </Field>
        </div>

        {/* 쇼츠 제외 + 최소 길이 + 최대 나이 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <Field label="🎬 쇼츠 제외" help="60초 이하 영상과 #shorts/#쇼츠 태그 자동 제외.">
            <label
              className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer"
              style={fieldStyle}
            >
              <input
                type="checkbox"
                checked={form.excludeShorts}
                onChange={(e) => setForm({ ...form, excludeShorts: e.target.checked })}
              />
              <span className="text-sm" style={{ color: 'var(--text-1)' }}>
                쇼츠 제외 (권장)
              </span>
            </label>
          </Field>
          <Field label="⏱️ 최소 영상 길이" help="이 시간(초) 미만 영상 제외.">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={7200}
                value={form.minDurationSec}
                onChange={(e) =>
                  setForm({ ...form, minDurationSec: parseInt(e.target.value, 10) || 0 })
                }
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={fieldStyle}
              />
              <span className="text-sm" style={{ color: 'var(--text-3)' }}>초</span>
            </div>
          </Field>
          <Field label="📅 영상 최대 나이" help="이 일수 초과한 옛날 영상 제외.">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                value={form.maxAgeDays}
                onChange={(e) =>
                  setForm({ ...form, maxAgeDays: parseInt(e.target.value, 10) || 0 })
                }
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={fieldStyle}
              />
              <span className="text-sm" style={{ color: 'var(--text-3)' }}>일</span>
            </div>
          </Field>
        </div>

        {/* 교체 주기 · 기존 영상 처리 정책 */}
        <div
          className="rounded-xl p-4 mb-4"
          style={{
            background: 'rgba(245,158,11,0.06)',
            border: '1px dashed rgba(245,158,11,0.35)',
          }}
        >
          <div
            className="text-[11px] font-extrabold mb-3 tracking-widest"
            style={{ color: 'var(--gold)' }}
          >
            🔄 교체 주기 · 기존 영상 처리
          </div>
          <div className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>
            💡 매일 새 영상으로 바꾸려면 “1일”, 같은 영상을 오래 보여주려면 “7일” 추천.<br />
            “전부 삭제하고 새 목록”을 켜두면 매번 깔끔하게 새 영상만 노출됩니다.
          </div>

          <Field
            label="🔁 교체 주기"
            help="N일마다 새 영상으로 교체. 1=매일, 2=이틀마다, 7=주1회. 지정 시각이 와도 N일이 안 지났으면 건너뜁니다."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={90}
                value={form.refreshIntervalDays}
                onChange={(e) =>
                  setForm({
                    ...form,
                    refreshIntervalDays: parseInt(e.target.value, 10) || 0,
                  })
                }
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={fieldStyle}
              />
              <span className="text-sm" style={{ color: 'var(--text-3)' }}>일마다</span>
            </div>
          </Field>

          <Field
            label="🧹 새 큐레이션 실행 시 기존 영상 처리"
            help="자동 등록된 영상의 만료 방식. 본사가 수동으로 등록한 영상은 어느 옵션이든 절대 삭제되지 않습니다."
          >
            <div className="flex flex-col gap-2">
              <label
                className="flex items-start gap-2 rounded-lg px-3 py-2 cursor-pointer"
                style={fieldStyle}
              >
                <input
                  type="radio"
                  name="expirePolicy"
                  className="mt-0.5"
                  checked={form.expirePreviousOnRefresh === true}
                  onChange={() => setForm({ ...form, expirePreviousOnRefresh: true })}
                />
                <span className="text-sm" style={{ color: 'var(--text-1)' }}>
                  전부 삭제하고 새 목록으로 교체{' '}
                  <span style={{ color: 'var(--gold)' }}>(권장)</span>
                  <span
                    className="block text-[11px] mt-0.5"
                    style={{ color: 'var(--text-3)' }}
                  >
                    매번 깔끔한 새 영상 {form.maxResults}개만 노출.
                  </span>
                </span>
              </label>
              <label
                className="flex items-start gap-2 rounded-lg px-3 py-2 cursor-pointer"
                style={fieldStyle}
              >
                <input
                  type="radio"
                  name="expirePolicy"
                  className="mt-0.5"
                  checked={form.expirePreviousOnRefresh === false}
                  onChange={() => setForm({ ...form, expirePreviousOnRefresh: false })}
                />
                <span className="text-sm" style={{ color: 'var(--text-1)' }}>
                  점진적 — 일정 기간 지난 영상만 자동 삭제
                  <span
                    className="block text-[11px] mt-0.5"
                    style={{ color: 'var(--text-3)' }}
                  >
                    기존 영상도 N일 동안 유지하면서 새 영상을 추가.
                  </span>
                </span>
              </label>
            </div>
          </Field>

          <Field
            label="🗑️ 자동 삭제 기준 (점진적 모드 전용)"
            help='위에서 "점진적"을 선택했을 때만 작동. N일 이상 지난 자동 영상은 다음 큐레이션 때 제거.'
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={90}
                value={form.autoVideoMaxAgeDays}
                onChange={(e) =>
                  setForm({
                    ...form,
                    autoVideoMaxAgeDays: parseInt(e.target.value, 10) || 0,
                  })
                }
                disabled={form.expirePreviousOnRefresh}
                className="w-full rounded-lg px-3 py-2 text-sm disabled:opacity-40"
                style={fieldStyle}
              />
              <span className="text-sm" style={{ color: 'var(--text-3)' }}>일 지난 영상</span>
            </div>
          </Field>
        </div>

        <div className="flex items-center gap-2 mt-5">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="px-5 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40"
            style={{ background: 'var(--gold)', color: '#0F1419' }}
          >
            {saving ? '저장 중…' : dirty ? '저장' : '변경 없음'}
          </button>
          <button
            type="button"
            onClick={handleResetDefaults}
            className="px-4 py-2.5 rounded-xl font-bold text-xs"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
              border: '1px solid var(--border)',
            }}
          >
            기본값으로
          </button>
        </div>
      </div>

      {/* 마지막 실행 + 즉시 실행 */}
      <div
        className="rounded-2xl p-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div
              className="text-xs font-extrabold mb-1 tracking-widest"
              style={{ color: 'var(--gold)' }}
            >
              마지막 실행
            </div>
            <div className="text-sm" style={{ color: 'var(--text-1)' }}>
              {fmtDate(config.lastRunAt)}
              {lastRun ? ` · 소요 ${fmtDurationMs(lastRun.durationMs)}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={handleRunNow}
            disabled={running}
            className="px-4 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
              border: '1px solid var(--gold)',
            }}
          >
            {running ? '실행 중…' : '⚡ 지금 즉시 실행'}
          </button>
        </div>

        {lastRun ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            <Stat label="큐레이션" value={`${lastRun.upserted}개`} />
            <Stat label="만료 삭제" value={`${lastRun.expiredDeleted}개`} />
            <Stat
              label="쇼츠 제외"
              value={`${lastRun.filtered?.shortsExcluded ?? 0}개`}
            />
            <Stat
              label="키워드 제외"
              value={`${lastRun.filtered?.keywordExcluded ?? 0}개`}
            />
          </div>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-3)' }}>
            아직 실행 기록이 없습니다.
          </div>
        )}

        {runMessage && (
          <div
            className="mt-4 rounded-lg p-3 text-xs"
            style={{
              background: 'rgba(245,158,11,0.10)',
              border: '1px solid rgba(245,158,11,0.35)',
              color: 'var(--text-1)',
            }}
          >
            {runMessage}
          </div>
        )}
      </div>

      {/* 수동 영상 관리 — priority 0이 최상단 */}
      <div className="mt-6">
        <ManualVideosSection />
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  color: 'var(--text-1)',
};

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-1)' }}>
        {label}
      </div>
      {help && (
        <div className="text-[11px] mb-1.5" style={{ color: 'var(--text-3)' }}>
          {help}
        </div>
      )}
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-3)' }}>
        {label}
      </div>
      <div className="text-base font-extrabold" style={{ color: 'var(--text-1)' }}>
        {value}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 수동 영상 관리 섹션 — priority 체계
// ─────────────────────────────────────────────────────────────────

function ManualVideosSection() {
  const authState = useAuth();
  const [videos, setVideos] = useState<HotYoutubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HotYoutubeVideo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeAllHotVideos(
      (items) => {
        setVideos(items);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  const manualVideos = useMemo(
    () => videos.filter((v) => v.source !== 'auto'),
    [videos],
  );
  const autoVideos = useMemo(
    () => videos.filter((v) => v.source === 'auto'),
    [videos],
  );

  const uid =
    authState.status === 'authenticated' ? authState.user.uid : null;

  const handleShift = async (v: HotYoutubeVideo, delta: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await shiftManualVideoPriority(v.videoId, v.priority, delta);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (v: HotYoutubeVideo) => {
    if (!window.confirm(`"${v.title}" 영상을 삭제할까요?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteManualVideo(v.videoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div
            className="text-xs font-extrabold tracking-widest mb-1"
            style={{ color: 'var(--gold)' }}
          >
            📌 수동 등록 영상
          </div>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            자동 큐레이션과 별도로 본사가 직접 등록·고정합니다.
            priority 0이 가장 위, 자동 영상(1, 2, …) 보다 먼저 노출됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!uid}
          className="px-4 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40 flex-shrink-0"
          style={{ background: 'var(--gold)', color: '#0F1419' }}
        >
          + 영상 추가
        </button>
      </div>

      {error && (
        <div
          className="mb-3 rounded-lg p-3 text-xs"
          style={{
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.35)',
            color: '#fecaca',
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>로딩 중…</div>
      ) : manualVideos.length === 0 ? (
        <div
          className="rounded-xl p-5 text-center text-xs"
          style={{
            background: 'var(--surface-2)',
            border: '1px dashed var(--border)',
            color: 'var(--text-3)',
          }}
        >
          등록된 수동 영상이 없습니다. &ldquo;+ 영상 추가&rdquo;로 시작하세요.
        </div>
      ) : (
        <>
          <div
            className="text-[11px] font-bold mb-2"
            style={{ color: 'var(--text-3)' }}
          >
            현재 등록된 수동 영상 ({manualVideos.length}개) · 자동 영상 {autoVideos.length}개와 함께 노출됨
          </div>
          <ul className="flex flex-col gap-2">
            {manualVideos.map((v) => (
              <ManualVideoCard
                key={v.videoId}
                video={v}
                disabled={busy}
                onUp={() => handleShift(v, -1)}
                onDown={() => handleShift(v, +1)}
                onEdit={() => setEditing(v)}
                onDelete={() => handleDelete(v)}
              />
            ))}
          </ul>
        </>
      )}

      {/* 영상 추가 모달 */}
      {adding && uid && (
        <ManualVideoModal
          mode="add"
          onClose={() => setAdding(false)}
          onSave={async ({ urlOrId, priority, title, channelName }) => {
            await addManualVideo({ urlOrId, priority, title, channelName }, uid);
          }}
        />
      )}

      {/* 영상 priority 수정 모달 */}
      {editing && (
        <ManualVideoModal
          mode="edit"
          video={editing}
          onClose={() => setEditing(null)}
          onSave={async ({ priority }) => {
            await updateManualVideoPriority(editing.videoId, priority ?? 0);
          }}
        />
      )}
    </div>
  );
}

function ManualVideoCard({
  video,
  disabled,
  onUp,
  onDown,
  onEdit,
  onDelete,
}: {
  video: HotYoutubeVideo;
  disabled: boolean;
  onUp: () => void;
  onDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const thumb =
    video.thumbnailUrl || youtubeThumbnailUrl(video.videoId, 'mqdefault');
  const priority = video.priority ?? 0;

  return (
    <li
      className="rounded-xl p-3 flex items-center gap-3"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      {/* priority badge */}
      <div
        className="flex flex-col items-center justify-center rounded-lg flex-shrink-0"
        style={{
          width: 44,
          minHeight: 44,
          background: 'rgba(255,31,143,0.15)',
          color: 'var(--brand, #FF1F8F)',
          border: '1px solid rgba(255,31,143,0.35)',
        }}
        title="priority (0이 최상단)"
      >
        <span className="text-[10px] font-bold leading-none">순위</span>
        <span className="text-base font-extrabold leading-none mt-1">
          {priority}
        </span>
      </div>

      {/* 썸네일 */}
      <div
        className="rounded-md overflow-hidden flex-shrink-0"
        style={{ width: 80, aspectRatio: '16/9', background: '#0F0F0F' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumb}
          alt={video.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>

      {/* 텍스트 */}
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-bold line-clamp-1"
          style={{ color: 'var(--text-1)' }}
        >
          {video.title}
        </div>
        <div className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
          {video.channelName ?? '-'} · videoId: {video.videoId}
        </div>
      </div>

      {/* 컨트롤 */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={onUp}
          disabled={disabled || priority <= 0}
          className="w-8 h-8 rounded-lg text-sm font-extrabold disabled:opacity-30"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            color: 'var(--text-1)',
          }}
          aria-label="순위 올리기"
          title="순위 올리기 (priority -1)"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={onDown}
          disabled={disabled}
          className="w-8 h-8 rounded-lg text-sm font-extrabold disabled:opacity-30"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            color: 'var(--text-1)',
          }}
          aria-label="순위 내리기"
          title="순위 내리기 (priority +1)"
        >
          ▼
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="px-2.5 h-8 rounded-lg text-[11px] font-bold disabled:opacity-30"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            color: 'var(--text-1)',
          }}
        >
          수정
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="px-2.5 h-8 rounded-lg text-[11px] font-bold disabled:opacity-30"
          style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.35)',
            color: '#fecaca',
          }}
        >
          삭제
        </button>
      </div>
    </li>
  );
}

interface ManualVideoModalProps {
  mode: 'add' | 'edit';
  video?: HotYoutubeVideo;
  onClose: () => void;
  onSave: (input: {
    urlOrId: string;
    priority?: number;
    title?: string;
    channelName?: string;
  }) => Promise<void>;
}

function ManualVideoModal({ mode, video, onClose, onSave }: ManualVideoModalProps) {
  const [urlOrId, setUrlOrId] = useState(
    video ? `https://www.youtube.com/watch?v=${video.videoId}` : '',
  );
  const [priority, setPriority] = useState<number>(video?.priority ?? 0);
  const [title, setTitle] = useState(video?.title ?? '');
  const [channelName, setChannelName] = useState(video?.channelName ?? '');
  const [thumbnailUrl, setThumbnailUrl] = useState(
    video?.thumbnailUrl ?? (video ? youtubeThumbnailUrl(video.videoId, 'mqdefault') : ''),
  );
  const [resolvedId, setResolvedId] = useState<string | null>(
    video?.videoId ?? null,
  );
  const [oembedLoading, setOembedLoading] = useState(false);
  const [oembedError, setOembedError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleResolve = async (value: string) => {
    setOembedError(null);
    const id = extractYoutubeVideoId(value);
    if (!id) {
      setResolvedId(null);
      return;
    }
    setResolvedId(id);
    setThumbnailUrl(youtubeThumbnailUrl(id, 'mqdefault'));
    if (mode === 'edit') return; // 편집 모드는 메타 그대로
    setOembedLoading(true);
    try {
      const meta = await fetchYoutubeOembed(id);
      if (meta) {
        if (meta.title) setTitle(meta.title);
        if (meta.channelName) setChannelName(meta.channelName);
        if (meta.thumbnailUrl) setThumbnailUrl(meta.thumbnailUrl);
      } else {
        setOembedError('유튜브 메타를 가져오지 못했습니다. 제목·채널을 직접 입력해 주세요.');
      }
    } catch (e) {
      setOembedError(e instanceof Error ? e.message : String(e));
    } finally {
      setOembedLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        urlOrId,
        priority: Number.isFinite(priority) ? Math.max(0, Math.floor(priority)) : 0,
        title: title.trim() || undefined,
        channelName: channelName.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    mode === 'edit' ? Number.isFinite(priority) : !!resolvedId && !saving;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <div
          className="p-5 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="text-base font-extrabold" style={{ color: 'var(--text-1)' }}>
            {mode === 'add' ? '수동 영상 추가' : '수동 영상 수정'}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* URL */}
          <div>
            <label
              className="block text-xs font-bold mb-1.5"
              style={{ color: 'var(--text-1)' }}
            >
              YouTube URL 또는 videoId
            </label>
            <input
              type="text"
              value={urlOrId}
              onChange={(e) => setUrlOrId(e.target.value)}
              onBlur={(e) => handleResolve(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              disabled={mode === 'edit'}
              className="w-full rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              style={fieldStyle}
            />
            <div
              className="text-[11px] mt-1"
              style={{ color: oembedError ? '#fecaca' : 'var(--text-3)' }}
            >
              {oembedLoading
                ? '메타 가져오는 중…'
                : oembedError
                ? oembedError
                : resolvedId
                ? `videoId: ${resolvedId}`
                : 'URL을 붙여넣으면 제목·채널·썸네일이 자동으로 채워집니다.'}
            </div>
          </div>

          {/* 미리보기 */}
          {resolvedId && (
            <div className="flex gap-3 items-start">
              <div
                className="rounded-md overflow-hidden flex-shrink-0"
                style={{ width: 140, aspectRatio: '16/9', background: '#0F0F0F' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailUrl}
                  alt={title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className="text-sm font-bold line-clamp-2"
                  style={{ color: 'var(--text-1)' }}
                >
                  {title || '(제목 없음)'}
                </div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                  {channelName || '(채널명 없음)'}
                </div>
              </div>
            </div>
          )}

          {/* 제목 (수정 가능) */}
          {mode === 'add' && (
            <>
              <div>
                <label
                  className="block text-xs font-bold mb-1.5"
                  style={{ color: 'var(--text-1)' }}
                >
                  제목 (자동 채움 — 필요시 수정)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label
                  className="block text-xs font-bold mb-1.5"
                  style={{ color: 'var(--text-1)' }}
                >
                  채널명 (자동 채움 — 필요시 수정)
                </label>
                <input
                  type="text"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={fieldStyle}
                />
              </div>
            </>
          )}

          {/* priority */}
          <div>
            <label
              className="block text-xs font-bold mb-1.5"
              style={{ color: 'var(--text-1)' }}
            >
              priority (0 = 최상단)
            </label>
            <input
              type="number"
              min={0}
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={fieldStyle}
            />
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
              자동 영상은 1, 2, 3, … 순으로 부여되므로 수동 영상을 자동 위에 두려면 0 권장.
            </div>
          </div>

          {saveError && (
            <div
              className="rounded-lg p-2.5 text-xs"
              style={{
                background: 'rgba(239,68,68,0.10)',
                border: '1px solid rgba(239,68,68,0.35)',
                color: '#fecaca',
              }}
            >
              {saveError}
            </div>
          )}
        </div>

        <div
          className="p-5 border-t flex items-center justify-end gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
              border: '1px solid var(--border)',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-5 py-2 rounded-lg text-sm font-extrabold disabled:opacity-40"
            style={{ background: 'var(--gold)', color: '#0F1419' }}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
