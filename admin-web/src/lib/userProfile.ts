'use client';

/**
 * 사용자 프로필 — 전화번호 등록·중복 방지 API.
 *
 * 정책:
 * - phoneIndex/{normalized} 컬렉션을 단일 진실 원천(SoT)으로 사용.
 *   doc id가 정규화된 전화번호 → 중복은 Firestore 인덱스 unique 효과.
 * - 본인 번호 재등록은 idempotent (같은 uid면 통과).
 * - 트랜잭션으로 중복 검사 + 이전 번호 정리 + 새 번호 등록 원자화.
 */

import {
  doc,
  getDoc,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import { normalizePhone } from './phone';

/**
 * 전화번호 중복 검사. 이미 다른 uid가 같은 번호를 등록했으면 false.
 * 본인이 이미 같은 번호를 등록한 경우는 true (통과).
 * 정규화 실패 시 throw.
 */
export async function checkPhoneAvailable(phone: string, currentUid: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('유효하지 않은 전화번호 형식입니다');
  const snap = await getDoc(doc(db, 'phoneIndex', normalized));
  if (!snap.exists()) return true;
  const data = snap.data() as { uid?: string };
  return data.uid === currentUid;  // 본인 번호면 OK
}

/**
 * 사용자 전화번호 등록·변경.
 * 1. phone 정규화
 * 2. 다른 uid가 같은 번호 사용 중이면 throw
 * 3. 이전 번호의 phoneIndex doc 삭제 (있으면)
 * 4. phoneIndex/{normalizedPhone} = { uid, updatedAt } 생성
 * 5. users/{uid}.phone = normalized
 */
export async function setUserPhone(uid: string, phoneRaw: string): Promise<void> {
  const normalized = normalizePhone(phoneRaw);
  if (!normalized) throw new Error('유효하지 않은 전화번호 형식입니다 (예: 010-1234-5678)');

  // 차단 체크 — 강제 탈퇴(영구)/본인 탈퇴(쿨다운) 번호는 재등록 불가.
  // 모든 가입(이메일·OAuth)이 거치는 단일 choke point라 여기서 phone 차단을 보장한다.
  try {
    const banSnap = await getDoc(doc(db, 'bannedContacts', normalized));
    if (banSnap.exists()) {
      const exp = (banSnap.data() as { expiresAt?: { toMillis?: () => number; toDate?: () => Date } | null }).expiresAt;
      if (!exp) {
        throw new Error('이용이 제한된 번호입니다. 본사에 문의해 주세요.');
      }
      const ms = typeof exp.toMillis === 'function' ? exp.toMillis() : 0;
      if (ms > Date.now()) {
        const d = exp.toDate ? exp.toDate() : new Date(ms);
        const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
        throw new Error(`탈퇴 후 재가입은 ${dateStr} 이후 가능합니다.`);
      }
    }
  } catch (e) {
    // 차단으로 인한 throw는 그대로 전파, 단순 조회 실패는 무시(가용성 우선)
    if (e instanceof Error && (e.message.includes('제한된') || e.message.includes('재가입은'))) throw e;
  }

  // 트랜잭션: 중복 검사 + 이전 번호 정리 + 새 번호 등록 + users doc 업데이트
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    const userSnap = await tx.get(userRef);
    const oldPhone = userSnap.data()?.phone as string | undefined;

    // 새 번호의 중복 검사
    const newIndexRef = doc(db, 'phoneIndex', normalized);
    const newIndexSnap = await tx.get(newIndexRef);
    if (newIndexSnap.exists()) {
      const data = newIndexSnap.data() as { uid?: string };
      if (data.uid !== uid) {
        throw new Error('이미 다른 계정에 등록된 전화번호입니다');
      }
    }

    // 이전 번호 정리 (있고, 새 번호와 다를 때만)
    if (oldPhone && oldPhone !== normalized) {
      const oldIndexRef = doc(db, 'phoneIndex', oldPhone);
      tx.delete(oldIndexRef);
    }

    // 새 번호 등록 + users doc 업데이트
    tx.set(newIndexRef, { uid, updatedAt: serverTimestamp() });
    tx.set(userRef, { phone: normalized, phoneUpdatedAt: serverTimestamp() }, { merge: true });
  });
}
