'use client';

/**
 * /m/community — 커뮤니티 인덱스 v0.3 (핸드오프 적용 2026-05-27)
 *
 * 핸드오프: claude-design/community-handoff/pimk-rabbit/project/screens-community.jsx
 * 디자인: 3탭 통합 (구인/구직/중고) + 검색 + 필터 chips + FAB 글쓰기
 *
 * v0.3 범위:
 *  - 시각 디자인 100% 매칭 (탭 underline, 검색 input, 필터 chips, FAB 그라데이션)
 *  - 각 탭 컨텐츠 = "전체 보기 →" 링크 (실제 리스트는 jobs/dealers/used 서브 페이지)
 *  - 실 데이터 인라인 통합은 v0.4 sprint 별도 진행
 *
 * 권한: 구직=일반 사용자, 구인·중고=매장 owner (서브 페이지에서 추가 가드)
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import NotificationBellButton from '@/components/mobile/NotificationBellButton';

type TabId = 'hiring' | 'seeking' | 'market';

interface TabDef {
  id: TabId;
  label: string;
  icon: string;
  desc: string;
  searchPlaceholder: string;
  listHref: string;
  composeHref: string;
}

const TABS: TabDef[] = [
  {
    id: 'hiring',
    label: '구인',
    icon: '🙋‍♂️',
    desc: '딜러 · 매니저 모집',
    searchPlaceholder: '매장명·지역·포지션',
    listHref: '/m/community/jobs',
    composeHref: '/m/community/jobs/new',
  },
  {
    id: 'seeking',
    label: '구직',
    icon: '💼',
    desc: '딜러 이력서',
    searchPlaceholder: '경력·지역으로 검색',
    listHref: '/m/community/dealers/me',
    composeHref: '/m/community/dealers/me',
  },
  {
    id: 'market',
    label: '중고거래',
    icon: '🃏',
    desc: '홀덤 용품',
    searchPlaceholder: '카드·칩셋·의자 등',
    listHref: '/m/community/used',
    composeHref: '/m/community/used/new',
  },
];

const HIRING_FILTERS = ['전체', '🔥 급구', '딜러', '매니저', '📍 가까운순', '💰 고시급'];
const MARKET_CATEGORIES = ['전체', '🃏 카드/덱', '🎰 칩셋', '🤖 셔플러', '🪑 의자/테이블', '🟢 매트', '📚 책/굿즈'];

export default function CommunityIndexPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('hiring');
  const [q, setQ] = useState('');
  const [hiringFilter, setHiringFilter] = useState('전체');
  const [marketCategory, setMarketCategory] = useState('전체');

  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="relative min-h-screen flex flex-col" style={{ background: 'var(--surface-2)' }}>
      {/* ── 헤더 ─────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 flex items-center gap-2 px-3"
        style={{
          height: 52,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          className="tap"
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-1)',
            cursor: 'pointer',
          }}
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
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-1)',
            textDecoration: 'none',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </Link>
        <NotificationBellButton ariaLabel="알림" />
      </header>

      {/* ── 탭 (구인 / 구직 / 중고거래) ───────────────── */}
      <nav
        className="sticky z-20 flex"
        style={{
          top: 52,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
        }}
        role="tablist"
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
              style={{
                flex: 1,
                padding: '12px 0 10px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                color: active ? 'var(--text-1)' : 'var(--text-3)',
              }}
            >
              <div style={{ fontSize: 18, marginBottom: 2 }} aria-hidden="true">{t.icon}</div>
              <div style={{ fontSize: 12, fontWeight: active ? 900 : 700, letterSpacing: '-0.01em' }}>{t.label}</div>
              <div
                style={{
                  fontSize: 9,
                  color: active ? 'var(--brand)' : 'var(--text-3)',
                  marginTop: 1,
                  fontWeight: 600,
                }}
              >
                {t.desc}
              </div>
              {active && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    bottom: -1,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '46%',
                    height: 3,
                    borderRadius: 99,
                    background: 'var(--brand)',
                    boxShadow: '0 2px 8px rgba(255,31,143,0.4)',
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* ── 검색 ───────────────────────────────────── */}
      <div className="px-3.5 pt-2.5 pb-1" style={{ background: 'var(--bg)' }}>
        <div
          className="flex items-center gap-2 px-2.5"
          style={{
            background: 'var(--surface-2)',
            borderRadius: 10,
            height: 36,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={activeTab.searchPlaceholder}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              flex: 1,
              fontSize: 13,
              color: 'var(--text-1)',
              fontFamily: 'inherit',
              minWidth: 0,
            }}
          />
          {q && (
            <button
              onClick={() => setQ('')}
              aria-label="검색어 지우기"
              className="tap"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-2)',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── 컨텐츠 ───────────────────────────────────── */}
      <div className="no-scrollbar flex-1 overflow-y-auto pb-24">
        {tab === 'hiring' && (
          <>
            <FilterChips
              options={HIRING_FILTERS}
              value={hiringFilter}
              onChange={setHiringFilter}
            />
            <TabPreview
              icon="🔥"
              title="인기 채용"
              listHref={activeTab.listHref}
              composeHref={activeTab.composeHref}
              composeLabel="공고 등록"
              emptyDesc="딜러·매니저 채용 공고를 둘러보거나 매장 사장이라면 직접 등록할 수 있어요."
            />
          </>
        )}
        {tab === 'seeking' && (
          <TabPreview
            icon="💼"
            title="구직 중인 딜러"
            listHref={activeTab.listHref}
            composeHref={activeTab.composeHref}
            composeLabel="이력서 작성"
            emptyDesc="딜러·매니저 본인이 한 번만 등록하면 매장에서 먼저 연락드려요."
          />
        )}
        {tab === 'market' && (
          <>
            <FilterChips
              options={MARKET_CATEGORIES}
              value={marketCategory}
              onChange={setMarketCategory}
            />
            <TabPreview
              icon="🛒"
              title="거래 물품"
              listHref={activeTab.listHref}
              composeHref={activeTab.composeHref}
              composeLabel="물품 등록"
              emptyDesc="카드·칩셋·셔플러 등 홀덤 용품을 매장 간 거래하세요."
            />
          </>
        )}
      </div>

      {/* ── FAB (글쓰기 — 활성 탭에 맞춰 이동) ──────── */}
      <Link
        href={activeTab.composeHref}
        aria-label={`${activeTab.label} 등록`}
        className="tap"
        style={{
          position: 'fixed',
          right: 18,
          bottom: 86, // 하단 탭바 위
          zIndex: 25,
          width: 54,
          height: 54,
          borderRadius: 99,
          background: 'linear-gradient(135deg,#FF1F8F,#FF6BAA)',
          boxShadow: '0 8px 22px rgba(255,31,143,0.42)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          textDecoration: 'none',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 필터 chips
// ──────────────────────────────────────────────────────
function FilterChips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const normalize = (s: string) => s.replace(/^[^\s]+\s/, '');
  return (
    <div
      className="no-scrollbar"
      style={{
        display: 'flex',
        gap: 6,
        padding: '8px 14px 12px',
        overflowX: 'auto',
        background: 'var(--bg)',
      }}
    >
      {options.map((opt) => {
        const normalized = normalize(opt);
        const active = value === normalized;
        return (
          <button
            key={opt}
            onClick={() => onChange(normalized)}
            className="tap"
            style={{
              flexShrink: 0,
              padding: '5px 12px',
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 700,
              border: active ? 'none' : '1px solid var(--border)',
              background: active ? 'var(--brand)' : 'var(--bg)',
              color: active ? '#fff' : 'var(--text-1)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 탭 미리보기 (실 데이터는 listHref 페이지에서)
// ──────────────────────────────────────────────────────
function TabPreview({
  icon,
  title,
  listHref,
  composeHref,
  composeLabel,
  emptyDesc,
}: {
  icon: string;
  title: string;
  listHref: string;
  composeHref: string;
  composeLabel: string;
  emptyDesc: string;
}) {
  return (
    <section style={{ padding: '0 14px 16px' }}>
      <div className="flex items-baseline justify-between mb-2.5">
        <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '-0.015em' }}>
          {icon} {title}
        </div>
        <Link
          href={listHref}
          className="tap"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--brand)',
            textDecoration: 'none',
          }}
        >
          전체 보기 →
        </Link>
      </div>

      {/* 빈 상태 — 실 데이터 인라인 통합은 v0.4 */}
      <div
        className="lift"
        style={{
          background: 'var(--bg)',
          borderRadius: 14,
          border: '1px dashed var(--border-strong)',
          padding: '28px 18px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 38, marginBottom: 10 }} aria-hidden="true">
          {icon}
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>전체 목록은 별도 페이지에서</div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-2)',
            lineHeight: 1.55,
            marginBottom: 16,
            whiteSpace: 'pre-line',
          }}
        >
          {emptyDesc}
        </div>
        <div className="flex gap-2 justify-center">
          <Link
            href={listHref}
            className="tap"
            style={{
              padding: '8px 16px',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 800,
              background: 'var(--brand)',
              color: '#fff',
              textDecoration: 'none',
              boxShadow: 'var(--shadow-brand)',
            }}
          >
            전체 보기
          </Link>
          <Link
            href={composeHref}
            className="tap"
            style={{
              padding: '8px 16px',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 800,
              background: 'var(--bg)',
              color: 'var(--text-1)',
              border: '1px solid var(--border-strong)',
              textDecoration: 'none',
            }}
          >
            + {composeLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
