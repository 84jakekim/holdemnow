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
  accessToken: string;
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
    const { accessToken } = request.data || {};
    if (!accessToken) {
      throw new HttpsError('invalid-argument', 'accessToken is required');
    }

    // 1. 카카오 API로 사용자 정보 조회
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
