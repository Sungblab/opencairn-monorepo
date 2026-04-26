# Deep Research Phase E — BYOK Settings · E2E Activation · Prod Release — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. After each major step, run `opencairn:post-feature` to verify before moving on.

**Spec:** `docs/superpowers/specs/2026-04-26-deep-research-phase-e-design.md` (§2 Goals/Non-Goals, §4 Components, §5 Data Flow, §6 Errors, §7 i18n, §8 Testing, §9 Rollout)

**Phases A~D complete:**
- A — `packages/llm` Interactions wrapper (PRs #2/#4 merged)
- B — DB migration 0013 + Temporal workflow + 4 activities (PR #3 merged)
- C — `apps/api/src/routes/research.ts` + SSE (PRs #6/#7/#8/#9 merged)
- D — `/research` UI + Plate `research-meta` block (PR #32 merged)

**Goal:** Ship the BYOK Gemini-key registration UI at `/[locale]/app/settings/ai` (with matching API endpoints), activate `research-smoke.spec.ts` in CI by injecting `FEATURE_DEEP_RESEARCH=true` into the Playwright web server, run a native English copy review, and stop — leaving the prod flag flip as a manual env change post-merge.

**Architecture:** API extends `apps/api/src/routes/users.ts` with three endpoints (`GET/PUT/DELETE /me/byok-key`) that read from / write to the existing `user_preferences.byokApiKeyEncrypted` column via the existing `encryptToken`/`decryptToken` helpers (wire-compatible with the worker's `decrypt_token`). Web adds a single client-side card (`ByokKeyCard`) wrapped by a thin Server Component page; both go through TanStack Query + a small `api-client-byok-key.ts` wrapper. Toasts use the already-mounted Sonner instance; the delete confirmation reuses the existing `@base-ui/react/dialog` primitive (no new deps). Provider/model selection stays env-only — there is no UI for it.

**Tech Stack:** Hono 4 · Drizzle ORM (`bytea` column) · Zod 3.24 · Vitest 4 · TanStack Query v5 · Next.js 16 (App Router · RSC) · `next-intl` v4 · `@base-ui/react/dialog` · Sonner · Playwright 1.59

**Branch:** `feat/deep-research-phase-e` off `main` (HEAD `f72044f`).

---

## Constraints, gotchas, and non-negotiables

Before writing any code, internalize these — they are the things this plan is shaped around:

1. **ESM `.js` extension imports in API tests.** `apps/api` is `"type": "module"` and tests use TypeScript with explicit `.js` extensions: `from "../src/app.js"`, `from "./helpers/seed.js"`. Source code uses the same convention. Don't write `from "../src/app"` — Vitest resolves it but at-build it will fail.

2. **Hono Zod validator surfaces a typed error block.** Use `zValidator("json", schema, (result, c) => { ... })` with an explicit handler that returns a JSON 400 with `{ error: "invalid_input", code: <first issue path> }`. The first issue's `message` is what we set in the schema (`too_short`/`too_long`/`wrong_prefix`).

3. **`bytea` Drizzle column ↔ Node `Buffer`.** `encryptToken` returns `Buffer`; Drizzle's `bytea` accepts `Buffer` directly. Do NOT convert to/from base64 at this boundary — the worker's `decrypt_token` reads the raw bytes (wire layout is `iv(12) || tag(16) || ct`).

4. **Crypto env var.** `INTEGRATION_TOKEN_ENCRYPTION_KEY` (base64-encoded 32 bytes). The same key encrypts both OAuth tokens and BYOK keys. Both `apps/api` and `apps/worker` must have it set in their `.env`. Tests load it via `vitest.config.ts`'s `configDotenv()`.

5. **Sonner already mounted.** Import `{ toast }` from `"sonner"` and call `toast.success("...")` / `toast.error("...")` directly inside event handlers. No provider setup needed (`<Toaster />` lives in the root layout).

6. **`@base-ui/react/dialog` ≠ AlertDialog.** Base UI does not ship a separate AlertDialog primitive. We compose a destructive-action dialog using the existing `<Dialog>` wrapper (in `components/ui/dialog.tsx`) with a custom title + body + Cancel/Delete buttons. Pattern is identical to AlertDialog conceptually.

7. **next-intl namespace registration is two-step.** Both the import in `apps/web/src/i18n.ts` and the messages object key. Missing either side ⇒ runtime "Could not resolve namespace" error.

8. **`setRequestLocale(locale)` is required in Server Components** for next-intl to read static rendering correctly. Skipping it bricks the page on locale-prefixed routes.

9. **Auth guard pattern.** Mirror `apps/web/src/app/[locale]/onboarding/page.tsx:60-73`: read `cookies()`, hit `${INTERNAL_API_URL}/api/auth/me`, redirect to `/${locale}/auth/login?return_to=...` on 401. Do NOT trust client-side checks — RSC enforces auth on first render.

10. **Playwright `webServer.env`.** The Playwright config in `apps/web/playwright.config.ts` declares two servers (web 3000, api 4000). Phase E injects `FEATURE_DEEP_RESEARCH: "true"` into the **web** server only — `research-smoke.spec.ts` mocks `/api/research/*` via fetch interceptor, so the API never sees those routes. (Documented in spec §8.3.2.)

11. **`/settings/ai` is NOT gated by `FEATURE_DEEP_RESEARCH`.** Users may want to register a BYOK key in advance. The page is always reachable when authenticated. Only `/research/*` routes and the sidebar entry are gated.

12. **No live key validation.** Saving a BYOK key does not call the Gemini API. Spec §6.1 worker fail-fast contract is the validation. Do not add `fetch("https://generativelanguage.googleapis.com/...")` to the PUT path.

13. **`lastFour` is computed at read time.** No DB column. The GET handler decrypts and slices `apiKey.slice(-4)`. PUT response includes `lastFour` from the just-encrypted plaintext (no extra decrypt round-trip).

---

## File map

### New files

| Path | Role |
|---|---|
| `apps/api/tests/byok-key.test.ts` | API unit: GET/PUT/DELETE `/me/byok-key` covering empty / valid / invalid / lifecycle |
| `apps/web/src/lib/api-client-byok-key.ts` | Typed wrappers + TanStack Query keys for the 3 endpoints |
| `apps/web/src/lib/api-client-byok-key.test.ts` | Wrapper unit tests with `fetch` mock |
| `apps/web/src/components/settings/ByokKeyCard.tsx` | The form / masked / delete-confirm card (client component) |
| `apps/web/src/components/settings/ByokKeyCard.test.tsx` | RTL tests for the card |
| `apps/web/src/app/[locale]/app/settings/ai/page.tsx` | Server Component — auth guard + render `<ByokKeyCard />` |
| `apps/web/messages/ko/settings.json` | New i18n namespace (ko) |
| `apps/web/messages/en/settings.json` | Same namespace (en, native review applied) |
| `apps/web/tests/e2e/settings-ai.spec.ts` | E2E: register → masked → replace → delete |
| `docs/superpowers/plans/2026-04-26-deep-research-phase-e-byok-and-release.md` | (this file — already created when reading this) |

### Modified files

| Path | Change |
|---|---|
| `apps/api/src/routes/users.ts` | Add 3 routes: GET/PUT/DELETE `/me/byok-key` + Zod schema |
| `apps/web/src/i18n.ts` | Register `settings` namespace (import + messages map) |
| `apps/web/playwright.config.ts` | Inject `FEATURE_DEEP_RESEARCH: "true"` into web `webServer.env` |
| `apps/web/messages/en/research.json` | Native review copy pass (keys unchanged) |
| `docs/contributing/plans-status.md` | Mark "Deep Research Phase E (features)" complete on PR merge |
| `CLAUDE.md` | Update "✅ Complete" / "🟡 Active" plan blocks |

### Files NOT touched (spec §2 Non-Goals)

- `apps/web/src/components/sidebar/sidebar-footer.tsx` — sidebar entry stays as-is
- `apps/api/src/routes/research.ts` — no API changes (Phase C territory)
- `packages/db/src/schema/user-preferences.ts` — column already exists (Plan 13 migration)
- `apps/worker/**` — read-only consumer of the BYOK column
- `.env.example` — `FEATURE_DEEP_RESEARCH` default stays `false` (manual env flip post-merge)

---

## Task ordering rationale

1. **API first (Tasks 1–3)** — testable in isolation with Vitest + DB seed, no UI dependency.
2. **Web client wrapper (Task 4)** — testable with `fetch` mock, no DOM.
3. **i18n setup (Task 5)** — must precede UI tasks because `useTranslations("settings")` blows up at runtime if the namespace isn't registered.
4. **UI component (Task 6)** — RTL tests, mocks the wrapper.
5. **Page route (Task 7)** — minimal Server Component composition, only meaningful via E2E.
6. **E2E (Tasks 8–9)** — settings-ai smoke + research-smoke activation.
7. **Native EN review (Task 10)** — last because keys/structure must already be stable.
8. **Finish (Task 11)** — `plans-status.md`, `CLAUDE.md`, post-feature workflow, PR.

---

## Task 1: API — `GET /me/byok-key`

**Files:**
- Create: `apps/api/tests/byok-key.test.ts`
- Modify: `apps/api/src/routes/users.ts`

- [ ] **Step 1: Write the failing test (GET only)**

Create `apps/api/tests/byok-key.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, userPreferences, eq } from "@opencairn/db";
import { encryptToken } from "../src/lib/integration-tokens.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

describe("GET /api/users/me/byok-key", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    await db
      .delete(userPreferences)
      .where(eq(userPreferences.userId, ctx.userId));
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns registered:false when no row exists", async () => {
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ registered: false });
  });

  it("returns registered:false when row exists with null ciphertext", async () => {
    await db
      .insert(userPreferences)
      .values({ userId: ctx.userId, byokApiKeyEncrypted: null });
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ registered: false });
  });

  it("returns registered:true with lastFour + updatedAt when key exists", async () => {
    const apiKey = "AIzaSyTestFakeKeyForUnitTestXYZ1234abcd";
    await db.insert(userPreferences).values({
      userId: ctx.userId,
      byokApiKeyEncrypted: encryptToken(apiKey),
    });
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(true);
    expect(body.lastFour).toBe("abcd");
    expect(typeof body.updatedAt).toBe("string");
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await app.request("/api/users/me/byok-key", { method: "GET" });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @opencairn/api test -- byok-key`
Expected: 4 failures — route does not exist (Hono returns 404), so `expect(res.status).toBe(200)` fails.

- [ ] **Step 3: Implement the GET route**

Edit `apps/api/src/routes/users.ts` — add imports + the new GET handler at the end of the file, before the export:

```typescript
import { db, eq, user, userPreferences, workspaceMembers, workspaces } from "@opencairn/db";
// ^ add userPreferences to existing import
import { decryptToken, encryptToken } from "../lib/integration-tokens.js";
// ^ new import

// ... existing routes ...

userRoutes.get("/me/byok-key", async (c) => {
  const me = c.get("user");
  const [row] = await db
    .select({
      enc: userPreferences.byokApiKeyEncrypted,
      updatedAt: userPreferences.updatedAt,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, me.id))
    .limit(1);

  if (!row || !row.enc) return c.json({ registered: false });

  const plain = decryptToken(row.enc);
  return c.json({
    registered: true,
    lastFour: plain.slice(-4),
    updatedAt: row.updatedAt.toISOString(),
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- byok-key`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/users.ts apps/api/tests/byok-key.test.ts
git commit -m "feat(api): GET /me/byok-key returns registration status

Adds the read endpoint for the BYOK Gemini key. Decrypts on read to
compute lastFour rather than storing it as a separate column — single-
user reads, negligible cost, no consistency burden.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: API — `PUT /me/byok-key`

**Files:**
- Modify: `apps/api/src/routes/users.ts`
- Modify: `apps/api/tests/byok-key.test.ts`

- [ ] **Step 1: Write the failing tests (PUT)**

Append to `apps/api/tests/byok-key.test.ts`:

```typescript
describe("PUT /api/users/me/byok-key", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    await db
      .delete(userPreferences)
      .where(eq(userPreferences.userId, ctx.userId));
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns 400 with code=too_short when key is too short", async () => {
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "PUT",
      userId: ctx.userId,
      body: JSON.stringify({ apiKey: "AIza1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "invalid_input", code: "too_short" });
  });

  it("returns 400 with code=wrong_prefix when prefix is wrong", async () => {
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "PUT",
      userId: ctx.userId,
      body: JSON.stringify({
        apiKey: "WRONG_PREFIX_TestKeyForPhaseEUnitTestXYZ",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "invalid_input",
      code: "wrong_prefix",
    });
  });

  it("inserts a new row, returns lastFour", async () => {
    const apiKey = "AIzaSyTestPhaseEUnitInsertCase1234wxyz";
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "PUT",
      userId: ctx.userId,
      body: JSON.stringify({ apiKey }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(true);
    expect(body.lastFour).toBe("wxyz");
    expect(typeof body.updatedAt).toBe("string");

    const [row] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, ctx.userId));
    expect(row).toBeDefined();
    expect(row!.byokApiKeyEncrypted).toBeInstanceOf(Buffer);
    expect(decryptToken(row!.byokApiKeyEncrypted!)).toBe(apiKey);
  });

  it("upserts when called twice (no second row, updatedAt advances)", async () => {
    const k1 = "AIzaSyTestPhaseEUpsertFirstRoundXYZkey1";
    const k2 = "AIzaSyTestPhaseEUpsertSecondRoundXYZkey2";
    const res1 = await authedFetch("/api/users/me/byok-key", {
      method: "PUT",
      userId: ctx.userId,
      body: JSON.stringify({ apiKey: k1 }),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    // ensure clock advances at least 1ms before the second call
    await new Promise((r) => setTimeout(r, 5));

    const res2 = await authedFetch("/api/users/me/byok-key", {
      method: "PUT",
      userId: ctx.userId,
      body: JSON.stringify({ apiKey: k2 }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.lastFour).toBe("key2");
    expect(new Date(body2.updatedAt).getTime()).toBeGreaterThan(
      new Date(body1.updatedAt).getTime(),
    );

    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, ctx.userId));
    expect(rows).toHaveLength(1);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await app.request("/api/users/me/byok-key", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "AIzaSy_anything" }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/api test -- byok-key`
Expected: 5 new failures (PUT returns 404 / wrong shape).

- [ ] **Step 3: Implement the PUT route**

In `apps/api/src/routes/users.ts`, add the schema near the top (with the existing `lastViewedSchema`) and the PUT handler:

```typescript
const setByokKeySchema = z.object({
  apiKey: z
    .string()
    .min(20, { message: "too_short" })
    .max(200, { message: "too_long" })
    .startsWith("AIza", { message: "wrong_prefix" }),
});

userRoutes.put(
  "/me/byok-key",
  zValidator("json", setByokKeySchema, (result, c) => {
    if (!result.success) {
      const code = result.error.issues[0]?.message ?? "invalid_input";
      return c.json({ error: "invalid_input", code }, 400);
    }
  }),
  async (c) => {
    const me = c.get("user");
    const { apiKey } = c.req.valid("json");
    const ciphertext = encryptToken(apiKey);
    const now = new Date();

    await db
      .insert(userPreferences)
      .values({
        userId: me.id,
        byokApiKeyEncrypted: ciphertext,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          byokApiKeyEncrypted: ciphertext,
          updatedAt: now,
        },
      });

    return c.json({
      registered: true,
      lastFour: apiKey.slice(-4),
      updatedAt: now.toISOString(),
    });
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- byok-key`
Expected: 9 passing (4 GET + 5 PUT).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/users.ts apps/api/tests/byok-key.test.ts
git commit -m "feat(api): PUT /me/byok-key encrypts and upserts BYOK key

Validates with Zod (length + AIza prefix) and surfaces the first issue's
message as a stable code (too_short / too_long / wrong_prefix). Reuses
encryptToken for byte compatibility with the worker's decrypt_token.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: API — `DELETE /me/byok-key`

**Files:**
- Modify: `apps/api/src/routes/users.ts`
- Modify: `apps/api/tests/byok-key.test.ts`

- [ ] **Step 1: Write the failing tests (DELETE)**

Append to `apps/api/tests/byok-key.test.ts`:

```typescript
describe("DELETE /api/users/me/byok-key", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    await db
      .delete(userPreferences)
      .where(eq(userPreferences.userId, ctx.userId));
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("nulls out the ciphertext when a row exists", async () => {
    await db.insert(userPreferences).values({
      userId: ctx.userId,
      byokApiKeyEncrypted: encryptToken("AIzaSyTestPhaseEDeleteFlow1234abcd"),
    });
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "DELETE",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ registered: false });

    const [row] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, ctx.userId));
    expect(row!.byokApiKeyEncrypted).toBeNull();
  });

  it("is idempotent when no row exists (returns 200)", async () => {
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "DELETE",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ registered: false });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await app.request("/api/users/me/byok-key", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/api test -- byok-key`
Expected: 3 new failures.

- [ ] **Step 3: Implement the DELETE route**

In `apps/api/src/routes/users.ts`:

```typescript
userRoutes.delete("/me/byok-key", async (c) => {
  const me = c.get("user");
  await db
    .update(userPreferences)
    .set({ byokApiKeyEncrypted: null, updatedAt: new Date() })
    .where(eq(userPreferences.userId, me.id));
  return c.json({ registered: false });
});
```

(Idempotent — `update` with no matching row is a no-op, and we return the same shape regardless.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- byok-key`
Expected: 12 passing total.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/users.ts apps/api/tests/byok-key.test.ts
git commit -m "feat(api): DELETE /me/byok-key clears the BYOK key

Idempotent — safe to call when no row exists. Sets byokApiKeyEncrypted
to NULL rather than deleting the row so other user_preferences columns
(llm_provider, llm_model, etc.) are preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Web — `api-client-byok-key.ts` wrapper

**Files:**
- Create: `apps/web/src/lib/api-client-byok-key.ts`
- Create: `apps/web/src/lib/api-client-byok-key.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/api-client-byok-key.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  byokKeyQueryKey,
  getByokKey,
  setByokKey,
  deleteByokKey,
} from "./api-client-byok-key";

describe("api-client-byok-key", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("byokKeyQueryKey is a stable tuple", () => {
    expect(byokKeyQueryKey()).toEqual(["byok-key"]);
  });

  it("getByokKey returns parsed body on 200", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          registered: true,
          lastFour: "abcd",
          updatedAt: "2026-04-26T10:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await getByokKey();
    expect(result).toEqual({
      registered: true,
      lastFour: "abcd",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/users/me/byok-key",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("getByokKey throws on non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );
    await expect(getByokKey()).rejects.toThrow(/byok-key/i);
  });

  it("setByokKey posts body and returns parsed response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          registered: true,
          lastFour: "wxyz",
          updatedAt: "2026-04-26T10:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await setByokKey("AIzaSyTestPhaseEClientWxyz");
    expect(result.lastFour).toBe("wxyz");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/users/me/byok-key",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ apiKey: "AIzaSyTestPhaseEClientWxyz" }),
      }),
    );
  });

  it("setByokKey forwards 400 error code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "invalid_input", code: "wrong_prefix" }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(setByokKey("not_a_key")).rejects.toMatchObject({
      code: "wrong_prefix",
    });
  });

  it("deleteByokKey returns parsed response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ registered: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await deleteByokKey();
    expect(result).toEqual({ registered: false });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/users/me/byok-key",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @opencairn/web test:unit -- api-client-byok-key`
Expected: ALL fail — module does not exist.

- [ ] **Step 3: Implement the wrapper**

Create `apps/web/src/lib/api-client-byok-key.ts`:

```typescript
// Tiny typed wrapper for the BYOK Gemini key endpoints. Discriminated
// union on `registered` keeps lastFour optional at the type level so
// consumers don't need null-checks for the empty case.

export type ByokKeyStatus =
  | { registered: false }
  | { registered: true; lastFour: string; updatedAt: string };

export class ByokKeyApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ByokKeyApiError";
  }
}

export const byokKeyQueryKey = () => ["byok-key"] as const;

const BASE = "/api/users/me/byok-key";

async function unwrap(res: Response): Promise<unknown> {
  if (res.ok) return res.json();
  let code = "unknown";
  try {
    const body = await res.json();
    if (typeof body === "object" && body && "code" in body) {
      code = String((body as { code: unknown }).code);
    }
  } catch {
    /* fallthrough */
  }
  throw new ByokKeyApiError(
    code,
    `byok-key request failed (${res.status} ${code})`,
  );
}

export async function getByokKey(): Promise<ByokKeyStatus> {
  const res = await fetch(BASE, {
    method: "GET",
    credentials: "include",
  });
  return (await unwrap(res)) as ByokKeyStatus;
}

export async function setByokKey(apiKey: string): Promise<ByokKeyStatus> {
  const res = await fetch(BASE, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  return (await unwrap(res)) as ByokKeyStatus;
}

export async function deleteByokKey(): Promise<{ registered: false }> {
  const res = await fetch(BASE, {
    method: "DELETE",
    credentials: "include",
  });
  return (await unwrap(res)) as { registered: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/web test:unit -- api-client-byok-key`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api-client-byok-key.ts apps/web/src/lib/api-client-byok-key.test.ts
git commit -m "feat(web): api-client-byok-key wrapper

Typed wrappers for the 3 BYOK endpoints with a discriminated-union
status type and a custom error class that surfaces the API's stable
code field for i18n branching in callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: i18n — `settings` namespace + parity stubs

**Files:**
- Create: `apps/web/messages/ko/settings.json`
- Create: `apps/web/messages/en/settings.json`
- Modify: `apps/web/src/i18n.ts`

- [ ] **Step 1: Create the ko namespace**

Create `apps/web/messages/ko/settings.json`:

```json
{
  "ai": {
    "title": "AI 설정",
    "subtitle": "Deep Research에 사용할 Gemini API 키를 관리합니다.",
    "byok": {
      "heading": "Gemini API 키",
      "description": "직접 등록한 키로 Deep Research를 호출합니다. 비용은 Google이 사용자의 Google Cloud 계정에 청구합니다.",
      "input_label": "API 키",
      "input_placeholder": "AIza…",
      "save": "저장",
      "saving": "저장 중…",
      "saved": "키가 저장되었습니다.",
      "registered_label": "등록된 키",
      "last_updated": "마지막 업데이트",
      "replace": "교체",
      "delete": "삭제",
      "delete_confirm_title": "API 키를 삭제할까요?",
      "delete_confirm_body": "삭제 후에는 새 리서치를 시작할 때 다시 등록해야 합니다.",
      "delete_confirm_yes": "삭제",
      "delete_confirm_no": "취소",
      "deleting": "삭제 중…",
      "deleted": "키가 삭제되었습니다.",
      "help_text": "Google AI Studio에서 키를 발급할 수 있습니다.",
      "loading": "키 정보를 불러오는 중…",
      "error": {
        "wrong_prefix": "올바른 Gemini API 키 형식이 아닙니다. (AIza로 시작하는 키)",
        "too_short": "키가 너무 짧습니다.",
        "too_long": "키가 너무 깁니다.",
        "save_failed": "저장에 실패했습니다. 잠시 후 다시 시도해주세요.",
        "delete_failed": "삭제에 실패했습니다. 잠시 후 다시 시도해주세요.",
        "load_failed": "키 정보를 불러오지 못했습니다."
      }
    }
  }
}
```

- [ ] **Step 2: Create the en namespace (parity copy, native review applied later in Task 10)**

Create `apps/web/messages/en/settings.json`:

```json
{
  "ai": {
    "title": "AI Settings",
    "subtitle": "Manage the Gemini API key used for Deep Research.",
    "byok": {
      "heading": "Gemini API Key",
      "description": "Deep Research calls Gemini directly with the key you register. Google bills your own Google Cloud account.",
      "input_label": "API key",
      "input_placeholder": "AIza…",
      "save": "Save",
      "saving": "Saving…",
      "saved": "Key saved.",
      "registered_label": "Registered key",
      "last_updated": "Last updated",
      "replace": "Replace",
      "delete": "Delete",
      "delete_confirm_title": "Delete this API key?",
      "delete_confirm_body": "You'll need to register one again before starting a new research run.",
      "delete_confirm_yes": "Delete",
      "delete_confirm_no": "Cancel",
      "deleting": "Deleting…",
      "deleted": "Key deleted.",
      "help_text": "Generate a key from Google AI Studio.",
      "loading": "Loading…",
      "error": {
        "wrong_prefix": "That doesn't look like a Gemini API key (it should start with AIza).",
        "too_short": "Key is too short.",
        "too_long": "Key is too long.",
        "save_failed": "Save failed. Please try again in a moment.",
        "delete_failed": "Delete failed. Please try again in a moment.",
        "load_failed": "Couldn't load key status."
      }
    }
  }
}
```

- [ ] **Step 3: Register the namespace in `apps/web/src/i18n.ts`**

Modify the file. Add `settings` to the `Promise.all` import block AND the `messages` map:

```typescript
// imports
const [
  common,
  landing,
  dashboard,
  sidebar,
  app,
  editor,
  auth,
  collab,
  importMessages,
  onboarding,
  appShell,
  agentPanel,
  research,
  canvas,
  note,
  settings,
] = await Promise.all([
  import(`../messages/${locale}/common.json`).then((m) => m.default),
  import(`../messages/${locale}/landing.json`).then((m) => m.default),
  import(`../messages/${locale}/dashboard.json`).then((m) => m.default),
  import(`../messages/${locale}/sidebar.json`).then((m) => m.default),
  import(`../messages/${locale}/app.json`).then((m) => m.default),
  import(`../messages/${locale}/editor.json`).then((m) => m.default),
  import(`../messages/${locale}/auth.json`).then((m) => m.default),
  import(`../messages/${locale}/collab.json`).then((m) => m.default),
  import(`../messages/${locale}/import.json`).then((m) => m.default),
  import(`../messages/${locale}/onboarding.json`).then((m) => m.default),
  import(`../messages/${locale}/app-shell.json`).then((m) => m.default),
  import(`../messages/${locale}/agent-panel.json`).then((m) => m.default),
  import(`../messages/${locale}/research.json`).then((m) => m.default),
  import(`../messages/${locale}/canvas.json`).then((m) => m.default),
  import(`../messages/${locale}/note.json`).then((m) => m.default),
  import(`../messages/${locale}/settings.json`).then((m) => m.default),
]);

return {
  locale,
  messages: {
    common,
    landing,
    dashboard,
    sidebar,
    app,
    editor,
    auth,
    collab,
    import: importMessages,
    onboarding,
    appShell,
    agentPanel,
    research,
    canvas,
    note,
    settings,
  },
};
```

- [ ] **Step 4: Verify parity**

Run: `pnpm --filter @opencairn/web i18n:parity`
Expected: PASS — both files have the same key set.

- [ ] **Step 5: Commit**

```bash
git add apps/web/messages/ko/settings.json apps/web/messages/en/settings.json apps/web/src/i18n.ts
git commit -m "feat(web): register settings i18n namespace

Adds messages/{ko,en}/settings.json for the Phase E /settings/ai page.
en is a literal first-pass translation; native review applied in a
later commit before merge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Web — `ByokKeyCard` component

**Files:**
- Create: `apps/web/src/components/settings/ByokKeyCard.tsx`
- Create: `apps/web/src/components/settings/ByokKeyCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/settings/ByokKeyCard.test.tsx`. Mirror the test pattern used by `ResearchHub.test.tsx` — `vi.mock` for the api-client module, `fireEvent` from `@testing-library/react`, real `NextIntlClientProvider` so Korean strings render verbatim:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import settingsKo from "../../../messages/ko/settings.json";
import { ByokKeyCard } from "./ByokKeyCard";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock("@/lib/api-client-byok-key", () => ({
  byokKeyQueryKey: () => ["byok-key"] as const,
  getByokKey: vi.fn(),
  setByokKey: vi.fn(),
  deleteByokKey: vi.fn(),
  ByokKeyApiError: class ByokKeyApiError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
}));

import {
  getByokKey,
  setByokKey,
  deleteByokKey,
  ByokKeyApiError,
} from "@/lib/api-client-byok-key";

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ settings: settingsKo }}>
        <ByokKeyCard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ByokKeyCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state with a key input + save button", async () => {
    vi.mocked(getByokKey).mockResolvedValue({ registered: false });
    renderCard();
    await screen.findByPlaceholderText("AIza…");
    expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
  });

  it("renders the registered state with masked last4 + replace + delete", async () => {
    vi.mocked(getByokKey).mockResolvedValue({
      registered: true,
      lastFour: "abcd",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });
    renderCard();
    expect(await screen.findByText(/abcd/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "교체" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "삭제" })).toBeInTheDocument();
  });

  it("calls setByokKey on save and shows success toast", async () => {
    vi.mocked(getByokKey).mockResolvedValue({ registered: false });
    vi.mocked(setByokKey).mockResolvedValue({
      registered: true,
      lastFour: "wxyz",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });
    renderCard();
    const input = await screen.findByPlaceholderText("AIza…");
    fireEvent.change(input, {
      target: { value: "AIzaSyTestPhaseEUiSaveCase1234wxyz" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(setByokKey).toHaveBeenCalledWith(
        "AIzaSyTestPhaseEUiSaveCase1234wxyz",
      ),
    );
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
  });

  it("displays the i18n error message when save fails with wrong_prefix", async () => {
    vi.mocked(getByokKey).mockResolvedValue({ registered: false });
    vi.mocked(setByokKey).mockRejectedValue(
      new ByokKeyApiError("wrong_prefix", "boom"),
    );
    renderCard();
    const input = await screen.findByPlaceholderText("AIza…");
    fireEvent.change(input, {
      target: { value: "WRONG_PREFIX_TestKeyForUiTesting" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText(/올바른 Gemini API 키 형식이 아닙니다/);
  });

  it("opens delete confirmation and calls deleteByokKey on confirm", async () => {
    vi.mocked(getByokKey).mockResolvedValue({
      registered: true,
      lastFour: "abcd",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });
    vi.mocked(deleteByokKey).mockResolvedValue({ registered: false });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "삭제" }));
    expect(
      await screen.findByText("API 키를 삭제할까요?"),
    ).toBeInTheDocument();
    // The dialog has its own "삭제" button — pick the last "삭제" in the DOM.
    const allDelete = screen.getAllByRole("button", { name: "삭제" });
    fireEvent.click(allDelete[allDelete.length - 1]!);
    await waitFor(() => expect(deleteByokKey).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/web test:unit -- ByokKeyCard`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/settings/ByokKeyCard.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ByokKeyApiError,
  byokKeyQueryKey,
  deleteByokKey,
  getByokKey,
  setByokKey,
  type ByokKeyStatus,
} from "@/lib/api-client-byok-key";

const KNOWN_ERROR_CODES = new Set([
  "wrong_prefix",
  "too_short",
  "too_long",
]);

export function ByokKeyCard() {
  const t = useTranslations("settings.ai.byok");
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: byokKeyQueryKey(),
    queryFn: getByokKey,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (apiKey: string) => setByokKey(apiKey),
    onSuccess: (next) => {
      qc.setQueryData(byokKeyQueryKey(), next);
      setDraft("");
      setEditing(false);
      setErrorCode(null);
      toast.success(t("saved"));
    },
    onError: (err: unknown) => {
      const code =
        err instanceof ByokKeyApiError && KNOWN_ERROR_CODES.has(err.code)
          ? err.code
          : "save_failed";
      setErrorCode(code);
      if (code === "save_failed") toast.error(t("error.save_failed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteByokKey(),
    onSuccess: () => {
      qc.setQueryData(byokKeyQueryKey(), { registered: false });
      setDeleteOpen(false);
      toast.success(t("deleted"));
    },
    onError: () => toast.error(t("error.delete_failed")),
  });

  if (status.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  if (status.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {t("error.load_failed")}
      </p>
    );
  }

  const data = status.data as ByokKeyStatus;
  const showInput = !data.registered || editing;

  return (
    <section className="rounded-lg border border-border p-6">
      <h2 className="text-base font-medium">{t("heading")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>

      {showInput ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            saveMutation.mutate(draft.trim());
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("input_label")}</span>
            <Input
              type="password"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (errorCode) setErrorCode(null);
              }}
              placeholder={t("input_placeholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {errorCode ? (
            <p className="text-sm text-destructive" role="alert">
              {t(`error.${errorCode}`)}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("help_text")}</p>
          <div className="flex justify-end gap-2">
            {data.registered ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                  setErrorCode(null);
                }}
              >
                {t("delete_confirm_no")}
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={saveMutation.isPending || !draft.trim()}
            >
              {saveMutation.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span className="text-sm">
              <span aria-hidden>••••</span>
              <span className="ml-1 font-mono">{data.lastFour}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {t("last_updated")}: {new Date(data.updatedAt).toLocaleString()}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              {t("replace")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(true)}
            >
              {t("delete")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("delete_confirm_title")}</DialogTitle>
            <DialogDescription>{t("delete_confirm_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteMutation.isPending}
            >
              {t("delete_confirm_no")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? t("deleting") : t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/web test:unit -- ByokKeyCard`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/settings/ByokKeyCard.tsx apps/web/src/components/settings/ByokKeyCard.test.tsx
git commit -m "feat(web): ByokKeyCard component for /settings/ai

Three states: empty (input + save), registered (masked + replace +
delete), editing (input pre-shown, cancel returns to registered).
Errors map known API codes to localized strings, fallback to a generic
toast otherwise.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Web — `/settings/ai` page route

**Files:**
- Create: `apps/web/src/app/[locale]/app/settings/ai/page.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/src/app/[locale]/app/settings/ai/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";
import { ByokKeyCard } from "@/components/settings/ByokKeyCard";

export default async function SettingsAiPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const cookieHeader = (await cookies()).toString();
  const apiBase = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

  // Auth guard — mirror onboarding/page.tsx pattern.
  const meRes = await fetch(`${apiBase}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!meRes.ok) {
    redirect(
      `/${locale}/auth/login?return_to=${encodeURIComponent(
        `/${locale}/app/settings/ai`,
      )}`,
    );
  }

  const t = await getTranslations({ locale: locale as Locale, namespace: "settings.ai" });

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <ByokKeyCard />
    </main>
  );
}
```

- [ ] **Step 2: Verify the page loads (dev server smoke)**

Run from the worktree root:
```bash
pnpm dev
```

Visit `http://localhost:3000/ko/app/settings/ai` while signed in.
Expected: heading "AI 설정", subtitle, empty BYOK card with input.

If unauthenticated: redirect to `/ko/auth/login?return_to=...`.

(Stop the dev server after smoke check.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/app/settings/ai/page.tsx
git commit -m "feat(web): /[locale]/app/settings/ai page

Server Component with auth guard mirroring onboarding/page.tsx —
redirects unauth'd users to login with return_to. Page is intentionally
not gated by FEATURE_DEEP_RESEARCH; users may register a key in advance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: E2E — `settings-ai.spec.ts`

**Files:**
- Create: `apps/web/tests/e2e/settings-ai.spec.ts`

- [ ] **Step 1: Write the E2E spec**

Create `apps/web/tests/e2e/settings-ai.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Phase E smoke for /settings/ai BYOK key CRUD. The API is real (no
// fetch interceptor) — the seed helper signs the user in, then we
// exercise the live PUT/GET/DELETE flow via the actual UI.
//
// FEATURE_DEEP_RESEARCH does NOT need to be set for this spec; the
// BYOK page is reachable independently.
test.describe("Settings AI BYOK", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("register → masked display → replace → delete", async ({ page }) => {
    await page.goto("/ko/app/settings/ai");
    await expect(page.getByRole("heading", { name: "AI 설정" })).toBeVisible();

    // Empty state — input visible.
    const input = page.getByPlaceholder("AIza…");
    await expect(input).toBeVisible();

    // Register.
    const firstKey = "AIzaSyTestPhaseE2EFirstRegistration1abcd";
    await input.fill(firstKey);
    await page.getByRole("button", { name: "저장" }).click();

    // Registered state.
    await expect(page.getByText("abcd")).toBeVisible();
    await expect(page.getByRole("button", { name: "교체" })).toBeVisible();
    await expect(page.getByRole("button", { name: "삭제" })).toBeVisible();

    // Replace.
    await page.getByRole("button", { name: "교체" }).click();
    const input2 = page.getByPlaceholder("AIza…");
    await expect(input2).toBeVisible();
    const secondKey = "AIzaSyTestPhaseE2ESecondRoundRegistwxyz";
    await input2.fill(secondKey);
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("wxyz")).toBeVisible();

    // Delete (confirm).
    await page.getByRole("button", { name: "삭제" }).click();
    await expect(page.getByText("API 키를 삭제할까요?")).toBeVisible();
    // The dialog has its own "삭제" button — last() picks it over the page button.
    await page.getByRole("button", { name: "삭제" }).last().click();

    // Back to empty state.
    await expect(page.getByPlaceholder("AIza…")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E**

Boot the dev servers in another terminal first:
```bash
pnpm dev
```

Then in this worktree:
```bash
pnpm --filter @opencairn/web test:e2e -- settings-ai
```

Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/settings-ai.spec.ts
git commit -m "test(e2e): settings-ai BYOK CRUD smoke

Hits the real API — no fetch interceptor — to verify the encryptToken
roundtrip survives the full HTTP boundary. Independent of FEATURE_DEEP_
RESEARCH so it runs even with the flag off.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: E2E — activate `research-smoke.spec.ts`

**Files:**
- Modify: `apps/web/playwright.config.ts`

- [ ] **Step 1: Inject `FEATURE_DEEP_RESEARCH=true` into web webServer env**

Edit `apps/web/playwright.config.ts` — change the first `webServer` entry from:

```typescript
{
  command: "pnpm --filter @opencairn/web dev",
  url: "http://localhost:3000",
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
},
```

to:

```typescript
{
  command: "pnpm --filter @opencairn/web dev",
  url: "http://localhost:3000",
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  env: {
    ...process.env,
    FEATURE_DEEP_RESEARCH: "true",
  },
},
```

(API server's env stays untouched — research-smoke.spec.ts mocks `/api/research/*` via `context.route`, so the API never sees those requests.)

- [ ] **Step 2: Run the activated research smoke**

Boot dev servers:
```bash
pnpm dev
```

Then in another shell:
```bash
pnpm --filter @opencairn/web test:e2e -- research-smoke
```

Expected: **No skip**, 1 passing. (Previously the test would skip due to the `test.skip(... FEATURE_DEEP_RESEARCH ...)` guard at L25-28.)

If it skips: confirm Playwright actually re-spawned the dev server (i.e., `reuseExistingServer` did not prevent env override). With `pnpm dev` already running, Playwright reuses it and your manually started server doesn't have the flag. Stop `pnpm dev` and let Playwright spawn the server itself, OR temporarily start `pnpm dev` with `FEATURE_DEEP_RESEARCH=true` exported.

- [ ] **Step 3: Run the full E2E suite**

```bash
pnpm --filter @opencairn/web test:e2e
```

Expected: ALL specs passing including `research-smoke` and `settings-ai`. No skips for the research smoke (other Playwright skips for unrelated reasons are fine).

- [ ] **Step 4: Commit**

```bash
git add apps/web/playwright.config.ts
git commit -m "test(e2e): activate FEATURE_DEEP_RESEARCH for research-smoke

Injects the flag into the Playwright web webServer env so research-
smoke.spec.ts no longer skips. API webServer stays untouched — the
spec mocks /api/research/* via context.route.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: EN native review pass

**Files:**
- Modify: `apps/web/messages/en/research.json`
- Modify: `apps/web/messages/en/settings.json`

- [ ] **Step 1: Read the current EN research.json**

Run: `Read apps/web/messages/en/research.json` (full file).

- [ ] **Step 2: Apply the native review**

Edit `apps/web/messages/en/research.json` — keys MUST stay identical to ko parity. Apply these copy guidelines (in order of precedence):

1. **Use natural English idioms.** "최대 약 한 시간이 걸릴 수 있습니다" → "This can take up to an hour." (not "It is possible that it takes at most about an hour.")
2. **CTAs start with verbs.** "Open note" / "Approve and start" / "Start research".
3. **Errors blame the input, not the user.** "Your Gemini API key is invalid" → "The Gemini API key is invalid." Also, no "Sorry,".
4. **Keep Google product names verbatim.** "Deep Research", "Deep Research Max", "Gemini API". Don't translate or rebrand.
5. **Drop tech-stack jargon.** No "AES-256-GCM", "Temporal workflow", "SSE" in user-facing copy. ("collaborative_planning" was already absent — leave it.)
6. **Single-sentence error messages preferred.** Pair with a CTA where one exists.
7. **No exclamation marks.** Calm, professional tone.

Read the EN file you just opened and rewrite values in place (key set unchanged). The ko file is the source of intent — when in doubt, re-read `apps/web/messages/ko/research.json`.

Do NOT touch:
- Keys (parity will fail)
- Model names ("Deep Research", "Deep Research Max")
- Whitespace structure (still pretty JSON, 2-space indent)

- [ ] **Step 3: Apply the same pass to settings.json**

Edit `apps/web/messages/en/settings.json` similarly. The first-pass translation from Task 5 is good baseline; refine for native fluency. Pay particular attention to:
- `byok.description` — explain BYOK without "BYOK" (acronym is jargon for end users)
- `byok.error.wrong_prefix` — friendly hint, not technical
- `byok.help_text` — directional, not imperative

- [ ] **Step 4: Verify parity still passes**

Run: `pnpm --filter @opencairn/web i18n:parity`
Expected: PASS.

- [ ] **Step 5: Re-run web tests for sanity**

```bash
pnpm --filter @opencairn/web test:unit
pnpm --filter @opencairn/web lint
```

Expected: All pass. (Lint catches `i18next/no-literal-string` violations introduced by accident.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/messages/en/research.json apps/web/messages/en/settings.json
git commit -m "i18n(web): EN native review pass for research + settings

Pure copy refinement — no key changes. Tightens phrasing, strips
Korean grammar artifacts from the first-pass translation, drops tech-
stack jargon (AES-256-GCM, SSE, etc.) per copy guidelines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Finalize — `plans-status.md`, `CLAUDE.md`, post-feature

**Files:**
- Modify: `docs/contributing/plans-status.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update plans-status.md**

Read the current file: `docs/contributing/plans-status.md`. Find the Deep Research entries (search for "Phase D" or "Deep Research"). Add or update an entry for Phase E:

- Mark "Deep Research Phase E (BYOK + E2E)" with status ✅, date 2026-04-26, branch `feat/deep-research-phase-e`, and a brief description.
- Add a follow-up entry: "Deep Research prod release — pending manual env flip (`FEATURE_DEEP_RESEARCH=true`) on staging then prod. No code work."

(Match the file's existing line format — it uses a tabular or bulleted style.)

- [ ] **Step 2: Update CLAUDE.md**

Open `CLAUDE.md`. In the "Plans" section:
- Move "Deep Research Phase E (features)" from 🟡 to ✅ Complete.
- Update or remove the "Phase E (BYOK UI · /settings/ai · prod release)" entry under 🟡.
- Add a 🟡 entry: "Deep Research prod release — manual env flip pending after staging verification".

Keep the section terse — it is an index, not a changelog.

- [ ] **Step 3: Run the post-feature workflow**

Invoke the `opencairn:post-feature` skill (or follow its checklist manually):
- Verify `pnpm --filter @opencairn/api test` passes
- Verify `pnpm --filter @opencairn/web test:unit` passes
- Verify `pnpm --filter @opencairn/web lint` passes
- Verify `pnpm --filter @opencairn/web i18n:parity` passes
- Verify `pnpm --filter @opencairn/web test:e2e -- settings-ai research-smoke` passes
- (Optional) `pnpm build` or `pnpm typecheck` for the touched packages

If any step fails, fix in place and re-run before committing.

- [ ] **Step 4: Commit + push + open PR**

```bash
git add docs/contributing/plans-status.md CLAUDE.md
git commit -m "docs: mark Deep Research Phase E (features) complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin feat/deep-research-phase-e
```

Open a PR using `gh pr create --base main --title "feat(deep-research): Phase E — BYOK settings + E2E activation"` with a body covering:
- Summary: 3 bullets (BYOK CRUD, E2E activation, EN review)
- Test plan: pnpm test commands the reviewer can run
- Out of scope: `/settings/billing` (Plan 9b), prod flag flip (manual env change post-merge), sidebar entry changes

- [ ] **Step 5: Post-merge documentation (separate task, no code)**

After PR merge + staging verification + prod env flip:

1. On main, append a small docs commit to `plans-status.md`:
   - "Deep Research prod release — flag enabled on prod YYYY-MM-DD, HEAD <sha>"
2. Update CLAUDE.md to remove the "manual env flip pending" line and reflect the released state.

This step is a follow-up — do NOT include it in the Phase E PR.

---

## Self-review checklist (run after writing this plan, no agent dispatch)

1. **Spec coverage:**
   - §2 Goal 1 (BYOK page) → Tasks 6, 7
   - §2 Goal 2 (3 endpoints) → Tasks 1, 2, 3
   - §2 Goal 3 (research-smoke activation) → Task 9
   - §2 Goal 4 (settings-ai E2E) → Task 8
   - §2 Goal 5 (EN native review) → Task 10
   - §2 Goal 6 (plans-status.md) → Task 11
   - §6 error handling → embedded in Tasks 1-3 (API), 6 (Web)
   - §7 i18n parity → Task 5
   - §9 rollout (PR1 only, no flag flip) → Task 11 Step 4 + Step 5
   - All goals covered ✅

2. **Placeholder scan:** No "TODO", "TBD", "implement later" remain. ✅

3. **Type consistency:**
   - `ByokKeyStatus` discriminated union used in Tasks 4, 6 (consistent)
   - `byokKeyQueryKey()` used in Tasks 4, 6 (consistent)
   - `setByokKey(apiKey: string)` signature consistent
   - Error code names (`too_short`/`too_long`/`wrong_prefix`/`save_failed`/`delete_failed`/`load_failed`) consistent across spec §7 (i18n keys), Task 5 (json), Task 6 (UI mapping)
   - DB column `byokApiKeyEncrypted` matches schema (Task 1, 2, 3)
   - `encryptToken`/`decryptToken` import path `../lib/integration-tokens.js` consistent (Task 1)
   - All consistent ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-26-deep-research-phase-e-byok-and-release.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints

Which approach?
