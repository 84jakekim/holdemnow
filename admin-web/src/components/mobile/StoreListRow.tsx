'use client';

/**
 * StoreListRow — 공용 매장 목록 행 컴포넌트.
 *
 * find/page.tsx의 NearbyStoreListRow에서 추출.
 * /m/find (내 주변 매장 섹션)와 /m/stores (전용 목록 페이지) 양쪽에서 재사용.
 *
 * 64px 썸네일 · 2줄 구조:
 *   줄1: 매장명 + LIVE 뱃지
 *   줄2: pitch(있으면) / 거리+주소
 *   줄3: 거리+평점 or 평점+시설태그
 */

import { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { formatDistance } from '@/lib/geo';
import { bumpStoreMetric, trackImpressionOnce } from '@/lib/analytics';
import { RatingChip } from '@/components/mobile/RatingChip';

// ─── 시설 아이콘 매핑 (find/page.tsx와 동일) ──────────────────────
export const FACILITY_ICON: Record<string, string> = {
  '주차': '🚗', '발렛': '🅿️', '식사': '🍱', '24시간': '🌙',
  '흡연실': '🚬', '룸': '🚪', '여성전용시간': '👩', 'VIP룸': '💎',
};

// ─── NearbyStore 타입 (find/page.tsx와 호환) ─────────────────────
export interface NearbyStore {
  id: string;
  name: string;
  address?: string;
  photoUrl?: string;
  facilities?: string[];
  tier?: string;
  lat?: number;
  lng?: number;
  distance?: number;
  averageRating?: number;
  reviewCount?: number;
  /** 사장 한마디 자랑 — 최대 40자 */
  pitch?: string;
  /** 영업시간 문자열 */
  hours?: string;
  /** Firestore createdAt (ms epoch) */
  createdAt?: number;
}

// ─── impressionSource 타입 ────────────────────────────────────────
export type ImpressionSource =
  | 'find-nearby-list'
  | 'stores-popular-list'
  | 'stores-new-list'
  | 'stores-nearby-list';

interface StoreListRowProps {
  store: NearbyStore;
  live: number;
  rank: number;
  impressionSource?: ImpressionSource;
}

export function StoreListRow({
  store: st,
  live,
  rank,
  impressionSource = 'find-nearby-list',
}: StoreListRowProps) {
  useEffect(() => {
    trackImpressionOnce(st.id, impressionSource);
  }, [st.id, impressionSource]);

  const hasPitch = !!(st.pitch?.trim());
  const facilityLabels = (st.facilities ?? []).slice(0, 2);

  const distStr = st.distance != null ? formatDistance(st.distance) : null;
  const addrShort = st.address ? st.address.split(' ').slice(1, 3).join(' ') : '';
  const subLine = [distStr, addrShort].filter(Boolean).join(' · ');

  return (
    <Link
      href={`/m/store/${st.id}`}
      onClick={() => bumpStoreMetric(st.id, 'cardClicks')}
      className="flex items-center gap-3 px-4 py-3 transition active:bg-gray-50 tap"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {/* 순위 */}
      <span
        className="w-5 text-center text-[13px] font-extrabold flex-shrink-0 stat-number"
        style={{ color: rank <= 3 ? 'var(--brand)' : 'var(--text-3)' }}
      >
        {rank}
      </span>

      {/* 썸네일 — 64×64 정사각 */}
      <div
        className="w-16 h-16 rounded-xl flex-shrink-0 overflow-hidden relative"
        style={{ background: 'var(--surface-2)' }}
      >
        {st.photoUrl ? (
          <Image src={st.photoUrl} alt={st.name} fill className="object-cover" sizes="64px" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #FFF0F7 0%, #F3F4F6 100%)' }}
          >
            <span
              className="text-[18px] font-extrabold"
              style={{ color: 'var(--brand)', opacity: 0.45 }}
            >
              {st.name.charAt(0)}
            </span>
          </div>
        )}
        {live > 0 && (
          <span
            className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full pulse-live border-2 border-white"
            style={{ background: 'var(--live)' }}
            aria-label="LIVE 중"
          />
        )}
      </div>

      {/* 텍스트 — 최대 3줄 구조 */}
      <div className="flex-1 min-w-0">
        {/* 줄1: 매장명 + LIVE 뱃지 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-[14px] font-bold truncate leading-snug"
            style={{ color: 'var(--text-1)' }}
          >
            {st.name}
          </span>
          {live > 0 && (
            <span className="badge-live flex-shrink-0">
              <span className="dot" />LIVE
            </span>
          )}
        </div>

        {/* 줄2: pitch(있으면) or 거리+주소 */}
        {hasPitch ? (
          <div className="mt-0.5 flex items-center gap-1 min-w-0">
            <span style={{ fontSize: 10, lineHeight: 1, flexShrink: 0 }}>💬</span>
            <span
              className="text-[11px] font-semibold italic truncate"
              style={{ color: '#D4176C' }}
            >
              {st.pitch}
            </span>
          </div>
        ) : (
          subLine ? (
            <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
              {distStr && (
                <span className="font-semibold stat-number" style={{ color: 'var(--text-2)' }}>
                  {distStr}
                  {addrShort ? ' · ' : ''}
                </span>
              )}
              {addrShort}
            </div>
          ) : null
        )}

        {/* 줄3: pitch 있을 때 → 거리+평점 / 없을 때 → 평점+시설태그 */}
        {hasPitch ? (
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            {distStr && (
              <span
                className="text-[11px] stat-number font-semibold"
                style={{ color: 'var(--text-3)' }}
              >
                {distStr}
              </span>
            )}
            {(st.reviewCount ?? 0) > 0 && (
              <RatingChip rating={st.averageRating} count={st.reviewCount} size="sm" />
            )}
          </div>
        ) : (
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            {(st.reviewCount ?? 0) > 0 && (
              <RatingChip rating={st.averageRating} count={st.reviewCount} size="sm" />
            )}
            {(st.reviewCount ?? 0) === 0 &&
              facilityLabels.map((f) => (
                <span
                  key={f}
                  className="text-[10px] rounded-full px-1.5 py-0.5"
                  style={{
                    background: 'var(--surface-2)',
                    color: 'var(--text-3)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {FACILITY_ICON[f] ?? ''}{f}
                </span>
              ))}
          </div>
        )}
      </div>

      {/* 우측 화살표 */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: 'var(--text-3)', flexShrink: 0 }}
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  );
}
