import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

interface Input {
  targetUid?: string;   // 둘 중 하나
  targetEmail?: string;
}

export interface SetTemporaryPasswordResult {
  success: boolean;
  /** 새로 발급된 임시 비밀번호 평문 — CS 담당자가 즉시 사용자에게 전달 */
  tempPassword: string;
  email: string | null;
  /** 로그인 아이디 (본사 어드민은 합성 이메일의 앞부분, 그 외는 이메일) */
  loginId: string | null;
  providers: string[];
}

/**
 * 임시 비밀번호 생성 — 영문 대/소문자 + 숫자 혼합 10자.
 * 혼동되는 문자(0/O, 1/l/I) 제외해 전화 안내 시 실수 방지.
 */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const all = upper + lower + digit;
  // 최소 1개씩 보장 후 나머지 랜덤
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  const chars = [pick(upper), pick(lower), pick(digit), pick(digit)];
  while (chars.length < 10) chars.push(pick(all));
  // Fisher-Yates 셔플
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * 본사 관리자가 특정 사용자(가입자/매장/대회사 어드민)에게 임시 비밀번호를 강제 발급.
 * - 평문 원본 비밀번호는 누구도 조회할 수 없으므로, 새 임시 비밀번호로 덮어쓴 뒤
 *   그 값을 호출자(본사 어드민)에게 반환해 CS로 즉시 안내할 수 있게 함.
 * - platform_admin 권한 검증.
 * - Admin SDK updateUser로 비밀번호 교체 — 다음 로그인부터 적용.
 * - 감사 로그에 누가 누구의 비밀번호를 재발급했는지 기록 (평문은 로그에 남기지 않음).
 */
export const setTemporaryPasswordByAdmin = onCall(
  { region: 'asia-northeast3', timeoutSeconds: 60 },
  async (req): Promise<SetTemporaryPasswordResult> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'login required');

    // platform_admin 검증
    const callerSnap = await admin.firestore().collection('users').doc(req.auth.uid).get();
    const callerData = callerSnap.data() as { role?: string; roles?: string[] } | undefined;
    const isAdmin = callerData?.role === 'platform_admin' || callerData?.roles?.includes('platform_admin');
    if (!isAdmin) throw new HttpsError('permission-denied', 'platform_admin only');

    const input = (req.data ?? {}) as Input;
    if (!input.targetUid && !input.targetEmail) {
      throw new HttpsError('invalid-argument', 'targetUid or targetEmail required');
    }

    // 대상 사용자 조회
    let targetUser: admin.auth.UserRecord;
    try {
      targetUser = input.targetUid
        ? await admin.auth().getUser(input.targetUid)
        : await admin.auth().getUserByEmail(input.targetEmail!);
    } catch (e) {
      throw new HttpsError('not-found', `user not found: ${(e as Error).message}`);
    }

    const uid = targetUser.uid;
    const email = targetUser.email ?? null;

    // providers — 카카오는 custom token이라 uid 접두사로 보조 판별
    const providers = targetUser.providerData.map((p) => p.providerId);
    const isKakao = uid.startsWith('kakao:');
    if (isKakao && !providers.includes('kakao')) providers.push('kakao');

    // 본사 어드민 합성 이메일(`{id}@admin.pinkrabbit.local`)이면 앞부분이 로그인 아이디
    const loginId = email
      ? email.endsWith('@admin.pinkrabbit.local')
        ? email.slice(0, -'@admin.pinkrabbit.local'.length)
        : email
      : null;

    // 임시 비밀번호 생성 + 적용
    const tempPassword = generateTempPassword();
    try {
      await admin.auth().updateUser(uid, { password: tempPassword });
    } catch (e) {
      throw new HttpsError('internal', `failed to set password: ${(e as Error).message}`);
    }

    // 감사 로그 — 평문 비밀번호는 절대 기록하지 않음
    await admin.firestore().collection('adminAuditLog').add({
      action: 'temp_password_issued',
      callerUid: req.auth.uid,
      targetUid: uid,
      targetEmail: email,
      providers,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[setTemporaryPasswordByAdmin] caller=${req.auth.uid} target=${uid} (${email ?? 'no-email'})`);

    return { success: true, tempPassword, email, loginId, providers };
  },
);
