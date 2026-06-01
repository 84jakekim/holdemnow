# 매장 가입 → 본사 승인 SOP

**대상**: 본사 총관리자 (thethego@naver.com)
**목적**: 자체 가입한 매장을 신속히 승인하여 매장 어드민 잠금(PENDING_DISABLED_MENUS) 해제

---

## 흐름 요약

```
매장 사장 자체 가입 (홀덤나우 사장님 사이트)
   ↓
Firestore: stores/{id}.status = 'pending'
   ↓
본사 총관리자가 본사 어드민 접속
   ↓
가입 신청 검토 → 승인 클릭
   ↓
Firestore: stores/{id}.status = 'active'
   ↓
매장 어드민 PENDING_DISABLED 5메뉴 해제
   ↓
매장이 토너 등록 / 직원관리 / 딜러 / 광고 가능
```

---

## 단계별 절차

### 1. 본사 어드민 접속
- URL: `https://admin.holdemnow.com` (커스텀 도메인 적용 후) 또는 `https://holdemnow-admin--holdemnow-prod.us-east4.hosted.app`
- 로그인: `thethego@naver.com` + 비밀번호

### 2. 가입 신청 검토
좌측 메뉴 **회원 관리 → 매장 탭** 클릭
- "pending" 상태 매장 목록 표시
- 매장명 클릭 → 상세 페이지 진입

### 3. 검토 항목
| 항목 | 확인 |
|---|---|
| 사업자등록증 사진 (signageImageUrl) | 정상 매장인지 |
| 매장명 | 중복/이상 X |
| 주소 | 부산/경남 지역인지 (베타 한정) |
| 대표자 이름·전화 | 입력 정상 |
| 매장 전화·영업시간 | 입력 정상 |

### 4. 승인 또는 거절

**승인**:
- "활성화" 버튼 클릭
- Firestore: `status: 'active'` 갱신
- 매장 사장에게 알림 발송 (자동)

**거절**:
- "거절" 버튼 클릭
- 거절 사유 입력 (예: "사업자등록증 미확인", "지역 범위 초과")
- Firestore: `status: 'rejected'` 갱신

### 5. 매장 사장 측 동작
- 승인 후 매장 사장이 매장 어드민 재로그인 → 잠금 해제
- 토너 등록 / 직원관리 / 딜러 / 광고 / 통계 메뉴 활성화

---

## SLA (출시 후 1주)

- 신규 가입 → **2시간 내** 검토 + 승인/거절
- 24h 이상 pending 매장 0건 목표
- 거절 시 사유 명확히 (재신청 가능하게)

---

## 모니터링

본사 어드민 → 회원 관리 → 매장 탭에서 daily 1회 확인:
- pending 매장 수
- 24h 이상 적체 매장 수

---

## 비상 시

- 다수 가입이 한 번에 몰릴 경우: 일괄 승인 스크립트 사용 가능
  ```sh
  cd firebase/functions/scripts
  node bulkApproveStores.js --region=부산
  ```
  (현재 미구현 — 필요 시 P-launch 즉시 구현)

- 잘못 승인한 매장 비활성화:
  ```sh
  node deactivateStore.js {storeId}
  ```
  (현재 미구현 — 또는 본사 어드민 UI에서 status 수동 변경)

---

**작성일**: 2026-05-30 (출시 D-3)
**관련 메모리**: `project_store_signup_policy_v02.md`, `project_pre_launch_reset.md`
