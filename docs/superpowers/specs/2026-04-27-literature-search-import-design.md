# Literature Search & Auto-Import Design

**Date:** 2026-04-27  
**Status:** Draft  
**Scope:** E — 공개 API 어그리게이터 + 선택적 자동 import → 기존 ingest pipeline 연결  
**Out of scope:** PubMed, 인용 탐색 UI, 페이월 PDF 우회, enrichment (Plan B), 합성 export (Plan F)

---

## 1. 제품 컨텍스트

OpenCairn input-output 축의 **E 서브시스템**: 사용자가 검색어를 입력하면 공개 학술 API를 병렬 쿼리하고, 선택한 논문을 합법 OA PDF 또는 메타데이터-only note로 워크스페이스에 가져온다.

인덱싱 사업은 하지 않는다. 공개 API를 통해 "찾은 다음에 정리되는 것"을 잘 하는 것이 포지션이다.

---

## 2. 허용 소스 및 역할

| 소스 | 역할 | 인증 |
|---|---|---|
| **arXiv API** (공식) | 풀텍스트 PDF + AI/CS/물리/수학 | 익명 OK |
| **Semantic Scholar API** | 메타데이터 + 인용 수 + ~2.5억 논문 | 익명 OK (API key 권장) |
| **Crossref API** | DOI 메타 보완, 제목 검색 fallback | polite pool — `mailto=` 헤더 |
| **Unpaywall API** | DOI → 합법 OA PDF URL 발견 | `email=` 쿼리파라미터 |

**금지 소스:** Google Scholar (ToS 위반), DBpia, Scopus, Web of Science, 페이월 SCI 직접 다운로드.

페이월로 OA PDF가 없는 경우 → **메타데이터-only note** 생성 + "기관 구독으로 PDF를 직접 업로드하세요" 안내.

---

## 3. UX 플로우

### 3.1 채팅-first 진입

모든 진입점은 AI 채팅 패널이다. 별도 `/library` 라우트나 사이드바 메뉴 없음.

```
사용자: "attention mechanism 논문 10개 찾아줘"
  │
  └─▶ 에이전트: literature_search tool 호출
        │
        └─▶ GET /api/literature/search?q=attention+mechanism&limit=10
              │
              └─▶ arXiv + SS 병렬 쿼리 → DOI dedupe → 결과 반환
              │
        └─▶ 채팅 메시지 렌더링:
              ┌──────────────────────────────────────────┐
              │  📄 Attention Is All You Need (2017)      │
              │     Vaswani et al. · 인용 1.2만 · OA ✓   │
              │  📄 BERT: Pre-training of... (2018)       │
              │     Devlin et al. · 인용 8.7만 · OA ✓    │
              │  … (최대 10개)                            │
              │  ─────────────────────────────────────── │
              │  [에디터에서 전체 결과 보기 →]            │
              └──────────────────────────────────────────┘
```

### 3.2 에디터 탭 — 전체 결과 뷰

"에디터에서 전체 결과 보기" 클릭 시 TabModeRouter가 `viewer: "lit-search-results"` 탭을 연다.

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔍 [attention mechanism            ] [재검색]                   │
│    ☑ arXiv  ☑ Semantic Scholar  ☐ Crossref only                │
│─────────────────────────────────────────────────────────────────│
│  ☐  Attention Is All You Need          Vaswani et al.  2017  OA │
│  ☐  BERT: Pre-training of...          Devlin et al.   2018  OA │
│  ☐  GPT-3: Language Models...         Brown et al.    2020  🔒 │
│  …                                                              │
│─────────────────────────────────────────────────────────────────│
│ 하단 고정:  2개 선택됨  →  [프로젝트: ▾ ML Research]  [가져오기] │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 프로젝트 destination 규칙

1. 채팅이 현재 열린 프로젝트 컨텍스트를 갖고 있으면 → 해당 프로젝트를 default
2. 컨텍스트 없으면 → "프로젝트 선택" picker 표시
3. 에디터 탭에서도 드롭다운으로 변경 가능

### 3.4 import 완료 후

- 기존 `finalize_import_job` → `system` 알림 발송 (notification drawer)
- DOI dedupe로 건너뛴 논문이 있으면 알림에 포함: "3개 가져옴, 2개 이미 존재하여 건너뜀"

---

## 4. 데이터 모델

### 4.1 DB 변경 (migration 필요)

```sql
-- importSourceEnum에 값 추가
ALTER TYPE import_source ADD VALUE 'literature_search';

-- sourceTypeEnum에 값 추가
ALTER TYPE source_type ADD VALUE 'paper';
```

### 4.2 import_jobs.sourceMetadata 구조

`source = 'literature_search'`일 때 `source_metadata` jsonb 스키마:

```ts
interface LitSearchSourceMetadata {
  query: string;              // 원본 검색어
  sources: string[];          // ["arxiv", "semantic_scholar", "crossref"]
  selectedDois: string[];     // 사용자가 선택한 DOI (또는 "arxiv:<id>")
  totalResults: number;       // 검색 총 결과 수
}
```

### 4.3 note 메타데이터 저장

paper-meta Plate 블록을 note content에 삽입. DB 컬럼 추가 없음.

```ts
// Plate block type: "paper_meta"
{
  type: "paper_meta",
  doi: string | null,
  arxivId: string | null,
  title: string,
  authors: string[],
  year: number | null,
  abstract: string | null,
  citationCount: number | null,
  openAccessUrl: string | null,
  isPaywalled: boolean,
  importedAt: string,          // ISO 8601
}
```

OA PDF가 있는 논문: `source_type = "pdf"` (기존 IngestWorkflow 결과물)  
메타데이터-only 논문: `source_type = "paper"`, content에 paper_meta 블록만 존재

### 4.4 DOI 색인

기존 `notes` 테이블에 DOI를 저장하기 위한 전략:

- `notes.content` (jsonb)의 `paper_meta` 블록에서 DOI를 읽어 `/api/internal/notes?workspaceId=&doi=` 로 dedupe
- 또는 `notes` 테이블에 `doi text UNIQUE` 컬럼 추가 (워크스페이스-스코프가 아니라 전역 unique → 부적합)
- **채택**: `notes`에 `doi text` 컬럼 추가 + `(workspace_id, doi)` unique partial index (doi IS NOT NULL)

```sql
ALTER TABLE notes ADD COLUMN doi text;
CREATE UNIQUE INDEX notes_workspace_doi_idx
  ON notes (workspace_id, doi)
  WHERE doi IS NOT NULL;
```

---

## 5. API 레이어

### 5.1 라우트: `GET /api/literature/search`

**인증:** `requireAuth` (기존 미들웨어)

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `q` | string | (필수) | 검색어 |
| `sources` | csv | `arxiv,semantic_scholar` | 활성 소스 |
| `limit` | int | 20 | 최대 50 |
| `offset` | int | 0 | 페이지네이션 |
| `workspaceId` | uuid | (필수) | rate limit + dedupe 스코프 |

**응답 200:**
```ts
{
  results: PaperResult[];
  total: number;
  sources: {
    name: string;
    count: number;
    latencyMs: number;
  }[];
}
```

**PaperResult:**
```ts
interface PaperResult {
  id: string;                   // doi 또는 "arxiv:<id>"
  doi: string | null;
  arxivId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  source: "arxiv" | "semantic_scholar" | "crossref";
  openAccessPdfUrl: string | null;   // Unpaywall 결과 포함
  citationCount: number | null;
  alreadyImported: boolean;          // 워크스페이스 내 이미 존재 여부
}
```

**Federation 로직:**
1. arXiv + Semantic Scholar **parallel** 호출 (`Promise.all`)
2. 결과를 DOI 기준 dedupe — 같은 DOI면 arXiv > SS 우선 (arXiv가 PDF 직링크 제공)
3. DOI 없는 arXiv 논문: `"arxiv:<arxivId>"` 가상 키
4. Crossref는 arXiv + SS 결과가 모두 0일 때만 fallback 호출
5. Unpaywall 룩업은 DOI 있는 결과에 대해 **batch** 호출 (단일 엔드포인트 없음 — 각 DOI별 `GET /v2/{doi}?email=`)
6. **머지 우선순위** (같은 DOI가 arXiv + SS 모두 있을 때): `openAccessPdfUrl`·`arxivId`는 arXiv 우선, `citationCount`·`abstract` 길이가 더 긴 쪽은 SS 우선, 나머지 메타(제목·저자·연도)는 arXiv 우선
6. `alreadyImported` 플래그: `/api/internal/notes?workspaceId=&doi=` 조회

**Rate limit:** 워크스페이스당 60 req/min (Redis sliding window `SLIDING_WINDOW` 키: `lit:search:{workspaceId}`)

**에러:**
- `400` q 없음
- `429` rate limit
- 외부 API 전체 실패 시 `503`

### 5.2 라우트: `POST /api/literature/import`

**인증:** `requireAuth` + `canWrite(user, { type: "project", id: projectId })`

**요청:**
```ts
{
  dois: string[];          // DOI 또는 "arxiv:<id>", 최대 50
  projectId: string;       // uuid
}
```

**응답 202:**
```ts
{
  jobId: string;
  workflowId: string;
  skipped: string[];       // 이미 워크스페이스에 존재하는 DOI
  queued: number;          // 실제 import 진행할 논문 수
}
```

**내부 동작:**
1. `projectId` 권한 확인 + `workspaceId` 조회
2. `dois` 중 워크스페이스 내 기존 `notes.doi` 충돌 여부 사전 확인 → `skipped` 목록 반환
3. `queued = dois.length - skipped.length` — 0이면 202 + 빈 jobId 반환 (workflow 없음)
4. `import_jobs` row insert (source: `"literature_search"`, sourceMetadata)
5. `LitImportWorkflow` Temporal start (task queue: `"ingest"` 기존 큐 재활용)
6. Temporal semaphore: 워크스페이스당 동시 3 workflow (기존 Plan 4 패턴)

**에러:**
- `400` dois 빈 배열 or > 50
- `403` 프로젝트 권한 없음
- `404` 프로젝트 미존재

### 5.3 내부 API 확장

기존 `/api/internal/notes` POST에 `doi` 필드 추가:
```ts
{ ..., doi?: string | null }
```

기존 `/api/internal/notes` GET에 `doi` 쿼리파라미터 추가 (dedupe 조회용).

---

## 6. Worker 레이어 (LitImportWorkflow)

### 6.1 워크플로우 구조

```python
@workflow.defn(name="LitImportWorkflow")
class LitImportWorkflow:
    run(inp: LitImportInput) -> dict
```

```python
@dataclass
class LitImportInput:
    job_id: str
    user_id: str
    workspace_id: str
    dois: list[str]          # DOI 또는 "arxiv:<id>"
```

**실행 순서:**

```
1. resolve_target(job_id)                    ← 기존 activity 재활용
2. fetch_paper_metadata(dois)                ← 신규
3. dedupe_check(workspace_id, dois)          ← 신규 (최종 서버-사이드 확인)
4. asyncio.gather(*per-paper tasks)          ← fan-out on fresh[] only, return_exceptions=True
   ├─ [OA PDF] fetch_and_upload_oa_pdf → child IngestWorkflow
   │   └─ 실패 시 create_metadata_note로 graceful degradation
   └─ [no PDF] create_metadata_note
5. finalize_import_job(job_id, ...)          ← 기존 activity 재활용
```

### 6.2 신규 Activities

#### `fetch_paper_metadata`

```python
@activity.defn(name="fetch_paper_metadata")
async def fetch_paper_metadata(payload: dict) -> dict:
    """
    dois: list[str] → PaperNode[] with oa_pdf_url populated via Unpaywall
    전략:
      - "arxiv:<id>" → arXiv API (OA PDF 직링크)
      - DOI → Semantic Scholar API → Unpaywall fallback
      - 둘 다 없으면 Crossref 메타만
    타임아웃: 2분
    """
```

반환:
```python
{
  "papers": [
    {
      "doi": str | None,
      "arxiv_id": str | None,
      "title": str,
      "authors": list[str],
      "year": int | None,
      "abstract": str | None,
      "citation_count": int | None,
      "oa_pdf_url": str | None,   # None이면 metadata-only
      "is_paywalled": bool,
    }
  ]
}
```

#### `dedupe_check`

```python
@activity.defn(name="lit_dedupe_check")
async def lit_dedupe_check(payload: dict) -> dict:
    """
    workspace_id + dois → { fresh: list[str], skipped: list[str] }
    /api/internal/notes?workspaceId=&doi= 로 기존 note 조회
    타임아웃: 30초
    """
```

#### `create_metadata_note`

```python
@activity.defn(name="create_metadata_note")
async def create_metadata_note(payload: dict) -> dict:
    """
    paper_meta Plate 블록 포함 note 생성.
    source_type = "paper", doi 컬럼 채움.
    content에 paper_meta 블록 + 페이월 안내 텍스트 삽입.
    타임아웃: 30초
    """
```

#### `fetch_and_upload_oa_pdf`

```python
@activity.defn(name="fetch_and_upload_oa_pdf")
async def fetch_and_upload_oa_pdf(payload: dict) -> dict:
    """
    oa_pdf_url에서 PDF 다운로드 → MinIO uploads/ 업로드
    → object_key 반환 (child IngestWorkflow 입력으로 사용)
    타임아웃: 5분
    최대 PDF 크기: 50MB (학술 논문 기준 충분)
    """
```

### 6.3 기존 Activity 재활용

| Activity | 재활용 방식 |
|---|---|
| `resolve_target` | 그대로 (job_id → project_id + parent_note_id) |
| `finalize_import_job` | 그대로 (status + 카운터 + system 알림) |
| child `IngestWorkflow` | OA PDF upload 후 기존 PDF 파이프라인 그대로 통과 |

### 6.4 에러 처리

- `fetch_and_upload_oa_pdf` 실패 (네트워크, 50MB 초과 등) → `create_metadata_note`로 graceful degradation (섹션 6.1 fan-out 참조)
- `fetch_paper_metadata`에서 DOI 룩업 실패 → 해당 paper skip, failed count 증가
- `asyncio.gather(return_exceptions=True)` — 단일 논문 실패가 전체 job을 중단하지 않음
- 전체 실패(completed=0, failed>0) → `finalize_import_job`이 `status="failed"` 처리

### 6.5 타임아웃 요약

| Activity | schedule_to_close |
|---|---|
| `resolve_target` | 5분 (기존) |
| `fetch_paper_metadata` | 2분 |
| `lit_dedupe_check` | 30초 |
| `fetch_and_upload_oa_pdf` | 5분 |
| `create_metadata_note` | 30초 |
| `finalize_import_job` | 5분 (기존) |

---

## 7. 에이전트 도구

에이전트 런타임(Plan 12 / Agent Runtime v2)에 도구 2개 등록.

### `literature_search`

```python
class LiteratureSearchTool(BaseTool):
    name = "literature_search"
    description = "학술 논문을 arXiv, Semantic Scholar 등에서 검색합니다."

    class Input(BaseModel):
        query: str
        sources: list[str] = ["arxiv", "semantic_scholar"]
        limit: int = Field(default=10, le=50)
        workspace_id: str
        project_id: str | None = None    # 컨텍스트 힌트

    async def run(self, inp: Input) -> ToolResult:
        # GET /api/literature/search 호출
        # 결과를 에이전트 응답용 요약 + 채팅 렌더러용 structured payload로 반환
```

### `literature_import`

```python
class LiteratureImportTool(BaseTool):
    name = "literature_import"
    description = "선택한 논문을 워크스페이스로 가져옵니다."

    class Input(BaseModel):
        dois: list[str]
        project_id: str
        workspace_id: str

    async def run(self, inp: Input) -> ToolResult:
        # POST /api/literature/import 호출
        # job_id + skipped 목록 반환
```

---

## 8. 프론트엔드

### 8.1 채팅 메시지 렌더러

`LitResultCard` 컴포넌트 (신규, chat 렌더러 전용):

```
┌─────────────────────────────────────────────────────┐
│ 📄  Attention Is All You Need                        │
│     Vaswani, Shazeer, Parmar et al. — 2017           │
│     arXiv:1706.03762 · 인용 12,847 · [OA PDF]       │
│     "We propose a new simple network architecture..." │
└─────────────────────────────────────────────────────┘
```

- `[OA PDF]` 배지: 클릭 시 PDF 새 탭으로 열림
- 🔒 배지: 페이월 (메타데이터만 가져올 수 있음)
- 채팅 메시지 하단 CTA: **"에디터에서 전체 결과 보기 →"** → `TabModeRouter.open("lit-search-results", { query, results })`

### 8.2 에디터 탭 viewer (`lit-search-results`)

TabModeRouter에 신규 viewer 추가:

```ts
// apps/web/src/components/tabs/viewers/LitSearchResultsViewer.tsx
```

**컴포넌트 트리:**
```
LitSearchResultsViewer
  ├─ LitSearchBar              (쿼리 수정 + 재검색)
  ├─ LitSourceFilter           (arXiv / SS / Crossref 체크박스)
  ├─ LitResultsTable
  │    └─ LitResultRow × N    (체크박스 + 제목 + 저자 + 연도 + 인용수 + 배지)
  └─ LitImportBar (하단 고정)
       ├─ "N개 선택됨"
       ├─ ProjectPicker        (default: 채팅 컨텍스트 프로젝트)
       └─ [가져오기] 버튼      → POST /api/literature/import
```

### 8.3 import 진행 상태

- "가져오기" 클릭 후 `LitImportBar`가 `ProgressBar`로 전환
- `GET /api/literature/import/:jobId` 폴링 (2초 간격) — `import_jobs` 테이블 기반 (`ingest_jobs`가 아님)
  - 응답: `{ status, totalItems, completedItems, failedItems, finishedAt }`
- 완료 시 notification drawer에 시스템 알림 (기존 finalize_import_job → 알림 wiring)

**`GET /api/literature/import/:jobId` 추가** (섹션 5에 포함):
```ts
// 인증: requireAuth, 소유자 확인 (import_jobs.userId === user.id)
// 200: { status, totalItems, completedItems, failedItems, skipped: string[], finishedAt }
// 403: 다른 사용자의 job
// 404: job 미존재
```

### 8.4 i18n

신규 네임스페이스: `messages/ko/literature.json`

```json
{
  "search": {
    "placeholder": "논문 제목, 저자, 키워드로 검색",
    "button": "검색",
    "resultCount": "{{count}}개 결과",
    "openInEditor": "에디터에서 전체 결과 보기"
  },
  "import": {
    "selected": "{{count}}개 선택됨",
    "button": "가져오기",
    "skipped": "{{count}}개는 이미 존재하여 건너뜀",
    "paywallNotice": "OA PDF를 찾지 못했습니다. PDF를 직접 업로드하거나 기관 구독으로 접근하세요."
  },
  "badge": {
    "openAccess": "OA",
    "paywalled": "페이월"
  }
}
```

---

## 9. Rate Limit & Quota

### 9.1 사용자-facing 제한

| 제한 | 값 | 근거 |
|---|---|---|
| 검색 60 req/min per workspace | Redis sliding window | arXiv polite use policy |
| import 최대 50 DOI per 요청 | 하드 cap | 단일 workflow 크기 제한 |
| 동시 import workflow 3 per workspace | Temporal semaphore | 기존 Plan 4 패턴 |

### 9.2 외부 API 호출 전략

| API | 방식 | Rate limit |
|---|---|---|
| arXiv | `async httpx` | 3 req/sec 권장 → `asyncio.sleep(0.34)` 배치 사이 |
| Semantic Scholar | `async httpx` | 1 req/sec (미인증) / 10 req/sec (API key) |
| Crossref | `async httpx` + `mailto=` 헤더 | polite pool, 50 req/sec |
| Unpaywall | `async httpx` + `email=` 쿼리 | 100k req/day per email |

SS API key는 서버 env `SEMANTIC_SCHOLAR_API_KEY` (선택적). 없으면 1 req/sec 자동 적용.

### 9.3 API 키 관리

모든 학술 API 키는 서버 env-only. 사용자 BYOK 영역 없음 (인프라 비용이므로).

```
SEMANTIC_SCHOLAR_API_KEY=   # 선택적
CROSSREF_MAILTO=            # 필수 (polite pool)
UNPAYWALL_EMAIL=            # 필수
```

---

## 10. 보안

- **SSRF 방어**: `fetch_and_upload_oa_pdf`에서 Unpaywall이 반환한 URL을 그대로 fetch할 때, RFC 1918/loopback/link-local 주소 차단. `httpx` 커스텀 transport 레벨에서 DNS 결과 검증.
- **Content-Type 검증**: 다운로드된 파일이 `application/pdf`가 아닌 경우 즉시 abort.
- **파일 크기 cap**: PDF 50MB 초과 시 download abort (스트리밍 fetch로 Content-Length 선확인).
- **workspaceId 강제**: `/api/internal/*` 쓰기 라우트 전부 workspaceId 명시 (기존 feedback 규칙).

---

## 11. 미결 사항 (후속 spec)

| 항목 | 이유 |
|---|---|
| PubMed E-utilities 커넥터 | XML 파서 별도, 의학 사용자 수요 확인 후 |
| 인용 탐색 UI | Plan 5 KG backlinks 위에 얹는 것이 적합 |
| SS API key 사용량 모니터링 | Spec B (AI Usage Visibility) 흡수 |
| 검색 결과 캐싱 (Redis TTL) | 같은 쿼리 반복 시 외부 API 절약 |
| 에디터 탭 내 정렬/필터 고도화 | 인용수 정렬, 연도 필터 등 |

---

## 12. 구현 범위 요약

### apps/api
- `src/routes/literature.ts` — `/api/literature/search` + `/api/literature/import`
- `src/routes/internal/notes.ts` — `doi` 파라미터 + `doi` 필드 추가

### apps/worker
- `src/worker/workflows/lit_import_workflow.py` — LitImportWorkflow
- `src/worker/activities/lit_import_activities.py` — 4개 신규 activities
- `src/worker/tools/literature_search_tool.py` — 에이전트 tool 2개

### apps/web
- `src/components/chat/LitResultCard.tsx` — 채팅 카드
- `src/components/tabs/viewers/LitSearchResultsViewer.tsx` — 에디터 탭
- `messages/ko/literature.json` — i18n

### packages/db
- `src/schema/enums.ts` — `importSourceEnum` + `sourceTypeEnum` 값 추가
- `src/schema/notes.ts` — `doi text` 컬럼 + unique partial index
- migration 파일 (0026)
