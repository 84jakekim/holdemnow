/**
 * EmptyState — Pink Rabbit handoff 빈 상태 카드 (v2.0, 2026-05-25)
 *
 * 사용 예:
 *   <EmptyState
 *     icon="🔍"
 *     title="검색 결과가 없어요"
 *     desc="다른 키워드를 시도해보세요."
 *     action={<Link href="/m/find" className="btn-brand">매장찾기로</Link>}
 *   />
 *
 * 의미적으로 role="status" 부여. 화면 리더에 빈 상태임을 알림.
 * 데이터/이벤트 핸들러는 받지 않음. 순수 시각 컴포넌트.
 */

import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  desc?: string;
  action?: ReactNode;
  /** 대시보드형(가운데 배치) vs 인라인형(섹션 안 작게) */
  variant?: 'block' | 'inline';
  className?: string;
}

export default function EmptyState({
  icon = '✨',
  title,
  desc,
  action,
  variant = 'block',
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={`empty-state ${className ?? ''}`}
      style={
        variant === 'inline'
          ? { padding: '20px 16px', gap: 8 }
          : undefined
      }
    >
      <div className="empty-state-icon" aria-hidden>
        {icon}
      </div>
      <div>
        <div className="empty-state-title">{title}</div>
        {desc && <div className="empty-state-desc" style={{ marginTop: 6 }}>{desc}</div>}
      </div>
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}
