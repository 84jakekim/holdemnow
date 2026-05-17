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

/**
 * 부산·양산·김해 권역 가상 홀덤펍 100개 시드.
 * 기존 5개(seedStores.ts)와 구분하기 위해 demoBatch='bulk100' 플래그를 함께 박는다.
 * 카운트·삭제 모두 이 플래그로 좁힘 — 5개 시드와 충돌 없음.
 */
const DEMO_BATCH_ID = 'bulk100';

interface Area {
  region: '부산' | '양산' | '김해';
  dong: string;
  addrPrefix: string;
  lat: number;
  lng: number;
  count: number;
}

// 합 = 65 + 17 + 18 = 100
const AREAS: Area[] = [
  // 부산 65
  { region: '부산', dong: '서면',     addrPrefix: '부산광역시 부산진구 서면로',     lat: 35.1576, lng: 129.0596, count: 14 },
  { region: '부산', dong: '해운대',   addrPrefix: '부산광역시 해운대구 해운대로',   lat: 35.1631, lng: 129.1635, count: 12 },
  { region: '부산', dong: '광안리',   addrPrefix: '부산광역시 수영구 광안해변로',   lat: 35.1531, lng: 129.1185, count: 10 },
  { region: '부산', dong: '동래',     addrPrefix: '부산광역시 동래구 충렬대로',     lat: 35.2052, lng: 129.0832, count: 8 },
  { region: '부산', dong: '대연',     addrPrefix: '부산광역시 남구 못골로',         lat: 35.1357, lng: 129.1010, count: 7 },
  { region: '부산', dong: '장전',     addrPrefix: '부산광역시 금정구 장전로',       lat: 35.2306, lng: 129.0867, count: 5 },
  { region: '부산', dong: '하단',     addrPrefix: '부산광역시 사하구 하단동',       lat: 35.1059, lng: 128.9657, count: 3 },
  { region: '부산', dong: '사상',     addrPrefix: '부산광역시 사상구 사상로',       lat: 35.1539, lng: 128.9907, count: 2 },
  { region: '부산', dong: '남포',     addrPrefix: '부산광역시 중구 남포동',         lat: 35.0980, lng: 129.0288, count: 2 },
  { region: '부산', dong: '연제',     addrPrefix: '부산광역시 연제구 연제로',       lat: 35.1762, lng: 129.0823, count: 1 },
  { region: '부산', dong: '영도',     addrPrefix: '부산광역시 영도구 봉래동',       lat: 35.0917, lng: 129.0676, count: 1 },
  // 양산 17
  { region: '양산', dong: '물금',     addrPrefix: '경상남도 양산시 물금읍 물금로',  lat: 35.3034, lng: 128.9931, count: 9 },
  { region: '양산', dong: '양산중부', addrPrefix: '경상남도 양산시 중부동',         lat: 35.3373, lng: 129.0381, count: 5 },
  { region: '양산', dong: '양주',     addrPrefix: '경상남도 양산시 양주동',         lat: 35.3500, lng: 129.0500, count: 3 },
  // 김해 18
  { region: '김해', dong: '장유',     addrPrefix: '경상남도 김해시 장유로',         lat: 35.2010, lng: 128.8138, count: 9 },
  { region: '김해', dong: '내외동',   addrPrefix: '경상남도 김해시 내외중앙로',     lat: 35.2310, lng: 128.8898, count: 6 },
  { region: '김해', dong: '진영',     addrPrefix: '경상남도 김해시 진영읍 진영로',  lat: 35.2814, lng: 128.7383, count: 3 },
];

const THEMES = [
  '그랜드', '로얄', '프리미엄', '유니온', '킹스', '에이스', '조커', '스페이드',
  '다이아', '잭팟', '올인', '리버', '텍사스', '월드', '체리', '포커페이스',
  '원더', '시그니처', 'VIP', '챔피언',
];
const SHOP_TYPES = [
  '홀덤펍', '포커펍', '포커클럽', '카드클럽', '홀덤하우스', '텍사스홀덤',
  '포커라운지', '홀덤바', '카드하우스', '홀덤',
];
const HOURS_POOL = [
  '매일 18:00 - 익일 05:00',
  '매일 19:00 - 익일 04:00',
  '매일 17:00 - 익일 03:00',
  '매일 18:00 - 익일 06:00',
  '평일 19:00 - 익일 04:00 / 주말 17:00 - 익일 05:00',
];
const FACILITIES_POOL = ['주차', '발렛', '식사', '24시간', 'VIP룸', '룸', '와이파이', '흡연실'];
const DESCRIPTION_TEMPLATES = [
  '{dong} 중심부 매장. 토너·캐쉬 동시 운영, 입문자 환영.',
  '{dong} 핵심 상권, 위성 예선 정기 개최. 친절한 딜러 상주.',
  '{dong} 신상 매장. 깔끔한 인테리어와 넓은 룸 보유.',
  '{dong} 지역 인지도 매장. 정기 토너와 캐쉬게임 활발.',
  '{dong} 인근 직장인·동호회 단골 매장. 식사 메뉴 다양.',
];

// Unsplash 공개 photo URL 풀 (다크 바·라운지·게임 분위기).
// 작동 안 하는 URL은 이 배열만 교체하면 모든 매장 photoUrls가 자동 갱신됨.
const PHOTO_POOL = [
  'https://images.unsplash.com/photo-1606167668584-78701c57f13d?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1511193311914-0346f16efe90?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1538488881038-e252a119ace7?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1545486332-9e0999c535b2?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&q=70&auto=format',
];

/** mulberry32 — 결정론적 PRNG. 같은 seed → 같은 시퀀스 (멱등성 유지). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}
function pickN<T>(arr: T[], n: number, r: () => number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(r() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

export interface BulkDemoStoreSeed {
  id: string;
  ownerUid: string;
  name: string;
  address: string;
  addressDetail: string;
  phone: string;
  hours: string;
  description: string;
  facilities: string[];
  photoUrls: string[];
  lat: number;
  lng: number;
  status: 'active';
  tier: 'free';
  reviewCount: number;
  liveSessionCount: number;
  isDemo: boolean;
  demoBatch: string;
}

function buildBulkDemoStores(ownerUid: string): BulkDemoStoreSeed[] {
  const stores: BulkDemoStoreSeed[] = [];
  let idx = 0;
  for (const area of AREAS) {
    for (let i = 0; i < area.count; i++) {
      idx++;
      const r = rng(idx * 9973);
      const theme = pick(THEMES, r);
      const shopType = pick(SHOP_TYPES, r);
      const baseName = `${area.dong} ${theme}${shopType}`;
      const name = r() < 0.3 ? `${baseName} ${i + 1}호점` : baseName;
      // 좌표 jitter ~ ±0.0025 (약 250m)
      const lat = area.lat + (r() - 0.5) * 0.005;
      const lng = area.lng + (r() - 0.5) * 0.005;
      const addrNum = Math.floor(r() * 200) + 1;
      const address = `${area.addrPrefix} ${addrNum}`;
      const floorRoll = r();
      const addressDetail =
        floorRoll < 0.5 ? `${Math.floor(r() * 7) + 1}층`
        : floorRoll < 0.7 ? 'B1'
        : '';
      const phonePrefix = area.region === '부산' ? '051' : '055';
      const middle = String(Math.floor(r() * 900) + 100);
      const last = String(idx).padStart(4, '0');
      const phone = `${phonePrefix}-${middle}-${last}`;
      const hours = pick(HOURS_POOL, r);
      const description = pick(DESCRIPTION_TEMPLATES, r).replace('{dong}', area.dong);
      const facilities = pickN(FACILITIES_POOL, 2 + Math.floor(r() * 4), r);
      const photoUrls = pickN(PHOTO_POOL, 1 + Math.floor(r() * 3), r);
      const id = `bulk-demo-${String(idx).padStart(3, '0')}`;
      stores.push({
        id,
        ownerUid,
        name,
        address,
        addressDetail,
        phone,
        hours,
        description,
        facilities,
        photoUrls,
        lat,
        lng,
        status: 'active',
        tier: 'free',
        reviewCount: 0,
        liveSessionCount: 0,
        isDemo: true,
        demoBatch: DEMO_BATCH_ID,
      });
    }
  }
  return stores;
}

export const BULK_DEMO_TOTAL = AREAS.reduce((sum, a) => sum + a.count, 0);
export const BULK_DEMO_DISTRIBUTION = AREAS.map((a) => ({
  region: a.region,
  dong: a.dong,
  count: a.count,
}));

/** bulk100 데모 매장이 이미 몇 개 생성되었는지 카운트 (demoBatch 플래그로 좁힘) */
export async function countBulkDemoStores(): Promise<number> {
  const snap = await getDocs(
    query(collection(db, 'stores'), where('demoBatch', '==', DEMO_BATCH_ID)),
  );
  return snap.size;
}

/** 100개를 단일 batch로 일괄 생성. 멱등 — 같은 id 덮어쓰기. Firestore writeBatch는 500 op limit. */
export async function seedBulkDemoStores(ownerUid: string): Promise<number> {
  const stores = buildBulkDemoStores(ownerUid);
  const batch = writeBatch(db);
  for (const s of stores) {
    const ref = doc(db, 'stores', s.id);
    batch.set(ref, {
      ...s,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return stores.length;
}

/** demoBatch=bulk100인 매장 일괄 삭제 (platform_admin claim 필요) */
export async function removeBulkDemoStores(): Promise<number> {
  const snap = await getDocs(
    query(collection(db, 'stores'), where('demoBatch', '==', DEMO_BATCH_ID)),
  );
  if (snap.empty) return 0;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}
