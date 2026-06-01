/* eslint-disable no-console */
// 일회성: users 컬렉션에서 platform_admin 역할 + thethego 계정 정보 조회
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'holdemnow-prod' });
const db = admin.firestore();

(async () => {
  console.log('===== role==platform_admin =====');
  const a = await db.collection('users').where('role', '==', 'platform_admin').get();
  a.docs.forEach((d) => {
    const u = d.data();
    console.log(`  uid=${d.id}  email=${u.email || '(없음)'}  role=${u.role}  roles=${JSON.stringify(u.roles)}  storeOwner=${u.storeId || u.ownedStoreId || '-'}`);
  });

  console.log('\n===== roles array에 platform_admin 포함 =====');
  const b = await db.collection('users').where('roles', 'array-contains', 'platform_admin').get();
  b.docs.forEach((d) => {
    const u = d.data();
    console.log(`  uid=${d.id}  email=${u.email || '(없음)'}  role=${u.role}  roles=${JSON.stringify(u.roles)}`);
  });

  console.log('\n===== thethego@naver.com 본인 doc =====');
  const c = await db.collection('users').where('email', '==', 'thethego@naver.com').get();
  c.docs.forEach((d) => {
    const u = d.data();
    console.log(`  uid=${d.id}`);
    console.log(`  email=${u.email}`);
    console.log(`  displayName=${u.displayName || '-'}`);
    console.log(`  role=${u.role || '-'}`);
    console.log(`  roles=${JSON.stringify(u.roles)}`);
    console.log(`  storeId=${u.storeId || '-'}`);
    console.log(`  ownedStoreId=${u.ownedStoreId || '-'}`);
  });
})().catch((e) => { console.error(e); process.exit(1); });
