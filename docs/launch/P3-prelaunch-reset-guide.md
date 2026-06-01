# preLaunchReset.js Dry-Run 가이드

**대상**: 본사 총관리자 (thethego@naver.com)
**목적**: 출시 전 prod 데이터 초기화 사전 검증

**중요**: 사용자 명시 발화("지금 초기화 실행해") 전까지 **실제 실행 절대 금지** (메모리 `feedback_data_reset_lock`)

---

## 스크립트 위치
`firebase/functions/scripts/preLaunchReset.js`

## 보존 항목 (삭제 안 됨)
1. 총관리자 thethego@naver.com (Auth + users/{uid} doc + 매장 owner권)
2. 데모 매장 100개 (`stores.isDemo === true`) + 시드 콘텐츠
3. 본사 설정 (feedConfig, moderationKeywords 등)

## 삭제 대상
- 일반 가입자 (`role != 'platform_admin' && email != 'thethego@naver.com'`)
- 실제 매장 (`stores where isDemo != true`)
- 대회사 (organizers — 데모 없음)
- 콘텐츠: posts / reservations / reviews / recentVisits / notifications
- 라이브: liveSessions / liveSessionsAudit / templates(데모 제외) / timer prefs(데모 제외)

---

## Dry-Run 실행 (검증용, 안전)

### Prerequisites
- Firebase Admin SDK 자격 증명 (ADC 또는 service account JSON)
- `firebase login` 또는 `gcloud auth application-default login`

### 명령
```sh
cd firebase/functions/scripts

# 1. Dry-run (디폴트, 출력만)
node preLaunchReset.js

# 2. Verbose (상세 로그)
node preLaunchReset.js --verbose
```

### 출력 예시
```
[INFO] 보호 대상: thethego@naver.com → uid=abc123
[INFO] 보호 매장(데모): 100개
[DRY-RUN] 삭제 대상 users: 47개
[DRY-RUN] 삭제 대상 stores: 8개
[DRY-RUN] 삭제 대상 posts: 156개
[DRY-RUN] 삭제 대상 reservations: 32개
[DRY-RUN] 삭제 대상 liveSessions: 12개
...
```

### 검증 포인트
- [ ] `보호 대상` uid가 본사 계정과 일치
- [ ] `보호 매장(데모)` 100개 정확
- [ ] 삭제 대상 카운트가 예상 범위 (수십~수백)
- [ ] error 0건

---

## 실제 실행 (D-day, 사용자 명시 발화 후)

```sh
node preLaunchReset.js --execute
```

**경고**:
- 실행 후 복구 불가 (Firestore export 백업 권장)
- Auth 사용자 삭제는 별도 단계 (Firebase Console 또는 admin.auth().deleteUsers 호출)
- 실행 전 Firestore export로 백업:
  ```sh
  gcloud firestore export gs://holdemnow-prod-backup/$(date +%Y%m%d-%H%M)
  ```

---

## 실행 후 검증
1. 본사 어드민 → 회원 관리 → 일반 회원 0건 확인 (thethego 제외)
2. 매장 관리 → 데모 100개만 남음 확인
3. 사용자 앱 → 매장찾기 → 데모 매장 표시
4. 사용자 앱 → 홈 화면 → 빈 상태 처리 정상 (LIVE 0건 등)

---

## 비상 시 Rollback
- Firestore export 백업으로부터 import:
  ```sh
  gcloud firestore import gs://holdemnow-prod-backup/20260601-1200
  ```
- 단, Auth 사용자는 별도 복구 필요

---

**작성일**: 2026-05-30 (출시 D-3)
**관련 메모리**: `project_pre_launch_reset.md`, `feedback_data_reset_lock.md`
