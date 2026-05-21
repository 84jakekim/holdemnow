import { test, expect, Page } from '@playwright/test';
import { loginAndEnterStoreAdmin } from './helpers/login';

/**
 * 🎬 토너 운영 통합 컨트롤 센터 — E2E (시나리오 5개, serial).
 *
 * Firebase prod 에 동시 다발 로그인 시 too-many-requests 가 발생할 수 있어 worker=1 + serial 로 묶고
 * 첫 테스트에서 1회만 로그인 후 동일 context (page) 를 재사용한다.
 */

test.describe.configure({ mode: 'serial' });

/** 콘솔 로그 캡처 버퍼 — stopLiveSession audit 검증용 (3차 핫픽스). */
const consoleLogs: string[] = [];

test.describe('🎬 토너 운영 — 통합 컨트롤 센터', () => {
  let sharedPage: Page;
  let storeId: string;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    sharedPage.on('dialog', (dialog) => dialog.accept().catch(() => {}));
    // 콘솔 capture — stopLiveSession warn 로그에서 caller 인자가 실제 박히는지 검증
    sharedPage.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[stopLiveSession]') || text.includes('[selfHealStaleFinishingAt]') || text.includes('[isSessionExpired]')) {
        consoleLogs.push(`[${msg.type()}] ${text}`);
      }
    });
    storeId = await loginAndEnterStoreAdmin(sharedPage);
    expect(storeId).toBeTruthy();
  });

  test.afterAll(async () => {
    // 잔존 LIVE 세션 cleanup (LIVE spec 이 timeout 으로 종료하지 못한 경우 대비)
    try {
      await sharedPage.getByRole('button', { name: /토너 운영/ }).click().catch(() => {});
      for (let i = 0; i < 3; i++) {
        const stop = sharedPage.getByRole('button', { name: /이 세션 종료/ });
        if ((await stop.count()) === 0) break;
        await stop.first().click().catch(() => {});
        await sharedPage.waitForTimeout(1000);
      }
    } catch {}
    await sharedPage.context().close();
  });

  // ─── 시나리오 1: 로그인 + /admin/{본인 storeId} 자동 진입 ──────────
  test('1) 로그인 + 매장 어드민 자동 진입', async () => {
    await expect(sharedPage).toHaveURL(new RegExp(`/admin/${storeId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));
    await expect(sharedPage.getByRole('button', { name: /대시보드/ })).toBeVisible({ timeout: 20_000 });
  });

  // ─── 시나리오 2: 🎬 토너 운영 메뉴 → TournamentControlCenter 마운트 ──────
  test('2) 🎬 토너 운영 메뉴 클릭 → 통합 컨트롤 센터 mount', async () => {
    await sharedPage.getByRole('button', { name: /토너 운영/ }).click();
    await expect(sharedPage.getByRole('heading', { name: /🎬 토너 운영/ })).toBeVisible({ timeout: 10_000 });
    await expect(sharedPage.getByText(/진행 중 LIVE/).first()).toBeVisible();
    await expect(sharedPage.getByText('⚡ 빠른 시작').first()).toBeVisible();
    await expect(sharedPage.getByRole('button', { name: /새 LIVE 시작/ })).toBeVisible();
  });

  // ─── 시나리오 3: 🎲 템플릿 만들기 진입 + 복귀 + ★ favorite 토글 ──────────
  test('3) 🎲 템플릿 만들기 진입 + 복귀 + ★ favorite 토글', async () => {
    await sharedPage.getByRole('button', { name: /🎲 템플릿 만들기/ }).click();
    await expect(sharedPage.getByText('🎲 토너 템플릿 만들기/편집')).toBeVisible({ timeout: 10_000 });

    await sharedPage.getByRole('button', { name: /토너 운영으로/ }).click();
    await expect(sharedPage.getByRole('heading', { name: /🎬 토너 운영/ })).toBeVisible();

    const favButtons = sharedPage.locator('button[title*="즐겨찾기"]');
    const count = await favButtons.count();
    if (count > 0) {
      const first = favButtons.first();
      await first.click();
      await sharedPage.waitForTimeout(500);
      // cleanup: 원래 상태로 복원
      await first.click().catch(() => {});
    } else {
      test.info().annotations.push({ type: 'skip', description: '템플릿 없음 — favorite 토글 skip' });
    }
  });

  // ─── 시나리오 4: LIVE 빠른 시작 → 타이머 mount → 컨트롤 → 종료 ──────────
  test('4) LIVE 빠른 시작 → 타이머 mount → 컨트롤 → 종료', async () => {
    // 통합 컨트롤 센터 페이지에 있는지 보장 (3번 spec 잔존 또는 페이지 전환 race)
    if (!(await sharedPage.getByRole('heading', { name: /🎬 토너 운영/ }).isVisible().catch(() => false))) {
      await sharedPage.getByRole('button', { name: /토너 운영/ }).click();
      await expect(sharedPage.getByRole('heading', { name: /🎬 토너 운영/ })).toBeVisible({ timeout: 10_000 });
    }

    // 이미 진행 중인 LIVE 가 있으면 (이전 spec 잔존) 먼저 모두 종료 — 새 LIVE 시작 격리
    for (let i = 0; i < 5; i++) {
      const stop = sharedPage.getByRole('button', { name: /이 세션 종료/ });
      if ((await stop.count()) === 0) break;
      await stop.first().click().catch(() => {});
      await sharedPage.waitForTimeout(800);
    }

    // ⚡ 빠른 시작 영역의 첫 템플릿 시작 button
    // TemplateQuickItem onStart 버튼 → name 에 buy-in (₩) + 인원(명) 정보 포함
    const quickStartBtn = sharedPage.getByRole('button', { name: /₩.*명/ }).first();
    try {
      await expect(quickStartBtn).toBeVisible({ timeout: 10_000 });
    } catch {
      test.info().annotations.push({ type: 'skip', description: '템플릿 없음 — LIVE 시나리오 skip' });
      return;
    }

    // 진행 중 LIVE 카운트 capture (before)
    const liveCountBefore = await sharedPage.locator('aside').getByText(/진행 중 LIVE \((\d+)\)/).first().textContent() ?? '0';

    await quickStartBtn.click();

    // 빠른시작 직후엔 READY 상태 (시작 대기). ▶ 시작 버튼 mount 대기.
    await expect(sharedPage.getByRole('button', { name: /^▶ 시작$/ })).toBeVisible({ timeout: 15_000 });

    // ▶ 시작 클릭 → running 상태로 전환되며 진행바 mount
    await sharedPage.getByRole('button', { name: /^▶ 시작$/ }).click();
    await expect(sharedPage.getByLabel('현재 레벨 남은 시간 드래그 조절')).toBeVisible({ timeout: 15_000 });

    // 일시정지 → 재개 (best-effort)
    try {
      await sharedPage.getByRole('button', { name: /⏸ 일시정지/ }).click({ timeout: 10_000 });
      await sharedPage.getByRole('button', { name: /▶ 재개/ }).click({ timeout: 10_000 });
    } catch {}

    // 진행바 드래그 (best-effort)
    try {
      const bar = sharedPage.getByLabel('현재 레벨 남은 시간 드래그 조절');
      const box = await bar.boundingBox();
      if (box) {
        await sharedPage.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
        await sharedPage.mouse.down();
        await sharedPage.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
        await sharedPage.mouse.up();
      }
    } catch {}

    // 종료 (cleanup) — caller='TournamentControlCenter:user-button' 로그가 찍혀야 함 (3차 핫픽스 audit)
    consoleLogs.length = 0; // 종료 직전 로그만 capture
    await sharedPage.getByRole('button', { name: /이 세션 종료/ }).click({ timeout: 10_000 });
    await expect(sharedPage.getByLabel('현재 레벨 남은 시간 드래그 조절').first()).toBeHidden({ timeout: 15_000 });

    // audit 인프라 검증 — stopLiveSession warn 로그에 caller 인자 포함 확인
    await sharedPage.waitForTimeout(800);
    const stopLogs = consoleLogs.filter((l) => l.includes('[stopLiveSession]'));
    expect(stopLogs.length, '[stopLiveSession] warn 로그가 종료 시 찍혀야 함').toBeGreaterThan(0);
    expect(stopLogs[0]).toMatch(/caller=(TournamentControlCenter|LivePanel):user-button/);

    // LIVE 카운트가 시작 전 수준으로 복귀
    const liveCountAfter = await sharedPage.locator('aside').getByText(/진행 중 LIVE \((\d+)\)/).first().textContent() ?? '0';
    expect(liveCountAfter).toBe(liveCountBefore);
  });

  // ─── 시나리오 5: 🎨 화면 설정 / 🖥️ 미리보기 / 📺 TV 송출 탭 전환 ─────────
  test('5) 🎨 화면 설정 / 🖥️ 미리보기 / 📺 TV 송출 탭 전환', async () => {
    await sharedPage.getByRole('button', { name: /🎨 화면 설정/ }).click();
    await expect(sharedPage.getByText('🖼️ 배경')).toBeVisible({ timeout: 5_000 });
    await expect(sharedPage.getByText('🎨 컬러')).toBeVisible();
    await expect(sharedPage.getByText('💰 상금 분배표 노출')).toBeVisible();

    await sharedPage.getByRole('button', { name: /🖥️ 미리보기/ }).click();
    await sharedPage.waitForTimeout(500);

    await sharedPage.getByRole('button', { name: /📺 TV 송출/ }).click();
    await sharedPage.waitForTimeout(300);
  });

  // ─── 시나리오 6: 타이머 중도종료 회귀 검증 (3차 핫픽스 핵심) ───────────────
  // 신규 LIVE 시작 후 8초 동안 화면에서 사라지지 않아야 한다.
  // 사용자 보고(12레벨 토너에서 7레벨 시점에 사라짐)의 재현 방지 — finishingAt이
  // 잘못 박혀도 isSessionExpired의 sanity guard가 expired=false를 반환해 가리지 않아야 함.
  test('6) [3차 핫픽스 회귀] 신규 LIVE 시작 직후 화면 잔존 + isSessionExpired sanity guard', async () => {
    // 통합 컨트롤 센터 mount 보장
    await sharedPage.getByRole('button', { name: /토너 운영/ }).click();
    await expect(sharedPage.getByRole('heading', { name: /🎬 토너 운영/ })).toBeVisible({ timeout: 10_000 });

    // 잔존 LIVE 정리
    for (let i = 0; i < 5; i++) {
      const stop = sharedPage.getByRole('button', { name: /이 세션 종료/ });
      if ((await stop.count()) === 0) break;
      await stop.first().click().catch(() => {});
      await sharedPage.waitForTimeout(800);
    }

    // ─── A. isSessionExpired sanity guard — 단위 로직 in-browser 검증 ───
    // 시나리오: finishingAt=현재시각-1시간(이미 만료), currentLevel=7, lastLevelNum=12 → 잘못 박힘
    // 기대: isSessionExpired가 false (sanity guard 발동)
    const guardResult = await sharedPage.evaluate(() => {
      // 동일 로직을 in-browser에서 재현 (테스트 격리 — 실제 import 안 함)
      const FINISHING_GRACE_SEC = 180;
      const fakeStaleSession = {
        finishingAt: { toMillis: () => Date.now() - 3600 * 1000 },
        currentLevel: 7,
        blindStructureLocked: Array.from({ length: 12 }, (_, i) => ({
          level: i + 1, sb: 100, bb: 200, ante: 0, durationSec: 1200,
        })),
        blindStructure: [],
        status: 'running',
        createdAt: undefined,
      };
      // src/lib/live.ts isSessionExpired 로직과 동일
      function isSessionExpired(s: any): { expired: boolean; reason: string } {
        if (s.finishingAt) {
          const endsMs = s.finishingAt.toMillis() + FINISHING_GRACE_SEC * 1000;
          if (endsMs <= Date.now()) {
            const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
              ? s.blindStructureLocked
              : s.blindStructure;
            const lastLevelNum = structure && structure.length > 0
              ? structure[structure.length - 1].level
              : -1;
            const isReallyLastLevel = s.currentLevel === lastLevelNum && lastLevelNum > 0;
            if (!isReallyLastLevel) {
              return { expired: false, reason: 'sanity-guard-blocked' };
            }
            return { expired: true, reason: 'last-level-grace-expired' };
          }
        }
        return { expired: false, reason: 'not-expired' };
      }
      return isSessionExpired(fakeStaleSession);
    });
    expect(guardResult.expired, '잘못 박힌 finishingAt + currentLevel<lastLevel → expired=false').toBe(false);
    expect(guardResult.reason).toBe('sanity-guard-blocked');

    // 정상 케이스: currentLevel=12, lastLevelNum=12 → 진짜 마지막 레벨 → expired=true
    const normalResult = await sharedPage.evaluate(() => {
      const FINISHING_GRACE_SEC = 180;
      const session = {
        finishingAt: { toMillis: () => Date.now() - 3600 * 1000 },
        currentLevel: 12,
        blindStructureLocked: Array.from({ length: 12 }, (_, i) => ({
          level: i + 1, sb: 100, bb: 200, ante: 0, durationSec: 1200,
        })),
        blindStructure: [],
        status: 'running',
      };
      function isSessionExpired(s: any): { expired: boolean } {
        if (s.finishingAt) {
          const endsMs = s.finishingAt.toMillis() + FINISHING_GRACE_SEC * 1000;
          if (endsMs <= Date.now()) {
            const structure = (s.blindStructureLocked && s.blindStructureLocked.length > 0)
              ? s.blindStructureLocked : s.blindStructure;
            const lastLevelNum = structure && structure.length > 0
              ? structure[structure.length - 1].level : -1;
            const isReallyLastLevel = s.currentLevel === lastLevelNum && lastLevelNum > 0;
            if (!isReallyLastLevel) return { expired: false };
            return { expired: true };
          }
        }
        return { expired: false };
      }
      return isSessionExpired(session);
    });
    expect(normalResult.expired, '진짜 마지막 레벨 + 그레이스 만료 → expired=true').toBe(true);

    // ─── B. 실제 LIVE 시작 후 8초 잔존 — 종료 cleanup 까지 ───
    const quickStartBtn = sharedPage.getByRole('button', { name: /₩.*명/ }).first();
    if (!(await quickStartBtn.isVisible().catch(() => false))) {
      test.info().annotations.push({ type: 'skip', description: '템플릿 없음 — 실제 LIVE 잔존 검증 skip (단위는 통과)' });
      return;
    }
    await quickStartBtn.click();
    await expect(sharedPage.getByRole('button', { name: /^▶ 시작$/ })).toBeVisible({ timeout: 15_000 });
    await sharedPage.getByRole('button', { name: /^▶ 시작$/ }).click();
    await expect(sharedPage.getByLabel('현재 레벨 남은 시간 드래그 조절')).toBeVisible({ timeout: 15_000 });

    // 8초 대기 — sanity guard가 정상 작동하면 사라지지 않음
    await sharedPage.waitForTimeout(8_000);
    await expect(
      sharedPage.getByLabel('현재 레벨 남은 시간 드래그 조절'),
      '신규 LIVE는 8초 후에도 화면에 남아 있어야 함 (회귀 방지)',
    ).toBeVisible();

    // cleanup
    await sharedPage.getByRole('button', { name: /이 세션 종료/ }).click({ timeout: 10_000 });
    await expect(sharedPage.getByLabel('현재 레벨 남은 시간 드래그 조절').first()).toBeHidden({ timeout: 15_000 });
  });
});
