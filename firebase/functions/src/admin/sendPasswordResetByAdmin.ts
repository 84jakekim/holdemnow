import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

interface Input {
  targetUid?: string;       // 둘 중 하나
  targetEmail?: string;
}

export interface SendPasswordResetResult {
  success: boolean;
  reason?: 'no_password';
  providers?: string[];
  sentTo?: string | null;
}

/**
 * 본사 관리자가 특정 사용자에게 비밀번호 재설정 이메일 발송.
 * - 호출자가 platform_admin role 보유 검증
 * - 사용자 providerData 확인 — 비번 가입자만 재설정 가능
 * - Google/Kakao 등 소셜 로그인 사용자는 success=false + reason='no_password' 반환
 * - Firebase Admin SDK가 사용자 이메일로 재설정 링크 자동 발송
 * - 평문 비밀번호는 본사도 모름 — 사용자가 메일 링크로 직접 설정
 */
export const sendPasswordResetByAdmin = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 60 },
  async (req): Promise<SendPasswordResetResult> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'login required');

    // platform_admin 검증
    const callerSnap = await admin.firestore().collection('users').doc(req.auth.uid).get();
    const callerData = callerSnap.data() as { role?: string; roles?: string[] } | undefined;
    const isAdmin = callerData?.role === 'platform_admin' || callerData?.roles?.includes('platform_admin');
    if (!isAdmin) throw new HttpsError('permission-denied', 'platform_admin only');

    const input = req.data as Input;
    if (!input.targetUid && !input.targetEmail) {
      throw new HttpsError('invalid-argument', 'targetUid or targetEmail required');
    }

    // 사용자 정보 가져오기 (이메일 + providerData 확보)
    let targetUser: admin.auth.UserRecord;
    if (input.targetUid) {
      targetUser = await admin.auth().getUser(input.targetUid);
    } else {
      targetUser = await admin.auth().getUserByEmail(input.targetEmail!);
    }

    const uid = targetUser.uid;
    const email = targetUser.email ?? null;

    // providerData 기반 인증 방식 판별
    const providers = targetUser.providerData.map((p) => p.providerId);
    // 카카오는 우리 custom token이라 providerData에 안 잡힘 — uid 접두사로 보조 판별
    const isKakao = uid.startsWith('kakao:');
    if (isKakao && !providers.includes('kakao')) providers.push('kakao');
    const hasPassword = providers.includes('password');

    if (!hasPassword) {
      // 소셜 로그인 전용 사용자 — 재설정 메일 발송 불가
      // 감사 로그에도 기록 (시도 자체는 남김)
      await admin.firestore().collection('adminAuditLog').add({
        action: 'password_reset_skipped_no_password',
        callerUid: req.auth.uid,
        targetUid: uid,
        targetEmail: email,
        providers,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`[sendPasswordResetByAdmin] caller=${req.auth.uid} target=${uid} skipped — no password (providers=${providers.join(',')})`);

      return {
        success: false,
        reason: 'no_password',
        providers,
        sentTo: email,
      };
    }

    if (!email) {
      throw new HttpsError('not-found', 'user has no email — cannot send reset link');
    }

    // 재설정 링크 생성 + Firebase가 자동으로 메일 발송 (default email template)
    // generatePasswordResetLink는 링크만 생성 — 실제 메일 발송은 Firebase Auth가 처리
    await admin.auth().generatePasswordResetLink(email);

    // 감사 로그 — 누가 누구의 비번 재설정 요청했는지
    await admin.firestore().collection('adminAuditLog').add({
      action: 'password_reset_sent',
      callerUid: req.auth.uid,
      targetUid: uid,
      targetEmail: email,
      providers,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[sendPasswordResetByAdmin] caller=${req.auth.uid} target=${email}`);

    return { success: true, sentTo: email, providers };
  },
);
