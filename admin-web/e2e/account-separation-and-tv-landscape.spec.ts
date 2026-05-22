import { test, expect } from '@playwright/test';
import { logout } from './helpers/login';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 2026-05-22 PM 단독 핫픽스 — 자체 회귀 spec
 *
 * 검증 시나리오:
 *  A) 계정 분리 — /login (일반)에 매장 어드민 이메일(thethego@naver.com) 입력 시
 *     로그인이 차단되고 차단 메시지가 표시되어야 함.
 *  B) 매장 어드민 이메일은 /login/business 에서는 정상 통과 → /admin/{storeId} 진입.
 *  C) /display/{storeId}/{slotNum} 페이지 소스에 가로 모드 강제 로직 + 안내 문구가
 *     포함되어 있어야 함 (정적 검증 — fullscreen/orientation API는 headless에서 제한).
 */

test.describe.serial('🔒 계정 분리 + 📺 TV 가로 모드 (2026-05-22 핫픽스)', () => {
  test.beforeEach(async ({ page }) => {
    // 매 spec 시작 시 잔존 세션 제거 — Firebase Auth IndexedDB까지 클린.
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await logout(page);
  });

  test('A) /login 에 매장 어드민 이메일 입력 → 로그인 차단 + 안내 메시지', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    // hydration 대기 — 이메일 input에 React fiber 부착될 때까지
    await page.waitForFunction(
      () => {
        const inp = document.querySelector('input[type="email"]') as HTMLInputElement | null;
        if (!inp) return false;
        return Object.keys(inp).some((k) => k.startsWith('__react'));
      },
      { timeout: 15_000 },
    ).catch(() => {});

    await page.getByPlaceholder('이메일 주소').fill('thethego@naver.com');
    await page.getByPlaceholder('비밀번호').fill('Xorud1313!!');

    // 버튼 enable 대기
    await page.waitForFunction(
      () => {
        const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
        const target = btns.find((b) => (b.textContent || '').trim() === '로그인');
        return target ? !target.disabled : false;
      },
      { timeout: 10_000 },
    );

    await page.getByPlaceholder('비밀번호').press('Enter');

    // 차단 안내 — 두 가지 경로 모두 정상:
    //  (1) loginWithEmailExpecting 가 즉시 signOut → "일반 사용자 계정이 아닙니다" inline error
    //  (2) AuthGate path-vs-role 검사가 더 빠르게 hit → "매장 어드민 계정으로 로그인되어 있습니다" 카드
    await expect(
      page.getByText(/일반 사용자 계정이 아닙니다|매장 어드민 계정으로 로그인되어 있습니다|매장.*대회사 로그인/),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('B) /login/business 에 매장 어드민 이메일 입력 → /admin/{storeId} 정상 진입', async ({ page }) => {
    await page.goto('/login/business');
    await page.waitForLoadState('domcontentloaded');

    await page.waitForFunction(
      () => {
        const inp = document.querySelector('input[type="email"]') as HTMLInputElement | null;
        if (!inp) return false;
        return Object.keys(inp).some((k) => k.startsWith('__react'));
      },
      { timeout: 15_000 },
    ).catch(() => {});

    await page.getByPlaceholder('가입 시 등록한 이메일').fill('thethego@naver.com');
    await page.getByPlaceholder('비밀번호').first().fill('Xorud1313!!');

    await page.waitForFunction(
      () => {
        const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
        const target = btns.find((b) => /매장.*대회사 로그인/.test(b.textContent || ''));
        return target ? !target.disabled : false;
      },
      { timeout: 10_000 },
    );

    await page.getByPlaceholder('비밀번호').first().press('Enter');

    // /admin/{storeId} 로 redirect 대기
    await page.waitForURL(/\/admin\/[^/]+/, { timeout: 25_000 });
    expect(page.url()).toMatch(/\/admin\//);
  });

  test('C) /display 페이지 소스 — 가로 모드 강제 로직 + 사용자 안내 문구 포함', () => {
    // 가로 모드 강제는 fullscreen + screen.orientation.lock + CSS rotate fallback 조합.
    // Playwright headless는 fullscreen/orientation API가 제한적이라 런타임 검증 불안정 →
    // 페이지 소스 정적 검증으로 핵심 로직 + 안내 문구가 들어가 있는지만 확인.
    // 실기기 검증은 사용자가 모바일 Chrome / iOS Safari 에서 직접.
    const sourcePath = join(
      __dirname,
      '..',
      'src',
      'app',
      'display',
      '[storeId]',
      '[slotNum]',
      'page.tsx',
    );
    const source = readFileSync(sourcePath, 'utf-8');

    // ① orientation lock API 호출 (enterFullscreenMode 안에서)
    expect(source).toMatch(/orientation\.lock\(['"]landscape['"]\)/);
    // ② CSS rotate fallback (needsCssRotate 상태)
    expect(source).toMatch(/needsCssRotate/);
    expect(source).toMatch(/rotate\(90deg\)/);
    // ③ 사운드 활성화 오버레이의 가로 모드 안내 문구
    expect(source).toContain('TV 송출 시작');
    expect(source).toMatch(/가로.*landscape.*회전|가로\(landscape\)/);
    // ④ fullscreen + wakeLock 통합 호출 (기존 동작 유지)
    expect(source).toMatch(/requestFullscreen|webkitRequestFullscreen/);
    expect(source).toMatch(/wakeLock\.request/);
  });

  test('D) /display 정정 사양 (2026-05-22 PM 단독) — 자동 가로 강제 X, 버튼 트리거 + 세로 컴팩트', () => {
    // 5bcc1b8 race 핫픽스 사양:
    //  • 기본 진입 = 세로 모드 (자동 가로 강제 X)
    //  • "전체화면" 버튼 클릭 시에만 가로 진입
    //  • 모바일 세로 컴팩트 레이아웃 (MobilePortraitLayout)
    //  • fullscreenchange exit 시 자연 복귀
    const sourcePath = join(
      __dirname,
      '..',
      'src',
      'app',
      'display',
      '[storeId]',
      '[slotNum]',
      'page.tsx',
    );
    const source = readFileSync(sourcePath, 'utf-8');

    // ① enterFullscreenMode/exitFullscreenMode 핸들러 분리 (사용자 명시적 클릭만)
    expect(source).toMatch(/enterFullscreenMode/);
    expect(source).toMatch(/exitFullscreenMode/);
    // ② 모바일 세로 컴팩트 레이아웃 컴포넌트
    expect(source).toMatch(/MobilePortraitLayout/);
    expect(source).toMatch(/isMobilePortrait/);
    // ③ "전체화면" 버튼 텍스트
    expect(source).toMatch(/전체화면/);
    // ④ 자동 가로 강제 제거 — tryActivate 안에서 requestLandscapeSafe 호출 X
    expect(source).not.toMatch(/requestLandscapeSafe\(\)/);
    // ⑤ fullscreenchange + webkitfullscreenchange 둘 다 처리 (iOS Safari)
    expect(source).toMatch(/fullscreenchange/);
    expect(source).toMatch(/webkitfullscreenchange/);
    // ⑥ isFullscreenActive 상태로 진입/종료 버튼 토글
    expect(source).toMatch(/isFullscreenActive/);
  });
});
