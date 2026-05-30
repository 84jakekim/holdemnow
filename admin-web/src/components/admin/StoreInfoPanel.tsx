'use client';

import { useEffect, useRef, useState } from 'react';
import type { StoreDoc } from '@/lib/hooks';
import { useStoreDoc } from '@/lib/hooks';
import {
  FACILITY_OPTIONS,
  updateStoreInfo,
  uploadStorePhoto,
  deleteStorePhotoByUrl,
} from '@/lib/storeInfo';
import { moderateText } from '@/lib/moderation';
import { geocodeAddress } from '@/lib/kakao';
import BusinessHoursPicker from '@/components/common/BusinessHoursPicker';

const PITCH_MAX = 40;
const PITCH_EXAMPLES = [
  '우리 매장 딜러가 예뻐요',
  'AA 하루 10번 나옴',
  '신규 가입 시 칩 +50%',
  '주차 100% 무료',
  '오프닝 이벤트 진행 중',
];

interface Props {
  storeId: string;
}

interface FormState {
  name: string;
  address: string;
  addressDetail: string;
  phone: string;
  hours: string;
  description: string;
  facilities: string[];
  pitch: string;
}

function toForm(store: StoreDoc): FormState {
  return {
    name: store.name ?? '',
    address: store.address ?? '',
    addressDetail: store.addressDetail ?? '',
    phone: store.phone ?? '',
    hours: store.hours ?? '',
    description: store.description ?? '',
    facilities: store.facilities ?? [],
    pitch: store.pitch ?? '',
  };
}

export default function StoreInfoPanel({ storeId }: Props) {
  const store = useStoreDoc(storeId);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pitchExamplesOpen, setPitchExamplesOpen] = useState(false);
  const photoUrls = store?.photoUrls ?? [];
  const fileInputRef = useRef<HTMLInputElement>(null);

  // store가 로드되면 폼 초기화 (한 번만)
  useEffect(() => {
    if (store && form === null) setForm(toForm(store));
  }, [store, form]);

  if (store === undefined || form === null) {
    return <div className="text-sm text-gray-500">로딩 중…</div>;
  }
  if (store === null) {
    return <div className="text-sm text-red-600">매장 정보를 찾을 수 없습니다</div>;
  }

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setSavedAt(null);
  };

  const toggleFacility = (f: string) => {
    if (!form) return;
    update(
      'facilities',
      form.facilities.includes(f)
        ? form.facilities.filter((x) => x !== f)
        : [...form.facilities, f],
    );
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      // pitch 모더레이션 — 입력된 경우에만 검사
      const pitchTrimmed = form.pitch.trim();
      if (pitchTrimmed.length > 0) {
        const modResult = moderateText(pitchTrimmed, { allowEmpty: false, maxLength: PITCH_MAX });
        if (!modResult.ok) {
          setError(modResult.message ?? '한마디 자랑에 부적절한 내용이 포함됐어요');
          setSaving(false);
          return;
        }
      }

      const updates: Parameters<typeof updateStoreInfo>[1] = {
        name: form.name,
        address: form.address,
        addressDetail: form.addressDetail,
        phone: form.phone,
        hours: form.hours,
        description: form.description,
        facilities: form.facilities,
        // pitch: 빈 문자열이면 null로 저장해서 Firestore에서 필드 제거 (사용자 앱 카드 노출 차단)
        pitch: pitchTrimmed.length > 0 ? pitchTrimmed : null,
      };
      // 주소가 바뀌었으면 카카오 Geocoder로 lat/lng 재계산
      const addressChanged = (store?.address ?? '') !== form.address;
      if (addressChanged && form.address.trim()) {
        const coords = await geocodeAddress(form.address);
        if (coords) {
          updates.lat = coords.lat;
          updates.lng = coords.lng;
        }
      }
      await updateStoreInfo(storeId, updates);
      setSavedAt(Date.now());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const newUrls: string[] = [];
      // 최대 10장까지
      for (const file of Array.from(files)) {
        if (photoUrls.length + newUrls.length >= 10) break;
        const url = await uploadStorePhoto(storeId, file);
        newUrls.push(url);
      }
      if (newUrls.length > 0) {
        await updateStoreInfo(storeId, { photoUrls: [...photoUrls, ...newUrls] });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePhoto = async (url: string) => {
    if (!window.confirm('이 사진을 삭제할까요?')) return;
    try {
      await updateStoreInfo(storeId, { photoUrls: photoUrls.filter((u) => u !== url) });
      // Storage에서도 삭제 (실패해도 진행)
      await deleteStorePhotoByUrl(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <div className="section-title" style={{ color: 'var(--brand)' }}>STORE PROFILE</div>
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>🏬 매장 정보</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
          여기서 수정한 내용은 모바일 앱에 즉시 반영됩니다 ·{' '}
          <span className="mono pill" style={{ fontSize: 10 }}>{store.status ?? 'pending'}</span>
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* 사진 업로드 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold text-gray-500 tracking-wider">
              대표 사진 ({photoUrls.length}/10) · 첫 사진이 대표
            </div>
            {uploading && <span className="text-[11px] text-gray-500">업로드 중…</span>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {photoUrls.map((url) => (
              <div
                key={url}
                className="aspect-video rounded-lg bg-gray-100 relative overflow-hidden group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="매장" className="w-full h-full object-cover" />
                <button
                  onClick={() => removePhoto(url)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition"
                >
                  ✕
                </button>
              </div>
            ))}
            {photoUrls.length < 10 && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="aspect-video rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-gray-500 transition flex flex-col items-center justify-center text-xs font-bold text-gray-500"
              >
                {uploading ? '⏳' : '+ 사진'}
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="text-[10px] text-gray-400 mt-2">
            💡 5MB 이하 이미지. 사진이 풍성할수록 모바일 노출 효과가 큼 (베타 평균 +180%).
          </div>
        </div>

        {/* 기본 정보 */}
        <Field label="매장명">
          <input
            className="form-input"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="주소">
            <input
              className="form-input"
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
            />
          </Field>
          <Field label="상세 주소">
            <input
              className="form-input"
              value={form.addressDetail}
              onChange={(e) => update('addressDetail', e.target.value)}
              placeholder="2층 / B1"
            />
          </Field>
        </div>

        <Field label="전화">
          <input
            className="form-input font-mono"
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="051-000-0000"
          />
        </Field>

        <Field label="영업시간">
          <BusinessHoursPicker
            value={form.hours}
            onChange={(v) => update('hours', v)}
          />
        </Field>

        <Field label="매장 소개">
          <textarea
            className="form-input min-h-[80px]"
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            placeholder="매장의 특징·분위기·운영 스타일"
          />
        </Field>

        <Field label={`시설 (${form.facilities.length}개 선택)`}>
          {/* 노출 위치 안내 — 매장 사장님이 이 기능을 활용할 수 있도록 */}
          <div
            className="rounded-xl p-3 mb-3 text-[12px] leading-relaxed"
            style={{
              background: 'rgba(255,31,143,0.06)',
              border: '1px solid rgba(255,31,143,0.18)',
              color: '#5C1A3B',
            }}
          >
            <div className="font-extrabold mb-1 flex items-center gap-1" style={{ color: '#C4156D' }}>
              <span aria-hidden>📍</span> 어디에 노출되나요?
            </div>
            <ul className="space-y-0.5 ml-1">
              <li>• <b>사용자 앱 매장 카드</b> — '내 주변 매장' 섹션에서 사진 위 작은 칩으로 노출 (선택한 것 중 처음 2개)</li>
              <li>• <b>매장 상세 페이지</b> — 시설 태그 전체 표시</li>
              <li>• <b>매장 찾기 필터</b> — 사용자가 시설별로 매장을 검색할 수 있음</li>
            </ul>
            <div className="mt-1.5 text-[11px]" style={{ color: '#8B3563' }}>
              💡 자주 어필하고 싶은 특징을 <b>먼저(맨 앞)</b> 선택하세요 — 카드에 처음 2개만 보입니다.
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FACILITY_OPTIONS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleFacility(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border-[1.5px] transition ${
                  form.facilities.includes(f)
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-gray-900 border-gray-200'
                }`}
              >
                {form.facilities.includes(f) ? '✓ ' : ''}{f}
              </button>
            ))}
          </div>
        </Field>

        {/* 한마디 자랑 (pitch) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] font-bold text-gray-500 tracking-wider">
              한마디 자랑
              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold tracking-widest" style={{ background: '#FFF0F7', color: '#FF1F8F' }}>
                NEW
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPitchExamplesOpen((v) => !v)}
              className="text-[10px] font-semibold transition hover:opacity-70"
              style={{ color: '#FF1F8F', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {pitchExamplesOpen ? '예시 닫기 ↑' : '예시 보기 ↓'}
            </button>
          </div>

          {pitchExamplesOpen && (
            <div className="mb-2 rounded-xl p-3 flex flex-col gap-1.5" style={{ background: '#FFF0F7', border: '1px solid rgba(255,31,143,0.15)' }}>
              <div className="text-[10px] font-extrabold mb-1" style={{ color: '#FF1F8F' }}>예시 클릭 시 바로 적용돼요</div>
              {PITCH_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => { update('pitch', ex); setPitchExamplesOpen(false); }}
                  className="text-left text-[12px] font-medium py-1.5 px-2.5 rounded-lg transition hover:bg-pink-100"
                  style={{ color: '#333', background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,31,143,0.10)' }}
                >
                  &ldquo;{ex}&rdquo;
                </button>
              ))}
            </div>
          )}

          <div className="relative">
            <input
              className="form-input pr-14"
              value={form.pitch}
              onChange={(e) => {
                const v = e.target.value;
                if (v.length <= PITCH_MAX) update('pitch', v);
              }}
              placeholder="예: 신규 가입 시 칩 +50% 증정"
              maxLength={PITCH_MAX}
              aria-label="한마디 자랑 입력 (최대 40자)"
            />
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold tabular-nums"
              style={{ color: form.pitch.length >= PITCH_MAX ? '#EF4444' : form.pitch.length > 30 ? '#F59E0B' : '#aaa' }}
            >
              {form.pitch.length}/{PITCH_MAX}
            </span>
          </div>
          <div className="text-[10px] mt-1.5" style={{ color: '#888' }}>
            입력 시 모바일 매장 카드에 바로 표시돼요. 비워두면 노출 안 됩니다.
          </div>

          {/* 미리보기 */}
          {form.pitch.trim().length > 0 && (
            <div className="mt-2 rounded-xl px-3 py-2.5 flex items-center gap-2" style={{ background: 'linear-gradient(90deg, rgba(255,31,143,0.08) 0%, rgba(255,107,170,0.06) 100%)', border: '1px solid rgba(255,31,143,0.18)' }}>
              <span style={{ fontSize: 14 }}>💬</span>
              <span className="text-[12px] font-bold italic" style={{ color: '#FF1F8F' }}>&ldquo;{form.pitch.trim()}&rdquo;</span>
              <span className="ml-auto text-[10px]" style={{ color: '#bbb' }}>앱 카드 미리보기</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            disabled={saving}
            className="bg-black text-white px-6 py-3 rounded-xl font-bold text-sm disabled:opacity-40"
          >
            {saving ? '저장 중…' : '💾 저장'}
          </button>
          {savedAt && (
            <span className="text-xs text-green-600 font-bold">
              ✓ 저장됨 · 모바일에 즉시 반영
            </span>
          )}
        </div>
      </div>

      <style jsx global>{`
        .form-input {
          background: #fff;
          border: 1.5px solid #eaeaea;
          border-radius: 8px;
          padding: 8px 12px;
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}
