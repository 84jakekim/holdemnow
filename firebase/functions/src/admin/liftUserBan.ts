import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { liftBan } from '../account/_ban';

interface Input {
  uid?: string;
  reason?: string;
}

export interface LiftUserBanResult {
  success: boolean;
}

/**
 * 본사 관리자가 차단(banlist)을 해제 — 해당 uid의 banlist 문서 + 연결된 bannedContacts(phone/email) 삭제.
 * 강제 탈퇴(영구)·본인 탈퇴(쿨다운) 모두 해제 가능 → 동일 번호/이메일 재가입 다시 허용.
 * - platform_admin 권한 검증.
 * - 감사 로그(adminAuditLog) 기록.
 */
export const liftUserBan = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 30 },
  async (req): Promise<LiftUserBanResult> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'login required');

    const callerSnap = await admin.firestore().collection('users').doc(req.auth.uid).get();
    const callerData = callerSnap.data() as { role?: string; roles?: string[] } | undefined;
    const isAdmin = callerData?.role === 'platform_admin' || callerData?.roles?.includes('platform_admin');
    if (!isAdmin) throw new HttpsError('permission-denied', 'platform_admin only');

    const input = (req.data ?? {}) as Input;
    const uid = input.uid;
    if (!uid) throw new HttpsError('invalid-argument', 'uid required');

    const { phone, email } = await liftBan(admin.firestore(), uid);

    await admin.firestore().collection('adminAuditLog').add({
      action: 'lift_user_ban',
      callerUid: req.auth.uid,
      targetUid: uid,
      targetPhone: phone,
      targetEmail: email,
      reason: input.reason ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[liftUserBan] caller=${req.auth.uid} target=${uid} phone=${phone ?? '-'} email=${email ?? '-'}`);

    return { success: true };
  },
);
