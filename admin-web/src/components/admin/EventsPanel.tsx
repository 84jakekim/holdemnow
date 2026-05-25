'use client';

import { useEffect, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  type EventDoc,
  type EventCategory,
  type EventStatus,
  type EventInput,
  EVENT_CATEGORY_LABEL,
  EVENT_STATUS_LABEL,
  subscribeEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  uploadEventPoster,
  formatEventDateRange,
  daysFromNow,
  formatPrize,
} from '@/lib/events';
import { geocodeAddress } from '@/lib/kakao';
import EmptyState from '@/components/ui/EmptyState';

interface Props {
  /** 본인 organizerId — 본사 모드에선 undefined */
  organizerId?: string;
  organizerName?: string;
  /** 작성자 uid */
  ownerUid: string;
  /** 본사 모드 — true면 isPlatformPosted 플래그로 등록 */
  isPlatformMode?: boolean;
}

/**
 * 대회(events) 관리 패널 — 대회사 어드민 + 본사 어드민이 공통 사용.
 *
 * - 본인이 만든 events 목록
 * - 새 대회 등록 (모달 폼)
 * - 수정/삭제
 * - 포스터 업로드
 */
export default function EventsPanel({ organizerId, organizerName, ownerUid, isPlatformMode }: Props) {
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const unsub = subscribeEvents(
      organizerId
        ? { organizerId, orderByField: 'startDate', orderDir: 'desc' }
        : { orderByField: 'startDate', orderDir: 'desc' },
      (items) => {
        // 본사 모드: isPlatformPosted=true만. 대회사 모드: organizerId 일치만 (Firestore가 이미 필터).
        const filtered = organizerId
          ? items
          : items.filter((e) => e.isPlatformPosted || e.ownerUid === ownerUid);
        setEvents(filtered);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [organizerId, ownerUid]);

  const editing = editingId ? events.find((e) => e.id === editingId) ?? null : null;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">🎫 대회 등록</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isPlatformMode
              ? '본사가 직접 등록하는 글로벌·국내 큐레이션 대회'
              : `${organizerName ?? '대회사'}가 운영하는 대회`}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setShowForm(true);
          }}
          className="bg-amber-500 text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-amber-600"
        >
          + 새 대회
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 py-10 text-center">로딩 중…</div>
      ) : events.length === 0 ? (
        <EmptyState
          icon="🏆"
          title="등록된 대회가 없습니다"
          desc='우상단 "+ 새 대회" 버튼으로 첫 대회를 등록하세요. 등록 즉시 모바일 앱 "🏆 대회" 탭에 표시됩니다.'
        />
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <EventRow
              key={e.id}
              ev={e}
              onEdit={() => {
                setEditingId(e.id);
                setShowForm(true);
              }}
              onDelete={async () => {
                if (!window.confirm(`"${e.name}" 대회를 삭제할까요?`)) return;
                await deleteEvent(e.id);
              }}
            />
          ))}
        </div>
      )}

      {showForm && (
        <EventFormModal
          initial={editing}
          organizerId={organizerId}
          organizerName={organizerName}
          ownerUid={ownerUid}
          isPlatformMode={isPlatformMode}
          onClose={() => {
            setShowForm(false);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
 * 목록 행
 * ========================================================== */

function EventRow({ ev, onEdit, onDelete }: { ev: EventDoc; onEdit: () => void; onDelete: () => void }) {
  const d = daysFromNow(ev.startDate);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
      <div className="w-14 h-18 rounded-md bg-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
        {ev.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ev.posterUrl} alt={ev.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-2xl opacity-40">🏆</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className="text-[10px] font-bold bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">
            {EVENT_CATEGORY_LABEL[ev.category]}
          </span>
          {ev.city && (
            <span className="text-[10px] font-bold bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">
              📍 {ev.city}
            </span>
          )}
          <span
            className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${
              ev.status === 'upcoming'
                ? 'bg-amber-100 text-amber-800'
                : ev.status === 'ongoing'
                  ? 'bg-green-100 text-green-800'
                  : ev.status === 'completed'
                    ? 'bg-gray-100 text-gray-600'
                    : 'bg-red-100 text-red-800'
            }`}
          >
            {EVENT_STATUS_LABEL[ev.status]}
          </span>
          {ev.status === 'upcoming' && d > 0 && (
            <span className="text-[10px] font-extrabold text-red-500">D-{d}</span>
          )}
        </div>
        <div className="text-sm font-bold text-gray-900 truncate">{ev.name}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          📅 {formatEventDateRange(ev.startDate, ev.endDate)}
          {ev.venueName ? ` · 📍 ${ev.venueName}` : ''}
          {ev.guaranteedPrize ? ` · 🎁 ${formatPrize(ev.guaranteedPrize)} GTD` : ''}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        <button onClick={onEdit} className="bg-gray-100 hover:bg-gray-200 text-gray-900 px-3 py-1.5 rounded text-xs font-bold">
          수정
        </button>
        <button onClick={onDelete} className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded text-xs font-bold">
          삭제
        </button>
      </div>
    </div>
  );
}

/* ============================================================
 * 등록/수정 모달
 * ========================================================== */

interface FormState {
  name: string;
  shortName: string;
  description: string;
  category: EventCategory;
  status: EventStatus;
  startDate: string; // yyyy-mm-dd
  endDate: string;
  registrationDeadline: string;
  city: string;
  venueName: string;
  venueAddress: string;
  buyIn: string;
  guaranteedPrize: string;
  prizePool: string;
  expectedPlayers: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  registrationUrl: string;
  officialUrl: string;
  livestreamUrl: string;
}

function emptyForm(): FormState {
  return {
    name: '', shortName: '', description: '',
    category: 'domestic', status: 'upcoming',
    startDate: '', endDate: '', registrationDeadline: '',
    city: '', venueName: '', venueAddress: '',
    buyIn: '', guaranteedPrize: '', prizePool: '', expectedPlayers: '',
    contactName: '', contactPhone: '', contactEmail: '',
    registrationUrl: '', officialUrl: '', livestreamUrl: '',
  };
}

/** 도시 추천 — 국내 (광역시·도) + 국외 주요 홀덤 도시 */
const DOMESTIC_CITIES = ['서울', '부산', '인천', '대구', '대전', '광주', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const INTL_CITIES = ['라스베이거스', '마카오', '마닐라', '체주', '도쿄', '바르셀로나', '몬테카를로', '런던'];

function tsToInput(ts?: Timestamp): string {
  if (!ts) return '';
  const d = ts.toDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function inputToTs(input: string): Timestamp | undefined {
  if (!input) return undefined;
  const d = new Date(input + 'T00:00:00');
  if (isNaN(d.getTime())) return undefined;
  return Timestamp.fromDate(d);
}

function fromEvent(e: EventDoc): FormState {
  return {
    name: e.name,
    shortName: e.shortName ?? '',
    description: e.description ?? '',
    category: e.category,
    status: e.status,
    startDate: tsToInput(e.startDate),
    endDate: tsToInput(e.endDate),
    registrationDeadline: tsToInput(e.registrationDeadline),
    city: e.city ?? '',
    venueName: e.venueName ?? '',
    venueAddress: e.venueAddress ?? '',
    buyIn: e.buyIn != null ? String(e.buyIn) : '',
    guaranteedPrize: e.guaranteedPrize != null ? String(e.guaranteedPrize) : '',
    prizePool: e.prizePool != null ? String(e.prizePool) : '',
    expectedPlayers: e.expectedPlayers != null ? String(e.expectedPlayers) : '',
    contactName: e.contactName ?? '',
    contactPhone: e.contactPhone ?? '',
    contactEmail: e.contactEmail ?? '',
    registrationUrl: e.registrationUrl ?? '',
    officialUrl: e.officialUrl ?? '',
    livestreamUrl: e.livestreamUrl ?? '',
  };
}

function EventFormModal({
  initial,
  organizerId,
  organizerName,
  ownerUid,
  isPlatformMode,
  onClose,
}: {
  initial: EventDoc | null;
  organizerId?: string;
  organizerName?: string;
  ownerUid: string;
  isPlatformMode?: boolean;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState<FormState>(initial ? fromEvent(initial) : emptyForm());
  const [posterUrl, setPosterUrl] = useState<string | undefined>(initial?.posterUrl);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onSelectFile = (f: File) => {
    setPosterFile(f);
    const reader = new FileReader();
    reader.onload = () => setPosterPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.startDate) {
      setError('대회 이름과 시작일은 필수입니다');
      return;
    }
    const startTs = inputToTs(form.startDate);
    if (!startTs) {
      setError('시작일 형식이 올바르지 않습니다');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // 좌표 geocoding (주소 있고 좌표 없을 때)
      let lat: number | undefined;
      let lng: number | undefined;
      if (form.venueAddress.trim() && (initial?.lat == null || initial.venueAddress !== form.venueAddress.trim())) {
        try {
          const coords = await geocodeAddress(form.venueAddress.trim());
          if (coords) {
            lat = coords.lat;
            lng = coords.lng;
          }
        } catch {
          /* skip */
        }
      } else {
        lat = initial?.lat;
        lng = initial?.lng;
      }

      const payload: EventInput = {
        name: form.name.trim(),
        shortName: form.shortName.trim() || undefined,
        description: form.description.trim() || undefined,
        category: form.category,
        status: form.status,
        startDate: startTs,
        endDate: inputToTs(form.endDate),
        registrationDeadline: inputToTs(form.registrationDeadline),
        city: form.city.trim() || undefined,
        venueName: form.venueName.trim() || undefined,
        venueAddress: form.venueAddress.trim() || undefined,
        lat,
        lng,
        buyIn: form.buyIn ? Number(form.buyIn) : undefined,
        guaranteedPrize: form.guaranteedPrize ? Number(form.guaranteedPrize) : undefined,
        prizePool: form.prizePool ? Number(form.prizePool) : undefined,
        expectedPlayers: form.expectedPlayers ? Number(form.expectedPlayers) : undefined,
        contactName: form.contactName.trim() || undefined,
        contactPhone: form.contactPhone.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        registrationUrl: form.registrationUrl.trim() || undefined,
        officialUrl: form.officialUrl.trim() || undefined,
        livestreamUrl: form.livestreamUrl.trim() || undefined,
        organizerId,
        organizerName,
        isPlatformPosted: isPlatformMode || undefined,
        ownerUid,
        posterUrl,
      };

      let eventId = initial?.id;
      if (isEdit && eventId) {
        await updateEvent(eventId, payload);
      } else {
        const { createEvent: create } = await import('@/lib/events');
        eventId = await create(payload);
      }

      // 포스터 업로드 (있을 때)
      if (posterFile && eventId) {
        try {
          const url = await uploadEventPoster(eventId, posterFile);
          await updateEvent(eventId, { posterUrl: url });
        } catch (e) {
          console.warn('Poster upload failed', e);
        }
      }
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-gray-900">
            {isEdit ? '대회 수정' : '새 대회 등록'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* 포스터 */}
          <Field label="포스터 (5MB 이하)">
            <div className="flex items-start gap-3">
              <div className="w-24 h-32 bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0">
                {posterPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={posterPreview} alt="preview" className="w-full h-full object-cover" />
                ) : posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={posterUrl} alt="poster" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl opacity-40">🏆</span>
                )}
              </div>
              <div className="flex-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-black text-white px-3 py-2 rounded-lg text-xs font-bold"
                >
                  {posterUrl || posterPreview ? '교체' : '포스터 업로드'}
                </button>
                {(posterUrl || posterPreview) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPosterFile(null);
                      setPosterPreview(null);
                      setPosterUrl(undefined);
                    }}
                    className="ml-2 text-xs text-red-500 underline"
                  >
                    제거
                  </button>
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onSelectFile(f);
                  }}
                />
              </div>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="대회명 (필수)">
              <input className="form-input" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="WSOP Main Event 2026" />
            </Field>
            <Field label="짧은 이름 (선택)">
              <input className="form-input" value={form.shortName} onChange={(e) => update('shortName', e.target.value)} placeholder="WSOP ME" />
            </Field>
          </div>

          <Field label="설명">
            <textarea
              className="form-input min-h-[80px]"
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="대회 소개·특징·바이인 구조 등"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="카테고리">
              <select className="form-input" value={form.category} onChange={(e) => update('category', e.target.value as EventCategory)}>
                <option value="domestic">국내</option>
                <option value="international">국외</option>
              </select>
            </Field>
            <Field label="상태">
              <select className="form-input" value={form.status} onChange={(e) => update('status', e.target.value as EventStatus)}>
                <option value="upcoming">예정</option>
                <option value="ongoing">진행 중</option>
                <option value="completed">종료</option>
                <option value="cancelled">취소</option>
              </select>
            </Field>
            <Field label="예상 인원">
              <input type="number" className="form-input" value={form.expectedPlayers} onChange={(e) => update('expectedPlayers', e.target.value)} placeholder="500" />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="시작일 (필수)">
              <input type="date" className="form-input" value={form.startDate} onChange={(e) => update('startDate', e.target.value)} />
            </Field>
            <Field label="종료일">
              <input type="date" className="form-input" value={form.endDate} onChange={(e) => update('endDate', e.target.value)} />
            </Field>
            <Field label="등록 마감">
              <input type="date" className="form-input" value={form.registrationDeadline} onChange={(e) => update('registrationDeadline', e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="도시 (지역 뱃지)">
              <input
                className="form-input"
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
                placeholder={form.category === 'international' ? '예: 라스베이거스' : '예: 부산'}
                list="event-city-suggestions"
              />
              <datalist id="event-city-suggestions">
                {(form.category === 'international' ? INTL_CITIES : DOMESTIC_CITIES).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="대회장 이름">
              <input className="form-input" value={form.venueName} onChange={(e) => update('venueName', e.target.value)} placeholder="파라다이스 시티" />
            </Field>
            <Field label="대회장 주소 (전체)">
              <input className="form-input" value={form.venueAddress} onChange={(e) => update('venueAddress', e.target.value)} placeholder="인천 중구 영종해안남로 321" />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="바이인 (원)">
              <input type="number" className="form-input" value={form.buyIn} onChange={(e) => update('buyIn', e.target.value)} placeholder="1000000" />
            </Field>
            <Field label="GTD (원)">
              <input type="number" className="form-input" value={form.guaranteedPrize} onChange={(e) => update('guaranteedPrize', e.target.value)} placeholder="100000000" />
            </Field>
            <Field label="총 상금 (원)">
              <input type="number" className="form-input" value={form.prizePool} onChange={(e) => update('prizePool', e.target.value)} placeholder="200000000" />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="담당자">
              <input className="form-input" value={form.contactName} onChange={(e) => update('contactName', e.target.value)} placeholder="홍길동" />
            </Field>
            <Field label="담당 전화">
              <input className="form-input font-mono" value={form.contactPhone} onChange={(e) => update('contactPhone', e.target.value)} placeholder="010-0000-0000" />
            </Field>
            <Field label="담당 이메일">
              <input type="email" className="form-input" value={form.contactEmail} onChange={(e) => update('contactEmail', e.target.value)} placeholder="contact@example.com" />
            </Field>
          </div>

          <Field label="등록 URL (외부)">
            <input className="form-input" value={form.registrationUrl} onChange={(e) => update('registrationUrl', e.target.value)} placeholder="https://..." />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="공식 사이트">
              <input className="form-input" value={form.officialUrl} onChange={(e) => update('officialUrl', e.target.value)} placeholder="https://wsop.com/..." />
            </Field>
            <Field label="라이브 스트림">
              <input className="form-input" value={form.livestreamUrl} onChange={(e) => update('livestreamUrl', e.target.value)} placeholder="https://twitch.tv/..." />
            </Field>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border-[1.5px] border-gray-200 font-bold text-sm"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2.5 rounded-lg bg-amber-500 text-white font-bold text-sm disabled:opacity-40"
          >
            {saving ? '저장 중…' : isEdit ? '저장' : '등록'}
          </button>
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
