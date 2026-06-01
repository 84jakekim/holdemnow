/* eslint-disable */
const { chromium, devices } = require('playwright');

const URL = 'https://holdemnow--holdemnow-prod.us-east4.hosted.app';
const BUSAN = { latitude: 35.1796, longitude: 129.0756 };
const EMAIL = 'shotter@admin.pinkrabbit.local';
const PASSWORD = 'shot111';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    locale: 'ko-KR',
    geolocation: BUSAN,
    permissions: ['geolocation'],
  });
  const page = await ctx.newPage();

  await page.goto(URL + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // splash가 사라지고 input이 mount될 때까지 명시적 대기
  await page.locator('input[type="email"], input[type="text"]').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(500);
  console.log('✓ 입력폼 등장');

  await page.locator('input[type="email"], input[type="text"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("로그인")').first().click();
  console.log('✓ 제출');

  // 로그인 성공: URL 바뀌거나 splash 다시 뜸
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 30000 });
  console.log('✓ 로그인 → URL:', page.url());
  await page.waitForTimeout(3000);

  // /m/find로 직접 이동
  await page.goto(URL + '/m/find', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 매장 카드 mount될 때까지 대기 (NEARBY 섹션의 카드)
  await page.locator('a[href^="/m/store/"]').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => null);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'shot-1-find.png', fullPage: false });
  await page.screenshot({ path: 'shot-2-find-full.png', fullPage: true });
  console.log('✓ /m/find 캡처 2장');

  // /m (홈탭)
  await page.goto(URL + '/m', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: 'shot-3-home.png', fullPage: false });
  console.log('✓ /m 홈탭 캡처');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
