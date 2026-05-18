'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type JobOffer,
  type JobRole,
  JOB_ROLE_LABELS,
  SHIFT_LABELS,
  formatWage,
  formatRelativeTime,
  subscribeActiveJobs,
} from '@/lib/community';

/* ============================================================
 * /m/community/jobs — 구인 리스트
 * 상단 필터바 (지역·직무·정렬) + 카드 리스트
 * 데이터: PLACEHOLDER_JOBS (부모 에이전트가 Firestore로 교체)
 * ========================================================== */

type SortKey = 'recent' | 'wage';
type RoleFilter = 'all' | JobRole;

const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'dealer', label: '딜러' },
  { key: 'floor', label: '플로어' },
  { key: 'manager', label: '매니저' },
  { key: 'parttime', label: '파트' },
];

export default function JobsListPage() {
  const router = useRouter();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [jobs, setJobs] = useState<JobOffer[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = subscribeActiveJobs(
      (items) => { setJobs(items); setLoaded(true); },
      () => setLoaded(true),
    );
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    let list = jobs.filter((j) => j.status === 'active');
    if (roleFilter !== 'all') list = list.filter((j) => j.role === roleFilter);
    if (sortKey === 'wage') {
      list = [...list].sort((a, b) => {
        const av = a.wage.type === 'negotiable' ? 0 : (a.wage.amount ?? 0);
        const bv = b.wage.type === 'negotiable' ? 0 : (b.wage.amount ?? 0);
        return bv - av;
      });
    } else {
      list = [...list].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }
    return list;
  }, [jobs, roleFilter, sortKey]);

  return (
    <div style={{ background: 'var(--bg-sub)', minHeight: '100vh' }}>
      {/* ── 헤더 ── */}
      <header
        className="sticky top-0 z-30 flex items-center h-14 px-4 gap-3"
        style={{
          background: 'rgba(255,255,255,0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          className="w-9 h-9 flex items-center justify-center rounded-full transition active:bg-[var(--surface-2)] flex-shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <h1 className="flex-1 text-center text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          💼 구인
        </h1>
        {/* 검색 (UI 자리만 — 기능 추후) */}
        <button
          aria-label="검색"
          className="w-9 h-9 flex items-center justify-center rounded-full transition active:bg-[var(--surface-2)] flex-shrink-0"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </button>
      </header>

      {/* ── 필터바 ── */}
      <div
        className="sticky z-20 bg-white px-4 pt-3 pb-2 flex flex-col gap-2"
        style={{ top: 56, borderBottom: '1px solid var(--border)' }}
      >
        {/* 직무 칩 */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none" role="group" aria-label="직무 필터">
          {ROLE_FILTERS.map((f) => {
            const active = roleFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setRoleFilter(f.key)}
                aria-pressed={active}
                className="flex-shrink-0 px-3 h-8 rounded-full text-[12px] font-bold transition active:scale-95"
                style={{
                  background: active ? '#FF1F8F' : 'var(--surface-2)',
                  color: active ? '#fff' : 'var(--text-2)',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* 정렬 */}
        <div className="flex items-center justify-end gap-2">
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>정렬</span>
          <button
            onClick={() => setSortKey('recent')}
            className="text-[12px] font-semibold transition"
            style={{ color: sortKey === 'recent' ? '#FF1F8F' : 'var(--text-3)' }}
          >
            최신순
          </button>
          <span style={{ color: 'var(--border)' }}>|</span>
          <button
            onClick={() => setSortKey('wage')}
            className="text-[12px] font-semibold transition"
            style={{ color: sortKey === 'wage' ? '#FF1F8F' : 'var(--text-3)' }}
          >
            시급순
          </button>
        </div>
      </div>

      {/* ── 리스트 ── */}
      <div className="pb-24">
        {!loaded ? (
          <div className="py-12 text-center text-[12px]" style={{ color: 'var(--text-3)' }}>
            불러오는 중…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyJobsState />
        ) : (
          <div className="flex flex-col gap-2 px-4 pt-3">
            {filtered.map((job) => (
              <JobListCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 구인 리스트 카드 ── */
function JobListCard({ job }: { job: JobOffer }) {
  return (
    <Link
      href={`/m/community/jobs/${job.id}`}
      className="block rounded-2xl overflow-hidden transition active:scale-[0.99]"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      }}
    >
      <div className="p-4">
        {/* 상단: 매장 사진 + 핵심 정보 */}
        <div className="flex gap-3">
          {/* 매장 로고/사진 64×64 */}
          <div
            className="flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden"
            style={{ background: 'var(--surface-2)' }}
          >
            {job.storePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={job.storePhotoUrl}
                alt={job.storeName ?? ''}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl" aria-hidden="true">
                🏠
              </div>
            )}
          </div>

          {/* 우측 정보 */}
          <div className="flex-1 min-w-0">
            {/* 매장명 */}
            <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-2)' }}>
              {job.storeName ?? '매장명 미정'}
            </div>
            {/* 직무 칩 */}
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(255,31,143,0.10)', color: '#FF1F8F' }}
              >
                {JOB_ROLE_LABELS[job.role]}
              </span>
              {job.shift.slice(0, 2).map((s) => (
                <span
                  key={s}
                  className="text-[11px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
                >
                  {SHIFT_LABELS[s]}
                </span>
              ))}
            </div>
            {/* 시급 — 가장 강조 */}
            <div className="text-[17px] font-extrabold tracking-tight mt-1 stat-number" style={{ color: '#FF1F8F' }}>
              {formatWage(job.wage)}
            </div>
            {/* 지역 + 상대시간 */}
            <div className="flex items-center gap-1.5 mt-0.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <span className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                {job.region ?? '지역 미정'}
              </span>
              <span style={{ color: 'var(--border)' }}>·</span>
              <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                {formatRelativeTime(job.createdAt)}
              </span>
            </div>
          </div>
        </div>

        {/* 하단 CTA — 연락처 있을 때만 */}
        {(job.contact?.kakaoOpenChat || job.contact?.phone) && (
          <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            {job.contact?.kakaoOpenChat && (
              <a
                href={job.contact.kakaoOpenChat}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-[12px] font-bold transition active:opacity-75"
                style={{ background: '#FEE500', color: '#191919' }}
                aria-label="카카오 오픈채팅으로 연락"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 3C6.477 3 2 6.58 2 11c0 2.75 1.57 5.17 3.97 6.67L5 21l3.32-1.77C9.39 19.72 10.67 20 12 20c5.523 0 10-3.58 10-9s-4.477-8-10-8z"/>
                </svg>
                카카오 오픈채팅
              </a>
            )}
            {job.contact?.phone && (
              <a
                href={`tel:${job.contact.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-[12px] font-bold transition active:opacity-75"
                style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}
                aria-label={`전화 ${job.contact.phone}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.7A2 2 0 012.18 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.15a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                </svg>
                전화
              </a>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

/* ── 빈 상태 ── */
function EmptyJobsState() {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div className="text-5xl mb-4" aria-hidden="true">📭</div>
      <p className="text-[16px] font-bold mb-2" style={{ color: 'var(--text-1)' }}>
        아직 등록된 구인이 없습니다
      </p>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
        카톡방 사장님들이 곧 올릴 거예요
      </p>
    </div>
  );
}
