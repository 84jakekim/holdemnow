/* eslint-disable no-console */
/**
 * preLaunchReset.js — 출시 전 데이터 일괄 초기화 스크립트
 *
 * **목적**: 베타 기간 누적된 모든 가입/세션/콘텐츠를 삭제하고 깨끗한 상태로 출시.
 *
 * **보존 항목**:
 *   1. 총관리자 thethego@naver.com (Auth + users/{uid} doc + 매장 owner권)
 *   2. 데모 매장 100개 (stores.isDemo === true) + 그 매장의 시드 콘텐츠
 *   3. 본사 설정 (feedConfig, moderationKeywords seed 등)
 *
 * **삭제 항목**:
 *   - 일반 가입자 (users where role != 'platform_admin' && email != 'thethego@naver.com')
 *   - 매장 (stores where isDemo != true)
 *   - 대회사 (organizers — 데모 없음)
 *   - 콘텐츠: posts/reservations/reviews/recentVisits/notifications
 *   - 라이브: liveSessions/liveSessionsAudit/templates(데모 매장 제외)/timer prefs(데모 매장 제외)
 *
 * **사용법**:
 *   1. dry-run (디폴트, 출력만):
 *      node preLaunchReset.js
 *   2. 실제 실행 (D-day에만):
 *      node preLaunchReset.js --execute
 *
 * **주의**:
 *   - Auth 사용자 삭제는 별도 단계 (Firebase Console 또는 admin.auth().deleteUsers).
 *   - Firestore subcollection 자동 cascade 안 됨 — 명시적으로 처리.
 *   - 실행 후 복구 불가. 반드시 dry-run 먼저 + 결과 검토.
 */

const admin = require('firebase-admin');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'holdemnow-prod';
const PROTECTED_EMAIL = 'thethego@naver.com';

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const VERBOSE = argv.includes('--verbose') || argv.includes('-v');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

const stats = {
  protectedUid: null,
  protectedStores: [],
  deletedCounts: {},
  errors: [],
};

function bumpStat(key, n = 1) {
  stats.deletedCounts[key] = (stats.deletedCounts[key] || 0) + n;
}

async function findProtectedUid() {
  const snap = await db
    .collection('users')
    .where('email', '==', PROTECTED_EMAIL)
    .limit(1)
    .get();
  if (snap.empty) {
    console.warn(`[WARN] users 컬렉션에서 ${PROTECTED_EMAIL} 못 찾음. Auth uid 추가 조회 시도.`);
    try {
      const userRecord = await admin.auth().getUserByEmail(PROTECTED_EMAIL);
      console.warn(`[WARN] Auth에는 있음: uid=${userRecord.uid}. users doc 없으면 시드 필요.`);
      return userRecord.uid;
    } catch (e) {
      console.error(`[ERR] Auth에도 없음. 보호 대상 없이 진행하면 위험. 중단.`);
      process.exit(1);
    }
  }
  return snap.docs[0].id;
}

async function findDemoStoreIds() {
  const snap = await db.collection('stores').where('isDemo', '==', true).get();
  return snap.docs.map((d) => d.id);
}

async function deleteCollectionWhere(collPath, predicate, label) {
  let total = 0;
  let lastDoc = null;
  // page-based delete (Firestore 권장)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db.collection(collPath).limit(400);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    const toDelete = snap.docs.filter(predicate);
    if (toDelete.length > 0) {
      if (EXECUTE) {
        const batch = db.batch();
        toDelete.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      total += toDelete.length;
      if (VERBOSE) {
        toDelete.slice(0, 3).forEach((d) => {
          console.log(`  [${label}] ${EXECUTE ? 'DEL' : 'DRY'} ${d.id}`);
        });
      }
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
  bumpStat(label, total);
  return total;
}

async function deleteCollectionAll(collPath, label) {
  return deleteCollectionWhere(collPath, () => true, label);
}

async function deleteSubcollection(parentCollPath, parentDocId, subColl, label) {
  const subRef = db.collection(parentCollPath).doc(parentDocId).collection(subColl);
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await subRef.limit(400).get();
    if (snap.empty) break;
    if (EXECUTE) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    total += snap.size;
    if (snap.size < 400) break;
  }
  bumpStat(label, total);
  return total;
}

async function run() {
  console.log('='.repeat(60));
  console.log('Pink Rabbit Pre-Launch Reset');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (REAL DELETE)' : 'DRY-RUN (no writes)'}`);
  console.log(`Protected: ${PROTECTED_EMAIL}`);
  console.log('='.repeat(60));

  // 1. 보호 대상 식별
  stats.protectedUid = await findProtectedUid();
  stats.protectedStores = await findDemoStoreIds();
  console.log(`\n[보호] protected uid = ${stats.protectedUid}`);
  console.log(`[보호] demo stores = ${stats.protectedStores.length}개`);

  // 2. users — 보호 uid + role='platform_admin' 제외 전체 삭제
  await deleteCollectionWhere(
    'users',
    (d) => {
      const data = d.data();
      if (d.id === stats.protectedUid) return false;
      if (data.email === PROTECTED_EMAIL) return false;
      if (data.role === 'platform_admin') return false;
      if (Array.isArray(data.roles) && data.roles.includes('platform_admin')) return false;
      return true;
    },
    'users'
  );

  // 3. stores — isDemo !== true 전체 삭제 + subcollections (posts/templates/timerBackgrounds 등)
  const allStoresSnap = await db.collection('stores').get();
  const nonDemoStoreIds = allStoresSnap.docs
    .filter((d) => d.data().isDemo !== true)
    .map((d) => d.id);
  console.log(`[stores] non-demo: ${nonDemoStoreIds.length} (삭제 대상)`);
  for (const sid of nonDemoStoreIds) {
    // 서브컬렉션 들도 정리
    for (const sub of ['posts', 'templates', 'reservations', 'reviews', 'liveSessions', 'timerBackgrounds', 'staff']) {
      await deleteSubcollection('stores', sid, sub, `stores/${sub}`);
    }
    if (EXECUTE) {
      await db.collection('stores').doc(sid).delete().catch(() => {});
    }
    bumpStat('stores', 1);
  }

  // 4. organizers — 데모 없음, 전체 삭제
  await deleteCollectionAll('organizers', 'organizers');

  // 5. 글로벌 콘텐츠 컬렉션
  // posts (top-level — 시드 데이터 없음)
  await deleteCollectionAll('posts', 'posts');
  // reservations (top-level)
  await deleteCollectionAll('reservations', 'reservations');
  // reviews (top-level)
  await deleteCollectionAll('reviews', 'reviews');
  // recentVisits (top-level)
  await deleteCollectionAll('recentVisits', 'recentVisits');
  // notifications (top-level)
  await deleteCollectionAll('notifications', 'notifications');
  // reports
  await deleteCollectionAll('reports', 'reports');

  // 6. liveSessions (top-level — 매장 ref가 안 보존돼도 시드는 없음)
  await deleteCollectionAll('liveSessions', 'liveSessions');
  await deleteCollectionAll('liveSessionsAudit', 'liveSessionsAudit');

  // 7. passwordRecovery (가입 분실복구 매핑)
  await deleteCollectionWhere(
    'passwordRecovery',
    (d) => {
      const data = d.data();
      // 보호 대상 본인 매핑은 유지 (uid 기준)
      return data.uid !== stats.protectedUid;
    },
    'passwordRecovery'
  );

  // 8. 본사 설정은 보존:
  // - meta/feedConfig, meta/curationConfig
  // - moderationKeywords (시드 200개 유지)
  // - homeAds (있으면 보존 — 운영자가 큐레이션)
  // - hotYoutubeVideos / hotYoutubers (자동 수집물 — 옵션, 유지)
  // - platformCampaigns (운영자 작성물 — 유지)
  // → 이들은 명시적으로 삭제 X
  console.log('\n[보존] meta/feedConfig, meta/curationConfig, moderationKeywords, homeAds, hotYoutubeVideos, platformCampaigns');

  // 9. Auth 사용자 삭제 — 별도 단계 권고 (CLI 출력만)
  if (EXECUTE) {
    console.log('\n[Auth] users 컬렉션 doc은 삭제됨. Firebase Auth 계정 삭제는 별도 절차:');
    console.log('  - Firebase Console → Authentication → 보호 대상 외 일괄 삭제');
    console.log('  - 또는: admin.auth().listUsers + deleteUsers(uids) 별도 스크립트');
    console.log('  - 이 스크립트는 Auth는 손대지 않음 (rollback 불가 위험 분리).');
  }

  // 결과 출력
  console.log('\n' + '='.repeat(60));
  console.log(`결과 [${EXECUTE ? 'EXECUTED' : 'DRY-RUN'}]`);
  console.log('='.repeat(60));
  const entries = Object.entries(stats.deletedCounts).sort((a, b) => b[1] - a[1]);
  let grandTotal = 0;
  for (const [k, v] of entries) {
    if (v === 0) continue;
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(8)}`);
    grandTotal += v;
  }
  console.log('-'.repeat(60));
  console.log(`  ${'TOTAL'.padEnd(28)} ${String(grandTotal).padStart(8)} ${EXECUTE ? '실제 삭제됨' : '(dry-run, 미삭제)'}`);
  console.log('='.repeat(60));

  if (!EXECUTE) {
    console.log('\n⚠️  DRY-RUN 모드입니다. 실제 삭제하려면:');
    console.log('   node preLaunchReset.js --execute');
    console.log('\n실행 전 반드시:');
    console.log('   1. Firestore Export 백업 (gcloud firestore export gs://...)');
    console.log('   2. dry-run 결과 검토');
    console.log('   3. 보호 대상 uid/stores 개수 확인');
  } else {
    console.log('\n✅ 실행 완료. Auth 사용자 삭제는 별도 스크립트로 수행.');
  }
}

run().catch((e) => {
  console.error('\n[FATAL]', e);
  process.exit(1);
});
