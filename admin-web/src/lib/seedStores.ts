'use client';

import {
  collection,
  getDocs,
  writeBatch,
  doc,
  serverTimestamp,
  query,
  where,
} from 'firebase/firestore';
import { db } from './firebase';

/** 본사 관리자가 일회성으로 추가하는 데모 매장 5개. 좌표 포함 — Discover 첫 진입 시 즉시 마커 표시. */
export const DEMO_STORES = [
  {
    id: 'demo-store-seomyeon',
    name: '서면 ABC홀덤',
    address: '부산광역시 부산진구 서면로 23',
    addressDetail: '2층',
    phone: '051-802-0001',
    hours: '매일 18:00 - 익일 05:00',
    description: '서면 중심부 30평 규모. 토너·캐쉬 동시 운영, 부산진구 최대.',
    facilities: ['주차', '발렛', '식사', '24시간'],
    lat: 35.1576,
    lng: 129.0596,
  },
  {
    id: 'demo-store-haeundae',
    name: '해운대 포커펍',
    address: '부산광역시 해운대구 해운대로 145',
    addressDetail: 'B1',
    phone: '051-744-0002',
    hours: '매일 19:00 - 익일 04:00',
    description: '해운대 바닷가 인근, 캐쉬게임 특화 매장.',
    facilities: ['주차', '식사'],
    lat: 35.1631,
    lng: 129.1635,
  },
  {
    id: 'demo-store-gwangalli',
    name: '광안리 카드클럽',
    address: '부산광역시 수영구 광안해변로 219',
    addressDetail: '3층',
    phone: '051-621-0003',
    hours: '매일 18:00 - 익일 06:00',
    description: '메이저 토너 시리즈 협력 매장. VIP룸 보유.',
    facilities: ['주차', '발렛', '식사', '24시간', 'VIP룸'],
    lat: 35.1531,
    lng: 129.1185,
  },
  {
    id: 'demo-store-dongnae',
    name: '동래 그랜드홀덤',
    address: '부산광역시 동래구 충렬대로 108',
    addressDetail: '',
    phone: '051-552-0004',
    hours: '매일 17:00 - 익일 03:00',
    description: '위성 예선 개최 매장. 동래 권역 인지도 1위.',
    facilities: ['주차', '식사'],
    lat: 35.2052,
    lng: 129.0832,
  },
  {
    id: 'demo-store-centum',
    name: '센텀 카지노펍',
    address: '부산광역시 해운대구 센텀중앙로 79',
    addressDetail: '5층',
    phone: '051-731-0005',
    hours: '매일 18:00 - 익일 05:00',
    description: '센텀시티 인근 고급 매장. 룸·VIP 코너 보유.',
    facilities: ['주차', '발렛', '식사', '24시간', 'VIP룸', '룸'],
    lat: 35.1696,
    lng: 129.1306,
  },
];

const DEMO_STORE_IDS = DEMO_STORES.map((s) => s.id);

/** 5개 데모 매장 중 이미 생성된 개수를 확인 */
export async function countSeededDemoStores(): Promise<number> {
  const snap = await getDocs(
    query(collection(db, 'stores'), where('isDemo', '==', true)),
  );
  return snap.size;
}

/** 5개 데모 매장 일괄 생성 (멱등 — 이미 있으면 덮어쓰기) */
export async function seedDemoStores(ownerUid: string): Promise<number> {
  const batch = writeBatch(db);
  for (const s of DEMO_STORES) {
    const ref = doc(db, 'stores', s.id);
    batch.set(ref, {
      id: s.id,
      ownerUid,
      name: s.name,
      address: s.address,
      addressDetail: s.addressDetail,
      phone: s.phone,
      hours: s.hours,
      description: s.description,
      facilities: s.facilities,
      photoUrls: [],
      lat: s.lat,
      lng: s.lng,
      status: 'active',
      tier: 'free',
      reviewCount: 0,
      liveSessionCount: 0,
      isDemo: true, // 본사 관리자 1클릭 삭제 식별용
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return DEMO_STORES.length;
}

/** 5개 데모 매장 일괄 삭제 (본사 관리자) */
export async function removeDemoStores(): Promise<number> {
  const batch = writeBatch(db);
  for (const id of DEMO_STORE_IDS) {
    batch.delete(doc(db, 'stores', id));
  }
  await batch.commit();
  return DEMO_STORE_IDS.length;
}
