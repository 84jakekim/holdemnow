/**
 * Firestore 공통 유틸 — undefined sanitizer
 *
 * 배경:
 *   Firestore는 `undefined` 값을 허용하지 않는다 (only null or omit).
 *   optional 필드(`?:`)가 undefined로 spread되면 addDoc/setDoc/updateDoc 호출 시
 *   `'Unsupported field value: undefined'` 가 throw 되어 silent fail / "저장 실패" 로 보임.
 *
 *   - payoutStructure.customPercents
 *   - BlindLevel.isBreak
 *   - template.guarantee
 *   - posterUrl, description, ...
 *
 *   같은 옵셔널 필드가 폼에서 빈 칸으로 들어오면 undefined 가 박힘.
 *
 * 정책:
 *   모든 Firestore write 호출(addDoc/setDoc/updateDoc, merge 포함) 직전에
 *   payload를 stripUndefined() 통과시킨다. null은 보존, Timestamp/Date/FieldValue 등
 *   Firestore 네이티브 객체는 건드리지 않음.
 *
 * 사용:
 *   import { stripUndefined } from '@/lib/firestoreUtil';
 *   await addDoc(col, stripUndefined({ ...payload, createdAt: serverTimestamp() }));
 */

import { Timestamp, FieldValue } from 'firebase/firestore';

function isFirestoreNative(value: unknown): boolean {
  if (value instanceof Timestamp) return true;
  if (value instanceof FieldValue) return true;
  if (value instanceof Date) return true;
  return false;
}

export function stripUndefined<T>(value: T): T {
  if (value === undefined) {
    // top-level undefined은 그대로 (호출자 책임). 객체 내부에서는 키 자체를 제거.
    return value;
  }
  if (value === null) return value;
  if (isFirestoreNative(value)) return value;
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined)
      .map((v) => stripUndefined(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
