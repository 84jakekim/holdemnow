/**
 * moderationKeywords.ts — Firestore 동적 금지어 사전.
 *
 * 본사 어드민 (/platform/moderation-keywords)에서 단어를 추가/삭제/토글하면
 * 클라이언트가 1분 캐시로 받아와 매칭에 사용. 사용자 앱 재배포 불필요.
 *
 * 매칭 정책 (2026-05-22, PM 결재):
 *   - normalize: 소문자 + 공백·특수문자 제거.
 *   - matchMode='exact'   : 토큰 단위로 normalize 후 토큰 전체 일치 (예: "시발" exact → 단독으로만 매칭)
 *   - matchMode='partial' : 토큰 단위로 normalize 후 토큰이 단어를 포함 (예: 토큰 "시발놈"이 "시발" 포함 — OK)
 *   - matchMode='contains': 전체 문자열 normalize 후 substring 검색 (도박/환금 같이 거의 모든 컨텍스트가 부적절한 경우)
 *
 * "오늘 20시 발표" → 토큰: ["오늘", "20시", "발표"] → "시발" exact/partial 둘 다 미매칭 → 통과.
 * 기존 lib/moderation의 `normalize(s).includes(w)` 부분매칭은 이 정책으로 대체됨.
 *
 * Firestore: /moderationKeywords/{keywordId}
 *   - word: string
 *   - category: 'profanity' | 'gambling' | 'cashout' | 'spam' | 'other'
 *   - enabled: boolean
 *   - matchMode: 'exact' | 'partial' | 'contains'
 *   - createdAt / updatedAt: Timestamp
 *   - createdBy: uid
 */
'use client';

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { stripUndefined } from './firestoreUtil';

export type ModerationCategory = 'profanity' | 'gambling' | 'cashout' | 'spam' | 'other';
export type ModerationMatchMode = 'exact' | 'partial' | 'contains';

export interface ModerationKeyword {
  id: string;
  word: string;
  category: ModerationCategory;
  enabled: boolean;
  matchMode: ModerationMatchMode;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  createdBy?: string;
}

const COL = 'moderationKeywords';

// ─────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────

export function subscribeAllModerationKeywords(
  onChange: (items: ModerationKeyword[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(collection(db, COL), orderBy('category', 'asc'), orderBy('word', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ModerationKeyword, 'id'>) })),
      );
    },
    (e) => onError(e as Error),
  );
}

export async function createModerationKeyword(input: {
  word: string;
  category: ModerationCategory;
  matchMode?: ModerationMatchMode;
  enabled?: boolean;
  createdBy?: string;
}): Promise<string> {
  const word = (input.word ?? '').trim();
  if (!word) throw new Error('단어를 입력하세요');
  const ref = await addDoc(collection(db, COL), stripUndefined({
    word,
    category: input.category,
    matchMode: input.matchMode ?? 'partial',
    enabled: input.enabled ?? true,
    createdBy: input.createdBy ?? '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  return ref.id;
}

export async function updateModerationKeyword(
  id: string,
  updates: Partial<Pick<ModerationKeyword, 'word' | 'category' | 'matchMode' | 'enabled'>>,
): Promise<void> {
  await updateDoc(doc(db, COL, id), stripUndefined({
    ...updates,
    updatedAt: serverTimestamp(),
  }));
}

export async function deleteModerationKeyword(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}

// ─────────────────────────────────────────────────────────────
// 시드 마이그레이션 — 하드코딩 사전을 한 번에 Firestore로 이관
// ─────────────────────────────────────────────────────────────

/**
 * 시드 셋. 카테고리별로 분류 + 단어 길이에 따라 matchMode 자동 결정.
 * - 2자 이하 한글 욕설 (시발/씨발/병신 등): partial — 단어 안에 포함되어도 OK
 *   → 단, 토큰 단위 매칭이므로 정상 텍스트 안 짧은 음절은 통과.
 * - 3자 이상 / 결합 단어: partial
 * - 도박/환금/사기: contains (전체 문자열 검색 — 띄어쓰기 우회 방어)
 * - 영문 욕설: partial (대소문자 무관, 토큰 매칭)
 *
 * 매칭 알고리즘 자체가 토큰 기반이므로 partial로 둬도 false positive 없음.
 */
export const SEED_KEYWORDS: {
  word: string;
  category: ModerationCategory;
  matchMode: ModerationMatchMode;
}[] = [
  // 한국어 욕설 — partial (토큰 매칭이라 정상 명사와 충돌 X)
  ...['시발', '씨발', '시팔', '씨팔', '시바', '씨바', '쉬발', '쒸발', '시벌', '씨벌',
    '시부랄', '씨부랄', '시부럴', '씨부럴', '쌍놈', '쌍년', '쌍눔',
    '병신', '븅신', '븅딱', '빙신', '뱅신', '뼝신',
    '지랄', '쥐랄', '지럴', '쥐럴', '지롤',
    '개새끼', '개색끼', '개시키', '개샛키', '개쉐키', '개쉑', '개쌔끼', '개색기',
    '개놈', '개년', '개잡놈', '개잡년',
    '좆', '좇', '존나', '졸라', '존네', '졸래', '좃같', '좆같', '좃밥', '좆밥',
    '좆까', '좇까', '좆되', '좆돼',
    '꺼져', '꺼지라', '꺼지세요', '뒤져', '뒤지라', '뒤져라', '죽어라', '뒈져',
    '뒈지라', '닥쳐', '닥치라', '아가리',
    '새끼', '쉐끼', '쉑히', '쉽새', '씹새', '씹새끼', '씹쌔끼', '씹놈', '씹년',
    '씹창', '씹덕', '씹덕후', '씹할',
    '호로새끼', '후레자식', '후레아들', '호로자식',
    '미친놈', '미친년', '미친새끼', '또라이', '돌아이', '대가리깨', '대가리박',
    '엿같', '엿먹어', '엿이나먹', '쥐뿔',
    '보지', '자지', '섹스', '딸딸이', '딸자', '딸쳐', '딸친', '오나니',
    '발기', '사정', '야동', '야설', '음란', '음탕', '음담', '난교',
    '변태', '쓰레기', '인간쓰레기', '폐급', '폐인',
    'ㅅㅂ', 'ㅄ', 'ㅂㅅ', 'ㅈㄹ', 'ㄱㅅㄲ', 'ㅁㅊ', 'ㅁㅊㄴ', 'ㅁㅊㄴㅁ',
    'ㅗㅗ', 'ㅗ', 'ㅈㄴ', 'ㅈㅈ', 'ㄷㅊ', 'ㅗㅁㅊ',
    '한남', '한녀', '맘충', '김치녀', '된장녀', '꼴페미', '메갈',
    '틀딱', '급식충', '잼민이', '쿵쾅이',
    '시1발', '시!발', '씨1발', '씨!발', '병1신', '병!신', '시.발', '씨.발',
    '병.신', '지.랄', '미.친',
  ].map((w) => ({ word: w, category: 'profanity' as const, matchMode: 'partial' as const })),

  // 영문 욕설 — partial (대소문자 무관, 토큰 매칭)
  ...['fuck', 'fck', 'fuk', 'fuking', 'fucking', 'fcking', 'mthrfucker', 'mtherfker',
    'shit', 'sht', 'bullshit',
    'bitch', 'btch', 'biatch',
    'asshole', 'azzhole', 'ahole',
    'dick', 'dik', 'cock', 'cunt',
    'pussy', 'pssy', 'pusy',
    'damn', 'dmn', 'goddamn',
    'slut', 'whore', 'hooker',
    'retard', 'retarded', 'idiot', 'moron', 'dumbass', 'jackass',
    'piss', 'pissed', 'pissoff',
    'nigger', 'nigga', 'faggot',
    'porn', 'porno',
  ].map((w) => ({ word: w, category: 'profanity' as const, matchMode: 'partial' as const })),

  // 환금/현금화 — contains (도박업자가 띄어쓰기 우회를 자주 시도하므로 normalize 전체 검색)
  ...['환금', '환전', '현금화', '현금환', '현금교환', '시세보장', '수익보장',
    '원금보장', '환급보장', '입금보장',
  ].map((w) => ({ word: w, category: 'cashout' as const, matchMode: 'contains' as const })),

  // 도박 권유 — contains
  ...['도박', '베팅', '도박장', '도박사이트', '베팅사이트', '온라인도박',
    '캐시게임', '캐시포커', '리얼머니', '실머니', '실머니게임',
    '사설', '사설사이트', '사설업체', '사설토토', '토토', '토토사이트',
    '먹튀', '먹튀검증', '먹튀보증', '먹튀없음', '안전놀이터', '메이저놀이터',
    '환치기', '돈세탁', '자금세탁',
    '대출', '무담보대출', '신용대출', '소액대출', '급전', '일수', '일수대출',
    '투자권유', '투자수익', '투자보장', '코인투자', '비트코인투자',
    '가상화폐투자', '재테크투자', '리딩방', '주식리딩', '코인리딩',
    '성매매', '성매수', '조건만남', '오피', '안마', '키스방',
    '대리입금', '대리결제', '신용카드깡', '카드깡', '상품권깡',
  ].map((w) => ({ word: w, category: 'gambling' as const, matchMode: 'contains' as const })),
];

/**
 * 시드 일괄 등록. 이미 같은 단어가 존재하면 skip (중복 방지).
 * 한 번에 ~500개를 처리하므로 batch로 묶음(Firestore 한 batch 최대 500 write).
 */
export async function seedDefaultKeywords(actorUid: string): Promise<{
  added: number;
  skipped: number;
}> {
  // 기존 단어 셋 fetch
  const existing = await getDocs(collection(db, COL));
  const seen = new Set<string>(
    existing.docs.map((d) => ((d.data() as ModerationKeyword).word ?? '').trim().toLowerCase()),
  );

  let added = 0;
  let skipped = 0;
  let batch = writeBatch(db);
  let inBatch = 0;

  for (const seed of SEED_KEYWORDS) {
    const key = seed.word.trim().toLowerCase();
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const ref = doc(collection(db, COL));
    batch.set(ref, {
      word: seed.word,
      category: seed.category,
      matchMode: seed.matchMode,
      enabled: true,
      createdBy: actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    added++;
    inBatch++;
    // Firestore batch 한도 500
    if (inBatch >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();

  // 시드 완료 메타 마커 (idempotent)
  await setDoc(
    doc(db, 'meta', 'moderationSeed'),
    {
      seededAt: serverTimestamp(),
      seededBy: actorUid,
      added,
      skipped,
      total: SEED_KEYWORDS.length,
    },
    { merge: true },
  );

  return { added, skipped };
}

// ─────────────────────────────────────────────────────────────
// 클라이언트 캐시 (1분 TTL) — moderateText에서 sync로 가져감
// ─────────────────────────────────────────────────────────────

interface CacheEntry {
  /** 캐싱된 단어 리스트 (enabled === true만 포함) */
  keywords: ModerationKeyword[];
  /** 컴파일된 매칭 lookup (성능) */
  exact: Set<string>;       // 토큰 normalize → matched word(raw)
  partial: { norm: string; raw: string }[];  // 토큰 안 substring 매칭
  contains: { norm: string; raw: string }[]; // 전체 문자열 substring
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60_000; // 1분
let inflight: Promise<CacheEntry> | null = null;
let liveUnsub: (() => void) | null = null;

/** 캐시용 normalize (lib/moderation의 normalizeForMatch와 동일 정의) */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\W_]/g, '');
}

function buildCache(keywords: ModerationKeyword[]): CacheEntry {
  const enabled = keywords.filter((k) => k.enabled !== false && (k.word ?? '').trim().length > 0);
  const exact = new Set<string>();
  const partial: { norm: string; raw: string }[] = [];
  const contains: { norm: string; raw: string }[] = [];
  for (const k of enabled) {
    const norm = normalize(k.word);
    if (!norm) continue;
    if (k.matchMode === 'exact') exact.add(norm);
    else if (k.matchMode === 'contains') contains.push({ norm, raw: k.word });
    else partial.push({ norm, raw: k.word }); // default partial
  }
  return { keywords: enabled, exact, partial, contains, fetchedAt: Date.now() };
}

/** 1회성 fetch + cache build. inflight 중복 호출 합치기. */
async function fetchAndBuild(): Promise<CacheEntry> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const snap = await getDocs(collection(db, COL));
      const items: ModerationKeyword[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ModerationKeyword, 'id'>),
      }));
      const built = buildCache(items);
      cache = built;
      return built;
    } catch {
      // fetch 실패 시 빈 캐시 (하드코딩 fallback은 lib/moderation이 책임)
      const empty = buildCache([]);
      cache = empty;
      return empty;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * 캐시 prime — 매장 어드민이 글 작성 페이지 진입 시 호출하면 첫 작성도 빠름.
 * onSnapshot으로 실시간 반영 (본사가 단어 추가하면 1분 내가 아니라 즉시 반영).
 */
export function primeModerationKeywordsCache(): void {
  if (liveUnsub) return; // 이미 구독 중
  try {
    liveUnsub = onSnapshot(
      collection(db, COL),
      (snap) => {
        const items: ModerationKeyword[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ModerationKeyword, 'id'>),
        }));
        cache = buildCache(items);
      },
      () => {
        // 실패 시 무시 — moderateText는 hardcoded fallback으로 안전
      },
    );
  } catch {
    // ignore
  }
}

/** 캐시 해제 (테스트/언마운트용) */
export function disposeModerationKeywordsCache(): void {
  if (liveUnsub) {
    liveUnsub();
    liveUnsub = null;
  }
  cache = null;
}

/**
 * 동기 캐시 조회. fresh하면 즉시 반환, stale하면 백그라운드 갱신만 트리거.
 * moderateText는 동기여야 하므로 (UI 폼 onChange) 항상 즉시 반환 가능해야 함.
 */
export function getModerationKeywordsCacheSync(): CacheEntry | null {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  // stale or empty → 백그라운드 갱신 (await 안 함)
  void fetchAndBuild();
  return cache; // null이면 호출자가 hardcoded fallback을 씀
}

/** 매칭 결과 */
export interface KeywordMatch {
  matched: boolean;
  word?: string;
  category?: ModerationCategory;
}

/**
 * 캐시된 사전 + 입력 텍스트 매칭.
 *
 * 알고리즘:
 *   1) normalize(text) 전체 → contains 사전 검사 (강력한 도박/환금 키워드)
 *   2) 토큰 분리: 한글/영문/숫자 시퀀스만 (split on \W). 각 토큰을 normalize.
 *      - exact: 토큰 == 단어
 *      - partial: 토큰.includes(단어)
 *
 * "오늘 20시 발표" → tokens=["오늘","20시","발표"] → normalize=["오늘","20시","발표"]
 *   → "시발" 단어가 exact·partial 어디서도 hit 안 됨 → 통과 ✅
 *
 * "시발놈아" → tokens=["시발놈아"] → normalize=["시발놈아"]
 *   → "시발" partial → "시발놈아".includes("시발") → 매칭 ✅
 */
export function matchKeywordsSync(text: string): KeywordMatch {
  const cur = getModerationKeywordsCacheSync();
  if (!cur || cur.keywords.length === 0) return { matched: false };
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { matched: false };

  // 1) contains — 전체 문자열 normalize 후 substring
  const fullNorm = normalize(trimmed);
  for (const c of cur.contains) {
    if (fullNorm.includes(c.norm)) {
      const cat = cur.keywords.find((k) => k.word === c.raw)?.category;
      return { matched: true, word: c.raw, category: cat };
    }
  }

  // 2) 토큰 단위 분리 — 한글/영문/숫자/언더스코어 시퀀스
  // \W는 한글 포함 안 되는 ASCII만 비단어로 보지만, 한글은 \w에 매칭됨(Unicode 모드).
  // 안전을 위해 명시적 패턴 사용: 한글/영문/숫자만 통과.
  const tokens = trimmed
    .split(/[^A-Za-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+/u)
    .filter((t) => t.length > 0)
    .map((t) => normalize(t))
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return { matched: false };

  // 3) exact — 토큰 전체가 단어와 동일
  for (const t of tokens) {
    if (cur.exact.has(t)) {
      const raw = cur.keywords.find((k) => normalize(k.word) === t && k.matchMode === 'exact')?.word ?? t;
      const cat = cur.keywords.find((k) => k.word === raw)?.category;
      return { matched: true, word: raw, category: cat };
    }
  }

  // 4) partial — 토큰 안에 단어 substring
  for (const t of tokens) {
    for (const p of cur.partial) {
      if (t.includes(p.norm)) {
        const cat = cur.keywords.find((k) => k.word === p.raw)?.category;
        return { matched: true, word: p.raw, category: cat };
      }
    }
  }

  return { matched: false };
}
