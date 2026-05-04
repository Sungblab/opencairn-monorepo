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

### Trajectory 기반 Eval (2026-04-20 추가, Plan 12 이후)

Runtime facade가 구축되면 위 방법에 **`AgentEvent` trajectory 매칭**이 추가된다. 스펙: [`2026-04-20-agent-runtime-standard-design.md`](../contributing/roadmap.md) §7.

**3가지 eval 실행 모드**:

| 모드 | 트리거 | LLM | 속도 | 비용 |
|---|---|---|---|---|
| **Unit eval (mock)** | CI every PR | `runtime/eval/mocks.py`로 고정 응답 | 빠름 (<30초) | 0원 |
| **Integration eval** | `pytest -m eval_integration` (수동/nightly) | 실제 Gemini/Ollama | 느림 | 케이스당 ~₩200 |
| **Replay eval** | 모델 업그레이드 시 `uv run eval replay` | 실제 LLM, 저장된 trajectory를 기대값으로 | 가장 느림 | ~₩200/케이스 |

**검증하는 메트릭** (`DEFAULT_CRITERIA`):

- `tool_trajectory_score` — 기대한 툴이 기대한 인자로 호출되었는가
- `forbidden_tool_score` — 금지 툴 미호출 (zero tolerance, 1.0 아니면 fail)
- `handoff_score` — 서브에이전트 위임 체인 일치
- `response_contains_score` — 최종 응답에 예상 substring 포함 (임계치 0.8)
- `cost_within_budget` / `duration_within_budget` — 리소스 상한 준수

**케이스 파일**: `apps/worker/eval/{agent}/*.yaml`. 최초 20~30개는 수동 작성, 이후 프로덕션 `agent_runs` 중 유저 👍/👎 런을 PII redaction 거쳐 golden dataset화.

**LLM judge (`response_match_llm`)는 nightly만.** 매 PR 실행 금지 — Gemini 호출 비용 발생.

### Seeded RNG 컨벤션

비결정성을 줄이기 위해 에이전트 테스트 내 모든 랜덤성은 **seed 고정**:

```python
# CPU에서 generator → device로 이동 (device-invariant seed)
import torch
g = torch.Generator(device="cpu")
g.manual_seed(42)
noise = torch.randn(n, generator=g).to(device)
```

- Python stdlib `random`: `random.seed(42)` — 테스트 모듈 상단
- `numpy.random.default_rng(42)` — numpy 사용 시
- Gemini/Ollama 호출 시 `temperature=0.0` + `seed`가 지원되면 지정

배경: pyturboquant 레포에서 채택된 재현 가능 RNG 패턴 (`rotation.py:64-73`).

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

## 5. CI Gate 기준 (필수 통과)

| Gate | 기준 | 실패 시 |
|------|------|--------|
| Lint | ESLint 0 errors (strict) | block merge |
| Type | `tsc --noEmit` 0 errors (web/api/shared) | block merge |
| Python type | `ruff check` + `mypy --strict` (apps/worker) | block merge |
| Unit coverage | ≥75% (packages/db, packages/shared, apps/api/src/lib) | warn (v0.1) → block (v0.3) |
| Integration coverage | ≥70% (CRUD routes, Hocuspocus, Temporal) | warn (v0.1) → block (v0.3) |
| E2E | 핵심 경로(signup→upload→wiki→chat) 통과 | block merge |
| Security | no `allow-same-origin`, no `postMessage(*,'*')` grep 통과 | block merge |
| Secret scan | gitleaks 통과 | block merge |

## 6. Collaboration Testing (Hocuspocus)

### Unit
- Yjs update encoding/decoding
- Awareness (presence) 어댑터
- auth hook (`canWrite` 모킹 → readOnly 판정)

### Integration
- 2-client 시뮬레이션 (ws-server 실제 기동 + y-websocket 클라이언트 2개)
  - Client A update → Client B 수신 <500ms
  - 동시 편집 CRDT reconcile
  - Viewer 클라이언트가 update 전송 시 서버 drop
- 코멘트 create → 알림 생성 (SSE) 확인
- @mention → 알림 + 이메일 큐 확인

### E2E (Playwright 2-tab)
- 탭 1 입력 → 탭 2 실시간 반영
- 탭 1 코멘트 → 탭 2 알림 표시
- 탭 1 @사용자 → 대상에게 알림
- Presence cursor 표시 확인

### CI
- `pnpm --filter @opencairn/hocuspocus test`
- `playwright test --grep @collaboration` (timeout 15s)

## 7. CI Pipeline

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
