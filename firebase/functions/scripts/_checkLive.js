const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'holdemnow-prod' });
(async () => {
  const snap = await admin.firestore().collection('liveSessions').where('status', '==', 'live').get();
  console.log('liveSessions status=live 개수:', snap.size);
  snap.docs.slice(0, 5).forEach(d => {
    const data = d.data();
    console.log(`  - id=${d.id} storeId=${data.storeId} tournamentName=${data.tournamentName || data.name || ''}`);
  });
})().catch(e => { console.error(e); process.exit(1); });
