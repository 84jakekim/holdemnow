'use client';

/**
 * /platform/moderation — 본사 어드민 통합 모더레이션 페이지
 *
 * 매장 어드민 + 일반 사용자가 작성한 모든 콘텐츠를 한 곳에서 컨트롤.
 * 탭:
 *   1) 매장 소식 (collectionGroup posts) — 오늘의 소식 24h 만료성
 *   2) 구인 (community where type=jobOffer)
 *   3) 딜러 프로필 (community where type=dealerProfile)
 *   4) 중고거래 (community where type=usedListing)
 *
 * 액션: 숨김/복구 (status 토글) + 삭제. 모두 platform_admin 권한으로 처리.
 *
 * 리뷰는 별도 /platform/reviews 페이지에서 관리 (신고/통계 등 더 풍부한 UI).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { logAdminAction } from '@/lib/auditLog';

type Tab = 'posts' | 'jobs' | 'dealers' | 'used' | 'reviews';
type SortBy = 'createdAt' | 'flagCount';

interface PostRow {
  id: string;
  storeId: string;
  storeName?: string;
  body: string;
  imageUrls?: string[];
  eventTags?: string[];
  authorUid?: string;
  status: 'published' | 'hidden' | 'pending' | string;
  createdAt?: Timestamp;
  expiresAt?: Timestamp;
}

interface CommunityRow {
  id: string;
  type: 'jobOffer' | 'dealerProfile' | 'usedListing' | string;
  title?: string;
  body?: string;
  displayName?: string;
  storeName?: string;
  storeId?: string;
  authorUid: string;
  status: 'active' | 'closed' | 'expired' | 'hidden' | string;
  flagCount?: number;
  createdAt?: Timestamp;
}

interface ReviewRow {
  id: string;
  storeId: string;
  storeName?: string;
  authorUid: string;
  authorDisplayName?: string;
  rating?: number;
  body?: string;
  photoUrls?: string[];
  hidden?: boolean;
  flagCount?: number;
  createdAt?: Timestamp;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'posts', label: '매장 소식', icon: '📢' },
  { id: 'jobs', label: '구인', icon: '💼' },
  { id: 'dealers', label: '딜러 프로필', icon: '🃏' },
  { id: 'used', label: '중고거래', icon: '🛒' },
  { id: 'reviews', label: '리뷰', icon: '⭐' },
];

export default function ModerationPage() {
  const [tab, setTab] = useState<Tab>('posts');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900">모더레이션</h1>
        <p className="text-sm text-gray-500 mt-1">
          매장·사용자가 작성한 모든 게시물을 한 곳에서 점검·차단합니다.
          신고 누적(flagCount) 기준 정렬로 위험 글을 먼저 확인하세요.
          상세 신고 흐름은{' '}
          <Link href="/platform/reviews" className="text-pink-600 font-bold hover:underline">
            리뷰 관리
          </Link>{' '}
          페이지에도 별도 도구 제공.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-bold rounded-t-lg border-b-2 transition flex-shrink-0 ${
              tab === t.id
                ? 'border-pink-500 text-pink-700 bg-pink-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="mr-1">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'posts' && <PostsTab />}
      {tab === 'jobs' && <CommunityTab type="jobOffer" />}
      {tab === 'dealers' && <CommunityTab type="dealerProfile" />}
      {tab === 'used' && <CommunityTab type="usedListing" />}
      {tab === 'reviews' && <ReviewsTab />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 매장 소식 탭 — collectionGroup('posts'), 전체 (hidden 포함) 최근 200건
 * ─────────────────────────────────────────────────────────────*/

function PostsTab() {
  const [items, setItems] = useState<PostRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'published' | 'hidden' | 'expired'>('all');
  const [sortBy, setSortBy] = useState<SortBy>('createdAt');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collectionGroup(db, 'posts'), orderBy('createdAt', 'desc'), limit(200));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const storeId = d.ref.parent.parent?.id ?? '';
          return { id: d.id, storeId, ...(d.data() as Omit<PostRow, 'id' | 'storeId'>) };
        });
        setItems(rows);
        setLoading(false);
      },
      (e) => { setErr(e.message); setLoading(false); },
    );
  }, []);

  const now = Date.now();
  const filtered = useMemo(() => {
    const arr = items.filter((p) => {
      const expMs = p.expiresAt?.toMillis() ?? 0;
      const isExpired = expMs > 0 && expMs <= now;
      if (filter === 'published' && (p.status !== 'published' || isExpired)) return false;
      if (filter === 'hidden' && p.status !== 'hidden') return false;
      if (filter === 'expired' && !isExpired) return false;
      if (search) {
        const s = search.toLowerCase();
        const text = `${p.storeName ?? ''} ${p.body ?? ''} ${(p.eventTags ?? []).join(' ')}`.toLowerCase();
        if (!text.includes(s)) return false;
      }
      return true;
    });
    if (sortBy === 'flagCount') {
      return [...arr].sort((a, b) => {
        const fa = (a as PostRow & { flagCount?: number }).flagCount ?? 0;
        const fb = (b as PostRow & { flagCount?: number }).flagCount ?? 0;
        if (fa !== fb) return fb - fa;
        return (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0);
      });
    }
    return arr;
  }, [items, filter, sortBy, search, now]);

  const togglePost = async (p: PostRow) => {
    const next = p.status === 'hidden' ? 'published' : 'hidden';
    try {
      await updateDoc(doc(db, 'stores', p.storeId, 'posts', p.id), {
        status: next,
        moderatedAt: serverTimestamp(),
      });
      void logAdminAction({
        action: next === 'hidden' ? 'hide' : 'restore',
        targetPath: `stores/${p.storeId}/posts/${p.id}`,
        targetType: 'post',
      });
    } catch (e) {
      alert(`상태 변경 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const removePost = async (p: PostRow) => {
    if (!window.confirm('이 글을 완전히 삭제할까요? 첨부 이미지는 별도 정리됩니다.')) return;
    try {
      await deleteDoc(doc(db, 'stores', p.storeId, 'posts', p.id));
      void logAdminAction({
        action: 'delete',
        targetPath: `stores/${p.storeId}/posts/${p.id}`,
        targetType: 'post',
      });
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div>
      <FilterBar
        filter={filter}
        onFilter={(f) => setFilter(f as typeof filter)}
        options={[
          { id: 'all', label: '전체' },
          { id: 'published', label: '게시 중' },
          { id: 'hidden', label: '숨김' },
          { id: 'expired', label: '만료' },
        ]}
        search={search}
        onSearch={setSearch}
        placeholder="매장명/본문/태그 검색"
        count={filtered.length}
        sortBy={sortBy}
        onSortBy={setSortBy}
      />

      {err && <ErrorBanner msg={err} />}
      {loading ? <LoadingRow /> : filtered.length === 0 ? (
        <EmptyState label="해당 조건의 매장 소식이 없습니다" />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const expMs = p.expiresAt?.toMillis() ?? 0;
            const isExpired = expMs > 0 && expMs <= now;
            const isHidden = p.status === 'hidden';
            const flagCount = (p as PostRow & { flagCount?: number }).flagCount ?? 0;
            return (
              <ModerationCard
                key={`${p.storeId}-${p.id}`}
                badge={
                  isHidden ? { label: '숨김', tone: 'gray' } :
                  isExpired ? { label: '만료', tone: 'gray' } :
                  { label: '게시 중', tone: 'green' }
                }
                flagCount={flagCount}
                title={p.storeName ?? '(매장명 없음)'}
                subtitle={p.eventTags?.length ? `#${p.eventTags.join(' #')}` : undefined}
                body={p.body}
                imageUrl={p.imageUrls?.[0]}
                createdAt={p.createdAt}
                authorUid={p.authorUid}
                links={p.storeId ? [{ href: `/admin/${p.storeId}`, label: '매장 어드민' }] : []}
                actions={[
                  { label: isHidden ? '복구' : '숨김', onClick: () => togglePost(p), variant: isHidden ? 'primary' : 'subtle' },
                  { label: '삭제', onClick: () => removePost(p), variant: 'danger' },
                ]}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * community 탭 (jobOffer / dealerProfile / usedListing 공통)
 * ─────────────────────────────────────────────────────────────*/

function CommunityTab({ type }: { type: 'jobOffer' | 'dealerProfile' | 'usedListing' }) {
  const [items, setItems] = useState<CommunityRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'hidden' | 'closed'>('all');
  const [sortBy, setSortBy] = useState<SortBy>('createdAt');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'community'),
      where('type', '==', type),
      orderBy('createdAt', 'desc'),
      limit(200),
    );
    return onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommunityRow, 'id'>) })));
        setLoading(false);
      },
      (e) => { setErr(e.message); setLoading(false); },
    );
  }, [type]);

  const filtered = useMemo(() => {
    const arr = items.filter((c) => {
      if (filter === 'active' && c.status !== 'active') return false;
      if (filter === 'hidden' && c.status !== 'hidden') return false;
      if (filter === 'closed' && !(c.status === 'closed' || c.status === 'expired')) return false;
      if (search) {
        const s = search.toLowerCase();
        const text = `${c.title ?? ''} ${c.body ?? ''} ${c.displayName ?? ''} ${c.storeName ?? ''}`.toLowerCase();
        if (!text.includes(s)) return false;
      }
      return true;
    });
    if (sortBy === 'flagCount') {
      return [...arr].sort((a, b) => {
        if ((a.flagCount ?? 0) !== (b.flagCount ?? 0)) return (b.flagCount ?? 0) - (a.flagCount ?? 0);
        return (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0);
      });
    }
    return arr;
  }, [items, filter, sortBy, search]);

  const targetTypeOf = (t: typeof type): 'community' | 'dealer' =>
    t === 'dealerProfile' ? 'dealer' : 'community';

  const toggleStatus = async (c: CommunityRow) => {
    const next = c.status === 'hidden' ? 'active' : 'hidden';
    try {
      await updateDoc(doc(db, 'community', c.id), {
        status: next,
        moderatedAt: serverTimestamp(),
      });
      void logAdminAction({
        action: next === 'hidden' ? 'hide' : 'restore',
        targetPath: `community/${c.id}`,
        targetType: targetTypeOf(type),
      });
    } catch (e) {
      alert(`상태 변경 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async (c: CommunityRow) => {
    if (!window.confirm('이 게시글을 완전히 삭제할까요? 되돌릴 수 없습니다.')) return;
    try {
      await deleteDoc(doc(db, 'community', c.id));
      void logAdminAction({
        action: 'delete',
        targetPath: `community/${c.id}`,
        targetType: targetTypeOf(type),
      });
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const typeLabel = type === 'jobOffer' ? '구인' : type === 'dealerProfile' ? '딜러 프로필' : '중고거래';

  return (
    <div>
      <FilterBar
        filter={filter}
        onFilter={(f) => setFilter(f as typeof filter)}
        options={[
          { id: 'all', label: '전체' },
          { id: 'active', label: '게시 중' },
          { id: 'hidden', label: '숨김' },
          { id: 'closed', label: '마감/만료' },
        ]}
        search={search}
        onSearch={setSearch}
        placeholder={`${typeLabel} 검색 (제목/본문/작성자/매장)`}
        count={filtered.length}
        sortBy={sortBy}
        onSortBy={setSortBy}
      />

      {err && <ErrorBanner msg={err} />}
      {loading ? <LoadingRow /> : filtered.length === 0 ? (
        <EmptyState label={`해당 조건의 ${typeLabel} 글이 없습니다`} />
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const isHidden = c.status === 'hidden';
            const tone = isHidden ? 'gray' :
              c.status === 'active' ? 'green' : 'gray';
            const label = isHidden ? '숨김' :
              c.status === 'active' ? '게시 중' :
              c.status === 'closed' ? '마감' :
              c.status === 'expired' ? '만료' : c.status;

            return (
              <ModerationCard
                key={c.id}
                badge={{ label, tone }}
                flagCount={c.flagCount ?? 0}
                title={c.title ?? c.displayName ?? '(제목 없음)'}
                subtitle={
                  type === 'jobOffer' ? c.storeName :
                  type === 'dealerProfile' ? `딜러 · ${c.displayName ?? ''}` :
                  c.storeName
                }
                body={c.body}
                createdAt={c.createdAt}
                authorUid={c.authorUid}
                links={
                  c.storeId
                    ? [{ href: `/admin/${c.storeId}`, label: '매장' }]
                    : []
                }
                actions={[
                  { label: isHidden ? '복구' : '숨김', onClick: () => toggleStatus(c), variant: isHidden ? 'primary' : 'subtle' },
                  { label: '삭제', onClick: () => remove(c), variant: 'danger' },
                ]}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 리뷰 탭 — collectionGroup('reviews') 전체, hidden 토글 + 삭제
 * (별도 /platform/reviews 페이지의 신고 통계는 그대로 유지)
 * ─────────────────────────────────────────────────────────────*/

function ReviewsTab() {
  const [items, setItems] = useState<ReviewRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [sortBy, setSortBy] = useState<SortBy>('createdAt');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collectionGroup(db, 'reviews'), orderBy('createdAt', 'desc'), limit(200));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const storeId = d.ref.parent.parent?.id ?? '';
          return { id: d.id, storeId, ...(d.data() as Omit<ReviewRow, 'id' | 'storeId'>) };
        });
        setItems(rows);
        setLoading(false);
      },
      (e) => { setErr(e.message); setLoading(false); },
    );
  }, []);

  const filtered = useMemo(() => {
    const arr = items.filter((r) => {
      if (filter === 'visible' && r.hidden === true) return false;
      if (filter === 'hidden' && r.hidden !== true) return false;
      if (search) {
        const s = search.toLowerCase();
        const text = `${r.storeName ?? ''} ${r.body ?? ''} ${r.authorDisplayName ?? ''}`.toLowerCase();
        if (!text.includes(s)) return false;
      }
      return true;
    });
    if (sortBy === 'flagCount') {
      return [...arr].sort((a, b) => {
        if ((a.flagCount ?? 0) !== (b.flagCount ?? 0)) return (b.flagCount ?? 0) - (a.flagCount ?? 0);
        return (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0);
      });
    }
    return arr;
  }, [items, filter, sortBy, search]);

  const toggleHidden = async (r: ReviewRow) => {
    const next = !r.hidden;
    try {
      await updateDoc(doc(db, 'stores', r.storeId, 'reviews', r.id), {
        hidden: next,
        moderatedAt: serverTimestamp(),
      });
      void logAdminAction({
        action: next ? 'hide' : 'restore',
        targetPath: `stores/${r.storeId}/reviews/${r.id}`,
        targetType: 'review',
      });
    } catch (e) {
      alert(`상태 변경 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const removeReview = async (r: ReviewRow) => {
    if (!window.confirm('이 리뷰를 완전히 삭제할까요? 매장 평점은 자동 재계산됩니다.')) return;
    try {
      await deleteDoc(doc(db, 'stores', r.storeId, 'reviews', r.id));
      void logAdminAction({
        action: 'delete',
        targetPath: `stores/${r.storeId}/reviews/${r.id}`,
        targetType: 'review',
      });
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div>
      <FilterBar
        filter={filter}
        onFilter={(f) => setFilter(f as typeof filter)}
        options={[
          { id: 'all', label: '전체' },
          { id: 'visible', label: '노출' },
          { id: 'hidden', label: '숨김' },
        ]}
        search={search}
        onSearch={setSearch}
        placeholder="매장명/본문/작성자 검색"
        count={filtered.length}
        sortBy={sortBy}
        onSortBy={setSortBy}
      />

      {err && <ErrorBanner msg={err} />}
      {loading ? <LoadingRow /> : filtered.length === 0 ? (
        <EmptyState label="해당 조건의 리뷰가 없습니다" />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const isHidden = r.hidden === true;
            const ratingStr = typeof r.rating === 'number' ? '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) : '';
            return (
              <ModerationCard
                key={`${r.storeId}-${r.id}`}
                badge={{ label: isHidden ? '숨김' : '노출', tone: isHidden ? 'gray' : 'green' }}
                flagCount={r.flagCount ?? 0}
                title={r.storeName ?? '(매장명 없음)'}
                subtitle={`${ratingStr} · ${r.authorDisplayName ?? '익명'}`}
                body={r.body}
                imageUrl={r.photoUrls?.[0]}
                createdAt={r.createdAt}
                authorUid={r.authorUid}
                links={r.storeId ? [{ href: `/admin/${r.storeId}`, label: '매장 어드민' }] : []}
                actions={[
                  { label: isHidden ? '복구' : '숨김', onClick: () => toggleHidden(r), variant: isHidden ? 'primary' : 'subtle' },
                  { label: '삭제', onClick: () => removeReview(r), variant: 'danger' },
                ]}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 공통 컴포넌트
 * ─────────────────────────────────────────────────────────────*/

function FilterBar({
  filter,
  onFilter,
  options,
  search,
  onSearch,
  placeholder,
  count,
  sortBy,
  onSortBy,
}: {
  filter: string;
  onFilter: (f: string) => void;
  options: { id: string; label: string }[];
  search: string;
  onSearch: (s: string) => void;
  placeholder: string;
  count: number;
  sortBy: SortBy;
  onSortBy: (s: SortBy) => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onFilter(o.id)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
              filter === o.id
                ? 'bg-pink-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={placeholder}
        className="flex-1 max-w-sm px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
      />
      <select
        value={sortBy}
        onChange={(e) => onSortBy(e.target.value as SortBy)}
        className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-bold bg-white"
        title="정렬 기준"
      >
        <option value="createdAt">최신순</option>
        <option value="flagCount">🚩 신고 많은 순</option>
      </select>
      <span className="text-xs text-gray-500 font-mono">{count}건</span>
    </div>
  );
}

function ModerationCard({
  badge,
  flagCount,
  title,
  subtitle,
  body,
  imageUrl,
  createdAt,
  authorUid,
  links,
  actions,
}: {
  badge: { label: string; tone: 'green' | 'gray' | 'red' | 'amber' };
  flagCount?: number;
  title: string;
  subtitle?: string;
  body?: string;
  imageUrl?: string;
  createdAt?: Timestamp;
  authorUid?: string;
  links: { href: string; label: string }[];
  actions: { label: string; onClick: () => void; variant: 'primary' | 'subtle' | 'danger' }[];
}) {
  const badgeColor = {
    green: 'bg-emerald-100 text-emerald-800',
    gray: 'bg-gray-200 text-gray-600',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-800',
  }[badge.tone];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">📝</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className={`text-[10px] font-extrabold tracking-wider px-1.5 py-0.5 rounded ${badgeColor}`}>
            {badge.label}
          </span>
          {flagCount != null && flagCount > 0 && (
            <span
              className="text-[10px] font-extrabold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
              style={{
                background: flagCount >= 3 ? '#FECACA' : '#FED7AA',
                color: flagCount >= 3 ? '#991B1B' : '#9A3412',
              }}
              title={`신고 ${flagCount}건${flagCount >= 3 ? ' (자동 숨김 임계 도달)' : ''}`}
            >
              🚩 {flagCount}
            </span>
          )}
          <span className="font-bold text-gray-900 truncate">{title}</span>
          {subtitle && (
            <span className="text-[11px] text-gray-500 truncate">{subtitle}</span>
          )}
        </div>
        {body && (
          <div className="text-sm text-gray-700 line-clamp-2 whitespace-pre-wrap leading-relaxed">
            {body}
          </div>
        )}
        <div className="text-[10.5px] text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
          {createdAt && <span>{formatRelative(createdAt)}</span>}
          {authorUid && <span className="font-mono">uid {authorUid.slice(0, 8)}…</span>}
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-pink-600 hover:underline font-semibold">
              {l.label} →
            </Link>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        {actions.map((a) => {
          const cls =
            a.variant === 'primary' ? 'bg-pink-600 text-white border-transparent hover:bg-pink-700' :
            a.variant === 'danger' ? 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100' :
            'border-gray-200 text-gray-700 hover:bg-gray-50';
          return (
            <button
              key={a.label}
              onClick={a.onClick}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-md border transition ${cls}`}
            >
              {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">
      불러오기 실패: {msg}
    </div>
  );
}

function LoadingRow() {
  return <div className="py-10 text-center text-sm text-gray-500">로딩 중…</div>;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-12 text-center bg-white border-2 border-dashed border-gray-200 rounded-xl">
      <div className="text-3xl mb-2">📭</div>
      <div className="text-sm font-bold text-gray-700">{label}</div>
    </div>
  );
}

function formatRelative(ts: Timestamp): string {
  const ms = Date.now() - ts.toMillis();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return ts.toDate().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
}
