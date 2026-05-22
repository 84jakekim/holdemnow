/**
 * autoHideOnReports — reports/{reportId} onCreate 트리거.
 *
 * 동일 targetId의 신고 누적 수가 REPORT_THRESHOLD(3) 이상이면
 * 자동으로 대상 doc의 status='hidden' / hidden=true 설정 + autoHiddenReason 박음.
 *
 * 정책:
 *   - 임계값: 3건
 *   - 대상 targetType: 'review' (Phase B) + 'post' (Phase E, 매장 데일리 글) + 'community' (모더레이션 v0.1)
 *   - 멱등: 이미 hidden=true / status='hidden'이면 동일 결과
 *   - 카운트는 Firestore count() aggregation 사용
 *   - post/community는 status='hidden'로 처리 (collectionGroup/일반 쿼리가 status 필터 적용 중)
 *   - flagCount는 매 reports 생성 시 누계 미러 (관리자 페이지 정렬용)
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

const REPORT_THRESHOLD = 3;
const SUPPORTED_TARGETS = new Set(['review', 'post', 'community']);

interface ReportData {
  targetType?: string;
  targetId?: string;
  targetParentPath?: string;
  storeId?: string;
}

export const autoHideOnReports = onDocumentCreated(
  { document: 'reports/{reportId}', region: 'asia-northeast3' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as ReportData;

    if (!data.targetType || !SUPPORTED_TARGETS.has(data.targetType)) {
      return;
    }
    if (!data.targetId || !data.targetParentPath) {
      return;
    }

    const db = admin.firestore();

    const countSnap = await db
      .collection('reports')
      .where('targetType', '==', data.targetType)
      .where('targetId', '==', data.targetId)
      .count()
      .get();
    const count = countSnap.data().count;

    // flagCount는 임계 미달이어도 항상 누계 미러 (모더레이션 페이지 정렬용)
    if (count < REPORT_THRESHOLD) {
      try {
        await db.doc(data.targetParentPath).set({ flagCount: count }, { merge: true });
      } catch (err) {
        console.warn(
          `[autoHideOnReports] flagCount 미러 실패 path=${data.targetParentPath}:`,
          err,
        );
      }
      console.log(
        `[autoHideOnReports] ${data.targetType}=${data.targetId} count=${count} < threshold=${REPORT_THRESHOLD} — flagCount만 갱신`,
      );
      return;
    }

    // 자동 숨김 — review/post/community 공통 필드 + post/community는 status='hidden' 추가
    const update: Record<string, unknown> = {
      hidden: true,
      autoHiddenAt: admin.firestore.FieldValue.serverTimestamp(),
      autoHiddenReason: `신고 ${count}건 누적`,
      flagCount: count,
    };
    if (data.targetType === 'post' || data.targetType === 'community') {
      update.status = 'hidden';
    }

    await db.doc(data.targetParentPath).set(update, { merge: true });

    console.log(
      `[autoHideOnReports] hid ${data.targetType}=${data.targetId} path=${data.targetParentPath} after ${count} reports`,
    );
  },
);
