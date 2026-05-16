# Firestore 컬렉션 스키마 (v0.1)

프로토타입(`holdemnow_prototype.html`)의 데이터 모델 + 백엔드 Prisma 스키마(`backend/prisma/schema.prisma`)를 Firestore NoSQL로 옮긴 것.

진실의 원천(SoT)은 이 문서.

---

## 설계 원칙

1. **자주 같이 읽는 데이터는 denormalize** — read 비용 < write 비용 (Firestore 가격 구조)
2. **실시간 listener 효율 우선** — `liveSessions`는 top-level (모바일/TV가 직접 구독)
3. **관계는 ID 참조** — join은 클라이언트에서 (대부분의 경우 추가 read 1~2번이면 충분)
4. **document size < 1MB** — 큰 array(예: 본선 진출자 누적)는 subcollection
5. **doc ID는 의미있게** — `slotNum`처럼 자연 키가 있으면 그것을 ID로 (조회 효율)

---

## 📦 컬렉션 트리

```
stores/{storeId}
  ├ staff/{staffId}
  ├ tournamentTemplates/{templateId}
  ├ tournaments/{tournamentId}
  └ displaySlots/{slotNum}  ← slotNum이 doc ID

liveSessions/{sessionId}  ← top-level (실시간 listener 효율)
  └ events/{eventId}

users/{userId}
  ├ favorites/{storeId}    ← storeId가 doc ID
  └ interests/{tournamentId}

series/{seriesId}
  └ finalists/{finalistId}

organizers/{organizerId}
  └ staff/{staffId}

regions/{regionCode}       ← 인덱싱용 lookup
```

---

## 🏪 `stores/{storeId}`

매장 — 모든 LIVE·디스커버리의 출발점.

```ts
{
  id: string,              // doc ID (= storeId)
  storeCode: string,       // 사장님에게 보이는 ID "BSN_001"
  name: string,
  description?: string,
  address: string,
  addressDetail?: string,
  regionCode: string,      // "busan-seomyeon"
  location: GeoPoint,      // {latitude, longitude}
  phone?: string,
  hours: { mon: {open, close}, tue: ..., ... },
  facilities: string[],    // ["주차", "발렛", "식사"]
  thumbnailUrl?: string,
  photoUrls: string[],
  tier: 'free' | 'premium' | 'vip',
  status: 'active' | 'paused' | 'closed',
  averageRating?: number,
  reviewCount: number,
  avgBuyIn?: number,
  rake?: number,
  // denormalized for list view (변경 시 함께 갱신)
  liveSessionCount: number,        // 현재 진행 중 LIVE 개수 (모바일 카드 뱃지용)
  createdAt: Timestamp,
  updatedAt: Timestamp,
  deletedAt?: Timestamp,
}
```

**인덱스**:
- `regionCode + status` (지역 필터)
- `tier + averageRating` (VIP 상단 노출 + 평점순)
- 위치 검색: `geohash` 필드 추가 (geofire-common 라이브러리)

---

## 👥 `stores/{storeId}/staff/{staffId}` (subcollection)

매장 스태프 계정. Firebase Auth의 `uid`를 doc ID로.

```ts
{
  uid: string,                     // Firebase Auth uid (= doc ID)
  displayName: string,
  email: string,                   // Firebase Auth와 동일
  role: 'master' | 'staff',
  permissions: {
    editInfo: boolean,
    operateLive: boolean,
    purchase: boolean,
  },
  lastLoginAt?: Timestamp,
  createdAt: Timestamp,
}
```

**보안**: Auth `customClaims`에 `storeId`, `role` 넣어서 firestore.rules 빠르게 검증.

---

## 🎲 `stores/{storeId}/tournamentTemplates/{templateId}` (subcollection)

프로토타입 M18 `customTemplates`와 1:1.

```ts
{
  id: string,                      // doc ID
  name: string,                    // "프리징 90GTD"
  type: 'freezeout' | 'rebuy' | 'turbo' | 'bounty' | 'satellite' | 'cash',
  buyIn: number,
  guarantee: number,
  totalPlayers: number,
  prizePool: number,
  startingStack: number,
  lateRegEndLevel: number,
  posterStyle: string,             // "poster-dark"
  // 블라인드 구조는 array (보통 10~20레벨이라 1MB 안에 충분히 들어감)
  blindStructure: Array<{
    level: number,
    sb: number,
    bb: number,
    ante: number,
    durationSec: number,
    isBreak?: boolean,
  }>,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

**왜 subcollection?** — 템플릿은 매장 소유. 다른 매장과 격리. 보안 규칙 단순화.

---

## 🃏 `stores/{storeId}/tournaments/{tournamentId}` (subcollection)

특정 일자에 진행하는 1회분 토너.

```ts
{
  id: string,
  templateId?: string,             // null이면 ad-hoc
  name: string,                    // 템플릿에서 복사
  type: string,
  buyIn: number,
  guarantee: number,
  startsAt: Timestamp,
  status: 'draft' | 'scheduled' | 'live' | 'completed' | 'cancelled',
  posterStyle: string,
  // 시작 시점에 템플릿에서 복사 (시작 후 템플릿 편집 영향 X)
  levels: Array<{level, sb, bb, ante, durationSec, isBreak?}>,
  // 활성 LIVE 세션 ID (있으면)
  activeLiveSessionId?: string,
  createdAt: Timestamp,
}
```

---

## 📺 `stores/{storeId}/displaySlots/{slotNum}` (subcollection)

매장 TV 슬롯. doc ID는 slotNum 문자열("1", "2", ...).

```ts
{
  slotNum: number,                 // 매장 안 슬롯 번호
  name?: string,                   // "1번 메인 TV"
  sessionId?: string,              // 매핑된 liveSession ID (null = 비어있음)
  updatedAt: Timestamp,
}
```

**TV 디스플레이 URL**: `display.holdemnow.com/{storeId}/{slotNum}` → 클라이언트는 이 슬롯 문서를 listener로 구독. sessionId 바뀌면 자동으로 그 세션 listener도 갈아낌.

---

## 🔴 `liveSessions/{sessionId}` (top-level)

**가장 중요한 컬렉션** — 실시간 송출의 심장.

```ts
{
  id: string,                      // doc ID
  storeId: string,                 // ref → stores
  tournamentId: string,            // ref → stores/{storeId}/tournaments
  // denormalized (자주 같이 표시)
  storeName: string,
  storeRegion: string,
  tournamentName: string,
  posterStyle: string,
  buyIn: number,
  totalPlayers: number,
  status: 'running' | 'paused' | 'break' | 'completed',
  // 진행 상태
  currentLevel: number,
  // 카운트다운 모델: levelStartedAt 기반 derived 또는 levelSecondsLeft 직접 저장
  // 클라이언트가 직접 카운트다운하고 사용자 액션 시점에 levelSecondsLeft 갱신
  levelSecondsLeft: number,
  levelDurationSec: number,        // 현재 레벨의 전체 길이
  smallBlind: number,
  bigBlind: number,
  ante: number,
  playersRemaining: number,
  tablesRemaining: number,
  prizePool: number,
  lateRegClosed: boolean,
  lateRegEndLevel: number,
  // 시작 시점에 복사된 blindStructure
  blindStructure: Array<{level, sb, bb, ante, durationSec, isBreak?}>,
  // 메타
  startedAt: Timestamp,
  pausedAt?: Timestamp,
  endedAt?: Timestamp,
  viewerCount: number,
  note?: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

**왜 top-level?** — 모바일 홈의 LIVE 피드가 모든 매장의 진행 중 세션을 한 번에 query하려면 collectionGroup보다 top-level이 효율적.

**카운트다운 전략**: 클라이언트가 자체적으로 1초씩 감소시키고, 사용자 액션(일시정지/다음레벨/+1분)에서만 Firestore write. 일반 tick은 write 안 함 → Firestore 비용 절약.

**서버 보정** (선택): Cloud Functions의 scheduled function이 5분마다 모든 active 세션의 `levelSecondsLeft`를 보정 — 클라이언트 시계 drift 방지. v0.2부터.

**인덱스**:
- `status + storeId` (매장별 진행 중 세션)
- `status + storeRegion + updatedAt` (지역별 LIVE 피드)

---

## 📋 `liveSessions/{sessionId}/events/{eventId}` (subcollection)

LIVE 세션 액션 로그 (감사 + Undo).

```ts
{
  type: 'started' | 'paused' | 'resumed' | 'level_next' | 'level_prev'
      | 'time_added' | 'time_removed' | 'break_start' | 'break_end'
      | 'late_reg_closed' | 'late_reg_reopened' | 'players_updated' | 'finished',
  payload: object,                 // {previousValue, newValue}
  actorUid: string,                // 누가 했는지 (Auth uid)
  createdAt: Timestamp,            // server timestamp
}
```

---

## 👤 `users/{userId}` (Firebase Auth `uid`가 doc ID)

```ts
{
  uid: string,
  kakaoId?: string,
  nickname: string,
  profileImage?: string,
  email?: string,
  phone?: string,
  role: 'player' | 'store_master' | 'store_staff' | 'organizer_master' | 'platform_admin',
  preferredRegion?: string,
  notificationPrefs: {
    favLive: boolean,
    tournamentStart: boolean,
    lateRegImminent: boolean,
    marketing: boolean,
  },
  // FCM 디바이스 토큰 (멀티 디바이스)
  fcmTokens: { [deviceId: string]: { token: string, createdAt: Timestamp } },
  lastSeenAt?: Timestamp,
  createdAt: Timestamp,
}
```

---

## ⭐ `users/{userId}/favorites/{storeId}` (subcollection)

doc ID가 storeId — favorite 존재 자체가 즐겨찾기 여부.

```ts
{
  storeId: string,
  storeName: string,                 // denormalized (리스트 표시용)
  storePhotoUrl?: string,
  notifyOnLive: boolean,
  createdAt: Timestamp,
}
```

**즐겨찾기 LIVE 알림**: `liveSessions` write 시 onCreate Cloud Function이 발동 → 해당 storeId를 favorite한 모든 user 찾기 → FCM 전송.

---

## 🎯 `users/{userId}/interests/{tournamentId}` (subcollection)

관심 토너.

```ts
{
  tournamentId: string,
  storeId: string,
  tournamentName: string,
  startsAt: Timestamp,
  createdAt: Timestamp,
}
```

---

## 🏆 `series/{seriesId}` (top-level)

대회사 시리즈.

```ts
{
  id: string,
  organizerId: string,
  name: string,
  season: string,
  description: string,
  status: 'upcoming' | 'active' | 'completed',
  posterStyle: string,
  finalDate: Timestamp,
  finalVenue: string,
  finalBuyIn: number,
  finalGuarantee: number,
  partnerStoreIds: string[],       // 배열 in clause로 쿼리 가능 (최대 10개)
  partnerStoreCount: number,       // denormalized (10개 초과 대비)
  seedRule: string,
  satelliteCount: number,
  satelliteCompleted: number,
  finalistCount: number,           // denormalized (subcollection count)
  pageViews: number,
  adSpend: number,
  revenue: number,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

**10개 초과 협력 매장**: `partnerStoreIds`는 표시용 (최대 10개로 자르기). 진짜 매핑은 `series/{id}/partners/{storeId}` subcollection으로 확장.

---

## 🎫 `series/{seriesId}/finalists/{finalistId}` (subcollection)

본선 진출자 누적 명단.

```ts
{
  id: string,
  nickname: string,
  userId?: string,                 // 등록한 회원일 경우
  storeId: string,                 // 위성 예선 진행 매장
  storeName: string,               // denormalized
  satelliteDate: Timestamp,
  rank: number,                    // 1~N
  createdAt: Timestamp,
}
```

**자동 집계** (M19 시뮬): 매장 어드민에서 위성 예선 결과 입력 → Cloud Function이 `series/{id}/finalists`에 batch write + 모회사 카운터 갱신.

---

## 🏢 `organizers/{organizerId}` (top-level)

대회사 마스터.

```ts
{
  id: string,
  name: string,
  tagline: string,
  contactEmail: string,
  status: 'active' | 'paused',
  createdAt: Timestamp,
}
```

---

## 🗺 `regions/{regionCode}` (조회용 lookup)

```ts
{
  code: string,                    // "busan-seomyeon"
  parentCode: string,              // "busan"
  nameKo: string,                  // "서면"
  nameEn: string,                  // "Seomyeon"
  centerLat: number,
  centerLng: number,
  storeCount: number,
}
```

---

## 🔒 보안 규칙 핵심

`firestore.rules`:

```
match /stores/{storeId} {
  allow read: if true;                                // 누구나 매장 조회 가능
  allow write: if isStoreMember(storeId);             // 매장 스태프만 수정

  match /tournamentTemplates/{tplId} {
    allow read: if isStoreMember(storeId);            // 본인 매장만 read
    allow write: if isStoreMember(storeId);
  }

  match /displaySlots/{slotNum} {
    allow read: if true;                              // TV 디스플레이는 누구나 (URL 갖고 접근)
    allow write: if isStoreMember(storeId);
  }
}

match /liveSessions/{sessionId} {
  allow read: if true;                                // 누구나 LIVE 피드 구독
  allow write: if isStoreMemberOf(resource.data.storeId);

  match /events/{eventId} {
    allow read: if isStoreMemberOf(get(/databases/$(database)/documents/liveSessions/$(sessionId)).data.storeId);
    allow write: if false;                            // Functions만 write
  }
}

match /users/{userId} {
  allow read: if request.auth.uid == userId;
  allow write: if request.auth.uid == userId;

  match /{document=**} {
    allow read, write: if request.auth.uid == userId;
  }
}
```

`isStoreMember(storeId)` 헬퍼는 Auth `customClaims.storeId == storeId` 검증.

---

## 📊 데이터 모델 결정 사항

| 결정 | 이유 |
|------|------|
| `liveSessions`를 top-level | 모바일 LIVE 피드의 collectionGroup 쿼리 비용 최소화 |
| 매장의 templates/tournaments는 subcollection | 매장 소유 명확, 보안 규칙 단순 |
| favorites doc ID = storeId | 존재 자체가 즐겨찾기 여부, 추가 인덱스 불필요 |
| `notificationPrefs`를 user document에 nested | 매번 같이 읽음, 별도 doc 불필요 |
| `blindStructure`를 array | 보통 10~20레벨, 1MB 안 충분, 한 번에 read |
| `partnerStoreIds`를 array (≤10) | array-contains-any 쿼리 가능 |
| denormalized fields (storeName, tournamentName, ...) | 리스트 렌더링 시 join 안 해도 됨 |

---

## ⚠ 함정

1. **denormalized 필드 동기화** — `stores/{id}.name` 바뀌면 `liveSessions`, `favorites` 등의 storeName 다 갱신 필요. Cloud Function trigger로 자동화.
2. **카운트다운 write 폭주** — 1초마다 write하면 무료 한도 금방 소진. 클라이언트 자체 tick + user action만 write.
3. **GeoPoint 검색** — Firestore는 단순 GeoPoint만 있고 반경 검색 불가. `geohash` 필드 + `geofire-common` 라이브러리 활용.
4. **subcollection의 trade-off** — 보안·격리는 좋지만 collectionGroup 쿼리 시 인덱스 별도 필요.
