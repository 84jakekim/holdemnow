/* eslint-disable no-console */
/**
 * seedOpsSimulation.js — 3~4개월 운영 시뮬레이션 풀세트 시드
 *
 * 목적:
 *   실제로 사용자 ~250명 + 매장 100곳이 활발히 3~4개월 사용한 것처럼
 *   가상 데이터를 Firestore에 시드. 사용자 앱·매장 어드민·본사 어드민 모든
 *   화면이 풍성하게 보이도록.
 *
 * 시드 카테고리 (8):
 *   1. 가상 사용자 ~250명 (Firebase Auth + users doc)
 *   2. 매장 정보 풍성화 (description/pitch/facilities/tier/aggregates)
 *   3. 리뷰 ~1500~2000건 (stores/{id}/reviews)
 *   4. 즐겨찾기 ~800건 (users/{uid}/favorites/{storeId})
 *   5. 예약 ~500~800건 (stores/{id}/reservations)
 *   6. 매장 소식 ~400건 (stores/{id}/posts) — 과거 누적 + 일부 활성
 *   7. LIVE 세션 과거 기록 ~300건 (liveSessions where status=completed)
 *   8. 메트릭 ~ (stores/{id}/metrics/global: favoriteAdds/directionsClicks)
 *
 * 안전장치:
 *   - dry-run 디폴트, --execute 필요
 *   - 멱등성: 모든 시드 doc에 `seedSource: 'ops-sim'` 표식
 *     · 사용자 uid prefix: `sim-`
 *     · liveSessions doc ID prefix: `sim-`
 *     · 그 외 컬렉션은 doc 데이터에 seedSource 필드
 *   - 회수: --unseed --execute 로 모두 삭제
 *   - Firestore batch 500 제한 → 청크 분할
 *
 * 데이터 무결성:
 *   - 사용자 uid는 실제 Auth에 등록 (안 등록되면 client subscribe 못함)
 *   - 매장 ID는 실제 demo 매장 ID 사용 (isDemo=true)
 *
 * 사용법:
 *   # 1. dry-run (디폴트)
 *   node firebase/functions/scripts/seedOpsSimulation.js
 *
 *   # 2. 실제 실행
 *   node firebase/functions/scripts/seedOpsSimulation.js --execute
 *
 *   # 3. 회수 (모든 시드 데이터 삭제)
 *   node firebase/functions/scripts/seedOpsSimulation.js --unseed --execute
 *
 *   # 4. 일부 카테고리만 실행
 *   node ... --execute --only=users,reviews
 *
 *   # 5. 진행 상황 상세 로그
 *   node ... --execute --verbose
 */

const admin = require('firebase-admin');

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'holdemnow-prod';
const SEED_SOURCE = 'ops-sim';
const SIM_PREFIX = 'sim-';

// 시드 규모
const TARGET_USERS = 250;
const TARGET_REVIEWS_PER_STORE_AVG = 15; // 매장당 평균
const TARGET_FAVS_PER_USER_AVG = 4; // 사용자당 평균
const TARGET_RESERVATIONS_PER_STORE_AVG = 8; // 매장당 평균
const TARGET_POSTS_PER_STORE_AVG = 4; // 매장당 평균 (과거 누적)
const TARGET_LIVE_PER_STORE_AVG = 3; // 매장당 평균 (과거 완료)

// 시간 분산
const NOW = Date.now();
const FOUR_MONTHS_MS = 4 * 30 * 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const THREE_MONTHS_MS = 3 * 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// CLI
const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const VERBOSE = argv.includes('--verbose') || argv.includes('-v');
const UNSEED = argv.includes('--unseed');
const ONLY = (() => {
  const arg = argv.find((a) => a.startsWith('--only='));
  if (!arg) return null;
  return new Set(arg.replace('--only=', '').split(',').map((s) => s.trim()));
})();

function shouldRun(category) {
  if (!ONLY) return true;
  return ONLY.has(category);
}

// ─────────────────────────────────────────────────────────────
// Firebase init
// ─────────────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();
const auth = admin.auth();
const { Timestamp, FieldValue } = admin.firestore;

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN(arr, n) {
  const a = [...arr];
  const out = [];
  for (let i = 0; i < n && a.length > 0; i++) {
    const idx = Math.floor(Math.random() * a.length);
    out.push(a.splice(idx, 1)[0]);
  }
  return out;
}
function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}
function randomPastMs(spanMs, minAgoMs = 0) {
  return NOW - randInt(minAgoMs, spanMs);
}
function tsFromMs(ms) {
  return Timestamp.fromMillis(ms);
}
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function gauss() {
  // Box-Muller, 평균 0, 표준편차 1
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
async function commitBatchedWrites(refsAndPayloads, label) {
  let written = 0;
  for (const part of chunk(refsAndPayloads, 400)) {
    const batch = db.batch();
    for (const { ref, data, op } of part) {
      if (op === 'set') batch.set(ref, data);
      else if (op === 'merge') batch.set(ref, data, { merge: true });
      else if (op === 'delete') batch.delete(ref);
      else if (op === 'update') batch.update(ref, data);
    }
    await batch.commit();
    written += part.length;
    if (VERBOSE || written % 1000 === 0) {
      console.log(`  [batch] ${label}: ${written}/${refsAndPayloads.length}`);
    }
  }
  return written;
}

// ─────────────────────────────────────────────────────────────
// FIXTURES — 한국어 자연어 풀
// ─────────────────────────────────────────────────────────────
const KOREAN_SURNAMES = [
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
  '한', '오', '서', '신', '권', '황', '안', '송', '류', '전',
  '홍', '고', '문', '양', '손', '배', '백', '허', '유', '남',
];
const KOREAN_GIVEN_FIRST = [
  '민', '서', '지', '현', '도', '준', '예', '수', '윤', '하',
  '주', '재', '소', '시', '진', '태', '승', '연', '나', '아',
  '유', '은', '채', '다', '리', '여', '경', '슬', '한', '루',
];
const KOREAN_GIVEN_SECOND = [
  '준', '우', '호', '훈', '아', '연', '진', '서', '영', '수',
  '빈', '민', '경', '희', '석', '환', '솔', '울', '기', '안',
  '율', '담', '하', '미', '림', '엽', '비', '리', '욱', '강',
];
const NICKNAMES_BASE = [
  '포카', '올인', '리버', '플랍', '잭팟', '에이스', '킹', '퀸', '슈터', '플레이어',
  '레이즈', '콜러', '폴드', '딜러', '블러퍼', '포커페이스', '터프', '쉐도우', '루키', '베테랑',
  '체크', '베팅', '핸드', '칩스', '카드', '머신', '하이', '로우', '풀하우스', '스트레이트',
  '플러시', '트립스', '쿼드', '롤러', '나이트', '데이', '레전드', '챔프', '러키', '쿨',
];

const PERSONAS = [
  { age: '20s', gender: 'M', tag: '대학생', weight: 25 },
  { age: '20s', gender: 'F', tag: '대학생', weight: 12 },
  { age: '30s', gender: 'M', tag: '직장인', weight: 30 },
  { age: '30s', gender: 'F', tag: '직장인', weight: 10 },
  { age: '40s', gender: 'M', tag: '단골', weight: 18 },
  { age: '40s', gender: 'F', tag: '단골', weight: 5 },
];

function pickPersona() {
  const total = PERSONAS.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of PERSONAS) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return PERSONAS[0];
}

function randomKoreanName() {
  return pick(KOREAN_SURNAMES) + pick(KOREAN_GIVEN_FIRST) + pick(KOREAN_GIVEN_SECOND);
}
function randomNickname(idx) {
  return pick(NICKNAMES_BASE) + randInt(10, 999);
}
function randomPhone(idx) {
  // 010-9XXX-XXXX (1인 1번호 + sim 식별을 위해 9 prefix)
  return `010-9${pad(Math.floor(idx / 10000), 3)}-${pad(idx % 10000, 4)}`;
}
function randomEmail(uid) {
  return `${uid}@simdemo.holdemnow.local`;
}

// 리뷰 본문 풀 (한국어 자연스러운 문장)
const REVIEW_BODIES_POSITIVE = [
  '딜러 분이 친절하시고 분위기 너무 좋네요. 다음에도 또 올 것 같아요.',
  '초보자도 부담 없이 즐길 수 있는 분위기. 친구랑 처음 갔는데 만족했습니다.',
  '테이블 회전이 빠르고 운영이 깔끔해요. 부산에서 손꼽히는 매장.',
  '안주 퀄리티가 생각보다 훨씬 좋았어요. 진심 강추합니다.',
  '주차도 편하고 조명도 적당해서 게임에 집중하기 좋아요.',
  '오너 분이 직접 신경 써주시는 게 느껴짐. 분위기 따뜻함.',
  '토너 운영이 체계적이고 블라인드 구조도 합리적이에요.',
  '캐쉬 게임 풍부하게 돌아가서 좋았어요. 또 가야지.',
  '딜러님 멘트가 재밌어서 게임이 즐거웠어요. 추천!',
  '시설 신축이라 깨끗하고 의자도 편함. 장시간 앉아도 안 힘들어요.',
  '여성 단독 방문도 부담 없이 갈 수 있는 분위기. 친구들 데려가야겠어요.',
  '단골 손님들과도 자연스럽게 친해질 수 있는 곳. 동네 사랑방.',
  '오랜만에 분위기 좋은 곳에서 게임하니 좋네요. 매장 운영 굿.',
  '주말 늦은 시간까지 운영해서 좋아요. 직장인 친화적.',
  '음료 서비스도 빠르고 친절합니다. 게임에만 집중할 수 있어요.',
  '비가오는날 들렀는데 분위기 너무 좋았습니다. 또 갈게요!',
  '딜러분들 실력 좋고 매너도 좋아요. 강추!',
  '바이인 다양해서 부담없이 즐길 수 있는 곳. 추천드려요.',
  '간식 무한리필이 진짜 좋아요 ㅎㅎ 게임도 재밌었음.',
  '친구 추천으로 갔는데 진짜 좋네요. 단골 될 듯.',
];
const REVIEW_BODIES_NEUTRAL = [
  '기본은 하는 곳입니다. 특별히 좋지도 나쁘지도 않아요.',
  '평일 저녁이라 사람이 좀 적었네요. 분위기는 나쁘지 않음.',
  '딜러 분 컨디션 따라 게임 진행 속도가 좀 다른 듯. 그래도 무난.',
  '시설은 평범한 편. 가격대도 평균적이에요.',
  '처음 가본 곳이라 비교가 어렵지만 큰 불만은 없었습니다.',
  '주차장이 좀 좁아서 만석이면 인근 유료 주차해야 해요.',
  '평일 토너는 인원 모이는데 시간이 걸리는 편. 주말은 모르겠음.',
  '게임 운영은 표준적. 분위기는 조용한 편이라 호불호 갈릴 듯.',
  '식음 메뉴는 단순한 편이지만 가격은 합리적.',
  '에어컨이 좀 약한 듯. 여름엔 약간 더울 수 있어요.',
];
const REVIEW_BODIES_NEGATIVE = [
  '음료 가격이 좀 비싼 편이에요. 분위기는 나쁘지 않지만 재방문은 글쎄...',
  '테이블 회전이 너무 느려서 답답했습니다. 다른 매장 갈게요.',
  '딜러 분의 진행이 미숙해서 게임 흐름이 자주 끊겼어요.',
  '주차장이 너무 좁고 인근 주차도 단속 빡셉니다. 대중교통 추천.',
  '단골 위주로 분위기가 형성된 듯. 처음 가면 좀 어색해요.',
  '에어컨이 약해서 여름에 더웠어요. 환기도 잘 안되는 느낌.',
  '소음이 좀 있어서 집중하기 어려웠습니다.',
  '안주 양도 적고 종류도 부족해요. 식사는 외부에서 해결.',
  '바이인 대비 칩이 적은 듯. 다른 매장과 비교됨.',
];

function randomReviewBody(rating) {
  // 별점에 따라 톤 다르게
  if (rating >= 4) return pick(REVIEW_BODIES_POSITIVE);
  if (rating === 3) return pick(REVIEW_BODIES_NEUTRAL);
  return pick(REVIEW_BODIES_NEGATIVE);
}

// 매장 답글 풀 (30%만)
const STORE_REPLIES = [
  '좋은 후기 남겨주셔서 감사합니다! 또 뵙겠습니다 ^^',
  '방문해 주셔서 감사해요. 더 좋은 서비스로 보답하겠습니다.',
  '소중한 의견 감사합니다. 지적해주신 부분 개선하도록 노력할게요.',
  '단골 손님으로 모시겠습니다. 다음 방문 기다리고 있을게요!',
  '말씀해주신 내용 운영에 반영하겠습니다. 감사합니다.',
];

// 매장 description (description) 풀
const STORE_DESCRIPTIONS = [
  '부산 지역 단골들이 가장 많이 찾는 동네 사랑방. 친절한 분위기와 합리적인 운영이 강점입니다.\n신규/단골 누구나 환영합니다.',
  '신축 인테리어로 깔끔한 매장. 토너와 캐쉬 모두 활발히 돌아가는 곳입니다.\n주말 토너 일정 매장 카톡으로 안내드립니다.',
  '오너가 직접 운영하는 정성 가득한 곳. 안주와 음료도 신경 써서 제공합니다.\n초보부터 고수까지 누구나 편하게 즐기실 수 있어요.',
  '24시간 운영(주말 한정). 야간 직장인 친화적 매장입니다.\n도시 직장인들의 퇴근 후 휴식처.',
  '여성 단독 방문도 부담 없는 매너 좋은 분위기. 첫 방문 손님 환영.\n조용히 게임에만 집중할 수 있는 환경.',
  '체계적인 토너 운영과 다양한 블라인드 구조. 토너 마니아들에게 추천.\n매주 정기 토너 + 월간 특별 이벤트 진행.',
  '동네 단골 위주의 따뜻한 분위기. 친구·동료와 함께 오시면 더욱 즐거우실 거예요.\n오랜만에 친목 다지기 좋은 장소.',
  '신규 회원 환영 이벤트 상시 진행. 첫 방문 시 무료 토너 참가권 제공.\n포커 입문자분들에게도 추천하는 친절한 매장.',
];

// 매장 pitch (한 줄 자랑) 풀
const STORE_PITCHES = [
  '딜러 친절도 1위',
  '신축 인테리어 깔끔',
  '주말 토너 풀하우스',
  '단골 손님 다수',
  '여성 환영 매너 분위기',
  '체계적인 토너 운영',
  '안주·음료 만족도 높음',
  '주차 편의 + 24시간 운영',
  '신규 환영 이벤트 상시',
  '캐쉬 게임 활발',
];

// 시설 풀
const FACILITY_OPTIONS = ['주차', '식사', '와이파이', '카드결제', '24시간', '여성친화', '신축', '단체석'];

// 예약 시 토너명 풀
const TOURNAMENT_NAMES = [
  '평일 미니 토너', '주말 정기 토너', '신년 스페셜 토너', '여성 한정 토너',
  '초보자 환영 토너', '하이롤러 토너', '월간 챔피언십', '주중 보너스 토너',
  '단골 감사 토너', '데일리 새틀라이트',
];

// 매장 post 템플릿 (확장)
const POST_TEMPLATES = [
  { headline: '오늘 저녁 8시 토너 50인 진행', body: '오늘 저녁 8시 토너 50인 진행 중입니다. 바이인 3만원 / 스타팅 1.5만 / 레벨 20분.', cardColor: 'red', cardEmojis: ['🎯', '🔥'], eventTags: ['토너', '오늘'] },
  { headline: '신규 가입 시 칩 +30% 이번 주말 한정', body: '신규 회원 가입 시 칩 +30% 보너스. 이번 주말까지만!', cardColor: 'pink', cardEmojis: ['🎁', '✨'], eventTags: ['이벤트', '신규'] },
  { headline: '딜러 모집 중 (경력 1년 이상 우대)', body: '함께 일할 딜러 모십니다. 경력 1년 이상 우대, 신입도 교육 후 채용 가능.', cardColor: 'navy', cardEmojis: ['🙋', '💼'], eventTags: ['채용', '딜러'] },
  { headline: '오늘 캐쉬 게임 8테이블 풀하우스', body: '오늘 캐쉬 게임 8테이블 모두 가동 중! 대기 1팀.', cardColor: 'green', cardEmojis: ['🃏', '💰'], eventTags: ['캐쉬', '실시간'] },
  { headline: '월요일 한정 평일 토너 무료 칩 1만', body: '월요일은 평일 무료 토너! 참가비 0원, 시작 칩 1만.', cardColor: 'gold', cardEmojis: ['🆓', '🎉'], eventTags: ['토너', '무료'] },
  { headline: '주차장 확장 완료 — 30대 가능', body: '주차장 확장 공사가 끝났습니다. 동시 30대까지 주차 가능.', cardColor: 'white', cardEmojis: ['📢', '📍'], eventTags: ['공지', '주차'] },
  { headline: '신규 회원 첫 토너 무료 참가권 증정', body: '처음 오시는 분께 첫 토너 무료 참가권 1매 드립니다.', cardColor: 'purple', cardEmojis: ['💎', '🎁'], eventTags: ['이벤트', '신규'] },
  { headline: '오늘부터 야식 메뉴 추가 — 라멘/도시락', body: '야식 메뉴 신설! 라멘 · 김치찌개 · 도시락 3종 출시.', cardColor: 'orange', cardEmojis: ['🍣', '🍻'], eventTags: ['식음', '신메뉴'] },
  { headline: '단골 감사 이벤트 — 토너 우승 상금 두 배', body: '평소 사랑해주시는 단골님께 감사드립니다. 이번 주 토너 우승 상금 두 배 지급!', cardColor: 'gold', cardEmojis: ['🏆', '🎊'], eventTags: ['이벤트', '단골'] },
  { headline: 'TV 시청 + 캠 추가 — 시야 더 좋아짐', body: '카메라 각도 조정으로 BB/SB 표시가 더 잘 보입니다.', cardColor: 'cyan', cardEmojis: ['📺', '💡'], eventTags: ['공지', '시설'] },
  { headline: '여성 토너 매주 토요일 오후 3시', body: '여성 한정 토너 매주 토요일 진행. 친구들과 함께 오세요!', cardColor: 'pink', cardEmojis: ['🌟', '🎉'], eventTags: ['토너', '여성'] },
  { headline: '추석 연휴 특별 토너 — 명절 보너스', body: '추석 연휴 동안 매일 특별 토너 진행. 명절 보너스 칩 지급.', cardColor: 'red', cardEmojis: ['🎁', '🎉'], eventTags: ['토너', '명절'] },
];

// LIVE 토너 풀 (과거 완료 기록용)
const PAST_LIVE_BUYINS = [10000, 20000, 30000, 50000, 100000];

// ─────────────────────────────────────────────────────────────
// 1. 가상 사용자 시드
// ─────────────────────────────────────────────────────────────
async function seedUsers() {
  console.log(`\n[users] ${TARGET_USERS}명 시드 시작...`);

  const users = [];
  for (let i = 0; i < TARGET_USERS; i++) {
    const idx = i + 1;
    const uid = `${SIM_PREFIX}u${pad(idx, 4)}`;
    const realName = randomKoreanName();
    const nickname = randomNickname(idx);
    const persona = pickPersona();
    const email = randomEmail(uid);
    const phone = randomPhone(idx);
    const signupMs = randomPastMs(FOUR_MONTHS_MS, ONE_WEEK_MS); // 1주~4개월 전
    users.push({
      uid, email, realName, nickname, persona, phone, signupMs,
    });
  }

  if (!EXECUTE) {
    console.log(`  [DRY] Auth ${users.length}명 + users doc ${users.length}건 — skip`);
    return { users, created: 0 };
  }

  // 1.1. Firebase Auth 사용자 생성 (배치 X — 1건씩 createUser API)
  let authCreated = 0, authSkipped = 0;
  for (const u of users) {
    try {
      await auth.createUser({
        uid: u.uid,
        email: u.email,
        emailVerified: true,
        password: 'sim-demo-pw-2026',
        displayName: u.nickname,
        disabled: false,
      });
      authCreated++;
    } catch (e) {
      if (e.code === 'auth/uid-already-exists' || e.code === 'auth/email-already-exists') {
        authSkipped++;
      } else {
        console.error(`  [auth-err] ${u.uid}: ${e.message}`);
      }
    }
    if ((authCreated + authSkipped) % 50 === 0) {
      console.log(`  [auth] ${authCreated + authSkipped}/${users.length}`);
    }
  }
  console.log(`  [auth] 완료: 생성 ${authCreated} / 이미 있음 ${authSkipped}`);

  // 1.2. users/{uid} Firestore 문서 batch
  const writes = users.map((u) => ({
    op: 'set',
    ref: db.collection('users').doc(u.uid),
    data: {
      uid: u.uid,
      email: u.email,
      role: 'player',
      roles: ['player'],
      providers: ['password'],
      signupSource: 'player-signup',
      status: 'active',
      displayName: u.nickname,
      nickname: u.nickname,
      realName: u.realName,
      phone: u.phone,
      kycCompletedAt: tsFromMs(u.signupMs),
      kycSource: 'signup',
      agreeMarketing: Math.random() < 0.5,
      signupAt: tsFromMs(u.signupMs),
      createdAt: tsFromMs(u.signupMs),
      updatedAt: tsFromMs(u.signupMs),
      // 시드 메타
      seedSource: SEED_SOURCE,
      personaTag: u.persona.tag,
      personaAge: u.persona.age,
      personaGender: u.persona.gender,
    },
  }));
  const wrote = await commitBatchedWrites(writes, 'users doc');
  console.log(`  [users] 완료: doc ${wrote}건 작성 (auth 생성 ${authCreated})`);
  return { users, created: wrote };
}

// ─────────────────────────────────────────────────────────────
// 2. 매장 정보 풍성화
// ─────────────────────────────────────────────────────────────
async function loadDemoStores() {
  const snap = await db.collection('stores').where('isDemo', '==', true).get();
  if (snap.empty) {
    console.error('[FATAL] 데모 매장(isDemo=true)이 없습니다. seedStoresBulk 먼저 실행 필요.');
    process.exit(1);
  }
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

async function seedStoreEnrichment(stores) {
  console.log(`\n[stores] ${stores.length}개 매장 정보 풍성화...`);

  const writes = stores.map((s, idx) => {
    // tier 분포: free 80% / standard 15% / pro 5%
    const tierRoll = Math.random();
    const tier = tierRoll < 0.8 ? 'free' : tierRoll < 0.95 ? 'standard' : 'pro';
    // tier에 따라 활발도 가중
    const activity = tier === 'pro' ? 1.5 : tier === 'standard' ? 1.2 : 1.0;

    const facilities = pickN(FACILITY_OPTIONS, randInt(2, 5));
    const description = pick(STORE_DESCRIPTIONS);
    const pitch = pick(STORE_PITCHES);

    // 활발도에 따라 카운트 분산
    const liveSessionCount = Math.max(0, Math.floor(rand(0, 50) * activity));
    const directionsClicks = Math.max(5, Math.floor(rand(10, 200) * activity));

    return {
      op: 'merge',
      ref: db.collection('stores').doc(s.id),
      data: {
        description,
        pitch,
        facilities,
        tier,
        liveSessionCount,
        // reviewCount/averageRating는 리뷰 시드 후 별도 계산해서 덮어씀 (트리거 비활성)
        directionsClicks, // 시드 metrics와 별개로 store 본문에도 둠 (디버깅용)
        // seed marker
        seedSource: SEED_SOURCE,
        updatedAt: tsFromMs(NOW),
      },
    };
  });

  if (!EXECUTE) {
    console.log(`  [DRY] ${writes.length}개 매장 merge 갱신 — skip`);
    return { updated: 0 };
  }
  const wrote = await commitBatchedWrites(writes, 'stores enrichment');
  console.log(`  [stores] 완료: ${wrote}개 매장 갱신`);
  return { updated: wrote };
}

// 매장 metrics/global 갱신 — favoriteAdds/directionsClicks
async function seedStoreMetrics(stores) {
  console.log(`\n[metrics] ${stores.length}개 매장 metrics/global 갱신...`);
  const writes = stores.map((s) => {
    const favoriteAdds = randInt(5, 80);
    const directionsClicks = randInt(10, 200);
    return {
      op: 'merge',
      ref: db.collection('stores').doc(s.id).collection('metrics').doc('global'),
      data: {
        favoriteAdds,
        directionsClicks,
        seedSource: SEED_SOURCE,
        updatedAt: tsFromMs(NOW),
      },
    };
  });
  if (!EXECUTE) {
    console.log(`  [DRY] ${writes.length}개 metrics merge — skip`);
    return { updated: 0 };
  }
  const wrote = await commitBatchedWrites(writes, 'metrics global');
  console.log(`  [metrics] 완료: ${wrote}개 갱신`);
  return { updated: wrote };
}

// ─────────────────────────────────────────────────────────────
// 3. 리뷰 시드
// ─────────────────────────────────────────────────────────────
async function seedReviews(users, stores) {
  console.log(`\n[reviews] 리뷰 시드 시작...`);

  const writes = [];
  // 매장별 별점 누적 (마지막에 averageRating 계산)
  const storeStats = new Map(); // storeId → { count, sum, dist }

  for (const store of stores) {
    // 활발한 매장(액티비티 가중)은 더 많은 리뷰
    const activityRoll = Math.random();
    const baseCount = TARGET_REVIEWS_PER_STORE_AVG;
    // gauss 분포로 표준편차 7 정도, 최소 3, 최대 35
    const count = Math.min(35, Math.max(3, Math.round(baseCount + gauss() * 7 + (activityRoll > 0.7 ? 10 : 0))));

    const reviewers = pickN(users, count); // 1 user x 1 store 1 review

    let sum = 0;
    const dist = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

    for (const u of reviewers) {
      // 별점 분산: 5점 35% / 4점 30% / 3점 20% / 2점 10% / 1점 5%
      const r = Math.random();
      let rating;
      if (r < 0.35) rating = 5;
      else if (r < 0.65) rating = 4;
      else if (r < 0.85) rating = 3;
      else if (r < 0.95) rating = 2;
      else rating = 1;

      const body = randomReviewBody(rating);
      const createdMs = randomPastMs(FOUR_MONTHS_MS, ONE_DAY_MS); // 1일~4개월 전
      const hasReply = Math.random() < 0.3;
      const replyMs = hasReply ? createdMs + randInt(ONE_DAY_MS, 7 * ONE_DAY_MS) : null;

      const reviewId = `${SIM_PREFIX}rv_${u.uid.replace(SIM_PREFIX, '')}_${store.id.slice(-6)}`;
      writes.push({
        op: 'set',
        ref: db.collection('stores').doc(store.id).collection('reviews').doc(reviewId),
        data: {
          storeId: store.id,
          authorUid: u.uid,
          authorName: u.nickname,
          rating,
          body,
          photoUrls: [],
          visitDate: tsFromMs(createdMs - randInt(ONE_DAY_MS, 7 * ONE_DAY_MS)),
          helpfulCount: randInt(0, 5),
          createdAt: tsFromMs(createdMs),
          updatedAt: tsFromMs(createdMs),
          editedAt: null,
          hidden: false,
          ...(hasReply
            ? {
                storeReply: pick(STORE_REPLIES),
                storeReplyAt: tsFromMs(replyMs),
                storeRepliedBy: store.data.ownerUid || 'demo-owner',
              }
            : {}),
          seedSource: SEED_SOURCE,
        },
      });

      sum += rating;
      dist[String(rating)]++;
    }
    storeStats.set(store.id, { count, sum, dist });
  }

  console.log(`  [reviews] 총 ${writes.length}건 생성 예정 (매장당 평균 ${(writes.length / stores.length).toFixed(1)}건)`);

  if (!EXECUTE) {
    console.log(`  [DRY] skip`);
    return { created: 0, storeStats };
  }

  const wrote = await commitBatchedWrites(writes, 'reviews');

  // 매장 본문에 reviewCount/averageRating/ratingDistribution 직접 set
  // (aggregateReviewStats 트리거가 비동기로 작동하지만, 시드 즉시 노출 위해 수동 갱신)
  console.log(`  [reviews] 매장 집계 필드 갱신 중...`);
  const aggWrites = [];
  for (const [storeId, stat] of storeStats.entries()) {
    const avg = stat.count > 0 ? Math.round((stat.sum / stat.count) * 10) / 10 : 0;
    aggWrites.push({
      op: 'merge',
      ref: db.collection('stores').doc(storeId),
      data: {
        reviewCount: stat.count,
        averageRating: avg,
        ratingDistribution: stat.dist,
        updatedAt: tsFromMs(NOW),
      },
    });
  }
  await commitBatchedWrites(aggWrites, 'store agg');
  console.log(`  [reviews] 완료: ${wrote}건 + 매장 ${aggWrites.length}건 집계 갱신`);
  return { created: wrote, storeStats };
}

// ─────────────────────────────────────────────────────────────
// 4. 즐겨찾기 시드
// ─────────────────────────────────────────────────────────────
async function seedFavorites(users, stores) {
  console.log(`\n[favorites] 즐겨찾기 시드 시작...`);
  // 인기 매장 상위 20개를 weight 높게
  const popular = stores.slice(0, 20);

  const writes = [];
  for (const u of users) {
    // 사용자당 평균 4개 즐겨찾기 (gauss ±2)
    const count = Math.min(10, Math.max(0, Math.round(TARGET_FAVS_PER_USER_AVG + gauss() * 2)));
    if (count === 0) continue;

    // 60%는 인기 매장에서, 40%는 전체에서
    const fromPopular = Math.min(count, Math.ceil(count * 0.6));
    const fromAll = count - fromPopular;

    const pickedPopular = pickN(popular, fromPopular);
    const remaining = stores.filter((s) => !pickedPopular.some((p) => p.id === s.id));
    const pickedAll = pickN(remaining, fromAll);
    const picked = [...pickedPopular, ...pickedAll];

    for (const s of picked) {
      const createdMs = randomPastMs(THREE_MONTHS_MS, ONE_DAY_MS);
      writes.push({
        op: 'set',
        ref: db.collection('users').doc(u.uid).collection('favorites').doc(s.id),
        data: {
          storeId: s.id,
          storeName: s.data.name || '',
          notifyOnLive: Math.random() < 0.7,
          createdAt: tsFromMs(createdMs),
          seedSource: SEED_SOURCE,
        },
      });
    }
  }
  console.log(`  [favorites] 총 ${writes.length}건 생성 예정`);
  if (!EXECUTE) {
    console.log(`  [DRY] skip`);
    return { created: 0 };
  }
  const wrote = await commitBatchedWrites(writes, 'favorites');
  console.log(`  [favorites] 완료: ${wrote}건`);
  return { created: wrote };
}

// ─────────────────────────────────────────────────────────────
// 5. 예약 시드
// ─────────────────────────────────────────────────────────────
async function seedReservations(users, stores) {
  console.log(`\n[reservations] 예약 시드 시작...`);
  const writes = [];

  for (const store of stores) {
    const count = Math.min(25, Math.max(2, Math.round(TARGET_RESERVATIONS_PER_STORE_AVG + gauss() * 5)));
    const reservers = pickN(users, count);

    for (const u of reservers) {
      // 상태 분산: pending 5% / confirmed 25% / completed 50% / cancelled 15% / no_show 5%
      const r = Math.random();
      let status;
      if (r < 0.05) status = 'pending';
      else if (r < 0.30) status = 'confirmed';
      else if (r < 0.80) status = 'completed';
      else if (r < 0.95) status = 'cancelled';
      else status = 'no_show';

      const createdMs = randomPastMs(THREE_MONTHS_MS, ONE_DAY_MS);
      // 예약 시각: status에 따라 과거/미래 분산
      let reservedMs;
      if (status === 'pending' || status === 'confirmed') {
        // 미래 (지금부터 7일 이내)
        reservedMs = NOW + randInt(2 * 60 * 60 * 1000, 7 * ONE_DAY_MS);
      } else {
        // 과거 (createdMs 이후, NOW 이전)
        reservedMs = createdMs + randInt(ONE_DAY_MS, 14 * ONE_DAY_MS);
        if (reservedMs > NOW) reservedMs = NOW - randInt(ONE_DAY_MS, 30 * ONE_DAY_MS);
      }

      const reservationId = `${SIM_PREFIX}rs_${u.uid.replace(SIM_PREFIX, '')}_${store.id.slice(-6)}_${randInt(100, 999)}`;
      const partySize = randInt(1, 6);
      const tournamentName = pick(TOURNAMENT_NAMES);
      const respondedMs = status !== 'pending' ? createdMs + randInt(60 * 60 * 1000, ONE_DAY_MS) : null;

      const data = {
        storeId: store.id,
        storeName: store.data.name || '',
        authorUid: u.uid,
        authorName: u.nickname,
        authorPhone: u.phone,
        reservedFor: tsFromMs(reservedMs),
        partySize,
        note: Math.random() < 0.3 ? '문의 있어서 카톡 드릴게요' : null,
        participatingGame: tournamentName,
        status,
        createdAt: tsFromMs(createdMs),
        updatedAt: tsFromMs(respondedMs || createdMs),
        respondedAt: respondedMs ? tsFromMs(respondedMs) : null,
        respondedBy: respondedMs ? (store.data.ownerUid || 'demo-owner') : null,
        responseNote: null,
        readByStore: status !== 'pending',
        durationMinutes: 120,
        confirmedAt: status === 'confirmed' || status === 'completed' ? tsFromMs(respondedMs || createdMs) : null,
        cancelledAt: status === 'cancelled' ? tsFromMs(respondedMs || createdMs) : null,
        cancelledBy: status === 'cancelled' ? (Math.random() < 0.6 ? 'user' : 'store') : null,
        seedSource: SEED_SOURCE,
      };
      writes.push({
        op: 'set',
        ref: db.collection('stores').doc(store.id).collection('reservations').doc(reservationId),
        data,
      });
    }
  }
  console.log(`  [reservations] 총 ${writes.length}건 생성 예정`);
  if (!EXECUTE) {
    console.log(`  [DRY] skip`);
    return { created: 0 };
  }
  const wrote = await commitBatchedWrites(writes, 'reservations');
  console.log(`  [reservations] 완료: ${wrote}건`);
  return { created: wrote };
}

// ─────────────────────────────────────────────────────────────
// 6. 매장 소식(posts) 시드 — 과거 누적 + 활성 일부
// ─────────────────────────────────────────────────────────────
async function seedPosts(stores) {
  console.log(`\n[posts] 매장 소식 시드 시작...`);
  const writes = [];

  for (const store of stores) {
    const count = Math.min(8, Math.max(2, Math.round(TARGET_POSTS_PER_STORE_AVG + gauss() * 2)));
    const usedTemplates = pickN(POST_TEMPLATES, count);
    const ownerUid = store.data.ownerUid || 'demo-seeder';

    for (let i = 0; i < usedTemplates.length; i++) {
      const tpl = usedTemplates[i];
      // 첫 1~2건은 활성(24h 후 만료), 나머지는 과거 만료
      const isActive = i < 2 && Math.random() < 0.5;
      const createdMs = isActive
        ? randomPastMs(ONE_DAY_MS, 60 * 60 * 1000) // 최근 1일~1시간 전
        : randomPastMs(FOUR_MONTHS_MS, ONE_DAY_MS); // 1일~4개월 전
      const expiresMs = createdMs + 24 * 60 * 60 * 1000;

      const postId = `${SIM_PREFIX}pt_${store.id.slice(-6)}_${i}_${randInt(100, 999)}`;
      writes.push({
        op: 'set',
        ref: db.collection('stores').doc(store.id).collection('posts').doc(postId),
        data: {
          storeId: store.id,
          storeName: store.data.name || '',
          body: tpl.body,
          headline: tpl.headline,
          cardColor: tpl.cardColor,
          cardEmoji: tpl.cardEmojis[0] || '',
          cardEmojis: tpl.cardEmojis,
          imageUrls: [],
          eventTags: tpl.eventTags || [],
          ctaUrl: '',
          ctaLabel: '',
          authorType: 'store',
          authorUid: ownerUid,
          authorName: store.data.name || '',
          status: 'published',
          flagCount: 0,
          createdAt: tsFromMs(createdMs),
          serverCreatedAt: tsFromMs(createdMs),
          expiresAt: tsFromMs(expiresMs),
          seedSource: SEED_SOURCE,
        },
      });
    }
  }
  console.log(`  [posts] 총 ${writes.length}건 생성 예정`);
  if (!EXECUTE) {
    console.log(`  [DRY] skip`);
    return { created: 0 };
  }
  const wrote = await commitBatchedWrites(writes, 'posts');
  console.log(`  [posts] 완료: ${wrote}건`);
  return { created: wrote };
}

// ─────────────────────────────────────────────────────────────
// 7. LIVE 세션 과거 기록 시드 (completed)
// ─────────────────────────────────────────────────────────────
async function seedPastLiveSessions(stores) {
  console.log(`\n[liveSessions] 과거 LIVE 세션 기록 시드...`);
  const writes = [];

  for (const store of stores) {
    const count = Math.min(8, Math.max(1, Math.round(TARGET_LIVE_PER_STORE_AVG + gauss() * 1.5)));
    for (let i = 0; i < count; i++) {
      const buyIn = pick(PAST_LIVE_BUYINS);
      const totalPlayers = randInt(20, 80);
      const startedMs = randomPastMs(FOUR_MONTHS_MS, ONE_DAY_MS);
      const endedMs = startedMs + randInt(3 * 60 * 60 * 1000, 6 * 60 * 60 * 1000);

      const sessionId = `${SIM_PREFIX}ls_${store.id.slice(-6)}_${i}_${randInt(100, 999)}`;
      writes.push({
        op: 'set',
        ref: db.collection('liveSessions').doc(sessionId),
        data: {
          storeId: store.id,
          storeName: store.data.name || '',
          templateId: 'sim-template',
          tournamentName: pick(TOURNAMENT_NAMES),
          tournamentType: 'tournament',
          posterStyle: 'default',
          buyIn,
          totalPlayers,
          currentEntries: totalPlayers,
          rebuysCount: randInt(0, totalPlayers / 4),
          startingStack: 15000,
          blindStructure: [],
          lateRegEndLevel: 6,
          status: 'completed',
          currentLevel: randInt(15, 25),
          levelSecondsLeft: 0,
          levelEndsAt: null,
          smallBlind: 500,
          bigBlind: 1000,
          ante: 100,
          playersRemaining: 1,
          tablesRemaining: 1,
          prizePool: Math.floor(totalPlayers * buyIn * 0.8),
          lateRegClosed: true,
          viewerCount: 0,
          createdAt: tsFromMs(startedMs - 30 * 60 * 1000),
          startedAt: tsFromMs(startedMs),
          endedAt: tsFromMs(endedMs),
          finishingAt: null,
          totalStartedAt: tsFromMs(startedMs),
          totalPausedMs: 0,
          pausedAt: null,
          // storeRegion은 비워두면 됨 (필수 X)
          seedSource: SEED_SOURCE,
        },
      });
    }
  }
  console.log(`  [liveSessions] 총 ${writes.length}건 생성 예정`);
  if (!EXECUTE) {
    console.log(`  [DRY] skip`);
    return { created: 0 };
  }
  const wrote = await commitBatchedWrites(writes, 'liveSessions');
  console.log(`  [liveSessions] 완료: ${wrote}건`);
  return { created: wrote };
}

// ─────────────────────────────────────────────────────────────
// UNSEED — 모든 시드 데이터 삭제
// ─────────────────────────────────────────────────────────────
async function unseedAll() {
  console.log('\n[unseed] 시드 데이터 회수 시작...');
  const stats = { users: 0, reviews: 0, favorites: 0, reservations: 0, posts: 0, live: 0, metrics: 0, authDeleted: 0 };

  // 1) Auth 사용자 삭제 (uid prefix sim-)
  if (shouldRun('users')) {
    console.log('  [unseed:auth] sim- prefix Auth 사용자 조회...');
    const simUids = [];
    let pageToken = undefined;
    do {
      const list = await auth.listUsers(1000, pageToken);
      for (const u of list.users) {
        if (u.uid.startsWith(SIM_PREFIX)) simUids.push(u.uid);
      }
      pageToken = list.pageToken;
    } while (pageToken);
    console.log(`  [unseed:auth] sim Auth 사용자: ${simUids.length}명`);
    if (EXECUTE && simUids.length > 0) {
      // deleteUsers API: 최대 1000건씩
      for (const part of chunk(simUids, 1000)) {
        const r = await auth.deleteUsers(part);
        stats.authDeleted += r.successCount;
        if (r.failureCount > 0) console.error(`  [unseed:auth] 실패 ${r.failureCount}건`);
      }
      console.log(`  [unseed:auth] Auth 삭제: ${stats.authDeleted}건`);
    }
  }

  // 2) collectionGroup 단위로 seedSource='ops-sim' 검색해서 삭제
  const groups = [
    { name: 'reviews', key: 'reviews' },
    { name: 'favorites', key: 'favorites' },
    { name: 'reservations', key: 'reservations' },
    { name: 'posts', key: 'posts' },
    { name: 'metrics', key: 'metrics' },
  ];
  for (const g of groups) {
    if (!shouldRun(g.name)) continue;
    const snap = await db.collectionGroup(g.key).where('seedSource', '==', SEED_SOURCE).get();
    console.log(`  [unseed] ${g.name}: 발견 ${snap.size}건`);
    if (EXECUTE && snap.size > 0) {
      const refs = snap.docs.map((d) => ({ op: 'delete', ref: d.ref }));
      const wrote = await commitBatchedWrites(refs, `del ${g.name}`);
      stats[g.name] = wrote;
    }
  }

  // 3) liveSessions (top-level) seedSource 필터
  if (shouldRun('live')) {
    const lsSnap = await db.collection('liveSessions').where('seedSource', '==', SEED_SOURCE).get();
    console.log(`  [unseed] liveSessions: 발견 ${lsSnap.size}건`);
    if (EXECUTE && lsSnap.size > 0) {
      const refs = lsSnap.docs.map((d) => ({ op: 'delete', ref: d.ref }));
      const wrote = await commitBatchedWrites(refs, 'del liveSessions');
      stats.live = wrote;
    }
  }

  // 4) users (sim- prefix) Firestore doc
  if (shouldRun('users')) {
    const usSnap = await db.collection('users').where('seedSource', '==', SEED_SOURCE).get();
    console.log(`  [unseed] users: 발견 ${usSnap.size}건`);
    if (EXECUTE && usSnap.size > 0) {
      const refs = usSnap.docs.map((d) => ({ op: 'delete', ref: d.ref }));
      const wrote = await commitBatchedWrites(refs, 'del users');
      stats.users = wrote;
    }
  }

  // 5) 매장 본문에 박힌 seedSource는 보존성 데이터를 삭제하면 안되므로
  //    description/pitch/facilities/tier 등은 그대로 두고
  //    seedSource 필드만 FieldValue.delete()로 제거하는 정책.
  //    단, reviewCount/averageRating/ratingDistribution도 0으로 리셋.
  if (shouldRun('stores')) {
    const storeSnap = await db.collection('stores').where('seedSource', '==', SEED_SOURCE).get();
    console.log(`  [unseed] stores 풍성화 흔적: ${storeSnap.size}개 (seedSource 필드 제거 + 집계 리셋)`);
    if (EXECUTE && storeSnap.size > 0) {
      const refs = storeSnap.docs.map((d) => ({
        op: 'update',
        ref: d.ref,
        data: {
          seedSource: FieldValue.delete(),
          // 집계 리셋 (트리거가 다시 계산)
          reviewCount: 0,
          averageRating: 0,
          ratingDistribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        },
      }));
      const wrote = await commitBatchedWrites(refs, 'reset stores');
      stats.metrics = wrote; // metric 항목 재활용
    }
  }

  console.log('\n[unseed] 회수 완료:');
  console.log(stats);
  return stats;
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function run() {
  console.log('='.repeat(72));
  console.log('HoldemNow Ops Simulation Seeder');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Mode:    ${EXECUTE ? 'EXECUTE (real writes)' : 'DRY-RUN (no writes)'}`);
  console.log(`Action:  ${UNSEED ? 'UNSEED (delete)' : 'SEED (create)'}`);
  console.log(`Only:    ${ONLY ? Array.from(ONLY).join(',') : '(all categories)'}`);
  console.log('='.repeat(72));

  if (UNSEED) {
    await unseedAll();
    if (!EXECUTE) console.log('\nDRY-RUN. 실제 회수: --execute 추가.');
    return;
  }

  const stores = await loadDemoStores();
  console.log(`\n[init] 데모 매장 ${stores.length}개 로드`);

  const results = {};

  // 의존: users 먼저
  if (shouldRun('users')) {
    results.users = await seedUsers();
  } else {
    // users 카테고리 skip 시 기존 sim 사용자 로드
    const snap = await db.collection('users').where('seedSource', '==', SEED_SOURCE).get();
    results.users = {
      users: snap.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          nickname: data.nickname || data.displayName || '익명',
          phone: data.phone || '',
          email: data.email || '',
        };
      }),
      created: 0,
    };
    console.log(`\n[users:skip] 기존 sim 사용자 ${results.users.users.length}명 재사용`);
  }
  const users = results.users.users;

  if (users.length === 0) {
    console.log('[WARN] users가 0명 → 의존 카테고리(reviews/favorites/reservations) skip 강제');
  }

  if (shouldRun('stores')) {
    results.stores = await seedStoreEnrichment(stores);
  }
  if (shouldRun('metrics')) {
    results.metrics = await seedStoreMetrics(stores);
  }
  if (shouldRun('reviews') && users.length > 0) {
    results.reviews = await seedReviews(users, stores);
  }
  if (shouldRun('favorites') && users.length > 0) {
    results.favorites = await seedFavorites(users, stores);
  }
  if (shouldRun('reservations') && users.length > 0) {
    results.reservations = await seedReservations(users, stores);
  }
  if (shouldRun('posts')) {
    results.posts = await seedPosts(stores);
  }
  if (shouldRun('live')) {
    results.live = await seedPastLiveSessions(stores);
  }

  console.log('\n' + '='.repeat(72));
  console.log('[summary]');
  console.log(`  users:        ${results.users?.created ?? 0}건`);
  console.log(`  stores:       ${results.stores?.updated ?? 0}개`);
  console.log(`  metrics:      ${results.metrics?.updated ?? 0}개`);
  console.log(`  reviews:      ${results.reviews?.created ?? 0}건`);
  console.log(`  favorites:    ${results.favorites?.created ?? 0}건`);
  console.log(`  reservations: ${results.reservations?.created ?? 0}건`);
  console.log(`  posts:        ${results.posts?.created ?? 0}건`);
  console.log(`  live:         ${results.live?.created ?? 0}건`);
  console.log('='.repeat(72));

  if (!EXECUTE) {
    console.log('\nDRY-RUN. 실제 실행: --execute 추가.');
  }
}

run().catch((e) => {
  console.error('\n[FATAL]', e);
  process.exit(1);
});
