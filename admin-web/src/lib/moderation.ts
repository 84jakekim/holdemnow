/**
 * moderation.ts — 콘텐츠 모더레이션 (욕설·금지어·도배·작성빈도).
 *
 * 정책 (PM 합의 — Phase A+B):
 * - 한국어 욕설/비속어 + 영문 욕설 + 도박/사기 권유 키워드 사전 (약 200개).
 * - 띄어쓰기·특수문자 무시한 normalized 비교.
 * - 같은 글자 30+ 연속 도배 차단.
 * - 빈 텍스트·길이·작성빈도 차단.
 *
 * 2026-05-22 업데이트 (PM 단독):
 *   - false positive 차단: "오늘 20시 발표"가 "시발"로 매칭되던 normalize+substring 버그를
 *     **토큰 단위 매칭**으로 교체. (lib/moderationKeywords 참고)
 *   - 본사 어드민 /platform/moderation-keywords에서 단어를 동적으로 추가/삭제 가능.
 *     Firestore /moderationKeywords 컬렉션이 우선이며, 없을 때만 아래 하드코딩 사전이 fallback.
 *
 * 호출 시점:
 *   - 리뷰 createReview/updateReview 전 moderateText() — 통과해야 진행
 *   - 커뮤니티 createJob/createDealerProfile/createUsedListing 전 moderateText()
 *   - 매장 데일리 글 createStorePost 전 moderateText()
 *   - 작성 직전 checkWriteRateLimit() — uid+namespace 빈도 제한
 *
 * Firestore: writeRateLimits/{uid}_{namespace} 단일 doc — timestamps[] 윈도우 관리.
 */
'use client';

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { matchKeywordsSync, getModerationKeywordsCacheSync } from './moderationKeywords';

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export type ModerationReason =
  | 'banned_word'
  | 'spam_repeat'
  | 'spam_length'
  | 'rate_limit'
  | 'empty';

export interface ModerationResult {
  ok: boolean;
  reason?: ModerationReason;
  /** 어떤 단어에 걸렸는지 (디버그·로그용, UI에는 노출 X) */
  matchedWord?: string;
  /** 사용자에게 보여줄 한국어 메시지 */
  message?: string;
}

// ─────────────────────────────────────────────────────────────
// 금지어 사전 (~200개)
// 분류: 한국어 욕설/변형/초성 / 영문 욕설 / 도박·사기·환금 권유
// ─────────────────────────────────────────────────────────────

const KOREAN_PROFANITY = [
  // 시발 계열
  '시발', '씨발', '시팔', '씨팔', '시바', '씨바', '쉬발', '쒸발', '시벌', '씨벌',
  '시부랄', '씨부랄', '시부럴', '씨부럴', '쌍놈', '쌍년', '쌍눔',
  // 병신 계열
  '병신', '븅신', '븅딱', '빙신', '뱅신', '뼝신',
  // 지랄 계열
  '지랄', '쥐랄', '지럴', '쥐럴', '지롤',
  // 개새끼 계열
  '개새끼', '개색끼', '개시키', '개샛키', '개쉐키', '개쉑', '개쌔끼', '개색기',
  '개놈', '개년', '개잡놈', '개잡년',
  // 좆 계열
  '좆', '좇', '존나', '졸라', '존네', '졸래', '좃같', '좆같', '좃밥', '좆밥',
  '좆까', '좇까', '좆되', '좆돼',
  // 꺼져/뒤져/죽어
  '꺼져', '꺼지라', '꺼지세요', '뒤져', '뒤지라', '뒤져라', '죽어라', '뒈져',
  '뒈지라', '닥쳐', '닥치라', '아가리',
  // 새끼/씹
  '새끼', '쉐끼', '쉑히', '쉽새', '씹새', '씹새끼', '씹쌔끼', '씹놈', '씹년',
  '씹창', '씹덕', '씹덕후', '씹할',
  // 호로/후레
  '호로새끼', '후레자식', '후레아들', '호로자식',
  // 미친 계열
  '미친놈', '미친년', '미친새끼', '또라이', '돌아이', '대가리깨', '대가리박',
  // 엿/지랄/지옥
  '엿같', '엿먹어', '엿이나먹', '쥐뿔',
  // 보지/자지/섹스 직설
  '보지', '자지', '섹스', '딸딸이', '딸자', '딸쳐', '딸친', '오나니',
  '발기', '사정', '야동', '야설', '음란', '음탕', '음담', '난교',
  // 변태/노예 비하
  '변태', '쓰레기', '인간쓰레기', '폐급', '폐인',
  // 한글 초성 변형 (자주 쓰임)
  'ㅅㅂ', 'ㅄ', 'ㅂㅅ', 'ㅈㄹ', 'ㄱㅅㄲ', 'ㅁㅊ', 'ㅁㅊㄴ', 'ㅁㅊㄴㅁ', 'ㅁㅊㄴ',
  'ㅗㅗ', 'ㅗ', 'ㅈㄴ', 'ㅈㅈ', 'ㄷㅊ', 'ㅗㅁㅊ',
  // 차별/혐오
  '한남', '한녀', '맘충', '김치녀', '된장녀', '꼴페미', '메갈',
  '틀딱', '급식충', '잼민이', '쿵쾅이',
  // 욕설 변형 (간격 두기, 자모 분리)
  '시1발', '시!발', '씨1발', '씨!발', '병1신', '병!신', '시.발', '씨.발',
  '병.신', '지.랄', '미.친',
];

const ENGLISH_PROFANITY = [
  'fuck', 'fck', 'fuk', 'fuking', 'fucking', 'fcking', 'mthrfucker', 'mtherfker',
  'shit', 'sht', 'bullshit', 'bs',
  'bitch', 'btch', 'biatch',
  'asshole', 'azzhole', 'ahole',
  'dick', 'dik', 'cock', 'cunt',
  'pussy', 'pssy', 'pusy',
  'damn', 'dmn', 'goddamn',
  'slut', 'whore', 'hooker',
  'retard', 'retarded', 'idiot', 'moron', 'dumbass', 'jackass',
  'piss', 'pissed', 'pissoff',
  'nigger', 'nigga', 'faggot', 'fag',
  'porn', 'porno', 'xxx',
];

const GAMBLING_FRAUD = [
  // 환금·환전·현금화
  '환금', '환전', '현금화', '현금환', '현금교환', '시세보장', '수익보장',
  '원금보장', '환급보장', '입금보장',
  // 도박 권유
  '도박', '베팅', '도박장', '도박사이트', '베팅사이트', '온라인도박',
  '캐시게임', '캐시포커', '리얼머니', '실머니', '실머니게임',
  // 사설/불법
  '사설', '사설사이트', '사설업체', '사설토토', '토토', '토토사이트',
  '먹튀', '먹튀검증', '먹튀보증', '먹튀없음', '안전놀이터', '메이저놀이터',
  // 환치기/세탁
  '환치기', '돈세탁', '자금세탁',
  // 대출·투자권유
  '대출', '무담보대출', '신용대출', '소액대출', '급전', '일수', '일수대출',
  '투자권유', '투자수익', '투자보장', '코인투자', '비트코인투자',
  '가상화폐투자', '재테크투자', '리딩방', '주식리딩', '코인리딩',
  // 불법알선
  '성매매', '성매수', '조건만남', '오피', '안마', '키스방',
  '대리입금', '대리결제', '신용카드깡', '카드깡', '상품권깡',
];

const BANNED_WORDS_RAW: readonly string[] = [
  ...KOREAN_PROFANITY,
  ...ENGLISH_PROFANITY,
  ...GAMBLING_FRAUD,
];

/** 소문자 + 공백·특수문자 제거 — 띄어쓰기/점/특수기호 우회 방어 */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s\W_]/g, '');
}

// ─────────────────────────────────────────────────────────────
// 매장 데일리 글 전용 — 외부 링크 whitelist + 이모지 캡
// (Sprint 1 Phase E, 2026-05-21)
// ─────────────────────────────────────────────────────────────

/**
 * 매장 글에 허용되는 외부 도메인. 본문에 다른 URL이 있으면 거절.
 * - 카카오톡 오픈채팅: open.kakao.com (카톡방 안내가 핵심 운영 동선)
 * - 카카오 플러스친구: pf.kakao.com
 * - 전화 링크: tel: (방문 예약 유도)
 */
export const ALLOWED_LINK_HOSTS = ['open.kakao.com', 'pf.kakao.com'];
const URL_RE = /\b(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

export interface LinkCheckResult {
  ok: boolean;
  blockedHost?: string;
  message?: string;
}

/** 본문에 포함된 외부 링크가 모두 whitelist에 있는지 검사. tel: 은 우회 허용. */
export function checkLinkWhitelist(text: string): LinkCheckResult {
  if (!text) return { ok: true };
  const matches = text.match(URL_RE);
  if (!matches || matches.length === 0) return { ok: true };
  for (const raw of matches) {
    const url = raw.startsWith('http') ? raw : `https://${raw}`;
    try {
      const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      const allowed = ALLOWED_LINK_HOSTS.some((h) => host === h || host.endsWith('.' + h));
      if (!allowed) {
        return {
          ok: false,
          blockedHost: host,
          message: '카카오 오픈채팅·플러스친구 외 외부 링크는 첨부할 수 없어요',
        };
      }
    } catch {
      return { ok: false, message: '본문에 올바르지 않은 링크가 포함됐어요' };
    }
  }
  return { ok: true };
}

/**
 * 이모지 캡 — 5개 초과면 앞 5개만 유지.
 * Unicode emoji 범위(흔한 surrogate pair 포함) 기준.
 *
 * 정책: 사용자 작성을 막지 않고 자동 잘라내기 (UX 마찰 최소화).
 */
const EMOJI_RE = /(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/gu;
export const MAX_EMOJIS = 5;

export function capEmojis(text: string, max: number = MAX_EMOJIS): string {
  if (!text) return text;
  let count = 0;
  return text.replace(EMOJI_RE, (m) => {
    count += 1;
    return count <= max ? m : '';
  });
}

/** 본문에 포함된 이모지 개수 (가이드용). */
export function countEmojis(text: string): number {
  if (!text) return 0;
  const m = text.match(EMOJI_RE);
  return m ? m.length : 0;
}

/** 금지어 사전 크기 (하드코딩 fallback) — 로그/디버그용 */
export const BANNED_WORD_COUNT = BANNED_WORDS_RAW.length;

// ─────────────────────────────────────────────────────────────
// 핵심 함수
// ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_LENGTH = 1000;
const DEFAULT_MIN_LENGTH = 0;
const SPAM_REPEAT_THRESHOLD = 30; // 같은 문자 30회 연속이면 도배

/**
 * 텍스트 검사 — 욕설·금지어·도배 패턴.
 *
 * @param text 검사할 텍스트
 * @param options.allowEmpty 기본 false — 빈 텍스트 차단
 * @param options.maxLength 기본 1000자
 * @param options.minLength 기본 0
 */
export function moderateText(
  text: string,
  options?: { allowEmpty?: boolean; maxLength?: number; minLength?: number },
): ModerationResult {
  const allowEmpty = options?.allowEmpty ?? false;
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const minLength = options?.minLength ?? DEFAULT_MIN_LENGTH;

  const trimmed = (text ?? '').trim();

  // 1) 빈 텍스트
  if (trimmed.length === 0) {
    if (allowEmpty) return { ok: true };
    return { ok: false, reason: 'empty', message: '내용을 입력해주세요' };
  }

  // 2) 길이 검사
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      reason: 'spam_length',
      message: `내용이 너무 깁니다 (${maxLength}자 이하)`,
    };
  }
  if (trimmed.length < minLength) {
    return {
      ok: false,
      reason: 'spam_length',
      message: `내용이 너무 짧습니다 (${minLength}자 이상)`,
    };
  }

  // 3) 도배 검사 — 같은 문자 SPAM_REPEAT_THRESHOLD회 연속
  // ASCII·한글·이모지 모두 코드포인트 단위로 검사
  const chars = Array.from(trimmed);
  let runChar = '';
  let runLen = 0;
  for (const ch of chars) {
    if (ch === runChar) {
      runLen++;
      if (runLen >= SPAM_REPEAT_THRESHOLD) {
        return {
          ok: false,
          reason: 'spam_repeat',
          matchedWord: runChar,
          message: '같은 글자가 너무 많이 반복됐어요',
        };
      }
    } else {
      runChar = ch;
      runLen = 1;
    }
  }

  // 4) 금지어 검사 — Firestore 동적 사전 우선, 비어있으면 하드코딩 fallback
  //    토큰 단위 매칭으로 false positive 차단 (lib/moderationKeywords).
  const dyn = matchKeywordsSync(trimmed);
  if (dyn.matched) {
    return {
      ok: false,
      reason: 'banned_word',
      matchedWord: dyn.word ?? '',
      message: '부적절한 표현이 포함되어 있어요',
    };
  }

  // Firestore 캐시가 비어있을 때만 하드코딩 사전을 사용 (출시 전 시드 안 된 상태 보호).
  const cache = getModerationKeywordsCacheSync();
  if (!cache || cache.keywords.length === 0) {
    const fb = matchHardcodedFallback(trimmed);
    if (fb) {
      return {
        ok: false,
        reason: 'banned_word',
        matchedWord: fb,
        message: '부적절한 표현이 포함되어 있어요',
      };
    }
  }

  return { ok: true };
}

/**
 * 하드코딩 사전 fallback — Firestore가 비어있거나 fetch 실패한 경우.
 * 토큰 단위 매칭으로 "오늘 20시 발표" false positive 차단.
 *
 * 알고리즘은 lib/moderationKeywords.matchKeywordsSync와 동일 (partial=토큰 안 substring).
 */
function matchHardcodedFallback(text: string): string | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const fullNorm = normalizeForMatch(trimmed);

  // contains 카테고리: 도박/환금/사기 — 전체 normalize substring
  for (const raw of GAMBLING_FRAUD) {
    const norm = normalizeForMatch(raw);
    if (norm && fullNorm.includes(norm)) return raw;
  }

  // partial: 한국어 욕설 + 영문 욕설 — 토큰 단위
  const tokens = trimmed
    .split(/[^A-Za-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+/u)
    .filter((t) => t.length > 0)
    .map((t) => normalizeForMatch(t))
    .filter((t) => t.length > 0);

  for (const t of tokens) {
    for (const raw of KOREAN_PROFANITY) {
      const norm = normalizeForMatch(raw);
      if (norm && t.includes(norm)) return raw;
    }
    for (const raw of ENGLISH_PROFANITY) {
      const norm = normalizeForMatch(raw);
      if (norm && t.includes(norm)) return raw;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 작성 빈도 제한 (writeRateLimits)
// ─────────────────────────────────────────────────────────────

const DEFAULT_RATE_LIMIT = 5;
const DEFAULT_RATE_WINDOW_MS = 5 * 60 * 1000; // 5분

interface RateLimitDoc {
  uid: string;
  namespace: string;
  timestamps: number[];
  updatedAt?: unknown;
}

/**
 * 작성 빈도 제한 — 같은 uid가 namespace 안에서 windowMs 내 limit회 이상 작성 시 차단.
 *
 * 동작:
 *   1) writeRateLimits/{uid}_{namespace} doc 읽음
 *   2) 윈도우(현재-windowMs) 안 timestamps 필터
 *   3) length >= limit이면 false (차단)
 *   4) 통과 시 현재 timestamp 추가 + 윈도우 밖 정리 → setDoc(merge)
 *
 * @returns true = 통과, false = 차단
 */
export async function checkWriteRateLimit(
  uid: string,
  namespace: 'review' | 'community' | 'profile' | 'reservation',
  limit: number = DEFAULT_RATE_LIMIT,
  windowMs: number = DEFAULT_RATE_WINDOW_MS,
): Promise<boolean> {
  if (!uid) return false;

  const docId = `${uid}_${namespace}`;
  const ref = doc(db, 'writeRateLimits', docId);
  const now = Date.now();
  const cutoff = now - windowMs;

  try {
    const snap = await getDoc(ref);
    const data = (snap.exists() ? (snap.data() as RateLimitDoc) : null) ?? null;
    const prev = Array.isArray(data?.timestamps) ? (data!.timestamps as number[]) : [];

    // 윈도우 안 항목만 유지
    const recent = prev.filter((t) => typeof t === 'number' && t > cutoff);

    if (recent.length >= limit) {
      // 차단 — timestamps 갱신은 하지 않음 (스팸 시도를 늘려 더 길게 막을지는 v0.2 정책)
      return false;
    }

    // 통과 — 현재 timestamp 추가
    const next = [...recent, now];
    await setDoc(
      ref,
      {
        uid,
        namespace,
        timestamps: next,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch {
    // 실패 시 보수적으로 통과 — 사용자 차단보단 로깅 추후 보강
    return true;
  }
}
