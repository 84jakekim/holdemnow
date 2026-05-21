// 진단용 일회성 스크립트 — prod Firestore의 최근 completed liveSessions 덤프
// 실행: ADC 토큰 사용 (firebase login 상태)
const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'holdemnow-prod',
});

const db = admin.firestore();

(async () => {
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const sinceTs = admin.firestore.Timestamp.fromMillis(sinceMs);

  // status=completed + endedAt >= sinceTs
  // 인덱스 없을 수 있으니 전체 fetch 후 클라 필터
  const snap = await db.collection('liveSessions')
    .where('status', '==', 'completed')
    .limit(50)
    .get();

  const rows = [];
  snap.forEach((d) => {
    const data = d.data();
    const tsToMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
    const tsToIso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);
    const endedMs = tsToMs(data.endedAt);
    if (endedMs && endedMs < sinceMs) return; // 24시간 이내만

    const startedMs = tsToMs(data.totalStartedAt);
    const durationsMin = data.blindStructureLocked
      ? data.blindStructureLocked.reduce((s, l) => s + (l.durationSec || 0), 0) / 60
      : null;
    const lockedLen = (data.blindStructureLocked || []).length;
    const liveLen = (data.blindStructure || []).length;
    const lastLevel = lockedLen > 0 ? data.blindStructureLocked[lockedLen - 1].level : null;
    const elapsedMin = startedMs && endedMs
      ? Math.floor((endedMs - startedMs - (data.totalPausedMs || 0)) / 60000)
      : null;
    rows.push({
      id: d.id,
      storeName: data.storeName,
      tournamentName: data.tournamentName,
      currentLevel: data.currentLevel,
      lastLevel,
      lockedLen,
      liveLen,
      reachedLast: data.currentLevel === lastLevel,
      durationsMin,
      elapsedMin,
      totalPausedMin: Math.floor((data.totalPausedMs || 0) / 60000),
      totalStartedAt: tsToIso(data.totalStartedAt),
      finishingAt: tsToIso(data.finishingAt),
      endedAt: tsToIso(data.endedAt),
      createdAt: tsToIso(data.createdAt),
      updatedAt: tsToIso(data.updatedAt),
      // 어떻게 종료됐는지 추정
      // - finishingAt 박힌 채 endedAt → autoAdvanceLevel + (cron 또는 client) 정리
      // - finishingAt null + endedAt → 클라이언트 수동 stop 또는 cron staleNull/zombie
      stopRoute: data.finishingAt
        ? (data.currentLevel === lastLevel ? 'finishingAt(LAST)' : 'finishingAt(NOT-LAST!!)')
        : 'noFinishingAt(manual_or_zombie)',
    });
  });

  rows.sort((a, b) => (b.endedAt || '').localeCompare(a.endedAt || ''));
  console.log(JSON.stringify(rows.slice(0, 10), null, 2));
  console.log(`\nTotal completed (24h): ${rows.length}`);
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
