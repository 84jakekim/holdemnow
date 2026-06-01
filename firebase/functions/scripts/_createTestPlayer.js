/* eslint-disable no-console */
// 일회성: 캡처용 임시 player 계정 생성
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'holdemnow-prod' });

const EMAIL = 'shotter@admin.pinkrabbit.local';
const PASSWORD = 'shot111';

(async () => {
  let uid;
  try {
    const u = await admin.auth().createUser({ email: EMAIL, password: PASSWORD, emailVerified: true });
    uid = u.uid;
    console.log(`[Auth] 생성 — uid=${uid}`);
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      const ex = await admin.auth().getUserByEmail(EMAIL);
      uid = ex.uid;
      await admin.auth().updateUser(uid, { password: PASSWORD });
      console.log(`[Auth] 기존 — uid=${uid}`);
    } else throw e;
  }
  await admin.firestore().collection('users').doc(uid).set({
    email: EMAIL,
    role: 'player',
    roles: ['player'],
    displayName: '스크린샷',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`[Firestore] users/${uid} role=player 설정`);
  console.log(`\n이메일: ${EMAIL}\n비번: ${PASSWORD}`);
})().catch((e) => { console.error(e); process.exit(1); });
