/**
 * 스모크 감사 — 3개 앱(사용자/매장/본사)의 핵심 화면을 한 번에 훑으며
 * 콘솔 에러·페이지 에러·4xx/5xx 응답·빈 화면을 자동 수집한다.
 * "구석구석 수동 점검이 너무 길다"를 줄이기 위한 반복 가능한 점검 도구.
 *
 * 사전 조건:
 *   - dev 서버 실행 중 (npm run dev) — 기본 http://localhost:3000
 *   - playwright 설치됨 (devDependency). 최초 1회: npx playwright install chromium
 *
 * 실행:
 *   # 사용자 앱만 (이메일 플레이어 계정)
 *   SMOKE_USER_EMAIL=... SMOKE_USER_PW=... node scripts/smoke-audit.mjs
 *
 *   # 본사·매장까지
 *   SMOKE_USER_EMAIL=.. SMOKE_USER_PW=.. \
 *   SMOKE_PLATFORM_EMAIL=.. SMOKE_PLATFORM_PW=.. \
 *   SMOKE_BIZ_EMAIL=.. SMOKE_BIZ_PW=.. SMOKE_STORE_ID=.. \
 *   node scripts/smoke-audit.mjs
 *
 * 환경변수:
 *   SMOKE_BASE            기본 http://localhost:3000
 *   SMOKE_USER_EMAIL/PW   사용자 앱(/m) — 이메일/비번 플레이어
 *   SMOKE_PLATFORM_EMAIL/PW  본사 어드민(/platform)
 *   SMOKE_BIZ_EMAIL/PW + SMOKE_STORE_ID  매장 어드민(/admin/{storeId})
 *
 * 출력: scripts/audit-out/*.png + 콘솔 요약(앱별 에러 건수, PASS/FAIL).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
const OUT = new URL('./audit-out/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
let totalErrors = 0;

function attachCollectors(page, errors, fails) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(page.url().replace(BASE, '') + ': ' + m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message.slice(0, 160)));
  page.on('response', (r) => { if (r.status() >= 400) fails.push(r.status() + ' ' + r.url().replace(BASE, '').slice(0, 90)); });
}
async function killPopup(page) {
  for (let i = 0; i < 4; i++) {
    const b = page.getByRole('button', { name: '닫기', exact: true }).first();
    if (await b.isVisible().catch(() => false)) { await b.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); } else break;
  }
}
async function walk(label, ctx, routes, opts = {}) {
  const page = await ctx.newPage();
  const errors = [], fails = [];
  attachCollectors(page, errors, fails);
  if (opts.login) await opts.login(page);
  console.log(`\n=== ${label} ===`);
  for (const [path, name] of routes) {
    const before = errors.length;
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' }).catch((e) => errors.push('GOTO ' + path + ': ' + e.message.slice(0, 80)));
    await page.waitForTimeout(opts.wait || 3000);
    await killPopup(page);
    await page.screenshot({ path: `${OUT}${label}_${name}.png` }).catch(() => {});
    const len = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
    const flag = len < 40 ? ' ⚠️빈화면?' : '';
    console.log(`  [${name}] ${path} | 콘솔에러+${errors.length - before} | 본문${len}${flag}`);
  }
  const uniq = [...new Set(errors)];
  if (uniq.length) { console.log(`  — 에러 ${uniq.length}건:`); uniq.slice(0, 12).forEach((e) => console.log('     ' + e)); }
  const uniqFail = [...new Set(fails.map((f) => f.replace(/[0-9a-f]{8,}/g, '*')))];
  if (uniqFail.length) { console.log(`  — 4xx/5xx ${uniqFail.length}종:`); uniqFail.slice(0, 8).forEach((f) => console.log('     ' + f)); }
  totalErrors += uniq.length;
  await page.close();
}
async function emailLogin(page, loginPath, email, pw, emailSel, pwSel) {
  await page.goto(BASE + loginPath, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.fill(emailSel, email);
  await page.locator(pwSel).first().fill(pw);
  await page.locator(pwSel).first().press('Enter');
  await page.waitForTimeout(4500);
}

// ── 사용자 앱 ──
if (process.env.SMOKE_USER_EMAIL) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await walk('user', ctx, [
    ['/m', 'home'], ['/m/find', 'find'], ['/m/live', 'live'], ['/m/calendar', 'calendar'],
    ['/m/favorites', 'favorites'], ['/m/reservations', 'reservations'],
    ['/m/community', 'community'], ['/m/notifications', 'notifications'], ['/m/my', 'my'],
  ], {
    wait: 3500,
    login: async (page) => {
      await emailLogin(page, '/login', process.env.SMOKE_USER_EMAIL, process.env.SMOKE_USER_PW,
        'input[type="email"]', 'input[placeholder="비밀번호 입력"]');
      await page.evaluate(() => localStorage.setItem('hn:onboardingSeen', '1'));
    },
  });
  await ctx.close();
}

// ── 본사 어드민 ──
if (process.env.SMOKE_PLATFORM_EMAIL) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await walk('platform', ctx, [
    ['/platform', 'dashboard'], ['/platform/members', 'members'], ['/platform/stores', 'stores'],
    ['/platform/live', 'live'], ['/platform/organizers', 'organizers'], ['/platform/reviews', 'reviews'],
    ['/platform/inquiries', 'inquiries'], ['/platform/prereg', 'prereg'],
  ], {
    login: async (page) => emailLogin(page, '/platform-login', process.env.SMOKE_PLATFORM_EMAIL, process.env.SMOKE_PLATFORM_PW,
      'input[placeholder="admin01 또는 admin@holdemnow.com"]', 'input[placeholder="••••••••"]'),
  });
  await ctx.close();
}

// ── 매장 어드민 ──
if (process.env.SMOKE_BIZ_EMAIL && process.env.SMOKE_STORE_ID) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await walk('store', ctx, [
    ['/admin/' + process.env.SMOKE_STORE_ID, 'dashboard'],
  ], {
    login: async (page) => emailLogin(page, '/login/business', process.env.SMOKE_BIZ_EMAIL, process.env.SMOKE_BIZ_PW,
      'input[placeholder="가입 시 등록한 이메일"]', 'input[placeholder="비밀번호"]'),
  });
  await ctx.close();
}

await browser.close();
console.log(`\n${totalErrors === 0 ? '✅ PASS' : '⚠️ ' + totalErrors + '건 에러'} — 스크린샷: scripts/audit-out/`);
process.exit(totalErrors === 0 ? 0 : 1);
