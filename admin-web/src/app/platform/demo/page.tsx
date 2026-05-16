'use client';

import { useAuth } from '@/lib/hooks';
import DemoStoresCard from '@/components/admin/DemoStoresCard';

export default function PlatformDemoPage() {
  const authState = useAuth();
  if (authState.status !== 'authenticated') return null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">🛠 데모 데이터 관리</h1>
        <p className="text-sm text-gray-500 mt-1">카톡방 사장님 가입 전 임시 매장·데이터</p>
      </div>

      <DemoStoresCard ownerUid={authState.user.uid} />

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-xs text-gray-600 leading-relaxed">
        <div className="font-bold text-gray-900 mb-2">💡 사용 시점</div>
        <ul className="list-disc list-inside space-y-1.5">
          <li>카톡방 사장님이 아직 가입하지 않은 초기 단계에서, 모바일 앱 동작·UI 검증을 위해 임시 매장을 생성</li>
          <li>본사 관리자(현재 계정) 소유로 등록 — 사진·정보 수정 가능하지만 별도 매장 어드민 진입은 v0.2 (multi-store)</li>
          <li>실제 매장이 가입을 시작하면 "삭제"로 한 번에 정리</li>
        </ul>
      </div>
    </div>
  );
}
