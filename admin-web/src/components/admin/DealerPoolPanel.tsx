'use client';

import { useEffect, useState, useMemo, type ReactNode } from 'react';
import {
  type DealerProfile,
  type DealerAbility,
  type ExperienceLevel,
  DEALER_ABILITY_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  AVAILABLE_SHIFT_LABELS,
  formatRelativeTime,
  subscribeAllDealerProfiles,
} from '@/lib/community';

/* ============================================================
 * DealerPoolPanel — 매장 어드민 전용 딜러 풀
 *
 * 권한: 매장 owner만 열람 (Firestore rules로 서버 검증,
 *       UI 레벨에서는 어드민 진입 자체로 owner 보장)
 * 데이터: subscribeAllDealerProfiles — type=dealerProfile + status=active
 * ========================================================== */

interface DealerPoolPanelProps {
  storeId: string;
  storeName: string;
}

type AbilityFilter = 'all' | DealerAbility;
type LevelFilter = 'all' | ExperienceLevel;

export default function DealerPoolPanel({ storeName }: DealerPoolPanelProps) {
  const [profiles, setProfiles] = useState<DealerProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abilityFilter, setAbilityFilter] = useState<AbilityFilter>('all');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [regionKeyword, setRegionKeyword] = useState('');
  const [selectedProfile, setSelectedProfile] = useState<DealerProfile | null>(null);

  useEffect(() => {
    // 사장이 권한·인덱스 에러를 인지할 수 있게 onError를 더 이상 silent 처리하지 않음.
    const unsub = subscribeAllDealerProfiles(
      {},
      (items) => { setProfiles(items); setLoaded(true); setError(null); },
      (e) => {
        // eslint-disable-next-line no-console
        console.warn('[DealerPoolPanel] 딜러 풀 구독 실패', e);
        setError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      },
    );
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    let list = profiles;
    if (abilityFilter !== 'all') {
      list = list.filter((p) => p.abilities?.includes(abilityFilter));
    }
    if (levelFilter !== 'all') {
      list = list.filter((p) => p.experienceLevel === levelFilter);
    }
    if (regionKeyword.trim()) {
      const kw = regionKeyword.trim().toLowerCase();
      list = list.filter((p) => p.region?.toLowerCase().includes(kw));
    }
    return list;
  }, [profiles, abilityFilter, levelFilter, regionKeyword]);

  return (
    <div>
      {/* ── 헤더 ── */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="section-title" style={{ color: 'var(--brand)' }}>DEALER POOL</div>
          <h1 className="h2" style={{ color: 'var(--text-1)' }}>
            🃏 딜러 풀
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            {storeName} · 활성 <b style={{ color: 'var(--brand)' }}>{profiles.length}</b>명 · {loaded ? `필터 ${filtered.length}명` : '불러오는 중…'}
          </p>
        </div>
        <div className="pr-pill" style={{ background: 'var(--brand-pale)', color: 'var(--brand)', borderColor: 'rgba(255,31,143,0.30)' }}>
          🔒 매장 대표 전용
        </div>
      </div>

      {/* ── 안내 박스 ── */}
      <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <div className="text-lg flex-shrink-0">🃏</div>
        <div className="text-xs text-amber-800 leading-relaxed">
          딜러로 등록한 사용자 프로필입니다. 연락처·나이·거주지 등 개인정보는 매장 대표에게만 공개되며,
          일반 사용자에게는 노출되지 않습니다.
          직접 연락을 원하면 카드를 클릭해 연락처를 확인하세요.
        </div>
      </div>

      {/* ── 필터바 ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 flex flex-col gap-3">
        {/* 가능분야 칩 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-gray-500 w-16 flex-shrink-0">가능분야</span>
          <div className="flex gap-1.5 flex-wrap">
            <FilterChip active={abilityFilter === 'all'} onClick={() => setAbilityFilter('all')}>
              전체
            </FilterChip>
            {(Object.keys(DEALER_ABILITY_LABELS) as DealerAbility[]).map((a) => (
              <FilterChip key={a} active={abilityFilter === a} onClick={() => setAbilityFilter(a)}>
                {DEALER_ABILITY_LABELS[a]}
              </FilterChip>
            ))}
          </div>
        </div>

        {/* 경력 단계 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-gray-500 w-16 flex-shrink-0">경력</span>
          <div className="flex gap-1.5 flex-wrap">
            <FilterChip active={levelFilter === 'all'} onClick={() => setLevelFilter('all')}>
              전체
            </FilterChip>
            {(Object.keys(EXPERIENCE_LEVEL_LABELS) as ExperienceLevel[]).map((lvl) => (
              <FilterChip key={lvl} active={levelFilter === lvl} onClick={() => setLevelFilter(lvl)}>
                {EXPERIENCE_LEVEL_LABELS[lvl]}
              </FilterChip>
            ))}
          </div>
        </div>

        {/* 지역 키워드 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500 w-16 flex-shrink-0">지역</span>
          <input
            type="text"
            value={regionKeyword}
            onChange={(e) => setRegionKeyword(e.target.value)}
            placeholder="예: 해운대, 양산, 창원…"
            className="flex-1 h-8 rounded-lg px-3 text-sm focus:outline-none"
            style={{
              border: '1.5px solid var(--border)',
              color: 'var(--text-1)',
              background: 'var(--surface-2)',
            }}
          />
          {regionKeyword && (
            <button
              onClick={() => setRegionKeyword('')}
              className="text-xs text-gray-400 hover:text-gray-700 transition"
              aria-label="지역 검색 초기화"
            >
              초기화
            </button>
          )}
        </div>
      </div>

      {/* ── 에러 안내 (권한·인덱스 실패) ── */}
      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-[12px] text-red-700">
          딜러 풀을 불러오지 못했습니다. ({error})
        </div>
      )}

      {/* ── 리스트 / 빈 상태 ── */}
      {!loaded ? (
        <div className="py-20 text-center text-sm text-gray-400">불러오는 중…</div>
      ) : filtered.length === 0 ? (
        <EmptyState hasFilter={abilityFilter !== 'all' || levelFilter !== 'all' || !!regionKeyword} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((profile) => (
            <DealerCard
              key={profile.id}
              profile={profile}
              onClick={() => setSelectedProfile(profile)}
            />
          ))}
        </div>
      )}

      {/* ── 상세 모달 ── */}
      {selectedProfile && (
        <DealerDetailModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}
    </div>
  );
}

/* ── 딜러 카드 ── */
function DealerCard({
  profile,
  onClick,
}: {
  profile: DealerProfile;
  onClick: () => void;
}) {
  const initial = (profile.displayName?.[0] ?? '?').toUpperCase();
  const expLabel = EXPERIENCE_LEVEL_LABELS[profile.experienceLevel] ?? '미입력';

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-pink-200 hover:shadow-sm transition group"
    >
      <div className="flex gap-3">
        {/* 아바타 */}
        {profile.profileImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.profileImageUrl}
            alt={profile.displayName}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center font-extrabold text-white text-lg flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BB5 100%)' }}
            aria-hidden="true"
          >
            {initial}
          </div>
        )}

        {/* 정보 */}
        <div className="flex-1 min-w-0">
          {/* 이름 + 나이·성별 */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-extrabold text-gray-900 truncate">{profile.displayName}</span>
            {(profile.age || profile.gender) && (
              <span className="text-xs text-gray-400 flex-shrink-0">
                {profile.age && `${profile.age}세`}
                {profile.age && profile.gender && ' · '}
                {profile.gender && { male: '남', female: '여', other: '기타' }[profile.gender]}
              </span>
            )}
          </div>

          {/* 경력 뱃지 + 가능분야 칩 */}
          <div className="flex gap-1 mt-1 flex-wrap items-center">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,31,143,0.10)', color: '#FF1F8F' }}
            >
              {expLabel}
            </span>
            {(profile.abilities ?? []).slice(0, 3).map((a) => (
              <span
                key={a}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"
              >
                {DEALER_ABILITY_LABELS[a]}
              </span>
            ))}
          </div>

          {/* 지역 + 거주지 */}
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {profile.region && (
              <span className="text-[11px] text-gray-500 truncate max-w-[120px]">{profile.region}</span>
            )}
            {profile.region && profile.residence && (
              <span className="text-gray-300 text-[10px]">·</span>
            )}
            {profile.residence && (
              <span className="text-[11px] text-gray-400">거주: {profile.residence}</span>
            )}
          </div>

          {/* 가용시간 + 등록일 */}
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {(profile.availableShifts ?? []).map((s) => (
              <span
                key={s}
                className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500"
              >
                {AVAILABLE_SHIFT_LABELS[s]}
              </span>
            ))}
            <span className="text-[10px] text-gray-300 ml-auto">
              {formatRelativeTime(profile.createdAt)}
            </span>
          </div>
        </div>

        {/* 화살표 */}
        <svg
          className="flex-shrink-0 self-center text-gray-300 group-hover:text-pink-400 transition"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </div>
    </button>
  );
}

/* ── 상세 모달 ── */
function DealerDetailModal({
  profile,
  onClose,
}: {
  profile: DealerProfile;
  onClose: () => void;
}) {
  const initial = (profile.displayName?.[0] ?? '?').toUpperCase();
  const expLabel = EXPERIENCE_LEVEL_LABELS[profile.experienceLevel] ?? '미입력';
  const hasKakao = !!profile.contact?.kakaoOpenChat;
  const hasPhone = !!profile.contact?.phone;
  const genderLabel: Record<string, string> = { male: '남성', female: '여성', other: '기타' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={`${profile.displayName} 딜러 상세`}
      >
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <span className="text-sm font-extrabold text-gray-900">딜러 상세</span>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 아바타 + 이름 + 뱃지 */}
          <div className="flex gap-4 items-start">
            {profile.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.profileImageUrl}
                alt={profile.displayName}
                className="w-16 h-16 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center font-extrabold text-white text-2xl flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BB5 100%)' }}
                aria-hidden="true"
              >
                {initial}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-lg font-extrabold text-gray-900">{profile.displayName}</span>
                {profile.age && (
                  <span className="text-sm text-gray-500">{profile.age}세</span>
                )}
                {profile.gender && (
                  <span className="text-sm text-gray-500">{genderLabel[profile.gender] ?? profile.gender}</span>
                )}
              </div>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                <span
                  className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(255,31,143,0.10)', color: '#FF1F8F' }}
                >
                  {expLabel}
                </span>
                {(profile.abilities ?? []).map((a) => (
                  <span key={a} className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {DEALER_ABILITY_LABELS[a]}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">{formatRelativeTime(profile.createdAt)} 등록</p>
            </div>
          </div>

          {/* 인적사항 — 거주지·연락처 */}
          {(profile.residence || profile.region || hasPhone || hasKakao) && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold text-gray-500 mb-2">인적사항 (매장 대표 전용)</p>
              {profile.residence && (
                <InfoRow icon="home" label="거주지" value={profile.residence} />
              )}
              {profile.region && (
                <InfoRow icon="map" label="활동 지역" value={profile.region} />
              )}
              {profile.contact?.phone && (
                <InfoRow icon="phone" label="전화번호" value={profile.contact.phone} />
              )}
              {profile.contact?.kakaoOpenChat && (
                <InfoRow icon="chat" label="카카오" value={profile.contact.kakaoOpenChat} isLink />
              )}
            </div>
          )}

          {/* 가용시간 */}
          {(profile.availableShifts ?? []).length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 mb-2">가용시간</p>
              <div className="flex gap-1.5 flex-wrap">
                {profile.availableShifts.map((s) => (
                  <span key={s} className="text-xs font-bold px-3 py-1 rounded-full bg-gray-100 text-gray-700">
                    {AVAILABLE_SHIFT_LABELS[s]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 자기소개 */}
          {profile.bio && (
            <div>
              <p className="text-xs font-bold text-gray-500 mb-2">자기소개</p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{profile.bio}</p>
            </div>
          )}

          {/* 경력사항 */}
          {profile.careerHistory && (
            <div>
              <p className="text-xs font-bold text-gray-500 mb-2">경력사항</p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{profile.careerHistory}</p>
            </div>
          )}

          {/* 연락 CTA */}
          {(hasKakao || hasPhone) && (
            <div className="flex gap-2 pt-1">
              {hasKakao && (
                <a
                  href={profile.contact!.kakaoOpenChat!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-11 flex items-center justify-center gap-2 rounded-xl text-sm font-bold transition hover:opacity-90"
                  style={{ background: '#FEE500', color: '#191919' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 3C6.477 3 2 6.58 2 11c0 2.75 1.57 5.17 3.97 6.67L5 21l3.32-1.77C9.39 19.72 10.67 20 12 20c5.523 0 10-3.58 10-9s-4.477-8-10-8z"/>
                  </svg>
                  카카오로 연락
                </a>
              )}
              {hasPhone && (
                <a
                  href={`tel:${profile.contact!.phone}`}
                  className="flex-1 h-11 flex items-center justify-center gap-2 rounded-xl text-sm font-bold border border-gray-200 transition hover:bg-gray-50"
                  style={{ color: 'var(--text-1)' }}
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
      </div>
    </div>
  );
}

/* ── 빈 상태 ── */
function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-16 text-center">
      <div className="text-4xl mb-3 opacity-60">🃏</div>
      <p className="font-bold text-gray-900 mb-2">
        {hasFilter ? '필터 조건에 맞는 딜러가 없습니다' : '아직 등록된 딜러가 없습니다'}
      </p>
      <p className="text-xs text-gray-500 leading-relaxed max-w-sm mx-auto">
        {hasFilter
          ? '필터를 변경하거나 초기화해보세요'
          : '카톡방에서 딜러 프로필 등록을 안내해보세요. 등록한 딜러는 이곳에 표시됩니다.'}
      </p>
    </div>
  );
}

/* ── InfoRow ── */
function InfoRow({
  label,
  value,
  icon,
  isLink,
}: {
  label: string;
  value: string;
  icon: 'home' | 'map' | 'phone' | 'chat';
  isLink?: boolean;
}) {
  const IconMap: Record<string, ReactNode> = {
    home: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
    map: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
      </svg>
    ),
    phone: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.7A2 2 0 012.18 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.15a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
      </svg>
    ),
    chat: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="#9ca3af" aria-hidden="true">
        <path d="M12 3C6.477 3 2 6.58 2 11c0 2.75 1.57 5.17 3.97 6.67L5 21l3.32-1.77C9.39 19.72 10.67 20 12 20c5.523 0 10-3.58 10-9s-4.477-8-10-8z"/>
      </svg>
    ),
  };

  return (
    <div className="flex items-start gap-2">
      <span className="flex-shrink-0 mt-0.5">{IconMap[icon]}</span>
      <span className="text-xs font-bold text-gray-500 w-14 flex-shrink-0">{label}</span>
      {isLink ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline break-all"
        >
          {value}
        </a>
      ) : (
        <span className="text-xs text-gray-800 break-all">{value}</span>
      )}
    </div>
  );
}

/* ── FilterChip ── */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex-shrink-0 px-2.5 h-7 rounded-full text-xs font-bold transition"
      style={{
        background: active ? '#FF1F8F' : '#f3f4f6',
        color: active ? '#fff' : '#374151',
      }}
    >
      {children}
    </button>
  );
}
