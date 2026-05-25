'use client';

/**
 * /preview/rabbit-logo — Pink Rabbit handoff RabbitLogo 컴포넌트 미리보기
 *
 * 2026-05-25 신설. Claude Design 핸드오프(claude-design/pimk-rabbit/)에서 추출한
 * 단일 SVG 토끼 로고를 라이트/다크 양쪽 + 모든 size/variant 조합으로 빠르게 확인.
 *
 * 신규 utility (.lift / .tap / .skel / .pill / .mono)도 함께 렌더하여 즉시 시각 검증.
 *
 * 개발용 페이지로 라우터에 자연 노출되지만 메뉴/링크에선 미연결.
 */

import { useState } from 'react';
import { RabbitLogo, Card, Button } from '@/components/ui';

const SIZES = [24, 32, 48, 64, 96] as const;
const VARIANTS = ['badge', 'mark'] as const;

export default function RabbitLogoPreview() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  return (
    <div
      data-theme={theme}
      style={{ background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh' }}
    >
      <div className="max-w-[960px] mx-auto px-6 py-12">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <RabbitLogo size={56} variant="badge" glow />
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">RabbitLogo Preview</h1>
              <p className="text-sm text-[var(--text-2)] mt-1">
                Pink Rabbit handoff · /preview/rabbit-logo
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </Button>
        </div>

        {/* badge variant — 사이즈 그리드 */}
        <Card variant="base" padded className="mb-6">
          <div className="mb-4">
            <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-[var(--text-2)] mb-1">
              variant: badge
            </div>
            <div className="text-sm text-[var(--text-2)]">
              라운드 박스 안에 흰 토끼 + 핑크 그라데이션 배경
            </div>
          </div>
          <div className="flex items-end gap-6 flex-wrap">
            {SIZES.map((s) => (
              <div key={s} className="flex flex-col items-center gap-2">
                <RabbitLogo size={s} variant="badge" />
                <span className="mono text-[11px] text-[var(--text-3)]">{s}px</span>
              </div>
            ))}
            <div className="flex flex-col items-center gap-2">
              <RabbitLogo size={64} variant="badge" glow />
              <span className="mono text-[11px] text-[var(--text-3)]">64 glow</span>
            </div>
          </div>
        </Card>

        {/* mark variant */}
        <Card variant="base" padded className="mb-6">
          <div className="mb-4">
            <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-[var(--text-2)] mb-1">
              variant: mark
            </div>
            <div className="text-sm text-[var(--text-2)]">
              배경 없는 핑크 그라데이션 토끼 (워드마크 옆 / 진한 배경 위)
            </div>
          </div>
          <div className="flex items-end gap-6 flex-wrap">
            {SIZES.map((s) => (
              <div key={`m-${s}`} className="flex flex-col items-center gap-2">
                <RabbitLogo size={s} variant="mark" />
                <span className="mono text-[11px] text-[var(--text-3)]">{s}px</span>
              </div>
            ))}
          </div>
        </Card>

        {/* 모든 variant 조합 표 */}
        <Card variant="ghost" padded className="mb-6">
          <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-[var(--text-2)] mb-3">
            All variants
          </div>
          <div className="grid grid-cols-2 gap-4">
            {VARIANTS.map((v) => (
              <div
                key={v}
                className="flex items-center gap-4 p-4 rounded-[var(--r-lg)] border border-[var(--border-strong)]"
                style={{ background: 'var(--surface-2)' }}
              >
                <RabbitLogo size={48} variant={v} />
                <div>
                  <div className="font-bold text-sm">{v}</div>
                  <div className="mono text-[11px] text-[var(--text-3)]">48px</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* utility 클래스 데모 */}
        <Card variant="base" padded>
          <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-[var(--text-2)] mb-3">
            Handoff utilities
          </div>
          <div className="flex flex-wrap gap-3 items-center mb-4">
            <span className="pill">.pill</span>
            <span className="pill">
              <RabbitLogo size={14} variant="mark" /> Pink Rabbit
            </span>
            <span className="badge-live">
              <span className="dot" /> LIVE
            </span>
            <span className="mono text-sm">.mono 1,234,567</span>
          </div>
          <div className="flex flex-wrap gap-3 items-center mb-4">
            <div
              className="lift tap p-4 rounded-[var(--r-lg)] border border-[var(--border)]"
              style={{ background: 'var(--surface-1)' }}
            >
              .lift + .tap (hover & active)
            </div>
            <div
              className="skel"
              style={{ width: 180, height: 40 }}
              aria-hidden="true"
            />
          </div>
        </Card>

        <div className="mt-6 text-xs text-[var(--text-3)]">
          핸드오프 원본: <span className="mono">claude-design/pimk-rabbit/project/components.jsx</span>
        </div>
      </div>
    </div>
  );
}
