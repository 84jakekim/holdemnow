'use client';

/**
 * /platform/members/store/[id] — 매장 가입 심사 상세
 *
 * 본사 총괄 어드민이 신청 매장을 "심사 기준(충족/미충족)"으로 검토하고 승인/반려하는 화면.
 * - 자동 기준: 신청 데이터로 즉시 판정(✅/❌) — storeReview.evaluateAutoCriteria
 * - 수동 기준: 담당자가 검토 후 체크 → stores/{id}.reviewChecklist 에 저장
 * - 필수 기준 전부 충족 시에만 "승인" 활성. 미충족이면 경고 후에도 강제 승인은 가능(운영 재량).
 *
 * 보안: stores status 변경은 firestore.rules에서 platform_admin만 허용.
 *       이 페이지는 /platform/* 레이아웃에서 platform_admin으로 게이팅됨.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  summarizeReview,
  type StoreApplicationData,
  type EvaluatedCriterion,
} from '@/lib/storeReview';

interface StoreDoc extends StoreApplicationData {
  id: string;
  status?: 'pending' | 'active' | 'rejected' | 'suspended' | 'paused' | 'closed';
  isDemo?: boolean;
  rejectionReason?: string;
  reviewNote?: string;
  createdAt?: { toDate: () => Date };
  reviewedAt?: { toDate: () => Date };
}

export default function StoreReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [store, setStore] = useState<StoreDoc | null | undefined>(undefined);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'stores', id),
      (snap) => setStore(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<StoreDoc, 'id'>) }) : null),
      () => setStore(null),
    );
    return unsub;
  }, [id]);

  if (store === undefined) {
    return <div className="text-sm" style={{ color: 'var(--text-2)' }}>로딩 중…</div>;
  }
  if (store === null) {
    return (
      <div>
        <BackLink />
        <div className="mt-6 text-sm" style={{ color: 'var(--text-2)' }}>매장을 찾을 수 없습니다.</div>
      </div>
    );
  }

  const summary = summarizeReview(store);
  const status = store.status ?? 'pending';

  const toggleManual = async (cid: string, next: boolean) => {
    await updateDoc(doc(db, 'stores', id), {
      [`reviewChecklist.${cid}`]: next,
      updatedAt: serverTimestamp(),
    });
  };

  const approve = async () => {
    if (!summary.canApprove) {
      const ok = window.confirm(
        `미충족 필수 항목이 ${summary.unmetRequired.length}개 있습니다:\n` +
        summary.unmetRequired.map((c) => `· ${c.label}`).join('\n') +
        `\n\n그래도 승인하시겠습니까?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await updateDoc(doc(db, 'stores', id), {
        status: 'active',
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'stores', id), {
        status: 'rejected',
        rejectionReason: rejectReason.trim(),
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setRejectOpen(false);
      setRejectReason('');
    } finally {
      setBusy(false);
    }
  };

  const suspend = async () => {
    if (!window.confirm(`"${store.name}" 매장을 정지하시겠습니까?`)) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'stores', id), { status: 'suspended', updatedAt: serverTimestamp() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <BackLink />

      {/* 헤더 */}
      <div className="mt-4 mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-1)' }}>{store.name || '(이름 없음)'}</h1>
            <StatusBadge status={status} />
            {store.isDemo && (
              <span className="text-[9px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-extrabold">DEMO</span>
            )}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            신청일: {store.createdAt ? fmt(store.createdAt.toDate()) : '—'}
            {store.reviewedAt && ` · 심사일: ${fmt(store.reviewedAt.toDate())}`}
          </div>
        </div>

        {/* 심사 충족 요약 */}
        <div
          className="rounded-xl px-4 py-3 text-center"
          style={{ background: 'var(--surface-2, #fff)', border: '1px solid var(--border)' }}
        >
          <div className="text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-3)' }}>심사 충족</div>
          <div className="text-2xl font-extrabold" style={{ color: summary.canApprove ? '#16A34A' : '#F59E0B' }}>
            {summary.metCount}<span className="text-sm" style={{ color: 'var(--text-3)' }}>/{summary.totalCount}</span>
          </div>
          <div className="text-[10px] font-bold" style={{ color: summary.canApprove ? '#16A34A' : '#F59E0B' }}>
            {summary.canApprove ? '승인 가능' : `필수 ${summary.unmetRequired.length}건 미충족`}
          </div>
        </div>
      </div>

      {/* 반려 사유 표시 (이미 반려된 경우) */}
      {status === 'rejected' && store.rejectionReason && (
        <div className="rounded-xl p-4 mb-5 text-xs" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
          <b>반려 사유:</b> {store.rejectionReason}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        {/* 좌: 신청 정보 */}
        <section>
          <SectionTitle>신청 정보</SectionTitle>
          {(store.signageImageUrl || (store.photoUrls && store.photoUrls[0])) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={store.signageImageUrl || store.photoUrls![0]}
              alt="매장 간판"
              className="w-full rounded-xl border mb-3 object-cover"
              style={{ aspectRatio: '4/3', borderColor: 'var(--border)' }}
            />
          )}
          <dl className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <InfoRow label="사업자번호" value={store.businessRegistrationNumber} mono />
            <InfoRow label="대표자" value={[store.representativeName, store.representativePhone].filter(Boolean).join(' · ')} />
            <InfoRow label="매장 전화" value={store.phone} mono />
            <InfoRow label="주소" value={[store.roadAddress, store.address].find(Boolean)} />
            <InfoRow label="지역코드" value={store.regionCode} />
            <InfoRow label="영업시간" value={store.hours} />
            <InfoRow label="소개" value={store.description} />
          </dl>
        </section>

        {/* 우: 심사 기준 */}
        <section>
          <SectionTitle>자동 심사 기준</SectionTitle>
          <div className="space-y-1.5 mb-5">
            {summary.auto.map((c) => (
              <CriterionRow key={c.id} c={c} />
            ))}
          </div>

          <SectionTitle>수동 심사 (담당자 확인)</SectionTitle>
          <div className="space-y-1.5">
            {summary.manual.map((c) => (
              <ManualRow key={c.id} c={c} onToggle={(v) => toggleManual(c.id, v)} disabled={busy} />
            ))}
          </div>
        </section>
      </div>

      {/* 액션 */}
      <div className="mt-7 flex gap-2.5 flex-wrap">
        {status !== 'active' && (
          <button
            onClick={approve}
            disabled={busy}
            className="px-6 py-3 rounded-xl font-extrabold text-sm text-white disabled:opacity-40"
            style={{ background: summary.canApprove ? '#16A34A' : '#9CA3AF' }}
          >
            {status === 'rejected' || status === 'suspended' ? '✅ 승인(재개)' : '✅ 승인'}
            {!summary.canApprove && ' (미충족)'}
          </button>
        )}
        {status === 'pending' && (
          <button
            onClick={() => setRejectOpen(true)}
            disabled={busy}
            className="px-6 py-3 rounded-xl font-bold text-sm disabled:opacity-40"
            style={{ background: '#fff', border: '1.5px solid #FECACA', color: '#DC2626' }}
          >
            ⛔ 반려
          </button>
        )}
        {status === 'active' && (
          <button
            onClick={suspend}
            disabled={busy}
            className="px-6 py-3 rounded-xl font-bold text-sm disabled:opacity-40"
            style={{ background: '#F3F4F6', color: '#374151' }}
          >
            정지
          </button>
        )}
        <a
          href={`/admin/${store.id}`}
          target="_blank"
          rel="noopener"
          className="px-6 py-3 rounded-xl font-bold text-sm"
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)' }}
        >
          매장 어드민 ↗
        </a>
      </div>

      {/* 반려 모달 */}
      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setRejectOpen(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-extrabold text-gray-900 mb-1">반려 처리</h3>
            <p className="text-xs text-gray-500 mb-4"><b>{store.name}</b>의 신청을 반려합니다. 사유는 가입자에게 전달됩니다.</p>
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 text-sm min-h-[90px] resize-none outline-none focus:border-pink-500"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="예: 사업자등록번호가 조회되지 않습니다. 정확한 번호로 재신청 바랍니다."
            />
            <div className="flex gap-2.5 mt-4">
              <button onClick={() => setRejectOpen(false)} className="flex-1 py-2.5 rounded-xl border-[1.5px] border-gray-200 font-bold text-sm">취소</button>
              <button onClick={reject} disabled={busy || rejectReason.trim().length < 2} className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-bold text-sm disabled:opacity-40">반려</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 서브 컴포넌트
// ─────────────────────────────────────────────────────────────
function BackLink() {
  return (
    <Link href="/platform/members?tab=stores" className="text-xs font-bold inline-flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
      ← 매장 목록으로
    </Link>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-extrabold tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>{children}</div>;
}

function InfoRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 px-3 py-2.5 text-xs" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="shrink-0 w-20 font-bold" style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className={`flex-1 break-words ${mono ? 'font-mono' : ''}`} style={{ color: value ? 'var(--text-1)' : 'var(--text-3)' }}>
        {value || '미입력'}
      </span>
    </div>
  );
}

function CriterionRow({ c }: { c: EvaluatedCriterion }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-3 py-2" style={{ background: c.met ? 'rgba(22,163,74,0.06)' : 'rgba(245,158,11,0.06)', border: `1px solid ${c.met ? 'rgba(22,163,74,0.2)' : 'rgba(245,158,11,0.25)'}` }}>
      <span className="text-sm leading-5">{c.met ? '✅' : '⚠️'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
          {c.label}
          {c.required && <span className="text-[9px] font-extrabold" style={{ color: '#DC2626' }}>필수</span>}
        </div>
        {c.detail && <div className="text-[10.5px] mt-0.5 break-words" style={{ color: 'var(--text-3)' }}>{c.detail}</div>}
      </div>
    </div>
  );
}

function ManualRow({ c, onToggle, disabled }: { c: EvaluatedCriterion; onToggle: (v: boolean) => void; disabled: boolean }) {
  return (
    <label className="flex items-start gap-2.5 rounded-lg px-3 py-2 cursor-pointer" style={{ background: c.met ? 'rgba(22,163,74,0.06)' : 'var(--surface-2, #fff)', border: `1px solid ${c.met ? 'rgba(22,163,74,0.2)' : 'var(--border)'}` }}>
      <input
        type="checkbox"
        checked={c.met}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-0.5 w-4 h-4 accent-green-600"
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
          {c.label}
          {c.required && <span className="text-[9px] font-extrabold" style={{ color: '#DC2626' }}>필수</span>}
        </div>
        <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>{c.hint}</div>
      </div>
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending: { bg: '#FEF3C7', fg: '#B45309', label: '심사 대기' },
    active: { bg: '#DCFCE7', fg: '#15803D', label: '활성' },
    rejected: { bg: '#FEE2E2', fg: '#B91C1C', label: '반려' },
    suspended: { bg: '#E5E7EB', fg: '#4B5563', label: '정지' },
    paused: { bg: '#E5E7EB', fg: '#4B5563', label: '중단' },
    closed: { bg: '#FEE2E2', fg: '#B91C1C', label: '종료' },
  };
  const s = map[status] ?? { bg: '#F3F4F6', fg: '#6B7280', label: status };
  return <span className="text-[10px] font-extrabold rounded px-2 py-0.5" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

function fmt(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
