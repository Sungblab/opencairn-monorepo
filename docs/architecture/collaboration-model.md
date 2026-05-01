# Collaboration Model

OpenCairn의 협업 시스템 캐논 문서. 워크스페이스 경계, 권한 계층, 실시간 편집, 코멘트, @mention, 알림, 프레즌스, 공개 공유, 게스트 — 협업과 관련된 **모든** 설계 결정을 한 곳에서 정의한다. 다른 문서는 이 문서를 참조만 하고 중복 정의하지 않는다.

---

## 1. Design Principles

1. **Workspace가 격리 경계.** 내 개인 워크스페이스와 회사 워크스페이스의 데이터는 절대 섞이지 않는다. 에이전트, 검색, KG, LightRAG 인덱스, Hocuspocus 채널, 알림 전부 workspace 스코프.
2. **Project는 조직 단위.** Workspace 안에서 Notion 페이지처럼 프로젝트가 나뉜다. 기본은 프로젝트 간 격리되지만 Connector Agent가 연결을 제안한다 (같은 workspace 내에서만).
3. **Page-level override.** 프로젝트 전체 공개이지만 특정 페이지는 비공개로 둘 수 있다 (Notion 방식).
4. **Permission-checking은 데이터 레이어 경유.** 모든 read/write 쿼리는 `canRead` / `canWrite` 헬퍼를 거친다. API route 미들웨어만으로는 부족하다 (에이전트·웹훅·내부 호출도 경유해야 함).
5. **CRDT는 최상위 기술.** Yjs가 Notion의 OT보다 우월하다. 충돌·재연결·"다시 로드..." 화면이 없다. 협업 UX의 핵심 경쟁력이다.
6. **AGPLv3 + 셀프호스트가 구조적 차별화.** 규제 산업(금융·의료·공공·대학·법무)이 Notion 못 쓰는 이유를 OpenCairn이 해결한다. 협업 기능은 이 약속을 지키기 위한 table stakes.

---

## 2. Data Model

### 2.1 Top-level hierarchy

```
User (Better Auth)
  └── WorkspaceMembership (M:N)
Workspace
  ├── WorkspaceMember (role)
  ├── WorkspaceInvite (pending)
  ├── Project
  │    ├── ProjectPermission (user or group → role, overrides workspace default)
  │    ├── Folder
  │    └── Note (= page)
  │         └── PagePermission (user → role, overrides project default)
```

### 2.2 Core tables

```sql
-- 격리 경계
workspaces
  id              uuid PK
  slug            text UNIQUE (URL용, 예: "acme-corp")
  name            text
  owner_id        text FK → users.id (Better Auth users.id는 text)
  plan_type       enum (free, pro, enterprise)      -- workspace-level plan
  created_at      timestamptz
  updated_at      timestamptz

-- 멤버십
workspace_members
  workspace_id    uuid FK → workspaces.id ON DELETE CASCADE
  user_id         text FK → users.id ON DELETE CASCADE
  role            enum (owner, admin, member, guest)
  invited_by      text FK → users.id NULLABLE
  joined_at       timestamptz
  PRIMARY KEY (workspace_id, user_id)

-- 초대 (수락 전)
workspace_invites
  id              uuid PK
  workspace_id    uuid FK → workspaces.id ON DELETE CASCADE
  email           text NOT NULL
  role            enum (admin, member, guest)
  token           text UNIQUE NOT NULL           -- URL-safe random, 32+ bytes
  invited_by      text FK → users.id
  expires_at      timestamptz NOT NULL           -- 기본 7일
  accepted_at     timestamptz NULLABLE
  created_at      timestamptz

-- Project-level 권한 override (기본은 workspace role 상속)
project_permissions
  id              uuid PK
  project_id      uuid FK → projects.id ON DELETE CASCADE
  user_id         text FK → users.id NULLABLE    -- null이면 group
  group_id        uuid FK → workspace_groups.id NULLABLE  -- v0.2: 팀 단위 권한
  role            enum (editor, viewer)
  granted_by      text FK → users.id
  created_at      timestamptz
  UNIQUE (project_id, user_id) WHERE user_id IS NOT NULL
  UNIQUE (project_id, group_id) WHERE group_id IS NOT NULL

-- Page-level 권한 override (특정 페이지만 다르게)
page_permissions
  id              uuid PK
  page_id         uuid FK → notes.id ON DELETE CASCADE
  user_id         text FK → users.id NULLABLE
  role            enum (editor, viewer, none)    -- 'none'으로 명시적 접근 차단
  granted_by      text FK → users.id
  created_at      timestamptz
  UNIQUE (page_id, user_id)

-- 프로젝트·노트에 workspace_id 컬럼 추가 (index 필수)
-- projects ADD COLUMN workspace_id uuid NOT NULL
-- projects DROP COLUMN user_id   -- owner는 workspace_members에서 resolve
-- notes ADD COLUMN workspace_id uuid NOT NULL  (denormalized for query speed)
```

### 2.3 Comments & @mentions

```sql
comments
  id              uuid PK
  workspace_id    uuid FK → workspaces.id      -- denormalized for scoping
  note_id         uuid FK → notes.id ON DELETE CASCADE
  parent_id       uuid FK → comments.id NULLABLE  -- thread
  anchor_block_id text NULLABLE                -- Plate block ID (null이면 page-level)
  author_id       text FK → users.id
  body            text NOT NULL                -- markdown, mentions as @[user:{id}]
  body_ast        jsonb NULLABLE               -- 파싱된 mention 배열 캐시
  resolved_at     timestamptz NULLABLE
  resolved_by     text FK → users.id NULLABLE
  created_at      timestamptz
  updated_at      timestamptz

-- @mention에 의해 생성되는 관계 (알림 대상 식별용)
comment_mentions
  comment_id      uuid FK → comments.id ON DELETE CASCADE
  mentioned_type  enum (user, page, concept)
  mentioned_id    text NOT NULL                -- user_id, note_id, concept_id
  PRIMARY KEY (comment_id, mentioned_type, mentioned_id)
```

### 2.4 Notifications

```sql
notifications
  id              uuid PK
  recipient_id    text FK → users.id
  workspace_id    uuid FK → workspaces.id
  type            enum (mention, comment_reply, invite, share, wiki_change,
                        librarian_suggestion, synthesis_insight, stale_alert,
                        permission_granted, review_reminder)
  payload         jsonb NOT NULL               -- 타입별 구조, Zod 스키마 검증
  batch_key       text NULLABLE                -- 동일 key는 N분 내 묶임
  read_at         timestamptz NULLABLE
  emailed_at      timestamptz NULLABLE
  created_at      timestamptz
  INDEX (recipient_id, read_at) WHERE read_at IS NULL

notification_preferences
  user_id         text FK → users.id
  type            text NOT NULL
  channel_inapp   boolean DEFAULT true
  channel_email   boolean DEFAULT true
  frequency       enum (instant, hourly_digest, daily_digest, off) DEFAULT 'instant'
  PRIMARY KEY (user_id, type)
```

### 2.5 Activity log (wiki_logs 확장)

기존 `wiki_logs`에 comment/share/permission 이벤트까지 통합:

```sql
-- wiki_logs 리네이밍: activity_events
activity_events
  id              uuid PK
  workspace_id    uuid FK → workspaces.id
  actor_id        text FK → users.id            -- AI면 agent 이름
  actor_type      enum (user, agent)
  verb            enum (
    -- note
    created, updated, deleted, restored,
    -- wiki (기존 wiki_logs)
    wiki_created, wiki_updated, wiki_merged, wiki_linked, wiki_unlinked,
    -- collab
    commented, comment_resolved,
    invited, joined, role_changed, removed,
    shared_public, share_revoked,
    permission_granted, permission_revoked
  )
  object_type     enum (note, project, workspace, comment, invite, link)
  object_id       text NOT NULL
  diff            jsonb NULLABLE                -- 변경 내용
  reason          text NULLABLE                 -- AI가 왜 그랬는지
  created_at      timestamptz
  INDEX (workspace_id, created_at DESC)
  INDEX (actor_id, created_at DESC)
  INDEX (object_type, object_id, created_at DESC)
```

### 2.6 Public share links

```sql
public_share_links
  id              uuid PK
  workspace_id    uuid FK → workspaces.id
  scope_type      enum (note, project)
  scope_id        text NOT NULL                 -- note_id or project_id
  token           text UNIQUE NOT NULL          -- URL용 slug
  role            enum (viewer, commenter)      -- 공개 링크는 editor 금지 (보안)
  password_hash   text NULLABLE                 -- 선택적 암호 보호 (bcrypt)
  expires_at      timestamptz NULLABLE
  created_by      text FK → users.id
  created_at      timestamptz
  revoked_at      timestamptz NULLABLE
```

---

## 3. Role & Permission Model

### 3.1 Workspace roles

| Role | 권한 |
|------|------|
| **Owner** | 모든 권한. workspace 삭제, billing, owner 이전 가능. 1명만 (이전 시 교체) |
| **Admin** | 멤버 초대·제거·역할 변경, 프로젝트 생성·삭제, 설정 변경. owner 이전만 못 함 |
| **Member** | 프로젝트 생성, 자신이 만든 프로젝트 관리, 공개된 프로젝트 읽기·편집 |
| **Guest** | 명시적으로 공유된 페이지만 접근. 자기 계정 생성 없음, 초대받은 이메일만 |

### 3.2 Project roles (workspace role 위에 override)

| Role | 권한 |
|------|------|
| **Editor** | 프로젝트 노트 생성·편집·삭제, 공유, 코멘트 |
| **Viewer** | 읽기, 코멘트만 |

### 3.3 Page roles (project role 위에 override, Notion과 동일 유연성)

동일 타입 + `none` 추가 (명시적 차단)

### 3.4 Resolve 순서

```
function resolveRole(user, page) {
  // 0. Soft-deleted는 존재하지 않는 것으로 취급
  //    apps/api/src/lib/permissions.ts 의 lookup은
  //    `isNull(notes.deletedAt)` 필터를 붙이므로 row 자체가 돌아오지 않아 'none'.
  //    즉 삭제된 노트는 복구 전까지 어떤 role도 상속하지 않는다.
  if (page === null /* lookup failed or deletedAt IS NOT NULL */) return 'none'
  // 1. 페이지별 override
  if (page_permissions has row for (page, user)) return that.role
  // 2. 페이지가 상속 거부면 — 여기서 끝 (아무 권한 없음)
  if (page.inherit_parent === false) return 'none'
  // 3. 프로젝트 override
  if (project_permissions has row for (project, user or user's group)) return that.role
  // 4. Workspace role에서 매핑
  const wsRole = workspace_members.role
  if (wsRole in ('owner','admin')) return 'editor'
  if (wsRole === 'member') return projectDefaultRole  // 프로젝트 생성자 설정
  if (wsRole === 'guest') return 'none'  // 명시적 공유 없으면 접근 불가
}
```

### 3.5 Agent scoping

에이전트(Compiler/Research/Synthesis 등)도 권한 시스템을 따른다:

- 에이전트 activity의 `workspace_id` 파라미터 필수
- Connector Agent는 **같은 workspace 내 다른 project**만 연결 (workspace 경계 절대 불침투)
- 모든 에이전트 행동은 `activity_events`에 `actor_type='agent'`로 기록 (감시 가능성)

**권한 상속 규칙** (혼동 방지를 위해 명시):

| 트리거 유형 | 예시 에이전트 | 적용 권한 | 근거 |
|-------------|--------------|-----------|------|
| **사용자 트리거** (chat, 명시적 호출) | Research, Code, Compiler(업로드 직후), Deep Research | 트리거한 사용자의 `resolveRole` 결과 그대로 적용. **권한 상승 금지.** 사용자가 못 읽는 페이지는 에이전트도 못 읽음. | 사용자가 출력 결과의 책임 주체. PAYG 차감도 사용자 |
| **자동 스케줄** (cron, idle trigger, 워크스페이스 이벤트 반응) | Librarian, Curator, Visualization (백그라운드), Synthesis (주기적) | **workspace owner 권한**으로 실행. 단 모든 쓰기는 `actor_type='agent'`로 감시 로그 + activity feed에 표시. | 자동 에이전트는 워크스페이스 전체 일관성 유지가 목적 (위키 정리, 중복 감지 등) — owner 시점이 자연스러움 |

**경계 케이스:**

- **사용자 트리거 → 자동 후속 작업**: Research가 사용자 트리거로 실행되다가 결과를 위키에 반영하기 위해 Compiler를 후속 호출하는 경우, 후속도 **트리거한 사용자 권한 유지** (체인 전체 단일 권한 컨텍스트).
- **자동 트리거 → 사용자 알림**: Librarian이 owner 권한으로 중복 페이지 발견 → 알림은 페이지 `viewer`+ 권한 가진 사용자에게만 전송 (collaboration-model §7).
- **Guest 사용자 트리거**: Guest가 명시적으로 공유받은 페이지 안에서 채팅 트리거 시 Guest의 좁은 권한 그대로 적용. Guest 권한으로 못 읽는 다른 페이지/프로젝트는 검색 결과에서도 제외.

---

## 4. Real-Time Collaboration (Hocuspocus)

### 4.1 Auth hook

모든 Hocuspocus 연결은 Better Auth 세션 토큰 + 페이지 권한 검증 경유:

```typescript
// apps/hocuspocus/src/auth.ts
import type { onAuthenticatePayload } from "@hocuspocus/server";

export async function authenticateConnection({
  documentName,       // "page:<uuid>"
  token,              // better_auth session cookie
  requestParameters,
}: onAuthenticatePayload) {
  const session = await betterAuth.verifySession(token);
  if (!session) throw new Error("Unauthenticated");

  const pageId = documentName.replace(/^page:/, "");
  const role = await resolveRole(session.userId, pageId);

  if (role === "none" || role === "viewer") {
    // viewer는 WebSocket 연결은 허용하되 server-side에서 모든 update를 reject
    return { userId: session.userId, readOnly: true };
  }
  if (role === "editor" || role === "commenter") {
    return { userId: session.userId, readOnly: false };
  }
  throw new Error("Forbidden");
}
```

### 4.2 Document naming

- Yjs 문서 이름 = `page:<note_id>` (note 하나 = Yjs doc 하나)
- Workspace/Project 레벨 broadcast는 별도 채널: `workspace:<id>:presence`

### 4.3 Presence (Awareness)

Hocuspocus Awareness 프로토콜로 다음 전파:
- `user`: `{ id, name, avatarUrl, color }`
- `cursor`: Plate selection range
- `viewing`: 현재 활성 블록 ID (스크롤 위치 기반)

클라이언트는 동일 문서에 연결된 다른 사용자 목록을 실시간 수신 → 아바타 스택 + 인라인 커서 렌더.

### 4.4 Read-only 강제

viewer는 WebSocket은 열리지만 Yjs update message를 서버가 drop. Hocuspocus `onChange` hook에서 `readOnly === true`면 `throw` 해서 broadcast 차단. 클라이언트는 `readOnly` 플래그 받으면 Plate 에디터를 `readOnly` 모드로.

---

## 5. Comments

### 5.1 UX 모델

- **Page-level**: 페이지 사이드 패널에 스레드 (anchor_block_id = null)
- **Block-level**: 블록 옆 작은 말풍선 아이콘, 클릭 시 스레드 확장
- **Threading**: parent_id로 reply chain
- **Resolve**: 저자·편집자가 resolved_at 설정, 해결된 스레드는 기본 숨김

### 5.2 Plate 통합

- Plate 커스텀 플러그인 `comments-plugin`:
  - 블록 hover 시 "💬 add comment" 버튼
  - 블록에 연결된 코멘트 수 뱃지
  - 블록 삭제 시 코멘트는 **보존**하되 `anchor_block_id = null`로 페이지 코멘트로 강등

### 5.3 Permissions

- 코멘트 조회: 페이지 `viewer` 이상
- 코멘트 작성: 페이지 `commenter` 이상 (workspace `member` 이상의 기본 권한)
- 코멘트 수정: 본인 작성만
- 코멘트 삭제: 본인 + 페이지 `editor` 이상
- Resolve: 페이지 `editor` + 스레드 참여자

---

## 6. @Mentions

### 6.1 파서 (Plate 플러그인)

```
@[user:550e8400]        → 사용자 멘션
@[page:abc123]          → 페이지 링크
@[concept:transformer]  → 개념(KG 노드) 링크
@[date:2026-04-20]      → 날짜 리마인더
```

### 6.2 Resolver

- 타이핑 시 `@` 입력하면 combobox:
  - 현재 workspace 멤버 (user)
  - 최근 편집한 페이지 (page)
  - 현재 프로젝트의 관련 개념 (concept, 벡터 검색)
- 선택하면 serialized 형태 저장 + 렌더 시 preview 카드

### 6.3 알림 트리거

저장 시 `comment_mentions` insert → notification worker가:
- user mention → `notifications (type='mention')` 행 생성
- page mention → 페이지 구독자에게 `wiki_change` 알림 (옵션)
- date mention → Temporal schedule에 등록 (리마인더)

---

## 7. Notifications

### 7.1 전달 채널

| 채널 | 구현 | 지연 |
|------|------|------|
| **In-app 뱃지** | 상단 바 뱃지 + 드롭다운. `notifications` 테이블 polling(30s) 또는 SSE stream | 즉시~30s |
| **Email** | Resend (Plan 1 설정), 사용자 선호도에 따라 instant / hourly / daily digest | ≤1h |
| **Webhook (v0.2)** | Slack / Discord / 커스텀 | 즉시 |

### 7.2 Batching

- `batch_key` 같은 알림은 5분 내 합쳐짐 ("3개 새 코멘트" 식)
- 키 예시: `comments:page:<id>`, `invites:ws:<id>`, `wiki_changes:project:<id>`

### 7.3 선호도 UI

설정 페이지에서 타입 × 채널 × 빈도 매트릭스 편집. 기본값은 "instant + in-app + email".

### 7.4 Deep linking

이메일 알림의 링크는 deep link: `/workspace/<ws>/project/<proj>/note/<note>?commentId=<c>&focus=true` → 브라우저가 해당 코멘트까지 스크롤 + 하이라이트.

---

## 8. Public Share Links

### 8.1 플로우

1. 페이지/프로젝트 소유자가 "Share" → "Public link" 클릭
2. role 선택 (viewer | commenter), 선택적 암호, 선택적 만료
3. 토큰 생성 → URL 반환 (`/s/<token>`)
4. 방문자는 비로그인으로 접근 가능. 암호 있으면 먼저 입력.
5. 방문자는 guest session (쿠키) 부여 — 코멘트 작성 시 이름만 입력받아 "익명:홍길동" 형태로 기록

### 8.2 보안

- editor 권한은 공개 링크로 절대 부여 금지
- 토큰 32 bytes URL-safe random
- 페이지 삭제 시 cascade
- `revoked_at` 설정 시 즉시 거부
- Rate limit (per token): 분당 30 req

### 8.3 검색엔진 노출

- 기본: `<meta name="robots" content="noindex">` 주입
- 사용자 설정에서 "검색엔진에 노출" 옵션 (옵트인)

---

## 9. Guest Users

### 9.1 초대 플로우

1. Admin이 이메일로 guest 초대 + 특정 프로젝트/페이지 접근 권한 부여
2. 초대 이메일 수신 → 링크 클릭 → 간단 계정 생성 (이름 + 비밀번호 또는 OAuth)
3. 로그인 후 본인에게 공유된 리소스만 사이드바에 보임

### 9.2 경계

- Guest는 workspace 전체 목록, 멤버 목록 못 봄
- 본인에게 공유된 페이지/프로젝트 외 모든 리소스는 존재 자체를 숨김 (API 404 반환)
- Guest는 "다른 guest가 누구인지" 못 봄 (코멘트에서도 이메일 숨김, 이름만)
- Workspace plan에 guest 수 상한 (Free: 3명, Pro: 10명, Enterprise: 무제한)

---

## 10. Activity Feed

### 10.1 UI

- Workspace 수준 / Project 수준 / 개인 수준 3가지 뷰
- Twitter 타임라인 스타일: actor avatar + verb + object + timestamp
- AI 에이전트 활동도 구분 표시 (🤖 아이콘)

### 10.2 Example

```
👤 Sungbin created project "Thesis Research"          · 2h ago
🤖 Compiler created wiki page "Attention Mechanism"   · 1h ago
👤 Alice commented on "Transformer Architecture"      · 1h ago
🤖 Librarian suggested merging 2 duplicate pages       · 45m ago
👤 Bob @mentioned you in "RoPE explained"             · 20m ago
🤖 Synthesis found insight: "biology ↔ software"       · 10m ago
```

### 10.3 API

- `GET /api/activity?workspace=&project=&actor=&since=&limit=`
- Keyset pagination (cursor 기반)
- Rate limit per user

---

## 11. 권한 체크 구현 패턴

### 11.1 TypeScript helper (canonical)

```typescript
// apps/api/src/lib/permissions.ts
import { db } from "./db";
import type { UserRole, ResourceType } from "@opencairn/shared";

export type ResolvedRole = "owner" | "admin" | "editor" | "commenter" | "viewer" | "none";

/**
 * 단일 리소스에 대한 사용자 역할을 계산.
 * 모든 read/write 쿼리는 이것을 먼저 호출해야 한다.
 */
export async function resolveRole(
  userId: string,
  resource: { type: ResourceType; id: string }
): Promise<ResolvedRole> {
  // 1. Workspace 찾기 (resource에서 workspace_id 역추적)
  const wsId = await findWorkspaceId(resource);
  if (!wsId) return "none";

  // 2. Workspace membership 확인
  const membership = await db.query.workspaceMembers.findFirst({
    where: (m, { and, eq }) => and(eq(m.workspaceId, wsId), eq(m.userId, userId)),
  });
  if (!membership) return "none";

  if (membership.role === "owner") return "owner";
  if (membership.role === "admin") return "admin";

  // 3. Page-level override
  if (resource.type === "note") {
    const pagePerm = await db.query.pagePermissions.findFirst({
      where: (p, { and, eq }) => and(eq(p.pageId, resource.id), eq(p.userId, userId)),
    });
    if (pagePerm) return pagePerm.role;

    const note = await db.query.notes.findFirst({ where: (n, { eq }) => eq(n.id, resource.id) });
    if (note && note.inheritParent === false) return "none";
  }

  // 4. Project-level override
  const projectId = resource.type === "project" ? resource.id : await findProjectId(resource);
  if (projectId) {
    const projPerm = await db.query.projectPermissions.findFirst({
      where: (p, { and, eq }) => and(eq(p.projectId, projectId), eq(p.userId, userId)),
    });
    if (projPerm) return projPerm.role;
  }

  // 5. Workspace default
  if (membership.role === "member") return "editor";  // workspace 공개 프로젝트
  if (membership.role === "guest") return "none";     // 명시적 공유 필요
  return "none";
}

export async function canRead(userId: string, resource: { type: ResourceType; id: string }): Promise<boolean> {
  const role = await resolveRole(userId, resource);
  return role !== "none";
}

export async function canWrite(userId: string, resource: { type: ResourceType; id: string }): Promise<boolean> {
  const role = await resolveRole(userId, resource);
  return ["owner", "admin", "editor"].includes(role);
}

export async function canAdmin(userId: string, workspaceId: string): Promise<boolean> {
  const role = await resolveRole(userId, { type: "workspace", id: workspaceId });
  return role === "owner" || role === "admin";
}
```

### 11.2 쿼리 헬퍼

```typescript
// apps/api/src/lib/queries.ts
// 모든 Drizzle 쿼리는 이 헬퍼를 경유
export function userScoped<T>(
  userId: string,
  baseQuery: (db: Database) => T
) {
  // 사용자가 속한 workspace id 목록 서브쿼리를 모든 select에 주입
  // ...
}
```

### 11.3 Hono middleware

```typescript
// apps/api/src/middleware/require-role.ts
export function requireWorkspaceRole(minRole: "member" | "admin" | "owner") {
  return createMiddleware(async (c, next) => {
    const userId = c.get("userId");
    const wsId = c.req.param("workspaceId");
    const role = await resolveRole(userId, { type: "workspace", id: wsId });
    if (!rolePasses(role, minRole)) return c.json({ error: "Forbidden" }, 403);
    c.set("wsRole", role);
    await next();
  });
}
```

---

## 12. 위키(자동 생성 콘텐츠)의 협업 규칙

AI 에이전트가 자동 생성한 위키 페이지(`is_auto=true`)와 사용자 작성 콘텐츠 간 충돌 방지:

1. **사용자 수동 편집 = canonical** — 사용자가 수동 편집한 문단은 `is_auto=false`로 마킹. Compiler/Librarian이 덮어쓰기 금지.
2. **AI 변경 제안은 comment thread로** — Librarian이 위키에 직접 수정 대신 "이 섹션을 이렇게 고칠까요?" 제안 → 편집자가 승인/거절
3. **병합 충돌** — 2명이 동시에 같은 블록 편집 시 Yjs가 CRDT 병합. AI vs 사용자 충돌은 Librarian이 별도 comment로 표시.
4. **공동 편집 감사** — activity_events에 `actor_type='agent'` 명시. 사용자는 "이 문장을 AI가 썼나 내가 썼나"를 bullet histogram으로 시각적으로 구분 가능.

---

## 13. Free / Pro / Enterprise 플랜 차이

| 기능 | Free | Pro | Enterprise |
|------|------|-----|-----------|
| Workspace 수 | 1 | 3 | 무제한 |
| 멤버 수 | 3 | 15 | 무제한 |
| Guest 수 | 3 | 10 | 무제한 |
| 공개 링크 | 3개 | 무제한 | 무제한 + 암호·만료 |
| Activity log 보존 | 30일 | 1년 | 무제한 + export |
| SSO (SAML/OIDC) | - | - | ✓ |
| 감사 로그 Export | - | - | ✓ |
| Hocuspocus 연결 동시 제한 | 5 | 50 | 500 |

---

## 14. Chat Scope 권한 경계 (2026-04-20)

Agent Chat (Plan 11A)은 Workspace/Project/Page 3계층 scope를 따르며, 권한 모델과 다음과 같이 맞물린다:

| Scope | RAG 범위 | 참여자 |
|-------|---------|--------|
| Workspace chat | canRead 통과한 모든 workspace 문서 | workspace 멤버 |
| Project chat | canRead 통과한 project 내 문서 | project 권한 있는 사용자 |
| Page chat | 해당 page 내 블록 + 첨부 | page 권한 있는 사용자 |

- **Strict vs Expand**: Strict는 칩으로 붙인 범위만. Expand는 top-k 희박 시 workspace fallback (참여자 권한 체크 여전히 적용).
- **Pin**: 답변을 pin하면 conversation 스코프 외 사용자도 해당 답변 링크 공유 가능. 단 출처(citations)는 pin 당시 canRead 통과한 문서만 노출. 이후 권한 변경 시 출처는 자동 redact, "권한 변경됨" 경고.
- **상세**: [agent-chat-scope-design.md §6](../superpowers/specs/2026-04-20-agent-chat-scope-design.md).

---

## 15. 변경 이력

- 2026-04-18: 최초 작성. Workspace 계층 도입, 권한 모델, Hocuspocus auth hook, comments/mentions/notifications/presence 전체 캐논 정의.
- 2026-04-20: Chat scope 권한 경계 섹션 추가 (Plan 11A 연동, Strict/Expand/Pin + 권한 redact).
- 2026-04-22: **Plan 2B 구현**. `apps/hocuspocus` (Better Auth 세션 서명 직접 검증 + page 레벨 `resolveRole` → readOnly), `notes.content` / `content_text`는 Hocuspocus `onStoreDocument` 파생 스냅샷으로 전환 (API PATCH에서 `content` 제거 — Yjs canonical). `commenter` 역할이 `page_role` / `project_role` enum + `ResolvedRole`에 추가 (migration 0011), `canComment` 헬퍼 + `canWrite`는 commenter 제외 유지. 코멘트 DB 스키마 + CRUD + resolve + `@[type:id]` 멘션 파서 + `/api/mentions/search` + `comment_mentions` insert hook 출시 (Plan 2C 알림 dispatcher의 입력 큐). Readonly guard는 `beforeHandleMessage`가 아니라 `connectionConfig.readOnly` 경로로 enforce (전자는 읽기 핸드셰이크까지 끊음 — Task 14 smoke에서 확인). Notifications / share / guest / activity feed verb 확장은 **Plan 2C**로 이월.
