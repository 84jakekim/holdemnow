# Pink Rabbit Scripts

Firestore 운영용 일회성 스크립트. ADC(`firebase login`) 토큰 사용.

## 파일

### `preLaunchReset.js` — 출시 전 데이터 일괄 초기화

**언제**: 베타 종료 후 정식 출시 D-day에 1회만.

**용도**:
- 누적된 가입자/세션/콘텐츠를 모두 삭제하고 깨끗한 상태로 출시.
- `thethego@naver.com`(총관리자), 데모 매장 100개(`stores.isDemo === true`), 본사 설정은 보존.

**실행 순서**:
```bash
# 1. 백업 (필수)
gcloud firestore export gs://holdemnow-prod.appspot.com/backups/pre-launch-$(date +%F)

# 2. dry-run (출력만, 미삭제) — 결과 검토
node preLaunchReset.js

# 3. verbose 옵션으로 일부 ID 샘플 출력
node preLaunchReset.js --verbose

# 4. 실제 실행 (rollback 불가)
node preLaunchReset.js --execute

# 5. Auth 사용자 정리 (별도 단계)
#    - Firebase Console → Authentication → 사용자 일괄 삭제
#    - 보호 대상: thethego@naver.com 만 유지
```

**보존 대상**:
- `users/{thethego-uid}` + `role === 'platform_admin'` 가진 모든 doc
- `stores/{...} where isDemo === true` (100개) + 그 매장의 시드 콘텐츠 (posts/templates/timer prefs)
- `meta/feedConfig`, `meta/curationConfig`
- `moderationKeywords` (시드 200개)
- `homeAds`, `hotYoutubeVideos`, `hotYoutubers`, `platformCampaigns` (본사 큐레이션)

**삭제 대상**:
- 일반 가입자 users doc
- 비-데모 stores + subcollections (posts/templates/reservations/reviews/liveSessions/timerBackgrounds/staff)
- organizers 전체
- posts/reservations/reviews/recentVisits/notifications/reports (top-level)
- liveSessions/liveSessionsAudit (top-level)
- passwordRecovery (보호 대상 제외)

**주의**:
- Firestore subcollection은 자동 cascade 안 됨 — 명시적으로 처리됨.
- Auth 사용자 삭제는 이 스크립트에서 안 함 (rollback 불가 위험 분리).
- 실행 전 반드시 dry-run + Firestore Export 백업.

---

### `dumpCompletedSessions.js` — 라이브 세션 진단 덤프

최근 24시간 `liveSessions where status='completed'` 덤프. 좀비 룰 디버깅용.

```bash
node dumpCompletedSessions.js
```

---

### `seedOpsSimulation.js` — 3~4개월 운영 시뮬레이션 풀세트 시드

**언제**: 베타/데모/QA 환경에서 사용자 ~250명 × 매장 100곳이 3~4개월
활발히 사용한 것처럼 풍성한 가상 데이터를 한 번에 생성할 때.

**시드 카테고리 (8)**:
1. 가상 사용자 ~250명 (Firebase Auth + `users` doc)
2. 매장 정보 풍성화 (description / pitch / facilities / tier / liveSessionCount)
3. 리뷰 ~1500~2000건 (`stores/{id}/reviews`)
4. 즐겨찾기 ~800~1000건 (`users/{uid}/favorites/{storeId}`)
5. 예약 ~500~900건 (`stores/{id}/reservations`)
6. 매장 소식 ~400건 (`stores/{id}/posts`) — 과거 누적 + 일부 활성
7. LIVE 세션 과거 기록 ~300건 (`liveSessions` where status=completed)
8. 매장 메트릭 (`stores/{id}/metrics/global`: favoriteAdds/directionsClicks)

**멱등성**:
- 모든 시드 doc에 `seedSource: 'ops-sim'` 표식.
- 사용자 uid prefix: `sim-` (예: `sim-u0001`).
- liveSessions doc ID prefix: `sim-`.
- 재실행 시 동일 doc ID는 set으로 덮어쓰지만, 사용자 Auth는 이미 존재 시 skip.

**실행**:
```bash
# 1. dry-run (디폴트, 카운트만 확인)
node seedOpsSimulation.js

# 2. 실제 실행 (Auth + Firestore 전체)
node seedOpsSimulation.js --execute

# 3. 일부 카테고리만
node seedOpsSimulation.js --execute --only=users,reviews

# 4. 회수 (모든 sim 데이터 + Auth 일괄 삭제)
node seedOpsSimulation.js --unseed --execute
```

**카테고리 키 (--only=)**:
`users`, `stores`, `metrics`, `reviews`, `favorites`, `reservations`, `posts`, `live`

**주의**:
- Auth 사용자 생성은 1건씩 호출 → 250명 약 2~3분 소요.
- 리뷰 시드 후 매장 본문(reviewCount/averageRating/ratingDistribution) 직접 갱신.
  Cloud Function `aggregateReviewStats`가 비동기로 다시 계산하지만 시드 즉시 노출용.
- 회수 시 매장 본문 풍성화(description/pitch/facilities/tier) 흔적은 그대로 두고
  `seedSource` 필드만 제거 + 리뷰 집계 0 리셋.
- Firestore 인덱스 필요:
  - `collectionGroup('reviews') where seedSource ==` (회수용 단일 필드)
  - `collectionGroup('favorites') where seedSource ==`
  - `collectionGroup('reservations') where seedSource ==`
  - `collectionGroup('posts') where seedSource ==`
  - 모두 단일 필드 인덱스로 자동 처리됨.

---

### `seedDemoPosts.js` — 데모 매장 "오늘의 소식" 가상 시드

**언제**: 베타·출시 직후 홈 캐러셀이 비어 보이지 않도록 콘텐츠를 채울 때.

**용도**:
- `stores where isDemo === true` 매장 중 10곳(서면/해운대/광안리/동래/대연/장전/사상/하단/양산 등)에
  가상 "오늘의 소식" 글 1건씩 등록.
- 24h 만료(`expiresAt = now + 24h`), `status='published'`, `authorUid='demo-seeder'`.
- 글 톤은 토너/이벤트/채용/시설/캐쉬/주차/식음 등 10종 다양화.

**멱등성**:
- 매장별로 `authorUid='demo-seeder'` 글이 1건이라도 있으면 skip.
- 재실행 안전.

**실행**:
```bash
# 1. dry-run (출력만, 미작성)
node seedDemoPosts.js

# 2. 실제 실행
node seedDemoPosts.js --execute

# 3. 회수 (시더 글 일괄 삭제)
node seedDemoPosts.js --unseed --execute
```

**참고**:
- 카드 색상/이모지는 `admin-web/src/lib/posts.ts`의 화이트리스트와 동기.
- 24h 후 자동 만료되므로, 지속 노출하려면 주기 재실행 또는 cron 권장.

