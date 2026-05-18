'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeAllLiveSessions, type LiveSession, fmtTime, useLiveCountdown } from '@/lib/live';
import { subscribeAllSeries, type Series } from '@/lib/series';
import { posterStyleFor } from '@/lib/templates';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { haversineMeters, formatDistance, type LatLng } from '@/lib/geo';
import { loadPopularStores, loadRecentlyJoinedStores, type PopularityStore } from '@/lib/popularity';

interface StoreGroup {
  storeId: string;
  storeName: string;
  sessions: LiveSession[];
}

interface StoreSummary {
  thumbnail?: string;
}

interface NearbyStore {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
  facilities?: string[];
  tier?: string;
  lat?: number;
  lng?: number;
  distance?: number;
}

/* ============================================================
 * 홈 페이지 v4 — lun DNA 적용
 * 1. 위치 헤더
 * 2. 히어로 LIVE 카드 (가로 스와이프, GTD 숫자 강조)
 * 3. 원형 카테고리 아이콘 그리드 (5개)
 * 4. 인기 매장 아바타 가로 스크롤
 * 5. 내 주변 매장 TOP
 * 6. 메이저 시리즈
 * 7. 콘텐츠 영역 (추후 SNS 확장 자리)
 * ========================================================== */
export default function MobileHome() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [storeSummaries, setStoreSummaries] = useState<Record<string, StoreSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeAllLiveSessions(
      (items) => { setSessions(items); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); },
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeAllSeries(setSeries, () => {});
    return unsub;
  }, []);

  const groups: StoreGroup[] = useMemo(() => {
    const map: Record<string, StoreGroup> = {};
    for (const s of sessions) {
      if (!map[s.storeId]) map[s.storeId] = { storeId: s.storeId, storeName: s.storeName, sessions: [] };
      map[s.storeId].sessions.push(s);
    }
    return Object.values(map);
  }, [sessions]);

  useEffect(() => {
    const ids = groups.map((g) => g.storeId).filter((id) => !(id in storeSummaries));
    if (ids.length === 0) return;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'stores'), where(documentId(), 'in', ids.slice(0, 10))),
        );
        const next: Record<string, StoreSummary> = {};
        snap.forEach((d) => {
          const data = d.data() as { photoUrls?: string[] };
          next[d.id] = { thumbnail: data.photoUrls?.[0] };
        });
        setStoreSummaries((prev) => ({ ...prev, ...next }));
      } catch { /* ignore */ }
    })();
  }, [groups, storeSummaries]);

  const liveByStore = useMemo(() => sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.storeId] = (acc[s.storeId] || 0) + 1;
    return acc;
  }, {}), [sessions]);

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          1. 상단 헤더 v6 — 핑크 그라데이션 카드형
          브랜드 핑크 그라데이션 배경, 흰 로고·아이콘, 위치도 핑크 안
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <header className="sticky top-0 z-30 header-brand-card">
        {/* 1단 — 브랜드 (흰 로고마크 + 흰 워드마크) + 우측 액션 */}
        <div className="px-4 h-14 flex items-center justify-between">
          <Link href="/m" aria-label="HoldemNow 홈" className="flex items-center gap-2 transition active:opacity-75">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-mark.svg"
              alt=""
              width={30}
              height={30}
              className="flex-shrink-0"
              style={{ borderRadius: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.18)' }}
              aria-hidden="true"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-white.svg"
              alt="HoldemNow"
              height={22}
              style={{ width: 'auto', display: 'block' }}
            />
          </Link>

          <div className="flex items-center gap-1.5">
            <Link
              href="/m/search"
              aria-label="검색"
              className="w-9 h-9 flex items-center justify-center rounded-xl header-action-btn-white"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            </Link>
            <button
              aria-label="알림"
              className="w-9 h-9 flex items-center justify-center rounded-xl relative header-action-btn-white"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 01-3.46 0"/>
              </svg>
            </button>
          </div>
        </div>

        {/* 2단 — 위치 헤딩 (핑크 헤더 안 흰색, 토스 스타일) */}
        <div className="px-4 pb-3 -mt-1">
          <button className="flex items-center gap-1.5 transition active:opacity-70">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.90)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            <span className="text-[16px] font-extrabold tracking-tight header-location-text">
              부산 서면
            </span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.70)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
        </div>

        {/* 하단 페이드 구분 — 본문과 자연스럽게 분리 */}
        <div className="header-brand-card-footer" aria-hidden="true" />
      </header>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          2. 히어로 LIVE 카드 — lun 강도 수준
          GTD/진행 인원 숫자 강조 + 강한 포스터 분위기
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section aria-label="지금 LIVE" className="pt-4">
        {/* 섹션 헤더 */}
        <div className="px-4 flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 pulse-live"
              style={{ background: 'var(--live)' }}
              aria-hidden="true"
            />
            <span className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
              지금 LIVE
            </span>
            {groups.length > 0 && (
              <span
                className="text-[11px] font-extrabold rounded-full px-2 py-0.5 stat-number"
                style={{ background: 'var(--live)', color: '#fff' }}
              >
                {groups.length}
              </span>
            )}
          </div>
          <Link
            href="/m/live"
            className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60"
            style={{ color: 'var(--brand)' }}
          >
            전체보기
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
          </Link>
        </div>

        {/* 카드 영역 */}
        {loading ? (
          <LiveHeroSkeleton />
        ) : error ? (
          <div
            className="mx-4 rounded-2xl p-4 text-sm"
            style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: 'var(--live)' }}
          >
            {error}
          </div>
        ) : groups.length === 0 ? (
          <LiveEmptyHero />
        ) : (
          <div className="pl-4 flex gap-3 overflow-x-auto pb-1 scrollbar-none">
            {groups.map((g) => (
              <LiveHeroCard
                key={g.storeId}
                group={g}
                thumbnail={storeSummaries[g.storeId]?.thumbnail}
              />
            ))}
            <div className="w-3 flex-shrink-0" aria-hidden="true" />
          </div>
        )}
      </section>

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider mt-5" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          3. 원형 카테고리 아이콘 그리드 — lun DNA 핵심
          5개 즉시 진입점: 매장찾기 / LIVE중 / 토너 / 시리즈 / 즐겨찾기
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section aria-label="빠른 메뉴" className="px-4 py-5">
        <div className="grid grid-cols-5 gap-1">
          {/* 매장찾기 */}
          <Link href="/m/discover" className="flex flex-col items-center gap-2 transition active:scale-95">
            <div className="cat-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9"/>
                <path d="M14.5 9.5l-5 2-2 5 5-2 2-5z"/>
                <circle cx="12" cy="12" r="1.2" fill="#fff" stroke="none"/>
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>매장찾기</span>
          </Link>

          {/* LIVE 중 */}
          <Link href="/m/discover" className="flex flex-col items-center gap-2 transition active:scale-95">
            <div className="cat-icon-wrap cat-icon-wrap-live relative">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" fill="#fff" stroke="none"/>
                <path d="M16.5 7.5a6.5 6.5 0 010 9M7.5 7.5a6.5 6.5 0 000 9"/>
                <path d="M19.07 4.93a10.5 10.5 0 010 14.14M4.93 4.93a10.5 10.5 0 000 14.14"/>
              </svg>
              {/* 미세 펄스 표시 */}
              <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: '#fff', opacity: 0.9 }} aria-hidden="true" />
            </div>
            <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>LIVE 중</span>
          </Link>

          {/* 토너 */}
          <Link href="/m/calendar" className="flex flex-col items-center gap-2 transition active:scale-95">
            <div className="cat-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2.5"/>
                <path d="M16 2v4M8 2v4M3 10h18"/>
                <circle cx="8" cy="15" r="1" fill="#fff" stroke="none"/>
                <circle cx="12" cy="15" r="1" fill="#fff" stroke="none"/>
                <circle cx="16" cy="15" r="1" fill="#fff" stroke="none"/>
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>토너</span>
          </Link>

          {/* 시리즈 */}
          <Link href="/m/events" className="flex flex-col items-center gap-2 transition active:scale-95">
            <div className="cat-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 21l4-4 4 4"/>
                <path d="M12 17V3"/>
                <path d="M3 8h18"/>
                <path d="M6 12.5l6-2.5 6 2.5"/>
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>시리즈</span>
          </Link>

          {/* 즐겨찾기 */}
          <Link href="/m/favorites" className="flex flex-col items-center gap-2 transition active:scale-95">
            <div className="cat-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>즐겨찾기</span>
          </Link>
        </div>
      </section>

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          4. 인기 매장 아바타 가로 스크롤 — lun 인기 유튜버 패턴
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <PopularStoresAvatarScroll liveByStore={liveByStore} />

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          🆕 새로 합류한 매장 — 가입 30일 이내, cold-start 노출 보장
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <NewlyJoinedStoresSection liveByStore={liveByStore} />

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          5. 내 주변 매장 TOP
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <NearbyStoresSection liveByStore={liveByStore} />

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      {series.length > 0 && <div className="brand-strip-divider mt-5" />}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          6. 메이저 시리즈 (큰 포스터 카드)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {series.length > 0 && (
        <section aria-label="메이저 시리즈" className="pb-6">
          <div className="px-4 flex items-center justify-between mb-4 pt-5">
            <div>
              <div className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
                메이저 시리즈
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                전국 주요 대회 일정
              </div>
            </div>
            <Link
              href="/m/events"
              className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60"
              style={{ color: 'var(--brand)' }}
            >
              전체보기
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
            </Link>
          </div>
          <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
            {series.map((s) => <SeriesPosterCard key={s.id} series={s} />)}
            <div className="w-3 flex-shrink-0" aria-hidden="true" />
          </div>
        </section>
      )}

      {/* 섹션 구분 — 브랜드 핑크 스트립 */}
      <div className="brand-strip-divider" />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          7. 콘텐츠 영역 — 추후 SNS/피드로 확장될 자리
          지금은 placeholder + 빈 상태 UI
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <ContentFeedPlaceholder />

      {/* ── 푸터 ── */}
      <div
        className="px-4 py-6 text-center text-[11px]"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--text-3)' }}
      >
        HoldemNow BETA · 부산/경남 홀덤펍 디스커버리
      </div>
    </div>
  );
}

/* ============================================================
 * 히어로 LIVE 카드 v4 — lun 강도 수준
 * 더 어두운 그라데이션 오버레이 + GTD/진행인원 숫자 강조
 * ========================================================== */
function LiveHeroCard({ group, thumbnail }: { group: StoreGroup; thumbnail?: string }) {
  const primary = group.sessions[0];
  const count = group.sessions.length;
  const poster = posterStyleFor(primary.posterStyle);
  const totalPlayers = group.sessions.reduce((s, x) => s + (x.playersRemaining || 0), 0);

  useEffect(() => { trackImpressionOnce(group.storeId, 'home-live'); }, [group.storeId]);

  return (
    <Link
      href={`/m/store/${group.storeId}`}
      onClick={() => bumpStoreMetric(group.storeId, 'cardClicks')}
      className="w-[280px] flex-shrink-0 overflow-hidden card-hover hero-dark-card"
      style={{
        boxShadow: '0 4px 24px rgba(0,0,0,0.22), 0 1px 6px rgba(229,62,62,0.18)',
      }}
    >
      {/* 사진 영역 — lun 수준의 강한 어두운 오버레이 */}
      <div
        className="relative overflow-hidden"
        style={{ aspectRatio: '16/9', background: poster.bg }}
      >
        {thumbnail ? (
          <>
            <img src={thumbnail} alt={group.storeName} className="absolute inset-0 w-full h-full object-cover" />
            {/* 상단 → 하단 그라데이션 */}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.70) 100%)' }} />
          </>
        ) : (
          /* 사진 없을 때: 다크 그라데이션 배경 */
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #1A0A1E 0%, #0D1117 100%)' }}>
            <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
              </svg>
            </div>
          </div>
        )}

        {/* LIVE 배지 — 좌상단 */}
        <div className="absolute top-3 left-3 z-10">
          <span className="badge-live" style={{ fontSize: 11, padding: '4px 10px' }}>
            <span className="dot" />
            LIVE{count > 1 ? ` ${count}` : ''}
          </span>
        </div>

        {/* 우상단: 진행 인원 강조 */}
        {totalPlayers > 0 && (
          <div className="absolute top-3 right-3 z-10">
            <div
              className="rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)' }}
            >
              <span className="stat-number" style={{ color: 'var(--brand)' }}>{totalPlayers}</span>
              <span> 명 진행</span>
            </div>
          </div>
        )}

        {/* 하단 텍스트 블록 — lun의 GTD 강조 레이아웃 */}
        <div className="absolute bottom-0 left-0 right-0 p-3.5 z-10">
          {/* 토너 이름 — 굵고 크게 */}
          <div
            className="text-[15px] font-extrabold text-white leading-snug"
            style={{ textShadow: '0 1px 6px rgba(0,0,0,0.60)' }}
          >
            {primary.tournamentName}
          </div>
          {/* 바이인 — 금색 강조 */}
          {primary.buyIn > 0 && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.60)' }}>바이인</span>
              <span className="stat-number text-[13px] font-extrabold" style={{ color: '#F59E0B' }}>
                ₩{primary.buyIn.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 정보 영역 — 다크 배경 위 라이트 텍스트. 레벨 + 블라인드 + 인원 한눈에. */}
      <div className="px-3.5 py-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-bold truncate text-white flex-1 min-w-0">
            {group.storeName}
          </div>
          <CountdownPill session={primary} />
        </div>
        {/* 핵심 지표 한 줄 — Lv · SB/BB · 인원 */}
        <div className="flex items-center gap-3 text-[11px]" style={{ color: 'rgba(255,255,255,0.65)' }}>
          <span className="font-bold">
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>Lv </span>
            <span className="font-mono font-extrabold text-white">{primary.currentLevel}</span>
          </span>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
          <span className="font-mono font-bold tracking-tight">
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>블라인드 </span>
            <span className="text-white">{primary.smallBlind}/{primary.bigBlind}</span>
          </span>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
          <span className="font-bold">
            <span className="font-mono font-extrabold text-white">{primary.playersRemaining}</span>
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>명</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

/* LIVE 없을 때 히어로 */
function LiveEmptyHero() {
  return (
    <div className="mx-4">
      <Link
        href="/m/discover"
        className="block rounded-3xl overflow-hidden card-hover"
        style={{
          background: 'linear-gradient(135deg, var(--brand-pale) 0%, #fff 100%)',
          border: '1px solid rgba(255,31,143,0.15)',
          padding: '24px 20px',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--brand)' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" fill="#fff" stroke="none"/>
              <path d="M16.5 7.5a6.5 6.5 0 010 9M7.5 7.5a6.5 6.5 0 000 9"/>
            </svg>
          </div>
          <div>
            <div className="text-[15px] font-extrabold" style={{ color: 'var(--text-1)' }}>
              현재 진행 중인 LIVE 없음
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>
              주변 홀덤펍 지도로 탐색하기 →
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}

/* 카운트다운 알약 */
function CountdownPill({ session }: { session: LiveSession }) {
  const sec = useLiveCountdown(session);
  const paused = session.status === 'paused';
  return (
    <div
      className="flex-shrink-0 rounded-full px-3 py-1.5 ml-2"
      style={{
        background: paused ? 'rgba(245,158,11,0.15)' : 'rgba(229,62,62,0.15)',
        border: `1px solid ${paused ? 'rgba(245,158,11,0.30)' : 'rgba(229,62,62,0.30)'}`,
      }}
    >
      <span
        className="font-mono text-[13px] font-extrabold stat-number"
        style={{ color: paused ? '#F59E0B' : '#FC8181' }}
      >
        {fmtTime(sec)}
      </span>
    </div>
  );
}

/* 스켈레톤 */
function LiveHeroSkeleton() {
  return (
    <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-1">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="w-[280px] flex-shrink-0 rounded-3xl overflow-hidden"
          style={{ border: '1px solid var(--border)' }}
        >
          <div className="skeleton" style={{ aspectRatio: '16/9' }} />
          <div className="p-3.5 space-y-2" style={{ background: 'var(--surface-2)' }}>
            <div className="skeleton h-4 w-3/4 rounded" />
            <div className="skeleton h-3 w-1/2 rounded" />
          </div>
        </div>
      ))}
      <div className="w-3 flex-shrink-0" aria-hidden="true" />
    </div>
  );
}

/* ============================================================
 * 인기 매장 아바타 가로 스크롤 — popularity 점수 + 위치 10km 자동 확장
 * 정책: project_holdemnow_popularity (LIVE×2 + favoriteAdds + directionsClicks + 신규부스트 − 거리감점)
 * ========================================================== */
function PopularStoresAvatarScroll({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<PopularityStore[]>([]);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [appliedRadiusKm, setAppliedRadiusKm] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const tid = setTimeout(() => setUserLocation(null), 0);
      return () => clearTimeout(tid);
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPopularStores(userLocation)
      .then((res) => {
        if (cancelled) return;
        setStores(res.stores);
        setExpanded(res.expanded);
        setAppliedRadiusKm(res.appliedRadiusM > 0 ? Math.round(res.appliedRadiusM / 1000) : null);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [userLocation]);

  if (loaded && stores.length === 0) return null;

  return (
    <section aria-label="내 주변 인기 매장" className="py-5">
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
            내 주변 인기 매장
          </div>
          {appliedRadiusKm != null && (
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {expanded
                ? `주변 매장이 적어 ${appliedRadiusKm}km까지 범위를 넓혔어요`
                : `반경 ${appliedRadiusKm}km · LIVE 운영 활발한 매장 우선`}
            </div>
          )}
        </div>
        <Link
          href="/m/discover"
          className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60 mb-0.5"
          style={{ color: 'var(--brand)' }}
        >
          전체보기
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </Link>
      </div>
      <div className="pl-4 flex gap-4 overflow-x-auto scrollbar-none pb-1">
        {stores.map((st) => {
          const isLive = (liveByStore[st.id] || 0) > 0;
          const photo = st.photoUrls[0];
          return (
            <Link
              key={st.id}
              href={`/m/store/${st.id}`}
              onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 transition active:scale-95"
              style={{ width: 64 }}
            >
              <div
                className={`store-avatar-ring${isLive ? ' live-ring' : ''}`}
                style={{ width: 60, height: 60, position: 'relative' }}
              >
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={st.name} className="w-full h-full object-cover" style={{ borderRadius: '50%' }} />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)', borderRadius: '50%' }}
                  >
                    <span className="text-[16px] font-extrabold" style={{ color: 'var(--brand)' }}>
                      {st.name.charAt(0)}
                    </span>
                  </div>
                )}
                {isLive && (
                  <span
                    className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white pulse-live"
                    style={{ background: 'var(--live)' }}
                    aria-label="LIVE 중"
                  />
                )}
              </div>
              <span
                className="text-[11px] font-semibold text-center leading-tight"
                style={{ color: 'var(--text-2)', width: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {st.name}
              </span>
            </Link>
          );
        })}
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>
    </section>
  );
}

/* ============================================================
 * 🆕 새로 합류한 매장 — 가입 30일 이내, 거리순
 * 인기 신호와 무관 — 신규 매장 노출 보장 (카톡방 사장님 retention)
 * ========================================================== */
function NewlyJoinedStoresSection({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<PopularityStore[]>([]);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const tid = setTimeout(() => setUserLocation(null), 0);
      return () => clearTimeout(tid);
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRecentlyJoinedStores(userLocation)
      .then((list) => {
        if (cancelled) return;
        setStores(list);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userLocation]);

  if (loaded && stores.length === 0) return null;

  return (
    <section aria-label="새로 합류한 매장" className="py-5">
      <div className="px-4 flex items-end justify-between mb-3">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
            <span>🆕</span>
            <span>새로 합류한 매장</span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            최근 30일 가입 · {userLocation ? '거리순' : '가입 최신순'}
          </div>
        </div>
      </div>
      <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
        {stores.map((st) => {
          const isLive = (liveByStore[st.id] || 0) > 0;
          const photo = st.photoUrls[0];
          return (
            <Link
              key={st.id}
              href={`/m/store/${st.id}`}
              onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
              className="w-[140px] flex-shrink-0 rounded-2xl overflow-hidden card-hover"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
            >
              <div className="relative overflow-hidden" style={{ aspectRatio: '1', background: 'var(--surface-2)' }}>
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={st.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}>
                    <span className="text-[20px] font-extrabold" style={{ color: 'var(--brand)' }}>{st.name.charAt(0)}</span>
                  </div>
                )}
                <span
                  className="absolute top-2 left-2 text-[9px] font-extrabold rounded-full px-2 py-0.5"
                  style={{ background: 'var(--brand)', color: '#fff' }}
                >
                  NEW
                </span>
                {isLive && (
                  <div className="absolute top-2 right-2">
                    <span className="badge-live" style={{ fontSize: 9, padding: '2px 6px' }}>
                      <span className="dot" />
                      LIVE
                    </span>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 h-10" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 100%)' }} aria-hidden="true" />
              </div>
              <div className="px-2.5 pt-2.5 pb-2">
                <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</div>
                {st.address && (
                  <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
                    {st.address.split(' ').slice(1, 3).join(' ')}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>
    </section>
  );
}

/* ============================================================
 * 주변 매장 섹션 — 큰 정사각 사진 카드 가로 스크롤 + 리스트
 * ========================================================== */
const NEARBY_RADIUS_STEPS_KM = [20, 40, 60, 80, 100] as const;
const NEARBY_RADIUS_INITIAL_KM = 20;
const NEARBY_RADIUS_MAX_KM = 100;

const NEARBY_LIST_INITIAL_COUNT = 20;

function NearbyStoresSection({ liveByStore }: { liveByStore: Record<string, number> }) {
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(NEARBY_RADIUS_INITIAL_KM);
  const [listExpanded, setListExpanded] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    getDocs(collection(db, 'stores')).then((snap) => {
      setStores(snap.docs.map((d) => {
        const data = d.data() as {
          name: string; address?: string; photoUrls?: string[];
          facilities?: string[]; tier?: string; lat?: number; lng?: number;
        };
        return {
          id: d.id, name: data.name, address: data.address,
          photoUrl: data.photoUrls?.[0], facilities: data.facilities,
          tier: data.tier, lat: data.lat, lng: data.lng,
        };
      }));
    });
  }, []);

  const sorted = useMemo(() => {
    return stores
      .map((s) => ({
        ...s,
        distance:
          userLocation && typeof s.lat === 'number' && typeof s.lng === 'number'
            ? haversineMeters(userLocation, { lat: s.lat, lng: s.lng })
            : undefined,
      }))
      .sort((a, b) => {
        if (a.distance != null && b.distance != null) return a.distance - b.distance;
        if (a.distance != null) return -1;
        if (b.distance != null) return 1;
        return 0;
      });
  }, [stores, userLocation]);

  const visible = useMemo(() => {
    if (!userLocation) return sorted;
    const maxM = radiusKm * 1000;
    return sorted.filter((s) => s.distance != null && s.distance <= maxM);
  }, [sorted, userLocation, radiusKm]);

  const nextRadiusKm = userLocation
    ? NEARBY_RADIUS_STEPS_KM.find((r) => r > radiusKm) ?? null
    : null;
  const moreCount = useMemo(() => {
    if (!userLocation || nextRadiusKm == null) return 0;
    const nextMaxM = nextRadiusKm * 1000;
    const inNext = sorted.filter((s) => s.distance != null && s.distance <= nextMaxM).length;
    return Math.max(0, inNext - visible.length);
  }, [sorted, userLocation, nextRadiusKm, visible.length]);

  const canExpand = nextRadiusKm != null && radiusKm < NEARBY_RADIUS_MAX_KM;

  if (stores.length === 0) return null;

  return (
    <section aria-label="내 주변 매장" className="pt-5">
      {/* 섹션 헤더 */}
      <div className="px-4 flex items-end justify-between mb-4">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
            내 주변 매장
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {userLocation
              ? `현재 위치 기준 · 반경 ${radiusKm}km · `
              : '위치 권한 허용 시 거리 표시'}
            {userLocation && (
              <span className="font-bold stat-number" style={{ color: 'var(--brand)' }}>{visible.length}개</span>
            )}
          </div>
        </div>
        <Link
          href="/m/discover"
          className="text-[12px] font-semibold flex items-center gap-0.5 transition active:opacity-60 mb-1"
          style={{ color: 'var(--brand)' }}
        >
          지도로 보기
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </Link>
      </div>

      {/* 가로 스크롤 큰 정사각 카드 */}
      <div className="pl-4 flex gap-3 overflow-x-auto scrollbar-none pb-2">
        {visible.slice(0, 10).map((st) => (
          <NearbyStoreSquareCard key={st.id} store={st} live={liveByStore[st.id] || 0} />
        ))}
        {/* 지도로 더보기 카드 */}
        <Link
          href="/m/discover"
          className="w-[140px] flex-shrink-0 rounded-2xl flex flex-col items-center justify-center gap-2 transition active:scale-95"
          style={{
            aspectRatio: '1',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
          aria-label="전체 매장 보기"
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface-3)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-2)' }} aria-hidden="true">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>지도로</span>
        </Link>
        <div className="w-3 flex-shrink-0" aria-hidden="true" />
      </div>

      {/* 거리순 리스트 — 기본 1~20개, 펼치기로 전체 */}
      <div className="mt-4">
        {(listExpanded ? visible : visible.slice(0, NEARBY_LIST_INITIAL_COUNT)).map((st, idx) => (
          <NearbyStoreListRow key={st.id} store={st} live={liveByStore[st.id] || 0} rank={idx + 1} />
        ))}
      </div>

      {/* 펼치기/접기 토글 — 20개 초과 시만 노출 */}
      {visible.length > NEARBY_LIST_INITIAL_COUNT && (
        <div className="px-4 pt-3">
          <button
            onClick={() => setListExpanded((v) => !v)}
            className="w-full py-3 rounded-2xl text-[13px] font-bold transition active:scale-[0.99] flex items-center justify-center gap-1.5"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
            aria-expanded={listExpanded}
          >
            {listExpanded ? (
              <>
                접기
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>
              </>
            ) : (
              <>
                <span>더 보기</span>
                <span className="stat-number" style={{ color: 'var(--brand)' }}>
                  +{visible.length - NEARBY_LIST_INITIAL_COUNT}개
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
              </>
            )}
          </button>
        </div>
      )}

      {/* 단계 확장 더보기 — 반경 늘리기 */}
      {canExpand && (
        <div className="px-4 pt-3 pb-1">
          <button
            onClick={() => setRadiusKm(nextRadiusKm!)}
            className="w-full py-3 rounded-2xl text-[13px] font-bold transition active:scale-[0.99]"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          >
            더 멀리 보기 · 반경 {nextRadiusKm}km
            {moreCount > 0 && (
              <span style={{ color: 'var(--brand)', fontWeight: 800 }} className="stat-number"> · +{moreCount}개</span>
            )}
          </button>
        </div>
      )}
      {!canExpand && userLocation && (
        <div className="px-4 pt-3 text-center text-[11px]" style={{ color: 'var(--text-3)' }}>
          최대 반경({NEARBY_RADIUS_MAX_KM}km)까지 모두 표시됨
        </div>
      )}
    </section>
  );
}

/* 정사각 앨범 카드 (가로 스크롤용) */
function NearbyStoreSquareCard({ store: st, live }: { store: NearbyStore; live: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'home-nearby'); }, [st.id]);
  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="w-[140px] flex-shrink-0 rounded-2xl overflow-hidden card-hover"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="relative overflow-hidden" style={{ aspectRatio: '1', background: 'var(--surface-2)' }}>
        {st.photoUrl
          ? <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
          : (
            <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}>
              <span className="text-[24px] font-extrabold" style={{ color: 'var(--brand)', opacity: 0.4 }}>{st.name.charAt(0)}</span>
            </div>
          )
        }
        {/* 좌상단 배지 */}
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {st.distance != null && (
            <span
              className="text-[10px] font-bold rounded-full px-2 py-0.5"
              style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)' }}
            >
              {formatDistance(st.distance)}
            </span>
          )}
          {st.tier === 'vip' && (
            <span className="text-[9px] font-extrabold rounded-full px-2 py-0.5" style={{ background: 'var(--gold)', color: '#fff' }}>
              VIP
            </span>
          )}
        </div>
        {/* 우상단 LIVE */}
        {live > 0 && (
          <div className="absolute top-2 right-2">
            <span className="badge-live" style={{ fontSize: 9, padding: '2px 6px' }}>
              <span className="dot" />
              LIVE
            </span>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 h-10" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 100%)' }} aria-hidden="true" />
      </div>
      <div className="px-2.5 pt-2.5 pb-2">
        <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</div>
        {st.address && (
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
            {st.address.split(' ').slice(1, 3).join(' ')}
          </div>
        )}
      </div>
    </Link>
  );
}

/* 리스트 로우 */
function NearbyStoreListRow({ store: st, live, rank }: { store: NearbyStore; live: number; rank: number }) {
  useEffect(() => { trackImpressionOnce(st.id, 'home-nearby-list'); }, [st.id]);
  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="flex items-center gap-3 px-4 py-3 transition active:bg-gray-50"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <span
        className="w-6 text-center text-[13px] font-extrabold flex-shrink-0 stat-number"
        style={{ color: rank <= 3 ? 'var(--brand)' : 'var(--text-3)' }}
      >
        {rank}
      </span>
      <div
        className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden"
        style={{ background: 'var(--surface-2)' }}
      >
        {st.photoUrl
          ? <img src={st.photoUrl} alt={st.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}>
              <span className="text-[14px] font-extrabold" style={{ color: 'var(--brand)', opacity: 0.5 }}>{st.name.charAt(0)}</span>
            </div>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{st.name}</span>
          {st.tier === 'vip' && (
            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: 'var(--gold)', color: '#fff' }}>VIP</span>
          )}
        </div>
        <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
          {st.distance != null && (
            <span className="font-semibold stat-number" style={{ color: 'var(--text-2)' }}>{formatDistance(st.distance)} · </span>
          )}
          {st.address ? st.address.split(' ').slice(1, 3).join(' ') : ''}
        </div>
      </div>
      {live > 0 ? (
        <span className="badge-live flex-shrink-0">
          <span className="dot" />
          LIVE
        </span>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)', flexShrink: 0 }} aria-hidden="true">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      )}
    </Link>
  );
}

/* ============================================================
 * 시리즈 포스터 카드
 * ========================================================== */
function SeriesPosterCard({ series }: { series: Series }) {
  const poster = posterStyleFor(series.posterStyle);
  const dDays = series.finalDate
    // eslint-disable-next-line react-hooks/purity
    ? Math.ceil((series.finalDate.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const statusLabel = series.status === 'active' ? '진행 중' : series.status === 'upcoming' ? '예정' : '종료';
  const statusBg = series.status === 'active' ? 'var(--live)' : series.status === 'upcoming' ? 'var(--brand)' : 'var(--text-3)';

  return (
    <Link
      href={`/m/series/${series.id}`}
      className="w-[220px] flex-shrink-0 rounded-2xl overflow-hidden card-hover"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="h-[120px] relative" style={{ background: poster.bg, color: poster.color }}>
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
          <span
            className="text-[10px] font-extrabold rounded-full px-2.5 py-1"
            style={{ background: statusBg, color: '#fff' }}
          >
            {statusLabel}
          </span>
          {dDays !== null && dDays > 0 && series.status !== 'completed' && (
            <span
              className="text-[10px] font-bold rounded-full px-2.5 py-1 stat-number"
              style={{ background: 'rgba(0,0,0,0.35)', color: '#fff' }}
            >
              D-{dDays}
            </span>
          )}
        </div>
        <div className="absolute bottom-3 left-3 right-3">
          <div className="text-[10px] opacity-75 mb-0.5">{series.season}</div>
          <div className="text-[15px] font-extrabold leading-tight">{series.name}</div>
        </div>
      </div>
      <div className="p-3">
        <div className="text-[11px] mb-0.5" style={{ color: 'var(--text-3)' }}>본선 게런티</div>
        <div className="font-mono text-[16px] font-extrabold stat-number" style={{ color: 'var(--gold)' }}>
          ₩{(series.finalGuarantee / 100000000).toFixed(1)}억
        </div>
        <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
          <span>협력 매장</span>
          <span className="font-semibold stat-number" style={{ color: 'var(--text-2)' }}>{series.partnerStoreIds.length}곳</span>
        </div>
      </div>
    </Link>
  );
}

/* ============================================================
 * 콘텐츠 피드 자리 — 추후 SNS 게시글/영상으로 교체
 * ========================================================== */
function ContentFeedPlaceholder() {
  return (
    <section aria-label="커뮤니티" className="py-5">
      <div className="px-4 flex items-center justify-between mb-3">
        <div>
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
            커뮤니티
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            매장 소식 · 리뷰 · 후기 — 준비 중
          </div>
        </div>
      </div>

      {/* 2열 그리드 placeholder */}
      <div className="px-4 grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="content-card-placeholder"
            style={{ aspectRatio: '4/3', padding: '16px' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {i % 2 === 0 ? (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21"/>
                </>
              ) : (
                <>
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </>
              )}
            </svg>
            <span className="text-[11px] font-semibold text-center" style={{ color: 'var(--text-3)' }}>
              {i % 2 === 0 ? '매장 사진' : '리뷰'}
            </span>
          </div>
        ))}
      </div>

      {/* 오픈 예정 배너 */}
      <div
        className="mx-4 mt-4 rounded-2xl px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--brand-pale)', border: '1px solid rgba(255,31,143,0.15)' }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--brand)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <div>
          <div className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
            커뮤니티 기능 오픈 예정
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--brand)' }}>
            매장 리뷰 · 체크인 · 소식 알림
          </div>
        </div>
      </div>
    </section>
  );
}
