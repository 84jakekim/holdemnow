'use client';

/**
 * auditLog.ts — 본사 관리자 감사 로그 헬퍼
 *
 * auditLogs/{auto-id} 컬렉션에 기록.
 * 감사 로그는 create 전용 — update/delete 불가 (Firestore rules 보장).
 */

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import { stripUndefined } from './firestoreUtil';

export type AuditAction =
  | 'export_members'
  | 'send_password_reset'
  | 'change_status'
  | 'change_role'
  // 인기 매장 컨트롤
  | 'change_score_boost'
  // 모더레이션 액션 (platform/moderation)
  | 'hide'
  | 'restore'
  | 'delete';

export type AuditTarget = {
  type: 'user' | 'store' | 'organizer';
  id: string;
};

// 모더레이션 전용 입력 형태 — targetPath/targetType로 임의 문서 식별.
export type ModerationLogInput = {
  action: 'hide' | 'restore' | 'delete';
  targetPath: string;
  targetType: 'post' | 'community' | 'dealer' | 'review' | 'comment';
  reason?: string;
};

// 기존 멤버 관리 형태 입력
export type MembershipLogInput = {
  action: AuditAction;
  target: AuditTarget;
  metadata?: Record<string, unknown>;
};

function isModerationInput(
  input: ModerationLogInput | MembershipLogInput,
): input is ModerationLogInput {
  return (
    typeof (input as ModerationLogInput).targetPath === 'string' &&
    typeof (input as ModerationLogInput).targetType === 'string'
  );
}

export async function logAdminAction(input: ModerationLogInput): Promise<void>;
export async function logAdminAction(input: MembershipLogInput): Promise<void>;
export async function logAdminAction(
  input: ModerationLogInput | MembershipLogInput,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    console.warn('[auditLog] 로그인 상태가 아닙니다. 감사 로그 기록 생략.');
    return;
  }

  try {
    if (isModerationInput(input)) {
      // 모더레이션 audit: targetPath/targetType + reason
      await addDoc(
        collection(db, 'auditLogs'),
        stripUndefined({
          // 신규 필드 (PM 확정 시그니처)
          actorUid: user.uid,
          actorEmail: user.email ?? '',
          // 기존 rules 호환: actor == request.auth.uid 조건 만족
          actor: user.uid,
          timestamp: serverTimestamp(),
          action: input.action,
          targetPath: input.targetPath,
          targetType: input.targetType,
          reason: input.reason,
        }),
      );
    } else {
      // 기존 멤버 관리 audit (호환 유지)
      await addDoc(
        collection(db, 'auditLogs'),
        stripUndefined({
          actor: user.uid,
          actorUid: user.uid,
          actorEmail: user.email ?? '',
          timestamp: serverTimestamp(),
          action: input.action,
          target: input.target,
          metadata: input.metadata ?? {},
        }),
      );
    }
  } catch (err) {
    // 감사 로그 실패는 사용자 흐름을 막지 않음 — 콘솔 경고만
    console.warn('[auditLog] 기록 실패:', err);
  }
}
