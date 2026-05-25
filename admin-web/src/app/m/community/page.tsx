'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/* ============================================================
 * /m/community — 커뮤니티 인덱스 v0.2
 * 3개 카드 모두 활성: 구인 · 구직(dealerProfile) · 중고거래(usedListing)
 * 권한: 구직=일반 사용자, 구인·중고=매장 owner (여기선 탐색만)
 * ========================================================== */

interface CategoryCard {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  href: string;
  accentColor: string;
}

const CATEGORIES: CategoryCard[] = [
  {
    id: 'jobs',
    emoji: '💼',
    title: '구인',
    subtitle: '홀덤펍 채용 공고',
    href: '/m/community/jobs',
    accentColor: '#FF1F8F',
  },
  {
    id: 'dealers',
    emoji: '🃏',
    title: '구직 게시 (딜러)',
    subtitle: '게시글 한 번이면 매장에서 먼저 연락해요',
    href: '/m/community/dealers/me',
    accentColor: '#FF1F8F',
  },
  {
    id: 'used',
    emoji: '🛒',
    title: '중고거래',
    subtitle: '매장 비품 매매 (칩·카드·타이머)',
    href: '/m/community/used',
    accentColor: '#FF1F8F',
  },
];

export default function CommunityIndexPage() {
  const router = useRouter();

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* ── 핑크 그라데이션 hero ── */}
      <header className="pr-home-hero px-5 pt-5 pb-7">
        <div className="pr-home-hero-content flex items-start justify-between gap-3">
          <button
            onClick={() => router.back()}
            aria-label="뒤로"
            className="hero-pink-action w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 tap"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <div className="flex-1 min-w-0 text-center">
            <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase opacity-90">
              COMMUNITY
            </div>
            <h1 className="h2 font-serif mt-1.5">커뮤니티</h1>
            <p className="text-[13px] font-semibold opacity-90 mt-1.5">
              홀덤펍 종사자와 매장을 잇는 공간
            </p>
          </div>
          <div className="w-9 h-9 flex-shrink-0" aria-hidden="true" />
        </div>
      </header>

      {/* ── 카드 리스트 ── */}
      <div className="px-4 flex flex-col gap-3 pb-8">
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.id}
            href={cat.href}
            className="block transition active:scale-[0.99] tap"
            aria-label={`${cat.title} — ${cat.subtitle}`}
          >
            <div
              className="rounded-2xl overflow-hidden lift"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid rgba(255,31,143,0.18)',
                boxShadow: '0 2px 16px rgba(255,31,143,0.08), 0 1px 4px rgba(0,0,0,0.04)',
              }}
            >
              {/* 상단 핑크 액센트 라인 */}
              <div
                style={{
                  height: 3,
                  background: 'linear-gradient(90deg, #FF1F8F 0%, rgba(255,31,143,0.15) 100%)',
                }}
                aria-hidden="true"
              />
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    {/* 이모지 배경 */}
                    <div
                      className="flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                      style={{
                        background: 'linear-gradient(135deg, rgba(255,31,143,0.12) 0%, rgba(255,31,143,0.06) 100%)',
                      }}
                      aria-hidden="true"
                    >
                      {cat.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
                        {cat.title}
                      </span>
                      <p className="text-[13px] mt-0.5 leading-snug" style={{ color: 'var(--text-2)' }}>
                        {cat.subtitle}
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 self-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
