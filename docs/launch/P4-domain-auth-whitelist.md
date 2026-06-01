# 커스텀 도메인 + Auth/카카오 화이트리스트 가이드

**대상**: 본사 총관리자 (thethego@naver.com)
**목적**: 출시 전 prod 도메인 설정 + Firebase Auth + 카카오 OAuth 화이트리스트 등록

**중요**: DNS 전파 24~48h 소요 → **D-1 (출시 전날)에는 반드시 완료**

---

## 1. 도메인 구조

| 백엔드 | 사용자 노출 도메인 | App Hosting 도메인 |
|---|---|---|
| holdemnow (메인) | `holdemnow.com` / `www.holdemnow.com` | `holdemnow--holdemnow-prod.us-east4.hosted.app` |
| holdemnow-biz (사장 어드민) | `biz.holdemnow.com` | `holdemnow-biz--holdemnow-prod.us-east4.hosted.app` |
| holdemnow-admin (본사 어드민) | `admin.holdemnow.com` | `holdemnow-admin--holdemnow-prod.us-east4.hosted.app` |

---

## 2. Firebase App Hosting 커스텀 도메인 연결

각 백엔드별 작업 (3회 반복):

### Firebase Console
1. https://console.firebase.google.com/project/holdemnow-prod/apphosting
2. 대상 backend 선택 → **설정 → 도메인 추가**
3. 도메인 입력 (예: `holdemnow.com`)
4. Firebase가 제공하는 DNS 레코드 복사:
   - A 레코드 (예: `199.36.158.x`)
   - 또는 CNAME 레코드 (예: `holdemnow-prod.web.app`)

### DNS 등록
도메인 등록업체(가비아/카페24 등) 관리자 페이지에서:
- A 레코드 또는 CNAME 추가
- TTL: 600 (10분) 추천

### 검증
- Firebase Console에서 "검증 중" → "활성"으로 변경 대기 (몇 분 ~ 몇 시간)
- 활성 후 brwoser에서 `https://holdemnow.com` 접속 → SSL 인증서 자동 발급 (Let's Encrypt)

---

## 3. Firebase Auth 승인된 도메인 추가

OAuth(카카오/Google) + Email/Password 로그인이 도메인에서 작동하려면 화이트리스트 등록 필요.

### 절차
1. https://console.firebase.google.com/project/holdemnow-prod/authentication/settings
2. **승인된 도메인** 섹션 → **도메인 추가**
3. 다음 도메인 모두 추가:
   - `holdemnow.com`
   - `www.holdemnow.com`
   - `biz.holdemnow.com`
   - `admin.holdemnow.com`
   - (이미 등록되어 있는) `holdemnow-prod.firebaseapp.com`
   - (이미 등록되어 있는) `localhost`

---

## 4. 카카오 개발자 콘솔 화이트리스트

카카오 OAuth 로그인이 작동하려면 카카오에 도메인 등록.

### 절차
1. https://developers.kakao.com/console/app/{앱ID}/product/login
2. **카카오 로그인 → 활성화 설정** 확인
3. **Redirect URI** 추가:
   - `https://holdemnow.com/__/auth/handler` (Firebase Auth 콜백 경로)
   - `https://www.holdemnow.com/__/auth/handler`
   - `https://biz.holdemnow.com/__/auth/handler`
   - `https://admin.holdemnow.com/__/auth/handler`
4. **사이트 도메인** (앱 설정 → 플랫폼 → Web):
   - `https://holdemnow.com`
   - `https://www.holdemnow.com`
   - `https://biz.holdemnow.com`
   - `https://admin.holdemnow.com`

### JavaScript SDK 도메인 등록 (지도/공유용)
1. https://developers.kakao.com/console/app/{앱ID}/config/platform
2. **Web 플랫폼 → 사이트 도메인** 위와 동일 4개 추가

---

## 5. 카카오맵 도메인 등록

지도/검색 API 호출이 도메인에서 작동하려면:

### 절차
1. https://developers.kakao.com/console/app/{앱ID}/app/info
2. **앱 키 → JavaScript 키** 확인 (이미 코드에 적용됨)
3. **플랫폼 → Web → 사이트 도메인**에 위 4개 등록 (3단계와 동일)

---

## 6. CORS / Storage 도메인

Firebase Storage(사진 업로드)는 자동 적용. 추가 작업 없음.

---

## 검증 체크리스트 (출시 당일 아침)

- [ ] `https://holdemnow.com` 접속 → 메인 페이지 로드
- [ ] `https://biz.holdemnow.com` 접속 → 사장 어드민 로그인 페이지
- [ ] `https://admin.holdemnow.com` 접속 → 본사 어드민 로그인 페이지
- [ ] SSL 인증서 적용 (자물쇠 아이콘) 확인
- [ ] 카카오 로그인 → Redirect 정상 (콜백 URL 화이트리스트 작동)
- [ ] 매장찾기 → 지도 모드 → 카카오맵 로드 (SDK 화이트리스트 작동)
- [ ] 회원가입 → Email/Password 정상 동작 (Auth 도메인 화이트리스트 작동)

---

## 비상 시 fallback

- DNS 전파 미완료 시 App Hosting 기본 도메인(`*.hosted.app`) 사용
- 카톡방 공지에 임시 URL 안내 가능 (`https://holdemnow--holdemnow-prod.us-east4.hosted.app`)
- DNS 전파 완료 후 도메인 안내로 전환

---

**작성일**: 2026-05-30 (출시 D-3)
**관련 메모리**: `project_holdemnow_paths.md`
