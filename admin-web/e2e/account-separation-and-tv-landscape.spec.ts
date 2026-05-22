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
    // 2026-05-23 핫픽스: CSS rotate fallback 폐기.
    // orientation lock 실패 시 자체 회전하지 않고 사용자에게 직접 가로 회전 안내(띠) 노출.
    // 페이지 소스 정적 검증으로 핵심 로직 + 안내 문구가 들어가 있는지만 확인.
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
    // ② CSS rotate fallback 폐기 — 외곽 rotate(90deg) 사용 X
    expect(source).not.toMatch(/transform:\s*['"]rotate\(90deg\)['"]/);
    // ③ orientation lock 실패 시 안내 띠 노출 (showLandscapeHint)
    expect(source).toMatch(/showLandscapeHint/);
    expect(source).toMatch(/기기를 가로로 돌려주세요/);
    // ④ 사운드 활성화 오버레이의 가로 모드 안내 문구
    expect(source).toContain('TV 송출 시작');
    expect(source).toMatch(/가로\(landscape\)|가로.*돌려/);
    // ⑤ fullscreen + wakeLock 통합 호출 (기존 동작 유지)
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

  test('E) /display 모바일 가로 전용 레이아웃 (2026-05-23 핫픽스) — 3분할 + 컨트롤 + 드래그바 + 권한 게이팅', () => {
    // 2026-05-23 핫픽스 사양:
    //  • CSS rotate fallback 폐기 → orientation lock 실패 시 안내 띠만 노출
    //  • 가로 모드 진입 시 MobileLandscapeLayout (3분할 + 컨트롤 행 + 드래그 진행바)
    //  • 컨트롤 6종: ⏮/⏸/⏭/−1분/+1분/⏹종료/⛶종료
    //  • 권한자(canControl)만 컨트롤 노출, 그 외는 로그인 버튼 또는 안내
    //  • 진행률 바 드래그로 디테일 시간 조절 (LandscapeDraggableProgressBar)
    //  • 권한 fallback: storeDoc.ownerUid === uid 면 role 미설정이어도 owner 인정
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

    // ① 가로 전용 레이아웃 컴포넌트 + 감지 상태
    expect(source).toMatch(/MobileLandscapeLayout/);
    expect(source).toMatch(/isMobileLandscape/);

    // ② 컨트롤 핸들러 6종 + 드래그 핸들러
    expect(source).toMatch(/handleTogglePause/);
    expect(source).toMatch(/handlePrevLevel/);
    expect(source).toMatch(/handleNextLevel/);
    expect(source).toMatch(/handleAddMinute/);
    expect(source).toMatch(/handleStopSession/);
    expect(source).toMatch(/handleSetTimeRemaining/);
    // ⛶ 전체화면 종료는 exitFullscreenMode 재활용
    expect(source).toMatch(/onExitFullscreen/);

    // ③ live.ts 컨트롤 함수 호출 (silent fail X — try/catch + canControl 게이팅)
    expect(source).toMatch(/togglePauseSession\(/);
    expect(source).toMatch(/goToLevelInSession\(/);
    expect(source).toMatch(/addSecondsToSession\(/);
    expect(source).toMatch(/stopLiveSession\(/);
    expect(source).toMatch(/setTimeRemainingInSession\(/);

    // ④ 권한 판정: useAuth + useUserDoc + useStoreDoc + hasRole + ownerUid fallback
    expect(source).toMatch(/useAuth\(\)/);
    expect(source).toMatch(/useUserDoc\(/);
    expect(source).toMatch(/useStoreDoc\(/);
    expect(source).toMatch(/hasRole\(userDoc, ['"]platform_admin['"]\)/);
    expect(source).toMatch(/hasRole\(userDoc, ['"]store_master['"]\)/);
    expect(source).toMatch(/hasRole\(userDoc, ['"]store_staff['"]\)/);
    expect(source).toMatch(/canControl/);
    // 핫픽스: storeDoc.ownerUid === authedUid 단독 통과 (role-missing fallback)
    expect(source).toMatch(/storeDoc\?\.ownerUid && storeDoc\.ownerUid === authedUid/);

    // ⑤ 진행률 바 드래그 — 가로 전용 컴포넌트 + onCommit 핸들러
    expect(source).toMatch(/LandscapeDraggableProgressBar/);
    expect(source).toMatch(/onSetTimeRemaining/);
    expect(source).toMatch(/onCommit/);

    // ⑥ 세션 종료 확인 모달 (실수 방지)
    expect(source).toMatch(/window\.confirm/);

    // ⑦ 우측 상단 진입 버튼은 데스크탑/대형 TV에서만 (모바일 세로/가로에서 미노출)
    //    조건: !isMobilePortrait && !isMobileLandscape
    expect(source).toMatch(/!isMobilePortrait\s*&&\s*!isMobileLandscape/);

    // ⑧ 비권한자 안내 — READ-ONLY 텍스트 폐기. 비로그인 시 로그인 버튼, 로그인됐지만
    //    권한 없으면 안내 텍스트
    expect(source).toMatch(/매장 사장님이신가요\?/);
    expect(source).toMatch(/owner 계정으로 로그인하면/);
    // 이전 "🔒 READ-ONLY · 운영 컨트롤은 매장 관리자만" 라인은 제거되어야
    expect(source).not.toMatch(/🔒 READ-ONLY · 운영 컨트롤은 매장 관리자만/);

    // ⑨ 세로 컴팩트 레이아웃 하단 버튼 — subtle 톤 (노란 풀필 제거)
    const portraitButtonRegion = source.match(/전체화면 진입 안내 띠[\s\S]*?<\/button>/);
    if (portraitButtonRegion) {
      expect(portraitButtonRegion[0]).not.toMatch(/bg-amber-500/);
      expect(portraitButtonRegion[0]).not.toMatch(/border-amber-300/);
    }
  });
});
