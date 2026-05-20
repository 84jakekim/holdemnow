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

// ===== YouTube — 채널 페이지 메타 추출 (API key 불필요, og:meta 파싱) =====
export { getYoutubeChannelMeta } from './youtube/getYoutubeChannelMeta';

// ===== YouTube — 인기 영상 자동 큐레이션 (매일 04:00 KST, YOUTUBE_API_KEY secret 필요) =====
// curateHotVideos: 스케줄 정상 트리거 / triggerCurateHotVideos: 관리자 수동 트리거 (v0.5에서 어드민 callable 정식화)
export { curateHotVideos, triggerCurateHotVideos } from './youtube/curateHotVideos';

// ===== Notifications (FCM) =====
export { notifyFavoriteOnLive } from './notifications/notifyFavoriteOnLive';
export { notifyTournamentStart } from './notifications/notifyTournamentStart';
export { notifyLateRegImminent } from './notifications/notifyLateRegImminent';
export { marketingBroadcast } from './notifications/marketingBroadcast';
export { processScheduledCampaigns } from './notifications/processScheduledCampaigns';

// ===== LIVE =====
// 마지막 레벨 종료 후 그레이스(180초) 만료된 세션을 status=completed로 자동 정리.
// "실시간" 컨셉 보증 — 매장 사장 화면이 꺼져 있어도 서버에서 정리됨.
export { autoStopFinishedSessions } from './live/autoStopFinishedSessions';

// ===== Reviews — 매장 리뷰 집계 (reviewCount/averageRating/ratingDistribution) =====
export { aggregateReviewStats } from './reviews/aggregateReviewStats';

// ===== Moderation — reports 누적 3건 시 자동 숨김 (Phase B 클린봇) =====
export { autoHideOnReports } from './moderation/autoHideOnReports';

// ===== Series — 위성 예선 자동 집계 (M19 매핑) (v0.2+ 추가 예정) =====
// export { onSatelliteResultBatch } from './series/onSatelliteResultBatch';

// ===== Denormalized 동기화 (storeName 등) (v0.2+ 추가 예정) =====
// export { propagateStoreName } from './denorm/propagateStoreName';
