# App Hosting 백엔드 3분할 가이드

2026-05-26 도입. 같은 `admin-web` 코드베이스를 **백엔드 3개**에 배포해 도메인별로 역할을 분리한다.

| variant | 백엔드 이름(권장) | URL(예시) | 허용 라우트 | SEO |
|---|---|---|---|---|
| `app`   | `holdemnow` (기존) | `holdemnow--holdemnow-prod.us-east4.hosted.app` | `/m/*`, `/login`, `/onboarding/*`, `/signup/player`, `/auth/*`, `/legal/*`, `/preview/*`, `/display/*` | index 허용 |
| `biz`   | `holdemnow-biz`    | `holdemnow-biz--holdemnow-prod.us-east4.hosted.app` | `/login/business`, `/admin/*`, `/admin-login`, `/signup/store`, `/signup/organizer`, `/organizer/*` | noindex |
| `admin` | `holdemnow-admin`  | `holdemnow-admin--holdemnow-prod.us-east4.hosted.app` | `/platform-login`, `/platform/*` | noindex |

분기는 `src/middleware.ts`가 `NEXT_PUBLIC_APP_VARIANT` 환경변수를 보고 처리한다.
잘못된 도메인 → 의도 백엔드 URL이 설정돼 있으면 동일 path로 307 redirect, 아니면 `/_blocked` 안내(URL 유지).

---

## 1. 백엔드 신설 (Firebase 콘솔)

> Firebase 콘솔 → App Hosting → **백엔드 추가** 권장. CLI는 region/SA 누락 시 실패가 잦다.

1. **`holdemnow-biz` 생성**
   - Region: `us-east4` (기존 `holdemnow`와 동일)
   - Repository: 기존과 동일 (예: GitHub `holdem`)
   - Branch: `main`
   - **Root directory: `admin-web`**
   - **App Hosting config file: `apphosting.biz.yaml`** ← 핵심
   - Service account: 기존 `holdemnow`와 동일한 SA 선택

2. **`holdemnow-admin` 생성** — 위와 동일하되 config는 `apphosting.admin.yaml`.

3. 두 백엔드의 첫 빌드가 완료되면 URL이 발급된다.
   - 예: `https://holdemnow-biz--holdemnow-prod.us-east4.hosted.app/`
   - 예: `https://holdemnow-admin--holdemnow-prod.us-east4.hosted.app/`

### CLI로 만들 경우 (참고)

```bash
firebase apphosting:backends:create \
  --project holdemnow-prod \
  --location us-east4
# 이름 입력 프롬프트에 holdemnow-biz / holdemnow-admin 지정
```

> CLI는 config file path 옵션이 없어서 콘솔에서 추가 설정해야 한다.

---

## 2. 시크릿 권한 부여

기존 백엔드와 동일한 Secret Manager 시크릿을 사용한다. 새 백엔드에 접근 권한을 부여:

```bash
# 시크릿이 등록돼 있다고 가정
firebase apphosting:secrets:grantaccess <secretName> --backend holdemnow-biz
firebase apphosting:secrets:grantaccess <secretName> --backend holdemnow-admin
```

(현재 yaml들은 모두 평문 NEXT_PUBLIC_* 만 쓰고 있어 별도 시크릿 권한 부여가 필요한 항목은 없다. 향후 서버 전용 시크릿 추가 시 이 절차를 거쳐야 한다.)

---

## 3. URL을 받은 후 — 환경변수 채우기

세 yaml 모두 **같은 3개 URL을 그대로 복붙**한다. (각 백엔드에 모든 다른 백엔드 URL을 알려야 redirect가 가능)

`admin-web/apphosting.yaml`, `admin-web/apphosting.biz.yaml`, `admin-web/apphosting.admin.yaml`:

```yaml
- variable: NEXT_PUBLIC_BACKEND_APP_URL
  value: "https://holdemnow--holdemnow-prod.us-east4.hosted.app"
- variable: NEXT_PUBLIC_BACKEND_BIZ_URL
  value: "https://holdemnow-biz--holdemnow-prod.us-east4.hosted.app"
- variable: NEXT_PUBLIC_BACKEND_ADMIN_URL
  value: "https://holdemnow-admin--holdemnow-prod.us-east4.hosted.app"
```

> 끝에 `/` 붙이지 말 것 (middleware가 `new URL(path, base)`로 합성).

커밋 + 푸시하면 3개 백엔드가 동시에 재빌드된다.

---

## 4. Firebase Auth 도메인 화이트리스트 추가

> 새 백엔드 URL에서 로그인이 작동하려면 **반드시 등록**.

Firebase 콘솔 → **Authentication → Settings → Authorized domains** 에 다음 추가:

- `holdemnow-biz--holdemnow-prod.us-east4.hosted.app`
- `holdemnow-admin--holdemnow-prod.us-east4.hosted.app`

(기존 `holdemnow--…` 도메인은 이미 등록돼 있을 것.)

---

## 5. 카카오 도메인 추가 (Maps + JS SDK)

[Kakao Developers Console](https://developers.kakao.com/) → 내 애플리케이션 → **플랫폼 → Web** 에 도메인 추가:

- `https://holdemnow-biz--holdemnow-prod.us-east4.hosted.app`
- `https://holdemnow-admin--holdemnow-prod.us-east4.hosted.app`

**참고**: admin 백엔드는 카카오 Maps를 사용하지 않지만, layout.tsx가 공통으로 스크립트를 로드한다. 도메인 미등록 시 콘솔 에러는 뜨지만 기능은 정상.

---

## 6. 검증 체크리스트

각 도메인에서 다음 시나리오를 수동 확인:

### app 백엔드 (`holdemnow--…`)
- [ ] `/` → 로그인 페이지(or dispatcher) 정상 노출
- [ ] `/m` → 홈 정상
- [ ] `/admin/abc` → biz 도메인으로 307 redirect (또는 `/_blocked`)
- [ ] `/platform-login` → admin 도메인으로 307 redirect (또는 `/_blocked`)
- [ ] `/robots.txt` → `/m/` allow, `/admin/`, `/platform/` disallow

### biz 백엔드 (`holdemnow-biz--…`)
- [ ] `/` → `/login/business` 자동 redirect
- [ ] `/login/business` → 로그인 폼 정상
- [ ] `/admin/<storeId>` → 어드민 정상
- [ ] `/m` → app 도메인으로 307 redirect (또는 `/_blocked`)
- [ ] `/robots.txt` → 전체 Disallow
- [ ] 응답 헤더 `X-Robots-Tag: noindex, nofollow` 포함

### admin 백엔드 (`holdemnow-admin--…`)
- [ ] `/` → `/platform-login` 자동 redirect
- [ ] `/platform-login` → 로그인 폼 정상
- [ ] `/platform` → 본사 콘솔 정상
- [ ] `/admin/abc` → biz 도메인으로 307 redirect (또는 `/_blocked`)
- [ ] `/robots.txt` → 전체 Disallow

---

## 7. 롤백 절차

문제 발생 시:

1. Firebase 콘솔 → App Hosting → 해당 백엔드 → **Rollouts** 에서 이전 릴리스로 즉시 롤백
2. 또는 `apphosting.yaml`의 `NEXT_PUBLIC_APP_VARIANT` 를 빈 값(또는 `app`)으로 되돌리면 기존 단일 백엔드 동작으로 복귀
3. 정 안 되면 신규 백엔드 2개를 삭제하면 기존 `holdemnow` 백엔드는 그대로 작동

---

## 8. 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| 잘못된 도메인 진입 시 404 안내가 뜸 | 의도 백엔드 URL 환경변수가 빈 값 | `NEXT_PUBLIC_BACKEND_*_URL` 채우고 재배포 |
| redirect 무한 루프 | yaml에 자기 자신 variant의 URL을 다른 variant 값으로 잘못 입력 | URL 매핑 재확인 |
| `/admin/*` 진입 시 로그인 화면이 안 뜸 | Auth 도메인 화이트리스트 누락 | 위 4번 절차 |
| 카카오 Maps 안 뜸 | 카카오 콘솔에 도메인 미등록 | 위 5번 절차 |
| 시크릿 못 읽음 | 새 백엔드에 grantaccess 안 함 | 위 2번 절차 |
