/**
 * Pink Rabbit Cloud Functions 진입점
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

// ===== Admin — 본사 관리자 전용 =====
// 사용자 비밀번호 재설정 메일 발송 (platform_admin only, 감사 로그 기록).
export { sendPasswordResetByAdmin } from './admin/sendPasswordResetByAdmin';
// 사용자 인증 방식 조회 (platform_admin only) — providers/hasPassword/hasGoogle/hasKakao
export { getUserAuthInfo } from './admin/getUserAuthInfo';

// ===== YouTube — 채널 페이지 메타 추출 (API key 불필요, og:meta 파싱) =====
export { getYoutubeChannelMeta } from './youtube/getYoutubeChannelMeta';

// ===== YouTube — 인기 영상 자동 큐레이션 (매시간 KST, config.scheduleHourKst 일치 시만 실행) =====
// curateHotVideos: 매시 정각 스케줄 / triggerCurateHotVideos: 관리자 수동 트리거 (secret query)
export { curateHotVideos, triggerCurateHotVideos } from './youtube/curateHotVideos';
// 본사 어드민 즉시 실행 Callable (platform_admin only, /platform/videos 페이지 "지금 실행" 버튼)
export { triggerYoutubeCurationNow } from './youtube/triggerYoutubeCurationNow';
// 인기 유튜버 자동 일괄 등록 (platform_admin only) — 키워드 search + channels.list로 메타·아바타 한 번에 fetch
export { autoImportYoutubers } from './youtube/autoImportYoutubers';

// ===== Notifications (FCM) =====
export { notifyFavoriteOnLive } from './notifications/notifyFavoriteOnLive';
export { notifyTournamentStart } from './notifications/notifyTournamentStart';
export { notifyLateRegImminent } from './notifications/notifyLateRegImminent';
// 시리즈 본선 D-7/D-3/D-1 카운트다운 (매일 09:00 KST) — seriesSubscriptions 구독자에게 FCM
export { notifySeriesCountdown } from './notifications/notifySeriesCountdown';
export { marketingBroadcast } from './notifications/marketingBroadcast';
export { processScheduledCampaigns } from './notifications/processScheduledCampaigns';
// 새 예약 생성 시 매장 owner에게 FCM 푸시.
export { notifyStoreOnReservation } from './notifications/notifyStoreOnReservation';
// 예약 확정 시 예약자에게 FCM 푸시 (pending → confirmed).
export { notifyUserOnReservationConfirmed } from './notifications/notifyUserOnReservationConfirmed';
// 매장 측 예약 취소 시 예약자에게 FCM 푸시 (cancelledBy='store' 또는 'store_approved').
export { notifyUserOnReservationCancelledByStore } from './notifications/notifyUserOnReservationCancelledByStore';
// 사용자 발의 취소 신청 시 매장 owner에게 FCM 푸시 (cancelRequested false→true).
export { notifyStoreOnCancelRequest } from './notifications/notifyStoreOnCancelRequest';
// 매장이 사용자 취소 신청을 거절했을 때 사용자에게 FCM 푸시 (cancelRequested true→false + declinedAt).
export { notifyUserOnCancelRequestDeclined } from './notifications/notifyUserOnCancelRequestDeclined';
// 예약 방문 10분 전 사용자에게 리마인더 FCM 푸시 (1분 cron).
export { notifyReservationReminder } from './notifications/notifyReservationReminder';
// 입장시간+2h 지난 pending/confirmed 예약 자동 completed (30분 cron) — 2026-05-27
export { autoCompleteReservations } from './notifications/autoCompleteReservations';
// 90일 이상 지난 종료 예약 자동 삭제 (매일 03:00 KST) — 2026-05-27
// 대상: cancelled/rejected/completed/no_show + reservedFor < now-90d.
// 활성(pending/confirmed) 및 cancelRequested=true 는 이중 가드로 절대 삭제 X.
export { cleanupOldReservations } from './notifications/cleanupOldReservations';
// 새 리뷰 작성 시 매장 owner에게 FCM 푸시.
export { notifyStoreOnReview } from './notifications/notifyStoreOnReview';
// 종료된 관심 토너 자동 삭제 — 매시간, 시작 시각+6h 지난 doc 정리
export { cleanupExpiredInterests } from './notifications/cleanupExpiredInterests';
// 시작 시각+3h 지났는데 LIVE 시작 안 된 scheduled 토너를 expired로 자동 변경
export { cleanupExpiredTournaments } from './notifications/cleanupExpiredTournaments';

// ===== LIVE =====
// 마지막 레벨 종료 후 그레이스(180초) 만료된 세션을 status=completed로 자동 정리.
// "실시간" 컨셉 보증 — 매장 사장 화면이 꺼져 있어도 서버에서 정리됨.
export { autoStopFinishedSessions } from './live/autoStopFinishedSessions';
// LIVE 세션 레벨 자동 진행 — 매장 어드민 화면 꺼져있어도 다음 레벨로 자동 전환
export { autoAdvanceLevel } from './live/autoAdvanceLevel';

// ===== Reviews — 매장 리뷰 집계 (reviewCount/averageRating/ratingDistribution) =====
export { aggregateReviewStats } from './reviews/aggregateReviewStats';

// ===== Moderation — reports 누적 3건 시 자동 숨김 (Phase B 클린봇) =====
export { autoHideOnReports } from './moderation/autoHideOnReports';

// ===== AdSlots — 매장 광고 노출권 (Sprint 3 Phase C, 2026-05-21) =====
// 활성 전이 시 stores 캐싱 필드 동기화.
export { onAdSlotActivate } from './ads/onAdSlotActivate';
// 매시간: 만료 → expired, 시작 → active 자동 전이.
export { scheduledAdSlotExpiry } from './ads/scheduledAdSlotExpiry';
// 매시간: impressions/clicks를 stores/{id}/metrics/ad_summary로 미러.
export { aggregateAdSlotImpressions } from './ads/aggregateAdSlotImpressions';

// ===== Series — 위성 예선 자동 집계 (M19 매핑) (v0.2+ 추가 예정) =====
// export { onSatelliteResultBatch } from './series/onSatelliteResultBatch';

// ===== Denormalized 동기화 (storeName 등) (v0.2+ 추가 예정) =====
// export { propagateStoreName } from './denorm/propagateStoreName';
