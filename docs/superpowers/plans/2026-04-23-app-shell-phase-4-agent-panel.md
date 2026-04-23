# App Shell Phase 4 — Agent Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1 placeholder agent panel with a real right-hand chat UI — workspace-scoped threads backed by `chat_threads/chat_messages/message_feedback` tables, SSE streaming message responses, ChatGPT-style thread management via `+`/`···` buttons, composer with mode selector + mic↔send toggle, scope chip row, and wiring for thought bubble / status line / citations / save-suggestions / mode badge referenced from existing specs.

**Architecture:**
- Drop unused `conversations/messages` tables; introduce `chat_threads` (per workspace + per user) and `chat_messages` (role, content jsonb, mode, provider, token_usage) plus `message_feedback` (thumbs up/down with reason).
- Hono API exposes REST CRUD for threads + SSE for streaming assistant messages. Agent pipeline (provider call, tool use, save-suggestion emission) calls into existing `packages/llm` + `packages/agent-runtime` — Phase 4 plumbs the transport, not the agent internals.
- React client: panel shell + thread-list popover + `Conversation` component that renders `chat_messages` via `MessageBubble`; `ThoughtBubble`, `StatusLine`, `CitationChips`, `SaveSuggestionCard` are externalized to existing spec references but we create thin local wrappers so the panel is self-contained.
- `threads-store` (Phase 1 skeleton) extended with `activeThreadId` mutations and `closedStack` equivalent.

**Tech Stack:** Drizzle (migration), Hono (`streamSSE`), React Query (thread list + messages), zustand (`threads-store` active id), `@tanstack/react-query` mutations for feedback, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` §6 (Agent Panel), §11.5 (migration).
**External spec references (authoritative for details):**
- `agent-humanizer-design.md` — thought bubble + status line
- `plan-11b-chat-editor-knowledge-loop-design.md` — citations + save suggestions
- `agent-chat-scope-design.md` — scope chips
- `model-router-design.md` — mode selector
**Depends on:** Phase 1 (threads-store skeleton, AppShell). Plan 2D (chat renderer components, if already implemented — we reuse).

---

## File Structure

**New files:**

```
packages/db/drizzle/NNNN_chat_redesign.sql                    # migration (drop + create)
packages/db/src/schema/chat-threads.ts                        # new schema
packages/db/src/schema/chat-messages.ts
packages/db/src/schema/message-feedback.ts

apps/api/src/routes/
├── threads.ts                                                # REST CRUD
├── threads-messages.ts                                       # list + SSE POST
└── message-feedback.ts

apps/api/src/lib/
└── agent-pipeline.ts                                         # wraps packages/llm + runtime invocations for SSE

apps/web/src/components/agent-panel/
├── agent-panel.tsx                                           # replaces PlaceholderAgentPanel
├── panel-header.tsx                                          # 타이틀 + +/···/→
├── thread-list.tsx                                           # ··· dropdown body
├── empty-state.tsx                                           # first-visit
├── conversation.tsx                                          # message list
├── message-bubble.tsx
├── message-actions.tsx                                       # 복사/재생성/👍/👎
├── thought-bubble.tsx                                        # wraps humanizer spec
├── status-line.tsx
├── citation-chips.tsx                                        # wraps plan-11b
├── save-suggestion-card.tsx
├── scope-chips-row.tsx                                       # wraps chat-scope
├── composer.tsx                                              # textarea + toolbars
└── mode-selector.tsx                                         # auto/fast/balanced/accurate/research

apps/web/src/hooks/
├── use-chat-threads.ts                                       # list threads + active
├── use-chat-messages.ts                                      # list messages for thread
└── use-chat-send.ts                                          # POST + SSE stream
```

**Modified files:**

```
apps/web/src/components/shell/app-shell.tsx                   # swap PlaceholderAgentPanel → AgentPanel
apps/web/src/stores/threads-store.ts                          # +clearActiveThread(), +listActions
packages/db/src/index.ts                                      # export new tables
messages/{ko,en}/agent-panel.json
```

**Tests:**

```
apps/api/tests/threads.test.ts
apps/api/tests/threads-messages.test.ts
apps/api/tests/message-feedback.test.ts
apps/web/src/components/agent-panel/agent-panel.test.tsx
apps/web/src/components/agent-panel/composer.test.tsx
apps/web/src/components/agent-panel/conversation.test.tsx
apps/web/src/hooks/use-chat-threads.test.tsx
apps/web/src/hooks/use-chat-send.test.tsx
apps/web/tests/e2e/agent-panel.spec.ts
```

---

## Task 1: DB migration — drop `conversations/messages`, create `chat_threads/chat_messages/message_feedback`

**Files:**
- Create: `packages/db/src/schema/chat-threads.ts`
- Create: `packages/db/src/schema/chat-messages.ts`
- Create: `packages/db/src/schema/message-feedback.ts`
- Modify: `packages/db/src/schema/enums.ts` — remove old, add new
- Modify: `packages/db/src/index.ts` — export
- Create: migration SQL (auto-numbered)

- [ ] **Step 1.1: Confirm legacy tables unused**

```bash
pnpm grep -rn "conversations\|messages" apps/api/src
pnpm grep -rn "from .*conversations\|from .*messages" apps/
```

Expected: no hits in `apps/api/src`. If any found, escalate to the user before proceeding — Phase 4 assumes the tables are unused.

- [ ] **Step 1.2: Schema files**

`packages/db/src/schema/chat-threads.ts`:

```ts
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./users";

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("chat_threads_workspace_id_idx").on(t.workspaceId),
    index("chat_threads_user_id_idx").on(t.userId),
    index("chat_threads_updated_at_idx").on(t.workspaceId, t.updatedAt),
  ],
);
```

`packages/db/src/schema/chat-messages.ts`:

```ts
import { pgTable, uuid, jsonb, timestamp, text, index } from "drizzle-orm/pg-core";
import { messageRoleEnum } from "./enums";
import { chatThreads } from "./chat-threads";

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: jsonb("content").notNull(),
    mode: text("mode"),
    provider: text("provider"),
    tokenUsage: jsonb("token_usage"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_messages_thread_created_idx").on(t.threadId, t.createdAt)],
);
```

`packages/db/src/schema/message-feedback.ts`:

```ts
import { pgTable, uuid, text, timestamp, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { chatMessages } from "./chat-messages";
import { users } from "./users";

export const messageFeedback = pgTable(
  "message_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sentiment: text("sentiment").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("message_feedback_message_id_idx").on(t.messageId),
    unique("message_feedback_message_user_unique").on(t.messageId, t.userId),
    check("message_feedback_sentiment_check", sql`${t.sentiment} IN ('positive','negative')`),
  ],
);
```

- [ ] **Step 1.3: Update enums**

Edit `packages/db/src/schema/enums.ts`:

```ts
// REMOVE:
// export const conversationScopeEnum = pgEnum("conversation_scope", ["project", "global"]);
// export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

// ADD:
export const messageRoleEnum = pgEnum("message_role", ["user", "agent"]);
```

The migration SQL will handle the DB-level type rename (see Step 1.4).

- [ ] **Step 1.4: Handwritten migration**

Create the next-numbered migration (check `packages/db/drizzle/` for highest number, then `N+1`). Filename body: `chat_redesign`.

```sql
-- drop legacy
DROP TABLE IF EXISTS "messages";
DROP TABLE IF EXISTS "conversations";
DROP TYPE IF EXISTS "conversation_scope";

-- replace enum (old had 'user' + 'assistant'; new uses 'user' + 'agent')
DROP TYPE IF EXISTS "message_role";
CREATE TYPE "message_role" AS ENUM ('user', 'agent');

-- chat_threads
CREATE TABLE "chat_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "archived_at" timestamp with time zone
);
CREATE INDEX "chat_threads_workspace_id_idx" ON "chat_threads" ("workspace_id");
CREATE INDEX "chat_threads_user_id_idx" ON "chat_threads" ("user_id");
CREATE INDEX "chat_threads_updated_at_idx" ON "chat_threads" ("workspace_id", "updated_at");

-- chat_messages
CREATE TABLE "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_id" uuid NOT NULL REFERENCES "chat_threads"("id") ON DELETE CASCADE,
  "role" "message_role" NOT NULL,
  "content" jsonb NOT NULL,
  "mode" text,
  "provider" text,
  "token_usage" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);
CREATE INDEX "chat_messages_thread_created_idx" ON "chat_messages" ("thread_id", "created_at");

-- message_feedback
CREATE TABLE "message_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" uuid NOT NULL REFERENCES "chat_messages"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sentiment" text NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "message_feedback_message_user_unique" UNIQUE ("message_id", "user_id"),
  CONSTRAINT "message_feedback_sentiment_check" CHECK ("sentiment" IN ('positive','negative'))
);
CREATE INDEX "message_feedback_message_id_idx" ON "message_feedback" ("message_id");
```

- [ ] **Step 1.5: Apply + smoke**

```bash
pnpm --filter @opencairn/db db:migrate
```

Expected: applied, no error. Verify tables with `\d chat_threads chat_messages message_feedback`.

- [ ] **Step 1.6: Export + commit**

Update `packages/db/src/index.ts` to re-export the three new modules.

```bash
git add packages/db/src/schema/chat-threads.ts \
        packages/db/src/schema/chat-messages.ts \
        packages/db/src/schema/message-feedback.ts \
        packages/db/src/schema/enums.ts \
        packages/db/src/index.ts \
        packages/db/drizzle/
git commit -m "feat(db): drop unused conversations/messages; add chat_threads/messages/feedback"
```

---

## Task 2: `GET/POST /api/threads` endpoints

List threads for the caller in a workspace; create a new thread optionally with a first message.

**Files:**
- Create: `apps/api/src/routes/threads.ts`
- Create: `apps/api/tests/threads.test.ts`
- Modify: `apps/api/src/routes/index.ts` — mount

- [ ] **Step 2.1: Failing test**

```ts
// apps/api/tests/threads.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestClient, seedUser, seedWorkspace, resetDb } from "./helpers";

describe("Threads REST", () => {
  beforeEach(resetDb);

  it("creates a thread and returns it in the list", async () => {
    const user = await seedUser();
    const ws = await seedWorkspace({ ownerId: user.id });
    const client = createTestClient({ userId: user.id });

    const create = await client.post("/api/threads", {
      body: { workspace_id: ws.id, title: "Research query" },
    });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const list = await client.get(`/api/threads?workspace_id=${ws.id}`);
    expect(list.body.threads).toHaveLength(1);
    expect(list.body.threads[0].id).toBe(id);
    expect(list.body.threads[0].title).toBe("Research query");
  });

  it("returns only caller's own threads", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const ws = await seedWorkspace({ ownerId: a.id, extraMembers: [b.id] });
    const clientA = createTestClient({ userId: a.id });
    const clientB = createTestClient({ userId: b.id });

    await clientA.post("/api/threads", { body: { workspace_id: ws.id, title: "A thread" } });
    await clientB.post("/api/threads", { body: { workspace_id: ws.id, title: "B thread" } });

    const listA = await clientA.get(`/api/threads?workspace_id=${ws.id}`);
    expect(listA.body.threads).toHaveLength(1);
    expect(listA.body.threads[0].title).toBe("A thread");
  });

  it("requires workspace membership", async () => {
    const a = await seedUser();
    const outsider = await seedUser();
    const ws = await seedWorkspace({ ownerId: a.id });
    const client = createTestClient({ userId: outsider.id });
    expect(
      (await client.post("/api/threads", { body: { workspace_id: ws.id, title: "x" } })).status,
    ).toBe(403);
  });

  it("PATCH title updates the record", async () => {
    const user = await seedUser();
    const ws = await seedWorkspace({ ownerId: user.id });
    const client = createTestClient({ userId: user.id });
    const id = (await client.post("/api/threads", { body: { workspace_id: ws.id, title: "old" } })).body.id;
    await client.patch(`/api/threads/${id}`, { body: { title: "new" } });
    const list = await client.get(`/api/threads?workspace_id=${ws.id}`);
    expect(list.body.threads[0].title).toBe("new");
  });

  it("DELETE archives (soft-delete)", async () => {
    const user = await seedUser();
    const ws = await seedWorkspace({ ownerId: user.id });
    const client = createTestClient({ userId: user.id });
    const id = (await client.post("/api/threads", { body: { workspace_id: ws.id, title: "x" } })).body.id;
    await client.delete(`/api/threads/${id}`);
    const list = await client.get(`/api/threads?workspace_id=${ws.id}`);
    expect(list.body.threads).toHaveLength(0); // archived excluded by default
  });
});
```

- [ ] **Step 2.2: Implement**

```ts
// apps/api/src/routes/threads.ts
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, chatThreads } from "@opencairn/db";
import { requireSession } from "../lib/auth";
import { requireWorkspaceMember } from "../lib/permissions";

const createBody = z.object({ workspace_id: z.string().uuid(), title: z.string().optional() });
const listQuery = z.object({ workspace_id: z.string().uuid() });
const patchBody = z.object({ title: z.string().optional(), archived: z.boolean().optional() });

export const threadsRoute = new Hono()
  .get("/threads", zValidator("query", listQuery), async (c) => {
    const session = await requireSession(c);
    const { workspace_id } = c.req.valid("query");
    await requireWorkspaceMember(session.userId, workspace_id);
    const rows = await db
      .select()
      .from(chatThreads)
      .where(and(
        eq(chatThreads.workspaceId, workspace_id),
        eq(chatThreads.userId, session.userId),
        isNull(chatThreads.archivedAt),
      ))
      .orderBy(desc(chatThreads.updatedAt));
    return c.json({
      threads: rows.map((r) => ({
        id: r.id, title: r.title, updated_at: r.updatedAt, created_at: r.createdAt,
      })),
    });
  })

  .post("/threads", zValidator("json", createBody), async (c) => {
    const session = await requireSession(c);
    const { workspace_id, title } = c.req.valid("json");
    await requireWorkspaceMember(session.userId, workspace_id);
    const [row] = await db
      .insert(chatThreads)
      .values({ workspaceId: workspace_id, userId: session.userId, title: title ?? "" })
      .returning();
    return c.json({ id: row.id, title: row.title }, 201);
  })

  .patch("/threads/:id", zValidator("json", patchBody), async (c) => {
    const session = await requireSession(c);
    const id = c.req.param("id");
    const { title, archived } = c.req.valid("json");
    const [row] = await db.select().from(chatThreads).where(eq(chatThreads.id, id));
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.userId !== session.userId) return c.json({ error: "forbidden" }, 403);
    await db
      .update(chatThreads)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(archived ? { archivedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chatThreads.id, id));
    return c.json({ ok: true });
  })

  .delete("/threads/:id", async (c) => {
    const session = await requireSession(c);
    const id = c.req.param("id");
    const [row] = await db.select().from(chatThreads).where(eq(chatThreads.id, id));
    if (!row || row.userId !== session.userId) return c.json({ error: "forbidden" }, 403);
    await db.update(chatThreads).set({ archivedAt: new Date() }).where(eq(chatThreads.id, id));
    return c.json({ ok: true });
  });
```

Mount in `routes/index.ts`.

- [ ] **Step 2.3: Run + commit**

```bash
pnpm --filter @opencairn/api test threads
git add apps/api/src/routes/threads.ts \
        apps/api/src/routes/index.ts \
        apps/api/tests/threads.test.ts
git commit -m "feat(api): thread CRUD endpoints"
```

---

## Task 3: `GET /api/threads/:id/messages` + `POST /api/threads/:id/messages` (SSE)

GET returns paginated history; POST accepts user message, persists it, invokes the agent pipeline, streams agent response as SSE while persisting chunks in a single row (`role=agent`).

**Files:**
- Create: `apps/api/src/routes/threads-messages.ts`
- Create: `apps/api/src/lib/agent-pipeline.ts`
- Create: `apps/api/tests/threads-messages.test.ts`

- [ ] **Step 3.1: Agent pipeline wrapper (stub-first)**

Create `apps/api/src/lib/agent-pipeline.ts` with a streaming generator interface. The initial implementation can return a tiny stub response (echo + citation stub) so this plan can land without depending on runtime changes.

```ts
import { db, chatMessages } from "@opencairn/db";

export interface AgentChunk {
  type: "status" | "thought" | "text" | "citation" | "save_suggestion" | "done";
  payload: unknown;
}

export async function* runAgent(opts: {
  threadId: string;
  userMessage: { content: string; scope?: unknown };
  mode: "auto" | "fast" | "balanced" | "accurate" | "research";
}): AsyncGenerator<AgentChunk> {
  yield { type: "status", payload: { phrase: "관련 문서 훑는 중..." } };
  yield { type: "thought", payload: { summary: "사용자의 질문 분석 중", tokens: 120 } };

  // Stub body — real pipeline wiring is Phase 4.1 followup.
  const body = `(stub agent response to: ${opts.userMessage.content})`;
  for (const ch of body) {
    yield { type: "text", payload: { delta: ch } };
    await new Promise((r) => setTimeout(r, 4));
  }
  yield { type: "done", payload: {} };
}

export async function persistAgentMessage(threadId: string, content: object, mode: string) {
  const [row] = await db
    .insert(chatMessages)
    .values({ threadId, role: "agent", content, mode })
    .returning();
  return row;
}
```

The real pipeline (calling `packages/llm` + `packages/agent-runtime`) is a follow-up wire-up; plan keeps the transport concern cleanly separate.

- [ ] **Step 3.2: Endpoint implementation**

```ts
// apps/api/src/routes/threads-messages.ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { db, chatThreads, chatMessages } from "@opencairn/db";
import { requireSession } from "../lib/auth";
import { runAgent, persistAgentMessage } from "../lib/agent-pipeline";

const postBody = z.object({
  content: z.string().min(1),
  scope: z.unknown().optional(),
  mode: z.enum(["auto", "fast", "balanced", "accurate", "research"]).default("auto"),
});

export const threadsMessagesRoute = new Hono()
  .get("/threads/:id/messages", async (c) => {
    const session = await requireSession(c);
    const id = c.req.param("id");
    const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, id));
    if (!thread || thread.userId !== session.userId) return c.json({ error: "forbidden" }, 403);

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, id))
      .orderBy(asc(chatMessages.createdAt));
    return c.json({ messages: rows });
  })

  .post("/threads/:id/messages", zValidator("json", postBody), async (c) => {
    const session = await requireSession(c);
    const id = c.req.param("id");
    const { content, scope, mode } = c.req.valid("json");
    const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, id));
    if (!thread || thread.userId !== session.userId) return c.json({ error: "forbidden" }, 403);

    // Persist user message synchronously before streaming
    const [userRow] = await db
      .insert(chatMessages)
      .values({ threadId: id, role: "user", content: { body: content, scope }, mode })
      .returning();

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "user_persisted", data: JSON.stringify({ id: userRow.id }) });

      const buffer: string[] = [];
      const meta: Record<string, unknown> = {};
      for await (const chunk of runAgent({ threadId: id, userMessage: { content, scope }, mode })) {
        if (chunk.type === "text") buffer.push((chunk.payload as { delta: string }).delta);
        if (chunk.type === "status") meta.status = chunk.payload;
        if (chunk.type === "thought") meta.thought = chunk.payload;
        if (chunk.type === "citation") meta.citations = [...((meta.citations as unknown[]) ?? []), chunk.payload];
        if (chunk.type === "save_suggestion") meta.save_suggestion = chunk.payload;
        await stream.writeSSE({ event: chunk.type, data: JSON.stringify(chunk.payload) });
      }

      const agentRow = await persistAgentMessage(
        id,
        { body: buffer.join(""), ...meta },
        mode,
      );
      await stream.writeSSE({ event: "done", data: JSON.stringify({ id: agentRow.id }) });
      await db.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, id));
    });
  });
```

Mount in `routes/index.ts`.

- [ ] **Step 3.3: Integration test**

```ts
// apps/api/tests/threads-messages.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestClient, seedUser, seedWorkspace, resetDb } from "./helpers";

describe("Threads messages", () => {
  beforeEach(resetDb);

  it("POST streams agent response and persists both messages", async () => {
    const user = await seedUser();
    const ws = await seedWorkspace({ ownerId: user.id });
    const client = createTestClient({ userId: user.id });
    const tid = (await client.post("/api/threads", { body: { workspace_id: ws.id, title: "t" } })).body.id;

    const events: string[] = [];
    await client.sse(`/api/threads/${tid}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "hi", mode: "auto" }),
      headers: { "content-type": "application/json" },
      onMessage: (e) => events.push(e.type),
    });

    expect(events).toContain("user_persisted");
    expect(events).toContain("done");
    expect(events).toContain("status");
    expect(events).toContain("text");

    const list = await client.get(`/api/threads/${tid}/messages`);
    expect(list.body.messages).toHaveLength(2);
    expect(list.body.messages[0].role).toBe("user");
    expect(list.body.messages[1].role).toBe("agent");
  });
});
```

Adapt `client.sse` to whatever SSE helper exists in `apps/api/tests/` (already used by Phase 2).

- [ ] **Step 3.4: Commit**

```bash
git add apps/api/src/lib/agent-pipeline.ts \
        apps/api/src/routes/threads-messages.ts \
        apps/api/src/routes/index.ts \
        apps/api/tests/threads-messages.test.ts
git commit -m "feat(api): threads message list and SSE streaming POST"
```

---

## Task 4: `POST /api/message-feedback`

**Files:**
- Create: `apps/api/src/routes/message-feedback.ts`
- Create: `apps/api/tests/message-feedback.test.ts`

- [ ] **Step 4.1: Test**

```ts
// apps/api/tests/message-feedback.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestClient, seedUser, seedWorkspace, resetDb, createMessage } from "./helpers";

describe("POST /api/message-feedback", () => {
  beforeEach(resetDb);

  it("stores feedback", async () => {
    const user = await seedUser();
    const ws = await seedWorkspace({ ownerId: user.id });
    const msg = await createMessage({ workspaceId: ws.id, userId: user.id, role: "agent" });
    const client = createTestClient({ userId: user.id });
    const res = await client.post("/api/message-feedback", {
      body: { message_id: msg.id, sentiment: "positive" },
    });
    expect(res.status).toBe(201);
  });

  it("upserts on conflict (message_id, user_id)", async () => {
    const user = await seedUser();
    const ws = await seedWorkspace({ ownerId: user.id });
    const msg = await createMessage({ workspaceId: ws.id, userId: user.id, role: "agent" });
    const client = createTestClient({ userId: user.id });
    await client.post("/api/message-feedback", { body: { message_id: msg.id, sentiment: "positive" } });
    await client.post("/api/message-feedback", {
      body: { message_id: msg.id, sentiment: "negative", reason: "incorrect" },
    });
    // implementation should upsert: second call succeeds with 200, or 201 after delete+insert.
    const feedback = await client.get(`/api/message-feedback?message_id=${msg.id}`);
    expect(feedback.body.sentiment).toBe("negative");
    expect(feedback.body.reason).toBe("incorrect");
  });

  it("400 on invalid sentiment", async () => {
    const user = await seedUser();
    const client = createTestClient({ userId: user.id });
    const res = await client.post("/api/message-feedback", {
      body: { message_id: "x", sentiment: "meh" },
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4.2: Implement**

```ts
// apps/api/src/routes/message-feedback.ts
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db, chatMessages, chatThreads, messageFeedback } from "@opencairn/db";
import { requireSession } from "../lib/auth";

const body = z.object({
  message_id: z.string().uuid(),
  sentiment: z.enum(["positive", "negative"]),
  reason: z.string().optional(),
});

export const messageFeedbackRoute = new Hono()
  .post("/message-feedback", zValidator("json", body), async (c) => {
    const session = await requireSession(c);
    const { message_id, sentiment, reason } = c.req.valid("json");

    const [msg] = await db.select().from(chatMessages).where(eq(chatMessages.id, message_id));
    if (!msg) return c.json({ error: "not_found" }, 404);
    const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, msg.threadId));
    if (thread?.userId !== session.userId) return c.json({ error: "forbidden" }, 403);

    await db
      .insert(messageFeedback)
      .values({ messageId: message_id, userId: session.userId, sentiment, reason })
      .onConflictDoUpdate({
        target: [messageFeedback.messageId, messageFeedback.userId],
        set: { sentiment, reason, createdAt: new Date() },
      });

    return c.json({ ok: true }, 201);
  })

  .get("/message-feedback", async (c) => {
    const session = await requireSession(c);
    const messageId = c.req.query("message_id");
    if (!messageId) return c.json({ error: "message_id required" }, 400);
    const [row] = await db
      .select()
      .from(messageFeedback)
      .where(and(
        eq(messageFeedback.messageId, messageId),
        eq(messageFeedback.userId, session.userId),
      ));
    if (!row) return c.json(null, 200);
    return c.json({ sentiment: row.sentiment, reason: row.reason });
  });
```

- [ ] **Step 4.3: Commit**

```bash
git add apps/api/src/routes/message-feedback.ts \
        apps/api/src/routes/index.ts \
        apps/api/tests/message-feedback.test.ts
git commit -m "feat(api): message feedback upsert endpoint"
```

---

## Task 5: `use-chat-threads` + `use-chat-messages` hooks

**Files:**
- Create: `apps/web/src/hooks/use-chat-threads.ts`
- Create: `apps/web/src/hooks/use-chat-messages.ts`
- Create: `apps/web/src/hooks/use-chat-threads.test.tsx`

- [ ] **Step 5.1: Thread list hook**

```ts
// apps/web/src/hooks/use-chat-threads.ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface Thread { id: string; title: string; updated_at: string; }

export function useChatThreads(workspaceId: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["threads", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const r = await fetch(`/api/threads?workspace_id=${workspaceId}`);
      if (!r.ok) throw new Error();
      return (await r.json()).threads as Thread[];
    },
  });

  const create = useMutation({
    mutationFn: async (input: { title?: string }) => {
      const r = await fetch("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, title: input.title ?? "" }),
      });
      if (!r.ok) throw new Error();
      return r.json() as Promise<{ id: string; title: string }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads", workspaceId] }),
  });

  const rename = useMutation({
    mutationFn: async (input: { id: string; title: string }) => {
      const r = await fetch(`/api/threads/${input.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: input.title }),
      });
      if (!r.ok) throw new Error();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads", workspaceId] }),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/threads/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads", workspaceId] }),
  });

  return { threads: query.data ?? [], isLoading: query.isLoading, create, rename, archive };
}
```

- [ ] **Step 5.2: Messages hook**

```ts
// apps/web/src/hooks/use-chat-messages.ts
"use client";
import { useQuery } from "@tanstack/react-query";

export interface Message {
  id: string;
  role: "user" | "agent";
  content: { body: string; thought?: unknown; status?: unknown; citations?: unknown[]; save_suggestion?: unknown };
  mode: string | null;
  provider: string | null;
  created_at: string;
}

export function useChatMessages(threadId: string | null) {
  return useQuery({
    queryKey: ["thread-messages", threadId],
    enabled: !!threadId,
    queryFn: async () => {
      const r = await fetch(`/api/threads/${threadId}/messages`);
      if (!r.ok) throw new Error();
      return ((await r.json()).messages as Message[]);
    },
  });
}
```

- [ ] **Step 5.3: Smoke test for list**

Skip unit tests for `use-chat-messages` — coverage via e2e. Add a minimal test for `useChatThreads.create` with fetch mocks:

```tsx
// apps/web/src/hooks/use-chat-threads.test.tsx
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useChatThreads } from "./use-chat-threads";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;
afterEach(() => fetchMock.mockReset());

describe("useChatThreads", () => {
  it("create posts to /api/threads and invalidates the list", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ threads: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "t1", title: "x" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ threads: [{ id: "t1", title: "x", updated_at: "" }] }) });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { result } = renderHook(() => useChatThreads("ws-x"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await waitFor(() => expect(result.current.threads).toHaveLength(0));
    await act(async () => { await result.current.create.mutateAsync({ title: "x" }); });
    await waitFor(() => expect(result.current.threads).toHaveLength(1));
  });
});
```

- [ ] **Step 5.4: Commit**

```bash
git add apps/web/src/hooks/use-chat-threads.ts \
        apps/web/src/hooks/use-chat-threads.test.tsx \
        apps/web/src/hooks/use-chat-messages.ts
git commit -m "feat(web): chat threads and messages query hooks"
```

---

## Task 6: `use-chat-send` (SSE stream consumer)

**Files:**
- Create: `apps/web/src/hooks/use-chat-send.ts`
- Create: `apps/web/src/hooks/use-chat-send.test.tsx`

- [ ] **Step 6.1: Implement**

```ts
// apps/web/src/hooks/use-chat-send.ts
"use client";
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export interface StreamingAgentMessage {
  id: string | null;      // temp id until 'done' event
  body: string;
  thought: unknown | null;
  status: { phrase?: string } | null;
  citations: unknown[];
  save_suggestion: unknown | null;
}

export function useChatSend(threadId: string | null) {
  const qc = useQueryClient();
  const [live, setLive] = useState<StreamingAgentMessage | null>(null);
  const controller = useRef<AbortController | null>(null);

  const send = useCallback(
    async (input: { content: string; scope?: unknown; mode?: string }) => {
      if (!threadId) return;
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;

      setLive({ id: null, body: "", thought: null, status: null, citations: [], save_suggestion: null });

      const res = await fetch(`/api/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ content: input.content, scope: input.scope, mode: input.mode ?? "auto" }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split(/\n\n/);
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const lines = part.split("\n");
          const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
          const data = lines.filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
          if (!event) continue;
          const payload = data ? JSON.parse(data) : null;
          setLive((prev) => {
            if (!prev) return prev;
            switch (event) {
              case "status": return { ...prev, status: payload };
              case "thought": return { ...prev, thought: payload };
              case "text": return { ...prev, body: prev.body + (payload.delta ?? "") };
              case "citation": return { ...prev, citations: [...prev.citations, payload] };
              case "save_suggestion": return { ...prev, save_suggestion: payload };
              case "done": return { ...prev, id: payload.id };
              default: return prev;
            }
          });
        }
      }
      qc.invalidateQueries({ queryKey: ["thread-messages", threadId] });
      setLive(null);
    },
    [threadId, qc],
  );

  return { send, live };
}
```

- [ ] **Step 6.2: Test (mock fetch stream)**

```tsx
// apps/web/src/hooks/use-chat-send.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
import { useChatSend } from "./use-chat-send";

function mkSseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe("useChatSend", () => {
  it("accumulates text deltas and resolves with 'done'", async () => {
    const body = mkSseBody([
      "event: status\ndata: {\"phrase\":\"검색 중\"}\n\n",
      "event: text\ndata: {\"delta\":\"Hel\"}\n\n",
      "event: text\ndata: {\"delta\":\"lo\"}\n\n",
      "event: done\ndata: {\"id\":\"m1\"}\n\n",
    ]);
    (global.fetch as any) = vi.fn().mockResolvedValue({ ok: true, body });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await act(async () => { await result.current.send({ content: "hi" }); });
    await waitFor(() => expect(result.current.live).toBeNull());
  });
});
```

- [ ] **Step 6.3: Commit**

```bash
git add apps/web/src/hooks/use-chat-send.ts apps/web/src/hooks/use-chat-send.test.tsx
git commit -m "feat(web): SSE consumer for streaming agent responses"
```

---

## Task 7: `PanelHeader` + `ThreadList`

**Files:**
- Create: `apps/web/src/components/agent-panel/panel-header.tsx`
- Create: `apps/web/src/components/agent-panel/thread-list.tsx`

- [ ] **Step 7.1: Panel header**

```tsx
"use client";
import { Plus, MoreHorizontal, ChevronRight } from "lucide-react";
import { usePanelStore } from "@/stores/panel-store";
import { ThreadList } from "./thread-list";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";

export function PanelHeader({
  onNewThread,
}: {
  onNewThread(): void;
}) {
  const togglePanel = usePanelStore((s) => s.toggleAgentPanel);
  return (
    <div className="flex h-10 items-center justify-between border-b border-border px-3">
      <span className="text-sm font-semibold">AI 에이전트</span>
      <div className="flex items-center gap-1">
        <button aria-label="새 대화" onClick={onNewThread} className="rounded p-1 hover:bg-accent">
          <Plus className="h-4 w-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="대화 목록" className="rounded p-1 hover:bg-accent">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <ThreadList />
          </DropdownMenuContent>
        </DropdownMenu>
        <button aria-label="패널 접기" onClick={togglePanel} className="rounded p-1 hover:bg-accent">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Thread list body**

```tsx
"use client";
import { useParams } from "next/navigation";
import { useChatThreads } from "@/hooks/use-chat-threads";
import { useThreadsStore } from "@/stores/threads-store";
import { formatDistanceToNow } from "date-fns";

export function ThreadList() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const workspaceKey = wsSlug ? `ws_slug:${wsSlug}` : null;
  const { threads, isLoading } = useChatThreads(workspaceKey);
  const setActive = useThreadsStore((s) => s.setActiveThread);

  if (isLoading) return <p className="p-2 text-xs text-muted-foreground">불러오는 중…</p>;
  if (threads.length === 0) return <p className="p-2 text-xs text-muted-foreground">대화가 없습니다.</p>;

  return (
    <ul className="max-h-80 overflow-auto">
      {threads.map((t) => (
        <li key={t.id}>
          <button
            onClick={() => setActive(t.id)}
            className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-accent"
          >
            <span className="truncate text-sm">{t.title || "(제목 없음)"}</span>
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 7.3: Commit**

```bash
git add apps/web/src/components/agent-panel/panel-header.tsx \
        apps/web/src/components/agent-panel/thread-list.tsx
git commit -m "feat(web): panel header and thread list dropdown"
```

---

## Task 8: `MessageBubble` + `MessageActions`

Renders user vs agent messages; agent bubble composes thought/status/body/citations/save-suggestion.

**Files:**
- Create: `apps/web/src/components/agent-panel/message-bubble.tsx`
- Create: `apps/web/src/components/agent-panel/message-actions.tsx`
- Create: `apps/web/src/components/agent-panel/thought-bubble.tsx` (lightweight wrapper)
- Create: `apps/web/src/components/agent-panel/status-line.tsx`
- Create: `apps/web/src/components/agent-panel/citation-chips.tsx`
- Create: `apps/web/src/components/agent-panel/save-suggestion-card.tsx`

- [ ] **Step 8.1: Thought bubble (collapsible)**

```tsx
"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function ThoughtBubble({ summary, tokens }: { summary: string; tokens?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-border bg-muted/20 text-xs">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1 px-2 py-1">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>생각{tokens ? ` ${Math.round(tokens / 60)}초` : ""}</span>
      </button>
      {open ? <p className="border-t border-border px-2 py-1 text-muted-foreground">{summary}</p> : null}
    </div>
  );
}
```

- [ ] **Step 8.2: Status line with pulse**

```tsx
"use client";
export function StatusLine({ phrase }: { phrase: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/40" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-foreground" />
      </span>
      <span>{phrase}</span>
    </div>
  );
}
```

- [ ] **Step 8.3: Citation chips**

```tsx
"use client";
export interface Citation { index: number; title: string; url?: string; noteId?: string; }

export function CitationChips({ citations }: { citations: Citation[] }) {
  if (!citations?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {citations.map((c) => (
        <a
          key={c.index}
          href={c.url ?? (c.noteId ? `/ko/app/notes/${c.noteId}` : "#")}
          target={c.url ? "_blank" : undefined}
          rel={c.url ? "noreferrer" : undefined}
          className="rounded border border-border px-1.5 text-[10px] hover:bg-accent"
        >
          [{c.index}] {c.title}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 8.4: Save-suggestion card**

```tsx
"use client";
export function SaveSuggestionCard({
  title,
  onSave,
  onDismiss,
}: {
  title: string;
  onSave(): void;
  onDismiss(): void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded border border-border p-2 text-xs">
      <span className="flex-1 truncate">"{title}" 노트로 저장 제안</span>
      <button onClick={onSave} className="rounded bg-foreground px-2 py-0.5 text-background">저장</button>
      <button onClick={onDismiss} aria-label="닫기" className="rounded px-2 py-0.5 hover:bg-accent">×</button>
    </div>
  );
}
```

- [ ] **Step 8.5: Message actions**

```tsx
"use client";
import { useState } from "react";
import { Copy, RotateCcw, ThumbsUp, ThumbsDown } from "lucide-react";

export function MessageActions({
  text,
  onRegenerate,
  onFeedback,
}: {
  text: string;
  onRegenerate(): void;
  onFeedback(s: "positive" | "negative", reason?: string): void;
}) {
  const [reasonOpen, setReasonOpen] = useState(false);
  return (
    <div className="mt-1 flex items-center gap-2 text-muted-foreground">
      <button aria-label="복사" onClick={() => navigator.clipboard.writeText(text)}>
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button aria-label="재생성" onClick={onRegenerate}>
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      <button aria-label="좋아요" onClick={() => onFeedback("positive")}>
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button aria-label="싫어요" onClick={() => setReasonOpen((o) => !o)}>
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
      {reasonOpen ? (
        <div className="flex gap-1">
          {(["incorrect", "incomplete", "irrelevant", "other"] as const).map((r) => (
            <button
              key={r}
              onClick={() => { onFeedback("negative", r); setReasonOpen(false); }}
              className="rounded border border-border px-1.5 text-[10px]"
            >
              {r}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 8.6: Message bubble**

```tsx
"use client";
import type { Message } from "@/hooks/use-chat-messages";
import { ThoughtBubble } from "./thought-bubble";
import { StatusLine } from "./status-line";
import { CitationChips } from "./citation-chips";
import { SaveSuggestionCard } from "./save-suggestion-card";
import { MessageActions } from "./message-actions";

export function MessageBubble({
  msg,
  onRegenerate,
  onSaveSuggestion,
  onFeedback,
}: {
  msg: Message;
  onRegenerate(msgId: string): void;
  onSaveSuggestion(payload: unknown): void;
  onFeedback(msgId: string, s: "positive" | "negative", reason?: string): void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase text-muted-foreground">나</span>
        <p className="whitespace-pre-wrap text-sm">{msg.content.body}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase text-muted-foreground">에이전트</span>
        {msg.mode ? (
          <span className="rounded border border-border px-1.5 text-[10px] uppercase tracking-wide">
            {msg.mode}
          </span>
        ) : null}
      </div>
      {msg.content.thought ? <ThoughtBubble {...(msg.content.thought as any)} /> : null}
      {msg.content.status ? <StatusLine {...(msg.content.status as any)} /> : null}
      <p className="whitespace-pre-wrap text-sm">{msg.content.body}</p>
      {msg.content.citations ? <CitationChips citations={msg.content.citations as any} /> : null}
      {msg.content.save_suggestion ? (
        <SaveSuggestionCard
          {...(msg.content.save_suggestion as any)}
          onSave={() => onSaveSuggestion(msg.content.save_suggestion)}
          onDismiss={() => { /* ignore */ }}
        />
      ) : null}
      <MessageActions
        text={msg.content.body}
        onRegenerate={() => onRegenerate(msg.id)}
        onFeedback={(s, r) => onFeedback(msg.id, s, r)}
      />
    </div>
  );
}
```

- [ ] **Step 8.7: Commit**

```bash
git add apps/web/src/components/agent-panel/{thought-bubble,status-line,citation-chips,save-suggestion-card,message-actions,message-bubble}.tsx
git commit -m "feat(web): agent message UI composition (thought/status/citation/save/actions)"
```

---

## Task 9: `Conversation` component

Wraps message list + live streaming message.

**Files:**
- Create: `apps/web/src/components/agent-panel/conversation.tsx`

- [ ] **Step 9.1: Implement**

```tsx
"use client";
import { useChatMessages } from "@/hooks/use-chat-messages";
import { useChatSend } from "@/hooks/use-chat-send";
import { MessageBubble } from "./message-bubble";
import { ThoughtBubble } from "./thought-bubble";
import { StatusLine } from "./status-line";

export function Conversation({ threadId }: { threadId: string | null }) {
  const { data: messages = [] } = useChatMessages(threadId);
  const { live } = useChatSend(threadId);

  async function onFeedback(msgId: string, s: "positive" | "negative", reason?: string) {
    await fetch("/api/message-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message_id: msgId, sentiment: s, reason }),
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-3">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          msg={m}
          onRegenerate={() => { /* wire up in follow-up */ }}
          onSaveSuggestion={() => { /* Plan 11B consumer */ }}
          onFeedback={onFeedback}
        />
      ))}
      {live ? (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase text-muted-foreground">에이전트</span>
          {live.thought ? <ThoughtBubble {...(live.thought as any)} /> : null}
          {live.status ? <StatusLine {...(live.status as any)} /> : null}
          <p className="whitespace-pre-wrap text-sm">{live.body}</p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 9.2: Commit**

```bash
git add apps/web/src/components/agent-panel/conversation.tsx
git commit -m "feat(web): conversation component with live streaming bubble"
```

---

## Task 10: `Composer` + `ModeSelector` + `ScopeChipsRow`

**Files:**
- Create: `apps/web/src/components/agent-panel/composer.tsx`
- Create: `apps/web/src/components/agent-panel/mode-selector.tsx`
- Create: `apps/web/src/components/agent-panel/scope-chips-row.tsx`
- Create: `apps/web/src/components/agent-panel/composer.test.tsx`

- [ ] **Step 10.1: Mode selector**

```tsx
"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

export type ChatMode = "auto" | "fast" | "balanced" | "accurate" | "research";

export function ModeSelector({ value, onChange }: { value: ChatMode; onChange(v: ChatMode): void }) {
  const modes: ChatMode[] = ["auto", "fast", "balanced", "accurate", "research"];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded border border-border px-2 py-0.5 text-xs uppercase tracking-wide">
        {value}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {modes.map((m) => (
          <DropdownMenuItem key={m} onSelect={() => onChange(m)} className="flex items-center gap-2">
            {value === m ? <Check className="h-3 w-3" /> : <span className="w-3" />}
            <span className="uppercase tracking-wide">{m}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 10.2: Scope chips row (skeleton — chat-scope spec has depth we defer)**

```tsx
"use client";
import { useTabsStore } from "@/stores/tabs-store";

export interface Scope { id: string; label: string; kind: "page" | "project" | "workspace" | "memory" | "research"; }

function defaultScopes(activeKind: string | undefined): Scope[] {
  switch (activeKind) {
    case "note": return [{ id: "page", label: "📄 페이지", kind: "page" }, { id: "project", label: "📂 프로젝트", kind: "project" }];
    case "project": return [{ id: "project", label: "📂 프로젝트", kind: "project" }];
    case "research_run": return [{ id: "research", label: "🔬 이 리서치", kind: "research" }];
    default: return [{ id: "workspace", label: "🏠 워크스페이스", kind: "workspace" }];
  }
}

export function ScopeChipsRow({
  selected,
  onChange,
  strict,
  onStrictChange,
}: {
  selected: string[];
  onChange(next: string[]): void;
  strict: "strict" | "loose";
  onStrictChange(v: "strict" | "loose"): void;
}) {
  const activeId = useTabsStore((s) => s.activeId);
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === activeId));
  const chips = defaultScopes(tab?.kind);

  return (
    <div className="flex items-center gap-1 border-t border-border px-2 py-1 text-[10px]">
      <div className="flex flex-1 flex-wrap gap-1">
        {chips.map((c) => {
          const on = selected.includes(c.id);
          return (
            <button
              key={c.id}
              onClick={() =>
                onChange(on ? selected.filter((x) => x !== c.id) : [...selected, c.id])
              }
              className={`rounded border px-2 py-0.5 ${on ? "border-foreground" : "border-border"}`}
            >
              {c.label}
            </button>
          );
        })}
        <button className="rounded border border-dashed border-border px-2 py-0.5 text-muted-foreground">
          +
        </button>
      </div>
      <button
        onClick={() => onStrictChange(strict === "strict" ? "loose" : "strict")}
        className="rounded border border-border px-2 py-0.5 uppercase"
      >
        {strict}
      </button>
    </div>
  );
}
```

- [ ] **Step 10.3: Composer**

```tsx
"use client";
import { useState, useRef } from "react";
import { Paperclip, Mic, ArrowUp } from "lucide-react";
import { ModeSelector, type ChatMode } from "./mode-selector";

export function Composer({
  onSend,
  disabled,
}: {
  onSend(input: { content: string; mode: ChatMode }): void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<ChatMode>("auto");
  const ref = useRef<HTMLTextAreaElement>(null);

  function autoGrow() {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.min(200, ref.current.scrollHeight)}px`;
  }

  function submit() {
    if (!value.trim() || disabled) return;
    onSend({ content: value.trim(), mode });
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  }

  return (
    <div className="m-2 flex flex-col gap-1 rounded-xl border border-border p-2">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder="메시지를 입력하세요..."
        disabled={disabled}
        onChange={(e) => { setValue(e.target.value); autoGrow(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
        className="resize-none bg-transparent text-sm outline-none"
      />
      <div className="flex items-center gap-2">
        <button aria-label="첨부" className="rounded p-1 hover:bg-accent">
          <Paperclip className="h-4 w-4" />
        </button>
        <div className="flex-1" />
        <ModeSelector value={mode} onChange={setMode} />
        {value.trim().length === 0 ? (
          <button aria-label="음성 입력" className="rounded p-1 hover:bg-accent">
            <Mic className="h-4 w-4" />
          </button>
        ) : (
          <button
            aria-label="전송"
            onClick={submit}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 10.4: Composer test (toggle behavior)**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";

describe("Composer", () => {
  it("shows mic when empty, send when non-empty", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    expect(screen.getByLabelText("음성 입력")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("메시지를 입력하세요..."), {
      target: { value: "hi" },
    });
    expect(screen.getByLabelText("전송")).toBeInTheDocument();
  });

  it("Enter submits, Shift+Enter newlines", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText("메시지를 입력하세요...");
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ content: "hi", mode: "auto" });
  });
});
```

- [ ] **Step 10.5: Commit**

```bash
git add apps/web/src/components/agent-panel/{composer,mode-selector,scope-chips-row,composer.test}.tsx
git commit -m "feat(web): composer with mode selector, mic/send toggle, scope chips row"
```

---

## Task 11: `AgentPanel` assembly + empty state + swap placeholder

**Files:**
- Create: `apps/web/src/components/agent-panel/empty-state.tsx`
- Create: `apps/web/src/components/agent-panel/agent-panel.tsx`
- Modify: `apps/web/src/components/shell/app-shell.tsx`

- [ ] **Step 11.1: Empty state**

```tsx
"use client";
export function AgentPanelEmptyState({ onStart }: { onStart(): void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">이 워크스페이스의 지식을 기반으로 물어보세요.</p>
      <p className="text-xs text-muted-foreground">스코프 칩으로 범위를 조정할 수 있습니다.</p>
      <button onClick={onStart} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-accent">
        + 첫 대화 시작
      </button>
    </div>
  );
}
```

- [ ] **Step 11.2: Panel assembly**

```tsx
"use client";
import { useParams } from "next/navigation";
import { useThreadsStore } from "@/stores/threads-store";
import { useChatThreads } from "@/hooks/use-chat-threads";
import { useChatSend } from "@/hooks/use-chat-send";
import { PanelHeader } from "./panel-header";
import { Conversation } from "./conversation";
import { Composer } from "./composer";
import { ScopeChipsRow } from "./scope-chips-row";
import { AgentPanelEmptyState } from "./empty-state";
import { useState } from "react";

export function AgentPanel() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const workspaceKey = wsSlug ? `ws_slug:${wsSlug}` : null;
  const activeThreadId = useThreadsStore((s) => s.activeThreadId);
  const setActive = useThreadsStore((s) => s.setActiveThread);
  const { create } = useChatThreads(workspaceKey);
  const { send } = useChatSend(activeThreadId);
  const [scope, setScope] = useState<string[]>(["page", "project"]);
  const [strict, setStrict] = useState<"strict" | "loose">("strict");

  async function startNew() {
    const { id } = await create.mutateAsync({ title: "" });
    setActive(id);
  }

  return (
    <aside data-testid="app-shell-agent-panel" className="flex h-full flex-col border-l border-border bg-background">
      <PanelHeader onNewThread={startNew} />
      {activeThreadId ? (
        <Conversation threadId={activeThreadId} />
      ) : (
        <AgentPanelEmptyState onStart={startNew} />
      )}
      <ScopeChipsRow selected={scope} onChange={setScope} strict={strict} onStrictChange={setStrict} />
      <Composer
        disabled={!activeThreadId}
        onSend={(input) => send({ content: input.content, mode: input.mode, scope: { chips: scope, strict } })}
      />
    </aside>
  );
}
```

- [ ] **Step 11.3: Swap into AppShell**

Edit `apps/web/src/components/shell/app-shell.tsx`: replace `PlaceholderAgentPanel` with `AgentPanel`.

- [ ] **Step 11.4: Commit**

```bash
git add apps/web/src/components/agent-panel/{empty-state,agent-panel}.tsx \
        apps/web/src/components/shell/app-shell.tsx
git commit -m "feat(web): assemble AgentPanel and swap into AppShell"
```

---

## Task 12: E2E coverage

**Files:**
- Create: `apps/web/tests/e2e/agent-panel.spec.ts`

- [ ] **Step 12.1: Spec**

```ts
import { test, expect } from "@playwright/test";
import { loginAsTestUser, seedWorkspaceWithFirstProject } from "./helpers";

test.describe("Agent Panel", () => {
  test.beforeEach(async ({ page }) => loginAsTestUser(page));

  test("empty state shows on first visit and starts a thread", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible();
    await expect(page.getByText("첫 대화 시작")).toBeVisible();
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    await expect(page.getByPlaceholder("메시지를 입력하세요...")).not.toBeDisabled();
  });

  test("sends a message and receives streamed response", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    const ta = page.getByPlaceholder("메시지를 입력하세요...");
    await ta.fill("hello");
    await ta.press("Enter");
    await expect(page.getByText(/stub agent response to: hello/)).toBeVisible();
  });

  test("thumbs-down exposes reason chips", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    await page.getByPlaceholder("메시지를 입력하세요...").fill("hi");
    await page.getByPlaceholder("메시지를 입력하세요...").press("Enter");
    await page.getByLabel("싫어요").click();
    await expect(page.getByRole("button", { name: "incorrect" })).toBeVisible();
  });

  test("new thread via + preserves previous thread in list", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    await page.getByPlaceholder("메시지를 입력하세요...").fill("first");
    await page.getByPlaceholder("메시지를 입력하세요...").press("Enter");
    await page.getByLabel("새 대화").click();
    await page.getByLabel("대화 목록").click();
    await expect(page.getByText(/first/)).toBeVisible();
  });
});
```

- [ ] **Step 12.2: Commit**

```bash
git add apps/web/tests/e2e/agent-panel.spec.ts
git commit -m "test(web): e2e agent panel (empty, send, feedback, threads)"
```

---

## Task 13: Post-feature

- [ ] **Step 13.1: Full suite**

```bash
pnpm --filter @opencairn/api test
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web test:e2e -g "Agent Panel"
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web typecheck
```

- [ ] **Step 13.2: Real agent pipeline follow-up note**

Add an Open Question in `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` §14:
> **Agent pipeline integration**: Phase 4 ships a stub `runAgent` in `apps/api/src/lib/agent-pipeline.ts`. Replace with real `packages/llm` + `packages/agent-runtime` wiring in a follow-up (likely merged with humanizer + model-router spec implementations).

- [ ] **Step 13.3: Plans-status + memory + commit**

```bash
git add docs/contributing/plans-status.md \
        docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md
git commit -m "docs(docs,specs): mark app shell phase 4 complete, note agent pipeline followup"
```

---

## Completion Criteria

- [ ] Legacy `conversations/messages` dropped; `chat_threads/chat_messages/message_feedback` created
- [ ] Thread CRUD endpoints tested (list/create/patch/archive)
- [ ] Messages SSE endpoint persists user + agent rows and streams events
- [ ] Message feedback upserts correctly
- [ ] Agent panel renders header + thread list + empty state + conversation + composer + scope chips
- [ ] E2E agent-panel spec passes
- [ ] Manual smoke: open workspace → click "첫 대화 시작" → send message → stub response streams → thumbs down → reason chips appear → new thread via `+` → old thread visible in `···`

## What's NOT in this plan

| Item | Where |
|------|-------|
| Real agent pipeline (LLM calls, save-suggestion generation, citations, tool use) | Separate follow-up; stub `runAgent` in-place |
| Plan 11B save-suggestion editor loop | Plan 11A/B when implemented |
| Deep Research integration (research-mode specific UI) | Phase D |
| Voice input mic functional behavior (UI only here) | TBD, behind feature flag |
| Cross-workspace thread sharing | v2 |
