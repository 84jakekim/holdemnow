/**
 * triggerYoutubeCurationNow — 본사 어드민 즉시 큐레이션 실행 Callable
 *
 * 권한: platform_admin only (users doc의 role 또는 roles 검사)
 * 동작: runCuration() 즉시 호출 → CurationResult 반환
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { runCuration, YOUTUBE_API_KEY, CurationResult } from './curateHotVideos';

export const triggerYoutubeCurationNow = onCall(
  {
    region: 'asia-northeast3',
    timeoutSeconds: 540,
    memory: '256MiB',
    secrets: [YOUTUBE_API_KEY],
  },
  async (req): Promise<CurationResult> => {
    if (!req.auth?.uid) {
      throw new HttpsError('unauthenticated', 'login required');
    }

    const userSnap = await admin.firestore().collection('users').doc(req.auth.uid).get();
    const userData = userSnap.data() as { role?: string; roles?: string[] } | undefined;
    const isAdmin =
      userData?.role === 'platform_admin' ||
      (Array.isArray(userData?.roles) && userData!.roles!.includes('platform_admin'));
    if (!isAdmin) {
      throw new HttpsError('permission-denied', 'platform_admin only');
    }

    const apiKey = YOUTUBE_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'YOUTUBE_API_KEY secret 미설정');
    }

    try {
      const result = await runCuration(apiKey);
      logger.info(
        `즉시 큐레이션 by ${req.auth.uid} — upsert=${result.upserted}, deleted=${result.expiredDeleted}`,
      );
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`즉시 큐레이션 실패: ${msg}`);
      throw new HttpsError('internal', msg);
    }
  },
);
