/**
 * 매장 리뷰 집계 — stores/{storeId}/reviews/{reviewId} write 시 트리거.
 *
 * 매장 문서에 다음 필드를 merge로 갱신:
 *   - reviewCount: number              총 개수
 *   - averageRating: number            평균 별점 (소수점 1자리 반올림, 0~5.0)
 *   - ratingDistribution: { '1': N, ..., '5': N }   별점별 개수
 *
 * 베타 규모(매장당 수십~수백 개 리뷰)에서 매 write마다 collection re-scan으로 충분.
 * 추후 규모가 커지면 transaction 기반 증분 업데이트로 이관.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

export const aggregateReviewStats = onDocumentWritten(
  {
    document: 'stores/{storeId}/reviews/{reviewId}',
    region: 'asia-northeast3',
  },
  async (event) => {
    const storeId = event.params.storeId as string;
    const db = admin.firestore();

    // 해당 매장의 모든 리뷰 fetch
    const snap = await db
      .collection('stores')
      .doc(storeId)
      .collection('reviews')
      .get();

    let count = 0;
    let sum = 0;
    const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

    snap.forEach((doc) => {
      const data = doc.data() as { rating?: number };
      const r = Math.round(data.rating ?? 0);
      if (r < 1 || r > 5) return;
      count++;
      sum += r;
      dist[String(r)] = (dist[String(r)] ?? 0) + 1;
    });

    const avg = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

    await db.collection('stores').doc(storeId).set(
      {
        reviewCount: count,
        averageRating: avg,
        ratingDistribution: dist,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    console.log(
      `[aggregateReviewStats] store=${storeId} count=${count} avg=${avg} ` +
        `dist=${JSON.stringify(dist)}`,
    );
  },
);
