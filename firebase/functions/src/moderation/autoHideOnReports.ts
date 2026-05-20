/**
 * autoHideOnReports — reports/{reportId} onCreate 트리거.
 *
 * 동일 targetId(리뷰)의 신고 누적 수가 REPORT_THRESHOLD(3) 이상이면
 * 자동으로 대상 리뷰의 hidden=true 설정 + autoHiddenReason 박음.
 *
 * 정책 (PM 합의 — Phase B):
 *   - 임계값: 3건
 *   - 대상: targetType === 'review'만 (community/user는 Phase C에서 확장)
 *   - 멱등: 이미 hidden=true면 다시 set해도 같은 결과
 *   - 카운트는 Firestore count() aggregation 사용
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

const REPORT_THRESHOLD = 3;

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

    if (data.targetType !== 'review' || !data.targetId || !data.targetParentPath) {
      return;
    }

    const db = admin.firestore();

    // 동일 리뷰에 대한 신고 누적 카운트
    const countSnap = await db
      .collection('reports')
      .where('targetType', '==', 'review')
      .where('targetId', '==', data.targetId)
      .count()
      .get();
    const count = countSnap.data().count;

    if (count < REPORT_THRESHOLD) {
      console.log(
        `[autoHideOnReports] review=${data.targetId} count=${count} < threshold=${REPORT_THRESHOLD} — skip`,
      );
      return;
    }

    // 자동 숨김
    await db.doc(data.targetParentPath).set(
      {
        hidden: true,
        autoHiddenAt: admin.firestore.FieldValue.serverTimestamp(),
        autoHiddenReason: `신고 ${count}건 누적`,
      },
      { merge: true },
    );

    console.log(
      `[autoHideOnReports] hid review=${data.targetId} path=${data.targetParentPath} after ${count} reports`,
    );
  },
);
