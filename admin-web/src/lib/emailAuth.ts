'use client';

/**
 * Email/Password 가입·로그인·복구 유틸
 *
 * Firebase Auth Email/Password provider 활성화 필요:
 * Firebase Console → Authentication → Sign-in method → Email/Password → 사용 설정
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
} from 'firebase/auth';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { app } from './firebase';
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  addDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { stripUndefined } from './firestoreUtil';
import { setUserPhone } from './userProfile';
import { normalizePhone } from './phone';
import { regionCodeFromAddress } from './geo';
import { compressImageForUpload } from './imageCompress';

// =====================================================================
// 타입 정의
// =====================================================================

export interface StoreSignupPayload {
  // Step 1 — 계정
  email: string;
  password: string;
  passwordHint: string;
  recoveryLast4: string; // 보조 복구 연락처 마지막 4자리

  // Step 2 — 매장 기본 (간판 사진 + 사업자등록번호로 실존·합법 확인)
  storeName: string;
  /** 사업자등록번호 (XXX-XX-XXXXX) — 불법 사설업체 필터링용 본사 심사 핵심 항목. 필수. */
  businessRegistrationNumber: string;
  /** @deprecated storeAddress 제거 — roadAddress + detailAddress 합본 사용. 기존 호환을 위해 optional 유지 */
  storeAddress?: string;
  roadAddress: string;    // 도로명 주소 (다음 우편번호 선택 결과)
  detailAddress: string;  // 상세 주소 (층/호수, 수기 입력)
  jibunAddress: string;   // 지번 주소
  zonecode: string;       // 우편번호
  storeHours: string;
  storeDescription: string;
  storePhone: string;
  signageImageFile: File; // 매장 간판 사진 — 본사 심사 시 매장 실존 확인용

  // Step 3 — 대표자
  representativeName: string;
  representativePhone: string;

  // Step 4 — 약관
  agreeService: boolean;
  agreePrivacy: boolean;
  agreeMarketing: boolean;
}

export interface OrganizerSignupPayload {
  // Step 1 — 계정
  email: string;
  password: string;
  passwordHint: string;
  recoveryLast4: string;

  // Step 2 — 회사 정보
  companyName: string;
  businessRegistrationNumber: string;
  representativeName: string;
  representativePhone: string;
  companyAddress: string;

  // Step 3 — 담당자
  contactPersonName: string;
  contactPersonPosition?: string;
  contactPersonPhone: string;
  contactPersonEmail?: string;

  // Step 4 — 레퍼런스 + 약관
  tournamentReferences: string;
  agreeService: boolean;
  agreePrivacy: boolean;
  agreeMarketing: boolean;
}

// =====================================================================
// 비밀번호 유효성 검사
// =====================================================================

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return '비밀번호는 8자 이상이어야 합니다';
  if (!/[a-zA-Z]/.test(pw)) return '영문자를 포함해야 합니다';
  if (!/[0-9]/.test(pw)) return '숫자를 포함해야 합니다';
  return null;
}

export function validateBusinessReg(brn: string): boolean {
  // XXX-XX-XXXXX 형식 검사
  return /^\d{3}-\d{2}-\d{5}$/.test(brn);
}

export function formatBusinessReg(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

// =====================================================================
// 차단(banlist) 체크 — 가입 직전 호출
// =====================================================================

/**
 * 강제 탈퇴(영구) / 본인 탈퇴(쿨다운) 차단 여부를 bannedContacts에서 조회.
 * 차단 중이면 throw → Auth 계정 생성 전에 가입을 막는다.
 * - 영구(expiresAt 없음): "이용 제한" 안내
 * - 쿨다운(expiresAt 미래): 재가입 가능일 안내
 * - 만료된 쿨다운(expiresAt 과거): 통과
 */
export async function assertNotBanned(input: { email?: string; phone?: string }): Promise<void> {
  const keys: string[] = [];
  const normPhone = normalizePhone(input.phone);
  if (normPhone) keys.push(normPhone);
  const email = input.email?.trim().toLowerCase();
  if (email) keys.push(email);
  if (keys.length === 0) return;

  for (const key of keys) {
    let snap;
    try {
      snap = await getDoc(doc(db, 'bannedContacts', key));
    } catch {
      continue; // 조회 실패는 가입을 막지 않음(가용성 우선)
    }
    if (!snap.exists()) continue;
    const data = snap.data() as { expiresAt?: { toMillis?: () => number; toDate?: () => Date } | null };
    const exp = data.expiresAt;
    // 영구(null) → 항상 차단
    if (!exp) {
      throw new Error('이용이 제한된 계정입니다. 본사에 문의해 주세요.');
    }
    // 쿨다운 — 만료 전이면 차단
    const ms = typeof exp.toMillis === 'function' ? exp.toMillis() : 0;
    if (ms > Date.now()) {
      const d = exp.toDate ? exp.toDate() : new Date(ms);
      const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
      throw new Error(`탈퇴 후 재가입은 ${dateStr} 이후 가능합니다.`);
    }
  }
}

// =====================================================================
// 매장 자체 가입
// =====================================================================

export async function signupAsStore(payload: StoreSignupPayload): Promise<string> {
  // 0. 차단 체크 (Auth 계정 생성 전)
  await assertNotBanned({ email: payload.email, phone: payload.representativePhone });

  // 1. Firebase Auth 계정 생성
  const credential = await createUserWithEmailAndPassword(
    auth,
    payload.email.trim().toLowerCase(),
    payload.password,
  );
  const uid = credential.user.uid;
  const normalizedPhone = normalizePhone(payload.representativePhone);

  // 1.5. 전화번호 선체크 (부분 실패 방지) — 매장/사진/유저 doc 생성 *전에* 중복이면 즉시 중단.
  //      이미 등록된 번호면 방금 만든 Auth 계정까지 삭제해 orphan을 남기지 않는다.
  //      (선체크~최종 등록 사이의 미세 경합은 하단 setUserPhone 트랜잭션이 최종 가드)
  if (normalizedPhone) {
    let phoneTaken = false;
    try {
      const idxSnap = await getDoc(doc(db, 'phoneIndex', normalizedPhone));
      phoneTaken = idxSnap.exists() && (idxSnap.data() as { uid?: string }).uid !== uid;
    } catch {
      // phoneIndex 읽기 실패는 무시 — setUserPhone 트랜잭션이 어차피 가드함
    }
    if (phoneTaken) {
      await deleteUser(credential.user).catch(() => {});
      throw new Error('이미 다른 계정에 등록된 전화번호입니다');
    }
  }

  // 2. storeId 미리 확보 (Storage 경로에 사용)
  const newStoreRef = doc(collection(db, 'stores'));
  const storeId = newStoreRef.id;

  // 부분 실패 롤백 래퍼 — 아래 단계 중 하나라도 실패하면 생성된 매장/유저/번호/Auth를 정리해
  // 고아(orphan) 데이터를 남기지 않는다. (동시 가입이 몰려도 각 가입이 독립적으로 깔끔히 정리됨)
  try {
  // 3. 매장 간판 사진 — 업로드 직전 압축(보통 <1MB). 디코드 실패 시 원본 폴백.
  //    압축을 여기서 하므로 미리보기는 원본을 그대로 써서 엑박스가 발생하지 않는다.
  const file = await compressImageForUpload(payload.signageImageFile);
  // Storage 규칙(5MB) 보호 — 압축 실패 + 원본 초과 시 명확히 안내하고 중단(롤백).
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('사진 용량이 커서 업로드할 수 없습니다. 더 작은 사진(JPG 권장)으로 다시 시도해 주세요.');
  }
  const ext = file.type === 'image/jpeg'
    ? 'jpg'
    : ((file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg');
  const path = `stores/${storeId}/photos/signage.${ext}`;
  await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
  const signageImageUrl = await getDownloadURL(storageRef(storage, path));

  // 합본 주소 (기존 address 필드 하위 호환)
  const combinedAddress = [payload.roadAddress.trim(), payload.detailAddress.trim()]
    .filter(Boolean)
    .join(' ');
  // regionCode 자동 산출 — `where regionCode in […]` 필터 + 광고 슬롯 분배용.
  // 도로명 주소 우선, 없으면 지번 주소, 그래도 없으면 합본.
  // ⚠️ 정적 import 사용 — 과거 동적 import('./geo')는 배포 직후 옛 빌드 페이지에서
  //    제출 시 사라진 청크를 fetch하려다 "신청 중"에서 멈추는 hang을 유발했음.
  const regionCode = regionCodeFromAddress(
    payload.roadAddress.trim() || payload.jibunAddress.trim() || combinedAddress,
  );

  // 4. stores/{storeId} 문서 생성 (photoUrls 첫번째에 간판 사진 URL 포함)
  await setDoc(newStoreRef, stripUndefined({
    ownerUid: uid,
    name: payload.storeName.trim(),
    businessRegistrationNumber: payload.businessRegistrationNumber.trim(), // 본사 심사 — 불법 사설업체 필터
    address: combinedAddress,           // 기존 호환 필드
    regionCode,                          // 광역 단위 한글 키 ("부산"/"경남" 등) — Phase B
    roadAddress: payload.roadAddress.trim(),
    detailAddress: payload.detailAddress.trim(),
    jibunAddress: payload.jibunAddress.trim(),
    zonecode: payload.zonecode.trim(),
    phone: payload.storePhone.trim(),
    hours: payload.storeHours.trim(),
    description: payload.storeDescription.trim(),
    representativeName: payload.representativeName.trim(),
    representativePhone: payload.representativePhone.trim(),
    signageImageUrl,
    photoUrls: [signageImageUrl],
    status: 'pending',
    tier: 'free',
    reviewCount: 0,
    liveSessionCount: 0,
    signupApplication: {
      submittedAt: new Date().toISOString(),
      agreeService: payload.agreeService,
      agreePrivacy: payload.agreePrivacy,
      agreeMarketing: payload.agreeMarketing,
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  const storeRef = newStoreRef;

  // 3. users/{uid} 문서 생성
  //   - 매장 가입자는 대표자명/대표 연락처를 이미 필수 입력했으므로
  //     realName/phone에 자동 매핑하고 KYC를 즉시 완료 처리 (AuthGate가 /onboarding/kyc로
  //     잘못 가로채지 않도록 함). signupSource='store-signup' 이면 별도 KYC 절차 불필요.
  //   - phone은 setUserPhone에서 phoneIndex와 함께 트랜잭션으로 등록 (아래).
  await setDoc(doc(db, 'users', uid), stripUndefined({
    uid,
    email: payload.email.trim().toLowerCase(),
    storeId: storeRef.id,
    role: 'store_master',
    roles: ['store_master'],
    providers: ['password'],
    signupSource: 'store-signup',
    signupAt: serverTimestamp(),
    status: 'active',
    passwordHint: payload.passwordHint.trim(),
    recoveryLast4: payload.recoveryLast4.trim().slice(-4),
    realName: payload.representativeName.trim(),
    kycCompletedAt: serverTimestamp(),
    kycSource: 'signup',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  // 4. 대표자 연락처를 phoneIndex에 등록 — 1인 1번호 정책.
  //    정규화 가능한 경우만 시도하고, 중복(다른 계정 사용)이면 throw하므로
  //    signup 흐름 자체가 실패해 사용자에게 알림이 전달된다. (최종 원자적 가드)
  if (normalizedPhone) {
    await setUserPhone(uid, payload.representativePhone);
  }

  // 5. passwordRecovery/{email} 문서 생성 (비밀번호 분실 시 빠른 조회용)
  await setDoc(doc(db, 'passwordRecovery', payload.email.trim().toLowerCase()), stripUndefined({
    uid,
    passwordHint: payload.passwordHint.trim(),
    recoveryLast4: payload.recoveryLast4.trim().slice(-4),
    createdAt: serverTimestamp(),
  }));

  return storeRef.id;
  } catch (err) {
    // 부분 실패 롤백 — Firestore 먼저(권한 보존), Auth 마지막. 모두 best-effort.
    try { await deleteDoc(newStoreRef); } catch { /* noop */ }
    try { await deleteDoc(doc(db, 'users', uid)); } catch { /* noop */ }
    if (normalizedPhone) {
      try { await deleteDoc(doc(db, 'phoneIndex', normalizedPhone)); } catch { /* noop */ }
    }
    try { await deleteUser(credential.user); } catch { /* noop */ }
    throw err;
  }
}

// =====================================================================
// 대회사 자체 가입
// =====================================================================

export async function signupAsOrganizer(payload: OrganizerSignupPayload): Promise<string> {
  // 0. 차단 체크 (Auth 계정 생성 전) — 등록 번호는 contactPersonPhone 우선
  await assertNotBanned({
    email: payload.email,
    phone: payload.contactPersonPhone || payload.representativePhone,
  });

  const credential = await createUserWithEmailAndPassword(
    auth,
    payload.email.trim().toLowerCase(),
    payload.password,
  );
  const uid = credential.user.uid;

  const orgRef = await addDoc(collection(db, 'organizers'), stripUndefined({
    ownerUid: uid,
    companyName: payload.companyName.trim(),
    name: payload.companyName.trim(), // 기존 name 필드 호환
    businessRegistrationNumber: payload.businessRegistrationNumber.trim(),
    representativeName: payload.representativeName.trim(),
    representativePhone: payload.representativePhone.trim(),
    companyAddress: payload.companyAddress.trim(),
    contactPerson: {
      name: payload.contactPersonName.trim(),
      position: payload.contactPersonPosition?.trim() || null,
      phone: payload.contactPersonPhone.trim(),
      email: payload.contactPersonEmail?.trim() || null,
    },
    tournamentReferences: payload.tournamentReferences.trim(),
    tagline: payload.companyName.trim(), // 기존 tagline 필드 호환
    contactEmail: payload.contactPersonEmail?.trim() || null,
    status: 'pending',
    signupApplication: {
      submittedAt: new Date().toISOString(),
      agreeService: payload.agreeService,
      agreePrivacy: payload.agreePrivacy,
      agreeMarketing: payload.agreeMarketing,
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  // 대회사 가입자도 담당자/대표자 정보를 이미 필수 입력 → realName/phone 자동 매핑 + KYC 즉시 완료
  // phone은 아래 setUserPhone으로 phoneIndex와 함께 트랜잭션 등록.
  const organizerPhone = payload.contactPersonPhone.trim() || payload.representativePhone.trim();
  await setDoc(doc(db, 'users', uid), stripUndefined({
    uid,
    email: payload.email.trim().toLowerCase(),
    organizerId: orgRef.id,
    role: 'organizer_master',
    roles: ['organizer_master'],
    providers: ['password'],
    signupSource: 'organizer-signup',
    signupAt: serverTimestamp(),
    status: 'active',
    realName: payload.contactPersonName.trim() || payload.representativeName.trim(),
    kycCompletedAt: serverTimestamp(),
    kycSource: 'signup',
    passwordHint: payload.passwordHint.trim(),
    recoveryLast4: payload.recoveryLast4.trim().slice(-4),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  // 담당자/대표자 연락처를 phoneIndex에 등록 — 1인 1번호 정책.
  if (normalizePhone(organizerPhone)) {
    await setUserPhone(uid, organizerPhone);
  }

  await setDoc(doc(db, 'passwordRecovery', payload.email.trim().toLowerCase()), stripUndefined({
    uid,
    passwordHint: payload.passwordHint.trim(),
    recoveryLast4: payload.recoveryLast4.trim().slice(-4),
    createdAt: serverTimestamp(),
  }));

  return orgRef.id;
}

// =====================================================================
// 플레이어 자체 가입
// =====================================================================

export interface PlayerSignupPayload {
  email: string;
  password: string;
  nickname: string;
  realName: string;   // 필수 — 본인 확인용 실명
  phone: string;      // 필수 — 010-XXXX-XXXX 형식
  passwordHint?: string;
  agreeService: boolean;
  agreePrivacy: boolean;
  agreeMarketing: boolean;
}

export async function signupAsPlayer(payload: PlayerSignupPayload): Promise<void> {
  // 0) 차단 체크 (Auth 계정 생성 전)
  await assertNotBanned({ email: payload.email, phone: payload.phone });

  // 1) Firebase Auth 계정 생성
  const credential = await createUserWithEmailAndPassword(
    auth,
    payload.email.trim().toLowerCase(),
    payload.password,
  );
  const uid = credential.user.uid;
  const email = payload.email.trim().toLowerCase();

  // 2) users/{uid} 문서 생성
  //    phone은 아래 setUserPhone으로 phoneIndex와 함께 트랜잭션 등록.
  await setDoc(doc(db, 'users', uid), stripUndefined({
    uid,
    email,
    role: 'player',
    roles: ['player'],
    providers: ['password'],
    signupSource: 'player-signup',
    status: 'active',
    displayName: payload.nickname.trim(),
    nickname: payload.nickname.trim(),
    realName: payload.realName.trim(),
    kycCompletedAt: serverTimestamp(),
    kycSource: 'signup',
    ...(payload.passwordHint?.trim() ? { passwordHint: payload.passwordHint.trim() } : {}),
    agreeMarketing: payload.agreeMarketing,
    signupAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  // 플레이어 전화번호 — phoneIndex 트랜잭션으로 1인 1번호 정책 적용.
  if (normalizePhone(payload.phone)) {
    await setUserPhone(uid, payload.phone);
  }

  // 3) 힌트가 있을 때만 passwordRecovery/{email} 문서 생성
  if (payload.passwordHint?.trim()) {
    await setDoc(doc(db, 'passwordRecovery', email), stripUndefined({
      uid,
      passwordHint: payload.passwordHint.trim(),
      createdAt: serverTimestamp(),
    }));
  }
}

// =====================================================================
// 이메일/비밀번호 로그인
// =====================================================================

export async function loginWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
}

// =====================================================================
// 역할 게이팅 로그인 (2026-05-22 신설)
//
// 사장님 요구: 매장 어드민 이메일이 일반 /login에서 로그인되면 안 됨,
// 일반 사용자 이메일이 /login/business에서 로그인되면 안 됨.
// 단순히 wrongRole 안내 카드만 띄우는 게 아니라 로그인 자체를 차단 + signOut.
//
// 동작:
//  1) Firebase Auth 로그인 시도
//  2) users/{uid} 1회 fetch → 역할 판정
//  3) expectedKind와 다르면 즉시 signOut + 'wrong-role' 에러 throw
//     (메시지에 실제 역할이 담겨 호출부에서 안내 분기)
// =====================================================================

export type LoginExpectedKind = 'player' | 'business' | 'platform_admin';

export class WrongRoleError extends Error {
  /** 실제 계정 유형 */
  readonly actualKind: 'platform_admin' | 'store' | 'organizer' | 'player';
  constructor(actualKind: WrongRoleError['actualKind']) {
    super(`wrong-role:${actualKind}`);
    this.name = 'WrongRoleError';
    this.actualKind = actualKind;
  }
}

export async function loginWithEmailExpecting(
  email: string,
  password: string,
  expected: LoginExpectedKind,
): Promise<void> {
  const credential = await signInWithEmailAndPassword(
    auth,
    email.trim().toLowerCase(),
    password,
  );
  const uid = credential.user.uid;

  // users/{uid} 1회 fetch — onSnapshot 대기 없이 즉시 판정
  let snap;
  try {
    snap = await getDoc(doc(db, 'users', uid));
  } catch {
    // 문서 조회 실패 — 보수적으로 signOut 후 일반 에러
    try { await auth.signOut(); } catch {}
    throw new Error('계정 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
  const data = snap.exists() ? (snap.data() as { storeId?: string; organizerId?: string; role?: string; roles?: string[] }) : null;

  // 역할 판정 — AuthGate.classifyAccount와 동일 규칙
  const roles = data?.roles ?? [];
  const role = data?.role;
  const isPlatformAdmin = roles.includes('platform_admin') || role === 'platform_admin';

  let actualKind: WrongRoleError['actualKind'];
  if (isPlatformAdmin) actualKind = 'platform_admin';
  else if (data?.storeId) actualKind = 'store';
  else if (data?.organizerId) actualKind = 'organizer';
  else actualKind = 'player';

  const ok =
    (expected === 'player' && actualKind === 'player') ||
    (expected === 'business' && (actualKind === 'store' || actualKind === 'organizer')) ||
    (expected === 'platform_admin' && actualKind === 'platform_admin');

  if (!ok) {
    // 역할 불일치 — 즉시 signOut → 호출부에서 "없는 계정" 메시지로 안내.
    try { await auth.signOut(); } catch {}
    throw new WrongRoleError(actualKind);
  }
}

// =====================================================================
// 비밀번호 분실 복구
// =====================================================================

export interface RecoveryCheckResult {
  success: boolean;
  hint?: string; // 가입 시 설정한 힌트 문구 (화면에 표시)
  uid?: string;
}

/**
 * 이메일로 passwordRecovery 문서 조회 → 힌트 반환
 * (힌트 답변과 4자리 검증은 클라이언트에서 수행)
 */
export async function fetchRecoveryInfo(email: string): Promise<{
  found: boolean;
  hint: string;
  recoveryLast4: string;
  uid: string;
} | null> {
  const key = email.trim().toLowerCase();
  const snap = await getDoc(doc(db, 'passwordRecovery', key));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    found: true,
    hint: d.passwordHint || '',
    recoveryLast4: d.recoveryLast4 || '',
    uid: d.uid || '',
  };
}

export async function sendPasswordReset(email: string) {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

// =====================================================================
// 회원 탈퇴 (본인)
// =====================================================================

export interface DeleteOwnAccountResult {
  success: boolean;
  closedStoreId?: string;
  closedOrganizerId?: string;
}

/**
 * 본인 회원 탈퇴. Cloud Function이 Firestore 정리 + 매장/대회사 폐업 처리 +
 * Firebase Auth 계정 삭제를 한 번에 수행한다.
 *
 * 이메일/비밀번호 계정은 보안상 최근 로그인 검증(재인증)이 필요할 수 있어,
 * currentPassword가 주어지면 호출 전에 재인증을 시도한다 (실패해도 함수는 진행 가능하나
 * Auth deleteUser 단계에서 requires-recent-login이 날 수 있으므로 권장).
 */
export async function deleteOwnAccount(currentPassword?: string): Promise<DeleteOwnAccountResult> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인 상태가 아닙니다');

  // 이메일/비번 계정이고 비번을 받았으면 재인증 (recent-login 보강)
  if (currentPassword && user.email) {
    try {
      const cred = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, cred);
    } catch {
      throw new Error('현재 비밀번호가 올바르지 않습니다');
    }
  }

  const fn = httpsCallable<Record<string, never>, DeleteOwnAccountResult>(
    getFunctions(app, 'asia-northeast3'),
    'deleteOwnAccount',
  );
  const res = await fn({});

  // 서버에서 Auth 계정이 삭제됐으므로 로컬 세션도 정리
  try { await auth.signOut(); } catch { /* ignore */ }

  return res.data;
}

// =====================================================================
// 비밀번호 변경 (어드민 내부)
// =====================================================================

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error('로그인 상태가 아닙니다');

  // 재인증 (보안 요구)
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}

/**
 * 비밀번호 변경 후 passwordRecovery 동기화 (힌트/4자리 갱신 옵션)
 */
export async function syncPasswordRecovery(
  email: string,
  updates: { passwordHint?: string; recoveryLast4?: string },
) {
  const key = email.trim().toLowerCase();
  const snap = await getDoc(doc(db, 'passwordRecovery', key));
  if (!snap.exists()) return;

  await setDoc(
    doc(db, 'passwordRecovery', key),
    stripUndefined({
      ...updates,
      updatedAt: serverTimestamp(),
    }),
    { merge: true },
  );

  // users/{uid}도 동기화
  const uid = snap.data().uid;
  if (uid) {
    await setDoc(
      doc(db, 'users', uid),
      stripUndefined({
        ...(updates.passwordHint !== undefined ? { passwordHint: updates.passwordHint } : {}),
        ...(updates.recoveryLast4 !== undefined ? { recoveryLast4: updates.recoveryLast4 } : {}),
        updatedAt: serverTimestamp(),
      }),
      { merge: true },
    );
  }
}
