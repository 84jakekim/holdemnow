'use client';

import { useEffect, useState } from 'react';
import {
  type JobOffer,
  type JobRole,
  type ShiftType,
  JOB_ROLE_LABELS,
  SHIFT_LABELS,
  formatWage,
  formatRelativeTime,
  subscribeStoreJobs,
  createJob,
  updateJob,
  deleteJob,
} from '@/lib/community';
import { useAuth } from '@/lib/hooks';

/* ============================================================
 * JobsPanel — 매장 어드민 구인 관리 패널
 * /admin/[storeId] 의 activeMenu === 'jobs' 일 때 렌더
 * 데이터: PLACEHOLDER_JOBS (부모 에이전트가 Firestore로 교체)
 * ========================================================== */

interface JobsPanelProps {
  storeId: string;
  storeName: string;
}

type ModalMode = 'create' | 'edit';

const WAGE_TYPE_LABELS = {
  hourly: '시간당',
  monthly: '월급',
  negotiable: '협의',
};

const defaultForm = (): NewJobForm => ({
  role: 'dealer',
  wageType: 'hourly',
  wageAmount: '',
  shift: [],
  title: '',
  body: '',
  phone: '',
  kakaoOpenChat: '',
  expiresInDays: 30,
});

interface NewJobForm {
  role: JobRole;
  wageType: 'hourly' | 'monthly' | 'negotiable';
  wageAmount: string;
  shift: ShiftType[];
  title: string;
  body: string;
  phone: string;
  kakaoOpenChat: string;
  expiresInDays: number;
}

export default function JobsPanel({ storeId, storeName }: JobsPanelProps) {
  const authState = useAuth();
  const [jobs, setJobs] = useState<JobOffer[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<NewJobForm>(defaultForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = subscribeStoreJobs(storeId, setJobs, () => {});
    return unsub;
  }, [storeId]);

  function openCreate() {
    setModalMode('create');
    setEditingId(null);
    setForm({
      ...defaultForm(),
      title: `${storeName} 딜러 구인`,
    });
    setModalOpen(true);
  }

  function openEdit(job: JobOffer) {
    setModalMode('edit');
    setEditingId(job.id);
    setForm({
      role: job.role,
      wageType: job.wage.type,
      wageAmount: job.wage.amount?.toString() ?? '',
      shift: [...job.shift],
      title: job.title,
      body: job.body,
      phone: job.contact?.phone ?? '',
      kakaoOpenChat: job.contact?.kakaoOpenChat ?? '',
      expiresInDays: 30,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setForm(defaultForm());
  }

  async function handleSave() {
    if (!form.title.trim() || !form.body.trim()) return;
    if (!form.phone.trim() && !form.kakaoOpenChat.trim()) {
      alert('전화 또는 카카오 오픈채팅 URL 중 하나 이상 입력해주세요.');
      return;
    }
    if (authState.status !== 'authenticated') {
      alert('로그인이 필요합니다');
      return;
    }
    setSaving(true);
    try {
      const wage = {
        type: form.wageType,
        amount: form.wageType !== 'negotiable' && form.wageAmount ? Number(form.wageAmount) : undefined,
        currency: 'KRW' as const,
      };
      const contact = {
        phone: form.phone || undefined,
        kakaoOpenChat: form.kakaoOpenChat || undefined,
      };
      const expiresAt = new Date(Date.now() + form.expiresInDays * 86_400_000);
      if (modalMode === 'create') {
        await createJob({
          storeId,
          storeName,
          authorUid: authState.user.uid,
          title: form.title,
          body: form.body,
          role: form.role,
          wage,
          shift: form.shift,
          contact,
          expiresAt,
        });
      } else if (editingId) {
        await updateJob(editingId, {
          title: form.title,
          body: form.body,
          role: form.role,
          wage,
          shift: form.shift,
          contact,
          expiresAt,
        });
      }
      closeModal();
    } catch (e: unknown) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleClose(jobId: string) {
    if (!confirm('이 공고를 마감 처리하시겠습니까?')) return;
    await updateJob(jobId, { status: 'closed' }).catch((e) =>
      alert(`마감 실패: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  async function handleDelete(jobId: string) {
    if (!confirm('공고를 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    await deleteJob(jobId).catch((e) =>
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  const toggleShift = (s: ShiftType) => {
    setForm((f) => ({
      ...f,
      shift: f.shift.includes(s) ? f.shift.filter((x) => x !== s) : [...f.shift, s],
    }));
  };

  const suggestTitle = (role: JobRole) => {
    setForm((f) => ({ ...f, role, title: `${storeName} ${JOB_ROLE_LABELS[role]} 구인` }));
  };

  return (
    <div>
      {/* ── 패널 헤더 ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">💼 구인 관리</h1>
          <p className="text-sm text-gray-500 mt-1">{storeName} · 채용 공고</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 h-10 rounded-xl text-sm font-bold text-white transition hover:opacity-90 active:opacity-75"
          style={{ background: '#FF1F8F' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          새 구인
        </button>
      </div>

      {/* ── 공고 리스트 ── */}
      {jobs.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center">
          <div className="text-4xl mb-3">📭</div>
          <p className="font-bold text-gray-700">등록된 구인 공고가 없습니다</p>
          <p className="text-sm text-gray-400 mt-1">우상단 &apos;새 구인&apos; 버튼으로 공고를 등록하세요.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => (
            <AdminJobCard
              key={job.id}
              job={job}
              onEdit={() => openEdit(job)}
              onClose={() => handleClose(job.id)}
              onDelete={() => handleDelete(job.id)}
            />
          ))}
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
                {modalMode === 'create' ? '새 구인 공고 등록' : '구인 공고 수정'}
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
              {/* 직무 select */}
              <FieldGroup label="직무">
                <select
                  value={form.role}
                  onChange={(e) => suggestTitle(e.target.value as JobRole)}
                  className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-pink-400"
                >
                  {(Object.keys(JOB_ROLE_LABELS) as JobRole[]).map((r) => (
                    <option key={r} value={r}>{JOB_ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </FieldGroup>

              {/* 제목 */}
              <FieldGroup label="공고 제목">
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder={`${storeName} ${JOB_ROLE_LABELS[form.role]} 구인`}
                  className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm text-gray-900 focus:outline-none focus:border-pink-400"
                />
              </FieldGroup>

              {/* 시급 */}
              <FieldGroup label="급여">
                <div className="flex gap-2">
                  <select
                    value={form.wageType}
                    onChange={(e) => setForm((f) => ({ ...f, wageType: e.target.value as NewJobForm['wageType'] }))}
                    className="h-10 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-pink-400"
                    style={{ minWidth: 90 }}
                  >
                    {(Object.keys(WAGE_TYPE_LABELS) as (keyof typeof WAGE_TYPE_LABELS)[]).map((t) => (
                      <option key={t} value={t}>{WAGE_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  {form.wageType !== 'negotiable' && (
                    <input
                      type="number"
                      value={form.wageAmount}
                      onChange={(e) => setForm((f) => ({ ...f, wageAmount: e.target.value }))}
                      placeholder="금액 (원)"
                      className="flex-1 h-10 rounded-xl border border-gray-200 px-3 text-sm text-gray-900 focus:outline-none focus:border-pink-400"
                      min={0}
                    />
                  )}
                </div>
              </FieldGroup>

              {/* 근무시간 */}
              <FieldGroup label="근무형태 (복수 선택)">
                <div className="flex gap-2 flex-wrap">
                  {(Object.keys(SHIFT_LABELS) as ShiftType[]).map((s) => {
                    const active = form.shift.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleShift(s)}
                        aria-pressed={active}
                        className="px-3 h-8 rounded-full text-xs font-bold transition"
                        style={{
                          background: active ? '#FF1F8F' : '#F3F4F6',
                          color: active ? '#fff' : '#6B7280',
                        }}
                      >
                        {SHIFT_LABELS[s]}
                      </button>
                    );
                  })}
                </div>
              </FieldGroup>

              {/* 본문 */}
              <FieldGroup label="공고 내용 (카톡 글 붙여넣기 OK)">
                <textarea
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder={`예)\n경력 우대, 초보도 교육 가능합니다.\n주 5일 고정 시프트, 복지 좋아요.`}
                  rows={5}
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

              {/* 만료일 */}
              <FieldGroup label="공고 기간">
                <select
                  value={form.expiresInDays}
                  onChange={(e) => setForm((f) => ({ ...f, expiresInDays: Number(e.target.value) }))}
                  className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-900 focus:outline-none focus:border-pink-400"
                >
                  <option value={7}>7일</option>
                  <option value={14}>14일</option>
                  <option value={30}>30일 (기본)</option>
                  <option value={60}>60일</option>
                </select>
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
                disabled={saving || !form.title.trim() || !form.body.trim()}
                className="flex-1 h-11 rounded-2xl text-sm font-bold text-white transition hover:opacity-90 active:opacity-75 disabled:opacity-40"
                style={{ background: '#FF1F8F' }}
              >
                {saving ? '저장 중…' : modalMode === 'create' ? '공고 등록' : '수정 완료'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 어드민 공고 카드 ── */
function AdminJobCard({
  job,
  onEdit,
  onClose,
  onDelete,
}: {
  job: JobOffer;
  onEdit: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const isClosed = job.status === 'closed' || job.status === 'expired';

  return (
    <div
      className="bg-white border rounded-2xl p-5 flex flex-col gap-3"
      style={{
        borderColor: isClosed ? '#E5E7EB' : 'rgba(255,31,143,0.18)',
        opacity: isClosed ? 0.7 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* 상태 배지 + 직무 */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="text-[10px] font-extrabold px-2 py-0.5 rounded-full"
              style={{
                background: isClosed ? '#F3F4F6' : 'rgba(255,31,143,0.10)',
                color: isClosed ? '#9CA3AF' : '#FF1F8F',
              }}
            >
              {isClosed ? '마감' : '모집중'}
            </span>
            <span className="text-[11px] font-bold text-gray-500">
              {JOB_ROLE_LABELS[job.role]}
            </span>
            {job.shift.map((s) => (
              <span key={s} className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                {SHIFT_LABELS[s]}
              </span>
            ))}
          </div>
          <h3 className="text-[15px] font-extrabold text-gray-900 truncate">{job.title}</h3>
          <div className="text-[18px] font-extrabold mt-0.5" style={{ color: isClosed ? '#9CA3AF' : '#FF1F8F' }}>
            {formatWage(job.wage)}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            {formatRelativeTime(job.createdAt)}
            {job.expiresAt && (
              <> · 만료 {new Date(job.expiresAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</>
            )}
          </p>
        </div>
      </div>

      {/* 액션 버튼 */}
      <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid #F3F4F6' }}>
        {!isClosed && (
          <button
            onClick={onEdit}
            className="flex-1 h-9 rounded-xl text-xs font-bold text-gray-700 transition hover:bg-gray-100"
            style={{ background: '#F3F4F6' }}
          >
            편집
          </button>
        )}
        {!isClosed && (
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-xl text-xs font-bold transition hover:opacity-90"
            style={{ background: '#FFF7ED', color: '#C2410C' }}
          >
            마감
          </button>
        )}
        <button
          onClick={onDelete}
          className="flex-1 h-9 rounded-xl text-xs font-bold transition hover:opacity-90"
          style={{ background: '#FEF2F2', color: '#B91C1C' }}
        >
          삭제
        </button>
      </div>
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
