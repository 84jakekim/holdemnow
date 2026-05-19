/**
 * Firebase Cloud Messaging Service Worker.
 * 백그라운드 푸시 메시지 처리 (탭이 꺼져있거나 다른 탭에 있을 때).
 *
 * Firebase Web Push가 동작하려면 이 파일이 반드시 `/firebase-messaging-sw.js` 경로에 있어야 합니다.
 * compat 빌드를 사용하는 게 SW 환경에선 표준.
 */
/* eslint-disable */
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js');

// Firebase 설정값 — apiKey/projectId만 있어도 messaging 동작.
// 클라이언트와 동일한 값. messagingSenderId/appId는 푸시 라우팅에 필수.
firebase.initializeApp({
  apiKey: 'AIzaSyC3WVSca1WpLk8O81cS8JqNWELBDj_Jocg',
  authDomain: 'holdemnow-prod.firebaseapp.com',
  projectId: 'holdemnow-prod',
  storageBucket: 'holdemnow-prod.firebasestorage.app',
  messagingSenderId: '279366919379',
  appId: '1:279366919379:web:486f079698915469852026',
});

const messaging = firebase.messaging();

// 백그라운드 메시지 (탭 꺼짐/포커스 X) — 직접 알림 표시
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'HoldemNow';
  const options = {
    body: payload.notification?.body || '',
    icon: '/icon-app.svg',
    badge: '/icon-app.svg',
    tag: payload.data?.tag || 'holdemnow-notification',
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

// 알림 클릭 시 적절한 URL로 이동.
// 마케팅 캠페인 푸시는 data.url에 /m/campaigns/{id} 또는 외부 URL을 담아 보냄.
// fcmOptions.link 폴백도 지원 (FCM webpush 표준).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // 우선순위: data.url → data.FCM_MSG.notification.click_action → '/m'
  const url =
    data.url ||
    data?.FCM_MSG?.notification?.click_action ||
    '/m';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 이미 열려 있는 동일 origin 탭이 있으면 그 탭으로 navigate + focus
        for (const c of clientList) {
          if ('focus' in c) {
            // navigate가 지원되는 경우만 시도 (Safari/구형 브라우저 대비)
            if ('navigate' in c) {
              try {
                c.navigate(url);
              } catch {
                // cross-origin 등으로 navigate 실패 시 무시 — focus만
              }
            }
            return c.focus();
          }
        }
        // 열린 탭 없으면 새 창
        return self.clients.openWindow(url);
      }),
  );
});

// ===== PWA Installability =====
// 크롬은 fetch 이벤트 핸들러가 있어야 PWA로 설치 가능하다고 판단합니다.
// 이 핸들러는 네트워크 요청을 가로채지 않고 그대로 통과시키지만,
// 존재만으로 "이 사이트는 설치 가능한 PWA"라는 신호를 줍니다.
// v0.2에서 Workbox/Serwist로 본격적인 오프라인 캐시 전략 추가 예정.
self.addEventListener('fetch', (event) => {
  // No-op — 그냥 네트워크로 보냄. 캐시는 v0.2.
});

// 새 SW 즉시 활성화 (배포 후 사용자가 새 버전 빠르게 받게)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
