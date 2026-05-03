# Agent Behavior Specification

> Plan 12 (agent-runtime-standard-design.md) 기준의 목표 계약. `runtime.Agent` ABC, `@tool` 데코레이터, `AgentEvent` 스트림은 새 런타임 에이전트의 표준이다.
>
> **2026-04-14 명단**: Compiler / Librarian / Research / Connector / Socratic / Temporal / Synthesis / Curator / Narrator / Deep Research / Code / Visualization (12개). Hunter는 v0.2로 이관됨.
>
> **2026-05-03 claim audit 반영**: 위 명단은 제품/설계 역할 목록이며, 현재 구현의 모든 항목이 `runtime.Agent` 서브클래스이거나 기본 활성 UI 엔트리포인트인 것은 아니다. 자세한 근거는 `docs/review/2026-05-03-agent-system-claim-audit.md`와 `docs/review/2026-05-03-claim-reality-master-audit.md`를 본다.

---

## 0. 현재 구현 인벤토리

이 표는 public copy에서 "12 production agents"처럼 읽히지 않도록 현재 구현 형태를 구분한다. 상태는 2026-05-03 감사 스냅샷 기준이며, 변경 시 코드와 `docs/contributing/plans-status.md`를 다시 확인한다.

| 역할 | 현재 구현 형태 | 제품 노출 상태 |
| --- | --- | --- |
| Compiler | `runtime.Agent` + ingest-triggered workflow | 업로드/컴파일 경로에서 간접 실행 |
| Research | `runtime.Agent` 존재, 최신 chat은 API-side retrieval 경로 중심 | 독립 에이전트 카드가 아니라 Q&A 표면 |
| Librarian | `runtime.Agent` maintenance role | 사용자 run 버튼보다 유지보수 역할 |
| Connector | `runtime.Agent` + Plan 8 API/UI | 프로젝트 Agents 페이지의 5개 카드 중 하나 |
| Socratic | workflow/activity 기반, `runtime.Agent` 클래스 없음 | Learn/Socratic 제품 표면 |
| Temporal/Staleness | `StalenessAgent` 구현, 이름은 Temporal Agent와 다름 | 프로젝트 Agents 페이지의 staleness 카드 |
| Synthesis | `runtime.Agent` + Plan 8 API/UI | 제안 생성 표면, Synthesis Export와 별개 |
| Curator | `runtime.Agent` + Plan 8 API/UI | 프로젝트 Agents 페이지의 5개 카드 중 하나 |
| Narrator | `runtime.Agent` + Plan 8 API/UI | 프로젝트 Agents 페이지의 5개 카드 중 하나 |
| Deep Research | workflow/activity 기반, `DeepResearchAgent` 클래스 없음 | 기능 플래그/route 기반 research 표면 |
| Code | workflow 기반, 명시적으로 `runtime.Agent` 아님 | `FEATURE_CODE_AGENT=false` 기본값 |
| Visualization | plain class + tool loop, `runtime.Agent` 아님 | 그래프 시각화 경로 |
| DocEditor | `runtime.Agent` 서브클래스, 원래 12개 명단 외 | slash/RAG command flag 기반 |

---

## 1. 공통 계약

- **인터페이스**: `Agent.run(input) -> AsyncGenerator[AgentEvent]`. `runtime.Agent`로 구현된 에이전트는 동일한 비동기 스트림 프로토콜을 따른다. workflow/activity 기반 기능은 이 목표 계약에 맞춰 점진 통합한다.
- **도구 호출**: 모든 LLM function call은 `@tool` 등록된 함수만 호출 가능 (화이트리스트). 각 도구는 `ToolContext`(`user_id`, `workspace_id`, `permissions`, `run_id`)를 통과받으며, context 없이 호출되면 `ToolError` 발생.
- **이벤트 타입 9종**: `RunStart`, `ModelStart`, `ModelEnd`, `ToolUse`, `ToolResult`, `StateUpdate`, `HandoffRequest`, `AgentError`, `RunEnd`. SSE로 UI에 스트리밍.
- **훅 3계층**: global / agent-level / run-level. 권한 검증, 비용 추적, 로깅 훅이 기본 global. `HookRegistry.register(hook, scope, agent_filter)`로 등록.
- **Trajectory**: NDJSON으로 S3/R2 저장 (`trajectories/{run_id}.ndjson`), 요약은 `agent_runs` Postgres 테이블(`id, agent_name, workflow_id, user_id, workspace_id, total_cost_krw, started_at, ended_at, status`).
- **Workspace 스코프**: 모든 activity input에 `workspace_id` + `user_id` 필수. 누락 시 Zod/Pydantic 검증 실패로 즉시 reject. 읽는 모든 리소스는 `WHERE workspace_id = $1` 강제 — cross-workspace 접근 절대 금지.

---

## 2. 가드레일

### 도구 화이트리스트
- 각 에이전트는 자신의 `allowed_tools` 외에는 호출 불가. LLM이 미등록 도구를 요청하면 runtime이 `ToolError` 주입 후 재계획 유도.

### Permission 검증
- 모든 툴은 실행 전 `ToolContext.permissions` 확인. `canRead`/`canWrite` 위반 시 `ToolError` 발생 → `AgentEvent.ToolResult(error=...)` yield.
- 사용자 트리거 run: 해당 user의 권한으로 실행 (권한 상승 금지).
- 자동 스케줄 run (Librarian/Curator/Temporal): workspace `owner` 권한으로 실행.
- Hocuspocus 에이전트 쓰기는 `canWrite` 통과 후에만 Yjs doc에 반영.

### Stop 조건
- `max_iterations` 기본 10 (agent-level override 가능). Deep Research만 30+.
- **Cost ceiling (per-run, 계획)**: hosted billing/credit rail은 Plan 9b 전까지 제품에 연결되지 않았다. 런타임은 비용 집계와 hard-cap hook을 목표로 하지만, public copy에서 실제 결제/환불/캐시 동작처럼 표현하지 않는다.
- 구조화 출력(Pydantic) 검증 실패 → 최대 2회 재시도 후 실패.

### 충돌 해결
- 동일 리소스 동시 쓰기 시 Temporal semaphore (`workspace:{wsId}:project:{pid}` max=1) — plan-3/4 workflow 레벨에서 적용.
- 우선순위: Compiler > Librarian > 나머지.
- `wiki_logs`에 변경 기록 (agent, action, diff, reason). 사용자 직접 편집(`is_auto=false`)은 에이전트가 덮어쓰지 못함 — 제안/리뷰 PR 경로만.

### 위키 수정 규칙
- 모든 위키 변경은 `wiki_logs`에 기록 (agent, action, diff, reason)
- 사용자 직접 수정 내용(`is_auto=false`)은 AI가 덮어쓰지 않음
- 충돌 시 양쪽 보존 + 사용자 알림

---

## 3. 에이전트별 동작 요약

### 3.1 Compiler
- **역할**: 파싱된 문서 → KG 노드 + 위키 페이지 생성
- **Tools**: `kg.upsert_node`, `kg.link`, `wiki.write_page`, `wiki.read_page`
- **Stop**: 모든 청크 처리 완료 / 추출 개념 0개 / max_iter=10
- **출력**: 위키 페이지 URL + 노드 ID 목록
- **Cost ceiling**: ₩500/run (Flash-Lite 기준 500K 토큰)

### 3.2 Research
- **역할**: 사용자 질문 → 하이브리드 검색 + 답변 생성 + 출처 인용
- **Tools**: `search.hybrid(query, scope_chips, mode)`, `kg.query`, `cite.format`
- **Stop**: 답변 생성 완료 / 관련 문서 0개 / max_iter=8
- **출력**: 답변 마크다운 + citations 배열
- **Cost ceiling**: ₩200/run (캐시 히트 시 ₩20)
- **제약**: 읽기 전용. 출처 없는 답변 금지 (최소 1개 인용).

### 3.3 Librarian
- **역할**: 주기적 KG 품질 관리 — 인덱스 갱신, 연결 강화, 병합/삭제 제안
- **Tools**: `kg.dedupe`, `kg.classify`, `wiki.reorganize`, `wiki.suggest_merge`
- **Stop**: 변경점 없음 / max_iter=5
- **제약**: Synthesis가 만든 페이지는 24시간 보호 기간 (삭제 방지)
- **Cost ceiling**: ₩500/run (정기 스케줄은 일 1회)

### 3.4 Visualization (Plan 5 M1)
- **역할**: ViewSpec 빌드 (Graph/Mindmap/Cards/Canvas/Timeline 5뷰)
- **Tools**: `view.build_graph`, `view.build_mindmap`, `view.build_cards`, `view.build_canvas`, `view.build_timeline`
- **Stop**: 단일 호출 (비반복)
- **출력**: Cytoscape ViewSpec JSON (노드/엣지/스타일/레이아웃 파라미터)
- **제약**: 최대 500 노드. 읽기 전용. Canvas 좌표는 `concept_positions`에 upsert만.
- **Cost ceiling**: ₩50/run

### 3.5 Socratic (Plan 6)
- **역할**: 학습 문답 — 퀴즈, 플래시카드 생성
- **Tools**: `flashcard.sm2_update`, `quiz.generate`, `wiki.read_page`
- **Stop**: 템플릿 충족 / max_iter=3
- **제약**: 위키에 없는 내용으로 문제 출제 금지. 한 번에 최대 30 카드.
- **Cost ceiling**: ₩150/run

### 3.6 Code (Plan 7)
- **역할**: 코드 문자열 **생성만**. 실행은 브라우저 샌드박스 (Pyodide/iframe postMessage, ADR-006)
- **Tools**: `sandbox.run_python`, `sandbox.run_js` (둘 다 브라우저 위임)
- **Stop**: self-healing 3회 / max_iter=5
- **제약**: iframe sandbox는 `allow-scripts`만. `allow-same-origin` 절대 금지. 서버 코드 실행 없음.
- **Cost ceiling**: ₩200/run

### 3.7 Connector (Plan 8)
- **역할**: 외부 URL/API 연결, cross-project 연결 제안
- **Tools**: `external.fetch_url`, `external.oauth_call`, `kg.suggest_link`
- **Stop**: 제안 최대 10개 / max_iter=5
- **제약**: 같은 workspace 내에서만 연결 제안. 자동 연결 금지 (제안만).
- **Cost ceiling**: ₩300/run

### 3.8 Temporal (Plan 8)
- **역할**: **stale 감지 + 스케줄링만**. 지식 변화 추적.
- **Tools**: `kg.find_stale`, `schedule.create`, `notify.send`
- **Stop**: stale 없음 / max_iter=3
- **제약**: **Timeline 생성 금지 — Visualization Agent 담당.** 읽기 전용.
- **Cost ceiling**: ₩100/run

### 3.9 Synthesis (Plan 8)
- **역할**: 다중 소스 종합, 창발적 연결 제안
- **Tools**: `kg.query`, `doc.compile`, `wiki.suggest_page`
- **Stop**: 개념 10개 미만이면 즉시 종료 / max_iter=5
- **제약**: 제안만. 사용자 확인 후 Compiler가 실제 페이지 생성.
- **Cost ceiling**: ₩500/run (주간 스케줄)

### 3.10 Curator (Plan 8)
- **역할**: KG 품질 개선 제안 — 태그, 링크, 외부 자료 추천
- **Tools**: `kg.suggest_tags`, `kg.suggest_links`, `external.search_grounding`
- **Stop**: 제안 10개 / max_iter=3
- **제약**: Gemini Google Search Grounding만 사용 (직접 크롤링 금지).
- **Cost ceiling**: ₩150/run

### 3.11 Narrator (Plan 8)
- **역할**: 서술형 문서/오디오 생성
- **Tools**: `doc.compile`, `tts.synthesize` (Gemini MultiSpeakerVoiceConfig)
- **Stop**: 단일 호출
- **제약**: 오디오 50MB 제한. Free 티어 월 3회.
- **Cost ceiling**: ₩800/run (TTS 비용 지배적)

### 3.12 Deep Research (Plan 8)
- **역할**: 장문 리서치. child workflow 생성 가능.
- **Tools**: `gemini.deep_research_start`, `gemini.deep_research_poll`
- **Stop**: Gemini API 완료 / 30분 타임아웃 / max_iter=30+
- **제약**: 결과는 바로 위키 저장 안 함 — 사용자 확인 후 Compiler가 처리.
- **Cost ceiling**: 별도 (건당 ₩2,000-5,000). Free 티어 제외 (Pro/BYOK만).

---

## 4. 재시도 / 타임아웃

### Temporal Activity 레벨 (plan-3/4에서 정의)
- 기본 재시도 3회, 초기 간격 5s, 지수 backoff (계수 2.0), 최대 간격 60s
- Deep Research: 재시도 무제한 + 30분 타임아웃 (Gemini background API 폴링)

### Agent 레벨
- 툴 실패 시 LLM에 error 전달 → 에이전트가 retry/replan 결정 (내부 최대 3회)
- LLM 환각 감지: 구조화 출력(Pydantic) 스키마 위반 시 재시도 2회 후 실패

### 에러 처리
- Gemini 429 (rate limit): 지수 백오프 (1s → 2s → 4s → 8s)
- Gemini 5xx: 최대 3회 재시도 후 job status=failed
- Worker 크래시: Temporal이 마지막 완료 Activity부터 재개

---

## 5. 비용 추적

- 모든 `ModelEnd` 이벤트에 `cost_krw` 필드 포함 (prompt_tokens × provider_rate + completion_tokens × provider_rate).
- `agent_runs.total_cost_krw`에 run 단위 집계. `credit_balances`에서 차감 (PAYG).
- 월간 집계 뷰: `monthly_agent_costs(user_id, workspace_id, agent_name, total_cost_krw)`.
- BYOK run은 `is_byok=true` 플래그 — 비용 집계에서 제외.

### 티어별 상한

| 티어 | Per-run 기본 | 예외 |
|------|------------|------|
| Free | 계획 | Deep Research/Narrator 제한 예정 |
| BYOK | 계획 | 현재는 user-level Gemini BYOK 설정부터 구현 |
| Pro | 계획 | Plan 9b 이후 hosted billing에서 확정 |
| Enterprise | Custom | 협의 |

---

## 6. Agent Interaction Matrix

어느 에이전트가 어느 에이전트를 트리거할 수 있는지. `HandoffRequest` 이벤트로만 요청, 워크플로우가 승인.

| 트리거 → | Compiler | Librarian | Research | Connector | Socratic | Temporal | Synthesis | Curator | Narrator | Deep | Code | Viz |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Compiler** | - | O | X | X | X | X | X | X | X | X | X | O |
| **Librarian** | X | - | X | X | X | X | X | O | X | X | X | O |
| **Research** | O | X | - | X | X | X | X | X | X | X | O | X |
| **Curator** | O | X | X | X | X | X | X | - | X | X | X | X |
| **Deep** | O | X | X | X | X | X | X | X | X | - | X | X |
| (나머지) | X | X | X | X | X | X | X | X | X | X | X | X |

트리거 체인 깊이 **최대 3단계** (무한 루프 방지).

---

## 7. Failure Modes & Recovery

| 실패 모드 | 영향 | 복구 전략 |
|-----------|------|-----------|
| Gemini API 다운 | 모든 에이전트 중단 | Temporal 재시도 (지수 백오프, 최대 1시간) |
| Worker 크래시 | 실행 중 에이전트 중단 | Temporal이 마지막 완료 Activity부터 재개 |
| DB 커넥션 풀 고갈 | 쿼리 실패 | Activity 재시도 + 풀 크기 모니터링 |
| 무한 트리거 체인 | 리소스 고갈 | 체인 깊이 3 제한 |
| LLM 환각 | 위키 오염 | Pydantic 검증 + Librarian 일관성 체크 |
| Cost ceiling 초과 | run 중단 | `AgentError(cost_exceeded)` yield + RunEnd |
| 대용량 입력 | 메모리 부족 | 청크 처리 (페이지/단락 단위) |
