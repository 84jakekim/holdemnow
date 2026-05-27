'use client';

/**
 * /platform/inquiries — 본사 어드민 사용자 1:1 문의 관리 (2026-05-27 신설)
 * - 받은 문의 리스트 (필터: 미답변/답변완료/전체)
 * - 답변 작성 + 상태 전환
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth, useUserDoc, hasRole } from '@/lib/hooks';
import {
  type Inquiry,
  type InquiryStatus,
  INQUIRY_CATEGORY_LABEL,
  subscribeAllInquiries,
  replyToInquiry,
  setInquiryStatus,
} from '@/lib/inquiries';
import { formatRelativeKo } from '@/lib/relativeTime';

export default function PlatformInquiriesPage() {
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  const isAdmin = hasRole(userDoc, 'platform_admin');

  const [items, setItems] = useState<Inquiry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<InquiryStatus | 'all'>('pending');

  useEffect(() => {
    if (!isAdmin) return;
    return subscribeAllInquiries(
      (next) => { setItems(next); setLoaded(true); },
      () => setLoaded(true),
      filter === 'all' ? undefined : { status: filter },
    );
  }, [isAdmin, filter]);

  const counts = useMemo(() => {
    return {
      pending: items.filter((i) => i.status === 'pending').length,
      answered: items.filter((i) => i.status === 'answered').length,
      closed: items.filter((i) => i.status === 'closed').length,
    };
  }, [items]);

  if (!authState || authState.status !== 'authenticated') {
    return <main className="p-8 text-center text-sm text-gray-500">로딩 중…</main>;
  }
  if (!isAdmin) {
    return <main className="p-8 text-center text-sm text-red-600 font-bold">본사 관리자 전용 페이지입니다.</main>;
  }

  return (
    <div>
      <div className="mb-6">
        <div className="section-title" style={{ color: 'var(--gold)' }}>USER INQUIRIES</div>
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>📩 사용자 문의 관리</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
          미답변 {counts.pending}건 / 답변완료 {counts.answered}건 / 종료 {counts.closed}건
        </p>
      </div>

      {/* 필터 */}
      <div className="flex gap-2 mb-4">
        {([
          { key: 'pending' as const, label: `미답변 (${counts.pending})` },
          { key: 'answered' as const, label: `답변완료 (${counts.answered})` },
          { key: 'closed' as const, label: '종료' },
          { key: 'all' as const, label: '전체' },
        ]).map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="tap"
              style={{
                padding: '6px 14px',
                borderRadius: 99,
                fontSize: 12,
                fontWeight: 700,
                border: active ? 'none' : '1px solid var(--border)',
                background: active ? 'var(--gold)' : 'var(--bg)',
                color: active ? '#fff' : 'var(--text-2)',
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {!loaded ? (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--text-3)' }}>불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--text-3)' }}>
          <div className="text-4xl mb-3">📭</div>
          <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)' }}>
            {filter === 'pending' ? '미답변 문의가 없습니다' : '문의가 없습니다'}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <AdminInquiryCard key={it.id} item={it} adminUid={authState.user.uid} adminName={authState.user.displayName ?? '본사 관리자'} />
          ))}
        </div>
      )}
    </div>
  );
}

function AdminInquiryCard({
  item,
  adminUid,
  adminName,
}: {
  item: Inquiry;
  adminUid: string;
  adminName: string;
}) {
  const [expanded, setExpanded] = useState(item.status === 'pending');
  const [replyText, setReplyText] = useState(item.adminReply?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const created = item.createdAt?.toDate ? item.createdAt.toDate() : new Date();

  const statusInfo = {
    pending: { label: '미답변', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
    answered: { label: '답변완료', color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
    closed: { label: '종료', color: 'var(--text-3)', bg: 'var(--surface-2)' },
  }[item.status];

  const handleReply = async () => {
    if (!replyText.trim()) {
      setErr('답변 내용을 입력해주세요.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await replyToInquiry(item.id, {
        body: replyText.trim(),
        repliedBy: adminUid,
        repliedByName: adminName,
      });
      setSavedAt(Date.now());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async () => {
    if (!window.confirm('이 문의를 종료할까요?')) return;
    try {
      await setInquiryStatus(item.id, 'closed');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        overflow: 'hidden',
      }}
    >
      {/* 헤더 (clickable) */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full tap"
        style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: statusInfo.bg, color: statusInfo.color }}>
              {statusInfo.label}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--surface-2)', color: 'var(--text-2)' }}>
              {INQUIRY_CATEGORY_LABEL[item.category]}
            </span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {formatRelativeKo(created.getTime())}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-1)' }}>
            {item.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
            {item.userDisplayName || '(이름 없음)'} · {item.userEmail || '(이메일 없음)'}
          </div>
        </div>
        <span style={{ color: 'var(--text-3)' }}>{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {/* 사용자 본문 */}
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', marginBottom: 4 }}>사용자 문의</div>
          <div className="p-3 mb-4" style={{ background: 'var(--surface-2)', borderRadius: 8, fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.65, whiteSpace: 'pre-line' }}>
            {item.body}
          </div>

          {/* 본사 답변 */}
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--brand)', marginBottom: 4 }}>본사 답변</div>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value.slice(0, 4000))}
            placeholder="답변 내용을 작성하세요... (4000자 이내)"
            rows={6}
            className="w-full mb-2"
            style={{ padding: 12, borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text-1)', fontSize: 13, fontWeight: 500, lineHeight: 1.6, outline: 'none', resize: 'vertical' }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 8, textAlign: 'right' }}>{replyText.length}/4000</div>

          {err && (
            <div className="mb-2" style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#DC2626', fontSize: 11, fontWeight: 700 }}>
              {err}
            </div>
          )}

          <div className="flex items-center gap-2">
            {savedAt && Date.now() - savedAt < 3000 && (
              <span className="text-xs font-bold" style={{ color: '#047857' }}>✓ 저장됨</span>
            )}
            <button
              onClick={handleReply}
              disabled={saving || !replyText.trim()}
              className="tap"
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                background: saving || !replyText.trim() ? 'var(--surface-3)' : 'var(--brand)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 800,
                border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? '저장 중...' : item.adminReply ? '답변 수정' : '답변 등록'}
            </button>
            {item.status !== 'closed' && (
              <button
                onClick={handleClose}
                className="tap"
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                  fontSize: 11,
                  fontWeight: 700,
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                종료
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
