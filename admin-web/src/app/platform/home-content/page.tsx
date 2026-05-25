'use client';

/**
 * /platform/home-content — 홈 콘텐츠 관리
 * Tab 1: 홈 광고 (homeAds)
 * Tab 2: 인기 유튜브 영상 (hotYoutubeVideos)
 * Tab 3: 인기 유튜버 채널 (hotYoutubers)
 */

import { useEffect, useRef, useState } from 'react';
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp, query, orderBy, onSnapshot,
  getCountFromServer, setDoc, where,
} from 'firebase/firestore';
import {
  ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { stripUndefined } from '@/lib/firestoreUtil';
import { extractYoutubeVideoId, youtubeThumbnailUrl, fetchYoutubeChannelMeta } from '@/lib/youtube';
import type { HomeAd, HotYoutubeVideo, HotYoutuber } from '@/lib/homeContent';
import {
  subscribeCurationConfig,
  saveCurationConfig,
  parseKeywordsText,
  formatKeywordsText,
  DEFAULT_CURATION_CONFIG,
  type YoutubeCurationConfig,
} from '@/lib/curationConfig';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { app } from '@/lib/firebase';

// ─── homeContentCounts 동기화 ─────────────────────────────────

async function syncHomeContentCounts(): Promise<void> {
  try {
    const [adsSnap, videosSnap, youtubersSnap] = await Promise.all([
      getCountFromServer(query(collection(db, 'homeAds'), where('isActive', '==', true))),
      getCountFromServer(query(collection(db, 'hotYoutubeVideos'), where('isActive', '==', true))),
      getCountFromServer(query(collection(db, 'hotYoutubers'), where('isActive', '==', true))),
    ]);
    await setDoc(
      doc(db, 'meta', 'homeContentCounts'),
      stripUndefined({
        adsActive: adsSnap.data().count,
        videosActive: videosSnap.data().count,
        youtubersActive: youtubersSnap.data().count,
        updatedAt: serverTimestamp(),
      }),
      { merge: true },
    );
  } catch {
    // 카운트 동기화 실패는 조용히 무시 (비핵심)
  }
}

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
  return t.toDate().toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

type Tab = 'ads' | 'videos' | 'youtubers';

// ─── 메인 페이지 ──────────────────────────────────────────────

export default function HomeContentPage() {
  const [tab, setTab] = useState<Tab>('ads');

  return (
    <div>
      <div className="mb-6">
        <div className="section-title" style={{ color: 'var(--gold)' }}>HOME CONTENT</div>
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>📺 홈 콘텐츠 관리</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>모바일 홈 화면에 노출되는 광고, 유튜브 영상, 유튜버 채널을 관리합니다.</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { id: 'ads', label: '홈 광고' },
          { id: 'videos', label: '인기 유튜브 영상' },
          { id: 'youtubers', label: '인기 유튜버' },
        ] as { id: Tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-bold rounded-t-lg border-b-2 transition ${
              tab === t.id
                ? 'border-amber-500 text-amber-700 bg-amber-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ads' && <AdsTab />}
      {tab === 'videos' && <VideosTab />}
      {tab === 'youtubers' && <YoutubersTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 1: 홈 광고
// ═══════════════════════════════════════════════════════════════

function AdsTab() {
  const [ads, setAds] = useState<HomeAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [posFilter, setPosFilter] = useState<'all' | 'top' | 'bottom'>('all');
  const [editing, setEditing] = useState<HomeAd | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'homeAds'), orderBy('order'));
    return onSnapshot(q, (snap) => {
      setAds(snap.docs.map((d) => ({ id: d.id, ...d.data() } as HomeAd)));
      setLoading(false);
    }, (e) => { setError(e.message); setLoading(false); });
  }, []);

  const filtered = posFilter === 'all' ? ads : ads.filter((a) => a.position === posFilter);

  const handleToggleActive = async (ad: HomeAd) => {
    await updateDoc(doc(db, 'homeAds', ad.id), { isActive: !ad.isActive, updatedAt: serverTimestamp() });
    syncHomeContentCounts();
  };

  const handleDelete = async (ad: HomeAd) => {
    if (!confirm(`"${ad.title ?? ad.id}" 광고를 삭제하시겠습니까?`)) return;
    await deleteDoc(doc(db, 'homeAds', ad.id));
    syncHomeContentCounts();
  };

  return (
    <div>
      {/* 상단 컨트롤 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1.5">
          {(['all', 'top', 'bottom'] as const).map((p) => (
            <button key={p} onClick={() => setPosFilter(p)} className={`px-3 py-1.5 text-xs font-bold rounded-lg ${posFilter === p ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {p === 'all' ? '전체' : p === 'top' ? '상단' : '하단'}
            </button>
          ))}
        </div>
        <button onClick={() => setEditing('new')} className="px-4 py-2 bg-amber-500 text-white text-sm font-bold rounded-xl hover:bg-amber-600 transition">
          + 광고 추가
        </button>
      </div>

      {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
      {loading && <div className="text-sm text-gray-500">로딩 중…</div>}

      {/* 리스트 */}
      <div className="space-y-3">
        {filtered.map((ad) => (
          <div key={ad.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
            {/* 썸네일 */}
            <div className="w-20 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {ad.imageUrl && <img src={ad.imageUrl} alt="" className="w-full h-full object-cover" />}
            </div>
            {/* 정보 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ad.position === 'top' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                  {ad.position === 'top' ? '상단' : '하단'}
                </span>
                <span className="text-sm font-bold text-gray-900 truncate">{ad.title ?? '(제목 없음)'}</span>
              </div>
              <div className="text-xs text-gray-500">
                {fmtDate(ad.startAt)} ~ {fmtDate(ad.endAt)} · order {ad.order}
              </div>
            </div>
            {/* 컨트롤 */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => handleToggleActive(ad)}
                className={`relative w-10 h-5 rounded-full transition ${ad.isActive ? 'bg-green-500' : 'bg-gray-300'}`}
                aria-label={ad.isActive ? '비활성화' : '활성화'}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${ad.isActive ? 'left-5' : 'left-0.5'}`} />
              </button>
              <button onClick={() => setEditing(ad)} className="px-2.5 py-1.5 text-xs font-bold bg-gray-100 hover:bg-gray-200 rounded-lg">수정</button>
              <button onClick={() => handleDelete(ad)} className="px-2.5 py-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg">삭제</button>
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">등록된 광고가 없습니다</div>
        )}
      </div>

      {/* 모달 */}
      {editing && (
        <AdModal
          ad={editing === 'new' ? null : editing}
          saving={saving}
          onSave={async (data, file) => {
            setSaving(true);
            try {
              if (editing === 'new') {
                const docRef = await addDoc(collection(db, 'homeAds'), stripUndefined({
                  ...data, imageUrl: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
                }));
                if (file) {
                  const url = await uploadAdImage(docRef.id, file);
                  await updateDoc(docRef, { imageUrl: url });
                }
              } else {
                const updates: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() };
                if (file) {
                  const url = await uploadAdImage(editing.id, file);
                  updates.imageUrl = url;
                }
                await updateDoc(doc(db, 'homeAds', editing.id), stripUndefined(updates));
              }
              syncHomeContentCounts();
              setEditing(null);
            } catch (e: unknown) {
              alert((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

async function uploadAdImage(adId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const r = storageRef(storage, `homeAds/${adId}/cover.${ext}`);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}

interface AdFormData {
  position: 'top' | 'bottom';
  title: string;
  subtitle: string;
  description: string;
  linkType: 'external' | 'store' | 'event' | 'internal';
  linkUrl: string;
  startAt: Timestamp | null;
  endAt: Timestamp | null;
  order: number;
  isActive: boolean;
}

function AdModal({ ad, saving, onSave, onClose }: {
  ad: HomeAd | null;
  saving: boolean;
  onSave: (data: AdFormData, file: File | null) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AdFormData>({
    position: ad?.position ?? 'top',
    title: ad?.title ?? '',
    subtitle: ad?.subtitle ?? '',
    description: ad?.description ?? '',
    linkType: ad?.linkType ?? 'external',
    linkUrl: ad?.linkUrl ?? '',
    startAt: ad?.startAt ?? null,
    endAt: ad?.endAt ?? null,
    order: ad?.order ?? 0,
    isActive: ad?.isActive ?? true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>(ad?.imageUrl ?? '');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-900">{ad ? '광고 수정' : '광고 추가'}</h2>
        </div>
        <div className="p-6 space-y-4">

          {/* 이미지 업로드 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">광고 이미지</label>
            <div className="relative cursor-pointer" onClick={() => fileRef.current?.click()}>
              <div className="w-full rounded-xl overflow-hidden bg-gray-100 border-2 border-dashed border-gray-300" style={{ aspectRatio: '16/9' }}>
                {preview
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={preview} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-sm text-gray-400">클릭하여 이미지 업로드</div>
                }
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

            {/* 권장 이미지 사이즈 안내 */}
            <div className="mt-2.5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-gray-600 space-y-1.5">
              <p className="font-bold text-blue-700 text-[11px] uppercase tracking-wide">권장 이미지 사이즈</p>
              <ul className="space-y-1">
                <li className={form.position === 'top' ? 'font-bold text-gray-900' : 'text-gray-500'}>
                  {form.position === 'top' ? '▶ ' : ''}
                  상단 광고: <span className={form.position === 'top' ? 'text-amber-700' : ''}>16:9 비율</span>
                  {' '}(예: 1600×900px, 최소 800×450px)
                </li>
                <li className={form.position === 'bottom' ? 'font-bold text-gray-900' : 'text-gray-500'}>
                  {form.position === 'bottom' ? '▶ ' : ''}
                  하단 광고: <span className={form.position === 'bottom' ? 'text-amber-700' : ''}>21:9 비율</span>
                  {' '}(예: 1680×720px, 최소 840×360px)
                </li>
                <li className="text-gray-500">가로 사이즈는 자유롭게 사용 가능 (비율만 맞으면 모든 사이즈 OK)</li>
                <li className="text-gray-500">다른 비율 업로드 시 가운데 정렬로 잘림 (object-cover)</li>
                <li className="text-gray-500">파일 형식: JPG / PNG (5MB 이하)</li>
              </ul>
            </div>
          </div>

          {/* position */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">위치</label>
            <div className="flex gap-2">
              {(['top', 'bottom'] as const).map((p) => (
                <button key={p} onClick={() => setForm((f) => ({ ...f, position: p }))} className={`flex-1 py-2 text-sm font-bold rounded-lg border transition ${form.position === p ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-600'}`}>
                  {p === 'top' ? '상단 (16:9)' : '하단 (21:9)'}
                </button>
              ))}
            </div>
          </div>

          {/* 제목/부제 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">제목 (선택)</label>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="광고 제목" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">부제 (선택)</label>
              <input value={form.subtitle} onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="부제" />
            </div>
          </div>

          {/* 상세 설명 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">상세 설명 (선택)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={6}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-y leading-relaxed"
              placeholder={'사용자가 광고를 탭하면 상세 페이지에서 보여집니다.\n행사 일정, 혜택, 참여 방법 등을 자유롭게 작성하세요.'}
            />
            <div className="text-[11px] text-gray-400 mt-1">
              줄바꿈·이모지 그대로 표시. 카톡방 안내문을 붙여넣어도 OK.
            </div>
          </div>

          {/* linkType + linkUrl */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">링크 유형</label>
            <select value={form.linkType} onChange={(e) => setForm((f) => ({ ...f, linkType: e.target.value as AdFormData['linkType'] }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2">
              <option value="external">외부 URL</option>
              <option value="internal">내부 경로 (/m/...)</option>
              <option value="store">매장 상세</option>
              <option value="event">대회 상세</option>
            </select>
            <input value={form.linkUrl} onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder={form.linkType === 'internal' ? '/m/find?mode=map' : 'https://...'} />
          </div>

          {/* 기간 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">시작 일시</label>
              <input type="datetime-local" value={toLocalInput(form.startAt)} onChange={(e) => setForm((f) => ({ ...f, startAt: fromLocalInput(e.target.value) }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">종료 일시</label>
              <input type="datetime-local" value={toLocalInput(form.endAt)} onChange={(e) => setForm((f) => ({ ...f, endAt: fromLocalInput(e.target.value) }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {/* order + isActive */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs font-bold text-gray-700 mb-1.5">순서 (order)</label>
              <input type="number" value={form.order} onChange={(e) => setForm((f) => ({ ...f, order: Number(e.target.value) }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" min={0} />
            </div>
            <div className="flex items-center gap-2 mt-4">
              <label className="text-xs font-bold text-gray-700">활성</label>
              <button onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))} className={`relative w-10 h-5 rounded-full transition ${form.isActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.isActive ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50">취소</button>
          <button onClick={() => onSave(form, file)} disabled={saving} className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 disabled:opacity-40">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 2: 인기 유튜브 영상
// ═══════════════════════════════════════════════════════════════

// ─── 헬퍼: 숫자 포맷 (k/M 단위) ──────────────────────────────

function fmtViewCount(n?: number): string {
  if (n === undefined || n === null) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/* ═══════════════════════════════════════════════════════════════
 * 인기 유튜브 영상 — 자동 큐레이션 설정 카드 (인라인)
 *
 * platformConfig/youtubeCuration doc을 실시간 구독·저장.
 * Cloud Function curateHotVideos가 scheduleHourKst 시각에 이 설정을 읽고
 * includeKeywords·excludeKeywords·maxResults 등을 적용해 큐레이션 수행.
 * 고급 설정(refreshInterval, autoVideoMaxAgeDays 등)은 /platform/videos 페이지.
 * ═══════════════════════════════════════════════════════════════ */
function CurationSettingsCard() {
  const [config, setConfig] = useState<YoutubeCurationConfig | null>(null);
  const [includeText, setIncludeText] = useState<string>('');
  const [excludeText, setExcludeText] = useState<string>('');
  const [maxResults, setMaxResults] = useState<number>(20);
  const [excludeShorts, setExcludeShorts] = useState<boolean>(true);
  const [scheduleHourKst, setScheduleHourKst] = useState<number>(4);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeCurationConfig(
      (cfg) => {
        setConfig(cfg);
        if (!loaded) {
          setIncludeText(formatKeywordsText(cfg.includeKeywords));
          setExcludeText(formatKeywordsText(cfg.excludeKeywords));
          setMaxResults(cfg.maxResults);
          setExcludeShorts(cfg.excludeShorts);
          setScheduleHourKst(cfg.scheduleHourKst);
          setLoaded(true);
        }
      },
      (e) => setErr(e.message),
    );
    return unsub;
  }, [loaded]);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      await saveCurationConfig({
        includeKeywords: parseKeywordsText(includeText),
        excludeKeywords: parseKeywordsText(excludeText),
        maxResults: Math.max(5, Math.min(50, Math.floor(maxResults) || DEFAULT_CURATION_CONFIG.maxResults)),
        excludeShorts,
        scheduleHourKst: Math.max(0, Math.min(23, Math.floor(scheduleHourKst))),
      });
      setSavedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleResetKeywords = () => {
    if (!window.confirm('포함 키워드를 기본값(홀덤·포커·토너먼트·WSOP 등)으로 되돌릴까요?')) return;
    setIncludeText(formatKeywordsText(DEFAULT_CURATION_CONFIG.includeKeywords));
  };

  const handleRunNow = async () => {
    if (!window.confirm('지금 즉시 큐레이션을 실행할까요? YouTube Data API 쿼터를 소모합니다.')) return;
    setRunning(true);
    setRunMessage(null);
    setErr(null);
    try {
      const functions = getFunctions(app, 'asia-northeast3');
      const fn = httpsCallable<
        Record<string, never>,
        {
          upserted: number;
          expiredDeleted: number;
          durationMs: number;
          filtered?: { shortsExcluded?: number; keywordExcluded?: number };
        }
      >(functions, 'triggerYoutubeCurationNow');
      const res = await fn({});
      const d = res.data;
      setRunMessage(
        `완료 — 큐레이션 ${d.upserted}개 / 삭제 ${d.expiredDeleted}개 / ` +
          `쇼츠 ${d.filtered?.shortsExcluded ?? 0} · 키워드 ${d.filtered?.keywordExcluded ?? 0} 제외`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const lastRunAt = config?.lastRunAt;
  const lastUpserted = config?.lastRunResult?.upserted;

  return (
    <div className="mb-5 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[18px]">⚙️</span>
            <h3 className="text-[15px] font-extrabold text-amber-900">자동 큐레이션 설정</h3>
          </div>
          <p className="text-[11.5px] text-amber-800 mt-1 leading-relaxed">
            매일 새벽 {config?.scheduleHourKst ?? scheduleHourKst}시 자동 실행 · 포함 키워드 매칭 영상만 추가
          </p>
        </div>
        {lastRunAt && (
          <div className="text-[11px] text-amber-700 text-right">
            <div>마지막 실행 {fmtRelative(lastRunAt)}</div>
            {lastUpserted != null && (
              <div className="text-[10px] text-amber-600 mt-0.5">{lastUpserted}건 갱신</div>
            )}
          </div>
        )}
      </div>

      {err && (
        <div className="mb-3 rounded-lg bg-red-100 border border-red-200 px-3 py-2 text-[11.5px] text-red-700">
          {err}
        </div>
      )}

      <div className="space-y-3">
        {/* 포함 키워드 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11.5px] font-bold text-amber-900">
              📌 포함 키워드 (영상 제목·설명에 하나라도 있으면 통과)
            </label>
            <button
              onClick={handleResetKeywords}
              className="text-[10px] font-bold text-amber-700 hover:text-amber-900 underline"
            >
              기본값으로
            </button>
          </div>
          <textarea
            value={includeText}
            onChange={(e) => setIncludeText(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-amber-300 rounded-lg text-[12.5px] font-mono leading-relaxed bg-white"
            placeholder={'한 줄에 하나씩 또는 쉼표로 구분\n예시:\n홀덤\n포커\nWSOP\nWPT'}
          />
          <div className="text-[10.5px] text-amber-700 mt-1">
            현재 {parseKeywordsText(includeText).length}개 키워드 · 비워두면 키워드 필터 비활성(전체 영상 통과)
          </div>
        </div>

        {/* 제외 키워드 */}
        <div>
          <label className="block text-[11.5px] font-bold text-amber-900 mb-1.5">
            🚫 제외 키워드 (있으면 영상 제외)
          </label>
          <textarea
            value={excludeText}
            onChange={(e) => setExcludeText(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-amber-300 rounded-lg text-[12.5px] font-mono leading-relaxed bg-white"
            placeholder="예시: 도박, 사설, 불법"
          />
        </div>

        {/* 갯수 + 시각 + 쇼츠 제외 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-amber-900 mb-1">
              🎯 노출 영상 갯수 (5~50)
            </label>
            <input
              type="number"
              min={5}
              max={50}
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
              className="w-full px-3 py-2 border border-amber-300 rounded-lg text-[13px] font-bold bg-white tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-amber-900 mb-1">
              ⏰ 실행 시각 (KST 0~23시)
            </label>
            <input
              type="number"
              min={0}
              max={23}
              value={scheduleHourKst}
              onChange={(e) => setScheduleHourKst(Number(e.target.value))}
              className="w-full px-3 py-2 border border-amber-300 rounded-lg text-[13px] font-bold bg-white tabular-nums"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer w-full px-3 py-2 border border-amber-300 rounded-lg bg-white">
              <input
                type="checkbox"
                checked={excludeShorts}
                onChange={(e) => setExcludeShorts(e.target.checked)}
                className="w-4 h-4 accent-amber-600"
              />
              <span className="text-[12px] font-bold text-amber-900">쇼츠 제외</span>
            </label>
          </div>
        </div>

        {/* 실행 결과 메시지 */}
        {runMessage && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11.5px] text-emerald-800 leading-relaxed">
            {runMessage}
          </div>
        )}

        {/* 액션 — 저장 + 즉시 실행 */}
        <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
          {savedAt != null && Date.now() - savedAt < 4000 && (
            <span className="text-[11px] text-emerald-700 font-bold mr-auto">✓ 저장됨</span>
          )}
          <button
            onClick={handleRunNow}
            disabled={running || saving}
            className="px-4 py-2 bg-amber-100 text-amber-900 text-[12.5px] font-extrabold rounded-lg border border-amber-300 hover:bg-amber-200 disabled:opacity-40 transition"
            title="저장된 설정으로 지금 즉시 큐레이션 실행"
          >
            {running ? '실행 중…' : '⚡ 지금 즉시 실행'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !loaded}
            className="px-5 py-2 bg-amber-600 text-white text-[12.5px] font-extrabold rounded-lg hover:bg-amber-700 disabled:opacity-40 transition"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** relative 날짜 ("N일 전" 등) */
function fmtRelative(t?: { toMillis(): number } | null): string {
  if (!t) return '';
  const diffMs = Date.now() - t.toMillis();
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 0) return '오늘';
  if (days < 7) return `${days}일 전`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}주 전`;
  const months = Math.floor(days / 30);
  return `${months}개월 전`;
}

function VideosTab() {
  const [videos, setVideos] = useState<HotYoutubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<HotYoutubeVideo | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 어드민은 order 없이 전체 로드 (isActive 관계없이) → 클라이언트 정렬
    const q = query(collection(db, 'hotYoutubeVideos'));
    return onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HotYoutubeVideo));
      // 어드민 뷰: manual 먼저(order ASC) → auto(score DESC)
      all.sort((a, b) => {
        const aManual = a.source !== 'auto';
        const bManual = b.source !== 'auto';
        if (aManual !== bManual) return aManual ? -1 : 1;
        if (aManual) return (a.order ?? 0) - (b.order ?? 0);
        return (b.score ?? 0) - (a.score ?? 0);
      });
      setVideos(all);
      setLoading(false);
    }, (e) => { setError(e.message); setLoading(false); });
  }, []);

  const handleToggleActive = async (v: HotYoutubeVideo) => {
    await updateDoc(doc(db, 'hotYoutubeVideos', v.id), { isActive: !v.isActive, updatedAt: serverTimestamp() });
    syncHomeContentCounts();
  };

  const handleDelete = async (v: HotYoutubeVideo) => {
    if (!confirm(`"${v.title}" 영상을 삭제하시겠습니까?`)) return;
    await deleteDoc(doc(db, 'hotYoutubeVideos', v.id));
    syncHomeContentCounts();
  };

  interface VideoFormData {
    videoId: string;
    title: string;
    channelName: string;
    channelUrl: string;
    order: number;
    isActive: boolean;
  }

  return (
    <div>
      {/* 자동 큐레이션 설정 (인라인) */}
      <CurationSettingsCard />

      <div className="flex justify-end mb-4">
        <button onClick={() => setEditing('new')} className="px-4 py-2 bg-amber-500 text-white text-sm font-bold rounded-xl hover:bg-amber-600 transition">
          + 영상 추가
        </button>
      </div>

      {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
      {loading && <div className="text-sm text-gray-500">로딩 중…</div>}

      <div className="space-y-3">
        {videos.map((v) => {
          const isAuto = v.source === 'auto';
          return (
            <div key={v.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
              {/* 썸네일 */}
              <div className="w-20 h-12 rounded-lg overflow-hidden bg-gray-900 flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.thumbnailUrl || youtubeThumbnailUrl(v.videoId)} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                  {/* source 배지 */}
                  {isAuto ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">AUTO</span>
                  ) : (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-pink-100 text-pink-700">수동</span>
                  )}
                  <span className="text-sm font-bold text-gray-900 truncate">{v.title}</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                  <span>{v.channelName ?? '-'}</span>
                  {v.viewCount !== undefined && (
                    <span>조회수 {fmtViewCount(v.viewCount)}</span>
                  )}
                  {v.publishedAt && (
                    <span>{fmtRelative(v.publishedAt)}</span>
                  )}
                  <span>videoId: {v.videoId}</span>
                  {!isAuto && <span>order {v.order}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => handleToggleActive(v)} className={`relative w-10 h-5 rounded-full transition ${v.isActive ? 'bg-green-500' : 'bg-gray-300'}`} aria-label={v.isActive ? '비활성화' : '활성화'}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${v.isActive ? 'left-5' : 'left-0.5'}`} />
                </button>
                <button onClick={() => setEditing(v)} className="px-2.5 py-1.5 text-xs font-bold bg-gray-100 hover:bg-gray-200 rounded-lg">수정</button>
                <button onClick={() => handleDelete(v)} className="px-2.5 py-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg">삭제</button>
              </div>
            </div>
          );
        })}
        {!loading && videos.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">등록된 영상이 없습니다</div>
        )}
      </div>

      {/* 모달 */}
      {editing && (
        <VideoModal
          video={editing === 'new' ? null : editing}
          saving={saving}
          onSave={async (data: VideoFormData) => {
            setSaving(true);
            try {
              if (editing === 'new') {
                await addDoc(collection(db, 'hotYoutubeVideos'), stripUndefined({
                  ...data,
                  source: 'manual',
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                }));
              } else {
                const wasAuto = editing.source === 'auto';
                await updateDoc(doc(db, 'hotYoutubeVideos', editing.id), stripUndefined({
                  ...data,
                  source: 'manual',
                  updatedAt: serverTimestamp(),
                  ...(wasAuto ? { manualConvertedAt: serverTimestamp() } : {}),
                }));
              }
              syncHomeContentCounts();
              setEditing(null);
            } catch (e: unknown) { alert((e as Error).message); }
            finally { setSaving(false); }
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

async function fetchOEmbed(url: string): Promise<{ title?: string; author_name?: string; author_url?: string; thumbnail_url?: string } | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function VideoModal({ video, saving, onSave, onClose }: {
  video: HotYoutubeVideo | null;
  saving: boolean;
  onSave: (data: { videoId: string; title: string; channelName: string; channelUrl: string; order: number; isActive: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const isAutoSource = video?.source === 'auto';
  const [urlInput, setUrlInput] = useState(video ? `https://www.youtube.com/watch?v=${video.videoId}` : '');
  const [form, setForm] = useState({
    videoId: video?.videoId ?? '',
    title: video?.title ?? '',
    channelName: video?.channelName ?? '',
    channelUrl: video?.channelUrl ?? '',
    order: video?.order ?? 0,
    isActive: video?.isActive ?? true,
  });
  const [extractError, setExtractError] = useState<string | null>(null);
  const [oEmbedLoading, setOEmbedLoading] = useState(false);

  const handleUrlBlur = async () => {
    const id = extractYoutubeVideoId(urlInput);
    if (!id) { setExtractError('유효한 YouTube URL이 아닙니다.'); return; }
    setExtractError(null);
    setForm((f) => ({ ...f, videoId: id }));

    // oEmbed 자동 메타 채우기
    setOEmbedLoading(true);
    const meta = await fetchOEmbed(urlInput);
    setOEmbedLoading(false);
    if (meta) {
      setForm((f) => ({
        ...f,
        title: meta.title ?? f.title,
        channelName: meta.author_name ?? f.channelName,
        channelUrl: meta.author_url ?? f.channelUrl,
      }));
    }
  };

  const thumb = form.videoId ? youtubeThumbnailUrl(form.videoId) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-900">{video ? '영상 수정' : '영상 추가'}</h2>
        </div>
        <div className="p-6 space-y-4">

          {/* AUTO 영상 수정 안내 */}
          {isAutoSource && (
            <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-xs text-yellow-800 leading-relaxed">
              이 영상은 자동 큐레이션으로 등록된 영상입니다.
              수정·저장하면 <span className="font-bold">'수동 영상'으로 전환</span>되어, 매일 자동 갱신의 영향을 받지 않습니다.
            </div>
          )}

          {/* YouTube URL 입력 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">YouTube URL</label>
            <div className="relative">
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={handleUrlBlur}
                className={`w-full border rounded-lg px-3 py-2 text-sm pr-8 ${extractError ? 'border-red-400' : 'border-gray-200'}`}
                placeholder="https://www.youtube.com/watch?v=..."
              />
              {oEmbedLoading && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  ⏳
                </span>
              )}
            </div>
            {extractError && <p className="text-red-500 text-xs mt-1">{extractError}</p>}
            {form.videoId && !oEmbedLoading && (
              <p className="text-green-600 text-xs mt-1">videoId: {form.videoId} · 메타 자동 입력됨</p>
            )}
          </div>

          {/* 썸네일 미리보기 */}
          {form.videoId && (
            <div className="w-full rounded-xl overflow-hidden bg-gray-900" style={{ aspectRatio: '16/9' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb} alt="" className="w-full h-full object-cover" />
            </div>
          )}

          {/* 제목 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">영상 제목</label>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="영상 제목 입력" />
          </div>

          {/* 채널명 + URL */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">채널명</label>
              <input value={form.channelName} onChange={(e) => setForm((f) => ({ ...f, channelName: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="채널명" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">채널 URL</label>
              <input value={form.channelUrl} onChange={(e) => setForm((f) => ({ ...f, channelUrl: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="https://youtube.com/..." />
            </div>
          </div>

          {/* order + isActive */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs font-bold text-gray-700 mb-1">
                노출 순서
                <span className="ml-1.5 text-[11px] font-normal text-gray-400">(낮을수록 먼저 노출)</span>
              </label>
              <input
                type="number"
                value={form.order}
                onChange={(e) => setForm((f) => ({ ...f, order: Number(e.target.value) }))}
                className="w-full border border-amber-300 bg-amber-50 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-400"
                min={0}
              />
            </div>
            <div className="flex items-center gap-2 mt-5">
              <label className="text-xs font-bold text-gray-700">활성</label>
              <button onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))} className={`relative w-10 h-5 rounded-full transition ${form.isActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.isActive ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50">취소</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.videoId || !form.title} className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 disabled:opacity-40">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 3: 인기 유튜버 채널
// ═══════════════════════════════════════════════════════════════

function YoutubersTab() {
  const [youtubers, setYoutubers] = useState<HotYoutuber[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<HotYoutuber | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'hotYoutubers'), orderBy('order'));
    return onSnapshot(q, (snap) => {
      setYoutubers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as HotYoutuber)));
      setLoading(false);
    }, (e) => { setError(e.message); setLoading(false); });
  }, []);

  const handleToggleActive = async (y: HotYoutuber) => {
    await updateDoc(doc(db, 'hotYoutubers', y.id), { isActive: !y.isActive, updatedAt: serverTimestamp() });
    syncHomeContentCounts();
  };

  const handleDelete = async (y: HotYoutuber) => {
    if (!confirm(`"${y.channelName}" 채널을 삭제하시겠습니까?`)) return;
    await deleteDoc(doc(db, 'hotYoutubers', y.id));
    syncHomeContentCounts();
  };

  interface YoutuberFormData {
    channelId: string;
    channelName: string;
    channelUrl: string;
    avatarUrl: string;
    description: string;
    order: number;
    isActive: boolean;
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setEditing('new')} className="px-4 py-2 bg-amber-500 text-white text-sm font-bold rounded-xl hover:bg-amber-600 transition">
          + 채널 추가
        </button>
      </div>

      {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
      {loading && <div className="text-sm text-gray-500">로딩 중…</div>}

      <div className="space-y-3">
        {youtubers.map((y) => (
          <div key={y.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100 flex-shrink-0 border-2 border-red-400">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {y.avatarUrl && <img src={y.avatarUrl} alt={y.channelName} className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-900">{y.channelName}</div>
              <div className="text-xs text-gray-500 truncate mt-0.5">{y.channelUrl} · order {y.order}</div>
              {y.description && <div className="text-xs text-gray-400 truncate">{y.description}</div>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => handleToggleActive(y)} className={`relative w-10 h-5 rounded-full transition ${y.isActive ? 'bg-green-500' : 'bg-gray-300'}`} aria-label={y.isActive ? '비활성화' : '활성화'}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${y.isActive ? 'left-5' : 'left-0.5'}`} />
              </button>
              <button onClick={() => setEditing(y)} className="px-2.5 py-1.5 text-xs font-bold bg-gray-100 hover:bg-gray-200 rounded-lg">수정</button>
              <button onClick={() => handleDelete(y)} className="px-2.5 py-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg">삭제</button>
            </div>
          </div>
        ))}
        {!loading && youtubers.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">등록된 채널이 없습니다</div>
        )}
      </div>

      {/* 모달 */}
      {editing && (
        <YoutuberModal
          youtuber={editing === 'new' ? null : editing}
          saving={saving}
          onSave={async (data: YoutuberFormData, file: File | null) => {
            setSaving(true);
            try {
              if (editing === 'new') {
                const docRef = await addDoc(collection(db, 'hotYoutubers'), stripUndefined({ ...data, avatarUrl: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
                if (file) {
                  const url = await uploadYoutuberAvatar(docRef.id, file);
                  await updateDoc(docRef, { avatarUrl: url });
                }
              } else {
                const updates: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() };
                if (file) {
                  const url = await uploadYoutuberAvatar(editing.id, file);
                  updates.avatarUrl = url;
                }
                await updateDoc(doc(db, 'hotYoutubers', editing.id), stripUndefined(updates));
              }
              syncHomeContentCounts();
              setEditing(null);
            } catch (e: unknown) { alert((e as Error).message); }
            finally { setSaving(false); }
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

async function uploadYoutuberAvatar(cid: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const r = storageRef(storage, `hotYoutubers/${cid}/avatar.${ext}`);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}

function YoutuberModal({ youtuber, saving, onSave, onClose }: {
  youtuber: HotYoutuber | null;
  saving: boolean;
  onSave: (data: { channelId: string; channelName: string; channelUrl: string; avatarUrl: string; description: string; order: number; isActive: boolean }, file: File | null) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    channelId: youtuber?.channelId ?? '',
    channelName: youtuber?.channelName ?? '',
    channelUrl: youtuber?.channelUrl ?? '',
    avatarUrl: youtuber?.avatarUrl ?? '',
    description: youtuber?.description ?? '',
    order: youtuber?.order ?? 0,
    isActive: youtuber?.isActive ?? true,
  });
  const [file, setFile] = useState<File | null>(null);
  // 아바타 미리보기: 파일 업로드 > API 아바타 URL > 기존 저장값
  const [preview, setPreview] = useState<string>(youtuber?.avatarUrl ?? '');
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaStatus, setMetaStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleFetchMeta = async () => {
    if (!form.channelUrl) return;
    setMetaLoading(true);
    setMetaStatus('idle');
    const meta = await fetchYoutubeChannelMeta(form.channelUrl);
    setMetaLoading(false);
    if (meta) {
      setForm((f) => ({
        ...f,
        channelId: meta.channelId || f.channelId,
        channelName: meta.channelName || f.channelName,
        description: meta.description || f.description,
        avatarUrl: meta.avatarUrl || f.avatarUrl,
      }));
      // 파일 업로드가 없을 때만 API 아바타로 미리보기 갱신
      if (!file && meta.avatarUrl) setPreview(meta.avatarUrl);
      setMetaStatus('ok');
    } else {
      setMetaStatus('fail');
    }
  };

  // 채널 URL blur 시 자동 fetch — Cloud Function이 og:meta 파싱 (API key 불필요)
  const handleChannelUrlBlur = () => {
    if (form.channelUrl) {
      handleFetchMeta();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-900">{youtuber ? '채널 수정' : '채널 추가'}</h2>
        </div>
        <div className="p-6 space-y-4">

          {/* 빠른 등록 안내 — Cloud Function 자동 추출 */}
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
            💡 채널 URL을 입력하면 채널명·설명·아바타가 자동으로 채워집니다.
          </div>

          {/* 채널 URL + 메타 가져오기 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">채널 URL</label>
            <div className="flex gap-2">
              <input
                value={form.channelUrl}
                onChange={(e) => {
                  setForm((f) => ({ ...f, channelUrl: e.target.value }));
                  setMetaStatus('idle');
                }}
                onBlur={handleChannelUrlBlur}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="https://youtube.com/@channelname"
              />
              <button
                type="button"
                onClick={handleFetchMeta}
                disabled={!form.channelUrl || metaLoading}
                className="px-3 py-2 text-xs font-bold rounded-lg border transition whitespace-nowrap flex-shrink-0 bg-red-50 border-red-200 text-red-700 hover:bg-red-100 disabled:opacity-40"
                title="채널 정보 자동 가져오기"
              >
                {metaLoading ? '가져오는 중…' : '메타 가져오기'}
              </button>
            </div>

            {/* 상태 메시지 */}
            {metaStatus === 'ok' && (
              <p className="text-green-600 text-xs mt-1">채널 정보가 자동으로 채워졌습니다.</p>
            )}
            {metaStatus === 'fail' && (
              <p className="text-red-500 text-xs mt-1">채널 정보를 가져오지 못했습니다. 수동으로 입력해 주세요.</p>
            )}
          </div>

          {/* 아바타 업로드 */}
          <div className="flex items-start gap-4">
            <div className="relative cursor-pointer flex-shrink-0" onClick={() => fileRef.current?.click()}>
              <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center">
                {preview
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={preview} alt="" className="w-full h-full object-cover" />
                  : <span className="text-xs text-gray-400 text-center px-1">사진 업로드</span>
                }
              </div>
            </div>
            <div className="flex-1 pt-1">
              <p className="text-xs font-bold text-gray-700 mb-0.5">아바타 이미지</p>
              <p className="text-xs text-gray-500">
                URL 입력 시 자동으로 채워집니다. 직접 업로드도 가능합니다 (최대 2MB).
              </p>
              {form.avatarUrl && !file && (
                <p className="text-xs text-blue-600 mt-1 truncate">미리보기: API 아바타</p>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </div>

          {/* 채널명 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">채널명</label>
            <input value={form.channelName} onChange={(e) => setForm((f) => ({ ...f, channelName: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="채널명" />
          </div>

          {/* 설명 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">설명 (선택)</label>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="채널 소개 한 줄" />
          </div>

          {/* channelId (읽기 전용, 자동 채워짐) */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">채널 ID (자동)</label>
            {/* 자동 영상 큐레이션 안내 */}
            <p className="text-[11px] text-blue-700 mb-1.5">
              channelId가 등록되어 있어야 자동 영상 큐레이션이 작동합니다. URL 자동 메타에서 자동 채워집니다.
            </p>
            <input
              readOnly
              value={form.channelId}
              className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-default"
              placeholder="채널 URL 입력 후 '메타 가져오기' 클릭 시 자동 입력"
            />
          </div>

          {/* order + isActive */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs font-bold text-gray-700 mb-1.5">순서 (order)</label>
              <input type="number" value={form.order} onChange={(e) => setForm((f) => ({ ...f, order: Number(e.target.value) }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" min={0} />
            </div>
            <div className="flex items-center gap-2 mt-4">
              <label className="text-xs font-bold text-gray-700">활성</label>
              <button onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))} className={`relative w-10 h-5 rounded-full transition ${form.isActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.isActive ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50">취소</button>
          <button onClick={() => onSave(form, file)} disabled={saving || !form.channelName || !form.channelUrl} className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 disabled:opacity-40">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
