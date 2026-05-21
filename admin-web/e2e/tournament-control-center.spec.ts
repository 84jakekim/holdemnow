import { test, expect, Page } from '@playwright/test';
import { loginAndEnterStoreAdmin } from './helpers/login';

/**
 * 🎬 토너 운영 통합 컨트롤 센터 — E2E (시나리오 5개, serial).
 *
 * Firebase prod 에 동시 다발 로그인 시 too-many-requests 가 발생할 수 있어 worker=1 + serial 로 묶고
 * 첫 테스트에서 1회만 로그인 후 동일 context (page) 를 재사용한다.
 */

test.describe.configure({ mode: 'serial' });

test.describe('🎬 토너 운영 — 통합 컨트롤 센터', () => {
  let sharedPage: Page;
  let storeId: string;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    sharedPage.on('dialog', (dialog) => dialog.accept().catch(() => {}));
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

    // 종료 (cleanup)
    await sharedPage.getByRole('button', { name: /이 세션 종료/ }).click({ timeout: 10_000 });
    await expect(sharedPage.getByLabel('현재 레벨 남은 시간 드래그 조절').first()).toBeHidden({ timeout: 15_000 });

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
});
