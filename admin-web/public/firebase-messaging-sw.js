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

// 알림 클릭 시 적절한 URL로 이동
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/m';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
