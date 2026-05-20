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
