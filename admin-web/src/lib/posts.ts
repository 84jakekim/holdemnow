'use client';

import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  limit,
} from 'firebase/firestore';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { db, storage } from './firebase';
import { compressImageForUpload } from './imageCompress';
import { stripUndefined } from './firestoreUtil';
import { moderateText, checkLinkWhitelist, capEmojis } from './moderation';

/**
 * 매장 데일리 홍보 ("오늘의 소식") + 본사 pinned 공지.
 *
 * 정책 (memory: project_holdemnow_daily_posts):
 * - 매장당 1일 3글 (free tier, 2026-05-22 변경 — POST_DAILY_LIMIT_FREE), createdAt + 24h 자동 만료
 * - 이미지 최대 4장 (5MB/장)
 * - 자유 이벤트 태그
 * - 본사 pinned 글은 top-level `pinnedPosts` 컬렉션 (홈 최상단 고정)
 * - authorType 필드로 추후 SNS 'user' 게시글과 호환
 *
 * 콘텐츠 가드 (Sprint 1 Phase E, 2026-05-21):
 * - moderateText: 욕설·도박·환금 키워드 자동 거부 (lib/moderation 사전 ~250개)
 * - checkLinkWhitelist: open.kakao.com / pf.kakao.com 외 URL 거절
 * - 1일 N글 클라이언트 가드: createdAt + 24h 이내 본인 글 수 ≥ POST_DAILY_LIMIT_FREE 시 차단
 * - 이모지 5개 캡: 자동 자르기 (UX 마찰 최소화)
 * - 신고 누적 3건 → autoHideOnReports Cloud Function이 status='hidden' 처리
 */
export class PostGuardError extends Error {
  constructor(public readonly code: 'banned' | 'link' | 'rate_limit' | 'empty' | 'length', message: string) {
    super(message);
    this.name = 'PostGuardError';
  }
}

const POST_MAX_LENGTH = 500;
/** 카드 노출용 한 줄 헤드라인 최대 길이 (grapheme 기준 — 이모지 1자 = 1자) */
export const HEADLINE_MAX_LENGTH = 40;

const POST_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_POST_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * 카드 색상 팔레트 (Phase F+, 2026-05-22 / 확장 2026-05-22).
 * 매장 어드민이 글 작성 시 선택. 홈 캐러셀에서 카드 톤으로 적용.
 * 기본 6색 + 확장 3색: purple(라운지), cyan(청량/오픈), orange(주말/활기).
 */
export type PostCardColor =
  | 'white' | 'pink' | 'green' | 'gold' | 'navy' | 'red'
  | 'purple' | 'cyan' | 'orange';
export const POST_CARD_COLORS: PostCardColor[] = [
  'white', 'pink', 'green', 'gold', 'navy', 'red',
  'purple', 'cyan', 'orange',
];

/**
 * 큐레이션된 카드 액센트 이모지 — 5개 카테고리 48종 (2026-05-22 확장).
 * 어드민 폼에서 카테고리 탭으로 노출. 다중 선택(최대 3개) 지원.
 */
export const POST_CARD_EMOJI_GROUPS = {
  '포커': ['🃏', '🎰', '♠️', '♥️', '♦️', '♣️', '🎯', '💰', '💵', '💸'],
  '이벤트': ['🎉', '🎊', '🎁', '✨', '🔥', '⚡', '⭐', '💎', '🏆', '🌟'],
  '식음': ['☕', '🍻', '🍺', '🍷', '🥃', '🍰', '🍕', '🍣'],
  '안내': ['📢', '🔔', '❗', '⚠️', '💡', '📅', '🕐', '🏬', '📍', '🚨'],
  '모집': ['👀', '🙋', '👋', '🆕', '🎪', '🤝', '💼', '📝', '🎓', '🚀'],
} as const;

/** 평탄화된 큐레이션 셋 — 검증/마이그레이션용 */
export const POST_CARD_EMOJIS: readonly string[] = Object.values(POST_CARD_EMOJI_GROUPS).flat();
export type PostCardEmoji = string;

/** 카드에 노출할 이모지 최대 개수 (다중 선택) */
export const POST_CARD_EMOJIS_MAX = 3;

/** grapheme 기준 길이 — 이모지/한글/영문 1자 = 1 */
export function graphemeLength(s: string): number {
  if (!s) return 0;
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let n = 0;
    for (const _ of seg.segment(s)) n++;
    return n;
  } catch {
    // fallback (구형 환경): Array.from은 코드포인트 단위라 일부 ZWJ는 분리되지만 근사치 OK
    return Array.from(s).length;
  }
}

/** grapheme 기준으로 자르기 (UI 카운터/저장 시 안전) */
export function truncateGraphemes(s: string, max: number): string {
  if (!s) return '';
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let out = '';
    let n = 0;
    for (const part of seg.segment(s)) {
      if (n >= max) break;
      out += part.segment;
      n++;
    }
    return out;
  } catch {
    return Array.from(s).slice(0, max).join('');
  }
}

export type PostAuthorType = 'store' | 'platform' | 'user'; // user는 v1.0 SNS 확장용
export type PostStatus = 'published' | 'hidden' | 'pending';

export interface StorePost {
  id: string;
  storeId: string;
  storeName?: string;
  body: string;
  /** 카드 노출용 한 줄 (Phase F, 2026-05-22). 없으면 body 첫 줄 fallback. 최대 40 grapheme. */
  headline?: string;
  /** 카드 색상 톤. 미설정 시 'white' (기본). */
  cardColor?: PostCardColor;
  /**
   * 카드 좌측 액센트 이모지 — 레거시 단일 필드 (2026-05-22 이전 작성 글).
   * 신규 작성은 cardEmojis 배열을 사용. resolveCardVisual이 자동 승격.
   * @deprecated cardEmojis 사용
   */
  cardEmoji?: string;
  /**
   * 카드 좌측 액센트 이모지 — 다중 선택 (최대 POST_CARD_EMOJIS_MAX개).
   * 미설정 시 색상별 기본 이모지가 자동 적용됩니다.
   * (2026-05-22 신설)
   */
  cardEmojis?: string[];
  imageUrls: string[];
  eventTags: string[];
  ctaUrl?: string;
  ctaLabel?: string;
  authorType: PostAuthorType;
  authorUid: string;
  status: PostStatus;
  flagCount: number;
  createdAt?: Timestamp;
  expiresAt?: Timestamp;
}

export interface PinnedPost {
  id: string;
  title: string;
  body: string;
  imageUrls: string[];
  ctaUrl?: string;
  ctaLabel?: string;
  active: boolean;
  priority: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─────────────────────────────────────────────────────────────
// 매장 posts (stores/{storeId}/posts/{postId})
// ─────────────────────────────────────────────────────────────

function postsCol(storeId: string) {
  return collection(db, 'stores', storeId, 'posts');
}

function expiresFromNow(): Timestamp {
  return Timestamp.fromMillis(Date.now() + POST_TTL_MS);
}

/** 매장 어드민용 — 자기 매장 글 전체(만료/숨김 포함) */
export function subscribeStorePostsAll(
  storeId: string,
  onChange: (items: StorePost[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(postsCol(storeId), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StorePost, 'id'>),
        })),
      );
    },
    (e) => onError(e as Error),
  );
}

/** 매장 상세 페이지용 — 활성(미만료, published) 최신 1건 */
export function subscribeStoreActivePost(
  storeId: string,
  onChange: (post: StorePost | null) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    postsCol(storeId),
    where('status', '==', 'published'),
    orderBy('createdAt', 'desc'),
    limit(1),
  );
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onChange(null);
        return;
      }
      const d = snap.docs[0];
      const data = { id: d.id, ...(d.data() as Omit<StorePost, 'id'>) };
      // 클라이언트 측 만료 필터 — expiresAt 지났으면 안 보여줌
      const expMs = data.expiresAt?.toMillis() ?? 0;
      if (expMs && expMs <= Date.now()) {
        onChange(null);
        return;
      }
      onChange(data);
    },
    (e) => onError(e as Error),
  );
}

/** 홈용 — 전체 매장의 활성(미만료) 글 collectionGroup. 거리/위치 필터는 호출자에서. */
export async function loadActivePostsAll(maxAgeMs = POST_TTL_MS): Promise<StorePost[]> {
  const since = Timestamp.fromMillis(Date.now() - maxAgeMs);
  const q = query(
    collectionGroup(db, 'posts'),
    where('status', '==', 'published'),
    where('createdAt', '>=', since),
    orderBy('createdAt', 'desc'),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    storeId: d.ref.parent.parent?.id ?? '',
    ...(d.data() as Omit<StorePost, 'id' | 'storeId'>),
  }));
}

/**
 * 채팅방(/m/posts)용 — 전체 매장의 활성 글을 createdAt **오름차순**(말풍선 시간순)으로
 * 실시간 구독. 거리/위치 필터는 호출자에서 클라이언트 사이드로 처리.
 *
 * 정책 (2026-05-22 신설):
 *  - 채팅방 톤이므로 오래된 글이 위, 최신 글이 아래로. 새 글이 추가될 때마다 자동 추가.
 *  - 24h 만료 + status='published'만 노출. (인덱스: posts collectionGroup status+createdAt asc)
 *  - limit 100 — 24h 안에 100건 넘는 트래픽은 v0.1 범위 밖.
 *  - storeId는 d.ref.parent.parent?.id에서 추출 (collectionGroup 메타).
 */
export function subscribeActivePostsAll(
  onChange: (items: StorePost[]) => void,
  onError: (e: Error) => void,
  options: { maxAgeMs?: number; limitCount?: number } = {},
) {
  const maxAgeMs = options.maxAgeMs ?? POST_TTL_MS;
  const limitCount = options.limitCount ?? 100;
  const since = Timestamp.fromMillis(Date.now() - maxAgeMs);
  const q = query(
    collectionGroup(db, 'posts'),
    where('status', '==', 'published'),
    where('createdAt', '>=', since),
    orderBy('createdAt', 'asc'),
    limit(limitCount),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: StorePost[] = snap.docs.map((d) => ({
        id: d.id,
        storeId: d.ref.parent.parent?.id ?? '',
        ...(d.data() as Omit<StorePost, 'id' | 'storeId'>),
      }));
      onChange(items);
    },
    (e) => onError(e as Error),
  );
}

/** 매장 1일 작성 한도 (free tier, 2026-05-22).
 *  향후 유료 패키지로 횟수 증액 예정 — `project_post_quota_roadmap.md` 참조. */
export const POST_DAILY_LIMIT_FREE = 3;

/** 매장이 24h 이내 작성한 글 수 (한도 가드용). */
export async function countRecentPostsByStore(storeId: string, authorUid: string): Promise<number> {
  const since = Timestamp.fromMillis(Date.now() - POST_TTL_MS);
  const q = query(
    postsCol(storeId),
    where('authorUid', '==', authorUid),
    where('createdAt', '>=', since),
  );
  const snap = await getDocs(q);
  return snap.size;
}

/**
 * headline에 대한 가드:
 *  - 빈 값 → 차단 (Phase F 이후 필수 필드)
 *  - 40 grapheme 초과 → 자동 자르기 (UX 마찰 최소화)
 *  - 욕설/도박/링크/이모지 캡(5개)은 본문과 동일 적용
 */
function sanitizeHeadline(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new PostGuardError('empty', '카드에 노출될 한 줄을 입력해주세요');
  const mod = moderateText(trimmed, { maxLength: HEADLINE_MAX_LENGTH * 4 }); // 길이 자체는 grapheme로 별도
  if (!mod.ok) {
    const detail = mod.matchedWord
      ? `카드 노출 문구에 사용할 수 없는 표현이 있어요: "${mod.matchedWord}"`
      : (mod.message ?? '카드 노출 문구에 사용할 수 없는 표현이 있어요');
    throw new PostGuardError(
      mod.reason === 'banned_word' ? 'banned' : 'length',
      detail,
    );
  }
  const linkCheck = checkLinkWhitelist(trimmed);
  if (!linkCheck.ok) {
    throw new PostGuardError('link', '카드 노출 문구에는 외부 링크를 넣을 수 없어요');
  }
  const capped = capEmojis(trimmed);
  return truncateGraphemes(capped, HEADLINE_MAX_LENGTH);
}

/** 큐레이션 셋에 포함된 이모지만 통과시키고 최대 N개로 잘라 반환 */
function sanitizeCardEmojis(input: {
  cardEmojis?: string[];
  cardEmoji?: string;
}): string[] {
  const set = new Set(POST_CARD_EMOJIS);
  const raw: string[] = [];
  if (Array.isArray(input.cardEmojis)) raw.push(...input.cardEmojis);
  if (input.cardEmoji) raw.push(input.cardEmoji);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (typeof e !== 'string' || !set.has(e) || seen.has(e)) continue;
    out.push(e);
    seen.add(e);
    if (out.length >= POST_CARD_EMOJIS_MAX) break;
  }
  return out;
}

export async function createStorePost(input: {
  storeId: string;
  storeName?: string;
  body: string;
  headline?: string;
  cardColor?: PostCardColor;
  /** @deprecated cardEmojis 사용 — 호환을 위해 받기는 함 */
  cardEmoji?: string;
  cardEmojis?: string[];
  imageUrls?: string[];
  eventTags?: string[];
  ctaUrl?: string;
  ctaLabel?: string;
  authorUid: string;
}): Promise<string> {
  // ── Phase E 가드 ──────────────────────────────────────────
  const trimmed = (input.body ?? '').trim();
  if (!trimmed) {
    throw new PostGuardError('empty', '내용을 입력해주세요');
  }
  // 1) 욕설·도박·환금 키워드 + 길이 + 도배
  const mod = moderateText(trimmed, { maxLength: POST_MAX_LENGTH });
  if (!mod.ok) {
    const detail = mod.matchedWord
      ? `본문에 사용할 수 없는 표현이 있어요: "${mod.matchedWord}"`
      : (mod.message ?? '작성할 수 없는 내용이에요');
    throw new PostGuardError(
      mod.reason === 'banned_word' ? 'banned' : 'length',
      detail,
    );
  }
  // 2) 외부 링크 whitelist
  const linkCheck = checkLinkWhitelist(trimmed);
  if (!linkCheck.ok) {
    throw new PostGuardError('link', linkCheck.message ?? '외부 링크가 허용되지 않아요');
  }
  // 3) ctaUrl 도 whitelist 적용
  if (input.ctaUrl) {
    const ctaCheck = checkLinkWhitelist(input.ctaUrl);
    if (!ctaCheck.ok) {
      throw new PostGuardError('link', '카카오 오픈채팅·플러스친구 외 링크는 첨부할 수 없어요');
    }
  }
  // 4) 1일 작성 한도 가드 (free tier 3건/24h. 유료 패키지 도입 시 증액 예정)
  const recentCount = await countRecentPostsByStore(input.storeId, input.authorUid);
  if (recentCount >= POST_DAILY_LIMIT_FREE) {
    throw new PostGuardError(
      'rate_limit',
      `오늘의 소식은 하루에 ${POST_DAILY_LIMIT_FREE}건까지 작성할 수 있어요. 기존 글을 수정하거나 24시간 후 다시 작성해주세요.`,
    );
  }
  // 5) 이모지 5개 캡 — 자동 자르기 (UX 마찰 최소화)
  const cappedBody = capEmojis(trimmed);
  // 6) headline 가드 — 필수, grapheme 기준 40자 캡, 동일 키워드/링크 가드
  const headline = sanitizeHeadline(input.headline ?? (input.body ?? '').split('\n')[0]);
  // 7) cardColor 화이트리스트
  const cardColor: PostCardColor = POST_CARD_COLORS.includes(input.cardColor as PostCardColor)
    ? (input.cardColor as PostCardColor)
    : 'white';
  // 8) cardEmojis 검증 — 큐레이션 셋에 포함된 이모지만 최대 N개. 레거시 cardEmoji도 같이 흡수.
  const cardEmojis = sanitizeCardEmojis(input);
  // 백워드 호환: 단일 필드도 같이 저장 (예전 클라이언트 fallback 보호)
  const cardEmoji = cardEmojis[0] ?? '';

  // ⚠️ createdAt: 클라이언트 Timestamp.now() 사용 (2026-05-22 hotfix #4)
  // serverTimestamp() 사용 시 첫 onSnapshot emit에 createdAt=null → 모든 구독자의
  // where('createdAt', '>=', since) + orderBy('createdAt') 쿼리에서 제외되어,
  // 매장 어드민에서 글을 올려도 홈 캐러셀/채팅방/매장 상세에 즉시 안 뜨던 근본 원인.
  // 클라 시간 사용으로 첫 emit부터 query 매칭 보장. (디바이스 clock skew 수 초는 무시 가능)
  // serverCreatedAt은 별도 필드로 백업하여 감사 추적/정확한 정렬이 필요할 때 사용.
  const nowTs = Timestamp.now();
  const ref = await addDoc(postsCol(input.storeId), stripUndefined({
    storeId: input.storeId,
    storeName: input.storeName ?? '',
    body: cappedBody,
    headline,
    cardColor,
    cardEmoji,
    cardEmojis,
    imageUrls: input.imageUrls ?? [],
    eventTags: input.eventTags ?? [],
    ctaUrl: input.ctaUrl ?? '',
    ctaLabel: input.ctaLabel ?? '',
    authorType: 'store' as PostAuthorType,
    authorUid: input.authorUid,
    status: 'published' as PostStatus,
    flagCount: 0,
    createdAt: nowTs,
    serverCreatedAt: serverTimestamp(),
    expiresAt: expiresFromNow(),
  }));
  return ref.id;
}

/**
 * 재등록 — 기존 글의 본문 데이터를 그대로 복사해 새 글 생성.
 * - 새 createdAt = now, expiresAt = now + 24h, 새 doc ID
 * - 이미지는 Storage URL 재사용 (재업로드 없음)
 * - cleanupExpiredPosts cron이 이미 삭제한 이미지 URL은 fetch HEAD로 확인 후 빈 배열 fallback
 * - 1일 작성 한도(POST_DAILY_LIMIT_FREE) 동일 가드 적용
 */
export async function repostStorePost(
  storeId: string,
  postId: string,
  authorUid: string,
): Promise<string> {
  // 원본 글 조회
  const snap = await getDoc(doc(postsCol(storeId), postId));
  if (!snap.exists()) throw new Error('원본 글을 찾을 수 없습니다');
  const src = { id: snap.id, ...(snap.data() as Omit<StorePost, 'id'>) } as StorePost;

  // 1일 작성 한도 가드 (free tier 3건/24h)
  const recentCount = await countRecentPostsByStore(storeId, authorUid);
  if (recentCount >= POST_DAILY_LIMIT_FREE) {
    throw new PostGuardError(
      'rate_limit',
      `오늘의 소식은 하루에 ${POST_DAILY_LIMIT_FREE}건까지 작성할 수 있어요. 24시간 후 다시 재등록해주세요.`,
    );
  }

  // 이미지 URL 유효성 확인 — cleanupExpiredPosts cron(3일 후 삭제)에 의해
  // 이미 제거된 이미지라면 HEAD 요청이 실패하므로 빈 배열로 fallback.
  let imageUrls: string[] = [];
  if ((src.imageUrls ?? []).length > 0) {
    const checks = await Promise.all(
      src.imageUrls.map((url) =>
        fetch(url, { method: 'HEAD' })
          .then((r) => (r.ok ? url : null))
          .catch(() => null),
      ),
    );
    imageUrls = checks.filter((u): u is string => u !== null);
  }

  const nowTs = Timestamp.now();
  const ref = await addDoc(postsCol(storeId), stripUndefined({
    storeId,
    storeName: src.storeName ?? '',
    body: src.body ?? '',
    headline: src.headline ?? '',
    cardColor: src.cardColor ?? 'white',
    cardEmoji: src.cardEmoji ?? '',
    cardEmojis: src.cardEmojis ?? [],
    imageUrls,
    eventTags: src.eventTags ?? [],
    ctaUrl: src.ctaUrl ?? '',
    ctaLabel: src.ctaLabel ?? '',
    authorType: 'store' as PostAuthorType,
    authorUid,
    status: 'published' as PostStatus,
    flagCount: 0,
    createdAt: nowTs,
    serverCreatedAt: serverTimestamp(),
    expiresAt: expiresFromNow(),
  }));
  return ref.id;
}

export async function updateStorePost(
  storeId: string,
  postId: string,
  updates: Partial<Omit<StorePost, 'id' | 'storeId' | 'authorType' | 'authorUid' | 'createdAt' | 'expiresAt'>>,
): Promise<void> {
  // headline/cardColor/cardEmoji가 업데이트에 포함되면 동일 가드 적용
  const next: Record<string, unknown> = { ...updates };
  if (typeof updates.headline === 'string') {
    next.headline = sanitizeHeadline(updates.headline);
  }
  if (typeof updates.cardColor === 'string') {
    next.cardColor = POST_CARD_COLORS.includes(updates.cardColor as PostCardColor)
      ? updates.cardColor
      : 'white';
  }
  // cardEmoji(단일·레거시) / cardEmojis(배열·신규) 어느 쪽이 와도 동일 sanitize 후 둘 다 저장
  if (typeof updates.cardEmoji === 'string' || Array.isArray(updates.cardEmojis)) {
    const cardEmojis = sanitizeCardEmojis({
      cardEmoji: typeof updates.cardEmoji === 'string' ? updates.cardEmoji : undefined,
      cardEmojis: Array.isArray(updates.cardEmojis) ? updates.cardEmojis : undefined,
    });
    next.cardEmojis = cardEmojis;
    next.cardEmoji = cardEmojis[0] ?? '';
  }
  await updateDoc(doc(postsCol(storeId), postId), stripUndefined(next));
}

export async function deleteStorePost(storeId: string, postId: string): Promise<void> {
  try {
    const snap = await getDoc(doc(postsCol(storeId), postId));
    if (snap.exists()) {
      const data = snap.data() as StorePost;
      await Promise.all(
        (data.imageUrls ?? []).map((url) => deletePostImageByUrl(url).catch(() => {})),
      );
    }
  } catch {
    // ignore
  }
  await deleteDoc(doc(postsCol(storeId), postId));
}

/** 포스트 이미지 업로드 — posts/{storeId}/{postId}/{filename} */
export async function uploadPostImage(
  storeId: string,
  postIdOrTemp: string,
  file: File,
): Promise<string> {
  file = await compressImageForUpload(file);
  if (file.size > MAX_IMAGE_BYTES) throw new Error('사진 용량이 커서 업로드할 수 없습니다. 더 작은 사진(JPG 권장)으로 다시 시도해 주세요.');
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드 가능합니다');
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `posts/${storeId}/${postIdOrTemp}/${id}.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}

export async function deletePostImageByUrl(url: string): Promise<void> {
  try {
    await deleteObject(storageRef(storage, url));
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────
// 본사 pinned 글 (pinnedPosts/{id}) — 홈 최상단 고정 공지
// ─────────────────────────────────────────────────────────────

const PINNED = 'pinnedPosts';

export function subscribeActivePinnedPosts(
  onChange: (items: PinnedPost[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(
    collection(db, PINNED),
    where('active', '==', true),
    orderBy('priority', 'desc'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PinnedPost, 'id'>) })));
    },
    (e) => onError(e as Error),
  );
}

export function subscribeAllPinnedPosts(
  onChange: (items: PinnedPost[]) => void,
  onError: (e: Error) => void,
) {
  const q = query(collection(db, PINNED), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PinnedPost, 'id'>) })));
    },
    (e) => onError(e as Error),
  );
}

export async function createPinnedPost(input: {
  title: string;
  body?: string;
  imageUrls?: string[];
  ctaUrl?: string;
  ctaLabel?: string;
  active?: boolean;
  priority?: number;
}): Promise<string> {
  // 동일 함정 차단(2026-05-22 hotfix #4): createdAt을 클라 Timestamp.now()로.
  const nowTs = Timestamp.now();
  const ref = await addDoc(collection(db, PINNED), stripUndefined({
    title: input.title,
    body: input.body ?? '',
    imageUrls: input.imageUrls ?? [],
    ctaUrl: input.ctaUrl ?? '',
    ctaLabel: input.ctaLabel ?? '',
    active: input.active ?? true,
    priority: input.priority ?? 0,
    createdAt: nowTs,
    updatedAt: nowTs,
    serverCreatedAt: serverTimestamp(),
  }));
  return ref.id;
}

export async function updatePinnedPost(
  id: string,
  updates: Partial<Omit<PinnedPost, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  await updateDoc(doc(db, PINNED, id), stripUndefined({
    ...updates,
    updatedAt: serverTimestamp(),
  }));
}

export async function deletePinnedPost(id: string): Promise<void> {
  try {
    const snap = await getDoc(doc(db, PINNED, id));
    if (snap.exists()) {
      const data = snap.data() as PinnedPost;
      await Promise.all(
        (data.imageUrls ?? []).map((url) => deletePostImageByUrl(url).catch(() => {})),
      );
    }
  } catch {
    // ignore
  }
  await deleteDoc(doc(db, PINNED, id));
}

/** pinned 글 이미지 업로드 — posts/_pinned/{postIdOrTemp}/{filename} */
export async function uploadPinnedImage(postIdOrTemp: string, file: File): Promise<string> {
  file = await compressImageForUpload(file);
  if (file.size > MAX_IMAGE_BYTES) throw new Error('사진 용량이 커서 업로드할 수 없습니다. 더 작은 사진(JPG 권장)으로 다시 시도해 주세요.');
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드 가능합니다');
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `posts/_pinned/${postIdOrTemp}/${id}.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}
