'use client';

/**
 * 본사 어드민 — 마케팅 푸시 (platformCampaigns)
 *
 * - 캠페인 목록 (createdAt desc, 모든 상태)
 * - 새 캠페인 작성/수정 모달
 * - 즉시 발송 / 예약 발송 / 테스트 발송
 * - 상태별 액션 (수정/취소/삭제/재시도/지금 발송)
 *
 * backend(lib/campaigns.ts, rules, functions)는 firebase-backend가 a6aff2c에서 마무리.
 * 이 페이지는 그 위의 풀스택 UI.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Campaign,
  type CampaignStatus,
  subscribeAllCampaigns,
  createCampaign,
  updateCampaign,
  cancelCampaign,
  deleteCampaign,
  uploadCampaignImage,
  sendCampaignNow,
  sendTestCampaign,
  campaignStatusLabel,
  campaignDeliveryRate,
} from '@/lib/campaigns';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '@/lib/hooks';
import EmptyState from '@/components/ui/EmptyState';

// =====================================================================
// 유틸
// =====================================================================

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Timestamp/Date → datetime-local input value (YYYY-MM-DDTHH:mm). */
function toLocalInput(t?: Timestamp | Date | null): string {
  if (!t) return '';
  const d = t instanceof Date ? t : typeof (t as Timestamp).toDate === 'function' ? (t as Timestamp).toDate() : null;
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Timestamp → "MM/DD HH:mm" */
function fmtTs(t?: Timestamp | null): string {
  if (!t || typeof t.toDate !== 'function') return '';
  const d = t.toDate();
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 상대 시간 (k시간 전 / k분 전) */
function fmtRelative(t?: Timestamp | null): string {
  if (!t || typeof t.toDate !== 'function') return '';
  const ms = Date.now() - t.toDate().getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return fmtTs(t);
}

/** 숫자 천단위 콤마 */
function fmtNum(n: number | undefined): string {
  return (n ?? 0).toLocaleString();
}

const STATUS_STYLES: Record<
  CampaignStatus,
  { bg: string; fg: string; icon: string; border: string }
> = {
  draft: { bg: 'rgba(148,163,184,0.12)', fg: '#94A3B8', icon: '📝', border: 'rgba(148,163,184,0.35)' },
  scheduled: { bg: 'rgba(59,130,246,0.14)', fg: '#60A5FA', icon: '⏰', border: 'rgba(59,130,246,0.4)' },
  sending: { bg: 'rgba(234,179,8,0.16)', fg: '#FACC15', icon: '🔄', border: 'rgba(234,179,8,0.5)' },
  sent: { bg: 'rgba(16,185,129,0.14)', fg: '#34D399', icon: '✅', border: 'rgba(16,185,129,0.4)' },
  failed: { bg: 'rgba(239,68,68,0.14)', fg: '#F87171', icon: '⚠️', border: 'rgba(239,68,68,0.4)' },
  cancelled: { bg: 'rgba(148,163,184,0.1)', fg: '#94A3B8', icon: '🚫', border: 'rgba(148,163,184,0.3)' },
};

// =====================================================================
// 페이지
// =====================================================================

export default function PlatformMarketingPage() {
  const authState = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);

  useEffect(() => {
    const unsub = subscribeAllCampaigns(
      (items) => {
        setCampaigns(items);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  const counts = useMemo(() => {
    const by: Partial<Record<CampaignStatus, number>> = {};
    for (const c of campaigns) {
      by[c.status] = (by[c.status] ?? 0) + 1;
    }
    return by;
  }, [campaigns]);

  if (authState.status !== 'authenticated') return null;

  const me = authState.user;

  return (
    <div>
      <style jsx>{`
        @keyframes pulse-row {
          0%, 100% { background: var(--surface-1); }
          50% { background: rgba(234,179,8,0.08); }
        }
        .sending-row { animation: pulse-row 1.6s ease-in-out infinite; }
      `}</style>

      {/* 헤더 */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="section-title" style={{ color: 'var(--gold)' }}>MARKETING PUSH</div>
          <h1 className="h2" style={{ color: 'var(--text-1)' }}>
            📣 마케팅 푸시
          </h1>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
            본사가 알림설정 동의자 전원에게 발송하는 마케팅·이벤트 푸시. 즉시 / 예약 / 테스트 발송 지원.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3 text-[11px]">
            {(['scheduled', 'sending', 'sent', 'failed', 'cancelled', 'draft'] as CampaignStatus[]).map((s) => {
              const n = counts[s] ?? 0;
              if (n === 0) return null;
              const st = STATUS_STYLES[s];
              return (
                <span
                  key={s}
                  className="px-2 py-0.5 rounded font-bold"
                  style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}` }}
                >
                  {st.icon} {campaignStatusLabel(s)} {n}
                </span>
              );
            })}
          </div>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="px-4 py-2.5 rounded-xl font-bold text-sm"
          style={{ background: 'var(--gold)', color: '#0F1419' }}
        >
          + 새 캠페인
        </button>
      </div>

      {error && (
        <div
          className="mb-4 rounded-lg p-3 text-xs"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#F87171' }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>
          로딩 중…
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon="📣"
          title="등록된 캠페인이 없습니다"
          desc='우상단 "+ 새 캠페인"으로 첫 푸시를 만들어 보세요.'
        />
      ) : (
        <div className="flex flex-col gap-2">
          {campaigns.map((c) => (
            <CampaignRow key={c.id} campaign={c} onEdit={() => setEditing(c)} />
          ))}
        </div>
      )}

      {editing && (
        <CampaignWriteSheet
          campaign={editing === 'new' ? null : editing}
          me={{ uid: me.uid, name: me.displayName ?? me.email ?? '본사 관리자' }}
          onClose={() => setEditing(null)}
        />
      )}

      <div
        className="mt-8 rounded-xl p-5 text-xs leading-relaxed"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
      >
        <div className="font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          💡 발송 규칙
        </div>
        <ul className="list-disc list-inside space-y-1.5">
          <li>대상은 현재 알림설정 동의자 전원 (segment=all v0.1)</li>
          <li>예약 발송은 매 1분 cron(processScheduledCampaigns)이 자동 발송</li>
          <li>광고 표기 체크 시 본문 앞에 &quot;(광고)&quot; prefix가 자동으로 붙음</li>
          <li>야간(21~08시) 광고성 알림 발송은 사용자 별도 동의가 필요할 수 있음</li>
          <li>발송 시작 후(sending/sent/failed/cancelled)에는 본문 수정 불가</li>
        </ul>
      </div>
    </div>
  );
}

// =====================================================================
// 캠페인 행 (카드)
// =====================================================================

function CampaignRow({
  campaign,
  onEdit,
}: {
  campaign: Campaign;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const st = STATUS_STYLES[campaign.status];

  const handleSendNow = async () => {
    if (campaign.status !== 'draft') return;
    if (!window.confirm('지금 알림 동의자 전원에게 발송됩니다. 진행할까요?')) return;
    setBusy(true);
    setErr(null);
    try {
      await sendCampaignNow(campaign.id);
      // 5초간 비활성
      setTimeout(() => setBusy(false), 5000);
      return;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('예약 캠페인을 취소할까요?')) return;
    setBusy(true);
    setErr(null);
    try {
      await cancelCampaign(campaign.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`"${campaign.title}" 캠페인을 삭제할까요? (첨부 이미지도 같이 삭제)`)) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteCampaign(campaign.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    // failed → draft로 되돌린 후 즉시 발송
    if (!window.confirm('실패한 캠페인을 다시 발송하시겠습니까?')) return;
    setBusy(true);
    setErr(null);
    try {
      await updateCampaign(campaign.id, {});
      // updateCampaign은 draft/scheduled만 허용. failed는 rules로 못 바꿈.
      // → 실패 건은 "삭제 후 새로 만들기"가 정석. 안내만.
      setErr('실패한 캠페인은 직접 수정할 수 없습니다. 삭제 후 새 캠페인으로 다시 만들어 주세요.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 시간 정보
  let timeInfo = '';
  if (campaign.status === 'scheduled' && campaign.scheduledAt) {
    timeInfo = `⏰ 예약: ${fmtTs(campaign.scheduledAt)}`;
  } else if (campaign.status === 'sent' && campaign.sentAt) {
    timeInfo = `발송: ${fmtRelative(campaign.sentAt)}`;
  } else if (campaign.createdAt) {
    timeInfo = `작성: ${fmtRelative(campaign.createdAt)}`;
  }

  // 통계 (sent일 때만)
  const showStats = campaign.status === 'sent';
  const rate = campaign.recipientCount && campaign.recipientCount > 0
    ? Math.round(campaignDeliveryRate(campaign) * 100)
    : 0;

  return (
    <div
      className={`rounded-xl p-3.5 flex gap-3 ${campaign.status === 'sending' ? 'sending-row' : ''}`}
      style={{
        background: 'var(--surface-1)',
        border: `1px solid ${st.border}`,
        borderRadius: 14,
      }}
    >
      {/* 썸네일 */}
      {campaign.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={campaign.imageUrl}
          alt=""
          style={{
            width: 60,
            height: 60,
            borderRadius: 10,
            objectFit: 'cover',
            flexShrink: 0,
            border: '1px solid var(--border)',
          }}
        />
      ) : (
        <div
          className="flex items-center justify-center text-2xl flex-shrink-0"
          style={{
            width: 60,
            height: 60,
            borderRadius: 10,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        >
          📣
        </div>
      )}

      {/* 중앙 본문 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <div className="font-bold truncate" style={{ color: 'var(--text-1)', maxWidth: 360 }}>
            {campaign.title}
          </div>
          <span
            className="text-[10px] font-extrabold tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}` }}
          >
            {st.icon} {campaignStatusLabel(campaign.status)}
          </span>
          {campaign.isAdvertisement && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--gold)', border: '1px solid rgba(245,158,11,0.35)' }}
            >
              광고
            </span>
          )}
        </div>
        <div className="text-xs truncate" style={{ color: 'var(--text-2)' }}>
          {campaign.isAdvertisement ? '(광고) ' : ''}
          {campaign.body}
        </div>
        <div className="text-[11px] mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: 'var(--text-3)' }}>
          {timeInfo && <span>{timeInfo}</span>}
          {campaign.sentByName && <span>by {campaign.sentByName}</span>}
          {campaign.linkUrl && <span>🔗 {campaign.linkUrl.length > 30 ? campaign.linkUrl.slice(0, 30) + '…' : campaign.linkUrl}</span>}
        </div>

        {/* 통계 (sent) */}
        {showStats && (
          <div
            className="mt-2 text-[11px] font-bold flex flex-wrap gap-x-3 gap-y-0.5"
            style={{ color: 'var(--text-2)' }}
          >
            {(campaign.recipientCount ?? 0) === 0 ? (
              <span style={{ color: '#F87171' }}>
                대상자 없음 — 알림설정 동의자가 없습니다
              </span>
            ) : (
              <>
                <span>{fmtNum(campaign.recipientCount)}명 발송</span>
                <span>
                  도달 {fmtNum(campaign.deliveredCount)} ({rate}%)
                </span>
                {(campaign.failureCount ?? 0) > 0 && (
                  <span style={{ color: '#F87171' }}>
                    실패 {fmtNum(campaign.failureCount)}
                  </span>
                )}
                {(campaign.clickCount ?? 0) > 0 && (
                  <span>클릭 {fmtNum(campaign.clickCount)}</span>
                )}
              </>
            )}
          </div>
        )}

        {/* 실패 메시지 */}
        {campaign.status === 'failed' && campaign.errorMessage && (
          <div
            className="mt-2 text-[11px] rounded p-2"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171' }}
          >
            ⚠️ {campaign.errorMessage}
          </div>
        )}

        {err && (
          <div
            className="mt-2 text-[11px] rounded p-2"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171' }}
          >
            {err}
          </div>
        )}
      </div>

      {/* 우측 액션 */}
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        {campaign.status === 'draft' && (
          <>
            <ActionButton onClick={handleSendNow} disabled={busy} variant="primary">
              지금 발송
            </ActionButton>
            <ActionButton onClick={onEdit} disabled={busy}>
              수정
            </ActionButton>
            <ActionButton onClick={handleDelete} disabled={busy} variant="danger">
              삭제
            </ActionButton>
          </>
        )}
        {campaign.status === 'scheduled' && (
          <>
            <ActionButton onClick={onEdit} disabled={busy}>
              수정
            </ActionButton>
            <ActionButton onClick={handleCancel} disabled={busy} variant="danger">
              취소
            </ActionButton>
          </>
        )}
        {campaign.status === 'sending' && (
          <ActionButton disabled>발송 중…</ActionButton>
        )}
        {campaign.status === 'sent' && (
          <ActionButton onClick={onEdit} disabled={busy}>
            상세
          </ActionButton>
        )}
        {campaign.status === 'failed' && (
          <>
            <ActionButton onClick={handleRetry} disabled={busy}>
              재시도
            </ActionButton>
            <ActionButton onClick={handleDelete} disabled={busy} variant="danger">
              삭제
            </ActionButton>
          </>
        )}
        {campaign.status === 'cancelled' && (
          <ActionButton onClick={handleDelete} disabled={busy} variant="danger">
            삭제
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = 'default',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
}) {
  const style: React.CSSProperties =
    variant === 'primary'
      ? { background: 'var(--gold)', color: '#0F1419', border: '1px solid var(--gold)' }
      : variant === 'danger'
        ? { background: 'transparent', color: '#F87171', border: '1px solid rgba(239,68,68,0.4)' }
        : { background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[11px] font-bold px-3 py-1.5 rounded-md disabled:opacity-40 whitespace-nowrap"
      style={style}
    >
      {children}
    </button>
  );
}

// =====================================================================
// 캠페인 작성/수정 모달
// =====================================================================

const TITLE_MAX = 60;
const BODY_MAX = 200;

function CampaignWriteSheet({
  campaign,
  me,
  onClose,
}: {
  campaign?: Campaign | null;
  me: { uid: string; name: string };
  onClose: () => void;
}) {
  const isNew = !campaign;
  const isReadOnly = !!campaign && !['draft', 'scheduled'].includes(campaign.status);

  const [title, setTitle] = useState(campaign?.title ?? '');
  const [body, setBody] = useState(campaign?.body ?? '');
  const [isAdvertisement, setIsAdvertisement] = useState(campaign?.isAdvertisement ?? false);
  const [imageUrl, setImageUrl] = useState<string | null>(campaign?.imageUrl ?? null);
  const [linkUrl, setLinkUrl] = useState(campaign?.linkUrl ?? '');
  const [autoLinkSelf, setAutoLinkSelf] = useState(false);
  const [sendMode, setSendMode] = useState<'now' | 'scheduled'>(
    campaign?.scheduledAt ? 'scheduled' : 'now',
  );
  const [scheduledAt, setScheduledAt] = useState<string>(toLocalInput(campaign?.scheduledAt));
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Storage 경로용 임시 ID
  const tempIdRef = useRef<string>(
    campaign?.id ?? `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingImage(true);
    try {
      const url = await uploadCampaignImage(tempIdRef.current, file);
      setImageUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 야간 발송 경고 (예약 시간 21~08시)
  const nightWarning = useMemo(() => {
    if (sendMode !== 'scheduled' || !scheduledAt) return false;
    const d = new Date(scheduledAt);
    if (Number.isNaN(d.getTime())) return false;
    const h = d.getHours();
    return h >= 21 || h < 8;
  }, [sendMode, scheduledAt]);

  // 예약 시각 5분 이상 미래 검증
  const scheduleError = useMemo(() => {
    if (sendMode !== 'scheduled') return null;
    if (!scheduledAt) return '예약 시각을 입력하세요';
    const d = new Date(scheduledAt);
    if (Number.isNaN(d.getTime())) return '예약 시각이 올바르지 않습니다';
    const remaining = d.getTime() - Date.now();
    if (remaining < 5 * 60 * 1000) return '예약 시각은 현재로부터 5분 이상 이후여야 합니다';
    return null;
  }, [sendMode, scheduledAt]);

  const finalBody = isAdvertisement && !body.trim().startsWith('(광고)')
    ? `(광고) ${body.trim()}`
    : body.trim();

  const handleTest = async () => {
    if (!title.trim() || !body.trim()) {
      setError('테스트 발송 전 제목·본문을 입력하세요');
      return;
    }
    setError(null);
    setTestStatus('발송 중…');
    try {
      await sendTestCampaign({
        title: title.trim(),
        body: finalBody,
        imageUrl: imageUrl ?? undefined,
        linkUrl: linkUrl.trim() || undefined,
        isAdvertisement,
        toUid: me.uid,
      });
      setTestStatus('본인 기기에 테스트 발송 완료 — 알림을 확인하세요');
    } catch (e) {
      setTestStatus(null);
      setError(e instanceof Error ? `테스트 발송 실패: ${e.message}` : String(e));
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError('제목은 필수입니다');
      return;
    }
    if (title.length > TITLE_MAX) {
      setError(`제목은 ${TITLE_MAX}자 이내여야 합니다`);
      return;
    }
    if (!body.trim()) {
      setError('본문은 필수입니다');
      return;
    }
    if (body.length > BODY_MAX) {
      setError(`본문은 ${BODY_MAX}자 이내여야 합니다`);
      return;
    }
    if (sendMode === 'scheduled' && scheduleError) {
      setError(scheduleError);
      return;
    }

    setError(null);
    setBusy(true);

    try {
      if (!isNew && campaign) {
        // 수정 (draft / scheduled만 가능)
        await updateCampaign(campaign.id, {
          title: title.trim(),
          body: finalBody,
          imageUrl: imageUrl ?? null,
          linkUrl: linkUrl.trim() || null,
          isAdvertisement,
          scheduledAt: sendMode === 'scheduled' ? new Date(scheduledAt) : null,
        });
        onClose();
        return;
      }

      // 신규 생성
      if (sendMode === 'scheduled') {
        // 예약 발송 — createCampaign with scheduledAt → status=scheduled
        const linkResolved = autoLinkSelf ? '__SELF__' : (linkUrl.trim() || null);
        const newId = await createCampaign({
          title: title.trim(),
          body: finalBody,
          imageUrl: imageUrl ?? null,
          linkUrl: linkResolved === '__SELF__' ? null : linkResolved,
          isAdvertisement,
          scheduledAt: new Date(scheduledAt),
          sentBy: me.uid,
          sentByName: me.name,
        });
        // 자기 ID로 자동 링크 적용
        if (linkResolved === '__SELF__') {
          await updateCampaign(newId, { linkUrl: `/m/campaigns/${newId}` });
        }
        onClose();
      } else {
        // 즉시 발송
        if (
          !window.confirm(
            '지금 알림 동의자 전원에게 발송됩니다. 진행할까요?\n(대상자 수는 발송 완료 후 통계로 표시됩니다)',
          )
        ) {
          setBusy(false);
          return;
        }
        const linkResolved = autoLinkSelf ? '__SELF__' : (linkUrl.trim() || null);
        const newId = await createCampaign({
          title: title.trim(),
          body: finalBody,
          imageUrl: imageUrl ?? null,
          linkUrl: linkResolved === '__SELF__' ? null : linkResolved,
          isAdvertisement,
          scheduledAt: null, // draft 생성
          sentBy: me.uid,
          sentByName: me.name,
        });
        if (linkResolved === '__SELF__') {
          await updateCampaign(newId, { linkUrl: `/m/campaigns/${newId}` });
        }
        await sendCampaignNow(newId);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          color: 'var(--text-1)',
        }}
      >
        {/* 헤더 */}
        <div
          className="px-6 py-4 flex items-center gap-2"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="font-extrabold flex-1">
            {isNew ? '📣 새 캠페인' : isReadOnly ? '📣 캠페인 상세' : '📣 캠페인 수정'}
            {!isNew && campaign && (
              <span
                className="ml-2 text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded align-middle"
                style={{
                  background: STATUS_STYLES[campaign.status].bg,
                  color: STATUS_STYLES[campaign.status].fg,
                  border: `1px solid ${STATUS_STYLES[campaign.status].border}`,
                }}
              >
                {STATUS_STYLES[campaign.status].icon} {campaignStatusLabel(campaign.status)}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-xs font-bold"
            style={{ color: 'var(--text-3)' }}
          >
            닫기
          </button>
        </div>

        {/* 본문 (스크롤) */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isReadOnly && (
            <div
              className="rounded-lg p-3 text-xs"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-2)',
              }}
            >
              이 캠페인은 <b>{campaignStatusLabel(campaign!.status)}</b> 상태이므로 수정할 수 없습니다. 내용 확인만 가능합니다.
            </div>
          )}

          {/* 제목 */}
          <FieldLabel required>제목</FieldLabel>
          <div className="relative">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isReadOnly}
              maxLength={TITLE_MAX + 20}
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
              placeholder="예: 5월 GTD 천만원 토너 OPEN"
            />
            <div
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold"
              style={{ color: title.length > TITLE_MAX ? '#F87171' : 'var(--text-3)' }}
            >
              {title.length}/{TITLE_MAX}
            </div>
          </div>

          {/* 본문 */}
          <FieldLabel required>본문</FieldLabel>
          <div className="relative">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={isReadOnly}
              maxLength={BODY_MAX + 20}
              rows={4}
              className="w-full px-3 py-2.5 rounded-lg text-sm resize-none"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
              placeholder="알림에 표시될 본문. 200자 이내."
            />
            <div
              className="absolute right-3 bottom-2 text-[10px] font-bold"
              style={{ color: body.length > BODY_MAX ? '#F87171' : 'var(--text-3)' }}
            >
              {body.length}/{BODY_MAX}
            </div>
          </div>

          {/* 광고 표기 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isAdvertisement}
              onChange={(e) => setIsAdvertisement(e.target.checked)}
              disabled={isReadOnly}
              className="w-4 h-4"
            />
            <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
              광고 표기 (체크 시 본문 앞에 &quot;(광고)&quot; 자동 추가)
            </span>
          </label>
          {isAdvertisement && (
            <div
              className="text-[11px] rounded p-2.5"
              style={{
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.3)',
                color: 'var(--gold)',
              }}
            >
              미리보기: <b>(광고)</b> {body.trim() || '본문…'}
            </div>
          )}

          {/* 이미지 */}
          <FieldLabel>이미지 첨부 (선택, 최대 5MB)</FieldLabel>
          {imageUrl && (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt=""
                style={{
                  maxWidth: 180,
                  maxHeight: 120,
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  objectFit: 'cover',
                }}
              />
              {!isReadOnly && (
                <button
                  onClick={() => setImageUrl(null)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full text-xs font-bold"
                  style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}
                >
                  ×
                </button>
              )}
            </div>
          )}
          {!isReadOnly && (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              disabled={uploadingImage}
              className="block w-full text-xs file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:bg-transparent file:font-bold file:cursor-pointer disabled:opacity-40"
              style={{ color: 'var(--text-3)' }}
            />
          )}
          {uploadingImage && (
            <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              업로드 중…
            </div>
          )}

          {/* 링크 URL */}
          <FieldLabel>클릭 시 이동 URL (선택)</FieldLabel>
          <input
            value={autoLinkSelf ? '/m/campaigns/{이 캠페인 ID로 자동 설정}' : linkUrl}
            onChange={(e) => {
              setAutoLinkSelf(false);
              setLinkUrl(e.target.value);
            }}
            disabled={isReadOnly || autoLinkSelf}
            className="w-full px-3 py-2.5 rounded-lg text-sm"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
            placeholder="비워두면 홈으로 이동. https://... 또는 /m/..."
          />
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: '홈', value: '/m' },
              { label: '매장 찾기', value: '/m/find' },
              { label: '이벤트', value: '/m/events' },
            ].map((c) => (
              <button
                key={c.value}
                type="button"
                disabled={isReadOnly}
                onClick={() => {
                  setAutoLinkSelf(false);
                  setLinkUrl(c.value);
                }}
                className="text-[11px] font-bold px-2.5 py-1 rounded-md"
                style={{
                  background: linkUrl === c.value && !autoLinkSelf ? 'var(--gold)' : 'var(--surface-2)',
                  color: linkUrl === c.value && !autoLinkSelf ? '#0F1419' : 'var(--text-2)',
                  border: '1px solid var(--border)',
                }}
              >
                {c.label}
              </button>
            ))}
            <button
              type="button"
              disabled={isReadOnly}
              onClick={() => {
                setAutoLinkSelf(true);
                setLinkUrl('');
              }}
              className="text-[11px] font-bold px-2.5 py-1 rounded-md"
              style={{
                background: autoLinkSelf ? 'var(--gold)' : 'var(--surface-2)',
                color: autoLinkSelf ? '#0F1419' : 'var(--text-2)',
                border: '1px solid var(--border)',
              }}
            >
              /m/campaigns/{`{자동 ID}`}
            </button>
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            비워두면 홈으로 이동. 자동 ID 선택 시 캠페인 생성 후 자기 자신 ID로 인앱 페이지 자동 설정.
          </div>

          {/* 발송 방식 */}
          <FieldLabel required>발송 방식</FieldLabel>
          <div className="flex gap-2">
            <RadioCard
              checked={sendMode === 'now'}
              disabled={isReadOnly || !isNew}
              onClick={() => setSendMode('now')}
              title="⚡ 즉시 발송"
              desc="저장과 동시에 발송"
            />
            <RadioCard
              checked={sendMode === 'scheduled'}
              disabled={isReadOnly}
              onClick={() => setSendMode('scheduled')}
              title="⏰ 예약 발송"
              desc="지정한 시각에 자동 발송"
            />
          </div>

          {sendMode === 'scheduled' && (
            <>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={isReadOnly}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)',
                }}
              />
              {scheduleError && (
                <div
                  className="text-[11px] rounded p-2"
                  style={{
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    color: '#F87171',
                  }}
                >
                  {scheduleError}
                </div>
              )}
              {nightWarning && (
                <div
                  className="text-[11px] rounded p-2.5 leading-relaxed"
                  style={{
                    background: 'rgba(234,179,8,0.1)',
                    border: '1px solid rgba(234,179,8,0.4)',
                    color: '#FACC15',
                  }}
                >
                  ⚠️ 야간 시간대(21~08시) 발송 예약입니다. 광고성 알림은 별도 사전 동의가 필요할 수 있습니다.
                </div>
              )}
            </>
          )}

          {/* 테스트 발송 */}
          {!isReadOnly && (
            <div
              className="rounded-lg p-3"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>
                    🧪 테스트 발송
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    본인 기기에만 실제 알림 발송. 캠페인 문서는 만들어지지 않음.
                  </div>
                </div>
                <button
                  onClick={handleTest}
                  disabled={busy || uploadingImage}
                  className="text-[11px] font-bold px-3 py-2 rounded-md whitespace-nowrap disabled:opacity-40"
                  style={{
                    background: 'var(--surface-1)',
                    color: 'var(--text-1)',
                    border: '1px solid var(--border)',
                  }}
                >
                  나에게 테스트
                </button>
              </div>
              {testStatus && (
                <div className="mt-2 text-[11px] font-bold" style={{ color: 'var(--gold)' }}>
                  {testStatus}
                </div>
              )}
            </div>
          )}

          {/* 통계 영역 (sent 상태 상세 보기) */}
          {campaign?.status === 'sent' && (
            <div
              className="rounded-lg p-3.5"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <div className="text-xs font-bold mb-2" style={{ color: 'var(--text-1)' }}>
                📊 발송 통계
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <Stat label="대상" value={fmtNum(campaign.recipientCount)} />
                <Stat label="도달" value={fmtNum(campaign.deliveredCount)} />
                <Stat label="실패" value={fmtNum(campaign.failureCount)} />
                <Stat label="클릭" value={fmtNum(campaign.clickCount)} />
              </div>
              {campaign.sentAt && (
                <div className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
                  발송 시각: {fmtTs(campaign.sentAt)}
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              className="rounded-lg p-2.5 text-xs"
              style={{
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.35)',
                color: '#F87171',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div
          className="px-6 py-4 flex gap-2"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg font-bold text-sm disabled:opacity-40"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          >
            {isReadOnly ? '닫기' : '취소'}
          </button>
          {!isReadOnly && (
            <button
              onClick={handleSave}
              disabled={busy || uploadingImage}
              className="flex-1 py-2.5 rounded-lg font-bold text-sm disabled:opacity-40"
              style={{ background: 'var(--gold)', color: '#0F1419' }}
            >
              {busy
                ? '처리 중…'
                : isNew
                  ? sendMode === 'now'
                    ? '저장 후 즉시 발송'
                    : '예약 저장'
                  : '수정 저장'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-xs font-bold" style={{ color: 'var(--text-2)' }}>
      {children}
      {required && <span style={{ color: '#F87171', marginLeft: 4 }}>*</span>}
    </label>
  );
}

function RadioCard({
  checked,
  disabled,
  onClick,
  title,
  desc,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex-1 text-left rounded-lg p-3 transition disabled:opacity-40"
      style={{
        background: checked ? 'rgba(245,158,11,0.1)' : 'var(--surface-2)',
        border: checked ? '1px solid var(--gold)' : '1px solid var(--border)',
        color: 'var(--text-1)',
      }}
    >
      <div className="text-sm font-extrabold mb-0.5">{title}</div>
      <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
        {desc}
      </div>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold mb-0.5" style={{ color: 'var(--text-3)' }}>
        {label}
      </div>
      <div className="text-sm font-extrabold" style={{ color: 'var(--text-1)' }}>
        {value}
      </div>
    </div>
  );
}
