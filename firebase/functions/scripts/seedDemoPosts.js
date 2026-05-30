/* eslint-disable no-console */
/**
 * seedDemoPosts.js — 데모 매장 "오늘의 소식" 가상 시드
 *
 * 목적:
 *   사용자 앱 홈("오늘의 소식" 캐러셀)에 콘텐츠가 비어 보이지 않도록,
 *   다양한 지역의 데모 매장 10곳에 가상 글 1개씩 일괄 등록.
 *
 * 정책 (admin-web/src/lib/posts.ts 참고):
 *   - 컬렉션: stores/{storeId}/posts
 *   - 24h 만료(expiresAt = now + 24h), status='published'
 *   - createdAt = 클라이언트 Timestamp (서버타임스탬프 null emit 함정 회피)
 *   - cardColor 화이트리스트 / cardEmojis 큐레이션 셋(최대 3) — 본 스크립트는 검증된 값만 사용
 *   - authorType='store', authorUid='demo-seeder' (시드 출처 식별 + 멱등성 키)
 *
 * 멱등성:
 *   - 매장별로 authorUid='demo-seeder' 글이 이미 1건이라도 있으면 skip
 *   - 재실행 안전 — 신규 데모 매장이 추가돼도 누적 등록되지 않음
 *
 * 사용법:
 *   1. dry-run (디폴트):
 *      node firebase/functions/scripts/seedDemoPosts.js
 *   2. 실제 실행:
 *      node firebase/functions/scripts/seedDemoPosts.js --execute
 *   3. 상세 출력:
 *      node firebase/functions/scripts/seedDemoPosts.js --execute --verbose
 *
 * 지역 다양성:
 *   - 부산 핵심 상권(서면/해운대/광안/동래/대연/연산/사상/사하/금정/장전) 한 매장씩
 *   - dong 필드 기반 그룹핑 → 각 그룹에서 1개 매장 round-robin 선택
 *
 * 회수(언시드):
 *   node firebase/functions/scripts/seedDemoPosts.js --unseed --execute
 *   → authorUid='demo-seeder' 글 일괄 삭제 (멱등성 키 재사용)
 */

const admin = require('firebase-admin');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'holdemnow-prod';
const SEEDER_UID = 'demo-seeder';
const TTL_MS = 24 * 60 * 60 * 1000;
const TARGET_COUNT = 10;

// 우선순위가 높은 동(서로 다른 구·동을 골고루 노출하기 위해 명시).
// 데모 매장 dong 필드는 buildBulkDemoStores에서 `${area.dong} ${theme}` 패턴으로 store.name에만 들어가지만,
// AREAS 정의 시 dong이 store 문서 필드로는 저장되지 않으므로 name LIKE 매칭으로 그룹핑한다.
const DESIRED_DONGS = [
  '서면', '해운대', '광안리', '동래', '대연',
  '장전', '연산', '사상', '사하', '금정',
  // backup picks (위 매칭이 부족할 경우)
  '하단', '명지', '양산', '김해',
];

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const VERBOSE = argv.includes('--verbose') || argv.includes('-v');
const UNSEED = argv.includes('--unseed');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

// ─────────────────────────────────────────────────────────────
// 가상 글 풀 — 10개. 톤/카테고리 다양화 (이벤트/채용/시설/캐쉬/주차/식음 등).
// headline 40 grapheme 이내, body는 200자 안쪽으로 통제.
// cardColor / cardEmojis는 admin-web/src/lib/posts.ts의 화이트리스트와 일치해야 함.
// ─────────────────────────────────────────────────────────────
const POST_TEMPLATES = [
  {
    headline: '오늘 저녁 8시 토너 50인 진행',
    body: '오늘 저녁 8시 토너 50인 진행 중입니다. 바이인 3만원 / 스타팅 1.5만 / 레벨 20분. 노쇼 NO! 늦으면 입장 불가하니 시간 꼭 지켜주세요.',
    cardColor: 'red',
    cardEmojis: ['🎯', '🔥'],
    eventTags: ['토너', '오늘'],
  },
  {
    headline: '신규 가입 시 칩 +30% 이번 주말 한정',
    body: '신규 회원 가입 시 칩 +30% 보너스. 이번 주말까지만! 가입 신청은 매장에서 직접 받습니다. 카카오톡 문의 환영해요.',
    cardColor: 'pink',
    cardEmojis: ['🎁', '✨'],
    eventTags: ['이벤트', '신규'],
  },
  {
    headline: '딜러 모집 중 (경력 1년 이상 우대)',
    body: '함께 일할 딜러 모십니다. 경력 1년 이상 우대, 신입도 교육 후 채용 가능. 주 5일 / 야간 / 시급 협의. 매장으로 전화 또는 카톡 주세요.',
    cardColor: 'navy',
    cardEmojis: ['🙋', '💼'],
    eventTags: ['채용', '딜러'],
  },
  {
    headline: 'TV 신설 완료 — 캠 추가로 BB 더 잘 보임',
    body: 'TV 추가 설치 완료했습니다. 카메라 각도 조정해서 BB/SB 표시가 더 잘 보여요. 시야 불편 의견 주신 분들 감사합니다!',
    cardColor: 'cyan',
    cardEmojis: ['📺', '✨'].slice(0, 1).concat(['💡']),
    eventTags: ['공지', '시설'],
  },
  {
    headline: '오늘 캐쉬 게임 8테이블 풀하우스',
    body: '오늘 캐쉬 게임 8테이블 모두 가동 중! 대기 1팀. 1/2 · 2/5 두 종류 운영. 자리 비면 카톡으로 안내드립니다.',
    cardColor: 'green',
    cardEmojis: ['🃏', '💰'],
    eventTags: ['캐쉬', '실시간'],
  },
  {
    headline: '월요일 한정 평일 토너 무료 칩 1만',
    body: '월요일은 평일 무료 토너! 참가비 0원, 시작 칩 1만. 우승 상금은 매장 식음 쿠폰. 매주 진행하니 자주 와주세요.',
    cardColor: 'gold',
    cardEmojis: ['🆓', '🎉'],
    eventTags: ['토너', '무료', '월요일'],
  },
  {
    headline: '주차장 확장 완료 — 30대 가능',
    body: '주차장 확장 공사가 끝났습니다. 동시 30대까지 주차 가능. 인근 도로 주차 단속 강화됐으니 꼭 매장 주차장 이용해주세요.',
    cardColor: 'white',
    cardEmojis: ['📢', '📍'],
    eventTags: ['공지', '주차'],
  },
  {
    headline: '신규 회원 첫 토너 무료 참가권 증정',
    body: '처음 오시는 분께 첫 토너 무료 참가권 1매 드립니다. 가입 절차는 5분이면 끝나요. 친구 데려오시면 둘 다 칩 +20%!',
    cardColor: 'purple',
    cardEmojis: ['💎', '🎁'],
    eventTags: ['이벤트', '신규'],
  },
  {
    headline: '우리 매장 딜러 친절도 1위 후기 모아봤어요',
    body: '최근 한 달 후기에서 “딜러 친절도”가 가장 많이 언급된 매장에 선정됐어요. 와주신 손님들 덕분입니다. 더 좋은 서비스로 보답하겠습니다.',
    cardColor: 'pink',
    cardEmojis: ['🌟', '💁'],
    eventTags: ['공지'],
  },
  {
    headline: '오늘부터 야식 메뉴 추가 — 라멘/도시락',
    body: '야식 메뉴 신설! 라멘 · 김치찌개 · 도시락 3종 출시. 매장 안 주문 가능. 게임 중간에 든든하게 채우고 가세요.',
    cardColor: 'orange',
    cardEmojis: ['🍣', '🍻'],
    eventTags: ['식음', '신메뉴'],
  },
];

// 큐레이션 셋 검증용 (posts.ts와 동기 — 검증된 이모지만 통과)
const CURATED_EMOJIS = new Set([
  '🃏', '🎰', '♠️', '♥️', '♦️', '♣️', '🎯', '💰', '💵', '💸',
  '🎉', '🎊', '🎁', '✨', '🔥', '⚡', '⭐', '💎', '🏆', '🌟',
  '☕', '🍻', '🍺', '🍷', '🥃', '🍰', '🍕', '🍣',
  '📢', '🔔', '❗', '⚠️', '💡', '📅', '🕐', '🏬', '📍', '🚨',
  '👀', '🙋', '👋', '🆕', '🎪', '🤝', '💼', '📝', '🎓', '🚀',
]);
const VALID_CARD_COLORS = new Set([
  'white', 'pink', 'green', 'gold', 'navy', 'red',
  'purple', 'cyan', 'orange',
]);

function sanitizeEmojis(arr) {
  return (arr || []).filter((e) => CURATED_EMOJIS.has(e)).slice(0, 3);
}

// ─────────────────────────────────────────────────────────────
// 데모 매장 선정: dong별 1개씩 round-robin → 10개
// ─────────────────────────────────────────────────────────────
async function pickDemoStores() {
  const snap = await db.collection('stores').where('isDemo', '==', true).get();
  if (snap.empty) {
    console.error('[FATAL] 데모 매장(isDemo=true)이 한 곳도 없습니다. seedStoresBulk 먼저 실행 필요.');
    process.exit(1);
  }
  console.log(`[demo] 전체 데모 매장: ${snap.size}개`);

  // dong별로 매장 그룹핑. dong은 store.name에 prefix로 들어가 있음 (예: "서면 라운지펍").
  const groups = new Map(); // dong → [{id, name}]
  for (const d of snap.docs) {
    const data = d.data();
    const name = String(data.name ?? '');
    for (const dong of DESIRED_DONGS) {
      if (name.startsWith(dong)) {
        if (!groups.has(dong)) groups.set(dong, []);
        groups.get(dong).push({ id: d.id, name, address: data.address ?? '' });
        break;
      }
    }
  }

  // DESIRED_DONGS 순서대로 1매장씩 픽 (해당 dong에 매장 없으면 skip)
  const picked = [];
  for (const dong of DESIRED_DONGS) {
    if (picked.length >= TARGET_COUNT) break;
    const arr = groups.get(dong);
    if (!arr || arr.length === 0) continue;
    picked.push({ dong, ...arr[0] });
  }

  // 부족하면 그룹에 안 잡힌 나머지 데모 매장에서 보충
  if (picked.length < TARGET_COUNT) {
    const usedIds = new Set(picked.map((p) => p.id));
    for (const d of snap.docs) {
      if (picked.length >= TARGET_COUNT) break;
      if (usedIds.has(d.id)) continue;
      const data = d.data();
      picked.push({ dong: '기타', id: d.id, name: data.name ?? '', address: data.address ?? '' });
    }
  }

  console.log(`[demo] 선정된 매장: ${picked.length}개`);
  picked.forEach((p, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. [${p.dong}] ${p.name} (${p.id})`);
  });
  return picked;
}

// ─────────────────────────────────────────────────────────────
// 이미 시드된 매장인지 확인 (멱등성)
// ─────────────────────────────────────────────────────────────
async function hasExistingSeed(storeId) {
  const snap = await db
    .collection('stores').doc(storeId)
    .collection('posts')
    .where('authorUid', '==', SEEDER_UID)
    .limit(1)
    .get();
  return !snap.empty;
}

// ─────────────────────────────────────────────────────────────
// 시드 실행
// ─────────────────────────────────────────────────────────────
async function runSeed() {
  const stores = await pickDemoStores();

  const stats = { created: 0, skipped: 0, errors: 0 };
  const now = Date.now();

  for (let i = 0; i < stores.length; i++) {
    const store = stores[i];
    const tpl = POST_TEMPLATES[i % POST_TEMPLATES.length];

    // 멱등성 가드
    const exists = await hasExistingSeed(store.id);
    if (exists) {
      stats.skipped++;
      if (VERBOSE) console.log(`  [skip] ${store.name} — 이미 demo-seeder 글 있음`);
      continue;
    }

    const cardColor = VALID_CARD_COLORS.has(tpl.cardColor) ? tpl.cardColor : 'white';
    const cardEmojis = sanitizeEmojis(tpl.cardEmojis);
    const nowTs = Timestamp.fromMillis(now);
    const expTs = Timestamp.fromMillis(now + TTL_MS);

    const payload = {
      storeId: store.id,
      storeName: store.name,
      body: tpl.body,
      headline: tpl.headline,
      cardColor,
      cardEmoji: cardEmojis[0] ?? '',
      cardEmojis,
      imageUrls: [],
      eventTags: tpl.eventTags ?? [],
      ctaUrl: '',
      ctaLabel: '',
      authorType: 'store',
      authorUid: SEEDER_UID,
      authorName: store.name,
      status: 'published',
      flagCount: 0,
      createdAt: nowTs,
      serverCreatedAt: FieldValue.serverTimestamp(),
      expiresAt: expTs,
      // 식별·관리용 부가 필드 (스키마와 충돌 없음)
      isDemoSeed: true,
      demoSeedVersion: 'v1',
    };

    if (EXECUTE) {
      try {
        const ref = await db
          .collection('stores').doc(store.id)
          .collection('posts')
          .add(payload);
        stats.created++;
        console.log(`  [create] ${store.name} → posts/${ref.id}`);
      } catch (e) {
        stats.errors++;
        console.error(`  [ERR] ${store.name}: ${e.message}`);
      }
    } else {
      stats.created++;
      console.log(`  [DRY] ${store.name} ← "${tpl.headline}"`);
    }
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────
// 언시드 (회수): authorUid='demo-seeder' 글 모두 삭제
// ─────────────────────────────────────────────────────────────
async function runUnseed() {
  // collectionGroup posts 에서 시더 글 전부 검색
  const snap = await db
    .collectionGroup('posts')
    .where('authorUid', '==', SEEDER_UID)
    .get();
  console.log(`[unseed] 시더 글 발견: ${snap.size}개`);

  let deleted = 0;
  const batches = [];
  let batch = db.batch();
  let count = 0;
  for (const d of snap.docs) {
    if (VERBOSE) console.log(`  [${EXECUTE ? 'DEL' : 'DRY'}] ${d.ref.path}`);
    if (EXECUTE) {
      batch.delete(d.ref);
      count++;
      if (count === 400) {
        batches.push(batch.commit());
        batch = db.batch();
        count = 0;
      }
    }
    deleted++;
  }
  if (EXECUTE && count > 0) batches.push(batch.commit());
  if (batches.length > 0) await Promise.all(batches);
  return { deleted };
}

// ─────────────────────────────────────────────────────────────
async function run() {
  console.log('='.repeat(60));
  console.log('HoldemNow Demo Posts Seeder');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Mode:    ${EXECUTE ? 'EXECUTE (real writes)' : 'DRY-RUN (no writes)'}`);
  console.log(`Action:  ${UNSEED ? 'UNSEED (delete)' : 'SEED (create)'}`);
  console.log(`Seeder:  authorUid='${SEEDER_UID}'`);
  console.log('='.repeat(60));

  if (UNSEED) {
    const { deleted } = await runUnseed();
    console.log('\n' + '-'.repeat(60));
    console.log(`[unseed] ${EXECUTE ? '삭제됨' : 'DRY-RUN'}: ${deleted}건`);
  } else {
    const stats = await runSeed();
    console.log('\n' + '-'.repeat(60));
    console.log(`[seed] 결과: 생성 ${stats.created} / 스킵 ${stats.skipped} / 에러 ${stats.errors}`);
  }

  if (!EXECUTE) {
    console.log('\nDRY-RUN 모드입니다. 실제 실행하려면 --execute 추가.');
    console.log('  node firebase/functions/scripts/seedDemoPosts.js --execute');
  }
}

run().catch((e) => {
  console.error('\n[FATAL]', e);
  process.exit(1);
});
