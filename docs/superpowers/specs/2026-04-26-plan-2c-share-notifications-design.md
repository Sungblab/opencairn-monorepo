# Plan 2C — Share Links + Notification Wiring (Design)

**Status:** Ready for plan
**Date:** 2026-04-26
**Branch:** `feat/plan-2c-share-notifications` (worktree `.worktrees/plan-2c`)
**Supersedes:** Plan 2 Tasks 12, 13, 16, 17 (notification publish wiring + public share + page-level guest share)
**Companion docs:** `docs/architecture/collaboration-model.md`, `docs/superpowers/plans/2026-04-09-plan-2-editor.md`

## 1. Goal

플랜 2의 마지막 협업 조각을 매듭짓는다.

1. **알림 발화 wiring 완성** — `notifications` 인프라(App Shell Phase 5)에 누락되어 있던 3 종(`comment_reply`, `share_invite`, `research_complete`)을 실제 이벤트에 연결.
2. **노션 스타일 공개 공유 링크** — 토큰 기반 read-only 퍼블릭 페이지. 비밀번호/만료/SEO 옵션 없이 "토큰=비밀, revoke만 빠르게"의 노션 모델.
3. **워크스페이스 멤버에 대한 page-level 권한 부여 UI** — `pagePermissions` 테이블은 이미 있으나 CRUD API + UI가 비어 있음. ShareDialog에서 워크스페이스 멤버 검색 → role 부여.

## 2. Scope

### In scope

| 범위 | 설명 |
|------|------|
| `share_links` 스키마 + 마이그레이션 | 신규 테이블, soft-revoke, partial active index |
| `apps/api/src/routes/share.ts` | 공개 링크 CRUD + 비인증 `/api/public/share/:token` |
| Per-note 권한 라우트 | 워크스페이스 멤버에게 `pagePermissions` 행 grant/revoke/role 변경 |
| `comment_reply` 알림 wiring | comments POST에 답글 발화 추가 |
| `share_invite` 알림 wiring | page permission grant/upgrade 시 발화 |
| `research_complete` 알림 wiring | 신규 `PATCH /internal/research/runs/:id/finalize` + worker 새 액티비티 |
| `ShareDialog` (노트 에디터) | Invite people + Share to web 두 섹션 |
| `/[locale]/s/[token]` 비인증 SSR 페이지 | Y.Doc → Plate 변환 + PlateStatic 렌더 |
| `SharedLinksTab` 채우기 | 워크스페이스 settings 어드민 뷰 |
| `NotificationItem` 4 종 분기 | `comment_reply` / `share_invite` / `research_complete` / `system` |
| i18n (ko/en parity) | shareDialog · publicShare · workspaceSettings.sharedLinks · notifications |

### Out of scope (별도 플랜으로 분리)

| 항목 | 이유 / 어디서 다룰지 |
|------|----------------------|
| 이메일 알림 (Resend) | 플랜 2 Task 14에서 별도로 다룸 (인앱 알림 + 선호도 + batching이 한 단위) |
| 비밀번호 보호 / 만료 / SEO 토글 | 노션 모델 채택 — 토큰 자체가 비밀, revoke가 만료 대체. 후속 follow-up |
| 외부 이메일로 페이지별 게스트 초대 | 워크스페이스 invite 시스템(이미 있음)으로 게스트 추가 후 page 권한 부여 |
| `system` 알림 발송 wiring | Super Admin Console spec(`project_super_admin_spec.md`)에서 broadcast UI까지 통합 |
| 공유 페이지 라이브 동기화 (Hocuspocus 비인증 read-only) | 99% 유스케이스가 정적 스냅샷이고 보안 surface 증가. 후속 plan |
| 공유 페이지 `editor` role 활성화 | Yjs 클라이언트 비인증 접근 필요 — 위와 같이 후속 |

## 3. Decisions Log (브레인스토밍 합의)

| # | 질문 | 결정 | 근거 |
|---|------|------|------|
| 1 | research_complete 후킹 위치 | **A** — 새 `PATCH /internal/research/runs/:id/finalize` + worker 새 액티비티 | 워크플로우가 명시적으로 "완료" 선언하므로 SSE 미구독 사용자도 알림 받음 |
| 2 | 공개 공유 링크 기능 범위 | **A'** Notion 스타일 — 토큰 + role + revoke + noindex + rate limit | 비밀번호/만료는 학습 부담만 키움. revoke가 만료 대체 |
| 3 | 비인증 viewer가 콘텐츠 보는 방식 | **B** — 서버에서 Y.Doc → Plate 변환 → SSR 정적 렌더 | Hocuspocus auth 확장은 보안 surface 증가. 99% 유스케이스 = 한 번 보기 |
| 4 | per-note 게스트 공유 | **B** — 워크스페이스 멤버 한정 page-level 권한 부여, 외부인은 공개 링크 | A는 워크스페이스 invite와 중복. 외부인 공유 = 공개 링크가 더 자연스러움 |
| 5 | 이메일 알림 포함 | **제외** | Task 14가 이메일 + batching + 선호도 UI를 한 단위로 가져감 |
| 6 | `system` 알림 wiring | **wiring 안 함, 렌더러만 추가** | Super Admin Console spec에서 broadcast UI까지 통합 설계 예정 |

## 4. Data Model

### 신규 테이블 `share_links`

```ts
// packages/db/src/schema/share-links.ts
export const shareRoleEnum = pgEnum("share_role", ["viewer", "commenter", "editor"]);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),       // 32-byte base64url
    role: shareRoleEnum("role").notNull().default("viewer"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("share_links_token_unique").on(t.token),
    index("share_links_note_id_idx").on(t.noteId),
    index("share_links_workspace_id_idx").on(t.workspaceId),
    // hot path: 토큰 검증은 활성 링크만, partial index로 O(1)
    index("share_links_active_token_idx")
      .on(t.token)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);
```

### 설계 결정

- **토큰 생성**: `randomBytes(32).toString("base64url")` — 256-bit 엔트로피, URL-safe
- **soft-revoke**: `revokedAt` NULL이 활성. revoke 후에도 audit 추적 가능. partial index로 룩업 비용 동일
- **`workspaceId` denormalize**: `notes.workspaceId`와 동일하지만 SharedLinksTab이 노트 join 없이 워크스페이스 전체 링크 나열
- **role 3종**: enum에는 `editor` 두지만 MVP UI는 `viewer`/`commenter`만 노출. `editor` 활성화는 후속(Hocuspocus 비인증 read 확장 필요)
- **만료/비밀번호 컬럼 없음**: 노션 모델
- **여러 활성 링크 허용**: 같은 노트에 여러 role의 링크 동시 발급 가능. 단, **같은 role의 활성 링크가 이미 있으면 새로 만들지 않고 재사용** (idempotent)

### 기존 테이블 변경 없음

`notes`, `pagePermissions`, `notifications`, `notificationKindEnum`, `pageRoleEnum` 모두 손대지 않음. `pagePermissions` 행 INSERT/UPDATE/DELETE만 추가됨.

### 마이그레이션

- 파일명: `0026_share_links.sql` (Drizzle generate)
- main HEAD가 0024이고 plan-7-phase-2가 이미 0025를 점유. 머지 충돌 시 reviewer가 재번호 (`project_plan7_phase2_complete.md`에 같은 패턴 선례)
- 단방향 신규 추가, 기존 데이터 영향 없음

## 5. API Contract

### 공개 링크 — `apps/api/src/routes/share.ts`

#### `POST /api/notes/:id/share`

**권한**: `canWrite(note)` (editor 이상)
**Body**: `{ role: 'viewer' | 'commenter' }`
**동작**:
1. 활성 + 같은 role 링크 있으면 그것의 `{id, token, role, createdAt}` 반환 (idempotent) → `200`
2. 없으면 새 토큰 발급 + 행 INSERT → `201`
**Response**: `{ id, token, role, createdAt }` (status 위 분기)

#### `GET /api/notes/:id/share`

**권한**: `canRead(note)`
**Response**: `200 { links: [{id, token, role, createdAt, createdBy: {id, name}}] }` — 활성만

#### `DELETE /api/share/:shareId`

**권한**: `shareLink.createdBy === userId` OR `canWrite(note)`
**동작**: `revokedAt = NOW()` (soft) — 멱등 (이미 revoke 된 행 두 번째 호출도 200)
**Response**: `204`

#### `GET /api/workspaces/:wsId/share`

**권한**: `requireWorkspaceRole("admin")`
**Response**: `200 { links: [{id, token, role, noteId, noteTitle, createdAt, createdBy:{id,name}}] }` — 활성만, workspace 전체

#### `GET /api/public/share/:token` (비인증)

**Path**: `/api/public/*` 경로는 `requireAuth` 미들웨어 앞에 마운트 (invites 패턴)
**Rate limit**: 30 req/min/IP (`apps/api/src/lib/rate-limit.ts` 재사용)
**동작**:
1. 토큰 룩업 → 활성(revokedAt IS NULL) AND 노트(deletedAt IS NULL) 검증, 둘 다 만족 안 하면 404
2. `notes.yjsStateLoadedAt`가 있고 `yjs_documents.state`가 존재하면 Yjs decode → Plate value
3. 아니면 `notes.content` (Plate Value 그대로) 반환
**Response**: `200 { note: { id, title, role, plateValue, updatedAt } }`
**보안**: workspaceId/projectId/userId/createdAt 등 메타 절대 미노출

### Per-note 권한 — `apps/api/src/routes/share.ts` (또는 분리)

#### `GET /api/notes/:id/permissions`

**권한**: `canRead(note)`
**Response**: `200 { permissions: [{userId, role, name, email, grantedBy, createdAt}] }`

#### `POST /api/notes/:id/permissions`

**권한**: `canWrite(note)`
**Body**: `{ userId, role: 'viewer' | 'commenter' | 'editor' }`
**검증**: `userId`가 노트의 워크스페이스 멤버인지 lookup — 아니면 400 (`not_workspace_member`)
**동작**: `pagePermissions` upsert (`ON CONFLICT (page_id, user_id) DO UPDATE SET role`)
**알림**: 성공 + `userId !== currentUserId`이면 `share_invite` 발화
**Response**: `201 { userId, role, grantedBy, createdAt }`

#### `PATCH /api/notes/:id/permissions/:userId`

**권한**: `canWrite(note)`
**Body**: `{ role: 'viewer' | 'commenter' | 'editor' }`
**알림**: role이 실제로 변경된 경우에만 `share_invite` 재발화 (`summary`에 새 role 명시)
**Response**: `200 { userId, role }`

#### `DELETE /api/notes/:id/permissions/:userId`

**권한**: `canWrite(note)`
**동작**: pagePermissions 행 DELETE
**Response**: `204`

#### `GET /api/workspaces/:wsId/members/search?q=...`

**권한**: `requireWorkspaceRole("member")`
**동작**: ILIKE name/email, 디바운스 200ms 가정, 최대 10건
**Response**: `200 { members: [{userId, name, email, role}] }`
**Note**: 이미 비슷한 멤버 검색이 있으면 재사용 — implementation 시 grep 확인

### 알림 wiring 추가

#### `comments.ts` POST `/notes/:noteId/comments`

기존 mention fan-out 직후, `body.parentId`가 있으면:

```ts
const [parent] = await db
  .select({ authorId: comments.authorId })
  .from(comments)
  .where(eq(comments.id, body.parentId));
if (parent && parent.authorId !== userId) {
  await persistAndPublish({
    userId: parent.authorId,
    kind: "comment_reply",
    payload: {
      summary: body.body.slice(0, 200),
      noteId,
      commentId: inserted.id,
      parentCommentId: body.parentId,
      fromUserId: userId,
    },
  }).catch(() => undefined);
}
```

**중복 방지 정책**: 부모 댓글 작성자가 답글 본문에 @mention 되어 있으면 mention + comment_reply 둘 다 받음. 둘 다 의미 있고 같은 노트로 점프하므로 허용 (de-dup 안 함).

#### 신규 `internal.ts` `PATCH /internal/research/runs/:id/finalize`

**Body**: `{ status: 'completed' | 'failed' | 'cancelled', noteId?: string, errorCode?: string, errorMessage?: string }`
**동작**:
1. 트랜잭션 시작
2. `SELECT completedAt, userId, topic, projectId FROM researchRuns WHERE id = :id FOR UPDATE` — 행 잠금 + 이전 상태 확인
3. `previouslyCompleted = run.completedAt !== null`
4. `UPDATE researchRuns SET status, completedAt = NOW(), [error]` 적용
5. 트랜잭션 커밋
6. `status === 'completed' && !previouslyCompleted`일 때만 `persistAndPublish` 호출 (커밋 후, await + silent-on-failure)

```ts
// 트랜잭션 끝난 뒤
if (body.status === "completed" && !previouslyCompleted) {
  await persistAndPublish({
    userId: run.userId,
    kind: "research_complete",
    payload: {
      summary: `"${run.topic}" 리서치가 완료되었습니다`,
      runId,
      noteId: body.noteId,
      projectId: run.projectId,
      topic: run.topic,
    },
  }).catch(() => undefined);
}
```

**Response**: `200 { ok: true, alreadyFinalized?: boolean }`

### Worker 변경 — `apps/worker/src/worker/`

#### 신규 액티비티 `activities/deep_research/finalize.py`

```python
@dataclass
class FinalizeInput:
    run_id: str
    status: str  # "completed" | "failed" | "cancelled"
    note_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None

@activity.defn(name="finalize_deep_research")
async def finalize_deep_research(inp: FinalizeInput) -> dict[str, Any]:
    from worker.lib.api_client import patch_internal
    body = {"status": inp.status}
    if inp.note_id: body["noteId"] = inp.note_id
    if inp.error_code: body["errorCode"] = inp.error_code
    if inp.error_message: body["errorMessage"] = inp.error_message
    return await patch_internal(f"/internal/research/runs/{inp.run_id}/finalize", body)
```

#### `workflows/deep_research_workflow.py` 수정

워크플로우의 try/except 종단부 — **성공/실패/취소 3 경로 모두**에서 finalize 호출:

```python
# 성공 경로 (persist_out 직후)
await workflow.execute_activity(
    "finalize_deep_research",
    FinalizeInput(run_id=inp.run_id, status="completed", note_id=persist_out["note_id"]),
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy=RetryPolicy(maximum_attempts=5),
)
return DeepResearchOutput(status="completed", ...)

# 실패 경로 (ActivityError except 안)
await workflow.execute_activity(
    "finalize_deep_research",
    FinalizeInput(run_id=inp.run_id, status="failed", error_code=code, error_message=msg),
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy=RetryPolicy(maximum_attempts=5),
)
return DeepResearchOutput(status="failed", ...)

# 취소 경로 동일
```

**왜 새 액티비티인가**: 워크플로우는 외부 IO(HTTP) 직접 호출 불가 (Temporal determinism). `post/patch_internal`은 액티비티 안에서만 합법.

## 6. Notification payload schemas

`apps/api/src/lib/notification-events.ts` docblock에 명문화:

```ts
// payload 공통: 모든 kind는 `summary: string`을 가짐 (NotificationItem fallback 안전망)

// mention (기존, 변경 없음):
//   { summary, noteId, commentId, fromUserId }

// comment_reply (신규):
//   { summary, noteId, commentId, parentCommentId, fromUserId }

// share_invite (신규):
//   { summary, noteId, noteTitle, role, fromUserId }

// research_complete (신규):
//   { summary, runId, noteId, projectId, topic }

// system (enum 유지, wiring 미구현):
//   { summary, level: 'info' | 'warning', linkUrl?: string }
```

**자기 자신 발화 금지**: 모든 발화 지점에서 `targetUserId === currentUserId` skip (mention 패턴 동일).

## 7. Frontend Components

### `ShareDialog` — `apps/web/src/components/share/share-dialog.tsx`

노트 에디터 헤더의 "Share" 버튼 (조건: `canWrite(note)`)이 여는 모달.

**레이아웃 (노션 모델)**:

```
┌─ Share "<note title>" ──────────────────────┐
│  Invite people                              │
│  [멤버 검색…………]  [Viewer ▼]  [+ 부여]    │
│  ┌─────────────────────────────────────┐    │
│  │ 👤 Alice (alice@…)   [Editor ▼]  × │    │
│  │ 👤 Bob   (bob@…)     [Viewer ▼]  × │    │
│  └─────────────────────────────────────┘    │
│  ───────────────────────────────────────    │
│  Share to web                    [○ off]    │
│  (toggle on 시)                             │
│  https://opencairn.app/s/abc123…  [Copy]    │
│  Role: ○ Viewer  ● Commenter                │
│  Created by you · 2026-04-26                │
│  [Revoke link]                              │
└─────────────────────────────────────────────┘
```

**상호작용**:
- 멤버 검색: `GET /workspaces/:wsId/members/search?q=` 200ms 디바운스, 드롭다운, 이미 부여된 멤버는 회색
- 권한 부여: `POST /notes/:id/permissions` (TanStack Query mutation)
- role 인라인 변경: select onChange → `PATCH ...`
- 권한 회수: `×` 즉시 `DELETE` (확인 없이 — 노션 동일, 실수면 다시 부여)
- web toggle off→on: `POST /notes/:id/share` → 토큰 발급
- web toggle on→off: `DELETE /share/:shareId`
- role 변경(viewer↔commenter): 새 토큰 발급 + 기존 revoke (토큰=role 캐시)

### `/[locale]/s/[token]` — `apps/web/src/app/[locale]/s/[token]/page.tsx`

비인증 SSR. `[locale]/layout.tsx`만 거치고 `(app)` shell 미적용.

**서버 컴포넌트 흐름**:
1. `fetch GET /api/public/share/:token` (no auth header)
2. 404 → `notFound()` (Next.js)
3. 200 → `<PublicNoteView note={note} />`

**`PublicNoteView`** (`apps/web/src/components/share/public-note-view.tsx`):
- 헤더: 노트 제목 + "View only · Shared by OpenCairn" 배너 + 로그인 CTA
- 본문: `<PlateStaticRenderer value={plateValue} />`
- meta: `<meta name="robots" content="noindex">`, `<meta name="referrer" content="no-referrer">`

**`PlateStaticRenderer`** (`apps/web/src/components/share/plate-static-renderer.tsx`):
- Plate v49 `PlateStatic` API 사용 (편집/선택 비활성)
- 기존 element renderer (wiki-link, math, table, …) read-only mode 재사용
- 라이브 에디터와 동일한 plugin set 강제 (시각적 정합성)

### `SharedLinksTab` — `apps/web/src/components/views/workspace-settings/shared-links-tab.tsx`

현재 stub. 채울 내용:
- 워크스페이스 어드민 전용 (`requireWorkspaceRole('admin')`)
- `GET /api/workspaces/:wsId/share` 결과 테이블 표시
- 컬럼: Note title (링크) · Role · Created by · Created at · [revoke]
- 빈 상태: "아직 공유 링크가 없습니다"

### `NotificationItem` — `apps/web/src/components/notifications/notification-item.tsx`

기존 `mention`만 라벨/요약, 나머지는 `[kind]` fallback. 4 종 분기 추가:

| kind | 요약 텍스트 (i18n) | 클릭 시 이동 |
|------|-------------------|--------------|
| `comment_reply` | `notifications.summary.commentReply({from, body})` → `"<from> 님이 답글을 남겼습니다"` | `/notes/:noteId#comment-:commentId` |
| `share_invite` | `notifications.summary.shareInvite({from, note, role})` → `"<from> 님이 \"<note>\"를 공유했습니다 (Viewer)"` | `/notes/:noteId` |
| `research_complete` | `notifications.summary.researchComplete({topic})` → `"\"<topic>\" 리서치가 완료되었습니다"` | `/notes/:noteId` (없으면 `/projects/:projectId/research/:runId`) |
| `system` | `payload.summary` 그대로 | `payload.linkUrl` 있으면 이동, 없으면 인라인 |

### 노트 에디터 헤더 수정

기존 노트 헤더 컴포넌트(파일은 implementation 시 grep으로 확정)에 "Share" 버튼 추가. 표시 조건: `canWrite(note)`. 클릭 시 `<ShareDialog />` 모달 오픈.

### Middleware — `/s/*` 인증 패스스루

`apps/web/middleware.ts` (또는 동등 위치)에서 `/s/[token]` 경로는 인증 미들웨어 통과. 기존 `/invites/[token]` 패턴 따라.

## 8. i18n (ko/en parity)

신규 키 (모두 ko + en 양쪽 추가, parity script CI gate):

```
notifications.kindLabels.commentReply       "답글"      / "Reply"
notifications.kindLabels.shareInvite        "공유"      / "Share"
notifications.kindLabels.researchComplete   "리서치"    / "Research"
notifications.kindLabels.system             "알림"      / "System"

notifications.summary.commentReply          "{from} 님이 답글을 남겼습니다"
notifications.summary.shareInvite           "{from} 님이 \"{note}\"를 공유했습니다 ({role})"
notifications.summary.researchComplete      "\"{topic}\" 리서치가 완료되었습니다"

shareDialog.title                           "공유"
shareDialog.invitePeople                    "사용자 초대"
shareDialog.inviteSearchPlaceholder         "워크스페이스 멤버 검색"
shareDialog.addButton                       "부여"
shareDialog.role.viewer                     "보기"
shareDialog.role.commenter                  "댓글"
shareDialog.role.editor                     "편집"
shareDialog.removeMember                    "권한 회수"
shareDialog.webShareToggle                  "웹에서 공유"
shareDialog.webShareCopy                    "복사"
shareDialog.webShareCopied                  "복사됨"
shareDialog.webShareRevoke                  "링크 폐기"
shareDialog.webShareCreatedBy               "생성: {name} · {date}"
shareDialog.viewOnlyBanner                  "보기 전용으로 공유됨"
shareDialog.notWorkspaceMember              "워크스페이스 멤버만 부여할 수 있습니다"

publicShare.viewOnly                        "보기 전용"
publicShare.sharedBy                        "OpenCairn에서 공유된 페이지"
publicShare.signInCta                       "OpenCairn 시작하기"
publicShare.notFound                        "이 링크는 만료되었거나 폐기되었습니다"

workspaceSettings.sharedLinks.heading       "공유 링크"
workspaceSettings.sharedLinks.empty         "활성 공유 링크가 없습니다"
workspaceSettings.sharedLinks.headerNote    "노트"
workspaceSettings.sharedLinks.headerRole    "권한"
workspaceSettings.sharedLinks.headerCreatedBy "생성자"
workspaceSettings.sharedLinks.headerCreatedAt "생성일"
workspaceSettings.sharedLinks.revoke        "폐기"

workspaceSettings.tabs.sharedLinks          "공유 링크"  (이미 있을 수 있음 — 확인)
```

**카피 규칙 준수**: 존댓말 · 경쟁사 직접 미언급 · 기술 스택 미언급 (`feedback_opencairn_copy.md`).

## 9. Testing Strategy

### Backend (apps/api/tests, vitest + 실 DB)

**신규 파일**:
- `tests/share-links.test.ts` — POST/GET/DELETE/public, 권한 매트릭스, idempotency (같은 role 재호출 시 동일 토큰), revoke 후 404, deleted note → 404, role 변경 시 새 토큰
- `tests/note-permissions.test.ts` — POST/PATCH/DELETE, 워크스페이스 멤버 검증 (외부 user reject), `share_invite` 알림 발화 + payload, 자기 자신 skip, role 미변경 시 알림 미발화
- `tests/comment-reply-notification.test.ts` — 답글 시 부모 author 알림, self-reply skip, parentId NULL이면 미발화, mention + comment_reply 동시 발화 가능
- `tests/internal-research-finalize.test.ts` — completed/failed/cancelled 분기, completed만 알림, 자기 자신만 발화, 중복 finalize 호출 시 알림 1회만 (멱등)

**기존 파일 확장**:
- `tests/comments.test.ts` — comment_reply 기본 케이스 추가 (기존 mention 패턴 재사용)
- `tests/notifications.test.ts` — 새 4 종 kind에 대한 GET/PATCH read 동작

**픽스처**: 기존 `tests/setup.ts` + `lib/test-seed-multi.ts` 재사용 (워크스페이스 + 멤버 2명 + 노트 1개).

### Worker (apps/worker/tests, pytest)

**신규 파일**:
- `tests/activities/deep_research/test_finalize.py` — `FinalizeInput` shape, retry 정책, API mock으로 PATCH 호출 검증, 모든 status 분기

**기존 파일 확장**:
- `tests/workflows/test_deep_research_workflow.py` — happy/cancel/failed 모두에서 `finalize_deep_research` 정확히 1회 호출

### Frontend (apps/web, vitest + JSDOM)

**신규 파일**:
- `tests/components/share-dialog.test.tsx` — toggle / copy / revoke / role 변경, 멤버 검색 디바운스, mutation
- `tests/components/notification-item.test.tsx` — 4 종 kind 라벨 + summary + 클릭 라우팅
- `tests/components/shared-links-tab.test.tsx` — 목록 + revoke
- `tests/components/plate-static-renderer.test.tsx` — Plate value → DOM 정합성, 편집 비활성

**E2E (Playwright)**: 후속 follow-up. 비인증 페이지 + ShareDialog 흐름을 묶은 spec 1개 정도 가치 있으나 dev server 병렬 이슈로 deferred (Plan 9b 전 풀 셋업 시).

### i18n parity

```bash
pnpm --filter @opencairn/web i18n:parity
```

CI gate. 신규 키 모두 ko/en 동시 추가.

### 커버리지 목표

신규 코드 100%. 알림 silent-on-failure path는 `.catch(() => undefined)` 까지 검증 (mock으로 throw → 라우트는 200 응답).

## 10. File Changes Summary

### 신규

**Backend (apps/api)**
- `src/routes/share.ts` — share 라우트 + per-note 권한 (한 파일 통합 가능, 컴팩트하면)
- `src/lib/yjs-to-plate.ts` — Y.Doc binary state → Plate value
- `src/lib/share-token.ts` — 토큰 생성/검증 헬퍼
- `tests/share-links.test.ts`
- `tests/note-permissions.test.ts`
- `tests/comment-reply-notification.test.ts`
- `tests/internal-research-finalize.test.ts`

**DB (packages/db)**
- `src/schema/share-links.ts`
- `migrations/0026_share_links.sql` (Drizzle generate; 머지 시점 충돌 시 재번호)

**Worker (apps/worker)**
- `src/worker/activities/deep_research/finalize.py`
- `tests/activities/deep_research/test_finalize.py`

**Web (apps/web)**
- `src/components/share/share-dialog.tsx`
- `src/components/share/plate-static-renderer.tsx`
- `src/components/share/public-note-view.tsx`
- `src/app/[locale]/s/[token]/page.tsx`
- `src/app/[locale]/s/[token]/not-found.tsx`
- `tests/components/share-dialog.test.tsx`
- `tests/components/notification-item.test.tsx`
- `tests/components/shared-links-tab.test.tsx`
- `tests/components/plate-static-renderer.test.tsx`

### 수정

**Backend**
- `src/routes/comments.ts` — comment_reply 발화
- `src/routes/internal.ts` — `PATCH /internal/research/runs/:id/finalize` 추가
- `src/lib/notification-events.ts` — payload shape docblock 갱신
- `src/app.ts` — shareRouter 등록 + `/api/public/*` 인증 앞에 마운트
- `src/middleware/auth.ts` (또는 동등) — `/api/public/*` 인증 제외 확인

**DB**
- `src/schema/index.ts` — export 추가

**Worker**
- `src/worker/workflows/deep_research_workflow.py` — try/except 3 경로에 finalize 호출
- `src/worker/activities/deep_research/__init__.py` — finalize export
- `src/worker/__init__.py` (worker registration) — `finalize_deep_research` 등록
- `tests/workflows/test_deep_research_workflow.py` — 확장

**Web**
- `src/components/notifications/notification-item.tsx` — 4 종 분기
- `src/components/views/workspace-settings/shared-links-tab.tsx` — stub 채우기
- `src/components/views/note/...editor-header...` — Share 버튼 추가 (정확한 파일은 grep)
- `src/lib/api-client.ts` — `shareApi`, `notePermissionsApi`, `wsSettingsApi.sharedLinks` 추가
- `middleware.ts` — `/s/*` 인증 패스스루
- `messages/ko/*.json`, `messages/en/*.json` — 신규 키 (parity)

## 11. Implementation Order (subagent-driven 분리 가능 지점)

순차 의존성:

1. **DB foundation** (단일):
   - share-links 스키마 + 마이그레이션 + index export

2. **Backend foundation** (DB 후 순차):
   - share.ts 라우트 (TDD: tests 먼저)
   - per-note permissions (TDD)
   - comment_reply wiring (TDD)
   - internal finalize 라우트 (TDD)

3. **Worker** (Backend foundation 완료 후):
   - finalize.py 액티비티 (pytest)
   - workflow 수정 (pytest)

4. **Frontend** (Backend 완료 후 **병렬 가능 3 trk**):
   - 4-A: ShareDialog + PlateStaticRenderer + /s/[token] 페이지 (가장 큰 trk)
   - 4-B: SharedLinksTab fill-in
   - 4-C: NotificationItem 4 종 분기 + i18n 키 동기화

5. **Verification**:
   - `pnpm --filter @opencairn/api run test`
   - `pnpm --filter @opencairn/web run test`
   - `pytest apps/worker`
   - `pnpm --filter @opencairn/web i18n:parity`
   - manual smoke: ShareDialog → 토큰 발급 → 비인증 브라우저로 `/s/<token>` 접근 → revoke → 404

## 12. Risks

| 리스크 | 영향 | 완화 |
|--------|------|------|
| Yjs → Plate 변환 정합성 | 라이브 에디터와 정적 렌더가 다르면 사용자 혼란 | PlateStatic + Y.Doc decode 둘 다 같은 plugin set 강제, plate-static-renderer 단독 테스트로 element 렌더 1:1 검증 |
| 마이그레이션 번호 충돌 | plan-7-phase-2 머지 전후 충돌 | reviewer 확인 + 0024↔0025 재번호 선례 (`project_plan7_phase2_complete.md`) 따라 처리 |
| Share token referer leak | 외부 사이트로 referer 보내질 때 토큰 노출 | 공유 페이지에 `<meta name="referrer" content="no-referrer">` 강제 |
| research_complete 중복 발화 | workflow retry 5회로 finalize 중복 호출 가능 | finalize에서 `completedAt IS NOT NULL` 체크 후 알림 skip + 응답에 `alreadyFinalized: true` |
| 워크스페이스 멤버 검색 권한 누설 | search 결과로 비활성 멤버나 다른 워크스페이스 유저 노출 | `requireWorkspaceRole("member")` 게이트 + workspace_members JOIN으로 명시적 scope |
| ShareDialog 권한 매트릭스 복잡도 | viewer/commenter/editor + 워크스페이스 owner/admin/member/guest 곱집합 | 권한 체크는 백엔드만, 프론트는 `canWrite` boolean으로 단순화 |

## 13. Definition of Done

- [ ] `share_links` 테이블 + 마이그레이션 적용
- [ ] 신규 라우트 4개 (POST/GET/DELETE share, public GET) + per-note 권한 4개 + finalize 1개 모두 구현 + 테스트 통과
- [ ] worker finalize 액티비티 + workflow 3 경로 + pytest 통과
- [ ] ShareDialog (Invite + Web) UI 동작 + 멤버 검색 + role 부여/회수
- [ ] `/s/[token]` 비인증 페이지 SSR 렌더 + Y.Doc → Plate 변환 정상
- [ ] SharedLinksTab 채워짐 + revoke 동작
- [ ] NotificationItem 4 종 분기 + i18n parity 통과
- [ ] manual smoke: 발급 → 비인증 접근 → revoke → 404 + comment_reply / share_invite / research_complete 알림 드로어에 표시
- [ ] `apps/api`, `apps/web`, `apps/worker` 테스트 모두 통과
- [ ] PR 본문에 알림 payload schema + Notion 모델 채택 결정 명시

## 14. Follow-ups (이번 plan 밖)

1. 공유 페이지 `editor` role 활성화 — Hocuspocus 비인증 read 확장
2. 공유 페이지 라이브 동기화 (Yjs subscribe)
3. 공유 링크 만료 / 비밀번호 (사용자 요구 시)
4. 공유 링크 SEO opt-in 토글 (indexable robots) — Pro 플랜 게이트
5. 외부 이메일로 페이지별 게스트 초대 (워크스페이스 invite 통합 흐름)
6. 이메일 알림 + 선호도 UI — Plan 2 Task 14
7. `system` 알림 발송 — Super Admin Console
8. Playwright E2E (share + notification 흐름)
