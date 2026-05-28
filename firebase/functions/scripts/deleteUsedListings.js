/* eslint-disable no-console */
/**
 * deleteUsedListings.js — 중고거래(usedListing) Firestore doc + Storage 이미지 일괄 삭제
 *
 * **목적**: 중고거래 기능 완전 제거 결정(2026-05-28)에 따라
 * Firestore 잔존 데이터를 즉시 일괄 정리. 코드/룰 측 제거는 동시에 완료된 상태.
 *
 * **삭제 대상**:
 *   - Firestore: collection('community') where type == 'usedListing' (전체)
 *   - Storage: 각 doc의 images[] 다운로드 URL에서 path 추출 후 삭제
 *
 * **건드리지 않는 것**:
 *   - jobOffer / dealerProfile / 그 외 모든 community 항목
 *   - reports 컬렉션 (preLaunchReset 또는 별도 정리에서 처리)
 *   - Auth / users / stores / 기타
 *
 * **사용법**:
 *   dry-run (디폴트):
 *     node deleteUsedListings.js
 *     node deleteUsedListings.js --verbose
 *   실제 실행:
 *     node deleteUsedListings.js --execute
 *
 * **안전장치**:
 *   - --execute 없으면 write 0
 *   - Storage 삭제 실패는 무시(ignoreNotFound) — orphan 이미지보다 doc 삭제 우선
 *   - Batch 400건 단위 (Firestore 한도 500 안전 마진)
 */

const admin = require('firebase-admin');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'holdemnow-prod';

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const VERBOSE = argv.includes('--verbose') || argv.includes('-v');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();
const bucket = admin.storage().bucket(`${PROJECT_ID}.appspot.com`);

const stats = {
  docsScanned: 0,
  docsToDelete: 0,
  imagesToDelete: 0,
  imagesDeleted: 0,
  imagesFailed: 0,
  docsDeleted: 0,
  sampleIds: [],
  errors: [],
};

/**
 * Firebase Storage download URL에서 객체 path 추출.
 * 형식: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token=...
 * 반환: 'community/abc123/img1.jpg' 같은 디코딩된 path. 매칭 실패 시 null.
 */
function extractStoragePath(downloadUrl) {
  if (typeof downloadUrl !== 'string') return null;
  // path는 /o/ 와 ? 사이
  const m = downloadUrl.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

async function deleteStorageImage(url) {
  const path = extractStoragePath(url);
  if (!path) {
    stats.imagesFailed += 1;
    return;
  }
  if (!EXECUTE) {
    // dry-run: 카운트만
    return;
  }
  try {
    await bucket.file(path).delete({ ignoreNotFound: true });
    stats.imagesDeleted += 1;
  } catch (e) {
    stats.imagesFailed += 1;
    stats.errors.push(`storage ${path}: ${e.message}`);
  }
}

async function run() {
  console.log('='.repeat(60));
  console.log('Pink Rabbit — usedListing 일괄 삭제');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (REAL DELETE)' : 'DRY-RUN (no writes)'}`);
  console.log('='.repeat(60));

  // 1. 삭제 대상 전부 스캔 (페이지네이션)
  const targets = [];
  let lastDoc = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db
      .collection('community')
      .where('type', '==', 'usedListing')
      .orderBy('__name__')
      .limit(400);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach((d) => {
      targets.push({ id: d.id, data: d.data(), ref: d.ref });
    });
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }

  stats.docsScanned = targets.length;
  stats.docsToDelete = targets.length;

  // 이미지 카운트
  for (const t of targets) {
    const imgs = Array.isArray(t.data.images) ? t.data.images : [];
    stats.imagesToDelete += imgs.length;
    if (VERBOSE && stats.sampleIds.length < 10) {
      const title = (t.data.title || '').slice(0, 30);
      const storeName = t.data.storeName || '(user)';
      stats.sampleIds.push(`  ${t.id}  [${storeName}] ${title}  imgs=${imgs.length}`);
    }
  }

  console.log(`\n[스캔] community where type='usedListing': ${stats.docsScanned} docs`);
  console.log(`[스캔] 첨부 이미지 총 ${stats.imagesToDelete}개`);
  if (VERBOSE && stats.sampleIds.length > 0) {
    console.log('\n[샘플 (최대 10건)]');
    stats.sampleIds.forEach((line) => console.log(line));
  }

  if (targets.length === 0) {
    console.log('\n✅ 삭제 대상 없음. 종료.');
    return;
  }

  // 2. Storage 이미지 먼저 정리 (doc 삭제 후엔 URL을 잃으므로 순서 중요)
  console.log(`\n[Storage] 이미지 삭제 시작 ${EXECUTE ? '(실삭제)' : '(dry-run, 카운트만)'}...`);
  for (const t of targets) {
    const imgs = Array.isArray(t.data.images) ? t.data.images : [];
    // 순차 삭제 (병렬 시 storage rate limit 고려)
    for (const url of imgs) {
      await deleteStorageImage(url);
    }
  }
  console.log(`[Storage] ${EXECUTE ? '삭제 성공' : 'path 파싱 성공'}: ${EXECUTE ? stats.imagesDeleted : stats.imagesToDelete - stats.imagesFailed}, 실패/skip: ${stats.imagesFailed}`);

  // 3. Firestore doc 삭제 (batch 400)
  console.log(`\n[Firestore] doc 삭제 시작 ${EXECUTE ? '(실삭제)' : '(dry-run)'}...`);
  if (EXECUTE) {
    let cursor = 0;
    while (cursor < targets.length) {
      const slice = targets.slice(cursor, cursor + 400);
      const batch = db.batch();
      slice.forEach((t) => batch.delete(t.ref));
      await batch.commit();
      stats.docsDeleted += slice.length;
      cursor += slice.length;
    }
  } else {
    stats.docsDeleted = 0;
  }
  console.log(`[Firestore] ${EXECUTE ? `삭제됨: ${stats.docsDeleted}` : `대상: ${stats.docsToDelete} (dry-run)`}`);

  // 결과
  console.log('\n' + '='.repeat(60));
  console.log(`결과 [${EXECUTE ? 'EXECUTED' : 'DRY-RUN'}]`);
  console.log('='.repeat(60));
  console.log(`  community/usedListing docs       : ${stats.docsScanned} 스캔 / ${EXECUTE ? stats.docsDeleted + ' 삭제' : stats.docsToDelete + ' 삭제 대상'}`);
  console.log(`  Storage 이미지                    : ${stats.imagesToDelete} 대상 / ${EXECUTE ? stats.imagesDeleted + ' 삭제 성공' : '(dry-run)'} / ${stats.imagesFailed} 실패`);
  console.log('='.repeat(60));

  if (stats.errors.length > 0) {
    console.log('\n[errors (최대 10건)]');
    stats.errors.slice(0, 10).forEach((e) => console.log(`  - ${e}`));
  }

  if (!EXECUTE) {
    console.log('\n⚠️  DRY-RUN 모드입니다. 실제 삭제하려면:');
    console.log('   node deleteUsedListings.js --execute');
    console.log('\n실행 전 권장:');
    console.log('   1. Firestore Export 백업 (gcloud firestore export gs://...)');
    console.log('   2. --verbose로 샘플 ID 확인');
  } else {
    console.log('\n✅ 실행 완료. usedListing 데이터 + 첨부 이미지 정리됨.');
  }
}

run().catch((e) => {
  console.error('\n[FATAL]', e);
  process.exit(1);
});
