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
 * 동네별 실제 상권 핫스팟(역세권·중심로) 좌표를 정의해두고, 매장을 핫스팟에 라운드로빈으로 분배.
 * 좌표 jitter는 ±0.0004(약 40m) — 핫스팟 인근 도로변에 자연스럽게 흩뿌려 보이게.
 * 도로명·번지는 핫스팟의 실제 도로명을 그대로 사용 (번지만 변형).
 *
 * 기존 5개(seedStores.ts)와 구분: demoBatch='bulk100' 플래그.
 */
const DEMO_BATCH_ID = 'bulk100';

interface Hotspot {
  /** 핫스팟 라벨 (디버깅용) */
  label: string;
  /** 실제 도로명 (예: '서면로', '해운대해변로') */
  road: string;
  /** 도로명 주소 시 prefix (시·구·도로명 직전까지) */
  addrPrefix: string;
  /** 번지 범위 [min, max] */
  banjiRange: [number, number];
  lat: number;
  lng: number;
}

interface Area {
  region: '부산' | '양산' | '김해';
  dong: string;
  count: number;
  hotspots: Hotspot[];
}

// 핫스팟 좌표는 실제 행정동의 주요 역세권·상권을 기준으로 잡음.
// 매장은 area 안에서 idx % hotspots.length로 라운드로빈 분배 → 한쪽에 몰리지 않음.
const AREAS: Area[] = [
  // ===== 부산 65개 =====
  {
    region: '부산', dong: '서면', count: 14,
    hotspots: [
      { label: '서면역 NC',    road: '가야대로',   addrPrefix: '부산광역시 부산진구', banjiRange: [690, 780], lat: 35.1576, lng: 129.0593 },
      { label: '서면 메디컬',  road: '서전로',     addrPrefix: '부산광역시 부산진구', banjiRange: [10, 70],   lat: 35.1565, lng: 129.0610 },
      { label: '부전역',       road: '동천로',     addrPrefix: '부산광역시 부산진구', banjiRange: [100, 180], lat: 35.1592, lng: 129.0590 },
      { label: '영광도서',     road: '중앙대로',   addrPrefix: '부산광역시 부산진구', banjiRange: [780, 870], lat: 35.1559, lng: 129.0568 },
      { label: '서면시장',     road: '부전로',     addrPrefix: '부산광역시 부산진구', banjiRange: [40, 110],  lat: 35.1545, lng: 129.0613 },
    ],
  },
  {
    region: '부산', dong: '해운대', count: 12,
    hotspots: [
      { label: '해운대역',     road: '구남로',         addrPrefix: '부산광역시 해운대구', banjiRange: [10, 90],   lat: 35.1631, lng: 129.1635 },
      { label: '해운대해변',   road: '해운대해변로',   addrPrefix: '부산광역시 해운대구', banjiRange: [200, 320], lat: 35.1592, lng: 129.1605 },
      { label: '미포 달맞이',  road: '달맞이길',       addrPrefix: '부산광역시 해운대구', banjiRange: [30, 130],  lat: 35.1593, lng: 129.1718 },
      { label: '센텀시티',     road: '센텀중앙로',     addrPrefix: '부산광역시 해운대구', banjiRange: [55, 145],  lat: 35.1696, lng: 129.1306 },
    ],
  },
  {
    region: '부산', dong: '광안리', count: 10,
    hotspots: [
      { label: '광안역',       road: '광남로',         addrPrefix: '부산광역시 수영구', banjiRange: [40, 120],  lat: 35.1551, lng: 129.1186 },
      { label: '광안리해변',   road: '광안해변로',     addrPrefix: '부산광역시 수영구', banjiRange: [180, 280], lat: 35.1531, lng: 129.1185 },
      { label: '민락동',       road: '민락로',         addrPrefix: '부산광역시 수영구', banjiRange: [55, 140],  lat: 35.1490, lng: 129.1240 },
      { label: '남천동',       road: '수영로',         addrPrefix: '부산광역시 수영구', banjiRange: [300, 410], lat: 35.1450, lng: 129.1110 },
    ],
  },
  {
    region: '부산', dong: '동래', count: 8,
    hotspots: [
      { label: '동래역',       road: '충렬대로',     addrPrefix: '부산광역시 동래구', banjiRange: [88, 170],  lat: 35.2052, lng: 129.0832 },
      { label: '명륜동',       road: '명륜로',       addrPrefix: '부산광역시 동래구', banjiRange: [80, 160],  lat: 35.2061, lng: 129.0844 },
      { label: '사직동',       road: '사직북로',     addrPrefix: '부산광역시 동래구', banjiRange: [20, 90],   lat: 35.1981, lng: 129.0593 },
    ],
  },
  {
    region: '부산', dong: '대연', count: 7,
    hotspots: [
      { label: '대연역',       road: '못골로',       addrPrefix: '부산광역시 남구',   banjiRange: [40, 110],  lat: 35.1357, lng: 129.1010 },
      { label: '부경대',       road: '용소로',       addrPrefix: '부산광역시 남구',   banjiRange: [30, 95],   lat: 35.1336, lng: 129.1057 },
      { label: '못골',         road: '진남로',       addrPrefix: '부산광역시 남구',   banjiRange: [25, 90],   lat: 35.1325, lng: 129.0980 },
    ],
  },
  {
    region: '부산', dong: '장전', count: 5,
    hotspots: [
      { label: '부산대역',     road: '장전온천천로', addrPrefix: '부산광역시 금정구', banjiRange: [40, 110],  lat: 35.2306, lng: 129.0867 },
      { label: '부산대정문',   road: '부산대학로',   addrPrefix: '부산광역시 금정구', banjiRange: [40, 120],  lat: 35.2330, lng: 129.0900 },
    ],
  },
  {
    region: '부산', dong: '하단', count: 3,
    hotspots: [
      { label: '하단역',       road: '낙동남로',     addrPrefix: '부산광역시 사하구', banjiRange: [1300, 1380], lat: 35.1059, lng: 128.9657 },
      { label: '동아대',       road: '하신중앙로',   addrPrefix: '부산광역시 사하구', banjiRange: [200, 280],   lat: 35.1085, lng: 128.9700 },
    ],
  },
  {
    region: '부산', dong: '사상', count: 2,
    hotspots: [
      { label: '사상역',       road: '사상로',       addrPrefix: '부산광역시 사상구', banjiRange: [300, 380], lat: 35.1539, lng: 128.9907 },
    ],
  },
  {
    region: '부산', dong: '남포', count: 2,
    hotspots: [
      { label: '남포역',       road: '광복로',       addrPrefix: '부산광역시 중구',   banjiRange: [40, 90],   lat: 35.0980, lng: 129.0288 },
    ],
  },
  {
    region: '부산', dong: '연제', count: 1,
    hotspots: [
      { label: '연산역',       road: '연제로',       addrPrefix: '부산광역시 연제구', banjiRange: [10, 80],   lat: 35.1841, lng: 129.0826 },
    ],
  },
  {
    region: '부산', dong: '영도', count: 1,
    hotspots: [
      { label: '영도구청',     road: '태종로',       addrPrefix: '부산광역시 영도구', banjiRange: [40, 110],  lat: 35.0911, lng: 129.0676 },
    ],
  },

  // ===== 양산 17개 =====
  {
    region: '양산', dong: '물금', count: 9,
    hotspots: [
      { label: '물금역',       road: '물금로',       addrPrefix: '경상남도 양산시 물금읍', banjiRange: [80, 160],  lat: 35.3034, lng: 128.9931 },
      { label: '범어동',       road: '황산공원로',   addrPrefix: '경상남도 양산시 물금읍', banjiRange: [120, 200], lat: 35.3140, lng: 128.9905 },
      { label: '증산리',       road: '증산역로',     addrPrefix: '경상남도 양산시 물금읍', banjiRange: [40, 110],  lat: 35.3155, lng: 128.9870 },
    ],
  },
  {
    region: '양산', dong: '양산중부', count: 5,
    hotspots: [
      { label: '양산시청',     road: '중앙로',       addrPrefix: '경상남도 양산시',       banjiRange: [60, 130],  lat: 35.3373, lng: 129.0381 },
      { label: '양산역',       road: '양산대로',     addrPrefix: '경상남도 양산시',       banjiRange: [1400, 1500], lat: 35.3304, lng: 129.0264 },
    ],
  },
  {
    region: '양산', dong: '양주', count: 3,
    hotspots: [
      { label: '양주동',       road: '양주로',       addrPrefix: '경상남도 양산시',       banjiRange: [30, 100],  lat: 35.3500, lng: 129.0500 },
    ],
  },

  // ===== 김해 18개 =====
  {
    region: '김해', dong: '장유', count: 9,
    hotspots: [
      { label: '장유1동',      road: '장유로',       addrPrefix: '경상남도 김해시',       banjiRange: [100, 180], lat: 35.2010, lng: 128.8138 },
      { label: '율하동',       road: '율하1로',      addrPrefix: '경상남도 김해시',       banjiRange: [70, 150],  lat: 35.1869, lng: 128.8001 },
      { label: '부원동',       road: '부원로',       addrPrefix: '경상남도 김해시',       banjiRange: [40, 120],  lat: 35.2280, lng: 128.8870 },
    ],
  },
  {
    region: '김해', dong: '내외동', count: 6,
    hotspots: [
      { label: '김해시청',     road: '내외중앙로',   addrPrefix: '경상남도 김해시',       banjiRange: [40, 110],  lat: 35.2310, lng: 128.8898 },
      { label: '외동',         road: '외동로',       addrPrefix: '경상남도 김해시',       banjiRange: [40, 110],  lat: 35.2260, lng: 128.8820 },
    ],
  },
  {
    region: '김해', dong: '진영', count: 3,
    hotspots: [
      { label: '진영읍',       road: '진영로',       addrPrefix: '경상남도 김해시 진영읍', banjiRange: [180, 260], lat: 35.2814, lng: 128.7383 },
    ],
  },
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
  '{dong} 핵심 상권, 새틀라이트 정기 개최. 친절한 딜러 상주.',
  '{dong} 신상 매장. 깔끔한 인테리어와 넓은 룸 보유.',
  '{dong} 지역 인지도 매장. 정기 토너와 캐쉬게임 활발.',
  '{dong} 인근 직장인·동호회 단골 매장. 식사 메뉴 다양.',
];

const PHOTO_POOL = [
  'https://images.unsplash.com/photo-1606167668584-78701c57f13d?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1511193311914-0346f16efe90?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1538488881038-e252a119ace7?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1545486332-9e0999c535b2?w=800&q=70&auto=format',
  'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&q=70&auto=format',
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
      // 핫스팟 라운드로빈 분배 — 한 area 안에서 골고루 흩어짐
      const hotspot = area.hotspots[i % area.hotspots.length];

      const theme = pick(THEMES, r);
      const shopType = pick(SHOP_TYPES, r);
      const baseName = `${area.dong} ${theme}${shopType}`;
      const name = r() < 0.3 ? `${baseName} ${i + 1}호점` : baseName;

      // 핫스팟 인근 ±40m jitter (lat 0.0004 ≈ 44m, lng 0.0004 ≈ 36m)
      const lat = hotspot.lat + (r() - 0.5) * 0.0008;
      const lng = hotspot.lng + (r() - 0.5) * 0.0008;

      const [minBanji, maxBanji] = hotspot.banjiRange;
      const banji = Math.floor(r() * (maxBanji - minBanji + 1)) + minBanji;
      const address = `${hotspot.addrPrefix} ${hotspot.road} ${banji}`;

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
