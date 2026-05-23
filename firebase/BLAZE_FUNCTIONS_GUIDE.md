# Blaze 업그레이드 + Functions 배포 가이드

`platform_admin` Custom Claims · FCM 자동 푸시 · 카카오 로그인을 활성화하는 단계.

---

## 1. Blaze 요금제 업그레이드 (5분)

### 왜 필요한가
- **Cloud Functions 배포는 Blaze(종량제) 플랜만 가능** (Spark 무료 플랜은 Functions 안 됨)
- **무료 한도 매우 넉넉** — 초기 1년은 사실상 ₩0
  - Functions: 월 200만 호출 / 400,000 GB-초 / 200,000 CPU-초 무료
  - Firestore: 일일 50,000 read / 20,000 write / 1GB 무료
  - Storage: 5GB / 1GB 다운로드 무료
- **예산 알림 자동 설정 가능** — 한도 넘으면 알림·자동 차단

### 진행 단계

1. https://console.firebase.google.com/project/holdemnow-prod/usage 접속
2. 우상단 **"플랜 변경"** 또는 **"업그레이드"** 클릭
3. **Blaze 선택** → 결제 카드 등록 (해외결제 가능 카드)
4. **예산 알림** 설정 (권장):
   - 월 예산 한도: ₩10,000 또는 ₩50,000 (초기 매우 안전)
   - 50% / 90% / 100% 도달 시 이메일 알림

### 안내
- 초기 한 달 무료 한도 안에서 운영 시 ₩0 청구
- 매장 100개 베타에서도 한도 여유 충분 (계산 결과 월 ~₩2,000 추정)
- 한도 초과 위험: 카카오 로그인 시도 폭주 (방지: Function rate limit), 대량 푸시 (방지: 배치 처리)

---

## 2. Cloud Functions 배포

### 사전 준비
- `functions/` 폴더 의존성은 이미 설치됨 (`npm install` 완료)
- `auth/kakaoCustomToken.ts` 카카오 Custom Token 함수 작성됨

### 배포

```powershell
cd C:\Users\User\Documents\holdem\firebase
firebase deploy --only functions
```

첫 배포 시:
- Cloud Functions API, Cloud Build API, Artifact Registry API 자동 활성화
- 약 3~5분 소요
- 결과:
  ```
  + functions[kakaoCustomToken(asia-northeast3)] Successful create operation.
  Function URL (kakaoCustomToken): https://asia-northeast3-holdemnow-prod.cloudfunctions.net/kakaoCustomToken
  ```

### 배포된 Function 확인
```powershell
firebase functions:list
firebase functions:log
```

---

## 3. 카카오 로그인 활성화

### 카카오 개발자 등록

1. https://developers.kakao.com 접속 (카카오 계정 로그인)
2. **내 애플리케이션** → **애플리케이션 추가**
   - 앱 이름: `Pink Rabbit`
   - 사업자명: (회사명 또는 본인)
3. 생성된 앱 → **앱 키** 확인:
   - **REST API 키** (Functions에서 사용)
   - **JavaScript 키** (클라이언트에서 사용)
4. **카카오 로그인** 메뉴 → **활성화 설정** ON
5. **동의 항목**:
   - 닉네임 (필수)
   - 프로필 사진 (선택)
   - 이메일 (선택 동의)
6. **Redirect URI** 등록:
   - `http://localhost:3000/auth/kakao/callback`
   - `https://your-prod-domain.com/auth/kakao/callback`

### Firebase에 카카오 키 등록

```powershell
firebase functions:config:set kakao.rest_api_key="YOUR_REST_API_KEY"
firebase deploy --only functions  # 재배포
```

또는 `.env` (functions v2 권장):
```
# firebase/functions/.env
KAKAO_REST_API_KEY=xxx
```

### 클라이언트 카카오 SDK 추가

```bash
cd admin-web
npm install @react-oauth/kakao  # 또는 카카오 SDK 직접 로드
```

흐름:
1. 모바일 로그인 화면에 "카카오로 로그인" 버튼
2. 카카오 SDK로 access_token 받음
3. `httpsCallable('kakaoCustomToken')` 호출 → Firebase Custom Token 받음
4. `signInWithCustomToken(token)` → Firebase 로그인 완료

---

## 4. FCM 자동 푸시 (다음 단계)

### 추가할 Functions

- `notifyFavoriteOnLive` — `liveSessions/{id}` onCreate
  - 그 storeId를 favorite한 모든 user → notifyOnLive=true → FCM 전송
- `notifyInterestedTournamentStart` — Scheduled (매분)
  - 시작 1시간 전 도달한 `tournaments/{id}` → 관심 등록자에게 FCM
- `notifySeriesMilestone` — Scheduled
  - 시리즈 본선 D-7, D-3, D-1 → 구독자에게 FCM

### 클라이언트 FCM 토큰 등록

```typescript
import { getMessaging, getToken } from 'firebase/messaging';

const messaging = getMessaging(app);
const token = await getToken(messaging, { vapidKey: '...' });
// users/{uid}.fcmTokens[deviceId] = token 저장
```

---

## 5. platform_admin Custom Claims (보안 강화)

### 본사 관리자 부여

배포된 Function 호출 (또는 Firebase Admin SDK CLI):
```typescript
await admin.auth().setCustomUserClaims(uid, { role: 'platform_admin' });
```

### Firestore Rules 강화

```
function isPlatformAdmin() {
  return request.auth.token.role == 'platform_admin';
}
```

현재 v0.1은 클라이언트 검증 (users/{uid}.roles)이지만, 운영 단계는 Custom Claims로 변경.

---

## ⚠ 진행 전 체크리스트

- [ ] Blaze 업그레이드 (카드 등록, 예산 알림 ₩10,000 설정)
- [ ] `firebase deploy --only functions` 첫 배포 성공
- [ ] 카카오 개발자 계정 + 앱 등록 + 키 확보
- [ ] kakao.rest_api_key 환경변수 등록 + 재배포
- [ ] 클라이언트 카카오 SDK 통합 (다음 단계)

이 단계들은 본 채팅이 못 도와줄 영역 (사용자 결제·외부 가입). 진행 후 알려주시면 다음 코드 작업 진행합니다.
