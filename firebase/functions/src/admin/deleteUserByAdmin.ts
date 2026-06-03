import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { writeBan } from '../account/_ban';

interface Input {
  targetUid?: string;
  reason?: string;
}

export interface DeleteUserByAdminResult {
  success: boolean;
}

/**
 * 본사 관리자가 악성 사용자(불법 유도 등)를 강제 탈퇴.
 * - platform_admin 권한 검증.
 * - 안전장치: 자기 자신 삭제 금지 / 대상이 platform_admin이면 삭제 금지 (둘 다 failed-precondition).
 * - Firestore `users/{targetUid}` 문서 삭제 + Firebase Auth 계정 삭제.
 *   - 카카오 uid(`kakao:` 접두사)도 동일하게 deleteUser 가능.
 *   - Auth에 이미 없으면(user-not-found) 무시하고 진행.
 * - 감사 로그(adminAuditLog) 기록: 누가/언제/대상/사유.
 *
 * 주의: 연관 데이터(favorites, 하위 컬렉션, 작성 글/리뷰 등)까지의 캐스케이드 삭제는 이번 범위 밖.
 *       users 문서 + Auth 계정만 삭제한다. 추후 연관 데이터 정리(별도 cleanup 함수) 필요.
 */
export const deleteUserByAdmin = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 60 },
  async (req): Promise<DeleteUserByAdminResult> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'login required');

    // platform_admin 검증
    const callerSnap = await admin.firestore().collection('users').doc(req.auth.uid).get();
    const callerData = callerSnap.data() as { role?: string; roles?: string[] } | undefined;
    const isAdmin = callerData?.role === 'platform_admin' || callerData?.roles?.includes('platform_admin');
    if (!isAdmin) throw new HttpsError('permission-denied', 'platform_admin only');

    const input = (req.data ?? {}) as Input;
    const targetUid = input.targetUid;
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required');

    // 안전장치 ①: 자기 자신 삭제 금지
    if (req.auth.uid === targetUid) {
      throw new HttpsError('failed-precondition', 'cannot delete yourself');
    }

    // 안전장치 ②: 대상이 platform_admin이면 삭제 금지
    const targetSnap = await admin.firestore().collection('users').doc(targetUid).get();
    const targetData = targetSnap.data() as
      | { role?: string; roles?: string[]; email?: string; phone?: string; displayName?: string }
      | undefined;
    const targetIsAdmin = targetData?.role === 'platform_admin' || targetData?.roles?.includes('platform_admin');
    if (targetIsAdmin) {
      throw new HttpsError('failed-precondition', 'cannot delete a platform_admin user');
    }

    // 대상 이메일 확보 (감사 로그용) — Firestore 우선, 없으면 Auth에서 보조
    let targetEmail: string | null = targetData?.email ?? null;
    if (!targetEmail) {
      try {
        const authUser = await admin.auth().getUser(targetUid);
        targetEmail = authUser.email ?? null;
      } catch {
        // Auth에 없을 수 있음 — 무시
      }
    }

    const targetPhone = targetData?.phone ?? null; // users.phone은 정규화 저장(phoneIndex 키와 동일)
    const fs = admin.firestore();

    // ③ 영구 차단 기록 (banlist + bannedContacts) — 동일 번호/이메일 재가입 차단.
    //    문서 삭제 전에 확보한 phone/email로 기록.
    try {
      await writeBan(fs, {
        uid: targetUid,
        phone: targetPhone,
        email: targetEmail,
        displayName: targetData?.displayName ?? null,
        type: 'force_delete',
        reason: input.reason ?? null,
        bannedBy: req.auth.uid,
      });
    } catch (e) {
      console.error(`[deleteUserByAdmin] writeBan failed for ${targetUid}:`, e);
    }

    // ④ phoneIndex / passwordRecovery 정리 (orphan 제거 — 차단은 banlist가 담당)
    if (targetPhone) {
      try {
        const idxRef = fs.collection('phoneIndex').doc(targetPhone);
        const idxSnap = await idxRef.get();
        if (idxSnap.exists && (idxSnap.data() as { uid?: string }).uid === targetUid) {
          await idxRef.delete();
        }
      } catch (e) {
        console.error(`[deleteUserByAdmin] phoneIndex cleanup failed:`, e);
      }
    }
    if (targetEmail) {
      try {
        await fs.collection('passwordRecovery').doc(targetEmail).delete();
      } catch (e) {
        console.error(`[deleteUserByAdmin] passwordRecovery cleanup failed:`, e);
      }
    }

    // ⑤ Firestore users 문서 삭제 (없어도 delete는 에러 없이 성공)
    await fs.collection('users').doc(targetUid).delete();

    // ⑥ Firebase Auth 계정 삭제 — 이미 없으면(user-not-found) 무시
    try {
      await admin.auth().deleteUser(targetUid);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'auth/user-not-found') {
        throw new HttpsError('internal', `failed to delete auth user: ${(e as Error).message}`);
      }
    }

    // ⑦ 감사 로그
    await admin.firestore().collection('adminAuditLog').add({
      action: 'force_delete_user',
      callerUid: req.auth.uid,
      targetUid,
      targetEmail,
      reason: input.reason ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `[deleteUserByAdmin] caller=${req.auth.uid} target=${targetUid} (${targetEmail ?? 'no-email'}) reason=${input.reason ?? '-'}`,
    );

    return { success: true };
  },
);
