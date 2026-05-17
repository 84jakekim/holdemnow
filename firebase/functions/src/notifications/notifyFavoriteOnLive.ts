/**
 * LIVE 세션 생성 시 그 매장을 즐겨찾기한 사용자들에게 FCM 푸시 발송.
 *
 * 트리거: liveSessions/{sessionId} onCreate
 *
 * 흐름:
 * 1. 세션 doc에서 storeId, storeName, tournamentName 추출
 * 2. collectionGroup('favorites')에서 storeId 일치 + notifyOnLive=true 사용자 조회
 *    → 부모 path에서 uid 추출 (`users/{uid}/favorites/{storeId}`)
 * 3. 각 uid의 fcmTokens 서브컬렉션 읽어 토큰 모음
 * 4. admin.messaging().sendEach(...) 일괄 발송
 * 5. 실패 응답에서 unregistered/invalid 토큰은 정리
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

interface LiveSessionDoc {
  storeId?: string;
  storeName?: string;
  tournamentName?: string;
  buyIn?: number;
}

export const notifyFavoriteOnLive = onDocumentCreated(
  {
    document: 'liveSessions/{sessionId}',
    region: 'asia-northeast3',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const sessionId = event.params.sessionId;
    const data = snap.data() as LiveSessionDoc;
    const { storeId, storeName = '매장', tournamentName = '토너' } = data;

    if (!storeId) {
      console.warn(`session ${sessionId} has no storeId, skip`);
      return;
    }

    const db = admin.firestore();
    const messaging = admin.messaging();

    // 1. 이 매장을 즐겨찾기한 user 조회 (collectionGroup 쿼리)
    //    requires composite index on collectionGroup('favorites') with fields storeId, notifyOnLive
    let favSnap;
    try {
      favSnap = await db
        .collectionGroup('favorites')
        .where('storeId', '==', storeId)
        .where('notifyOnLive', '==', true)
        .get();
    } catch (e: any) {
      // 인덱스 없을 가능성 — storeId만으로 쿼리 후 클라이언트 필터로 폴백
      console.warn('favorites composite query failed, falling back:', e?.message);
      favSnap = await db
        .collectionGroup('favorites')
        .where('storeId', '==', storeId)
        .get();
    }

    if (favSnap.empty) {
      console.log(`No favorites for store ${storeId}`);
      return;
    }

    // 2. uid 목록 추출 + notifyOnLive=true 한 번 더 필터 (폴백 대비)
    const uids: string[] = [];
    favSnap.forEach((d) => {
      const v = d.data() as { notifyOnLive?: boolean };
      if (v.notifyOnLive === false) return;
      // 경로: users/{uid}/favorites/{storeId}
      const parts = d.ref.path.split('/');
      const uidIdx = parts.indexOf('users') + 1;
      if (uidIdx > 0 && parts[uidIdx]) uids.push(parts[uidIdx]);
    });
    if (uids.length === 0) return;

    // 3. 각 uid의 fcmTokens 모음
    const tokenDocs: { uid: string; tokenId: string; token: string }[] = [];
    await Promise.all(
      uids.map(async (uid) => {
        const tSnap = await db.collection('users').doc(uid).collection('fcmTokens').get();
        tSnap.forEach((td) => {
          const tv = td.data() as { token?: string };
          if (tv.token) tokenDocs.push({ uid, tokenId: td.id, token: tv.token });
        });
      }),
    );

    if (tokenDocs.length === 0) {
      console.log(`No FCM tokens for ${uids.length} favoriters of store ${storeId}`);
      return;
    }

    // 4. 메시지 일괄 발송
    const messages: admin.messaging.Message[] = tokenDocs.map(({ token }) => ({
      token,
      notification: {
        title: `🔴 ${storeName} LIVE 시작!`,
        body: `${tournamentName} · 지금 진행 중`,
      },
      data: {
        type: 'favorite-live',
        sessionId,
        storeId,
        url: `/m/live/${sessionId}`,
      },
      webpush: {
        notification: {
          icon: '/icon-app.svg',
          badge: '/icon-app.svg',
          tag: `live-${sessionId}`,
        },
        fcmOptions: {
          link: `/m/live/${sessionId}`,
        },
      },
    }));

    const resp = await messaging.sendEach(messages);
    console.log(
      `Sent to ${tokenDocs.length} devices for store ${storeId}: ${resp.successCount} OK, ${resp.failureCount} failed`,
    );

    // 5. 만료/무효 토큰 정리
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
    if (cleanups.length > 0) {
      await Promise.allSettled(cleanups);
      console.log(`Cleaned up ${cleanups.length} stale tokens`);
    }
  },
);
