# ⚠ 사용하지 않음 (참고용)

본 폴더는 **NestJS + Prisma + PostgreSQL** 백엔드 시안이었으나,
프로젝트는 **풀 Firebase**로 결정되어 사용하지 않습니다.

## 활용 가치 (보관 이유)

- **`prisma/schema.prisma`** — 데이터 모델의 의미를 가장 명확하게 정리한 청사진. Firestore 컬렉션 설계 시 reference로 활용.
- 만약 향후 트래픽이 매우 커지거나 Firebase 한도를 넘으면, 이 NestJS+Postgres 스택으로 마이그레이션 옵션 보존.

## 메인 백엔드는?

`../firebase/` 폴더 참고.
