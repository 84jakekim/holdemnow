/**
 * cleanupExpiredPosts — 만료된 매장 "오늘의 소식" 자동 정리.
 *
 * 정책 (memory: project_holdemnow_daily_posts):
 *  - 데일리 글은 24h 만료 (createdAt + 24h = expiresAt).
 *  - 만료 후 3일 grace — 사장이 잘못 만료 처리한 경우 복구할 수 있도록.
 *  - 대상: collectionGroup('posts') where expiresAt < now - 3d
 *  - 함께 정리: 글에 첨부된 Firebase Storage 이미지 (imageUrls).
 *  - pinned 공지(top-level `pinnedPosts`)는 별도 컬렉션이라 collectionGroup 'posts'에
 *    걸리지 않음 → 안전. 추가로 path guard로 storeId 부재 시 skip.
 *  - batch 500건 단위, 단일 cron tick에서 최대 ~2,500건 정리. 모자라면 다음날 따라잡음.
 *
 * 스케줄: 매일 04:00 KST (저트래픽 시간대, 03:00 cleanupOldReservations 직후).
 * 쿼리: collectionGroup('posts')
 *   where expiresAt < now - 3d
 *   order by expiresAt asc
 *   limit 500 × N
 *
 * Firestore 인덱스: collectionGroup 'posts' on expiresAt asc (단일 필드 — 자동 인덱스 OK).
 *
 * 에러 정책:
 *  - 개별 이미지 삭제 실패는 swallow (Storage 권한/이미 삭제됨).
 *  - batch.commit 실패 시 throw 안 함 — 다음 cron tick에서 재시도.
 *  - 트랜잭션 사용 X (한 번에 너무 많으면 분할 처리).
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const GRACE_DAYS = 3;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 5; // 단일 tick 최대 2,500건

/**
 * Firebase Storage download URL → object path 변환.
 *  - `https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{ENCODED_PATH}?alt=...`
 *  - `gs://{bucket}/{path}`
 * 둘 다 지원. 매칭 실패 시 null 반환 (skip).
 */
function extractStoragePath(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  // gs:// 형식
  if (url.startsWith('gs://')) {
    const rest = url.slice('gs://'.length);
    const slash = rest.indexOf('/');
    if (slash < 0) return null;
    return decodeURIComponent(rest.slice(slash + 1));
  }
  // https download URL — /o/{ENCODED_PATH} 추출
  const m = url.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

async function deleteImageByUrl(url: string): Promise<boolean> {
  const path = extractStoragePath(url);
  if (!path) return false;
  try {
    await admin.storage().bucket().file(path).delete({ ignoreNotFound: true });
    return true;
  } catch (err) {
    // 권한/네트워크 등 — 다음 tick에서 재시도 가능. 본 batch는 계속 진행.
    logger.warn(`cleanupExpiredPosts: image delete failed path=${path}`, err);
    return false;
  }
}

export const cleanupExpiredPosts = onSchedule(
  {
    // 매일 04:00 KST = 19:00 UTC (전일)
    schedule: '0 4 * * *',
    timeZone: 'Asia/Seoul',
    region: 'asia-northeast3',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - GRACE_MS);

    let totalDeleted = 0;
    let totalSkipped = 0;
    let totalImagesDeleted = 0;
    let totalImagesFailed = 0;
    let totalBatchFailures = 0;

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      let snap: admin.firestore.QuerySnapshot;
      try {
        snap = await db
          .collectionGroup('posts')
          .where('expiresAt', '<', cutoff)
          .orderBy('expiresAt', 'asc')
          .limit(BATCH_SIZE)
          .get();
      } catch (err) {
        logger.error(`cleanupExpiredPosts: query failed at batch ${i + 1}`, err);
        break;
      }

      if (snap.empty) break;

      // 1) 이미지 삭제 — 병렬 처리(batch.commit 전에 먼저 시도).
      //    실패해도 Firestore 문서는 삭제 진행 (orphan 이미지가 생길 수 있으나
      //    Storage 라이프사이클 정책으로 별도 회수 가능).
      const imageDeletes: Array<Promise<boolean>> = [];
      const docsToDelete: admin.firestore.QueryDocumentSnapshot[] = [];

      snap.forEach((doc) => {
        // path guard — collectionGroup('posts')는 향후 다른 컬렉션의 'posts'도 잡을 수 있음.
        // 매장 posts는 항상 stores/{storeId}/posts/{postId} 구조. parent.parent 부재 시 skip.
        const parentDoc = doc.ref.parent.parent;
        if (!parentDoc || parentDoc.parent.id !== 'stores') {
          totalSkipped += 1;
          return;
        }

        const data = doc.data();
        const imageUrls: unknown = data?.imageUrls;
        if (Array.isArray(imageUrls)) {
          for (const url of imageUrls) {
            if (typeof url === 'string' && url) {
              imageDeletes.push(deleteImageByUrl(url));
            }
          }
        }
        docsToDelete.push(doc);
      });

      // 이미지 삭제 결과 집계 (실패해도 진행)
      const imgResults = await Promise.allSettled(imageDeletes);
      for (const r of imgResults) {
        if (r.status === 'fulfilled' && r.value) totalImagesDeleted += 1;
        else totalImagesFailed += 1;
      }

      if (docsToDelete.length === 0) {
        // 이번 페이지는 전부 skip — 다음 페이지로 갈 게 없으니 종료.
        break;
      }

      // 2) Firestore batch delete
      const batch = db.batch();
      for (const d of docsToDelete) batch.delete(d.ref);

      try {
        await batch.commit();
        totalDeleted += docsToDelete.length;
        logger.info(
          `cleanupExpiredPosts: batch ${i + 1} deleted ${docsToDelete.length} (running total ${totalDeleted})`,
        );
      } catch (err) {
        totalBatchFailures += 1;
        logger.error(
          `cleanupExpiredPosts: batch ${i + 1} commit failed — will retry next tick`,
          err,
        );
        // throw 안 함 — 다음 실행에서 재시도.
        break;
      }

      // 마지막 batch가 500 미만이면 더 가져올 게 없음.
      if (snap.size < BATCH_SIZE) break;
    }

    logger.info(
      `cleanupExpiredPosts: complete. ` +
        `deleted=${totalDeleted} skipped=${totalSkipped} ` +
        `images_deleted=${totalImagesDeleted} images_failed=${totalImagesFailed} ` +
        `batch_failures=${totalBatchFailures} grace=${GRACE_DAYS}d ` +
        `cutoff=${cutoff.toDate().toISOString()}`,
    );
  },
);
