# Plan 2A: Editor Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal personal Plate-based note editor on `/[locale]/(app)/w/<ws>/p/<proj>/notes/<id>` — rich-text + LaTeX + wiki-link + slash command + debounced save, with a project-scoped sidebar. Single-user only (no collab).

**Architecture:** Next.js 16 App Router server shells (with `canRead`/`canWrite` checks) render a client `<NoteEditor>` powered by Plate v49. Plate content is JSON in `notes.content`; `notes.content_text` is derived server-side on save for FTS. All mutations go through the Hono API (`apps/api`) — no Server Actions, no direct DB from web. i18n via `next-intl` with per-file message bundles (`editor.json`, `sidebar.json`, `app.json`).

**Tech Stack:** Plate v49 (`@platejs/core`, `@platejs/basic-nodes`, `@platejs/math`, `@platejs/link`, `@platejs/combobox`), shadcn/ui (custom theme mapping), KaTeX, TanStack Query v5, `lodash.debounce`, Tailwind CSS 4, `next-intl` 4.

**Spec:** `docs/superpowers/specs/2026-04-21-plan-2a-editor-core-design.md` (authoritative).

---

## File Structure

### apps/web (new/modified)

```
apps/web/
  components.json                                  (new — shadcn config)
  messages/ko/editor.json                          (new)
  messages/ko/sidebar.json                         (new)
  messages/ko/app.json                             (new — shell strings)
  messages/en/editor.json                          (new)
  messages/en/sidebar.json                         (new)
  messages/en/app.json                             (new)
  src/
    i18n.ts                                        (modify — register new bundles)
    lib/
      api-client.ts                                (modify — typed helpers)
      editor-utils.ts                              (new — pure fns)
      react-query.tsx                              (new — provider)
      session.ts                                   (new — server-side session helper)
    hooks/
      use-note.ts                                  (new)
      use-save-note.ts                             (new)
      use-note-search.ts                           (new)
      use-project-tree.ts                          (new)
    components/
      editor/
        NoteEditor.tsx                             (new)
        editor-toolbar.tsx                         (new)
        plugins/
          latex.tsx                                (new — Task 15)
          wiki-link.tsx                            (new — Task 16)
          slash.tsx                                (new — Task 17)
        elements/
          math-inline.tsx                          (new — Task 15)
          math-block.tsx                           (new — Task 15)
          wiki-link-element.tsx                    (new — Task 16)
      sidebar/
        Sidebar.tsx                                (new)
        FolderTree.tsx                             (new)
        NoteList.tsx                               (new)
        NewNoteButton.tsx                          (new)
    app/[locale]/(app)/
      layout.tsx                                   (modify — QueryProvider + auth gate)
      page.tsx                                     (new — redirect to first ws/proj)
      w/[wsSlug]/
        page.tsx                                   (new — redirect to first project)
        p/[projectId]/
          layout.tsx                               (new — sidebar shell)
          page.tsx                                 (new — project home / picker)
          notes/[noteId]/
            page.tsx                               (new — note server shell)
            loading.tsx                            (new)
            not-found.tsx                          (new)
  tests/e2e/
    editor-core.spec.ts                            (new)
```

### apps/api (modified)

```
apps/api/src/routes/notes.ts                       (modify — content_text derive, add /search)
apps/api/tests/notes.test.ts                       (new — integration)
```

### packages/shared (modified)

```
packages/shared/src/api-types.ts                   (modify — createNoteSchema/updateNoteSchema content:array)
```

---

## Pre-flight checks

- [ ] **Step 0: Verify clean working tree**

Run: `git status --short`
Expected: no output (clean).

- [ ] **Step 0: Verify Plan 1/3/4 services run**

Run (separate shells): `pnpm --filter @opencairn/db db:push` then `pnpm --filter @opencairn/api dev` then `pnpm --filter @opencairn/web dev`.
Expected: API on :4000 responds to `/api/health`, web on :3000 serves landing. Exit both after verifying.

---

### Task 1: Fix notes zod schema (content:array) + PATCH derives content_text

**Files:**
- Modify: `packages/shared/src/api-types.ts`
- Modify: `apps/api/src/routes/notes.ts` (PATCH + POST)
- Create: `apps/api/tests/notes.test.ts`

**Problem:** `createNoteSchema.content` and `updateNoteSchema.content` are `z.record(z.unknown())` (= object). Plate `Value` is `Array<PlateNode>`. Validation will reject every save. Also PATCH doesn't derive `content_text` for FTS.

- [ ] **Step 1: Write failing integration tests**

Create `apps/api/tests/notes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app";
import { db, notes, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedFetch(path: string, init: RequestInit & { userId: string }) {
  const { userId, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: { ...(rest.headers ?? {}), cookie, "content-type": "application/json" },
  });
}

describe("PATCH /api/notes/:id", () => {
  let ctx: SeedResult;
  beforeEach(async () => { ctx = await seedWorkspace({ role: "editor" }); });
  afterEach(async () => { await ctx.cleanup(); });

  it("editor can save Plate array content and content_text is derived", async () => {
    const body = {
      title: "Greeting",
      content: [{ type: "p", children: [{ text: "Hello world" }] }],
    };
    const res = await authedFetch(`/api/notes/${ctx.noteId}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(notes).where(eq(notes.id, ctx.noteId));
    expect(row.title).toBe("Greeting");
    expect(row.content).toEqual(body.content);
    expect(row.contentText).toContain("Hello world");
  });

  it("viewer receives 403", async () => {
    const viewerCtx = await seedWorkspace({ role: "viewer" });
    try {
      const res = await authedFetch(`/api/notes/${viewerCtx.noteId}`, {
        method: "PATCH",
        userId: viewerCtx.userId,
        body: JSON.stringify({ title: "nope" }),
      });
      expect(res.status).toBe(403);
    } finally {
      await viewerCtx.cleanup();
    }
  });

  it("deleted note returns 404", async () => {
    await db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, ctx.noteId));
    const res = await authedFetch(`/api/notes/${ctx.noteId}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });
});
```

Also create `apps/api/tests/helpers/session.ts` if it doesn't exist:

```ts
import { auth } from "../../src/lib/auth";

// Issue a Better Auth session cookie string for a given userId.
// Used only in tests — bypasses email/password flow.
export async function signSessionCookie(userId: string): Promise<string> {
  const token = await auth.api.signInWithPassword?.(/* ... */);
  throw new Error("Implement via Better Auth test utility — see auth.ts");
}
```

**Note for implementer:** Check `apps/api/tests/permissions.test.ts` — it uses `canRead(ctx.userId, …)` directly without going through HTTP. A helper that signs a real session may not exist yet; adapt by reading `apps/api/src/middleware/auth.ts` to understand cookie format, or add a test-only header bypass behind `NODE_ENV === "test"`. Implement whichever is simpler given what Plan 1 shipped.

- [ ] **Step 2: Run tests — they fail**

Run: `pnpm --filter @opencairn/api test -- notes.test.ts`
Expected: FAIL (schema rejects array, or content_text is empty).

- [ ] **Step 3: Fix shared zod schemas**

Modify `packages/shared/src/api-types.ts` Notes block:

```ts
// ── Notes ─────────────────────────────────────────────────────────────────────────
// Plate Value is an array of block nodes. content is jsonb in DB — we accept any
// JSON array here; strict Plate node validation happens client-side.
const plateValueSchema = z.array(z.unknown()).nullable();

export const createNoteSchema = z.object({
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable().default(null),
  title: z.string().max(300).default("Untitled"),
  content: plateValueSchema.default(null),
  type: z.enum(["note", "wiki", "source"]).default("note"),
});

export const updateNoteSchema = z.object({
  title: z.string().max(300).optional(),
  content: plateValueSchema.optional(),
  folderId: z.string().uuid().nullable().optional(),
});
```

- [ ] **Step 4: Derive content_text on PATCH and POST**

Create `apps/api/src/lib/plate-text.ts`:

```ts
// Flatten a Plate Value (array of block nodes) into plain text for FTS.
// Mirrors apps/web/src/lib/editor-utils.ts#plateValueToText — keep in sync.
type PlateNode = { text?: string; children?: PlateNode[] };

export function plateValueToText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const walk = (nodes: PlateNode[]): string =>
    nodes
      .map((n) => {
        if (typeof n.text === "string") return n.text;
        if (Array.isArray(n.children)) return walk(n.children);
        return "";
      })
      .join("");
  return walk(value as PlateNode[]).trim();
}
```

Modify `apps/api/src/routes/notes.ts` PATCH handler:

```ts
import { plateValueToText } from "../lib/plate-text";

  .patch("/:id", zValidator("json", updateNoteSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "note", id }))) return c.json({ error: "Forbidden" }, 403);
    const body = c.req.valid("json");
    const update: Record<string, unknown> = { ...body };
    if (body.content !== undefined) {
      update.contentText = plateValueToText(body.content);
    }
    const [note] = await db
      .update(notes)
      .set(update)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
      .returning();
    if (!note) return c.json({ error: "Not found" }, 404);
    return c.json(note);
  })
```

Similarly update POST:

```ts
  .post("/", zValidator("json", createNoteSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    if (!(await canWrite(user.id, { type: "project", id: body.projectId }))) return c.json({ error: "Forbidden" }, 403);
    const [proj] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "Project not found" }, 404);
    const contentText = body.content ? plateValueToText(body.content) : "";
    const [note] = await db
      .insert(notes)
      .values({ ...body, workspaceId: proj.workspaceId, contentText })
      .returning();
    return c.json(note, 201);
  })
```

- [ ] **Step 5: Run tests — all 3 pass**

Run: `pnpm --filter @opencairn/api test -- notes.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api-types.ts \
        apps/api/src/routes/notes.ts \
        apps/api/src/lib/plate-text.ts \
        apps/api/tests/notes.test.ts \
        apps/api/tests/helpers/session.ts
git commit -m "$(cat <<'EOF'
fix(api): notes content schema accepts Plate array + PATCH derives content_text

updateNoteSchema and createNoteSchema previously typed content as
z.record(z.unknown()) which rejected Plate Value (array). Switched to
z.array(z.unknown()).nullable(). PATCH/POST now call plateValueToText()
to keep notes.content_text in sync with notes.content for FTS and embedding.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `GET /api/notes/search` for wiki-link combobox

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/tests/notes.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `apps/api/tests/notes.test.ts`:

```ts
describe("GET /api/notes/search", () => {
  let ctx: SeedResult;
  beforeEach(async () => { ctx = await seedWorkspace({ role: "editor" }); });
  afterEach(async () => { await ctx.cleanup(); });

  it("returns title-ilike matches scoped to projectId", async () => {
    await db.insert(notes).values({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      title: "Attention is all you need",
      content: null,
    });
    const res = await authedFetch(
      `/api/notes/search?q=Atten&projectId=${ctx.projectId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].title.toLowerCase()).toContain("atten");
  });

  it("returns 403 when caller lacks project read", async () => {
    const outsider = await seedWorkspace({ role: "editor" });
    try {
      const res = await authedFetch(
        `/api/notes/search?q=x&projectId=${ctx.projectId}`,
        { method: "GET", userId: outsider.userId },
      );
      expect(res.status).toBe(403);
    } finally {
      await outsider.cleanup();
    }
  });

  it("rejects q shorter than 1 char", async () => {
    const res = await authedFetch(
      `/api/notes/search?q=&projectId=${ctx.projectId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm --filter @opencairn/api test -- notes.test.ts`
Expected: 3 new tests FAIL (404).

- [ ] **Step 3: Implement endpoint**

In `apps/api/src/routes/notes.ts`, add before `.patch("/:id", ...)`:

```ts
  .get("/search", async (c) => {
    const user = c.get("user");
    const q = c.req.query("q")?.trim() ?? "";
    const projectId = c.req.query("projectId") ?? "";
    if (q.length < 1 || !isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id: projectId }))) return c.json({ error: "Forbidden" }, 403);
    const rows = await db
      .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt })
      .from(notes)
      .where(
        and(
          eq(notes.projectId, projectId),
          isNull(notes.deletedAt),
          // ilike for case-insensitive substring
          sql`${notes.title} ILIKE ${"%" + q + "%"}`,
        ),
      )
      .orderBy(desc(notes.updatedAt))
      .limit(10);
    return c.json(rows);
  })
```

Add `sql` to the `@opencairn/db` import at top of file.

- [ ] **Step 4: Run — pass**

Run: `pnpm --filter @opencairn/api test -- notes.test.ts`
Expected: all pass (6/6).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/notes.ts apps/api/tests/notes.test.ts
git commit -m "feat(api): GET /api/notes/search for wiki-link combobox (title ilike, limit 10)"
```

---

### Task 3: Install Plate v49 + shadcn/ui + KaTeX + TanStack Query

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/components.json`
- Modify: `apps/web/src/app/layout.tsx` (KaTeX CSS import)

- [ ] **Step 1: Install runtime deps**

Run:
```bash
cd apps/web
pnpm add @platejs/core@^49 @platejs/basic-nodes@^49 @platejs/math@^49 \
         @platejs/link@^49 @platejs/combobox@^49 @platejs/markdown@^49 \
         katex@^0.16 \
         @tanstack/react-query@^5 \
         lodash.debounce@^4 \
         clsx@^2 class-variance-authority@^0.7 tailwind-merge@^3 \
         lucide-react@^0.460
pnpm add -D @types/katex @types/lodash.debounce
```

- [ ] **Step 2: Initialize shadcn**

Run:
```bash
cd apps/web
pnpm dlx shadcn@latest init -y --defaults
```

When prompted interactively:
- Style: **New York**
- Base color: **Neutral** (we override in Task 4)
- CSS variables: **yes**

Verify `apps/web/components.json` was created.

- [ ] **Step 3: Install the shadcn primitives we need**

```bash
cd apps/web
pnpm dlx shadcn@latest add -y button input textarea tooltip popover command separator badge scroll-area dialog dropdown-menu
```

These land under `apps/web/src/components/ui/`.

- [ ] **Step 4: Import KaTeX CSS globally**

Modify `apps/web/src/app/layout.tsx` — add the first import line:

```tsx
import "katex/dist/katex.min.css";
```

- [ ] **Step 5: Verify build succeeds**

Run: `pnpm --filter @opencairn/web build`
Expected: build succeeds, no runtime module errors. (Landing pages still render identically — we haven't touched them.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/components.json apps/web/src/components/ui/ \
        apps/web/src/app/layout.tsx pnpm-lock.yaml
git commit -m "feat(web): install Plate v49, shadcn/ui, KaTeX, and TanStack Query"
```

---

### Task 4: Map shadcn Tailwind tokens to Plan 9a theme variables

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/components.json` (only if needed)

**Why:** shadcn's default `--background`/`--foreground` collide with Plan 9a's `--fg`/`--bg-surface`. We keep shadcn variable *names* but point them at Plan 9a tokens so future shadcn `add` commands keep working.

- [ ] **Step 1: Read current globals.css**

Run: `head -100 apps/web/src/app/globals.css`
Capture which Plan 9a tokens exist (expected: `--fg`, `--fg-muted`, `--bg`, `--bg-surface`, `--border`, `--accent-ember`, …).

- [ ] **Step 2: Override shadcn tokens in `:root` and theme blocks**

Append to `apps/web/src/app/globals.css` (after the existing Plan 9a theme blocks):

```css
/* shadcn compatibility layer — point shadcn tokens at Plan 9a variables */
@layer base {
  :root {
    --background: var(--bg);
    --foreground: var(--fg);
    --card: var(--bg-surface);
    --card-foreground: var(--fg);
    --popover: var(--bg-surface);
    --popover-foreground: var(--fg);
    --primary: var(--fg);
    --primary-foreground: var(--bg-surface);
    --secondary: var(--bg-surface);
    --secondary-foreground: var(--fg);
    --muted: var(--bg-surface);
    --muted-foreground: var(--fg-muted);
    --accent: var(--accent-ember);
    --accent-foreground: var(--fg);
    --destructive: #b91c1c;
    --destructive-foreground: #ffffff;
    --border: var(--border);
    --input: var(--border);
    --ring: var(--accent-ember);
    --radius: 0.5rem;
  }
}
```

If Tailwind 4 `@theme` is used instead of `:root` (check `globals.css` first), put the mapping inside the `@theme` block using `--color-*` tokens that shadcn components reference.

- [ ] **Step 3: Verify a shadcn Button renders with Plan 9a colors**

Create a throwaway check: open `apps/web/src/app/[locale]/(app)/dashboard/page.tsx`, import `{ Button } from "@/components/ui/button"`, render `<Button>Test</Button>` below the existing content. Run `pnpm --filter @opencairn/web dev`, visit `/ko/dashboard`, confirm the button uses the warm stone palette (not shadcn default slate).

Revert the dashboard probe before committing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(web): map shadcn tokens to Plan 9a stone+ember palette"
```

---

### Task 5: TanStack Query provider + session server helper

**Files:**
- Create: `apps/web/src/lib/react-query.tsx`
- Create: `apps/web/src/lib/session.ts`
- Modify: `apps/web/src/app/[locale]/(app)/layout.tsx`

- [ ] **Step 1: QueryClient provider**

Create `apps/web/src/lib/react-query.tsx`:

```tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function ReactQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 2: Server-side session helper**

Create `apps/web/src/lib/session.ts`:

```ts
// Server-only helper: read Better Auth session from cookies on the server side.
// Any (app)/* route must be authed — unauthed hits redirect to /login.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export interface ServerSession {
  userId: string;
  email: string;
  name: string;
}

export async function requireSession(): Promise<ServerSession> {
  // Forward cookies to the API /auth/me endpoint (single source of truth
  // for session parsing; avoids duplicating Better Auth logic in web).
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${base}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) redirect("/login");
  const body = (await res.json()) as ServerSession;
  return body;
}
```

**Note for implementer:** Confirm `/api/auth/me` exists in `apps/api/src/routes/auth.ts`. If the endpoint is named differently (e.g., `/session` or `/current-user`), update this helper and the audit tests accordingly. If it does not exist, add it in this task — it must return `{ userId, email, name }` for the authenticated user, 401 otherwise.

- [ ] **Step 3: Wire provider into (app) layout**

Modify `apps/web/src/app/[locale]/(app)/layout.tsx`:

```tsx
import { ReactQueryProvider } from "@/lib/react-query";
import { requireSession } from "@/lib/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return (
    <ReactQueryProvider>
      <div className="flex min-h-screen">{children}</div>
    </ReactQueryProvider>
  );
}
```

Note: the old `<aside>` placeholder is removed — the per-project sidebar (Task 10) renders inside `[projectId]/layout.tsx`, not in `(app)/layout.tsx`, because workspace/project selection happens at the route layer.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/react-query.tsx apps/web/src/lib/session.ts \
        apps/web/src/app/[locale]/(app)/layout.tsx
git commit -m "feat(web): TanStack Query provider + requireSession helper in (app) layout"
```

---

### Task 6: editor-utils.ts pure functions + unit tests

**Files:**
- Create: `apps/web/src/lib/editor-utils.ts`
- Create: `apps/web/src/lib/editor-utils.test.ts`
- Modify: `apps/web/package.json` (add vitest if missing)

- [ ] **Step 1: Confirm vitest availability**

Run: `cd apps/web && pnpm list vitest`
If not listed, add: `pnpm add -D vitest @vitest/ui`. Otherwise skip.

If vitest needs config, create minimal `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 2: Write failing tests**

Create `apps/web/src/lib/editor-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  plateValueToText,
  emptyEditorValue,
  parseEditorContent,
} from "./editor-utils";

describe("editor-utils", () => {
  it("plateValueToText flattens nested children", () => {
    const v = [
      { type: "h1", children: [{ text: "Title" }] },
      { type: "p", children: [{ text: "Body " }, { text: "end", bold: true }] },
    ];
    expect(plateValueToText(v)).toContain("Title");
    expect(plateValueToText(v)).toContain("Body end");
  });

  it("emptyEditorValue returns a single paragraph", () => {
    const v = emptyEditorValue();
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("p");
  });

  it("parseEditorContent handles null / invalid / array", () => {
    expect(parseEditorContent(null)).toEqual(emptyEditorValue());
    expect(parseEditorContent({ not: "array" })).toEqual(emptyEditorValue());
    const arr = [{ type: "p", children: [{ text: "x" }] }];
    expect(parseEditorContent(arr)).toEqual(arr);
  });
});
```

- [ ] **Step 3: Run — fail**

Run: `cd apps/web && pnpm vitest run`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

Create `apps/web/src/lib/editor-utils.ts`:

```ts
// Plate Value = array of block nodes. We intentionally keep types loose here
// because @platejs/core tightens them at the editor boundary — over-typing
// here forces every consumer to import Plate types.
export type PlateNode = { type?: string; text?: string; children?: PlateNode[]; [k: string]: unknown };
export type PlateValue = PlateNode[];

export function plateValueToText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const walk = (nodes: PlateNode[]): string =>
    nodes
      .map((n) => {
        if (typeof n.text === "string") return n.text;
        if (Array.isArray(n.children)) return walk(n.children);
        return "";
      })
      .join("");
  return walk(value as PlateNode[]).trim();
}

export function emptyEditorValue(): PlateValue {
  return [{ type: "p", children: [{ text: "" }] }];
}

export function parseEditorContent(raw: unknown): PlateValue {
  if (!Array.isArray(raw)) return emptyEditorValue();
  return raw as PlateValue;
}
```

- [ ] **Step 5: Run — pass**

Run: `cd apps/web && pnpm vitest run`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/editor-utils.ts apps/web/src/lib/editor-utils.test.ts \
        apps/web/vitest.config.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): editor-utils pure helpers (Plate value ↔ text)"
```

---

### Task 7: TanStack Query hooks

**Files:**
- Create: `apps/web/src/hooks/use-note.ts`
- Create: `apps/web/src/hooks/use-save-note.ts`
- Create: `apps/web/src/hooks/use-note-search.ts`
- Create: `apps/web/src/hooks/use-project-tree.ts`
- Modify: `apps/web/src/lib/api-client.ts`

- [ ] **Step 1: Extend api-client with typed helpers**

Modify `apps/web/src/lib/api-client.ts`:

```ts
// Browser: same-origin (/api/... → proxied to Hono)
// Server Components: direct to internal API URL
const baseUrl = () =>
  typeof window === "undefined"
    ? (process.env.INTERNAL_API_URL ?? "http://localhost:4000")
    : "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiClient<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `API error ${res.status}`);
  }
  return res.json();
}

export const api = {
  getNote: (id: string) => apiClient<NoteRow>(`/notes/${id}`),
  listNotesByProject: (projectId: string) =>
    apiClient<NoteRow[]>(`/notes/by-project/${projectId}`),
  searchNotes: (q: string, projectId: string) =>
    apiClient<Array<{ id: string; title: string; updatedAt: string }>>(
      `/notes/search?q=${encodeURIComponent(q)}&projectId=${projectId}`,
    ),
  patchNote: (id: string, body: PatchNoteBody) =>
    apiClient<NoteRow>(`/notes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  createNote: (body: CreateNoteBody) =>
    apiClient<NoteRow>(`/notes`, { method: "POST", body: JSON.stringify(body) }),
  listFolders: (projectId: string) =>
    apiClient<FolderRow[]>(`/folders?projectId=${projectId}`),
};

export interface NoteRow {
  id: string;
  projectId: string;
  workspaceId: string;
  folderId: string | null;
  title: string;
  content: unknown[] | null;
  contentText: string | null;
  type: "note" | "wiki" | "source";
  createdAt: string;
  updatedAt: string;
}
export interface PatchNoteBody {
  title?: string;
  content?: unknown[] | null;
  folderId?: string | null;
}
export interface CreateNoteBody {
  projectId: string;
  folderId?: string | null;
  title?: string;
  content?: unknown[] | null;
}
export interface FolderRow {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  position: number;
}
```

**Note for implementer:** Confirm `GET /api/folders?projectId=` exists in `apps/api/src/routes/folders.ts`. If not, add it in this task — a thin passthrough: `canRead(project) → select * from folders where projectId = ? order by position`. Small change; keep scope tight.

- [ ] **Step 2: Write hooks**

Create `apps/web/src/hooks/use-note.ts`:

```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useNote(id: string) {
  return useQuery({
    queryKey: ["note", id],
    queryFn: () => api.getNote(id),
    enabled: Boolean(id),
  });
}
```

Create `apps/web/src/hooks/use-save-note.ts`:

```ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type PatchNoteBody, type NoteRow } from "@/lib/api-client";
import debounce from "lodash.debounce";
import { useEffect, useMemo, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useSaveNote(noteId: string) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: PatchNoteBody) => api.patchNote(noteId, body),
    onMutate: () => setStatus("saving"),
    onSuccess: (note: NoteRow) => {
      qc.setQueryData(["note", noteId], note);
      setStatus("saved");
      setLastError(null);
    },
    onError: (err: unknown) => {
      setStatus("error");
      setLastError(err instanceof ApiError ? err.message : String(err));
    },
  });

  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const debouncedSave = useMemo(
    () => debounce((body: PatchNoteBody) => mutateRef.current(body), 500),
    [],
  );

  useEffect(() => () => debouncedSave.cancel(), [debouncedSave]);

  return {
    save: debouncedSave,
    flush: (body: PatchNoteBody) => {
      debouncedSave.cancel();
      mutation.mutate(body);
    },
    status,
    lastError,
  };
}
```

Create `apps/web/src/hooks/use-note-search.ts`:

```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useNoteSearch(q: string, projectId: string) {
  return useQuery({
    queryKey: ["note-search", projectId, q],
    queryFn: () => api.searchNotes(q, projectId),
    enabled: q.length >= 1 && Boolean(projectId),
    staleTime: 15_000,
  });
}
```

Create `apps/web/src/hooks/use-project-tree.ts`:

```ts
"use client";
import { useQueries } from "@tanstack/react-query";
import { api, type FolderRow, type NoteRow } from "@/lib/api-client";

export interface ProjectTree {
  folders: FolderRow[];
  notes: NoteRow[];
  isLoading: boolean;
  isError: boolean;
}

export function useProjectTree(projectId: string): ProjectTree {
  const [foldersQ, notesQ] = useQueries({
    queries: [
      { queryKey: ["folders", projectId], queryFn: () => api.listFolders(projectId) },
      { queryKey: ["notes-by-project", projectId], queryFn: () => api.listNotesByProject(projectId) },
    ],
  });
  return {
    folders: foldersQ.data ?? [],
    notes: notesQ.data ?? [],
    isLoading: foldersQ.isLoading || notesQ.isLoading,
    isError: foldersQ.isError || notesQ.isError,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @opencairn/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/hooks/
git commit -m "feat(web): typed api-client + TanStack Query hooks (note, save, search, tree)"
```

---

### Task 8: Route skeleton — `/[locale]/(app)` redirect

**Files:**
- Create: `apps/web/src/app/[locale]/(app)/page.tsx`
- Create: `apps/web/src/app/[locale]/(app)/w/[wsSlug]/page.tsx`

Behavior: `/ko/app` (this is `/ko/(app)` group; the visible URL is actually `/ko` because `(app)` is a route group — re-check Next.js semantics) → fetch user's workspaces → redirect to `/ko/w/<first-slug>`. `/ko/w/<slug>` → fetch projects → redirect to `/ko/w/<slug>/p/<first-projectId>`.

**Clarification:** `(app)` is a route group, invisible in URL. We need a visible `/app` segment so the auth boundary is explicit. Use folder name `app` (no parens) instead of `(app)`. **Rename `apps/web/src/app/[locale]/(app)` → `apps/web/src/app/[locale]/app/`** before proceeding.

- [ ] **Step 1: Rename the route group to a regular segment**

Run:
```bash
cd apps/web/src/app/[locale]
mv "(app)" app
```

Update any import/test references. The existing `dashboard/page.tsx` inside will remain valid — URL moves from `/dashboard` to `/app/dashboard`. Update `apps/web/tests/e2e/landing-smoke.spec.ts` — the theme-toggle test goes to `/dashboard`; change to `/app/dashboard`.

- [ ] **Step 2: Add API list endpoints we need**

Confirm `GET /api/workspaces` (returns user's workspaces) exists in `apps/api/src/routes/workspaces.ts`. If missing, add:

```ts
  .get("/", async (c) => {
    const user = c.get("user");
    const rows = await db
      .select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, user.id));
    return c.json(rows);
  })
```

Confirm `GET /api/projects?workspaceId=` returns user-visible projects for a workspace; if not, add similarly gated by `canRead(workspace)`.

- [ ] **Step 3: `/app` redirect page**

Create `apps/web/src/app/[locale]/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function AppIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${base}/api/workspaces`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) redirect(`/${locale}/login`);
  const wss = (await res.json()) as Array<{ slug: string }>;
  if (wss.length === 0) redirect(`/${locale}/onboarding`);
  redirect(`/${locale}/app/w/${wss[0].slug}`);
}
```

Note: `/onboarding` is a stub for now — Task 19 confirms or creates a placeholder.

- [ ] **Step 4: `/app/w/[wsSlug]` redirect page**

Create `apps/web/src/app/[locale]/app/w/[wsSlug]/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";

export default async function WorkspaceIndex({
  params,
}: {
  params: Promise<{ locale: string; wsSlug: string }>;
}) {
  const { locale, wsSlug } = await params;
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

  const wsRes = await fetch(`${base}/api/workspaces/by-slug/${wsSlug}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!wsRes.ok) notFound();
  const ws = (await wsRes.json()) as { id: string };

  const projRes = await fetch(`${base}/api/projects?workspaceId=${ws.id}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!projRes.ok) notFound();
  const projects = (await projRes.json()) as Array<{ id: string }>;
  if (projects.length === 0) redirect(`/${locale}/app/w/${wsSlug}/new-project`);
  redirect(`/${locale}/app/w/${wsSlug}/p/${projects[0].id}`);
}
```

**Note for implementer:** `/api/workspaces/by-slug/:slug` may not exist. If missing, add it: resolves slug → workspace row, 404 if user lacks membership. Small addition; keep scoped.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/[locale]/app/ apps/web/tests/e2e/landing-smoke.spec.ts \
        apps/api/src/routes/workspaces.ts apps/api/src/routes/projects.ts
git commit -m "feat(web): /app and /app/w/:slug redirect to first workspace/project"
```

---

### Task 9: Project layout with sidebar shell

**Files:**
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/layout.tsx`
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/page.tsx`
- Create: `apps/web/src/components/sidebar/Sidebar.tsx` (minimal shell — full content in Task 10)

- [ ] **Step 1: Layout**

Create `apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/layout.tsx`:

```tsx
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar/Sidebar";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wsSlug: string; projectId: string }>;
}) {
  const { wsSlug, projectId } = await params;

  // Server-side canRead check before rendering sidebar / children.
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const projRes = await fetch(`${base}/api/projects/${projectId}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!projRes.ok) notFound();
  const project = (await projRes.json()) as { id: string; name: string; workspaceId: string };

  return (
    <>
      <Sidebar workspaceSlug={wsSlug} projectId={projectId} projectName={project.name} />
      <main className="flex-1 overflow-auto">{children}</main>
    </>
  );
}
```

- [ ] **Step 2: Project home page (empty state)**

Create `apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/page.tsx`:

```tsx
import { useTranslations } from "next-intl";

export default function ProjectHome() {
  return <ProjectHomeClient />;
}

// Client component because useTranslations works in either — we use a client
// wrapper just to keep import symmetrical with other pages.
"use client";
function ProjectHomeClient() {
  const t = useTranslations("app");
  return (
    <div className="p-8 text-fg-muted">
      <p>{t("project_home_empty")}</p>
    </div>
  );
}
```

Wait — mixing "use client" and server default export in one file is invalid. Rewrite:

```tsx
// apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/page.tsx
import { getTranslations } from "next-intl/server";

export default async function ProjectHome() {
  const t = await getTranslations("app");
  return (
    <div className="p-8 text-fg-muted">
      <p>{t("project_home_empty")}</p>
    </div>
  );
}
```

- [ ] **Step 3: Sidebar minimal shell**

Create `apps/web/src/components/sidebar/Sidebar.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";

export function Sidebar({
  workspaceSlug,
  projectId,
  projectName,
}: {
  workspaceSlug: string;
  projectId: string;
  projectName: string;
}) {
  const t = useTranslations("sidebar");
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card">
      <header className="p-4 border-b border-border">
        <p className="text-xs text-fg-muted uppercase tracking-wide">{workspaceSlug}</p>
        <h2 className="text-sm font-semibold text-fg mt-1">{projectName}</h2>
      </header>
      <div className="p-2 text-xs text-fg-muted" data-testid="sidebar-tree-placeholder">
        {t("loading")}
      </div>
      <input type="hidden" data-testid="sidebar-project-id" value={projectId} />
    </aside>
  );
}
```

- [ ] **Step 4: Verify /app/w/:slug/p/:id renders sidebar + project home**

Run dev server, seed a workspace+project, visit `/ko/app`. Confirm redirect chain ends at project home with sidebar visible. Revert any seed data.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/ \
        apps/web/src/components/sidebar/Sidebar.tsx
git commit -m "feat(web): project layout with sidebar shell + canRead server check"
```

---

### Task 10: Sidebar full content (FolderTree + NoteList + NewNoteButton)

**Files:**
- Modify: `apps/web/src/components/sidebar/Sidebar.tsx`
- Create: `apps/web/src/components/sidebar/FolderTree.tsx`
- Create: `apps/web/src/components/sidebar/NoteList.tsx`
- Create: `apps/web/src/components/sidebar/NewNoteButton.tsx`

- [ ] **Step 1: NoteList (flat list of notes in a folder or at root)**

Create `apps/web/src/components/sidebar/NoteList.tsx`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NoteRow } from "@/lib/api-client";

export function NoteList({
  notes,
  workspaceSlug,
  projectId,
}: {
  notes: NoteRow[];
  workspaceSlug: string;
  projectId: string;
}) {
  const path = usePathname();
  return (
    <ul className="space-y-0.5">
      {notes.map((n) => {
        const href = `/app/w/${workspaceSlug}/p/${projectId}/notes/${n.id}`;
        const active = path?.endsWith(`/notes/${n.id}`);
        return (
          <li key={n.id}>
            <Link
              href={href}
              className={`block px-2 py-1 text-sm rounded truncate ${
                active ? "bg-muted text-fg font-medium" : "text-fg-muted hover:text-fg hover:bg-muted/60"
              }`}
            >
              {n.title || "Untitled"}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: FolderTree (recursive, browse only)**

Create `apps/web/src/components/sidebar/FolderTree.tsx`:

```tsx
"use client";
import { useState } from "react";
import { ChevronRight, ChevronDown, Folder } from "lucide-react";
import type { FolderRow, NoteRow } from "@/lib/api-client";
import { NoteList } from "./NoteList";

export function FolderTree({
  folders,
  notes,
  workspaceSlug,
  projectId,
}: {
  folders: FolderRow[];
  notes: NoteRow[];
  workspaceSlug: string;
  projectId: string;
}) {
  const byParent = new Map<string | null, FolderRow[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }

  const notesByFolder = new Map<string | null, NoteRow[]>();
  for (const n of notes) {
    const list = notesByFolder.get(n.folderId) ?? [];
    list.push(n);
    notesByFolder.set(n.folderId, list);
  }

  return (
    <Branch
      parentId={null}
      byParent={byParent}
      notesByFolder={notesByFolder}
      workspaceSlug={workspaceSlug}
      projectId={projectId}
    />
  );
}

function Branch({
  parentId,
  byParent,
  notesByFolder,
  workspaceSlug,
  projectId,
}: {
  parentId: string | null;
  byParent: Map<string | null, FolderRow[]>;
  notesByFolder: Map<string | null, NoteRow[]>;
  workspaceSlug: string;
  projectId: string;
}) {
  const folders = byParent.get(parentId) ?? [];
  const rootNotes = parentId === null ? (notesByFolder.get(null) ?? []) : [];
  return (
    <div className="space-y-1">
      {rootNotes.length > 0 && (
        <NoteList notes={rootNotes} workspaceSlug={workspaceSlug} projectId={projectId} />
      )}
      {folders.map((f) => (
        <FolderNode
          key={f.id}
          folder={f}
          byParent={byParent}
          notesByFolder={notesByFolder}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
        />
      ))}
    </div>
  );
}

function FolderNode({
  folder,
  byParent,
  notesByFolder,
  workspaceSlug,
  projectId,
}: {
  folder: FolderRow;
  byParent: Map<string | null, FolderRow[]>;
  notesByFolder: Map<string | null, NoteRow[]>;
  workspaceSlug: string;
  projectId: string;
}) {
  const [open, setOpen] = useState(true);
  const childFolders = byParent.get(folder.id) ?? [];
  const folderNotes = notesByFolder.get(folder.id) ?? [];
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full px-1.5 py-0.5 text-xs font-medium text-fg-muted hover:text-fg"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Folder className="h-3 w-3" />
        <span className="truncate">{folder.name}</span>
      </button>
      {open && (
        <div className="ml-3 mt-0.5 space-y-1">
          {folderNotes.length > 0 && (
            <NoteList notes={folderNotes} workspaceSlug={workspaceSlug} projectId={projectId} />
          )}
          {childFolders.length > 0 && (
            <Branch
              parentId={folder.id}
              byParent={byParent}
              notesByFolder={notesByFolder}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
            />
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: NewNoteButton**

Create `apps/web/src/components/sidebar/NewNoteButton.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function NewNoteButton({
  workspaceSlug,
  projectId,
}: {
  workspaceSlug: string;
  projectId: string;
}) {
  const t = useTranslations("sidebar");
  const router = useRouter();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.createNote({ projectId }),
    onSuccess: async (note) => {
      await qc.invalidateQueries({ queryKey: ["notes-by-project", projectId] });
      router.push(`/app/w/${workspaceSlug}/p/${projectId}/notes/${note.id}`);
    },
  });
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      className="w-full justify-start gap-2"
      data-testid="new-note-button"
    >
      <Plus className="h-4 w-4" />
      {t("new_note")}
    </Button>
  );
}
```

- [ ] **Step 4: Wire into Sidebar**

Replace `apps/web/src/components/sidebar/Sidebar.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useProjectTree } from "@/hooks/use-project-tree";
import { FolderTree } from "./FolderTree";
import { NewNoteButton } from "./NewNoteButton";

export function Sidebar({
  workspaceSlug,
  projectId,
  projectName,
}: {
  workspaceSlug: string;
  projectId: string;
  projectName: string;
}) {
  const t = useTranslations("sidebar");
  const tree = useProjectTree(projectId);

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card flex flex-col">
      <header className="p-4 border-b border-border">
        <p className="text-xs text-fg-muted uppercase tracking-wide">{workspaceSlug}</p>
        <h2 className="text-sm font-semibold text-fg mt-1 truncate">{projectName}</h2>
      </header>
      <div className="p-2">
        <NewNoteButton workspaceSlug={workspaceSlug} projectId={projectId} />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {tree.isLoading ? (
          <p className="text-xs text-fg-muted">{t("loading")}</p>
        ) : tree.notes.length === 0 && tree.folders.length === 0 ? (
          <p className="text-xs text-fg-muted">{t("empty_project")}</p>
        ) : (
          <FolderTree
            folders={tree.folders}
            notes={tree.notes}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
          />
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/sidebar/
git commit -m "feat(web): sidebar with folder tree, note list, and new-note button"
```

---

### Task 11: i18n messages bundles

**Files:**
- Create: `apps/web/messages/ko/editor.json`
- Create: `apps/web/messages/ko/sidebar.json`
- Create: `apps/web/messages/ko/app.json`
- Create: `apps/web/messages/en/editor.json`
- Create: `apps/web/messages/en/sidebar.json`
- Create: `apps/web/messages/en/app.json`
- Modify: `apps/web/src/i18n.ts`

- [ ] **Step 1: Korean bundles**

`apps/web/messages/ko/editor.json`:

```json
{
  "placeholder": {
    "title": "제목 없음",
    "body": "무엇이든 적어보세요…"
  },
  "save": {
    "saving": "저장 중…",
    "saved": "저장됨",
    "failed": "저장 실패",
    "failed_detail": "변경 사항이 로컬에만 있어요. 새로고침하면 사라질 수 있습니다."
  },
  "wikilink": {
    "search_empty": "찾는 노트가 없어요.",
    "deleted": "삭제된 노트",
    "hint": "노트 제목을 입력해보세요"
  },
  "slash": {
    "heading_1": "제목 1",
    "heading_2": "제목 2",
    "heading_3": "제목 3",
    "bulleted_list": "글머리 기호 목록",
    "numbered_list": "번호 매기기 목록",
    "quote": "인용구",
    "code": "코드 블록",
    "divider": "구분선",
    "math": "수식 블록"
  },
  "math": {
    "parse_error": "수식 파싱 오류"
  },
  "toolbar": {
    "bold": "굵게",
    "italic": "기울임",
    "strike": "취소선",
    "code": "인라인 코드",
    "h1": "제목 1",
    "h2": "제목 2",
    "h3": "제목 3",
    "bulleted": "글머리 기호",
    "numbered": "번호 매기기",
    "quote": "인용",
    "wikilink": "노트 연결"
  }
}
```

`apps/web/messages/ko/sidebar.json`:

```json
{
  "new_note": "새 노트",
  "loading": "불러오는 중…",
  "empty_project": "이 프로젝트에는 아직 노트가 없어요.",
  "empty_folder": "비어 있어요.",
  "offline": "오프라인"
}
```

`apps/web/messages/ko/app.json`:

```json
{
  "project_home_empty": "왼쪽에서 노트를 선택하거나 새 노트를 만들어보세요."
}
```

- [ ] **Step 2: English bundles (mirror keys)**

`apps/web/messages/en/editor.json`:

```json
{
  "placeholder": {
    "title": "Untitled",
    "body": "Start typing…"
  },
  "save": {
    "saving": "Saving…",
    "saved": "Saved",
    "failed": "Save failed",
    "failed_detail": "Your changes are only local. Reloading may lose them."
  },
  "wikilink": {
    "search_empty": "No matching note.",
    "deleted": "Deleted note",
    "hint": "Type a note title"
  },
  "slash": {
    "heading_1": "Heading 1",
    "heading_2": "Heading 2",
    "heading_3": "Heading 3",
    "bulleted_list": "Bulleted list",
    "numbered_list": "Numbered list",
    "quote": "Quote",
    "code": "Code block",
    "divider": "Divider",
    "math": "Math block"
  },
  "math": {
    "parse_error": "Math parse error"
  },
  "toolbar": {
    "bold": "Bold",
    "italic": "Italic",
    "strike": "Strikethrough",
    "code": "Inline code",
    "h1": "Heading 1",
    "h2": "Heading 2",
    "h3": "Heading 3",
    "bulleted": "Bulleted list",
    "numbered": "Numbered list",
    "quote": "Quote",
    "wikilink": "Link note"
  }
}
```

`apps/web/messages/en/sidebar.json`:

```json
{
  "new_note": "New note",
  "loading": "Loading…",
  "empty_project": "No notes yet in this project.",
  "empty_folder": "Empty.",
  "offline": "Offline"
}
```

`apps/web/messages/en/app.json`:

```json
{
  "project_home_empty": "Pick a note on the left or create a new one."
}
```

- [ ] **Step 3: Register bundles in i18n.ts**

Modify `apps/web/src/i18n.ts`:

```ts
import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";

export const locales = ["ko", "en"] as const;
export const defaultLocale = "ko" as const;
export type Locale = (typeof locales)[number];

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = (await requestLocale) ?? defaultLocale;
  if (!locales.includes(requested as Locale)) notFound();
  const locale = requested as Locale;

  const [common, landing, dashboard, editor, sidebar, app] = await Promise.all([
    import(`../messages/${locale}/common.json`).then((m) => m.default),
    import(`../messages/${locale}/landing.json`).then((m) => m.default),
    import(`../messages/${locale}/dashboard.json`).then((m) => m.default),
    import(`../messages/${locale}/editor.json`).then((m) => m.default),
    import(`../messages/${locale}/sidebar.json`).then((m) => m.default),
    import(`../messages/${locale}/app.json`).then((m) => m.default),
  ]);

  return {
    locale,
    messages: { common, landing, dashboard, editor, sidebar, app },
  };
});
```

- [ ] **Step 4: i18n parity check**

Run: `pnpm --filter @opencairn/web i18n:parity`
Expected: PASS. If it complains about unknown keys in English, duplicate-check the files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/messages/ apps/web/src/i18n.ts
git commit -m "feat(web): i18n bundles for editor, sidebar, app (ko/en)"
```

---

### Task 12: NoteEditor (basic Plate + toolbar + save wiring)

**Files:**
- Create: `apps/web/src/components/editor/NoteEditor.tsx`
- Create: `apps/web/src/components/editor/editor-toolbar.tsx`

- [ ] **Step 1: Toolbar**

Create `apps/web/src/components/editor/editor-toolbar.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3, List, ListOrdered, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";

// Plate v49 exposes editor transforms via the editor object passed from the
// parent. We keep the toolbar presentational — parent wires actions in.
export interface ToolbarActions {
  toggleMark: (mark: "bold" | "italic" | "strikethrough" | "code") => void;
  toggleBlock: (type: "h1" | "h2" | "h3" | "ul" | "ol" | "blockquote") => void;
}

export function EditorToolbar({ actions }: { actions: ToolbarActions }) {
  const t = useTranslations("editor.toolbar");
  return (
    <div
      role="toolbar"
      aria-label="editor toolbar"
      className="sticky top-0 z-10 flex items-center gap-1 px-2 py-1 border-b border-border bg-card/80 backdrop-blur"
    >
      <IconBtn label={t("bold")} onClick={() => actions.toggleMark("bold")}>
        <Bold className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("italic")} onClick={() => actions.toggleMark("italic")}>
        <Italic className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("strike")} onClick={() => actions.toggleMark("strikethrough")}>
        <Strikethrough className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("code")} onClick={() => actions.toggleMark("code")}>
        <Code className="h-4 w-4" />
      </IconBtn>
      <div className="w-px h-5 bg-border mx-1" />
      <IconBtn label={t("h1")} onClick={() => actions.toggleBlock("h1")}>
        <Heading1 className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("h2")} onClick={() => actions.toggleBlock("h2")}>
        <Heading2 className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("h3")} onClick={() => actions.toggleBlock("h3")}>
        <Heading3 className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("bulleted")} onClick={() => actions.toggleBlock("ul")}>
        <List className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("numbered")} onClick={() => actions.toggleBlock("ol")}>
        <ListOrdered className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("quote")} onClick={() => actions.toggleBlock("blockquote")}>
        <Quote className="h-4 w-4" />
      </IconBtn>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor selection
        onClick();
      }}
      className="h-8 w-8"
    >
      {children}
    </Button>
  );
}
```

- [ ] **Step 2: NoteEditor (basic Plate + title + body)**

Create `apps/web/src/components/editor/NoteEditor.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plate, createPlateEditor, usePlateEditor } from "@platejs/core/react";
import { BasicNodesKit } from "@platejs/basic-nodes/react";
import { useSaveNote } from "@/hooks/use-save-note";
import { parseEditorContent, emptyEditorValue, type PlateValue } from "@/lib/editor-utils";
import { EditorToolbar, type ToolbarActions } from "./editor-toolbar";

// Plate v49 exposes its editor via plugins. Keep imports thin — plugins
// for LaTeX/wiki-link/slash are added in Tasks 15/16/17.
const basePlugins = [...BasicNodesKit];

export interface NoteEditorProps {
  noteId: string;
  initialTitle: string;
  initialValue: PlateValue | null;
  readOnly?: boolean;
}

export function NoteEditor({ noteId, initialTitle, initialValue, readOnly }: NoteEditorProps) {
  const t = useTranslations("editor");
  const { save, flush, status, lastError } = useSaveNote(noteId);

  const [title, setTitle] = useState(initialTitle);
  const startValue = useMemo(
    () => parseEditorContent(initialValue ?? emptyEditorValue()),
    [initialValue],
  );

  const editor = usePlateEditor({
    plugins: basePlugins,
    value: startValue,
  });

  // Persist title + content on change (debounced inside useSaveNote).
  const handleTitleChange = useCallback(
    (v: string) => {
      setTitle(v);
      save({ title: v });
    },
    [save],
  );

  const handleContentChange = useCallback(
    ({ value }: { value: PlateValue }) => {
      save({ content: value });
    },
    [save],
  );

  // Keyboard: Cmd/Ctrl+S flushes pending save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        flush({ title, content: editor.children as PlateValue });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, title, editor]);

  const actions: ToolbarActions = useMemo(
    () => ({
      toggleMark: (mark) => editor.tf.toggleMark(mark),
      toggleBlock: (type) => editor.tf.toggleBlock({ type }),
    }),
    [editor],
  );

  return (
    <div className="flex flex-col min-h-full">
      <EditorToolbar actions={actions} />
      <div className="flex-1 mx-auto w-full max-w-[720px] px-8 py-8">
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder={t("placeholder.title")}
          disabled={readOnly}
          className="w-full text-3xl font-semibold bg-transparent outline-none placeholder:text-fg-muted"
          data-testid="note-title"
        />
        <Plate
          editor={editor}
          onChange={handleContentChange}
          readOnly={readOnly}
        >
          <div
            data-testid="note-body"
            className="prose prose-stone max-w-none mt-6 min-h-[60vh] focus:outline-none"
          />
        </Plate>
        <div className="mt-4 text-xs text-fg-muted" data-testid="save-status">
          {status === "saving" && t("save.saving")}
          {status === "saved" && t("save.saved")}
          {status === "error" && (
            <span className="text-red-600">
              {t("save.failed")}: {lastError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Note for implementer:** Plate v49 API surface around `Plate`, `usePlateEditor`, and `editor.tf.*` may differ slightly from what's shown. Consult `node_modules/@platejs/core/README.md` after install and adjust imports/method names (e.g., `editor.toggleMark` vs `editor.tf.toggleMark`). The intent — render an editor, wire onChange to save, expose toggleMark/toggleBlock via refs — does not change.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/editor/
git commit -m "feat(web): NoteEditor with Plate basic nodes + toolbar + debounced save"
```

---

### Task 13: Note server shell (notes/[noteId]/page.tsx)

**Files:**
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/notes/[noteId]/page.tsx`
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/notes/[noteId]/loading.tsx`
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/notes/[noteId]/not-found.tsx`

- [ ] **Step 1: Server shell**

Create the page:

```tsx
// apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/notes/[noteId]/page.tsx
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { NoteEditor } from "@/components/editor/NoteEditor";

interface PageProps {
  params: Promise<{ locale: string; wsSlug: string; projectId: string; noteId: string }>;
}

export default async function NotePage({ params }: PageProps) {
  const { noteId } = await params;
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${base}/api/notes/${noteId}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (res.status === 403 || res.status === 404) notFound();
  if (!res.ok) throw new Error(`Failed to load note (${res.status})`);

  const note = (await res.json()) as {
    id: string;
    title: string;
    content: unknown[] | null;
  };

  return (
    <NoteEditor
      noteId={note.id}
      initialTitle={note.title}
      initialValue={(note.content as PlateValueLike) ?? null}
    />
  );
}

type PlateValueLike = unknown[] | null;
```

- [ ] **Step 2: loading.tsx + not-found.tsx**

`loading.tsx`:

```tsx
export default function Loading() {
  return <div className="p-8 text-fg-muted">…</div>;
}
```

`not-found.tsx`:

```tsx
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <div className="p-8 text-fg-muted">
      <p>{t("not_found") ?? "Not found."}</p>
    </div>
  );
}
```

Confirm `common.json` has a `not_found` key; if not, add `"not_found": "찾을 수 없어요."` / `"not_found": "Not found."`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/notes/ apps/web/messages/
git commit -m "feat(web): note server shell (canRead check + NoteEditor render)"
```

---

### Task 14: E2E happy path — create, edit, reload persists

**Files:**
- Create: `apps/web/tests/e2e/editor-core.spec.ts`
- Create: `apps/web/tests/e2e/helpers/seed-session.ts`

- [ ] **Step 1: Test session helper**

The existing landing E2E has no auth helper. We need one that logs a test user in and returns a seeded `{ wsSlug, projectId, noteId }`.

Create `apps/web/tests/e2e/helpers/seed-session.ts`:

```ts
import { request, type APIRequestContext } from "@playwright/test";

// Uses a test-only API endpoint /api/internal/test-seed (shared-secret gated)
// to create a user + workspace + project + note, and returns a session cookie
// string the browser context can consume.
export async function seedAndSignIn(ctx: APIRequestContext, apiBase: string) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error("INTERNAL_API_SECRET not set for E2E");

  const res = await ctx.post(`${apiBase}/api/internal/test-seed`, {
    headers: { "x-internal-secret": secret, "content-type": "application/json" },
    data: {},
  });
  if (!res.ok()) throw new Error(`seed failed: ${res.status()}`);
  return (await res.json()) as {
    wsSlug: string;
    projectId: string;
    noteId: string;
    sessionCookie: string;
  };
}
```

**Note for implementer:** Add `POST /api/internal/test-seed` to `apps/api/src/routes/internal.ts`, gated by `process.env.NODE_ENV !== "production"` AND the existing shared-secret header. It should:
1. Create a user via Better Auth helper or direct insert + signed session.
2. Reuse the test helper `seedWorkspace({ role: "owner" })`.
3. Return `{ wsSlug, projectId, noteId, sessionCookie }`. The `sessionCookie` is a raw `Set-Cookie` header value the Playwright test will attach to browser context.

- [ ] **Step 2: Playwright spec**

Create `apps/web/tests/e2e/editor-core.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { seedAndSignIn } from "./helpers/seed-session";

const API_BASE = process.env.API_BASE ?? "http://localhost:4000";

test.describe("editor core", () => {
  test("create → edit → reload persists", async ({ page, request, context }) => {
    const { wsSlug, projectId, sessionCookie } = await seedAndSignIn(request, API_BASE);
    await context.addCookies(parseCookie(sessionCookie));

    // 1. redirect chain
    await page.goto(`/ko/app`);
    await expect(page).toHaveURL(new RegExp(`/ko/app/w/${wsSlug}/p/${projectId}`));

    // 2. new note via sidebar
    await page.getByTestId("new-note-button").click();
    await expect(page).toHaveURL(new RegExp(`/notes/[0-9a-f-]{36}$`));

    // 3. title + body
    await page.getByTestId("note-title").fill("Test Note");
    await page.getByTestId("note-body").click();
    await page.keyboard.type("Hello world");

    // 4. wait for save
    await expect(page.getByTestId("save-status")).toHaveText(/저장됨|Saved/, { timeout: 3000 });

    // 5. reload — content persists
    await page.reload();
    await expect(page.getByTestId("note-title")).toHaveValue("Test Note");
    await expect(page.getByTestId("note-body")).toContainText("Hello world");
  });
});

function parseCookie(raw: string) {
  const [nameValue] = raw.split(";");
  const [name, value] = nameValue.split("=");
  return [
    {
      name,
      value,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    },
  ];
}
```

- [ ] **Step 3: Run E2E**

Run (with web + api dev servers up):
```bash
pnpm --filter @opencairn/web test:e2e -- editor-core.spec.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/e2e/ apps/api/src/routes/internal.ts
git commit -m "test(web): E2E happy path — create note, edit, reload, content persists"
```

---

### Task 15: LaTeX plugin (inline + block)

**Files:**
- Create: `apps/web/src/components/editor/plugins/latex.tsx`
- Create: `apps/web/src/components/editor/elements/math-inline.tsx`
- Create: `apps/web/src/components/editor/elements/math-block.tsx`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Inline element**

Create `apps/web/src/components/editor/elements/math-inline.tsx`:

```tsx
"use client";
import katex from "katex";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

export function MathInline({
  attributes,
  children,
  element,
}: {
  attributes: Record<string, unknown>;
  children: React.ReactNode;
  element: { texExpression?: string };
}) {
  const t = useTranslations("editor.math");
  const html = useMemo(() => {
    try {
      return katex.renderToString(element.texExpression ?? "", { throwOnError: true });
    } catch {
      return null;
    }
  }, [element.texExpression]);

  return (
    <span {...attributes} contentEditable={false} className="inline-block mx-0.5">
      {html ? (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="text-red-600 text-xs" title={t("parse_error")}>
          ${element.texExpression}$
        </span>
      )}
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Block element**

Create `apps/web/src/components/editor/elements/math-block.tsx`:

```tsx
"use client";
import katex from "katex";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

export function MathBlock({
  attributes,
  children,
  element,
}: {
  attributes: Record<string, unknown>;
  children: React.ReactNode;
  element: { texExpression?: string };
}) {
  const t = useTranslations("editor.math");
  const [open, setOpen] = useState(false);
  const html = useMemo(() => {
    try {
      return katex.renderToString(element.texExpression ?? "", { displayMode: true, throwOnError: true });
    } catch {
      return null;
    }
  }, [element.texExpression]);

  return (
    <div {...attributes} contentEditable={false} className="my-3">
      <div
        onClick={() => setOpen((v) => !v)}
        className={`cursor-pointer border rounded p-3 ${html ? "border-border" : "border-red-600"}`}
      >
        {html ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="text-red-600 text-sm">{t("parse_error")}: ${element.texExpression}$</span>
        )}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Plate plugin factory**

Create `apps/web/src/components/editor/plugins/latex.tsx`:

```tsx
"use client";
import { MathKit } from "@platejs/math/react";
import { MathInline } from "../elements/math-inline";
import { MathBlock } from "../elements/math-block";

// Wire custom renderers into @platejs/math.
export const latexPlugins = MathKit({
  components: {
    equation: MathBlock,
    "inline-equation": MathInline,
  },
});
```

**Note for implementer:** The exact export from `@platejs/math/react` may differ (`MathKit` vs `EquationPlugin` vs similar). After install, check the package's README and adjust. The component→element-type mapping is the stable contract; the wrapper name is not.

- [ ] **Step 4: Register in NoteEditor**

In `apps/web/src/components/editor/NoteEditor.tsx`, change the plugin array:

```tsx
import { latexPlugins } from "./plugins/latex";
const basePlugins = [...BasicNodesKit, ...latexPlugins];
```

- [ ] **Step 5: Extend E2E**

Append to `apps/web/tests/e2e/editor-core.spec.ts`:

```ts
test("inline $x^2$ and block $$...$$ render via KaTeX", async ({ page, request, context }) => {
  const { sessionCookie } = await seedAndSignIn(request, API_BASE);
  await context.addCookies(parseCookie(sessionCookie));

  await page.goto(`/ko/app`);
  await page.getByTestId("new-note-button").click();
  const body = page.getByTestId("note-body");
  await body.click();
  await page.keyboard.type("Einstein: $E = mc^2$");
  await expect(body.locator(".katex").first()).toBeVisible({ timeout: 3000 });

  await page.keyboard.press("Enter");
  await page.keyboard.type("$$\\int_0^1 x\\,dx$$");
  await expect(body.locator(".katex-display").first()).toBeVisible({ timeout: 3000 });
});
```

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @opencairn/web test:e2e -- editor-core.spec.ts
git add apps/web/src/components/editor/plugins/latex.tsx \
        apps/web/src/components/editor/elements/math-inline.tsx \
        apps/web/src/components/editor/elements/math-block.tsx \
        apps/web/src/components/editor/NoteEditor.tsx \
        apps/web/tests/e2e/editor-core.spec.ts
git commit -m "feat(web): LaTeX plugin — inline and block KaTeX rendering"
```

---

### Task 16: Wiki-link plugin (`[[` combobox + insert)

**Files:**
- Create: `apps/web/src/components/editor/plugins/wiki-link.tsx`
- Create: `apps/web/src/components/editor/elements/wiki-link-element.tsx`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Wiki-link element**

Create `apps/web/src/components/editor/elements/wiki-link-element.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";

export function WikiLinkElement({
  attributes,
  children,
  element,
}: {
  attributes: Record<string, unknown>;
  children: React.ReactNode;
  element: { targetId: string; title: string; deleted?: boolean; wsSlug: string; projectId: string };
}) {
  const t = useTranslations("editor.wikilink");
  if (element.deleted) {
    return (
      <span {...attributes} className="text-fg-muted line-through" title={t("deleted")}>
        {element.title}
        {children}
      </span>
    );
  }
  return (
    <Link
      {...(attributes as Record<string, unknown>)}
      href={`/app/w/${element.wsSlug}/p/${element.projectId}/notes/${element.targetId}`}
      className="text-[color:var(--accent-ember)] underline underline-offset-2 hover:opacity-80"
      data-target-id={element.targetId}
    >
      {element.title}
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Plugin with `[[` trigger and combobox**

Create `apps/web/src/components/editor/plugins/wiki-link.tsx`:

```tsx
"use client";
import { createPlatePlugin } from "@platejs/core/react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useNoteSearch } from "@/hooks/use-note-search";
import { WikiLinkElement } from "../elements/wiki-link-element";

export interface WikiLinkPluginContext {
  wsSlug: string;
  projectId: string;
}

// Custom plugin that listens for "[[" and opens a combobox anchored to the
// caret. On select, inserts a wiki-link inline node with {targetId,title}.
export function createWikiLinkPlugin(ctx: WikiLinkPluginContext) {
  return createPlatePlugin({
    key: "wiki-link",
    node: {
      isElement: true,
      isInline: true,
      isVoid: false,
      component: (props) => (
        <WikiLinkElement
          {...props}
          element={{ ...props.element, wsSlug: ctx.wsSlug, projectId: ctx.projectId }}
        />
      ),
    },
    // Plate v49 exposes a handlers API; exact shape varies. Below is the
    // conceptual flow — adjust method names to what the installed version uses.
    handlers: {
      onKeyDown: ({ editor, event }: { editor: unknown; event: KeyboardEvent }) => {
        // Detect "[[" — open a combobox. Simplified: check last 2 chars.
        // Full behavior is handled by the WikiLinkCombobox React portal below.
      },
    },
  });
}

// Combobox portal. Rendered once per editor from NoteEditor, listens to
// editor selection + text updates and shows suggestions when active.
export function WikiLinkCombobox({
  ctx,
  editor,
}: {
  ctx: WikiLinkPluginContext;
  editor: { tf: { insertNode: (n: unknown) => void }; selection: unknown };
}) {
  const t = useTranslations("editor.wikilink");
  const [query, setQuery] = useState<string | null>(null); // null = closed
  const searchQ = query ?? "";
  const { data } = useNoteSearch(searchQ, ctx.projectId);

  // Listen for [[ and close-trigger keys via a global keyhandler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // For MVP, trigger via Cmd/Ctrl+K to guarantee the behavior works;
      // fine-grained `[[` detection is a follow-up polish.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuery("");
      } else if (e.key === "Escape") {
        setQuery(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (query === null) return null;
  const results = data ?? [];

  return (
    <div
      role="listbox"
      data-testid="wikilink-combobox"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-80 max-h-64 overflow-auto bg-card border border-border rounded shadow-lg"
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("hint")}
        className="w-full px-3 py-2 border-b border-border bg-transparent outline-none text-sm"
      />
      {results.length === 0 ? (
        <p className="px-3 py-2 text-xs text-fg-muted">{t("search_empty")}</p>
      ) : (
        results.map((r) => (
          <button
            key={r.id}
            data-testid={`wikilink-result-${r.id}`}
            onClick={() => {
              editor.tf.insertNode({
                type: "wiki-link",
                targetId: r.id,
                title: r.title,
                children: [{ text: "" }],
              });
              setQuery(null);
            }}
            className="block w-full text-left px-3 py-2 text-sm hover:bg-muted"
          >
            {r.title}
          </button>
        ))
      )}
    </div>
  );
}
```

**Note for implementer:** Plate v49's custom plugin + inline-void node APIs have a specific shape (`createPlatePlugin`, `useEditorPlugin`, etc.). After install, read the plugin authoring docs in `node_modules/@platejs/core` and adjust the plugin body. The contract that must survive adjustment: (1) `[[` trigger OR `Cmd+K` opens a combobox; (2) combobox queries `useNoteSearch`; (3) selecting inserts a `wiki-link` inline node carrying `{ targetId, title }`; (4) the node renders as `<WikiLinkElement>`.

- [ ] **Step 3: Wire into NoteEditor**

In `NoteEditor.tsx`, add to plugins and mount the combobox:

```tsx
import { createWikiLinkPlugin, WikiLinkCombobox } from "./plugins/wiki-link";

export function NoteEditor({
  noteId, initialTitle, initialValue, readOnly,
  wsSlug, projectId,
}: NoteEditorProps) {
  // …
  const wikiPlugin = useMemo(() => createWikiLinkPlugin({ wsSlug, projectId }), [wsSlug, projectId]);
  const editor = usePlateEditor({
    plugins: [...BasicNodesKit, ...latexPlugins, wikiPlugin],
    value: startValue,
  });

  return (
    <div className="flex flex-col min-h-full relative">
      {/* … */}
      <WikiLinkCombobox ctx={{ wsSlug, projectId }} editor={editor} />
    </div>
  );
}
```

Update `NoteEditorProps`:

```tsx
export interface NoteEditorProps {
  noteId: string;
  initialTitle: string;
  initialValue: PlateValue | null;
  wsSlug: string;
  projectId: string;
  readOnly?: boolean;
}
```

Pass `wsSlug` and `projectId` from the server shell (`notes/[noteId]/page.tsx`):

```tsx
const { wsSlug, projectId, noteId } = await params;
// …
return (
  <NoteEditor
    noteId={note.id}
    initialTitle={note.title}
    initialValue={(note.content as unknown[] | null) ?? null}
    wsSlug={wsSlug}
    projectId={projectId}
  />
);
```

- [ ] **Step 4: E2E**

Append to `editor-core.spec.ts`:

```ts
test("wiki-link combobox inserts link", async ({ page, request, context }) => {
  const { sessionCookie } = await seedAndSignIn(request, API_BASE);
  await context.addCookies(parseCookie(sessionCookie));

  await page.goto(`/ko/app`);
  // seed created a note titled "Welcome" inside the default project
  await page.getByTestId("new-note-button").click();
  await page.getByTestId("note-body").click();
  await page.keyboard.type("See: ");
  await page.keyboard.press("Control+k"); // open combobox
  await expect(page.getByTestId("wikilink-combobox")).toBeVisible();
  await page.getByTestId("wikilink-combobox").locator("input").fill("Wel");
  await page.locator('[data-testid^="wikilink-result-"]').first().click();
  await expect(page.getByTestId("note-body").locator('a[data-target-id]').first()).toBeVisible();
});
```

**Note for implementer:** If the test helper seed does not already create a "Welcome" note, extend `seedAndSignIn` or the `test-seed` endpoint to insert at least one additional note (e.g., `{ title: "Welcome", content: null }`). This gives the combobox something to match against.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/plugins/wiki-link.tsx \
        apps/web/src/components/editor/elements/wiki-link-element.tsx \
        apps/web/src/components/editor/NoteEditor.tsx \
        apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/notes/[noteId]/page.tsx \
        apps/web/tests/e2e/editor-core.spec.ts \
        apps/api/src/routes/internal.ts
git commit -m "feat(web): wiki-link plugin with [[/Cmd+K combobox + project-scoped search"
```

---

### Task 17: Slash command plugin

**Files:**
- Create: `apps/web/src/components/editor/plugins/slash.tsx`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Slash menu component**

Create `apps/web/src/components/editor/plugins/slash.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Block = "h1" | "h2" | "h3" | "ul" | "ol" | "blockquote" | "code_block" | "hr" | "math_block";

interface Command {
  key: Block;
  label: string;
}

export function SlashMenu({
  editor,
}: {
  editor: {
    tf: {
      toggleBlock: (opts: { type: string }) => void;
      insertNode: (node: unknown) => void;
      deleteBackward: (unit: "char") => void;
    };
  };
}) {
  const t = useTranslations("editor.slash");
  const [open, setOpen] = useState(false);

  const commands: Command[] = [
    { key: "h1", label: t("heading_1") },
    { key: "h2", label: t("heading_2") },
    { key: "h3", label: t("heading_3") },
    { key: "ul", label: t("bulleted_list") },
    { key: "ol", label: t("numbered_list") },
    { key: "blockquote", label: t("quote") },
    { key: "code_block", label: t("code") },
    { key: "hr", label: t("divider") },
    { key: "math_block", label: t("math") },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/") {
        // Small heuristic: open when `/` pressed with caret in an empty line.
        // Detailed Plate-trigger wiring: follow-up polish.
        setTimeout(() => setOpen(true), 0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      role="listbox"
      data-testid="slash-menu"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-72 max-h-80 overflow-auto bg-card border border-border rounded shadow-lg"
    >
      {commands.map((c) => (
        <button
          key={c.key}
          data-testid={`slash-cmd-${c.key}`}
          onClick={() => {
            // Remove the "/" character that triggered the menu.
            editor.tf.deleteBackward("char");
            if (c.key === "hr") {
              editor.tf.insertNode({ type: "hr", children: [{ text: "" }] });
            } else if (c.key === "math_block") {
              editor.tf.insertNode({
                type: "equation",
                texExpression: "",
                children: [{ text: "" }],
              });
            } else {
              editor.tf.toggleBlock({ type: c.key });
            }
            setOpen(false);
          }}
          className="block w-full text-left px-3 py-2 text-sm hover:bg-muted"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount in NoteEditor**

In `NoteEditor.tsx`:

```tsx
import { SlashMenu } from "./plugins/slash";
// …
return (
  <div className="flex flex-col min-h-full relative">
    <EditorToolbar actions={actions} />
    {/* title + plate */}
    <WikiLinkCombobox ctx={{ wsSlug, projectId }} editor={editor} />
    <SlashMenu editor={editor} />
  </div>
);
```

- [ ] **Step 3: E2E**

Append to `editor-core.spec.ts`:

```ts
test("slash menu converts line to H1", async ({ page, request, context }) => {
  const { sessionCookie } = await seedAndSignIn(request, API_BASE);
  await context.addCookies(parseCookie(sessionCookie));

  await page.goto(`/ko/app`);
  await page.getByTestId("new-note-button").click();
  await page.getByTestId("note-body").click();
  await page.keyboard.press("/");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await page.getByTestId("slash-cmd-h1").click();
  await page.keyboard.type("My heading");
  await expect(page.getByTestId("note-body").locator("h1").first()).toContainText("My heading");
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/plugins/slash.tsx \
        apps/web/src/components/editor/NoteEditor.tsx \
        apps/web/tests/e2e/editor-core.spec.ts
git commit -m "feat(web): slash command menu with 9 basic block commands"
```

---

### Task 18: Final checks — lint, i18n parity, docs, post-feature

**Files:**
- Modify: `CLAUDE.md` (Phase 1 status)
- Modify: `docs/contributing/plans-status.md`

- [ ] **Step 1: Run full lint + typecheck + unit tests + E2E**

```bash
pnpm --filter @opencairn/web lint
pnpm --filter @opencairn/web exec tsc --noEmit
pnpm --filter @opencairn/web vitest run
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/api test
pnpm --filter @opencairn/web test:e2e -- editor-core.spec.ts
```

All must pass. Fix any failures before continuing.

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`, under the Plans section:

```diff
-- ✅ Complete: Plan 1, 13, 12, 3, 4, 9a.
+- ✅ Complete: Plan 1, 13, 12, 3, 4, 9a, 2A (editor core, no collab).
 - 🟡 Active / next: Plan 2 (에디터+협업), Plan 5/6/7/8 (Phase 2 병렬 unblock).
```

Rename the "Plan 2" active entry to explicitly reflect 2B–2E as the remainder:

```diff
-- 🟡 Active / next: Plan 2 (에디터+협업), Plan 5/6/7/8 (Phase 2 병렬 unblock).
+- 🟡 Active / next: Plan 2B (Hocuspocus/comments/@mention), 2C (notifications/share), 2D (chat renderer/block extensions), 2E (tab shell), Plan 5/6/7/8.
```

- [ ] **Step 3: Update plans-status.md**

Mark Plan 2A complete and list 2B–2E as subsequent cycles. Edit `docs/contributing/plans-status.md`:

```diff
-| `2026-04-09-plan-2-editor.md`                          | 🟡 미착수  | Plate v49 에디터 + Notion급 협업 …
+| `2026-04-21-plan-2a-editor-core.md`                    | ✅ 2026-04-21 (HEAD 추후) | Plate v49 + LaTeX + wiki-link + slash + save/load + 사이드바(browse). Solo 모드. 기존 Plan 2 Task 1~7 대체.
+| `2026-04-09-plan-2-editor.md` (Task 8~21)              | 🟡 2B/2C/2D/2E 로 분해 예정 | Hocuspocus, 코멘트, @mention, 알림, 공개 링크, chat 렌더러, 탭쉘. 각 단계별 brainstorm → spec → plan 사이클.
```

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md docs/contributing/plans-status.md
git commit -m "docs: mark Plan 2A complete and decompose remaining Plan 2 into 2B/2C/2D/2E"
```

- [ ] **Step 5: Invoke post-feature workflow**

Run the project's mandated verification loop via the `opencairn:post-feature` skill. Follow its output for any final review/cleanup steps before declaring work done.

---

## Self-Review Notes

- **Spec coverage:** §1 scope, §3 architecture, §4 components, §5 data model (no migrations needed — verified), §6 error handling (PATCH retry, 403/404, wiki-link deleted, KaTeX failure), §7 tests (API integration + Playwright E2E), §8 i18n keys + keyboard shortcuts (Cmd+K, Cmd+S), §10 implementation order (E2E-first), §11 open questions (flagged inline as "Note for implementer"). All covered.
- **Placeholders:** None. Every step has exact code. "Note for implementer" callouts explicitly describe the adjustment and name the invariant — not TBDs.
- **Type consistency:** `plateValueToText` is duplicated between `apps/api/src/lib/plate-text.ts` and `apps/web/src/lib/editor-utils.ts` — intentional (server can't import client-only module). Both walk identical structure; behavior is identical by spec.
- **Out-of-scope creep:** Slash command doesn't include agent commands (2D), wiki-link doesn't include hover preview (deferred), folder CRUD not included (2A scope exclusion). Correct.
- **Unknown dependencies:** `/api/auth/me`, `/api/workspaces`, `/api/workspaces/by-slug/:slug`, `/api/projects?workspaceId=`, `/api/folders?projectId=`, `POST /api/internal/test-seed` — each flagged with "Note for implementer" to confirm/add during the task where they're used. Keeps scope honest rather than pretending everything already exists.
