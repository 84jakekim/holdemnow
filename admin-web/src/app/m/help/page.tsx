'use client';

/**
 * /m/help — 도움말 + 1:1 문의 (2026-05-27 신설)
 *
 * 섹션:
 *  1. FAQ (정적, 카테고리별 접기/펴기)
 *  2. 1:1 문의 작성 폼
 *  3. 본인 문의 내역 (답변 확인)
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks';
import {
  type Inquiry,
  type InquiryCategory,
  FAQ_LIST,
  INQUIRY_CATEGORY_LABEL,
  createInquiry,
  subscribeMyInquiries,
} from '@/lib/inquiries';
import { formatRelativeKo } from '@/lib/relativeTime';
import NotificationBellButton from '@/components/mobile/NotificationBellButton';

type Tab = 'faq' | 'ask' | 'my';

export default function HelpPage() {
  const router = useRouter();
  const authState = useAuth();
  const [tab, setTab] = useState<Tab>('faq');

  return (
    <div className="relative min-h-screen flex flex-col" style={{ background: 'var(--surface-2)' }}>
      {/* 헤더 */}
      <header
        className="sticky top-0 z-30 flex items-center gap-2 px-3"
        style={{ height: 52, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          className="tap"
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-1)', cursor: 'pointer' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 900, color: 'var(--text-1)' }}>도움말·문의</div>
        <NotificationBellButton ariaLabel="알림" />
      </header>

      {/* 탭 */}
      <nav
        className="sticky z-20 flex"
        style={{ top: 52, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
        role="tablist"
      >
        {([
          { id: 'faq' as const, label: 'FAQ', desc: '자주 묻는 질문' },
          { id: 'ask' as const, label: '문의 작성', desc: '1:1 문의 보내기' },
          { id: 'my' as const, label: '내 문의', desc: '답변 확인' },
        ]).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className="tap"
              style={{ flex: 1, padding: '12px 0 10px', background: 'transparent', border: 'none', cursor: 'pointer', position: 'relative', color: active ? 'var(--text-1)' : 'var(--text-3)' }}
            >
              <div style={{ fontSize: 13, fontWeight: active ? 900 : 700, letterSpacing: '-0.01em' }}>{t.label}</div>
              <div style={{ fontSize: 9, color: active ? 'var(--brand)' : 'var(--text-3)', marginTop: 2, fontWeight: 600 }}>{t.desc}</div>
              {active && (
                <span aria-hidden style={{ position: 'absolute', bottom: -1, left: '50%', transform: 'translateX(-50%)', width: '46%', height: 3, borderRadius: 99, background: 'var(--brand)', boxShadow: '0 2px 8px rgba(255,31,143,0.4)' }} />
              )}
            </button>
          );
        })}
      </nav>

      <div className="no-scrollbar flex-1 overflow-y-auto pb-24 pt-3">
        {tab === 'faq' && <FaqTab />}
        {tab === 'ask' && <AskTab authState={authState} onSent={() => setTab('my')} />}
        {tab === 'my' && <MyInquiriesTab authState={authState} onGoAsk={() => setTab('ask')} />}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// FAQ 탭
// ──────────────────────────────────────────────────────
function FaqTab() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [category, setCategory] = useState<InquiryCategory | 'all'>('all');

  const filtered = useMemo(() => {
    if (category === 'all') return FAQ_LIST;
    return FAQ_LIST.filter((f) => f.category === category);
  }, [category]);

  const cats: { key: InquiryCategory | 'all'; label: string }[] = [
    { key: 'all', label: '전체' },
    { key: 'account', label: '계정·로그인' },
    { key: 'reservation', label: '예약' },
    { key: 'live', label: 'LIVE/토너' },
    { key: 'community', label: '커뮤니티' },
    { key: 'bug', label: '오류' },
    { key: 'feature', label: '기능 제안' },
  ];

  return (
    <div>
      <div className="no-scrollbar" style={{ display: 'flex', gap: 6, padding: '4px 16px 12px', overflowX: 'auto', background: 'var(--bg)' }}>
        {cats.map((c) => {
          const active = category === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className="tap"
              style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700, border: active ? 'none' : '1px solid var(--border)', background: active ? 'var(--brand)' : 'var(--bg)', color: active ? '#fff' : 'var(--text-1)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="px-4 space-y-2">
        {filtered.map((f) => {
          const open = openId === f.id;
          return (
            <div
              key={f.id}
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => setOpenId(open ? null : f.id)}
                className="w-full tap"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '14px 14px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: 'var(--brand)',
                    flexShrink: 0,
                    minWidth: 16,
                  }}
                >
                  Q
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--text-1)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {f.question}
                </span>
                <span style={{ color: 'var(--text-3)', fontSize: 14 }}>{open ? '▴' : '▾'}</span>
              </button>
              {open && (
                <div
                  className="px-4 pb-3"
                  style={{
                    fontSize: 12.5,
                    color: 'var(--text-2)',
                    lineHeight: 1.7,
                    borderTop: '1px solid var(--border)',
                    paddingTop: 10,
                    whiteSpace: 'pre-line',
                  }}
                >
                  <span style={{ fontWeight: 800, color: 'var(--brand)', marginRight: 6 }}>A</span>
                  {f.answer}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 mt-6 text-center" style={{ fontSize: 11, color: 'var(--text-3)' }}>
        답을 못 찾으셨나요?{' '}
        <Link href="#" style={{ color: 'var(--brand)', fontWeight: 800 }}>
          위 "문의 작성" 탭으로
        </Link>{' '}
        보내주세요.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 1:1 문의 작성 탭
// ──────────────────────────────────────────────────────
function AskTab({
  authState,
  onSent,
}: {
  authState: ReturnType<typeof useAuth>;
  onSent: () => void;
}) {
  const [category, setCategory] = useState<InquiryCategory>('etc');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  if (authState.status !== 'authenticated') {
    return (
      <div className="px-4 py-10 text-center">
        <div style={{ fontSize: 36, marginBottom: 12 }} aria-hidden>🔐</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-1)', marginBottom: 6 }}>
          로그인이 필요합니다
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 16 }}>
          본사가 답변드리려면 계정이 필요해요.
        </div>
        <Link href="/login" className="tap" style={{ display: 'inline-block', padding: '10px 20px', borderRadius: 10, background: 'var(--brand)', color: '#fff', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}>
          로그인하러 가기
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setErr('제목과 본문을 모두 입력해주세요.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createInquiry({
        uid: authState.user.uid,
        userEmail: authState.user.email ?? '',
        userDisplayName: authState.user.displayName ?? '',
        category,
        title: title.trim(),
        body: body.trim(),
      });
      setOkMsg('문의가 접수되었습니다. 본사 확인 후 답변드릴게요.');
      setTitle('');
      setBody('');
      setTimeout(() => onSent(), 1000);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="px-4 space-y-3">
      {/* 카테고리 */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-2)' }}>카테고리</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as InquiryCategory)}
          className="w-full mt-1.5"
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            border: '1.5px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text-1)',
            fontSize: 13,
            fontWeight: 600,
            outline: 'none',
          }}
        >
          {(Object.keys(INQUIRY_CATEGORY_LABEL) as InquiryCategory[]).map((k) => (
            <option key={k} value={k}>
              {INQUIRY_CATEGORY_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {/* 제목 */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-2)' }}>제목 (필수, 80자 이내)</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 80))}
          placeholder="짧고 명확하게 요약해주세요"
          className="w-full mt-1.5"
          style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text-1)', fontSize: 13, fontWeight: 600, outline: 'none' }}
        />
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, textAlign: 'right' }}>{title.length}/80</div>
      </div>

      {/* 본문 */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-2)' }}>본문 (필수, 2000자 이내)</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 2000))}
          placeholder={`어떤 페이지에서 어떤 동작을 하셨고, 어떤 결과가 나왔는지 적어주시면 빠르게 도움드릴 수 있습니다.

예) 매장 상세 페이지에서 "예약" 버튼을 눌렀는데 화면이 안 넘어가요. 갤럭시 S23 / 크롬 사용중.`}
          rows={8}
          className="w-full mt-1.5"
          style={{ padding: '12px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text-1)', fontSize: 13, fontWeight: 500, lineHeight: 1.6, outline: 'none', resize: 'vertical' }}
        />
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, textAlign: 'right' }}>{body.length}/2000</div>
      </div>

      {/* 안내 */}
      <div
        style={{
          padding: '10px 12px',
          borderRadius: 10,
          background: 'rgba(255,31,143,0.06)',
          border: '1px solid rgba(255,31,143,0.20)',
          fontSize: 11,
          color: 'var(--text-2)',
          lineHeight: 1.6,
        }}
      >
        <b style={{ color: 'var(--text-1)' }}>📌 답변 안내</b>
        <br />
        평균 1~2영업일 내 답변드립니다. 답변이 등록되면 알림으로 알려드려요. "내 문의" 탭에서 진행 상태를 확인할 수 있습니다.
      </div>

      {err && (
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#DC2626', fontSize: 12, fontWeight: 700 }}>
          {err}
        </div>
      )}

      {okMsg && (
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.30)', color: '#047857', fontSize: 12, fontWeight: 700 }}>
          ✓ {okMsg}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !title.trim() || !body.trim()}
        className="tap w-full"
        style={{
          padding: '13px 0',
          borderRadius: 12,
          background: submitting || !title.trim() || !body.trim() ? 'var(--surface-3)' : 'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 900,
          border: 'none',
          cursor: submitting ? 'not-allowed' : 'pointer',
          boxShadow: 'var(--shadow-brand)',
        }}
      >
        {submitting ? '보내는 중...' : '📩 문의 보내기'}
      </button>
    </form>
  );
}

// ──────────────────────────────────────────────────────
// 내 문의 탭
// ──────────────────────────────────────────────────────
function MyInquiriesTab({
  authState,
  onGoAsk,
}: {
  authState: ReturnType<typeof useAuth>;
  onGoAsk: () => void;
}) {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (authState.status !== 'authenticated') {
      setLoaded(true);
      return;
    }
    return subscribeMyInquiries(
      authState.user.uid,
      (next) => { setItems(next); setLoaded(true); },
      () => setLoaded(true),
    );
  }, [authState]);

  if (authState.status !== 'authenticated') {
    return (
      <div className="px-4 py-10 text-center" style={{ color: 'var(--text-2)' }}>
        로그인 후 본인 문의 내역을 확인할 수 있습니다.
      </div>
    );
  }

  if (!loaded) {
    return <div className="px-4 py-10 text-center" style={{ color: 'var(--text-3)', fontSize: 12 }}>불러오는 중…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <div style={{ fontSize: 36, marginBottom: 12 }} aria-hidden>📭</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-1)', marginBottom: 6 }}>
          보낸 문의가 없어요
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 16 }}>
          궁금한 점이나 개선 의견이 있으면 보내주세요.
        </div>
        <button
          onClick={onGoAsk}
          className="tap"
          style={{ padding: '10px 20px', borderRadius: 10, background: 'var(--brand)', color: '#fff', fontSize: 12, fontWeight: 800, border: 'none', cursor: 'pointer' }}
        >
          문의 작성하기
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 space-y-2">
      {items.map((it) => (
        <InquiryCard key={it.id} item={it} />
      ))}
    </div>
  );
}

function InquiryCard({ item }: { item: Inquiry }) {
  const [open, setOpen] = useState(false);
  const statusInfo = {
    pending: { label: '답변 대기', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
    answered: { label: '✓ 답변 완료', color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
    closed: { label: '종료', color: 'var(--text-3)', bg: 'var(--surface-2)' },
  }[item.status];

  const created = item.createdAt?.toDate ? item.createdAt.toDate() : new Date();

  return (
    <div
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full tap"
        style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div className="flex items-center justify-between gap-2">
          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: statusInfo.bg, color: statusInfo.color }}>
            {statusInfo.label}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-3)' }} className="mono">
            {formatRelativeKo(created.getTime())}
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
          {item.title}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
          {INQUIRY_CATEGORY_LABEL[item.category]}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', marginBottom: 4 }}>내 문의</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.65, whiteSpace: 'pre-line' }}>
            {item.body}
          </div>

          {item.adminReply ? (
            <div className="mt-4 p-3" style={{ background: 'rgba(255,31,143,0.06)', border: '1px solid rgba(255,31,143,0.20)', borderRadius: 10 }}>
              <div className="flex items-center gap-1.5 mb-1">
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--brand)' }}>📣 본사 답변</span>
                {item.adminReply.repliedAt?.toDate && (
                  <span className="mono" style={{ fontSize: 9, color: 'var(--text-3)' }}>
                    {formatRelativeKo(item.adminReply.repliedAt.toDate().getTime())}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                {item.adminReply.body}
              </div>
            </div>
          ) : (
            <div className="mt-3 text-center text-[11px]" style={{ color: 'var(--text-3)' }}>
              본사 답변 대기 중 · 평균 1~2영업일
            </div>
          )}
        </div>
      )}
    </div>
  );
}
