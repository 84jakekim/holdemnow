'use client';

/**
 * /platform/members/store/[storeId] — 매장 사장 상세
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sendPasswordReset } from '@/lib/emailAuth';
import { logAdminAction } from '@/lib/auditLog';
import { geocodeAddress } from '@/lib/kakao';
import MemberDetailHeader, { type MemberStatus } from '@/components/platform/MemberDetailHeader';
import IdentityVerificationCard from '@/components/platform/IdentityVerificationCard';
import ConsentSummaryCard from '@/components/platform/ConsentSummaryCard';
import StoreInfoCard from '@/components/platform/StoreInfoCard';
import { summarizeReview, type StoreApplicationData, type EvaluatedCriterion } from '@/lib/storeReview';

// =====================================================================
// 타입
// =====================================================================

type StoreStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'paused' | 'closed';

interface StoreDetail {
  id: string;
  ownerUid?: string;
  name?: string;
  address?: string;
  roadAddress?: string;
  detailAddress?: string;
  jibunAddress?: string;
  zonecode?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  hours?: string;
  description?: string;
  signageImageUrl?: string;
  representativeName?: string;
  representativePhone?: string;
  businessRegistrationNumber?: string;
  regionCode?: string;
  photoUrls?: string[];
  status?: StoreStatus;
  reviewChecklist?: Record<string, boolean>;
  createdAt?: { toDate: () => Date } | null;
  signupApplication?: {
    submittedAt?: string;
    agreeService?: boolean;
    agreePrivacy?: boolean;
    agreeMarketing?: boolean;
  };
}

interface OwnerUser {
  email?: string;
  displayName?: string;
  realName?: string;
  providers?: string[];
  passwordHint?: string;
  recoveryLast4?: string;
  signupAt?: { toDate: () => Date } | null;
  createdAt?: { toDate: () => Date } | null;
  kycCompletedAt?: { toDate: () => Date } | null;
  kycSource?: string;
}

function fmtDate(ts?: { toDate: () => Date } | null): string {
  if (!ts) return '-';
  try {
    const d = ts.toDate();
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '-';
  }
}

function toMemberStatus(s?: StoreStatus): MemberStatus {
  if (s === 'active') return 'active';
  if (s === 'pending') return 'pending';
  if (s === 'suspended') return 'suspended';
  if (s === 'rejected') return 'rejected';
  return 'active';
}

// =====================================================================
// 메인
// =====================================================================

export default function StoreDetailPage() {
  const params = useParams<{ storeId: string }>();
  const storeId = params?.storeId ?? '';

  const [store, setStore] = useState<StoreDetail | null>(null);
  const [owner, setOwner] = useState<OwnerUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!storeId) return;
    (async () => {
      const snap = await getDoc(doc(db, 'stores', storeId));
      if (snap.exists()) {
        const data = { id: storeId, ...snap.data() } as StoreDetail;
        setStore(data);
        // owner 정보 fetch
        if (data.ownerUid) {
          const ownerSnap = await getDoc(doc(db, 'users', data.ownerUid));
          if (ownerSnap.exists()) setOwner(ownerSnap.data() as OwnerUser);
        }
      }
      setLoading(false);
    })();
  }, [storeId]);

  const handleStatusChange = async (newStatus: MemberStatus) => {
    if (!store) return;
    try {
      // 본사가 매장을 'active'로 승인하는 첫 시점에 한해 카카오 geocoding 1회 시도.
      // 도로명 실패 시 지번 폴백. 둘 다 실패하면 좌표 없이 그냥 active 처리 →
      // 첫 모바일 진입 시 lazy geocoding (m/discover) 안전망 그대로 동작.
      const goingActive = newStatus === 'active' && store.status !== 'active';
      const needsGeocode = goingActive && (typeof store.lat !== 'number' || typeof store.lng !== 'number');

      let geocoded: { lat: number; lng: number } | null = null;
      if (needsGeocode) {
        try {
          const addr1 = store.roadAddress?.trim() || store.address?.trim();
          if (addr1) geocoded = await geocodeAddress(addr1);
          if (!geocoded && store.jibunAddress) {
            geocoded = await geocodeAddress(store.jibunAddress.trim());
          }
        } catch {
          /* 카카오 한도/오류 — 좌표 없이 active 처리, 추후 lazy 폴백 */
        }
      }

      const updatePayload: Record<string, unknown> = {
        status: newStatus,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (geocoded) {
        updatePayload.lat = geocoded.lat;
        updatePayload.lng = geocoded.lng;
        updatePayload.geocodedAt = serverTimestamp();
      }
      if (goingActive) {
        updatePayload.approvedAt = serverTimestamp();
      }

      await updateDoc(doc(db, 'stores', storeId), updatePayload);
      await logAdminAction({
        action: 'change_status',
        target: { type: 'store', id: storeId },
        metadata: { from: store.status, to: newStatus, geocoded: !!geocoded },
      });
      setStore((s) => s ? {
        ...s,
        status: newStatus as StoreStatus,
        ...(geocoded ? { lat: geocoded.lat, lng: geocoded.lng } : {}),
      } : s);
      const msg = goingActive
        ? geocoded
          ? '매장 승인 완료 + 지도 좌표 등록됨'
          : '매장 승인 완료 (좌표는 모바일 첫 진입 시 자동 산출)'
        : `매장 상태가 "${newStatus}"로 변경되었습니다.`;
      showToast(msg);
    } catch {
      showToast('상태 변경에 실패했습니다.', 'error');
    }
  };

  const handleSendPasswordReset = async () => {
    if (!owner?.email) return;
    try {
      await sendPasswordReset(owner.email);
      await logAdminAction({
        action: 'send_password_reset',
        target: { type: 'store', id: storeId },
        metadata: { email: owner.email },
      });
      showToast('비밀번호 재설정 메일을 발송했습니다.');
    } catch {
      showToast('메일 발송에 실패했습니다.', 'error');
    }
  };

  const toggleManualCriterion = async (cid: string, next: boolean) => {
    if (!store) return;
    setStore((s) => s ? { ...s, reviewChecklist: { ...(s.reviewChecklist ?? {}), [cid]: next } } : s);
    try {
      await updateDoc(doc(db, 'stores', storeId), {
        [`reviewChecklist.${cid}`]: next,
        updatedAt: serverTimestamp(),
      });
    } catch {
      showToast('심사 체크 저장 실패', 'error');
    }
  };

  if (loading) return <div className="text-sm text-gray-500 p-8">로딩 중…</div>;
  if (!store) return <div className="text-sm text-red-500 p-8">매장을 찾을 수 없습니다.</div>;

  const isEmailProvider = (owner?.providers ?? []).includes('password');
  const currentStatus = toMemberStatus(store.status);

  return (
    <div className="max-w-5xl">
      {toast && (
        <div
          role="alert"
          className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl text-sm font-bold text-white shadow-lg ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <MemberDetailHeader
        name={store.name ?? '(매장명 없음)'}
        email={owner?.email}
        status={currentStatus}
        type="store"
        providers={owner?.providers}
        onStatusChange={handleStatusChange}
        onSendPasswordReset={isEmailProvider ? handleSendPasswordReset : undefined}
        isEmailProvider={isEmailProvider}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 좌측 메인 */}
        <div className="lg:col-span-2 space-y-5">
          {/* 계정 정보 */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-gray-900 mb-3">계정 정보</h3>
            <div className="space-y-2.5">
              <InfoRow label="이메일" value={owner?.email} />
              <InfoRow label="대표자명" value={owner?.realName ?? store.representativeName} />
              <InfoRow label="KYC 완료" value={owner?.kycCompletedAt ? fmtDate(owner.kycCompletedAt) : undefined} />
              <InfoRow label="KYC 방법" value={owner?.kycSource} />
              <InfoRow label="가입일시" value={fmtDate(store.createdAt)} />
            </div>
          </div>

          {/* 심사 기준 — 충족/미충족 (자동) + 담당자 수동 확인 */}
          <ReviewChecklistCard store={store} onToggle={toggleManualCriterion} />

          {/* 매장 상세 정보 */}
          <StoreInfoCard
            name={store.name}
            address={store.address}
            hours={store.hours}
            phone={store.phone}
            description={store.description}
            signageImageUrl={store.signageImageUrl}
            representativeName={store.representativeName}
            representativePhone={store.representativePhone}
            businessRegistrationNumber={store.businessRegistrationNumber}
            signupApplication={store.signupApplication}
          />

          {/* 본인 확인 카드 */}
          {isEmailProvider && (
            <IdentityVerificationCard
              email={owner?.email ?? ''}
              loginId={owner?.email}
              passwordHint={owner?.passwordHint}
              recoveryLast4={owner?.recoveryLast4}
              onSendPasswordReset={handleSendPasswordReset}
              targetUid={store.ownerUid}
            />
          )}

          {/* 약관 동의 */}
          <ConsentSummaryCard
            consent={{
              agreeService: store.signupApplication?.agreeService,
              agreePrivacy: store.signupApplication?.agreePrivacy,
              agreeMarketing: store.signupApplication?.agreeMarketing,
              submittedAt: store.signupApplication?.submittedAt,
            }}
          />
        </div>

        {/* 우측 사이드 */}
        <div className="space-y-5">
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-gray-900 mb-3">매장 통계</h3>
            <StatRow label="현재 상태" value={store.status ?? '-'} />
            <div className="pt-3 mt-3 border-t border-gray-100">
              <a
                href={`/admin/${storeId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-2.5 text-center rounded-xl text-xs font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
              >
                매장 어드민으로 이동 ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-[11px] font-bold text-gray-500 flex-shrink-0 w-20 pt-0.5">{label}</span>
      <span className="text-gray-800 flex-1">{value ?? <span className="text-gray-400">-</span>}</span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-[12px] text-gray-600">{label}</span>
      <span className="text-[12px] font-bold text-gray-900">{value}</span>
    </div>
  );
}

// 심사 기준 카드 — 자동(✅/⚠️) + 수동 체크(저장). storeReview SSOT 사용.
function ReviewChecklistCard({
  store,
  onToggle,
}: {
  store: StoreApplicationData;
  onToggle: (cid: string, next: boolean) => void;
}) {
  const summary = summarizeReview(store);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-extrabold text-gray-900">심사 기준</h3>
        <span
          className="text-[11px] font-extrabold rounded px-2 py-0.5"
          style={summary.canApprove ? { background: '#DCFCE7', color: '#15803D' } : { background: '#FEF3C7', color: '#B45309' }}
          title={summary.canApprove ? '필수 항목 전부 충족 — 승인 가능' : `필수 미충족 ${summary.unmetRequired.length}건`}
        >
          충족 {summary.metCount}/{summary.totalCount}
        </span>
      </div>

      <div className="text-[10px] font-bold text-gray-400 mb-1.5">자동 판정</div>
      <div className="space-y-1.5 mb-4">
        {summary.auto.map((c) => <AutoRow key={c.id} c={c} />)}
      </div>

      <div className="text-[10px] font-bold text-gray-400 mb-1.5">담당자 확인</div>
      <div className="space-y-1.5">
        {summary.manual.map((c) => (
          <label key={c.id} className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer border"
            style={c.met ? { background: 'rgba(22,163,74,.06)', borderColor: 'rgba(22,163,74,.25)' } : { background: '#fff', borderColor: '#E5E7EB' }}>
            <input type="checkbox" checked={c.met} onChange={(e) => onToggle(c.id, e.target.checked)} className="mt-0.5 w-4 h-4 accent-green-600" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                {c.label}
                {c.required && <span className="text-[9px] font-extrabold text-red-600">필수</span>}
              </div>
              <div className="text-[10.5px] text-gray-500 mt-0.5">{c.hint}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function AutoRow({ c }: { c: EvaluatedCriterion }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 border"
      style={c.met ? { background: 'rgba(22,163,74,.05)', borderColor: 'rgba(22,163,74,.2)' } : { background: 'rgba(245,158,11,.05)', borderColor: 'rgba(245,158,11,.25)' }}>
      <span className="text-sm leading-5">{c.met ? '✅' : '⚠️'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
          {c.label}
          {c.required && <span className="text-[9px] font-extrabold text-red-600">필수</span>}
        </div>
        {c.detail && <div className="text-[10.5px] text-gray-500 mt-0.5 break-words">{c.detail}</div>}
      </div>
    </div>
  );
}
