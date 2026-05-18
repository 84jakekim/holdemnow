'use client';

/**
 * auditLog.ts — 본사 관리자 감사 로그 헬퍼
 *
 * auditLogs/{auto-id} 컬렉션에 기록.
 * 감사 로그는 create 전용 — update/delete 불가 (Firestore rules 보장).
 */

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

export type AuditAction =
  | 'export_members'
  | 'send_password_reset'
  | 'change_status'
  | 'change_role';

export type AuditTarget = {
  type: 'user' | 'store' | 'organizer';
  id: string;
};

export async function logAdminAction(opts: {
  action: AuditAction;
  target: AuditTarget;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    console.warn('[auditLog] 로그인 상태가 아닙니다. 감사 로그 기록 생략.');
    return;
  }

  try {
    await addDoc(collection(db, 'auditLogs'), {
      actor: user.uid,
      actorEmail: user.email ?? '',
      timestamp: serverTimestamp(),
      action: opts.action,
      target: opts.target,
      metadata: opts.metadata ?? {},
    });
  } catch (err) {
    // 감사 로그 실패는 사용자 흐름을 막지 않음 — 콘솔 경고만
    console.error('[auditLog] 기록 실패:', err);
  }
}
