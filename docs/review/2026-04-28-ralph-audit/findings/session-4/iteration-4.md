# Session 4 — Iteration 4 Findings

**영역**: Area 6 (Plan 11B DocEditorAgent)  
**범위**: `apps/worker/src/worker/agents/doc_editor/` (agent.py, commands/), `apps/worker/src/worker/activities/doc_editor_activity.py`, `apps/worker/src/worker/workflows/doc_editor_workflow.py`, `apps/api/src/routes/doc-editor.ts`

---

## 체크리스트 결과

| 항목 | 결과 |
|------|------|
| `DocEditorWorkflow` timeout/retry 설계 | ✅ `start_to_close_timeout=45s`, `maximum_attempts=2` — 단일 LLM 호출에 적절 |
| `FEATURE_DOC_EDITOR_SLASH` 게이트 — API 라우트 범위 | ✅ `use("/notes/:noteId/doc-editor/*")` 경로 범위 — wildcard 버그 방지 주석 포함 (PR #67/#84 교훈) |
| `canWrite` 권한 검사 존재 | ✅ `doc-editor.ts:72` |
| SSE `stream.onAbort` → `handle.cancel()` | ✅ `doc-editor.ts:166-173` |
| `docEditorCalls` 감사 로그 (성공 + 실패 양쪽) | ✅ lines 195, 221 — temporal 연결 실패 포함 3-way 커버 |
| 알 수 없는 커맨드 → 400 | ✅ `docEditorCommandSchema.safeParse` 선검사 + `get_command_spec()` KeyError → activity 400 |
| 커맨드 스펙 4개 완전성 | ✅ improve/translate/summarize/expand 전부 `COMMANDS` 딕셔너리 등록 |
| Note 소프트삭제 필터 | ❌ **S4-010** |
| `_noop_emit` 궤적 훅 없음 (S4-007 재확인) | ⚠️ S4-007 기존 발견 확인 — `_invoke_agent` 호출 시 `emit=_noop_emit` |
| `_SeqCounter` 중복 (S4-004 재확인) | ⚠️ `agent.py:59-67` S4-004 확인 |
| `tokens_in/out=0` 반환 (S4-003 재확인) | ⚠️ `agent.py` S4-003 확인 |

---

## 발견 (Findings)

### S4-010 [LOW] `doc-editor.ts` — Note 소프트삭제 필터 누락

**파일**: `apps/api/src/routes/doc-editor.ts:64-67`

```typescript
const [note] = await db
  .select({ id: notes.id, workspaceId: notes.workspaceId })
  .from(notes)
  .where(eq(notes.id, noteId));  // ← isNull(notes.deletedAt) 누락
```

**증상**: `deletedAt IS NOT NULL`인 소프트삭제 노트도 `note` 행 반환 → `if (!note)` 통과 → `canWrite` 통과(노트 행 존재) → Temporal 워크플로 시작 → LLM 호출 발생.

삭제된 노트 내용에 대한 불필요한 LLM 비용이 발생하고, `docEditorCalls`에 존재하지 않는 노트 ID가 기록된다. `canWrite` 내부에서도 `deletedAt` 체크 여부에 따라 권한 판단이 달라질 수 있다.

**영향**: `FEATURE_DOC_EDITOR_SLASH=false` 기본값으로 현재 잠재적 버그 상태. 기능 활성화 시 즉시 발화 가능.

**수정**:
```typescript
.where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
```

---

## 주요 안전 확인 (확인됨 ✅)

- `DocEditorWorkflow` 단순 래퍼 — `start_to_close_timeout=45s` × `maximum_attempts=2`, `schedule_to_close_timeout` 미설정(무한이지만 Temporal 워크플로 자체 제약에 의해 관리) ✅
- 기능 게이트 경로 범위 주석: wildcard 버그(PR #67/#84)를 방지하기 위해 `/notes/:noteId/doc-editor/*`로 한정 ✅
- 커맨드 파싱 선검사(schema) → DB 조회 없이 400 ✅
- 감사 로그: Temporal 연결 실패/activity 실패/성공 3가지 경우 모두 `docEditorCalls` INSERT ✅
- `stream.onAbort` → `handle.cancel()` — 클라이언트 disconnect 처리 ✅
- 커맨드 스펙 4개 (improve/translate/summarize/expand) `COMMANDS` 딕셔너리 완전 등록 ✅
- `improve.py` 대표 확인: `output_mode="diff"`, JSON-only 응답 요구 system prompt ✅

---

## 다음 Iteration 영역

**Iteration 5**: Area 7+8 (Code Agent + Visualization Agent)  
- `apps/worker/src/worker/agents/code_agent/`
- `apps/api/src/routes/code.ts`
- `apps/worker/src/worker/workflows/code_workflow.py` (또는 유사 경로)
- Visualization Agent 관련 활동/워크플로
