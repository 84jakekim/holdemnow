'use client';

/**
 * checkIns.ts — 매장 체크인 v0.1 (소셜 기능 최소 도입)
 *
 * 정책 (memory: project_social_feature_plan v0.1):
 *  - 별도 탭 신설 X (6탭 함정 금지)
 *  - 홈 한 섹션으로만 노출 (`DailyPostsCarousel` 위/아래)
 *  - v0.5/v1.0 확장: 팔로우·알림·댓글·좋아요는 본 파일에서 다루지 않음
 *
 * 데이터 모델:
 *  checkIns/{checkInId} (top-level):
 *    uid          : string  — 작성자 uid
 *    displayName  : string  — denormalized (작성 시점 닉네임)
 *    avatarUrl?   : string  — denormalized (작성 시점 아바타)
 *    storeId      : string
 *    storeName    : string  — denormalized
 *    comment?     : string  — 60자 한도 (선택)
 *    createdAt    : Timestamp
 *    expiresAt    : Timestamp  — createdAt + 24h (홈 노출 차단용, TTL 정책은 클라 필터)
 *
 * 24h 만료: query 시 createdAt > now-24h 로 필터 (TTL 컬렉션 별도 미설정).
 *  - posts.ts와 동일 패턴. cron은 v0.5에서 도입 검토.
 *
 * Rate limit (1일 1매장 1회):
 *  - 클라 가드: checkIns where uid==me, storeId==X, createdAt>=now-24h
 *  - Firestore rules에서는 강제하지 않음(스팸 시 v0.5에서 cron으로 정리)
 *
 * 상금 노출 정책 (memory: project_prize_display_policy):
 *  - 본 모듈은 상금 관련 필드를 다루지 않음. 매장명+한 줄 후기만 노출.
 */

import {
  collection,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  limit as fsLimit,
} from 'firebase/firestore';
import { db } from './firebase';
import { stripUndefined } from './firestoreUtil';

export const CHECKIN_COMMENT_MAX = 60;
export const CHECKIN_TTL_MS = 24 * 60 * 60 * 1000;
export const CHECKIN_RATE_LIMIT_MS = CHECKIN_TTL_MS; // 1일 1매장 1회

export class CheckInGuardError extends Error {
  constructor(public readonly code: 'rate_limit' | 'length' | 'auth', message: string) {
    super(message);
    this.name = 'CheckInGuardError';
  }
}

export interface CheckIn {
  id: string;
  uid: string;
  displayName: string;
  avatarUrl?: string;
  storeId: string;
  storeName: string;
  comment?: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export interface CreateCheckInInput {
  uid: string;
  displayName: string;
  avatarUrl?: string;
  storeId: string;
  storeName: string;
  comment?: string;
}

/**
 * 본인이 이 매장에 24h 이내 체크인 했는지 확인.
 * Rate-limit 가드(1일 1매장 1회)에 사용.
 */
export async function hasRecentCheckIn(uid: string, storeId: string): Promise<boolean> {
  const since = Timestamp.fromMillis(Date.now() - CHECKIN_RATE_LIMIT_MS);
  const q = query(
    collection(db, 'checkIns'),
    where('uid', '==', uid),
    where('storeId', '==', storeId),
    where('createdAt', '>=', since),
    fsLimit(1),
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

/**
 * 체크인 생성.
 *  - 60자 초과 → CheckInGuardError('length')
 *  - 1일 1매장 1회 위반 → CheckInGuardError('rate_limit')
 *  - uid 누락 → CheckInGuardError('auth')
 */
export async function createCheckIn(input: CreateCheckInInput): Promise<string> {
  if (!input.uid) throw new CheckInGuardError('auth', '로그인이 필요합니다.');
  const comment = input.comment?.trim();
  if (comment && comment.length > CHECKIN_COMMENT_MAX) {
    throw new CheckInGuardError('length', `한 줄 후기는 ${CHECKIN_COMMENT_MAX}자 이내로 입력해 주세요.`);
  }
  const already = await hasRecentCheckIn(input.uid, input.storeId);
  if (already) {
    throw new CheckInGuardError('rate_limit', '이 매장은 24시간 이내에 이미 체크인했습니다.');
  }
  const now = Date.now();
  const payload = stripUndefined({
    uid: input.uid,
    displayName: input.displayName || '플레이어',
    avatarUrl: input.avatarUrl,
    storeId: input.storeId,
    storeName: input.storeName,
    comment: comment || undefined,
    createdAt: serverTimestamp(),
    // serverTimestamp는 쓰기 후 채워지므로, 만료시각도 명시적으로 박는다.
    expiresAt: Timestamp.fromMillis(now + CHECKIN_TTL_MS),
  });
  const ref = await addDoc(collection(db, 'checkIns'), payload);
  return ref.id;
}

/**
 * 최근 24h 체크인 N건 실시간 구독.
 * 홈 섹션용. createdAt DESC.
 *
 * Firestore index: (createdAt DESC) — 기본 인덱스로 충분.
 * 24h 필터는 클라에서 createdAt 비교(서버에서 where 'createdAt >= since' 시 추가 index 불필요).
 */
export function subscribeRecentCheckIns(
  limit: number,
  onChange: (items: CheckIn[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const since = Timestamp.fromMillis(Date.now() - CHECKIN_TTL_MS);
  const q = query(
    collection(db, 'checkIns'),
    where('createdAt', '>=', since),
    orderBy('createdAt', 'desc'),
    fsLimit(limit),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: CheckIn[] = [];
      snap.forEach((d) => {
        const data = d.data();
        items.push({
          id: d.id,
          uid: String(data.uid ?? ''),
          displayName: String(data.displayName ?? '플레이어'),
          avatarUrl: data.avatarUrl ? String(data.avatarUrl) : undefined,
          storeId: String(data.storeId ?? ''),
          storeName: String(data.storeName ?? ''),
          comment: data.comment ? String(data.comment) : undefined,
          createdAt: (data.createdAt as Timestamp) ?? Timestamp.now(),
          expiresAt: (data.expiresAt as Timestamp) ?? Timestamp.now(),
        });
      });
      onChange(items);
    },
    (err) => onError?.(err as Error),
  );
}
