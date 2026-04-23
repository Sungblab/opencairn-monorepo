# Post-hoc Review — Plans 1 ~ 4

- **Date**: 2026-04-23
- **Reviewer**: Claude Code (Code Reviewer agent, 4 병렬 iteration + 1 synthesis)
- **Base HEAD**: `a838524` (main, PR #9 merged)
- **범위**: Plan 1 (Foundation), Plan 2A (Editor Core), Plan 2B (Hocuspocus Collab), Plan 3 (Ingest Pipeline), Plan 3b (Batch Embeddings), Plan 4 Phase A+B (Agent Core + Hybrid Search)
- **이유**: 솔로 개발 초기 단계에 외부 리뷰 없이 머지된 구간을 post-hoc 감사. DB 스키마 / API 계약 / 권한 경계 / 보안에 집중.

## 총 집계

| Plan | 🔴 CRITICAL | 🟠 HIGH | 🟡 MEDIUM |
|---|---:|---:|---:|
| 1 Foundation | 7 | 7 | 7 |
| 2A + 2B | 4 | 5 | 5 |
| 3 + 3b | 2 | 4 | 7 |
| 4 A+B | 3 | 6 | 6 |
| **합계** | **16** | **22** | **25** |

아키텍처는 건전. 대부분 **surgical fix** 로 해결 가능.

---

## 7대 공통 패턴 (근본 부채)

### 1. Workspace 교차 검증 부재 — 가장 크고 위험한 패턴
Plan 1 H-3 가 Plan 2B/3/4 로 광범위하게 전파.

- Plan 1 H-3: `notes.workspaceId` ↔ `notes.projectId` denormalization 불변식 검증 트리거 없음
- Plan 2B C-2: comments `parentId` cross-note 검증 없음
- Plan 2B C-3: `@mention` 이 `/api/mentions/search` 를 우회해서 cross-workspace ID 주입 가능
- Plan 4 C-3: `/internal/notes/hybrid-search` + concept-edges + concept-notes + concepts/merge + concepts/search + orphan-concepts + link-candidates + topics — **전부 workspaceId 파라미터 없음**
- Plan 4 H-1: `/internal/notes` idempotency 가 `researchRuns.id` 만 키로 사용, workspace 교차검증 없음
- Plan 4 H-4: Librarian 워크플로우 페이로드에 `workspace_id` 있지만 API 호출에 전파 안 됨
- Plan 4 M-3: `/concept-notes` cross-project 링크 조용히 허용

**근본 원인**: "내부 엔드포인트는 신뢰된 워커만 호출하니까 workspace 는 암묵" 가정이 4 Plan 에 걸쳐 layered → **방어 심도 0**. 워커 버그 하나로 크로스-워크스페이스 오염.

**해법**: `internal.ts` 의 모든 쓰기 라우트에 `workspaceId` 명시 파라미터 + `assertResourceWorkspace(tx, resourceId, workspaceId)` 공통 헬퍼.

### 2. Soft-delete 불일치 (deletedAt not honored)
Plan 1 H-4 가 여러 곳으로 전파.

- Plan 1 H-4: `permissions.ts:33-40` `findWorkspaceId` 가 `deletedAt` 미체크
- Plan 2B C-4: Hocuspocus `onLoadDocument` / `persistence.fetch` 가 삭제된 노트 Yjs 세션 개방
- Plan 3 M-2: `/api/internal/notes` PATCH 가 `deletedAt` 미체크 → 삭제된 노트 부활 가능
- Plan 4 H-3: `/internal/notes/:id` + `/refresh-tsv` 가 `deletedAt` 미체크

**해법**: `permissions.ts:33-40` 한 줄 수정으로 Hocuspocus + api routes + compiler 전부 차단. `/internal/notes/:id` + `/refresh-tsv` + internal PATCH 개별 필터도 추가.

### 3. Rate limit / DoS 방어 전무

- Plan 1 C-5: Better Auth `rateLimit` 블록 없음, 초대 POST 무제한 (admin 이 이메일 폭탄 가능)
- Plan 2B M-1: `mentionSearchQuerySchema.q: min(0)` — 빈 쿼리로 워크스페이스 전 노트 스캔
- Plan 3 C-1: web SSRF + 응답 크기 상한 없음 (30s timeout 만으로 워커 슬롯 점유)
- Plan 3 H-2: PDF page count 상한 없음
- Plan 4 N-3: Librarian 100 프로젝트 시 순차 LLM 핫루프

**해법**: Better Auth `rateLimit` + 경로별 pagination cap + external fetch response size cap.

### 4. Concurrency primitives 부실

- Plan 1 C-2: invite accept TOCTOU (`UPDATE WHERE accepted_at IS NULL` 가드 없음)
- Plan 4 C-1: `/internal/concepts/merge` 의 `BEGIN;…COMMIT;` 가 **실제 트랜잭션 아님** — node-postgres 의 단일 `db.execute` 는 롤백 보장 없음
- Plan 4 C-2: 세마포어 acquire TOCTOU — 주석으로 자인, 버스트 시 rare 아님

**해법**: state-change 라우트를 `db.transaction()` 으로 감싸는 리팩터 + 경합 많은 곳에 `pg_advisory_xact_lock`.

### 5. Prompt injection 경계 부재

- Plan 3 M-1: `enhance_activity.py` 의 `ENHANCE_PROMPT_TEMPLATE.format(raw_text=raw_text)` 가 untrusted PDF/웹 텍스트를 system prompt 에 interpolation
- Plan 4 H-5: Compiler LLM 출력이 검증 없이 concept graph 로 영속화 → prompt injection concept 가 지식 그래프 상주

**해법**: `<document>` 델리미터 + system/user 메시지 분리 + extracted concept grounding check (원본 텍스트와의 토큰 오버랩).

### 6. 스키마 부채 (migration 0014 로 묶을 수 있음)

- Plan 1 H-1: `workspace_invites (workspace_id, email) WHERE accepted_at IS NULL` partial unique 부재
- Plan 1 H-2: `workspace_members.invited_by` 인덱스 부재 (cascade/SET NULL 시 풀스캔)
- Plan 1 H-6: `workspaces.slug` case-sensitive unique → `CHECK (slug = lower(slug))` 필요
- Plan 1 H-7: 중복 `workspaces_slug_idx` (unique constraint 자동 인덱스와 겹침)
- Plan 2B H-3: `yjs_documents` size cap / GC / `notes` FK 전무 → bytea TOAST 압박, 고아 행
- **Plan 4 M-1**: `notes.embedding` / `concepts.embedding` 에 **벡터 인덱스 자체가 없음** (HNSW/IVFFLAT 미존재). Phase 2 seq-scan 절벽

### 7. Operational visibility 부족

- Plan 1 C-7: **`.github/workflows/` 자체가 없음** — Plan 1 완료 태그와 불일치
- Plan 3 H-4: Librarian `_merge_duplicates` inline path, 로그 없음 → 플래그 ON 시 왜 절감 안되는지 ops 가 식별 불가
- Plan 4 M-2: RRF CJK 빈 tsquery silent degrade
- Plan 4 N-1: Compiler 임베딩 skip 이벤트 없음

---

## 실행 계획 — Tier 기반 (4 PR)

### Tier 0 — 즉시 (security hotfixes) — ✅ COMPLETE (2026-04-23, `fix/plans-1-to-4-tier-0`)

| # | 상태 | 커밋 주제 |
|---|:-:|---|
| 0-1 | ✅ | permissions.ts + internal GET/PATCH/refresh-tsv 에 `isNull(deletedAt)` 필터. `soft-delete-cascade.test.ts` (4 tests) + notes.test.ts 기대값 404→403 업데이트. |
| 0-2 | ✅ | web_activity 전면 개편: scheme allowlist + IP literal 차단 + DNS 재해석(rebinding) + 수동 redirect 루프(max 5, hop 재검증) + streamed 10 MB cap. `test_web_activity_ssrf.py` 16 tests. |
| 0-3 | ✅ | `mentions.ts` user 분기에서 `user.email` SELECT 제거 + `sublabel` 드롭. label fallback은 name→id (email 금지). mentions.test.ts 에 PII 누출 방지 검증 추가. |
| 0-4 | ✅ | Better Auth `rateLimit` 활성화 (global 100/60s + /sign-up·/sign-in·/forget-password·/send-verification-email customRules). `lib/rate-limit.ts` (in-memory fixed-window) + 초대 POST 에 per-admin 10/min 버킷. 429 + Retry-After. |
| 0-5 | ✅ | `/invites/:token/accept` 트랜잭션 재배치: UPDATE(and(id, isNull(acceptedAt))) → INSERT 순서. returning 0 rows → 400. 23505 fallback 유지. 동시 5× accept → 정확히 1×200, 1 member row 검증. |

API vitest 139/139, worker `test_web_activity_ssrf.py` 17/17 (redirect-loop 테스트 추가), `pnpm build` 전체 green.

**Tier 1 로 이관된 follow-up 관찰 (후속 리뷰)**:
- **DNS TTL-shift TOCTOU**: `socket.getaddrinfo` 가 한 번 resolve 하고 `httpx.get()` 이 다시 resolve 하는 구간에서 attacker 가 짧은 TTL 로 answer 를 바꿀 수 있음. 완전한 fix 는 custom httpx transport 로 validated IP 에 connect pin (또는 `httpcore` `socket_options` post-connect peer IP 거부). 현재 worker 는 NAT 뒤라 RFC1918 은 외부에서 라우팅되지 않으므로 심각도 낮음 — 하지만 코드 주석의 "naive defense, sufficient" 표현은 과소평가.
- **Rate-limit 버킷 eviction**: `Map<string, Bucket>` 이 만료된 키를 `checkRateLimit` 재호출 시에만 교체하므로, 공격자가 고정된 사용자 ID 공간 밖에서 무한 키를 생성하면 프로세스 메모리가 슬로리크. 단일 프로세스 footprint 는 작지만 Tier 1 Redis 전환 시 해소.

### Tier 0 — 즉시 (security hotfixes) — original spec

| # | 위치 | 작업 |
|---|---|---|
| 0-1 | `apps/api/src/lib/permissions.ts:33-40` | `findWorkspaceId` 의 note 분기에 `isNull(notes.deletedAt)` 필터. 추가로 `/internal/notes/:id`, `/refresh-tsv`, internal PATCH 에도 명시 필터. **[Plan 1 H-4 + 2B C-4 + 3 M-2 + 4 H-3 한번에 마감]** |
| 0-2 | `apps/worker/src/worker/activities/web_activity.py:38-43` | SSRF 차단: `socket.getaddrinfo` 로 hostname 해석 후 private/loopback/link-local/reserved IP 거부 + `follow_redirects=False` 수동 루프 (max 5, hop 마다 IP 재검증) + response size cap (예: 10MB). **[Plan 3 C-1]** |
| 0-3 | `apps/api/src/routes/mentions.ts:60-78` | user 타입 결과에서 `email` SELECT + `sublabel` 제거. `MentionSearchResult.sublabel` 필드는 유지하되 PII 원천 차단. **[Plan 2B C-1]** |
| 0-4 | `apps/api/src/lib/auth.ts` + 초대 POST | Better Auth `rateLimit: { enabled: true, window: 60, max: 10 }` + 초대 POST 에 per-workspace-admin 토큰 버킷. **[Plan 1 C-5]** |
| 0-5 | `apps/api/src/routes/invites.ts:92-111` | UPDATE 에 `and(eq(id, inv.id), isNull(acceptedAt))` 가드 + `rowCount === 1` 확인. **[Plan 1 C-2]** |

### Tier 1 — 배포 전 (구조적 강화)

| # | 위치 | 작업 |
|---|---|---|
| 1-1 | `apps/api/src/routes/internal.ts:708-724` | concepts/merge 를 `db.transaction(async tx => ...)` 로 래핑 + `sql.raw` → `sql.join` 교체. **[Plan 4 C-1 + 1 H-5]** |
| 1-2 | `apps/api/src/routes/internal.ts:815-874` | 세마포어 acquire/renewal 을 `db.transaction` + `pg_advisory_xact_lock(hashtext(projectId))` 로 감쌈. **[Plan 4 C-2]** |
| 1-3 | `apps/api/src/routes/internal.ts` 전반 | 모든 쓰기 라우트에 `workspaceId` 명시 파라미터 + `assertResourceWorkspace(tx, resourceId, workspaceId)` 공통 헬퍼. concept-edges 는 `sourceId.projectId === targetId.projectId` 추가 검증. **[Plan 4 C-3 + H-1 + H-4 + M-3]** |
| 1-4 | `apps/worker/src/worker/activities/youtube_activity.py:72-80` | `yt_dlp.YoutubeDL.extract_info` 전에 hostname 화이트리스트 재검증. **[Plan 3 C-2]** |
| 1-5 | `apps/api/src/routes/ingest.ts:208-219` | `workflowId → (userId, workspaceId)` 매핑 영속화 + 상태 조회 시 owner check. **[Plan 3 H-1]** |
| 1-6 | `docker-compose.yml:11` | `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}` 필수화. **[Plan 1 C-6]** |
| 1-7 | `apps/api/src/lib/auth.ts:33-36` | Google OAuth provider + oneTap 플러그인을 env 존재 시에만 조건부 등록. **[Plan 1 C-3]** |

### Tier 2 — Migration 0014 (스키마 묶음) — ✅ COMPLETE (2026-04-23, `fix/plans-1-to-4-tier-2`)

| # | 상태 | 작업 |
|---|:-:|---|
| 2-1 | ✅ | `CREATE INDEX notes_embedding_hnsw_idx ON notes USING hnsw (embedding vector_cosine_ops)` **[Plan 4 M-1]** |
| 2-2 | ✅ | `CREATE INDEX concepts_embedding_hnsw_idx ON concepts USING hnsw (embedding vector_cosine_ops)` **[Plan 4 M-1]** |
| 2-3 | ✅ | `CREATE UNIQUE INDEX workspace_invites_ws_email_pending_idx ON workspace_invites (workspace_id, email) WHERE accepted_at IS NULL` **[Plan 1 H-1]** |
| 2-4 | ✅ | `CREATE INDEX workspace_members_invited_by_idx` + `workspace_invites_invited_by_idx` **[Plan 1 H-2]** |
| 2-5 | ✅ | `ALTER TABLE workspaces ADD CONSTRAINT workspaces_slug_lower_check CHECK (slug = lower(slug))` **[Plan 1 H-6]** |
| 2-6 | ✅ | `DROP INDEX workspaces_slug_idx` (unique constraint 자동 인덱스와 중복) **[Plan 1 H-7]** |
| 2-7 | ✅ | `yjs_documents`: `size_bytes integer NOT NULL` (backfilled from `octet_length(state)`) + CHECK `octet_length(state) <= 4 MB` + `persistence.ts` 의 pre-check + `YjsStateTooLargeError` 노출 **[Plan 2B H-3]** |

API 143/143 · hocuspocus 39/39 (size-cap + size_bytes 회귀 2건 추가) · db 4/4 · 전체 monorepo build green. HNSW / CHECK constraint / partial unique 전부 `docker exec ... \d` 로 실존 확인. drizzle customType 가 opclass 를 snapshot 으로 못 실어서 HNSW 두 건은 `0014_*.sql` 수기 + 스키마 미수정(다음 `db:generate` 가 drop 시도 안 함 — snapshot 에 부재하므로).

**프로덕션 주의** (배포 runbook 으로 승격):

- 2-7 `CHECK (octet_length(state) <= 4 MB)` 은 기존 row 가 cap 을 초과하면 `ALTER TABLE` 단계에서 실패. 배포 전 `SELECT max(octet_length(state)) FROM yjs_documents;` 로 pre-flight 검증. dev 에서는 최대값 < 100 bytes.
- 2-5 `workspaces_slug_lower_check` 역시 기존 row 중 하나라도 uppercase 가 섞여 있으면 constraint 추가 단계에서 실패. 배포 전 `SELECT id, slug FROM workspaces WHERE slug != lower(slug);` 로 audit 후, 나오는 row 는 `UPDATE workspaces SET slug = lower(slug) WHERE slug != lower(slug);` 로 정규화한 뒤 migration 진행. (PR #13 gemini 리뷰 follow-up — 0014 를 retro-patch 하는 대신 runbook 에 기록.) dev 는 모든 slug 가 이미 lowercase 였음.

### Tier 2 follow-up (migration 0015)

| # | 상태 | 작업 |
|---|:-:|---|
| 2-8 | ✅ | `DROP INDEX workspace_invites_token_idx` — `token` 의 `.unique()` 가 이미 `workspace_invites_token_unique` btree 를 자동 생성. 0014 에서 놓친 중복 idx 제거. (PR #13 gemini 리뷰 follow-up) |

### Tier 3 — 방어적 코딩 + E2E

| # | 위치 | 작업 |
|---|---|---|
| 3-1 | `apps/worker/src/worker/agents/compiler/agent.py:183-204` | extraction prompt 를 `<document>...</document>` 델리미터로 감싸고 system/user 메시지 분리. extracted concept 에 grounding check (원본 텍스트와 토큰 오버랩 없으면 드롭). **[Plan 4 H-5]** |
| 3-2 | `apps/worker/src/worker/activities/enhance_activity.py:32-50` | `ENHANCE_PROMPT_TEMPLATE` 을 user role 메시지로 분리, `<document>` 델리미터. **[Plan 3 M-1]** |
| 3-3 | `apps/api/src/routes/internal.ts:439` (+ concept search/upsert) | `queryEmbedding: z.array(z.number().finite()).length(768)` 로 좁힘. **[Plan 4 H-2]** |
| 3-4 | `apps/worker/src/worker/agents/librarian/agent.py:706-709` | `_build_clusters` 재귀 union-find → iterative loop 변환. **[Plan 4 H-6]** |
| 3-5 | `apps/hocuspocus/src/config.ts:6` | `BETTER_AUTH_SECRET.min(32)` (api 측과 정합). **[Plan 2B H-1]** |
| 3-6 | `apps/web/tests/e2e/collab.spec.ts:74-83` | viewer 실제 타이핑 → 다른 브라우저에 **미도달** 검증 추가. **[Plan 2B M-4]** |

### Tier 4 — 인프라/운영 (별도 Plan 필요, 이 사이클 밖)

- `.github/workflows/ci.yml` 추가 (pnpm test, typecheck, db check) **[Plan 1 C-7]**
- MinIO per-workspace 버킷/프리픽스 격리 **[Plan 3 M-6]**
- `yjs_documents` GC + snapshot compaction (`Y.encodeStateAsUpdateV2`) **[Plan 2B H-3 연장]**
- Role revocation → WS 연결 종료 mechanism (api → hocuspocus admin 포트) **[Plan 2B H-5]**

---

## Plan 별 상세 findings

### Plan 1 Foundation

#### 🔴 CRITICAL

- **C-1**: `apps/api/src/middleware/require-role.ts:11` — `workspaceId` 파라미터 없으면 빈 문자열로 권한 조회 → 500. `isUuid(wsId)` 실패 시 400 반환
- **C-2**: `apps/api/src/routes/invites.ts:92-111` — 초대 수락 TOCTOU. UPDATE 에 `isNull(acceptedAt)` 가드 + `rowCount===1` 확인
- **C-3**: `apps/api/src/lib/auth.ts:33-36` — `GOOGLE_CLIENT_ID/SECRET` 빈값 fallback, oneTap 무조건 등록. env 존재 시 조건부 등록
- **C-4**: `apps/api/src/lib/auth.ts:16-43` — Better Auth 쿠키 attributes 미설정. 배포 토폴로지 확정 시 `advanced.defaultCookieAttributes` 명시
- **C-5**: Better Auth + 초대 엔드포인트 — rate limit 전무. Admin 이메일 폭탄 프리미티브
- **C-6**: `docker-compose.yml:11` — `POSTGRES_PASSWORD: changeme` 하드코딩. `${POSTGRES_PASSWORD:?...}` 필수화
- **C-7**: `.github/` 디렉토리 없음 — CI/CD 자체 부재

#### 🟠 HIGH

- **H-1**: `workspace_invites` — `(workspace_id, email) WHERE accepted_at IS NULL` partial unique 부재
- **H-2**: `workspace_members.invited_by` 인덱스 부재
- **H-3**: `notes.workspaceId` ↔ `notes.projectId` denorm 검증 트리거 없음 → 불일치 시 권한 바이패스
- **H-4**: `permissions.ts:33-40` `findWorkspaceId` 가 `deletedAt` 미체크 (Hocuspocus/compiler 전역 확산 원인)
- **H-5**: `internal.ts:705-707` `sql.raw` + 문자열 concat — `sql.join` 으로 교체
- **H-6**: `workspaces.slug` case-sensitive unique
- **H-7**: `workspaces_slug_idx` 가 unique constraint 인덱스와 중복

#### 🟡 MEDIUM

- **M-1**: `workspace_role.guest` 를 `resolveRole` 이 처리 안 함 (Plan 2B 재검증 결과: 실제로는 정상 동작 → 오탐, `permissions.ts:73-111` 이 guest 를 explicit grant 없으면 `none` 처리)
- **M-2**: `/members` 라우트가 `invitedBy` 누출 + `LIMIT` 없음
- **M-3**: `notes/by-project` 가 Promise.all N+1 권한 쿼리
- **M-4**: 미들웨어 캐시 패턴 일관성 (`c.set("wsRole")`)
- **M-5**: `/invites/:token/decline` invitee 이메일 검증 없이 delete
- **M-6**: 트랜잭션 재시도 루프 23505 catch 가 향후 projects 유니크 추가 시 오작동
- **M-7**: drizzle-kit destructive DDL 안전 가드 부재

### Plan 2A + 2B (Editor + Hocuspocus Collab)

#### 🔴 CRITICAL

- **C-1**: `apps/api/src/routes/mentions.ts:60-78` — user 검색 결과에 `email` 이 `sublabel` 로 반환 → 전 멤버 이메일 열람 가능 (PII 누출)
- **C-2**: `apps/api/src/routes/comments.ts:93-118` — 코멘트 `parentId` 가 `noteId` 소속 검증 없음 → cross-note 주입
- **C-3**: `apps/api/src/routes/comments.ts:91` + `lib/mention-parser.ts` — `@[user:UUID]` 가 `/api/mentions/search` 우회. 타 워크스페이스 ID 임의 주입 가능
- **C-4**: `apps/hocuspocus/src/auth.ts:52-67` + `apps/api/src/lib/permissions.ts:33-40` — 삭제된 노트 Yjs 세션 여전히 개방 (Plan 1 H-4 재현). **permissions.ts 한 줄 수정 전역 차단**

#### 🟠 HIGH

- **H-1**: `apps/hocuspocus/src/config.ts:6` — `BETTER_AUTH_SECRET.min(16)` 너무 낮음
- **H-2**: `apps/hocuspocus/src/readonly-guard.ts:53-66` — `onChange` throw 가 post-apply → 피어 브로드캐스트 이후 작동. 실제 차단은 Hocuspocus 내장 `connectionConfig.readOnly` 단일 지점 의존
- **H-3**: `yjs_documents` — size cap / GC / notes FK 전무
- **H-4**: `apps/web/src/components/editor/plugins/slash.tsx:109-176` — 슬래시 메뉴 window-wide keydown, `readOnly` 무시
- **H-5**: 권한 취소 실시간 반영 안 됨 — `onAuthenticate` 는 WS open 시점에만 호출

#### 🟡 MEDIUM

- **M-1**: `mentionSearchQuerySchema.q: min(0)` → DoS 프리미티브
- **M-2**: 코멘트 하드 삭제 — 답글 고아화, tombstone 부재
- **M-3**: `anchorBlockId` 클라이언트 신뢰, reaper 는 Y.Doc change 트리거
- **M-4**: E2E 가 readonly 배너만 확인, 실제 viewer 타이핑 → 피어 미도달 검증 없음
- **M-5**: `parseMentions` 정규식이 `@[user:../../admin]` 같은 경로 ID 허용

### Plan 3 + 3b (Ingest + Batch Embeddings)

#### 🔴 CRITICAL

- **C-1**: `apps/worker/src/worker/activities/web_activity.py:38-43` — **SSRF 치명적**. `httpx.AsyncClient(follow_redirects=True)` 에 host/IP 필터 없음. AWS IMDS (`169.254.169.254`), 내부 MinIO/Postgres/Temporal/Hocuspocus 모두 스캔 가능
- **C-2**: `apps/worker/src/worker/activities/youtube_activity.py:72-80` — 워커가 hostname 재검증 안 함, yt-dlp generic extractor 가 임의 사이트 fetch

#### 🟠 HIGH

- **H-1**: `apps/api/src/routes/ingest.ts:208-219` — `/ingest/status/:workflowId` per-owner 검증 없음 (capability URL, "Plan 5 follow-up" 주석)
- **H-2**: `apps/worker/src/worker/activities/pdf_activity.py:86-98` — `opendataloader-pdf` stderr 필터 없이 전파, `_detect_scan` page_count 상한 없음
- **H-3**: `apps/api/src/routes/internal.ts:64-68, 109-169` — `parentNoteId` 조용히 드롭 (UX 버그)
- **H-4**: Librarian `_merge_duplicates` inline embed, 로그 없음

#### 🟡 MEDIUM

- **M-1**: `apps/worker/src/worker/activities/enhance_activity.py:32-50` — prompt injection (raw_text → system prompt interpolation)
- **M-2**: `apps/api/src/routes/internal.ts:1254-1277` — PATCH `/internal/notes/:id` 가 `deletedAt` 미체크 (Plan 1 H-4 연장)
- **M-3**: quarantine path traversal — `PurePosixPath.name` 안전 확인됨, 테스트 핀만 추가
- **M-5**: `apps/worker/src/worker/workflows/batch_embed_workflow.py:114-120` — `run_id[:8]` 8자 절단 → S3 키 충돌 가능성
- **M-6**: `apps/api/src/lib/s3.ts:43` — MinIO 단일 버킷, per-workspace 격리 없음
- **M-7**: `upload_jsonl` 전량 메모리 버퍼 (`MAX_ITEMS` split 시 메모리 절벽)

#### 🟢 NOTES

- bodyLimit (500MB) + per-MIME 상한 = 올바른 이중 가드 ✅
- MIME allowlist 엄격 (deny-list 아님) ✅
- ADR-007 임베딩 모델 전환 완결 (3072d 런타임 흔적 없음) ✅
- LLM provider env-only 규율 준수 (`os.environ["LLM_PROVIDER"]`) ✅
- At-least-once 부작용: `create_source_note` 재시도 시 중복 노트 → compiler 재실행 → 임베드 비용 2배 (알려진 trade-off)

### Plan 4 Phase A + B (Agent Core + Hybrid Search)

#### 🔴 CRITICAL

- **C-1**: `apps/api/src/routes/internal.ts:708-724` — `/internal/concepts/merge` 의 `BEGIN;…COMMIT;` 가 실제 트랜잭션 아님 (node-postgres 단일 `db.execute`). `db.transaction()` 필수 + `sql.raw` 교체
- **C-2**: `apps/api/src/routes/internal.ts:815-874` — 세마포어 acquire TOCTOU. `pg_advisory_xact_lock` 필요
- **C-3**: `apps/api/src/routes/internal.ts:465-562` + 다수 — hybrid-search/concept-edges/concept-notes/concepts/merge/concepts/search/orphan-concepts/link-candidates/topics 전부 workspace 검증 없음

#### 🟠 HIGH

- **H-1**: `apps/api/src/routes/internal.ts:1192-1200` — `/internal/notes` idempotency 가 `researchRuns.id` 만 키, workspace 교차검증 없음
- **H-2**: `apps/api/src/routes/internal.ts:439` — `queryEmbedding: z.array(z.number())` 차원/finite 검증 없음
- **H-3**: `/internal/notes/:id` (201-221) + `/refresh-tsv` (770) 가 `deletedAt` 미체크 (Plan 1 H-4 연장)
- **H-4**: `apps/worker/src/worker/agents/librarian/agent.py:125-130` — workflow payload 에 `workspace_id` 있지만 API 호출에 전파 안 됨
- **H-5**: `apps/worker/src/worker/agents/compiler/agent.py:183-204, 567-574` — LLM 출력 무검증 영속화, prompt injection concept 상주
- **H-6**: `apps/worker/src/worker/agents/librarian/agent.py:706-709` — `_build_clusters` 재귀 union-find, RecursionError 리스크

#### 🟡 MEDIUM

- **M-1** 🔥: `notes.embedding` / `concepts.embedding` **벡터 인덱스 자체가 없음** (HNSW/IVFFLAT 미존재)
- **M-2**: RRF `plainto_tsquery('simple', <CJK>)` 빈 tsquery → BM25 무음 degrade
- **M-3**: `/concept-notes` insert 가 같은 프로젝트 검증 없음
- **M-4**: 에이전트 provider 주입이 activity 레이어에서 env-only 확인 필요 (별도 감사)
- **M-5**: `/wiki-logs` `reason` 이 `\r\n` 허용 → log forgery pivot
- **M-6**: 세마포어 renewal 이 `purpose` 불일치 무시

#### 🟢 NOTES

- ResearchAgent 는 `fetch_url` 미사용 → Plan 3 C-1 SSRF 영향 없음 ✅
- Compiler 임베딩 skip silent → CustomEvent 로그 권장
- `assertResourceWorkspace` 헬퍼 도입 시 Plan 5/6/7/8 가 자동으로 방어선 상속

---

## Plan 간 cross-check 결과

| Plan 1 finding | Plan 2B/3/4 에서 재확인 결과 |
|---|---|
| H-3 (denorm 불변식) | 2B C-2, 4 C-3, 4 H-1, 4 H-4, 4 M-3 전부 동일 근본 원인 |
| H-4 (deletedAt) | 2B C-4, 3 M-2, 4 H-3 — **확산 확인**. permissions.ts 한 줄로 전역 차단 |
| H-5 (sql.raw) | 4 C-1 에 여전히 방치 |
| M-1 (guest role) | 오탐 — `permissions.ts:73-111` 이 실제로 올바르게 처리 |

---

## 참고

- 이 리뷰는 **디스크에 영구 기록**됨. 새 세션에서 이 파일을 읽고 tier 순서대로 PR 진행 권장.
- 실행 plan 은 `docs/superpowers/plans/2026-04-23-plans-1-to-4-fixes.md` 에 별도 작성 (새 세션에서).
- 메모리 요약: `project_post_hoc_review_plans_1_to_4.md` (backlog 참조용).
- 원칙 메모: `feedback_internal_api_workspace_scope.md` (향후 Plan 에서 강제).
