import { Page, expect } from '@playwright/test';

/**
 * thethego@naver.com 로그인 helper.
 *
 * 메모리상 "총관리자"로 표기되어 있으나, prod Firestore의 user 문서에는 storeId가 채워진
 * 매장 owner 계정으로 등록되어 있다 (platform_admin 미부여 또는 storeId와 공존).
 * → /platform-login 사용 시 "매장 사장 계정" 경고가 뜬다.
 * → /login/business 사용 시 자동으로 /admin/{본인 storeId} 로 redirect 된다.
 *
 * 이 함수는 로그인 + 매장 어드민 진입까지 보장하고, 진입한 storeId 를 리턴한다.
 *
 * Firebase Auth 세션은 IndexedDB 에 저장되어 Playwright storageState 로 재사용 불가 → spec 마다 호출.
 */
export async function loginAndEnterStoreAdmin(page: Page): Promise<string> {
  await page.goto('/login/business');

  // 페이지 로드 + hydration 대기 — dev server cold start 시 hydration 늦음
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle').catch(() => {});

  // 이미 로그인 상태(이전 spec 잔존)면 자동으로 /admin/{storeId} 로 redirect 된다.
  // 새로 로그인 필요한 경우만 form fill.
  const emailField = page.getByPlaceholder('가입 시 등록한 이메일');
  const isLoginVisible = await emailField.isVisible({ timeout: 15_000 }).catch(() => false);
  if (isLoginVisible) {
    // hydration 완료 보장 — React state setter 가 attach 되었는지 확인
    await page.waitForFunction(
      () => {
        const inp = document.querySelector('input[type="email"]') as HTMLInputElement | null;
        if (!inp) return false;
        // React 19 fiber 가 input 에 attach 되면 __reactProps$ 등이 생긴다
        return Object.keys(inp).some((k) => k.startsWith('__react'));
      },
      { timeout: 15_000 },
    ).catch(() => {});

    await emailField.fill('thethego@naver.com');
    const pwField = page.getByPlaceholder('비밀번호').first();
    await pwField.fill('Xorud1313!!');
    // disabled 풀릴 때까지 polling (React state 반영 race 회피)
    await page.waitForFunction(
      () => {
        const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
        const target = btns.find((b) => /매장.*대회사 로그인/.test(b.textContent || ''));
        return target ? !target.disabled : false;
      },
      { timeout: 10_000 },
    );
    // Enter 키로 form submit
    await pwField.press('Enter');
  }

  // /admin/{storeId} 로 redirect 대기
  await page.waitForURL(/\/admin\/[^/]+/, { timeout: 25_000 });
  const url = page.url();
  const match = url.match(/\/admin\/([^/?#]+)/);
  if (!match) throw new Error(`/admin/{storeId} 로 진입 실패: ${url}`);
  return match[1];
}

/**
 * 로그아웃 — Firebase signOut + IndexedDB 잔존 세션 제거.
 * spec 사이의 격리 위해 사용 (필요 시).
 */
export async function logout(page: Page) {
  await page.evaluate(async () => {
    try {
      const dbs = await (indexedDB as any).databases?.();
      if (dbs) {
        for (const db of dbs) {
          if (db.name) indexedDB.deleteDatabase(db.name);
        }
      }
    } catch {}
    try {
      sessionStorage.clear();
      localStorage.clear();
    } catch {}
  });
  await page.context().clearCookies();
}
