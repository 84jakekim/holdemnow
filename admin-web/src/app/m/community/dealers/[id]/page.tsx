'use client';

/**
 * /m/community/dealers/[id] — 공개 딜러 상세 (2026-05-26 절충 정책)
 *
 * 정책 (memory: project_dealer_profile_v03 절충안):
 *   - 딜러 본인이 publicProfile=true 토글 켰을 때만 사용자 열람 허용
 *   - false/undefined면 BlockedContentNotice 처리 (어드민에서만 열람 가능)
 *   - 나이/성별/거주지 등 민감 필드는 v0.3 정책 그대로 숨김 (매장 owner 전용 정보)
 *   - 연락처/이력서 등 본업 매칭 정보만 노출
 */

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type DealerProfile,
  DEALER_ABILITY_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  AVAILABLE_SHIFT_LABELS,
  subscribeDealerProfile,
  reportCommunityItem,
  hasReportedCommunityItem,
} from '@/lib/community';
import { useAuth } from '@/lib/hooks';
import BlockedContentNotice from '@/components/mobile/BlockedContentNotice';

export default function DealerPublicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const authState = useAuth();
  const [item, setItem] = useState<DealerProfile | null | undefined>(undefined);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    const unsub = subscribeDealerProfile(
      id,
      (it) => setItem(it),
      () => setItem(null),
    );
    return unsub;
  }, [id]);

  useEffect(() => {
    if (authState.status !== 'authenticated') { setReported(false); return; }
    hasReportedCommunityItem(id, authState.user.uid).then(setReported).catch(() => {});
  }, [id, authState]);

  async function handleReport() {
    if (authState.status !== 'authenticated') { alert('로그인이 필요합니다'); return; }
    if (reported) return;
    const reason = window.prompt(
      '신고 사유를 선택하세요:\n1=스팸\n2=불쾌한 내용\n3=허위정보\n4=광고\n5=기타',
      '1',
    );
    if (!reason) return;
    const map: Record<string, 'spam' | 'offensive' | 'misinformation' | 'advertising' | 'other'> = {
      '1': 'spam', '2': 'offensive', '3': 'misinformation', '4': 'advertising', '5': 'other',
    };
    setReporting(true);
    try {
      await reportCommunityItem(id, authState.user.uid, map[reason.trim()] ?? 'other');
      setReported(true);
      alert('신고 접수되었습니다. 누적 3건 시 자동 숨김됩니다.');
    } catch (e) {
      alert(`신고 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReporting(false);
    }
  }

  if (item === undefined) {
    return (
      <div className="p-5 space-y-3" style={{ background: 'var(--bg)', minHeight: '100vh' }}>
        <div className="skel h-14 rounded-r-md" />
        <div className="skel h-32 rounded-r-xl" />
        <div className="skel h-24 rounded-r-xl" />
      </div>
    );
  }

  if (item === null) {
    return (
      <BlockedContentNotice
        title="딜러 프로필을 찾을 수 없어요"
        description="삭제되었거나 비공개 처리된 프로필입니다."
        backHref="/m/community/dealers"
        backLabel="딜러 목록으로"
      />
    );
  }

  // 비공개 또는 hidden → 사용자 노출 차단
  if (item.publicProfile !== true || item.status === 'hidden') {
    return (
      <BlockedContentNotice
        title="이 프로필은 비공개입니다"
        description="딜러 본인이 공개 토글을 켜야 표시됩니다. 매장 운영자라면 어드민에서 열람할 수 있습니다."
        backHref="/m/community/dealers"
        backLabel="공개 딜러 목록으로"
      />
    );
  }

  const initial = (item.displayName?.[0] ?? '?').toUpperCase();
  const hasKakao = !!item.contact?.kakaoOpenChat;
  const hasPhone = !!item.contact?.phone;

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
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
          className="w-9 h-9 flex items-center justify-center rounded-full active:bg-[var(--surface-2)]"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="flex-1 text-center text-[17px] font-extrabold tracking-tight line-clamp-1" style={{ color: 'var(--text-1)' }}>
          딜러 프로필
        </h1>
        <div className="w-9 h-9 flex-shrink-0" aria-hidden="true" />
      </header>

      <div className="pb-36">
        {/* 프로필 헤더 */}
        <div className="flex flex-col items-center pt-8 pb-6 px-5" style={{ borderBottom: '6px solid var(--surface-2)' }}>
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #FF1F8F 0%, #FF6BB5 100%)', boxShadow: '0 8px 24px rgba(255,31,143,0.25)' }}
          >
            {item.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.profileImageUrl} alt={item.displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-4xl font-extrabold text-white" aria-hidden="true">{initial}</span>
            )}
          </div>
          <div className="text-[22px] font-extrabold mt-3" style={{ color: 'var(--text-1)' }}>
            {item.displayName}
          </div>
          {item.experienceLevel && (
            <div className="text-[12px] font-bold mt-1 px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,31,143,0.10)', color: '#FF1F8F' }}>
              {EXPERIENCE_LEVEL_LABELS[item.experienceLevel]}
            </div>
          )}
          {item.region && (
            <div className="text-[12px] mt-2" style={{ color: 'var(--text-3)' }}>📍 {item.region}</div>
          )}
        </div>

        {/* 가능 분야 */}
        {(item.abilities?.length ?? 0) > 0 && (
          <div className="px-5 py-5" style={{ borderBottom: '6px solid var(--surface-2)' }}>
            <h3 className="text-[13px] font-extrabold mb-3" style={{ color: 'var(--text-3)' }}>가능 분야</h3>
            <div className="flex flex-wrap gap-1.5">
              {item.abilities.map((a) => (
                <span key={a} className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}>
                  {DEALER_ABILITY_LABELS[a]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 가용 시간 */}
        {(item.availableShifts?.length ?? 0) > 0 && (
          <div className="px-5 py-5" style={{ borderBottom: '6px solid var(--surface-2)' }}>
            <h3 className="text-[13px] font-extrabold mb-3" style={{ color: 'var(--text-3)' }}>가용 시간</h3>
            <div className="flex flex-wrap gap-1.5">
              {item.availableShifts.map((s) => (
                <span key={s} className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(255,31,143,0.08)', color: '#FF1F8F' }}>
                  {AVAILABLE_SHIFT_LABELS[s]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 자기소개 */}
        {item.bio && (
          <div className="px-5 py-5" style={{ borderBottom: '6px solid var(--surface-2)' }}>
            <h3 className="text-[13px] font-extrabold mb-3" style={{ color: 'var(--text-3)' }}>자기소개</h3>
            <p className="text-[14px] leading-loose whitespace-pre-wrap" style={{ color: 'var(--text-1)' }}>
              {item.bio}
            </p>
          </div>
        )}

        {/* 경력 사항 */}
        {item.careerHistory && (
          <div className="px-5 py-5" style={{ borderBottom: '6px solid var(--surface-2)' }}>
            <h3 className="text-[13px] font-extrabold mb-3" style={{ color: 'var(--text-3)' }}>경력 사항</h3>
            <p className="text-[14px] leading-loose whitespace-pre-wrap" style={{ color: 'var(--text-1)' }}>
              {item.careerHistory}
            </p>
          </div>
        )}

        {/* 안내 */}
        <div className="mx-5 mt-4 px-4 py-3 rounded-xl text-[12px] leading-relaxed" style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
          나이·성별·거주지 등 민감 정보는 매장 운영자에게만 공개되며 일반 사용자에게는 노출되지 않습니다.
        </div>

        {/* 신고 */}
        {authState.status === 'authenticated' && item.authorUid !== authState.user.uid && (
          <div className="px-5 pt-3">
            <button
              onClick={handleReport}
              disabled={reported || reporting}
              className="w-full py-2.5 rounded-md text-[12px] font-bold tap disabled:opacity-50"
              style={{
                background: reported ? 'var(--surface-2)' : 'transparent',
                color: reported ? 'var(--text-3)' : '#B91C1C',
                border: '1px solid ' + (reported ? 'var(--border)' : 'rgba(185,28,28,0.30)'),
              }}
            >
              {reported ? '✓ 신고 접수됨' : reporting ? '신고 중…' : '🚨 신고하기'}
            </button>
          </div>
        )}
      </div>

      {/* 하단 고정 CTA */}
      {(hasKakao || hasPhone) && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-30 px-4 pb-6 pt-3" style={{ background: 'linear-gradient(to top, var(--bg) 80%, transparent 100%)' }}>
          <div className="flex gap-2">
            {hasKakao && (
              <a
                href={item.contact!.kakaoOpenChat!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl text-[14px] font-bold transition active:opacity-75"
                style={{ background: '#FEE500', color: '#191919' }}
              >
                💬 카카오로 연락
              </a>
            )}
            {hasPhone && (
              <a
                href={`tel:${item.contact!.phone}`}
                className="flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl text-[14px] font-bold transition active:opacity-75"
                style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
              >
                📞 전화
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
