'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type UsedListing,
  type UsedCategory,
  type UsedCondition,
  type DealStatus,
  USED_CATEGORY_LABELS,
  USED_CONDITION_LABELS,
  DEAL_STATUS_LABELS,
  formatUsedPrice,
  formatRelativeTime,
  subscribeStoreAllUsedListings,
  createUsedListing,
  updateUsedListing,
  deleteUsedListing,
  uploadUsedImage,
  hasBannedKeyword,
} from '@/lib/community';
import { useAuth } from '@/lib/hooks';
import { EmptyState } from '@/components/ui';

/* ============================================================
 * UsedItemsPanel — 매장 어드민 중고거래 관리 패널
 * /admin/[storeId] activeMenu === 'used'
 * 권한: 매장 owner 전용 (authorType: 'store')
 * JobsPanel 구조 통일
 * ========================================================== */

interface UsedItemsPanelProps {
  storeId: string;
  storeName: string;
  storePhotoUrl?: string;
}

type ModalMode = 'create' | 'edit';

interface UsedForm {
  title: string;
  body: string;
  category: UsedCategory;
  price: string;
  priceNegotiable: boolean;
  condition: UsedCondition;
  dealStatus: DealStatus;
  region: string;
  phone: string;
  kakaoOpenChat: string;
  images: string[];
}

function defaultForm(): UsedForm {
  return {
    title: '',
    body: '',
    category: 'chip',
    price: '',
    priceNegotiable: false,
    condition: 'used',
    dealStatus: 'selling',
    region: '',
    phone: '',
    kakaoOpenChat: '',
    images: [],
  };
}

const REGIONS = ['부산 해운대구', '부산 부산진구', '부산 남구', '부산 북구', '부산 강서구', '경남 창원', '경남 김해'];

export default function UsedItemsPanel({ storeId, storeName, storePhotoUrl }: UsedItemsPanelProps) {
  const authState = useAuth();
  const [items, setItems] = useState<UsedListing[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UsedForm>(defaultForm());
  const [saving, setSaving] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 인덱스 또는 권한 에러를 사장이 인지할 수 있도록 onError를 silent fail에서 인라인 표시로 전환.
    const unsub = subscribeStoreAllUsedListings(
      storeId,
      (list) => { setItems(list); setSubError(null); },
      (e) => {
        // eslint-disable-next-line no-console
        console.warn('[UsedItemsPanel] 중고거래 구독 실패', e);
        setSubError(e instanceof Error ? e.message : String(e));
      },
    );
    return unsub;
  }, [storeId]);

  function openCreate() {
    setModalMode('create');
    setEditingId(null);
    setForm({ ...defaultForm(), region: REGIONS[0] });
    setModalOpen(true);
  }

  function openEdit(item: UsedListing) {
    setModalMode('edit');
    setEditingId(item.id);
    setForm({
      title: item.title,
      body: item.body,
      category: item.category,
      price: item.price.toString(),
      priceNegotiable: item.priceNegotiable,
      condition: item.condition,
      dealStatus: item.dealStatus,
      region: item.region ?? '',
      phone: item.contact?.phone ?? '',
      kakaoOpenChat: item.contact?.kakaoOpenChat ?? '',
      images: item.images ?? [],
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setForm(defaultForm());
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (form.images.length >= 4) { alert('이미지는 최대 4장까지 업로드 가능합니다'); return; }
    setUploadingImg(true);
    try {
      const url = await uploadUsedImage(storeId, file);
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
    if (!form.title.trim()) { alert('제목을 입력해주세요'); return; }
    if (!form.body.trim()) { alert('상품 설명을 입력해주세요'); return; }
    if (form.images.length === 0) { alert('이미지를 1장 이상 업로드해주세요'); return; }
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) { alert('올바른 가격을 입력해주세요'); return; }
    if (!form.phone.trim() && !form.kakaoOpenChat.trim()) { alert('전화 또는 카카오 오픈채팅 URL을 하나 이상 입력해주세요'); return; }
    if (hasBannedKeyword(form.title) || hasBannedKeyword(form.body)) { alert('도박 관련 표현은 등록할 수 없어요'); return; }
    if (authState.status !== 'authenticated') { alert('로그인이 필요합니다'); return; }

    setSaving(true);
    try {
      const contact = {
        phone: form.phone || undefined,
        kakaoOpenChat: form.kakaoOpenChat || undefined,
      };
      if (modalMode === 'create') {
        await createUsedListing({
          storeId,
          storeName,
          storePhotoUrl,
          authorUid: authState.user.uid,
          title: form.title,
          body: form.body,
          category: form.category,
          price: Number(form.price),
          priceNegotiable: form.priceNegotiable,
          condition: form.condition,
          region: form.region || undefined,
          contact,
          images: form.images,
        });
      } else if (editingId) {
        await updateUsedListing(editingId, {
          title: form.title,
          body: form.body,
          category: form.category,
          price: Number(form.price),
          priceNegotiable: form.priceNegotiable,
          condition: form.condition,
          dealStatus: form.dealStatus,
          region: form.region || undefined,
          contact,
          images: form.images,
        });
      }
      closeModal();
    } catch (e) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDealStatus(itemId: string, status: DealStatus) {
    await updateUsedListing(itemId, { dealStatus: status }).catch((e) =>
      alert(`상태 변경 실패: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  async function handleDelete(itemId: string) {
    if (!confirm('삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    await deleteUsedListing(itemId).catch((e) =>
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  function daysLeft(expiresAt?: string | Date): number {
    if (!expiresAt) return 0;
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
  }

  return (
    <div>
      {/* ── 패널 헤더 ── */}
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <div className="section-title" style={{ color: 'var(--brand)' }}>USED MARKET</div>
          <h1 className="h2" style={{ color: 'var(--text-1)' }}>🛒 중고거래 관리</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>{storeName} · 매장 비품 판매</p>
        </div>
        <button
          onClick={openCreate}
          className="btn-brand flex items-center gap-1.5 px-4 h-10 text-sm tap"
          style={{ borderRadius: 'var(--r-md)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          새 매물
        </button>
      </div>

      {/* ── 구독 에러 안내 (권한·인덱스 실패) ── */}
      {subError && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-[12px] text-red-700">
          중고거래 매물을 불러오지 못했습니다. ({subError})
        </div>
      )}

      {/* ── 글 리스트 ── */}
      {items.length === 0 ? (
        <EmptyState
          icon="🛒"
          title="등록된 중고 매물이 없습니다"
          desc="우상단 &apos;새 매물&apos; 버튼으로 비품을 등록하세요."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const expired = daysLeft(item.expiresAt) === 0 && !!item.expiresAt;
            const isSold = item.dealStatus === 'sold';
            const dimmed = expired || isSold;
            return (
              <div
                key={item.id}
                className="bg-white border rounded-2xl p-5 flex flex-col gap-3"
                style={{
                  borderColor: dimmed ? '#E5E7EB' : 'rgba(255,31,143,0.18)',
                  opacity: dimmed ? 0.7 : 1,
                }}
              >
                <div className="flex gap-4">
                  {/* 썸네일 */}
                  <div
                    className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center text-2xl"
                    style={{ background: '#F3F4F6' }}
                  >
                    {item.images?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.images[0]} alt={item.title} className="w-full h-full object-cover" />
                    ) : (
                      <span aria-hidden="true">📦</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* 배지 */}
                    <div className="flex gap-1.5 mb-1 flex-wrap">
                      <span
                        className="text-[10px] font-extrabold px-2 py-0.5 rounded-full"
                        style={{
                          background: isSold ? '#F3F4F6' : expired ? '#F3F4F6' : item.dealStatus === 'reserved' ? 'rgba(251,191,36,0.15)' : 'rgba(255,31,143,0.10)',
                          color: isSold ? '#9CA3AF' : expired ? '#9CA3AF' : item.dealStatus === 'reserved' ? '#B45309' : '#FF1F8F',
                        }}
                      >
                        {expired ? '기간만료' : DEAL_STATUS_LABELS[item.dealStatus]}
                      </span>
                      <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        {USED_CATEGORY_LABELS[item.category]}
                      </span>
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                        {USED_CONDITION_LABELS[item.condition]}
                      </span>
                    </div>

                    <h3 className="text-[15px] font-extrabold text-gray-900 truncate">{item.title}</h3>
                    <div className="text-[17px] font-extrabold mt-0.5" style={{ color: dimmed ? '#9CA3AF' : '#FF1F8F' }}>
                      {formatUsedPrice(item.price, item.priceNegotiable)}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {formatRelativeTime(item.createdAt)}
                      {item.expiresAt && !expired && (
                        <> · {daysLeft(item.expiresAt)}일 후 만료</>
                      )}
                    </p>
                  </div>
                </div>

                {/* 액션 버튼 */}
                <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid #F3F4F6' }}>
                  {!dimmed && (
                    <button
                      onClick={() => openEdit(item)}
                      className="flex-1 h-9 rounded-xl text-xs font-bold text-gray-700 transition hover:bg-gray-100"
                      style={{ background: '#F3F4F6' }}
                    >
                      편집
                    </button>
                  )}
                  {!dimmed && item.dealStatus === 'selling' && (
                    <button
                      onClick={() => handleDealStatus(item.id, 'reserved')}
                      className="flex-1 h-9 rounded-xl text-xs font-bold transition hover:opacity-90"
                      style={{ background: 'rgba(251,191,36,0.15)', color: '#B45309' }}
                    >
                      예약
                    </button>
                  )}
                  {!dimmed && item.dealStatus !== 'sold' && (
                    <button
                      onClick={() => handleDealStatus(item.id, 'sold')}
                      className="flex-1 h-9 rounded-xl text-xs font-bold transition hover:opacity-90"
                      style={{ background: '#FFF7ED', color: '#C2410C' }}
                    >
                      판매완료
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="flex-1 h-9 rounded-xl text-xs font-bold transition hover:opacity-90"
                    style={{ background: '#FEF2F2', color: '#B91C1C' }}
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 모달 ── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-lg mx-4 overflow-y-auto"
            style={{ maxHeight: 'calc(100vh - 80px)' }}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-extrabold text-gray-900">
                {modalMode === 'create' ? '새 중고 매물 등록' : '중고 매물 수정'}
              </h2>
              <button
                onClick={closeModal}
                aria-label="닫기"
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* 폼 본문 */}
            <div className="p-5 flex flex-col gap-4">
              {/* 이미지 업로드 (1~4장 필수) */}
              <FieldGroup label={`이미지 (${form.images.length}/4장, 1장 이상 필수)`}>
                <div className="flex gap-2 flex-wrap">
                  {form.images.map((url, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden" style={{ border: '1px solid #E5E7EB' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`이미지 ${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => removeImage(i)}
                        aria-label={`이미지 ${i + 1} 삭제`}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: 'rgba(0,0,0,0.55)' }}
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                  {form.images.length < 4 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImg}
                      className="w-16 h-16 rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs text-gray-400 font-bold transition hover:bg-gray-100"
                      style={{ border: '2px dashed #E5E7EB' }}
                    >
                      {uploadingImg ? (
                        <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                          추가
                        </>
                      )}
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
              </FieldGroup>

              {/* 카테고리 */}
              <FieldGroup label="카테고리">
                <div className="flex gap-1.5 flex-wrap">
                  {(Object.keys(USED_CATEGORY_LABELS) as UsedCategory[]).map((c) => {
                    const active = form.category === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, category: c }))}
                        aria-pressed={active}
                        className="px-3 h-8 rounded-full text-xs font-bold transition"
                        style={{ background: active ? '#FF1F8F' : '#F3F4F6', color: active ? '#fff' : '#6B7280' }}
                      >
                        {USED_CATEGORY_LABELS[c]}
                      </button>
                    );
                  })}
                </div>
              </FieldGroup>

              {/* 제목 */}
              <FieldGroup label="제목">
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="예: 포커 칩 세트 1000개 일괄 판매"
                  className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm text-gray-900 focus:outline-none focus:border-pink-400"
                  maxLength={50}
                />
              </FieldGroup>

              {/* 가격 */}
              <FieldGroup label="가격 (원)">
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="0"
                    className="flex-1 h-10 rounded-xl border border-gray-200 px-3 text-sm text-gray-900 focus:outline-none focus:border-pink-400"
                    min={0}
                  />
                  <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.priceNegotiable}
                      onChange={(e) => setForm((f) => ({ ...f, priceNegotiable: e.target.checked }))}
                      className="w-4 h-4 accent-pink-500"
                    />
                    협의가능
                  </label>
                </div>
              </FieldGroup>

              {/* 상태 */}
              <FieldGroup label="상품 상태">
                <div className="flex gap-1.5 flex-wrap">
                  {(Object.keys(USED_CONDITION_LABELS) as UsedCondition[]).map((c) => {
                    const active = form.condition === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, condition: c }))}
                        aria-pressed={active}
                        className="px-3 h-8 rounded-full text-xs font-bold transition"
                        style={{ background: active ? '#FF1F8F' : '#F3F4F6', color: active ? '#fff' : '#6B7280' }}
                      >
                        {USED_CONDITION_LABELS[c]}
                      </button>
                    );
                  })}
                </div>
              </FieldGroup>

              {/* 수정 시 거래 상태 변경 */}
              {modalMode === 'edit' && (
                <FieldGroup label="거래 상태">
                  <div className="flex gap-1.5">
                    {(Object.keys(DEAL_STATUS_LABELS) as DealStatus[]).map((s) => {
                      const active = form.dealStatus === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, dealStatus: s }))}
                          aria-pressed={active}
                          className="px-3 h-8 rounded-full text-xs font-bold transition"
                          style={{ background: active ? '#FF1F8F' : '#F3F4F6', color: active ? '#fff' : '#6B7280' }}
                        >
                          {DEAL_STATUS_LABELS[s]}
                        </button>
                      );
                    })}
                  </div>
                </FieldGroup>
              )}

              {/* 지역 */}
              <FieldGroup label="지역">
                <select
                  value={form.region}
                  onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                  className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-pink-400"
                >
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </FieldGroup>

              {/* 본문 */}
              <FieldGroup label="상품 설명 (카톡 글 붙여넣기 OK)">
                <textarea
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder={'예)\n사용감 거의 없음. 박스 포함 판매합니다.\n직거래만 가능합니다.'}
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 leading-relaxed resize-none focus:outline-none focus:border-pink-400 font-mono"
                  style={{ whiteSpace: 'pre-wrap' }}
                />
              </FieldGroup>

              {/* 연락처 */}
              <FieldGroup label="연락처 (1개 이상 필수)">
                <div className="flex flex-col gap-2">
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="전화번호 (예: 051-123-4567)"
                    className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm text-gray-900 focus:outline-none focus:border-pink-400"
                  />
                  <input
                    type="url"
                    value={form.kakaoOpenChat}
                    onChange={(e) => setForm((f) => ({ ...f, kakaoOpenChat: e.target.value }))}
                    placeholder="카카오 오픈채팅 URL"
                    className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm text-gray-900 focus:outline-none focus:border-pink-400"
                  />
                </div>
              </FieldGroup>
            </div>

            {/* 모달 하단 CTA */}
            <div className="px-5 pb-5 flex gap-2">
              <button
                onClick={closeModal}
                className="flex-1 h-11 rounded-2xl text-sm font-bold text-gray-600 transition hover:bg-gray-100"
                style={{ background: '#F3F4F6' }}
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving || uploadingImg || !form.title.trim() || !form.body.trim()}
                className="flex-1 h-11 rounded-2xl text-sm font-bold text-white transition hover:opacity-90 active:opacity-75 disabled:opacity-40"
                style={{ background: '#FF1F8F' }}
              >
                {saving ? '저장 중…' : modalMode === 'create' ? '매물 등록' : '수정 완료'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 폼 필드 그룹 ── */
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-bold text-gray-500">{label}</label>
      {children}
    </div>
  );
}
