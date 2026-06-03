/**
 * 차단(banlist) 공용 헬퍼 — 강제 탈퇴(영구) / 본인 탈퇴(쿨다운) 공용.
 *
 * 데이터 모델:
 *  - banlist/{uid}          : 본사 관리·조회용 1인 1문서.
 *      { uid, phone, email, displayName, type, reason, bannedBy, createdAt, expiresAt }
 *  - bannedContacts/{key}   : 가입 시 O(1) 조회용 lookup. key = 정규화 전화번호 또는 소문자 이메일.
 *      { type, expiresAt, uid }
 *
 * type:
 *  - 'force_delete'    : 본사 강제 탈퇴 → 영구 차단 (expiresAt = null)
 *  - 'self_withdrawal' : 본인 탈퇴 → 쿨다운 (expiresAt = 탈퇴 + COOLDOWN_MONTHS)
 *
 * 가입 차단 판정(클라이언트/서버 공통): 문서 존재 AND (expiresAt == null || expiresAt > now)
 */
import * as admin from 'firebase-admin';

export const COOLDOWN_MONTHS = 3;

export type BanType = 'force_delete' | 'self_withdrawal';

export interface WriteBanInput {
  uid: string;
  phone?: string | null; // 정규화된 전화번호(010XXXXXXXX) 권장
  email?: string | null;
  displayName?: string | null;
  type: BanType;
  reason?: string | null;
  bannedBy: string; // 강제탈퇴=관리자 uid, 본인탈퇴='self'
}

/** 쿨다운 만료 시각 계산 (self_withdrawal). force_delete는 null(영구). */
export function computeExpiresAt(type: BanType): admin.firestore.Timestamp | null {
  if (type === 'force_delete') return null;
  const d = new Date();
  d.setMonth(d.getMonth() + COOLDOWN_MONTHS);
  return admin.firestore.Timestamp.fromDate(d);
}

/**
 * 차단 기록을 banlist + bannedContacts에 기록한다.
 * 탈퇴 처리(문서/Auth 삭제) 전에 호출해야 phone/email을 확보할 수 있다.
 */
export async function writeBan(
  fs: admin.firestore.Firestore,
  input: WriteBanInput,
): Promise<void> {
  const expiresAt = computeExpiresAt(input.type);
  const email = input.email ? input.email.trim().toLowerCase() : null;
  const phone = input.phone ? input.phone.trim() : null;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const batch = fs.batch();

  batch.set(fs.collection('banlist').doc(input.uid), {
    uid: input.uid,
    phone,
    email,
    displayName: input.displayName ?? null,
    type: input.type,
    reason: input.reason ?? null,
    bannedBy: input.bannedBy,
    createdAt: now,
    expiresAt, // null=영구
  });

  const contact = { type: input.type, expiresAt, uid: input.uid, updatedAt: now };
  if (phone) batch.set(fs.collection('bannedContacts').doc(phone), contact);
  if (email) batch.set(fs.collection('bannedContacts').doc(email), contact);

  await batch.commit();
}

/**
 * 차단 해제 — banlist/{uid} + 연결된 bannedContacts(phone/email) 삭제.
 * banlist 문서에서 phone/email을 읽어 lookup까지 함께 제거한다.
 */
export async function liftBan(
  fs: admin.firestore.Firestore,
  uid: string,
): Promise<{ phone: string | null; email: string | null }> {
  const ref = fs.collection('banlist').doc(uid);
  const snap = await ref.get();
  const data = snap.data() as { phone?: string | null; email?: string | null } | undefined;
  const phone = data?.phone ?? null;
  const email = data?.email ?? null;

  const batch = fs.batch();
  batch.delete(ref);
  if (phone) batch.delete(fs.collection('bannedContacts').doc(phone));
  if (email) batch.delete(fs.collection('bannedContacts').doc(email));
  await batch.commit();

  return { phone, email };
}
