# Plan 7 Canvas Phase 1 — Web Runtime + Tab Mode Router 통합

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pyodide(WASM Python) + iframe sandbox(JS/HTML/React) 코드 실행 인프라를 web 측에 구현하고 App Shell Tab Mode Router 의 신규 `canvas` 모드로 통합한다. 서버는 코드를 한 줄도 실행하지 않는다 (ADR-006).

**Architecture:** `CanvasViewer` 가 Tab Mode Router 의 신규 `canvas` 모드를 처리, `notes.contentText` 를 소스로 로드, language 에 따라 `<PyodideRunner>` (Python) 또는 `<CanvasFrame>` (iframe sandbox JS/HTML/React) 으로 분기. 데이터는 `notes` 테이블에 sourceType='canvas' + canvasLanguage 컬럼으로 저장.

**Tech Stack:** Next.js 16 (App Shell), Hono 4, Drizzle ORM (Postgres pgEnum), Pyodide 0.27 (WASM, CDN 고정), esm.sh (런타임 ESM CDN), Better Auth, Zod, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-04-25-plan-7-canvas-phase-1-design.md`](../specs/2026-04-25-plan-7-canvas-phase-1-design.md)

**Worktree:** `.worktrees/canvas-phase-1` · **Branch:** `feat/plan-7-canvas-phase-1` · **Base:** main `7d4ae57`

---

## File Structure

```
packages/
├── db/
│   ├── src/schema/
│   │   ├── enums.ts                  # MOD: sourceTypeEnum + canvasLanguageEnum
│   │   └── notes.ts                  # MOD: canvasLanguage 컬럼
│   ├── drizzle/
│   │   ├── 0020_canvas_source_type_value.sql   # NEW
│   │   └── 0021_canvas_language_column.sql      # NEW
│   └── test/
│       └── canvas-constraint.test.ts            # NEW
└── shared/src/
    └── api-types.ts                  # MOD: schema 확장 + canvasLanguageSchema

apps/api/src/
└── routes/
    ├── notes.ts                      # MOD: POST 확장 + GET 응답 + PATCH /:id/canvas 추가
    └── notes.canvas.test.ts          # NEW (POST/GET 테스트)
    └── notes.canvas-patch.test.ts    # NEW (PATCH /:id/canvas 테스트)

apps/web/
├── messages/
│   ├── ko/canvas.json                # NEW
│   └── en/canvas.json                # NEW
├── next.config.ts                    # MOD: CSP headers
├── src/
│   ├── lib/
│   │   ├── pyodide-loader.ts         # NEW
│   │   └── __tests__/
│   │       └── pyodide-loader.test.ts # NEW
│   ├── components/
│   │   ├── canvas/                   # NEW (도메인 런타임)
│   │   │   ├── PyodideRunner.tsx
│   │   │   ├── CanvasFrame.tsx
│   │   │   ├── sandbox-html-template.ts
│   │   │   ├── useCanvasMessages.ts
│   │   │   └── __tests__/
│   │   │       ├── sandbox-html-template.test.ts
│   │   │       ├── useCanvasMessages.test.tsx
│   │   │       ├── CanvasFrame.test.tsx
│   │   │       └── PyodideRunner.test.tsx
│   │   └── tab-shell/
│   │       ├── tab-mode-router.tsx   # MOD: case 'canvas'
│   │       ├── tab-mode-router.test.tsx # MOD
│   │       └── viewers/
│   │           ├── canvas-viewer.tsx       # NEW
│   │           └── canvas-viewer.test.tsx  # NEW
│   ├── app/[locale]/canvas/demo/
│   │   └── page.tsx                  # NEW (standalone playground)
│   └── stores/tabs-store.ts          # MOD: 'canvas' 모드 + auto-detect
└── tests/e2e/
    └── canvas.spec.ts                # NEW (Playwright)

.github/
└── workflows/ci.yml                  # MOD: regression grep guards
```

---

### Task 1: DB schema 확장 + migrations + CHECK 제약

**Files:**
- Modify: `packages/db/src/schema/enums.ts`
- Modify: `packages/db/src/schema/notes.ts`
- Create: `packages/db/drizzle/0020_canvas_source_type_value.sql`
- Create: `packages/db/drizzle/0021_canvas_language_column.sql`
- Create: `packages/db/test/canvas-constraint.test.ts`
- Verify: `packages/db/drizzle/meta/_journal.json` (Drizzle 자동 생성)

> **Migration 번호 race**: Session A (App Shell Phase 4) 가 머지 먼저 되면 0020/0021 차지. 본 PR rebase 시 0022/0023 으로 rename + Drizzle journal 갱신. 충돌 패턴은 파일명 + journal entry 두 곳.

- [ ] **Step 1.1: 실패 테스트 작성**

`packages/db/test/canvas-constraint.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db, notes, projects, workspaces, users } from "../src";
import { eq } from "drizzle-orm";

describe("notes_canvas_language_check constraint", () => {
  let workspaceId: string;
  let projectId: string;
  let userId: string;

  beforeAll(async () => {
    // 테스트 fixture: 최소 user/workspace/project 생성 (기존 헬퍼 사용)
    const [u] = await db.insert(users).values({ email: "canvas-test@example.com" }).returning();
    userId = u.id;
    const [ws] = await db.insert(workspaces).values({ name: "Canvas Test", slug: `canvas-test-${Date.now()}`, ownerId: userId }).returning();
    workspaceId = ws.id;
    const [p] = await db.insert(projects).values({ name: "Test", workspaceId, createdBy: userId }).returning();
    projectId = p.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("rejects sourceType='canvas' with canvasLanguage=NULL", async () => {
    await expect(
      db.insert(notes).values({
        title: "Bad Canvas",
        projectId,
        workspaceId,
        sourceType: "canvas",
        canvasLanguage: null,
      })
    ).rejects.toThrow(/notes_canvas_language_check/);
  });

  it("accepts sourceType='canvas' + canvasLanguage='python'", async () => {
    const [row] = await db.insert(notes).values({
      title: "Good Canvas",
      projectId,
      workspaceId,
      sourceType: "canvas",
      canvasLanguage: "python",
      contentText: "print('hi')",
    }).returning();
    expect(row.canvasLanguage).toBe("python");
    await db.delete(notes).where(eq(notes.id, row.id));
  });

  it("accepts non-canvas notes with canvasLanguage=NULL (default)", async () => {
    const [row] = await db.insert(notes).values({
      title: "Plain Note",
      projectId,
      workspaceId,
    }).returning();
    expect(row.canvasLanguage).toBeNull();
    await db.delete(notes).where(eq(notes.id, row.id));
  });
});
```

- [ ] **Step 1.2: 테스트 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/db test -- canvas-constraint
# Expected: FAIL — column "canvas_language" does not exist
```

- [ ] **Step 1.3: enum + 컬럼 schema 수정**

`packages/db/src/schema/enums.ts`:

```diff
 export const sourceTypeEnum = pgEnum("source_type", [
   "manual",
   "pdf",
   "audio",
   "video",
   "image",
   "youtube",
   "web",
   "notion",
   "unknown",
+  "canvas",
 ]);
+
+// Plan 7 Canvas Phase 1. canvasLanguage IS NOT NULL ↔ sourceType='canvas'
+// (DB CHECK constraint in migration 0021).
+export const canvasLanguageEnum = pgEnum("canvas_language", [
+  "python",
+  "javascript",
+  "html",
+  "react",
+]);
```

`packages/db/src/schema/notes.ts`:

```diff
-import { noteTypeEnum, sourceTypeEnum } from "./enums";
+import { noteTypeEnum, sourceTypeEnum, canvasLanguageEnum } from "./enums";
 ...
     sourceType: sourceTypeEnum("source_type"),
+    canvasLanguage: canvasLanguageEnum("canvas_language"),
     sourceFileKey: text("source_file_key"),
```

- [ ] **Step 1.4: Drizzle migration 자동 생성 + 수동 분리**

```bash
pnpm --filter @opencairn/db generate
```

Drizzle 가 단일 migration 파일을 생성한다 (예: `0020_<random_slug>.sql`). PostgreSQL 의 `ALTER TYPE ... ADD VALUE` 트랜잭션 제약 때문에 **두 파일로 분리**해야 함.

생성된 파일을 삭제하고 다음 두 파일 수동 작성:

`packages/db/drizzle/0020_canvas_source_type_value.sql`:
```sql
ALTER TYPE "source_type" ADD VALUE 'canvas';
```

`packages/db/drizzle/0021_canvas_language_column.sql`:
```sql
CREATE TYPE "canvas_language" AS ENUM ('python', 'javascript', 'html', 'react');

ALTER TABLE "notes" ADD COLUMN "canvas_language" "canvas_language";

ALTER TABLE "notes" ADD CONSTRAINT "notes_canvas_language_check"
  CHECK (
    (source_type = 'canvas' AND canvas_language IS NOT NULL)
    OR (source_type IS NULL OR source_type <> 'canvas')
  );
```

`packages/db/drizzle/meta/_journal.json` 에 두 entry 추가 (Drizzle 자동 생성된 hash 그대로):
```json
{
  "idx": 20,
  "version": "7",
  "when": <epoch>,
  "tag": "0020_canvas_source_type_value",
  "breakpoints": true
},
{
  "idx": 21,
  "version": "7",
  "when": <epoch>,
  "tag": "0021_canvas_language_column",
  "breakpoints": true
}
```

`packages/db/drizzle/meta/0020_snapshot.json` + `0021_snapshot.json` 도 적절히 갱신 (Drizzle 자동 생성된 0020 snapshot 을 0021 로 rename, 0020 snapshot 은 enum 만 추가된 상태로 수동 작성).

> 실행자가 Drizzle snapshot 형식에 익숙하지 않으면: `pnpm db:generate` 결과의 snapshot 그대로 두고, SQL 파일만 분리 + journal idx 21 추가. snapshot 0020 은 0021 과 동일하게 둠 (불완전하지만 migrate 는 SQL 만 읽어서 동작함).

- [ ] **Step 1.5: Migration 적용**

```bash
pnpm --filter @opencairn/db migrate
# Expected: 0020 + 0021 적용 OK, 기존 row 영향 0
```

DB 재셋업 (dev 환경):
```bash
docker-compose down postgres
docker-compose up -d postgres
sleep 3
pnpm --filter @opencairn/db migrate
```

- [ ] **Step 1.6: 테스트 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/db test -- canvas-constraint
# Expected: 3/3 pass
```

- [ ] **Step 1.7: 전체 db 테스트 회귀 확인**

```bash
pnpm --filter @opencairn/db test
# Expected: 모든 기존 테스트 + 신규 3개 PASS
```

- [ ] **Step 1.8: Commit**

```bash
git add packages/db/src/schema/enums.ts \
        packages/db/src/schema/notes.ts \
        packages/db/drizzle/0020_canvas_source_type_value.sql \
        packages/db/drizzle/0021_canvas_language_column.sql \
        packages/db/drizzle/meta/ \
        packages/db/test/canvas-constraint.test.ts
git commit -m "feat(db): add canvas source type + canvasLanguage column with CHECK invariant"
```

---

### Task 2: Shared Zod 스키마 확장

**Files:**
- Modify: `packages/shared/src/api-types.ts`
- Test: `packages/shared/test/api-types.test.ts` (이미 존재 시 추가, 없으면 생성)

- [ ] **Step 2.1: 실패 테스트 작성**

`packages/shared/test/api-types.test.ts` (또는 등가):

```ts
import { describe, expect, it } from "vitest";
import {
  createNoteSchema,
  patchCanvasSchema,
  canvasLanguageSchema,
} from "../src/api-types";

describe("createNoteSchema (canvas extension)", () => {
  const baseValid = {
    projectId: "00000000-0000-0000-0000-000000000001",
  };

  it("rejects sourceType='canvas' without canvasLanguage", () => {
    const r = createNoteSchema.safeParse({ ...baseValid, sourceType: "canvas" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toContain("canvasLanguage");
  });

  it("accepts sourceType='canvas' + canvasLanguage='python'", () => {
    const r = createNoteSchema.safeParse({
      ...baseValid,
      sourceType: "canvas",
      canvasLanguage: "python",
      contentText: "print('hi')",
    });
    expect(r.success).toBe(true);
  });

  it("contentText > 64KB rejected", () => {
    const r = createNoteSchema.safeParse({
      ...baseValid,
      sourceType: "canvas",
      canvasLanguage: "python",
      contentText: "a".repeat(64 * 1024 + 1),
    });
    expect(r.success).toBe(false);
  });

  it("works without canvas fields (backward compat)", () => {
    const r = createNoteSchema.safeParse(baseValid);
    expect(r.success).toBe(true);
  });
});

describe("patchCanvasSchema", () => {
  it("accepts source + language", () => {
    const r = patchCanvasSchema.safeParse({ source: "x", language: "python" });
    expect(r.success).toBe(true);
  });

  it("source > 64KB rejected", () => {
    const r = patchCanvasSchema.safeParse({ source: "a".repeat(64 * 1024 + 1) });
    expect(r.success).toBe(false);
  });

  it("invalid language rejected", () => {
    const r = patchCanvasSchema.safeParse({ source: "x", language: "ruby" });
    expect(r.success).toBe(false);
  });
});

describe("canvasLanguageSchema", () => {
  it("accepts 4 known languages", () => {
    expect(canvasLanguageSchema.safeParse("python").success).toBe(true);
    expect(canvasLanguageSchema.safeParse("javascript").success).toBe(true);
    expect(canvasLanguageSchema.safeParse("html").success).toBe(true);
    expect(canvasLanguageSchema.safeParse("react").success).toBe(true);
  });
});
```

- [ ] **Step 2.2: 테스트 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/shared test -- api-types
# Expected: FAIL — patchCanvasSchema/canvasLanguageSchema not exported
```

- [ ] **Step 2.3: schema 확장**

`packages/shared/src/api-types.ts` 의 Notes 섹션 변경:

```diff
 // ── Notes ─────────────────────────────────────────────────────────────────────────
 const plateValueSchema = z.array(z.unknown()).nullable();

+const sourceTypeSchema = z.enum([
+  "manual", "pdf", "audio", "video", "image",
+  "youtube", "web", "notion", "unknown", "canvas",
+]);
+
+export const canvasLanguageSchema = z.enum([
+  "python", "javascript", "html", "react",
+]);
+
+const MAX_CANVAS_SOURCE_BYTES = 64 * 1024;
+
 export const createNoteSchema = z.object({
   projectId: z.string().uuid(),
   folderId: z.string().uuid().nullable().default(null),
   title: z.string().max(300).default("Untitled"),
   content: plateValueSchema.default(null),
   type: z.enum(["note", "wiki", "source"]).default("note"),
+  sourceType: sourceTypeSchema.optional(),
+  canvasLanguage: canvasLanguageSchema.optional(),
+  contentText: z.string().max(MAX_CANVAS_SOURCE_BYTES).optional(),
+}).refine(
+  d => d.sourceType !== "canvas" || d.canvasLanguage !== undefined,
+  { message: "canvasLanguage required when sourceType=canvas", path: ["canvasLanguage"] },
 });

 export const updateNoteSchema = z.object({
   title: z.string().max(300).optional(),
   content: plateValueSchema.optional(),
   folderId: z.string().uuid().nullable().optional(),
 });
+
+export const patchCanvasSchema = z.object({
+  source: z.string().max(MAX_CANVAS_SOURCE_BYTES),
+  language: canvasLanguageSchema.optional(),
+});
```

`packages/shared/src/index.ts` (또는 등가) 에 export 추가:

```diff
-export { createNoteSchema, updateNoteSchema } from "./api-types";
+export {
+  createNoteSchema,
+  updateNoteSchema,
+  patchCanvasSchema,
+  canvasLanguageSchema,
+} from "./api-types";
```

(이미 wildcard re-export 라면 step 생략)

- [ ] **Step 2.4: 테스트 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/shared test
# Expected: 모든 테스트 PASS (신규 + 기존)
```

- [ ] **Step 2.5: Commit**

```bash
git add packages/shared/src/api-types.ts \
        packages/shared/src/index.ts \
        packages/shared/test/api-types.test.ts
git commit -m "feat(shared): canvas Zod schemas (sourceType extension + canvasLanguage + patchCanvas)"
```

---

### Task 3: API — POST `/api/notes` 확장 + GET `/api/notes/:id` 응답 형태

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Create: `apps/api/test/routes/notes.canvas.test.ts`

- [ ] **Step 3.1: 실패 테스트 작성**

`apps/api/test/routes/notes.canvas.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { app } from "../../src/app";  // 기존 테스트 헬퍼 import 패턴 따름
import { setupTestUser, setupTestProject } from "../helpers";

describe("POST /api/notes (canvas)", () => {
  let token: string;
  let projectId: string;

  beforeAll(async () => {
    const u = await setupTestUser();
    token = u.token;
    projectId = (await setupTestProject(u.userId)).projectId;
  });

  it("rejects sourceType='canvas' without canvasLanguage (400)", async () => {
    const res = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `auth.session=${token}` },
      body: JSON.stringify({ projectId, title: "C", sourceType: "canvas" }),
    });
    expect(res.status).toBe(400);
  });

  it("creates canvas note (201) and GET returns canvasLanguage", async () => {
    const res = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `auth.session=${token}` },
      body: JSON.stringify({
        projectId,
        title: "Hello Canvas",
        sourceType: "canvas",
        canvasLanguage: "python",
        contentText: "print('hi')",
      }),
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.canvasLanguage).toBe("python");
    expect(created.sourceType).toBe("canvas");
    expect(created.contentText).toBe("print('hi')");

    // GET response includes canvasLanguage
    const getRes = await app.request(`/api/notes/${created.id}`, {
      headers: { cookie: `auth.session=${token}` },
    });
    expect(getRes.status).toBe(200);
    const got = await getRes.json();
    expect(got.canvasLanguage).toBe("python");
  });

  it("non-canvas note has canvasLanguage=null in GET", async () => {
    const post = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `auth.session=${token}` },
      body: JSON.stringify({ projectId, title: "Plain" }),
    });
    const created = await post.json();
    const getRes = await app.request(`/api/notes/${created.id}`, {
      headers: { cookie: `auth.session=${token}` },
    });
    const got = await getRes.json();
    expect(got.canvasLanguage).toBeNull();
  });
});
```

> 헬퍼 (`setupTestUser`, `setupTestProject`) 는 기존 `apps/api/test/helpers/` 또는 `apps/api/test/setup.ts` 에 정의된 패턴을 따른다. 기존 테스트 파일 (예: `apps/api/test/routes/notes.test.ts`) 의 헬퍼 호출을 그대로 복제.

- [ ] **Step 3.2: 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/api test -- notes.canvas
# Expected: FAIL — `Unrecognized option: 'sourceType'` 또는 등가
```

- [ ] **Step 3.3: 라우트 확장**

`apps/api/src/routes/notes.ts` POST 핸들러 변경 (createNoteSchema 가 이제 canvas 필드 받음 — Zod 가 알아서 검증):

POST 핸들러의 INSERT 부분 변경:

```diff
   const body = c.req.valid("json");
   ...
   const [note] = await db.insert(notes).values({
     projectId: body.projectId,
     workspaceId: project.workspaceId,
     folderId: body.folderId,
     title: body.title,
     content: body.content,
+    contentText: body.contentText ?? "",
     type: body.type,
+    sourceType: body.sourceType,
+    canvasLanguage: body.canvasLanguage,
   }).returning();

-  return c.json(note, 201);
+  return c.json({ ...note }, 201);  // canvasLanguage 자동 포함 (drizzle returns all columns)
```

GET `/:id` 핸들러는 별도 수정 불필요 — drizzle `.select()` 가 모든 컬럼 반환 (canvasLanguage 포함).

- [ ] **Step 3.4: 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/api test -- notes.canvas
# Expected: 3/3 pass
```

- [ ] **Step 3.5: 회귀 확인**

```bash
pnpm --filter @opencairn/api test
# Expected: 모든 기존 + 신규 PASS
```

- [ ] **Step 3.6: Commit**

```bash
git add apps/api/src/routes/notes.ts apps/api/test/routes/notes.canvas.test.ts
git commit -m "feat(api): POST/GET /api/notes accept and return canvas fields"
```

---

### Task 4: API — PATCH `/api/notes/:id/canvas` 신규 엔드포인트

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Create: `apps/api/test/routes/notes.canvas-patch.test.ts`

- [ ] **Step 4.1: 실패 테스트 작성**

`apps/api/test/routes/notes.canvas-patch.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { app } from "../../src/app";
import { setupTestUser, setupTestProject, setupReadOnlyUser } from "../helpers";

describe("PATCH /api/notes/:id/canvas", () => {
  let writerToken: string, readerToken: string;
  let projectId: string;
  let canvasId: string, plainId: string;

  beforeAll(async () => {
    const writer = await setupTestUser();
    writerToken = writer.token;
    const project = await setupTestProject(writer.userId);
    projectId = project.projectId;

    // canvas note
    const c = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `auth.session=${writerToken}` },
      body: JSON.stringify({
        projectId,
        title: "C",
        sourceType: "canvas",
        canvasLanguage: "python",
        contentText: "old",
      }),
    });
    canvasId = (await c.json()).id;

    // plain note
    const p = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `auth.session=${writerToken}` },
      body: JSON.stringify({ projectId, title: "P" }),
    });
    plainId = (await p.json()).id;

    // read-only user 권한 셋업 (기존 헬퍼 패턴)
    const reader = await setupReadOnlyUser(project.projectId);
    readerToken = reader.token;
  });

  it("200 + saves source + language for owner", async () => {
    const res = await app.request(`/api/notes/${canvasId}/canvas`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `auth.session=${writerToken}` },
      body: JSON.stringify({ source: "print('new')", language: "python" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contentText).toBe("print('new')");
    expect(body.canvasLanguage).toBe("python");
  });

  it("language omitted → 기존 값 유지", async () => {
    const res = await app.request(`/api/notes/${canvasId}/canvas`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `auth.session=${writerToken}` },
      body: JSON.stringify({ source: "console.log('x')" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canvasLanguage).toBe("python");  // 변경 안 됨
    expect(body.contentText).toBe("console.log('x')");
  });

  it("409 notCanvas for non-canvas note", async () => {
    const res = await app.request(`/api/notes/${plainId}/canvas`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `auth.session=${writerToken}` },
      body: JSON.stringify({ source: "x" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("notCanvas");
  });

  it("403 for read-only user", async () => {
    const res = await app.request(`/api/notes/${canvasId}/canvas`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `auth.session=${readerToken}` },
      body: JSON.stringify({ source: "hax" }),
    });
    expect(res.status).toBe(403);
  });

  it("404 for non-existent note", async () => {
    const res = await app.request(`/api/notes/00000000-0000-0000-0000-000000000000/canvas`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `auth.session=${writerToken}` },
      body: JSON.stringify({ source: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("413 for source > 64KB", async () => {
    const big = "a".repeat(64 * 1024 + 1);
    const res = await app.request(`/api/notes/${canvasId}/canvas`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `auth.session=${writerToken}` },
      body: JSON.stringify({ source: big }),
    });
    expect([400, 413]).toContain(res.status);  // Zod max → 400; Hono bodyLimit 도달 시 413
  });
});
```

- [ ] **Step 4.2: 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/api test -- notes.canvas-patch
# Expected: FAIL — 404 (라우트 없음)
```

- [ ] **Step 4.3: 라우트 추가**

`apps/api/src/routes/notes.ts` 에 신규 핸들러 추가 (`/:id` 라우트들 사이 적절한 위치):

```ts
import { patchCanvasSchema } from "@opencairn/shared";

// ... 기존 라우트들 ...

  .patch("/:id/canvas", zValidator("json", patchCanvasSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);

    // canRead 먼저 (404 vs 403 정보 누설 방지 — Phase 3-B 동일 패턴)
    if (!(await canRead(user.id, { type: "page", id }))) {
      return c.json({ error: "Not Found" }, 404);
    }

    const [note] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
    if (!note || note.deletedAt) return c.json({ error: "Not Found" }, 404);

    if (note.sourceType !== "canvas") {
      return c.json({ error: "notCanvas" }, 409);
    }

    if (!(await canWrite(user.id, { type: "page", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const body = c.req.valid("json");
    const [updated] = await db
      .update(notes)
      .set({
        contentText: body.source,
        ...(body.language !== undefined ? { canvasLanguage: body.language } : {}),
      })
      .where(eq(notes.id, id))
      .returning({
        id: notes.id,
        contentText: notes.contentText,
        canvasLanguage: notes.canvasLanguage,
        updatedAt: notes.updatedAt,
      });

    return c.json(updated, 200);
  })
```

> Hocuspocus 우회 (`yjs_documents` 갱신 안 함) — canvas 는 협업 안 함, 단일 사용자 모델. 기존 PATCH `/:id` 는 `content` 를 strip 하므로 자동으로 Hocuspocus 가 권위. canvas 는 별도 표면 → race condition 없음.

- [ ] **Step 4.4: 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/api test -- notes.canvas-patch
# Expected: 6/6 pass
```

- [ ] **Step 4.5: 전체 회귀**

```bash
pnpm --filter @opencairn/api test
# Expected: 모든 기존 + 신규 PASS
```

- [ ] **Step 4.6: Commit**

```bash
git add apps/api/src/routes/notes.ts apps/api/test/routes/notes.canvas-patch.test.ts
git commit -m "feat(api): PATCH /api/notes/:id/canvas dedicated write surface"
```

---

### Task 5: pyodide-loader

**Files:**
- Create: `apps/web/src/lib/pyodide-loader.ts`
- Create: `apps/web/src/lib/__tests__/pyodide-loader.test.ts`

- [ ] **Step 5.1: 실패 테스트 작성**

`apps/web/src/lib/__tests__/pyodide-loader.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadPyodide, PYODIDE_VERSION, PYODIDE_CDN } from "../pyodide-loader";

describe("pyodide-loader", () => {
  beforeEach(() => {
    // 매 테스트 전 DOM script 제거 + 글로벌 캐시 리셋
    document.head.innerHTML = "";
    // @ts-expect-error
    delete window.loadPyodide;
    // 모듈 캐시 리셋: dynamic import + vi.resetModules() 권장
    vi.resetModules();
  });

  it("PYODIDE_VERSION 은 숫자.숫자.숫자 형식 (floating tag 금지)", () => {
    expect(PYODIDE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("PYODIDE_CDN URL 에 PYODIDE_VERSION 이 포함", () => {
    expect(PYODIDE_CDN).toContain(`v${PYODIDE_VERSION}`);
    expect(PYODIDE_CDN).not.toContain("latest");
  });

  it("두 번 호출 시 동일 Promise (캐시)", async () => {
    // window.loadPyodide mock
    const mockPyodide = { runPythonAsync: vi.fn() };
    // @ts-expect-error
    window.loadPyodide = vi.fn().mockResolvedValue(mockPyodide);

    // script onload 시뮬레이션
    const origAppend = document.head.appendChild.bind(document.head);
    document.head.appendChild = ((node: any) => {
      const result = origAppend(node);
      if (node.tagName === "SCRIPT") setTimeout(() => node.onload?.(), 0);
      return result;
    }) as any;

    const { loadPyodide: load } = await import("../pyodide-loader");
    const p1 = load();
    const p2 = load();
    expect(p1).toBe(p2);
    await p1;
    // window.loadPyodide 가 한 번만 호출됨
    // @ts-expect-error
    expect(window.loadPyodide).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5.2: 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/web test -- pyodide-loader
# Expected: FAIL — Cannot find module '../pyodide-loader'
```

- [ ] **Step 5.3: 구현**

`apps/web/src/lib/pyodide-loader.ts`:

```ts
import type { PyodideInterface } from "pyodide";

export const PYODIDE_VERSION = "0.27.0";
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let _instance: Promise<PyodideInterface> | null = null;

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideInterface>;
  }
}

export function loadPyodide(): Promise<PyodideInterface> {
  if (_instance) return _instance;

  _instance = (async () => {
    if (!window.loadPyodide) {
      const script = document.createElement("script");
      script.src = `${PYODIDE_CDN}pyodide.js`;
      script.async = true;
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Pyodide script"));
        document.head.appendChild(script);
      });
    }
    if (!window.loadPyodide) {
      throw new Error("window.loadPyodide not injected after script load");
    }
    return window.loadPyodide({ indexURL: PYODIDE_CDN });
  })();

  return _instance;
}
```

> `pyodide` 타입 패키지가 없으면 `apps/web/package.json` 에 `"pyodide": "^0.27.0"` 또는 `"@types/pyodide"` 추가. 런타임은 CDN 으로 로드 — npm 패키지는 타입 전용이라 번들 크기 영향 없음.

- [ ] **Step 5.4: pyodide 타입 dependency 추가**

```bash
pnpm --filter @opencairn/web add -D pyodide@0.27.0
# 또는 단순 `add`. PyodideInterface 타입 import 용.
```

- [ ] **Step 5.5: 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/web test -- pyodide-loader
# Expected: 3/3 pass
```

- [ ] **Step 5.6: Commit**

```bash
git add apps/web/src/lib/pyodide-loader.ts \
        apps/web/src/lib/__tests__/pyodide-loader.test.ts \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): pyodide-loader (lazy load + cache, version pinned)"
```

---

### Task 6: sandbox-html-template (pure 함수)

**Files:**
- Create: `apps/web/src/components/canvas/sandbox-html-template.ts`
- Create: `apps/web/src/components/canvas/__tests__/sandbox-html-template.test.ts`

- [ ] **Step 6.1: 실패 테스트 작성**

`apps/web/src/components/canvas/__tests__/sandbox-html-template.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSandboxHTML } from "../sandbox-html-template";

describe("buildSandboxHTML", () => {
  it("HTML 모드는 입력을 그대로 반환", () => {
    const html = "<h1>hi</h1>";
    expect(buildSandboxHTML(html, "html")).toBe(html);
  });

  it("javascript 모드는 <script type=module> 로 래핑", () => {
    const out = buildSandboxHTML("console.log('x');", "javascript");
    expect(out).toContain('<script type="module">');
    expect(out).toContain("console.log('x');");
    expect(out).toContain('<div id="root"></div>');
  });

  it("react 모드는 esm.sh import map (react@19, react-dom@19/client) 포함", () => {
    const out = buildSandboxHTML("export default function App() { return null; }", "react");
    expect(out).toContain('"react": "https://esm.sh/react@19"');
    expect(out).toContain('"react-dom/client": "https://esm.sh/react-dom@19/client"');
    expect(out).toContain("createRoot");
  });

  it("react 모드는 floating 'latest' 태그 미포함", () => {
    const out = buildSandboxHTML("x", "react");
    expect(out).not.toMatch(/esm\.sh\/react@(?!19)/);
    expect(out).not.toContain("latest");
  });
});
```

- [ ] **Step 6.2: 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/web test -- sandbox-html-template
# Expected: FAIL — Cannot find module
```

- [ ] **Step 6.3: 구현**

`apps/web/src/components/canvas/sandbox-html-template.ts`:

```ts
export type CanvasIframeLanguage = "react" | "html" | "javascript";

export function buildSandboxHTML(userSource: string, language: CanvasIframeLanguage): string {
  if (language === "html") {
    return userSource;
  }

  if (language === "javascript") {
    return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
  <div id="root"></div>
  <script type="module">
${userSource}
  </script>
</body></html>`;
  }

  // react
  return `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <script type="importmap">
    {
      "imports": {
        "react": "https://esm.sh/react@19",
        "react-dom/client": "https://esm.sh/react-dom@19/client"
      }
    }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "react";
    import { createRoot } from "react-dom/client";
${userSource}
    const App = (typeof default_1 !== "undefined") ? default_1 : (typeof globalThis.App !== "undefined" ? globalThis.App : null);
    if (App) {
      createRoot(document.getElementById("root")).render(React.createElement(App));
    } else {
      document.getElementById("root").textContent = "No default export found";
    }
  </script>
</body></html>`;
}
```

- [ ] **Step 6.4: 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/web test -- sandbox-html-template
# Expected: 4/4 pass
```

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/src/components/canvas/sandbox-html-template.ts \
        apps/web/src/components/canvas/__tests__/sandbox-html-template.test.ts
git commit -m "feat(web): sandbox-html-template (esm.sh import map, version pinned)"
```

---

### Task 7: useCanvasMessages (postMessage origin 검증 훅)

**Files:**
- Create: `apps/web/src/components/canvas/useCanvasMessages.ts`
- Create: `apps/web/src/components/canvas/__tests__/useCanvasMessages.test.tsx`

- [ ] **Step 7.1: 실패 테스트 작성**

`apps/web/src/components/canvas/__tests__/useCanvasMessages.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useCanvasMessages, type CanvasMessage } from "../useCanvasMessages";

function makeMessageEvent(data: CanvasMessage, origin: string, source: Window | null): MessageEvent {
  return new MessageEvent("message", { data, origin, source } as any);
}

describe("useCanvasMessages", () => {
  it("origin === 'null' + source === iframe 일 때만 콜백 호출", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const onMsg = vi.fn();

    const { result } = renderHook(() => {
      const ref = useRef<HTMLIFrameElement>(iframe);
      return useCanvasMessages(ref, onMsg);
    });

    act(() => {
      window.dispatchEvent(makeMessageEvent({ type: "CANVAS_READY" }, "null", iframe.contentWindow));
    });

    expect(onMsg).toHaveBeenCalledWith({ type: "CANVAS_READY" });
  });

  it("origin !== 'null' 인 메시지 무시", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const onMsg = vi.fn();

    renderHook(() => {
      const ref = useRef<HTMLIFrameElement>(iframe);
      return useCanvasMessages(ref, onMsg);
    });

    act(() => {
      window.dispatchEvent(makeMessageEvent({ type: "CANVAS_READY" }, "https://evil.com", iframe.contentWindow));
    });

    expect(onMsg).not.toHaveBeenCalled();
  });

  it("source !== iframe.contentWindow 인 메시지 무시", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const onMsg = vi.fn();

    renderHook(() => {
      const ref = useRef<HTMLIFrameElement>(iframe);
      return useCanvasMessages(ref, onMsg);
    });

    act(() => {
      window.dispatchEvent(makeMessageEvent({ type: "CANVAS_READY" }, "null", window));  // not iframe
    });

    expect(onMsg).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7.2: 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/web test -- useCanvasMessages
# Expected: FAIL
```

- [ ] **Step 7.3: 구현**

`apps/web/src/components/canvas/useCanvasMessages.ts`:

```ts
"use client";
import { useEffect, useRef, type RefObject } from "react";

export type CanvasMessage =
  | { type: "CANVAS_READY" }
  | { type: "CANVAS_ERROR"; error: string }
  | { type: "CANVAS_RESIZE"; height: number };

/**
 * Blob URL iframe 의 message origin 은 항상 `"null"` 로 보고된다.
 * `event.source` 도 함께 비교해 외부 윈도우 위장 차단.
 *
 * IMPORTANT: 호출 측에서 `iframeRef.current` 가 mount 된 이후에만 의미 있음.
 */
export function useCanvasMessages(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  onMessage: (m: CanvasMessage) => void,
): void {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    function listener(event: MessageEvent) {
      if (event.origin !== "null") return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      handlerRef.current(event.data as CanvasMessage);
    }
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [iframeRef]);
}
```

- [ ] **Step 7.4: 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/web test -- useCanvasMessages
# Expected: 3/3 pass
```

- [ ] **Step 7.5: Commit**

```bash
git add apps/web/src/components/canvas/useCanvasMessages.ts \
        apps/web/src/components/canvas/__tests__/useCanvasMessages.test.tsx
git commit -m "feat(web): useCanvasMessages hook (origin=null + source identity)"
```

---

### Task 8: CanvasFrame (iframe sandbox 컴포넌트)

**Files:**
- Create: `apps/web/src/components/canvas/CanvasFrame.tsx`
- Create: `apps/web/src/components/canvas/__tests__/CanvasFrame.test.tsx`

- [ ] **Step 8.1: 실패 테스트 작성**

`apps/web/src/components/canvas/__tests__/CanvasFrame.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { CanvasFrame } from "../CanvasFrame";
import koMessages from "../../../../messages/ko/canvas.json";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ canvas: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("CanvasFrame", () => {
  it("sandbox 속성 = 'allow-scripts' (정확히, allow-same-origin 없음)", () => {
    const { container } = render(withIntl(<CanvasFrame source="<h1>x</h1>" language="html" />));
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("source > 64KB 이면 에러 UI + iframe 미렌더", () => {
    const big = "a".repeat(64 * 1024 + 1);
    const { container, getByText } = render(withIntl(<CanvasFrame source={big} language="html" />));
    expect(container.querySelector("iframe")).toBeNull();
    expect(getByText(/64KB/)).toBeInTheDocument();
  });

  it("언마운트 시 URL.revokeObjectURL 호출", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const { unmount } = render(withIntl(<CanvasFrame source="x" language="html" />));
    expect(create).toHaveBeenCalled();
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
});
```

- [ ] **Step 8.2: 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/web test -- CanvasFrame
# Expected: FAIL — Cannot find canvas/CanvasFrame
```

- [ ] **Step 8.3: 구현**

`apps/web/src/components/canvas/CanvasFrame.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { buildSandboxHTML, type CanvasIframeLanguage } from "./sandbox-html-template";
import { useCanvasMessages } from "./useCanvasMessages";

export const MAX_SOURCE_BYTES = 64 * 1024;

type Props = {
  source: string;
  language: CanvasIframeLanguage;
  className?: string;
};

export function CanvasFrame({ source, language, className = "" }: Props) {
  const t = useTranslations("canvas");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(480);

  const blobUrl = useMemo(() => {
    if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
      setError(t("errors.sourceTooLarge"));
      return null;
    }
    setError(null);
    const html = buildSandboxHTML(source, language);
    const blob = new Blob([html], { type: "text/html" });
    return URL.createObjectURL(blob);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, language]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useCanvasMessages(iframeRef, (m) => {
    if (m.type === "CANVAS_ERROR") setError(m.error);
    if (m.type === "CANVAS_RESIZE") setHeight(m.height);
  });

  if (!blobUrl) {
    return <div className="p-4 text-destructive text-sm">{error}</div>;
  }

  return (
    <div className={`rounded-xl overflow-hidden border bg-background ${className}`}>
      <iframe
        ref={iframeRef}
        src={blobUrl}
        title={t("frame.loading")}
        // CRITICAL: allow-same-origin 절대 추가 금지 (sandbox escape)
        sandbox="allow-scripts"
        style={{ height, width: "100%", border: 0 }}
        loading="lazy"
      />
      {error && (
        <div className="p-2 text-sm text-destructive bg-destructive/10">{error}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 8.4: 실행 (성공 확인)**

테스트는 i18n keys 가 필요하므로 Task 9 (canvas.json) 와 함께 검증. 임시로 `canvas.json` 없으면 다음 단계에서 만든 후 다시 실행.

이 시점에서는 다음 Task 9 로 진행하고 i18n 키 만든 후 8 + 9 통합 검증.

- [ ] **Step 8.5: Commit (i18n 만든 후 검증되는 시점)**

Task 9 의 i18n 까지 만든 후 통합 검증 → 함께 commit (또는 staged 로 두고 Task 9 완료 후 한 번에).

```bash
git add apps/web/src/components/canvas/CanvasFrame.tsx \
        apps/web/src/components/canvas/__tests__/CanvasFrame.test.tsx
# commit 은 Task 9 + 검증 통과 후
```

---

### Task 9: i18n canvas.json (ko + en)

**Files:**
- Create: `apps/web/messages/ko/canvas.json`
- Create: `apps/web/messages/en/canvas.json`

- [ ] **Step 9.1: ko 작성**

`apps/web/messages/ko/canvas.json`:

```json
{
  "tab": {
    "title": "캔버스",
    "untitled": "이름 없는 캔버스"
  },
  "viewer": {
    "languageLabel": "언어",
    "run": "실행",
    "reset": "되돌리기",
    "save": {
      "saved": "저장됨",
      "saving": "저장 중…",
      "dirty": "변경됨",
      "error": "저장 실패"
    },
    "languages": {
      "python": "Python",
      "javascript": "JavaScript",
      "html": "HTML",
      "react": "React"
    }
  },
  "runner": {
    "status": {
      "loading": "Pyodide 로드 중…",
      "ready": "준비됨",
      "running": "실행 중…",
      "done": "완료",
      "error": "오류"
    },
    "stdout": "표준 출력",
    "stderr": "오류 출력"
  },
  "frame": {
    "loading": "샌드박스 로드 중…",
    "error": "샌드박스 오류"
  },
  "errors": {
    "sourceTooLarge": "소스가 64KB 를 초과했습니다.",
    "executionTimeout": "실행이 10초 시간 제한을 초과했습니다.",
    "notCanvas": "캔버스 노트가 아닙니다."
  },
  "demo": {
    "title": "캔버스 데모",
    "sourcePlaceholder": "여기에 코드를 입력하세요…",
    "languagePython": "Python (Pyodide)",
    "languageReact": "React (esm.sh)",
    "languageHtml": "HTML",
    "languageJavascript": "JavaScript"
  },
  "sidebar": {
    "newCanvas": "새 캔버스"
  }
}
```

- [ ] **Step 9.2: en 작성 (동일 키, 영어 1차 값)**

`apps/web/messages/en/canvas.json`:

```json
{
  "tab": {
    "title": "Canvas",
    "untitled": "Untitled Canvas"
  },
  "viewer": {
    "languageLabel": "Language",
    "run": "Run",
    "reset": "Reset",
    "save": {
      "saved": "Saved",
      "saving": "Saving…",
      "dirty": "Modified",
      "error": "Save failed"
    },
    "languages": {
      "python": "Python",
      "javascript": "JavaScript",
      "html": "HTML",
      "react": "React"
    }
  },
  "runner": {
    "status": {
      "loading": "Loading Pyodide…",
      "ready": "Ready",
      "running": "Running…",
      "done": "Done",
      "error": "Error"
    },
    "stdout": "Standard output",
    "stderr": "Error output"
  },
  "frame": {
    "loading": "Loading sandbox…",
    "error": "Sandbox error"
  },
  "errors": {
    "sourceTooLarge": "Source exceeds 64 KB.",
    "executionTimeout": "Execution exceeded the 10-second timeout.",
    "notCanvas": "Not a canvas note."
  },
  "demo": {
    "title": "Canvas Demo",
    "sourcePlaceholder": "Type code here…",
    "languagePython": "Python (Pyodide)",
    "languageReact": "React (esm.sh)",
    "languageHtml": "HTML",
    "languageJavascript": "JavaScript"
  },
  "sidebar": {
    "newCanvas": "New canvas"
  }
}
```

- [ ] **Step 9.3: parity 검증**

```bash
pnpm --filter @opencairn/web i18n:parity
# Expected: PASS — 모든 키가 ko/en 양쪽 존재
```

- [ ] **Step 9.4: i18n 통합 (next-intl namespace 등록)**

`apps/web/src/i18n/request.ts` (또는 `next-intl` 메시지 로드 파일) 에 canvas namespace 가 자동 포함되는지 확인. 다른 namespace (예: `app-shell.json`) 가 wildcard merge 되는 패턴이면 자동.

`apps/web/messages/{locale}/index.ts` (또는 등가) 가 있다면 추가:

```diff
+import canvas from "./canvas.json";
 export default {
   common,
   ...
+  canvas,
 };
```

(파일 구조는 기존 pattern 확인 후 따름)

- [ ] **Step 9.5: Task 8 + Task 9 통합 검증**

```bash
pnpm --filter @opencairn/web test -- CanvasFrame
# Expected: 3/3 pass
```

- [ ] **Step 9.6: Commit (Task 8 + 9 통합)**

```bash
git add apps/web/src/components/canvas/CanvasFrame.tsx \
        apps/web/src/components/canvas/__tests__/CanvasFrame.test.tsx \
        apps/web/messages/ko/canvas.json \
        apps/web/messages/en/canvas.json \
        apps/web/src/i18n/request.ts  # 변경된 경우
git commit -m "feat(web): CanvasFrame component + canvas.json i18n (ko/en parity)"
```

---

### Task 10: PyodideRunner (Python WASM 실행 컴포넌트)

**Files:**
- Create: `apps/web/src/components/canvas/PyodideRunner.tsx`
- Create: `apps/web/src/components/canvas/__tests__/PyodideRunner.test.tsx`

- [ ] **Step 10.1: 실패 테스트 작성**

`apps/web/src/components/canvas/__tests__/PyodideRunner.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "../../../../messages/ko/canvas.json";
import { PyodideRunner } from "../PyodideRunner";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ canvas: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

vi.mock("@/lib/pyodide-loader", () => {
  return {
    PYODIDE_VERSION: "0.27.0",
    loadPyodide: vi.fn().mockImplementation(async () => ({
      setStdin: vi.fn(),
      setStdout: ({ batched }: any) => batched("hello\n"),
      setStderr: vi.fn(),
      runPythonAsync: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("PyodideRunner", () => {
  it("status 가 loading → ready → running → done 으로 전환", async () => {
    const onResult = vi.fn();
    const { findByText } = render(withIntl(<PyodideRunner source="print('hello')" onResult={onResult} />));
    // 초기 'Pyodide 로드 중…'
    await findByText(/Pyodide 로드 중/);
    // 최종 done
    await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 5000 });
    expect(onResult.mock.calls[0][0].timedOut).toBe(false);
  });
});
```

- [ ] **Step 10.2: 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/web test -- PyodideRunner
# Expected: FAIL
```

- [ ] **Step 10.3: 구현**

`apps/web/src/components/canvas/PyodideRunner.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { loadPyodide } from "@/lib/pyodide-loader";

export const EXECUTION_TIMEOUT_MS = 10_000;

type Status = "loading" | "ready" | "running" | "done" | "error";

type Props = {
  source: string;
  stdin?: string;
  onResult?: (r: { stdout: string; stderr: string; timedOut: boolean }) => void;
};

export function PyodideRunner({ source, stdin = "", onResult }: Props) {
  const t = useTranslations("canvas.runner");
  const [status, setStatus] = useState<Status>("loading");
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");

  useEffect(() => {
    let cancelled = false;
    let outBuf = "";
    let errBuf = "";

    (async () => {
      try {
        const pyodide = await loadPyodide();
        if (cancelled) return;
        setStatus("ready");

        const lines = stdin.split("\n");
        let idx = 0;
        pyodide.setStdin({ stdin: () => (idx < lines.length ? lines[idx++] : null) });

        pyodide.setStdout({ batched: (s: string) => { outBuf += s + "\n"; if (!cancelled) setStdout(outBuf); } });
        pyodide.setStderr({ batched: (s: string) => { errBuf += s + "\n"; if (!cancelled) setStderr(errBuf); } });

        setStatus("running");
        const exec = pyodide.runPythonAsync(source);
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("__CANVAS_TIMEOUT__")), EXECUTION_TIMEOUT_MS),
        );

        try {
          await Promise.race([exec, timeout]);
          if (cancelled) return;
          setStatus("done");
          onResult?.({ stdout: outBuf, stderr: errBuf, timedOut: false });
        } catch (e) {
          if (cancelled) return;
          const timedOut = (e as Error).message === "__CANVAS_TIMEOUT__";
          setStatus("error");
          const msg = timedOut ? t("status.error") : (e as Error).message;
          setStderr((prev) => prev + "\n" + msg);
          onResult?.({ stdout: outBuf, stderr: errBuf + "\n" + msg, timedOut });
        }
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setStderr(String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [source, stdin, onResult, t]);

  return (
    <div className="rounded-xl border bg-background p-4 space-y-2">
      <div className="text-xs text-muted-foreground" data-testid="status">
        {t(`status.${status}`)}
      </div>
      {stdout && (
        <pre className="text-sm whitespace-pre-wrap font-mono" data-testid="stdout">
          {stdout}
        </pre>
      )}
      {stderr && (
        <pre className="text-sm whitespace-pre-wrap font-mono text-destructive" data-testid="stderr">
          {stderr}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 10.4: 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/web test -- PyodideRunner
# Expected: 1/1 pass
```

- [ ] **Step 10.5: Commit**

```bash
git add apps/web/src/components/canvas/PyodideRunner.tsx \
        apps/web/src/components/canvas/__tests__/PyodideRunner.test.tsx
git commit -m "feat(web): PyodideRunner component (10s timeout, status states, i18n)"
```

---

### Task 11: CanvasViewer (Tab Mode Router 어댑터)

**Files:**
- Create: `apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/canvas-viewer.test.tsx`

- [ ] **Step 11.1: 실패 테스트 작성**

`apps/web/src/components/tab-shell/viewers/canvas-viewer.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import koMessages from "../../../../messages/ko/canvas.json";
import { CanvasViewer } from "./canvas-viewer";
import type { Tab } from "@/stores/tabs-store";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <NextIntlClientProvider locale="ko" messages={{ canvas: koMessages }}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

const mockNote = {
  id: "n1",
  title: "Hello",
  contentText: "print('hi')",
  canvasLanguage: "python" as const,
  sourceType: "canvas" as const,
};

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn().mockImplementation((url: string, opts: any) => {
    if (url === "/api/notes/n1" && (!opts || opts.method === "GET")) {
      return Promise.resolve(mockNote);
    }
    if (url === "/api/notes/n1/canvas" && opts.method === "PATCH") {
      return Promise.resolve({ ...mockNote, contentText: JSON.parse(opts.body).source });
    }
    throw new Error(`Unexpected ${opts?.method ?? "GET"} ${url}`);
  }),
}));

const tab: Tab = { id: "t1", noteId: "n1", mode: "canvas", title: "Canvas" } as any;

describe("CanvasViewer", () => {
  it("python language → PyodideRunner 마운트", async () => {
    const { findByText } = render(wrap(<CanvasViewer tab={tab} />));
    // 텍스트영역에 기존 source 로드 + Pyodide 로딩 텍스트 표시
    await findByText(/Pyodide 로드 중/);
  });

  it("language='html' note 는 CanvasFrame 마운트", async () => {
    const { apiFetch } = await import("@/lib/api");
    (apiFetch as any).mockResolvedValueOnce({ ...mockNote, canvasLanguage: "html", contentText: "<h1>x</h1>" });
    const { container } = render(wrap(<CanvasViewer tab={tab} />));
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
  });

  it("textarea 변경 → 1.5s 디바운스 후 PATCH 호출", async () => {
    vi.useFakeTimers();
    const { apiFetch } = await import("@/lib/api");
    const { findByRole } = render(wrap(<CanvasViewer tab={tab} />));
    const ta = await findByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      ta.value = "print('new')";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(1600);
    });
    expect((apiFetch as any).mock.calls.some((c: any[]) =>
      c[0] === "/api/notes/n1/canvas" && c[1]?.method === "PATCH"
    )).toBe(true);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 11.2: 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/web test -- canvas-viewer
# Expected: FAIL
```

- [ ] **Step 11.3: 구현**

`apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx`:

```tsx
"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import type { Tab } from "@/stores/tabs-store";
import { PyodideRunner } from "@/components/canvas/PyodideRunner";
import { CanvasFrame } from "@/components/canvas/CanvasFrame";
import { MAX_SOURCE_BYTES } from "@/components/canvas/CanvasFrame";

type CanvasNote = {
  id: string;
  title: string;
  contentText: string;
  canvasLanguage: "python" | "javascript" | "html" | "react";
};

const SAVE_DEBOUNCE_MS = 1500;

export function CanvasViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("canvas");
  const noteId = tab.noteId!;

  const { data: note } = useQuery<CanvasNote>({
    queryKey: ["note", noteId],
    queryFn: () => apiFetch(`/api/notes/${noteId}`),
  });

  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: { source: string; language?: CanvasNote["canvasLanguage"] }) =>
      apiFetch(`/api/notes/${noteId}/canvas`, {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    onSuccess: (data) => qc.setQueryData(["note", noteId], data),
  });

  const [source, setSource] = useState<string>("");
  const [language, setLanguage] = useState<CanvasNote["canvasLanguage"]>("python");
  const [runId, setRunId] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty" | "error">("saved");

  // 노트 로드 → state 동기화
  useEffect(() => {
    if (note) {
      setSource(note.contentText ?? "");
      setLanguage(note.canvasLanguage);
    }
  }, [note]);

  // 디바운스 저장
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!note) return;
    if (source === note.contentText && language === note.canvasLanguage) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveStatus("saving");
      save.mutate(
        { source, language },
        {
          onSuccess: () => setSaveStatus("saved"),
          onError: () => setSaveStatus("error"),
        },
      );
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [source, language, note, save]);

  if (!note) return <div className="p-4 text-sm">{t("frame.loading")}</div>;

  const tooLarge = new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-2 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span>{t("viewer.languageLabel")}:</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as CanvasNote["canvasLanguage"])}
            className="border rounded px-2 py-1"
          >
            <option value="python">{t("viewer.languages.python")}</option>
            <option value="javascript">{t("viewer.languages.javascript")}</option>
            <option value="html">{t("viewer.languages.html")}</option>
            <option value="react">{t("viewer.languages.react")}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setRunId((n) => n + 1)}
          disabled={tooLarge}
          className="px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          {t("viewer.run")}
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {saveStatus === "saved" && t("viewer.save.saved")}
          {saveStatus === "saving" && t("viewer.save.saving")}
          {saveStatus === "dirty" && `● ${t("viewer.save.dirty")}`}
          {saveStatus === "error" && t("viewer.save.error")}
        </span>
      </div>
      <div className="flex flex-1 min-h-0">
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="flex-1 p-3 font-mono text-sm bg-muted/20 border-r outline-none resize-none"
          spellCheck={false}
        />
        <div className="flex-1 p-3 overflow-auto">
          {tooLarge ? (
            <div className="text-destructive text-sm">{t("errors.sourceTooLarge")}</div>
          ) : language === "python" ? (
            <PyodideRunner key={runId} source={source} />
          ) : (
            <CanvasFrame key={runId} source={source} language={language} />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.4: 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/web test -- canvas-viewer
# Expected: 3/3 pass
```

- [ ] **Step 11.5: Commit**

```bash
git add apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx \
        apps/web/src/components/tab-shell/viewers/canvas-viewer.test.tsx
git commit -m "feat(web): CanvasViewer (Tab Mode Router adapter, debounced save)"
```

---

### Task 12: Tab Mode Router 'canvas' case + sourceType auto-detect

**Files:**
- Modify: `apps/web/src/components/tab-shell/tab-mode-router.tsx`
- Modify: `apps/web/src/components/tab-shell/tab-mode-router.test.tsx`
- Modify: `apps/web/src/stores/tabs-store.ts` (auto-detect 헬퍼)

- [ ] **Step 12.1: 실패 테스트 작성/확장**

`apps/web/src/components/tab-shell/tab-mode-router.test.tsx` 에 추가:

```tsx
it("dispatches mode='canvas' to CanvasViewer", () => {
  const tab = { id: "t", noteId: "n", mode: "canvas", title: "C" } as any;
  const { container } = render(<TabModeRouter tab={tab} />);
  // CanvasViewer 의 첫 마운트 표식 (예: select[name=language] 또는 data-testid)
  expect(container.querySelector('[data-testid="canvas-viewer-toolbar"]')).not.toBeNull();
});
```

CanvasViewer 의 외곽 div 에 `data-testid="canvas-viewer-toolbar"` 추가 필요 (Task 11 코드의 toolbar div 에).

`tabs-store.ts` 의 sourceType→mode 헬퍼 (이미 있는 패턴 확장):

```tsx
// auto-detect 단위 테스트 — apps/web/src/stores/__tests__/tabs-store.test.ts 또는 등가
it("modeFromSourceType: 'canvas' → 'canvas'", () => {
  expect(modeFromSourceType("canvas")).toBe("canvas");
});
```

- [ ] **Step 12.2: 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/web test -- tab-mode-router tabs-store
# Expected: FAIL — case 'canvas' 없음
```

- [ ] **Step 12.3: Tab Mode Router 수정**

`apps/web/src/components/tab-shell/tab-mode-router.tsx`:

```diff
 import { ReadingViewer } from "./viewers/reading-viewer";
 import { SourceViewer } from "./viewers/source-viewer";
 import { DataViewer } from "./viewers/data-viewer";
+import { CanvasViewer } from "./viewers/canvas-viewer";
 import { StubViewer } from "./viewers/stub-viewer";

 export function TabModeRouter({ tab }: { tab: Tab }) {
   switch (tab.mode) {
     case "reading":
       return <ReadingViewer tab={tab} />;
     case "source":
       return <SourceViewer tab={tab} />;
     case "data":
       return <DataViewer tab={tab} />;
+    case "canvas":
+      return <CanvasViewer tab={tab} />;
     case "plate":
       throw new Error(...);
     default:
       return <StubViewer mode={tab.mode} />;
   }
 }
```

- [ ] **Step 12.4: tabs-store auto-detect 확장**

`apps/web/src/stores/tabs-store.ts` 의 `modeFromSourceType` (또는 등가 헬퍼) 에:

```diff
 export function modeFromSourceType(sourceType: SourceType | null): TabMode {
   switch (sourceType) {
     case "pdf":
       return "source";
+    case "canvas":
+      return "canvas";
     default:
       return "plate";
   }
 }
```

`TabMode` union 에 `"canvas"` 추가 (이미 있다면 skip):

```diff
 export type TabMode = "plate" | "reading" | "source" | "data" | "canvas" | "diff" | ...;
```

- [ ] **Step 12.5: CanvasViewer 의 toolbar div 에 data-testid 추가**

```diff
-      <div className="border-b p-2 flex items-center gap-3 text-sm">
+      <div className="border-b p-2 flex items-center gap-3 text-sm" data-testid="canvas-viewer-toolbar">
```

- [ ] **Step 12.6: 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/web test -- tab-mode-router tabs-store canvas-viewer
# Expected: 모두 PASS
```

- [ ] **Step 12.7: Commit**

```bash
git add apps/web/src/components/tab-shell/tab-mode-router.tsx \
        apps/web/src/components/tab-shell/tab-mode-router.test.tsx \
        apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx \
        apps/web/src/stores/tabs-store.ts \
        apps/web/src/stores/__tests__/tabs-store.test.ts
git commit -m "feat(web): tab-mode-router canvas case + sourceType=canvas auto-detect"
```

---

### Task 13: Standalone `/canvas/demo` Playground

**Files:**
- Create: `apps/web/src/app/[locale]/canvas/demo/page.tsx`

- [ ] **Step 13.1: 페이지 작성**

`apps/web/src/app/[locale]/canvas/demo/page.tsx`:

```tsx
"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { PyodideRunner } from "@/components/canvas/PyodideRunner";
import { CanvasFrame } from "@/components/canvas/CanvasFrame";

type DemoLang = "python" | "javascript" | "html" | "react";

export default function CanvasDemoPage() {
  const t = useTranslations("canvas");
  const params = useSearchParams();
  const initialLang = (params.get("lang") as DemoLang) ?? "python";

  const [language, setLanguage] = useState<DemoLang>(initialLang);
  const [source, setSource] = useState<string>("");
  const [runId, setRunId] = useState(0);

  // sessionStorage 영속화 (디버깅 편의)
  useEffect(() => {
    const saved = sessionStorage.getItem(`canvas-demo:${language}`);
    if (saved !== null) setSource(saved);
  }, [language]);

  useEffect(() => {
    sessionStorage.setItem(`canvas-demo:${language}`, source);
  }, [source, language]);

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b p-3">
        <h1 className="text-lg font-semibold">{t("demo.title")}</h1>
      </header>
      <div className="border-b p-2 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span>{t("viewer.languageLabel")}:</span>
          <select
            name="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as DemoLang)}
            className="border rounded px-2 py-1"
          >
            <option value="python">{t("demo.languagePython")}</option>
            <option value="javascript">{t("demo.languageJavascript")}</option>
            <option value="html">{t("demo.languageHtml")}</option>
            <option value="react">{t("demo.languageReact")}</option>
          </select>
        </label>
        <button
          type="submit"
          onClick={() => setRunId((n) => n + 1)}
          className="px-3 py-1 rounded bg-primary text-primary-foreground"
        >
          {t("viewer.run")}
        </button>
      </div>
      <div className="flex flex-1 min-h-0">
        <textarea
          name="source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={t("demo.sourcePlaceholder")}
          className="flex-1 p-3 font-mono text-sm bg-muted/20 border-r outline-none resize-none"
          spellCheck={false}
        />
        <div className="flex-1 p-3 overflow-auto">
          {language === "python" ? (
            <PyodideRunner key={runId} source={source} />
          ) : (
            <CanvasFrame key={runId} source={source} language={language} />
          )}
        </div>
      </div>
    </div>
  );
}
```

> 인증 게이트는 `apps/web/src/middleware.ts` 의 패턴을 따른다 — `/canvas/demo` 경로는 Better Auth 미들웨어 통과 필요. 비로그인 → `/login?next=/canvas/demo` 리다이렉트가 자동 동작하면 별도 코드 불필요. 자동 동작 안 하는 경로면 middleware matcher 에 `/canvas/demo` 추가.

- [ ] **Step 13.2: 수동 검증**

```bash
pnpm --filter @opencairn/web dev
# 브라우저에서 http://localhost:3000/ko/canvas/demo?lang=python
# 1. 로그인 안 된 상태 → /login?next=/canvas/demo 리다이렉트
# 2. 로그인 후 → 데모 페이지 마운트
# 3. textarea 에 `print('hello')` 입력 → Run → "hello" 출력
# 4. lang=react 로 바꿔 simple component 입력 → iframe 마운트
```

- [ ] **Step 13.3: middleware matcher 보강 (필요 시)**

`apps/web/src/middleware.ts` 의 `matcher` 또는 auth 가드에 `/canvas/demo` 가 포함되는지 확인. 누락되면:

```diff
 export const config = {
-  matcher: ["/app/:path*", ...],
+  matcher: ["/app/:path*", "/canvas/:path*", ...],
 };
```

- [ ] **Step 13.4: Commit**

```bash
git add apps/web/src/app/\[locale\]/canvas/demo/page.tsx \
        apps/web/src/middleware.ts  # 변경된 경우
git commit -m "feat(web): /canvas/demo standalone playground (auth-gated, sessionStorage)"
```

---

### Task 14: 사이드바 "+ 새 캔버스" 진입점

**Files:**
- Modify: `apps/web/src/components/sidebar/project-tree-context-menu.tsx` (또는 등가 — Phase 2 패턴 확인)
- Modify: 해당 테스트 파일

- [ ] **Step 14.1: 기존 context menu 코드 확인**

```bash
grep -rn "context-menu\|ContextMenu\|새 노트\|newNote" apps/web/src/components/sidebar/ | head -20
```

기존 "새 노트" 메뉴 항목 위치 확인 → 같은 패턴으로 "새 캔버스" 추가.

- [ ] **Step 14.2: 실패 테스트 작성**

기존 sidebar 테스트 (예: `project-tree.test.tsx`) 에 추가:

```tsx
it("project context menu 에 '새 캔버스' 항목이 있다", async () => {
  const { findByText } = render(...);  // 기존 패턴 따름
  await user.contextClick(getByText(projectName));
  expect(await findByText(/새 캔버스|New canvas/i)).toBeInTheDocument();
});

it("'새 캔버스' 클릭 → POST /api/notes (sourceType='canvas', language='python')", async () => {
  const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ id: "new-id", canvasLanguage: "python" }),
    { status: 201 }
  ));
  ...
  await user.click(await findByText(/새 캔버스/i));
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/api/notes"),
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"sourceType":"canvas"'),
    }),
  );
});
```

- [ ] **Step 14.3: 실행 (실패 확인)**

```bash
pnpm --filter @opencairn/web test -- project-tree
# Expected: FAIL
```

- [ ] **Step 14.4: 메뉴 항목 추가**

기존 "새 노트" 메뉴 코드 옆에:

```tsx
<ContextMenuItem onSelect={() => createCanvas(project.id)}>
  {t("canvas.sidebar.newCanvas")}
</ContextMenuItem>
```

`createCanvas` 헬퍼 (같은 컴포넌트 또는 store action):

```ts
async function createCanvas(projectId: string) {
  const note = await apiFetch("/api/notes", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      title: t("canvas.tab.untitled"),
      sourceType: "canvas",
      canvasLanguage: "python",
      contentText: "",
    }),
    headers: { "content-type": "application/json" },
  });
  // 새 탭 열기 (기존 store action 패턴)
  openTab({ noteId: note.id, mode: "canvas", title: note.title });
}
```

- [ ] **Step 14.5: 실행 (성공 확인)**

```bash
pnpm --filter @opencairn/web test -- project-tree
# Expected: PASS
```

- [ ] **Step 14.6: Commit**

```bash
git add apps/web/src/components/sidebar/
git commit -m "feat(web): sidebar '+ 새 캔버스' entry creates canvas note + opens canvas tab"
```

---

### Task 15: CSP 헤더

**Files:**
- Modify: `apps/web/next.config.ts`

- [ ] **Step 15.1: 기존 CSP 확인**

```bash
grep -n "Content-Security-Policy\|csp\|headers" apps/web/next.config.ts apps/web/src/middleware.ts 2>/dev/null
```

기존 CSP 가 있으면 머지, 없으면 신규 작성.

- [ ] **Step 15.2: CSP 헤더 추가**

`apps/web/next.config.ts`:

```diff
 const nextConfig = {
   ...
+  async headers() {
+    const csp = [
+      "default-src 'self'",
+      "frame-src 'self' blob:",
+      // Pyodide WASM compile 은 'unsafe-eval' 필요 (ADR-006 인정)
+      "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net/pyodide/ https://esm.sh",
+      "worker-src 'self' blob:",
+      "connect-src 'self' https://esm.sh https://cdn.jsdelivr.net/pyodide/",
+      "img-src 'self' data: blob: https:",
+      "style-src 'self' 'unsafe-inline'",
+    ].join("; ");
+    return [
+      {
+        source: "/:path*",
+        headers: [{ key: "Content-Security-Policy", value: csp }],
+      },
+    ];
+  },
 };
```

> 기존에 다른 CSP 정책이 있으면 source 별로 분리하거나 한 정책에 머지. `next.config.ts` 가 ESM 이 아니면 (CommonJS) 동일하게 적용.

- [ ] **Step 15.3: 검증**

```bash
pnpm --filter @opencairn/web build  # 빌드 성공
pnpm --filter @opencairn/web start  # 또는 dev
# 다른 터미널: curl -I http://localhost:3000/ko | grep -i security
# Expected: Content-Security-Policy 헤더에 esm.sh + jsdelivr/pyodide 포함
```

- [ ] **Step 15.4: Commit**

```bash
git add apps/web/next.config.ts
git commit -m "feat(web): CSP allowlist for Pyodide CDN + esm.sh + iframe blob"
```

---

### Task 16: Playwright E2E (`canvas.spec.ts`)

**Files:**
- Create: `apps/web/tests/e2e/canvas.spec.ts`

- [ ] **Step 16.1: E2E 작성**

`apps/web/tests/e2e/canvas.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { loginAsTestUser } from "./helpers";  // 기존 패턴

test.describe("Canvas Phase 1", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/ko/canvas/demo?lang=python");
  });

  test("Pyodide 로 Python 코드 실행 → stdout 스트리밍", async ({ page }) => {
    await page.locator("textarea[name=source]").fill("for i in range(3): print(i)");
    await page.getByRole("button", { name: /실행|Run/i }).click();
    await expect(page.locator("[data-testid=stdout]"))
      .toContainText("0", { timeout: 30_000 });
    await expect(page.locator("[data-testid=stdout]")).toContainText("1");
    await expect(page.locator("[data-testid=stdout]")).toContainText("2");
  });

  test("EXECUTION_TIMEOUT_MS 10초 초과 → error 상태", async ({ page }) => {
    await page.locator("textarea[name=source]").fill("while True: pass");
    await page.getByRole("button", { name: /실행|Run/i }).click();
    await expect(page.locator("[data-testid=status]"))
      .toContainText(/오류|Error/i, { timeout: 15_000 });
  });

  test("iframe sandbox 속성 = 'allow-scripts' (정확히)", async ({ page }) => {
    await page.locator("select[name=language]").selectOption("html");
    await page.locator("textarea[name=source]").fill("<h1>test</h1>");
    await page.getByRole("button", { name: /실행|Run/i }).click();
    const sandbox = await page.locator("iframe").first().getAttribute("sandbox");
    expect(sandbox).toBe("allow-scripts");
  });

  test("iframe 에서 부모 cookie 접근 시 DOMException → 'BLOCKED' 메시지", async ({ page }) => {
    await page.locator("select[name=language]").selectOption("html");
    await page.locator("textarea[name=source]").fill(`
      <script>
        try {
          const c = window.parent.document.cookie;
          parent.postMessage({ type: "LEAK", c }, "*");
        } catch (e) {
          parent.postMessage({ type: "BLOCKED", e: String(e) }, "*");
        }
      </script>
    `);
    await page.getByRole("button", { name: /실행|Run/i }).click();
    const msg = await page.evaluate(() =>
      new Promise<unknown>((resolve) => {
        window.addEventListener("message", (e) => resolve(e.data), { once: true });
        setTimeout(() => resolve(null), 5000);
      })
    );
    expect((msg as any)?.type).toBe("BLOCKED");
  });

  test("Pyodide CDN URL 은 고정 버전 (floating tag 금지)", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto("/ko/canvas/demo?lang=python");
    await page.locator("textarea[name=source]").fill("print('x')");
    await page.getByRole("button", { name: /실행|Run/i }).click();
    await page.waitForTimeout(2000);  // CDN 요청 대기
    const pyodideUrls = requests.filter((u) => u.includes("/pyodide/"));
    expect(pyodideUrls.length).toBeGreaterThan(0);
    expect(pyodideUrls.every((u) => /\/v\d+\.\d+\.\d+\//.test(u))).toBe(true);
    expect(pyodideUrls.every((u) => !u.includes("latest"))).toBe(true);
  });

  test("64KB 초과 source → UI 거부", async ({ page }) => {
    await page.locator("select[name=language]").selectOption("html");
    const big = "a".repeat(64 * 1024 + 1);
    await page.locator("textarea[name=source]").fill(big);
    await page.getByRole("button", { name: /실행|Run/i }).click();
    await expect(page.locator("text=/64KB|exceeds/i")).toBeVisible();
    expect(await page.locator("iframe").count()).toBe(0);
  });
});
```

- [ ] **Step 16.2: 실행**

```bash
pnpm --filter @opencairn/web playwright test canvas.spec.ts
# Expected: 6/6 pass (Pyodide 첫 다운로드는 ~15s 걸림)
```

- [ ] **Step 16.3: Commit**

```bash
git add apps/web/tests/e2e/canvas.spec.ts
git commit -m "test(web): Playwright E2E for canvas (Pyodide + sandbox isolation)"
```

---

### Task 17: 회귀 CI grep 가드

**Files:**
- Modify: `.github/workflows/ci.yml` (또는 `package.json` scripts)

- [ ] **Step 17.1: CI step 추가**

기존 CI workflow 의 lint/test 단계 옆에 새 step 추가:

```yaml
- name: Canvas regression guards
  run: |
    set -e
    echo "🔒 allow-same-origin should not appear in canvas code..."
    if grep -RE "allow-same-origin" apps/web/src/components/canvas/ apps/web/src/app/\[locale\]/canvas/; then
      echo "❌ FAIL: allow-same-origin found"
      exit 1
    fi

    echo "🔒 postMessage with '*' wildcard should not appear in canvas code..."
    if grep -RE 'postMessage\([^,]*,\s*"\*"' apps/web/src/components/canvas/; then
      echo "❌ FAIL: wildcard postMessage found"
      exit 1
    fi

    echo "🔒 Pyodide CDN should not use floating tags..."
    if grep -RE "pyodide/(latest|v@latest)" apps/web/src/; then
      echo "❌ FAIL: pyodide floating tag found"
      exit 1
    fi

    echo "✅ All canvas regression guards passed"
```

> CI workflow 가 `.github/workflows/` 에 여러 파일로 분리돼 있으면 lint job 또는 dedicated quality job 에 추가.

- [ ] **Step 17.2: 로컬 검증**

```bash
# 가드 자체가 실수 시 실패하는지 확인
echo "test allow-same-origin" >> apps/web/src/components/canvas/PyodideRunner.tsx
bash -c 'grep -RE "allow-same-origin" apps/web/src/components/canvas/' && echo "DETECTED"
git checkout apps/web/src/components/canvas/PyodideRunner.tsx
```

`DETECTED` 가 나와야 가드가 실제로 작동.

- [ ] **Step 17.3: Commit**

```bash
git add .github/workflows/
git commit -m "ci: canvas regression grep guards (allow-same-origin / postMessage * / pyodide latest)"
```

---

## Final Verification (PR 머지 전)

각 task 완료 후 누적 검증. 마지막 task 후 한 번에:

- [ ] **F1: 전체 테스트 통과**
  ```bash
  pnpm --filter @opencairn/db test
  pnpm --filter @opencairn/shared test
  pnpm --filter @opencairn/api test
  pnpm --filter @opencairn/web test
  ```

- [ ] **F2: i18n parity 통과**
  ```bash
  pnpm --filter @opencairn/web i18n:parity
  ```

- [ ] **F3: Web 빌드 성공**
  ```bash
  pnpm --filter @opencairn/web build
  ```

- [ ] **F4: Playwright E2E 통과**
  ```bash
  pnpm --filter @opencairn/web playwright test canvas.spec.ts
  ```

- [ ] **F5: CI grep 가드 0 hit**
  ```bash
  ! grep -RE "allow-same-origin" apps/web/src/components/canvas/
  ! grep -RE 'postMessage\([^,]*,\s*"\*"' apps/web/src/components/canvas/
  ! grep -RE "pyodide/(latest|v@latest)" apps/web/src/
  ```

- [ ] **F6: 수동 smoke**
  - `/canvas/demo?lang=python` 에서 `print('hello')` → "hello" 출력
  - 사이드바 우클릭 → "새 캔버스" → Tab Mode Router 가 canvas 모드로 마운트
  - 수정 후 1.5s 대기 → "저장됨" 표시

- [ ] **F7: 문서 업데이트** (Plan 7 status, plans-status.md, MEMORY.md)

- [ ] **F8: PR 생성**
  ```bash
  gh pr create --base main --head feat/plan-7-canvas-phase-1 \
    --title "feat: Plan 7 Canvas Phase 1 — web runtime + tab mode router" \
    --body-file .github/pr-canvas-phase-1.md  # 또는 인라인
  ```

  PR 본문 핵심:
  - Spec / Plan 링크
  - 17 task 요약
  - 테스트 결과 (db / shared / api / web / playwright counts)
  - i18n parity 통과
  - CSP 헤더 추가
  - Phase 2 인계 (Code Agent / `/api/code/run` / canvas template / Monaco / matplotlib output)
  - Migration 충돌 노트 (Session A 와 0020 race 상황)
