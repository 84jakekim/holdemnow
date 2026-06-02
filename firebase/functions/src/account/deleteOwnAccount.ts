import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export interface DeleteOwnAccountResult {
  success: boolean;
  /** 소유 매장/대회사가 있었으면 폐업(closed) 처리된 id */
  closedStoreId?: string;
  closedOrganizerId?: string;
}

/**
 * 본인 회원 탈퇴 — 일반 사용자 / 매장 어드민 / 대회사 어드민 공용.
 *
 * 동작:
 *  - 호출자 본인(req.auth.uid)만 자기 계정을 삭제 (대상 지정 불가).
 *  - users/{uid} 문서 + 하위 컬렉션(favorites/interests 등) recursiveDelete.
 *  - phoneIndex/{phone}, passwordRecovery/{email} 정리.
 *  - 매장/대회사 어드민이면 소유 매장·대회사는 삭제하지 않고 status='closed'로 전환
 *    (리뷰·LIVE 기록 등 연관 데이터 보존 + 노출만 중단). ownerUid는 보존하되
 *    closedByWithdrawal 플래그로 탈퇴에 의한 폐업임을 표시.
 *  - 마지막으로 Firebase Auth 계정 삭제 → 즉시 로그인 불가.
 *
 * 평문 비밀번호 등 민감정보는 다루지 않음.
 */
export const deleteOwnAccount = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 120 },
  async (req): Promise<DeleteOwnAccountResult> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'login required');
    const uid = req.auth.uid;
    const fs = admin.firestore();

    const userRef = fs.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const data = userSnap.data() as
      | { email?: string; phone?: string; storeId?: string; organizerId?: string }
      | undefined;

    const email = data?.email ?? null;
    const phone = data?.phone ?? null;
    const storeId = data?.storeId ?? null;
    const organizerId = data?.organizerId ?? null;

    const result: DeleteOwnAccountResult = { success: true };

    // 1) 매장/대회사 폐업 처리 (삭제 X — 데이터 보존)
    if (storeId) {
      try {
        await fs.collection('stores').doc(storeId).set(
          {
            status: 'closed',
            closedByWithdrawal: true,
            closedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        result.closedStoreId = storeId;
      } catch (e) {
        console.error(`[deleteOwnAccount] failed to close store ${storeId}:`, e);
      }
    }
    if (organizerId) {
      try {
        await fs.collection('organizers').doc(organizerId).set(
          {
            status: 'closed',
            closedByWithdrawal: true,
            closedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        result.closedOrganizerId = organizerId;
      } catch (e) {
        console.error(`[deleteOwnAccount] failed to close organizer ${organizerId}:`, e);
      }
    }

    // 2) phoneIndex 정리 (본인 소유일 때만)
    if (phone) {
      try {
        const idxRef = fs.collection('phoneIndex').doc(phone);
        const idxSnap = await idxRef.get();
        if (idxSnap.exists && (idxSnap.data() as { uid?: string }).uid === uid) {
          await idxRef.delete();
        }
      } catch (e) {
        console.error(`[deleteOwnAccount] failed to clean phoneIndex ${phone}:`, e);
      }
    }

    // 3) passwordRecovery 정리
    if (email) {
      try {
        await fs.collection('passwordRecovery').doc(email).delete();
      } catch (e) {
        console.error(`[deleteOwnAccount] failed to clean passwordRecovery ${email}:`, e);
      }
    }

    // 4) users/{uid} + 하위 컬렉션 정리
    try {
      await fs.recursiveDelete(userRef);
    } catch (e) {
      console.error(`[deleteOwnAccount] recursiveDelete users/${uid} failed:`, e);
      // 폴백 — 문서만이라도 삭제
      try { await userRef.delete(); } catch { /* ignore */ }
    }

    // 5) 감사 로그
    await fs.collection('adminAuditLog').add({
      action: 'account_self_deleted',
      callerUid: uid,
      targetUid: uid,
      targetEmail: email,
      closedStoreId: result.closedStoreId ?? null,
      closedOrganizerId: result.closedOrganizerId ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 6) Firebase Auth 계정 삭제 — 마지막에 실행 (앞 단계 실패 시 재시도 여지 남김)
    try {
      await admin.auth().deleteUser(uid);
    } catch (e) {
      console.error(`[deleteOwnAccount] auth deleteUser ${uid} failed:`, e);
      throw new HttpsError('internal', `계정 삭제 중 오류가 발생했습니다: ${(e as Error).message}`);
    }

    console.log(`[deleteOwnAccount] uid=${uid} email=${email ?? 'none'} done`);
    return result;
  },
);
