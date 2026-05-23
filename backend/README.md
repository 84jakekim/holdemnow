# Pink Rabbit Backend (v0.1)

NestJS + Prisma + PostgreSQL + Redis 기반 MVP 백엔드.

프로토타입(`../holdemnow_prototype.html`)에서 검증된 데이터 모델·액션을 실제 API로 옮긴 것.

---

## 🚀 첫 실행 (10분 컷)

### 1. 사전 준비
- **Node.js 20+** ([nodejs.org](https://nodejs.org)) — 최신 LTS
- **Docker Desktop** ([docker.com](https://www.docker.com/products/docker-desktop)) — Postgres + Redis 컨테이너 실행용

### 2. 패키지 설치
```powershell
cd C:\Users\User\Documents\holdem\backend
npm install
```

### 3. 환경 변수 셋업
```powershell
copy .env.example .env
```
`.env` 안의 `JWT_SECRET`만 임의 문자열로 바꾸세요.

### 4. DB & Redis 실행 (Docker)
```powershell
npm run db:up
```
백그라운드로 Postgres(PostGIS 확장) + Redis 가 뜹니다.

### 5. Prisma 마이그레이션 + 시드
```powershell
npm run prisma:migrate
npm run prisma:generate
```

### 6. 서버 실행
```powershell
npm run dev
```
- API: http://localhost:3001
- Swagger 문서: http://localhost:3001/api/docs
- Prisma Studio (DB GUI): 별도 터미널에서 `npm run prisma:studio` → http://localhost:5555

---

## 📂 폴더 구조

```
backend/
├── prisma/
│   ├── schema.prisma       # DB 스키마 (이게 진실의 원천)
│   └── migrations/         # 마이그레이션 히스토리
├── src/
│   ├── main.ts             # 진입점 (Swagger, CORS, ValidationPipe)
│   ├── app.module.ts       # 루트 모듈
│   ├── auth/               # JWT 인증, 카카오 OAuth
│   ├── stores/             # 매장 도메인
│   ├── tournaments/        # 토너 + 템플릿 (M18 매핑)
│   ├── live/               # LIVE 세션 + 슬롯 (M7~M10 매핑)
│   ├── users/              # 플레이어 + 즐겨찾기
│   ├── series/             # 대회사 시리즈 (M19 매핑)
│   ├── notifications/      # FCM 푸시
│   ├── analytics/          # 통계 이벤트
│   ├── common/             # 공통 가드·인터셉터·DTO
│   └── prisma/             # Prisma 모듈 (전역 PrismaService)
├── docker-compose.yml      # Postgres + Redis 로컬
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 🧪 API 테스트

추천: **Bruno** ([usebruno.com](https://www.usebruno.com)) — 오픈소스 Postman 대체.

또는 Swagger UI에서 바로 호출.

```bash
# 매장 등록
POST http://localhost:3001/api/admin/stores/signup

# LIVE 세션 시작
POST http://localhost:3001/api/admin/live/sessions

# 모바일 LIVE 피드
GET http://localhost:3001/api/live/feed?lat=35.158&lng=129.060
```

---

## 🗂 프로토타입 ↔ 백엔드 매핑

| 프로토타입 | 백엔드 |
|----------|--------|
| `LiveStateProvider` | `LiveModule` + Redis pub/sub |
| `BroadcastChannel` | SSE (`GET /live/sessions/{id}/stream`) |
| `localStorage` | PostgreSQL |
| `customTemplates` | `tournaments_templates` 테이블 |
| `sessions[]` | `live_sessions` 테이블 |
| `slots[]` | `display_slots` 테이블 |
| `series[]` | `series` 테이블 |
| `finalists[]` | `series_finalists` 테이블 |

---

## 🎯 v0.1 구현 우선순위 (TodoList Phase 2 매핑)

- [x] 폴더 구조 + Prisma 스키마 초안
- [ ] PrismaService + 전역 모듈
- [ ] AuthModule (JWT + 카카오 OAuth)
- [ ] StoresModule — 매장 가입·로그인·정보 관리
- [ ] TournamentsModule — 템플릿 CRUD + 토너 등록
- [ ] LiveModule — 세션 시작/일시정지/레벨 이동 (M3·M7~M10 액션)
- [ ] DisplaySlots — 슬롯 ↔ 세션 매핑
- [ ] SSE 송출 — `/live/sessions/{id}/stream`
- [ ] UsersModule — 카카오 로그인, 즐겨찾기, 관심 토너
- [ ] AnalyticsModule — 노출/클릭 카운터 (Redis)
- [ ] FCM 푸시 — 즐겨찾기 LIVE 시작 알림

자세한 작업은 `../Pink Rabbit_TodoList_v1.0.md` Phase 2 참고.

---

## 🐳 Docker 명령어

```powershell
npm run db:up        # Postgres + Redis 시작
npm run db:down      # 중지 (데이터 유지)
docker compose down -v  # 데이터까지 삭제 (주의: 초기화)

docker exec -it holdemnow-postgres psql -U holdem -d holdemnow
docker exec -it holdemnow-redis redis-cli
```

---

## 📝 환경별 메모

- **로컬 개발**: 본 README 그대로
- **스테이징**: AWS RDS(Postgres) + ElastiCache(Redis) + ECS/Fargate (NestJS)
- **프로덕션**: 동일 + CloudFront + Route53 + ACM

---

**다음 단계**: `prisma/schema.prisma` 확인 후 `npm install` → `npm run db:up` → `npm run prisma:migrate`.
