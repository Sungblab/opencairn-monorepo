# Temporal Workflow Definitions

에이전트 오케스트레이션을 위한 Temporal 워크플로우 설계.

---

## 1. Workflow Overview

```
Hono API
  |
  v
Temporal Server (temporalio/auto-setup)
  |
  ├── IngestWorkflow          (자료 업로드 → 파싱 → Compiler → Librarian)
  ├── ResearchWorkflow        (사용자 질문 → 검색 → 응답 → 업류)
  ├── DeepResearchWorkflow    (딥 리서치 요청 → Gemini API → 위키 통합)
  ├── LearningWorkflow        (Tool Template 실행 → Socratic/Narrator/Code)
  ├── MaintenanceWorkflow     (일간 유지보수 → Librarian + Temporal + Synthesis + Curator)
  └── ConnectorWorkflow       (주간 유지보수 → 새로운 프로젝트 연결)
  |
  v
Python Worker (Temporal Worker)
  ├── Activities: parse_pdf, transcribe_audio, compile_wiki, ...
  └── LangGraph: agent internal state machines
```

---

## 2. Workflow Definitions

### 2.1 IngestWorkflow

가장 중요한 워크플로우. 파일 업로드부터 위키 생성까지.

```python
@workflow.defn
class IngestWorkflow:
    @workflow.run
    async def run(self, input: IngestInput) -> IngestOutput:
        # 1. 파싱 (소스 타입별 분기)
        parsed = await workflow.execute_activity(
            parse_source,
            input,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )

        # 2. Gemini 멀티모달 보강 (복잡한 페이지)
        if parsed.has_complex_pages:
            enhanced = await workflow.execute_activity(
                enhance_with_gemini_multimodal,
                parsed,
                start_to_close_timeout=timedelta(minutes=5),
            )
            parsed = merge_parsed(parsed, enhanced)

        # 3. 임베딩 생성
        embedded = await workflow.execute_activity(
            generate_embeddings,
            parsed,
            start_to_close_timeout=timedelta(minutes=5),
        )

        # 4. Source 노트 생성
        source_note = await workflow.execute_activity(
            create_source_note,
            embedded,
            start_to_close_timeout=timedelta(minutes=1),
        )

        # 5. Compiler Agent (세마포어로 직렬화 보장)
        async with workflow.semaphore(f"project:{input.project_id}", max=1):
            wiki_pages = await workflow.execute_activity(
                run_compiler_agent,
                source_note,
                start_to_close_timeout=timedelta(minutes=5),
            )

        # 6. Librarian 트리거 (비동기, 결과 안 기다림)
        await workflow.start_child_workflow(
            MaintenanceWorkflow.run,
            MaintenanceInput(project_id=input.project_id, trigger="post_ingest"),
        )

        return IngestOutput(
            source_note_id=source_note.id,
            wiki_page_ids=[p.id for p in wiki_pages],
        )
```

### 2.2 ResearchWorkflow

실시간 Q&A. 스트리밍이 필요하기 때문에 Temporal은 오케스트레이션만, 실제 스트리밍은 SSE로.

```python
@workflow.defn
class ResearchWorkflow:
    @workflow.run
    async def run(self, input: ResearchInput) -> ResearchOutput:
        # 1. 하이브리드 검색 (쓰기 없음, 세마포어 불필요)
        search_results = await workflow.execute_activity(
            hybrid_search,
            input,
            start_to_close_timeout=timedelta(minutes=1),
        )

        # 2. Research Agent 실행
        answer = await workflow.execute_activity(
            run_research_agent,
            ResearchAgentInput(
                question=input.question,
                search_results=search_results,
                conversation_id=input.conversation_id,
            ),
            start_to_close_timeout=timedelta(minutes=3),
        )

        # 3. 위키 업류 (새 인사이트 발견 시)
        if answer.has_new_insights:
            async with workflow.semaphore(f"project:{input.project_id}", max=1):
                await workflow.execute_activity(
                    run_compiler_agent,
                    answer.insights,
                    start_to_close_timeout=timedelta(minutes=3),
                )

        return answer
```

### 2.3 DeepResearchWorkflow

수십 분 비동기 실행 (5-20분).

```python
@workflow.defn
class DeepResearchWorkflow:
    @workflow.run
    async def run(self, input: DeepResearchInput) -> DeepResearchOutput:
        # 1. 위키에서 기존 지식 수집
        context = await workflow.execute_activity(
            gather_wiki_context,
            input,
            start_to_close_timeout=timedelta(minutes=2),
        )

        # 2. Gemini Deep Research API 호출 (background=True)
        interaction_id = await workflow.execute_activity(
            start_gemini_deep_research,
            DeepResearchRequest(
                topic=input.topic,
                wiki_context=context,
            ),
            start_to_close_timeout=timedelta(minutes=2),
        )

        # 3. 폴링 (완료까지 대기)
        report = await workflow.execute_activity(
            poll_deep_research_result,
            interaction_id,
            start_to_close_timeout=timedelta(minutes=30),
            heartbeat_timeout=timedelta(minutes=2),  # 주기적 하트비트
        )

        # 4. 위키 통합 (사용자 확인 후)
        # 완 리포트를 jobs.output에 저장, 사용자가 확인하면 별도 IngestWorkflow 시작

        return DeepResearchOutput(report=report)
```

### 2.4 LearningWorkflow

Tool Template 실행 (퀴즈, 플래시카드, 슬라이드, 팟캐스트 등).

```python
@workflow.defn
class LearningWorkflow:
    @workflow.run
    async def run(self, input: LearningInput) -> LearningOutput:
        # 1. 위키 컨텍스트 수집
        context = await workflow.execute_activity(
            gather_wiki_context,
            input,
            start_to_close_timeout=timedelta(minutes=1),
        )

        # 2. 에이전트로 분기
        match input.agent:
            case "socratic":
                result = await workflow.execute_activity(
                    run_socratic_agent,
                    SocraticInput(context=context, template=input.template),
                    start_to_close_timeout=timedelta(minutes=2),
                )
            case "narrator":
                result = await workflow.execute_activity(
                    run_narrator_agent,
                    NarratorInput(context=context),
                    start_to_close_timeout=timedelta(minutes=10),
                )
            case "code":
                result = await workflow.execute_activity(
                    run_code_agent,
                    CodeInput(context=context, template=input.template),
                    start_to_close_timeout=timedelta(minutes=2),
                )
            case _:
                # Research agent handles other templates
                result = await workflow.execute_activity(
                    run_research_agent,
                    ResearchAgentInput(context=context, template=input.template),
                    start_to_close_timeout=timedelta(minutes=3),
                )

        return LearningOutput(result=result)
```

### 2.5 MaintenanceWorkflow

일간 유지보수 또는 인제스트 후 트리거.

```python
@workflow.defn
class MaintenanceWorkflow:
    @workflow.run
    async def run(self, input: MaintenanceInput) -> None:
        async with workflow.semaphore(f"project:{input.project_id}", max=1):
            # 1. Librarian
            await workflow.execute_activity(
                run_librarian_agent,
                input.project_id,
                start_to_close_timeout=timedelta(minutes=10),
            )

            # 2. Temporal Agent (지식 변화 추적)
            await workflow.execute_activity(
                run_temporal_agent,
                input.project_id,
                start_to_close_timeout=timedelta(minutes=3),
            )

        # 3. Synthesis (세마포어 밖 → 제안만 생성, 위키 수정 없음)
        await workflow.execute_activity(
            run_synthesis_agent,
            input.project_id,
            start_to_close_timeout=timedelta(minutes=5),
        )

        # 4. Curator (세마포어 밖 → 추천만 생성)
        await workflow.execute_activity(
            run_curator_agent,
            input.project_id,
            start_to_close_timeout=timedelta(minutes=3),
        )
```

### 2.6 ConnectorWorkflow

주간 유지보수.

```python
@workflow.defn
class ConnectorWorkflow:
    @workflow.run
    async def run(self, input: ConnectorInput) -> None:
        await workflow.execute_activity(
            run_connector_agent,
            input.user_id,
            start_to_close_timeout=timedelta(minutes=5),
        )
```

---

## 3. Temporal Schedules (Cron)

```python
# Worker 시작 시 등록
async def register_schedules(client: Client):
    # 일간 유지보수 (매일 03:00 UTC)
    await client.create_schedule(
        "daily-maintenance",
        Schedule(
            action=ScheduleActionStartWorkflow(
                MaintenanceWorkflow.run,
                MaintenanceInput(trigger="daily"),
            ),
            spec=ScheduleSpec(cron_expressions=["0 3 * * *"]),
        ),
    )

    # 주간 Connector (매주 일요일 04:00 UTC)
    await client.create_schedule(
        "weekly-connector",
        Schedule(
            action=ScheduleActionStartWorkflow(
                ConnectorWorkflow.run,
                ConnectorInput(),
            ),
            spec=ScheduleSpec(cron_expressions=["0 4 * * 0"]),
        ),
    )
```

---

## 4. Retry Policies

| Activity 유형 | 최대 재시도 | 초기 간격 | 최대 간격 | 백오프 계수 |
|---------------|-----------|----------|----------|-----------|
| Gemini API 호출 | 5 | 1s | 60s | 2.0 |
| DB 쿼리 | 3 | 500ms | 5s | 2.0 |
| 파일 파싱 | 2 | 1s | 10s | 2.0 |
| Cloudflare R2 업로드/다운로드 | 3 | 1s | 30s | 2.0 |
| Deep Research 폴링 | 무제한 | 10s | 60s | 1.5 |

---

## 5. Dead Letter Queue (DLQ)

- **정의**: Temporal Activity 최대 재시도(3회 기본, Deep Research 무제한) 실패 시 `dlq_events` 테이블에 기록 + Telegram 알림.
- **스키마**: `dlq_events { id, workflow_id, activity_type, input_json, error, failed_at, user_id, workspace_id }`
- **재실행**: 관리자가 원인 수정 후 `pnpm dlq:retry <id>` CLI로 재큐.
- **보존**: 30일 후 자동 삭제 (GDPR).

---

## 6. Worker Scaling

| 환경 | Worker Pool | 메모리 | 용도 |
|------|------------|--------|------|
| dev | 1 (로컬) | 2GB | 전체 워크플로우 |
| staging | 2 | 4GB 각 | ingest + agent 분리 |
| prod (v0.1) | 3 | 8GB 각 | ingest / agent / deep_research |
| prod (scale) | HPA: CPU 70% 트리거, max 10 | 8GB | 큐별 auto-scale |

- **Task queue 분리**: `ingest-queue`, `agent-queue`, `deep-research-queue` 3개.
- **Idempotency**: 모든 workflow는 `workflow_id = "{type}:{resource_id}:{user_id}"` 규칙.

---

## 7. Workflow Versioning

- Temporal `GetVersion` API 사용.
- Breaking change 시 major version bump (`workflow_v1` → `workflow_v2`), 기존 실행은 old 로직 유지.
- 배포 전 `workflow_versioning.md`에 rationale 기록 (템플릿 제공).

---

## 8. Observability

- Temporal Web UI: `http://localhost:8233` (개발), 워크플로우 상태/히스토리 확인
- 각 워크플로우의 progress를 jobs 테이블에서 조회 (프론트엔드 표시)
- Activity 실패 시 Temporal이 자동 로깅 (검색 가능)
