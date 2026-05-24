# Pink Rabbit Sounds

## notification.mp3

매장 어드민에서 새 pending 예약 도착 시 재생되는 알림 사운드.

### 현재 상태 (2026-05-25)

`notification.mp3`는 **104B silent placeholder**입니다. 실제 ding 사운드가 들리도록 두 가지 옵션:

### 옵션 A: 실제 ding 파일로 교체 (권장)

1. 약 1~3초짜리 ding/chime/notification 사운드 파일 준비 (`.mp3`, ≥ 2KB)
2. 권장 무료 사이트:
   - https://mixkit.co/free-sound-effects/notification/
   - https://pixabay.com/sound-effects/search/notification/
   - https://freesound.org (저작자 표시 라이선스 확인)
3. 파일명을 `notification.mp3`로 저장
4. 이 디렉토리(`admin-web/public/sounds/notification.mp3`)에 덮어쓰기
5. commit + push → 자동 배포

### 옵션 B: 그대로 두기 (Web Audio API 폴백)

현재 hook(`useReservationSoundAlert.ts`)이 placeholder를 감지하면 **자동으로 Web Audio API ding 폴백**으로 전환됩니다 (C5→E5 2음 차임).

- 장점: 외부 파일 의존 없음, 즉시 동작
- 단점: 톤이 단순함 (mp3 사운드보다 덜 풍부)

### 동작 검증

1. 매장 어드민 페이지(`/admin/[storeId]`)에서 화면 한 번 클릭 (autoplay priming)
2. 다른 디바이스에서 해당 매장에 예약 접수 (`/m/store/[storeId]` → 예약하기)
3. 매장 어드민에 ding 사운드 들림 확인
