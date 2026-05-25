# Pink Rabbit Design System

_Started 2026-05-24 23:37 UTC_

---

## User

GitHub connected

## Assistant

Hey! GitHub's connected — paste any github.com repo URL (or a specific folder/file within one) and I'll explore it. I can pull components, styles, or assets into this project to use as reference for design mockups.

## User

깃허브https://github.com/84jakekim/holdemnow/tree/main/prototypes 경로의 프로토타입 페이지를 확인해서 Pink Rabbit 컨셉에 맞는 디자인시스템을 작성하고, 프로토타입으로 만들어줘

## Assistant

_[tool: github_get_tree]_

_[tool: list_files]_

_[tool: list_files]_

_[tool: github_read_file]_

_[tool: github_read_file]_

좋습니다! Pink Rabbit / HoldemNow 컨셉을 파악했습니다. 부산·경남 홀덤펍 디스커버리 + 토너 디지털 인프라 플랫폼이군요. 진행 전에 몇 가지 확인 질문드릴게요.

_[tool: questions_v2]_

Pink Rabbit / HoldemNow 컨셉을 확실히 파악했습니다 — 부산·경남 홀덤펍 디스커버리 + 토너 디지털 인프라 플랫폼, 핫핑크(#FF1F8F) 브랜드, LIVE 빨강, 야놀자·토스 DNA 톤이군요. 기존 5개 카테고리(사용자앱/매장어드민/본사어드민/TV/인증) 중 어디에 집중할지, 그리고 디자인 방향을 정하기 위해 몇 가지 질문드리겠습니다.

## User

Questions answered:
- scope: 전부 다 (디자인 시스템 페이지 + 각 카테고리 대표 화면 1개씩)
- direction: 기존 톤 그대로 정제·고도화 (안정적)
- deliverable: 한 파일 안에 디자인 시스템 + 핵심 프로토타입 통합
- interactivity: 탭바·화면 간 전환 동작, BREAK ↔ LIVE 상태 전환
- tweaks: 라이트 ↔ 다크 모드, TV 디스플레이 프리셋 5종, 타이포그래피 (Pretendard ↔ 다른 한글 폰트)
- device: 단순 392px 모바일 박스 (기존 프로토타입 스타일)
- novel: 기존 화면들을 충실히 재현 (안전한 선택)
- language: 한국어 (기존 프로토타입과 동일)
- rabbit: 심플한 SVG 토끼 일러스트로 업그레이드
- extra: 기존에 없는 새로운 아이디어도 시도해볼까요? 질문의  추가코멘트로 "⚠️ 예외: 한두 가지 novel 요소도 OK라면 마이크로 인터랙션(hover/loading) 정도"

"Pink Rabbit" 브랜드명이라 토끼 로고가 자연스러움. 단 이모지/추상화는 X

## Assistant

_[tool: update_todos]_

_[tool: github_read_file]_

좋습니다! 한 파일 안에 디자인 시스템 + 5개 카테고리 대표 화면 + Tweaks 통합으로 가겠습니다. 나머지 프로토타입도 빠르게 훑어보고 작업 시작하겠습니다.

_[tool: copy_starter_component]_

전체 그림이 보입니다. 이제 본격 작업 시작하겠습니다.

_[tool: read_file]_

_[tool: write_file]_

이제 빌드합니다. 단일 페이지 안에 디자인 시스템 + 5개 카테고리 대표 화면 + 인터랙티브 + Tweaks를 모두 담은 구조로 갑니다.

_[tool: write_file]_

이제 공용 컴포넌트 (SVG 토끼 로고 + 빌딩 블록).

_[tool: write_file]_

이제 사용자 앱 화면 (탭 전환 인터랙티브) — 가장 핵심 파트입니다.

_[tool: write_file]_

이제 나머지 4개 카테고리 화면 — 매장 어드민, 본사 어드민, TV (LIVE↔BREAK 토글 + 프리셋), 인증.

_[tool: write_file]_

이제 디자인 시스템 카탈로그 페이지.이제 메인 app.jsx — 모든 것을 묶고 Tweaks 패널을 추가합니다.

_[tool: write_file]_

_[tool: show_html]_

_[tool: done]_

_[tool: fork_verifier_agent]_

콘솔 깨끗하게 떴습니다. 검증 에이전트를 돌립니다.Pink Rabbit 디자인 시스템 + 5개 카테고리 프로토타입을 한 파일로 완성했습니다.

**구성:**
- **디자인 시스템 카탈로그** — 핫핑크 그라데이션 hero · 색상 토큰 (라이트/다크) · 타이포 · radius/spacing/shadow · 9개 시그니처 컴포넌트
- **01 사용자 앱** — 하단 탭으로 홈/매장찾기/채팅방/캘린더/마이 전환 (실제 클릭 가능, 검색·필터·즐겨찾기 동작)
- **02 매장 어드민** — 다크 control center, 타이머 카운트다운, ⏸ 일시정지 + ☕ BREAK 토글
- **03 본사 어드민** — KPI 4종 + LIVE 모니터링 + 광고 4등급
- **04 TV 디스플레이** — 16:9 가로 모드, 우상단 BREAK 버튼으로 LIVE↔BREAK 전환, Tweaks에서 프리셋 5종 (다크/그린/블루/크림슨/화이트) 변경
- **05 인증** — 사용자/매장/본사 3-tab, 전화번호 + 약관 동의 인터랙티브

**Tweaks 패널 (우하단):**
- 라이트 ↔ 다크 모드 전환
- 본문 폰트 4종 (Pretendard / Noto Sans KR / Spoqa / Gowun Dodum)
- TV 디스플레이 프리셋 5종

**SVG 토끼 로고** — `badge`(라운드박스+그라데이션) / `mark`(단독) 2가지 변형. 이모지 X, 깔끔한 기하학적 형태.

기존 톤(야놀자·토스 라이트 + 핑크 액센트, LIVE 빨강 의미 고정, TV 3분할 골격)은 그대로 유지하고, lift hover / pulse / tap scale 등 마이크로 인터랙션과 SVG 로고로 살짝 고도화했습니다.

## User

계속진행해줘

## Assistant

_[tool: save_screenshot]_

현재 상태를 확인해보고 보강할 부분을 찾아보겠습니다.

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: get_webview_logs]_

_[tool: sleep]_

_[tool: update_todos]_

_[tool: read_file]_

매장 상세 모달과 LIVE 풀스크린을 사용자 앱 안에 추가해서 진짜 인터랙티브 프로토타입으로 만들어보겠습니다.

_[tool: read_file]_

_[tool: str_replace_edit]_

## Assistant

_[tool: str_replace_edit]_

이제 디자인 시스템에 Motion 토큰 섹션을 추가합니다.

_[tool: str_replace_edit]_

_[tool: done]_

_[tool: update_todos]_

_[tool: fork_verifier_agent]_

추가 작업 완료했습니다.

**새로 추가된 인터랙션:**
- **매장 상세 모달** — 사용자 앱의 매장 카드(홈의 HOT LIVE Hero, 매장찾기 리스트)를 클릭하면 슬라이드 업으로 상세 모달이 열립니다. Hero 이미지 + LIVE 진행중 카드(타이머/Lv/참가자) + 매장 정보 + 사진 + 예정 토너 + 리뷰 + 하단 고정 CTA.
- **LIVE 풀스크린 모달** — 상세 모달 안 "LIVE 풀스크린 보기" 버튼을 누르면 다크 풀스크린 LIVE 뷰로 진입. 모바일 사용자용 톤 (핑크 거대 타이머 + 블라인드 + 3카드). 하단의 BREAK 시뮬레이션 버튼으로 LIVE ↔ BREAK 전환.

**디자인 시스템 보강:**
- **Motion 섹션** — Timing 토큰 5종(micro/fast/base/modal/theme)과 인터랙션 데모(tap scale · card lift · pulse).

검증 에이전트를 돌렸습니다.

_[tool: show_html]_

