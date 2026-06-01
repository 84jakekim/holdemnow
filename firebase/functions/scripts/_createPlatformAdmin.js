/* eslint-disable no-console */
// 일회성: platform_admin 계정 생성 (Auth + users doc)
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'holdemnow-prod' });

const EMAIL = 'admin2@admin.pinkrabbit.local';
const PASSWORD = '111111';

(async () => {
  // 1) Auth 계정 생성 (이미 있으면 비번 재설정)
  let uid;
  try {
    const u = await admin.auth().createUser({
      email: EMAIL,
      password: PASSWORD,
      emailVerified: true,
      disabled: false,
    });
    uid = u.uid;
    console.log(`[Auth] 신규 생성 — uid=${uid}`);
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      const exist = await admin.auth().getUserByEmail(EMAIL);
      uid = exist.uid;
      await admin.auth().updateUser(uid, { password: PASSWORD });
      console.log(`[Auth] 기존 계정 발견 — uid=${uid} 비번만 갱신`);
    } else {
      throw e;
    }
  }

  // 2) users/{uid} doc 생성/갱신 (platform_admin)
  await admin.firestore().collection('users').doc(uid).set({
    email: EMAIL,
    role: 'platform_admin',
    roles: ['platform_admin'],
    displayName: 'admin2',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`[Firestore] users/${uid} platform_admin role 설정`);

  console.log('\n✅ 완료');
  console.log(`   이메일: ${EMAIL}`);
  console.log(`   비밀번호: ${PASSWORD}`);
  console.log(`   로그인: https://holdemnow-admin--holdemnow-prod.us-east4.hosted.app/platform-login`);
})().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
