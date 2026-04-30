# MCP Server Read-Only Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose OpenCairn as a read-only MCP server so external agent clients can search and fetch workspace knowledge.

**Architecture:** Implement the MCP server inside `apps/api` using the existing TypeScript MCP SDK and Hono request boundary. Workspace admins create read-only workspace tokens in the web settings UI; external MCP clients call a Streamable HTTP endpoint that validates the token, derives a workspace context, and serves only `search_notes`, `get_note`, and `list_projects`.

**Tech Stack:** Hono 4, `@modelcontextprotocol/sdk` 1.29.0, Drizzle/Postgres, pgvector + `content_tsv`, Better Auth session routes for token management, Next.js/TanStack Query for token UX, Vitest.

## Implementation Status (2026-04-30)

Implemented on branch `feat/plan-mcp-server-phase-1` in `.worktrees/plan-mcp-server-phase-1`.

Completed:

- Shared MCP server schemas and tests.
- `mcp_server_tokens` Drizzle schema and generated migration `0040_tranquil_captain_flint`.
- API token generation, hashing, verification, metadata, token management routes, and Streamable HTTP MCP endpoint.
- Read-only services for `search_notes`, `get_note`, and `list_projects`.
- Settings UI for workspace-scoped MCP read tokens with ko/en i18n.
- API/env/operator docs.

Verified:

- `pnpm --filter @opencairn/api build`
- `pnpm --filter @opencairn/web build`
- `pnpm --filter @opencairn/web i18n:parity`
- `pnpm --filter @opencairn/web i18n:quality`
- Targeted web ESLint on changed files.
- `pnpm --filter @opencairn/db db:generate` idempotency after migration generation.
- `git diff --check`

Blocked locally:

- Focused Vitest suites do not reach OpenCairn test code in this Windows worktree because Vitest startup fails with `ERR_PACKAGE_IMPORT_NOT_DEFINED: #module-evaluator`.
- WSL retry against the same Windows-installed `node_modules` fails before tests load because the Linux Rolldown optional native binding is absent: `Cannot find module '@rolldown/binding-linux-x64-gnu'`.

---

## Context And Decisions

This plan is intentionally server-only for MCP protocol handling. It does not implement OpenCairn MCP write tools, generic MCP import, provider-specific Drive/GitHub/Notion import UX, or `docs/contributing/plans-status.md` updates before merge.

### Decision Summary

| Question | Decision | Reason |
| --- | --- | --- |
| Python MCP SDK vs TypeScript | **TypeScript in `apps/api`** | The data boundary, Better Auth helpers, workspace permissions, Hono mount ordering, and existing `@modelcontextprotocol/sdk` dependency already live in `apps/api`. Python would need a second auth/data gateway for no Phase 1 gain. |
| `apps/api` route vs new `packages/mcp-server` | **`apps/api/src/lib/mcp-server/*` + `apps/api/src/routes/mcp-server.ts`** | No new package until the server proves useful. Extraction is easy later because protocol handlers will be isolated under `lib/mcp-server`. |
| Transport | **Streamable HTTP only** | Hosted and self-hosted deployments both already expose HTTP. Stdio would require a separate local proxy/CLI and token handoff. Add stdio only after real users need local desktop launch flows. |
| Auth | **Workspace-scoped read token + OAuth protected-resource metadata** | OAuth 2.1 is the direction, but a full authorization server is too large for Phase 1. This plan implements the MCP resource-server side: bearer validation on every request, `WWW-Authenticate` with `resource_metadata`, and `.well-known/oauth-protected-resource`. Full OAuth authorization-code/PKCE is a follow-up. |
| Tool scope | **`search_notes`, `get_note`, `list_projects`** | These match the research docs and are enough for external agents to discover and cite OpenCairn knowledge. `create_note`, `start_research`, import/sync, and external-send tools stay out. |
| Hosted endpoint vs local stdio | **Hosted/self-hosted HTTP endpoint first** | Use `https://<api-host>/api/mcp` for hosted and `http://localhost:<api-port>/api/mcp` only in local dev/self-host docs. No `mcp.opencairn.com` domain hardcode; use env-derived public URL. |

### Public Surface

| Surface | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/mcp` | `GET`/`POST`/`DELETE` | MCP bearer token | Streamable HTTP MCP endpoint. |
| `/.well-known/oauth-protected-resource` | `GET` | none | Root protected-resource metadata. |
| `/.well-known/oauth-protected-resource/api/mcp` | `GET` | none | Path-specific protected-resource metadata. |
| `/api/mcp/tokens?workspaceId=` | `GET` | session + workspace admin | List token metadata. |
| `/api/mcp/tokens` | `POST` | session + workspace admin | Create read-only token; plaintext returned once. |
| `/api/mcp/tokens/:id` | `DELETE` | session + workspace admin | Revoke token. |

### MCP Tools

`search_notes`

```ts
{
  query: string;              // 1..2000 chars
  limit?: number;             // default 10, max 25
  projectId?: string;         // optional UUID, must belong to token workspace
}
```

Returns top hits with note id, title, project id/name, snippet, source type/url, updated timestamp, vector score, BM25 score, and fused RRF score. It uses hybrid pgvector + BM25 when embedding is configured and falls back to BM25-only with `vectorScore: null` when no embedding provider is configured.

`get_note`

```ts
{
  noteId: string;             // UUID
}
```

Returns title, project id/name, source metadata, content text clipped to a server-side max, and updated timestamp. Cross-workspace, soft-deleted, or unknown notes return an MCP tool error without revealing which case occurred.

`list_projects`

```ts
{
  limit?: number;             // default 50, max 100
}
```

Returns workspace projects visible to the workspace token. Phase 1 workspace tokens are admin-issued and read all non-deleted workspace notes/projects, so page-level per-user overrides do not apply to external agent access.

### Files

- Create: `packages/shared/src/mcp-server.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/mcp-server.test.ts`
- Create: `packages/db/src/schema/mcp-server-tokens.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/client.ts`
- Test: `packages/db/tests/mcp-server-tokens.test.ts`
- Create: `apps/api/src/lib/mcp-server/token.ts`
- Create: `apps/api/src/lib/mcp-server/metadata.ts`
- Create: `apps/api/src/lib/mcp-server/search.ts`
- Create: `apps/api/src/lib/mcp-server/server.ts`
- Create: `apps/api/src/routes/mcp-server.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/mcp-server/token.test.ts`
- Test: `apps/api/tests/mcp-server/routes.test.ts`
- Test: `apps/api/tests/mcp-server/tools.test.ts`
- Create: `apps/web/src/lib/api/mcp-server-tokens.ts`
- Create: `apps/web/src/components/settings/mcp/McpServerTokenCard.tsx`
- Modify: `apps/web/src/components/settings/mcp/McpSettingsClient.tsx`
- Modify: `apps/web/messages/ko/settings.json`
- Modify: `apps/web/messages/en/settings.json`
- Test: `apps/web/src/components/settings/mcp/McpServerTokenCard.test.tsx`
- Modify: `.env.example`
- Modify: `docs/architecture/api-contract.md`
- Create: `docs/architecture/mcp-server.md`

---

### Task 1: Shared Schemas

**Files:**
- Create: `packages/shared/src/mcp-server.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/mcp-server.test.ts`

- [ ] **Step 1: Write failing shared schema tests**

Create `packages/shared/tests/mcp-server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  McpGetNoteInputSchema,
  McpListProjectsInputSchema,
  McpSearchNotesInputSchema,
  McpTokenCreateSchema,
  McpTokenListResponseSchema,
} from "../src/mcp-server";

describe("MCP server shared schemas", () => {
  it("accepts bounded read-only MCP tool inputs", () => {
    expect(
      McpSearchNotesInputSchema.parse({
        query: "retrieval augmented generation",
        limit: 25,
        projectId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toMatchObject({ limit: 25 });

    expect(
      McpGetNoteInputSchema.parse({
        noteId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toEqual({ noteId: "22222222-2222-4222-8222-222222222222" });

    expect(McpListProjectsInputSchema.parse({})).toEqual({ limit: 50 });
  });

  it("rejects over-broad tool inputs", () => {
    expect(() =>
      McpSearchNotesInputSchema.parse({ query: "", limit: 10 }),
    ).toThrow();
    expect(() =>
      McpSearchNotesInputSchema.parse({ query: "x", limit: 500 }),
    ).toThrow();
    expect(() =>
      McpGetNoteInputSchema.parse({ noteId: "not-a-uuid" }),
    ).toThrow();
  });

  it("models create/list token responses without returning old plaintext", () => {
    const create = McpTokenCreateSchema.parse({
      workspaceId: "33333333-3333-4333-8333-333333333333",
      label: "Claude Code",
      expiresAt: null,
    });
    expect(create.label).toBe("Claude Code");

    const list = McpTokenListResponseSchema.parse({
      tokens: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          workspaceId: "33333333-3333-4333-8333-333333333333",
          label: "Claude Code",
          tokenPrefix: "ocmcp_abcd",
          scopes: ["workspace:read"],
          expiresAt: null,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: "2026-04-30T00:00:00.000Z",
        },
      ],
    });
    expect(list.tokens[0]!.token).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencairn/shared test -- mcp-server.test.ts
```

Expected: fail because `packages/shared/src/mcp-server.ts` does not exist.

- [ ] **Step 3: Add shared schemas**

Create `packages/shared/src/mcp-server.ts`:

```ts
import { z } from "zod";

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime();

export const MCP_SERVER_SCOPES = ["workspace:read"] as const;

export const McpSearchNotesInputSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  limit: z.number().int().positive().max(25).default(10),
  projectId: uuid.optional(),
});

export const McpGetNoteInputSchema = z.object({
  noteId: uuid,
});

export const McpListProjectsInputSchema = z.object({
  limit: z.number().int().positive().max(100).default(50),
});

export const McpTokenCreateSchema = z.object({
  workspaceId: uuid,
  label: z.string().trim().min(1).max(80),
  expiresAt: isoDateTime.nullable().optional(),
});

export const McpTokenCreatedSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  label: z.string(),
  token: z.string().startsWith("ocmcp_"),
  tokenPrefix: z.string(),
  scopes: z.array(z.enum(MCP_SERVER_SCOPES)),
  expiresAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const McpTokenSummarySchema = McpTokenCreatedSchema.omit({
  token: true,
}).extend({
  lastUsedAt: isoDateTime.nullable(),
  revokedAt: isoDateTime.nullable(),
});

export const McpTokenListResponseSchema = z.object({
  tokens: z.array(McpTokenSummarySchema),
});

export type McpSearchNotesInput = z.infer<typeof McpSearchNotesInputSchema>;
export type McpGetNoteInput = z.infer<typeof McpGetNoteInputSchema>;
export type McpListProjectsInput = z.infer<typeof McpListProjectsInputSchema>;
export type McpTokenCreate = z.infer<typeof McpTokenCreateSchema>;
export type McpTokenCreated = z.infer<typeof McpTokenCreatedSchema>;
export type McpTokenSummary = z.infer<typeof McpTokenSummarySchema>;
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./mcp-server";
```

- [ ] **Step 4: Run shared schema tests**

Run:

```bash
pnpm --filter @opencairn/shared test -- mcp-server.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/mcp-server.ts packages/shared/src/index.ts packages/shared/tests/mcp-server.test.ts
git commit -m "feat(shared): add mcp server schemas"
```

---

### Task 2: Workspace Token Persistence

**Files:**
- Create: `packages/db/src/schema/mcp-server-tokens.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/client.ts`
- Test: `packages/db/tests/mcp-server-tokens.test.ts`
- Generate: `packages/db/drizzle/*`

- [ ] **Step 1: Write failing DB schema test**

Create `packages/db/tests/mcp-server-tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mcpServerTokens } from "../src/index";

describe("mcpServerTokens schema", () => {
  it("declares workspace-scoped token metadata without plaintext token storage", () => {
    expect(Object.keys(mcpServerTokens)).toEqual(
      expect.arrayContaining([
        "id",
        "workspaceId",
        "createdByUserId",
        "label",
        "tokenHash",
        "tokenPrefix",
        "scopes",
        "expiresAt",
        "lastUsedAt",
        "revokedAt",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(Object.keys(mcpServerTokens)).not.toContain("token");
    expect(Object.keys(mcpServerTokens)).not.toContain("tokenEncrypted");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencairn/db test -- mcp-server-tokens.test.ts
```

Expected: fail because `mcpServerTokens` is not exported.

- [ ] **Step 3: Add schema module**

Create `packages/db/src/schema/mcp-server-tokens.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const mcpServerTokens = pgTable(
  "mcp_server_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["workspace:read"]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("mcp_server_tokens_hash_idx").on(t.tokenHash),
    index("mcp_server_tokens_workspace_idx").on(t.workspaceId),
    index("mcp_server_tokens_active_idx")
      .on(t.workspaceId, t.revokedAt, t.expiresAt),
    check("mcp_server_tokens_label_nonempty", sql`length(trim(${t.label})) > 0`),
    check(
      "mcp_server_tokens_prefix_format",
      sql`${t.tokenPrefix} LIKE 'ocmcp_%'`,
    ),
  ],
);
```

Modify `packages/db/src/index.ts`:

```ts
export * from "./schema/mcp-server-tokens";
```

Modify `packages/db/src/client.ts`:

```ts
import * as mcpServerTokens from "./schema/mcp-server-tokens";

export const schema = {
  // existing schema spreads...
  ...mcpServerTokens,
};
```

- [ ] **Step 4: Generate migration using Drizzle**

Run:

```bash
pnpm --filter @opencairn/db db:generate
```

Expected: a new Drizzle SQL migration and meta snapshot are generated. Do not manually guess or edit the migration number.

- [ ] **Step 5: Run DB schema test**

Run:

```bash
pnpm --filter @opencairn/db test -- mcp-server-tokens.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/mcp-server-tokens.ts packages/db/src/index.ts packages/db/src/client.ts packages/db/tests/mcp-server-tokens.test.ts packages/db/drizzle packages/db/drizzle/meta
git commit -m "feat(db): add mcp server token table"
```

---

### Task 3: Token Generation And Verification

**Files:**
- Create: `apps/api/src/lib/mcp-server/token.ts`
- Test: `apps/api/tests/mcp-server/token.test.ts`

- [ ] **Step 1: Write failing token helper tests**

Create `apps/api/tests/mcp-server/token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  generateMcpToken,
  hashMcpToken,
  redactMcpToken,
  timingSafeTokenHashEqual,
} from "../../src/lib/mcp-server/token";

describe("MCP server token helpers", () => {
  it("generates high-entropy tokens with a display prefix", () => {
    const token = generateMcpToken();
    expect(token).toMatch(/^ocmcp_[A-Za-z0-9_-]{43}$/);
    expect(redactMcpToken(token)).toMatch(/^ocmcp_[A-Za-z0-9_-]{4}$/);
  });

  it("hashes tokens without storing plaintext", () => {
    const token = "ocmcp_" + "a".repeat(43);
    const hash = hashMcpToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(timingSafeTokenHashEqual(hash, hash)).toBe(true);
    expect(timingSafeTokenHashEqual(hash, hash.replace(/.$/, "0"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencairn/api test -- mcp-server/token.test.ts
```

Expected: fail because token helpers do not exist.

- [ ] **Step 3: Implement token helpers**

Create `apps/api/src/lib/mcp-server/token.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "ocmcp_";
const TOKEN_RANDOM_BYTES = 32;
const TOKEN_PREFIX_VISIBLE_CHARS = TOKEN_PREFIX.length + 4;

export function generateMcpToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_RANDOM_BYTES).toString("base64url")}`;
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function redactMcpToken(token: string): string {
  return token.slice(0, TOKEN_PREFIX_VISIBLE_CHARS);
}

export function isMcpTokenFormat(value: string): boolean {
  return /^ocmcp_[A-Za-z0-9_-]{43}$/.test(value);
}

export function timingSafeTokenHashEqual(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
```

- [ ] **Step 4: Run token helper tests**

Run:

```bash
pnpm --filter @opencairn/api test -- mcp-server/token.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/mcp-server/token.ts apps/api/tests/mcp-server/token.test.ts
git commit -m "feat(api): add mcp server token helpers"
```

---

### Task 4: Token Management API

**Files:**
- Create: `apps/api/src/routes/mcp-server.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/mcp-server/routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `apps/api/tests/mcp-server/routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  eq,
  mcpServerTokens,
  user,
  workspaces,
} from "@opencairn/db";
import { createApp } from "../../src/app";
import { hashMcpToken } from "../../src/lib/mcp-server/token";
import { seedWorkspace } from "../helpers/seed";
import { signSessionCookie } from "../helpers/session";

const app = createApp();
const cleanups: Array<() => Promise<void>> = [];

async function authed(userId: string, path: string, init: RequestInit = {}) {
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

beforeEach(() => {
  process.env.FEATURE_MCP_SERVER = "true";
});

afterEach(async () => {
  delete process.env.FEATURE_MCP_SERVER;
  await db.delete(mcpServerTokens);
  while (cleanups.length) await cleanups.pop()!();
});

describe("MCP server token API", () => {
  it("returns 404 when FEATURE_MCP_SERVER is off", async () => {
    process.env.FEATURE_MCP_SERVER = "false";
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed.cleanup);
    const res = await authed(
      seed.userId,
      `/api/mcp/tokens?workspaceId=${seed.workspaceId}`,
    );
    expect(res.status).toBe(404);
  });

  it("allows workspace admins to create, list, and revoke read tokens", async () => {
    const seed = await seedWorkspace({ role: "admin" });
    cleanups.push(seed.cleanup);

    const create = await authed(seed.userId, "/api/mcp/tokens", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        label: "Claude Code",
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.token).toMatch(/^ocmcp_/);
    expect(created.scopes).toEqual(["workspace:read"]);

    const [row] = await db.select().from(mcpServerTokens);
    expect(row.tokenHash).toBe(hashMcpToken(created.token));
    expect(row.tokenHash).not.toContain(created.token);

    const list = await authed(
      seed.userId,
      `/api/mcp/tokens?workspaceId=${seed.workspaceId}`,
    );
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0].token).toBeUndefined();

    const revoke = await authed(seed.userId, `/api/mcp/tokens/${created.id}`, {
      method: "DELETE",
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toEqual({ ok: true });
  });

  it("rejects non-admin token creation", async () => {
    const seed = await seedWorkspace({ role: "viewer" });
    cleanups.push(seed.cleanup);
    const res = await authed(seed.userId, "/api/mcp/tokens", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        label: "Viewer token",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("hides cross-workspace token ids behind 404 on revoke", async () => {
    const owner = await seedWorkspace({ role: "owner" });
    const other = await seedWorkspace({ role: "owner" });
    cleanups.push(owner.cleanup, other.cleanup);

    const [inserted] = await db
      .insert(mcpServerTokens)
      .values({
        workspaceId: owner.workspaceId,
        createdByUserId: owner.userId,
        label: "Owner token",
        tokenHash: hashMcpToken("ocmcp_" + "b".repeat(43)),
        tokenPrefix: "ocmcp_bbbb",
        scopes: ["workspace:read"],
      })
      .returning();

    const res = await authed(other.userId, `/api/mcp/tokens/${inserted.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencairn/api test -- mcp-server/routes.test.ts
```

Expected: fail because `/api/mcp/tokens` is not mounted.

- [ ] **Step 3: Add feature flag and token management routes**

Create `apps/api/src/routes/mcp-server.ts` with token routes first:

```ts
import { zValidator } from "@hono/zod-validator";
import {
  McpTokenCreateSchema,
  McpTokenListResponseSchema,
  type McpTokenCreated,
  type McpTokenSummary,
} from "@opencairn/shared";
import {
  and,
  db,
  desc,
  eq,
  isNull,
  mcpServerTokens,
} from "@opencairn/db";
import { Hono } from "hono";
import { z } from "zod";
import { canAdmin } from "../lib/permissions";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";
import {
  generateMcpToken,
  hashMcpToken,
  redactMcpToken,
} from "../lib/mcp-server/token";

export const mcpServerRoutes = new Hono<AppEnv>();

function featureEnabled(): boolean {
  return (process.env.FEATURE_MCP_SERVER ?? "false").toLowerCase() === "true";
}

mcpServerRoutes.use("*", async (c, next) => {
  if (!featureEnabled()) return c.json({ error: "Not found" }, 404);
  return next();
});

function toSummary(row: typeof mcpServerTokens.$inferSelect): McpTokenSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes as ["workspace:read"],
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireAdminOr403(userId: string, workspaceId: string) {
  return canAdmin(userId, workspaceId);
}

mcpServerRoutes.get(
  "/tokens",
  requireAuth,
  zValidator("query", z.object({ workspaceId: z.string().uuid() })),
  async (c) => {
    const userId = c.get("userId");
    const { workspaceId } = c.req.valid("query");
    if (!(await requireAdminOr403(userId, workspaceId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const rows = await db
      .select()
      .from(mcpServerTokens)
      .where(eq(mcpServerTokens.workspaceId, workspaceId))
      .orderBy(desc(mcpServerTokens.createdAt));
    const body = McpTokenListResponseSchema.parse({
      tokens: rows.map(toSummary),
    });
    return c.json(body);
  },
);

mcpServerRoutes.post(
  "/tokens",
  requireAuth,
  zValidator("json", McpTokenCreateSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    if (!(await requireAdminOr403(userId, body.workspaceId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const token = generateMcpToken();
    const now = new Date();
    const [row] = await db
      .insert(mcpServerTokens)
      .values({
        workspaceId: body.workspaceId,
        createdByUserId: userId,
        label: body.label,
        tokenHash: hashMcpToken(token),
        tokenPrefix: redactMcpToken(token),
        scopes: ["workspace:read"],
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const created: McpTokenCreated = {
      id: row.id,
      workspaceId: row.workspaceId,
      label: row.label,
      token,
      tokenPrefix: row.tokenPrefix,
      scopes: ["workspace:read"],
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
    return c.json(created, 201);
  },
);

mcpServerRoutes.delete("/tokens/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [row] = await db
    .select()
    .from(mcpServerTokens)
    .where(eq(mcpServerTokens.id, id))
    .limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAdmin(userId, row.workspaceId))) {
    return c.json({ error: "Not found" }, 404);
  }
  await db
    .update(mcpServerTokens)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(mcpServerTokens.id, id), isNull(mcpServerTokens.revokedAt)));
  return c.json({ ok: true });
});
```

Modify `apps/api/src/app.ts`:

```ts
import { mcpServerRoutes } from "./routes/mcp-server";

// Keep the existing MCP client registration route first.
app.route("/api/mcp/servers", mcpRoutes);
app.route("/api/mcp", mcpServerRoutes);
app.route("/api/connectors", connectorFoundationRoutes);
```

- [ ] **Step 4: Run token route tests**

Run:

```bash
pnpm --filter @opencairn/api test -- mcp-server/routes.test.ts
```

Expected: pass after DB migration is applied in the local test database.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/mcp-server.ts apps/api/src/app.ts apps/api/tests/mcp-server/routes.test.ts
git commit -m "feat(api): add mcp server token routes"
```

---

### Task 5: Read-Only Search And Fetch Services

**Files:**
- Create: `apps/api/src/lib/mcp-server/search.ts`
- Test: `apps/api/tests/mcp-server/tools.test.ts`

- [ ] **Step 1: Write failing search/fetch service tests**

Create the first half of `apps/api/tests/mcp-server/tools.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  eq,
  notes,
  projects,
  workspaces,
} from "@opencairn/db";
import { seedWorkspace } from "../helpers/seed";
import {
  getMcpNote,
  listMcpProjects,
  searchMcpNotes,
  __setEmbedForTest,
} from "../../src/lib/mcp-server/search";

const cleanups: Array<() => Promise<void>> = [];

beforeEach(() => {
  __setEmbedForTest(async () => Array.from({ length: 768 }, () => 0.01));
});

afterEach(async () => {
  __setEmbedForTest(null);
  while (cleanups.length) await cleanups.pop()!();
});

describe("MCP server read services", () => {
  it("searches notes inside one workspace only", async () => {
    const a = await seedWorkspace({ role: "owner" });
    const b = await seedWorkspace({ role: "owner" });
    cleanups.push(a.cleanup, b.cleanup);

    await db
      .update(notes)
      .set({
        title: "Hybrid Retrieval",
        contentText: "pgvector and BM25 retrieval notes",
      })
      .where(eq(notes.id, a.noteId));
    await db
      .update(notes)
      .set({
        title: "Other Workspace Secret",
        contentText: "pgvector and BM25 retrieval notes",
      })
      .where(eq(notes.id, b.noteId));

    const hits = await searchMcpNotes({
      workspaceId: a.workspaceId,
      query: "retrieval",
      limit: 10,
    });
    expect(hits.some((hit) => hit.noteId === a.noteId)).toBe(true);
    expect(hits.some((hit) => hit.noteId === b.noteId)).toBe(false);
  });

  it("fetches one note with project metadata and clips content", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed.cleanup);
    await db
      .update(notes)
      .set({
        title: "Fetch Target",
        contentText: "x".repeat(40_000),
      })
      .where(eq(notes.id, seed.noteId));

    const note = await getMcpNote({
      workspaceId: seed.workspaceId,
      noteId: seed.noteId,
    });
    expect(note.title).toBe("Fetch Target");
    expect(note.contentText.length).toBeLessThanOrEqual(20_000);
    expect(note.projectId).toBe(seed.projectId);
  });

  it("lists projects for one workspace", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed.cleanup);
    const list = await listMcpProjects({
      workspaceId: seed.workspaceId,
      limit: 50,
    });
    expect(list.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: seed.projectId, name: "Test Project" }),
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencairn/api test -- mcp-server/tools.test.ts
```

Expected: fail because `lib/mcp-server/search.ts` does not exist.

- [ ] **Step 3: Implement read services**

Create `apps/api/src/lib/mcp-server/search.ts`:

```ts
import {
  and,
  db,
  desc,
  eq,
  isNull,
  notes,
  projects,
  sql,
} from "@opencairn/db";
import { LLMNotConfiguredError, getGeminiProvider } from "../llm/gemini";

const RRF_K = 60;
const SNIPPET_MAX = 400;
const CONTENT_MAX = 20_000;

type EmbedFn = (text: string) => Promise<number[]>;
let embedOverride: EmbedFn | null = null;

export function __setEmbedForTest(fn: EmbedFn | null) {
  embedOverride = fn;
}

function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function clip(text: string | null, max: number): string {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

async function embedQuery(query: string): Promise<number[] | null> {
  if (embedOverride) return embedOverride(query);
  try {
    return await getGeminiProvider().embed(query);
  } catch (err) {
    if (err instanceof LLMNotConfiguredError) return null;
    throw err;
  }
}

export type McpSearchHit = {
  noteId: string;
  title: string;
  projectId: string;
  projectName: string;
  snippet: string;
  sourceType: string | null;
  sourceUrl: string | null;
  updatedAt: string;
  vectorScore: number | null;
  bm25Score: number | null;
  rrfScore: number;
};

export async function searchMcpNotes(opts: {
  workspaceId: string;
  query: string;
  limit: number;
  projectId?: string;
}): Promise<McpSearchHit[]> {
  const fetchLimit = opts.limit * 2;
  const queryEmbedding = await embedQuery(opts.query);
  const filters = [
    sql`n.workspace_id = ${opts.workspaceId}`,
    sql`n.deleted_at IS NULL`,
    opts.projectId ? sql`n.project_id = ${opts.projectId}` : undefined,
  ].filter(Boolean);

  const bm25RowsRaw = await db.execute(sql`
    SELECT
      n.id,
      n.title,
      n.project_id,
      p.name AS project_name,
      n.content_text,
      n.source_type,
      n.source_url,
      n.updated_at,
      ts_rank(n.content_tsv, plainto_tsquery('simple', ${opts.query})) AS score
    FROM notes n
    JOIN projects p ON p.id = n.project_id
    WHERE ${sql.join(filters, sql` AND `)}
      AND n.content_tsv @@ plainto_tsquery('simple', ${opts.query})
    ORDER BY score DESC
    LIMIT ${fetchLimit}
  `);

  const vectorRowsRaw = queryEmbedding
    ? await db.execute(sql`
        SELECT
          n.id,
          n.title,
          n.project_id,
          p.name AS project_name,
          n.content_text,
          n.source_type,
          n.source_url,
          n.updated_at,
          1 - (n.embedding <=> ${vectorLiteral(queryEmbedding)}::vector) AS score
        FROM notes n
        JOIN projects p ON p.id = n.project_id
        WHERE ${sql.join(filters, sql` AND `)}
          AND n.embedding IS NOT NULL
        ORDER BY n.embedding <=> ${vectorLiteral(queryEmbedding)}::vector ASC
        LIMIT ${fetchLimit}
      `)
    : [];

  const rows = (raw: unknown) =>
    (raw as { rows?: Array<Record<string, unknown>> }).rows ??
    (raw as Array<Record<string, unknown>>);

  const hits = new Map<string, McpSearchHit>();
  const scores = new Map<string, number>();
  const add = (row: Record<string, unknown>, rank: number, channel: "vector" | "bm25") => {
    const noteId = String(row.id);
    const rawScore = Number(row.score ?? 0);
    const existing = hits.get(noteId);
    if (!existing) {
      hits.set(noteId, {
        noteId,
        title: String(row.title ?? "Untitled"),
        projectId: String(row.project_id),
        projectName: String(row.project_name ?? ""),
        snippet: clip(row.content_text as string | null, SNIPPET_MAX),
        sourceType: (row.source_type as string | null) ?? null,
        sourceUrl: (row.source_url as string | null) ?? null,
        updatedAt: new Date(row.updated_at as Date).toISOString(),
        vectorScore: channel === "vector" ? rawScore : null,
        bm25Score: channel === "bm25" ? rawScore : null,
        rrfScore: 0,
      });
    } else if (channel === "vector") {
      existing.vectorScore = rawScore;
    } else {
      existing.bm25Score = rawScore;
    }
    scores.set(noteId, (scores.get(noteId) ?? 0) + 1 / (RRF_K + rank));
  };

  rows(vectorRowsRaw).forEach((row, i) => add(row, i + 1, "vector"));
  rows(bm25RowsRaw).forEach((row, i) => add(row, i + 1, "bm25"));
  for (const [noteId, score] of scores) {
    const hit = hits.get(noteId);
    if (hit) hit.rrfScore = score;
  }
  return [...hits.values()].sort((a, b) => b.rrfScore - a.rrfScore).slice(0, opts.limit);
}

export async function getMcpNote(opts: { workspaceId: string; noteId: string }) {
  const [row] = await db
    .select({
      id: notes.id,
      title: notes.title,
      projectId: notes.projectId,
      projectName: projects.name,
      contentText: notes.contentText,
      sourceType: notes.sourceType,
      sourceUrl: notes.sourceUrl,
      mimeType: notes.mimeType,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .innerJoin(projects, eq(projects.id, notes.projectId))
    .where(
      and(
        eq(notes.id, opts.noteId),
        eq(notes.workspaceId, opts.workspaceId),
        isNull(notes.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    contentText: clip(row.contentText, CONTENT_MAX),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMcpProjects(opts: { workspaceId: string; limit: number }) {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      defaultRole: projects.defaultRole,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.workspaceId, opts.workspaceId))
    .orderBy(desc(projects.updatedAt))
    .limit(opts.limit);
  return {
    projects: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}
```

- [ ] **Step 4: Run read service tests**

Run:

```bash
pnpm --filter @opencairn/api test -- mcp-server/tools.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/mcp-server/search.ts apps/api/tests/mcp-server/tools.test.ts
git commit -m "feat(api): add mcp server read services"
```

---

### Task 6: Streamable HTTP MCP Endpoint

**Files:**
- Create: `apps/api/src/lib/mcp-server/metadata.ts`
- Create: `apps/api/src/lib/mcp-server/server.ts`
- Modify: `apps/api/src/routes/mcp-server.ts`
- Test: `apps/api/tests/mcp-server/tools.test.ts`

- [ ] **Step 1: Extend tests for bearer auth, metadata, and MCP tools**

Append to `apps/api/tests/mcp-server/tools.test.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../../src/app";
import { generateMcpToken, hashMcpToken, redactMcpToken } from "../../src/lib/mcp-server/token";
import { mcpServerTokens } from "@opencairn/db";

describe("OpenCairn MCP HTTP endpoint", () => {
  it("returns protected-resource metadata", async () => {
    process.env.FEATURE_MCP_SERVER = "true";
    process.env.API_PUBLIC_URL = "https://api.example.com";
    const app = createApp();
    const res = await app.request("/.well-known/oauth-protected-resource/api/mcp");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe("https://api.example.com/api/mcp");
    expect(body.scopes_supported).toEqual(["workspace:read"]);
    delete process.env.API_PUBLIC_URL;
    delete process.env.FEATURE_MCP_SERVER;
  });

  it("returns 401 with resource metadata challenge when bearer token is missing", async () => {
    process.env.FEATURE_MCP_SERVER = "true";
    const app = createApp();
    const res = await app.request("/api/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
    delete process.env.FEATURE_MCP_SERVER;
  });

  it("serves list_projects through the MCP SDK client", async () => {
    process.env.FEATURE_MCP_SERVER = "true";
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed.cleanup);
    const token = generateMcpToken();
    await db.insert(mcpServerTokens).values({
      workspaceId: seed.workspaceId,
      createdByUserId: seed.userId,
      label: "SDK test",
      tokenHash: hashMcpToken(token),
      tokenPrefix: redactMcpToken(token),
      scopes: ["workspace:read"],
    });

    const app = createApp();
    const transport = new StreamableHTTPClientTransport(
      new URL("http://localhost/api/mcp"),
      {
        fetch: (input, init) =>
          app.request(input instanceof URL ? input.pathname : String(input), {
            ...init,
            headers: {
              ...(init?.headers ?? {}),
              authorization: `Bearer ${token}`,
            },
          }),
      },
    );
    const client = new Client({ name: "opencairn-test", version: "0.1.0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["list_projects", "search_notes", "get_note"]),
      );
      const result = await client.callTool({
        name: "list_projects",
        arguments: { limit: 10 },
      });
      expect(JSON.stringify(result.content)).toContain(seed.projectId);
    } finally {
      await client.close();
      delete process.env.FEATURE_MCP_SERVER;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencairn/api test -- mcp-server/tools.test.ts
```

Expected: fail because metadata and MCP transport are not implemented.

- [ ] **Step 3: Add protected-resource metadata helper**

Create `apps/api/src/lib/mcp-server/metadata.ts`:

```ts
const DEFAULT_LOCAL_API = "http://localhost:4000";

export function apiPublicUrl(): string {
  return (
    process.env.MCP_SERVER_PUBLIC_URL ??
    process.env.API_PUBLIC_URL ??
    process.env.API_URL ??
    DEFAULT_LOCAL_API
  ).replace(/\/+$/, "");
}

export function mcpResourceUrl(): string {
  return `${apiPublicUrl()}/api/mcp`;
}

export function protectedResourceMetadata() {
  const resource = mcpResourceUrl();
  return {
    resource,
    authorization_servers: [apiPublicUrl()],
    scopes_supported: ["workspace:read"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${apiPublicUrl()}/docs/mcp`,
  };
}

export function bearerChallenge(): string {
  const metadataUrl = `${apiPublicUrl()}/.well-known/oauth-protected-resource/api/mcp`;
  return `Bearer resource_metadata="${metadataUrl}", scope="workspace:read"`;
}
```

- [ ] **Step 4: Add MCP auth + server factory**

Create `apps/api/src/lib/mcp-server/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  McpGetNoteInputSchema,
  McpListProjectsInputSchema,
  McpSearchNotesInputSchema,
} from "@opencairn/shared";
import { and, db, eq, gt, isNull, mcpServerTokens, or, sql } from "@opencairn/db";
import { z } from "zod";
import { bearerChallenge, mcpResourceUrl } from "./metadata";
import { getMcpNote, listMcpProjects, searchMcpNotes } from "./search";
import { hashMcpToken, isMcpTokenFormat } from "./token";

type McpAccess = {
  tokenId: string;
  workspaceId: string;
  scopes: string[];
};

function jsonText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function accessFromExtra(authInfo: AuthInfo | undefined): McpAccess {
  const access = authInfo?.extra?.opencairnAccess as McpAccess | undefined;
  if (!access?.workspaceId) throw new Error("MCP access context missing");
  return access;
}

export async function validateMcpBearer(request: Request): Promise<AuthInfo | Response> {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() ?? "";
  if (!isMcpTokenFormat(token)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": bearerChallenge(),
      },
    });
  }
  const [row] = await db
    .select()
    .from(mcpServerTokens)
    .where(
      and(
        eq(mcpServerTokens.tokenHash, hashMcpToken(token)),
        isNull(mcpServerTokens.revokedAt),
        or(isNull(mcpServerTokens.expiresAt), gt(mcpServerTokens.expiresAt, sql`now()`)),
      ),
    )
    .limit(1);
  if (!row) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": bearerChallenge(),
      },
    });
  }
  await db
    .update(mcpServerTokens)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(mcpServerTokens.id, row.id));
  return {
    token,
    clientId: row.label,
    scopes: row.scopes,
    resource: new URL(mcpResourceUrl()),
    extra: {
      opencairnAccess: {
        tokenId: row.id,
        workspaceId: row.workspaceId,
        scopes: row.scopes,
      } satisfies McpAccess,
    },
  };
}

export function createOpenCairnMcpServer() {
  const server = new McpServer({
    name: "opencairn",
    version: "0.1.0",
  });

  server.registerTool(
    "search_notes",
    {
      title: "Search OpenCairn notes",
      description: "Hybrid search over notes in the authorized OpenCairn workspace.",
      inputSchema: McpSearchNotesInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      const access = accessFromExtra(extra.authInfo);
      const input = McpSearchNotesInputSchema.parse(args);
      return jsonText({
        results: await searchMcpNotes({
          workspaceId: access.workspaceId,
          query: input.query,
          limit: input.limit,
          projectId: input.projectId,
        }),
      });
    },
  );

  server.registerTool(
    "get_note",
    {
      title: "Get OpenCairn note",
      description: "Fetch one note from the authorized OpenCairn workspace.",
      inputSchema: McpGetNoteInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      const access = accessFromExtra(extra.authInfo);
      const input = McpGetNoteInputSchema.parse(args);
      const note = await getMcpNote({
        workspaceId: access.workspaceId,
        noteId: input.noteId,
      });
      if (!note) throw new Error("Note not found");
      return jsonText(note);
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List OpenCairn projects",
      description: "List projects in the authorized OpenCairn workspace.",
      inputSchema: McpListProjectsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      const access = accessFromExtra(extra.authInfo);
      const input = McpListProjectsInputSchema.parse(args ?? {});
      return jsonText(
        await listMcpProjects({
          workspaceId: access.workspaceId,
          limit: input.limit,
        }),
      );
    },
  );

  return server;
}

export async function handleOpenCairnMcpRequest(request: Request): Promise<Response> {
  const authInfo = await validateMcpBearer(request);
  if (authInfo instanceof Response) return authInfo;
  const server = createOpenCairnMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(request, { authInfo });
}
```

- [ ] **Step 5: Mount metadata and MCP endpoint**

Modify `apps/api/src/routes/mcp-server.ts`:

```ts
import {
  handleOpenCairnMcpRequest,
} from "../lib/mcp-server/server";
import {
  protectedResourceMetadata,
} from "../lib/mcp-server/metadata";

mcpServerRoutes.get("/", async (c) => handleOpenCairnMcpRequest(c.req.raw));
mcpServerRoutes.post("/", async (c) => handleOpenCairnMcpRequest(c.req.raw));
mcpServerRoutes.delete("/", async (c) => handleOpenCairnMcpRequest(c.req.raw));

export const mcpMetadataRoutes = new Hono<AppEnv>();
mcpMetadataRoutes.get("/oauth-protected-resource", (c) =>
  c.json(protectedResourceMetadata()),
);
mcpMetadataRoutes.get("/oauth-protected-resource/api/mcp", (c) =>
  c.json(protectedResourceMetadata()),
);
```

Modify `apps/api/src/app.ts`:

```ts
import { mcpMetadataRoutes, mcpServerRoutes } from "./routes/mcp-server";

app.route("/.well-known", mcpMetadataRoutes);
app.route("/api/mcp/servers", mcpRoutes);
app.route("/api/mcp", mcpServerRoutes);
```

- [ ] **Step 6: Run MCP endpoint tests**

Run:

```bash
pnpm --filter @opencairn/api test -- mcp-server/tools.test.ts mcp-server/routes.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/mcp-server/metadata.ts apps/api/src/lib/mcp-server/server.ts apps/api/src/routes/mcp-server.ts apps/api/src/app.ts apps/api/tests/mcp-server/tools.test.ts
git commit -m "feat(api): expose read-only mcp server"
```

---

### Task 7: Settings Token UX

**Files:**
- Create: `apps/web/src/lib/api/mcp-server-tokens.ts`
- Create: `apps/web/src/components/settings/mcp/McpServerTokenCard.tsx`
- Modify: `apps/web/src/components/settings/mcp/McpSettingsClient.tsx`
- Modify: `apps/web/messages/ko/settings.json`
- Modify: `apps/web/messages/en/settings.json`
- Test: `apps/web/src/components/settings/mcp/McpServerTokenCard.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `apps/web/src/components/settings/mcp/McpServerTokenCard.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { McpServerTokenCard } from "./McpServerTokenCard";
import * as api from "@/lib/api/mcp-server-tokens";

vi.mock("@/lib/api/mcp-server-tokens");

const messages = {
  settings: {
    mcp: {
      server_tokens: {
        heading: "OpenCairn MCP access tokens",
        description: "Create read-only workspace tokens for external MCP clients.",
        label: "Label",
        placeholder: "Claude Code",
        create: "Create token",
        created: "Token created",
        copy_once: "Copy this token now. It will not be shown again.",
        empty: "No tokens yet.",
        revoke: "Revoke",
        revoked: "Token revoked.",
        load_failed: "Could not load tokens.",
      },
    },
  },
};

function renderCard() {
  const qc = new QueryClient();
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={qc}>
        <McpServerTokenCard workspaceId="11111111-1111-4111-8111-111111111111" />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("McpServerTokenCard", () => {
  it("creates a token and displays plaintext once", async () => {
    vi.mocked(api.listMcpServerTokens).mockResolvedValue({ tokens: [] });
    vi.mocked(api.createMcpServerToken).mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      label: "Claude Code",
      token: "ocmcp_" + "a".repeat(43),
      tokenPrefix: "ocmcp_aaaa",
      scopes: ["workspace:read"],
      expiresAt: null,
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    renderCard();
    await userEvent.type(await screen.findByLabelText("Label"), "Claude Code");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText(/ocmcp_/)).toBeInTheDocument();
    expect(screen.getByText("Copy this token now. It will not be shown again.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencairn/web test -- McpServerTokenCard.test.tsx
```

Expected: fail because the API client and component do not exist.

- [ ] **Step 3: Add web API client**

Create `apps/web/src/lib/api/mcp-server-tokens.ts`:

```ts
import type { McpTokenCreated, McpTokenCreate, McpTokenSummary } from "@opencairn/shared";

export type McpWorkspaceOption = {
  id: string;
  slug: string;
  name: string;
  role: string;
};

export const mcpServerTokensQueryKey = (workspaceId: string) =>
  ["mcp-server-tokens", workspaceId] as const;

export const mcpTokenWorkspacesQueryKey = ["mcp-token-workspaces"] as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`mcp token request failed (${res.status})`);
  return (await res.json()) as T;
}

export async function listMcpServerTokens(workspaceId: string) {
  return request<{ tokens: McpTokenSummary[] }>(
    `/api/mcp/tokens?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

export async function createMcpServerToken(input: McpTokenCreate) {
  return request<McpTokenCreated>("/api/mcp/tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function revokeMcpServerToken(id: string) {
  return request<{ ok: true }>(`/api/mcp/tokens/${id}`, { method: "DELETE" });
}

export async function listMcpTokenWorkspaces() {
  const data = await request<{ workspaces: McpWorkspaceOption[] }>("/api/workspaces/me");
  return data.workspaces;
}
```

- [ ] **Step 4: Add token card component**

Create `apps/web/src/components/settings/mcp/McpServerTokenCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createMcpServerToken,
  listMcpServerTokens,
  mcpServerTokensQueryKey,
  revokeMcpServerToken,
} from "@/lib/api/mcp-server-tokens";

export function McpServerTokenCard({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("settings.mcp.server_tokens");
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const query = useQuery({
    queryKey: mcpServerTokensQueryKey(workspaceId),
    queryFn: () => listMcpServerTokens(workspaceId),
  });

  const create = useMutation({
    mutationFn: () =>
      createMcpServerToken({
        workspaceId,
        label: label.trim(),
        expiresAt: null,
      }),
    onSuccess: (created) => {
      setCreatedToken(created.token);
      setLabel("");
      void qc.invalidateQueries({ queryKey: mcpServerTokensQueryKey(workspaceId) });
      toast.success(t("created"));
    },
  });

  const revoke = useMutation({
    mutationFn: revokeMcpServerToken,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mcpServerTokensQueryKey(workspaceId) });
      toast.success(t("revoked"));
    },
  });

  return (
    <section className="rounded-lg border border-border p-6">
      <h2 className="text-base font-medium">{t("heading")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (label.trim()) create.mutate();
        }}
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span>{t("label")}</span>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t("placeholder")}
          />
        </label>
        <Button className="self-end" type="submit" disabled={!label.trim() || create.isPending}>
          {t("create")}
        </Button>
      </form>
      {createdToken ? (
        <div className="mt-4 rounded-md border border-border bg-muted p-3">
          <p className="text-sm font-medium">{t("copy_once")}</p>
          <code className="mt-2 block break-all rounded bg-background p-2 text-xs">
            {createdToken}
          </code>
        </div>
      ) : null}
      {query.isError ? (
        <p className="mt-4 text-sm text-destructive">{t("load_failed")}</p>
      ) : query.data?.tokens.length ? (
        <ul className="mt-4 divide-y divide-border">
          {query.data.tokens.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium">{token.label}</p>
                <p className="font-mono text-xs text-muted-foreground">{token.tokenPrefix}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => revoke.mutate(token.id)}
                disabled={revoke.isPending || token.revokedAt !== null}
              >
                {t("revoke")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </section>
  );
}
```

Modify `apps/web/src/components/settings/mcp/McpSettingsClient.tsx` to render the token card below the existing external MCP client registration UI. Add a small workspace selector in this settings page instead of assuming an app-shell workspace context. Use `listMcpTokenWorkspaces()` from the new API client, keep only workspaces with role `owner` or `admin` in the selector, default to the first eligible workspace, and render a disabled empty state when the signed-in user has no admin workspace. The server route still enforces workspace admin permission on every token operation, so the client-side role filter is only UX.

Implementation shape:

```tsx
const workspacesQuery = useQuery({
  queryKey: mcpTokenWorkspacesQueryKey,
  queryFn: listMcpTokenWorkspaces,
});
const adminWorkspaces = (workspacesQuery.data ?? []).filter((workspace) =>
  ["owner", "admin"].includes(workspace.role),
);
const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

useEffect(() => {
  if (!selectedWorkspaceId && adminWorkspaces[0]) {
    setSelectedWorkspaceId(adminWorkspaces[0].id);
  }
}, [adminWorkspaces, selectedWorkspaceId]);

return (
  <>
    {/* existing external MCP client settings UI */}
    <section className="rounded-lg border border-border p-6">
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("server_tokens.workspace")}</span>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={selectedWorkspaceId ?? ""}
          onChange={(event) => setSelectedWorkspaceId(event.target.value)}
          disabled={adminWorkspaces.length === 0}
        >
          {adminWorkspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </label>
      {selectedWorkspaceId ? (
        <McpServerTokenCard workspaceId={selectedWorkspaceId} />
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("server_tokens.no_admin_workspace")}
        </p>
      )}
    </section>
  </>
);
```

- [ ] **Step 5: Add i18n keys**

Modify both `apps/web/messages/ko/settings.json` and `apps/web/messages/en/settings.json` under `mcp.server_tokens` with the keys used above. Korean copy should use 존댓말 and should not mention competitors.

- [ ] **Step 6: Run UI and i18n checks**

Run:

```bash
pnpm --filter @opencairn/web test -- McpServerTokenCard.test.tsx
pnpm --filter @opencairn/web i18n:parity
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api/mcp-server-tokens.ts apps/web/src/components/settings/mcp/McpServerTokenCard.tsx apps/web/src/components/settings/mcp/McpSettingsClient.tsx apps/web/src/components/settings/mcp/McpServerTokenCard.test.tsx apps/web/messages/ko/settings.json apps/web/messages/en/settings.json
git commit -m "feat(web): add mcp server token settings"
```

---

### Task 8: Docs, Env, And Contract

**Files:**
- Modify: `.env.example`
- Modify: `docs/architecture/api-contract.md`
- Create: `docs/architecture/mcp-server.md`

- [ ] **Step 1: Update env example**

Add:

```dotenv
# OpenCairn-as-MCP-server. Exposes read-only workspace tools at /api/mcp.
# Default OFF for OSS/self-host until the operator intentionally issues tokens.
FEATURE_MCP_SERVER=false

# Public API base used in OAuth Protected Resource Metadata.
# Example: https://api.opencairn.example
MCP_SERVER_PUBLIC_URL=
```

- [ ] **Step 2: Update API contract**

Add a section near the existing MCP Client section in `docs/architecture/api-contract.md`:

```md
### MCP Server Read-Only Phase 1 (feature-flag `FEATURE_MCP_SERVER`)

OpenCairn exposes a Streamable HTTP MCP endpoint for external agent clients.
The endpoint is read-only in Phase 1 and uses workspace-scoped bearer tokens
created by workspace admins.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET/POST/DELETE | `/api/mcp` | MCP bearer token | Streamable HTTP MCP endpoint. Tools: `search_notes`, `get_note`, `list_projects`. |
| GET | `/.well-known/oauth-protected-resource` | none | OAuth Protected Resource Metadata. |
| GET | `/.well-known/oauth-protected-resource/api/mcp` | none | Path-specific OAuth Protected Resource Metadata. |
| GET | `/api/mcp/tokens?workspaceId=` | workspace admin | List read-only MCP access tokens. Token plaintext is never returned. |
| POST | `/api/mcp/tokens` | workspace admin | Create a read-only token. Plaintext token is returned once. |
| DELETE | `/api/mcp/tokens/:id` | workspace admin | Revoke a token. Cross-workspace ids return 404. |

Phase 1 intentionally does not expose write tools, import tools, full OAuth
authorization-code flow, stdio transport, or provider-specific connector UX.
```

- [ ] **Step 3: Add operator note**

Create `docs/architecture/mcp-server.md` with:

```md
# OpenCairn MCP Server

Endpoint: `/api/mcp`

Phase 1 tools:
- `search_notes`
- `get_note`
- `list_projects`

Auth:
- Create a workspace token in Settings > MCP servers.
- Configure an external MCP client with Streamable HTTP and `Authorization: Bearer <token>`.
- Tokens are workspace-scoped, read-only, revocable, and returned only once.

Hosted operators must set `MCP_SERVER_PUBLIC_URL` so OAuth Protected Resource
Metadata points clients to the correct API origin.
```

- [ ] **Step 4: Run docs grep**

Run:

```bash
rg -n "FEATURE_MCP_SERVER|MCP Server Read-Only|/api/mcp" .env.example docs/architecture/api-contract.md docs/architecture/mcp-server.md
```

Expected: all new public surfaces are documented.

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/architecture/api-contract.md docs/architecture/mcp-server.md
git commit -m "docs(api): document read-only mcp server"
```

---

### Task 9: Final Verification

**Files:**
- No new source files unless a previous task found a defect.

- [ ] **Step 1: Run focused shared/db/api/web tests**

Run:

```bash
pnpm --filter @opencairn/shared test -- mcp-server.test.ts mcp.test.ts
pnpm --filter @opencairn/db test -- mcp-server-tokens.test.ts user-mcp-servers.test.ts
pnpm --filter @opencairn/api test -- mcp-server/token.test.ts mcp-server/routes.test.ts mcp-server/tools.test.ts mcp/servers.test.ts
pnpm --filter @opencairn/web test -- McpServerTokenCard.test.tsx McpSettingsClient.test.tsx
```

Expected: all pass. If Windows Vitest fails at startup with `ERR_PACKAGE_IMPORT_NOT_DEFINED: #module-evaluator`, do not classify it as a product failure; rerun in the known-good WSL/CI Node environment and record both the Windows startup error and the successful environment.

- [ ] **Step 2: Run typecheck/build checks**

Run:

```bash
pnpm --filter @opencairn/api build
pnpm --filter @opencairn/web exec tsc --noEmit
pnpm --filter @opencairn/web i18n:parity
```

Expected: all pass.

- [ ] **Step 3: Run migration idempotency check**

Run:

```bash
pnpm --filter @opencairn/db db:generate
git diff --exit-code -- packages/db/drizzle packages/db/drizzle/meta
```

Expected: no new migration diff after the generated migration is committed.

- [ ] **Step 4: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Manual smoke with SDK client**

Start API with `FEATURE_MCP_SERVER=true` and a migrated local database. Create a token through the settings UI, then run a small MCP SDK client against `/api/mcp`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL("http://localhost:4000/api/mcp"), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${process.env.OPENCAIRN_MCP_TOKEN}`,
    },
  },
});
const client = new Client({ name: "opencairn-smoke", version: "0.1.0" });
await client.connect(transport);
console.log(await client.listTools());
console.log(await client.callTool({ name: "list_projects", arguments: { limit: 10 } }));
await client.close();
```

Expected: the client lists `search_notes`, `get_note`, and `list_projects`; `list_projects` returns only the authorized workspace's projects.

- [ ] **Step 6: Final commit**

If previous tasks were committed separately, do not squash unless the reviewer asks. If implementing in one branch without intermediate commits, commit once:

```bash
git status --short
git add packages/shared packages/db apps/api apps/web .env.example docs/architecture
git commit -m "feat(api): expose read-only mcp server"
```

---

## Follow-Ups Not In Phase 1

- Full OAuth 2.1 authorization-code + PKCE server flow for remote MCP clients.
- Stdio local proxy package.
- MCP Resources and Prompts.
- Write tools such as `create_note`, `start_research`, `create_project`, `start_ingest`.
- Generic MCP output import into OpenCairn.
- Provider-specific Drive/GitHub/Notion import UX.
- `docs/contributing/plans-status.md` update before the implementation PR is merged.

## Current Worktree Baseline Note

The plan worktree was created at:

```text
C:\Users\Sungbin\Documents\GitHub\opencairn-monorepo\.worktrees\plan-mcp-server-phase-1
```

Setup command:

```bash
pnpm install --frozen-lockfile
```

Current Windows PowerShell baseline attempts:

```bash
pnpm --filter @opencairn/shared test -- mcp.test.ts
pnpm --filter @opencairn/api test -- mcp/servers.test.ts
```

Both currently stop before running tests with:

```text
TypeError [ERR_PACKAGE_IMPORT_NOT_DEFINED]: Package import specifier "#module-evaluator" is not defined
```

Evidence gathered:
- Node: `v22.17.0`
- pnpm: `9.15.0`
- Vitest package: `4.1.5`
- `vitest/package.json` contains the expected `imports["#module-evaluator"]` entry.
- The startup error occurs before OpenCairn test code loads.

Implementation should verify in WSL/CI if this Windows worktree startup issue persists.
