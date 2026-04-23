# App Shell Phase 1 — Shell Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the empty 3-panel application shell (sidebar/tabs/agent-panel) with working responsive behavior, URL↔tab synchronization, Zustand stores, and Next.js route scaffolds for all workspace-scoped pages. Produces a visible shell that renders placeholder regions and passes e2e route tests, ready for Phase 2~5 to fill in content.

**Architecture:**
- Next.js 16 App Router with `[locale]/app/w/[wsSlug]/*` routes wrapped by a new `AppShell` component.
- Five Zustand stores with per-domain boundaries: `panel` (user-global), `tabs` / `threads` / `sidebar` / `palette` (all per-workspace where applicable).
- `useUrlTabSync` hook makes URL the authoritative source for active tab; tab clicks use `router.replace`, new tabs use `router.push`.
- Responsive layout degrades to shadcn `Sheet` overlays below 1024px.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zustand 4 + persist middleware, `shadcn/ui` (Sheet, Button), Tailwind, Drizzle ORM, Vitest (node + jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` (Phase 1 scope = §13 Phase 1 + prerequisites from §2, §3, §9, §10).

**Scope boundary (what this plan does NOT include):**
- Sidebar internals (workspace switcher, tree, nav icons) — Phase 2
- Tab bar rendering beyond placeholder — Phase 3
- Agent panel content, DB schema, API endpoints — Phase 4
- Dashboard / project / research / palette content — Phase 5
- All viewer components (plate/reading/diff/...) — Phase 3

Phase 1 deliverable: a user can log in, land on `/<locale>/app/w/<last-workspace>/`, see a 3-panel shell with empty placeholders, toggle sidebar with `Ctrl+\`, toggle agent panel with `Ctrl+J`, resize window and have panels collapse to `Sheet` overlays, and navigate the URL to different routes without crashes.

---

## File Structure

**New files:**

```
apps/web/src/
├── app/[locale]/app/
│   └── w/[wsSlug]/
│       ├── layout.tsx                         # AppShell wrapper (session + providers + shell)
│       ├── loading.tsx                        # skeleton
│       ├── page.tsx                           # dashboard placeholder (replaces /dashboard page later)
│       ├── n/[noteId]/page.tsx                # note placeholder
│       ├── p/[projectId]/page.tsx             # project view placeholder
│       ├── research/page.tsx                  # research hub placeholder
│       ├── research/[runId]/page.tsx          # research run placeholder
│       └── settings/[[...slug]]/page.tsx      # ws admin placeholder
├── components/shell/
│   ├── app-shell.tsx                          # 3-panel layout + responsive Sheet wiring
│   ├── shell-providers.tsx                    # stores + keyboard shortcuts provider
│   ├── placeholder-sidebar.tsx                # Phase 2 replaces
│   ├── placeholder-tab-shell.tsx              # Phase 3 replaces
│   ├── placeholder-agent-panel.tsx            # Phase 4 replaces
│   └── shell-resize-handle.tsx                # drag resize + double-click reset
├── stores/
│   ├── panel-store.ts                         # user-global (width, open) + persist
│   ├── tabs-store.ts                          # per-workspace (tabs, activeId) + persist
│   ├── threads-store.ts                       # per-workspace (activeThreadId) + persist
│   ├── sidebar-store.ts                       # per-workspace (expanded set) + persist
│   └── palette-store.ts                       # session only (open, query)
├── hooks/
│   ├── use-breakpoint.ts                      # xs|sm|md|lg + test
│   ├── use-keyboard-shortcut.ts               # cross-OS mod+X + test
│   └── use-url-tab-sync.ts                    # URL ↔ tabs-store
└── lib/
    └── tab-url.ts                             # Tab ↔ URL conversions + test
```

**Modified files:**

```
packages/db/src/schema/users.ts                # + last_viewed_workspace_id column
apps/api/src/routes/users.ts                   # + PATCH /me/last-viewed-workspace (new file if absent)
apps/web/src/app/[locale]/app/layout.tsx       # delegate shell to w/[wsSlug]/layout.tsx
apps/web/src/app/[locale]/page.tsx             # root redirect to last workspace
apps/web/vitest.config.ts                      # add jsdom environment for component/hook tests
apps/web/package.json                          # + zustand, + @testing-library/react, + jsdom
```

**Tests:**

```
apps/web/src/stores/panel-store.test.ts
apps/web/src/stores/tabs-store.test.ts
apps/web/src/stores/threads-store.test.ts
apps/web/src/stores/sidebar-store.test.ts
apps/web/src/stores/palette-store.test.ts
apps/web/src/hooks/use-breakpoint.test.tsx
apps/web/src/hooks/use-keyboard-shortcut.test.tsx
apps/web/src/hooks/use-url-tab-sync.test.tsx
apps/web/src/lib/tab-url.test.ts
apps/web/tests/e2e/app-shell-phase1.spec.ts
apps/api/tests/users-last-viewed-workspace.test.ts
packages/db/drizzle/0014_users_last_viewed_workspace.sql
```

---

## Task 1: Add `users.last_viewed_workspace_id` column

Enables root `/` to redirect to the user's most recent workspace across devices (spec §9 step 1, §11.3). This is the only DB change in Phase 1; `chat_threads` etc. are Phase 4.

**Files:**
- Modify: `packages/db/src/schema/users.ts`
- Create: `packages/db/drizzle/0014_users_last_viewed_workspace.sql`
- Create: `apps/api/src/routes/users.ts` (if missing) or modify existing
- Create: `apps/api/tests/users-last-viewed-workspace.test.ts`

- [ ] **Step 1.1: Add column to Drizzle schema**

Open `packages/db/src/schema/users.ts`. Add the FK column in the existing `users` table definition:

```ts
// Inside pgTable("users", {...})
lastViewedWorkspaceId: uuid("last_viewed_workspace_id").references(
  () => workspaces.id,
  { onDelete: "set null" }
),
```

Import `workspaces` from `./workspaces` if not already imported. Import `uuid` from `drizzle-orm/pg-core` if needed.

- [ ] **Step 1.2: Generate migration**

Run from repo root:
```bash
pnpm --filter @opencairn/db db:generate
```

Expected: a new file `packages/db/drizzle/0014_*.sql` is produced. Rename it to `0014_users_last_viewed_workspace.sql` for clarity. Contents should be equivalent to:

```sql
ALTER TABLE "users" ADD COLUMN "last_viewed_workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE SET NULL;
```

- [ ] **Step 1.3: Run migration against local DB**

```bash
pnpm --filter @opencairn/db db:migrate
```

Expected output: migration applied with no error. Verify via `psql` or Drizzle Studio:
```sql
\d users
-- column last_viewed_workspace_id uuid should be present
```

- [ ] **Step 1.4: Write failing test for PATCH endpoint**

Create `apps/api/tests/users-last-viewed-workspace.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestClient, seedUser, seedWorkspace } from "./helpers";

describe("PATCH /api/users/me/last-viewed-workspace", () => {
  it("persists the workspace id on the user record", async () => {
    const user = await seedUser();
    const ws = await seedWorkspace({ ownerId: user.id });
    const client = createTestClient({ userId: user.id });

    const res = await client.patch("/api/users/me/last-viewed-workspace", {
      body: { workspace_id: ws.id },
    });

    expect(res.status).toBe(200);
    const reloaded = await client.get("/api/users/me");
    expect(reloaded.body.last_viewed_workspace_id).toBe(ws.id);
  });

  it("rejects workspace the user is not a member of", async () => {
    const user = await seedUser();
    const otherOwner = await seedUser();
    const foreignWs = await seedWorkspace({ ownerId: otherOwner.id });
    const client = createTestClient({ userId: user.id });

    const res = await client.patch("/api/users/me/last-viewed-workspace", {
      body: { workspace_id: foreignWs.id },
    });

    expect(res.status).toBe(403);
  });

  it("returns 400 on invalid uuid", async () => {
    const user = await seedUser();
    const client = createTestClient({ userId: user.id });

    const res = await client.patch("/api/users/me/last-viewed-workspace", {
      body: { workspace_id: "not-a-uuid" },
    });

    expect(res.status).toBe(400);
  });
});
```

Adjust the imports (`createTestClient`, `seedUser`, `seedWorkspace`) to match the existing test helpers in `apps/api/tests/helpers.ts`. If the helpers don't expose these exact names, use what's there and keep the assertions intact.

- [ ] **Step 1.5: Run the test to confirm it fails**

```bash
pnpm --filter @opencairn/api test users-last-viewed-workspace
```

Expected: all three cases fail (route does not exist yet).

- [ ] **Step 1.6: Implement the endpoint**

Open or create `apps/api/src/routes/users.ts`. Add:

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users, workspaceMembers } from "@opencairn/db";
import { requireSession } from "../lib/auth";

const body = z.object({ workspace_id: z.string().uuid() });

export const usersRoute = new Hono()
  .patch("/me/last-viewed-workspace", zValidator("json", body), async (c) => {
    const session = await requireSession(c);
    const { workspace_id } = c.req.valid("json");

    const membership = await db.query.workspaceMembers.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, session.userId), eq(m.workspaceId, workspace_id)),
    });
    if (!membership) return c.json({ error: "forbidden" }, 403);

    await db
      .update(users)
      .set({ lastViewedWorkspaceId: workspace_id })
      .where(eq(users.id, session.userId));

    return c.json({ ok: true });
  });
```

Mount the route in `apps/api/src/routes/index.ts` (or wherever routes are composed) as `.route("/users", usersRoute)`.

- [ ] **Step 1.7: Extend `GET /me` to return the column**

Find the handler for `GET /api/users/me`. Ensure the returned payload includes `last_viewed_workspace_id` (serialize the Drizzle `lastViewedWorkspaceId` into `last_viewed_workspace_id` using whatever serialization convention the file already uses; do not introduce a new one).

- [ ] **Step 1.8: Re-run the test**

```bash
pnpm --filter @opencairn/api test users-last-viewed-workspace
```

Expected: all three pass.

- [ ] **Step 1.9: Commit**

```bash
git add packages/db/src/schema/users.ts \
        packages/db/drizzle/0014_users_last_viewed_workspace.sql \
        apps/api/src/routes/users.ts \
        apps/api/src/routes/index.ts \
        apps/api/tests/users-last-viewed-workspace.test.ts
git commit -m "feat(api,db): track last viewed workspace per user"
```

---

## Task 2: Configure Vitest for React component / hook tests

Phase 1 introduces hooks (`useBreakpoint`, `useKeyboardShortcut`, `useUrlTabSync`) and the store tests use in-memory `localStorage`. Current `vitest.config.ts` is node-only and only matches `*.test.ts`. Add a jsdom-based config variant for component tests, keeping node tests fast.

**Files:**
- Modify: `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 2.1: Install dependencies**

From repo root:
```bash
pnpm --filter @opencairn/web add -D jsdom @testing-library/react @testing-library/jest-dom happy-dom zustand
```

Expected: `apps/web/package.json` shows new devDependencies (`jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `happy-dom` — we'll pick one; using `happy-dom` if it's already a peer, otherwise `jsdom`) plus `zustand` as a runtime dep.

- [ ] **Step 2.2: Update vitest config**

Replace `apps/web/vitest.config.ts` with a project-aware config:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test-setup.ts"],
        },
      },
    ],
  },
});
```

- [ ] **Step 2.3: Create test setup file**

Create `apps/web/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
```

- [ ] **Step 2.4: Smoke test**

Create a throwaway `apps/web/src/__smoke__.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("jsdom smoke", () => {
  it("renders a button", () => {
    render(<button>hi</button>);
    expect(screen.getByRole("button")).toHaveTextContent("hi");
  });
});
```

Run:
```bash
pnpm --filter @opencairn/web test
```

Expected: node and jsdom projects both run, smoke test passes.

Delete the smoke file after verification.

- [ ] **Step 2.5: Commit**

```bash
git add apps/web/vitest.config.ts \
        apps/web/src/test-setup.ts \
        apps/web/package.json \
        pnpm-lock.yaml
git commit -m "chore(web): enable jsdom project for component tests"
```

---

## Task 3: `useBreakpoint` hook

Core primitive. Returns `'xs' | 'sm' | 'md' | 'lg'` from the current viewport width (spec §10).

**Files:**
- Create: `apps/web/src/hooks/use-breakpoint.ts`
- Create: `apps/web/src/hooks/use-breakpoint.test.tsx`

- [ ] **Step 3.1: Write the failing test**

Create `apps/web/src/hooks/use-breakpoint.test.tsx`:

```tsx
import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBreakpoint } from "./use-breakpoint";

function setWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  window.dispatchEvent(new Event("resize"));
}

describe("useBreakpoint", () => {
  afterEach(() => vi.useRealTimers());

  it("returns lg for width >= 1024", () => {
    setWidth(1280);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("lg");
  });

  it("returns md for 768~1023", () => {
    setWidth(900);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("md");
  });

  it("returns sm for 640~767", () => {
    setWidth(700);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("sm");
  });

  it("returns xs for <640", () => {
    setWidth(400);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("xs");
  });

  it("updates on window resize", () => {
    setWidth(1280);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("lg");
    act(() => setWidth(500));
    expect(result.current).toBe("xs");
  });
});
```

- [ ] **Step 3.2: Run and confirm failure**

```bash
pnpm --filter @opencairn/web test use-breakpoint
```

Expected: FAIL with "Cannot find module ./use-breakpoint".

- [ ] **Step 3.3: Implement**

Create `apps/web/src/hooks/use-breakpoint.ts`:

```ts
"use client";
import { useEffect, useState } from "react";

export type Breakpoint = "xs" | "sm" | "md" | "lg";

function compute(width: number): Breakpoint {
  if (width >= 1024) return "lg";
  if (width >= 768) return "md";
  if (width >= 640) return "sm";
  return "xs";
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() =>
    typeof window === "undefined" ? "lg" : compute(window.innerWidth),
  );

  useEffect(() => {
    const handler = () => setBp(compute(window.innerWidth));
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return bp;
}
```

- [ ] **Step 3.4: Re-run test**

```bash
pnpm --filter @opencairn/web test use-breakpoint
```

Expected: all five cases pass.

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/src/hooks/use-breakpoint.ts \
        apps/web/src/hooks/use-breakpoint.test.tsx
git commit -m "feat(web): add useBreakpoint hook"
```

---

## Task 4: `useKeyboardShortcut` hook (cross-OS)

`Cmd` on macOS, `Ctrl` elsewhere. Handles chord strings like `"mod+\\"` or `"mod+shift+j"` (spec §2.3, §5.6).

**Files:**
- Create: `apps/web/src/hooks/use-keyboard-shortcut.ts`
- Create: `apps/web/src/hooks/use-keyboard-shortcut.test.tsx`

- [ ] **Step 4.1: Write the failing test**

Create `apps/web/src/hooks/use-keyboard-shortcut.test.tsx`:

```tsx
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useKeyboardShortcut } from "./use-keyboard-shortcut";

function dispatchKey(opts: { key: string; meta?: boolean; ctrl?: boolean; shift?: boolean }) {
  const ev = new KeyboardEvent("keydown", {
    key: opts.key,
    metaKey: !!opts.meta,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shift,
    bubbles: true,
  });
  window.dispatchEvent(ev);
}

describe("useKeyboardShortcut", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
  });

  it("invokes handler on mod+\\ (mac: meta key)", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+\\", handler));
    dispatchKey({ key: "\\", meta: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("uses Ctrl on non-mac", () => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "Win32",
    });
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+j", handler));
    dispatchKey({ key: "j", ctrl: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("respects shift modifier", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+shift+\\", handler));
    dispatchKey({ key: "\\", meta: true });
    expect(handler).not.toHaveBeenCalled();
    dispatchKey({ key: "\\", meta: true, shift: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not fire without modifier", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+j", handler));
    dispatchKey({ key: "j" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcut("mod+j", handler));
    unmount();
    dispatchKey({ key: "j", meta: true });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4.2: Run to confirm failure**

```bash
pnpm --filter @opencairn/web test use-keyboard-shortcut
```

Expected: FAIL.

- [ ] **Step 4.3: Implement**

Create `apps/web/src/hooks/use-keyboard-shortcut.ts`:

```ts
"use client";
import { useEffect } from "react";

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform);
}

interface Chord {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

function parse(chord: string): Chord {
  const parts = chord.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  return {
    key,
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  };
}

export function useKeyboardShortcut(chord: string, handler: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const parsed = parse(chord);
    const onKey = (e: KeyboardEvent) => {
      const modOk = parsed.mod ? (isMac() ? e.metaKey : e.ctrlKey) : !e.metaKey && !e.ctrlKey;
      const shiftOk = parsed.shift ? e.shiftKey : !e.shiftKey;
      const altOk = parsed.alt ? e.altKey : !e.altKey;
      if (modOk && shiftOk && altOk && e.key.toLowerCase() === parsed.key) {
        handler(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chord, handler]);
}
```

- [ ] **Step 4.4: Re-run**

```bash
pnpm --filter @opencairn/web test use-keyboard-shortcut
```

Expected: all five cases pass.

- [ ] **Step 4.5: Commit**

```bash
git add apps/web/src/hooks/use-keyboard-shortcut.ts \
        apps/web/src/hooks/use-keyboard-shortcut.test.tsx
git commit -m "feat(web): add cross-os useKeyboardShortcut hook"
```

---

## Task 5: `panel-store` (user-global width + open/closed)

Holds sidebar + agent-panel width and open state. Persists to `localStorage` with a fixed key (spec §6.6 table).

**Files:**
- Create: `apps/web/src/stores/panel-store.ts`
- Create: `apps/web/src/stores/panel-store.test.ts`

- [ ] **Step 5.1: Write failing test**

Create `apps/web/src/stores/panel-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { usePanelStore } from "./panel-store";

function reset() {
  localStorage.clear();
  usePanelStore.setState(usePanelStore.getInitialState(), true);
}

describe("panel-store", () => {
  beforeEach(reset);

  it("has default widths and open states", () => {
    const s = usePanelStore.getState();
    expect(s.sidebarWidth).toBe(240);
    expect(s.sidebarOpen).toBe(true);
    expect(s.agentPanelWidth).toBe(360);
    expect(s.agentPanelOpen).toBe(true);
  });

  it("toggleSidebar flips sidebarOpen", () => {
    usePanelStore.getState().toggleSidebar();
    expect(usePanelStore.getState().sidebarOpen).toBe(false);
    usePanelStore.getState().toggleSidebar();
    expect(usePanelStore.getState().sidebarOpen).toBe(true);
  });

  it("setSidebarWidth clamps to [180,400]", () => {
    usePanelStore.getState().setSidebarWidth(50);
    expect(usePanelStore.getState().sidebarWidth).toBe(180);
    usePanelStore.getState().setSidebarWidth(500);
    expect(usePanelStore.getState().sidebarWidth).toBe(400);
    usePanelStore.getState().setSidebarWidth(300);
    expect(usePanelStore.getState().sidebarWidth).toBe(300);
  });

  it("setAgentPanelWidth clamps to [300,560]", () => {
    usePanelStore.getState().setAgentPanelWidth(200);
    expect(usePanelStore.getState().agentPanelWidth).toBe(300);
    usePanelStore.getState().setAgentPanelWidth(999);
    expect(usePanelStore.getState().agentPanelWidth).toBe(560);
  });

  it("persists sidebarWidth across store recreation via localStorage", () => {
    usePanelStore.getState().setSidebarWidth(320);
    expect(localStorage.getItem("oc:panel")).toContain("320");
  });

  it("resetSidebarWidth restores 240", () => {
    usePanelStore.getState().setSidebarWidth(380);
    usePanelStore.getState().resetSidebarWidth();
    expect(usePanelStore.getState().sidebarWidth).toBe(240);
  });
});
```

- [ ] **Step 5.2: Run to confirm failure**

```bash
pnpm --filter @opencairn/web test panel-store
```

Expected: FAIL.

- [ ] **Step 5.3: Implement**

Create `apps/web/src/stores/panel-store.ts`:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;
const AGENT_MIN = 300;
const AGENT_MAX = 560;
const AGENT_DEFAULT = 360;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface PanelState {
  sidebarWidth: number;
  sidebarOpen: boolean;
  agentPanelWidth: number;
  agentPanelOpen: boolean;
  toggleSidebar(): void;
  toggleAgentPanel(): void;
  setSidebarWidth(w: number): void;
  setAgentPanelWidth(w: number): void;
  resetSidebarWidth(): void;
  resetAgentPanelWidth(): void;
}

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      sidebarWidth: SIDEBAR_DEFAULT,
      sidebarOpen: true,
      agentPanelWidth: AGENT_DEFAULT,
      agentPanelOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleAgentPanel: () => set((s) => ({ agentPanelOpen: !s.agentPanelOpen })),
      setSidebarWidth: (w) => set({ sidebarWidth: clamp(w, SIDEBAR_MIN, SIDEBAR_MAX) }),
      setAgentPanelWidth: (w) => set({ agentPanelWidth: clamp(w, AGENT_MIN, AGENT_MAX) }),
      resetSidebarWidth: () => set({ sidebarWidth: SIDEBAR_DEFAULT }),
      resetAgentPanelWidth: () => set({ agentPanelWidth: AGENT_DEFAULT }),
    }),
    { name: "oc:panel" },
  ),
);
```

- [ ] **Step 5.4: Re-run test**

```bash
pnpm --filter @opencairn/web test panel-store
```

Expected: all six pass.

- [ ] **Step 5.5: Commit**

```bash
git add apps/web/src/stores/panel-store.ts apps/web/src/stores/panel-store.test.ts
git commit -m "feat(web): add user-global panel store"
```

---

## Task 6: `tabs-store` skeleton (per-workspace, localStorage)

Holds the tab stack + active id. Supports `setWorkspace(id)` which flushes prior state and loads the new workspace's stack from `oc:tabs:<wsId>` (spec §5.2).

**Files:**
- Create: `apps/web/src/stores/tabs-store.ts`
- Create: `apps/web/src/stores/tabs-store.test.ts`

- [ ] **Step 6.1: Write failing test**

Create `apps/web/src/stores/tabs-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useTabsStore, type Tab } from "./tabs-store";

const mkTab = (overrides: Partial<Tab> = {}): Tab => ({
  id: "t1",
  kind: "note",
  targetId: "n1",
  mode: "plate",
  title: "Note 1",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
  ...overrides,
});

describe("tabs-store", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
  });

  it("has null workspaceId initially", () => {
    expect(useTabsStore.getState().workspaceId).toBeNull();
    expect(useTabsStore.getState().tabs).toEqual([]);
  });

  it("setWorkspace loads persisted tabs for that workspace", () => {
    localStorage.setItem(
      "oc:tabs:ws-a",
      JSON.stringify({ tabs: [mkTab({ id: "a1" })], activeId: "a1" }),
    );
    useTabsStore.getState().setWorkspace("ws-a");
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe("a1");
  });

  it("setWorkspace defaults to empty when no persisted state", () => {
    useTabsStore.getState().setWorkspace("ws-new");
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(useTabsStore.getState().activeId).toBeNull();
  });

  it("setWorkspace flushes prior workspace state to its own key", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab({ id: "x1" }));
    useTabsStore.getState().setWorkspace("ws-b");
    const raw = localStorage.getItem("oc:tabs:ws-a");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.tabs[0].id).toBe("x1");
  });

  it("addTab sets activeId when first tab", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab());
    expect(useTabsStore.getState().activeId).toBe("t1");
  });

  it("closeTab selects right neighbor", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab({ id: "t1" }));
    useTabsStore.getState().addTab(mkTab({ id: "t2" }));
    useTabsStore.getState().addTab(mkTab({ id: "t3" }));
    useTabsStore.getState().setActive("t2");
    useTabsStore.getState().closeTab("t2");
    expect(useTabsStore.getState().activeId).toBe("t3");
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("closeTab refuses pinned tabs", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab({ id: "t1", pinned: true }));
    useTabsStore.getState().closeTab("t1");
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("findTabByTarget returns tab matching kind+targetId", () => {
    useTabsStore.getState().setWorkspace("ws-a");
    useTabsStore.getState().addTab(mkTab({ id: "t1", kind: "note", targetId: "n1" }));
    const found = useTabsStore.getState().findTabByTarget("note", "n1");
    expect(found?.id).toBe("t1");
    expect(useTabsStore.getState().findTabByTarget("project", "n1")).toBeUndefined();
  });
});
```

- [ ] **Step 6.2: Run to confirm failure**

```bash
pnpm --filter @opencairn/web test tabs-store
```

Expected: FAIL.

- [ ] **Step 6.3: Implement**

Create `apps/web/src/stores/tabs-store.ts`:

```ts
import { create } from "zustand";

export type TabKind =
  | "dashboard"
  | "project"
  | "note"
  | "research_hub"
  | "research_run"
  | "import"
  | "ws_settings";

export type TabMode =
  | "plate"
  | "reading"
  | "diff"
  | "artifact"
  | "presentation"
  | "data"
  | "spreadsheet"
  | "whiteboard"
  | "source"
  | "canvas"
  | "mindmap"
  | "flashcard";

export interface Tab {
  id: string;
  kind: TabKind;
  targetId: string | null;
  mode: TabMode;
  title: string;
  pinned: boolean;
  preview: boolean;
  dirty: boolean;
  splitWith: string | null;
  splitSide: "left" | "right" | null;
  scrollY: number;
}

interface Persisted {
  tabs: Tab[];
  activeId: string | null;
}

interface State extends Persisted {
  workspaceId: string | null;
  setWorkspace(id: string): void;
  addTab(tab: Tab): void;
  closeTab(id: string): void;
  setActive(id: string): void;
  updateTab(id: string, patch: Partial<Tab>): void;
  findTabByTarget(kind: TabKind, targetId: string | null): Tab | undefined;
}

const key = (wsId: string) => `oc:tabs:${wsId}`;

function loadPersisted(wsId: string): Persisted {
  try {
    const raw = localStorage.getItem(key(wsId));
    if (!raw) return { tabs: [], activeId: null };
    return JSON.parse(raw) as Persisted;
  } catch {
    return { tabs: [], activeId: null };
  }
}

function flush(wsId: string, data: Persisted) {
  localStorage.setItem(key(wsId), JSON.stringify(data));
}

export const useTabsStore = create<State>((set, get) => ({
  workspaceId: null,
  tabs: [],
  activeId: null,

  setWorkspace: (id) => {
    const prev = get();
    if (prev.workspaceId && prev.workspaceId !== id) {
      flush(prev.workspaceId, { tabs: prev.tabs, activeId: prev.activeId });
    }
    const loaded = loadPersisted(id);
    set({ workspaceId: id, tabs: loaded.tabs, activeId: loaded.activeId });
  },

  addTab: (tab) => {
    const s = get();
    const tabs = [...s.tabs, tab];
    const activeId = s.activeId ?? tab.id;
    set({ tabs, activeId });
    if (s.workspaceId) flush(s.workspaceId, { tabs, activeId });
  },

  closeTab: (id) => {
    const s = get();
    const target = s.tabs.find((t) => t.id === id);
    if (!target || target.pinned) return;
    const idx = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t) => t.id !== id);
    let activeId = s.activeId;
    if (activeId === id) {
      const right = s.tabs[idx + 1];
      const left = s.tabs[idx - 1];
      activeId = right?.id ?? left?.id ?? null;
    }
    set({ tabs, activeId });
    if (s.workspaceId) flush(s.workspaceId, { tabs, activeId });
  },

  setActive: (id) => {
    const s = get();
    if (!s.tabs.some((t) => t.id === id)) return;
    set({ activeId: id });
    if (s.workspaceId) flush(s.workspaceId, { tabs: s.tabs, activeId: id });
  },

  updateTab: (id, patch) => {
    const s = get();
    const tabs = s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
    set({ tabs });
    if (s.workspaceId) flush(s.workspaceId, { tabs, activeId: s.activeId });
  },

  findTabByTarget: (kind, targetId) =>
    get().tabs.find((t) => t.kind === kind && t.targetId === targetId),
}));
```

- [ ] **Step 6.4: Re-run test**

```bash
pnpm --filter @opencairn/web test tabs-store
```

Expected: all eight pass.

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/src/stores/tabs-store.ts apps/web/src/stores/tabs-store.test.ts
git commit -m "feat(web): add per-workspace tabs store skeleton"
```

---

## Task 7: Remaining store skeletons (`threads`, `sidebar`, `palette`)

Three short stores. Each has minimal state Phase 1 needs; Phase 2~5 extend them.

**Files:**
- Create: `apps/web/src/stores/threads-store.ts` (+ test)
- Create: `apps/web/src/stores/sidebar-store.ts` (+ test)
- Create: `apps/web/src/stores/palette-store.ts` (+ test)

- [ ] **Step 7.1: threads-store test**

Create `apps/web/src/stores/threads-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useThreadsStore } from "./threads-store";

describe("threads-store", () => {
  beforeEach(() => {
    localStorage.clear();
    useThreadsStore.setState(useThreadsStore.getInitialState(), true);
  });

  it("activeThreadId null by default", () => {
    useThreadsStore.getState().setWorkspace("ws-a");
    expect(useThreadsStore.getState().activeThreadId).toBeNull();
  });

  it("setActiveThread persists under oc:active_thread:<wsId>", () => {
    useThreadsStore.getState().setWorkspace("ws-a");
    useThreadsStore.getState().setActiveThread("thread-42");
    expect(localStorage.getItem("oc:active_thread:ws-a")).toBe(JSON.stringify("thread-42"));
  });

  it("setWorkspace loads persisted value", () => {
    localStorage.setItem("oc:active_thread:ws-b", JSON.stringify("thread-99"));
    useThreadsStore.getState().setWorkspace("ws-b");
    expect(useThreadsStore.getState().activeThreadId).toBe("thread-99");
  });
});
```

- [ ] **Step 7.2: threads-store implementation**

Create `apps/web/src/stores/threads-store.ts`:

```ts
import { create } from "zustand";

const key = (wsId: string) => `oc:active_thread:${wsId}`;

interface State {
  workspaceId: string | null;
  activeThreadId: string | null;
  setWorkspace(id: string): void;
  setActiveThread(threadId: string | null): void;
}

export const useThreadsStore = create<State>((set, get) => ({
  workspaceId: null,
  activeThreadId: null,
  setWorkspace: (id) => {
    try {
      const raw = localStorage.getItem(key(id));
      const parsed = raw ? (JSON.parse(raw) as string | null) : null;
      set({ workspaceId: id, activeThreadId: parsed });
    } catch {
      set({ workspaceId: id, activeThreadId: null });
    }
  },
  setActiveThread: (threadId) => {
    const s = get();
    set({ activeThreadId: threadId });
    if (s.workspaceId) localStorage.setItem(key(s.workspaceId), JSON.stringify(threadId));
  },
}));
```

Run `pnpm --filter @opencairn/web test threads-store` — expect three passes.

- [ ] **Step 7.3: sidebar-store test**

Create `apps/web/src/stores/sidebar-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useSidebarStore } from "./sidebar-store";

describe("sidebar-store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebarStore.setState(useSidebarStore.getInitialState(), true);
  });

  it("toggleExpanded adds and removes ids", () => {
    useSidebarStore.getState().setWorkspace("ws-a");
    useSidebarStore.getState().toggleExpanded("folder-1");
    expect(useSidebarStore.getState().isExpanded("folder-1")).toBe(true);
    useSidebarStore.getState().toggleExpanded("folder-1");
    expect(useSidebarStore.getState().isExpanded("folder-1")).toBe(false);
  });

  it("persists expanded set across workspace reload", () => {
    useSidebarStore.getState().setWorkspace("ws-a");
    useSidebarStore.getState().toggleExpanded("folder-1");
    useSidebarStore.getState().setWorkspace("ws-b");
    useSidebarStore.getState().setWorkspace("ws-a");
    expect(useSidebarStore.getState().isExpanded("folder-1")).toBe(true);
  });
});
```

- [ ] **Step 7.4: sidebar-store implementation**

Create `apps/web/src/stores/sidebar-store.ts`:

```ts
import { create } from "zustand";

const key = (wsId: string) => `oc:sidebar:${wsId}`;

interface State {
  workspaceId: string | null;
  expanded: Set<string>;
  setWorkspace(id: string): void;
  toggleExpanded(nodeId: string): void;
  isExpanded(nodeId: string): boolean;
}

function load(wsId: string): Set<string> {
  try {
    const raw = localStorage.getItem(key(wsId));
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function flush(wsId: string, s: Set<string>) {
  localStorage.setItem(key(wsId), JSON.stringify([...s]));
}

export const useSidebarStore = create<State>((set, get) => ({
  workspaceId: null,
  expanded: new Set(),
  setWorkspace: (id) => {
    const prev = get();
    if (prev.workspaceId && prev.workspaceId !== id) flush(prev.workspaceId, prev.expanded);
    set({ workspaceId: id, expanded: load(id) });
  },
  toggleExpanded: (nodeId) => {
    const s = get();
    const next = new Set(s.expanded);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    set({ expanded: next });
    if (s.workspaceId) flush(s.workspaceId, next);
  },
  isExpanded: (nodeId) => get().expanded.has(nodeId),
}));
```

Run tests — expect two passes.

- [ ] **Step 7.5: palette-store test + implementation (session only)**

Create `apps/web/src/stores/palette-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { usePaletteStore } from "./palette-store";

describe("palette-store", () => {
  beforeEach(() => usePaletteStore.setState(usePaletteStore.getInitialState(), true));

  it("open/close toggles", () => {
    usePaletteStore.getState().open();
    expect(usePaletteStore.getState().isOpen).toBe(true);
    usePaletteStore.getState().close();
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it("query updates and clears on close", () => {
    usePaletteStore.getState().open();
    usePaletteStore.getState().setQuery("hello");
    expect(usePaletteStore.getState().query).toBe("hello");
    usePaletteStore.getState().close();
    expect(usePaletteStore.getState().query).toBe("");
  });
});
```

Create `apps/web/src/stores/palette-store.ts`:

```ts
import { create } from "zustand";

interface State {
  isOpen: boolean;
  query: string;
  open(): void;
  close(): void;
  setQuery(q: string): void;
}

export const usePaletteStore = create<State>((set) => ({
  isOpen: false,
  query: "",
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, query: "" }),
  setQuery: (q) => set({ query: q }),
}));
```

Run tests — two passes.

- [ ] **Step 7.6: Commit**

```bash
git add apps/web/src/stores/threads-store.ts \
        apps/web/src/stores/threads-store.test.ts \
        apps/web/src/stores/sidebar-store.ts \
        apps/web/src/stores/sidebar-store.test.ts \
        apps/web/src/stores/palette-store.ts \
        apps/web/src/stores/palette-store.test.ts
git commit -m "feat(web): add threads/sidebar/palette store skeletons"
```

---

## Task 8: `tab-url` helpers (Tab ↔ URL conversion)

Pure functions. Given a `Tab`, produce a relative URL `/w/<slug>/...`; given a URL path, return `(kind, targetId)` or `null` (spec §3.1, §3.2).

**Files:**
- Create: `apps/web/src/lib/tab-url.ts`
- Create: `apps/web/src/lib/tab-url.test.ts`

- [ ] **Step 8.1: Write failing test**

Create `apps/web/src/lib/tab-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tabToUrl, urlToTabTarget, type TabRoute } from "./tab-url";

describe("tabToUrl", () => {
  const cases: Array<[TabRoute, string]> = [
    [{ kind: "dashboard", targetId: null }, "/w/acme/"],
    [{ kind: "note", targetId: "n-123" }, "/w/acme/n/n-123"],
    [{ kind: "project", targetId: "p-1" }, "/w/acme/p/p-1"],
    [{ kind: "research_hub", targetId: null }, "/w/acme/research"],
    [{ kind: "research_run", targetId: "r-1" }, "/w/acme/research/r-1"],
    [{ kind: "import", targetId: null }, "/w/acme/import"],
    [{ kind: "ws_settings", targetId: null }, "/w/acme/settings"],
    [{ kind: "ws_settings", targetId: "members" }, "/w/acme/settings/members"],
  ];
  for (const [route, url] of cases) {
    it(`maps ${route.kind}/${route.targetId} -> ${url}`, () => {
      expect(tabToUrl("acme", route)).toBe(url);
    });
  }
});

describe("urlToTabTarget", () => {
  const cases: Array<[string, TabRoute | null, string | null]> = [
    ["/w/acme/", { kind: "dashboard", targetId: null }, "acme"],
    ["/w/acme/n/n-9", { kind: "note", targetId: "n-9" }, "acme"],
    ["/w/acme/p/p-3", { kind: "project", targetId: "p-3" }, "acme"],
    ["/w/acme/research", { kind: "research_hub", targetId: null }, "acme"],
    ["/w/acme/research/r-77", { kind: "research_run", targetId: "r-77" }, "acme"],
    ["/w/acme/import", { kind: "import", targetId: null }, "acme"],
    ["/w/acme/settings", { kind: "ws_settings", targetId: null }, "acme"],
    ["/w/acme/settings/members", { kind: "ws_settings", targetId: "members" }, "acme"],
    ["/some/other/path", null, null],
    ["/settings/profile", null, null],
  ];
  for (const [url, expected, slug] of cases) {
    it(`parses ${url}`, () => {
      const r = urlToTabTarget(url);
      if (expected === null) expect(r).toBeNull();
      else expect(r).toEqual({ slug, route: expected });
    });
  }
});
```

- [ ] **Step 8.2: Run to confirm failure**

```bash
pnpm --filter @opencairn/web test tab-url
```

Expected: FAIL.

- [ ] **Step 8.3: Implement**

Create `apps/web/src/lib/tab-url.ts`:

```ts
import type { TabKind } from "@/stores/tabs-store";

export interface TabRoute {
  kind: TabKind;
  targetId: string | null;
}

export function tabToUrl(slug: string, route: TabRoute): string {
  const base = `/w/${slug}`;
  switch (route.kind) {
    case "dashboard":
      return `${base}/`;
    case "note":
      return `${base}/n/${route.targetId}`;
    case "project":
      return `${base}/p/${route.targetId}`;
    case "research_hub":
      return `${base}/research`;
    case "research_run":
      return `${base}/research/${route.targetId}`;
    case "import":
      return `${base}/import`;
    case "ws_settings":
      return route.targetId ? `${base}/settings/${route.targetId}` : `${base}/settings`;
  }
}

export function urlToTabTarget(path: string): { slug: string; route: TabRoute } | null {
  const m = path.match(/^\/w\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  const slug = m[1];
  const rest = m[2] ?? "";
  const parts = rest.split("/").filter(Boolean);

  if (parts.length === 0) return { slug, route: { kind: "dashboard", targetId: null } };
  if (parts[0] === "n" && parts[1]) return { slug, route: { kind: "note", targetId: parts[1] } };
  if (parts[0] === "p" && parts[1]) return { slug, route: { kind: "project", targetId: parts[1] } };
  if (parts[0] === "research" && parts.length === 1)
    return { slug, route: { kind: "research_hub", targetId: null } };
  if (parts[0] === "research" && parts[1])
    return { slug, route: { kind: "research_run", targetId: parts[1] } };
  if (parts[0] === "import" && parts.length === 1)
    return { slug, route: { kind: "import", targetId: null } };
  if (parts[0] === "settings")
    return {
      slug,
      route: { kind: "ws_settings", targetId: parts[1] ?? null },
    };

  return null;
}
```

- [ ] **Step 8.4: Re-run test**

```bash
pnpm --filter @opencairn/web test tab-url
```

Expected: all 18 cases pass.

- [ ] **Step 8.5: Commit**

```bash
git add apps/web/src/lib/tab-url.ts apps/web/src/lib/tab-url.test.ts
git commit -m "feat(web): add tab-url conversion helpers"
```

---

## Task 9: `useUrlTabSync` hook (URL is authoritative)

On mount and on URL change, ensure the URL's target is represented as an active tab in the store; create a new tab if none exists. Exposes `navigateToTab(route)` that uses `router.push`/`router.replace` per spec §3.2.

**Files:**
- Create: `apps/web/src/hooks/use-url-tab-sync.ts`
- Create: `apps/web/src/hooks/use-url-tab-sync.test.tsx`

- [ ] **Step 9.1: Write failing test**

Create `apps/web/src/hooks/use-url-tab-sync.test.tsx`:

```tsx
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useUrlTabSync } from "./use-url-tab-sync";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/w/acme/n/n-1",
  useParams: () => ({ wsSlug: "acme" }),
}));

describe("useUrlTabSync", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    push.mockClear();
    replace.mockClear();
  });

  it("creates a tab matching the current URL on mount", () => {
    renderHook(() => useUrlTabSync());
    const s = useTabsStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ kind: "note", targetId: "n-1" });
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it("activates existing matching tab instead of creating a new one", () => {
    useTabsStore.getState().setWorkspace("ws-acme");
    const existing: Tab = {
      id: "pre",
      kind: "note",
      targetId: "n-1",
      mode: "plate",
      title: "existing",
      pinned: false,
      preview: false,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    };
    useTabsStore.setState({ tabs: [existing], activeId: null });
    renderHook(() => useUrlTabSync());
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe("pre");
  });

  it("navigateToTab(kind,id) pushes URL for new tab", () => {
    const { result } = renderHook(() => useUrlTabSync());
    act(() => result.current.navigateToTab({ kind: "note", targetId: "n-5" }, { mode: "push" }));
    expect(push).toHaveBeenCalledWith("/w/acme/n/n-5");
  });

  it("navigateToTab with mode=replace uses router.replace", () => {
    const { result } = renderHook(() => useUrlTabSync());
    act(() => result.current.navigateToTab({ kind: "dashboard", targetId: null }, { mode: "replace" }));
    expect(replace).toHaveBeenCalledWith("/w/acme/");
  });
});
```

- [ ] **Step 9.2: Run to confirm failure**

```bash
pnpm --filter @opencairn/web test use-url-tab-sync
```

Expected: FAIL.

- [ ] **Step 9.3: Implement**

Create `apps/web/src/hooks/use-url-tab-sync.ts`:

```ts
"use client";
import { useCallback, useEffect, useRef } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTabsStore, type Tab, type TabKind, type TabMode } from "@/stores/tabs-store";
import { tabToUrl, urlToTabTarget, type TabRoute } from "@/lib/tab-url";

function defaultModeFor(kind: TabKind): TabMode {
  return kind === "note" ? "plate" : "plate";
}

function defaultTitleFor(kind: TabKind, targetId: string | null): string {
  switch (kind) {
    case "dashboard":
      return "대시보드";
    case "note":
      return "노트";
    case "project":
      return "프로젝트";
    case "research_hub":
      return "Deep Research";
    case "research_run":
      return `Research ${targetId ?? ""}`;
    case "import":
      return "가져오기";
    case "ws_settings":
      return "설정";
  }
}

function newId() {
  // `t_` prefix is retained for debuggability (tab IDs stand out in devtools /
  // logs). Uniqueness comes from crypto.randomUUID — Date.now + 6-char random
  // has meaningful collision risk under rapid tab opens (duplicate-hotkey,
  // deep-link prefetch) which would corrupt the tabs map keyed on id.
  return `t_${crypto.randomUUID()}`;
}

export function useUrlTabSync() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useParams<{ wsSlug?: string }>();
  const slug = params?.wsSlug ?? "";

  const workspaceKey = slug ? `ws_slug:${slug}` : null;
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setWorkspace = useTabsStore((s) => s.setWorkspace);
  const addTab = useTabsStore((s) => s.addTab);
  const setActive = useTabsStore((s) => s.setActive);
  const findTabByTarget = useTabsStore.getState().findTabByTarget;

  const initialized = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceKey) return;
    if (initialized.current !== workspaceKey) {
      setWorkspace(workspaceKey);
      initialized.current = workspaceKey;
    }
  }, [workspaceKey, setWorkspace]);

  useEffect(() => {
    if (!slug) return;
    const parsed = urlToTabTarget(pathname);
    if (!parsed || parsed.slug !== slug) return;
    const { route } = parsed;
    const existing = useTabsStore.getState().findTabByTarget(route.kind, route.targetId);
    if (existing) {
      if (activeId !== existing.id) setActive(existing.id);
      return;
    }
    const tab: Tab = {
      id: newId(),
      kind: route.kind,
      targetId: route.targetId,
      mode: defaultModeFor(route.kind),
      title: defaultTitleFor(route.kind, route.targetId),
      pinned: false,
      preview: route.kind === "note",
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    };
    addTab(tab);
  }, [pathname, slug, activeId, setActive, addTab]);

  const navigateToTab = useCallback(
    (route: TabRoute, opts: { mode: "push" | "replace" } = { mode: "push" }) => {
      if (!slug) return;
      const url = tabToUrl(slug, route);
      if (opts.mode === "replace") router.replace(url);
      else router.push(url);
    },
    [router, slug],
  );

  return { tabs, activeId, navigateToTab };
}
```

- [ ] **Step 9.4: Re-run test**

```bash
pnpm --filter @opencairn/web test use-url-tab-sync
```

Expected: all four pass.

- [ ] **Step 9.5: Commit**

```bash
git add apps/web/src/hooks/use-url-tab-sync.ts apps/web/src/hooks/use-url-tab-sync.test.tsx
git commit -m "feat(web): add URL-authoritative tab sync hook"
```

---

## Task 10: AppShell 3-panel layout + resize handles

Renders three regions with `CSS grid`. Resize handles call `panel-store` setters. Double-click resets width.

**Files:**
- Create: `apps/web/src/components/shell/app-shell.tsx`
- Create: `apps/web/src/components/shell/shell-resize-handle.tsx`
- Create: `apps/web/src/components/shell/placeholder-sidebar.tsx`
- Create: `apps/web/src/components/shell/placeholder-tab-shell.tsx`
- Create: `apps/web/src/components/shell/placeholder-agent-panel.tsx`

- [ ] **Step 10.1: Placeholder components**

Create `apps/web/src/components/shell/placeholder-sidebar.tsx`:

```tsx
export function PlaceholderSidebar() {
  return (
    <aside
      data-testid="app-shell-sidebar"
      className="h-full border-r border-border bg-background text-sm text-muted-foreground"
    >
      <div className="p-4">사이드바 (Phase 2)</div>
    </aside>
  );
}
```

Create `apps/web/src/components/shell/placeholder-tab-shell.tsx`:

```tsx
export function PlaceholderTabShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      data-testid="app-shell-main"
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <div className="flex h-10 items-center border-b border-border px-3 text-xs text-muted-foreground">
        탭 바 (Phase 3)
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </main>
  );
}
```

Create `apps/web/src/components/shell/placeholder-agent-panel.tsx`:

```tsx
export function PlaceholderAgentPanel() {
  return (
    <aside
      data-testid="app-shell-agent-panel"
      className="h-full border-l border-border bg-background text-sm text-muted-foreground"
    >
      <div className="p-4">AI 에이전트 (Phase 4)</div>
    </aside>
  );
}
```

- [ ] **Step 10.2: Resize handle**

Create `apps/web/src/components/shell/shell-resize-handle.tsx`:

```tsx
"use client";
import { useCallback, useRef } from "react";

interface Props {
  onDrag(delta: number): void;
  onReset(): void;
  orientation?: "vertical";
  className?: string;
}

export function ShellResizeHandle({ onDrag, onReset, className = "" }: Props) {
  const startX = useRef(0);
  const dragging = useRef(false);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      startX.current = e.clientX;
      onDrag(delta);
    },
    [onDrag],
  );

  const stop = useCallback(() => {
    dragging.current = false;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", stop);
  }, [onMouseMove]);

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stop);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`w-1 cursor-col-resize bg-border hover:bg-primary/40 ${className}`}
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      data-testid="shell-resize-handle"
    />
  );
}
```

- [ ] **Step 10.3: AppShell layout**

Create `apps/web/src/components/shell/app-shell.tsx`:

```tsx
"use client";
import { PlaceholderSidebar } from "./placeholder-sidebar";
import { PlaceholderTabShell } from "./placeholder-tab-shell";
import { PlaceholderAgentPanel } from "./placeholder-agent-panel";
import { ShellResizeHandle } from "./shell-resize-handle";
import { usePanelStore } from "@/stores/panel-store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const sidebarWidth = usePanelStore((s) => s.sidebarWidth);
  const sidebarOpen = usePanelStore((s) => s.sidebarOpen);
  const agentPanelWidth = usePanelStore((s) => s.agentPanelWidth);
  const agentPanelOpen = usePanelStore((s) => s.agentPanelOpen);
  const setSidebarWidth = usePanelStore((s) => s.setSidebarWidth);
  const resetSidebarWidth = usePanelStore((s) => s.resetSidebarWidth);
  const setAgentPanelWidth = usePanelStore((s) => s.setAgentPanelWidth);
  const resetAgentPanelWidth = usePanelStore((s) => s.resetAgentPanelWidth);

  return (
    <div className="flex h-screen w-screen overflow-hidden" data-testid="app-shell">
      {sidebarOpen && (
        <>
          <div style={{ width: sidebarWidth, flexShrink: 0 }}>
            <PlaceholderSidebar />
          </div>
          <ShellResizeHandle
            onDrag={(d) => setSidebarWidth(sidebarWidth + d)}
            onReset={resetSidebarWidth}
          />
        </>
      )}
      <PlaceholderTabShell>{children}</PlaceholderTabShell>
      {agentPanelOpen && (
        <>
          <ShellResizeHandle
            onDrag={(d) => setAgentPanelWidth(agentPanelWidth - d)}
            onReset={resetAgentPanelWidth}
          />
          <div style={{ width: agentPanelWidth, flexShrink: 0 }}>
            <PlaceholderAgentPanel />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 10.4: No unit test for AppShell**

Rationale: Visual composition, covered by the Playwright e2e spec in Task 13. Unit-testing the placeholders adds no signal.

- [ ] **Step 10.5: Commit**

```bash
git add apps/web/src/components/shell/
git commit -m "feat(web): add AppShell 3-panel layout with resize handles"
```

---

## Task 11: `shell-providers` + keyboard shortcut wiring

Single component that mounts URL-tab sync, `⌘\` / `⌘J` shortcuts, and exposes workspace context. Wraps AppShell.

**Files:**
- Create: `apps/web/src/components/shell/shell-providers.tsx`

- [ ] **Step 11.1: Implement**

Create `apps/web/src/components/shell/shell-providers.tsx`:

```tsx
"use client";
import { useCallback } from "react";
import { AppShell } from "./app-shell";
import { useUrlTabSync } from "@/hooks/use-url-tab-sync";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { usePanelStore } from "@/stores/panel-store";
import { useThreadsStore } from "@/stores/threads-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useEffect } from "react";

export function ShellProviders({
  wsSlug,
  children,
}: {
  wsSlug: string;
  children: React.ReactNode;
}) {
  useUrlTabSync();

  const toggleSidebar = usePanelStore((s) => s.toggleSidebar);
  const toggleAgentPanel = usePanelStore((s) => s.toggleAgentPanel);

  const onSidebarShortcut = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      toggleSidebar();
    },
    [toggleSidebar],
  );
  const onAgentPanelShortcut = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      toggleAgentPanel();
    },
    [toggleAgentPanel],
  );

  useKeyboardShortcut("mod+\\", onSidebarShortcut);
  useKeyboardShortcut("mod+j", onAgentPanelShortcut);

  const setThreadsWs = useThreadsStore((s) => s.setWorkspace);
  const setSidebarWs = useSidebarStore((s) => s.setWorkspace);

  useEffect(() => {
    const key = `ws_slug:${wsSlug}`;
    setThreadsWs(key);
    setSidebarWs(key);
  }, [wsSlug, setThreadsWs, setSidebarWs]);

  return <AppShell>{children}</AppShell>;
}
```

- [ ] **Step 11.2: Commit**

```bash
git add apps/web/src/components/shell/shell-providers.tsx
git commit -m "feat(web): wire URL sync and Ctrl+\\/Ctrl+J shortcuts"
```

---

## Task 12: Responsive `Sheet` behavior

On `md` breakpoint and below, sidebar and agent panel render as overlays instead of inline columns.

**Files:**
- Modify: `apps/web/src/components/shell/app-shell.tsx`

- [ ] **Step 12.1: Update AppShell to branch on breakpoint**

Edit `apps/web/src/components/shell/app-shell.tsx` to introduce a responsive branch. Replace the entire return with:

```tsx
"use client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { PlaceholderSidebar } from "./placeholder-sidebar";
import { PlaceholderTabShell } from "./placeholder-tab-shell";
import { PlaceholderAgentPanel } from "./placeholder-agent-panel";
import { ShellResizeHandle } from "./shell-resize-handle";
import { usePanelStore } from "@/stores/panel-store";
import { useBreakpoint } from "@/hooks/use-breakpoint";

export function AppShell({ children }: { children: React.ReactNode }) {
  const bp = useBreakpoint();
  const sidebarWidth = usePanelStore((s) => s.sidebarWidth);
  const sidebarOpen = usePanelStore((s) => s.sidebarOpen);
  const toggleSidebar = usePanelStore((s) => s.toggleSidebar);
  const agentPanelWidth = usePanelStore((s) => s.agentPanelWidth);
  const agentPanelOpen = usePanelStore((s) => s.agentPanelOpen);
  const toggleAgentPanel = usePanelStore((s) => s.toggleAgentPanel);
  const setSidebarWidth = usePanelStore((s) => s.setSidebarWidth);
  const resetSidebarWidth = usePanelStore((s) => s.resetSidebarWidth);
  const setAgentPanelWidth = usePanelStore((s) => s.setAgentPanelWidth);
  const resetAgentPanelWidth = usePanelStore((s) => s.resetAgentPanelWidth);

  const isCompact = bp !== "lg";

  if (isCompact) {
    return (
      <div className="flex h-screen w-screen overflow-hidden" data-testid="app-shell">
        <Sheet open={sidebarOpen} onOpenChange={toggleSidebar}>
          <SheetContent side="left" className="w-[280px] p-0">
            <PlaceholderSidebar />
          </SheetContent>
        </Sheet>
        <PlaceholderTabShell>{children}</PlaceholderTabShell>
        <Sheet open={agentPanelOpen} onOpenChange={toggleAgentPanel}>
          <SheetContent side="right" className="w-[360px] p-0">
            <PlaceholderAgentPanel />
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden" data-testid="app-shell">
      {sidebarOpen && (
        <>
          <div style={{ width: sidebarWidth, flexShrink: 0 }}>
            <PlaceholderSidebar />
          </div>
          <ShellResizeHandle
            onDrag={(d) => setSidebarWidth(sidebarWidth + d)}
            onReset={resetSidebarWidth}
          />
        </>
      )}
      <PlaceholderTabShell>{children}</PlaceholderTabShell>
      {agentPanelOpen && (
        <>
          <ShellResizeHandle
            onDrag={(d) => setAgentPanelWidth(agentPanelWidth - d)}
            onReset={resetAgentPanelWidth}
          />
          <div style={{ width: agentPanelWidth, flexShrink: 0 }}>
            <PlaceholderAgentPanel />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 12.2: Verify `Sheet` component exists**

Check `apps/web/src/components/ui/sheet.tsx` exists (part of shadcn). If missing:
```bash
pnpm --filter @opencairn/web dlx shadcn@latest add sheet
```

- [ ] **Step 12.3: Commit**

```bash
git add apps/web/src/components/shell/app-shell.tsx apps/web/src/components/ui/
git commit -m "feat(web): degrade shell panels to Sheet overlays below lg"
```

---

## Task 13: Next.js route scaffolds + root redirect + e2e test

Add the workspace-scoped layout + all page placeholders, add root redirect, and write one Playwright spec that walks through route transitions.

**Files:**
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/layout.tsx`
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/page.tsx`
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/n/[noteId]/page.tsx`
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/research/page.tsx`
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/research/[runId]/page.tsx`
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/settings/[[...slug]]/page.tsx`
- Modify: `apps/web/src/app/[locale]/app/w/[wsSlug]/import/` (already exists — add placeholder if absent)
- Modify: `apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/page.tsx` (existing route, ensure placeholder)
- Modify: `apps/web/src/app/[locale]/page.tsx` — root redirect
- Create: `apps/web/tests/e2e/app-shell-phase1.spec.ts`

- [ ] **Step 13.1: Workspace layout**

Create `apps/web/src/app/[locale]/app/w/[wsSlug]/layout.tsx`:

```tsx
import { ShellProviders } from "@/components/shell/shell-providers";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wsSlug: string }>;
}) {
  const { wsSlug } = await params;
  return <ShellProviders wsSlug={wsSlug}>{children}</ShellProviders>;
}
```

Note: the outer `apps/web/src/app/[locale]/app/layout.tsx` already handles session + React Query. Do NOT duplicate session guards here.

- [ ] **Step 13.2: Workspace dashboard page (placeholder)**

Create `apps/web/src/app/[locale]/app/w/[wsSlug]/page.tsx`:

```tsx
export default function WorkspaceDashboard() {
  return (
    <div data-testid="route-dashboard" className="p-6">
      <h1 className="text-2xl font-semibold">대시보드</h1>
      <p className="text-sm text-muted-foreground">Phase 5 가 이 자리를 채웁니다.</p>
    </div>
  );
}
```

- [ ] **Step 13.3: Note / research / research run / settings placeholders**

Create each with the same skeleton, varying `data-testid` and heading:

`apps/web/src/app/[locale]/app/w/[wsSlug]/n/[noteId]/page.tsx`:
```tsx
export default async function NotePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  return (
    <div data-testid="route-note" className="p-6">
      <h1 className="text-2xl font-semibold">노트 {noteId}</h1>
      <p className="text-sm text-muted-foreground">Phase 3 가 이 자리를 채웁니다.</p>
    </div>
  );
}
```

`apps/web/src/app/[locale]/app/w/[wsSlug]/research/page.tsx`:
```tsx
export default function ResearchHub() {
  return (
    <div data-testid="route-research-hub" className="p-6">
      <h1 className="text-2xl font-semibold">Deep Research</h1>
    </div>
  );
}
```

`apps/web/src/app/[locale]/app/w/[wsSlug]/research/[runId]/page.tsx`:
```tsx
export default async function ResearchRun({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <div data-testid="route-research-run" className="p-6">
      <h1 className="text-2xl font-semibold">Research {runId}</h1>
    </div>
  );
}
```

`apps/web/src/app/[locale]/app/w/[wsSlug]/settings/[[...slug]]/page.tsx`:
```tsx
export default async function WsSettings({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const sub = slug?.[0] ?? "members";
  return (
    <div data-testid="route-ws-settings" className="p-6">
      <h1 className="text-2xl font-semibold">워크스페이스 설정 — {sub}</h1>
    </div>
  );
}
```

If `apps/web/src/app/[locale]/app/w/[wsSlug]/p/[projectId]/page.tsx` and `.../import/page.tsx` already exist, wrap them by adding `data-testid="route-project"` / `route-import` on the root element so the e2e test can select them. Do not replace their existing content.

- [ ] **Step 13.4: Root redirect**

Modify `apps/web/src/app/[locale]/page.tsx`. Replace current content (landing page logic may live here — keep landing for anonymous users; change only the authenticated branch). If the file currently renders the landing page unconditionally, wrap it:

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
// ... existing landing imports

export default async function LocalePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  if (session?.userId) {
    const res = await fetch(`${process.env.INTERNAL_API_URL}/api/users/me`, {
      headers: { authorization: `Bearer ${session.token}` },
      cache: "no-store",
    });
    if (res.ok) {
      const me = (await res.json()) as { last_viewed_workspace_id?: string | null };
      if (me.last_viewed_workspace_id) {
        // look up slug — Phase 1 shortcut: assume API also returns slug or use a helper
        const ws = await fetch(
          `${process.env.INTERNAL_API_URL}/api/workspaces/${me.last_viewed_workspace_id}`,
          { headers: { authorization: `Bearer ${session.token}` }, cache: "no-store" },
        );
        if (ws.ok) {
          const data = (await ws.json()) as { slug?: string };
          if (data.slug) redirect(`/${locale}/app/w/${data.slug}/`);
        }
      }
    }
    // Fallback: first workspace from membership
    const list = await fetch(`${process.env.INTERNAL_API_URL}/api/workspaces/me`, {
      headers: { authorization: `Bearer ${session.token}` },
      cache: "no-store",
    });
    if (list.ok) {
      const data = (await list.json()) as { workspaces?: Array<{ slug: string }> };
      if (data.workspaces?.[0]) redirect(`/${locale}/app/w/${data.workspaces[0].slug}/`);
    }
  }
  // Anonymous: render existing landing (preserve whatever was there)
  // If you had default-exported a component, call it here instead.
  // Example:
  // return <Landing locale={locale} />;
}
```

Adapt to the exact session retrieval API used elsewhere (e.g. `getSession`, `auth()`, etc. — search `apps/web/src/lib/session.ts` for the existing helper). Do not introduce a new session API.

If the landing page logic is non-trivial, factor it out first into `landing-page.tsx` and import rather than reimplementing.

- [ ] **Step 13.5: E2E spec**

Create `apps/web/tests/e2e/app-shell-phase1.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { loginAsTestUser, seedWorkspaceWithFirstProject } from "./helpers";

test.describe("App Shell Phase 1", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test("renders 3-panel shell with placeholders", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
    await expect(page.getByTestId("app-shell-main")).toBeVisible();
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible();
    await expect(page.getByTestId("route-dashboard")).toBeVisible();
  });

  test("Ctrl+\\ toggles sidebar", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
    await page.keyboard.press("Control+\\");
    await expect(page.getByTestId("app-shell-sidebar")).not.toBeVisible();
    await page.keyboard.press("Control+\\");
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
  });

  test("Ctrl+J toggles agent panel", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/`);
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(page.getByTestId("app-shell-agent-panel")).not.toBeVisible();
  });

  test("navigates through note -> research -> settings routes", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.goto(`/ko/app/w/${slug}/n/n-abc`);
    await expect(page.getByTestId("route-note")).toBeVisible();
    await page.goto(`/ko/app/w/${slug}/research`);
    await expect(page.getByTestId("route-research-hub")).toBeVisible();
    await page.goto(`/ko/app/w/${slug}/settings`);
    await expect(page.getByTestId("route-ws-settings")).toBeVisible();
  });

  test("collapses to Sheet overlays below 1024px", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto(`/ko/app/w/${slug}/`);
    await expect(page.getByTestId("app-shell-main")).toBeVisible();
    // sidebar overlay closed by default on compact; open via Ctrl+\
    await expect(page.getByTestId("app-shell-sidebar")).not.toBeVisible();
    await page.keyboard.press("Control+\\");
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
  });

  test("root / redirects to last viewed workspace", async ({ page }) => {
    const { slug } = await seedWorkspaceWithFirstProject();
    // Prime last-viewed via API
    await page.request.patch("/api/users/me/last-viewed-workspace", {
      data: { workspace_id: slug /* replace with actual id in helper */ },
    });
    await page.goto("/ko");
    await page.waitForURL(new RegExp(`/ko/app/w/${slug}/`));
  });
});
```

Adapt `loginAsTestUser` / `seedWorkspaceWithFirstProject` to the existing helpers in `apps/web/tests/e2e/helpers.ts`. If those don't exist, add minimal versions using the API test harness. The `last-viewed` priming in the final test should use the real workspace id — if the helper returns only `slug`, extend it to also return `id`.

- [ ] **Step 13.6: Run full test suite**

```bash
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web test:e2e -g "App Shell Phase 1"
```

Expected: all vitest projects pass; all six Playwright cases pass. If Sheet-overlay visibility assertion flaps, add `waitForAnimation` or use role-based queries instead of `toBeVisible` directly after toggle.

- [ ] **Step 13.7: Commit**

```bash
git add apps/web/src/app/[locale]/app/w/[wsSlug]/ \
        apps/web/src/app/[locale]/page.tsx \
        apps/web/tests/e2e/app-shell-phase1.spec.ts
git commit -m "feat(web): add workspace route scaffolds and phase-1 shell e2e"
```

---

## Task 14: Post-feature verification + docs update

Run the mandatory OpenCairn post-feature loop (`opencairn:post-feature` skill).

- [ ] **Step 14.1: Run all checks**

```bash
pnpm --filter @opencairn/web typecheck
pnpm --filter @opencairn/web lint
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/api test
pnpm --filter @opencairn/web test:e2e -g "App Shell Phase 1"
pnpm --filter @opencairn/web i18n:parity
```

Expected: all green. Any i18n parity error for user-facing strings in placeholders should be fixed by moving the 4 Korean strings (`대시보드`, `사이드바 (Phase 2)`, etc.) to `messages/{ko,en}/app-shell.json` and using `useTranslations`.

- [ ] **Step 14.2: Update `docs/contributing/plans-status.md`**

Mark Plan 2E/2F as superseded by this Phase 1 plan, add current status ("🟡 Active — Phase 1 complete, Phase 2 next"). Keep the entry short.

- [ ] **Step 14.3: Update memory**

Add a memory entry `project_plan_app_shell_phase_1_complete.md` noting: date, HEAD SHA, summary (shell frame + stores + routing + e2e), and next-step (Phase 2 plan writing in next session).

- [ ] **Step 14.4: Commit docs/memory updates**

```bash
git add docs/contributing/plans-status.md
git commit -m "docs(docs): mark app shell phase 1 complete in plans-status"
```

---

## Completion Criteria

- [ ] All 14 tasks committed
- [ ] `pnpm --filter @opencairn/web test` — green (node + jsdom projects)
- [ ] `pnpm --filter @opencairn/api test` — green
- [ ] `pnpm --filter @opencairn/web test:e2e -g "App Shell Phase 1"` — 6/6 green
- [ ] `pnpm --filter @opencairn/web typecheck` — green
- [ ] `pnpm --filter @opencairn/web i18n:parity` — green
- [ ] Manual smoke: `pnpm dev` → log in → land on `/ko/app/w/<slug>/` → shell renders with 3 placeholder regions → `Ctrl+\` and `Ctrl+J` toggle panels → resize window below 1024px → panels become Sheet overlays → Playwright routes (`/n/x`, `/research`, `/settings`) all render placeholders

## What's NOT in this plan (belongs to later phases)

| Item | Phase |
|------|-------|
| Workspace switcher dropdown, global nav, project hero, tree | 2 |
| Real project tree backend (`ltree` vs closure table, ADR 0008) | 2 (prerequisite) |
| Tab bar rendering (drag, context menu, overflow) | 3 |
| Preview tab mode UI (italic) | 3 |
| Split pane | 3 |
| `chat_threads` / `chat_messages` / `message_feedback` DB + API | 4 |
| Agent panel content (messages, thought bubble, composer) | 4 |
| Dashboard content, project view, research lifecycle, import wizard | 5 |
| Command palette (cmdk) | 5 |
| Notifications drawer | 5 |
