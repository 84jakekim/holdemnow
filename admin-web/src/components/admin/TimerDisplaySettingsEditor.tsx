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
  SCALE_MIN,
  SCALE_MAX,
  clampScale,
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

        {/*
         * 2026-05-24 사용자 정정 라운드 2 대응 — 사장 호소:
         *   "토너운영 > 화면설정페이지도 좀 수정을해 이요청은 몇차례했는데 왜 반영이 안되는건지 알수가없어"
         *
         * 코드는 이미 정리됨 (Section 1~7 번호 + 텍스트 최상단 + 폰트 슬라이더 8종).
         * 사장이 못 본 원인은 PWA/브라우저 캐시일 가능성 ↑.
         * → 명시적 "최신 정리됨" 배너 + 캐시 무효화 안내 (Ctrl+Shift+R / 홈 화면 PWA 재설치).
         * 이 배너가 보이면 정리된 최신 버전이 떴다는 신호.
         */}
        <div
          className="rounded-xl px-4 py-3 border-2 flex items-start gap-3"
          style={{ background: 'linear-gradient(135deg,#FFF8E7 0%,#FFFBEB 100%)', borderColor: '#F59E0B' }}
        >
          <div className="text-2xl flex-shrink-0">✨</div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-extrabold text-amber-900 leading-tight">
              화면 설정 — 2026-05-24 정리 완료 (v2)
            </div>
            <div className="text-[10.5px] text-amber-800 mt-1 leading-relaxed">
              7개 섹션으로 번호 매김 (1.텍스트 → 2.테마 → 3.배경 → 4.컬러 → 5.대회명/스폰서 →
              6.<b>폰트 슬라이더</b> → 7.사운드). 토너 제목 입력이 최상단으로 이동했습니다.
            </div>
            <div className="text-[9.5px] text-amber-700 mt-1.5 leading-tight">
              💡 화면이 예전 그대로면 캐시 문제 — <b>Ctrl+Shift+R</b> (PC) 또는 홈 화면 PWA 종료 후 재실행.
            </div>
          </div>
        </div>


        {/*
         * 2026-05-24 PM 정정 #7: "텍스트 3줄"을 화면 설정 최상단으로 이동.
         * 사용자 정정: "제목설정은 화면설정의 가장 위로 올려서 화면설정시 제목부터 설정하도록 순서배치"
         * ⇒ 사용자가 화면 설정 진입 즉시 토너 제목부터 입력 가능.
         * ⇒ 셋째 줄(자막)은 deprecated 안내로 변경 — 2026-05-24 사용자가 마퀴 제거 요청.
         */}
        <Section
          title="📝 1. 화면 텍스트 — 토너 제목부터"
          hint="TV에 띄울 자유 텍스트 — 토너 제목·설명 순서로 입력. 위치 다이어그램으로 어디에 노출되는지 미리 확인"
        >
          {/* 전체 위치 가이드 — 한눈에 보이는 다이어그램 */}
          <PositionDiagramAll />

          <div className="h-3" />

          {/* 첫째 줄 — 토너먼트 제목 (가장 위, 가장 큼) */}
          <TextLineEditor
            badge="🏆 첫째 줄 — 토너 제목 (가장 큼)"
            subtitle="TV 화면 정중앙 상단 · 가장 큰 헤드라인 · 예: 토너 이름"
            positionDiagram={<PositionDiagram active="title" />}
            placeholder="예) 🎰 5/24 정기 토너 100K"
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

          {/* 둘째 줄 — 토너 설명 (제목 바로 아래, 부제) */}
          <TextLineEditor
            badge="📝 둘째 줄 — 토너 설명 (부제)"
            subtitle="제목 바로 아래 · 부제 · 예: GTD·리바인 횟수·디너 시간 등 보조 정보"
            positionDiagram={<PositionDiagram active="note" />}
            placeholder="예) GTD 100만 · 리바인 3회 · 18:30 디너"
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

          {/* 2026-05-24 PM 정정 #6: 셋째 줄 자막 폐기 안내.
              사용자 명시: "중앙하단 자막기능은 제거".
              데이터 모델은 유지하되 입력 UI를 deprecated 안내로 대체. */}
          <div className="mt-4 rounded-lg px-3 py-3 border-2 border-dashed"
               style={{ background: 'rgba(156,163,175,0.08)', borderColor: 'rgba(156,163,175,0.3)' }}>
            <div className="text-[11px] font-extrabold text-gray-600 mb-1">
              📢 셋째 줄 — 자막 공지 (2026-05-24 제거됨)
            </div>
            <div className="text-[10.5px] text-gray-500 leading-relaxed">
              하단 흐름 자막 기능은 사용자 정정으로 화면에서 제거되었습니다.
              실시간 공지는 토너 제목·설명을 통해 안내해 주세요.
              (기존 입력값은 저장되어 있으나 TV에는 표시되지 않습니다.)
            </div>
          </div>
        </Section>

        {/* 프리셋 */}
        <Section title="🎨 2. 테마 프리셋" hint="매장 분위기에 맞는 컬러 세트를 한 번에 적용">
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
        <Section title="🖼️ 3. 배경" hint="단색·그라데이션·이미지 중 선택">
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
        <Section title="🎨 4. 컬러 팔레트">
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="타이머 숫자" value={settings.timerColor} onChange={(v) => update('timerColor', v)} />
            <ColorField label="블라인드 숫자" value={settings.blindsColor} onChange={(v) => update('blindsColor', v)} />
            <ColorField label="본문 텍스트" value={settings.textColor} onChange={(v) => update('textColor', v)} />
            <ColorField label="강조 색 (LIVE 점)" value={settings.accentColor} onChange={(v) => update('accentColor', v)} />
          </div>
        </Section>

        {/* 2026-05-24 PM 정정 #7: 화면 텍스트 3줄 Section은 최상단으로 이동됨 (위쪽 참조).
            여기엔 기타 텍스트 옵션만 남김. */}

        {/* 텍스트 — 기타 */}
        <Section title="🏷️ 5. 텍스트 — 기타 (대회명·스폰서·로고)">
          <FieldLabel label="대회명 오버라이드 (기존)" hint="비우면 세션 토너 이름 자동 사용 · 첫째 줄을 채우면 그 값을 우선 사용" />
          <input
            value={settings.customTournamentTitle}
            onChange={(e) => update('customTournamentTitle', e.target.value)}
            placeholder="예: 5월 정기 토너 100K"
            className="form-input"
          />
          <div className="mt-3" />
          <FieldLabel
            label="💰 PRIZE POOL — 어디서 설정하나요?"
            hint="2026-05-23부터 PRIZE POOL은 토너 운영 > 타이머에서 사장이 직접 변경하는 인원·리바인·바이인을 기반으로 자동 계산됩니다."
          />
          <div className="text-[11px] leading-relaxed rounded-lg px-3 py-2.5 space-y-1.5"
               style={{ background: 'rgba(16,185,129,0.08)', color: '#065F46', border: '1px solid rgba(16,185,129,0.30)' }}>
            <div className="font-bold">📐 자동 계산식</div>
            <div className="font-mono text-[10.5px]">
              PRIZE POOL = (인원 + 리바인) × 바이인 × payoutPercent%
            </div>
            <div>매장 사장님은 <b>토너 운영 &gt; 타이머</b> 페이지의 🎫 토너 정보 박스에서 인원·리바인·바이인을 실시간 조절하면 됩니다. TV 화면에는 5초 이내 자동 반영됩니다.</div>
            <div>표시 단위(만원/T)와 노출 여부(💰 토글)는 토너 템플릿에서 설정합니다.</div>
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

        {/*
         * 폰트 사이즈 미세조정 — 2026-05-24 사용자 정정으로 신설.
         *
         * 사용자 정정 (원문):
         *   "중앙라인에 노출되는 타이머와 블라인드, 게임타이틀, 블라인트표시와 앤티금액
         *    표시등의 폰트사이증을 자유롭게 실시간 설정할수있어야하고,
         *    좌측에 표시되는 스트럭처와 넥스트블라인드 표기카드또한, 카드크기를 조절해서
         *    카드안의 내용을 조검더 꽉찬 폰트사이즈로 표기"
         *
         * 8종 슬라이더 (0.5x ~ 2.0x, 디폴트 1.0x):
         *   [중앙 라인]
         *     - timer  (타이머 숫자 — mm:ss)
         *     - level  (LEVEL N 배지)
         *     - title  (heroTitle, 중앙 상단)
         *     - blinds (sb/bb 큰 폰트 — 중앙 하단)
         *     - ante   (Ante N 작은 보조 — 중앙 하단)
         *   [좌측 컬럼]
         *     - structure (BlindStructurePanel 행 폰트)
         *     - next      (NEXT BLIND 안내 카드 — showStructure=off 시)
         *   [우측 컬럼]
         *     - stats (SideStatCard 3종 PLAYERS/LATE/PRIZE)
         *
         * 실시간 반영 — onSnapshot으로 TV에 5초 이내.
         */}
        <Section
          title="🎚️ 6. 폰트 사이즈 미세조정 (실시간)"
          hint="TV 화면별 폰트 배율 0.5x ~ 2.0x · 저장 즉시 모든 TV에 반영"
        >
          <ScaleGroupHeader title="중앙 라인" subtitle="타이머/제목/블라인드 — 메인 영역" />
          <ScaleSlider
            label="⏱️ 타이머 숫자"
            value={settings.timerScale}
            onChange={(v) => update('timerScale', v)}
          />
          <ScaleSlider
            label="🎯 LEVEL 배지"
            value={settings.levelScale}
            onChange={(v) => update('levelScale', v)}
          />
          <ScaleSlider
            label="🏆 토너 제목"
            value={settings.titleScale}
            onChange={(v) => update('titleScale', v)}
          />
          <ScaleSlider
            label="💱 블라인드 (SB/BB)"
            value={settings.blindsScale}
            onChange={(v) => update('blindsScale', v)}
          />
          <ScaleSlider
            label="🪙 앤티 (Ante)"
            value={settings.anteScale}
            onChange={(v) => update('anteScale', v)}
          />

          <ScaleGroupHeader title="좌측 컬럼" subtitle="스트럭쳐 · NEXT 안내" />
          <ScaleSlider
            label="📋 스트럭쳐 (5레벨)"
            value={settings.structureScale}
            onChange={(v) => update('structureScale', v)}
          />
          <ScaleSlider
            label="▶ NEXT BLIND 카드"
            value={settings.nextScale}
            onChange={(v) => update('nextScale', v)}
            hint="스트럭쳐 OFF일 때만 노출"
          />

          <ScaleGroupHeader title="우측 컬럼" subtitle="PLAYERS / LATE / PRIZE" />
          <ScaleSlider
            label="📊 우측 stat 카드"
            value={settings.statsScale}
            onChange={(v) => update('statsScale', v)}
          />

          {/* 한 번에 전체 리셋 */}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setSettings((p) => ({
                  ...p,
                  timerScale: 1.0,
                  levelScale: 1.0,
                  titleScale: 1.0,
                  blindsScale: 1.0,
                  anteScale: 1.0,
                  structureScale: 1.0,
                  nextScale: 1.0,
                  statsScale: 1.0,
                }));
                setDirty(true);
              }}
              className="text-[10.5px] font-bold text-gray-600 hover:text-black underline underline-offset-2"
            >
              ↺ 모두 1.0x로 초기화
            </button>
          </div>
        </Section>

        {/* 사운드 */}
        <Section title="🔔 7. 사운드 알림" hint="TV가 켜진 브라우저에서 작동">
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

/**
 * ScaleSlider — 폰트 배율 슬라이더 (2026-05-24 신설).
 * 0.5x ~ 2.0x, 0.05 step. 좌측 라벨 + 중앙 슬라이더 + 우측 현재 배율(예: 1.20x).
 * 클램프는 clampScale로 안전 처리 (NaN/누락 → 1.0).
 */
function ScaleSlider({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const safe = clampScale(value);
  const pct = safe.toFixed(2);
  const isDefault = Math.abs(safe - 1.0) < 0.001;
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[11px] font-bold text-gray-800">{label}</div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10.5px] font-mono font-extrabold tabular-nums ${
              isDefault ? 'text-gray-500' : 'text-black'
            }`}
          >
            {pct}x
          </span>
          {!isDefault && (
            <button
              type="button"
              onClick={() => onChange(1.0)}
              className="text-[9px] text-gray-400 hover:text-black px-1.5 py-0.5 rounded hover:bg-gray-100"
              title="이 항목만 1.0x로"
            >
              ↺
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={SCALE_MIN}
        max={SCALE_MAX}
        step={0.05}
        value={safe}
        onChange={(e) => onChange(clampScale(Number(e.target.value)))}
        className="w-full accent-black"
        aria-label={`${label} 폰트 배율`}
      />
      {hint && <div className="text-[9.5px] text-gray-400 mt-0.5 leading-tight">{hint}</div>}
    </div>
  );
}

/** ScaleGroupHeader — 슬라이더 그룹 구분 헤더 (중앙/좌측/우측). */
function ScaleGroupHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-1.5 mt-3 first:mt-0 flex items-baseline gap-1.5 border-b border-gray-100 pb-1">
      <span className="text-[10.5px] font-extrabold text-gray-900 tracking-wide">{title}</span>
      <span className="text-[9.5px] text-gray-400">— {subtitle}</span>
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
          {/* 2026-05-24 PM 정정 #3: LEVEL은 타이머 바로 위에 작은 배지로. */}
          <div className="inline-flex flex-col items-center">
            <div
              className="rounded-full px-2 py-0.5 mb-1 border flex items-center gap-1"
              style={{
                background: `linear-gradient(135deg, ${settings.accentColor}26, rgba(0,0,0,0.5))`,
                borderColor: `${settings.accentColor}66`,
              }}
            >
              <span
                className="font-extrabold tracking-[0.18em] text-[8px]"
                style={{ color: settings.accentColor }}
              >
                ▶ NOW
              </span>
              <span className="text-[8px] opacity-40" style={{ color: settings.textColor }}>·</span>
              <span
                className="font-extrabold tracking-[0.15em] text-[10px]"
                style={{ color: settings.textColor }}
              >
                LV 4
              </span>
            </div>
            <div
              className="font-mono font-extrabold leading-none text-center"
              style={{ color: settings.timerColor, fontSize: '56px', letterSpacing: '-0.04em' }}
            >
              {mm}:{ss}
            </div>
            {/* 진행률 바 */}
            <div className="mt-1.5 h-1 bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full"
                style={{ width: '54%', background: settings.blindsColor }}
              />
            </div>
            {/* 2026-05-24 PM 정정 #5: 블라인드 금액을 진행바 아래 중앙으로 이동 (사용자 정정). */}
            <div
              className="font-mono font-extrabold text-center mt-2"
              style={{ color: settings.blindsColor, fontSize: '28px', letterSpacing: '-0.02em' }}
            >
              300 / 600
            </div>
            <div className="text-[10px] text-center mt-0.5" style={{ color: settings.textColor, opacity: 0.6 }}>
              Ante 75
            </div>
          </div>

          {/* 미니 통계 */}
          <div className="flex gap-6 mt-3 text-center" style={{ color: settings.textColor }}>
            <Stat label="PLAYERS" value="18/24" />
            <Stat label="PRIZE POOL" value="108T" />
            <Stat label="NEXT" value="LV5 · 400/800" />
          </div>
        </div>

        {/* 셋째 줄 — 하단 마퀴: 2026-05-24 PM 정정으로 미리보기 제거 (TV에 실제로 안 띄움). */}
        {false && (
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
 * 2026-05-23: positionDiagram(미니 위치 다이어그램) 추가로 "어디에 노출"이 한눈에.
 */
function TextLineEditor({
  badge,
  subtitle,
  positionDiagram,
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
  positionDiagram?: React.ReactNode;
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
      {/* 헤더 — 배지 + 부제 + 위치 다이어그램 (좌:정보, 우:다이어그램) */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-extrabold text-gray-900 tracking-wide">{badge}</div>
          <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{subtitle}</div>
        </div>
        {positionDiagram}
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

/**
 * PositionDiagram — TV 화면 (16:9 미니 카드) 위에 현재 텍스트 줄이 어디에 노출되는지
 * 핑크 박스로 표시. 사장님이 "이 텍스트가 어디 박히는지" 한눈에 확인.
 *
 * - title  → 상단 1/3 영역 풀폭
 * - note   → 상단 1/3 ~ 중앙 사이
 * - marquee → 하단 좁은 띠 풀폭
 */
function PositionDiagram({ active }: { active: 'title' | 'note' | 'marquee' }) {
  const HIGHLIGHT = '#FF1F8F';
  const GHOST = 'rgba(255,255,255,0.10)';
  const isTitle = active === 'title';
  const isNote = active === 'note';
  const isMarquee = active === 'marquee';
  return (
    <div
      title={`TV 화면에서 이 영역에 노출됩니다`}
      style={{
        width: 96,
        aspectRatio: '16 / 9',
        background: 'linear-gradient(135deg,#0A0A0A 0%,#1A1A2E 100%)',
        borderRadius: 6,
        position: 'relative',
        flexShrink: 0,
        overflow: 'hidden',
        border: '1.5px solid #111',
      }}
    >
      {/* title slot — 상단 22% */}
      <div
        style={{
          position: 'absolute',
          top: '12%',
          left: '8%',
          right: '8%',
          height: '14%',
          borderRadius: 2,
          background: isTitle ? HIGHLIGHT : GHOST,
          boxShadow: isTitle ? `0 0 6px ${HIGHLIGHT}` : undefined,
        }}
      />
      {/* note slot — 상단 30% */}
      <div
        style={{
          position: 'absolute',
          top: '30%',
          left: '14%',
          right: '14%',
          height: '8%',
          borderRadius: 2,
          background: isNote ? HIGHLIGHT : GHOST,
          boxShadow: isNote ? `0 0 6px ${HIGHLIGHT}` : undefined,
        }}
      />
      {/* timer placeholder — 항상 회색 */}
      <div
        style={{
          position: 'absolute',
          top: '46%',
          left: '24%',
          right: '24%',
          height: '24%',
          borderRadius: 2,
          background: 'rgba(255,255,255,0.05)',
        }}
      />
      {/* marquee slot — 타이머 바로 아래, 타이머 폭(left/right 24%) 한정 (2026-05-24 부활) */}
      <div
        style={{
          position: 'absolute',
          left: '24%',
          right: '24%',
          top: '72%',
          height: '8%',
          borderRadius: 2,
          background: isMarquee ? HIGHLIGHT : GHOST,
          boxShadow: isMarquee ? `0 0 6px ${HIGHLIGHT}` : undefined,
        }}
      />
      {/* 깜빡이 효과 — 활성 영역만 */}
      <style jsx>{`
        div[style*="${HIGHLIGHT}"] {
          animation: pos-pulse 1.6s ease-in-out infinite;
        }
        @keyframes pos-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}

/**
 * PositionDiagramAll — 3줄이 모두 어디 노출되는지 한 장의 가이드.
 * Section 상단에 한 번 노출해서 전체 구도 인지.
 */
function PositionDiagramAll() {
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gradient-to-br from-gray-50 to-white">
      <div className="text-[10.5px] font-extrabold text-gray-900 mb-2 tracking-wide">
        🖥️ 전체 위치 미리보기 — 각 줄이 TV 어디에 노출되는지
      </div>
      <div className="flex items-center gap-3">
        <div
          style={{
            width: 180,
            aspectRatio: '16 / 9',
            background: 'linear-gradient(135deg,#0A0A0A 0%,#1A1A2E 100%)',
            borderRadius: 8,
            position: 'relative',
            flexShrink: 0,
            overflow: 'hidden',
            border: '2px solid #111',
          }}
        >
          {/* title */}
          <div
            style={{
              position: 'absolute', top: '12%', left: '8%', right: '8%', height: '14%',
              borderRadius: 3, background: '#FF1F8F', boxShadow: '0 0 6px #FF1F8F',
            }}
          />
          <div style={{
            position: 'absolute', top: '7%', right: '10%',
            fontSize: 8, color: '#FF1F8F', fontWeight: 800,
          }}>🎯 1</div>

          {/* note */}
          <div
            style={{
              position: 'absolute', top: '30%', left: '14%', right: '14%', height: '8%',
              borderRadius: 2, background: '#3B82F6', boxShadow: '0 0 6px #3B82F6',
            }}
          />
          <div style={{
            position: 'absolute', top: '28%', right: '16%',
            fontSize: 8, color: '#3B82F6', fontWeight: 800,
          }}>📋 2</div>

          {/* timer ghost */}
          <div
            style={{
              position: 'absolute', top: '46%', left: '24%', right: '24%', height: '20%',
              borderRadius: 2, background: 'rgba(255,255,255,0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, color: 'rgba(255,255,255,0.30)', fontWeight: 800,
              letterSpacing: '0.1em',
            }}
          >
            18:30
          </div>

          {/* marquee slot — 2026-05-24 부활. 위치는 타이머 바로 아래 (중앙 하단),
              폭은 타이머 폭과 동일 (left/right 모두 24%). 화면 전체 폭 X. */}
          <div
            style={{
              position: 'absolute', top: '70%', left: '24%', right: '24%', height: '7%',
              borderRadius: 2, background: '#10B981', boxShadow: '0 0 6px #10B981',
              overflow: 'hidden',
            }}
          />
          <div style={{
            position: 'absolute', top: '70%', right: '15%',
            fontSize: 8, color: '#10B981', fontWeight: 800,
          }}>📢 3</div>
        </div>
        <div className="flex-1 min-w-0 text-[10px] leading-relaxed space-y-1">
          <div className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, background: '#FF1F8F', borderRadius: 2 }} />
            <span className="font-bold text-gray-900">🏆 1. 토너 제목</span>
            <span className="text-gray-500">— 정중앙 상단, 가장 크게</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, background: '#3B82F6', borderRadius: 2 }} />
            <span className="font-bold text-gray-900">📝 2. 설명</span>
            <span className="text-gray-500">— 제목 바로 아래</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, background: '#10B981', borderRadius: 2 }} />
            <span className="font-bold text-gray-900">📢 3. 자막 공지</span>
            <span className="text-gray-500">— 타이머 하단 · 좌→우 · 타이머 폭만</span>
          </div>
        </div>
      </div>
    </div>
  );
}
