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
} from 'firebase/auth';
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  collection,
  addDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { stripUndefined } from './firestoreUtil';
import { setUserPhone } from './userProfile';
import { normalizePhone } from './phone';

// =====================================================================
// 타입 정의
// =====================================================================

export interface StoreSignupPayload {
  // Step 1 — 계정
  email: string;
  password: string;
  passwordHint: string;
  recoveryLast4: string; // 보조 복구 연락처 마지막 4자리

  // Step 2 — 매장 기본 (사업자등록증 대신 매장 간판 사진으로 실존 확인)
  storeName: string;
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
// 매장 자체 가입
// =====================================================================

export async function signupAsStore(payload: StoreSignupPayload): Promise<string> {
  // 1. Firebase Auth 계정 생성
  const credential = await createUserWithEmailAndPassword(
    auth,
    payload.email.trim().toLowerCase(),
    payload.password,
  );
  const uid = credential.user.uid;

  // 2. storeId 미리 확보 (Storage 경로에 사용)
  const newStoreRef = doc(collection(db, 'stores'));
  const storeId = newStoreRef.id;

  // 3. 매장 간판 사진 Storage 업로드 — 본사 심사 시 매장 실존 확인용
  const file = payload.signageImageFile;
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `stores/${storeId}/photos/signage.${ext}`;
  await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
  const signageImageUrl = await getDownloadURL(storageRef(storage, path));

  // 합본 주소 (기존 address 필드 하위 호환)
  const combinedAddress = [payload.roadAddress.trim(), payload.detailAddress.trim()]
    .filter(Boolean)
    .join(' ');

  // 4. stores/{storeId} 문서 생성 (photoUrls 첫번째에 간판 사진 URL 포함)
  await setDoc(newStoreRef, stripUndefined({
    ownerUid: uid,
    name: payload.storeName.trim(),
    address: combinedAddress,           // 기존 호환 필드
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
  //    signup 흐름 자체가 실패해 사용자에게 알림이 전달된다.
  if (normalizePhone(payload.representativePhone)) {
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
}

// =====================================================================
// 대회사 자체 가입
// =====================================================================

export async function signupAsOrganizer(payload: OrganizerSignupPayload): Promise<string> {
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
