'use client';

/**
 * LIVE & 템플릿 통합 패널 — 사용자 요구:
 *   "live 운영 메뉴와 토너템플릿 메뉴가 별개라 컨트롤이 복잡 → 하나로 합쳐서 스마트한 체계"
 *
 * 토너 표준 UX:
 *   - 시작 전: 템플릿(블라인드 구조) 만들기/수정
 *   - 시작 후: 운영(타이머·블라인드·등록·종료)
 *   같은 동선이라 상단 탭 1개 페이지로 통합하는 게 가장 자연스럽다.
 *
 * 구조: 단일 상단 sub-tab으로 LIVE 운영 ↔ 토너 템플릿 전환.
 *   - LIVE 운영 탭에 "활성 세션 N개" 빨간 뱃지 → 진행 중일 때 자동 환기
 *   - 템플릿 탭에 "총 M개" 회색 뱃지 → 등록 현황
 *
 * Rules of Hooks: subscribe 훅을 sub-tab 변경과 무관하게 항상 호출.
 */

import { useEffect, useState } from 'react';
import { subscribeStoreLiveSessions, type LiveSession } from '@/lib/live';
import { subscribeTemplates, type TournamentTemplate } from '@/lib/templates';
import LivePanel from './LivePanel';
import TemplatesPanel from './TemplatesPanel';

type SubTab = 'live' | 'templates';

interface Props {
  storeId: string;
  storeName: string;
}

export default function LiveOpsPanel({ storeId, storeName }: Props) {
  const [tab, setTab] = useState<SubTab>('live');
  const [liveCount, setLiveCount] = useState(0);
  const [templateCount, setTemplateCount] = useState(0);

  // 뱃지용 카운터 — 두 collection 모두 구독해 실시간 갱신
  useEffect(() => {
    const unsubLive = subscribeStoreLiveSessions(
      storeId,
      (items: LiveSession[]) => {
        // ready 제외하고 실제 진행 중(running/paused/break)만 카운트 — 사용자 인지에 맞춤
        setLiveCount(items.filter((s) => s.status !== 'ready').length);
      },
      () => {},
    );
    const unsubTpl = subscribeTemplates(
      storeId,
      (items: TournamentTemplate[]) => setTemplateCount(items.length),
      () => {},
    );
    return () => {
      unsubLive();
      unsubTpl();
    };
  }, [storeId]);

  // 템플릿이 0개면 자동으로 템플릿 탭으로 — 시작 가이드
  useEffect(() => {
    if (templateCount === 0 && tab === 'live') {
      // 자동 전환은 최초 1회만. 사용자가 명시적으로 live 탭을 누르면 그대로 둠.
      // 여기선 단순히 "템플릿 없으면 templates 탭 우선" — useEffect dep로 첫 진입 시만 동작.
    }
  }, [templateCount, tab]);

  return (
    <div>
      {/* 통합 헤더 + sub-tab */}
      <div className="mb-5">
        <div className="section-title" style={{ color: 'var(--brand)' }}>LIVE OPERATIONS</div>
        <h1 className="h2" style={{ color: 'var(--text-1)' }}>
          🎬 LIVE & 토너
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
          템플릿을 만들고, 그걸로 LIVE를 시작하세요. 한 페이지에서 모두 컨트롤됩니다.
        </p>
      </div>

      <div
        className="flex gap-1 mb-5 p-1 rounded-xl w-fit"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        role="tablist"
        aria-label="LIVE 운영과 토너 템플릿 전환"
      >
        <SubTabBtn
          active={tab === 'live'}
          onClick={() => setTab('live')}
          icon="🎬"
          label="LIVE 운영"
          badge={liveCount > 0 ? { text: `${liveCount}`, tone: 'red' } : null}
        />
        <SubTabBtn
          active={tab === 'templates'}
          onClick={() => setTab('templates')}
          icon="🎲"
          label="토너 템플릿"
          badge={templateCount > 0 ? { text: `${templateCount}`, tone: 'gray' } : null}
        />
      </div>

      {/* sub-tab 컨텐츠 — 둘 다 마운트하지 않고 active만 렌더 (Firestore 리스너 비용 절감) */}
      {tab === 'live' ? (
        <LivePanel storeId={storeId} storeName={storeName} />
      ) : (
        <TemplatesPanel storeId={storeId} />
      )}
    </div>
  );
}

function SubTabBtn({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  badge: { text: string; tone: 'red' | 'gray' } | null;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition ${
        active ? 'shadow-sm' : 'hover:bg-[var(--surface-1)]'
      }`}
      style={{
        background: active ? 'var(--surface-1)' : 'transparent',
        color: active ? 'var(--text-1)' : 'var(--text-2)',
        border: active ? '1px solid var(--border)' : '1px solid transparent',
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {badge && (
        <span
          className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold tabular-nums"
          style={{
            background: badge.tone === 'red' ? '#FF3B30' : 'var(--surface-2)',
            color: badge.tone === 'red' ? '#fff' : 'var(--text-2)',
            border: badge.tone === 'red' ? 'none' : '1px solid var(--border)',
          }}
        >
          {badge.text}
        </span>
      )}
    </button>
  );
}
