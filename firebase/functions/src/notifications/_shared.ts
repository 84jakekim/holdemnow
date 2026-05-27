/**
 * 알림 함수 공통 헬퍼. uid 목록 → FCM 토큰 모으기 + 발송 + 만료 토큰 정리.
 */

import * as admin from 'firebase-admin';

export interface TokenDoc {
  uid: string;
  tokenId: string;
  token: string;
}

/** uid 목록 → 각 사용자의 fcmTokens 서브컬렉션을 평탄화한 토큰 배열 */
export async function gatherFcmTokens(uids: string[]): Promise<TokenDoc[]> {
  const db = admin.firestore();
  const out: TokenDoc[] = [];
  await Promise.all(
    uids.map(async (uid) => {
      const snap = await db.collection('users').doc(uid).collection('fcmTokens').get();
      snap.forEach((d) => {
        const v = d.data() as { token?: string };
        if (v.token) out.push({ uid, tokenId: d.id, token: v.token });
      });
    }),
  );
  return out;
}

/** FCM 일괄 발송 + 만료/무효 토큰 자동 정리. 성공 카운트 반환. */
export async function sendAndCleanup(
  tokenDocs: TokenDoc[],
  payload: { title: string; body: string; data: Record<string, string>; url: string; tag?: string },
): Promise<{ successCount: number; failureCount: number }> {
  if (tokenDocs.length === 0) return { successCount: 0, failureCount: 0 };
  const db = admin.firestore();
  const messaging = admin.messaging();

  const messages: admin.messaging.Message[] = tokenDocs.map(({ token }) => ({
    token,
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
    webpush: {
      notification: {
        icon: '/icon-app.svg',
        badge: '/icon-app.svg',
        tag: payload.tag,
      },
      fcmOptions: { link: payload.url },
    },
  }));

  const resp = await messaging.sendEach(messages);

  // 만료/무효 토큰 정리
  const cleanups: Promise<unknown>[] = [];
  resp.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        const { uid, tokenId } = tokenDocs[i];
        cleanups.push(
          db.collection('users').doc(uid).collection('fcmTokens').doc(tokenId).delete(),
        );
      }
    }
  });
  if (cleanups.length > 0) await Promise.allSettled(cleanups);

  return { successCount: resp.successCount, failureCount: resp.failureCount };
}

/**
 * uid 목록을 사용자 prefs 키 기준으로 필터링.
 * 기본 동작: pref가 없거나 undefined면 defaultOn에 따라 결정.
 */
export async function filterByPrefs(
  uids: string[],
  prefKey: 'favLive' | 'tournamentStart' | 'lateRegImminent' | 'marketing',
  defaultOn: boolean,
): Promise<string[]> {
  if (uids.length === 0) return [];
  const db = admin.firestore();
  const allowed: string[] = [];
  await Promise.all(
    uids.map(async (uid) => {
      const u = await db.collection('users').doc(uid).get();
      const prefs = u.data()?.notificationPrefs as Record<string, boolean | undefined> | undefined;
      const v = prefs?.[prefKey];
      if (v === true) allowed.push(uid);
      else if (v === false) return;
      else if (defaultOn) allowed.push(uid); // 미설정 시 default
    }),
  );
  return allowed;
}

/**
 * 마케팅 캠페인 발송 코어 헬퍼.
 *
 * marketingBroadcast(Callable) + processScheduledCampaigns(Scheduled) 둘 다 공유.
 *
 * - testUid가 있으면 그 사용자에게만 발송 (테스트).
 * - 없으면 users where notificationPrefs.marketing == true 전수 발송.
 * - 광고 prefix 자동 처리 (정보통신망법): isAdvertisement=true && !body.startsWith('(광고)') → "(광고) " 자동 부착.
 * - FCM chunk는 sendAndCleanup이 알아서 처리 (500개씩은 admin SDK가 내부 제한).
 *   배치가 더 커질 가능성이 있으면 호출부에서 분할.
 * - 만료/무효 토큰 정리 포함.
 *
 * @returns 발송 통계 {recipientCount, deliveredCount, failureCount}
 */
export async function broadcastMarketing(input: {
  campaignId?: string | null;
  title: string;
  body: string;
  imageUrl?: string | null;
  linkUrl?: string | null;
  isAdvertisement: boolean;
  testUid?: string | null;
}): Promise<{ recipientCount: number; deliveredCount: number; failureCount: number }> {
  const db = admin.firestore();
  const messaging = admin.messaging();

  // 1. 광고 prefix
  const finalBody = input.isAdvertisement && !input.body.startsWith('(광고)')
    ? `(광고) ${input.body}`
    : input.body;

  // 2. 대상 uid 결정
  let targetUids: string[];
  if (input.testUid) {
    targetUids = [input.testUid];
  } else {
    const usersSnap = await db
      .collection('users')
      .where('notificationPrefs.marketing', '==', true)
      .get();
    targetUids = usersSnap.docs.map((d) => d.id);
  }

  if (targetUids.length === 0) {
    return { recipientCount: 0, deliveredCount: 0, failureCount: 0 };
  }

  // 3. 토큰 모음
  const tokenDocs = await gatherFcmTokens(targetUids);
  if (tokenDocs.length === 0) {
    return { recipientCount: targetUids.length, deliveredCount: 0, failureCount: 0 };
  }

  // 4. 메시지 빌드 — 토큰별 (이미지/링크/data payload 포함). 500개씩 chunk.
  const baseData: Record<string, string> = {
    type: 'marketing',
    campaignId: input.campaignId ?? '',
    url: input.linkUrl ?? '/m',
  };
  if (input.isAdvertisement) baseData.isAd = '1';

  const messages: admin.messaging.Message[] = tokenDocs.map(({ token }) => {
    const notification: admin.messaging.Notification = {
      title: input.title,
      body: finalBody,
    };
    if (input.imageUrl) notification.imageUrl = input.imageUrl;

    const webpushNotification: admin.messaging.WebpushNotification = {
      icon: '/icon-app.svg',
      badge: '/icon-app.svg',
      tag: `campaign-${input.campaignId ?? Date.now()}`,
    };
    if (input.imageUrl) webpushNotification.image = input.imageUrl;

    return {
      token,
      notification,
      data: baseData,
      webpush: {
        notification: webpushNotification,
        fcmOptions: { link: input.linkUrl ?? '/m' },
      },
    };
  });

  // 5. 청크 발송 + 만료 토큰 정리
  let totalSuccess = 0;
  let totalFailure = 0;
  const cleanups: Promise<unknown>[] = [];

  for (let i = 0; i < messages.length; i += 500) {
    const chunk = messages.slice(i, i + 500);
    const resp = await messaging.sendEach(chunk);
    totalSuccess += resp.successCount;
    totalFailure += resp.failureCount;
    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          const td = tokenDocs[i + idx];
          if (td) {
            cleanups.push(
              db
                .collection('users')
                .doc(td.uid)
                .collection('fcmTokens')
                .doc(td.tokenId)
                .delete(),
            );
          }
        }
      }
    });
  }
  await Promise.allSettled(cleanups);

  // 6. 인앱 알림 doc 작성 — recipient uid 전원 (FCM 토큰 유무와 독립). 60일 TTL.
  // 마케팅 알림은 사용자가 토글 ON한 사용자만 대상이므로 정보통신망법 준수.
  await writeInAppNotificationBulk(targetUids, {
    type: 'marketing',
    title: input.title,
    body: finalBody,
    linkPath: input.linkUrl ?? '/m',
    payload: {
      campaignId: input.campaignId ?? null,
      isAd: input.isAdvertisement ? 1 : 0,
    },
    ttlDays: 60,
  });

  return {
    recipientCount: targetUids.length,
    deliveredCount: totalSuccess,
    failureCount: totalFailure,
  };
}

/** Firestore 서브컬렉션 경로(`users/{uid}/...`)에서 uid 추출 */
export function uidFromPath(refPath: string): string | null {
  const parts = refPath.split('/');
  const idx = parts.indexOf('users') + 1;
  return idx > 0 && parts[idx] ? parts[idx] : null;
}

// ─────────────────────────────────────────────────────────────
// 인앱 알림(notifications/{uid}/items) — 2026-05-27
// ─────────────────────────────────────────────────────────────

export type InAppNotificationType =
  | 'reservation_confirmed'
  | 'reservation_cancelled_by_store'
  | 'cancel_request_received'
  | 'cancel_request_declined'
  | 'reservation_reminder'
  | 'new_reservation'
  | 'tournament_start'
  | 'late_reg_imminent'
  | 'series_countdown'
  | 'favorite_live'
  | 'new_review'
  | 'marketing'
  | 'new_inquiry'
  | 'inquiry_replied';

export interface InAppNotificationInput {
  type: InAppNotificationType;
  title: string;
  body: string;
  linkPath?: string | null;
  payload?: Record<string, string | number | boolean | null> | null;
  /** TTL 일수 (기본 30일). 마케팅은 60일 권장. */
  ttlDays?: number;
}

/**
 * 단일 사용자에게 인앱 알림 doc 작성.
 *
 * FCM 푸시와 별개. FCM 실패해도 in-app은 작성, in-app 실패해도 FCM은 send.
 * 호출부에서 await로 catch만 하면 됨 — throw하지 않음(silent fail 회피).
 *
 * 경로: notifications/{uid}/items/{auto-id}
 */
export async function writeInAppNotification(
  uid: string,
  input: InAppNotificationInput,
): Promise<string | null> {
  if (!uid) return null;
  const db = admin.firestore();
  const ttlDays = input.ttlDays ?? 30;
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    now.toMillis() + ttlDays * 24 * 3600 * 1000,
  );

  // undefined 필드를 객체에서 제거 (Firestore는 undefined 거부)
  const raw: Record<string, unknown> = {
    type: input.type,
    title: input.title,
    body: input.body,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  };
  if (input.linkPath) raw.linkPath = input.linkPath;
  if (input.payload && Object.keys(input.payload).length > 0) {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.payload)) {
      if (v !== undefined && v !== null) sanitized[k] = v;
    }
    if (Object.keys(sanitized).length > 0) raw.payload = sanitized;
  }

  try {
    const ref = await db
      .collection('notifications')
      .doc(uid)
      .collection('items')
      .add(raw);
    return ref.id;
  } catch (err) {
    console.error(`[writeInAppNotification] uid=${uid} type=${input.type} failed`, err);
    return null;
  }
}

/**
 * 다중 사용자에게 일괄 인앱 알림 작성 (마케팅/시리즈 카운트다운 등).
 * 청크 단위로 Promise.allSettled.
 */
export async function writeInAppNotificationBulk(
  uids: string[],
  input: InAppNotificationInput,
): Promise<{ writtenCount: number; failedCount: number }> {
  if (uids.length === 0) return { writtenCount: 0, failedCount: 0 };
  let written = 0;
  let failed = 0;
  // 청크 500개씩
  for (let i = 0; i < uids.length; i += 500) {
    const chunk = uids.slice(i, i + 500);
    const results = await Promise.allSettled(
      chunk.map((uid) => writeInAppNotification(uid, input)),
    );
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value) written++;
      else failed++;
    });
  }
  return { writtenCount: written, failedCount: failed };
}
