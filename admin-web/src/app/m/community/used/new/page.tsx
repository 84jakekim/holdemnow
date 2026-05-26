'use client';

/**
 * /m/community/used/new — 일반 사용자 중고 등록 페이지
 *
 * 정책 (memory: project_holdemnow_community v0.2):
 *   - 매장 owner가 아닌 일반 사용자도 등록 가능 (2026-05-26 완화)
 *   - 1일 3건 한도 (countUserUsedListingsToday 검증 + writeRateLimits)
 *   - 신고 누적 3건 시 autoHideOnReports가 자동 status='hidden'
 *   - 이미지 1~4장 필수, 만료 30일 (매장과 동일)
 *
 * 매장 owner는 /admin/[storeId] UsedItemsPanel을 그대로 사용 (이 페이지 미사용).
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks';
import {
  type UsedCategory,
  type UsedCondition,
  USED_CATEGORY_LABELS,
  USED_CONDITION_LABELS,
  USER_USED_DAILY_LIMIT,
  countUserUsedListingsToday,
  createUserUsedListing,
  uploadCommunityImage,
  hasBannedKeyword,
} from '@/lib/community';
import { checkWriteRateLimit } from '@/lib/moderation';

const REGIONS = ['부산 해운대구', '부산 부산진구', '부산 남구', '부산 북구', '부산 강서구', '경남 창원', '경남 김해', '기타'];

interface Form {
  title: string;
  body: string;
  category: UsedCategory;
  price: string;
  priceNegotiable: boolean;
  condition: UsedCondition;
  region: string;
  phone: string;
  kakaoOpenChat: string;
  authorDisplayName: string;
  images: string[];
}

function defaultForm(): Form {
  return {
    title: '',
    body: '',
    category: 'chip',
    price: '',
    priceNegotiable: false,
    condition: 'used',
    region: REGIONS[0],
    phone: '',
    kakaoOpenChat: '',
    authorDisplayName: '',
    images: [],
  };
}

export default function UsedNewPage() {
  const router = useRouter();
  const authState = useAuth();
  const [form, setForm] = useState<Form>(defaultForm());
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 비로그인 차단
  useEffect(() => {
    if (authState.status === 'anonymous') {
      alert('로그인이 필요합니다');
      router.replace('/m/community/used');
    }
  }, [authState.status, router]);

  // 오늘 등록 건수 조회
  useEffect(() => {
    if (authState.status !== 'authenticated') return;
    (async () => {
      const c = await countUserUsedListingsToday(authState.user.uid);
      setTodayCount(c);
      setForm((f) => ({
        ...f,
        authorDisplayName:
          authState.user.displayName ?? authState.user.email?.split('@')[0] ?? '익명',
      }));
    })();
  }, [authState]);

  if (authState.status === 'loading') {
    return <div className="p-6 text-center text-sm text-gray-500">로딩 중…</div>;
  }
  if (authState.status !== 'authenticated') return null;

  const remaining = todayCount === null ? null : Math.max(0, USER_USED_DAILY_LIMIT - todayCount);
  const limitReached = remaining !== null && remaining === 0;

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (form.images.length >= 4) {
      alert('이미지는 최대 4장까지 업로드 가능합니다');
      return;
    }
    setUploadingImg(true);
    try {
      if (authState.status !== 'authenticated') return;
      const url = await uploadCommunityImage(`user_${authState.user.uid}`, file);
      setForm((f) => ({ ...f, images: [...f.images, url] }));
    } catch (err) {
      alert(err instanceof Error ? err.message : '이미지 업로드 실패');
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeImage(idx: number) {
    setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== idx) }));
  }

  async function handleSave() {
    if (authState.status !== 'authenticated') return;
    if (!form.authorDisplayName.trim()) { alert('닉네임을 입력해주세요'); return; }
    if (!form.title.trim()) { alert('제목을 입력해주세요'); return; }
    if (!form.body.trim()) { alert('상품 설명을 입력해주세요'); return; }
    if (form.images.length === 0) { alert('이미지를 1장 이상 업로드해주세요'); return; }
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) {
      alert('올바른 가격을 입력해주세요');
      return;
    }
    if (!form.phone.trim() && !form.kakaoOpenChat.trim()) {
      alert('전화 또는 카카오 오픈채팅 URL을 하나 이상 입력해주세요');
      return;
    }
    if (hasBannedKeyword(form.title) || hasBannedKeyword(form.body)) {
      alert('금지된 표현이 포함되어 있어요');
      return;
    }
    if (limitReached) {
      alert(`하루 ${USER_USED_DAILY_LIMIT}건까지만 등록할 수 있습니다`);
      return;
    }

    setSaving(true);
    try {
      // writeRateLimits 5분 5회 보강
      const ok = await checkWriteRateLimit(authState.user.uid, 'community', 5, 5 * 60 * 1000);
      if (!ok) {
        alert('너무 자주 작성하셨어요. 잠시 후 다시 시도해주세요.');
        setSaving(false);
        return;
      }

      const itemId = await createUserUsedListing({
        authorUid: authState.user.uid,
        authorDisplayName: form.authorDisplayName.trim(),
        title: form.title.trim(),
        body: form.body.trim(),
        category: form.category,
        price: Number(form.price),
        priceNegotiable: form.priceNegotiable,
        condition: form.condition,
        region: form.region || undefined,
        contact: {
          phone: form.phone.trim() || undefined,
          kakaoOpenChat: form.kakaoOpenChat.trim() || undefined,
        },
        images: form.images,
      });
      alert('등록 완료');
      router.replace(`/m/community/used/${itemId}`);
    } catch (e) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: 'var(--bg-sub)', minHeight: '100vh' }}>
      <header
        className="px-5 pt-5 pb-6 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #B45309 0%, #F59E0B 55%, #FCD34D 100%)' }}
      >
        <div className="relative z-10 flex items-start justify-between gap-3">
          <button
            onClick={() => router.back()}
            aria-label="뒤로"
            className="hero-pink-action w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 tap"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase opacity-90">SELL</div>
            <h1 className="h2 font-serif mt-1.5">🛒 중고 등록</h1>
            <p className="text-[13px] font-semibold opacity-90 mt-1.5">
              하루 {USER_USED_DAILY_LIMIT}건까지 · 30일 후 자동 만료
            </p>
          </div>
          <div className="w-9 h-9 flex-shrink-0" aria-hidden />
        </div>
      </header>

      {/* 한도 안내 */}
      {todayCount !== null && (
        <div
          className="mx-4 mt-3 px-3 py-2.5 rounded-r-md text-[12px] leading-relaxed"
          style={{
            background: limitReached ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
            color: limitReached ? '#B91C1C' : '#15803D',
            border: limitReached ? '1px solid rgba(239,68,68,0.18)' : '1px solid rgba(34,197,94,0.18)',
          }}
        >
          {limitReached
            ? `⚠️ 오늘 한도(${USER_USED_DAILY_LIMIT}건) 도달. 내일 다시 등록할 수 있어요.`
            : `오늘 ${todayCount}/${USER_USED_DAILY_LIMIT}건 등록 · 남은 한도 ${remaining}건`}
        </div>
      )}

      <div className="p-5 space-y-4 max-w-md mx-auto">
        {/* 닉네임 */}
        <Field label="닉네임 *">
          <input
            type="text"
            value={form.authorDisplayName}
            onChange={(e) => setForm({ ...form, authorDisplayName: e.target.value })}
            placeholder="공개될 닉네임"
            maxLength={30}
            className="w-full px-3 py-2.5 rounded-md border text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
          />
        </Field>

        {/* 카테고리 */}
        <Field label="카테고리 *">
          <div className="grid grid-cols-3 gap-1.5">
            {(Object.keys(USED_CATEGORY_LABELS) as UsedCategory[]).map((k) => {
              const active = form.category === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm({ ...form, category: k })}
                  className={`tap py-2 text-xs font-bold rounded-md border ${active ? '' : 'bg-white'}`}
                  style={active
                    ? { background: 'var(--gold)', color: '#fff', borderColor: 'var(--gold)' }
                    : { borderColor: 'var(--border)', color: 'var(--text-2)' }}
                >
                  {USED_CATEGORY_LABELS[k]}
                </button>
              );
            })}
          </div>
        </Field>

        {/* 제목 */}
        <Field label="제목 *">
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="예: 사용감 있는 1000개 칩 세트"
            maxLength={60}
            className="w-full px-3 py-2.5 rounded-md border text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
          />
        </Field>

        {/* 본문 */}
        <Field label="상품 설명 *">
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="상태·구매시기·거래장소 등"
            rows={5}
            maxLength={1000}
            className="w-full px-3 py-2.5 rounded-md border text-sm resize-none"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
          />
        </Field>

        {/* 가격 */}
        <Field label="가격 (원) *">
          <div className="flex gap-2 items-center">
            <input
              type="number"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="50000"
              inputMode="numeric"
              className="flex-1 px-3 py-2.5 rounded-md border text-sm font-mono"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
            />
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={form.priceNegotiable}
                onChange={(e) => setForm({ ...form, priceNegotiable: e.target.checked })}
              />
              협의가능
            </label>
          </div>
        </Field>

        {/* 상태 */}
        <Field label="상품 상태 *">
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(USED_CONDITION_LABELS) as UsedCondition[]).map((k) => {
              const active = form.condition === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm({ ...form, condition: k })}
                  className={`tap py-2 text-xs font-bold rounded-md border`}
                  style={active
                    ? { background: 'var(--gold)', color: '#fff', borderColor: 'var(--gold)' }
                    : { borderColor: 'var(--border)', color: 'var(--text-2)', background: '#fff' }}
                >
                  {USED_CONDITION_LABELS[k]}
                </button>
              );
            })}
          </div>
        </Field>

        {/* 지역 */}
        <Field label="거래 지역">
          <select
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
            className="w-full px-3 py-2.5 rounded-md border text-sm bg-white"
            style={{ borderColor: 'var(--border)' }}
          >
            {REGIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>

        {/* 이미지 */}
        <Field label={`사진 (${form.images.length}/4) *`}>
          <div className="grid grid-cols-4 gap-2">
            {form.images.map((url, i) => (
              <div key={url} className="relative aspect-square rounded-md overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center"
                  aria-label="삭제"
                >×</button>
              </div>
            ))}
            {form.images.length < 4 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImg}
                className="aspect-square rounded-md border-2 border-dashed flex items-center justify-center text-2xl text-gray-400 tap disabled:opacity-50"
                style={{ borderColor: 'var(--border)' }}
              >
                {uploadingImg ? '…' : '+'}
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
        </Field>

        {/* 연락 */}
        <Field label="전화 또는 카카오 오픈채팅 (하나 이상) *">
          <div className="space-y-2">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="010-0000-0000"
              className="w-full px-3 py-2.5 rounded-md border text-sm"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
            />
            <input
              type="url"
              value={form.kakaoOpenChat}
              onChange={(e) => setForm({ ...form, kakaoOpenChat: e.target.value })}
              placeholder="https://open.kakao.com/o/..."
              className="w-full px-3 py-2.5 rounded-md border text-sm"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
            />
          </div>
        </Field>

        {/* 안내 */}
        <div className="px-3 py-2.5 rounded-r-md text-[11px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.04)', color: 'var(--text-3)' }}>
          💡 직거래는 본인 책임입니다. 사기 의심 시 즉시 신고해주세요.
          신고 누적 3건 시 자동 숨김 처리됩니다.
        </div>

        {/* 저장 */}
        <button
          onClick={handleSave}
          disabled={saving || limitReached}
          className="btn-brand tap w-full py-3.5 text-sm font-extrabold disabled:opacity-50"
        >
          {saving ? '등록 중…' : limitReached ? '오늘 한도 도달' : '🛒 등록하기'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold text-gray-700 mb-1.5">{label}</div>
      {children}
    </div>
  );
}
