/* eslint-disable no-console */
/**
 * seedDemoLive.js — 데모 매장 "실시간 LIVE 구동 + 오늘의 소식" 시드
 *
 * 목적:
 *   사용자 앱(홈/지도/매장찾기 LIVE 피드)이 텅 비어 보이지 않도록,
 *   데모 매장 20곳에 **지금 실시간으로 카운트다운하는 running LIVE 세션**과
 *   신선한 "오늘의 소식"(24h) 1건씩을 일괄 등록.
 *
 * 핵심 — 왜 그냥 status='running'만 박으면 안 되는가:
 *   admin-web/src/lib/live.ts의 computeTimelinePosition은 절대 시각 기반.
 *   "지금 몇 레벨·몇 초 남았나"는 (now - totalStartedAt - totalPausedMs)를
 *   blindStructure에 대입해 계산한다. 따라서 살아있는 타이머처럼 보이려면:
 *     · status='running'
 *     · totalStartedAt = 과거 시각 (구조 총길이보다 충분히 작은 elapsed)
 *     · blindStructureLocked = 시작 시점 스냅샷 (timeline의 진실의 원천)
 *     · finishingAt = null
 *   세 조건을 모두 만족해야 모바일 LIVE 피드(subscribeAllLiveSessions)에 노출되고
 *   매초 카운트다운이 흐른다.
 *
 * autoStop cron 생존 조건 (firebase/functions/src/live/autoStopFinishedSessions.ts):
 *   · finishingAt = null (그레이스 만료 아님)
 *   · elapsed < 구조 총길이 + 30분 (zombieOverrun 아님)
 *   → 25레벨 × 20분 = 500분 구조에 totalStartedAt을 6~95분 전으로 두면
 *     앞으로 수 시간 동안 살아있는 "진행 중" 세션으로 유지된다.
 *
 * 멱등성:
 *   · liveSessions doc ID = `demo-live-{storeId}` (매장당 1세션, set 덮어쓰기)
 *     → 재실행 시 totalStartedAt 리프레시(타이머 리셋) + 중복 0
 *   · posts doc ID = `demo-live-post-{storeId}` (매장당 1글, set 덮어쓰기)
 *     → 재실행 시 24h 만료 윈도우 리프레시
 *   · 두 컬렉션 모두 seedSource='demo-live' 표식 → 일괄 회수 가능
 *
 * 사용법:
 *   # dry-run (디폴트, 쓰기 없음)
 *   node firebase/functions/scripts/seedDemoLive.js
 *   # 실제 실행
 *   node firebase/functions/scripts/seedDemoLive.js --execute
 *   # 개수 조절
 *   node firebase/functions/scripts/seedDemoLive.js --execute --count=30
 *   # 회수 (LIVE 세션 + 시드 글 모두 삭제)
 *   node firebase/functions/scripts/seedDemoLive.js --unseed --execute
 */

const admin = require('firebase-admin');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'holdemnow-prod';
const SEED_SOURCE = 'demo-live';
const POST_SEEDER_UID = 'demo-live-seeder';
const NOW = Date.now();
const TTL_MS = 24 * 60 * 60 * 1000;

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const VERBOSE = argv.includes('--verbose') || argv.includes('-v');
const UNSEED = argv.includes('--unseed');
const TARGET_COUNT = (() => {
  const a = argv.find((x) => x.startsWith('--count='));
  if (!a) return 20;
  const n = parseInt(a.replace('--count=', ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
})();

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function tsFromMs(ms) { return Timestamp.fromMillis(ms); }
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 만원 단위 내림 prizePool (templates.computeAutoPrizePool과 동일 룰). */
function computeAutoPrizePool(buyIn, players, payoutPercent) {
  const raw = buyIn * players * (payoutPercent / 100);
  return Math.floor(raw / 10000) * 10000;
}

// ─────────────────────────────────────────────────────────────
// 블라인드 구조 — 25레벨 × 20분 (총 500분). 앤티는 4레벨부터.
// ─────────────────────────────────────────────────────────────
const BLIND_TABLE = [
  [100, 200], [200, 400], [300, 600], [400, 800], [500, 1000],
  [700, 1400], [1000, 2000], [1500, 3000], [2000, 4000], [3000, 6000],
  [4000, 8000], [5000, 10000], [7000, 14000], [10000, 20000], [15000, 30000],
  [20000, 40000], [30000, 60000], [40000, 80000], [60000, 120000], [80000, 160000],
  [100000, 200000], [150000, 300000], [200000, 400000], [300000, 600000], [400000, 800000],
];

function buildBlindStructure() {
  return BLIND_TABLE.map(([sb, bb], i) => ({
    level: i + 1,
    sb,
    bb,
    ante: i >= 3 ? Math.round(bb / 8 / 100) * 100 : 0,
    durationSec: 1200, // 20분
  }));
}

/** 절대시각 기반 현재 위치 계산 (live.ts computeTimelinePosition의 running 케이스 미러). */
function computeTimelinePosition(structure, totalStartedMs) {
  const elapsedMs = Math.max(0, NOW - totalStartedMs);
  let cumulativeMs = 0;
  for (const lvl of structure) {
    const durMs = Math.max(0, lvl.durationSec) * 1000;
    if (cumulativeMs + durMs > elapsedMs) {
      const secondsLeft = Math.max(0, Math.ceil((cumulativeMs + durMs - elapsedMs) / 1000));
      return { level: lvl.level, secondsLeft, sb: lvl.sb, bb: lvl.bb, ante: lvl.ante };
    }
    cumulativeMs += durMs;
  }
  const last = structure[structure.length - 1];
  return { level: last.level, secondsLeft: 0, sb: last.sb, bb: last.bb, ante: last.ante };
}

// ─────────────────────────────────────────────────────────────
// 토너 메타 풀
// ─────────────────────────────────────────────────────────────
const TOURNEY_NAMES = [
  '데일리 8시 토너', '평일 미니 토너', '주중 보너스 토너', '하이롤러 나이트',
  '신규 환영 토너', '단골 감사 토너', '레이트 나이트 터보', '위클리 챔피언십',
  '데일리 새틀라이트', '여성 친화 토너', '프리롤 스페셜', '미드나잇 딥스택',
];
const BUYINS = [10000, 20000, 30000, 50000];
const POSTER_STYLES = ['default', 'neon', 'classic', 'bold'];

// ─────────────────────────────────────────────────────────────
// "오늘의 소식" — LIVE 진행 중 톤으로 큐레이션 (20종)
// cardColor / cardEmojis는 posts.ts 화이트리스트와 일치.
// ─────────────────────────────────────────────────────────────
const POST_TEMPLATES = [
  { headline: '지금 토너 진행 중 — 레이트 등록 가능!', body: '현재 토너 LIVE 진행 중입니다. 레이트 등록 열려 있어요. 지금 오셔도 충분히 인더머니 가능! 바로 합류하세요.', cardColor: 'red', cardEmojis: ['🔥', '🎯'], eventTags: ['토너', 'LIVE'] },
  { headline: '오늘 저녁 캐쉬 + 토너 동시 가동', body: '캐쉬 게임과 토너 동시에 돌아갑니다. 캐쉬 자리도 여유 있어요. 편하게 오셔서 원하는 게임 골라 즐기세요.', cardColor: 'green', cardEmojis: ['🃏', '💰'], eventTags: ['캐쉬', '실시간'] },
  { headline: '딥스택 토너 진행 중 — 스타팅 3만', body: '오늘은 딥스택! 스타팅 3만 칩으로 여유로운 플레이. 레벨 20분 구조라 초보도 부담 없어요. LIVE 보고 오세요.', cardColor: 'navy', cardEmojis: ['♠️', '🏆'], eventTags: ['토너', '딥스택'] },
  { headline: '신규 회원 첫 토너 무료 참가권', body: '처음 오시는 분께 오늘 진행 중인 토너 무료 참가권 드립니다. 가입 5분이면 끝! 지금 바로 합류 가능해요.', cardColor: 'pink', cardEmojis: ['🎁', '✨'], eventTags: ['이벤트', '신규'] },
  { headline: '하이롤러 나이트 — 프라이즈풀 빵빵', body: '오늘 하이롤러 나이트 진행 중! 참가 인원 많아 프라이즈풀 두둑합니다. 한 방 노리는 분들 지금 오세요.', cardColor: 'gold', cardEmojis: ['💎', '🏆'], eventTags: ['토너', '하이롤러'] },
  { headline: '레이트 등록 마감 임박 — 서두르세요', body: '진행 중인 토너 레이트 등록이 곧 마감됩니다. 지금 오시면 막차 탑승 가능! 늦으면 다음 토너 기다리셔야 해요.', cardColor: 'orange', cardEmojis: ['⚡', '🚨'], eventTags: ['토너', '마감임박'] },
  { headline: '단골 감사 토너 — 우승 상금 두 배', body: '평소 사랑해주시는 단골님께 감사! 오늘 토너 우승 상금 두 배 지급. 진행 중이니 지금 바로 합류하세요.', cardColor: 'red', cardEmojis: ['🎊', '🏆'], eventTags: ['이벤트', '단골'] },
  { headline: '평일 미니 토너 가볍게 한 판', body: '부담 없는 평일 미니 토너 진행 중. 바이인 1만, 퇴근 후 가볍게 즐기기 딱 좋아요. 자리 있을 때 오세요!', cardColor: 'cyan', cardEmojis: ['🎉', '🃏'], eventTags: ['토너', '평일'] },
  { headline: '지금 8테이블 풀하우스 — 열기 후끈', body: '현재 8테이블 모두 가동 중! 매장 열기 후끈합니다. 대기 거의 없으니 지금 오시면 바로 착석 가능해요.', cardColor: 'purple', cardEmojis: ['🔥', '🎰'], eventTags: ['실시간', '캐쉬'] },
  { headline: '미드나잇 딥스택 — 야간 직장인 환영', body: '야간 딥스택 토너 진행 중. 퇴근 늦은 직장인분들 환영! 늦은 시간까지 운영하니 편하게 오세요.', cardColor: 'navy', cardEmojis: ['🌟', '♠️'], eventTags: ['토너', '야간'] },
  { headline: '여성 친화 토너 — 매너 분위기 보장', body: '여성분들도 편하게 즐기실 수 있는 매너 좋은 분위기. 친구와 함께 오시면 더 즐거워요. 지금 진행 중입니다!', cardColor: 'pink', cardEmojis: ['🌟', '🎉'], eventTags: ['토너', '여성친화'] },
  { headline: '프리롤 스페셜 — 참가비 0원', body: '오늘 프리롤! 참가비 0원으로 상금 노려보세요. 부담 없이 포커 입문하기 좋은 기회. 진행 중이니 지금 오세요.', cardColor: 'gold', cardEmojis: ['🆓', '🎁'], eventTags: ['토너', '프리롤'] },
  { headline: '터보 토너 — 빠른 회전 좋아하는 분께', body: '레벨 빠르게 올라가는 터보 토너 진행 중! 짧고 굵게 즐기고 싶은 분들께 추천. 지금 합류 가능합니다.', cardColor: 'orange', cardEmojis: ['⚡', '🔥'], eventTags: ['토너', '터보'] },
  { headline: '오늘 캐쉬 1/2 · 2/5 두 종 운영', body: '캐쉬 게임 1/2와 2/5 두 종류 동시 운영 중. 원하는 스테이크 골라 즐기세요. 자리 여유 있을 때 오세요!', cardColor: 'green', cardEmojis: ['💵', '🃏'], eventTags: ['캐쉬', '실시간'] },
  { headline: '위클리 챔피언십 — 이번 주 메인 이벤트', body: '주간 메인 이벤트 진행 중! 이번 주 챔피언은 누구? 프라이즈풀 가장 큰 토너입니다. 지금 합류하세요.', cardColor: 'red', cardEmojis: ['🏆', '🎊'], eventTags: ['토너', '메인이벤트'] },
  { headline: '데일리 새틀라이트 — 메인 티켓 노려라', body: '메인 이벤트行 티켓이 걸린 새틀라이트 진행 중. 적은 바이인으로 큰 무대 노리세요! 지금 등록 가능합니다.', cardColor: 'cyan', cardEmojis: ['🎯', '🎟️'].slice(0, 1).concat(['✨']), eventTags: ['토너', '새틀라이트'] },
  { headline: '신규 인테리어 완료 — 쾌적하게 LIVE', body: '신축 인테리어로 더 쾌적해진 매장에서 토너 진행 중! 깨끗한 환경, 편한 의자로 장시간도 거뜬해요.', cardColor: 'white', cardEmojis: ['✨', '📺'], eventTags: ['공지', '시설'] },
  { headline: '안주 무한리필 + 토너 동시 진행', body: '게임하면서 든든하게! 안주 무한리필 운영 중에 토너도 LIVE. 배고플 걱정 없이 게임에 집중하세요.', cardColor: 'orange', cardEmojis: ['🍻', '🃏'], eventTags: ['식음', '실시간'] },
  { headline: '주차 편한 매장 — 차 가져오셔도 OK', body: '주차장 넉넉해서 차 가져오셔도 편해요. 지금 토너 진행 중이니 부담 없이 들러서 한 판 즐기고 가세요!', cardColor: 'navy', cardEmojis: ['📍', '🎯'], eventTags: ['공지', '주차'] },
  { headline: '지금이 인더머니 찬스 — 막판 합류', body: '토너 중반, 지금 합류하면 빠르게 인더머니 진입 가능! 레이트 등록 아직 열려 있어요. 서두르세요.', cardColor: 'gold', cardEmojis: ['💎', '⚡'], eventTags: ['토너', 'LIVE'] },
];

const CURATED_EMOJIS = new Set([
  '🃏', '🎰', '♠️', '♥️', '♦️', '♣️', '🎯', '💰', '💵', '💸',
  '🎉', '🎊', '🎁', '✨', '🔥', '⚡', '⭐', '💎', '🏆', '🌟',
  '☕', '🍻', '🍺', '🍷', '🥃', '🍰', '🍕', '🍣',
  '📢', '🔔', '❗', '⚠️', '💡', '📅', '🕐', '🏬', '📍', '🚨',
  '👀', '🙋', '👋', '🆕', '🎪', '🤝', '💼', '📝', '🎓', '🚀', '📺', '🎟️',
]);
const VALID_CARD_COLORS = new Set(['white', 'pink', 'green', 'gold', 'navy', 'red', 'purple', 'cyan', 'orange']);
function sanitizeEmojis(arr) { return (arr || []).filter((e) => CURATED_EMOJIS.has(e)).slice(0, 3); }

// ─────────────────────────────────────────────────────────────
// 매장 선정 — 105곳에서 균등 간격으로 TARGET_COUNT곳 (지역 다양성)
// ─────────────────────────────────────────────────────────────
async function pickStores() {
  const snap = await db.collection('stores').where('isDemo', '==', true).get();
  if (snap.empty) {
    console.error('[FATAL] 데모 매장(isDemo=true)이 없습니다. seedStoresBulk 먼저 실행 필요.');
    process.exit(1);
  }
  const all = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  console.log(`[demo] 전체 데모 매장: ${all.length}개`);

  const n = Math.min(TARGET_COUNT, all.length);
  const step = all.length / n; // 균등 간격 샘플링 → 이름/지역 골고루
  const picked = [];
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let idx = Math.floor(i * step);
    while (used.has(idx) && idx < all.length) idx++;
    if (idx >= all.length) break;
    used.add(idx);
    picked.push(all[idx]);
  }
  console.log(`[demo] 선정: ${picked.length}곳`);
  return picked;
}

// ─────────────────────────────────────────────────────────────
// SEED
// ─────────────────────────────────────────────────────────────
async function runSeed() {
  const stores = await pickStores();
  const liveWrites = [];
  const postWrites = [];

  stores.forEach((store, i) => {
    const structure = buildBlindStructure();
    // totalStartedAt: 6~95분 전 → 매장마다 레벨/남은시간 다르게 (살아있는 느낌)
    const startedAgoMin = randInt(6, 95);
    const totalStartedMs = NOW - startedAgoMin * 60 * 1000;
    const pos = computeTimelinePosition(structure, totalStartedMs);

    const buyIn = pick(BUYINS);
    const entries = randInt(18, 75);
    const rebuys = randInt(0, Math.floor(entries / 3));
    // 중반 토너 — 잔여 인원은 엔트리의 40~95%
    const playersRemaining = randInt(Math.ceil(entries * 0.4), entries);
    const tablesRemaining = Math.max(1, Math.ceil(playersRemaining / 8));
    const payoutPercent = 90;
    const payoutStructure = {
      payoutPercent,
      itmCount: 'auto',
      distribution: pick(['top-heavy', 'standard']),
    };
    const prizePool = computeAutoPrizePool(buyIn, entries + rebuys, payoutPercent);
    const tournamentName = pick(TOURNEY_NAMES);
    const nextLevelMs = NOW + pos.secondsLeft * 1000;

    const sessionId = `demo-live-${store.id}`;
    liveWrites.push({
      ref: db.collection('liveSessions').doc(sessionId),
      data: {
        storeId: store.id,
        storeName: store.data.name || '',
        templateId: 'demo-live-template',
        tournamentName,
        tournamentType: 'freezeout',
        posterStyle: pick(POSTER_STYLES),
        buyIn,
        totalPlayers: entries,
        currentEntries: entries,
        rebuysCount: rebuys,
        startingStack: 20000,
        blindStructure: structure,
        blindStructureLocked: structure, // timeline 진실의 원천
        lateRegEndLevel: 8,
        status: 'running',
        currentLevel: pos.level,
        levelSecondsLeft: pos.secondsLeft,
        levelEndsAt: tsFromMs(nextLevelMs),
        nextLevelAt: tsFromMs(nextLevelMs),
        smallBlind: pos.sb,
        bigBlind: pos.bb,
        ante: pos.ante,
        playersRemaining,
        tablesRemaining,
        prizePool,
        payoutStructure,
        prizeDisplayUnit: 'ticket',
        showPrizePool: true,
        lateRegClosed: pos.level > 8,
        viewerCount: randInt(0, 40),
        createdAt: tsFromMs(totalStartedMs - 20 * 60 * 1000),
        startedAt: tsFromMs(totalStartedMs),
        totalStartedAt: tsFromMs(totalStartedMs),
        totalPausedMs: 0,
        pausedAt: null,
        finishingAt: null,
        endedAt: null,
        updatedAt: tsFromMs(NOW),
        seedSource: SEED_SOURCE,
      },
    });

    // 오늘의 소식 1건 (24h)
    const tpl = POST_TEMPLATES[i % POST_TEMPLATES.length];
    const cardColor = VALID_CARD_COLORS.has(tpl.cardColor) ? tpl.cardColor : 'white';
    const cardEmojis = sanitizeEmojis(tpl.cardEmojis);
    const postId = `demo-live-post-${store.id}`;
    postWrites.push({
      ref: db.collection('stores').doc(store.id).collection('posts').doc(postId),
      data: {
        storeId: store.id,
        storeName: store.data.name || '',
        body: tpl.body,
        headline: tpl.headline,
        cardColor,
        cardEmoji: cardEmojis[0] || '',
        cardEmojis,
        imageUrls: [],
        eventTags: tpl.eventTags || [],
        ctaUrl: '',
        ctaLabel: '',
        authorType: 'store',
        authorUid: POST_SEEDER_UID,
        authorName: store.data.name || '',
        status: 'published',
        flagCount: 0,
        createdAt: tsFromMs(NOW),
        serverCreatedAt: tsFromMs(NOW),
        expiresAt: tsFromMs(NOW + TTL_MS),
        seedSource: SEED_SOURCE,
        isDemoLiveSeed: true,
      },
    });

    if (VERBOSE || !EXECUTE) {
      console.log(
        `  ${String(i + 1).padStart(2)}. ${store.data.name} ` +
        `| LIVE Lv${pos.level} ${Math.floor(pos.secondsLeft / 60)}:${String(pos.secondsLeft % 60).padStart(2, '0')} 남음 ` +
        `(${startedAgoMin}분 전 시작) | ${tournamentName} ${entries}명 잔여${playersRemaining} ` +
        `| 글:"${tpl.headline}"`,
      );
    }
  });

  if (!EXECUTE) {
    console.log(`\n[DRY] liveSessions ${liveWrites.length}건 + posts ${postWrites.length}건 — 쓰기 없음`);
    return { live: 0, posts: 0 };
  }

  let live = 0;
  for (const part of chunk(liveWrites, 400)) {
    const b = db.batch();
    part.forEach((w) => b.set(w.ref, w.data));
    await b.commit();
    live += part.length;
  }
  let posts = 0;
  for (const part of chunk(postWrites, 400)) {
    const b = db.batch();
    part.forEach((w) => b.set(w.ref, w.data));
    await b.commit();
    posts += part.length;
  }
  console.log(`\n[seed] liveSessions ${live}건 + posts ${posts}건 작성 완료`);
  return { live, posts };
}

// ─────────────────────────────────────────────────────────────
// UNSEED
// ─────────────────────────────────────────────────────────────
async function runUnseed() {
  // liveSessions는 top-level seedSource 쿼리로 회수 (인덱스 불필요).
  const lsSnap = await db.collection('liveSessions').where('seedSource', '==', SEED_SOURCE).get();
  // posts는 결정적 doc ID(`demo-live-post-{storeId}`)를 storeId에서 역산해 직접 삭제
  //   → collectionGroup('posts') seedSource 인덱스 의존 제거.
  const storeIds = lsSnap.docs.map((d) => (d.data().storeId || '')).filter(Boolean);
  console.log(`[unseed] liveSessions ${lsSnap.size}건 발견 / posts 후보 ${storeIds.length}건 (결정적 ID)`);
  if (!EXECUTE) return { live: lsSnap.size, posts: storeIds.length };

  let live = 0;
  for (const part of chunk(lsSnap.docs, 400)) {
    const b = db.batch();
    part.forEach((d) => b.delete(d.ref));
    await b.commit();
    live += part.length;
  }
  let posts = 0;
  for (const part of chunk(storeIds, 400)) {
    const b = db.batch();
    part.forEach((sid) => b.delete(db.collection('stores').doc(sid).collection('posts').doc(`demo-live-post-${sid}`)));
    await b.commit();
    posts += part.length;
  }
  console.log(`[unseed] 삭제 완료: liveSessions ${live}건 / posts ${posts}건`);
  return { live, posts };
}

// ─────────────────────────────────────────────────────────────
async function run() {
  console.log('='.repeat(64));
  console.log('HoldemNow Demo LIVE + Posts Seeder');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Mode:    ${EXECUTE ? 'EXECUTE (real writes)' : 'DRY-RUN (no writes)'}`);
  console.log(`Action:  ${UNSEED ? 'UNSEED (delete)' : `SEED ${TARGET_COUNT}곳`}`);
  console.log('='.repeat(64));

  if (UNSEED) {
    await runUnseed();
  } else {
    await runSeed();
  }

  if (!EXECUTE) {
    console.log('\nDRY-RUN 모드. 실제 실행: --execute 추가');
    console.log('  node firebase/functions/scripts/seedDemoLive.js --execute');
  }
}

run().catch((e) => { console.error('\n[FATAL]', e); process.exit(1); });
