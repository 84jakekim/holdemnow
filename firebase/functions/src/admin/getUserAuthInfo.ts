import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

interface Input { uid: string; }

export interface UserAuthInfo {
  uid: string;
  email: string | null;
  displayName: string | null;
  providers: string[];
  hasPassword: boolean;
  hasGoogle: boolean;
  hasKakao: boolean;
  createdAt: string;
  lastSignIn: string;
}

/**
 * 본사가 사용자 클릭 시 어떤 가입 방식인지 미리 확인.
 * - platform_admin 권한 검증
 * - Firebase Auth providerData + uid 접두사로 인증 방식 판별
 * - Kakao는 custom token이라 providerData에 안 잡힘 — uid `kakao:` 접두사로 보조 판별
 */
export const getUserAuthInfo = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 30 },
  async (req): Promise<UserAuthInfo> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'login required');

    const callerSnap = await admin.firestore().collection('users').doc(req.auth.uid).get();
    const callerData = callerSnap.data() as { role?: string; roles?: string[] } | undefined;
    const isAdmin = callerData?.role === 'platform_admin' || callerData?.roles?.includes('platform_admin');
    if (!isAdmin) throw new HttpsError('permission-denied', 'platform_admin only');

    const { uid } = (req.data ?? {}) as Input;
    if (!uid) throw new HttpsError('invalid-argument', 'uid required');

    try {
      const u = await admin.auth().getUser(uid);
      const providers = u.providerData.map((p) => p.providerId);
      // Kakao는 우리 custom token이라 providerData에 안 잡힘 — uid 접두사로 보조 판별
      const isKakao = uid.startsWith('kakao:');
      return {
        uid,
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        providers: isKakao && !providers.includes('kakao') ? [...providers, 'kakao'] : providers,
        hasPassword: providers.includes('password'),
        hasGoogle: providers.includes('google.com'),
        hasKakao: isKakao,
        createdAt: u.metadata.creationTime,
        lastSignIn: u.metadata.lastSignInTime,
      };
    } catch (e) {
      throw new HttpsError('not-found', `user not found: ${(e as Error).message}`);
    }
  },
);
