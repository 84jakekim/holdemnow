/**
 * autoHideOnReports — reports/{reportId} onCreate 트리거.
 *
 * 동일 targetId의 신고 누적 수가 REPORT_THRESHOLD(3) 이상이면
 * 자동으로 대상 doc의 status='hidden' / hidden=true 설정 + autoHiddenReason 박음.
 *
 * 정책:
 *   - 임계값: 3건
 *   - 대상 targetType: 'review' (Phase B) + 'post' (Phase E, 매장 데일리 글)
 *   - 멱등: 이미 hidden=true / status='hidden'이면 동일 결과
 *   - 카운트는 Firestore count() aggregation 사용
 *   - post는 status='hidden'로 처리 (collectionGroup 쿼리가 status==='published' 필터 적용 중)
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

const REPORT_THRESHOLD = 3;
const SUPPORTED_TARGETS = new Set(['review', 'post']);

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

    if (count < REPORT_THRESHOLD) {
      console.log(
        `[autoHideOnReports] ${data.targetType}=${data.targetId} count=${count} < threshold=${REPORT_THRESHOLD} — skip`,
      );
      return;
    }

    // 자동 숨김 — review/post 공통 필드 + post는 status='hidden' 추가
    const update: Record<string, unknown> = {
      hidden: true,
      autoHiddenAt: admin.firestore.FieldValue.serverTimestamp(),
      autoHiddenReason: `신고 ${count}건 누적`,
      flagCount: count,
    };
    if (data.targetType === 'post') {
      update.status = 'hidden';
    }

    await db.doc(data.targetParentPath).set(update, { merge: true });

    console.log(
      `[autoHideOnReports] hid ${data.targetType}=${data.targetId} path=${data.targetParentPath} after ${count} reports`,
    );
  },
);
