'use client';

/**
 * 매장별 토너 타이머 화면 설정 에디터.
 *
 * 라이브 미리보기(우측) + 폼(좌측). 모든 매장 TV(/display/{storeId}/{slot})가
 * 동일한 prefs를 즉시 반영. v0.1은 색·배경·공지·스폰서·사운드만, 로고/이미지
 * 업로드는 URL 직접 입력 (Firebase Storage 업로드는 추후).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type TimerDisplaySettings,
  DEFAULT_TIMER_DISPLAY,
  subscribeTimerDisplay,
  saveTimerDisplay,
  buildBackgroundCss,
  uploadTimerBackground,
  SAMPLE_TIMER_BACKGROUNDS,
  MAX_TIMER_BACKGROUND_BYTES,
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

  // 배경 이미지 업로드 상태 (2026-05-23)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');

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

  // 파일 업로드 → Firebase Storage → URL 자동 set + 배경 타입 image로 전환
  const handleFilePick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 다시 선택 가능하게
    if (!file) return;
    if (file.size > MAX_TIMER_BACKGROUND_BYTES) {
      setError('이미지는 5MB 이하만 업로드 가능합니다.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 업로드 가능합니다 (jpg, png, webp).');
      return;
    }
    setError(null);
    setUploading(true);
    setUploadProgress('업로드 중…');
    try {
      const url = await uploadTimerBackground(storeId, file);
      setSettings((prev) => ({
        ...prev,
        backgroundType: 'image',
        backgroundImageUrl: url,
      }));
      setDirty(true);
      setUploadProgress('업로드 완료 — "변경사항 저장"을 눌러 TV에 적용하세요');
      window.setTimeout(() => setUploadProgress(''), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUploadProgress('');
    } finally {
      setUploading(false);
    }
  };

  const applySample = (url: string, overlay: number) => {
    setSettings((prev) => ({
      ...prev,
      backgroundType: 'image',
      backgroundImageUrl: url,
      overlayOpacity: overlay,
    }));
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
              {/* 1) 파일 업로드 (PC/모바일 공통) */}
              <FieldLabel
                label="📷 내 사진에서 업로드"
                hint="PC 파일 또는 휴대폰 갤러리·카메라 · 최대 5MB · jpg/png/webp"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={handleFilePick}
                disabled={uploading}
                className="w-full py-3 rounded-lg border-2 border-dashed border-gray-300 hover:border-black hover:bg-gray-50 text-sm font-bold text-gray-700 disabled:opacity-50 transition-colors"
              >
                {uploading ? '📤 업로드 중…' : '📁 파일 선택하기'}
              </button>
              {uploadProgress && (
                <div className="mt-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
                  {uploadProgress}
                </div>
              )}

              {/* 2) 샘플 배경 갤러리 */}
              <div className="mt-4">
                <FieldLabel
                  label="🎨 샘플 배경"
                  hint="클릭하면 바로 적용 — 직접 사진을 올리지 않아도 OK"
                />
                <div className="grid grid-cols-3 gap-2">
                  {SAMPLE_TIMER_BACKGROUNDS.map((s) => {
                    const isActive = settings.backgroundImageUrl === s.url;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => applySample(s.url, s.recommendedOverlay)}
                        className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                          isActive
                            ? 'border-black ring-2 ring-black ring-offset-1'
                            : 'border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        <div
                          className="aspect-video w-full bg-gray-900"
                          style={{
                            backgroundImage: `url("${s.url}")`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }}
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-left">
                          <div className="text-[10px] font-bold text-white truncate">
                            {s.emoji} {s.label}
                          </div>
                        </div>
                        {isActive && (
                          <div className="absolute top-1 right-1 bg-black text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                            ✓ 선택
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3) URL 직접 입력 */}
              <div className="mt-4">
                <FieldLabel
                  label="🔗 URL 직접 입력"
                  hint="외부 이미지 링크(인스타·블로그·이미지 호스팅)를 그대로 붙여넣기"
                />
                <input
                  value={settings.backgroundImageUrl}
                  onChange={(e) => update('backgroundImageUrl', e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className="form-input"
                />
              </div>

              {/* 4) 어둡기 슬라이더 (공통) */}
              <div className="mt-4">
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

        {/* 텍스트 3줄 — 2026-05-23 신규 (게임타이틀 · 참고사항 · 하단 마퀴) */}
        <Section
          title="📝 화면 텍스트 3줄"
          hint="TV에 띄울 자유 텍스트 3줄 — 각각 글자 크기·색·스타일 조절 가능 · 이모지 자유"
        >
          {/* 첫째 줄 — 게임 타이틀 */}
          <TextLineEditor
            badge="🎯 첫째 줄"
            subtitle="게임 타이틀 — 화면 중앙 상단"
            placeholder="예) 🎰 6/15 정기 토너 100K"
            text={settings.titleText}
            fontSize={settings.titleFontSize}
            color={settings.titleColor}
            style={settings.titleStyle}
            onTextChange={(v) => update('titleText', v)}
            onFontSizeChange={(v) => update('titleFontSize', v)}
            onColorChange={(v) => update('titleColor', v)}
            onStyleChange={(v) => update('titleStyle', v)}
            sizeMin={16}
            sizeMax={64}
          />

          <div className="h-3" />

          {/* 둘째 줄 — 게임 참고사항 */}
          <TextLineEditor
            badge="📋 둘째 줄"
            subtitle="게임 참고사항 — 타이틀 바로 아래"
            placeholder="예) 리바이 3회까지 · 18:30 디너 제공"
            text={settings.noteText}
            fontSize={settings.noteFontSize}
            color={settings.noteColor}
            style={settings.noteStyle}
            onTextChange={(v) => update('noteText', v)}
            onFontSizeChange={(v) => update('noteFontSize', v)}
            onColorChange={(v) => update('noteColor', v)}
            onStyleChange={(v) => update('noteStyle', v)}
            sizeMin={10}
            sizeMax={40}
          />

          <div className="h-3" />

          {/* 셋째 줄 — 하단 마퀴 */}
          <TextLineEditor
            badge="📢 셋째 줄"
            subtitle="화면 하단 — 우→좌 자동 스와이프 (뉴스 띠)"
            placeholder="예) 📢 오늘 8시 시작 · 좌석 한정 · 디너 18:30"
            text={settings.marqueeText}
            fontSize={settings.marqueeFontSize}
            color={settings.marqueeColor}
            style={settings.marqueeStyle}
            onTextChange={(v) => update('marqueeText', v)}
            onFontSizeChange={(v) => update('marqueeFontSize', v)}
            onColorChange={(v) => update('marqueeColor', v)}
            onStyleChange={(v) => update('marqueeStyle', v)}
            sizeMin={12}
            sizeMax={48}
            extra={
              <div className="mt-2">
                <FieldLabel
                  label={`스와이프 속도 ${settings.marqueeSpeedSec}초 / 1바퀴`}
                  hint="작을수록 빠름 · 보통 25~35초"
                />
                <input
                  type="range"
                  min={10}
                  max={60}
                  step={1}
                  value={settings.marqueeSpeedSec}
                  onChange={(e) => update('marqueeSpeedSec', Number(e.target.value))}
                  className="w-full"
                />
              </div>
            }
          />
        </Section>

        {/* 텍스트 — 기타 */}
        <Section title="🏷️ 텍스트 — 기타">
          <FieldLabel label="대회명 오버라이드 (기존)" hint="비우면 세션 토너 이름 자동 사용 · 첫째 줄을 채우면 그 값을 우선 사용" />
          <input
            value={settings.customTournamentTitle}
            onChange={(e) => update('customTournamentTitle', e.target.value)}
            placeholder="예: 5월 정기 토너 100K"
            className="form-input"
          />
          <div className="mt-3" />
          <FieldLabel
            label="💰 화면 우측 PRIZE POOL 표시값 (매장 TV 전용)"
            hint='예: "티켓 30장" · "상금 100만" · "GTD 300만 · 우승 100만". 비워두면 자동 계산값(바이인×인원×비율) 사용. 사용자 앱에는 노출되지 않음.'
          />
          <input
            value={settings.prizeOverride}
            onChange={(e) => update('prizeOverride', e.target.value)}
            placeholder="예: 티켓 30장 / GTD 300만"
            className="form-input"
          />
          <div className="text-[10px] text-amber-700 mt-1 leading-relaxed bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            💡 이 값이 TV 우측 <b>PRIZE POOL</b> 카드에 그대로 표시됩니다. 토너 운영 컨트롤에는 영향 없음.
          </div>
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
              label='카운트다운 비프 (10초 → 1초 매초 "삐")'
              checked={settings.soundWarn30}
              onChange={(v) => update('soundWarn30', v)}
            />
            <SoundToggle
              label='블라인드업 음성 알림 ("Blind up!" TTS)'
              checked={settings.soundBlindUp}
              onChange={(v) => update('soundBlindUp', v)}
            />
            <div className="text-[10.5px] text-gray-500 mt-1 leading-relaxed pl-1">
              이전 60초·30초 사전 비프 / 레벨 종료 차임은 정책 변경(2026-05-23)으로 폐기되었습니다.
              카운트다운은 10초부터 1초까지 매초 한 번 울리고, 0초 직후 곧장 블라인드업 음성이 발화합니다.
            </div>
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
          {/* 첫째 줄 — 게임 타이틀 (titleText 우선, 없으면 customTournamentTitle, 그것도 없으면 데모) */}
          <div
            className="text-center max-w-[90%] truncate"
            style={{
              color: settings.titleText ? settings.titleColor : settings.textColor,
              fontSize: settings.titleText ? Math.min(settings.titleFontSize, 22) : 11,
              fontWeight:
                settings.titleText && settings.titleStyle.includes('bold')
                  ? 800
                  : 600,
              fontStyle:
                settings.titleText && settings.titleStyle.includes('italic')
                  ? 'italic'
                  : 'normal',
              lineHeight: 1.1,
              marginBottom: 4,
              letterSpacing: settings.titleText ? '-0.01em' : '0.15em',
            }}
          >
            {settings.titleText || settings.customTournamentTitle || '5월 정기 토너 100K'}
          </div>
          {/* 둘째 줄 — 게임 참고사항 (있을 때만) */}
          {settings.noteText && (
            <div
              className="text-center max-w-[90%] truncate"
              style={{
                color: settings.noteColor,
                fontSize: Math.min(settings.noteFontSize, 14),
                fontWeight: settings.noteStyle.includes('bold') ? 700 : 400,
                fontStyle: settings.noteStyle.includes('italic') ? 'italic' : 'normal',
                marginBottom: 6,
                opacity: 0.9,
              }}
            >
              {settings.noteText}
            </div>
          )}
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

        {/* 셋째 줄 — 하단 마퀴 (우→좌 자동 스와이프) */}
        {(settings.marqueeText || settings.announcement) && (
          <div
            className="overflow-hidden border-t whitespace-nowrap"
            style={{
              background: 'rgba(0,0,0,0.45)',
              borderColor: 'rgba(255,255,255,0.1)',
              padding: '6px 0',
            }}
          >
            <span
              className="inline-block preview-marquee"
              style={{
                color: settings.marqueeColor,
                fontSize: Math.min(settings.marqueeFontSize, 14),
                fontWeight: settings.marqueeStyle.includes('bold') ? 700 : 400,
                fontStyle: settings.marqueeStyle.includes('italic') ? 'italic' : 'normal',
                animationDuration: `${settings.marqueeSpeedSec}s`,
                willChange: 'transform',
              }}
            >
              {(settings.marqueeText || settings.announcement) +
                '         ' +
                (settings.marqueeText || settings.announcement)}
            </span>
            <style jsx>{`
              @keyframes preview-marquee-scroll {
                from { transform: translateX(0); }
                to   { transform: translateX(-50%); }
              }
              .preview-marquee {
                animation-name: preview-marquee-scroll;
                animation-timing-function: linear;
                animation-iteration-count: infinite;
              }
            `}</style>
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

/**
 * TextLineEditor — 텍스트 한 줄 + 폰트 크기/색/스타일 컨트롤 묶음.
 * 3개 줄(타이틀/참고사항/마퀴) 모두 동일한 UI 구조를 재사용.
 */
function TextLineEditor({
  badge,
  subtitle,
  placeholder,
  text,
  fontSize,
  color,
  style,
  onTextChange,
  onFontSizeChange,
  onColorChange,
  onStyleChange,
  sizeMin,
  sizeMax,
  extra,
}: {
  badge: string;
  subtitle: string;
  placeholder: string;
  text: string;
  fontSize: number;
  color: string;
  style: 'normal' | 'bold' | 'italic' | 'bold-italic';
  onTextChange: (v: string) => void;
  onFontSizeChange: (v: number) => void;
  onColorChange: (v: string) => void;
  onStyleChange: (v: 'normal' | 'bold' | 'italic' | 'bold-italic') => void;
  sizeMin: number;
  sizeMax: number;
  extra?: React.ReactNode;
}) {
  const styleOptions: { id: 'normal' | 'bold' | 'italic' | 'bold-italic'; label: string }[] = [
    { id: 'normal', label: 'Normal' },
    { id: 'bold', label: 'Bold' },
    { id: 'italic', label: 'Italic' },
    { id: 'bold-italic', label: 'B + I' },
  ];

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-extrabold text-gray-900 tracking-wide">{badge}</span>
        <span className="text-[10px] text-gray-500">{subtitle}</span>
      </div>
      <input
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder={placeholder}
        className="form-input"
      />
      <div className="grid grid-cols-3 gap-2 mt-2">
        {/* 폰트 크기 */}
        <div className="col-span-3 sm:col-span-1">
          <FieldLabel label={`크기 ${fontSize}px`} />
          <input
            type="range"
            min={sizeMin}
            max={sizeMax}
            step={1}
            value={fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value))}
            className="w-full"
          />
        </div>
        {/* 색상 */}
        <div className="col-span-3 sm:col-span-1">
          <FieldLabel label="색상" />
          <div className="flex gap-1.5 items-center">
            <input
              type="color"
              value={color}
              onChange={(e) => onColorChange(e.target.value)}
              className="h-8 w-10 rounded cursor-pointer border-0 p-0"
            />
            <input
              value={color}
              onChange={(e) => onColorChange(e.target.value)}
              className="form-input flex-1 font-mono text-[11px]"
            />
          </div>
        </div>
        {/* 스타일 */}
        <div className="col-span-3 sm:col-span-1">
          <FieldLabel label="스타일" />
          <div className="grid grid-cols-4 gap-1">
            {styleOptions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onStyleChange(s.id)}
                className={`text-[10px] py-1.5 rounded font-bold border ${
                  style === s.id
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {extra}
    </div>
  );
}
