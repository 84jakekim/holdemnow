'use client';

import { useAuth } from '@/lib/hooks';
import EventsPanel from '@/components/admin/EventsPanel';

/**
 * 본사 어드민 — 대회 큐레이션 페이지.
 *
 * - WSOP·EPT 같은 글로벌 대회를 본사가 직접 등록 (isPlatformPosted=true)
 * - 모든 대회사가 올린 대회도 모니터링 가능 (별도 패널 v0.2)
 */
export default function PlatformEventsPage() {
  const authState = useAuth();
  if (authState.status !== 'authenticated') return null;
  return (
    <div>
      <EventsPanel
        ownerUid={authState.user.uid}
        isPlatformMode
      />
    </div>
  );
}
