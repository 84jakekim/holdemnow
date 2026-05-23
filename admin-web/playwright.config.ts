import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config — Pink Rabbit admin-web
 *
 * 환경 (PM 결정 2026-05-21):
 *   - 기본: 로컬 dev server (npm run dev) 에 붙음. 실제 Firestore (prod)에 read/write.
 *   - 격리: thethego@naver.com (platform_admin) 이 owner가 아닌 demo-store-seomyeon에서 동작.
 *   - cleanup: 각 spec 내부 afterEach 또는 finally 블록에서 세션 종료/템플릿 토글 원복.
 *
 * 사용법:
 *   1. 별도 터미널에서 `npm run dev` (포트 3000)
 *   2. `npm run test:e2e`
 *
 * BASE_URL 환경변수로 prod URL 사용 가능: `BASE_URL=https://app.holdemnow.kr npm run test:e2e`
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // 같은 매장 동시 수정 방지 — 시리얼 실행
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // Firebase Auth 세션은 IndexedDB에 저장돼 Playwright storageState로 재사용 불가.
  // → 각 spec이 helpers/login.ts 의 loginAsPlatformAdmin()으로 매번 로그인 (시간 ~3초)
  projects: [
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
