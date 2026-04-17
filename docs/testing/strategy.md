# Testing Strategy

---

## 1. Test Pyramid

```
         /  E2E  \          -- Playwright (critical flows only)
        /----------\
       / Integration \      -- API routes + DB (Hono + test DB)
      /----------------\
     /    Unit Tests     \  -- Pure functions, Zod schemas, utils
    /______________________\
```

## 2. By Package

### packages/db
- **Unit**: Zod 스키마 검증, 유틸 함수
- **Integration**: Drizzle 쿼리 → 테스트 DB (docker-compose.test.yml)
- **Tool**: vitest

### apps/api
- **Unit**: 미들웨어 로직, 유틸 함수
- **Integration**: Hono app.request() → 테스트 DB
  - 전 CRUD 라우트 테스트
  - 인증 미들웨어 테스트 (인증 O/X)
  - 사용자 제한 테스트 (Free 플랜 한도 초과)
- **Tool**: vitest + @hono/testing

### apps/web
- **Unit**: 유틸 함수, 커스텀 훅
- **Component**: 주요 UI 컴포넌트 (에디터, 그래프 등)
- **E2E**: 핵심 유저 플로우 (가입 → 프로젝트 생성 → 노트 생성 → 검색)
- **Tool**: vitest (unit), Playwright (E2E)

### apps/worker
- **Unit**: 파싱 함수, 임베딩 유틸, RRF 알고리즘
- **Integration**: 에이전트 → 테스트 DB + Mock Gemini API
- **Tool**: pytest + pytest-asyncio

### Browser Sandbox (apps/web 내부)
2026-04-14 피봇으로 `apps/sandbox` 서비스는 폐기됨. 코드 실행은 전부 브라우저(Pyodide + iframe)에서 이루어지므로 별도 서버 테스트 대상이 없다. 대신:
- **Unit**: Pyodide 래퍼 훅(`useCanvasMessages`, `pyodide-runner.tsx`) 순수 로직 — vitest
- **Integration**: 모의 Code Agent 출력 → Pyodide 실행 → stdout 검증 (jsdom + @pyodide/pyodide npm)
- **E2E (Security)**: Playwright로 iframe sandbox 속성 강제 검증 (allow-same-origin 탈출 불가, postMessage origin 차단)
- **Tool**: vitest + Playwright. 상세는 [docs/testing/sandbox-testing.md](./sandbox-testing.md)

## 3. Agent Testing

에이전트 테스트는 일반 단위 테스트와 다르다. LLM 출력은 비결정론적이므로

### 전략: Deterministic Shell + Stochastic Core

```
[Deterministic]              [Stochastic]
 테스트 가능                  테스트 어려움
 - Temporal 워크플로우 순서     - LLM 응답 내용
 - DB 쿼리 실행               - 개념 추출 결과
 - 스마트어 시퀀스 순서         - 위키 텍스트 품질
 - 에러 핸들링 시퀀스          - 추론 생성
 - 스키마 검증                - 질문 생성
```

### 에이전트 테스트 방법

1. **Pydantic 스키마 검증 테스트**: LLM 출력이 스키마에 맞는지 확인 (Mock LLM으로)
2. **워크플로우 순서 테스트**: Temporal replay로 Activity 실행 순서 검증
3. **스마트어 테스트**: 시퀀스 2개로 Compiler가 같은 프로젝트에 접근 불가 확인
4. **Golden test**: 고정 입력 → LLM → 출력 스냅샷 비교 (주기적으로 업데이트)
5. **Guardrail test**: 에이전트가 금지된 행동을 하지 않는지 확인
   - Compiler가 수동 노트(is_auto=false)를 수정 못하는지
   - Research가 출처 없는 주장을 생성 못하는지

## 4. Test Database

```yaml
# docker-compose.test.yml
services:
  postgres-test:
    image: pgvector/pgvector:pg16
    ports: ["5433:5432"]
    environment:
      POSTGRES_DB: opencairn_test
      POSTGRES_USER: opencairn
      POSTGRES_PASSWORD: changeme
    tmpfs: /var/lib/postgresql/data  # RAM disk for speed
```

각 테스트 suite 전에 마이그레이션 실행, 후에 데이터 truncate.

## 5. CI Pipeline

```yaml
# .github/workflows/ci.yml
jobs:
  lint:
    - pnpm lint

  test-db:
    services: [postgres-test]
    - pnpm --filter @opencairn/db test

  test-api:
    services: [postgres-test, redis]
    - pnpm --filter @opencairn/api test

  test-web:
    - pnpm --filter @opencairn/web test

  test-worker:
    services: [postgres-test]
    - cd apps/worker && pytest

  e2e:
    services: [postgres, redis, minio]
    - pnpm build
    - pnpm playwright test
    # Pyodide 브라우저 sandbox 테스트 포함 (docs/testing/sandbox-testing.md)
```
