# Agent Platform Roadmap

OpenCairn agent runtime/observability/integration 백로그. **2026-04-28 시점 솔직 평가**.

현재 스택: Temporal (오케스트레이션) + 자체 `runtime.Agent` (Plan 12 + v2 Sub-A) + `packages/llm` (Gemini/Ollama). LangGraph/LangChain 미사용 — `runtime/langgraph_bridge.py`는 외부 그래프 호환용 어댑터로만 잔존, production 호출 0건.

## 결론

지금 구조는 **"적정 기술"** 수준이지 최고는 아님. agent 루프/오케스트레이션 자체는 견고하지만 **관찰성·eval·외부 통합 표준화가 약점**. LangGraph는 안 들여도 되지만 아래 항목들은 들여야 함.

---

## A. 도입 검토 (외부 라이브러리/표준)

### A1. MCP (Model Context Protocol) 클라이언트 — **우선순위 1**

**왜**
- Notion / Drive / GitHub / Linear / Slack 등 외부 툴을 매 통합마다 activity로 짜는 대신 표준 MCP 서버 연결로 추상화
- Claude Code, Cursor, ChatGPT Desktop 모두 MCP 서버 생태계 빠르게 자라는 중
- 우리 ingest 확장 패턴(Drive · Notion ZIP)이 정확히 MCP 모델과 맞음

**범위**
- `apps/worker/src/runtime/mcp_client.py` — stdio + SSE transport
- 기존 `Tool` 추상화에 MCP 툴 어댑터 (MCP 툴 → `runtime.Tool` 변환)
- workspace settings에서 MCP 서버 등록 UI
- 보안: 서버별 scope 게이팅, secrets는 BYOK 패턴 재사용

**비고**
- 메모리: "MCP client는 다음 세션 별도 spec" 이미 잡혀있음
- Plan 11B Phase B 이후 진행 가능

### A2. LLM Observability — Langfuse self-hosted — **우선순위 2**

**왜**
- 현재: `trajectory_writer` + Sentry → "한 run 내부" 만 보임
- 부재: "지난 7일간 Compiler agent 평균 latency / cost / 실패율 / p95 토큰" 집계 대시보드
- Langfuse: MIT, Docker Compose, AGPL 호환. Spec B (AI Usage Visibility) 일부를 공짜로 줌

**범위**
- `docker-compose.yml` 에 langfuse + clickhouse 프로필
- `runtime/default_hooks.py`에 LangfuseHook 추가 (TrajectoryWriter와 병렬)
- env-only, OSS 배포본은 자동 비활성화

**대안**: Arize Phoenix (Apache 2, OpenTelemetry 친화) — 비교 후 결정

### A3. DSPy / 프롬프트 자동 튜닝 — **우선순위 5 (보류)**

**언제 쓸지**
- agent 정확도 한 번 측정한 뒤 회귀가 보일 때
- prompts.py 버전 관리 자동화 필요할 때

지금 도입은 오버엔지니어링. eval harness(B1) 먼저 돌리고 데이터 쌓이면 결정.

### A4. Temporal Update-with-Start / Nexus — **우선순위 4**

- **Update-with-Start**: 워크플로 시작 + 첫 결과 동시 받기. 현재 SSE 첫 토큰 받기까지 awkward한 패턴 정리
- **Nexus**: namespace 분리 — 워커 스케일링 시점 (현재는 불필요)

### A5. 도입 안 함 (검토 끝)

| 라이브러리 | 안 쓰는 이유 |
|-----------|------------|
| LangGraph / LangChain | 노드 그래프 라우팅 패턴 우리한텐 거의 없음. Temporal workflow가 그 역할 흡수 |
| Pydantic AI / CrewAI / Mastra | 자체 `runtime.Agent`가 hook/scope/trajectory 더 정교 |
| LiteLLM | provider 2개라 자체 추상화가 더 가벼움 |
| Letta / MemGPT | KG + wiki + RAG로 이미 메모리 풀고 있음 |
| Instructor / Outlines | Gemini native `response_schema`로 충분 |
| 별도 벡터 DB (Qdrant / LanceDB) | pgvector + BM25 RRF로 충분 |

---

## B. 라이브러리로 못 푸는 약점 (내부 작업)

### B1. eval harness CI 통합 — **우선순위 2 (A2와 병렬)**

**현재**: `runtime/eval/` 하니스(EvalCase / score_trajectory) 만들어뒀지만 CI에서 안 돌림 → 프롬프트/모델 회귀 못 잡음.

**할 일**
- 핵심 agent 5개 (Compiler / Research / Librarian / Code / Visualization) 각 5~10 EvalCase 작성
- GitHub Actions: PR마다 nightly eval. 회귀 시 PR comment로 점수 diff
- BYOK 키 안 쓰는 fixture-only 모드 (ollama or recorded responses)

### B2. Prompt 버전 관리 — **우선순위 3**

**현재**: `worker/agents/*/prompts.py` 코드에 박힌 문자열. A/B 테스트 X, "어떤 버전이 언제 prod 들어갔는지" 추적 X.

**할 일**
- prompts에 `VERSION` 상수 + content hash
- trajectory 이벤트에 prompt_hash 기록 → 비교 가능
- (선택) admin UI에서 prompt diff viewer

### B3. Streaming UX 일관성 — **우선순위 3**

**현재**: agent마다 SSE 포맷 다름. humanizer spec(메모리 `agent_ux_specs`) 만들어놓고 미적용.

**할 일**
- 표준 이벤트 envelope: `{type, agent, seq, payload}` 강제
- 클라이언트 hook (`useAgentStream`) 단일화
- Plan 11B Phase A에서 일부 정비 — 끝까지 sweep

### B4. Multi-agent handoff 패턴 정립 — **우선순위 4**

**현재**: `Handoff` 이벤트 타입 정의는 있지만 실제로 multi-agent 협업 표준 없음. Plan 8 Connector/Curator/Synthesis는 사실상 독립 실행.

**할 일**
- handoff 컨벤션 문서: 입력/출력 계약, 컨텍스트 전달 규칙
- 1 케이스 시범 적용 (예: Compiler → Librarian wiki feedback)
- Temporal child workflow vs in-process handoff 가이드

### B5. Trajectory UI — **우선순위 4**

**현재**: trajectory가 DB+파일에 박제되는데 사람이 읽을 도구가 없음. SQL로 직접 까야 함.

**할 일**
- `/admin/trajectory/:runId` — 이벤트 타임라인 + 툴 콜 펼치기 + LLM 입출력 diff
- workspace owner가 자기 워크스페이스 run만 볼 수 있게 scope 게이팅
- Langfuse(A2) 도입하면 일부 대체 가능 — 우선 read-only 자체 뷰부터

### B6. Worker task queue 분리 — **우선순위 6 (스케일 시점)**

**현재**: 단일 Temporal task queue. Deep Research(30분) + ingest(빠른 batch)가 같은 큐 → head-of-line blocking 가능.

**할 일** (부하 관찰 후)
- queue 3분할: `ingest` / `agents` / `long-running`
- 워커 별도 프로세스, 동시성 limit 다르게
- ops runbook 업데이트

### B7. Cost dashboard — **우선순위 3 (Spec B 흡수)**

**현재**: TokenCounterHook으로 토큰/원화 추정 잡고 있지만 `user × agent × day` 집계 뷰 없음.

**할 일**: Spec B (AI Usage Visibility) 본 plan 작성 시 흡수. Langfuse(A2) 도입하면 상당 부분 무료로 풀림.

---

## 우선순위 정리

| 순위 | 항목 | 분류 | 의존 |
|-----|------|-----|-----|
| 1 | A1 MCP 클라이언트 | 외부 표준 | Plan 11B Phase B 이후 |
| 2 | A2 Langfuse + B1 eval CI (병렬) | 관찰성 | 독립 |
| 3 | B2 prompt 버전 / B3 streaming 일관성 / B7 cost dashboard | 내부 정비 | A2와 시너지 |
| 4 | A4 Temporal Update-with-Start / B4 handoff / B5 trajectory UI | 정합성 | 부분 독립 |
| 5 | A3 DSPy | 자동 튜닝 | B1 데이터 필요 |
| 6 | B6 worker queue 분리 | 스케일 | 부하 관찰 후 |

## 다음 단계

1. 이 문서 검토 후 우선순위 확정
2. 각 항목별 spec/plan 작성 (별도 세션)
3. Plan 11B Phase B / Synthesis Export 등 in-flight 작업 끝난 뒤 1순위부터 착수

---

## 부록: LangGraph/LangChain 정리

- 미사용 (production 호출 0건)
- `runtime/langgraph_bridge.py` 는 외부 LangGraph 그래프를 받았을 때 동일한 `AgentEvent` 스트림으로 변환하는 호환 레이어로만 남김 — 외부 컨트리뷰터 호환성 차원
- Older internal notes referred to "LangGraph per agent"; the public runtime direction is **Temporal + runtime.Agent**.
