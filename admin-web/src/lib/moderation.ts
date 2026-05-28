/**
 * moderation.ts — 콘텐츠 모더레이션 (욕설·금지어·도배·작성빈도).
 *
 * 정책 (PM 합의):
 * - 법적 리스크 키워드(환금·도박·환전 등 ~30개)는 코드 하드코딩 — 본사 토글 불가, 항상 차단.
 * - 욕설/비속어/일반 금지어는 Firestore /moderationKeywords에 본사가 직접 등록한 단어만 차단.
 *   → Firestore 비어있으면 욕설 차단 안 됨 (본사 의지에 따라 시드 또는 직접 추가).
 * - 띄어쓰기·특수문자 무시한 normalize 비교, 토큰 단위 매칭으로 false positive 차단.
 * - 같은 글자 30+ 연속 도배 차단.
 * - 빈 텍스트·길이·작성빈도 차단.
 *
 * 2026-05-22 정정 (PM 단독):
 *   - 사용자 보고: 본사 사전이 비어있는데 "시발"이 차단됨 → 정정.
 *   - 기존: hardcoded 200개 사전(시발/병신/지랄 등) fallback → 본사가 등록 안 했어도 차단됨.
 *   - 정정: hardcoded는 LEGAL_BLOCKED_KEYWORDS(환금·도박 ~30개)만 유지. 욕설은 Firestore 의존.
 *   - 시드는 SEED_KEYWORDS(lib/moderationKeywords)에 그대로 유지 — 본사가 1회 클릭으로 시드 가능.
 *
 * 호출 시점:
 *   - 리뷰 createReview/updateReview 전 moderateText() — 통과해야 진행
 *   - 커뮤니티 createJob/createDealerProfile 전 moderateText()
 *   - 매장 데일리 글 createStorePost 전 moderateText()
 *   - 작성 직전 checkWriteRateLimit() — uid+namespace 빈도 제한
 *
 * Firestore: writeRateLimits/{uid}_{namespace} 단일 doc — timestamps[] 윈도우 관리.
 */
'use client';

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { matchKeywordsSync } from './moderationKeywords';

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
// 법적 리스크 키워드 (~30개) — 항상 차단, 본사 토글 불가
// 환금/환전/도박/사설 등 사용자 앱 노출 시 법적 책임이 발생할 수 있는 키워드만.
// 욕설/비속어는 별도 시드(lib/moderationKeywords의 SEED_KEYWORDS)로 본사가 관리.
// ─────────────────────────────────────────────────────────────

/**
 * 법적으로 항상 차단해야 하는 키워드. UI에서 토글 불가.
 * 도박업자가 띄어쓰기/특수문자로 우회를 자주 시도하므로 contains(normalize 전체 검색) 정책.
 */
export const LEGAL_BLOCKED_KEYWORDS: readonly string[] = [
  // 환금·환전·현금화
  '환금', '환전', '현금화', '현금환', '현금교환',
  // 도박 권유
  '도박', '베팅', '도박장', '도박사이트', '베팅사이트', '온라인도박',
  '캐시게임', '캐시포커', '리얼머니', '실머니',
  // 사설/불법 토토
  '사설토토', '안전놀이터', '메이저놀이터', '먹튀검증',
  // 환치기/세탁
  '환치기', '돈세탁', '자금세탁',
  // 불법 결제·금융
  '신용카드깡', '카드깡', '상품권깡', '대리입금',
  // 불법 알선
  '성매매', '조건만남',
];

/** 소문자 + 공백·특수문자 제거 — 띄어쓰기/점/특수기호 우회 방어 */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s\W_]/g, '');
}

/** 법적 차단 사전 크기 (코드 하드코딩) */
export const LEGAL_BLOCKED_COUNT = LEGAL_BLOCKED_KEYWORDS.length;

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

/**
 * 금지어 사전 크기 (레거시 호환 — 로그/디버그용).
 * 실제 차단은 Firestore 동적 사전 + LEGAL_BLOCKED_KEYWORDS 조합.
 */
export const BANNED_WORD_COUNT = LEGAL_BLOCKED_KEYWORDS.length;

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

  // 4-A) 법적 차단 — 항상 적용 (코드 하드코딩, 본사 토글 불가)
  //      환금/환전/도박/사설 등 사용자 앱 노출 시 법적 리스크.
  //      contains 정책: 띄어쓰기·특수문자 제거 후 전체 문자열 substring 검색.
  const fullNorm = normalizeForMatch(trimmed);
  for (const raw of LEGAL_BLOCKED_KEYWORDS) {
    const norm = normalizeForMatch(raw);
    if (norm && fullNorm.includes(norm)) {
      return {
        ok: false,
        reason: 'banned_word',
        matchedWord: raw,
        message: '부적절한 표현이 포함되어 있어요',
      };
    }
  }

  // 4-B) 본사 등록 사전 — Firestore /moderationKeywords에 본사가 직접 등록한 단어만.
  //      비어있으면 욕설 차단 안 됨 (사용자 의지 — 본사가 등록한 만큼만 차단).
  //      토큰 단위 매칭으로 false positive 차단 ("오늘 20시 발표" → "시발" 미매칭).
  const dyn = matchKeywordsSync(trimmed);
  if (dyn.matched) {
    return {
      ok: false,
      reason: 'banned_word',
      matchedWord: dyn.word ?? '',
      message: '부적절한 표현이 포함되어 있어요',
    };
  }

  return { ok: true };
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
