'use client';

/**
 * 매장별 토너 타이머 화면 설정 에디터.
 *
 * 라이브 미리보기(우측) + 폼(좌측). 모든 매장 TV(/display/{storeId}/{slot})가
 * 동일한 prefs를 즉시 반영. v0.1은 색·배경·공지·스폰서·사운드만, 로고/이미지
 * 업로드는 URL 직접 입력 (Firebase Storage 업로드는 추후).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  type TimerDisplaySettings,
  DEFAULT_TIMER_DISPLAY,
  subscribeTimerDisplay,
  saveTimerDisplay,
  buildBackgroundCss,
} from '@/lib/timerDisplay';

interface Props {
  storeId: string;
}

const PRESETS: { id: string; label: string; patch: Partial<TimerDisplaySettings> }[] = [
  {
    id: 'classic-dark',
    label: '클래식 다크',
    patch: {
      backgroundType: 'gradient',
      backgroundColor: '#0A0A0A',
      backgroundColor2: '#1A1A2E',
      timerColor: '#FFFFFF',
      blindsColor: '#FFB800',
      textColor: '#E5E5E5',
      accentColor: '#FF4757',
    },
  },
  {
    id: 'casino-green',
    label: '카지노 그린',
    patch: {
      backgroundType: 'gradient',
      backgroundColor: '#0E3D2C',
      backgroundColor2: '#1A5641',
      timerColor: '#FFFFFF',
      blindsColor: '#F7C948',
      textColor: '#D6E5DC',
      accentColor: '#FF6B35',
    },
  },
  {
    id: 'royal-blue',
    label: '로얄 블루',
    patch: {
      backgroundType: 'gradient',
      backgroundColor: '#003049',
      backgroundColor2: '#1A4D6A',
      timerColor: '#FFFFFF',
      blindsColor: '#FFD166',
      textColor: '#CDE6F2',
      accentColor: '#EF476F',
    },
  },
  {
    id: 'crimson',
    label: '크림슨',
    patch: {
      backgroundType: 'gradient',
      backgroundColor: '#1A0000',
      backgroundColor2: '#5C0F0F',
      timerColor: '#FFFFFF',
      blindsColor: '#FFD60A',
      textColor: '#F4D4D4',
      accentColor: '#FF453A',
    },
  },
  {
    id: 'minimal-white',
    label: '미니멀 화이트',
    patch: {
      backgroundType: 'solid',
      backgroundColor: '#FAFAFA',
      timerColor: '#0A0A0A',
      blindsColor: '#FF6B35',
      textColor: '#404040',
      accentColor: '#0066FF',
    },
  },
];

export default function TimerDisplaySettingsEditor({ storeId }: Props) {
  const [settings, setSettings] = useState<TimerDisplaySettings>(DEFAULT_TIMER_DISPLAY);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeTimerDisplay(
      storeId,
      (s) => {
        if (!dirty) setSettings(s);
      },
      (e) => setError(e.message),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const update = <K extends keyof TimerDisplaySettings>(key: K, value: TimerDisplaySettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const applyPreset = (p: Partial<TimerDisplaySettings>) => {
    setSettings((prev) => ({ ...prev, ...p }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveTimerDisplay(storeId, settings);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!window.confirm('현재 설정을 초기값으로 되돌릴까요? 저장 전까지는 적용되지 않습니다.')) return;
    setSettings(DEFAULT_TIMER_DISPLAY);
    setDirty(true);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* 좌 — 폼 */}
      <div className="space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">{error}</div>
        )}

        {/* 프리셋 */}
        <Section title="🎨 테마 프리셋" hint="매장 분위기에 맞는 컬러 세트를 한 번에 적용">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.patch)}
                className="rounded-lg border-[1.5px] border-gray-200 hover:border-black p-2 text-left"
              >
                <div
                  className="h-8 rounded mb-1.5"
                  style={{ background: buildBackgroundCss({ ...DEFAULT_TIMER_DISPLAY, ...p.patch }) }}
                />
                <div className="text-[11px] font-bold text-gray-900">{p.label}</div>
              </button>
            ))}
          </div>
        </Section>

        {/* 배경 */}
        <Section title="🖼️ 배경" hint="단색·그라데이션·이미지 중 선택">
          <div className="flex gap-2 mb-3">
            {(['solid', 'gradient', 'image'] as const).map((t) => (
              <button
                key={t}
                onClick={() => update('backgroundType', t)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border-[1.5px] ${
                  settings.backgroundType === t
                    ? 'bg-black text-white border-black'
                    : 'bg-white border-gray-200 text-gray-700'
                }`}
              >
                {t === 'solid' ? '단색' : t === 'gradient' ? '그라데이션' : '이미지'}
              </button>
            ))}
          </div>
          {settings.backgroundType !== 'image' && (
            <div className="grid grid-cols-2 gap-2">
              <ColorField
                label="첫번째 색"
                value={settings.backgroundColor}
                onChange={(v) => update('backgroundColor', v)}
              />
              {settings.backgroundType === 'gradient' && (
                <ColorField
                  label="두번째 색"
                  value={settings.backgroundColor2}
                  onChange={(v) => update('backgroundColor2', v)}
                />
              )}
            </div>
          )}
          {settings.backgroundType === 'image' && (
            <>
              <FieldLabel label="이미지 URL" hint="https://... 또는 매장 사진 직접 링크" />
              <input
                value={settings.backgroundImageUrl}
                onChange={(e) => update('backgroundImageUrl', e.target.value)}
                placeholder="https://..."
                className="form-input"
              />
              <div className="mt-3">
                <FieldLabel label={`배경 어둡기 ${Math.round(settings.overlayOpacity * 100)}%`} />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings.overlayOpacity * 100)}
                  onChange={(e) => update('overlayOpacity', Number(e.target.value) / 100)}
                  className="w-full"
                />
              </div>
            </>
          )}
        </Section>

        {/* 색 팔레트 */}
        <Section title="🎨 컬러 팔레트">
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="타이머 숫자" value={settings.timerColor} onChange={(v) => update('timerColor', v)} />
            <ColorField label="블라인드 숫자" value={settings.blindsColor} onChange={(v) => update('blindsColor', v)} />
            <ColorField label="본문 텍스트" value={settings.textColor} onChange={(v) => update('textColor', v)} />
            <ColorField label="강조 색 (LIVE 점)" value={settings.accentColor} onChange={(v) => update('accentColor', v)} />
          </div>
        </Section>

        {/* 텍스트 */}
        <Section title="📝 텍스트 / 공지">
          <FieldLabel label="대회명 오버라이드" hint="비우면 세션 토너 이름 자동 사용" />
          <input
            value={settings.customTournamentTitle}
            onChange={(e) => update('customTournamentTitle', e.target.value)}
            placeholder="예: 5월 정기 토너 100K"
            className="form-input"
          />
          <div className="mt-3" />
          <FieldLabel label="공지 텍스트" hint="TV 하단 띠에 흐르듯 노출 — 비우면 표시 안 함" />
          <input
            value={settings.announcement}
            onChange={(e) => update('announcement', e.target.value)}
            placeholder="예: 다음 레벨 후 10분 휴식 · 18:30 디너 제공"
            className="form-input"
          />
          <div className="mt-3" />
          <FieldLabel
            label="상금 표기 오버라이드 (매장 TV 전용)"
            hint="비우면 세션 prizePool 자동 표기. 사용자 앱에는 노출되지 않음."
          />
          <input
            value={settings.prizeOverride}
            onChange={(e) => update('prizeOverride', e.target.value)}
            placeholder="예: GTD 300만 · 우승 100만"
            className="form-input"
          />
          <div className="mt-3" />
          <FieldLabel label="스폰서 / 후원 줄" />
          <input
            value={settings.sponsorText}
            onChange={(e) => update('sponsorText', e.target.value)}
            placeholder="예: powered by Pink Rabbit · 부산경남 협회"
            className="form-input"
          />
          <div className="mt-3" />
          <FieldLabel label="매장 로고 URL (선택)" hint="좌상단 작은 배지에 노출" />
          <input
            value={settings.storeLogoUrl}
            onChange={(e) => update('storeLogoUrl', e.target.value)}
            placeholder="https://..."
            className="form-input"
          />
        </Section>

        {/* 사운드 */}
        <Section title="🔔 사운드 알림" hint="TV가 켜진 브라우저에서 작동">
          <div className="space-y-2">
            <SoundToggle
              label="60초 남았을 때 경고 비프"
              checked={settings.soundWarn60}
              onChange={(v) => update('soundWarn60', v)}
            />
            <SoundToggle
              label="30초 남았을 때 경고 비프"
              checked={settings.soundWarn30}
              onChange={(v) => update('soundWarn30', v)}
            />
            <SoundToggle
              label="레벨 종료(0초) 차임"
              checked={settings.soundLevelEnd}
              onChange={(v) => update('soundLevelEnd', v)}
            />
          </div>
        </Section>

        <div className="flex gap-2 pt-2 sticky bottom-2">
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex-1 bg-black text-white py-3 rounded-xl font-bold text-sm disabled:opacity-40"
          >
            {saving ? '저장 중…' : dirty ? '변경사항 저장' : '저장됨'}
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-3 rounded-xl border-[1.5px] border-gray-200 font-bold text-sm text-gray-700"
          >
            기본값
          </button>
        </div>
      </div>

      {/* 우 — 미리보기 */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <FieldLabel label="🖥️ 실시간 미리보기" hint="저장 즉시 매장 모든 TV에 적용" />
        <TimerPreview settings={settings} />
        <div className="text-[11px] text-gray-500 mt-2 leading-relaxed">
          미리보기는 가상의 LIVE 세션입니다. 실제 송출은{' '}
          <span className="font-mono text-gray-700">/display/{storeId}/[슬롯번호]</span> 페이지에서.
        </div>
      </div>

      <style jsx global>{`
        .form-input {
          background: #fff;
          border: 1.5px solid #eaeaea;
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 13px;
          color: #111;
          width: 100%;
          box-sizing: border-box;
          outline: none;
        }
        .form-input:focus { border-color: #111; }
      `}</style>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-sm font-extrabold text-gray-900">{title}</div>
      {hint && <div className="text-[11px] text-gray-500 mb-3 mt-0.5">{hint}</div>}
      {!hint && <div className="mb-3" />}
      {children}
    </div>
  );
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-1.5">
      <div className="text-[11px] font-bold text-gray-700 tracking-wide">{label}</div>
      {hint && <div className="text-[10px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <FieldLabel label={label} />
      <div className="flex gap-2 items-center">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded cursor-pointer border-0 p-0"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="form-input flex-1 font-mono text-xs"
        />
      </div>
    </div>
  );
}

function SoundToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-black"
      />
      <span className="text-xs text-gray-800">{label}</span>
    </label>
  );
}

function TimerPreview({ settings }: { settings: TimerDisplaySettings }) {
  const bg = useMemo(() => buildBackgroundCss(settings), [settings]);

  // 가짜 카운트다운 — 18:30 부터 1초씩 줄어들며 미리보기
  const [sec, setSec] = useState(18 * 60 + 30);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => (s <= 0 ? 18 * 60 + 30 : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');

  return (
    <div
      className="rounded-2xl overflow-hidden relative aspect-video shadow-lg"
      style={{ background: bg }}
    >
      {settings.backgroundType === 'image' && (
        <div
          className="absolute inset-0"
          style={{ background: `rgba(0,0,0,${settings.overlayOpacity})` }}
        />
      )}
      <div className="relative h-full flex flex-col">
        <div className="px-5 pt-4 flex items-start justify-between" style={{ color: settings.textColor }}>
          <div className="flex items-center gap-2">
            {settings.storeLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.storeLogoUrl} alt="logo" className="h-7 w-7 rounded object-cover" />
            ) : null}
            <div className="text-[10px] font-bold opacity-70 tracking-widest">STORE</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] opacity-60 tracking-widest">2026.05.21 · 목</div>
            <div className="font-mono text-base font-extrabold leading-tight">21:42</div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center -mt-2">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: settings.accentColor }}
            />
            <span
              className="text-[10px] font-extrabold tracking-[0.3em]"
              style={{ color: settings.accentColor }}
            >
              LIVE
            </span>
          </div>
          <div className="text-[10px] tracking-widest mb-2 truncate max-w-[80%]" style={{ color: settings.textColor }}>
            {settings.customTournamentTitle || '5월 정기 토너 100K'}
          </div>
          <div className="text-[9px] tracking-[0.3em] mb-1" style={{ color: settings.textColor, opacity: 0.7 }}>
            LEVEL 4
          </div>
          <div
            className="font-mono font-extrabold leading-none"
            style={{ color: settings.timerColor, fontSize: '56px', letterSpacing: '-0.04em' }}
          >
            {mm}:{ss}
          </div>
          <div
            className="font-mono font-extrabold mt-2"
            style={{ color: settings.blindsColor, fontSize: '22px' }}
          >
            300 / 600
          </div>
          <div className="text-[10px] mt-1" style={{ color: settings.textColor, opacity: 0.6 }}>
            Ante 75
          </div>

          {/* 미니 통계 */}
          <div className="flex gap-6 mt-3 text-center" style={{ color: settings.textColor }}>
            <Stat label="PLAYERS" value="18/24" />
            <Stat
              label="PRIZE POOL"
              value={settings.prizeOverride || '₩240만'}
            />
            <Stat label="NEXT" value="LV5 · 400/800" />
          </div>
        </div>

        {settings.announcement && (
          <div
            className="px-5 py-2 text-center text-[11px] font-bold border-t"
            style={{
              background: 'rgba(0,0,0,0.35)',
              color: settings.timerColor,
              borderColor: 'rgba(255,255,255,0.1)',
            }}
          >
            📢 {settings.announcement}
          </div>
        )}
        {settings.sponsorText && (
          <div
            className="px-5 py-1.5 text-center text-[9px] tracking-widest"
            style={{ color: settings.textColor, opacity: 0.5 }}
          >
            {settings.sponsorText}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[8px] tracking-widest opacity-60">{label}</div>
      <div className="font-mono text-[11px] font-extrabold">{value}</div>
    </div>
  );
}
