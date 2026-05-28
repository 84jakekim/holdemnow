'use client';

/**
 * /m/community — 커뮤니티 인덱스 v0.4 (2026-05-27 사용자 명령)
 *
 * 정책 (사용자 결정):
 *  - 구인: 매장 어드민에서 마감 등록 전까지 전체 리스트에 즉시 노출. 모든 사용자 열람 OK.
 *  - 구직: 개인 이력서. 사용자 앱에서 리스트 노출 X.
 *          이력서 작성법 + 사용 안내만 표시. 등록은 본인 페이지로 이동.
 *          매장 어드민(v0.x 유료 한정) / 본사 어드민에서만 열람 가능.
 *  - 중고거래: 제거 (시드권/현금 거래 위험).
 *  - 핸드분석: 신규 게시판 (v0.5 오픈, 실 목록 노출).
 *
 * 핸드오프 참조: claude-design/community-handoff/pimk-rabbit/ screens-community.jsx
 *  - 탭바, 검색 input, 필터 chips, FAB 글쓰기 톤 100% 매칭
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth, useUserDoc } from '@/lib/hooks';
import {
  type JobOffer,
  type JobRole,
  JOB_ROLE_LABELS,
  formatWage,
  formatRelativeTime,
  subscribeActiveJobs,
} from '@/lib/community';
import NotificationBellButton from '@/components/mobile/NotificationBellButton';

type TabId = 'hiring' | 'seeking' | 'hand';

const TABS: { id: TabId; label: string; icon: string; desc: string; searchPlaceholder: string }[] = [
  { id: 'hiring', label: '구인', icon: '🙋‍♂️', desc: '딜러 · 매니저 모집', searchPlaceholder: '매장명·지역·포지션' },
  { id: 'seeking', label: '구직', icon: '💼', desc: '딜러 이력서', searchPlaceholder: '경력·지역으로 검색' },
  { id: 'hand', label: '핸드분석', icon: '🃏', desc: '플레이 복기·전략', searchPlaceholder: '핸드·블라인드·포지션' },
];

const HIRING_FILTERS: { key: 'all' | JobRole; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'dealer', label: '딜러' },
  { key: 'manager', label: '매니저' },
  { key: 'floor', label: '플로어' },
  { key: 'parttime', label: '파트' },
];

export default function CommunityIndexPage() {
  const router = useRouter();
  const authState = useAuth();
  const userDoc = useUserDoc(authState.status === 'authenticated' ? authState.user.uid : null);
  const [tab, setTab] = useState<TabId>('hiring');
  const [q, setQ] = useState('');
  const [hiringFilter, setHiringFilter] = useState<typeof HIRING_FILTERS[number]['key']>('all');
  const [jobs, setJobs] = useState<JobOffer[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [favoriteJobIds, setFavoriteJobIds] = useState<Set<string>>(new Set());

  // 매장 owner 여부 (구인 FAB 가드)
  const isStoreOwner = !!userDoc?.storeId;

  // 구인 탭 — Firestore 구독
  useEffect(() => {
    if (tab !== 'hiring') return;
    const unsub = subscribeActiveJobs(
      (items) => { setJobs(items); setJobsLoaded(true); },
      () => setJobsLoaded(true),
    );
    return unsub;
  }, [tab]);

  // 본인 즐겨찾기 잡 ID 집합 구독 (구인 탭에서만 활성)
  useEffect(() => {
    if (tab !== 'hiring') return;
    if (authState.status !== 'authenticated') {
      setFavoriteJobIds(new Set());
      return;
    }
    const ref = collection(db, 'users', authState.user.uid, 'favoriteJobs');
    const unsub = onSnapshot(ref, (snap) => {
      setFavoriteJobIds(new Set(snap.docs.map((d) => d.id)));
    }, () => {});
    return unsub;
  }, [tab, authState]);

  const handleToggleJobFavorite = async (job: JobOffer) => {
    if (authState.status !== 'authenticated') {
      router.push('/login');
      return;
    }
    const ref = doc(db, 'users', authState.user.uid, 'favoriteJobs', job.id);
    if (favoriteJobIds.has(job.id)) {
      await deleteDoc(ref).catch(() => {});
    } else {
      await setDoc(ref, {
        jobId: job.id,
        title: job.title,
        storeName: job.storeName ?? '',
        storeId: job.storeId ?? '',
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
  };

  const activeTab = TABS.find((t) => t.id === tab)!;
  const composeHref = tab === 'hiring' ? '/m/community/jobs/new'
    : tab === 'seeking' ? '/m/community/dealers/me'
    : '/m/community/hands/write'; // 핸드분석 작성 v0.5

  // FAB 노출 조건: 구인 탭은 매장 owner만, 구직 탭은 모든 사용자, 핸드분석은 로그인 사용자
  const showFab = tab === 'seeking'
    || (tab === 'hiring' && isStoreOwner)
    || (tab === 'hand' && authState.status === 'authenticated');

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (j.status !== 'active') return false;
      if (hiringFilter !== 'all' && j.role !== hiringFilter) return false;
      if (q) {
        const hay = `${j.title} ${j.storeName ?? ''} ${j.region ?? ''}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [jobs, hiringFilter, q]);

  return (
    <div className="relative min-h-screen flex flex-col" style={{ background: 'var(--surface-2)' }}>
      {/* ── 헤더 ───────────────────────────────────── */}
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 900, letterSpacing: '-0.015em', color: 'var(--text-1)' }}>커뮤니티</div>
        <Link
          href="/m/search"
          aria-label="검색"
          className="tap"
          style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-1)', textDecoration: 'none' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </Link>
        <NotificationBellButton ariaLabel="알림" />
      </header>

      {/* ── 탭 ─────────────────────────────────────── */}
      <nav
        role="tablist"
        className="sticky z-20 flex"
        style={{ top: 52, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        {TABS.map((t) => {
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
              <div style={{ fontSize: 18, marginBottom: 2 }} aria-hidden="true">{t.icon}</div>
              <div style={{ fontSize: 12, fontWeight: active ? 900 : 700, letterSpacing: '-0.01em' }}>{t.label}</div>
              <div style={{ fontSize: 9, color: active ? 'var(--brand)' : 'var(--text-3)', marginTop: 1, fontWeight: 600 }}>{t.desc}</div>
              {active && (
                <span aria-hidden="true" style={{ position: 'absolute', bottom: -1, left: '50%', transform: 'translateX(-50%)', width: '46%', height: 3, borderRadius: 99, background: 'var(--brand)', boxShadow: '0 2px 8px rgba(255,31,143,0.4)' }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* ── 검색 (구인/핸드분석만) ───────────────────── */}
      {tab !== 'seeking' && (
        <div className="px-3.5 pt-2.5 pb-1" style={{ background: 'var(--bg)' }}>
          <div className="flex items-center gap-2 px-2.5" style={{ background: 'var(--surface-2)', borderRadius: 10, height: 36 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={activeTab.searchPlaceholder}
              style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 13, color: 'var(--text-1)', fontFamily: 'inherit', minWidth: 0 }}
            />
            {q && (
              <button onClick={() => setQ('')} aria-label="검색어 지우기" className="tap" style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', cursor: 'pointer', fontSize: 14 }}>✕</button>
            )}
          </div>
        </div>
      )}

      {/* ── 컨텐츠 ───────────────────────────────────── */}
      <div className="no-scrollbar flex-1 overflow-y-auto pb-24">
        {tab === 'hiring' && (
          <HiringTab
            jobs={filteredJobs}
            loaded={jobsLoaded}
            filter={hiringFilter}
            onFilterChange={setHiringFilter}
            totalActive={jobs.filter((j) => j.status === 'active').length}
            favoriteIds={favoriteJobIds}
            onToggleFavorite={handleToggleJobFavorite}
          />
        )}
        {tab === 'seeking' && <SeekingTab />}
        {tab === 'hand' && <HandTab />}
      </div>

      {/* ── FAB ───────────────────────────────────────
         - 구인: 매장 owner만 (사용자 명령 v0.4)
         - 구직: 본인 이력서 (모든 사용자)
         - 핸드분석: 로그인 사용자 글 작성 가능 (v0.5 활성) */}
      {showFab && (
        <Link
          href={composeHref}
          aria-label={`${activeTab.label} 등록`}
          className="tap"
          style={{
            position: 'fixed', right: 18, bottom: 86, zIndex: 25,
            width: 54, height: 54, borderRadius: 99,
            background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
            boxShadow: '0 8px 22px rgba(255,31,143,0.42)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', textDecoration: 'none',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 구인 탭 — 핸드오프 HiringList 카드 톤 + 실 데이터
// ──────────────────────────────────────────────────────
function HiringTab({
  jobs,
  loaded,
  filter,
  onFilterChange,
  totalActive,
  favoriteIds,
  onToggleFavorite,
}: {
  jobs: JobOffer[];
  loaded: boolean;
  filter: typeof HIRING_FILTERS[number]['key'];
  onFilterChange: (k: typeof HIRING_FILTERS[number]['key']) => void;
  totalActive: number;
  favoriteIds: Set<string>;
  onToggleFavorite: (job: JobOffer) => void;
}) {
  return (
    <div>
      {/* 필터 chips */}
      <div className="no-scrollbar" style={{ display: 'flex', gap: 6, padding: '8px 14px 12px', overflowX: 'auto', background: 'var(--bg)' }}>
        {HIRING_FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className="tap"
              style={{
                flexShrink: 0, padding: '5px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                border: active ? 'none' : '1px solid var(--border)',
                background: active ? 'var(--brand)' : 'var(--bg)',
                color: active ? '#fff' : 'var(--text-1)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <section style={{ padding: '0 14px 12px' }}>
        <div className="flex items-baseline justify-between mb-2">
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '-0.015em' }}>🔥 인기 채용</div>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)' }}>· {jobs.length}건 / 전체 {totalActive}건</span>
        </div>

        {!loaded ? (
          <div className="text-center text-[11px] py-12" style={{ color: 'var(--text-3)' }}>불러오는 중…</div>
        ) : jobs.length === 0 ? (
          <div
            className="lift"
            style={{ background: 'var(--bg)', borderRadius: 14, border: '1px dashed var(--border-strong)', padding: '32px 18px', textAlign: 'center' }}
          >
            <div style={{ fontSize: 38, marginBottom: 10 }} aria-hidden="true">🙋‍♂️</div>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>현재 진행 중인 채용 공고가 없어요</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>
              매장 사장이라면 우하단 + 버튼으로 채용 공고를 등록하세요.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {jobs.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                isFavorite={favoriteIds.has(j.id)}
                onToggleFavorite={() => onToggleFavorite(j)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function JobCard({
  job,
  isFavorite,
  onToggleFavorite,
}: {
  job: JobOffer;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  const roleLabel = JOB_ROLE_LABELS[job.role] ?? job.role;
  const wageLabel = formatWage(job.wage);
  const region = job.region ?? '';
  const posted = job.createdAt ? formatRelativeTime(job.createdAt) : '';
  return (
    <Link
      href={`/m/community/jobs/${job.id}`}
      className="lift"
      style={{
        background: 'var(--bg)', borderRadius: 14,
        border: '1px solid var(--border)',
        padding: '12px 14px', cursor: 'pointer',
        position: 'relative', overflow: 'hidden',
        textDecoration: 'none', color: 'inherit',
        display: 'block',
      }}
    >
      {/* 즐겨찾기 별 (우상단) */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite();
        }}
        aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        aria-pressed={isFavorite}
        className="tap"
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 2,
          width: 32, height: 32, borderRadius: 99,
          background: isFavorite ? 'rgba(255,31,143,0.12)' : 'transparent',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg
          width="18" height="18" viewBox="0 0 24 24"
          fill={isFavorite ? '#FF1F8F' : 'none'}
          stroke={isFavorite ? '#FF1F8F' : 'var(--text-3)'}
          strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      </button>

      {/* 매장 행 */}
      <div className="flex items-center gap-2.5 mb-2.5">
        <div
          style={{
            position: 'relative',
            width: 38, height: 38, borderRadius: 11,
            background: 'linear-gradient(135deg,#fb7185,#ef4444)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, flexShrink: 0, color: '#fff',
            overflow: 'hidden',
          }}
          aria-hidden="true"
        >
          {job.storePhotoUrl ? (
            <Image src={job.storePhotoUrl} alt="" fill className="object-cover" sizes="38px" />
          ) : '🃏'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-1.5">
            <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 5, background: '#FFF0F7', color: '#FF1F8F' }}>{roleLabel}</span>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '-0.01em' }}>{job.storeName ?? '매장명 미등록'}</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>{region}</div>
        </div>
      </div>

      {/* 타이틀 */}
      <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1.35, letterSpacing: '-0.02em', marginBottom: 8 }}>{job.title}</div>

      {/* 정보 grid */}
      <div className="grid gap-1.5 mb-2.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <InfoLine emoji="💰" label={wageLabel} accent />
        <InfoLine emoji="🕐" label={(job.shift ?? []).slice(0, 2).join(', ')} />
      </div>

      {/* body (잘림) */}
      {job.body && (
        <div
          style={{
            fontSize: 11, color: 'var(--text-2)',
            lineHeight: 1.5, marginBottom: 10,
            paddingBottom: 10, borderBottom: '1px solid var(--border)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {job.body}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-3)' }} className="mono">{posted}</span>
        <span
          style={{
            padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 800,
            background: 'var(--brand)', color: '#fff',
            boxShadow: 'var(--shadow-brand)',
          }}
        >
          지원
        </span>
      </div>
    </Link>
  );
}

function InfoLine({ emoji, label, accent }: { emoji: string; label: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: 'var(--text-1)' }}>
      <span aria-hidden="true">{emoji}</span>
      <span style={{ fontWeight: accent ? 800 : 600, color: accent ? '#FF1F8F' : 'var(--text-1)' }}>{label}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 구직 탭 — 안내만 (개인 이력서 노출 X)
// ──────────────────────────────────────────────────────
function SeekingTab() {
  return (
    <div style={{ padding: '20px 14px 16px' }}>
      <div
        className="lift"
        style={{
          background: 'var(--bg)', borderRadius: 16,
          border: '1px solid rgba(255,31,143,0.18)',
          padding: '22px 18px',
          boxShadow: '0 2px 14px rgba(255,31,143,0.06)',
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 12 }} aria-hidden="true">💼</div>
        <h2 style={{ fontSize: 17, fontWeight: 900, letterSpacing: '-0.02em', marginBottom: 6 }}>
          한 번 등록하면 매장에서 먼저 연락해요
        </h2>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
          구직 이력서는 사용자 앱에 공개되지 않습니다.<br />
          매장 어드민·본사 어드민에서만 열람 가능하며, 매장이 직접 연락드립니다.
        </p>

        <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: 'var(--surface-2)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-1)', marginBottom: 8 }}>
            ✍️ 이력서에 적는 항목
          </div>
          <ul style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.7, paddingLeft: 4, listStyle: 'none' }}>
            <li>· 경력 단계 (3개월 / 1년 / 2~3년 / 5년+ 등)</li>
            <li>· 가능 분야 (토너먼트 / 캐쉬게임 / 매니저 등)</li>
            <li>· 가용 시간대 (평일/주말, 주간/야간)</li>
            <li>· 활동 지역</li>
            <li>· 본인 한 줄 소개 (선택)</li>
          </ul>
        </div>

        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 12, background: '#FFF7E6', border: '1px solid rgba(245,158,11,0.25)' }}>
          <div style={{ fontSize: 11.5, color: '#92400E', lineHeight: 1.6 }}>
            <b>🔒 개인정보 보호</b><br />
            전화번호 · 실명 등은 매장이 "연락" 요청 시에만 본사 승인 후 전달됩니다 (v0.5+).
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
          <Link
            href="/m/community/dealers/me"
            className="tap"
            style={{
              flex: 1, padding: '12px 0', borderRadius: 12,
              background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
              color: '#fff', fontSize: 13, fontWeight: 900,
              boxShadow: 'var(--shadow-brand)',
              textAlign: 'center', textDecoration: 'none',
              letterSpacing: '-0.01em',
            }}
          >
            ✍️ 내 이력서 작성 / 수정
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 12, padding: '10px 14px', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6, textAlign: 'center' }}>
        매장 어드민의 구직자 검색 기능은 v0.x 유료 플랜 한정으로 오픈됩니다.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 핸드분석 탭 — 실제 목록 (v0.5 활성)
// ──────────────────────────────────────────────────────
function HandTab() {
  return (
    <HandTabContent />
  );
}

function HandTabContent() {
  const router = useRouter();
  const [posts, setPosts] = useState<import('@/lib/handAnalysis').HandAnalysisPost[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    import('@/lib/handAnalysis').then(({ loadHandAnalysisPosts }) => {
      loadHandAnalysisPosts({ pageSize: 10 }).then(({ posts: items }) => {
        setPosts(items);
        setLoaded(true);
      });
    });
  }, []);

  if (!loaded) {
    return (
      <div style={{ padding: '20px 14px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1, 2].map((i) => (
          <div key={i} style={{ background: 'var(--bg)', borderRadius: 14, border: '1px solid var(--border)', height: 120 }} />
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">🃏</div>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>아직 핸드분석 글이 없어요</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 20 }}>
          실전 핸드를 공유하고 다른 플레이어와 함께 복기해 보세요.<br />
          우하단 + 버튼으로 첫 번째 글을 작성해 보세요.
        </div>
        <button
          onClick={() => router.push('/m/community/hands')}
          style={{ padding: '10px 20px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text-1)', cursor: 'pointer' }}
        >
          게시판 전체 보기
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ padding: '10px 14px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {posts.map((p) => (
          <button
            key={p.id}
            onClick={() => router.push(`/m/community/hands/${p.id}`)}
            className="lift tap"
            style={{
              background: 'var(--bg)', borderRadius: 14,
              border: '1px solid var(--border)',
              padding: '12px 14px', cursor: 'pointer',
              textAlign: 'left', width: '100%',
            }}
          >
            {p.position && (
              <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 5, background: '#EFF6FF', color: '#2563EB', marginBottom: 6 }}>
                {p.position.toUpperCase()}
              </span>
            )}
            <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1.35, letterSpacing: '-0.02em', marginBottom: 4, color: 'var(--text-1)' }}>
              {p.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 8 }}>
              {p.body}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--text-3)' }}>
              <span>{p.authorName}</span>
              <span style={{ marginLeft: 'auto' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ display: 'inline', marginRight: 2 }}>
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                {p.likeCount}
              </span>
              <span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ display: 'inline', marginRight: 2 }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {p.commentCount}
              </span>
            </div>
          </button>
        ))}
      </div>
      <div style={{ padding: '12px 14px' }}>
        <button
          onClick={() => router.push('/m/community/hands')}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 12,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            fontSize: 13, fontWeight: 700, color: 'var(--text-1)', cursor: 'pointer',
          }}
        >
          전체 글 보기
        </button>
      </div>
    </div>
  );
}
