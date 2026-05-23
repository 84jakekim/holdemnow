# Pink Rabbit Firebase Backend (v0.1)

풀 Firebase 스택. Firestore + Auth + Functions + FCM + Storage + Hosting.

---

## 📐 사용하는 Firebase 서비스

| 서비스 | 역할 | 프로토타입 대응 |
|--------|------|----------------|
| **Firestore** | 실시간 DB (NoSQL) | `sessions[]`, `slots[]`, `customTemplates`, `series`... 모두 여기 |
| **Authentication** | 매장 사장(이메일) + 플레이어(카카오 Custom Token) | M21 가입 마법사 |
| **Cloud Functions** | 카카오 Custom Token, 위성 예선 자동 집계, FCM 트리거 등 | 비즈니스 로직 |
| **FCM** | 즐겨찾기 LIVE / 관심 토너 / 시리즈 D-N 푸시 | 모바일 알림 |
| **Storage** | 매장 사진, 시리즈 포스터, 후원사 로고 | 사진 업로드 |
| **Hosting** | 어드민 웹 + TV 디스플레이 정적 배포 | admin.holdemnow.com |

**클라이언트가 Firestore SDK로 직접 read/write** 합니다. 권한은 `firestore.rules`에서 통제. 서버 코드는 카카오 OAuth 같은 특수 케이스에만 작성.

---

## 🚀 초기 셋업 (Firebase Console 작업)

### 1. Firebase 프로젝트 생성

1. https://console.firebase.google.com 접속 (Google 계정 로그인 상태)
2. **프로젝트 추가** → 이름 `holdemnow-prod` (또는 `holdemnow-dev`)
3. Google Analytics 활성화 (선택, 권장)

### 2. 각 서비스 활성화

콘솔 좌측 메뉴에서:
- **Authentication** → 시작하기 → 로그인 방법:
  - ✅ 이메일/비밀번호 (매장 사장님용)
  - ✅ Google (테스트용)
- **Firestore Database** → 데이터베이스 만들기:
  - 위치: `asia-northeast3 (Seoul)`
  - 모드: **잠금 모드로 시작** (`firestore.rules` 적용 후 단계적으로 오픈)
- **Storage** → 시작하기:
  - 같은 위치 `asia-northeast3`
- **Functions** → 시작하기 (Blaze 요금제 필요 — 무료 한도 매우 넉넉, 초기엔 ₩0)

### 3. 웹 앱 등록

콘솔 → ⚙️ 프로젝트 설정 → 일반 → 내 앱 → 웹 아이콘 클릭

| 항목 | 값 |
|------|------|
| 앱 닉네임 | `holdemnow-web` |
| Firebase Hosting 설정 | 체크 |

→ Firebase SDK 설정 값(`apiKey`, `authDomain` 등) 표시됨. 복사해두기 (어드민/모바일 클라이언트에서 사용).

### 4. 로컬 CLI 설치

```powershell
npm install -g firebase-tools
firebase login
cd C:\Users\User\Documents\holdem\firebase
firebase use --add
# → 위에서 만든 holdemnow-prod 선택, alias는 default
```

`.firebaserc`에 프로젝트 ID 자동 저장.

### 5. 카카오 로그인 (v0.1.5 이후)

- https://developers.kakao.com 에서 앱 등록
- REST API 키 + JavaScript 키 받음
- Cloud Functions의 `auth/kakaoCustomToken`이 카카오 토큰 → Firebase Custom Token으로 교환
- 클라이언트는 카카오 SDK 로그인 → Functions 호출 → Firebase Custom Token → `signInWithCustomToken`

자세한 흐름은 `docs/kakao-login-flow.md` 참고 (다음 세션에 작성).

---

## 📂 폴더 구조

```
firebase/
├── README.md
├── firebase.json           # 서비스별 설정 (hosting, functions, firestore, storage)
├── .firebaserc            # 프로젝트 ID 매핑 (default/dev/prod)
├── firestore.rules        # 보안 규칙 (누가 무엇을 read/write)
├── firestore.indexes.json # 복합 인덱스
├── storage.rules          # Storage 보안 규칙
├── docs/
│   └── firestore-schema.md  # 컬렉션 구조 (이 문서가 진실의 원천)
└── functions/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts          # 모든 functions export
        ├── auth/
        │   └── kakaoCustomToken.ts
        └── live/
            └── tickCountdown.ts  # (선택) 서버에서 카운트다운 보정
```

---

## 🧪 로컬 에뮬레이터 (오프라인 개발)

Firebase Emulator Suite로 인터넷 없이 로컬 개발 가능:

```powershell
firebase emulators:start
```

- Firestore: http://localhost:8080
- Auth: http://localhost:9099
- Functions: http://localhost:5001
- Storage: http://localhost:9199
- **Emulator UI**: http://localhost:4000 (브라우저로 모든 데이터·로그 확인)

데이터는 메모리에만 저장 — 중지하면 사라짐. `--export` 옵션으로 디스크 저장 가능.

---

## 🗂 데이터 모델

본 폴더의 `docs/firestore-schema.md` 참고. 프로토타입의 `customTemplates`, `sessions`, `slots`, `series` 등이 어떻게 Firestore 컬렉션으로 표현되는지 정리.

---

## 🎯 v0.1 작업 순서

- [x] 폴더 셋업 + 보안 규칙 초안 + Firestore 스키마 설계
- [ ] Firebase 프로젝트 생성 + 서비스 활성 (위 가이드)
- [ ] CLI 로그인 + `firebase use --add`
- [ ] **에뮬레이터 첫 실행** → Emulator UI에서 Firestore 컬렉션 만들어보기
- [ ] 어드민 웹 (Next.js) — Firebase SDK 연결
- [ ] 매장 가입 마법사 → Firestore에 store 문서 생성
- [ ] LIVE 세션 시작 → liveSessions 컬렉션에 문서 + 클라이언트 onSnapshot
- [ ] 카카오 Custom Token Functions
- [ ] FCM 푸시 트리거 (Firestore write 이벤트 기반)

---

## 💡 추천 도구

- **Firebase Console** (web) — DB·Auth·Functions 모니터링
- **Emulator UI** (`localhost:4000`) — 로컬 개발
- **Reactfire** 또는 **react-firebase-hooks** — React에서 Firestore 실시간 listener 편하게

---

## ⚠ 알림

- Cloud Functions은 **Blaze 요금제**(종량제) 필요. 다만 **무료 한도 매우 넉넉** — 매월 200만 호출/400,000 GB-초 무료. 초기엔 ₩0.
- Firestore는 일일 50,000 read / 20,000 write 무료. 매장 100개 베타에선 ₩0.
- Spark(무료) 플랜에서도 Firestore + Auth + Hosting 작동. Functions만 Blaze 필요.

---

**다음 단계**: 위 "초기 셋업" 1~4 진행 → 완료되면 알려주세요. 그 다음 Firestore 컬렉션 첫 문서 만들어보기.
