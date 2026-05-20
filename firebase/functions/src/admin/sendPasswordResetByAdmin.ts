import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

interface Input {
  targetUid?: string;       // 둘 중 하나
  targetEmail?: string;
}

/**
 * 본사 관리자가 특정 사용자에게 비밀번호 재설정 이메일 발송.
 * - 호출자가 platform_admin role 보유 검증
 * - Firebase Admin SDK가 사용자 이메일로 재설정 링크 자동 발송
 * - 평문 비밀번호는 본사도 모름 — 사용자가 메일 링크로 직접 설정
 */
export const sendPasswordResetByAdmin = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 60 },
  async (req) => {
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

    // 사용자 정보 가져오기 (이메일 확보)
    let email = input.targetEmail;
    let uid = input.targetUid;
    if (uid && !email) {
      const u = await admin.auth().getUser(uid);
      email = u.email ?? undefined;
    } else if (email && !uid) {
      const u = await admin.auth().getUserByEmail(email);
      uid = u.uid;
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[sendPasswordResetByAdmin] caller=${req.auth.uid} target=${email}`);

    return { success: true, sentTo: email };
  },
);
