'use client';

/**
 * /platform/splash-ads — 본사 스플래시 광고 등록/관리
 *
 * 본사 운영자가 광고 이미지(풀스크린) + 기간 + 가중치를 등록하면
 * 사용자 앱 cold start(/m 진입 직전)에 자동 노출.
 *
 * 섹션:
 *   - 활성(now ∈ 윈도우 && isActive)
 *   - 예정(start>now)
 *   - 만료(end<now)
 *   - 비활성(isActive=false)
 *
 * 통계: 노출/클릭/CTR 카드별 표시 + 상단 전체 합계.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { auth } from '@/lib/firebase';
import {
  SPLASH_AD_DEFAULTS,
  createSplashAd,
  deleteSplashAd,
  pickActiveSplashAd,
  subscribeAllSplashAds,
  updateSplashAd,
  uploadSplashAdImage,
  type SplashAd,
} from '@/lib/splashAds';
import EmptyState from '@/components/ui/EmptyState';

// ─── 헬퍼 ─────────────────────────────────────────────────────

function toLocalInput(t?: Timestamp | null): string {
  if (!t || typeof t.toDate !== 'function') return '';
  const d = t.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(val: string): Timestamp | null {
  if (!val) return null;
  return Timestamp.fromDate(new Date(val));
}

function fmtDate(t?: Timestamp | null): string {
  if (!t || typeof t.toDate !== 'function') return '-';
  return t.toDate().toLocaleString('ko-KR', {
    year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

type Bucket = 'active' | 'scheduled' | 'expired' | 'inactive';

function classifyAd(ad: SplashAd): Bucket {
  if (!ad.isActive) return 'inactive';
  const now = Date.now();
  const start = ad.startsAt?.toMillis() ?? 0;
  const end = ad.endsAt?.toMillis() ?? 0;
  if (now < start) return 'scheduled';
  if (now > end) return 'expired';
  return 'active';
}

function ctr(impressions: number, clicks: number): string {
  if (!impressions) return '-';
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}

// ─── 페이지 ──────────────────────────────────────────────────

export default function SplashAdsPage() {
  const [ads, setAds] = useState<SplashAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SplashAd | 'new' | null>(null);
  const [previewAd, setPreviewAd] = useState<SplashAd | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeAllSplashAds(
      (data) => {
        setAds(data);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
  }, []);

  const buckets = useMemo(() => {
    const out: Record<Bucket, SplashAd[]> = {
      active: [],
      scheduled: [],
      expired: [],
      inactive: [],
    };
    for (const ad of ads) out[classifyAd(ad)].push(ad);
    return out;
  }, [ads]);

  const totals = useMemo(() => {
    const impressions = ads.reduce((s, a) => s + (a.impressions ?? 0), 0);
    const clicks = ads.reduce((s, a) => s + (a.clicks ?? 0), 0);
    return { impressions, clicks, ctr: ctr(impressions, clicks) };
  }, [ads]);

  const handleToggle = async (ad: SplashAd) => {
    await updateSplashAd(ad.id, { isActive: !ad.isActive });
  };

  const handleDelete = async (ad: SplashAd) => {
    if (!confirm(`"${ad.title}" 광고를 삭제하시겠습니까?\n등록된 이미지도 함께 삭제됩니다.`)) return;
    try {
      await deleteSplashAd(ad);
    } catch (e: unknown) {
      alert((e as Error).message);
    }
  };

  const handleTestPick = async () => {
    const picked = await pickActiveSplashAd();
    if (!picked) {
      alert('현재 활성 광고 없음 — cold start 시 기본 스플래시(핑크) 노출됩니다.');
      return;
    }
    setPreviewAd(picked);
  };

  return (
    <div>
      {/* 헤더 */}
      <div className="mb-6">
        <div className="section-title" style={{ color: 'var(--gold)' }}>SPLASH ADS</div>
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>📺 스플래시 광고 관리</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
          사용자 앱 cold start 시 자동 노출되는 풀스크린 광고. 이미지만 만들어 등록하면 즉시 반영됩니다.
        </p>
      </div>

      {/* 상단 요약 + CTA */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label="활성" value={String(buckets.active.length)} accent="#10B981" />
        <StatCard label="예정/만료/비활성" value={String(buckets.scheduled.length + buckets.expired.length + buckets.inactive.length)} />
        <StatCard label="누적 노출" value={totals.impressions.toLocaleString()} />
        <StatCard label="누적 클릭 · CTR" value={`${totals.clicks.toLocaleString()} · ${totals.ctr}`} />
      </div>

      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
          ※ 19+ / 도박 / 상금 직접 노출 콘텐츠는 등록 금지. 광고 라벨(&ldquo;광고&rdquo;)은 자동 표시됩니다.
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTestPick}
            className="px-3 py-2 text-xs font-bold rounded-xl"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          >
            현재 노출 시뮬레이션
          </button>
          <button
            onClick={() => setEditing('new')}
            className="px-4 py-2 text-sm font-bold rounded-xl text-white"
            style={{ background: '#FF1F8F' }}
          >
            + 새 광고 등록
          </button>
        </div>
      </div>

      {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
      {loading && <div className="text-sm" style={{ color: 'var(--text-3)' }}>로딩 중…</div>}

      {!loading && ads.length === 0 && (
        <EmptyState
          icon="📺"
          title="등록된 스플래시 광고가 없습니다"
          desc='우상단 "+ 새 광고 등록"으로 시작하세요. 광고가 없으면 사용자 앱은 기본 핑크 스플래시를 표시합니다.'
          variant="inline"
        />
      )}

      <BucketSection title="활성" tone="active" ads={buckets.active} onToggle={handleToggle} onEdit={setEditing} onDelete={handleDelete} />
      <BucketSection title="예정" tone="scheduled" ads={buckets.scheduled} onToggle={handleToggle} onEdit={setEditing} onDelete={handleDelete} />
      <BucketSection title="만료" tone="expired" ads={buckets.expired} onToggle={handleToggle} onEdit={setEditing} onDelete={handleDelete} />
      <BucketSection title="비활성" tone="inactive" ads={buckets.inactive} onToggle={handleToggle} onEdit={setEditing} onDelete={handleDelete} />

      {/* 모달 */}
      {editing && (
        <SplashAdModal
          ad={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {/* 시뮬레이션 프리뷰 */}
      {previewAd && (
        <PreviewModal ad={previewAd} onClose={() => setPreviewAd(null)} />
      )}
    </div>
  );
}

// ─── 통계 카드 ───────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div
        className="text-lg font-extrabold mt-0.5"
        style={{ color: accent ?? 'var(--text-1)' }}
      >
        {value}
      </div>
    </div>
  );
}

// ─── 섹션 ────────────────────────────────────────────────────

function BucketSection({
  title, tone, ads, onToggle, onEdit, onDelete,
}: {
  title: string;
  tone: Bucket;
  ads: SplashAd[];
  onToggle: (ad: SplashAd) => void;
  onEdit: (ad: SplashAd) => void;
  onDelete: (ad: SplashAd) => void;
}) {
  if (ads.length === 0) return null;
  const toneColor = tone === 'active' ? '#10B981'
    : tone === 'scheduled' ? '#3B82F6'
    : tone === 'expired' ? '#9CA3AF'
    : '#EF4444';
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: toneColor }}
          aria-hidden
        />
        <h2 className="text-sm font-extrabold" style={{ color: 'var(--text-1)' }}>
          {title} <span style={{ color: 'var(--text-3)' }}>({ads.length})</span>
        </h2>
      </div>
      <div className="space-y-3">
        {ads.map((ad) => (
          <AdRow key={ad.id} ad={ad} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

// ─── 행 ──────────────────────────────────────────────────────

function AdRow({
  ad, onToggle, onEdit, onDelete,
}: {
  ad: SplashAd;
  onToggle: (ad: SplashAd) => void;
  onEdit: (ad: SplashAd) => void;
  onDelete: (ad: SplashAd) => void;
}) {
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
      }}
    >
      {/* 썸네일 (9:16 풀스크린 비율) */}
      <div
        className="rounded-lg overflow-hidden flex-shrink-0"
        style={{ width: 56, height: 96, background: 'var(--surface-2)' }}
      >
        {ad.imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={ad.imageUrl} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-[10px]" style={{ color: 'var(--text-3)' }}>없음</div>}
      </div>

      {/* 정보 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-extrabold truncate" style={{ color: 'var(--text-1)' }}>{ad.title}</span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: 'rgba(255,31,143,0.12)',
              color: '#FF1F8F',
            }}
          >
            가중치 {ad.weight ?? 1}
          </span>
        </div>
        <div className="text-[11px]" style={{ color: 'var(--text-2)' }}>
          {fmtDate(ad.startsAt)} ~ {fmtDate(ad.endsAt)}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
          {(ad.displayDurationMs ?? 3000) / 1000}s 노출 · {(ad.skipAfterMs ?? 1500) / 1000}s 후 건너뛰기
          {' · '}노출 {(ad.impressions ?? 0).toLocaleString()} · 클릭 {(ad.clicks ?? 0).toLocaleString()} · CTR {ctr(ad.impressions ?? 0, ad.clicks ?? 0)}
        </div>
        {ad.linkUrl && (
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
            🔗 {ad.linkUrl}
          </div>
        )}
      </div>

      {/* 컨트롤 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={() => onToggle(ad)}
          className={`relative w-10 h-5 rounded-full transition ${ad.isActive ? 'bg-green-500' : 'bg-gray-400'}`}
          aria-label={ad.isActive ? '비활성화' : '활성화'}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${ad.isActive ? 'left-5' : 'left-0.5'}`} />
        </button>
        <button onClick={() => onEdit(ad)} className="px-2.5 py-1.5 text-xs font-bold rounded-lg" style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}>수정</button>
        <button onClick={() => onDelete(ad)} className="px-2.5 py-1.5 text-xs font-bold rounded-lg text-red-600" style={{ background: 'rgba(239,68,68,0.08)' }}>삭제</button>
      </div>
    </div>
  );
}

// ─── 모달: 등록/수정 ─────────────────────────────────────────

interface FormState {
  title: string;
  description: string;
  linkUrl: string;
  sponsoredLabel: string;
  startsAt: Timestamp | null;
  endsAt: Timestamp | null;
  isActive: boolean;
  weight: number;
  displayDurationMs: number;
  skipAfterMs: number;
}

function SplashAdModal({ ad, onClose }: { ad: SplashAd | null; onClose: () => void }) {
  // 기본값 — 등록 시 시작=지금, 종료=+7일
  const defaultStart = ad?.startsAt ?? Timestamp.now();
  const defaultEnd = ad?.endsAt
    ?? Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [form, setForm] = useState<FormState>({
    title: ad?.title ?? '',
    description: ad?.description ?? '',
    linkUrl: ad?.linkUrl ?? '',
    sponsoredLabel: ad?.sponsoredLabel ?? SPLASH_AD_DEFAULTS.sponsoredLabel,
    startsAt: defaultStart,
    endsAt: defaultEnd,
    isActive: ad?.isActive ?? SPLASH_AD_DEFAULTS.isActive,
    weight: ad?.weight ?? SPLASH_AD_DEFAULTS.weight,
    displayDurationMs: ad?.displayDurationMs ?? SPLASH_AD_DEFAULTS.displayDurationMs,
    skipAfterMs: ad?.skipAfterMs ?? SPLASH_AD_DEFAULTS.skipAfterMs,
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>(ad?.imageUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setErr('이미지는 5MB 이하만 업로드 가능합니다.');
      return;
    }
    setErr(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleSave = async () => {
    setErr(null);
    // 검증
    if (!form.title.trim()) { setErr('제목은 필수입니다.'); return; }
    if (!form.startsAt || !form.endsAt) { setErr('시작/종료 시각을 입력하세요.'); return; }
    if (form.endsAt.toMillis() <= form.startsAt.toMillis()) { setErr('종료는 시작 이후여야 합니다.'); return; }
    if (!ad && !file) { setErr('이미지는 필수입니다.'); return; }
    if (form.displayDurationMs < 1000 || form.displayDurationMs > 10000) { setErr('노출 시간은 1~10초입니다.'); return; }
    if (form.skipAfterMs < 0 || form.skipAfterMs > 5000) { setErr('건너뛰기 지연은 0~5초입니다.'); return; }
    if (form.weight < 1 || form.weight > 10) { setErr('가중치는 1~10입니다.'); return; }

    setSaving(true);
    try {
      const uid = auth.currentUser?.uid ?? undefined;

      if (!ad) {
        // 신규
        const id = await createSplashAd({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          linkUrl: form.linkUrl.trim() || undefined,
          sponsoredLabel: form.sponsoredLabel.trim() || SPLASH_AD_DEFAULTS.sponsoredLabel,
          startsAt: form.startsAt,
          endsAt: form.endsAt,
          isActive: form.isActive,
          weight: form.weight,
          displayDurationMs: form.displayDurationMs,
          skipAfterMs: form.skipAfterMs,
          createdBy: uid,
        });
        if (file) {
          const { url, path } = await uploadSplashAdImage(id, file);
          await updateSplashAd(id, { imageUrl: url, imageStoragePath: path });
        }
      } else {
        // 수정
        const patch: Record<string, unknown> = {
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          linkUrl: form.linkUrl.trim() || undefined,
          sponsoredLabel: form.sponsoredLabel.trim() || SPLASH_AD_DEFAULTS.sponsoredLabel,
          startsAt: form.startsAt,
          endsAt: form.endsAt,
          isActive: form.isActive,
          weight: form.weight,
          displayDurationMs: form.displayDurationMs,
          skipAfterMs: form.skipAfterMs,
        };
        if (file) {
          const { url, path } = await uploadSplashAdImage(ad.id, file);
          patch.imageUrl = url;
          patch.imageStoragePath = path;
        }
        await updateSplashAd(ad.id, patch);
      }
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        style={{ background: 'var(--surface-1)', color: 'var(--text-1)' }}
      >
        <div className="p-5 sticky top-0 z-10 flex items-center justify-between" style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-lg font-extrabold">{ad ? '스플래시 광고 수정' : '새 스플래시 광고 등록'}</h2>
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>닫기</button>
        </div>

        <div className="p-5 space-y-4">
          {/* 이미지 */}
          <div>
            <label className="block text-xs font-bold mb-1.5">광고 이미지 (필수)</label>
            <div className="flex gap-4">
              <div
                className="relative cursor-pointer flex-shrink-0"
                onClick={() => fileRef.current?.click()}
                style={{ width: 180, height: 320 }}
              >
                <div
                  className="w-full h-full rounded-xl overflow-hidden border-2 border-dashed flex items-center justify-center"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                >
                  {preview
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={preview} alt="" className="w-full h-full object-cover" />
                    : <div className="text-center text-xs px-3" style={{ color: 'var(--text-3)' }}>
                        클릭하여 업로드<br/>
                        <span className="text-[10px]">9:16 풀스크린 권장</span>
                      </div>}
                </div>
              </div>
              <div className="flex-1 text-xs space-y-1.5" style={{ color: 'var(--text-2)' }}>
                <div className="font-bold" style={{ color: 'var(--gold)' }}>권장 사양</div>
                <ul className="space-y-1 list-disc pl-4">
                  <li>비율: <b>9:16</b> (모바일 풀스크린, 예: 1080×1920px)</li>
                  <li>형식: JPG / PNG, 5MB 이하</li>
                  <li>이미지에 텍스트 포함 시 상하 여백 100px 권장 (라벨/건너뛰기 겹침 방지)</li>
                  <li>다른 비율 업로드 시 가운데 정렬 잘림 (object-cover)</li>
                </ul>
                <div className="mt-2 px-2.5 py-1.5 rounded text-[11px]" style={{ background: 'rgba(239,68,68,0.10)', color: '#DC2626' }}>
                  ⚠ 19+ / 도박 / 상금 직접 노출 콘텐츠 등록 절대 금지
                </div>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </div>

          {/* 제목/메모 */}
          <div>
            <label className="block text-xs font-bold mb-1.5">제목 (필수, 관리용)</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="예: 6월 부산 신규 매장 오픈 캠페인"
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">메모 (선택, 본사 내부)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="광고주, 단가, 비고 등"
              className="w-full rounded-lg px-3 py-2 text-sm resize-y"
              style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
            />
          </div>

          {/* 링크 + 라벨 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1.5">클릭 시 이동 (선택)</label>
              <input
                value={form.linkUrl}
                onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))}
                placeholder="https://... 또는 /m/find"
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
              />
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>비워두면 단순 노출(클릭 비활성).</div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">광고 라벨</label>
              <input
                value={form.sponsoredLabel}
                onChange={(e) => setForm((f) => ({ ...f, sponsoredLabel: e.target.value }))}
                placeholder="광고"
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
              />
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>기본값 &ldquo;광고&rdquo;. 공정거래위 가이드.</div>
            </div>
          </div>

          {/* 기간 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1.5">시작 일시</label>
              <input
                type="datetime-local"
                value={toLocalInput(form.startsAt)}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: fromLocalInput(e.target.value) }))}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">종료 일시</label>
              <input
                type="datetime-local"
                value={toLocalInput(form.endsAt)}
                onChange={(e) => setForm((f) => ({ ...f, endsAt: fromLocalInput(e.target.value) }))}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
              />
            </div>
          </div>

          {/* 노출 시간 + 건너뛰기 + 가중치 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1.5">노출 시간 (ms)</label>
              <input
                type="number" min={1000} max={10000} step={500}
                value={form.displayDurationMs}
                onChange={(e) => setForm((f) => ({ ...f, displayDurationMs: Number(e.target.value) }))}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
              />
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>기본 3000 (3초)</div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">건너뛰기 지연 (ms)</label>
              <input
                type="number" min={0} max={5000} step={500}
                value={form.skipAfterMs}
                onChange={(e) => setForm((f) => ({ ...f, skipAfterMs: Number(e.target.value) }))}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
              />
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>기본 1500 (1.5초 후)</div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">가중치</label>
              <input
                type="number" min={1} max={10} step={1}
                value={form.weight}
                onChange={(e) => setForm((f) => ({ ...f, weight: Number(e.target.value) }))}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
              />
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>1~10. 클수록 자주 노출.</div>
            </div>
          </div>

          {/* 활성 */}
          <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div>
              <div className="text-sm font-bold">활성화</div>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>OFF 상태에서는 사용자 앱에 절대 노출되지 않습니다.</div>
            </div>
            <button
              onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
              className={`relative w-12 h-6 rounded-full transition ${form.isActive ? 'bg-green-500' : 'bg-gray-400'}`}
              aria-label={form.isActive ? '비활성화' : '활성화'}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.isActive ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>

          {err && <div className="text-red-500 text-sm">{err}</div>}
        </div>

        <div className="p-5 sticky bottom-0 flex gap-2 justify-end" style={{ background: 'var(--surface-1)', borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-xl" style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}>취소</button>
          <button
            disabled={saving}
            onClick={handleSave}
            className="px-5 py-2 text-sm font-extrabold rounded-xl text-white disabled:opacity-50"
            style={{ background: '#FF1F8F' }}
          >
            {saving ? '저장 중…' : ad ? '수정 저장' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 프리뷰(시뮬레이션) ──────────────────────────────────────

function PreviewModal({ ad, onClose }: { ad: SplashAd; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div className="relative" style={{ width: 280, height: 560 }}>
        <div className="absolute inset-0 rounded-2xl overflow-hidden" style={{ background: '#000' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ad.imageUrl} alt="" className="w-full h-full object-cover" />
          {/* 광고 라벨 */}
          <div className="absolute top-3 left-3 text-[10px] font-extrabold px-2 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', letterSpacing: '0.06em' }}>
            {ad.sponsoredLabel ?? '광고'}
          </div>
          {/* 건너뛰기 (시뮬) */}
          <button className="absolute top-3 right-3 text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
            건너뛰기
          </button>
          {/* 타이틀 */}
          <div className="absolute bottom-3 left-3 right-3 text-[12px] font-bold px-2 py-1 rounded" style={{ background: 'rgba(0,0,0,0.35)', color: '#fff' }}>
            {ad.title}
          </div>
        </div>
        <button onClick={onClose} className="absolute -top-10 right-0 text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'rgba(255,255,255,0.18)' }}>
          닫기
        </button>
      </div>
    </div>
  );
}
