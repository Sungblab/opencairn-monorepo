# Ingest Source Expansion — Google Drive & Notion Import

**Status:** Draft (2026-04-22)
**Owner:** Sungbin
**Related:**

- [2026-04-09-plan-3-ingest-pipeline.md](../plans/2026-04-09-plan-3-ingest-pipeline.md) — 본 spec이 확장하는 Plan 3 파이프라인
- [2026-04-21-plan-3b-batch-embeddings.md](../plans/2026-04-21-plan-3b-batch-embeddings.md) — bulk import의 임베딩 경로로 활용
- [data-flow.md](../../architecture/data-flow.md) — Ingest Flow (자료 → 위키). 본 spec의 결과물은 이 파이프라인에 합류
- [api-contract.md](../../architecture/api-contract.md) — Zod + requireAuth + workspace scope 규약
- [collaboration-model.md](../../architecture/collaboration-model.md) — 페이지 권한 · workspace 3계층
- [security-model.md](../../architecture/security-model.md) — BYOK 암호화 패턴 (본 spec의 OAuth 토큰 저장에 재사용)
- [storage-planning.md](../../architecture/storage-planning.md) — 워크스페이스 용량 카운터 (import 파일도 포함)
- [billing-model.md](../../architecture/billing-model.md) — BYOK/PAYG/Pro 경로 (새 gate 없음)
- [llm-antipatterns.md](../../contributing/llm-antipatterns.md) — Plate v49 함정 §8 (Notion MD → Plate 변환 시 반드시 참고)

## Dependencies

- **Plan 1** — Better Auth, workspace 3계층 권한, `users` / `workspaces` / `projects` / `notes` 스키마
- **Plan 3** — `IngestWorkflow`, MinIO, `sourceTypeEnum`, 8개 ingest activities (PDF/STT/Image/Web/Enhance/Note/Quarantine/YouTube)
- **Plan 3b** — `packages/llm` batch embedding surface, `embed_many()` helper, `BATCH_EMBED_*` flags (본 spec의 fast-path가 이 경로 활용)
- **Plan 9a** — i18n (next-intl, ko/en, ESLint `no-literal-string`, parity CI)
- **Plan 13** — `packages/llm` async provider 패턴 (임베딩 호출)
- **Plan 2A** — Plate v49 에디터 + `notes` 테이블 (imported 결과의 저장 포맷)
- **Feature flag** — 신규 `FEATURE_IMPORT_ENABLED` env (기본 off)
- **Env (관리형 전용)** — `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `INTEGRATION_TOKEN_ENCRYPTION_KEY`

### 엔티티 명명 규칙

OpenCairn 내부에서 "page" / "note" / "편집 가능한 문서"는 모두 **DB 테이블 `notes`** 를 가리킨다. UI 카피에서만 "페이지"로 부른다. 본 spec의 "Page"/"페이지"로 표기된 부분은 전부 `notes` 테이블 행이다. FK · 내부 API 경로 · 코드 심볼은 모두 `note(s)` 로 통일한다.

---

## 1. Problem

OpenCairn 사용자는 기존 지식 자산(Google Drive 파일, Notion 워크스페이스)을 OpenCairn으로 가져올 방법이 없다. 특히 Notion 이주자는 **"Notion 대체" 포지셔닝의 핵심 타겟**인데 마이그레이션 경로가 없으면 유입 자체가 막힌다.

구체적 고통:

1. **Notion 이주자**: 수백 페이지를 수동 복붙 — 현실적으로 불가능, 이주 포기
2. **Drive 헤비 유저**: 연구·업무 PDF·문서가 전부 Drive에 — OpenCairn에서 새로 업로드해야 RAG 활용 가능 (이중 저장)
3. **팀/스타트업**: 과거 Notion/Drive 자산을 OpenCairn에서 검색 가능한 상태로 만들지 못함 → 현실적으로 병행 운영

본 spec은 두 경로 모두를 **one-shot 임포트**로 해결한다.

---

## 2. Goals & Non-Goals

### Goals (MVP)

- **Google Drive one-shot 임포트**: 사용자가 Drive에서 파일/폴더 선택 → MinIO로 복사 + 기존 Plan 3 파이프라인으로 인덱싱
- **Notion ZIP 임포트**: 공식 "Markdown & CSV" export 업로드 → 계층 보존, `.md` → Plate 직변환, 첨부파일 MinIO
- **타겟 선택**: 새 프로젝트 생성 또는 기존 프로젝트 아래 편입 (라디오 + combobox)
- **계층 보존**: Notion 페이지 트리 그대로 / Drive 폴더 트리 그대로 (`parentNoteId` 체인)
- **Drive OAuth**: env-based credentials, per-user 토큰, AES-256-GCM 암호화. `drive.file` scope만 사용 (Google Picker 경유, RESTRICTED scope 회피)
- **전용 `/w/[slug]/import` 라우트**: 탭 [Drive / Notion ZIP]
- **과금 posture**: 새 gate 없음. 기존 ingest 경로의 BYOK/PAYG/Pro 로직 그대로 적용. 워크스페이스 용량 한도도 기존 카운터 재사용.
- **에러 회복**: 아이템 단위 실패 허용 (job 전체 abort 금지), per-item 재시도 버튼, OAuth 만료 시 refresh 1회 재시도
- **Self-host 친화**: `GOOGLE_OAUTH_CLIENT_ID` 없으면 Drive 탭만 disabled, Notion 탭은 항상 활성
- **ko/en i18n parity** (ko 먼저, en 런칭 직전 배치 번역, Plan 9a 원칙 그대로)

### Non-Goals (MVP 밖)

- **Drive 폴더 live sync** (변경 감지·삭제 reconcile) → 별도 spec. MVP는 import한 순간의 사본이 truth.
- **Notion API 토큰 방식** (블록 fidelity 고급: toggle/callout/column/synced block 보존) → 커뮤니티 수요 누적 시 follow-up. MVP는 공식 export ZIP만.
- **Notion DB → DataTable 블록 변환** → Plan 10B 완료 후 follow-up spec. MVP는 `.csv`를 source 노트의 첨부로만 저장.
- **Notion DB → 개별 Page + properties** → non-goal. "OpenCairn Database" 기능은 별도 Plan급.
- **Dropbox/OneDrive/Obsidian/Evernote import** → 같은 `/import` 라우트에 탭 추가하는 방식의 후속 spec.
- **ZIP 파싱 전 tree 미리보기 UI** → 구현 복잡도 대비 가치 낮음. 유저는 타겟 선택 후 바로 확정.
- **워크스페이스 레벨 동시 import 제한** → 사용자당 2개만 걸림. 팀 환경 문제는 관측 후 후속.
- **MCP client** → 별도 spec (본 spec 직후, brainstorm 예정).

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│ Next.js  /w/[slug]/import  (탭: Drive / Notion ZIP)          │
└─────────┬─────────────────────────────┬──────────────────────┘
          │ Drive                       │ Notion
          │ 1) Picker 임베드             │ 1) ZIP presigned 업로드
          │ 2) file_ids 선택             │ 2) zip_object_key 확보
          ▼                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Hono API  /api/import/drive · /api/import/notion             │
│  - requireAuth + workspace canWrite                          │
│  - import_jobs row INSERT                                    │
│  - Temporal: start ImportWorkflow                            │
└─────────┬────────────────────────────────────────────────────┘
          ▼
┌──────────────────────────────────────────────────────────────┐
│ Temporal ImportWorkflow (상위 오케스트레이터)                  │
│  [1] resolve_target (새 프로젝트 or 기존)                     │
│  [2] discover_tree (source별 분기)                            │
│      - Drive:  discover_drive_tree                            │
│      - Notion: unzip_notion_export                            │
│  [3] materialize_page_tree (notes 스텁 + parentNoteId 체인)   │
│  [4] fan-out per-node (asyncio.gather, return_exceptions)    │
│      ├─ fast-path: Notion .md  → convert_notion_md_to_plate  │
│      └─ existing-path: binary → child IngestWorkflow (Plan 3) │
│  [5] batch_embed_notion_pages (Plan 3b embed_many)            │
│  [6] finalize_import_job (status, summary, notification)      │
└──────────────────────────────────────────────────────────────┘
```

**하이브리드 분기 원칙** — 콘텐츠 종류에 따라 두 경로:

- **fast-path** (Notion `.md`): 이미 구조화된 마크다운이라 Plate로 직접 변환 → 재파싱 불필요, 임베딩만 batch로 처리
- **existing-path** (모든 바이너리: Drive 파일 전체 + Notion `.md` 내 임베드 이미지/PDF/영상): 기존 Plan 3 `IngestWorkflow`를 child로 spawn → PDF/STT/Image/Enhance 파이프라인 그대로 재사용

이 분기 덕에 Notion md의 원본 퀄리티가 PDF 파서를 타고 떨어지지 않고, 반대로 Drive의 실제 바이너리는 기존 정교한 파이프라인을 그대로 활용한다.

---

## 4. Data Model

### 4.1 신규 테이블

#### `user_integrations`

```sql
CREATE TYPE integration_provider AS ENUM ('google_drive');
-- 미래 확장: 'notion_oauth', 'dropbox', 'onedrive', ...

CREATE TABLE user_integrations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                 integration_provider NOT NULL,
  -- OAuth 토큰 (AES-256-GCM, INTEGRATION_TOKEN_ENCRYPTION_KEY env 키)
  access_token_encrypted   BYTEA NOT NULL,
  refresh_token_encrypted  BYTEA,
  token_expires_at         TIMESTAMPTZ,
  -- provider 메타 (UX용)
  account_email            TEXT,
  scopes                   TEXT[] NOT NULL,
  -- 타임스탬프
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_user_integrations_user ON user_integrations(user_id);
```

**설계 의도**:

- 토큰은 어떤 응답에도 복호화 값 노출 금지. worker activity만 복호화.
- BYOK LLM 키(`user_preferences.byokApiKey`)와 별도 키로 분리 — 대상이 다르고, 키 유출 시 폭발 반경 분리 목적.
- `provider` enum은 확장 시 마이그레이션 한 줄로 추가 가능하게.

#### `import_jobs`

```sql
CREATE TYPE import_source AS ENUM ('google_drive', 'notion_zip');

CREATE TABLE import_jobs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES users(id),
  source                    import_source NOT NULL,
  -- 타겟 (create 시점에 결정; 새 프로젝트 생성이면 resolve_target에서 채움)
  target_project_id         UUID REFERENCES projects(id),
  target_parent_note_id     UUID REFERENCES notes(id),
  -- Temporal 연결
  workflow_id               TEXT NOT NULL UNIQUE,
  status                    job_status NOT NULL DEFAULT 'queued',
  -- 진행 상황
  total_items               INT NOT NULL DEFAULT 0,
  completed_items           INT NOT NULL DEFAULT 0,
  failed_items              INT NOT NULL DEFAULT 0,
  -- 원본/결과
  source_metadata           JSONB NOT NULL,  -- Drive: { file_ids[], picker_token }; Notion: { zip_object_key, original_name }
  error_summary             TEXT,            -- 최대 100개 실패 요약 + "and N more"
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at               TIMESTAMPTZ
);

CREATE INDEX idx_import_jobs_workspace ON import_jobs(workspace_id, created_at DESC);
CREATE INDEX idx_import_jobs_user      ON import_jobs(user_id, created_at DESC);
```

**왜 기존 `jobs` 테이블과 분리했는가**:

- `jobs`는 **단일 파일** ingest의 생명주기 (1 file = 1 job). `import_jobs`는 **bulk operation** (1 import = N files + 계층 조립 + OAuth).
- `import_jobs` 1건은 내부적으로 여러 child `jobs`를 spawn (existing-path). 부모-자식 관계 명확화.
- job_status enum은 재사용 (queued / running / completed / failed). 부분 성공은 `status=completed` + `failed_items > 0` 패턴.

### 4.2 enum 확장

```ts
// packages/db/src/schema/enums.ts
export const sourceTypeEnum = pgEnum("source_type", [
  "manual",
  "pdf",
  "audio",
  "video",
  "image",
  "youtube",
  "web",
  "notion",   // 신규 — Notion export에서 복원된 텍스트 페이지 (.md → Plate)
  "unknown",
]);
```

- `notion`은 `web`과 의미적으로 유사 — **외부에서 임포트된 텍스트 페이지**를 구분하는 값. `manual`(사용자 직접 작성) / `web`(스크레이퍼 추출 HTML)과 별도.
- Notion `.md` → Plate로 들어간 노트: `source_type='notion'`, `source_file_key=null` (원본 MD는 파싱되어 녹아들어감)
- Notion 내 첨부 이미지/PDF: 기존 Plan 3 경로를 타므로 원래 content-type(`image` / `pdf` 등)이되 `source_metadata.import_job_id`로 연결 추적
- Drive 바이너리: 기존 `pdf` / `audio` / `image` / `video` enum 그대로 사용. Drive 프로비넌스는 `source_metadata = { drive_file_id, import_job_id, drive_path }`로만 기록. **`drive` enum 값은 도입하지 않음** (YAGNI — Google Docs Native 변환 등 실제 수요 생기면 그때 추가).

---

## 5. API Surface

모든 엔드포인트 `requireAuth` + workspace `canWrite` 체크. Zod로 입·출력 검증.

### 5.1 OAuth (integrations)

| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/integrations/google/connect?workspaceId=...` | OAuth redirect URL 발행 (state에 `workspaceId`, `userId`, nonce) |
| `GET` | `/api/integrations/google/callback?code=...&state=...` | 토큰 교환 → `user_integrations` UPSERT → `/w/[slug]/import?connected=true` redirect |
| `GET` | `/api/integrations/google` | 연결 상태 `{ connected: bool, accountEmail?, scopes? }` — 토큰 값 절대 포함 금지 |
| `DELETE` | `/api/integrations/google` | Google revoke endpoint 호출 + row 삭제 |

**OAuth scope**: `https://www.googleapis.com/auth/drive.file` (non-sensitive). 이게 이 spec 보안 설계의 핵심 — CASA 연간 감사 면제.

**state 파라미터**: `base64url(JSON{ workspaceId, userId, nonce })` + HMAC. callback에서 HMAC 검증 + nonce 원타임 사용 (redis 또는 `oauth_state` 임시 테이블).

### 5.2 Import 시작

| Method | Path | Body | 설명 |
|---|---|---|---|
| `POST` | `/api/import/drive` | `{ workspaceId, fileIds[], target: { kind: 'new' \| 'existing', projectId?, parentNoteId? } }` | `import_jobs` INSERT + `ImportWorkflow` start, `jobId` 반환 |
| `POST` | `/api/import/notion` | `{ workspaceId, zipObjectKey, originalName, target: {...} }` | 동일 |

**Notion ZIP 업로드는 2-step**:
1. `POST /api/import/notion/upload-url { workspaceId, size }` → presigned URL 반환 (MinIO 또는 동등). 크기 한도 체크 (`IMPORT_NOTION_ZIP_MAX_BYTES`, 기본 5GB).
2. 클라이언트가 presigned URL로 직접 PUT → 완료 후 `zipObjectKey` 확보 → `POST /api/import/notion`으로 import 시작.

### 5.3 Import 조회/제어

| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/import/jobs?workspaceId=...` | 리스트 (최신순, 페이지네이션) |
| `GET` | `/api/import/jobs/:id` | 단건 상세 (source_metadata의 내부 값 일부 redact) |
| `GET` | `/api/import/jobs/:id/events` | **SSE** 스트림 — row 변경 + 관련 child `jobs` 상태를 이벤트로 발행 |
| `POST` | `/api/import/jobs/:id/retry` | `{ itemPaths[] }` 실패 항목만 재시도 — `ImportWorkflow`에 signal |
| `DELETE` | `/api/import/jobs/:id` | 진행 중이면 workflow cancel + row archive (soft delete) |

---

## 6. ImportWorkflow 상세

### 6.1 코드 위치

```
apps/worker/src/worker/workflows/
  import_workflow.py           # 상위 오케스트레이터

apps/worker/src/worker/activities/
  drive_activities.py
    - discover_drive_tree(user_id, file_ids, folder_ids) -> TreeManifest
    - upload_drive_file_to_minio(user_id, drive_file_id, import_job_id) -> object_key
  notion_activities.py
    - unzip_notion_export(zip_object_key, staging_prefix) -> TreeManifest
    - convert_notion_md_to_plate(staging_path, note_id, uuid_link_map) -> None
  import_activities.py         # source-agnostic
    - resolve_target(job_id) -> { project_id, parent_note_id }
    - materialize_page_tree(job_id, manifest) -> idx_to_note_id
    - finalize_import_job(job_id, results) -> None

packages/db/src/schema/
  user_integrations.ts
  import_jobs.ts
```

### 6.2 TreeManifest (공통 포맷)

두 discover activity가 반환하는 공통 스키마:

```python
class TreeNode(BaseModel):
    idx: int                        # 0-based, manifest 내 고유
    parent_idx: int | None          # 루트는 None
    kind: Literal["page", "binary"] # page = Notion .md, binary = 모든 바이너리
    path: str                       # 원본 계층 내 경로 (Notion: "Projects/Q4/Spec.md", Drive: "papers/2024/paper.pdf")
    display_name: str               # UI 표시용 (Notion UUID 제거 후)
    meta: dict                      # kind별: page는 { uuid?, frontmatter }, binary는 { mime, size, drive_file_id? }

class TreeManifest(BaseModel):
    job_id: UUID
    root_display_name: str          # "Notion export 2026-04-22" 또는 "Drive import"
    nodes: list[TreeNode]
    uuid_link_map: dict[str, int]   # Notion only: "abc123..." -> idx (내부 링크 rewrite용)
```

### 6.3 Step별 동작

**[1] `resolve_target`**

- `target.kind == 'new'`: 새 프로젝트 생성, 이름은 `"{source} import {YYYY-MM-DD}"` (중복 시 suffix). `projects` 테이블 INSERT. 새 프로젝트의 기본 루트 페이지 아래를 `parent_note_id`로 설정.
- `target.kind == 'existing'`: `projectId` + `parentNoteId` 그대로 사용. `canWrite` 재확인.
- `import_jobs.target_project_id` / `target_parent_note_id` UPDATE.

**[2] `discover_tree`**

Drive 경로:
- `user_integrations`에서 토큰 복호화 → googleapiclient Drive v3
- 선택된 `fileIds` + `folderIds` 각각 처리:
  - 파일: 단일 `TreeNode(kind='binary')`
  - 폴더: 재귀 `files.list(q="'{id}' in parents")` → 하위 파일/폴더 tree 구성
- MIME type으로 `kind` 결정 (우리가 처리 가능한 MIME만, Plan 3 allowlist 재사용)
- Google Workspace native 문서(Docs/Sheets/Slides)는 MVP에서 **export API로 PDF 변환** → binary로 처리 (별도 spec으로 native 파싱 확장 여지)

Notion 경로:
- `unzip_notion_export(zip_object_key)`:
  - MinIO에서 ZIP 스트림 다운로드 → staging 볼륨에 풀기
  - 해제 전 `uncompressed_size > IMPORT_NOTION_ZIP_MAX_UNCOMPRESSED_BYTES` (기본 20GB) → abort
  - 경로 traversal 검사 (`..` 또는 절대경로 → abort)
  - 파일 개수 > 10,000 → abort
- 풀린 트리 순회:
  - 폴더 `Foo abc123/` + 파일 `Foo abc123.md` 패턴 감지 → 동일 페이지로 머지
  - UUID 추출(`abc123`)해서 `display_name="Foo"` + `meta.uuid="abc123..."` 저장
  - `.csv` 파일 → `kind='binary'`, mime=`text/csv` (DataTable 변환은 follow-up)
  - 첨부파일(이미지/PDF/기타): `kind='binary'`

**[3] `materialize_page_tree`**

이 단계는 **page 노드만** 노트로 실체화한다. binary는 단계 [4]에서 child `IngestWorkflow`가 `create_source_note`로 자기 노트를 만들기 때문에, 여기서 미리 만들면 이중 생성이 된다.

- manifest.nodes 순회:
  - `kind='page'`: `notes` 테이블 INSERT
    - `type='note'`, `source_type='notion'`, `content=null` (단계 [4]에서 채움)
    - `parent_note_id`:
      - `parent_idx is None` → `target_parent_note_id` (루트는 타겟 아래 직접 매달림)
      - `parent_idx`가 page 노드 → `idx_to_note_id[parent_idx]`
      - `parent_idx`가 binary 노드 → **불가능** (binary는 항상 leaf. binary 하위에 페이지가 올 수 없음을 discover_tree 단계에서 invariant로 보장)
  - `kind='binary'`: **여기서는 아무 것도 안 함**. 대신 이 노드의 **effective parent note_id**를 기록해 단계 [4]에 전달.
- 멱등성: `(job_id, path)` UNIQUE 제약 → `ON CONFLICT DO NOTHING`
- 반환: `idx_to_note_id: dict[int, UUID]` (page 노드 idx만 키로 존재) + `binary_effective_parent: dict[int, UUID]` (binary idx → 가장 가까운 상위 page의 note_id)
- `import_jobs.total_items = len(manifest.nodes)` UPDATE.

**[4] fan-out**

```python
# import_workflow.py (의사코드)
tasks = []
for node in manifest.nodes:
    if node.kind == 'page':
        tasks.append(workflow.execute_activity(
            'convert_notion_md_to_plate',
            { 'staging_path': node.path, 'note_id': idx_to_note_id[node.idx],
              'uuid_link_map': manifest.uuid_link_map,
              'idx_to_note_id': idx_to_note_id },
            schedule_to_close_timeout=timedelta(minutes=2),
            retry_policy=_RETRY,
        ))
    else:  # binary — 상위 page 노트의 자식으로 편입
        tasks.append(spawn_child_ingest(
            node,
            parent_note_id=binary_effective_parent[node.idx],
        ))

results = await asyncio.gather(*tasks, return_exceptions=True)
```

- `spawn_child_ingest`:
  - Drive: `upload_drive_file_to_minio` → `object_key` → `workflow.start_child_workflow('IngestWorkflow', IngestInput(object_key=..., mime_type=..., parent_note_id=..., user_id=..., project_id=...))`
  - Notion binary: staging 경로의 파일을 MinIO에 업로드 → 동일 패턴
- `asyncio.gather(..., return_exceptions=True)` — 한 아이템 실패가 전체 abort 않도록
- 실패 항목은 `failed_items++` + error_summary append (path + exception 요약, 최대 100건)

**[5] `batch_embed_notion_pages`**

- fast-path에서 생성된 노트 ID들만 대상
- 기존 Plan 3b `embed_many()` 경로 호출 — `BATCH_EMBED_COMPILER_ENABLED` 플래그에 따라 batch 또는 단건 fallback
- existing-path 자식들은 각자의 `generate_embeddings` activity가 이미 처리했으므로 skip

**[6] `finalize_import_job`**

- `import_jobs.status` 결정:
  - `completed` — failed_items == 0
  - `completed` with `failed_items > 0` — 부분 성공 (UI에서 badge 표시)
  - `failed` — 프리플라이트 실패 또는 전 항목 실패 (total_items > 0 && completed_items == 0)
- `finished_at = now()`
- in-app notification: 사용자에게 완료 알림 + `/w/[slug]/import/jobs/[id]` 링크

### 6.4 Notion MD → Plate 변환 (`convert_notion_md_to_plate`)

라이브러리: `markdown-it-py` (Python) 또는 `remark` JS (worker에서 subprocess). 선택은 구현 시점의 pragmatism — Plate JSON이 JS 포맷이라 `remark-plate` 같은 경로가 있으면 JS 사이드가 자연스러울 수 있음. **결정은 plan 단계에서**.

지원 변환:

| Markdown | Plate 블록 |
|---|---|
| `# H1` / `## H2` / `### H3` | `h1` / `h2` / `h3` |
| `**bold**` / `*italic*` / `` `code` `` | 인라인 마크 `bold` / `italic` / `code` |
| ````lang ... ```` | `code_block` with `lang` |
| `- item` / `1. item` | `ul` / `ol` + `li` |
| `> quote` | `blockquote` |
| `---` | `hr` |
| `![alt](relative/path/img.png)` | binary 경로 resolve → MinIO upload (existing-path 재귀) → Plate `image` 블록 with `src=minio-url` |
| `[text](../Other%20Page%20uuid.md)` | `uuid_link_map`에서 target note_id 찾음 → Plate wiki-link 블록 `{ type: 'wikilink', noteId, label: text }`. 맵에 없으면(외부 링크) 일반 `a` 유지 |
| `[text](../Some%20DB.csv)` (DB 링크) | DB는 note가 아님 → **일반 `a` 링크로 렌더** + 대상이 `.csv` 첨부임을 표시하는 작은 아이콘. 정확한 hover UX는 Open Question #4. |
| Notion 특수 블록 (toggle/callout/column/synced) | Notion MD export가 이미 flatten해서 내려줌 → 일반 문단/heading으로 수용 (우리 책임 아님) |

Plate 함정 주의: **`llm-antipatterns.md` §8** 반드시 참조. 특히 빈 노드 허용 규칙, leaf 텍스트 래핑 규약, `children[]` 최소 1개 원칙.

### 6.5 에러 회복

**Activity 멱등성** (Temporal 재시도 안전):
- `materialize_page_tree`: `(job_id, path)` UNIQUE → `ON CONFLICT DO NOTHING`
- `upload_*_to_minio`: `object_key = "{import_job_id}/{path_hash}"` 고정 → 재시도 overwrite 안전
- `convert_notion_md_to_plate`: note content 덮어쓰기 (부수효과 없음, 재실행 idempotent)

**아이템 단위 실패**:
- `asyncio.gather(..., return_exceptions=True)`로 독립 실행
- 실패 항목: `failed_items++`, `error_summary`에 `{path}: {reason}` append (최대 100건, 초과 시 "and N more")
- 사용자는 UI에서 **[재시도]** 버튼으로 `POST /api/import/jobs/:id/retry { itemPaths[] }` 호출 → signal로 실패분만 재실행

**OAuth 토큰 만료**:
- Drive API 호출 시 `401` 감지 → activity 내에서 refresh token으로 1회 재시도 → UPSERT 새 access_token
- 두 번째도 실패 → job → `failed` + in-app banner "Google 재인증이 필요합니다"

**프리플라이트 실패 (즉시 job failed)**:
- ZIP 손상 / 해시 검증 실패
- 워크스페이스 용량 한도 초과 (기존 `storage-planning.md` 카운터, pre-check)
- OAuth 토큰 없음 또는 revoke된 상태
- scope 부족 (사용자가 Picker에서 파일 선택 안 함)

**child IngestWorkflow 실패**:
- 기존 Plan 3 quarantine 메커니즘 그대로 작동 (`quarantine_source` + `report_ingest_failure`)
- 부모 ImportWorkflow 관점에서는 해당 아이템이 `failed_items`로 카운트됨

---

## 7. UI Surface

### 7.1 `/w/[slug]/import` (메인 페이지)

```
┌──────────────────────────────────────────────────────┐
│ [← 워크스페이스로]  가져오기                           │
│                                                      │
│  ┌────────────┐  ┌──────────────┐                    │
│  │ ▶ Drive    │  │   Notion ZIP │   (탭 전환)         │
│  └────────────┘  └──────────────┘                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  [ Drive 탭 내용 ]                                    │
│                                                      │
│  📎 Google Drive 연결됨: foo@gmail.com  [계정 바꾸기] │
│                                                      │
│  ┌──────────────────────────────────┐                │
│  │ [파일 선택하기]                   │                │
│  │ (Google Picker 모달 임베드)       │                │
│  └──────────────────────────────────┘                │
│                                                      │
│  선택된 파일: 23개 · 456 MB                           │
│  • paper.pdf                                         │
│  • meeting-notes.docx                                │
│  • 📁 research/ (14 files)                           │
│                                                      │
│  가져올 위치:                                         │
│  ( ) 새 프로젝트로 만들기                             │
│  (•) 기존 프로젝트에 추가:  [Project X ▼]            │
│       상위 페이지:  [Root ▼]                          │
│                                                      │
│             [ 가져오기 시작 ]                          │
└──────────────────────────────────────────────────────┘
```

**Drive 탭 상태 머신**:
1. 미연결 → "Google Drive 연결하기" CTA → OAuth 팝업 → callback 후 상태 재조회
2. 연결됨 + 선택 없음 → "파일 선택하기" 버튼
3. 연결됨 + 선택 있음 → 타겟 라디오 + "가져오기 시작" 활성화

**Notion 탭 상태 머신**:
1. 초기 → 안내 문구 ("Notion → Settings → Export → Markdown & CSV") + 드롭존
2. 업로드 중 → progress bar + 취소 버튼
3. 업로드 완료 → 파일명 + 크기 표시 + 타겟 라디오 + "가져오기 시작"

### 7.2 `/w/[slug]/import/jobs/[id]` (진행/결과 페이지)

```
┌──────────────────────────────────────────────────────┐
│ 가져오기 · Notion ZIP                                 │
│ 2026-04-22 14:23 시작 · 진행 중                        │
├──────────────────────────────────────────────────────┤
│ [=============------] 156 / 234  (67%)               │
│ 완료 142 · 실패 2 · 대기 90                            │
│ 예상 남은 시간: ~3분                                   │
├──────────────────────────────────────────────────────┤
│ 실패한 항목 (2)                                        │
│ • corrupted-image.png — MIME 거부                    │
│   [ 재시도 ]                                          │
│ • huge-file.zip — 용량 한도 초과                       │
│   [ 재시도 ]                                          │
├──────────────────────────────────────────────────────┤
│ 완료 시: [ 결과 열기 ] [ 알림 보기 ]                    │
└──────────────────────────────────────────────────────┘
```

- SSE `EventSource('/api/import/jobs/:id/events')` 구독
- 이벤트 종류: `job.updated`, `item.started`, `item.completed`, `item.failed`, `job.finished`
- 완료 시 "결과 열기" → `/w/[slug]/p/[targetProjectId]` 로 이동

### 7.3 라우트 gate

- `FEATURE_IMPORT_ENABLED=false` → `/w/[slug]/import` → 404
- Drive 탭: `GOOGLE_OAUTH_CLIENT_ID` 없으면 **탭 자체 disabled** + "관리자가 Google OAuth credentials를 설정해야 사용 가능합니다" 툴팁
- Notion 탭: 항상 활성 (외부 자격증명 불필요)

### 7.4 i18n

모든 문자열은 `messages/{ko,en}/import.json` 신규 네임스페이스. 예상 ~50 키. ESLint `no-literal-string` + `pnpm --filter @opencairn/web i18n:parity` CI로 강제 (Plan 9a 규약 그대로).

카피 원칙(`feedback_opencairn_copy.md`):
- 존댓말 유지
- 경쟁사(Notion) 언급은 "Notion ZIP" 같은 **기능 명세**로만, "Notion보다 나은" 같은 비교 금지
- 기술 스택 상세(AES-256-GCM 등) UI 노출 금지

---

## 8. 보안

### 8.1 OAuth scope 최소화 (설계 핵심)

- **`drive.file` scope만 사용** — 사용자가 Google Picker에서 명시적으로 고른 파일에만 접근 권한 부여
- **`drive.readonly` (RESTRICTED scope) 사용 안 함** → Google CASA 연간 보안 감사(수천 달러 / 대용량 벤더는 수만 달러) 면제
- Picker API는 client-side JS로 발급된 per-request OAuth token을 사용하므로 서버는 **선택된 file_id만** 받음. 목록 스캔 불가.

### 8.2 토큰 저장

- `user_integrations.access_token_encrypted` / `refresh_token_encrypted`
- **AES-256-GCM**, key는 `INTEGRATION_TOKEN_ENCRYPTION_KEY` env (BYOK 키 저장과 동일 패턴이나 별도 키)
- 암호화/복호화는 `packages/shared/src/crypto/integration-tokens.ts` (TS 측 encrypt-on-write) + `apps/worker/src/lib/integration_crypto.py` (Python 측 decrypt-on-use)
- **어떤 로그 · API 응답 · trajectory · 에러 메시지에도 원본 토큰 노출 금지**
- 연결 해제 시 Google revoke endpoint 호출(`https://oauth2.googleapis.com/revoke`) + DB row 삭제

### 8.3 ZIP 처리 방어

- **Zip bomb 방지**:
  - 압축 파일 크기 한도: `IMPORT_NOTION_ZIP_MAX_BYTES` (기본 5GB)
  - 압축 해제 후 합계 한도: `IMPORT_NOTION_ZIP_MAX_UNCOMPRESSED_BYTES` (기본 20GB)
  - 파일 개수 한도: `IMPORT_NOTION_ZIP_MAX_FILES` (기본 10,000)
  - 한도 초과 시 해제 중간에도 abort
- **Zip slip 방지**: 각 entry의 `entry.filename`이 `os.path.normpath` 후 staging 디렉토리를 벗어나면 abort
- **MIME allowlist**: 풀린 파일의 실제 MIME(magic bytes로 확인)이 Plan 3 allowlist 내에 있어야 함
- **Staging 격리**: ZIP 해제는 별도 볼륨(`/var/opencairn/import-staging/{job_id}/`)에서 수행, 성공적으로 처리된 바이너리만 MinIO로 복사. staging 디렉토리는 job 완료 후 삭제.

### 8.4 권한 체크

- 모든 import 엔드포인트: `requireAuth` + `canWrite(workspace_id, user_id)`
- `target.projectId` 지정 시: 해당 프로젝트가 `workspaceId` 소속인지 + 사용자가 `canWrite`인지 재확인
- `target.parentNoteId` 지정 시: 해당 note가 `projectId` 소속인지 재확인
- Import된 새 노트의 페이지 권한: 타겟 프로젝트의 권한 기본값 상속 (`collaboration-model.md` 상속 규칙 그대로)

### 8.5 Rate limiting / 자원 제한

- 사용자당 **동시 진행 import job 최대 2개** (API pre-check, `import_jobs` where status in ('queued','running') count)
- Drive API quota (분당 100 / 사용자당 하루 10억 쿼리) 내 운용 — `discover_drive_tree`·`upload_drive_file_to_minio` 모두 exponential backoff + 429 감지
- MinIO 업로드 동시성: Temporal activity concurrency 제한 (`max_concurrent_activities` 기본값)

### 8.6 Self-host 안전 기본값

- `GOOGLE_OAUTH_CLIENT_ID` 또는 `GOOGLE_OAUTH_CLIENT_SECRET` 없음 → Drive 기능 자동 disable, UI 툴팁
- `INTEGRATION_TOKEN_ENCRYPTION_KEY` 없음 → API `/api/integrations/google/*` 전체 503 + 로그 경고
- 설정 부재로 인한 crash는 없음 (feature graceful degradation)

---

## 9. 테스트 전략

### 9.1 Unit (pytest, `apps/worker/tests/`)

- `test_notion_md_converter.py`:
  - heading / list / code / image / internal UUID link / 외부 링크 / 혼합 문서
  - Plate JSON 유효성 (`children[]` non-empty invariant 등 Plate v49 규약)
- `test_unzip_notion_export.py`:
  - 정상 fixture (5 페이지 + 1 CSV + 2 이미지 + 3-level 중첩)
  - `Page abc123/` 폴더 + `Page abc123.md` 파일 머지
  - UUID 추출 정확도
- `test_zip_defenses.py`:
  - zip bomb 샘플 (1MB → 10GB 해제) → reject
  - zip slip 샘플 (`../../etc/passwd`) → reject
  - 파일 개수 초과 → reject
- `test_drive_discovery.py`:
  - `googleapiclient.http.HttpMockSequence`로 재귀 폴더 목록 mock
  - native Google Docs → PDF export 경로
- `test_token_crypto.py`:
  - encrypt → decrypt roundtrip
  - 잘못된 키로 decrypt → raise (silent fail 금지)
- `test_import_workflow_errors.py`:
  - 일부 활동 실패 시 job 계속 진행
  - failed_items / error_summary 집계

### 9.2 Integration (Temporal test env)

- in-memory Postgres + MinIO testcontainer
- `ImportWorkflow` 전체 flow: Notion 픽스처 / Drive mock → 완료 → DB assertion
  - notes 트리 구조 정확 (`parentNoteId` 체인)
  - `source_type` enum 값 정확
  - content 존재 확인 (fast-path) / `source_file_key` 존재 확인 (existing-path)
  - `import_jobs.status` / `completed_items` / `failed_items` 정확
- child `IngestWorkflow` spawn 경로: 기존 Plan 3 integration test 구조 재사용

### 9.3 E2E (Playwright, `apps/web/playwright/`)

- **Notion 경로** (자동화 가능):
  - 사전 fixture ZIP 업로드 → presigned 경로 mock → `POST /api/import/notion` → 진행 페이지 표시 → 완료 대기 → 프로젝트 열기 → 첫 페이지 content 검증
- **Drive 경로** (제한적):
  - Picker 팝업은 Google 소유라 E2E 자동화 어려움 → API 레벨에서 "Picker 결과가 이렇게 왔다고 가정" fixture POST → 이후 흐름만 검증
  - 실제 Google 계정 기반 스모크는 **수동 체크리스트** (`docs/testing/integration-import.md` 신규)

### 9.4 i18n parity

- `pnpm --filter @opencairn/web i18n:parity` — 신규 `messages/{ko,en}/import.json` 키 일치 (CI block)
- ko 먼저, en은 런칭 직전 배치 번역 (Plan 9a 원칙)

---

## 10. Rollout

### 10.1 Feature flag

- `FEATURE_IMPORT_ENABLED` (env, 기본 `false`)
  - `false` → `/w/[slug]/import` 및 `/api/import/*` · `/api/integrations/*` 전체 404 / 403
  - `true` → 노출
- Drive 하위 feature: `GOOGLE_OAUTH_CLIENT_ID` 존재 여부로 암묵적 gate (별도 flag 없음)
- Notion 탭: `FEATURE_IMPORT_ENABLED` 만 체크

### 10.2 단계

1. **Spec + Plan 머지** (본 spec + 후속 plan 문서)
2. **구현** (feat 브랜치, flag off)
3. **Dev/Staging**: flag on, 본인 Notion workspace export + 본인 Drive 계정으로 스모크
4. **Beta**: opencairn.com 소수 유저에게 flag on, 실제 import 관찰, 피드백 수집
5. **GA**:
   - flag on by default
   - 랜딩 페이지 feature 섹션 추가 ("Notion에서 이주하기" CTA)
   - changelog 게시
   - Plan 9a 랜딩의 10 섹션 중 "Import" 섹션 검토

### 10.3 의존성 정리

- ✅ Plan 1 (Better Auth, workspace 권한 헬퍼)
- ✅ Plan 3 (`IngestWorkflow`, MinIO, sourceTypeEnum, 8 activities)
- ✅ Plan 13 (`packages/llm` provider)
- ✅ Plan 9a (i18n parity CI)
- ✅ Plan 2A (Plate v49 에디터 + `notes` 테이블)
- 🟡 Plan 3b (batch embedding — 사용하지만 미결 4개 이슈 존재. fast-path는 flag OFF 상태에서 단건 fallback으로 동작, flag ON 시 자동 승격)
- 본 spec은 **Plan 2B/2C/2D/2E 및 Plan 5-8과 병렬 가능**. blocker 없음.

---

## 11. Open Questions

다음은 spec 작성 시점 미결이며, 구현 plan 또는 prod 설정에서 확정한다.

1. **Notion ZIP 용량 한도**: 초기값 `IMPORT_NOTION_ZIP_MAX_BYTES=5GB`, 해제 후 `IMPORT_NOTION_ZIP_MAX_UNCOMPRESSED_BYTES=20GB`. 실제 유저 데이터 관찰 후 조정. env override 가능.
2. **Drive 파일 개수 상한 (per job)**: 초기값 10,000. 실제 import 관찰 후 조정.
3. **동시 import 제한**: 사용자당 2개로 고정. **워크스페이스 레벨 제한 없음** — 팀 환경에서 한 명이 독점 가능성, 관측 후 후속 결정.
4. **Notion DB-to-DB 링크 렌더**: `.csv`는 note가 아니므로 `[Some DB](../Some DB.csv)` 링크는 **외부 링크로 남기고 hover 시 "이 데이터베이스는 첨부 파일로 가져와졌습니다" 툴팁** 제안. 구현 plan에서 확정.
5. **`import_jobs` 보관 기간**: 성공 job은 30일 후 자동 archive / 실패는 90일 / 아니면 영구? 관측 후 결정. MVP는 영구 보관 + 수동 삭제 API만.
6. **Picker vs Drive API 브라우징 재검토**: Picker는 다중 선택 쾌적하지만 "폴더 전체 드래그" 같은 일부 UX 제약. 수요가 쌓이면 `drive.readonly` RESTRICTED scope + CASA 감사 비용 감수 여부를 follow-up spec에서 재논의.
7. **MD → Plate 변환 런타임 언어**: `markdown-it-py` (Python, worker 내재) vs `remark` subprocess (JS, Plate 포맷과 네이티브 정합). 구현 plan 단계에서 PoC 후 결정.
8. **Google Workspace native 문서 처리**: MVP는 PDF export. 향후 Docs API 직접 호출로 Plate 변환까지 가면 퀄리티 상승 가능 — 별도 spec.
9. **관리형 → Cloudflare R2 마이그레이션 시** (`data-flow.md` 주석): `object_key` 네이밍 규약 호환 유지. 본 spec은 MinIO 전제이나 R2 전환 시 코드 변경 최소화 목표.

---

## 12. 요약표

| 축 | 결정 |
|---|---|
| Sync 모델 | **One-shot** (live sync는 후속 spec) |
| OAuth | `drive.file` scope + **Google Picker** + env-based credentials + per-user 토큰 (AES-256-GCM) |
| Notion DB | **CSV 첨부로만** — DataTable 블록 변환은 Plan 10B 후, properties는 별도 Plan |
| 계층 | **사용자 선택**: 새 프로젝트 vs 기존, 트리 그대로 보존 (parentNoteId 체인) |
| UI | `/w/[slug]/import` 탭 [Drive / Notion ZIP], 진행 페이지 SSE |
| 아키텍처 | **Hybrid**: fast-path(MD→Plate 직변환) + existing-path(child IngestWorkflow) |
| 데이터 모델 | `user_integrations` + `import_jobs` 신설, `sourceTypeEnum` 확장 (`drive`, `notion`) |
| 과금 | **새 gate 없음** — 기존 ingest 경로의 BYOK/PAYG/Pro 로직 그대로 |
| 보안 | Non-sensitive scope + AES-256-GCM + zip bomb/slip 방어 + staging 격리 |
| 테스트 | pytest unit + Temporal integration + Playwright E2E + i18n parity CI |
| Flag | `FEATURE_IMPORT_ENABLED` + Drive는 OAuth env 암묵적 gate |
| 병렬성 | **blocker 없음** — Plan 2B/2C/2D/2E 및 Plan 5-8과 완전 병렬 가능 |
