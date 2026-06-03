/**
 * 만료된 인앱 알림 자동 정리.
 *
 * 트리거: 매 6시간 scheduled
 * 흐름:
 * 1. collectionGroup('items') — expiresAt < now 인 알림 doc 조회 (페이지 500개씩)
 * 2. batch 삭제, 비어질 때까지 반복 (최대 MAX_PAGES 페이지)
 *
 * 배경: 인앱 알림(notifications/{uid}/items)은 그동안 클라이언트가 expiresAt로
 * "숨기기만" 하고 실제 문서는 영구 누적됐다. 사용자가 많아지면 누적량이 폭증하므로,
 * TTL(기본 1일)을 지난 doc을 서버에서 실제 삭제해 데이터를 최소로 유지한다.
 *
 * 참고: items는 notifications/{uid}/items 외에 다른 컬렉션에서 쓰지 않으므로
 * collectionGroup('items')는 인앱 알림에만 매칭된다.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const PAGE = 500;       // batch 한도
const MAX_PAGES = 40;   // 1회 실행당 최대 20,000건 (백로그 안전 마진)

export const cleanupExpiredNotifications = onSchedule(
  {
    schedule: 'every 6 hours',
    region: 'asia-northeast3',
    timeoutSeconds: 300,
  },
  async () => {
    const db = admin.firestore();
    let total = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const now = admin.firestore.Timestamp.now();
      const snap = await db
        .collectionGroup('items')
        .where('expiresAt', '<', now)
        .limit(PAGE)
        .get();

      if (snap.empty) break;

      const batch = db.batch();
      snap.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      total += snap.size;

      // 마지막 페이지(500 미만)면 종료
      if (snap.size < PAGE) break;
    }

    console.log(`[cleanupExpiredNotifications] removed ${total} expired notifications`);
  },
);
