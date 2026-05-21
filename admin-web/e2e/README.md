# E2E 테스트 — Playwright

## 환경 (PM 결정 2026-05-21)

- **prod Firestore + 로컬 dev server**: emulator setup 비용 + 시드 데이터 관리 비용보다 단순.
- **계정**: `thethego@naver.com` / `Xorud1313!!`
  - 메모리는 "총관리자"라 했으나 prod user 문서에 `storeId`가 채워진 매장 owner.
  - `/login/business` 사용 시 본인 매장 `/admin/{storeId}` 로 자동 redirect.
  - `/platform-login` 사용 시 "매장 사장 계정" 경고 발생 — 사용하지 않음.
- **serial 실행**: 5개 시나리오 한 spec 파일 안에서 `describe.configure({ mode: 'serial' })`. `beforeAll` 에서 1회만 로그인 → sharedPage 재사용 (Firebase Auth IndexedDB 세션 유지 + prod rate limit 회피).
- **cleanup**: 4번 시나리오 시작 시 잔존 LIVE 모두 종료 → 새 LIVE 시작 → 컨트롤 → 종료. `afterAll` 에서 한 번 더 재확인.

## 실행

```bash
# 1) 별도 터미널 — dev server 기동
cd admin-web
npm run dev

# 2) 또 다른 터미널 — E2E 실행
cd admin-web
npm run test:e2e
```

전체 5개 시나리오가 ~10초 안에 완료된다.

## 시나리오 (한 spec 파일 안에 serial 실행)

파일: `e2e/tournament-control-center.spec.ts`

1. **로그인 + 매장 어드민 자동 진입** — `/login/business` 폼 입력 → `/admin/{본인 storeId}` redirect
2. **🎬 토너 운영 메뉴 클릭** — TournamentControlCenter 마운트 + 좌(진행 중 LIVE, ⚡ 빠른 시작) + 우(▶ 새 LIVE 시작) 검증
3. **🎲 템플릿 만들기 진입 + 복귀 + ★ favorite 토글** — 편집 화면 진입/복귀 + 즐겨찾기 ON/OFF 원복
4. **LIVE 빠른 시작 → 타이머 mount → 종료** — 잔존 세션 cleanup → 빠른시작 → READY → ▶ 시작 → 진행바 mount → 일시정지/재개 → 진행바 드래그 → ■ 종료 → LIVE 카운트 복귀 검증
5. **🎨 화면 설정 / 🖥️ 미리보기 / 📺 TV 송출 탭 전환** — 5개 섹션(배경/컬러/폰트/상금분배표/텍스트) mount + 탭 toggle

## 발견 + fix 한 이슈

- **placeholder selector 불일치** — `getByLabel('이메일')` 안 됨 (label-input for/id 미연결). `getByPlaceholder('가입 시 등록한 이메일')` 로 교체.
- **React 19 controlled input + Playwright fill race** — `pressSequentially` 후 button disabled 풀릴 때까지 `waitForFunction` polling 추가.
- **Firebase Auth IndexedDB 세션은 storageState 로 복원 불가** — spec 마다 별도 로그인 대신 serial + sharedPage 패턴으로 1회 로그인 후 재사용.
- **LIVE 빠른시작은 READY 상태로 mount** — `▶ 시작` 한 번 더 눌러야 running + 진행바 mount.
- **strict mode violation** — `getByText('⚡ 빠른 시작')` 가 좌측 헤더 + 안내문구 2개 매칭. `.first()` 추가.

## skip / 후속 작업

- **TV 풀스크린 (`/display/{storeId}/{slotIndex}` + Fullscreen API)** — headless Chromium 의 `Element.requestFullscreen()` 호환 제한 + user gesture 요건 → skip.
- **신규 템플릿 저장** — TemplatesPanel 폼 구조에 fragile → 별도 컴포넌트 단위 테스트로 분리 권장.
- **CI 연동** — GitHub Actions / Firebase App Hosting webhook 결정 후 추가 (자동 회귀 차단).
- **다른 매장 (광안리/해운대 등) 회귀** — `E2E_STORE_ID` env 로 override 가능. 추가 owner 계정 또는 platform_admin 권한 확보 후.
