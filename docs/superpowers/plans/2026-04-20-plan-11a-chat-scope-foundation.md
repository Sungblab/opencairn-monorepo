# Plan 11A: Chat Scope Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Spec source:** `docs/superpowers/specs/2026-04-20-agent-chat-scope-design.md`
>
> **Companion plans (deferred):**
> - **Plan 11B (Memory Layers L1–L4)** — depends on 11A's chip infrastructure
> - **Plan 11C (Document Viewer)** — independent, can run in parallel
>
> **Prerequisites:** Plan 1 (workspace + permissions helpers `canRead` / `canWrite` / `requireWorkspaceRole` at `apps/api/src/lib/permissions.ts`). Plan 4 may or may not be done — this plan defines the canonical `conversations` table schema, replacing the stub mentioned in `api-contract.md:171`.

**Goal:** Ship a scope-aware chat that knows which slice of the workspace to search, shows attached context as removable chips, persists scope per conversation, supports Strict / Expand RAG modes, and lets users pin answers to pages with explicit permission warnings when citation visibility is asymmetric.

**Architecture:** Conversations live in Postgres with denormalized `workspace_id` for hard isolation. Chips are stored as a `jsonb` column on `conversations` (each conversation owns its full attached-chip set, location-independent). The web app uses a Cursor-style `<ChipRow>` component above the chat input that auto-detects scope from the current route via a `useScopeContext()` hook. Pin requests check citation visibility against the target page's viewer set and surface a confirmation modal when the delta is non-empty.

**Tech Stack:** Postgres 16 + pgvector, Drizzle ORM, Hono 4 (API), Next.js 16 + React Server Components, Better Auth (session), Zod (shared schemas in `packages/shared`), Playwright (E2E), Vitest (unit).

**Test fixtures:** Tasks 3+ assume the following helpers exist at `tests/api/helpers.ts` (mirror the patterns from Plan 1 / Plan 4 test setup — create them before Task 3 if missing):

- `testApp` — Hono test client wrapping `apps/api/src/index.ts`
- `asUser(userId)` — returns headers (`Cookie` or `Authorization`) that authenticate as the given user
- `seedWorkspace()` → `{ workspaceId, pageId, projectId, ownerId }` — creates a minimal workspace with one project + one page
- `seedPage(workspaceId?)` → `{ pageId, workspaceId }` — adds a page to the given (or new) workspace
- `seedConversation(userId)` → `{ conversationId, workspaceId, pageId }` — creates a workspace + a conversation owned by `userId` with a page-scope chip
- `seedMessageWithCitation({ ownerId, citedNoteIsPublic, targetPageIsPublic })` → `{ messageId, noteId }` — creates a conversation, an assistant message citing one note, and a separate target page with the requested visibility settings (use `page_permissions` rows to make them private)

The DB-side equivalent (`packages/db/tests/helpers/test-db.ts`) exists from Plan 1 — reuse it.

---

## File Structure

```
packages/db/src/schema/
  conversations.ts                       -- new: conversations + conversation_messages + pinned_answers tables
  index.ts                               -- modify: export conversations schemas

packages/shared/src/
  chat.ts                                -- new: Zod schemas (ScopeType, ChipType, AttachedChip, RagMode, MemoryFlags, etc.)
  index.ts                               -- modify: export chat schemas

apps/api/src/
  routes/
    chat.ts                              -- new: conversation + chips + pin + message SSE routes
  lib/
    chat-scope.ts                        -- new: validate scope + initialize attachedChips for new conversation
    pin-permissions.ts                   -- new: compute citation visibility delta for pin warnings
    cost.ts                              -- new: token → KRW conversion helper
  index.ts                               -- modify: mount /api/chat router

apps/web/src/
  hooks/
    useScopeContext.ts                   -- new: derives initial scope from current route
  components/chat/
    ChipRow.tsx                          -- new: horizontal chip row above input
    Chip.tsx                             -- new: single chip (icon, label, X, hover token estimate)
    AddChipCombobox.tsx                  -- new: + button → page/project search & multi-select
    RagModeToggle.tsx                    -- new: Strict / Expand dropdown
    PinButton.tsx                        -- new: pin to page + permission warning modal
    PinPermissionModal.tsx               -- new: shows hidden sources / hidden users
    CostBadge.tsx                        -- new: per-message cost display (after `cost` SSE event)
    ChatInput.tsx                        -- new: textarea + chip row + send button
    ChatPanel.tsx                        -- new: composes ChatInput + message list + scope chips
  lib/
    token-estimate.ts                    -- new: client-side estimator (tiktoken-style, language-agnostic)
  app/(app)/w/[workspaceSlug]/
    chat/page.tsx                        -- new: global workspace-scope chat entry point
    p/[projectSlug]/chat/page.tsx        -- new: project-scope chat entry point
    p/[projectSlug]/notes/[noteId]/page.tsx
                                         -- modify: mount ChatPanel in right side panel with page-scope

tests/
  api/chat.spec.ts                       -- new: Vitest API contract tests
  web/chat-scope.spec.ts                 -- new: Playwright E2E (auto-detect scope, add/remove chip, pin warning)
```

**File count rationale:** ~16 new files + 3 modifications. The chat UI is split by concern (ChipRow, AddChipCombobox, RagModeToggle, PinButton, etc.) so each component stays under ~100 lines and is independently testable.

---

## Plan 4 Q&A → Plan 11A Chat 마이그레이션

> **위치**: Task 0 실행 전에 반드시 읽고 숙지. 본 섹션은 Plan 4에 임시로 존재할 수 있는 `/api/qa/*` 엔드포인트를 Plan 11A의 canonical `conversations` 기반 chat API로 전환하는 정책이다.

- **현재 상태**: Plan 4 배포 시점 기준, 단순 `POST /api/qa/chat` 엔드포인트가 존재할 수 있다 (v0.1 임시). `conversations` 테이블은 아직 없고, in-memory 또는 stub 테이블에서 동작한다 (`api-contract.md:171` 참고).
- **병행 운영 기간**: **없음.** Plan 11A 배포와 동시에 `/api/qa/*`를 제거한다. 두 시스템을 겹쳐 운영하지 않는다 — chip 스코프·권한·pin 경고는 /api/qa에 역포팅되지 않으므로 병행은 보안적으로도 부적절.
- **데이터 이관**: 기존 `/api/qa` 호출 기록은 테스트/개발용이므로 **이관하지 않는다**. `conversations` · `conversation_messages` · `pinned_answers` 테이블은 Plan 11A에서 처음 생성되는 canonical 스키마이며, 이전 데이터는 버린다.
- **프론트엔드**: Plan 4 단계에서 `/api/qa`를 호출하던 UI는 Plan 11A 배포 시 chip 기반 UI (`<ChipRow>` + `<ChatPanel>`)로 **일괄 교체**. 과도기에는 feature flag (예: `NEXT_PUBLIC_CHAT_V1=true`)로 전환하여 롤백 경로를 확보한다.
- **API 버전**: `/api/qa`는 **공식 API가 아니며 internal**로 간주 (api-contract에 stable endpoint로 문서화하지 않는다). `/api/chat/*`가 첫 공식 대화 API이며, Plan 11B/11C까지 확장되어도 계약이 유지된다.

---

## Task 0: Branch & Worktree Setup

- [ ] **Step 1: Create worktree**

```bash
git worktree add ../opencairn-monorepo-plan11a -b feat/plan-11a-chat-scope main
cd ../opencairn-monorepo-plan11a
```

- [ ] **Step 2: Verify clean state**

Run: `git status`
Expected: `nothing to commit, working tree clean` on `feat/plan-11a-chat-scope`.

---

## Task 1: DB Schema — conversations + messages + pinned_answers

**Files:**
- Create: `packages/db/src/schema/conversations.ts`
- Modify: `packages/db/src/schema/index.ts` (export new tables)
- Test: `packages/db/tests/schema/conversations.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/tests/schema/conversations.spec.ts
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../helpers/test-db";
import { conversations, conversationMessages, pinnedAnswers } from "../../src/schema";

describe("conversations schema", () => {
  it("creates a conversation with workspace_id and scope columns", async () => {
    const [row] = await db.insert(conversations).values({
      workspaceId: "00000000-0000-0000-0000-000000000001",
      ownerUserId: "user_test",
      title: "test convo",
      scopeType: "page",
      scopeId: "00000000-0000-0000-0000-000000000010",
      attachedChips: [{ type: "page", id: "00000000-0000-0000-0000-000000000010", manual: false }],
      ragMode: "strict",
      memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
    }).returning();
    expect(row.id).toBeDefined();
    expect(row.totalCostKrw).toBe("0");
  });

  it("cascades delete from workspace", async () => {
    // covered by FK; assertion pattern is repo-standard
  });

  it("inserts a message with citations", async () => {
    const [row] = await db.insert(conversationMessages).values({
      conversationId: "<insert convo first then use id>",
      role: "assistant",
      content: "answer",
      citations: [{ source_type: "note", source_id: "abc", snippet: "..." }],
      tokensIn: 100, tokensOut: 50, costKrw: "0.5",
    }).returning();
    expect(row.citations).toEqual([{ source_type: "note", source_id: "abc", snippet: "..." }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @opencairn/db test conversations.spec`
Expected: FAIL — `Cannot find module '../../src/schema/conversations'` or "conversations table does not exist".

- [ ] **Step 3: Write the schema**

```ts
// packages/db/src/schema/conversations.ts
import { pgTable, uuid, text, jsonb, bigint, numeric, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./users";
import { notes } from "./notes";

export const scopeTypeEnum = pgEnum("scope_type", ["page", "project", "workspace"]);
export const ragModeEnum = pgEnum("rag_mode", ["strict", "expand"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  scopeType: scopeTypeEnum("scope_type").notNull(),
  scopeId: text("scope_id").notNull(),
  attachedChips: jsonb("attached_chips").$type<AttachedChip[]>().notNull().default([]),
  ragMode: ragModeEnum("rag_mode").notNull().default("strict"),
  memoryFlags: jsonb("memory_flags").$type<MemoryFlags>().notNull().default({
    l3_global: true, l3_workspace: true, l4: true, l2: false,
  }),
  sessionMemoryMd: text("session_memory_md"),       // L1 lossless extract — populated by Plan 11B
  fullSummary: text("full_summary"),                 // L1 lossy compaction — Plan 11B
  totalTokensIn: bigint("total_tokens_in", { mode: "number" }).notNull().default(0),
  totalTokensOut: bigint("total_tokens_out", { mode: "number" }).notNull().default(0),
  totalCostKrw: numeric("total_cost_krw", { precision: 12, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOwnerRecent: index("conversations_owner_recent_idx").on(t.workspaceId, t.ownerUserId, t.updatedAt),
  byScopeRecent: index("conversations_scope_recent_idx").on(t.scopeType, t.scopeId, t.updatedAt),
}));

export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
  tokensIn: bigint("tokens_in", { mode: "number" }),
  tokensOut: bigint("tokens_out", { mode: "number" }),
  costKrw: numeric("cost_krw", { precision: 12, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byConvoTime: index("messages_convo_time_idx").on(t.conversationId, t.createdAt),
}));

export const pinnedAnswers = pgTable("pinned_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => conversationMessages.id, { onDelete: "cascade" }),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  blockId: text("block_id").notNull(),
  pinnedBy: text("pinned_by").notNull().references(() => users.id),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byNote: index("pinned_answers_note_idx").on(t.noteId),
}));

// Inline TS types — canonical Zod schemas live in packages/shared/src/chat.ts (Task 2)
export type AttachedChip = {
  type: "page" | "project" | "workspace" | "memory:l3" | "memory:l4" | "memory:l2";
  id: string;
  label?: string;
  manual: boolean;
};
export type Citation = {
  source_type: "note" | "concept" | "external";
  source_id: string;
  snippet: string;
  locator?: { page?: number; line_range?: [number, number]; start_ms?: number; end_ms?: number };
};
export type MemoryFlags = {
  l3_global: boolean;
  l3_workspace: boolean;
  l4: boolean;
  l2: boolean;
};
```

- [ ] **Step 4: Export from index**

```ts
// packages/db/src/schema/index.ts (add at end of file)
export * from "./conversations";
```

- [ ] **Step 5: Generate + apply migration**

Run: `pnpm db:generate`
Expected: new migration file appears in `packages/db/drizzle/`.

Run: `pnpm db:migrate`
Expected: `applied N migration(s)`. No errors.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @opencairn/db test conversations.spec`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): add conversations, conversation_messages, pinned_answers tables"
```

---

## Task 2: Shared Zod Schemas

**Files:**
- Create: `packages/shared/src/chat.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/chat.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/chat.spec.ts
import { describe, it, expect } from "vitest";
import { AttachedChipSchema, CreateConversationBodySchema, MemoryFlagsSchema } from "../src/chat";

describe("chat shared schemas", () => {
  it("rejects unknown chip type", () => {
    const r = AttachedChipSchema.safeParse({ type: "garbage", id: "x", manual: true });
    expect(r.success).toBe(false);
  });
  it("accepts a page chip", () => {
    const r = AttachedChipSchema.safeParse({ type: "page", id: "uuid", manual: false });
    expect(r.success).toBe(true);
  });
  it("requires scope_id when creating a conversation", () => {
    const r = CreateConversationBodySchema.safeParse({
      workspaceId: "ws", scopeType: "page", attachedChips: [], memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
    });
    expect(r.success).toBe(false);
  });
  it("defaults ragMode to strict", () => {
    const r = CreateConversationBodySchema.parse({
      workspaceId: "ws", scopeType: "workspace", scopeId: "ws", attachedChips: [],
      memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
    });
    expect(r.ragMode).toBe("strict");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `pnpm --filter @opencairn/shared test chat.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the schemas**

```ts
// packages/shared/src/chat.ts
import { z } from "zod";

export const ScopeTypeSchema = z.enum(["page", "project", "workspace"]);
export const RagModeSchema = z.enum(["strict", "expand"]);
export const ChipTypeSchema = z.enum(["page", "project", "workspace", "memory:l3", "memory:l4", "memory:l2"]);

export const AttachedChipSchema = z.object({
  type: ChipTypeSchema,
  id: z.string().min(1),
  label: z.string().optional(),
  manual: z.boolean(),
});

export const MemoryFlagsSchema = z.object({
  l3_global: z.boolean(),
  l3_workspace: z.boolean(),
  l4: z.boolean(),
  l2: z.boolean(),
});

export const CitationSchema = z.object({
  source_type: z.enum(["note", "concept", "external"]),
  source_id: z.string(),
  snippet: z.string(),
  locator: z.object({
    page: z.number().int().optional(),
    line_range: z.tuple([z.number().int(), z.number().int()]).optional(),
    start_ms: z.number().int().optional(),
    end_ms: z.number().int().optional(),
  }).optional(),
});

export const CreateConversationBodySchema = z.object({
  workspaceId: z.string().uuid(),
  scopeType: ScopeTypeSchema,
  scopeId: z.string().min(1),
  attachedChips: z.array(AttachedChipSchema),
  ragMode: RagModeSchema.default("strict"),
  memoryFlags: MemoryFlagsSchema,
  title: z.string().max(200).optional(),
});

export const PatchConversationBodySchema = z.object({
  ragMode: RagModeSchema.optional(),
  memoryFlags: MemoryFlagsSchema.optional(),
  title: z.string().max(200).optional(),
});

export const SendMessageBodySchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1),
});

export const PinBodySchema = z.object({
  noteId: z.string().uuid(),
  blockId: z.string().min(1),
});

export type AttachedChip = z.infer<typeof AttachedChipSchema>;
export type MemoryFlags = z.infer<typeof MemoryFlagsSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type CreateConversationBody = z.infer<typeof CreateConversationBodySchema>;
export type PatchConversationBody = z.infer<typeof PatchConversationBodySchema>;
export type SendMessageBody = z.infer<typeof SendMessageBodySchema>;
export type PinBody = z.infer<typeof PinBodySchema>;
```

- [ ] **Step 4: Export from shared index**

```ts
// packages/shared/src/index.ts (add)
export * from "./chat";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @opencairn/shared test chat.spec`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add chat Zod schemas (chip, scope, message, pin)"
```

---

## Task 3: API — Conversation CRUD Routes

**Files:**
- Create: `apps/api/src/routes/chat.ts` (partial — CRUD only; chips/pin/message added in later tasks)
- Create: `apps/api/src/lib/chat-scope.ts`
- Modify: `apps/api/src/index.ts` (mount router)
- Test: `tests/api/chat.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/chat.spec.ts
import { describe, it, expect } from "vitest";
import { testApp, asUser, seedWorkspace } from "./helpers";

describe("POST /api/chat/conversations", () => {
  it("creates a conversation with auto-attached page chip", async () => {
    const { workspaceId, pageId } = await seedWorkspace();
    const res = await testApp.request("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asUser("u1") },
      body: JSON.stringify({
        workspaceId, scopeType: "page", scopeId: pageId,
        attachedChips: [{ type: "page", id: pageId, manual: false }],
        memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.attachedChips[0].id).toBe(pageId);
    expect(body.ragMode).toBe("strict");
  });

  it("rejects scope_id from a different workspace", async () => {
    const { workspaceId } = await seedWorkspace();
    const { pageId: foreignPage } = await seedWorkspace();
    const res = await testApp.request("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asUser("u1") },
      body: JSON.stringify({
        workspaceId, scopeType: "page", scopeId: foreignPage,
        attachedChips: [], memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
      }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 when no session", async () => {
    const res = await testApp.request("/api/chat/conversations", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/chat/conversations/:id", () => {
  it("updates ragMode and memoryFlags", async () => {
    const { conversationId } = await seedConversation("u1");
    const res = await testApp.request(`/api/chat/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...asUser("u1") },
      body: JSON.stringify({ ragMode: "expand" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ragMode).toBe("expand");
  });

  it("only owner can patch", async () => {
    const { conversationId } = await seedConversation("u1");
    const res = await testApp.request(`/api/chat/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...asUser("u2") },
      body: JSON.stringify({ ragMode: "expand" }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `pnpm --filter @opencairn/api test chat.spec`
Expected: FAIL — route does not exist (404 instead of 201/403).

- [ ] **Step 3: Write the scope validator helper**

```ts
// apps/api/src/lib/chat-scope.ts
import { db } from "../db";
import { notes, projects, workspaces } from "@opencairn/db/schema";
import { eq } from "drizzle-orm";
import type { ScopeType } from "@opencairn/shared";

/**
 * Verify scope_id belongs to workspace_id and resolve its display label.
 * Returns the canonical label or throws { status: 403, message: "scope outside workspace" }.
 */
export async function validateScope(
  workspaceId: string,
  scopeType: ScopeType,
  scopeId: string
): Promise<{ label: string }> {
  if (scopeType === "workspace") {
    if (scopeId !== workspaceId) throw { status: 403, message: "scope outside workspace" };
    const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws) throw { status: 404, message: "workspace not found" };
    return { label: ws.name };
  }
  if (scopeType === "project") {
    const [p] = await db.select({ name: projects.name, workspaceId: projects.workspaceId })
      .from(projects).where(eq(projects.id, scopeId));
    if (!p || p.workspaceId !== workspaceId) throw { status: 403, message: "scope outside workspace" };
    return { label: p.name };
  }
  // page
  const [n] = await db.select({ title: notes.title, workspaceId: notes.workspaceId })
    .from(notes).where(eq(notes.id, scopeId));
  if (!n || n.workspaceId !== workspaceId) throw { status: 403, message: "scope outside workspace" };
  return { label: n.title ?? "Untitled" };
}
```

- [ ] **Step 4: Write the chat router (CRUD only)**

```ts
// apps/api/src/routes/chat.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { conversations } from "@opencairn/db/schema";
import { CreateConversationBodySchema, PatchConversationBodySchema } from "@opencairn/shared";
import { canRead } from "../lib/permissions";
import { validateScope } from "../lib/chat-scope";

export const chatRoutes = new Hono<{ Variables: { userId: string } }>();

// All routes require auth middleware that sets c.var.userId; assume installed in apps/api/src/index.ts.

chatRoutes.post("/conversations", zValidator("json", CreateConversationBodySchema), async (c) => {
  const userId = c.var.userId;
  const body = c.req.valid("json");

  // Workspace membership check
  const ok = await canRead(userId, { type: "workspace", id: body.workspaceId });
  if (!ok) return c.json({ error: "forbidden" }, 403);

  // Scope validation (also enforces workspace boundary)
  try {
    await validateScope(body.workspaceId, body.scopeType, body.scopeId);
  } catch (e: any) {
    return c.json({ error: e.message }, e.status ?? 400);
  }

  const [row] = await db.insert(conversations).values({
    workspaceId: body.workspaceId,
    ownerUserId: userId,
    title: body.title,
    scopeType: body.scopeType,
    scopeId: body.scopeId,
    attachedChips: body.attachedChips,
    ragMode: body.ragMode,
    memoryFlags: body.memoryFlags,
  }).returning();
  return c.json(row, 201);
});

chatRoutes.patch("/conversations/:id", zValidator("json", PatchConversationBodySchema), async (c) => {
  const userId = c.var.userId;
  const id = c.req.param("id");
  const [existing] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!existing) return c.json({ error: "not found" }, 404);
  if (existing.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);

  const body = c.req.valid("json");
  const [row] = await db.update(conversations)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  return c.json(row);
});

chatRoutes.get("/conversations/:id", async (c) => {
  const userId = c.var.userId;
  const id = c.req.param("id");
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);
  return c.json(row);
});

chatRoutes.get("/conversations", async (c) => {
  const userId = c.var.userId;
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) return c.json({ error: "workspaceId required" }, 400);
  const ok = await canRead(userId, { type: "workspace", id: workspaceId });
  if (!ok) return c.json({ error: "forbidden" }, 403);
  const rows = await db.select().from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.ownerUserId, userId)));
  return c.json(rows);
});
```

- [ ] **Step 5: Mount the router**

```ts
// apps/api/src/index.ts (add)
import { chatRoutes } from "./routes/chat";
// ... after existing routes:
app.route("/api/chat", chatRoutes);
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @opencairn/api test chat.spec`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api packages
git commit -m "feat(api): conversation CRUD routes with scope + workspace boundary checks"
```

---

## Task 4: API — Chip Add/Remove Routes

**Files:**
- Modify: `apps/api/src/routes/chat.ts` (append chip routes)
- Test: `tests/api/chat.spec.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/chat.spec.ts (append)
describe("POST /api/chat/conversations/:id/chips", () => {
  it("adds a manual page chip", async () => {
    const { conversationId, workspaceId } = await seedConversation("u1");
    const { pageId } = await seedPage(workspaceId);
    const res = await testApp.request(`/api/chat/conversations/${conversationId}/chips`, {
      method: "POST", headers: { "Content-Type": "application/json", ...asUser("u1") },
      body: JSON.stringify({ type: "page", id: pageId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attachedChips.find((c: any) => c.id === pageId && c.manual === true)).toBeTruthy();
  });

  it("rejects chip pointing to another workspace", async () => {
    const { conversationId } = await seedConversation("u1");
    const { pageId: foreign } = await seedPage();   // different workspace
    const res = await testApp.request(`/api/chat/conversations/${conversationId}/chips`, {
      method: "POST", headers: { "Content-Type": "application/json", ...asUser("u1") },
      body: JSON.stringify({ type: "page", id: foreign }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/chat/conversations/:id/chips/:chipKey", () => {
  it("removes a chip by composite key (type:id)", async () => {
    const { conversationId, workspaceId } = await seedConversation("u1");
    const { pageId } = await seedPage(workspaceId);
    await testApp.request(`/api/chat/conversations/${conversationId}/chips`, {
      method: "POST", headers: { "Content-Type": "application/json", ...asUser("u1") },
      body: JSON.stringify({ type: "page", id: pageId }),
    });
    const res = await testApp.request(`/api/chat/conversations/${conversationId}/chips/page:${pageId}`, {
      method: "DELETE", headers: { ...asUser("u1") },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attachedChips.find((c: any) => c.id === pageId)).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `pnpm --filter @opencairn/api test chat.spec`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Implement chip routes**

```ts
// apps/api/src/routes/chat.ts (append, before export)
import { z } from "zod";
import { ChipTypeSchema, AttachedChipSchema } from "@opencairn/shared";

const AddChipBodySchema = z.object({
  type: ChipTypeSchema,
  id: z.string().min(1),
});

chatRoutes.post("/conversations/:id/chips", zValidator("json", AddChipBodySchema), async (c) => {
  const userId = c.var.userId;
  const id = c.req.param("id");
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!convo) return c.json({ error: "not found" }, 404);
  if (convo.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);

  const { type, id: chipId } = c.req.valid("json");

  // Validate the chip target lives in the same workspace
  if (type === "page" || type === "project" || type === "workspace") {
    try {
      const { label } = await validateScope(convo.workspaceId, type as any, chipId);
      const next = dedupeChips([...convo.attachedChips, { type, id: chipId, label, manual: true }]);
      const [row] = await db.update(conversations)
        .set({ attachedChips: next, updatedAt: new Date() })
        .where(eq(conversations.id, id))
        .returning();
      return c.json(row);
    } catch (e: any) {
      return c.json({ error: e.message }, e.status ?? 400);
    }
  }

  // Memory chips (l3/l4/l2) are validated in Plan 11B; in 11A accept-and-store as-is
  // (UI does not yet show them — flag in code review)
  const next = dedupeChips([...convo.attachedChips, { type, id: chipId, manual: true }]);
  const [row] = await db.update(conversations)
    .set({ attachedChips: next, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  return c.json(row);
});

chatRoutes.delete("/conversations/:id/chips/:chipKey", async (c) => {
  const userId = c.var.userId;
  const id = c.req.param("id");
  const chipKey = c.req.param("chipKey");
  const [type, chipId] = chipKey.split(":", 2);
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!convo) return c.json({ error: "not found" }, 404);
  if (convo.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);
  const next = convo.attachedChips.filter((c: any) => !(c.type === type && c.id === chipId));
  const [row] = await db.update(conversations)
    .set({ attachedChips: next, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  return c.json(row);
});

function dedupeChips(arr: any[]): any[] {
  const seen = new Set<string>();
  return arr.filter((c) => {
    const k = `${c.type}:${c.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @opencairn/api test chat.spec`
Expected: All chip tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): conversation chip add/remove with workspace boundary check"
```

---

## Task 5: API — Pin Route + Permission Warning

**Files:**
- Create: `apps/api/src/lib/pin-permissions.ts`
- Modify: `apps/api/src/routes/chat.ts` (append pin routes)
- Modify: `packages/db/src/schema/index.ts` (already exported pinnedAnswers from Task 1 — no change)
- Test: `tests/api/chat.spec.ts` (append)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/chat.spec.ts (append)
describe("POST /api/chat/messages/:id/pin", () => {
  it("pins immediately when no permission delta", async () => {
    const { messageId, noteId } = await seedMessageWithCitation({
      ownerId: "u1", citedNoteIsPublic: true, targetPageIsPublic: true,
    });
    const res = await testApp.request(`/api/chat/messages/${messageId}/pin`, {
      method: "POST", headers: { "Content-Type": "application/json", ...asUser("u1") },
      body: JSON.stringify({ noteId, blockId: "b1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pinned).toBe(true);
  });

  it("returns 409 + warning when citation is hidden from target page viewers", async () => {
    const { messageId, noteId } = await seedMessageWithCitation({
      ownerId: "u1", citedNoteIsPublic: false, targetPageIsPublic: true,
    });
    const res = await testApp.request(`/api/chat/messages/${messageId}/pin`, {
      method: "POST", headers: { "Content-Type": "application/json", ...asUser("u1") },
      body: JSON.stringify({ noteId, blockId: "b1" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.requireConfirm).toBe(true);
    expect(body.warning.hiddenSources.length).toBeGreaterThan(0);
    expect(body.warning.hiddenUsers.length).toBeGreaterThan(0);
  });
});

describe("POST /api/chat/messages/:id/pin/confirm", () => {
  it("force-pins after warning", async () => {
    const { messageId, noteId } = await seedMessageWithCitation({
      ownerId: "u1", citedNoteIsPublic: false, targetPageIsPublic: true,
    });
    const res = await testApp.request(`/api/chat/messages/${messageId}/pin/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json", ...asUser("u1") },
      body: JSON.stringify({ noteId, blockId: "b1" }),
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Expected: 3 new tests FAIL — `404 Not Found`.

- [ ] **Step 3: Write the pin-permissions helper**

```ts
// apps/api/src/lib/pin-permissions.ts
import { db } from "../db";
import { workspaceMembers, pagePermissions, projectPermissions, notes } from "@opencairn/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { resolveRole } from "./permissions";
import type { Citation } from "@opencairn/shared";

export type PinDelta = {
  hiddenSources: { sourceType: string; sourceId: string; snippet: string }[];
  hiddenUsers: { userId: string; reason: string }[];
};

/**
 * Compute the visibility delta if `message` (with `citations`) is pinned to `targetPageId`.
 * Returns sources cited but not visible to *some* user who can read the target page.
 */
export async function computePinDelta(
  citations: Citation[],
  targetPageId: string
): Promise<PinDelta> {
  const [note] = await db.select({ workspaceId: notes.workspaceId }).from(notes).where(eq(notes.id, targetPageId));
  if (!note) throw { status: 404, message: "target page not found" };

  // viewer+ users for the target page = workspace members who resolveRole !== "none"
  const members = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, note.workspaceId));

  const viewerUsers: string[] = [];
  for (const m of members) {
    const role = await resolveRole(m.userId, { type: "note", id: targetPageId });
    if (role !== "none") viewerUsers.push(m.userId);
  }

  const hiddenSources: PinDelta["hiddenSources"] = [];
  const hiddenUserSet = new Set<string>();

  for (const cite of citations) {
    if (cite.source_type !== "note") continue; // external/concept citations have no permission
    let sourceVisibleToAll = true;
    for (const u of viewerUsers) {
      const role = await resolveRole(u, { type: "note", id: cite.source_id });
      if (role === "none") {
        sourceVisibleToAll = false;
        hiddenUserSet.add(u);
      }
    }
    if (!sourceVisibleToAll) {
      hiddenSources.push({ sourceType: cite.source_type, sourceId: cite.source_id, snippet: cite.snippet });
    }
  }

  return {
    hiddenSources,
    hiddenUsers: Array.from(hiddenUserSet).map((userId) => ({ userId, reason: "no_access_to_cited_source" })),
  };
}
```

- [ ] **Step 4: Implement pin routes**

```ts
// apps/api/src/routes/chat.ts (append)
import { conversationMessages, pinnedAnswers, activityEvents } from "@opencairn/db/schema";
import { canWrite } from "../lib/permissions";
import { computePinDelta } from "../lib/pin-permissions";
import { PinBodySchema } from "@opencairn/shared";

async function doPin(opts: { userId: string; messageId: string; noteId: string; blockId: string; reason: string }) {
  await db.insert(pinnedAnswers).values({
    messageId: opts.messageId,
    noteId: opts.noteId,
    blockId: opts.blockId,
    pinnedBy: opts.userId,
  });
  await db.insert(activityEvents).values({
    workspaceId: (await db.select({ wsId: notes.workspaceId }).from(notes).where(eq(notes.id, opts.noteId)))[0].wsId,
    actorId: opts.userId,
    actorType: "user",
    verb: "pinned_answer",
    objectType: "note",
    objectId: opts.noteId,
    reason: opts.reason,
  });
}

chatRoutes.post("/messages/:id/pin", zValidator("json", PinBodySchema), async (c) => {
  const userId = c.var.userId;
  const messageId = c.req.param("id");
  const { noteId, blockId } = c.req.valid("json");

  const [msg] = await db.select().from(conversationMessages).where(eq(conversationMessages.id, messageId));
  if (!msg) return c.json({ error: "message not found" }, 404);
  // owner check via conversation
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, msg.conversationId));
  if (convo.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);

  if (!(await canWrite(userId, { type: "note", id: noteId }))) {
    return c.json({ error: "no write permission on target page" }, 403);
  }

  const delta = await computePinDelta(msg.citations as Citation[], noteId);
  if (delta.hiddenSources.length > 0) {
    return c.json({ requireConfirm: true, warning: delta }, 409);
  }
  await doPin({ userId, messageId, noteId, blockId, reason: "no_permission_delta" });
  return c.json({ pinned: true });
});

chatRoutes.post("/messages/:id/pin/confirm", zValidator("json", PinBodySchema), async (c) => {
  const userId = c.var.userId;
  const messageId = c.req.param("id");
  const { noteId, blockId } = c.req.valid("json");

  const [msg] = await db.select().from(conversationMessages).where(eq(conversationMessages.id, messageId));
  if (!msg) return c.json({ error: "message not found" }, 404);
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, msg.conversationId));
  if (convo.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);
  if (!(await canWrite(userId, { type: "note", id: noteId }))) {
    return c.json({ error: "no write permission on target page" }, 403);
  }

  await doPin({ userId, messageId, noteId, blockId, reason: "user_confirmed_permission_warning" });
  return c.json({ pinned: true });
});
```

- [ ] **Step 5: Run tests**

Expected: PASS (3 pin tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): pin answer to page with citation visibility delta warning"
```

---

## Task 6: API — Message SSE with Citations + Cost Event

**Files:**
- Create: `apps/api/src/lib/cost.ts`
- Modify: `apps/api/src/routes/chat.ts` (append SSE message route)
- Test: `tests/api/chat.spec.ts` (append)

> **Note:** This task ships a *minimal* SSE pipeline that returns one canned assistant message and emits the `cost` event. The actual LLM-backed retrieval/generation lives in the Plan 4 worker; wiring it is out of scope for 11A. We just need the contract to exist so the web client can be built and tested.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/chat.spec.ts (append)
describe("POST /api/chat/message (SSE)", () => {
  it("emits delta + cost events and persists the message", async () => {
    const { conversationId } = await seedConversation("u1");
    const res = await testApp.request("/api/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...asUser("u1") },
      body: JSON.stringify({ conversationId, content: "hello" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: delta");
    expect(text).toContain("event: cost");
    expect(text).toContain("event: done");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Expected: 404.

- [ ] **Step 3: Write the cost helper**

```ts
// apps/api/src/lib/cost.ts
// Conversion: $1 = ₩1,650 (locked in billing-model.md 2026-04-19)
const USD_TO_KRW = 1650;
// Gemini 2.5 Flash placeholder rates ($/1M tokens) — refine per provider in Plan 11B
const RATES_USD_PER_1M = {
  in: 0.075,
  out: 0.30,
};

export function tokensToKrw(tokensIn: number, tokensOut: number): number {
  const usd = (tokensIn / 1_000_000) * RATES_USD_PER_1M.in + (tokensOut / 1_000_000) * RATES_USD_PER_1M.out;
  return Number((usd * USD_TO_KRW).toFixed(4));
}
```

- [ ] **Step 4: Implement the SSE message route**

```ts
// apps/api/src/routes/chat.ts (append)
import { streamSSE } from "hono/streaming";
import { SendMessageBodySchema } from "@opencairn/shared";
import { tokensToKrw } from "../lib/cost";
import { sql } from "drizzle-orm";

chatRoutes.post("/message", zValidator("json", SendMessageBodySchema), async (c) => {
  const userId = c.var.userId;
  const { conversationId, content } = c.req.valid("json");

  const [convo] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!convo) return c.json({ error: "not found" }, 404);
  if (convo.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);

  // Persist user message
  const tokensInUser = Math.ceil(content.length / 4); // crude estimate; replaced when worker integrates
  const userCostKrw = tokensToKrw(tokensInUser, 0);
  await db.insert(conversationMessages).values({
    conversationId, role: "user", content,
    tokensIn: tokensInUser, tokensOut: 0, costKrw: String(userCostKrw),
  });

  return streamSSE(c, async (stream) => {
    // 11A placeholder: echo back a canned assistant response.
    // Plan 4 (worker) replaces this with real LLM stream + retrieval.
    const reply = "(11A placeholder reply)";
    for (const ch of reply) {
      await stream.writeSSE({ event: "delta", data: JSON.stringify({ delta: ch }) });
      await stream.sleep(5);
    }
    const tokensOut = Math.ceil(reply.length / 4);
    const costKrw = tokensToKrw(0, tokensOut);
    const [assistant] = await db.insert(conversationMessages).values({
      conversationId, role: "assistant", content: reply,
      citations: [], tokensIn: 0, tokensOut, costKrw: String(costKrw),
    }).returning();
    await db.update(conversations).set({
      totalTokensIn: sql`${conversations.totalTokensIn} + ${tokensInUser}`,
      totalTokensOut: sql`${conversations.totalTokensOut} + ${tokensOut}`,
      totalCostKrw: sql`${conversations.totalCostKrw} + ${userCostKrw + costKrw}`,
      updatedAt: new Date(),
    }).where(eq(conversations.id, conversationId));

    await stream.writeSSE({
      event: "cost",
      data: JSON.stringify({ messageId: assistant.id, tokensIn: 0, tokensOut, costKrw }),
    });
    await stream.writeSSE({ event: "done", data: "{}" });
  });
});
```

- [ ] **Step 5: Run tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): SSE message endpoint with cost event (placeholder generation)"
```

---

## Task 7: Web — useScopeContext Hook

**Files:**
- Create: `apps/web/src/hooks/useScopeContext.ts`
- Test: `apps/web/tests/hooks/useScopeContext.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/tests/hooks/useScopeContext.spec.tsx
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useScopeContext } from "../../src/hooks/useScopeContext";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/w/acme/p/thesis/notes/note_123",
  useParams: () => ({ workspaceSlug: "acme", projectSlug: "thesis", noteId: "note_123" }),
}));

describe("useScopeContext", () => {
  it("returns page scope when on a note route", () => {
    const { result } = renderHook(() => useScopeContext());
    expect(result.current.scopeType).toBe("page");
    expect(result.current.scopeId).toBe("note_123");
    expect(result.current.initialChips).toContainEqual(
      expect.objectContaining({ type: "page", id: "note_123", manual: false })
    );
  });
});

// Add similar tests for /app/w/acme/p/thesis/chat → project scope, /app/w/acme/chat → workspace scope.
```

- [ ] **Step 2: Run to verify FAIL**

Run: `pnpm --filter @opencairn/web test useScopeContext`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// apps/web/src/hooks/useScopeContext.ts
"use client";
import { useParams, usePathname } from "next/navigation";
import type { AttachedChip, ScopeType } from "@opencairn/shared";

export function useScopeContext(): {
  scopeType: ScopeType;
  scopeId: string;
  workspaceId: string;
  initialChips: AttachedChip[];
} {
  const params = useParams<{ workspaceSlug?: string; projectSlug?: string; noteId?: string }>();
  const pathname = usePathname();
  // workspaceId is resolved server-side from slug; in client we pass slug downstream and let server resolve.
  const workspaceId = params.workspaceSlug ?? "";

  if (params.noteId) {
    return {
      scopeType: "page",
      scopeId: params.noteId,
      workspaceId,
      initialChips: [{ type: "page", id: params.noteId, manual: false }],
    };
  }
  if (params.projectSlug) {
    return {
      scopeType: "project",
      scopeId: params.projectSlug,
      workspaceId,
      initialChips: [{ type: "project", id: params.projectSlug, manual: false }],
    };
  }
  // /app/w/<slug>/chat → workspace
  return {
    scopeType: "workspace",
    scopeId: workspaceId,
    workspaceId,
    initialChips: [{ type: "workspace", id: workspaceId, manual: false }],
  };
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): useScopeContext hook auto-detects scope from route"
```

---

## Task 8: Web — Chip Components

**Files:**
- Create: `apps/web/src/components/chat/Chip.tsx`
- Create: `apps/web/src/components/chat/ChipRow.tsx`
- Create: `apps/web/src/components/chat/AddChipCombobox.tsx`
- Create: `apps/web/src/lib/token-estimate.ts`
- Test: `apps/web/tests/components/chat/ChipRow.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/tests/components/chat/ChipRow.spec.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChipRow } from "../../../src/components/chat/ChipRow";

describe("<ChipRow>", () => {
  it("renders one chip per attached item", () => {
    render(<ChipRow chips={[
      { type: "page", id: "p1", label: "RoPE", manual: false },
      { type: "project", id: "pr1", label: "Thesis", manual: true },
    ]} onRemove={() => {}} onAdd={() => {}} />);
    expect(screen.getByText("RoPE")).toBeInTheDocument();
    expect(screen.getByText("Thesis")).toBeInTheDocument();
  });

  it("calls onRemove with composite key when X clicked", () => {
    const onRemove = vi.fn();
    render(<ChipRow chips={[{ type: "page", id: "p1", label: "RoPE", manual: false }]} onRemove={onRemove} onAdd={() => {}} />);
    fireEvent.click(screen.getByLabelText("Remove RoPE"));
    expect(onRemove).toHaveBeenCalledWith("page:p1");
  });

  it("renders + button that opens combobox", () => {
    render(<ChipRow chips={[]} onRemove={() => {}} onAdd={() => {}} />);
    expect(screen.getByLabelText("Add context")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Expected: FAIL — components don't exist.

- [ ] **Step 3: Implement the token estimator**

```ts
// apps/web/src/lib/token-estimate.ts
// Naive 4-chars-per-token heuristic. Replaced with model-specific tokenizer in Plan 11B.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

- [ ] **Step 4: Implement Chip component**

```tsx
// apps/web/src/components/chat/Chip.tsx
"use client";
import type { AttachedChip } from "@opencairn/shared";
import { X } from "lucide-react";

const ICONS: Record<AttachedChip["type"], string> = {
  "page": "📄", "project": "📂", "workspace": "🌐",
  "memory:l3": "🧠", "memory:l4": "🏢", "memory:l2": "💬",
};

export function Chip({ chip, onRemove, tokenEstimate }: {
  chip: AttachedChip;
  onRemove: (key: string) => void;
  tokenEstimate?: number;
}) {
  const label = chip.label ?? chip.id.slice(0, 8);
  const key = `${chip.type}:${chip.id}`;
  const tooltip = tokenEstimate ? `~${(tokenEstimate / 1000).toFixed(1)}k tokens` : undefined;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-100 text-stone-800 text-sm border border-stone-200"
      title={tooltip}
      data-auto={!chip.manual}
    >
      <span aria-hidden>{ICONS[chip.type]}</span>
      <span>{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        className="ml-1 text-stone-400 hover:text-stone-700"
        onClick={() => onRemove(key)}
      >
        <X size={12} />
      </button>
    </span>
  );
}
```

- [ ] **Step 5: Implement ChipRow + AddChipCombobox**

```tsx
// apps/web/src/components/chat/ChipRow.tsx
"use client";
import type { AttachedChip } from "@opencairn/shared";
import { Chip } from "./Chip";
import { AddChipCombobox } from "./AddChipCombobox";

export function ChipRow({ chips, onAdd, onRemove }: {
  chips: AttachedChip[];
  onAdd: (chip: { type: AttachedChip["type"]; id: string }) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center px-2 py-1 border-b border-stone-200">
      {chips.map((c) => (
        <Chip key={`${c.type}:${c.id}`} chip={c} onRemove={onRemove} />
      ))}
      <AddChipCombobox onAdd={onAdd} />
    </div>
  );
}
```

```tsx
// apps/web/src/components/chat/AddChipCombobox.tsx
"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import type { AttachedChip } from "@opencairn/shared";

export function AddChipCombobox({ onAdd }: {
  onAdd: (chip: { type: AttachedChip["type"]; id: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ type: AttachedChip["type"]; id: string; label: string }[]>([]);

  async function search(term: string) {
    setQ(term);
    if (term.length < 2) return setResults([]);
    const r = await fetch(`/api/search/scope-targets?q=${encodeURIComponent(term)}`);
    if (r.ok) setResults(await r.json());
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Add context"
        className="px-1.5 py-0.5 text-stone-500 hover:text-stone-800 rounded-md border border-dashed border-stone-300"
        onClick={() => setOpen(!open)}
      >
        <Plus size={12} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-64 rounded-md bg-white shadow-md border border-stone-200">
          <input
            autoFocus
            value={q}
            onChange={(e) => search(e.target.value)}
            placeholder="Search pages, projects…"
            className="w-full px-2 py-1.5 border-b border-stone-200 text-sm outline-none"
          />
          <ul className="max-h-64 overflow-auto">
            {results.map((r) => (
              <li key={`${r.type}:${r.id}`}>
                <button
                  type="button"
                  className="w-full text-left px-2 py-1 hover:bg-stone-50 text-sm"
                  onClick={() => { onAdd({ type: r.type, id: r.id }); setOpen(false); setQ(""); setResults([]); }}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

> **Note:** the `/api/search/scope-targets` endpoint is a thin search that returns pages + projects in the current workspace by name match. Add a minimal implementation in `apps/api/src/routes/search.ts` if it doesn't exist; spec it as: `GET /api/search/scope-targets?workspaceId=&q=` returning `[{type, id, label}]`. Treat that endpoint as part of this task — write a failing test in `tests/api/search.spec.ts` first; mirror the auth + workspace-scope pattern from chat routes.

- [ ] **Step 6: Run tests**

Expected: PASS (3 ChipRow tests + 1+ search endpoint tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web apps/api
git commit -m "feat(web): chip row + combobox; feat(api): scope target search"
```

---

## Task 9: Web — RAG Mode Toggle

**Files:**
- Create: `apps/web/src/components/chat/RagModeToggle.tsx`
- Test: `apps/web/tests/components/chat/RagModeToggle.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RagModeToggle } from "../../../src/components/chat/RagModeToggle";

describe("<RagModeToggle>", () => {
  it("renders current mode", () => {
    render(<RagModeToggle mode="strict" onChange={() => {}} />);
    expect(screen.getByText(/Strict/i)).toBeInTheDocument();
  });
  it("calls onChange when expand selected", () => {
    const onChange = vi.fn();
    render(<RagModeToggle mode="strict" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText(/Expand/i));
    expect(onChange).toHaveBeenCalledWith("expand");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/chat/RagModeToggle.tsx
"use client";
import { useState } from "react";
import { ChevronDown, Target, Globe } from "lucide-react";

export function RagModeToggle({ mode, onChange }: {
  mode: "strict" | "expand";
  onChange: (m: "strict" | "expand") => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative ml-auto">
      <button
        type="button"
        className="flex items-center gap-1 px-2 py-0.5 text-sm text-stone-700 hover:bg-stone-50 rounded"
        onClick={() => setOpen(!open)}
      >
        {mode === "strict" ? <Target size={12} /> : <Globe size={12} />}
        <span>{mode === "strict" ? "Strict" : "Expand"}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-md bg-white shadow-md border border-stone-200 z-10">
          {(["strict", "expand"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="w-full text-left px-2 py-1.5 text-sm hover:bg-stone-50 flex items-center gap-1.5"
              onClick={() => { onChange(m); setOpen(false); }}
            >
              {m === "strict" ? <Target size={12} /> : <Globe size={12} />}
              <span>{m === "strict" ? "Strict — chips only" : "Expand — fall back to workspace"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm --filter @opencairn/web test RagModeToggle
git add apps/web
git commit -m "feat(web): RAG mode toggle (Strict / Expand)"
```

---

## Task 10: Web — PinButton + PinPermissionModal

**Files:**
- Create: `apps/web/src/components/chat/PinButton.tsx`
- Create: `apps/web/src/components/chat/PinPermissionModal.tsx`
- Test: `apps/web/tests/components/chat/PinButton.spec.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PinButton } from "../../../src/components/chat/PinButton";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("<PinButton>", () => {
  it("pins immediately on 200", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ pinned: true }) });
    render(<PinButton messageId="m1" targetNoteId="n1" targetBlockId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pin/i }));
    await waitFor(() => expect(screen.getByText(/Pinned/i)).toBeInTheDocument());
  });

  it("shows confirmation modal on 409", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false, status: 409,
      json: async () => ({
        requireConfirm: true,
        warning: { hiddenSources: [{ sourceId: "x", snippet: "..." }], hiddenUsers: [{ userId: "u2" }] },
      }),
    });
    render(<PinButton messageId="m1" targetNoteId="n1" targetBlockId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pin/i }));
    await waitFor(() => expect(screen.getByText(/Pin anyway/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement PinPermissionModal**

```tsx
// apps/web/src/components/chat/PinPermissionModal.tsx
"use client";

export function PinPermissionModal({ warning, onCancel, onConfirm }: {
  warning: {
    hiddenSources: { sourceId: string; snippet: string }[];
    hiddenUsers: { userId: string }[];
  };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div role="dialog" aria-modal className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-md p-4 max-w-md w-full">
        <h2 className="font-semibold text-stone-900 mb-2">⚠ Citation visibility warning</h2>
        <p className="text-sm text-stone-700 mb-3">
          This answer cites <strong>{warning.hiddenSources.length}</strong> source(s) that are not visible to{" "}
          <strong>{warning.hiddenUsers.length}</strong> user(s) who can read the target page.
        </p>
        <p className="text-sm text-stone-700 mb-4">
          The pinned answer will still be visible. Continue?
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="px-3 py-1.5 rounded border border-stone-300" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="px-3 py-1.5 rounded bg-stone-900 text-white" onClick={onConfirm}>
            Pin anyway
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement PinButton**

```tsx
// apps/web/src/components/chat/PinButton.tsx
"use client";
import { useState } from "react";
import { Pin } from "lucide-react";
import { PinPermissionModal } from "./PinPermissionModal";

export function PinButton({ messageId, targetNoteId, targetBlockId }: {
  messageId: string;
  targetNoteId: string;
  targetBlockId: string;
}) {
  const [pinned, setPinned] = useState(false);
  const [warning, setWarning] = useState<any | null>(null);

  async function pin(confirm = false) {
    const url = confirm
      ? `/api/chat/messages/${messageId}/pin/confirm`
      : `/api/chat/messages/${messageId}/pin`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteId: targetNoteId, blockId: targetBlockId }),
    });
    if (res.status === 200) {
      setPinned(true);
      setWarning(null);
      return;
    }
    if (res.status === 409) {
      const body = await res.json();
      setWarning(body.warning);
      return;
    }
    // surface error toast (out of scope for 11A)
  }

  return (
    <>
      <button
        type="button"
        aria-label="Pin to page"
        className="text-sm text-stone-600 hover:text-stone-900 inline-flex items-center gap-1"
        onClick={() => pin(false)}
        disabled={pinned}
      >
        <Pin size={14} />
        <span>{pinned ? "Pinned" : "Pin"}</span>
      </button>
      {warning && (
        <PinPermissionModal
          warning={warning}
          onCancel={() => setWarning(null)}
          onConfirm={() => pin(true)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 5: Run tests + commit**

```bash
pnpm --filter @opencairn/web test PinButton
git add apps/web
git commit -m "feat(web): pin button with permission warning modal"
```

---

## Task 11: Web — Cost Badge + ChatPanel + ChatInput

**Files:**
- Create: `apps/web/src/components/chat/CostBadge.tsx`
- Create: `apps/web/src/components/chat/ChatInput.tsx`
- Create: `apps/web/src/components/chat/ChatPanel.tsx`
- Test: `apps/web/tests/components/chat/ChatPanel.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatPanel } from "../../../src/components/chat/ChatPanel";

vi.mock("../../../src/hooks/useScopeContext", () => ({
  useScopeContext: () => ({
    scopeType: "page", scopeId: "n1", workspaceId: "ws1",
    initialChips: [{ type: "page", id: "n1", label: "Test page", manual: false }],
  }),
}));

describe("<ChatPanel>", () => {
  it("creates a conversation on first send and shows the assistant reply with cost badge", async () => {
    let createCalled = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/chat/conversations") && !createCalled) {
        createCalled = true;
        return { ok: true, status: 201, json: async () => ({ id: "c1", attachedChips: [{ type: "page", id: "n1", label: "Test page", manual: false }], ragMode: "strict" }) };
      }
      if (url.endsWith("/api/chat/message")) {
        const body = [
          'event: delta\ndata: {"delta":"H"}\n\n',
          'event: delta\ndata: {"delta":"i"}\n\n',
          'event: cost\ndata: {"messageId":"m1","tokensIn":0,"tokensOut":2,"costKrw":0.0001}\n\n',
          'event: done\ndata: {}\n\n',
        ].join("");
        return { ok: true, status: 200, text: async () => body };
      }
      return { ok: false, status: 404 };
    }));

    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/How can I help/i), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(screen.getByText("Hi")).toBeInTheDocument());
    expect(screen.getByText(/원/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement CostBadge**

```tsx
// apps/web/src/components/chat/CostBadge.tsx
export function CostBadge({ costKrw }: { costKrw: number }) {
  const formatted = costKrw < 1 ? `${costKrw.toFixed(2)}원` : `${Math.round(costKrw)}원`;
  return (
    <span className="text-xs text-stone-500 ml-2" title={`Token cost: ${costKrw.toFixed(4)}원`}>
      −{formatted}
    </span>
  );
}
```

- [ ] **Step 4: Implement ChatInput**

```tsx
// apps/web/src/components/chat/ChatInput.tsx
"use client";
import { useState } from "react";
import type { AttachedChip } from "@opencairn/shared";
import { ChipRow } from "./ChipRow";
import { RagModeToggle } from "./RagModeToggle";

export function ChatInput({ chips, ragMode, onSend, onAddChip, onRemoveChip, onChangeRagMode, disabled }: {
  chips: AttachedChip[];
  ragMode: "strict" | "expand";
  onSend: (text: string) => void;
  onAddChip: (chip: { type: AttachedChip["type"]; id: string }) => void;
  onRemoveChip: (key: string) => void;
  onChangeRagMode: (m: "strict" | "expand") => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <div className="border border-stone-200 rounded-md">
      <div className="flex items-center">
        <ChipRow chips={chips} onAdd={onAddChip} onRemove={onRemoveChip} />
        <RagModeToggle mode={ragMode} onChange={onChangeRagMode} />
      </div>
      <div className="flex items-end gap-2 p-2">
        <textarea
          className="flex-1 resize-none outline-none text-sm"
          rows={2}
          placeholder="How can I help?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="px-3 py-1.5 bg-stone-900 text-white rounded text-sm disabled:opacity-50"
          disabled={disabled || text.trim().length === 0}
          onClick={() => { onSend(text); setText(""); }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement ChatPanel**

```tsx
// apps/web/src/components/chat/ChatPanel.tsx
"use client";
import { useState } from "react";
import { useScopeContext } from "../../hooks/useScopeContext";
import { ChatInput } from "./ChatInput";
import { CostBadge } from "./CostBadge";
import { PinButton } from "./PinButton";
import type { AttachedChip } from "@opencairn/shared";

type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  costKrw?: number;
};

export function ChatPanel() {
  const ctx = useScopeContext();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chips, setChips] = useState<AttachedChip[]>(ctx.initialChips);
  const [ragMode, setRagMode] = useState<"strict" | "expand">("strict");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);

  async function ensureConversation(): Promise<string> {
    if (conversationId) return conversationId;
    const res = await fetch("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        scopeType: ctx.scopeType,
        scopeId: ctx.scopeId,
        attachedChips: chips,
        ragMode,
        memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
      }),
    });
    const body = await res.json();
    setConversationId(body.id);
    setChips(body.attachedChips);
    return body.id;
  }

  async function send(text: string) {
    setBusy(true);
    const cid = await ensureConversation();
    setMessages((m) => [...m, { role: "user", content: text }]);
    const res = await fetch("/api/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: cid, content: text }),
    });
    const raw = await res.text();
    let assistant: Message = { role: "assistant", content: "" };
    let messageId: string | undefined;
    let costKrw = 0;
    for (const block of raw.split("\n\n")) {
      const eventLine = block.match(/^event: (\w+)/m)?.[1];
      const dataLine = block.match(/^data: (.+)$/m)?.[1];
      if (!eventLine || !dataLine) continue;
      const data = JSON.parse(dataLine);
      if (eventLine === "delta") assistant.content += data.delta;
      if (eventLine === "cost") { messageId = data.messageId; costKrw = data.costKrw; }
    }
    assistant.id = messageId;
    assistant.costKrw = costKrw;
    setMessages((m) => [...m, assistant]);
    setBusy(false);
  }

  async function addChip(c: { type: AttachedChip["type"]; id: string }) {
    const cid = await ensureConversation();
    const res = await fetch(`/api/chat/conversations/${cid}/chips`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    });
    if (res.ok) setChips((await res.json()).attachedChips);
  }

  async function removeChip(key: string) {
    const cid = await ensureConversation();
    const res = await fetch(`/api/chat/conversations/${cid}/chips/${encodeURIComponent(key)}`, { method: "DELETE" });
    if (res.ok) setChips((await res.json()).attachedChips);
  }

  async function changeRagMode(m: "strict" | "expand") {
    setRagMode(m);
    if (conversationId) {
      await fetch(`/api/chat/conversations/${conversationId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ragMode: m }),
      });
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-stone-900" : "text-stone-700"}>
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.role === "assistant" && (
              <div className="mt-1 flex items-center gap-2">
                {m.costKrw !== undefined && <CostBadge costKrw={m.costKrw} />}
                {m.id && ctx.scopeType === "page" && (
                  <PinButton messageId={m.id} targetNoteId={ctx.scopeId} targetBlockId="root" />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="p-2 border-t border-stone-200">
        <ChatInput
          chips={chips}
          ragMode={ragMode}
          onSend={send}
          onAddChip={addChip}
          onRemoveChip={removeChip}
          onChangeRagMode={changeRagMode}
          disabled={busy}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests + commit**

```bash
pnpm --filter @opencairn/web test ChatPanel
git add apps/web
git commit -m "feat(web): ChatPanel composes input, messages, cost badge, pin"
```

---

## Task 12: Wire ChatPanel into Routes

**Files:**
- Create: `apps/web/src/app/(app)/w/[workspaceSlug]/chat/page.tsx`
- Create: `apps/web/src/app/(app)/w/[workspaceSlug]/p/[projectSlug]/chat/page.tsx`
- Modify: `apps/web/src/app/(app)/w/[workspaceSlug]/p/[projectSlug]/notes/[noteId]/page.tsx`

- [ ] **Step 1: Add the workspace-scope chat page**

```tsx
// apps/web/src/app/(app)/w/[workspaceSlug]/chat/page.tsx
import { ChatPanel } from "@/components/chat/ChatPanel";

export default function WorkspaceChatPage() {
  return (
    <main className="h-screen">
      <ChatPanel />
    </main>
  );
}
```

- [ ] **Step 2: Add the project-scope chat page**

```tsx
// apps/web/src/app/(app)/w/[workspaceSlug]/p/[projectSlug]/chat/page.tsx
import { ChatPanel } from "@/components/chat/ChatPanel";

export default function ProjectChatPage() {
  return (
    <main className="h-screen">
      <ChatPanel />
    </main>
  );
}
```

- [ ] **Step 3: Mount ChatPanel in the page-side panel**

In `apps/web/src/app/(app)/w/[workspaceSlug]/p/[projectSlug]/notes/[noteId]/page.tsx` (created by Plan 2 — editor), add a right-side resizable panel hosting `<ChatPanel />`. Pattern follows the existing right-rail layout introduced in Plan 2.

```tsx
// near the existing layout, sketched as:
import { ChatPanel } from "@/components/chat/ChatPanel";
// inside the page render:
<ResizablePanelGroup direction="horizontal">
  <ResizablePanel defaultSize={70}><Editor /></ResizablePanel>
  <ResizableHandle />
  <ResizablePanel defaultSize={30}><ChatPanel /></ResizablePanel>
</ResizablePanelGroup>
```

- [ ] **Step 4: Smoke run dev server**

Run: `pnpm --filter @opencairn/web dev`
Manually open `/app/w/<slug>/p/<proj>/notes/<noteId>` and confirm the chat side panel appears with a `📄` chip.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): mount ChatPanel in workspace, project, and page routes"
```

---

## Task 13: E2E Test (Playwright)

**Files:**
- Create: `tests/web/chat-scope.e2e.spec.ts`

- [ ] **Step 1: Write the E2E test**

```ts
// tests/web/chat-scope.e2e.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Chat Scope — happy paths", () => {
  test("page chat auto-attaches the page as a chip", async ({ page }) => {
    await page.goto("/app/w/acme/p/thesis/notes/note_1");
    const chip = page.getByText(/RoPE/i);
    await expect(chip).toBeVisible();
    await expect(page.getByRole("button", { name: /Strict/i })).toBeVisible();
  });

  test("removing the auto-attached chip is allowed", async ({ page }) => {
    await page.goto("/app/w/acme/p/thesis/notes/note_1");
    await page.getByLabel(/Remove RoPE/i).click();
    await expect(page.getByText(/RoPE/i)).toHaveCount(0);
  });

  test("switching to Expand mode shows fallback chip hint", async ({ page }) => {
    await page.goto("/app/w/acme/p/thesis/notes/note_1");
    await page.getByRole("button", { name: /Strict/i }).click();
    await page.getByText(/Expand — fall back to workspace/i).click();
    await expect(page.getByText(/Expand/i)).toBeVisible();
  });

  test("sending a message creates a conversation and shows cost badge", async ({ page }) => {
    await page.goto("/app/w/acme/p/thesis/notes/note_1");
    await page.getByPlaceholder(/How can I help/i).fill("test");
    await page.getByRole("button", { name: /Send/i }).click();
    await expect(page.getByText(/원/)).toBeVisible();
  });

  test("pinning an answer with a hidden citation surfaces the warning modal", async ({ page }) => {
    // Requires fixture: a note with a private cited source.
    await page.goto("/app/w/acme/p/thesis/notes/note_with_private_citation");
    await page.getByPlaceholder(/How can I help/i).fill("summarize");
    await page.getByRole("button", { name: /Send/i }).click();
    await page.getByRole("button", { name: /Pin/i }).click();
    await expect(page.getByText(/Pin anyway/i)).toBeVisible();
    await page.getByRole("button", { name: /Cancel/i }).click();
  });
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm test:e2e chat-scope`
Expected: All 5 PASS. The fifth test depends on a seed fixture; add it to the test setup if missing.

- [ ] **Step 3: Commit**

```bash
git add tests/web
git commit -m "test(e2e): chat scope chip + RAG mode + pin warning paths"
```

---

## Task 14: Documentation Sync

**Files:**
- Modify: `docs/architecture/api-contract.md` (chat section §Chat)
- Modify: `CLAUDE.md` (docs index — add 11A reference)

- [ ] **Step 1: Update api-contract.md**

Replace the four-row chat table at `api-contract.md:166-173` with the full surface from spec §10 (CRUD, chips, pin, pin/confirm, message SSE, scope-targets search).

- [ ] **Step 2: Update CLAUDE.md docs index**

In CLAUDE.md, add a row under "Implementation Plans" pointing to `docs/superpowers/plans/2026-04-20-plan-11a-chat-scope-foundation.md` with the description "Chat scope foundation (conversations table, chip UI, RAG modes, pin + permission warning, cost tracking)".

- [ ] **Step 3: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: sync api-contract chat section + CLAUDE.md index for Plan 11A"
```

---

## Verification

- [ ] All Vitest suites pass: `pnpm test`
- [ ] All Playwright suites pass: `pnpm test:e2e`
- [ ] Type check clean: `pnpm tsc --noEmit`
- [ ] No TS `any` introduced outside the `attached_chips` jsonb cast and the SSE parser
- [ ] Spec §10 endpoints all exist and return the documented status codes
- [ ] Spec §7.1 columns all exist on the migrated `conversations` table
- [ ] Spec §7.3 pin-confirmation flow demonstrably works in E2E

## Out of Scope for 11A (handled by 11B / 11C)

- Memory chip rendering for `memory:l3` / `memory:l4` / `memory:l2` (chip storage works in 11A, UI rendering in 11B)
- L1 compaction (Plan 11B)
- Background memory extraction worker (Plan 11B)
- Settings page (Plan 11B owns memory + cost sections; 11A only ships the API)
- Real LLM-backed message generation (Plan 4 worker integration; 11A ships placeholder echo)
- Document viewer (Plan 11C)
- Scope-targets search beyond pages/projects (Plan 11B adds memory entry search)
