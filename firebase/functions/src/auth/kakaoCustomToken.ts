/**
 * 카카오 로그인 → Firebase Custom Token 교환
 *
 * 흐름:
 * 1. 클라이언트가 카카오 SDK로 로그인 → 카카오 access_token 받음
 * 2. 이 Function을 호출 (HTTPS callable) → access_token 전달
 * 3. Function이 카카오 API로 사용자 정보 조회 (id, nickname, email, profileImage)
 * 4. Firebase Auth에 카카오 id 기반 user 조회/생성
 * 5. Custom Token 발급해서 클라이언트로 반환
 * 6. 클라이언트가 `signInWithCustomToken(token)` 호출 → Firebase 로그인 완료
 *
 * users 컬렉션의 user document도 같이 upsert.
 *
 * 참고: https://firebase.google.com/docs/auth/admin/create-custom-tokens
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import axios from 'axios';

interface KakaoTokenInput {
  /** 이미 발급된 access_token (예: 카카오 SDK 클라이언트 로그인 결과) */
  accessToken?: string;
  /** OAuth code (redirect 기반 인증 결과) */
  code?: string;
  /** code 발급 시 사용한 redirect_uri — token 교환 시 동일하게 보내야 함 */
  redirectUri?: string;
}

interface KakaoUserInfo {
  id: number;
  kakao_account?: {
    email?: string;
    profile?: {
      nickname?: string;
      profile_image_url?: string;
    };
  };
}

export const kakaoCustomToken = onCall<KakaoTokenInput>(
  { region: 'asia-northeast3', maxInstances: 10 },
  async (request) => {
    const { accessToken: providedToken, code, redirectUri } = request.data || {};

    if (!providedToken && !code) {
      throw new HttpsError('invalid-argument', 'accessToken 또는 code 필요');
    }

    // 1. code가 있으면 access_token으로 교환
    let accessToken = providedToken;
    if (!accessToken && code) {
      if (!redirectUri) {
        throw new HttpsError('invalid-argument', 'redirectUri 필요 (code 교환 시)');
      }
      const restKey = process.env.KAKAO_REST_API_KEY;
      if (!restKey) {
        throw new HttpsError('failed-precondition', 'KAKAO_REST_API_KEY 환경변수 미설정');
      }
      try {
        const params = new URLSearchParams();
        params.set('grant_type', 'authorization_code');
        params.set('client_id', restKey);
        params.set('redirect_uri', redirectUri);
        params.set('code', code);
        // Client Secret 기능이 켜진 앱이면 필수. 없으면 KOE010 (Bad client credentials).
        const clientSecret = process.env.KAKAO_CLIENT_SECRET;
        if (clientSecret) {
          params.set('client_secret', clientSecret);
        }
        const tokenRes = await axios.post(
          'https://kauth.kakao.com/oauth/token',
          params,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' } },
        );
        accessToken = tokenRes.data.access_token;
      } catch (err: any) {
        const detail = err?.response?.data || err?.message;
        throw new HttpsError('unauthenticated', `카카오 토큰 교환 실패: ${JSON.stringify(detail)}`);
      }
    }
    if (!accessToken) {
      throw new HttpsError('internal', 'access_token 확보 실패');
    }

    // 2. 카카오 API로 사용자 정보 조회
    let kakaoUser: KakaoUserInfo;
    try {
      const res = await axios.get<KakaoUserInfo>('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      kakaoUser = res.data;
    } catch (err) {
      throw new HttpsError('unauthenticated', '카카오 사용자 정보 조회 실패');
    }

    const kakaoId = String(kakaoUser.id);
    const account = kakaoUser.kakao_account || {};
    const profile = account.profile || {};
    const nickname = profile.nickname || '플레이어';
    const profileImage = profile.profile_image_url || null;
    const email = account.email || null;

    // 2. Firebase Auth uid는 kakao:{id} 형식 (충돌 방지)
    const uid = `kakao:${kakaoId}`;

    // 3. Auth user 조회/생성
    try {
      await admin.auth().getUser(uid);
      // 존재 → 정보 업데이트
      await admin.auth().updateUser(uid, {
        displayName: nickname,
        photoURL: profileImage || undefined,
        email: email || undefined,
      });
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        await admin.auth().createUser({
          uid,
          displayName: nickname,
          photoURL: profileImage || undefined,
          email: email || undefined,
        });
      } else {
        throw new HttpsError('internal', 'Firebase Auth 사용자 처리 실패');
      }
    }

    // 4. customClaims로 role 부여 (firestore.rules에서 사용)
    await admin.auth().setCustomUserClaims(uid, { role: 'player' });

    // 5. users 컬렉션에 upsert
    const db = admin.firestore();
    await db.collection('users').doc(uid).set(
      {
        uid,
        kakaoId,
        nickname,
        profileImage,
        email,
        role: 'player',
        notificationPrefs: {
          favLive: true,
          tournamentStart: true,
          lateRegImminent: false,
          marketing: false,
        },
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // createdAt은 최초 생성 시에만
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // 6. Custom Token 발급
    const customToken = await admin.auth().createCustomToken(uid, { role: 'player' });
    return { customToken, uid };
  },
);
