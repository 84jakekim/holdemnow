/**
 * HoldemNow Cloud Functions 진입점
 *
 * 모든 Function을 여기서 export합니다. 그룹별 파일로 분리하면 firebase functions:list 등에서
 * 명확히 구분됩니다.
 *
 * 배포: `npm run deploy`
 * 로컬: `firebase emulators:start`
 */

import * as admin from 'firebase-admin';

// Firebase Admin 초기화 (Functions 환경에선 자동 자격 증명)
admin.initializeApp();

// ===== Auth =====
export { kakaoCustomToken } from './auth/kakaoCustomToken';

// ===== Notifications (FCM) =====
export { notifyFavoriteOnLive } from './notifications/notifyFavoriteOnLive';

// ===== LIVE (v0.2+ 추가 예정) =====
// export { onLiveSessionCreate } from './live/onLiveSessionCreate';
// export { tickCountdownDrift } from './live/tickCountdownDrift';

// ===== Notifications (FCM) v0.2+ 추가 예정 =====
// export { notifyInterestedTournamentStart } from './notifications/notifyInterestedTournamentStart';

// ===== Series — 위성 예선 자동 집계 (M19 매핑) (v0.2+ 추가 예정) =====
// export { onSatelliteResultBatch } from './series/onSatelliteResultBatch';

// ===== Denormalized 동기화 (storeName 등) (v0.2+ 추가 예정) =====
// export { propagateStoreName } from './denorm/propagateStoreName';
