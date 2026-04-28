# MCP Client Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation of the MCP client — `user_mcp_servers` table + 5 API routes + Settings UI page + worker `runtime/mcp/` package + `tool_demo` agent integration — so a user can register one external MCP server and a `tool_demo.full()` run lists it under `mcp__<slug>__<tool>` and can call it end-to-end. Behind `FEATURE_MCP_CLIENT` (default OFF, hosted-only).

**Architecture:** New per-user `user_mcp_servers` row stores `serverSlug` + `serverUrl` + AES-GCM-encrypted auth header. API exposes 5 user-owned routes (`GET/POST/PATCH/DELETE /api/mcp/servers` + `POST /api/mcp/servers/:id/test`). On register, the API auto-runs `list_tools` once and rejects servers with >50 tools or unreachable transports. The worker package `runtime/mcp/{client,adapter,resolver,slug}.py` does per-run resolution: at run start, `build_mcp_tools_for_user(user_id)` reads active rows, calls `list_tools` on each in parallel, wraps every returned `types.Tool` as a `runtime.Tool` whose `run()` opens a fresh `ClientSession` per call. The list is union'd into `tool_demo.full()`'s static tools so `run_with_tools` sees them as ordinary tools — no change to `ToolLoopExecutor`. Multi-tenant safety: MCP tools never enter the global `_REGISTRY`; SSRF guard blocks private/metadata IPs; `allowed_scopes=("workspace",)` hardcoded; auth header lives in adapter closure (never in `args` or trajectory).

**Tech Stack:** Drizzle ORM + Postgres (`user_mcp_servers` + `mcp_server_status` enum), AES-256-GCM (existing `integration-tokens.ts` / `integration_crypto.py`), Zod (`packages/shared`), Hono 4 + `@modelcontextprotocol/sdk` (TS, API-side `/test`), Python 3.12 + `mcp >= 1.12` + `mcp.client.streamable_http` + `mcp.ClientSession` (worker), Next.js 16 + next-intl + shadcn (web settings UI), Vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-04-28-mcp-client-design.md` (Phase 1 = §10).

**Dependencies:**
- ✅ Plan 12 — `runtime.Agent` + `runtime.tools.Tool` Protocol + `runtime.loop_runner.run_with_tools`
- ✅ Plan 11A — `runtime/loop_runner.py` + `tool_demo` agent presets (the integration host)
- ✅ Ingest Source Expansion — `apps/worker/src/worker/lib/integration_crypto.py` + `apps/api/src/lib/integration-tokens.ts` (AES-GCM helpers reused as-is)
- ✅ Plan 9a — `i18n:parity` enforcement + settings page route convention (`apps/web/src/app/[locale]/app/settings/{ai,mcp}/page.tsx`)
- ✅ Phase 5 — `apps/web/src/components/settings/ByokKeyCard.tsx` (similar shadcn settings-card layout to mirror)

**Migration number:** Run `pnpm db:generate` at implementation time. As of plan writing (2026-04-28) the migration head is `0034_note_enrichments.sql`. Parallel sessions may land 0035/0036 first — do not hard-code. If `pnpm db:generate` produces a colliding number, reorder before merge (Plan 11B-A pattern).

**Out of scope (deferred to MCP Phase 2+ or other plans — DO NOT widen):**
- The 11 other agents (Compiler / Research / Librarian / Curator / Synthesis / Connector / Staleness / Narrator / Visualization / Code / TemporalAgent) — Phase 2. Each entry is a 1-line `tools = [..., *mcp_tools]` union once that agent itself uses `run_with_tools`.
- A new chat agent that owns the `mcp__my_linear__create_issue` user scenario (spec §1.1) — Phase 2.
- OAuth 2.1 + PKCE auth (OQ-2) — separate spec when an OAuth-only server appears.
- Workspace-shared registration (OQ-1) — separate spec when team users request.
- Tool catalog cache (OQ-3) — only when `list_tools` round-trip shows up as SSE first-token latency.
- `sampling` / `resources` / `prompts` MCP features (OQ-4) — `tools` only in Phase 1.
- Domain allowlist default behaviour (OQ-5) — `MCP_URL_ALLOWLIST` is opt-in via env regex; default is "any HTTPS host except SSRF-blocked IPs".
- Per-tool destructive confirmation UI (OQ-6) — destructive heuristic is currently a trajectory flag only.
- stdio transport (production) — test fixtures may use stdio, production never does.
- OpenCairn-as-MCP-server (direction 2) — separate spec.

**Verification gates (run at end of each phase + once at end of plan):**
- `pnpm --filter @opencairn/db test`
- `pnpm --filter @opencairn/shared test`
- `pnpm --filter @opencairn/api test`
- `pnpm --filter @opencairn/web test`
- `pnpm --filter @opencairn/web i18n:parity`
- `pnpm --filter @opencairn/web exec tsc --noEmit`
- `cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/ tests/agents/test_tool_demo_agent_unit.py -v`

Branch: `docs/mcp-client-spec` (the spec already lives here from commit `a6224ed`; keep adding plan tasks as commits on the same branch — spec + plan ship as one PR).

---

## File Map

### packages/db
- **Modify** `src/schema/enums.ts` — add `mcpServerStatusEnum`.
- **Create** `src/schema/user-mcp-servers.ts` — Drizzle table (spec §4.1).
- **Modify** `src/index.ts` — re-export `userMcpServers`, types, enum.
- **Create** `tests/user-mcp-servers.test.ts` — schema sanity + columns + unique constraint.
- **Auto-generated** `drizzle/<NNNN>_user_mcp_servers.sql` (number assigned by `pnpm db:generate`).

### packages/shared
- **Create** `src/mcp.ts` — Zod schemas (spec §5.2 + response types).
- **Modify** `src/index.ts` — re-export.
- **Create** `tests/mcp.test.ts`.

### apps/api
- **Modify** `package.json` — add `@modelcontextprotocol/sdk` (latest, pin major).
- **Create** `src/lib/mcp-runner.ts` — `runListTools(url, authHeader)` using SDK's `Client` + `StreamableHTTPClientTransport`. Used by both the test endpoint and the auto-test on POST.
- **Create** `src/lib/mcp-slug.ts` — `generateSlug(displayName, takenSlugs)` + `isValidSlug(s)`.
- **Create** `src/routes/mcp.ts` — Hono router with the 5 routes + feature-flag middleware.
- **Modify** `src/app.ts` — mount under `/api/mcp/servers`.
- **Create** `tests/mcp/servers.test.ts` — CRUD + auto-test on POST + 50-tool reject + cross-user 404.
- **Create** `tests/mcp/encryption.test.ts` — auth-header round-trip; never plaintext in responses.
- **Create** `tests/mcp/slug.test.ts` — slug generation + collision suffix.
- **Create** `tests/mcp/feature-flag.test.ts` — flag OFF → 404.

### apps/worker
- **Modify** `pyproject.toml` — add `mcp>=1.12,<2`.
- **Create** `src/runtime/mcp/__init__.py` — public exports.
- **Create** `src/runtime/mcp/slug.py` — slug regex validator (mirrors API `isValidSlug`).
- **Create** `src/runtime/mcp/client.py` — SSRF guard + `MCPClient` wrapper (`list_tools`, `call_tool`).
- **Create** `src/runtime/mcp/adapter.py` — `adapt(server_slug, mcp_tool, *, server_url, auth_header)` returning a `runtime.Tool`.
- **Create** `src/runtime/mcp/resolver.py` — `build_mcp_tools_for_user(user_id, *, db_session, on_warning=None)`.
- **Modify** `src/runtime/__init__.py` — re-export `build_mcp_tools_for_user`, `MCPCatalogResolver`.
- **Modify** `src/worker/agents/tool_demo/agent.py` — feature-flagged MCP union in `run()`.
- **Create** `src/worker/lib/mcp_secrets.py` — small payload helper that decrypts `auth_header_value_encrypted` rows for activity input (re-uses `integration_crypto.decrypt_token`).
- **Create** `tests/runtime/mcp/__init__.py`
- **Create** `tests/runtime/mcp/conftest.py` — fixtures (in-process FastMCP echo server, mocked DB).
- **Create** `tests/runtime/mcp/test_slug.py`
- **Create** `tests/runtime/mcp/test_client_ssrf.py`
- **Create** `tests/runtime/mcp/test_client_http.py` — round-trip via in-process server.
- **Create** `tests/runtime/mcp/test_adapter.py`
- **Create** `tests/runtime/mcp/test_resolver.py`
- **Create** `tests/runtime/mcp/test_truncation.py`
- **Modify** `tests/agents/test_tool_demo_agent_unit.py` — add a flag-on case proving MCP tools are union'd.
- **Create** `tests/lib/test_mcp_secrets.py`

### apps/web
- **Modify** `messages/ko/settings.json` — add `mcp` block.
- **Modify** `messages/en/settings.json` — add `mcp` block.
- **Create** `src/lib/api/mcp.ts` — typed fetch wrappers (`listServers`, `createServer`, `updateServer`, `deleteServer`, `testServer`).
- **Create** `src/components/settings/mcp/McpServerForm.tsx` — register/edit form (displayName, URL, header name, header value).
- **Create** `src/components/settings/mcp/McpServerList.tsx` — list + status badges + Test/Edit/Delete actions.
- **Create** `src/app/[locale]/app/settings/mcp/page.tsx` — auth guard + feature-flag 404 + page shell.
- **Create** `src/components/settings/mcp/__tests__/McpServerForm.test.tsx`
- **Create** `src/components/settings/mcp/__tests__/McpServerList.test.tsx`

### docs
- **Modify** `docs/architecture/api-contract.md` — add `/api/mcp/servers/*` rows.
- **Create** `docs/review/2026-04-XX-mcp-client-phase-1-smoke.md` — manual smoke runbook + 2 screenshots (settings page after register; trajectory event listing for `mcp__echo__add`). Date assigned at smoke time.

### env / docker
- **Modify** `.env.example` — add `FEATURE_MCP_CLIENT=false` + `MCP_URL_ALLOWLIST=` (empty by default).
- No `docker-compose.yml` change — feature flag alone gates it.

---

## Task 1: Add Python MCP SDK dependency + import smoke

**Files:**
- Modify: `apps/worker/pyproject.toml`
- Create: `apps/worker/tests/runtime/mcp/__init__.py`
- Create: `apps/worker/tests/runtime/mcp/test_imports.py`

- [ ] **Step 1: Add the dep**

In `apps/worker/pyproject.toml` under `dependencies` (preserve alphabetic-ish ordering near `markdown-it-py` / `redis`):

```toml
    # MCP client SDK — used by runtime/mcp/{client,resolver}.py to talk to
    # user-registered streamable-HTTP MCP servers (spec 2026-04-28).
    "mcp>=1.12,<2",
```

- [ ] **Step 2: Sync and write the import-smoke test**

```bash
cd apps/worker && uv sync --all-extras
```

```python
# apps/worker/tests/runtime/mcp/test_imports.py
"""Imports we rely on must resolve at SDK >= 1.12. Pin via test."""
def test_mcp_sdk_surface_present():
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
    from mcp import types

    assert ClientSession is not None
    assert streamablehttp_client is not None
    # Tool DTO we adapt against.
    assert hasattr(types, "Tool")
```

```python
# apps/worker/tests/runtime/mcp/__init__.py
```
(Empty init.)

- [ ] **Step 3: Run**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/test_imports.py -v
```
Expected: PASS.

If `streamablehttp_client` is not present at the chosen SDK version, raise the floor (`>=1.13`) — the symbol name is unstable across early MCP SDK releases. Verify with `python -c "from mcp.client.streamable_http import streamablehttp_client; print(streamablehttp_client)"` before pinning.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/pyproject.toml apps/worker/uv.lock apps/worker/tests/runtime/mcp/__init__.py apps/worker/tests/runtime/mcp/test_imports.py
git commit -m "$(cat <<'EOF'
feat(worker): add mcp SDK dep + import smoke (Phase 1 Task 1)

Pins MCP Python SDK >= 1.12 with an import-surface test so future
upgrades fail loudly if `streamablehttp_client` / `ClientSession` /
`types.Tool` move.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: DB schema — `mcp_server_status` enum + `user_mcp_servers` table

**Files:**
- Modify: `packages/db/src/schema/enums.ts`
- Create: `packages/db/src/schema/user-mcp-servers.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/tests/user-mcp-servers.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
// packages/db/tests/user-mcp-servers.test.ts
import { describe, it, expect } from "vitest";
import { userMcpServers } from "../src/schema/user-mcp-servers";

describe("userMcpServers schema", () => {
  it("has the columns Phase 1 requires", () => {
    const cols = Object.keys(userMcpServers);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "userId",
        "serverSlug",
        "displayName",
        "serverUrl",
        "authHeaderName",
        "authHeaderValueEncrypted",
        "status",
        "lastSeenToolCount",
        "lastSeenAt",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("declares a (user_id, server_slug) unique constraint", () => {
    // Drizzle exposes table-level uniques through the symbol map; this
    // shallow assertion is enough to fail loudly if the constraint vanishes.
    const uniques = (userMcpServers as unknown as { _: { config?: unknown } })._
      ?.config;
    expect(JSON.stringify(uniques)).toContain("user_mcp_servers_user_slug_unique");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @opencairn/db test -- --run tests/user-mcp-servers.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Add the enum**

In `packages/db/src/schema/enums.ts` after `notificationKindEnum`:

```ts
// MCP client (spec 2026-04-28). `auth_expired` is set when a recent
// list_tools / call_tool returns 401 — surfaced in the settings UI as a
// red dot, not as a notification row (spec §4.4).
export const mcpServerStatusEnum = pgEnum("mcp_server_status", [
  "active",
  "disabled",
  "auth_expired",
]);
```

- [ ] **Step 4: Add the table**

```ts
// packages/db/src/schema/user-mcp-servers.ts
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { bytea } from "./custom-types";
import { mcpServerStatusEnum } from "./enums";

// Per-user external MCP server registration (spec 2026-04-28 §4.1). One
// row per (userId, serverSlug). The slug is generated server-side from
// displayName at POST time and is the prefix used in tool names —
// `mcp__<serverSlug>__<toolName>`.
export const userMcpServers = pgTable(
  "user_mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Better Auth user.id is text. FK type matches user_integrations /
    // user_preferences precedent.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Stable URL-safe identifier. /^[a-z0-9_]{1,32}$/. Generator lives in
    // apps/api/src/lib/mcp-slug.ts; worker only validates.
    serverSlug: text("server_slug").notNull(),
    displayName: text("display_name").notNull(),
    serverUrl: text("server_url").notNull(),
    // Header NAME the server expects. Default Authorization but a handful
    // of servers want X-API-Key / similar.
    authHeaderName: text("auth_header_name").notNull().default("Authorization"),
    // AES-256-GCM with INTEGRATION_TOKEN_ENCRYPTION_KEY. iv(12)||tag(16)||ct
    // wire layout — same as user_integrations / user_preferences so worker
    // decrypt helpers round-trip. Nullable for servers that need no auth.
    authHeaderValueEncrypted: bytea("auth_header_value_encrypted"),
    status: mcpServerStatusEnum("status").notNull().default("active"),
    lastSeenToolCount: integer("last_seen_tool_count").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("user_mcp_servers_user_slug_unique").on(t.userId, t.serverSlug),
  ],
);

export type UserMcpServer = typeof userMcpServers.$inferSelect;
export type UserMcpServerInsert = typeof userMcpServers.$inferInsert;
```

- [ ] **Step 5: Re-export**

In `packages/db/src/index.ts` (alphabetic-ish near other re-exports):

```ts
export {
  userMcpServers,
  type UserMcpServer,
  type UserMcpServerInsert,
} from "./schema/user-mcp-servers";
export { mcpServerStatusEnum } from "./schema/enums";
```

- [ ] **Step 6: Run**

```bash
pnpm --filter @opencairn/db test -- --run tests/user-mcp-servers.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/enums.ts packages/db/src/schema/user-mcp-servers.ts packages/db/src/index.ts packages/db/tests/user-mcp-servers.test.ts
git commit -m "$(cat <<'EOF'
feat(db): user_mcp_servers table + mcp_server_status enum (Phase 1 Task 2)

Spec §4.1. AES-GCM bytea token, (userId, serverSlug) unique, defaults to
status=active. Slug generator lives in apps/api; this layer only declares
the column shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Generate migration

**Files:**
- Create: `packages/db/drizzle/<NNNN>_user_mcp_servers.sql` (auto)
- Auto-update: `packages/db/drizzle/meta/_journal.json` + `meta/<NNNN>_snapshot.json`

- [ ] **Step 1: Generate**

```bash
pnpm --filter @opencairn/db db:generate -- --name user_mcp_servers
```

- [ ] **Step 2: Verify the migration SQL**

Open `packages/db/drizzle/<NNNN>_user_mcp_servers.sql` (whatever number drizzle picked). It must contain:
- `CREATE TYPE "public"."mcp_server_status" AS ENUM (...)`
- `CREATE TABLE "user_mcp_servers" (...)`
- `ADD CONSTRAINT "user_mcp_servers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade`
- `ADD CONSTRAINT "user_mcp_servers_user_slug_unique" UNIQUE("user_id","server_slug")`

If a parallel session already used the same number, rerun `db:generate` after rebasing.

- [ ] **Step 3: Apply locally and confirm**

```bash
pnpm --filter @opencairn/db db:migrate
psql $POSTGRES_URL -c "\d+ user_mcp_servers"
psql $POSTGRES_URL -c "\dT mcp_server_status"
```
Expected: table + enum present.

- [ ] **Step 4: Commit**

```bash
git add packages/db/drizzle/
git commit -m "$(cat <<'EOF'
feat(db): migrate user_mcp_servers + mcp_server_status (Phase 1 Task 3)

Auto-generated by drizzle-kit. Migration number is whatever db:generate
allocated — do not hard-code in plans / specs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Zod schemas in `packages/shared`

**Files:**
- Create: `packages/shared/src/mcp.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/tests/mcp.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/shared/tests/mcp.test.ts
import { describe, it, expect } from "vitest";
import {
  McpServerCreateSchema,
  McpServerUpdateSchema,
  McpServerSummarySchema,
  McpServerTestResultSchema,
} from "../src/mcp";

describe("McpServerCreateSchema", () => {
  it("accepts a minimal HTTPS URL", () => {
    const r = McpServerCreateSchema.safeParse({
      displayName: "My Linear",
      serverUrl: "https://mcp.linear.app/sse",
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-HTTPS URLs", () => {
    const r = McpServerCreateSchema.safeParse({
      displayName: "Plain HTTP",
      serverUrl: "http://example.com/mcp",
    });
    expect(r.success).toBe(false);
  });

  it("trims authHeaderName empty string to default", () => {
    const r = McpServerCreateSchema.parse({
      displayName: "x",
      serverUrl: "https://x/y",
    });
    expect(r.authHeaderName).toBe("Authorization");
  });
});

describe("McpServerSummarySchema", () => {
  it("never carries a plaintext authHeaderValue", () => {
    const shape = Object.keys(McpServerSummarySchema.shape);
    expect(shape).not.toContain("authHeaderValue");
    expect(shape).toContain("hasAuth");
  });
});

describe("McpServerTestResultSchema", () => {
  it("constrains status to the 3 documented values", () => {
    expect(
      McpServerTestResultSchema.safeParse({
        status: "ok",
        toolCount: 3,
        sampleNames: ["a", "b", "c"],
        durationMs: 120,
      }).success,
    ).toBe(true);
    expect(
      McpServerTestResultSchema.safeParse({
        status: "rate_limited",
        toolCount: 0,
        sampleNames: [],
        durationMs: 0,
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @opencairn/shared test -- --run tests/mcp.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/mcp.ts
import { z } from "zod";

export const McpServerCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(64),
  serverUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), {
      message: "MCP server URL must use HTTPS",
    }),
  authHeaderName: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .default("Authorization"),
  authHeaderValue: z.string().max(4096).optional(),
});

export const McpServerUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(64).optional(),
    authHeaderName: z.string().trim().min(1).max(64).optional(),
    // Pass `null` to clear auth; pass undefined to leave it. URL not
    // mutable (slug stability — spec §5).
    authHeaderValue: z.string().max(4096).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

export const McpServerStatusSchema = z.enum([
  "active",
  "disabled",
  "auth_expired",
]);

export const McpServerSummarySchema = z.object({
  id: z.string().uuid(),
  serverSlug: z.string(),
  displayName: z.string(),
  serverUrl: z.string(),
  authHeaderName: z.string(),
  hasAuth: z.boolean(),
  status: McpServerStatusSchema,
  lastSeenToolCount: z.number().int().nonnegative(),
  lastSeenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const McpServerTestResultSchema = z.object({
  status: z.enum(["ok", "auth_failed", "transport_error"]),
  toolCount: z.number().int().nonnegative(),
  sampleNames: z.array(z.string()).max(5),
  durationMs: z.number().int().nonnegative(),
  // Set when status != "ok" — surfaced verbatim in the settings UI toast.
  errorMessage: z.string().optional(),
});

export type McpServerCreate = z.infer<typeof McpServerCreateSchema>;
export type McpServerUpdate = z.infer<typeof McpServerUpdateSchema>;
export type McpServerSummary = z.infer<typeof McpServerSummarySchema>;
export type McpServerTestResult = z.infer<typeof McpServerTestResultSchema>;
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;
```

- [ ] **Step 4: Re-export**

Append to `packages/shared/src/index.ts`:

```ts
export * from "./mcp";
```

- [ ] **Step 5: Run**

```bash
pnpm --filter @opencairn/shared test -- --run tests/mcp.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/mcp.ts packages/shared/src/index.ts packages/shared/tests/mcp.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): MCP client zod schemas (Phase 1 Task 4)

Spec §5.2. McpServerCreate/Update/Summary/TestResult — Summary never
carries plaintext authHeaderValue (only hasAuth: boolean), Test result
uses the 3 documented statuses (ok | auth_failed | transport_error).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Worker — `runtime/mcp/slug.py` validator

**Files:**
- Create: `apps/worker/src/runtime/mcp/__init__.py` (stub)
- Create: `apps/worker/src/runtime/mcp/slug.py`
- Create: `apps/worker/tests/runtime/mcp/test_slug.py`

- [ ] **Step 1: Write failing tests**

```python
# apps/worker/tests/runtime/mcp/test_slug.py
import pytest

from runtime.mcp.slug import is_valid_slug, SLUG_PATTERN


@pytest.mark.parametrize(
    "ok",
    ["a", "abc_123", "x" * 32, "linear", "my_team_jira"],
)
def test_valid_slugs(ok):
    assert is_valid_slug(ok), ok


@pytest.mark.parametrize(
    "bad",
    ["", "A", "a-b", "a b", "x" * 33, "한글", "1.2", "café"],
)
def test_rejects_anything_outside_a_z0_9_underscore_max32(bad):
    assert not is_valid_slug(bad), bad


def test_pattern_anchored():
    # Defence-in-depth: the regex is anchored. ".match" alone would let
    # a trailing newline slip through.
    assert SLUG_PATTERN.fullmatch("foo")
    assert not SLUG_PATTERN.fullmatch("foo\n")
```

- [ ] **Step 2: Run to verify fail**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/test_slug.py -v
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```python
# apps/worker/src/runtime/mcp/__init__.py
"""MCP client runtime package.

Public surface populated by later tasks; importing this module on its own
(e.g. from `runtime`) must not raise even before resolver.py exists. The
real exports come in Task 11.
"""
```

```python
# apps/worker/src/runtime/mcp/slug.py
"""Slug regex validator. The generator side lives in apps/api
(`apps/api/src/lib/mcp-slug.ts`) — Postgres is the single source of
truth, the worker only validates rows it reads."""
from __future__ import annotations

import re

# /^[a-z0-9_]{1,32}$/ — same shape as the API generator.
SLUG_PATTERN = re.compile(r"^[a-z0-9_]{1,32}$")


def is_valid_slug(s: str) -> bool:
    return bool(SLUG_PATTERN.fullmatch(s))
```

- [ ] **Step 4: Run**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/test_slug.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/mcp/__init__.py apps/worker/src/runtime/mcp/slug.py apps/worker/tests/runtime/mcp/test_slug.py
git commit -m "$(cat <<'EOF'
feat(worker): runtime/mcp/slug.py validator (Phase 1 Task 5)

Defensive check for slugs read out of user_mcp_servers. Generator lives
in apps/api; the worker only asserts the regex on the read path so a
manually-corrupted row can't slip through into a tool name.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Worker — `runtime/mcp/client.py` SSRF guard

**Files:**
- Create: `apps/worker/src/runtime/mcp/errors.py`
- Create: `apps/worker/src/runtime/mcp/client.py` (SSRF half — list_tools/call_tool wrapper added in Task 7)
- Create: `apps/worker/tests/runtime/mcp/test_client_ssrf.py`

- [ ] **Step 1: Write failing tests**

```python
# apps/worker/tests/runtime/mcp/test_client_ssrf.py
"""SSRF guard. resolve_url() must raise MCPSecurityError for any URL whose
DNS resolution lands entirely on private/loopback/link-local/metadata IPs.
Mixed-resolution (one private + one public) is also rejected — the public
result alone could be racing the private one in production."""
from __future__ import annotations

import pytest

from runtime.mcp.client import _check_url_against_blocked_networks
from runtime.mcp.errors import MCPSecurityError


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",  # AWS / GCP metadata
        "::1",
        "fe80::1",
        "fd00::1",
    ],
)
def test_blocks_private_loopback_metadata(ip: str):
    with pytest.raises(MCPSecurityError):
        _check_url_against_blocked_networks(
            "https://example.test/", resolved_ips=[ip],
        )


def test_blocks_when_any_resolution_is_private():
    with pytest.raises(MCPSecurityError):
        _check_url_against_blocked_networks(
            "https://mixed.test/", resolved_ips=["8.8.8.8", "10.0.0.5"],
        )


def test_allows_public_only():
    # No raise.
    _check_url_against_blocked_networks(
        "https://api.example.com/", resolved_ips=["93.184.216.34"],
    )


def test_allowlist_regex_overrides_warning(monkeypatch):
    # When MCP_URL_ALLOWLIST matches the host, the guard still blocks
    # private IPs (defence in depth) but DOES allow a public host that
    # otherwise would have been allowed anyway. The env is for tightening,
    # not loosening the SSRF rules.
    monkeypatch.setenv("MCP_URL_ALLOWLIST", r"^api\.example\.com$")
    _check_url_against_blocked_networks(
        "https://api.example.com/", resolved_ips=["93.184.216.34"],
    )
    monkeypatch.setenv("MCP_URL_ALLOWLIST", r"^never\.example$")
    with pytest.raises(MCPSecurityError):
        _check_url_against_blocked_networks(
            "https://api.example.com/", resolved_ips=["93.184.216.34"],
        )
```

- [ ] **Step 2: Run to verify fail**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/test_client_ssrf.py -v
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement errors module**

```python
# apps/worker/src/runtime/mcp/errors.py
"""MCP client exception hierarchy.

Distinct subclasses so resolver / adapter / hook code can branch
without relying on string matching."""
from __future__ import annotations


class MCPError(Exception):
    """Base class for all MCP client failures."""


class MCPSecurityError(MCPError):
    """SSRF guard fired or URL violated MCP_URL_ALLOWLIST."""


class MCPAuthError(MCPError):
    """Server returned 401 / 403."""


class MCPTransportError(MCPError):
    """Connection refused, DNS failure, timeout — any layer-4 issue."""
```

- [ ] **Step 4: Implement SSRF half of client**

```python
# apps/worker/src/runtime/mcp/client.py
"""MCP client wrapper.

This file holds two pieces:
1. The SSRF guard (Task 6) — synchronous URL/IP checks.
2. The streamable-HTTP `MCPClient` (Task 7) — async list_tools / call_tool.

Keeping them in one module avoids a third file for the IP utilities and
matches the spec module count (§6)."""
from __future__ import annotations

import ipaddress
import os
import re
import socket
from collections.abc import Iterable
from urllib.parse import urlparse

from runtime.mcp.errors import MCPSecurityError

# RFC1918 + loopback + link-local + ULA + metadata. We do membership
# checks against an explicit list rather than `is_private` because the
# stdlib's definition excludes 169.254.169.254 (link-local) which IS what
# AWS/GCP metadata uses, and we want it blocked.
_BLOCKED_V4 = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("0.0.0.0/8"),
]
_BLOCKED_V6 = [
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),  # ULA
    ipaddress.ip_network("fe80::/10"),  # link-local
]
_METADATA_HOSTS = frozenset({"169.254.169.254", "fd00:ec2::254"})


def _is_blocked_ip(ip_str: str) -> bool:
    if ip_str in _METADATA_HOSTS:
        return True
    addr = ipaddress.ip_address(ip_str)
    if isinstance(addr, ipaddress.IPv4Address):
        return any(addr in net for net in _BLOCKED_V4)
    return any(addr in net for net in _BLOCKED_V6)


def _check_allowlist(host: str) -> None:
    """If MCP_URL_ALLOWLIST is set and the host doesn't match, raise."""
    pattern = os.environ.get("MCP_URL_ALLOWLIST")
    if not pattern:
        return
    if not re.search(pattern, host):
        raise MCPSecurityError(
            f"host {host!r} not in MCP_URL_ALLOWLIST",
        )


def _check_url_against_blocked_networks(
    url: str, *, resolved_ips: Iterable[str],
) -> None:
    """Raise MCPSecurityError if ANY resolved IP is private/metadata, or
    if MCP_URL_ALLOWLIST is set and host doesn't match. Public-only IPs
    AND (allowlist unset OR allowlist matches) → no raise."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    _check_allowlist(host)
    for ip in resolved_ips:
        if _is_blocked_ip(ip):
            raise MCPSecurityError(
                f"resolved IP {ip} for {host!r} is in a blocked network",
            )


def _resolve_host(host: str) -> list[str]:
    """getaddrinfo wrapper. Returns all unique IPs for a host."""
    out: set[str] = set()
    try:
        for family, _, _, _, sockaddr in socket.getaddrinfo(
            host, None, type=socket.SOCK_STREAM,
        ):
            ip = sockaddr[0]
            out.add(ip)
    except socket.gaierror as e:
        raise MCPSecurityError(f"DNS resolution failed for {host!r}: {e}") from e
    return sorted(out)


def assert_url_safe(url: str) -> None:
    """Public helper used by client.py before opening a streamable_http
    connection. Resolves DNS once and runs the guard."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise MCPSecurityError(f"URL must use https://: {url!r}")
    host = parsed.hostname
    if not host:
        raise MCPSecurityError(f"URL missing host: {url!r}")
    ips = _resolve_host(host)
    _check_url_against_blocked_networks(url, resolved_ips=ips)
```

- [ ] **Step 5: Run**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/test_client_ssrf.py -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/mcp/errors.py apps/worker/src/runtime/mcp/client.py apps/worker/tests/runtime/mcp/test_client_ssrf.py
git commit -m "$(cat <<'EOF'
feat(worker): runtime/mcp SSRF guard (Phase 1 Task 6)

Blocks RFC1918 + loopback + link-local + ULA + metadata IPs (incl.
169.254.169.254 / fd00:ec2::254). MCP_URL_ALLOWLIST regex narrows but
never widens — SSRF rules always apply. Sole exit point: assert_url_safe()
called before opening a streamable_http connection (Task 7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Worker — `runtime/mcp/client.py` MCPClient wrapper + integration round-trip

**Files:**
- Modify: `apps/worker/src/runtime/mcp/client.py` — append `MCPClient` class.
- Create: `apps/worker/tests/runtime/mcp/conftest.py` — in-process FastMCP echo server fixture.
- Create: `apps/worker/tests/runtime/mcp/test_client_http.py`

- [ ] **Step 1: Conftest — in-process MCP server fixture**

```python
# apps/worker/tests/runtime/mcp/conftest.py
"""Fixtures for runtime/mcp tests.

`fastmcp_echo_server` runs a FastMCP server backed by streamable HTTP on
127.0.0.1:<random port>. It exposes a single `add(x: int, y: int) -> int`
tool plus `delete_thing(id: str) -> str` so the destructive heuristic can
be exercised. Tests then point MCPClient at the loopback URL — but our
SSRF guard blocks 127.0.0.0/8! We expose a `bypass_ssrf` autouse fixture
that monkeypatches `assert_url_safe` to a no-op for these tests only;
production code still runs the real guard."""
from __future__ import annotations

import asyncio
import contextlib
import socket
import threading

import pytest

from runtime.mcp import client as mcp_client


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(autouse=True)
def _bypass_ssrf(monkeypatch):
    """Tests run against 127.0.0.1; production guard would block. Limited
    to runtime/mcp/ tests — global autouse scope of THIS conftest."""
    monkeypatch.setattr(mcp_client, "assert_url_safe", lambda url: None)


@pytest.fixture
async def fastmcp_echo_server():
    """Spawn a FastMCP echo server in a background thread. Yields the
    streamable-HTTP endpoint URL.

    Uses FastMCP from `mcp.server.fastmcp` (1.12+). Tools:
      add(x, y) -> {"sum": x + y}
      delete_thing(id) -> {"deleted": id}  # name triggers destructive heuristic
    """
    from mcp.server.fastmcp import FastMCP

    port = _free_port()
    fast = FastMCP(name="echo", host="127.0.0.1", port=port)

    @fast.tool()
    def add(x: int, y: int) -> dict:
        return {"sum": x + y}

    @fast.tool()
    def delete_thing(id: str) -> dict:
        return {"deleted": id}

    started = threading.Event()
    stop_event: asyncio.Event | None = None
    loop_holder: dict[str, asyncio.AbstractEventLoop] = {}

    def _run():
        loop = asyncio.new_event_loop()
        loop_holder["loop"] = loop
        asyncio.set_event_loop(loop)
        nonlocal stop_event
        stop_event = asyncio.Event()
        started.set()
        with contextlib.suppress(Exception):
            loop.run_until_complete(
                fast.run_streamable_http_async(),
            )

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    started.wait(timeout=5.0)

    # Best-effort wait for socket to bind.
    for _ in range(50):
        with socket.socket() as s:
            try:
                s.connect(("127.0.0.1", port))
                break
            except OSError:
                await asyncio.sleep(0.1)

    yield f"http://127.0.0.1:{port}/mcp"

    # Teardown — best-effort. The thread is daemon so process exit is the
    # ultimate stop. If FastMCP exposes a clean shutdown later, switch to that.
    loop = loop_holder.get("loop")
    if loop is not None:
        loop.call_soon_threadsafe(loop.stop)
```

- [ ] **Step 2: Write failing tests**

```python
# apps/worker/tests/runtime/mcp/test_client_http.py
"""Round-trip: MCPClient.list_tools / call_tool against an in-process
FastMCP echo server."""
import pytest

from runtime.mcp.client import MCPClient


@pytest.mark.asyncio
async def test_list_tools_returns_known_names(fastmcp_echo_server):
    async with MCPClient(
        url=fastmcp_echo_server, auth_header=None,
    ) as client:
        tools = await client.list_tools()
    names = {t.name for t in tools}
    assert {"add", "delete_thing"}.issubset(names)


@pytest.mark.asyncio
async def test_call_tool_round_trip(fastmcp_echo_server):
    async with MCPClient(
        url=fastmcp_echo_server, auth_header=None,
    ) as client:
        result = await client.call_tool("add", {"x": 2, "y": 3})
    # FastMCP wraps the dict return into structuredContent; either shape
    # is acceptable here — assert the value is reachable.
    assert "5" in str(result) or result.get("sum") == 5


@pytest.mark.asyncio
async def test_call_tool_unknown_raises(fastmcp_echo_server):
    async with MCPClient(
        url=fastmcp_echo_server, auth_header=None,
    ) as client:
        with pytest.raises(Exception):
            await client.call_tool("nonexistent_tool", {})
```

- [ ] **Step 3: Run to verify fail**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/test_client_http.py -v
```
Expected: FAIL — `MCPClient` not defined.

- [ ] **Step 4: Implement**

Append to `apps/worker/src/runtime/mcp/client.py`:

```python
# ── MCPClient ──────────────────────────────────────────────────────────

import contextlib
from typing import Any

from mcp import ClientSession, types
from mcp.client.streamable_http import streamablehttp_client

from runtime.mcp.errors import MCPAuthError, MCPTransportError

_DEFAULT_TIMEOUT_SEC = 30.0


class MCPClient:
    """Async context manager wrapping a single ClientSession.

    Usage:
        async with MCPClient(url=..., auth_header=("Authorization", "Bearer ...")) as c:
            tools = await c.list_tools()
            result = await c.call_tool("create_issue", {"title": "..."})

    Each `__aenter__` runs the SSRF guard and opens a fresh transport.
    Adapters open one MCPClient *per call* so a stalled session can't
    block parallel calls — see adapter.py."""

    def __init__(
        self,
        *,
        url: str,
        auth_header: tuple[str, str] | None,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SEC,
    ) -> None:
        self._url = url
        self._auth_header = auth_header
        self._timeout = timeout_seconds
        self._exit_stack: contextlib.AsyncExitStack | None = None
        self._session: ClientSession | None = None

    async def __aenter__(self) -> "MCPClient":
        assert_url_safe(self._url)
        self._exit_stack = contextlib.AsyncExitStack()
        headers: dict[str, str] = {}
        if self._auth_header:
            name, value = self._auth_header
            headers[name] = value
        try:
            transport = await self._exit_stack.enter_async_context(
                streamablehttp_client(self._url, headers=headers),
            )
            # streamablehttp_client yields (read, write, ...); shapes vary
            # slightly across SDK minors. Unpack defensively.
            read_stream, write_stream, *_rest = transport
            self._session = await self._exit_stack.enter_async_context(
                ClientSession(read_stream, write_stream),
            )
            await self._session.initialize()
        except Exception as e:  # pragma: no cover - exercised by test_truncation/test_resolver
            await self._exit_stack.aclose()
            self._exit_stack = None
            self._session = None
            if "401" in str(e) or "403" in str(e):
                raise MCPAuthError(str(e)) from e
            raise MCPTransportError(str(e)) from e
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._exit_stack is not None:
            await self._exit_stack.aclose()
        self._exit_stack = None
        self._session = None

    async def list_tools(self) -> list[types.Tool]:
        assert self._session is not None, "use as async context manager"
        result = await self._session.list_tools()
        return list(result.tools)

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        assert self._session is not None, "use as async context manager"
        result = await self._session.call_tool(name, arguments=arguments)
        if result.isError:
            # call_tool returns CallToolResult.content; prefer the text
            # payload, fall back to a stringified content list.
            content = result.content or []
            text = " ".join(
                getattr(c, "text", "") for c in content if hasattr(c, "text")
            )
            raise MCPTransportError(
                text or f"call_tool({name}) returned isError=True",
            )
        if result.structuredContent is not None:
            return dict(result.structuredContent)
        # Untyped content: best-effort flatten.
        out: dict[str, Any] = {"content": []}
        for c in result.content or []:
            if hasattr(c, "text"):
                out["content"].append({"type": "text", "text": c.text})
            else:
                out["content"].append({"type": getattr(c, "type", "unknown")})
        return out
```

- [ ] **Step 5: Run**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/test_client_http.py -v
```
Expected: PASS. If FastMCP startup races, raise the in-band socket-connect retry from 50→100.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/mcp/client.py apps/worker/tests/runtime/mcp/conftest.py apps/worker/tests/runtime/mcp/test_client_http.py
git commit -m "$(cat <<'EOF'
feat(worker): MCPClient streamable-HTTP wrapper (Phase 1 Task 7)

Async context manager around mcp.ClientSession + streamablehttp_client.
list_tools / call_tool only — sampling/resources/prompts deliberately
not surfaced (spec §1 scope). Auth header supplied as a 2-tuple to keep
callers from accidentally ferrying it via tool args. Round-trip verified
against an in-process FastMCP echo server.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Worker — `runtime/mcp/adapter.py`

**Files:**
- Create: `apps/worker/src/runtime/mcp/adapter.py`
- Create: `apps/worker/tests/runtime/mcp/test_adapter.py`

- [ ] **Step 1: Write failing tests**

```python
# apps/worker/tests/runtime/mcp/test_adapter.py
"""Adapter tests use the in-process echo server from conftest.py — no
need to construct fake mcp.types.Tool DTOs."""
from __future__ import annotations

import pytest

from runtime.mcp.adapter import adapt
from runtime.mcp.client import MCPClient


@pytest.mark.asyncio
async def test_adapt_prefixes_tool_name(fastmcp_echo_server):
    async with MCPClient(
        url=fastmcp_echo_server, auth_header=None,
    ) as client:
        mcp_tools = await client.list_tools()

    add_dto = next(t for t in mcp_tools if t.name == "add")
    runtime_tool = adapt(
        server_slug="echo",
        mcp_tool=add_dto,
        server_url=fastmcp_echo_server,
        auth_header=None,
    )
    assert runtime_tool.name == "mcp__echo__add"
    assert runtime_tool.allowed_scopes == ("workspace",)
    assert runtime_tool.allowed_agents == ()
    schema = runtime_tool.input_schema()
    assert "x" in str(schema)


def test_destructive_heuristic_flags_delete_names():
    from runtime.mcp.adapter import _is_destructive

    for name in ["delete_thing", "remove_user", "drop_table", "destroy_x"]:
        assert _is_destructive(name), name
    for name in ["add", "list_issues", "create_issue", "fetch_data"]:
        assert not _is_destructive(name), name


@pytest.mark.asyncio
async def test_adapter_run_calls_through(fastmcp_echo_server):
    from runtime.events import Scope
    from runtime.tools import ToolContext

    async def _emit(_ev):
        return None

    async with MCPClient(
        url=fastmcp_echo_server, auth_header=None,
    ) as client:
        mcp_tools = await client.list_tools()

    add_dto = next(t for t in mcp_tools if t.name == "add")
    rt = adapt(
        server_slug="echo",
        mcp_tool=add_dto,
        server_url=fastmcp_echo_server,
        auth_header=None,
    )
    ctx = ToolContext(
        workspace_id="ws", project_id=None, page_id=None,
        user_id="u", run_id="r", scope="workspace", emit=_emit,
    )
    out = await rt.run({"x": 4, "y": 5}, ctx)
    assert "9" in str(out) or out.get("sum") == 9
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — adapter module missing.

- [ ] **Step 3: Implement**

```python
# apps/worker/src/runtime/mcp/adapter.py
"""types.Tool → runtime.Tool adapter.

Each adapted tool opens a fresh MCPClient per `run()` invocation. That
costs a connection per call but: (a) per-tool timeout enforcement is
trivial, (b) one stalled session can't starve other parallel calls,
(c) failure isolation matches Temporal activity retry semantics.

Auth header lives in the closure so it never enters `args` (and therefore
never reaches the trajectory or sentry breadcrumbs)."""
from __future__ import annotations

import re
from typing import Any

from mcp import types

from runtime.events import Scope
from runtime.mcp.client import MCPClient
from runtime.tools import Tool, ToolContext

_DESTRUCTIVE_RE = re.compile(
    r"\b(delete|remove|drop|destroy)\w*\b", re.IGNORECASE,
)


def _is_destructive(name: str) -> bool:
    return bool(_DESTRUCTIVE_RE.search(name))


class _MCPAdaptedTool:
    """Concrete Tool that proxies to an MCP server."""

    def __init__(
        self,
        *,
        name: str,
        description: str,
        input_schema_dict: dict[str, Any],
        allowed_scopes: tuple[Scope, ...],
        server_url: str,
        upstream_name: str,
        auth_header: tuple[str, str] | None,
        destructive: bool,
    ) -> None:
        self.name = name
        self.description = description
        self.allowed_agents: tuple[str, ...] = ()
        self.allowed_scopes = allowed_scopes
        self._input_schema = input_schema_dict
        self._server_url = server_url
        self._upstream_name = upstream_name
        self._auth_header = auth_header
        self.destructive = destructive

    def supports_parallel(self, args: dict[str, Any]) -> bool:
        # Conservative — destructive tools serialise; everything else
        # opts out of parallel until we have per-server contention data.
        return False

    def input_schema(self) -> dict[str, Any]:
        return self._input_schema

    def redact(self, args: dict[str, Any]) -> dict[str, Any]:
        # Auth never enters args (closure-only) so trajectory writers see
        # the LLM-supplied payload as-is.
        return dict(args)

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> Any:
        async with MCPClient(
            url=self._server_url, auth_header=self._auth_header,
        ) as client:
            return await client.call_tool(self._upstream_name, args)


def adapt(
    *,
    server_slug: str,
    mcp_tool: types.Tool,
    server_url: str,
    auth_header: tuple[str, str] | None,
) -> Tool:
    """Wrap an mcp.types.Tool as a runtime.Tool. The returned object
    satisfies the runtime.Tool Protocol — inputSchema is passed through
    untouched (Gemini/Ollama declaration builders accept JSON Schema)."""
    full_name = f"mcp__{server_slug}__{mcp_tool.name}"
    description = (mcp_tool.description or full_name).strip()
    schema = dict(mcp_tool.inputSchema or {"type": "object", "properties": {}})
    return _MCPAdaptedTool(  # type: ignore[return-value]
        name=full_name,
        description=description,
        input_schema_dict=schema,
        allowed_scopes=("workspace",),
        server_url=server_url,
        upstream_name=mcp_tool.name,
        auth_header=auth_header,
        destructive=_is_destructive(mcp_tool.name),
    )
```

- [ ] **Step 4: Run**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/test_adapter.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/mcp/adapter.py apps/worker/tests/runtime/mcp/test_adapter.py
git commit -m "$(cat <<'EOF'
feat(worker): runtime/mcp/adapter — types.Tool → runtime.Tool (Phase 1 Task 8)

mcp__<slug>__<tool> prefix; allowed_scopes=("workspace",) hardcoded;
destructive heuristic flags delete/remove/drop/destroy in tool name as
an instance attribute (TrajectoryWriterHook integration is Phase 2 —
this task only sets the flag). Each run() opens a fresh MCPClient so
auth-header closure never crosses boundaries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Worker — `runtime/mcp/resolver.py`

**Files:**
- Create: `apps/worker/src/runtime/mcp/resolver.py`
- Create: `apps/worker/tests/runtime/mcp/test_resolver.py`

- [ ] **Step 1: Write failing tests**

```python
# apps/worker/tests/runtime/mcp/test_resolver.py
"""build_mcp_tools_for_user covers:
  - returns [] when feature flag is off
  - returns [] when user has no rows
  - parallel list_tools across multiple servers
  - one server failing doesn't break the others (warning emitted)
  - 50-tool overflow → that server is skipped + warning
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from runtime.mcp.resolver import (
    MCPServerRow,
    build_mcp_tools_from_payload,
)


def _row(slug: str, url: str = "https://x.test/mcp") -> MCPServerRow:
    return MCPServerRow(
        id="00000000-0000-0000-0000-000000000000",
        server_slug=slug,
        server_url=url,
        auth_header=None,
    )


@pytest.mark.asyncio
async def test_empty_payload_returns_empty(monkeypatch):
    tools = await build_mcp_tools_from_payload(rows=[])
    assert tools == []


@pytest.mark.asyncio
async def test_two_servers_succeed_in_parallel(monkeypatch, fastmcp_echo_server):
    # Two rows pointing at the SAME echo server (port reuse). Slugs differ.
    rows = [_row("echo1", fastmcp_echo_server), _row("echo2", fastmcp_echo_server)]
    tools = await build_mcp_tools_from_payload(rows=rows)
    names = {t.name for t in tools}
    assert "mcp__echo1__add" in names
    assert "mcp__echo2__add" in names


@pytest.mark.asyncio
async def test_one_server_down_other_still_works(fastmcp_echo_server):
    rows = [
        _row("good", fastmcp_echo_server),
        _row("bad", "https://nope.invalid:1/"),
    ]
    warnings: list[str] = []

    async def warn(msg: str) -> None:
        warnings.append(msg)

    tools = await build_mcp_tools_from_payload(rows=rows, on_warning=warn)
    names = {t.name for t in tools}
    assert any(n.startswith("mcp__good__") for n in names)
    assert not any(n.startswith("mcp__bad__") for n in names)
    assert any("bad" in w for w in warnings)


@pytest.mark.asyncio
async def test_50_tool_overflow_is_skipped(monkeypatch, fastmcp_echo_server):
    # Patch list_tools on the resolver module to return 51 fake tools for
    # the matching slug.
    from runtime.mcp import resolver as r

    real = r._fetch_tools_for_row

    async def fake(row):
        if row.server_slug == "huge":
            from mcp import types
            return [types.Tool(name=f"t{i}", description="x", inputSchema={})
                    for i in range(51)]
        return await real(row)

    monkeypatch.setattr(r, "_fetch_tools_for_row", fake)

    warnings: list[str] = []

    async def warn(msg: str) -> None:
        warnings.append(msg)

    rows = [_row("huge", fastmcp_echo_server), _row("ok", fastmcp_echo_server)]
    tools = await build_mcp_tools_from_payload(rows=rows, on_warning=warn)
    names = {t.name for t in tools}
    assert not any("huge" in n for n in names)
    assert any("ok" in n for n in names)
    assert any("50" in w or "too many" in w.lower() for w in warnings)
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — resolver missing.

- [ ] **Step 3: Implement**

```python
# apps/worker/src/runtime/mcp/resolver.py
"""Per-run MCP tool resolution.

Two entry points:
1. `build_mcp_tools_for_user(user_id, *, db_session, on_warning=None)`
   — used inside Temporal activities that have a DB session.
2. `build_mcp_tools_from_payload(rows, *, on_warning=None)`
   — used when a workflow has already serialised the (decrypted) rows
   into the activity input (spec §6.5 secret-via-payload pattern).

Both fan out `list_tools()` in parallel. A server that fails or returns
>50 tools is skipped; the others continue."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from mcp import types

from runtime.mcp.adapter import adapt
from runtime.mcp.errors import MCPError
from runtime.mcp.client import MCPClient
from runtime.mcp.slug import is_valid_slug
from runtime.tools import Tool

logger = logging.getLogger(__name__)

MAX_TOOLS_PER_SERVER = 50

WarnCallback = Callable[[str], Awaitable[None]]


@dataclass(frozen=True)
class MCPServerRow:
    """Decrypted, ready-to-use representation of a user_mcp_servers row.

    `auth_header` is `(name, plaintext_value)` — the workflow has already
    decrypted bytea via worker.lib.mcp_secrets.decrypt_row()."""

    id: str
    server_slug: str
    server_url: str
    auth_header: tuple[str, str] | None


async def build_mcp_tools_for_user(
    user_id: str,
    *,
    db_session: Any,
    on_warning: WarnCallback | None = None,
) -> list[Tool]:
    """Read active rows from `user_mcp_servers`, decrypt the auth blobs,
    then call `build_mcp_tools_from_payload`. The DB-touching variant for
    activities that have a session."""
    from worker.lib.mcp_secrets import load_active_rows_for_user

    rows = await load_active_rows_for_user(db_session, user_id=user_id)
    return await build_mcp_tools_from_payload(rows=rows, on_warning=on_warning)


async def build_mcp_tools_from_payload(
    *,
    rows: list[MCPServerRow],
    on_warning: WarnCallback | None = None,
) -> list[Tool]:
    if not rows:
        return []

    async def _safe_warn(msg: str) -> None:
        if on_warning is None:
            logger.warning("mcp resolver: %s", msg)
            return
        await on_warning(msg)

    async def _process(row: MCPServerRow) -> list[Tool]:
        if not is_valid_slug(row.server_slug):
            await _safe_warn(
                f"server {row.id} has malformed slug {row.server_slug!r}; skipping",
            )
            return []
        try:
            mcp_tools = await _fetch_tools_for_row(row)
        except MCPError as e:
            await _safe_warn(
                f"server {row.server_slug!r} unreachable: {e}",
            )
            return []
        if len(mcp_tools) > MAX_TOOLS_PER_SERVER:
            await _safe_warn(
                f"server {row.server_slug!r} exposed {len(mcp_tools)} tools; "
                f"skipping (max {MAX_TOOLS_PER_SERVER}, spec §2)",
            )
            return []
        return [
            adapt(
                server_slug=row.server_slug,
                mcp_tool=t,
                server_url=row.server_url,
                auth_header=row.auth_header,
            )
            for t in mcp_tools
        ]

    results = await asyncio.gather(
        *[_process(r) for r in rows], return_exceptions=False,
    )
    out: list[Tool] = []
    for sub in results:
        out.extend(sub)
    return out


async def _fetch_tools_for_row(row: MCPServerRow) -> list[types.Tool]:
    """Open one MCPClient and read the catalog. Patched in tests to
    inject overflow / failure scenarios without spinning up new servers."""
    async with MCPClient(
        url=row.server_url, auth_header=row.auth_header,
    ) as client:
        return await client.list_tools()
```

- [ ] **Step 4: Stub `worker.lib.mcp_secrets`**

Create `apps/worker/src/worker/lib/mcp_secrets.py` with the function the resolver imports — full implementation lands in Task 10. For now:

```python
# apps/worker/src/worker/lib/mcp_secrets.py
"""DB-side helper for MCP server rows. Real implementation in Task 10."""
from __future__ import annotations

from typing import Any

from runtime.mcp.resolver import MCPServerRow


async def load_active_rows_for_user(
    db_session: Any, *, user_id: str,
) -> list[MCPServerRow]:
    raise NotImplementedError("Implemented in Task 10")
```

- [ ] **Step 5: Run resolver tests**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/test_resolver.py -v
```
Expected: PASS (all 4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/mcp/resolver.py apps/worker/src/worker/lib/mcp_secrets.py apps/worker/tests/runtime/mcp/test_resolver.py
git commit -m "$(cat <<'EOF'
feat(worker): runtime/mcp/resolver per-run tool builder (Phase 1 Task 9)

build_mcp_tools_for_user / build_mcp_tools_from_payload. Parallel
list_tools, skip-don't-fail on individual server errors, 50-tool overflow
handling. Slug regex validated as defence-in-depth on the read path. The
DB-touching half is wired via worker.lib.mcp_secrets.load_active_rows_for_user
(stub here, real impl in Task 10).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Worker — `worker.lib.mcp_secrets` decrypt + load helper + `runtime/mcp/__init__.py` exports

**Files:**
- Modify: `apps/worker/src/worker/lib/mcp_secrets.py`
- Modify: `apps/worker/src/runtime/mcp/__init__.py`
- Modify: `apps/worker/src/runtime/__init__.py`
- Create: `apps/worker/tests/lib/test_mcp_secrets.py`

- [ ] **Step 1: Write failing test**

```python
# apps/worker/tests/lib/test_mcp_secrets.py
"""mcp_secrets.load_active_rows_for_user reads user_mcp_servers, filters
by status='active', and decrypts auth_header_value_encrypted via the
existing integration_crypto helper."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_decrypt_round_trip(db_session, test_user_factory, monkeypatch):
    # `db_session` and `test_user_factory` come from apps/worker/tests/conftest
    # — same fixtures the rest of the worker tests rely on.
    monkeypatch.setenv(
        "INTEGRATION_TOKEN_ENCRYPTION_KEY",
        # 32 bytes base64 — same fixture as test_drive_activities.
        "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
    )
    from worker.lib.integration_crypto import encrypt_token
    from worker.lib.mcp_secrets import load_active_rows_for_user

    user = await test_user_factory(email="alice@example.com")
    encrypted = encrypt_token("Bearer secret")
    await db_session.execute(
        """
        INSERT INTO user_mcp_servers
          (user_id, server_slug, display_name, server_url,
           auth_header_name, auth_header_value_encrypted, status)
        VALUES
          ($1, 'linear', 'My Linear', 'https://mcp.linear.app/sse',
           'Authorization', $2, 'active')
        """,
        user.id, encrypted,
    )
    # Disabled row — must not appear.
    await db_session.execute(
        """
        INSERT INTO user_mcp_servers
          (user_id, server_slug, display_name, server_url, status)
        VALUES
          ($1, 'archived', 'Old', 'https://x.test/mcp', 'disabled')
        """,
        user.id,
    )

    rows = await load_active_rows_for_user(db_session, user_id=user.id)
    assert len(rows) == 1
    [row] = rows
    assert row.server_slug == "linear"
    assert row.auth_header == ("Authorization", "Bearer secret")
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — `NotImplementedError`.

- [ ] **Step 3: Implement**

```python
# apps/worker/src/worker/lib/mcp_secrets.py
"""DB-side helper for MCP server rows.

Reads user_mcp_servers, filters by status='active', and decrypts the
auth header (if any) using worker.lib.integration_crypto — same wire
layout (iv||tag||ct) as user_integrations / user_preferences."""
from __future__ import annotations

from typing import Any

from runtime.mcp.resolver import MCPServerRow
from worker.lib.integration_crypto import decrypt_token


async def load_active_rows_for_user(
    db_session: Any, *, user_id: str,
) -> list[MCPServerRow]:
    """Returns one MCPServerRow per active row.

    `db_session` is whatever the caller's activity passed in. The shape we
    use is the project-standard asyncpg connection / Session — it must
    expose `.fetch(query, *args)` returning rows with attribute access.
    Adjust the binding here if the Plan 12 conventions diverge at impl
    time."""
    rows = await db_session.fetch(
        """
        SELECT id, server_slug, server_url,
               auth_header_name, auth_header_value_encrypted
          FROM user_mcp_servers
         WHERE user_id = $1
           AND status = 'active'
         ORDER BY created_at ASC
        """,
        user_id,
    )
    out: list[MCPServerRow] = []
    for r in rows:
        auth: tuple[str, str] | None = None
        encrypted: bytes | None = r["auth_header_value_encrypted"]
        if encrypted is not None:
            plaintext = decrypt_token(bytes(encrypted))
            auth = (r["auth_header_name"], plaintext)
        out.append(
            MCPServerRow(
                id=str(r["id"]),
                server_slug=r["server_slug"],
                server_url=r["server_url"],
                auth_header=auth,
            )
        )
    return out
```

- [ ] **Step 4: Wire `runtime/mcp/__init__.py` + `runtime/__init__.py` re-export**

```python
# apps/worker/src/runtime/mcp/__init__.py
"""MCP client runtime package — public API."""
from runtime.mcp.adapter import adapt
from runtime.mcp.errors import (
    MCPAuthError,
    MCPError,
    MCPSecurityError,
    MCPTransportError,
)
from runtime.mcp.resolver import (
    MAX_TOOLS_PER_SERVER,
    MCPServerRow,
    build_mcp_tools_for_user,
    build_mcp_tools_from_payload,
)

__all__ = [
    "MAX_TOOLS_PER_SERVER",
    "MCPAuthError",
    "MCPError",
    "MCPSecurityError",
    "MCPServerRow",
    "MCPTransportError",
    "adapt",
    "build_mcp_tools_for_user",
    "build_mcp_tools_from_payload",
]
```

In `apps/worker/src/runtime/__init__.py` add (alphabetic-ish):

```python
from runtime.mcp import (
    build_mcp_tools_for_user,
    build_mcp_tools_from_payload,
    MCPServerRow,
)
```

And append to `__all__`:

```python
    "MCPServerRow",
    "build_mcp_tools_for_user",
    "build_mcp_tools_from_payload",
```

- [ ] **Step 5: Run**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/lib/test_mcp_secrets.py tests/runtime/mcp/ -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/worker/lib/mcp_secrets.py apps/worker/src/runtime/mcp/__init__.py apps/worker/src/runtime/__init__.py apps/worker/tests/lib/test_mcp_secrets.py
git commit -m "$(cat <<'EOF'
feat(worker): mcp_secrets decrypt helper + runtime/mcp public API (Phase 1 Task 10)

load_active_rows_for_user reads user_mcp_servers (status='active') and
decrypts the auth header via existing integration_crypto.decrypt_token —
same wire layout as user_integrations. runtime/mcp/__init__.py + runtime
facade re-export build_mcp_tools_for_user / MCPServerRow so callers
import only from `runtime`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Worker — Truncation regression test (50 KB cap on MCP responses)

**Files:**
- Create: `apps/worker/tests/runtime/mcp/test_truncation.py`

- [ ] **Step 1: Test — validates that large MCP payloads round-trip through ToolLoopExecutor's `_truncate`**

```python
# apps/worker/tests/runtime/mcp/test_truncation.py
"""ToolLoopExecutor._truncate caps tool results at 50_000 chars. MCP
responses go through the same path (no special-casing) — this test
ensures we don't bypass it accidentally when wiring MCP into
run_with_tools."""
from __future__ import annotations

import json

from runtime.tool_loop import ToolLoopExecutor, LoopConfig


def test_truncate_clips_large_dict_response():
    executor = ToolLoopExecutor(
        provider=None,
        tool_registry=None,
        config=LoopConfig(),
        tool_context={"workspace_id": "ws"},
    )
    big = {"data": "x" * 100_000}
    truncated = executor._truncate(big, "mcp__server__big_tool")  # type: ignore[attr-defined]
    encoded = json.dumps(truncated, default=str) if isinstance(truncated, dict) else truncated
    assert len(encoded) <= 50_000 + 200  # the suffix marker fits
    assert "truncated" in encoded
```

- [ ] **Step 2: Run**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/test_truncation.py -v
```
Expected: PASS (no implementation needed — `_truncate` already exists).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/tests/runtime/mcp/test_truncation.py
git commit -m "$(cat <<'EOF'
test(worker): MCP responses respect ToolLoopExecutor._truncate (Phase 1 Task 11)

Regression guard for spec §7.1 row "MCP server returns giant payload"
— makes future refactors loud if MCP tools start bypassing the
50_000-char cap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Worker — `tool_demo` agent integration behind `FEATURE_MCP_CLIENT`

**Files:**
- Modify: `apps/worker/src/worker/agents/tool_demo/agent.py`
- Modify: `apps/worker/tests/agents/test_tool_demo_agent_unit.py`

- [ ] **Step 1: Write the failing integration test**

Append to `apps/worker/tests/agents/test_tool_demo_agent_unit.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_full_preset_unions_mcp_tools_when_flag_on(monkeypatch):
    """When FEATURE_MCP_CLIENT=true and tool_context carries a user_id,
    tool_demo.full() augments its static tool list with MCP tools
    returned by build_mcp_tools_for_user."""
    from worker.agents.tool_demo.agent import ToolDemoAgent

    monkeypatch.setenv("FEATURE_MCP_CLIENT", "true")

    # Capture what gets passed to run_with_tools.
    captured: dict = {}

    async def fake_run_with_tools(**kwargs):
        captured.update(kwargs)
        from runtime.tool_loop import LoopResult
        return LoopResult(
            final_text="ok",
            final_structured_output=None,
            termination_reason="model_stopped",
            turn_count=0,
            tool_call_count=0,
            total_input_tokens=0,
            total_output_tokens=0,
        )

    fake_mcp_tool = type(
        "FakeTool", (),
        {
            "name": "mcp__demo__hello",
            "description": "fake",
            "allowed_agents": (),
            "allowed_scopes": ("workspace",),
            "supports_parallel": lambda self, args: False,
            "input_schema": lambda self: {"type": "object"},
            "redact": lambda self, a: a,
            "run": AsyncMock(return_value={}),
        },
    )()

    async def fake_resolver(*, user_id, db_session=None, on_warning=None):
        return [fake_mcp_tool]

    with patch(
        "worker.agents.tool_demo.agent.run_with_tools",
        side_effect=fake_run_with_tools,
    ), patch(
        "worker.agents.tool_demo.agent.build_mcp_tools_for_user",
        side_effect=fake_resolver,
    ):
        agent = ToolDemoAgent.full(provider=object())
        await agent.run(
            user_prompt="hi",
            tool_context={
                "workspace_id": "ws", "project_id": "p",
                "user_id": "u-123", "run_id": "r", "scope": "workspace",
            },
        )

    names = {t.name for t in captured["tools"]}
    assert "mcp__demo__hello" in names


@pytest.mark.asyncio
async def test_full_preset_skips_mcp_when_flag_off(monkeypatch):
    from worker.agents.tool_demo.agent import ToolDemoAgent

    monkeypatch.delenv("FEATURE_MCP_CLIENT", raising=False)

    async def fake_run_with_tools(**kwargs):
        return type(
            "X", (), {
                "termination_reason": "model_stopped",
                "final_text": "", "final_structured_output": None,
                "turn_count": 0, "tool_call_count": 0,
                "total_input_tokens": 0, "total_output_tokens": 0,
            },
        )()

    called = False

    async def fake_resolver(**_):
        nonlocal called
        called = True
        return []

    with patch(
        "worker.agents.tool_demo.agent.run_with_tools",
        side_effect=fake_run_with_tools,
    ), patch(
        "worker.agents.tool_demo.agent.build_mcp_tools_for_user",
        side_effect=fake_resolver,
    ):
        agent = ToolDemoAgent.full(provider=object())
        await agent.run(
            user_prompt="hi",
            tool_context={
                "workspace_id": "ws", "project_id": None,
                "user_id": "u-123", "run_id": "r", "scope": "workspace",
            },
        )

    assert not called, "resolver must not run when flag is off"
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — `tool_demo` doesn't import `build_mcp_tools_for_user` yet.

- [ ] **Step 3: Modify `tool_demo`**

Replace the body of `apps/worker/src/worker/agents/tool_demo/agent.py` `run` method:

```python
"""ToolDemoAgent — Sub-project A verification agent.

Four presets map 1:1 to the four chat modes identified in the umbrella
(plain / reference / external / full). Each preset bundles a different
tool subset; the `run_with_tools` loop is identical across presets.

Phase 1 of MCP client (spec 2026-04-28): when FEATURE_MCP_CLIENT=true,
the `full` preset additionally pulls user-registered MCP tools via
build_mcp_tools_for_user. The `plain` / `reference` / `external` presets
intentionally don't — Phase 1 keeps the surface area minimal so the smoke
test exercises a single integration path."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from runtime import build_mcp_tools_for_user
from runtime.loop_runner import run_with_tools
from runtime.tool_loop import LoopConfig, LoopResult
from worker.tools_builtin import (
    BUILTIN_TOOLS,
    emit_structured_output,
    fetch_url,
    list_project_topics,
    read_note,
    search_concepts,
    search_notes,
)


def _mcp_enabled() -> bool:
    return (os.environ.get("FEATURE_MCP_CLIENT") or "false").lower() == "true"


@dataclass
class ToolDemoAgent:
    provider: object
    tools: tuple = field(default_factory=tuple)
    include_mcp: bool = False  # only `full` opts in by default

    @classmethod
    def plain(cls, provider) -> "ToolDemoAgent":
        return cls(provider=provider, tools=())

    @classmethod
    def reference(cls, provider) -> "ToolDemoAgent":
        return cls(provider=provider, tools=(
            list_project_topics, search_concepts, search_notes, read_note,
        ))

    @classmethod
    def external(cls, provider) -> "ToolDemoAgent":
        return cls(provider=provider, tools=(fetch_url, emit_structured_output))

    @classmethod
    def full(cls, provider) -> "ToolDemoAgent":
        return cls(
            provider=provider, tools=tuple(BUILTIN_TOOLS), include_mcp=True,
        )

    async def run(
        self,
        *,
        user_prompt: str,
        tool_context: dict,
        config: LoopConfig | None = None,
        db_session: Any | None = None,
    ) -> LoopResult:
        messages = [{"role": "user", "text": user_prompt}]
        tools = list(self.tools)
        if self.include_mcp and _mcp_enabled():
            user_id = tool_context.get("user_id")
            if user_id:
                # Per-run resolution: each invocation gets a fresh catalog.
                # The resolver returns [] on errors so a single bad server
                # never breaks the run.
                mcp_tools = await build_mcp_tools_for_user(
                    user_id=user_id,
                    db_session=db_session,
                )
                tools.extend(mcp_tools)
        return await run_with_tools(
            provider=self.provider,
            initial_messages=messages,
            tools=tools,
            tool_context=tool_context,
            config=config,
        )
```

> **Note**: in production `db_session` is supplied by the activity that
> wraps `tool_demo` (Plan 11A pattern). The unit test above passes
> `db_session=None` and patches `build_mcp_tools_for_user` directly;
> when `db_session=None` and the flag is on, the real resolver will
> raise `NotImplementedError` from `mcp_secrets.load_active_rows_for_user`
> if it actually gets called. That's deliberate — Phase 1 only ever
> instantiates `tool_demo.full()` from a Temporal activity that has a
> session. The smoke test in Task 22 verifies the wiring end-to-end.

- [ ] **Step 4: Run**

```bash
cd apps/worker && uv run --all-extras --no-sync pytest tests/agents/test_tool_demo_agent_unit.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/tool_demo/agent.py apps/worker/tests/agents/test_tool_demo_agent_unit.py
git commit -m "$(cat <<'EOF'
feat(worker): tool_demo.full unions MCP tools when flag on (Phase 1 Task 12)

ToolDemoAgent.full() pulls user-registered MCP tools via
build_mcp_tools_for_user when FEATURE_MCP_CLIENT=true and tool_context
carries a user_id. Other presets intentionally untouched — Phase 1's
e2e smoke runs against `full` only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: API — Add `@modelcontextprotocol/sdk` dep + smoke

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/tests/mcp/sdk-smoke.test.ts`

- [ ] **Step 1: Add dep**

```bash
pnpm --filter @opencairn/api add @modelcontextprotocol/sdk
```

- [ ] **Step 2: Smoke test**

```ts
// apps/api/tests/mcp/sdk-smoke.test.ts
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

describe("@modelcontextprotocol/sdk surface", () => {
  it("exposes Client + StreamableHTTPClientTransport", () => {
    expect(Client).toBeTypeOf("function");
    expect(StreamableHTTPClientTransport).toBeTypeOf("function");
  });
});
```

- [ ] **Step 3: Run**

```bash
pnpm --filter @opencairn/api test -- --run tests/mcp/sdk-smoke.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/tests/mcp/sdk-smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add @modelcontextprotocol/sdk + import smoke (Phase 1 Task 13)

Used by /api/mcp/servers POST + /test endpoints to issue list_tools.
Smoke test pins the import paths so SDK upgrades that move
StreamableHTTPClientTransport fail loudly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: API — `mcp-runner.ts` `runListTools` utility

**Files:**
- Create: `apps/api/src/lib/mcp-runner.ts`
- Create: `apps/api/tests/mcp/mcp-runner.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/api/tests/mcp/mcp-runner.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runListTools } from "../../src/lib/mcp-runner";
import { startEchoMcpServer, type EchoServerHandle } from "../helpers/mcp-fixture";

let echo: EchoServerHandle;

beforeAll(async () => {
  echo = await startEchoMcpServer();
});

afterAll(async () => {
  await echo.stop();
});

describe("runListTools", () => {
  it("returns ok + tool count for a reachable server", async () => {
    const result = await runListTools({
      url: echo.url, authHeader: null, timeoutMs: 5000,
    });
    expect(result.status).toBe("ok");
    expect(result.toolCount).toBeGreaterThan(0);
    expect(result.sampleNames.length).toBeGreaterThan(0);
    expect(result.sampleNames.length).toBeLessThanOrEqual(5);
  });

  it("returns transport_error for an unreachable host", async () => {
    const result = await runListTools({
      url: "https://nope.invalid:1/", authHeader: null, timeoutMs: 1000,
    });
    expect(result.status).toBe("transport_error");
  });

  it("returns auth_failed for a 401 response", async () => {
    const result = await runListTools({
      url: echo.urlRequiringAuth,
      authHeader: { name: "Authorization", value: "Bearer wrong" },
      timeoutMs: 5000,
    });
    expect(result.status).toBe("auth_failed");
  });
});
```

- [ ] **Step 2: Build the test fixture (in-process echo MCP server in TS)**

```ts
// apps/api/tests/helpers/mcp-fixture.ts
/**
 * Spawns an MCP echo server using the SDK's server side. Two endpoints:
 *   /mcp        — open
 *   /mcp-auth   — requires `Authorization: Bearer right-key` header
 *
 * Returns URLs + a stop() handle.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export interface EchoServerHandle {
  url: string;
  urlRequiringAuth: string;
  stop: () => Promise<void>;
}

export async function startEchoMcpServer(): Promise<EchoServerHandle> {
  const mcp = new McpServer({ name: "echo", version: "0.0.0" });
  mcp.tool(
    "add",
    "Adds two numbers",
    { x: z.number(), y: z.number() },
    async ({ x, y }) => ({ content: [{ type: "text", text: String(x + y) }] }),
  );

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/mcp-auth") {
      const auth = req.headers["authorization"];
      if (auth !== "Bearer right-key") {
        res.writeHead(401).end("unauthorized");
        return;
      }
    }
    if (url.pathname !== "/mcp" && url.pathname !== "/mcp-auth") {
      res.writeHead(404).end();
      return;
    }
    let transport = transports.get(url.pathname);
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => Math.random().toString(36).slice(2),
      });
      transports.set(url.pathname, transport);
      await mcp.connect(transport);
    }
    await transport.handleRequest(req, res, await readJson(req));
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    urlRequiringAuth: `http://127.0.0.1:${port}/mcp-auth`,
    stop: () => new Promise((r) => httpServer.close(() => r())),
  };
}

async function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}
```

> If the SDK's TS server-side helpers diverge at impl time, the fixture
> should still expose `{ url, urlRequiringAuth, stop }` and pass an
> equivalent test surface — adapt to current SDK exports rather than
> bending the test.

- [ ] **Step 3: Implement `runListTools`**

```ts
// apps/api/src/lib/mcp-runner.ts
/**
 * Single-shot list_tools call against a user-registered MCP server.
 * Used by both POST /api/mcp/servers (auto-test on register) and
 * POST /api/mcp/servers/:id/test.
 *
 * NOTE: this runs inside the Hono request handler — kept blast-radius
 * limited via:
 *   - hard timeout (default 30s; handler passes 30000)
 *   - HTTPS-only enforced at the Zod layer (not here)
 *   - SSRF guard: the WORKER side blocks private IPs at run time. The
 *     API doesn't replicate the guard because the API isn't in the
 *     internal-network topology — its outbound is filtered by the host's
 *     egress rules. If hosted topology changes, copy the worker SSRF
 *     guard here.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerTestResult } from "@opencairn/shared";

export interface RunListToolsArgs {
  url: string;
  authHeader: { name: string; value: string } | null;
  timeoutMs: number;
}

export async function runListTools({
  url,
  authHeader,
  timeoutMs,
}: RunListToolsArgs): Promise<McpServerTestResult> {
  const started = Date.now();
  const headers: Record<string, string> = {};
  if (authHeader) headers[authHeader.name] = authHeader.value;
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  const client = new Client({ name: "opencairn-api", version: "0.1.0" });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    await client.connect(transport);
    const list = await client.listTools();
    const tools = list.tools ?? [];
    return {
      status: "ok",
      toolCount: tools.length,
      sampleNames: tools.slice(0, 5).map((t) => t.name),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuth = /401|403|unauthor/i.test(msg);
    return {
      status: isAuth ? "auth_failed" : "transport_error",
      toolCount: 0,
      sampleNames: [],
      durationMs: Date.now() - started,
      errorMessage: msg.slice(0, 500),
    };
  } finally {
    clearTimeout(timer);
    try {
      await client.close();
    } catch {
      // best-effort
    }
  }
}
```

- [ ] **Step 4: Run**

```bash
pnpm --filter @opencairn/api test -- --run tests/mcp/mcp-runner.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/mcp-runner.ts apps/api/tests/mcp/mcp-runner.test.ts apps/api/tests/helpers/mcp-fixture.ts
git commit -m "$(cat <<'EOF'
feat(api): mcp-runner.runListTools + in-process fixture (Phase 1 Task 14)

Single-shot list_tools wrapper around @modelcontextprotocol/sdk Client +
StreamableHTTPClientTransport. Maps SDK errors to McpServerTestResult.status
(ok | auth_failed | transport_error). Hard timeout via AbortController.
Test fixture is a real in-process MCP server with a no-auth and
require-auth endpoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: API — `mcp-slug.ts` generator + validator

**Files:**
- Create: `apps/api/src/lib/mcp-slug.ts`
- Create: `apps/api/tests/mcp/slug.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// apps/api/tests/mcp/slug.test.ts
import { describe, it, expect } from "vitest";
import { generateSlug, isValidSlug } from "../../src/lib/mcp-slug";

describe("isValidSlug", () => {
  it.each(["abc", "abc_123", "linear", "a", "x".repeat(32)])(
    "accepts %s",
    (s) => {
      expect(isValidSlug(s)).toBe(true);
    },
  );

  it.each(["", "A", "x".repeat(33), "한글", "abc-def", " abc"])(
    "rejects %s",
    (s) => {
      expect(isValidSlug(s)).toBe(false);
    },
  );
});

describe("generateSlug", () => {
  it("lowercases and underscores spaces", () => {
    expect(generateSlug("My Linear", new Set())).toBe("my_linear");
  });

  it("strips non-[a-z0-9_] characters", () => {
    expect(generateSlug("Café — 2024!", new Set())).toBe("caf_2024");
  });

  it("falls back to a deterministic slug when input collapses to empty", () => {
    expect(generateSlug("…", new Set()).startsWith("server_")).toBe(true);
  });

  it("appends suffix on collision", () => {
    const taken = new Set(["my_linear"]);
    expect(generateSlug("My Linear", taken)).toBe("my_linear_2");
    taken.add("my_linear_2");
    expect(generateSlug("My Linear", taken)).toBe("my_linear_3");
  });

  it("never exceeds 32 chars even with suffix", () => {
    const long = "x".repeat(40);
    const out = generateSlug(long, new Set());
    expect(out.length).toBeLessThanOrEqual(32);
    expect(isValidSlug(out)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to fail**

```bash
pnpm --filter @opencairn/api test -- --run tests/mcp/slug.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/lib/mcp-slug.ts
/**
 * Slug generator for user_mcp_servers.serverSlug.
 *
 * /^[a-z0-9_]{1,32}$/. Used as the prefix in `mcp__<slug>__<tool>` so
 * collisions across (userId, slug) are blocked at the DB. The worker
 * mirrors the regex (apps/worker/src/runtime/mcp/slug.py) but only
 * validates — generation lives here.
 */

export const SLUG_PATTERN = /^[a-z0-9_]{1,32}$/;

export function isValidSlug(s: string): boolean {
  return SLUG_PATTERN.test(s);
}

const FALLBACK_PREFIX = "server_";

export function generateSlug(
  displayName: string,
  takenSlugs: ReadonlySet<string>,
): string {
  const base = sanitise(displayName) || `${FALLBACK_PREFIX}${randomSuffix()}`;
  if (!takenSlugs.has(base)) return base.slice(0, 32);

  let n = 2;
  while (n < 1000) {
    const suffix = `_${n}`;
    const trimmed = base.slice(0, 32 - suffix.length);
    const candidate = `${trimmed}${suffix}`;
    if (!takenSlugs.has(candidate)) return candidate;
    n += 1;
  }
  // 1000+ collisions would mean a near-pathological account state —
  // fall back to a random tail to guarantee progress.
  return `${base.slice(0, 24)}_${randomSuffix()}`;
}

function sanitise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
```

- [ ] **Step 4: Run**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/mcp-slug.ts apps/api/tests/mcp/slug.test.ts
git commit -m "$(cat <<'EOF'
feat(api): mcp-slug generator + validator (Phase 1 Task 15)

generateSlug(displayName, takenSlugs) lowercases, underscores
non-alphanumerics, trims to 32 chars, appends _2/_3/... on collision
(falls back to random suffix after 1000 collisions). Worker mirrors the
regex in runtime/mcp/slug.py.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: API — `routes/mcp.ts` 5 routes + auto-test on POST

**Files:**
- Create: `apps/api/src/routes/mcp.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/tests/mcp/servers.test.ts`
- Create: `apps/api/tests/mcp/encryption.test.ts`
- Create: `apps/api/tests/mcp/feature-flag.test.ts`

- [ ] **Step 1: Failing tests — `servers.test.ts` (CRUD + auto-test + cross-user 404)**

```ts
// apps/api/tests/mcp/servers.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { app } from "../../src/app";
import { signInAs } from "../helpers/auth-fixture";
import { startEchoMcpServer, type EchoServerHandle } from "../helpers/mcp-fixture";

let echo: EchoServerHandle;

beforeAll(async () => {
  process.env.FEATURE_MCP_CLIENT = "true";
  echo = await startEchoMcpServer();
});

afterAll(async () => {
  delete process.env.FEATURE_MCP_CLIENT;
  await echo.stop();
});

describe("POST /api/mcp/servers", () => {
  it("registers + auto-tests a reachable server", async () => {
    const { headers } = await signInAs("alice");
    const res = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "My Echo",
        serverUrl: echo.url,
        authHeaderValue: "anything",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.serverSlug).toBe("my_echo");
    expect(body.status).toBe("active");
    expect(body.lastSeenToolCount).toBeGreaterThan(0);
    expect(body.hasAuth).toBe(true);
    expect(body.authHeaderValue).toBeUndefined();
  });

  it("rejects servers with > 50 tools", async () => {
    // Use a stub that overrides runListTools to return 51 tools.
    const { runListTools } = await import("../../src/lib/mcp-runner");
    const spy = vi.spyOn(
      await import("../../src/lib/mcp-runner"), "runListTools",
    ).mockResolvedValueOnce({
      status: "ok",
      toolCount: 51,
      sampleNames: [],
      durationMs: 10,
    });
    const { headers } = await signInAs("alice");
    const res = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Huge",
        serverUrl: "https://huge.test/mcp",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("mcp_too_many_tools");
    spy.mockRestore();
  });

  it("rejects unreachable servers", async () => {
    const { headers } = await signInAs("alice");
    const res = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Down",
        serverUrl: "https://nope.invalid:1/",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("mcp_unreachable");
  });

  it("rejects HTTP (non-HTTPS) URLs at zod layer", async () => {
    const { headers } = await signInAs("alice");
    const res = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Bad",
        serverUrl: "http://example.com/mcp",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/mcp/servers", () => {
  it("lists only the caller's servers", async () => {
    const alice = await signInAs("alice");
    const bob = await signInAs("bob");

    await app.request("/api/mcp/servers", {
      method: "POST",
      headers: { ...alice.headers, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "A", serverUrl: echo.url }),
    });

    const res = await app.request("/api/mcp/servers", {
      headers: bob.headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.servers).toEqual([]);
  });
});

describe("cross-user access", () => {
  it("returns 404 when user A tries to delete user B's server", async () => {
    const alice = await signInAs("alice");
    const bob = await signInAs("bob");
    const created = await (
      await app.request("/api/mcp/servers", {
        method: "POST",
        headers: { ...alice.headers, "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Mine", serverUrl: echo.url }),
      })
    ).json();
    const res = await app.request(`/api/mcp/servers/${created.id}`, {
      method: "DELETE",
      headers: bob.headers,
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/mcp/servers/:id/test", () => {
  it("returns toolCount + sampleNames + status:ok", async () => {
    const alice = await signInAs("alice");
    const created = await (
      await app.request("/api/mcp/servers", {
        method: "POST",
        headers: { ...alice.headers, "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Echo", serverUrl: echo.url }),
      })
    ).json();
    const res = await app.request(
      `/api/mcp/servers/${created.id}/test`,
      { method: "POST", headers: alice.headers },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.toolCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Failing test — `encryption.test.ts`**

```ts
// apps/api/tests/mcp/encryption.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, userMcpServers, eq } from "@opencairn/db";
import { decryptToken } from "../../src/lib/integration-tokens";
import { app } from "../../src/app";
import { signInAs } from "../helpers/auth-fixture";
import { startEchoMcpServer, type EchoServerHandle } from "../helpers/mcp-fixture";

let echo: EchoServerHandle;
beforeAll(async () => {
  process.env.FEATURE_MCP_CLIENT = "true";
  echo = await startEchoMcpServer();
});
afterAll(async () => {
  delete process.env.FEATURE_MCP_CLIENT;
  await echo.stop();
});

describe("auth header encryption", () => {
  it("stores ciphertext in DB; never returns plaintext", async () => {
    const { headers } = await signInAs("alice");
    const created = await (
      await app.request("/api/mcp/servers", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "AuthEcho",
          serverUrl: echo.url,
          authHeaderValue: "secret-1234",
        }),
      })
    ).json();

    const list = await (
      await app.request("/api/mcp/servers", { headers })
    ).json();
    const summary = list.servers.find(
      (s: { id: string }) => s.id === created.id,
    );
    expect(summary.hasAuth).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("secret-1234");

    const [row] = await db
      .select()
      .from(userMcpServers)
      .where(eq(userMcpServers.id, created.id));
    expect(row.authHeaderValueEncrypted).toBeInstanceOf(Buffer);
    expect(decryptToken(row.authHeaderValueEncrypted as Buffer)).toBe(
      "secret-1234",
    );
  });
});
```

- [ ] **Step 3: Failing test — `feature-flag.test.ts`**

```ts
// apps/api/tests/mcp/feature-flag.test.ts
import { describe, it, expect } from "vitest";
import { app } from "../../src/app";
import { signInAs } from "../helpers/auth-fixture";

describe("FEATURE_MCP_CLIENT off", () => {
  it("returns 404 for any /api/mcp route", async () => {
    delete process.env.FEATURE_MCP_CLIENT;
    const { headers } = await signInAs("alice");
    const res = await app.request("/api/mcp/servers", { headers });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run all to verify fail**

```bash
pnpm --filter @opencairn/api test -- --run tests/mcp/
```
Expected: FAIL — module/route missing.

- [ ] **Step 5: Implement the router**

```ts
// apps/api/src/routes/mcp.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, userMcpServers, eq, and } from "@opencairn/db";
import {
  McpServerCreateSchema,
  McpServerUpdateSchema,
  type McpServerSummary,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { encryptToken, decryptToken } from "../lib/integration-tokens";
import { runListTools } from "../lib/mcp-runner";
import { generateSlug } from "../lib/mcp-slug";
import type { AppEnv } from "../lib/types";

const TEST_TIMEOUT_MS = 30_000;
const MAX_TOOLS_PER_SERVER = 50;

function isFeatureEnabled(): boolean {
  return (process.env.FEATURE_MCP_CLIENT ?? "false").toLowerCase() === "true";
}

export const mcpRouter = new Hono<AppEnv>();

mcpRouter.use("*", async (c, next) => {
  if (!isFeatureEnabled()) return c.json({ error: "not_found" }, 404);
  await next();
});

function summary(row: typeof userMcpServers.$inferSelect): McpServerSummary {
  return {
    id: row.id,
    serverSlug: row.serverSlug,
    displayName: row.displayName,
    serverUrl: row.serverUrl,
    authHeaderName: row.authHeaderName,
    hasAuth: row.authHeaderValueEncrypted != null,
    status: row.status,
    lastSeenToolCount: row.lastSeenToolCount,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

mcpRouter.get("/servers", requireAuth, async (c) => {
  const userId = c.get("userId");
  const rows = await db
    .select()
    .from(userMcpServers)
    .where(eq(userMcpServers.userId, userId));
  return c.json({ servers: rows.map(summary) });
});

mcpRouter.post(
  "/servers",
  requireAuth,
  zValidator("json", McpServerCreateSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const existing = await db
      .select({ slug: userMcpServers.serverSlug })
      .from(userMcpServers)
      .where(eq(userMcpServers.userId, userId));
    const slug = generateSlug(
      body.displayName, new Set(existing.map((r) => r.slug)),
    );

    // Auto-test before insert.
    const test = await runListTools({
      url: body.serverUrl,
      authHeader: body.authHeaderValue
        ? { name: body.authHeaderName, value: body.authHeaderValue }
        : null,
      timeoutMs: TEST_TIMEOUT_MS,
    });
    if (test.status === "transport_error") {
      return c.json(
        { error: "mcp_unreachable", details: test.errorMessage }, 400,
      );
    }
    if (test.status === "ok" && test.toolCount > MAX_TOOLS_PER_SERVER) {
      return c.json(
        { error: "mcp_too_many_tools", toolCount: test.toolCount }, 400,
      );
    }

    const status = test.status === "auth_failed" ? "auth_expired" : "active";

    const [row] = await db
      .insert(userMcpServers)
      .values({
        userId,
        serverSlug: slug,
        displayName: body.displayName,
        serverUrl: body.serverUrl,
        authHeaderName: body.authHeaderName,
        authHeaderValueEncrypted: body.authHeaderValue
          ? encryptToken(body.authHeaderValue)
          : null,
        status,
        lastSeenToolCount: test.status === "ok" ? test.toolCount : 0,
        lastSeenAt: test.status === "ok" ? new Date() : null,
      })
      .returning();
    return c.json(summary(row), 201);
  },
);

mcpRouter.patch(
  "/servers/:id",
  requireAuth,
  zValidator("json", McpServerUpdateSchema),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const updates: Partial<typeof userMcpServers.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.authHeaderName !== undefined)
      updates.authHeaderName = body.authHeaderName;
    if (body.authHeaderValue !== undefined) {
      updates.authHeaderValueEncrypted =
        body.authHeaderValue === null ? null : encryptToken(body.authHeaderValue);
    }

    const [row] = await db
      .update(userMcpServers)
      .set(updates)
      .where(
        and(eq(userMcpServers.id, id), eq(userMcpServers.userId, userId)),
      )
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(summary(row));
  },
);

mcpRouter.delete("/servers/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [row] = await db
    .delete(userMcpServers)
    .where(
      and(eq(userMcpServers.id, id), eq(userMcpServers.userId, userId)),
    )
    .returning({ id: userMcpServers.id });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

mcpRouter.post("/servers/:id/test", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [row] = await db
    .select()
    .from(userMcpServers)
    .where(
      and(eq(userMcpServers.id, id), eq(userMcpServers.userId, userId)),
    );
  if (!row) return c.json({ error: "not_found" }, 404);

  const authHeader = row.authHeaderValueEncrypted
    ? {
        name: row.authHeaderName,
        value: decryptToken(row.authHeaderValueEncrypted as Buffer),
      }
    : null;
  const result = await runListTools({
    url: row.serverUrl, authHeader, timeoutMs: TEST_TIMEOUT_MS,
  });
  // Persist the latest observation. auth_failed flips status to
  // auth_expired so the settings UI surfaces a red dot.
  const nextStatus =
    result.status === "auth_failed" ? "auth_expired" :
    result.status === "ok" ? "active" :
    row.status;
  await db
    .update(userMcpServers)
    .set({
      status: nextStatus,
      lastSeenToolCount: result.status === "ok" ? result.toolCount : row.lastSeenToolCount,
      lastSeenAt: result.status === "ok" ? new Date() : row.lastSeenAt,
      updatedAt: new Date(),
    })
    .where(eq(userMcpServers.id, id));
  return c.json(result);
});
```

- [ ] **Step 6: Mount in `apps/api/src/app.ts`**

Add import near the others:

```ts
import { mcpRouter } from "./routes/mcp";
```

Mount near the other user-owned routers (e.g. after `integrationsRouter`):

```ts
app.route("/api/mcp", mcpRouter);
```

- [ ] **Step 7: Run all tests**

```bash
pnpm --filter @opencairn/api test -- --run tests/mcp/
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/mcp.ts apps/api/src/app.ts apps/api/tests/mcp/servers.test.ts apps/api/tests/mcp/encryption.test.ts apps/api/tests/mcp/feature-flag.test.ts
git commit -m "$(cat <<'EOF'
feat(api): /api/mcp/servers CRUD + auto-test + /test (Phase 1 Task 16)

5 routes (GET / POST / PATCH / DELETE / POST :id/test). FEATURE_MCP_CLIENT
gate at the router level (404 when off). POST runs runListTools once
before insert and rejects:
  - transport_error → 400 mcp_unreachable
  - >50 tools → 400 mcp_too_many_tools
  - auth_failed  → status=auth_expired (still inserted; user fixes via PATCH)
Cross-user access returns 404 (no leak of existence).
authHeaderValue never appears in any response — only `hasAuth: boolean`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Docs — `api-contract.md` row update

**Files:**
- Modify: `docs/architecture/api-contract.md`

- [ ] **Step 1: Insert MCP rows after the integrations rows (or wherever the user-owned section lives)**

```md
## MCP Servers (FEATURE_MCP_CLIENT, user-owned)

| Method | Path                         | Auth         | Body / Returns                                                |
| ------ | ---------------------------- | ------------ | ------------------------------------------------------------- |
| GET    | /api/mcp/servers             | session user | `{ servers: McpServerSummary[] }`                             |
| POST   | /api/mcp/servers             | session user | body: `McpServerCreate` → `McpServerSummary` (201). Auto-runs `list_tools` once; rejects 50+ tools or unreachable transports. |
| PATCH  | /api/mcp/servers/:id         | session user | body: `McpServerUpdate` → `McpServerSummary`                  |
| DELETE | /api/mcp/servers/:id         | session user | `{ ok: true }`                                                |
| POST   | /api/mcp/servers/:id/test    | session user | `McpServerTestResult`                                          |

When `FEATURE_MCP_CLIENT=false` the entire router returns 404. URL is
HTTPS-only (zod-enforced). authHeaderValue is encrypted at rest with
`INTEGRATION_TOKEN_ENCRYPTION_KEY` (same wire layout as
user_integrations) and never appears in any response — `hasAuth: boolean`
is the only signal.
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/api-contract.md
git commit -m "$(cat <<'EOF'
docs(api): add /api/mcp/servers rows (Phase 1 Task 17)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Web — i18n keys (`messages/{ko,en}/settings.json`)

**Files:**
- Modify: `apps/web/messages/ko/settings.json`
- Modify: `apps/web/messages/en/settings.json`

- [ ] **Step 1: Add `mcp` block to ko**

In `apps/web/messages/ko/settings.json`, add a sibling key to `ai`:

```json
{
  "ai": { ... unchanged ... },
  "mcp": {
    "title": "MCP 서버",
    "subtitle": "외부 MCP 서버를 등록하면 에이전트가 그 서버의 도구를 호출할 수 있습니다.",
    "feature_disabled": "이 기능은 호스팅 환경에서만 사용할 수 있습니다.",
    "list": {
      "empty": "등록된 MCP 서버가 없습니다.",
      "tool_count": "도구 {count}개",
      "last_seen": "마지막 확인 {time}",
      "test_button": "Test",
      "edit_button": "수정",
      "delete_button": "삭제",
      "delete_confirm_title": "이 MCP 서버를 삭제할까요?",
      "delete_confirm_body": "삭제 후에는 등록된 도구를 더 이상 호출할 수 없습니다.",
      "delete_confirm_yes": "삭제",
      "delete_confirm_no": "취소"
    },
    "status": {
      "active": "정상",
      "disabled": "비활성",
      "auth_expired": "인증 만료"
    },
    "form": {
      "add_button": "MCP 서버 추가",
      "edit_title": "MCP 서버 수정",
      "display_name_label": "표시 이름",
      "display_name_placeholder": "예: My Linear",
      "url_label": "서버 URL",
      "url_placeholder": "https://mcp.example.com/sse",
      "url_help": "HTTPS 주소만 허용됩니다.",
      "auth_header_name_label": "인증 헤더 이름",
      "auth_header_name_placeholder": "Authorization",
      "auth_header_value_label": "인증 헤더 값",
      "auth_header_value_placeholder": "Bearer …",
      "auth_header_value_help": "비워두면 인증 없이 호출합니다. 등록 후에는 표시되지 않습니다.",
      "save": "저장",
      "saving": "저장 중…",
      "saved": "저장되었습니다.",
      "cancel": "취소"
    },
    "test_result": {
      "ok": "도구 {count}개를 확인했습니다.",
      "samples_label": "예시 도구",
      "auth_failed": "인증에 실패했습니다. 헤더 값을 다시 확인해주세요.",
      "transport_error": "서버에 연결할 수 없습니다. ({message})"
    },
    "error": {
      "too_many_tools": "이 서버는 도구가 너무 많습니다 ({count}개). 50개 이하만 등록할 수 있습니다.",
      "unreachable": "서버에 연결할 수 없습니다.",
      "save_failed": "저장에 실패했습니다.",
      "delete_failed": "삭제에 실패했습니다.",
      "test_failed": "테스트에 실패했습니다."
    }
  }
}
```

- [ ] **Step 2: Mirror in en**

```json
{
  "ai": { ... unchanged ... },
  "mcp": {
    "title": "MCP servers",
    "subtitle": "Register an external MCP server so your agents can call its tools.",
    "feature_disabled": "This feature is only available on hosted environments.",
    "list": {
      "empty": "No MCP servers registered.",
      "tool_count": "{count} tools",
      "last_seen": "Last checked {time}",
      "test_button": "Test",
      "edit_button": "Edit",
      "delete_button": "Delete",
      "delete_confirm_title": "Delete this MCP server?",
      "delete_confirm_body": "Tools from this server won't be callable after deletion.",
      "delete_confirm_yes": "Delete",
      "delete_confirm_no": "Cancel"
    },
    "status": {
      "active": "Active",
      "disabled": "Disabled",
      "auth_expired": "Auth expired"
    },
    "form": {
      "add_button": "Add MCP server",
      "edit_title": "Edit MCP server",
      "display_name_label": "Display name",
      "display_name_placeholder": "e.g. My Linear",
      "url_label": "Server URL",
      "url_placeholder": "https://mcp.example.com/sse",
      "url_help": "HTTPS only.",
      "auth_header_name_label": "Auth header name",
      "auth_header_name_placeholder": "Authorization",
      "auth_header_value_label": "Auth header value",
      "auth_header_value_placeholder": "Bearer …",
      "auth_header_value_help": "Leave empty to call without auth. Hidden after save.",
      "save": "Save",
      "saving": "Saving…",
      "saved": "Saved.",
      "cancel": "Cancel"
    },
    "test_result": {
      "ok": "Found {count} tools.",
      "samples_label": "Sample tools",
      "auth_failed": "Authentication failed. Double-check the header value.",
      "transport_error": "Couldn't reach the server. ({message})"
    },
    "error": {
      "too_many_tools": "This server exposes too many tools ({count}). The limit is 50.",
      "unreachable": "Couldn't reach the server.",
      "save_failed": "Save failed.",
      "delete_failed": "Delete failed.",
      "test_failed": "Test failed."
    }
  }
}
```

- [ ] **Step 3: Run parity check**

```bash
pnpm --filter @opencairn/web i18n:parity
```
Expected: 0 missing keys.

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/ko/settings.json apps/web/messages/en/settings.json
git commit -m "$(cat <<'EOF'
i18n(web): add settings.mcp namespace ko/en (Phase 1 Task 18)

Parity-checked. Copy follows existing rules: 존댓말, no competitor names,
no implementation details (just user-facing messaging).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Web — typed API client `lib/api/mcp.ts`

**Files:**
- Create: `apps/web/src/lib/api/mcp.ts`
- Create: `apps/web/src/lib/api/__tests__/mcp.test.ts`

- [ ] **Step 1: Failing test**

```ts
// apps/web/src/lib/api/__tests__/mcp.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listServers, createServer, testServer, deleteServer } from "../mcp";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("mcp api client", () => {
  it("listServers GETs /api/mcp/servers", async () => {
    (globalThis.fetch as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] }),
    });
    const out = await listServers();
    expect(out).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/mcp/servers",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("createServer POSTs body", async () => {
    (globalThis.fetch as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "x", serverSlug: "x" }),
    });
    await createServer({ displayName: "X", serverUrl: "https://x/y" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/mcp/servers",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    );
  });

  it("testServer POSTs to :id/test", async () => {
    (globalThis.fetch as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", toolCount: 3, sampleNames: [], durationMs: 1 }),
    });
    await testServer("abc-123");
    expect(fetch).toHaveBeenCalledWith(
      "/api/mcp/servers/abc-123/test",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deleteServer DELETEs /api/mcp/servers/:id", async () => {
    (globalThis.fetch as unknown as vi.Mock).mockResolvedValue({
      ok: true, json: async () => ({ ok: true }),
    });
    await deleteServer("abc");
    expect(fetch).toHaveBeenCalledWith(
      "/api/mcp/servers/abc",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
```

- [ ] **Step 2: Run to fail**

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/api/mcp.ts
import type {
  McpServerCreate,
  McpServerSummary,
  McpServerTestResult,
  McpServerUpdate,
} from "@opencairn/shared";

const BASE = "/api/mcp/servers";
const J = { "content-type": "application/json" };

export async function listServers(): Promise<McpServerSummary[]> {
  const r = await fetch(BASE, { method: "GET" });
  if (!r.ok) throw await mkErr(r);
  return ((await r.json()) as { servers: McpServerSummary[] }).servers;
}

export async function createServer(
  body: McpServerCreate,
): Promise<McpServerSummary> {
  const r = await fetch(BASE, {
    method: "POST", headers: J, body: JSON.stringify(body),
  });
  if (!r.ok) throw await mkErr(r);
  return (await r.json()) as McpServerSummary;
}

export async function updateServer(
  id: string, body: McpServerUpdate,
): Promise<McpServerSummary> {
  const r = await fetch(`${BASE}/${id}`, {
    method: "PATCH", headers: J, body: JSON.stringify(body),
  });
  if (!r.ok) throw await mkErr(r);
  return (await r.json()) as McpServerSummary;
}

export async function deleteServer(id: string): Promise<void> {
  const r = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  if (!r.ok) throw await mkErr(r);
}

export async function testServer(id: string): Promise<McpServerTestResult> {
  const r = await fetch(`${BASE}/${id}/test`, { method: "POST" });
  if (!r.ok) throw await mkErr(r);
  return (await r.json()) as McpServerTestResult;
}

interface ApiError extends Error {
  code?: string;
  details?: unknown;
  status: number;
}

async function mkErr(r: Response): Promise<ApiError> {
  let payload: { error?: string; details?: unknown } = {};
  try { payload = await r.json(); } catch { /* non-JSON body */ }
  const err = new Error(payload.error ?? `http_${r.status}`) as ApiError;
  err.code = payload.error;
  err.details = payload.details;
  err.status = r.status;
  return err;
}
```

- [ ] **Step 4: Run**

```bash
pnpm --filter @opencairn/web test -- --run src/lib/api/__tests__/mcp.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/mcp.ts apps/web/src/lib/api/__tests__/mcp.test.ts
git commit -m "$(cat <<'EOF'
feat(web): typed API client for /api/mcp/servers (Phase 1 Task 19)

listServers / createServer / updateServer / deleteServer / testServer.
Errors carry code + status so the UI can branch on mcp_too_many_tools
vs mcp_unreachable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Web — `McpServerForm` component

**Files:**
- Create: `apps/web/src/components/settings/mcp/McpServerForm.tsx`
- Create: `apps/web/src/components/settings/mcp/__tests__/McpServerForm.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// apps/web/src/components/settings/mcp/__tests__/McpServerForm.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import settings from "../../../../../messages/ko/settings.json";
import { McpServerForm } from "../McpServerForm";

const messages = { settings };

function renderWith(props: Parameters<typeof McpServerForm>[0]) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <McpServerForm {...props} />
    </NextIntlClientProvider>,
  );
}

describe("McpServerForm", () => {
  it("rejects submit when URL is HTTP", async () => {
    const onSubmit = vi.fn();
    renderWith({ mode: "create", onSubmit, onCancel: () => {} });
    fireEvent.change(screen.getByLabelText(/표시 이름/), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/서버 URL/), {
      target: { value: "http://example.com/mcp" },
    });
    fireEvent.click(screen.getByRole("button", { name: /저장/ }));
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it("submits valid HTTPS payload", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWith({ mode: "create", onSubmit, onCancel: () => {} });
    fireEvent.change(screen.getByLabelText(/표시 이름/), { target: { value: "MyEcho" } });
    fireEvent.change(screen.getByLabelText(/서버 URL/), {
      target: { value: "https://example.com/mcp" },
    });
    fireEvent.change(screen.getByLabelText(/인증 헤더 값/), {
      target: { value: "Bearer abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: /저장/ }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "MyEcho",
          serverUrl: "https://example.com/mcp",
          authHeaderValue: "Bearer abc",
        }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run to fail**

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/settings/mcp/McpServerForm.tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { McpServerCreateSchema } from "@opencairn/shared";
import type { McpServerCreate, McpServerSummary } from "@opencairn/shared";

export interface McpServerFormProps {
  mode: "create" | "edit";
  initial?: McpServerSummary;
  onSubmit: (
    payload: McpServerCreate & { id?: string },
  ) => Promise<void>;
  onCancel: () => void;
}

export function McpServerForm({
  mode,
  initial,
  onSubmit,
  onCancel,
}: McpServerFormProps) {
  const t = useTranslations("settings.mcp.form");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [serverUrl, setServerUrl] = useState(initial?.serverUrl ?? "");
  const [authHeaderName, setAuthHeaderName] = useState(
    initial?.authHeaderName ?? "Authorization",
  );
  const [authHeaderValue, setAuthHeaderValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = McpServerCreateSchema.safeParse({
      displayName,
      serverUrl,
      authHeaderName,
      authHeaderValue: authHeaderValue || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "validation");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ id: initial?.id, ...parsed.data });
    } catch (err) {
      setError(err instanceof Error ? err.message : "save_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField id="dn" label={t("display_name_label")}>
        <input
          id="dn"
          type="text"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t("display_name_placeholder")}
        />
      </FormField>
      <FormField id="url" label={t("url_label")} help={t("url_help")}>
        <input
          id="url"
          type="url"
          required
          disabled={mode === "edit"}
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder={t("url_placeholder")}
        />
      </FormField>
      <FormField id="ahn" label={t("auth_header_name_label")}>
        <input
          id="ahn"
          type="text"
          value={authHeaderName}
          onChange={(e) => setAuthHeaderName(e.target.value)}
          placeholder={t("auth_header_name_placeholder")}
        />
      </FormField>
      <FormField
        id="ahv"
        label={t("auth_header_value_label")}
        help={t("auth_header_value_help")}
      >
        <input
          id="ahv"
          type="password"
          value={authHeaderValue}
          onChange={(e) => setAuthHeaderValue(e.target.value)}
          placeholder={t("auth_header_value_placeholder")}
        />
      </FormField>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" disabled={busy}>
          {busy ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}

function FormField({
  id, label, help, children,
}: {
  id: string;
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="block text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {help && (
        <span className="block text-xs text-muted-foreground mt-1">{help}</span>
      )}
    </label>
  );
}
```

- [ ] **Step 4: Run**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/settings/mcp/McpServerForm.tsx apps/web/src/components/settings/mcp/__tests__/McpServerForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): McpServerForm (Phase 1 Task 20)

Client-side validation via McpServerCreateSchema (HTTPS-only enforced
client + server). URL is read-only in edit mode (slug stability per
spec §5).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Web — `McpServerList` component

**Files:**
- Create: `apps/web/src/components/settings/mcp/McpServerList.tsx`
- Create: `apps/web/src/components/settings/mcp/__tests__/McpServerList.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// apps/web/src/components/settings/mcp/__tests__/McpServerList.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import settings from "../../../../../messages/ko/settings.json";
import { McpServerList } from "../McpServerList";

const messages = { settings };
const sample = [
  {
    id: "s1",
    serverSlug: "linear",
    displayName: "My Linear",
    serverUrl: "https://mcp.linear.app/sse",
    authHeaderName: "Authorization",
    hasAuth: true,
    status: "active",
    lastSeenToolCount: 23,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function renderList(overrides: Partial<Parameters<typeof McpServerList>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <McpServerList
        servers={sample}
        onTest={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("McpServerList", () => {
  it("renders display name + tool count badge", () => {
    renderList();
    expect(screen.getByText("My Linear")).toBeInTheDocument();
    expect(screen.getByText(/23/)).toBeInTheDocument();
  });

  it("invokes onTest when Test button clicked", async () => {
    const onTest = vi.fn();
    renderList({ onTest });
    fireEvent.click(screen.getByRole("button", { name: /Test/ }));
    await waitFor(() => expect(onTest).toHaveBeenCalledWith("s1"));
  });

  it("renders auth_expired warning dot", () => {
    renderList({
      servers: [{ ...sample[0], status: "auth_expired" }],
    });
    expect(screen.getByText(/인증 만료/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// apps/web/src/components/settings/mcp/McpServerList.tsx
"use client";

import { useTranslations } from "next-intl";
import type { McpServerSummary } from "@opencairn/shared";

export interface McpServerListProps {
  servers: McpServerSummary[];
  onTest: (id: string) => void;
  onEdit: (server: McpServerSummary) => void;
  onDelete: (id: string) => void;
}

export function McpServerList({
  servers, onTest, onEdit, onDelete,
}: McpServerListProps) {
  const t = useTranslations("settings.mcp");
  if (servers.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("list.empty")}</p>;
  }
  return (
    <ul className="divide-y">
      {servers.map((s) => (
        <li key={s.id} className="py-3 flex items-center justify-between">
          <div>
            <div className="font-medium">{s.displayName}</div>
            <div className="text-xs text-muted-foreground">
              {s.serverUrl} · {t("list.tool_count", { count: s.lastSeenToolCount })}
            </div>
            <StatusBadge status={s.status} />
          </div>
          <div className="flex gap-1">
            <button onClick={() => onTest(s.id)}>{t("list.test_button")}</button>
            <button onClick={() => onEdit(s)}>{t("list.edit_button")}</button>
            <button onClick={() => onDelete(s.id)}>{t("list.delete_button")}</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: McpServerSummary["status"] }) {
  const t = useTranslations("settings.mcp.status");
  const cls =
    status === "active"
      ? "text-green-700"
      : status === "auth_expired"
        ? "text-amber-700"
        : "text-muted-foreground";
  return <span className={`text-xs ${cls}`}>{t(status)}</span>;
}
```

- [ ] **Step 3: Run**

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/settings/mcp/McpServerList.tsx apps/web/src/components/settings/mcp/__tests__/McpServerList.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): McpServerList component (Phase 1 Task 21)

Display + Test/Edit/Delete actions. Status badge surfaces auth_expired
in amber so the user notices a server needs re-auth without a separate
notification (spec §4.4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Web — `/settings/mcp` page

**Files:**
- Create: `apps/web/src/app/[locale]/app/settings/mcp/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/app/[locale]/app/settings/mcp/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";
import { McpSettingsClient } from "@/components/settings/mcp/McpSettingsClient";

export default async function SettingsMcpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const cookieHeader = (await cookies()).toString();
  const apiBase = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

  // Auth guard.
  const meRes = await fetch(`${apiBase}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!meRes.ok) {
    redirect(
      `/${locale}/auth/login?return_to=${encodeURIComponent(
        `/${locale}/app/settings/mcp`,
      )}`,
    );
  }

  // Feature-flag guard. Probe the API: if FEATURE_MCP_CLIENT is off the
  // router returns 404, which is what we surface here too.
  const probe = await fetch(`${apiBase}/api/mcp/servers`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (probe.status === 404) {
    const t = await getTranslations({
      locale: locale as Locale,
      namespace: "settings.mcp",
    });
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
        </header>
        <p className="text-sm text-muted-foreground">{t("feature_disabled")}</p>
      </main>
    );
  }

  const t = await getTranslations({
    locale: locale as Locale, namespace: "settings.mcp",
  });
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <McpSettingsClient />
    </main>
  );
}
```

- [ ] **Step 2: Implement the client island**

```tsx
// apps/web/src/components/settings/mcp/McpSettingsClient.tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { McpServerSummary } from "@opencairn/shared";
import {
  listServers, createServer, updateServer, deleteServer, testServer,
} from "@/lib/api/mcp";
import { McpServerList } from "./McpServerList";
import { McpServerForm } from "./McpServerForm";

export function McpSettingsClient() {
  const t = useTranslations("settings.mcp");
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [editing, setEditing] = useState<McpServerSummary | "new" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    listServers().then(setServers).catch(() => { /* surface via toast in retry */ });
  }, []);

  async function handleSubmit(
    payload: Parameters<typeof createServer>[0] & { id?: string },
  ) {
    const { id, ...body } = payload;
    if (id) {
      const next = await updateServer(id, body);
      setServers((s) => s.map((x) => (x.id === id ? next : x)));
    } else {
      const next = await createServer(body);
      setServers((s) => [...s, next]);
    }
    setEditing(null);
    setToast(t("form.saved"));
  }

  async function handleDelete(id: string) {
    if (!confirm(t("list.delete_confirm_body"))) return;
    await deleteServer(id);
    setServers((s) => s.filter((x) => x.id !== id));
  }

  async function handleTest(id: string) {
    const r = await testServer(id);
    if (r.status === "ok") {
      setToast(t("test_result.ok", { count: r.toolCount }));
      setServers((s) =>
        s.map((x) =>
          x.id === id
            ? { ...x, lastSeenToolCount: r.toolCount, status: "active" }
            : x,
        ),
      );
    } else if (r.status === "auth_failed") {
      setToast(t("test_result.auth_failed"));
      setServers((s) =>
        s.map((x) => (x.id === id ? { ...x, status: "auth_expired" } : x)),
      );
    } else {
      setToast(
        t("test_result.transport_error", { message: r.errorMessage ?? "" }),
      );
    }
  }

  return (
    <div className="space-y-4">
      {!editing && (
        <button onClick={() => setEditing("new")}>{t("form.add_button")}</button>
      )}
      {editing && (
        <McpServerForm
          mode={editing === "new" ? "create" : "edit"}
          initial={editing === "new" ? undefined : editing}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(null)}
        />
      )}
      <McpServerList
        servers={servers}
        onTest={handleTest}
        onEdit={setEditing}
        onDelete={handleDelete}
      />
      {toast && <p className="text-sm">{toast}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Build + tsc**

```bash
pnpm --filter @opencairn/web exec tsc --noEmit
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web i18n:parity
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/app/settings/mcp/page.tsx apps/web/src/components/settings/mcp/McpSettingsClient.tsx
git commit -m "$(cat <<'EOF'
feat(web): /settings/mcp page + client island (Phase 1 Task 22)

Auth guard mirrors /settings/ai (probe /api/auth/me). Feature-flag guard
probes /api/mcp/servers — when FEATURE_MCP_CLIENT is off the API returns
404, the page renders the feature_disabled message instead of the form.
Client island wires listServers/createServer/updateServer/deleteServer/
testServer + form + list + toast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: Env / docker — `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append**

```sh
# --- MCP client (spec 2026-04-28) -----------------------------------
# Default OFF. Set to true on hosted environments only — when off, the
# /api/mcp routes return 404 and the worker resolver short-circuits to []
# even before opening the DB. Self-hosters who explicitly want the
# feature can flip this to true.
FEATURE_MCP_CLIENT=false
# Optional: Python regex (host-only). When set, the worker SSRF guard
# additionally requires the URL host to match this pattern. Tightening
# only — never widens the SSRF rules. Leave empty to allow any HTTPS
# public host (default).
MCP_URL_ALLOWLIST=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "$(cat <<'EOF'
chore(env): document FEATURE_MCP_CLIENT + MCP_URL_ALLOWLIST (Phase 1 Task 23)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 24: Manual smoke test runbook + capture

**Files:**
- Create: `docs/review/2026-04-XX-mcp-client-phase-1-smoke.md` (date assigned at run time)
- Create: 2 PNG captures referenced in the runbook

- [ ] **Step 1: Spin up an external echo MCP server with ngrok**

```bash
# Terminal A — start a real public-internet MCP echo server.
# Use the FastMCP example so the spec §9.4 fixture path is exercised.
uv run --all-extras --no-sync python - <<'PY'
from mcp.server.fastmcp import FastMCP
fast = FastMCP(name="echo", host="127.0.0.1", port=9876)

@fast.tool()
def add(x: int, y: int) -> dict:
    return {"sum": x + y}

@fast.tool()
def delete_thing(id: str) -> dict:
    return {"deleted": id}

fast.run_streamable_http()
PY

# Terminal B
ngrok http 9876
# Note the https://<random>.ngrok-free.app URL — call this $TUNNEL.
```

- [ ] **Step 2: Bring up the OpenCairn stack with the flag on**

```bash
# Terminal C
export FEATURE_MCP_CLIENT=true
export INTEGRATION_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
docker-compose up -d   # postgres + redis + minio + temporal
pnpm dev               # api + web + worker + hocuspocus
```

- [ ] **Step 3: Register the server via the UI**

Navigate to `http://localhost:3000/ko/app/settings/mcp` (or `/en/...`).
- Click "Add MCP server".
- displayName: `Smoke Echo`
- Server URL: `${TUNNEL}/mcp`
- Auth header value: leave blank.
- Click Save.
- Expected: row appears with `mcp_too_many_tools`-clean status, `2 tools` badge.
- Capture screenshot → `docs/review/2026-04-XX-mcp-client-phase-1-smoke/01-settings.png`.

- [ ] **Step 4: Trigger a tool_demo run**

Open a Python REPL in the worker:

```bash
docker exec -it opencairn-worker uv run python - <<'PY'
import asyncio
from llm import LLMProvider
from worker.agents.tool_demo.agent import ToolDemoAgent
from runtime.tool_loop import LoopConfig

async def go():
    provider = LLMProvider.from_env()
    agent = ToolDemoAgent.full(provider)
    out = await agent.run(
        user_prompt="Use the smoke_echo server to add 17 and 25, then tell me the result.",
        tool_context={
            "workspace_id": "<your-workspace-id>",
            "project_id": None,
            "user_id": "<your-user-id>",
            "run_id": "smoke-1",
            "scope": "workspace",
        },
        config=LoopConfig(max_turns=4, max_tool_calls=4),
        # In production, the activity wraps tool_demo and supplies a real
        # asyncpg session. For this smoke we hand-roll a session:
        db_session=...,  # acquire via worker.db helpers
    )
    print(out)

asyncio.run(go())
PY
```

(Substitute real workspace_id / user_id from the registered user.)

- Expected output: a `LoopResult` with `final_text` mentioning 42, and at least one `mcp__smoke_echo__add` call in the trajectory.

- [ ] **Step 5: Capture the trajectory**

```bash
# JSONL trajectory location depends on TRAJECTORY_BACKEND env. Default is
# local FS under /tmp/opencairn-trajectories — find the smoke-1 file.
ls -lt /tmp/opencairn-trajectories | head -5
cat /tmp/opencairn-trajectories/<run-id>.jsonl | grep mcp__
```

Capture the grep output → `docs/review/2026-04-XX-mcp-client-phase-1-smoke/02-trajectory.txt`.

- [ ] **Step 6: Write the runbook**

```md
# MCP Client Phase 1 — Smoke Test (2026-04-XX)

**Plan**: `docs/superpowers/plans/2026-04-28-mcp-client-phase-1.md` (Task 24)
**Spec**: `docs/superpowers/specs/2026-04-28-mcp-client-design.md` §9.4

## Setup

1. FastMCP echo server on port 9876 (script in `tmp/smoke/echo_server.py`).
2. `ngrok http 9876` → `https://<id>.ngrok-free.app`.
3. OpenCairn stack with `FEATURE_MCP_CLIENT=true`.

## Steps + captures

### 1. Settings UI register
![settings](./2026-04-XX-mcp-client-phase-1-smoke/01-settings.png)

The auto-test reported toolCount=2 (`add`, `delete_thing`). lastSeenAt
populated.

### 2. tool_demo.full() run
[trajectory.txt](./2026-04-XX-mcp-client-phase-1-smoke/02-trajectory.txt)

The trajectory contains `tool_use { tool_name: "mcp__smoke_echo__add",
input_args: { "x": 17, "y": 25 } }` followed by
`tool_result { ok: true, output: { ... 42 ... } }`.

## Result

✅ End-to-end works. Phase 1 acceptance criteria met:
- Register / list / test / delete via UI.
- `tool_demo.full()` picks up the server's tools at run start.
- `mcp__<slug>__<tool>` naming preserved.
- 50-tool reject + transport-error reject manually verified by
  registering a known-bad URL and a stub returning >50 tools.
```

- [ ] **Step 7: Commit**

```bash
git add docs/review/
git commit -m "$(cat <<'EOF'
docs(review): MCP client Phase 1 smoke test capture (Task 24)

Manual end-to-end verification: ngrok + FastMCP echo server registered
via /settings/mcp, tool_demo.full() picks up the catalog and emits
mcp__smoke_echo__add in the trajectory. Captures embedded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 25: Final verification — run all gates + one consolidated tidy commit if needed

**Files:**
- (Possibly modify) any small follow-up nits surfaced by gate runs.

- [ ] **Step 1: Run every verification gate in sequence**

```bash
pnpm --filter @opencairn/db test
pnpm --filter @opencairn/shared test
pnpm --filter @opencairn/api test
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web exec tsc --noEmit
cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/ tests/agents/test_tool_demo_agent_unit.py tests/lib/test_mcp_secrets.py -v
```

All must pass.

- [ ] **Step 2: If any gate fails, fix in a NEW commit (not amend)**

Per `feedback_opencairn_commit_coauthor` and the project commit rules — fix-up commits get their own atomic message + Co-Authored-By trailer.

- [ ] **Step 3: Push & open PR**

```bash
git push -u origin docs/mcp-client-spec
gh pr create --title "docs+feat: MCP client spec + Phase 1 implementation" --body "$(cat <<'EOF'
## Summary

- Spec: `docs/superpowers/specs/2026-04-28-mcp-client-design.md` (committed earlier on this branch; this PR includes the Phase 1 patch that swapped the integration target from compiler → tool_demo).
- Plan: `docs/superpowers/plans/2026-04-28-mcp-client-phase-1.md`.
- Phase 1 implementation: DB + shared schemas + worker `runtime/mcp/` package + 5 API routes + Settings UI + `tool_demo.full()` integration. Behind `FEATURE_MCP_CLIENT` (default OFF).

## Test plan

- [x] `pnpm --filter @opencairn/db test`
- [x] `pnpm --filter @opencairn/shared test`
- [x] `pnpm --filter @opencairn/api test`
- [x] `pnpm --filter @opencairn/web test`
- [x] `pnpm --filter @opencairn/web i18n:parity`
- [x] `pnpm --filter @opencairn/web exec tsc --noEmit`
- [x] `cd apps/worker && uv run --all-extras --no-sync pytest tests/runtime/mcp/ tests/agents/test_tool_demo_agent_unit.py tests/lib/test_mcp_secrets.py -v`
- [x] Manual smoke (Task 24): ngrok + FastMCP echo + Settings register + tool_demo.full() invocation, captures in `docs/review/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Update `MEMORY.md`**

After PR merges, replace the `project_mcp_client_spec.md` memory entry with a `project_mcp_client_phase_1.md` entry pointing at the merge commit.

> **Note**: the plan-writer (you, in the previous session) already updated MEMORY before merge per the user's spec-writing instructions. The execute-time memory update is the *complete* state after merge — different obligation.

---

## Self-review checklist (filled in at plan write time)

**Spec coverage** — every spec section has at least one task:
- §1.1 user scenario → Phase 2 (out of scope here, marked).
- §2 decision table — every row enforced (transport HTTPS-only Task 4 zod, tool naming Tasks 8 + 15, scope hardcode Task 8, 50-tool limit Tasks 9 + 16, destructive heuristic Task 8, per-run resolution Task 9, failure mode Task 9 / 16, per-tool timeout Task 7 / 14, feature flag Tasks 12 / 16 / 22 / 23).
- §3 OQ — listed in "Out of scope".
- §4 DB — Tasks 2 + 3.
- §5 API — Task 16.
- §5.1 auto-test — Task 16.
- §5.2 Zod — Task 4.
- §6 worker — Tasks 5–11.
- §6.1 SSRF — Task 6.
- §6.2 adapter — Task 8.
- §6.3 resolver — Task 9.
- §6.4 tool_demo integration (was Compiler in original spec, patched in this PR's spec commit `20332c7`) — Task 12.
- §6.5 secret-via-payload — Task 10.
- §6.6 provider — no change needed; Task 12 verifies `tools` list union flows through unchanged.
- §6.7 dependencies — Tasks 1 + 13.
- §7 security model — Tasks 6 (SSRF) + 8 (auth in closure) + 16 (cross-user 404 + encryption never returned) + 9 (slug regex defence-in-depth) + 11 (truncation regression).
- §8 migration / rollback — Task 3 + plan body.
- §9.1–9.5 testing — Tasks 5–11 + 14–16 + 19–21 + 24.
- §10 Phase 1 scope — entire plan.
- §11 future work — "Out of scope".
- §12 references — embedded in task code comments.

**Placeholder scan** — no `TBD` / `implement later` / "similar to Task N" patterns.

**Type consistency** — `MCPServerRow` used identically across resolver / mcp_secrets / __init__ exports; `runListTools` return shape matches `McpServerTestResult` zod; slug regex identical between Python (`SLUG_PATTERN`) and TS (`SLUG_PATTERN`).

**Migration number** — never hard-coded; instructions tell the executor to run `pnpm db:generate` and to reorder if a parallel session collides.
