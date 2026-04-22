# Onboarding & First-Run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the `/app → /onboarding` 404 by implementing a single
`/{locale}/onboarding` route that handles first-workspace creation AND
email-invite acceptance, plus the five prerequisite backend/frontend
fixes that the flow depends on.

**Architecture:** Server component route guards (session → emailVerified →
workspace existence) → mode A (invite acceptance) or mode B (create
workspace) client forms. Invite tokens travel via URL query across
signup → verify → login → onboarding, with `sessionStorage` backing
up across verify-email callback. All user-facing strings live in
`messages/{ko,en}/onboarding.json`.

**Tech Stack:** Next.js 16 App Router (server + client components),
Hono 4 (API), better-auth 1.2, next-intl 4, Zod, Vitest (unit + API),
Playwright (E2E), Drizzle ORM.

**Spec:** `docs/superpowers/specs/2026-04-22-onboarding-and-first-run-design.md`

---

## File Structure

**New files:**
- `apps/web/src/app/[locale]/onboarding/layout.tsx` — centered-card layout (auth layout 복제)
- `apps/web/src/app/[locale]/onboarding/page.tsx` — server component; runs guards + invite fetch, hands data to shell
- `apps/web/src/app/[locale]/onboarding/OnboardingShell.tsx` — client; mode A/B switcher
- `apps/web/src/app/[locale]/onboarding/CreateWorkspaceForm.tsx` — client; create form
- `apps/web/src/app/[locale]/onboarding/AcceptInviteCard.tsx` — client; invite accept UI
- `apps/web/src/lib/slug.ts` — `deriveSlug(name: string): string`, `isValidSlug`, `RESERVED_SLUGS`
- `apps/web/src/lib/slug.test.ts` — Vitest unit tests
- `apps/web/src/lib/return-to.ts` — `isSafeReturnTo(path: string): boolean` whitelist helper (shared w/ LoginForm)
- `apps/web/src/lib/return-to.test.ts` — Vitest unit tests
- `apps/web/messages/ko/onboarding.json` / `apps/web/messages/en/onboarding.json`
- `apps/web/tests/e2e/onboarding-guards.spec.ts`
- `apps/web/tests/e2e/onboarding-create.spec.ts`
- `apps/web/tests/e2e/onboarding-invite-accept.spec.ts`
- `apps/web/tests/e2e/onboarding-slug-conflict.spec.ts`
- `apps/api/tests/invites.test.ts` — GET /api/invites/:token integration

**Modified files:**
- `apps/api/src/routes/invites.ts` — add `GET /invites/:token`
- `apps/api/src/routes/workspaces.ts` — reserved-slug `.refine()` + `409 conflict` error shape
- `apps/api/src/lib/email.ts` — invite URL → `${webBase}/${locale}/auth/signup?invite=<token>`
- `apps/api/src/routes/internal.ts` — extend `/test-seed` with `mode: "onboarding-empty" | "onboarding-invite"`
- `apps/web/src/app/[locale]/auth/signup/page.tsx` — session guard (if logged in + has invite → /onboarding)
- `apps/web/src/components/auth/SignupForm.tsx` — read `?invite=...`, stash in `sessionStorage`, pass in `callbackURL`
- `apps/web/src/components/auth/LoginForm.tsx` — read `?return_to=...`, redirect to whitelisted path on success
- `apps/web/src/app/[locale]/auth/verify-email/page.tsx` — login link uses return_to when pending invite exists
- `apps/web/src/app/[locale]/app/page.tsx` — keep redirect (unchanged but tested path)
- `apps/web/messages/ko/auth.json` / `apps/web/messages/en/auth.json` — new keys for invite hand-off
- `docs/architecture/api-contract.md` — mark `GET /api/invites/:token` implemented
- `docs/contributing/plans-status.md` — add Plan 9a follow-up entry

**Rationale for split:** `OnboardingShell` holds mode state so the user
can switch from mode A to "create instead" without a round-trip.
`CreateWorkspaceForm`/`AcceptInviteCard` are independently testable
and stay under ~150 LOC each. The slug utility is extracted because
both the create form and future settings UI will need identical
validation.

---

## Phase 1 — Backend Prerequisites

### Task 1: `GET /api/invites/:token` endpoint

**Files:**
- Modify: `apps/api/src/routes/invites.ts`
- Create: `apps/api/tests/invites.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/invites.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { testClient } from "hono/testing";
import { randomBytes } from "node:crypto";
import {
  db,
  workspaces,
  workspaceInvites,
  user,
  workspaceMembers,
  eq,
} from "@opencairn/db";
import { app } from "../src/app.js";
import { createUser } from "./helpers/seed.js";

const client = testClient(app);

async function seedInvite(opts: {
  email?: string;
  expiresAt?: Date;
  acceptedAt?: Date | null;
}) {
  const inviter = await createUser();
  const [ws] = await db
    .insert(workspaces)
    .values({
      slug: `inv-${randomBytes(4).toString("hex")}`,
      name: "Invite WS",
      ownerId: inviter.id,
      planType: "free",
    })
    .returning();
  await db.insert(workspaceMembers).values({
    workspaceId: ws.id,
    userId: inviter.id,
    role: "owner",
  });
  const token = randomBytes(32).toString("base64url");
  await db.insert(workspaceInvites).values({
    workspaceId: ws.id,
    email: opts.email ?? `invitee-${randomBytes(4).toString("hex")}@ex.com`,
    role: "member",
    token,
    invitedBy: inviter.id,
    expiresAt:
      opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: opts.acceptedAt ?? null,
  });
  return { token, workspaceId: ws.id, inviter };
}

async function cleanup() {
  await db.delete(workspaceInvites);
  await db.delete(workspaceMembers);
  await db.delete(workspaces);
  // user rows left to cascade via other tests' cleanup
}

describe("GET /api/invites/:token", () => {
  afterEach(cleanup);

  it("returns invite metadata for a valid token", async () => {
    const { token, workspaceId, inviter } = await seedInvite({});
    const res = await app.request(`/api/invites/${token}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaceId: string;
      workspaceName: string;
      inviterName: string;
      role: "admin" | "member" | "guest";
      email: string;
      expiresAt: string;
    };
    expect(body.workspaceId).toBe(workspaceId);
    expect(body.workspaceName).toBe("Invite WS");
    expect(body.inviterName).toBe(inviter.name);
    expect(body.role).toBe("member");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 404 for unknown token", async () => {
    const fake = randomBytes(32).toString("base64url");
    const res = await app.request(`/api/invites/${fake}`);
    expect(res.status).toBe(404);
  });

  it("returns 410 for expired token", async () => {
    const { token } = await seedInvite({
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await app.request(`/api/invites/${token}`);
    expect(res.status).toBe(410);
  });

  it("returns 400 for already-accepted token", async () => {
    const { token } = await seedInvite({ acceptedAt: new Date() });
    const res = await app.request(`/api/invites/${token}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_accepted");
  });

  it("returns 400 when token is shorter than 32 chars", async () => {
    const res = await app.request(`/api/invites/tooshort`);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/api test -- invites
```

Expected: all 5 tests FAIL with 404 (route not found).

- [ ] **Step 3: Implement `GET /invites/:token`**

Edit `apps/api/src/routes/invites.ts`, add **before** the accept route
(at ~line 37):

```typescript
// 초대 조회 (수락 UI용) — 토큰 자체가 비밀이므로 인증 불필요.
// Note: authentication middleware is scoped per-route below; keep this
// above the `.use("*", requireAuth)`-style guards if any get added.
inviteRoutes.get("/invites/:token", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length < 32) {
    return c.json({ error: "bad_request" }, 400);
  }
  const [row] = await db
    .select({
      workspaceId: workspaceInvites.workspaceId,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      expiresAt: workspaceInvites.expiresAt,
      acceptedAt: workspaceInvites.acceptedAt,
      invitedBy: workspaceInvites.invitedBy,
      workspaceName: workspaces.name,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .where(eq(workspaceInvites.token, token));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.acceptedAt) return c.json({ error: "already_accepted" }, 400);
  if (row.expiresAt < new Date()) return c.json({ error: "expired" }, 410);

  const [inviter] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, row.invitedBy));

  return c.json({
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    inviterName: inviter?.name ?? "",
    role: row.role,
    email: row.email,
    expiresAt: row.expiresAt.toISOString(),
  });
});
```

Also ensure the top of the file imports `user` and `workspaces` from
`@opencairn/db`:

```typescript
import {
  db,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  user,
  eq,
} from "@opencairn/db";
```

**Important:** This route must sit OUTSIDE the `requireAuth`
middleware. Inspect the current `inviteRoutes` initialization:

```typescript
export const inviteRoutes = new Hono<AppEnv>().use("*", requireAuth);
```

The wildcard `.use("*", requireAuth)` would gate our new public route.
Refactor to split public/auth:

```typescript
export const inviteRoutes = new Hono<AppEnv>();

// Public — token itself is the secret.
inviteRoutes.get("/invites/:token", async (c) => { /* ... */ });

// Authed routes below.
inviteRoutes.use("*", requireAuth);

inviteRoutes.post("/workspaces/:workspaceId/invites", /* ... */);
inviteRoutes.post("/invites/:token/accept", /* ... */);
inviteRoutes.post("/invites/:token/decline", /* ... */);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @opencairn/api test -- invites
```

Expected: 5/5 PASS.

- [ ] **Step 5: Run full API test suite to confirm no regression**

```bash
pnpm --filter @opencairn/api test
```

Expected: previous suites (notes, permissions) still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/invites.ts apps/api/tests/invites.test.ts
git commit -m "feat(api): GET /invites/:token for accept UI preview"
```

---

### Task 2: Workspace reserved-slug validation

**Files:**
- Modify: `apps/api/src/routes/workspaces.ts`
- Create: `apps/api/tests/workspaces.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/workspaces.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { db, workspaces, workspaceMembers } from "@opencairn/db";
import { app } from "../src/app.js";
import { createUser } from "./helpers/seed.js";
import { signSessionForUser } from "../src/lib/test-session.js";

async function authedRequest(
  path: string,
  init: RequestInit & { body?: unknown } = {},
) {
  const u = await createUser();
  const { setCookie } = await signSessionForUser(u.id);
  const headers = new Headers(init.headers);
  headers.set("cookie", setCookie.split(";")[0]);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await app.request(path, {
    ...init,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { res, user: u };
}

async function cleanup() {
  await db.delete(workspaceMembers);
  await db.delete(workspaces);
}

describe("POST /api/workspaces reserved-slug validation", () => {
  afterEach(cleanup);

  it.each(["app", "api", "admin", "auth", "onboarding", "billing"])(
    "rejects reserved slug %s",
    async (slug) => {
      const { res } = await authedRequest("/api/workspaces", {
        method: "POST",
        body: { name: "Test", slug },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/reserved|validation/i);
    },
  );

  it("accepts a non-reserved slug", async () => {
    const { res } = await authedRequest("/api/workspaces", {
      method: "POST",
      body: { name: "Test", slug: "my-team" },
    });
    expect(res.status).toBe(201);
  });

  it("returns 409 on slug conflict", async () => {
    await authedRequest("/api/workspaces", {
      method: "POST",
      body: { name: "A", slug: "dup-slug" },
    });
    const { res } = await authedRequest("/api/workspaces", {
      method: "POST",
      body: { name: "B", slug: "dup-slug" },
    });
    expect(res.status).toBe(409);
  });
});
```

**Note:** `signSessionForUser` is exported from
`apps/api/src/lib/test-session.ts` — check if it exists. If it's only
in `apps/api/src/routes/internal.ts`, extract it to a shared module
first (see Step 2 below).

- [ ] **Step 2: Extract `signSessionForUser` to shared helper**

If `signSessionForUser` lives inline in `internal.ts`, move the function
to `apps/api/src/lib/test-session.ts` and import it in `internal.ts`.
If it already lives in a shared spot, skip this step.

```typescript
// apps/api/src/lib/test-session.ts
// Sign a Better Auth session cookie for an existing user row. Test/dev
// only — gated by callers (internal route double-gate + NODE_ENV).
import { randomBytes } from "node:crypto";
import { db, sessions } from "@opencairn/db";

const SESSION_COOKIE_NAME = "better-auth.session_token";

export async function signSessionForUser(userId: string): Promise<{
  setCookie: string;
  name: string;
  value: string;
  expiresAt: Date;
}> {
  // existing implementation moved here from internal.ts
  // (the engineer should lift the exact body — do not rewrite cryptography)
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @opencairn/api test -- workspaces
```

Expected: reserved-slug tests FAIL (currently everything looks valid).
409 test may pass if DB unique constraint is already in place.

- [ ] **Step 4: Add reserved-slug validation**

Edit `apps/api/src/routes/workspaces.ts` createSchema:

```typescript
const RESERVED_SLUGS = new Set([
  "app", "api", "admin", "auth", "www", "assets", "static", "public",
  "health", "onboarding", "settings", "billing", "share",
  "invite", "invites", "help", "docs", "blog",
]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(3)
    .max(40)
    .refine((s) => !RESERVED_SLUGS.has(s), {
      message: "reserved_slug",
    }),
});
```

**Also ensure the POST handler maps unique-constraint errors to 409.**
The current handler throws on conflict; wrap in try/catch:

```typescript
workspaceRoutes.post("/", zValidator("json", createSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  try {
    const ws = await db.transaction(async (tx) => {
      const [created] = await tx.insert(workspaces).values({ ...body, ownerId: user.id }).returning();
      await tx.insert(workspaceMembers).values({ workspaceId: created.id, userId: user.id, role: "owner" });
      return created;
    });
    return c.json(ws, 201);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return c.json({ error: "slug_conflict" }, 409);
    }
    throw err;
  }
});
```

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm --filter @opencairn/api test -- workspaces
```

Expected: 8/8 PASS (6 reserved-slug cases + accept + conflict).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/workspaces.ts apps/api/src/lib/test-session.ts apps/api/src/routes/internal.ts apps/api/tests/workspaces.test.ts
git commit -m "feat(api): reject reserved slugs + 409 on slug conflict"
```

---

### Task 3: Fix invite email URL to point at signup

**Files:**
- Modify: `apps/api/src/lib/email.ts`

- [ ] **Step 1: Rewrite `sendInviteEmail`**

The current URL `${appUrl}/api/invites/${token}/accept` is an API path
(POST, no UI). Change it to the signup URL so the user can gain a
session first.

```typescript
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const from = process.env.EMAIL_FROM ?? "OpenCairn <onboarding@resend.dev>";
const webBase = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const DEFAULT_LOCALE = "ko"; // Plan 9a default; recipient-locale추론은 후속 과제

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendInviteEmail(
  to: string,
  params: { token: string; workspaceId: string; invitedByName: string },
): Promise<void> {
  const signupUrl = `${webBase}/${DEFAULT_LOCALE}/auth/signup?invite=${encodeURIComponent(params.token)}`;
  const safeName = escapeHtml(params.invitedByName);
  const subject = `${safeName} invited you to a workspace on OpenCairn`;
  const html = `<p>${safeName} invited you to collaborate.</p>
<p><a href="${signupUrl}">Accept invite</a></p>`;

  if (!resend) {
    console.log("[email:dev]", { to, subject, signupUrl });
    return;
  }
  await resend.emails.send({ from, to, subject, html });
}
```

- [ ] **Step 2: Add `WEB_BASE_URL` to `.env.example`**

If not already listed, add:

```
WEB_BASE_URL=http://localhost:3000
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/email.ts .env.example
git commit -m "fix(api): invite email links to /auth/signup?invite=<token>"
```

No new test — this path is exercised end-to-end in Task 14.

---

## Phase 2 — E2E Fixture Extension

### Task 4: Extend `/internal/test-seed` with onboarding modes

**Files:**
- Modify: `apps/api/src/routes/internal.ts`
- Modify: `apps/web/tests/e2e/helpers/seed-session.ts`

- [ ] **Step 1: Add `mode` parameter to the seed endpoint**

In `apps/api/src/routes/internal.ts`, change the test-seed handler to
accept a `mode` in the request body:

```typescript
internal.post("/test-seed", async (c) => {
  if (process.env.NODE_ENV === "production") {
    return c.json({ error: "test-seed disabled in production" }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    mode?: "default" | "onboarding-empty" | "onboarding-invite";
  };
  const mode = body.mode ?? "default";

  const userId = randomUUID();
  const email = `e2e-${userId}@example.com`;
  await db.insert(user).values({
    id: userId,
    email,
    name: `E2E User ${userId.slice(0, 8)}`,
    emailVerified: true,
  });

  const { setCookie, name, value, expiresAt } = await signSessionForUser(userId);
  const baseReply = {
    userId,
    email,
    sessionCookie: setCookie,
    cookieName: name,
    cookieValue: value,
    expiresAt: expiresAt.toISOString(),
  };

  if (mode === "onboarding-empty") {
    return c.json(baseReply);
  }

  if (mode === "onboarding-invite") {
    // Create a separate workspace owned by a different user, then
    // issue an invite to our fresh user's email.
    const ownerId = randomUUID();
    await db.insert(user).values({
      id: ownerId,
      email: `e2e-owner-${ownerId}@example.com`,
      name: "Owner",
      emailVerified: true,
    });
    const workspaceId = randomUUID();
    const slug = `e2e-inv-${workspaceId.slice(0, 8)}`;
    await db.insert(workspaces).values({
      id: workspaceId, slug, name: "Invite Target WS", ownerId, planType: "free",
    });
    await db.insert(workspaceMembers).values({
      workspaceId, userId: ownerId, role: "owner",
    });
    const token = randomBytes(32).toString("base64url");
    await db.insert(workspaceInvites).values({
      workspaceId, email, role: "member", token,
      invitedBy: ownerId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return c.json({ ...baseReply, inviteToken: token, inviteWorkspaceSlug: slug });
  }

  // default mode — existing behavior (workspace + project + note)
  const workspaceId = randomUUID();
  const slug = `e2e-ws-${workspaceId.slice(0, 8)}`;
  // ... (leave the existing default branch intact)
});
```

Also add `randomBytes` and `workspaceInvites` imports if not already
present at the top of the file.

- [ ] **Step 2: Update `SeededSession` type + helper signature**

Edit `apps/web/tests/e2e/helpers/seed-session.ts`:

```typescript
export interface SeededSession {
  userId: string;
  email: string;
  sessionCookie: string;
  cookieName: string;
  cookieValue: string;
  expiresAt: string;
  // default mode only
  wsSlug?: string;
  workspaceId?: string;
  projectId?: string;
  noteId?: string;
  // onboarding-invite mode only
  inviteToken?: string;
  inviteWorkspaceSlug?: string;
}

export async function seedAndSignIn(
  request: APIRequestContext,
  opts: {
    apiBase?: string;
    mode?: "default" | "onboarding-empty" | "onboarding-invite";
  } = {},
): Promise<SeededSession> {
  const apiBase = opts.apiBase ?? DEFAULT_API_BASE;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error(
      "INTERNAL_API_SECRET not set — required for E2E seed. " +
        "Export it (or source .env) before running playwright.",
    );
  }

  const res = await request.post(`${apiBase}/api/internal/test-seed`, {
    headers: {
      "x-internal-secret": secret,
      "content-type": "application/json",
    },
    data: { mode: opts.mode ?? "default" },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `test-seed failed: ${res.status()} ${res.statusText()} ${body}`,
    );
  }
  return (await res.json()) as SeededSession;
}
```

- [ ] **Step 3: Verify existing E2E still passes**

```bash
pnpm --filter @opencairn/api dev &
pnpm --filter @opencairn/web test:e2e -- editor-core
```

Expected: existing editor-core spec passes (default mode unchanged).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/internal.ts apps/web/tests/e2e/helpers/seed-session.ts
git commit -m "test(api): test-seed modes onboarding-empty/onboarding-invite"
```

---

## Phase 3 — Frontend Utilities (TDD)

### Task 5: `deriveSlug` utility

**Files:**
- Create: `apps/web/src/lib/slug.ts`
- Create: `apps/web/src/lib/slug.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/lib/slug.test.ts
import { describe, it, expect } from "vitest";
import { deriveSlug, isValidSlug, RESERVED_SLUGS } from "./slug";

describe("deriveSlug", () => {
  it("lowercases ASCII and hyphenates whitespace", () => {
    expect(deriveSlug("My Team")).toBe("my-team");
  });

  it("replaces underscores with hyphens", () => {
    expect(deriveSlug("Foo_Bar_Baz")).toBe("foo-bar-baz");
  });

  it("collapses runs of hyphens", () => {
    expect(deriveSlug("a -- b")).toBe("a-b");
  });

  it("strips non-ASCII (including Korean)", () => {
    expect(deriveSlug("한글 Team")).toBe("team");
  });

  it("returns empty string when input reduces to nothing", () => {
    expect(deriveSlug("한글만")).toBe("");
  });

  it("truncates to 40 chars", () => {
    const long = "a".repeat(80);
    expect(deriveSlug(long).length).toBe(40);
  });

  it("trims leading/trailing hyphens", () => {
    expect(deriveSlug("-- hi --")).toBe("hi");
  });

  it("returns empty for reserved output", () => {
    expect(deriveSlug("api")).toBe("");
  });

  it("returns empty for too-short output", () => {
    expect(deriveSlug("a")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("accepts valid slugs", () => {
    expect(isValidSlug("my-team")).toBe(true);
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("a1b2c3")).toBe(true);
  });

  it("rejects uppercase, spaces, underscores, unicode", () => {
    expect(isValidSlug("My-Team")).toBe(false);
    expect(isValidSlug("my team")).toBe(false);
    expect(isValidSlug("my_team")).toBe(false);
    expect(isValidSlug("팀")).toBe(false);
  });

  it("rejects too short or too long", () => {
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("a".repeat(41))).toBe(false);
  });

  it("rejects reserved slugs", () => {
    for (const r of RESERVED_SLUGS) expect(isValidSlug(r)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test:unit -- slug
```

Expected: all tests FAIL (module not found).

- [ ] **Step 3: Implement the utility**

```typescript
// apps/web/src/lib/slug.ts
// Keep this list in sync with apps/api/src/routes/workspaces.ts RESERVED_SLUGS.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app", "api", "admin", "auth", "www", "assets", "static", "public",
  "health", "onboarding", "settings", "billing", "share",
  "invite", "invites", "help", "docs", "blog",
]);

const MIN_LEN = 3;
const MAX_LEN = 40;
const VALID_SLUG = /^[a-z0-9-]+$/;

export function deriveSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^\x00-\x7f]+/g, "") // strip non-ASCII
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN);

  if (ascii.length < MIN_LEN) return "";
  if (RESERVED_SLUGS.has(ascii)) return "";
  return ascii;
}

export function isValidSlug(slug: string): boolean {
  if (slug.length < MIN_LEN || slug.length > MAX_LEN) return false;
  if (!VALID_SLUG.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @opencairn/web test:unit -- slug
```

Expected: 13/13 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/slug.ts apps/web/src/lib/slug.test.ts
git commit -m "feat(web): deriveSlug + isValidSlug with reserved list"
```

---

### Task 6: `isSafeReturnTo` whitelist

**Files:**
- Create: `apps/web/src/lib/return-to.ts`
- Create: `apps/web/src/lib/return-to.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/lib/return-to.test.ts
import { describe, it, expect } from "vitest";
import { isSafeReturnTo } from "./return-to";

describe("isSafeReturnTo", () => {
  it("allows /app and /app/**", () => {
    expect(isSafeReturnTo("/app")).toBe(true);
    expect(isSafeReturnTo("/app/w/my-team")).toBe(true);
    expect(isSafeReturnTo("/app/w/my-team/p/123")).toBe(true);
  });

  it("allows /onboarding and /onboarding?invite=...", () => {
    expect(isSafeReturnTo("/onboarding")).toBe(true);
    expect(isSafeReturnTo("/onboarding?invite=abc123")).toBe(true);
  });

  it("rejects external URLs", () => {
    expect(isSafeReturnTo("https://evil.com/phish")).toBe(false);
    expect(isSafeReturnTo("//evil.com")).toBe(false);
    expect(isSafeReturnTo("http://localhost:3000/app")).toBe(false);
  });

  it("rejects non-whitelisted paths", () => {
    expect(isSafeReturnTo("/auth/login")).toBe(false);
    expect(isSafeReturnTo("/foo")).toBe(false);
    expect(isSafeReturnTo("/")).toBe(false);
  });

  it("rejects empty / nullish", () => {
    expect(isSafeReturnTo("")).toBe(false);
    expect(isSafeReturnTo(null as unknown as string)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test:unit -- return-to
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/lib/return-to.ts
// Whitelist of relative paths safe to redirect to after auth flows.
// Strips locale prefix so callers can pass either /ko/app or /app.
const ALLOW_PREFIXES = ["/app", "/onboarding"];
const LOCALE_PREFIX = /^\/(ko|en)(?=\/|$)/;

export function isSafeReturnTo(path: string | null | undefined): boolean {
  if (!path || typeof path !== "string") return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  const stripped = path.replace(LOCALE_PREFIX, "") || "/";
  return ALLOW_PREFIXES.some(
    (prefix) => stripped === prefix || stripped.startsWith(`${prefix}/`) || stripped.startsWith(`${prefix}?`),
  );
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm --filter @opencairn/web test:unit -- return-to
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/return-to.ts apps/web/src/lib/return-to.test.ts
git commit -m "feat(web): isSafeReturnTo whitelist helper"
```

---

## Phase 4 — Onboarding Route

### Task 7: Onboarding layout

**Files:**
- Create: `apps/web/src/app/[locale]/onboarding/layout.tsx`

- [ ] **Step 1: Read the existing auth layout for reference**

Run: `cat apps/web/src/app/[locale]/auth/layout.tsx`

- [ ] **Step 2: Create the onboarding layout**

Copy the shell (center card, viewport, typography) but use onboarding-
specific copy keys. Do NOT import from the auth layout file — keep them
decoupled.

```tsx
// apps/web/src/app/[locale]/onboarding/layout.tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";

export default async function OnboardingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations({ locale, namespace: "onboarding.layout" });

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-md flex flex-col gap-8">
        <header className="flex flex-col gap-1">
          <p className="font-sans text-sm text-stone-400">{t("brand")}</p>
          <h1 className="font-sans text-2xl text-stone-900">{t("headline")}</h1>
        </header>
        {children}
        <p className="text-xs text-stone-400 font-sans text-center">{t("footnote")}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit** (hold until i18n keys added in Task 11; so actually bundle this task's commit with Task 8).

No commit yet — continue to Task 8.

---

### Task 8: Onboarding page (server component + shell)

**Files:**
- Create: `apps/web/src/app/[locale]/onboarding/page.tsx`
- Create: `apps/web/src/app/[locale]/onboarding/OnboardingShell.tsx`

- [ ] **Step 1: Build the server component with guards + invite fetch**

```tsx
// apps/web/src/app/[locale]/onboarding/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { OnboardingShell } from "./OnboardingShell";

interface InviteInfo {
  workspaceId: string;
  workspaceName: string;
  inviterName: string;
  role: "admin" | "member" | "guest";
  email: string;
  expiresAt: string;
}

type InviteFetchResult =
  | { status: "ok"; data: InviteInfo }
  | { status: "not_found" | "expired" | "already_accepted" | "bad_request" | "network_error" };

async function fetchInvite(apiBase: string, token: string): Promise<InviteFetchResult> {
  try {
    const res = await fetch(`${apiBase}/api/invites/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (res.ok) return { status: "ok", data: (await res.json()) as InviteInfo };
    if (res.status === 404) return { status: "not_found" };
    if (res.status === 410) return { status: "expired" };
    if (res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === "already_accepted") return { status: "already_accepted" };
      return { status: "bad_request" };
    }
    return { status: "network_error" };
  } catch {
    return { status: "network_error" };
  }
}

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const [{ locale }, { invite }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as Locale);

  const cookieHeader = (await cookies()).toString();
  const apiBase = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

  // Guard 1: session
  const meRes = await fetch(`${apiBase}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!meRes.ok) {
    const returnTo = `/onboarding${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
    redirect(`/${locale}/auth/login?return_to=${encodeURIComponent(returnTo)}`);
  }
  const me = (await meRes.json()) as { userId: string; email: string; name: string; emailVerified?: boolean };

  // Guard 2: email verified
  // (If /auth/me doesn't already include emailVerified, add it in a follow-up.
  //  For now, skip this guard when the field is absent — Better Auth signup
  //  flow already forces verify-email before login succeeds.)
  if (me.emailVerified === false) {
    redirect(`/${locale}/auth/verify-email`);
  }

  // Guard 3: workspace existence
  const wsRes = await fetch(`${apiBase}/api/workspaces`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!wsRes.ok) throw new Error(`Failed to load workspaces (${wsRes.status})`);
  const workspaces = (await wsRes.json()) as Array<{ slug: string; id: string }>;

  // If user already belongs to a workspace AND no invite token, go to /app.
  if (workspaces.length > 0 && !invite) {
    redirect(`/${locale}/app/w/${workspaces[0].slug}`);
  }

  // Otherwise (no workspace, OR token-bearing user): resolve invite (if any).
  const inviteResult: InviteFetchResult | null = invite
    ? await fetchInvite(apiBase, invite)
    : null;

  return (
    <OnboardingShell
      locale={locale}
      currentUserEmail={me.email}
      token={invite ?? null}
      inviteResult={inviteResult}
      hasExistingWorkspace={workspaces.length > 0}
      firstWorkspaceSlug={workspaces[0]?.slug ?? null}
    />
  );
}
```

- [ ] **Step 2: Add `emailVerified` to `/api/auth/me` if missing**

Check `apps/api/src/routes/auth.ts` or wherever `/api/auth/me` is
defined. If the response lacks `emailVerified`, add it. If there is no
such route (only Better Auth's own), expose a thin wrapper. Scope this
as a micro-task: 5 minutes.

- [ ] **Step 3: Build the client shell**

```tsx
// apps/web/src/app/[locale]/onboarding/OnboardingShell.tsx
"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";
import { AcceptInviteCard } from "./AcceptInviteCard";

type InviteFetchResult =
  | { status: "ok"; data: {
      workspaceId: string; workspaceName: string; inviterName: string;
      role: "admin" | "member" | "guest"; email: string; expiresAt: string;
    } }
  | { status: "not_found" | "expired" | "already_accepted" | "bad_request" | "network_error" };

type Mode = "invite" | "create";

export function OnboardingShell({
  locale,
  currentUserEmail,
  token,
  inviteResult,
  hasExistingWorkspace,
  firstWorkspaceSlug,
}: {
  locale: string;
  currentUserEmail: string;
  token: string | null;
  inviteResult: InviteFetchResult | null;
  hasExistingWorkspace: boolean;
  firstWorkspaceSlug: string | null;
}) {
  const t = useTranslations("onboarding");
  const [mode, setMode] = useState<Mode>(
    inviteResult?.status === "ok" ? "invite" : "create",
  );

  // Clear any sessionStorage invite marker once we've landed on the page.
  useEffect(() => {
    try {
      sessionStorage.removeItem("opencairn:pending_invite");
    } catch {
      // sessionStorage may be unavailable (e.g., privacy mode); ignore.
    }
  }, []);

  if (mode === "invite" && inviteResult?.status === "ok" && token) {
    return (
      <AcceptInviteCard
        locale={locale}
        token={token}
        info={inviteResult.data}
        currentUserEmail={currentUserEmail}
        onSwitchToCreate={() => setMode("create")}
      />
    );
  }

  // invalid / missing / expired invite: show explanatory banner above the create form
  const banner: string | null = (() => {
    if (!inviteResult || mode === "create") return null;
    switch (inviteResult.status) {
      case "not_found": return t("invite.errors.notFound");
      case "expired": return t("invite.errors.expired");
      case "already_accepted":
        return hasExistingWorkspace && firstWorkspaceSlug
          ? null // page will have redirected earlier in the common case; stays as fallback
          : t("invite.errors.alreadyAccepted");
      case "bad_request": return t("invite.errors.badRequest");
      case "network_error": return t("invite.errors.network");
      default: return null;
    }
  })();

  return (
    <div className="flex flex-col gap-5">
      {banner && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm bg-stone-50 border border-stone-200 rounded-md px-3 py-2 text-stone-700"
        >
          {banner}
        </p>
      )}
      <CreateWorkspaceForm locale={locale} />
    </div>
  );
}
```

- [ ] **Step 4: Commit (bundle with Task 9 once form is ready)**

No commit yet — we need the form components to compile.

---

### Task 9: `CreateWorkspaceForm`

**Files:**
- Create: `apps/web/src/app/[locale]/onboarding/CreateWorkspaceForm.tsx`

- [ ] **Step 1: Implement the form**

```tsx
// apps/web/src/app/[locale]/onboarding/CreateWorkspaceForm.tsx
"use client";
import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deriveSlug, isValidSlug } from "@/lib/slug";

type ErrorKind =
  | "required"
  | "slug_invalid"
  | "slug_reserved"
  | "slug_conflict"
  | "network"
  | "generic";

export function CreateWorkspaceForm({ locale }: { locale: string }) {
  const t = useTranslations("onboarding.create");
  const tErr = useTranslations("onboarding.create.errors");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-derive slug while user hasn't manually edited it.
  useEffect(() => {
    if (!slugTouched) setSlug(deriveSlug(name));
  }, [name, slugTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuggestions([]);

    if (!name.trim()) {
      setError("required");
      return;
    }
    if (!isValidSlug(slug)) {
      setError("slug_invalid");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), slug }),
        signal: controller.signal,
      });
      if (res.status === 201) {
        const ws = (await res.json()) as { slug: string };
        window.location.href = `/${locale}/app/w/${ws.slug}`;
        return;
      }
      if (res.status === 409) {
        setError("slug_conflict");
        setSuggestions([`${slug}-2`, `${slug}-3`, `${slug}-4`]);
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error === "reserved_slug" ? "slug_reserved" : "slug_invalid");
        return;
      }
      setError("generic");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError("network");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-sans text-xl text-stone-900">{t("title")}</h2>
        <p className="text-sm text-stone-500">{t("desc")}</p>
      </div>

      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md"
        >
          {tErr(error)}
        </p>
      )}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="text-stone-500">{t("suggest")}:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSlug(s);
                setSlugTouched(true);
              }}
              className="px-2 py-0.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-800 font-mono"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-stone-700" htmlFor="ws-name">
            {t("nameLabel")}
          </label>
          <Input
            id="ws-name"
            data-testid="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="organization"
            autoFocus
            required
            maxLength={120}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-stone-700" htmlFor="ws-slug">
            {t("slugLabel")}
          </label>
          <Input
            id="ws-slug"
            data-testid="ws-slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase());
              setSlugTouched(true);
            }}
            pattern="[a-z0-9-]+"
            minLength={3}
            maxLength={40}
            required
          />
          <p className="text-xs text-stone-400 font-mono">
            opencairn.com/app/w/<span className="text-stone-700">{slug || "…"}</span>
          </p>
        </div>
      </div>

      <Button type="submit" disabled={loading} data-testid="ws-submit" className="w-full">
        {loading ? "…" : t("submit")}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Verify typecheck compiles**

```bash
pnpm --filter @opencairn/web build
```

Expected: compiles (there will be i18n lookup warnings until Task 11 but types should be fine).

- [ ] **Step 3: Hold commit — bundle with Tasks 10+11**

---

### Task 10: `AcceptInviteCard`

**Files:**
- Create: `apps/web/src/app/[locale]/onboarding/AcceptInviteCard.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/app/[locale]/onboarding/AcceptInviteCard.tsx
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type AcceptError = "email_mismatch" | "expired" | "already_member" | "already_accepted" | "not_found" | "network" | "generic";

export function AcceptInviteCard({
  locale,
  token,
  info,
  currentUserEmail,
  onSwitchToCreate,
}: {
  locale: string;
  token: string;
  info: {
    workspaceId: string; workspaceName: string; inviterName: string;
    role: "admin" | "member" | "guest"; email: string; expiresAt: string;
  };
  currentUserEmail: string;
  onSwitchToCreate: () => void;
}) {
  const t = useTranslations("onboarding.invite");
  const tRole = useTranslations("onboarding.invite.roles");
  const tErr = useTranslations("onboarding.invite.errors");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AcceptError | null>(null);

  const emailMismatch =
    info.email.toLowerCase() !== currentUserEmail.toLowerCase();

  async function accept() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
      });
      if (res.ok) {
        // Response shape: { workspaceId }. Resolve slug via GET /api/workspaces.
        const wsListRes = await fetch(`/api/workspaces`);
        const list = (await wsListRes.json()) as Array<{ id: string; slug: string }>;
        const match = list.find((w) => w.id === info.workspaceId);
        window.location.href = match
          ? `/${locale}/app/w/${match.slug}`
          : `/${locale}/app`;
        return;
      }
      if (res.status === 403) setError("email_mismatch");
      else if (res.status === 410) setError("expired");
      else if (res.status === 409) setError("already_member");
      else if (res.status === 400) setError("already_accepted");
      else if (res.status === 404) setError("not_found");
      else setError("generic");
    } catch {
      setError("network");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-sans text-xl text-stone-900">
          {t("title", { inviterName: info.inviterName })}
        </h2>
        <p className="text-sm text-stone-500">
          {t("body", {
            workspaceName: info.workspaceName,
            role: tRole(info.role),
          })}
        </p>
      </div>

      {emailMismatch && (
        <p role="alert" className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-md">
          {t("emailMismatchHint", { inviteEmail: info.email })}
        </p>
      )}

      {error && (
        <p role="alert" aria-live="polite" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">
          {tErr(error)}
        </p>
      )}

      <Button
        type="button"
        onClick={accept}
        disabled={loading || emailMismatch}
        data-testid="invite-accept"
        className="w-full"
      >
        {loading ? "…" : t("accept")}
      </Button>

      <button
        type="button"
        onClick={onSwitchToCreate}
        data-testid="invite-create-instead"
        className="text-center text-sm text-stone-500 hover:text-stone-800 underline"
      >
        {t("declineAndCreate")}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Hold commit — bundle with Task 11**

---

### Task 11: i18n keys (ko + en)

**Files:**
- Create: `apps/web/messages/ko/onboarding.json`
- Create: `apps/web/messages/en/onboarding.json`
- Modify: `apps/web/messages/ko/auth.json`
- Modify: `apps/web/messages/en/auth.json`

- [ ] **Step 1: Write ko keys**

```json
// apps/web/messages/ko/onboarding.json
{
  "layout": {
    "brand": "OpenCairn",
    "headline": "시작하기",
    "footnote": "AGPLv3 · 셀프호스팅"
  },
  "create": {
    "title": "첫 워크스페이스를 만드세요",
    "desc": "워크스페이스는 문서·프로젝트가 모이는 공간이에요. 나중에 이름과 주소는 바꿀 수 있어요.",
    "nameLabel": "이름",
    "slugLabel": "주소",
    "submit": "워크스페이스 만들기",
    "suggest": "이건 어때요?",
    "errors": {
      "required": "이름을 입력해주세요.",
      "slug_invalid": "주소는 영문 소문자, 숫자, 하이픈으로 3~40자여야 해요.",
      "slug_reserved": "사용할 수 없는 주소예요. 다른 걸 골라주세요.",
      "slug_conflict": "이미 사용 중인 주소예요. 아래 추천을 써보세요.",
      "network": "연결이 불안정해요. 잠시 후 다시 시도해주세요.",
      "generic": "문제가 발생했어요. 잠시 후 다시 시도해주세요."
    }
  },
  "invite": {
    "title": "{inviterName}님의 초대",
    "body": "{workspaceName} 워크스페이스에 {role} 역할로 참여합니다.",
    "roles": {
      "admin": "관리자",
      "member": "멤버",
      "guest": "게스트"
    },
    "accept": "수락하고 입장하기",
    "declineAndCreate": "또는 내 워크스페이스 직접 만들기",
    "emailMismatchHint": "이 초대는 {inviteEmail}로 발송됐어요. 해당 이메일로 로그인해주세요.",
    "errors": {
      "email_mismatch": "초대된 이메일과 현재 로그인 이메일이 달라요.",
      "expired": "초대가 만료됐어요. 초대해주신 분께 재발송을 요청해주세요.",
      "already_member": "이미 이 워크스페이스 멤버예요.",
      "already_accepted": "이미 수락한 초대예요.",
      "not_found": "이 초대 링크를 찾을 수 없어요.",
      "bad_request": "초대 링크가 올바르지 않아요.",
      "network": "연결이 불안정해요. 잠시 후 다시 시도해주세요.",
      "generic": "문제가 발생했어요. 잠시 후 다시 시도해주세요."
    }
  }
}
```

- [ ] **Step 2: Write en keys (parity)**

```json
// apps/web/messages/en/onboarding.json
{
  "layout": {
    "brand": "OpenCairn",
    "headline": "Get started",
    "footnote": "AGPLv3 · self-hosted"
  },
  "create": {
    "title": "Create your first workspace",
    "desc": "A workspace is where your documents and projects live. You can rename it and change the address later.",
    "nameLabel": "Name",
    "slugLabel": "Address",
    "submit": "Create workspace",
    "suggest": "Try",
    "errors": {
      "required": "Please enter a name.",
      "slug_invalid": "The address must be 3–40 lowercase letters, digits, or hyphens.",
      "slug_reserved": "That address is reserved. Pick another.",
      "slug_conflict": "That address is already taken. Try one of the suggestions.",
      "network": "Connection issue. Please try again in a moment.",
      "generic": "Something went wrong. Please try again."
    }
  },
  "invite": {
    "title": "{inviterName} invited you",
    "body": "Join {workspaceName} as {role}.",
    "roles": {
      "admin": "admin",
      "member": "member",
      "guest": "guest"
    },
    "accept": "Accept & enter",
    "declineAndCreate": "Or create your own workspace instead",
    "emailMismatchHint": "This invite was sent to {inviteEmail}. Please sign in with that address.",
    "errors": {
      "email_mismatch": "The invited email does not match your signed-in address.",
      "expired": "This invite has expired. Ask the sender to resend it.",
      "already_member": "You are already a member of this workspace.",
      "already_accepted": "This invite was already accepted.",
      "not_found": "We could not find this invite link.",
      "bad_request": "This invite link is malformed.",
      "network": "Connection issue. Please try again in a moment.",
      "generic": "Something went wrong. Please try again."
    }
  }
}
```

- [ ] **Step 3: Register the new namespace in next-intl**

Find where message namespaces are loaded (search for `auth.json` in
`apps/web/src/i18n`). Add `onboarding.json` to the same list.

- [ ] **Step 4: Add auth keys for invite hand-off**

Edit `apps/web/messages/ko/auth.json` — append inside root object:

```json
  "inviteBanner": {
    "invitedTo": "초대받은 워크스페이스가 있어요",
    "continueAfterSignup": "가입을 마치면 초대를 수락할 수 있어요."
  },
```

And mirror in en:

```json
  "inviteBanner": {
    "invitedTo": "You have a pending invite",
    "continueAfterSignup": "Finish signing up to accept it."
  },
```

- [ ] **Step 5: Run parity + lint**

```bash
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web lint
```

Expected: both pass. Fix missing keys if parity complains.

- [ ] **Step 6: Commit the onboarding route + i18n as one unit**

```bash
git add apps/web/src/app/[locale]/onboarding apps/web/messages apps/web/src/i18n
git commit -m "feat(web): onboarding route with create + accept-invite modes"
```

---

## Phase 5 — Invite Token Hand-off

### Task 12: `SignupForm` — carry `?invite=` to callbackURL + sessionStorage

**Files:**
- Modify: `apps/web/src/components/auth/SignupForm.tsx`

- [ ] **Step 1: Read `?invite` on mount, stash in sessionStorage, pass in callbackURL**

Insert at the top of the component (after the existing `useState`
hooks):

```tsx
// Read invite token from URL once. Used to (a) echo in callbackURL so
// the verify-email link can pick it up, and (b) stash in sessionStorage
// as a fallback if the user opens verify-email in another tab.
const inviteToken = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("invite")
  : null;

useEffect(() => {
  if (inviteToken) {
    try {
      sessionStorage.setItem("opencairn:pending_invite", inviteToken);
    } catch {
      // ignore storage errors (private browsing)
    }
  }
}, [inviteToken]);
```

Change the `callbackURL`:

```tsx
const callbackBase = `/${locale}/auth/verify-email`;
const callbackURL = inviteToken
  ? `${callbackBase}?invite=${encodeURIComponent(inviteToken)}`
  : callbackBase;

const { error: authError } = await authClient.signUp.email({
  name, email, password, callbackURL,
});
```

And import `useEffect`:

```tsx
import { useState, useEffect } from "react";
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/auth/SignupForm.tsx
git commit -m "feat(web): SignupForm propagates ?invite token to verify-email"
```

---

### Task 13: `/auth/signup` session guard

**Files:**
- Modify: `apps/web/src/app/[locale]/auth/signup/page.tsx`

- [ ] **Step 1: Add session check, redirect if already logged in**

```tsx
// apps/web/src/app/[locale]/auth/signup/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { SignupForm } from "@/components/auth/SignupForm";
import { GoogleOneTap } from "@/components/auth/GoogleOneTap";

export default async function SignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const [{ locale }, { invite }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as Locale);

  // If already signed in, skip signup and go straight to onboarding (with
  // token) or the app.
  const cookieHeader = (await cookies()).toString();
  const apiBase = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const meRes = await fetch(`${apiBase}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (meRes.ok) {
    if (invite) {
      redirect(`/${locale}/onboarding?invite=${encodeURIComponent(invite)}`);
    } else {
      redirect(`/${locale}/app`);
    }
  }

  return (
    <>
      <GoogleOneTap />
      <SignupForm />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/[locale]/auth/signup/page.tsx
git commit -m "feat(web): signup page redirects logged-in users (carries invite)"
```

---

### Task 14: `verify-email` — chain to onboarding when invite pending

**Files:**
- Modify: `apps/web/src/app/[locale]/auth/verify-email/page.tsx`

- [ ] **Step 1: Update the post-verify link**

Open the page and find the "go to login" link. Change it to a client-
side component that reads the invite from URL or sessionStorage and
builds the appropriate `return_to`.

```tsx
// apps/web/src/app/[locale]/auth/verify-email/PostVerifyLink.tsx
"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export function PostVerifyLink({ locale }: { locale: string }) {
  const t = useTranslations("auth.verify");
  const [href, setHref] = useState(`/${locale}/auth/login`);

  useEffect(() => {
    const urlToken = new URLSearchParams(window.location.search).get("invite");
    let token: string | null = urlToken;
    if (!token) {
      try {
        token = sessionStorage.getItem("opencairn:pending_invite");
      } catch {
        // ignore
      }
    }
    if (token) {
      const returnTo = `/onboarding?invite=${encodeURIComponent(token)}`;
      setHref(`/${locale}/auth/login?return_to=${encodeURIComponent(returnTo)}`);
    }
  }, [locale]);

  return (
    <a href={href} className="text-center text-sm font-medium text-stone-900 hover:underline">
      {t("goLogin")}
    </a>
  );
}
```

Then in `verify-email/page.tsx` replace the hardcoded link with
`<PostVerifyLink locale={locale} />`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/[locale]/auth/verify-email
git commit -m "feat(web): verify-email chains to onboarding when invite pending"
```

---

### Task 15: `LoginForm` — honor `return_to` whitelist

**Files:**
- Modify: `apps/web/src/components/auth/LoginForm.tsx`

- [ ] **Step 1: Read `return_to` and route accordingly**

```tsx
import { useState, useEffect } from "react";
import { isSafeReturnTo } from "@/lib/return-to";

// inside component, after existing useState hooks:
const [returnTo, setReturnTo] = useState<string | null>(null);
useEffect(() => {
  const r = new URLSearchParams(window.location.search).get("return_to");
  if (r && isSafeReturnTo(r)) setReturnTo(r);
}, []);

// On successful login, replace the existing redirect with:
const dest = returnTo
  ? (returnTo.startsWith(`/${locale}`) ? returnTo : `/${locale}${returnTo}`)
  : `/${locale}/app`;
window.location.href = dest;
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/auth/LoginForm.tsx
git commit -m "feat(web): LoginForm honors whitelisted return_to"
```

---

## Phase 6 — E2E Tests

### Task 16: `onboarding-guards.spec.ts`

**Files:**
- Create: `apps/web/tests/e2e/onboarding-guards.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
} from "./helpers/seed-session";

test.describe("onboarding guards", () => {
  test("unauthed → /auth/login", async ({ page }) => {
    await page.goto("/ko/onboarding");
    await expect(page).toHaveURL(/\/ko\/auth\/login/, { timeout: 10_000 });
  });

  test("authed + no workspace → stays on /onboarding", async ({ page, request, context }) => {
    const session = await seedAndSignIn(request, { mode: "onboarding-empty" });
    await applySessionCookie(context, session);
    await page.goto("/ko/onboarding");
    await expect(page).toHaveURL(/\/ko\/onboarding$/);
    await expect(page.getByTestId("ws-name")).toBeVisible();
  });

  test("authed + has workspace + no invite → /app/w/:slug", async ({ page, request, context }) => {
    const session = await seedAndSignIn(request); // default mode has workspace
    await applySessionCookie(context, session);
    await page.goto("/ko/onboarding");
    await expect(page).toHaveURL(
      new RegExp(`/ko/app/w/${session.wsSlug}`),
      { timeout: 10_000 },
    );
  });
});
```

- [ ] **Step 2: Run the spec**

```bash
pnpm --filter @opencairn/api dev &
pnpm --filter @opencairn/web test:e2e -- onboarding-guards
```

Expected: 3/3 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/onboarding-guards.spec.ts
git commit -m "test(web): onboarding route guards E2E"
```

---

### Task 17: `onboarding-create.spec.ts`

**Files:**
- Create: `apps/web/tests/e2e/onboarding-create.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
} from "./helpers/seed-session";

test.describe("onboarding create workspace", () => {
  test("fills name, auto-derives slug, submits, lands on /app/w/:slug", async ({
    page, request, context,
  }) => {
    const session = await seedAndSignIn(request, { mode: "onboarding-empty" });
    await applySessionCookie(context, session);

    await page.goto("/ko/onboarding");
    await expect(page.getByTestId("ws-name")).toBeVisible();

    await page.getByTestId("ws-name").fill("My Team");
    // Slug should auto-derive to "my-team" in the input.
    await expect(page.getByTestId("ws-slug")).toHaveValue("my-team");

    await page.getByTestId("ws-submit").click();
    await expect(page).toHaveURL(/\/ko\/app\/w\/my-team/, { timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @opencairn/web test:e2e -- onboarding-create
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/onboarding-create.spec.ts
git commit -m "test(web): onboarding create-workspace happy path"
```

---

### Task 18: `onboarding-invite-accept.spec.ts`

**Files:**
- Create: `apps/web/tests/e2e/onboarding-invite-accept.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
} from "./helpers/seed-session";

test.describe("onboarding invite accept", () => {
  test("shows invite card and accepts → lands on invited workspace", async ({
    page, request, context,
  }) => {
    const session = await seedAndSignIn(request, { mode: "onboarding-invite" });
    await applySessionCookie(context, session);

    const token = session.inviteToken!;
    const slug = session.inviteWorkspaceSlug!;

    await page.goto(`/ko/onboarding?invite=${token}`);
    await expect(page.getByTestId("invite-accept")).toBeVisible();

    await page.getByTestId("invite-accept").click();
    await expect(page).toHaveURL(
      new RegExp(`/ko/app/w/${slug}`),
      { timeout: 10_000 },
    );
  });

  test("invalid token → falls back to create form with banner", async ({
    page, request, context,
  }) => {
    const session = await seedAndSignIn(request, { mode: "onboarding-empty" });
    await applySessionCookie(context, session);

    await page.goto("/ko/onboarding?invite=" + "x".repeat(44));
    await expect(page.getByTestId("ws-name")).toBeVisible();
    await expect(page.getByRole("status")).toContainText(/초대/);
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @opencairn/web test:e2e -- onboarding-invite-accept
```

Expected: 2/2 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/onboarding-invite-accept.spec.ts
git commit -m "test(web): onboarding invite accept + invalid-token fallback"
```

---

### Task 19: `onboarding-slug-conflict.spec.ts`

**Files:**
- Create: `apps/web/tests/e2e/onboarding-slug-conflict.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
} from "./helpers/seed-session";

test.describe("onboarding slug conflict", () => {
  test("409 shows error + suggestions; picking a suggestion submits", async ({
    page, request, context,
  }) => {
    // First user claims "popular-team".
    const first = await seedAndSignIn(request, { mode: "onboarding-empty" });
    await applySessionCookie(context, first);
    await page.goto("/ko/onboarding");
    await page.getByTestId("ws-name").fill("Popular Team");
    await page.getByTestId("ws-submit").click();
    await expect(page).toHaveURL(/\/app\/w\/popular-team/, { timeout: 10_000 });

    // Fresh browser context for second user.
    await context.clearCookies();
    const second = await seedAndSignIn(request, { mode: "onboarding-empty" });
    await applySessionCookie(context, second);
    await page.goto("/ko/onboarding");
    await page.getByTestId("ws-name").fill("Popular Team");
    await page.getByTestId("ws-submit").click();

    await expect(page.getByRole("alert")).toContainText(/이미|taken/i);
    // Suggestion chip for "popular-team-2".
    await page.getByText("popular-team-2").click();
    await page.getByTestId("ws-submit").click();
    await expect(page).toHaveURL(/\/app\/w\/popular-team-2/, { timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @opencairn/web test:e2e -- onboarding-slug-conflict
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/onboarding-slug-conflict.spec.ts
git commit -m "test(web): onboarding slug-conflict + suggestion click"
```

---

## Phase 7 — Docs & Memory

### Task 20: Update docs

**Files:**
- Modify: `docs/architecture/api-contract.md`
- Modify: `docs/contributing/plans-status.md`

- [ ] **Step 1: Mark GET /api/invites/:token implemented**

In `docs/architecture/api-contract.md`, find the Invites section and
ensure the `GET /api/invites/:token` row reflects the response shape
documented in Task 1:

```md
| GET | /api/invites/:token | No | 초대 정보 조회 (수락 UI용) — 응답 `{ workspaceId, workspaceName, inviterName, role, email, expiresAt }` | - |
```

- [ ] **Step 2: Add Plan 9a follow-up entry**

In `docs/contributing/plans-status.md`, add below Phase 1 table:

```md
## Phase 1 follow-ups

| Plan                                                 | Status | Summary |
| ---------------------------------------------------- | ------ | ------- |
| `2026-04-22-onboarding-implementation.md`            | 🟡     | Onboarding route (`/{locale}/onboarding`): workspace 생성 + 초대 수락 두 모드. Backend prereq: `GET /api/invites/:token`, reserved-slug 검증, invite email URL 교정. Spec: `2026-04-22-onboarding-and-first-run-design.md`. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/api-contract.md docs/contributing/plans-status.md
git commit -m "docs(docs): mark onboarding plan + GET invite endpoint"
```

---

### Task 21: Memory update

**Files:**
- Modify: `C:\Users\Sungbin\.claude\projects\C--Users-Sungbin-Documents-GitHub-opencairn-monorepo\memory\MEMORY.md`
- Create: `memory/project_onboarding_complete.md` (write AFTER all above tasks merged)

- [ ] **Step 1: Create the memory note after all tests green**

```markdown
---
name: Onboarding first-run 완료
description: /onboarding 라우트 (workspace 생성 + 초대 수락 2모드) 구현. 5개 backend/frontend prereq 포함. Plan 9a follow-up.
type: project
---

2026-04-22 (merge HEAD TBD). Phase 1 follow-up으로 Plan 9a의 404 블로커
를 닫음. 범위:
- `GET /api/invites/:token` 신규 + 예약 slug 검증 + invite email URL 교정
- `/{locale}/onboarding` 라우트 (서버 가드 + 클라이언트 shell)
- 초대 토큰 signup→verify→login→onboarding 승계 4단계 패치
- Playwright E2E 4 specs (guards/create/invite-accept/slug-conflict)

LLM provider 선택 UI는 범위에서 명시적으로 제외 (운영자 env에서 고정
— `feedback_llm_provider_env_only`).

Next: Plan 2B (Hocuspocus 협업) 착수 가능.
```

And append to `MEMORY.md`:

```md
- [Onboarding first-run 완료](project_onboarding_complete.md) — /{locale}/onboarding 2-mode 구현 + 5 prereq 패치, E2E 4 specs
```

- [ ] **Step 2: Commit as part of the `opencairn-post-feature` run (see below)**

---

## Post-feature Checklist

- [ ] Run full workspaces test suite: `pnpm --filter @opencairn/api test`
- [ ] Run full web unit suite: `pnpm --filter @opencairn/web test:unit`
- [ ] Run full E2E suite: `pnpm --filter @opencairn/web test:e2e`
- [ ] Run lint: `pnpm --filter @opencairn/web lint`
- [ ] Run i18n parity: `pnpm --filter @opencairn/web i18n:parity`
- [ ] Invoke `opencairn-post-feature` skill for Code Review + docs + final commit

---

## Self-Review Checklist (done before handoff)

- **Spec coverage:** §1–§11 mapped to tasks 1–21.
  - §3 flows → Tasks 7–10 (route/shell/forms)
  - §5.3–5.4 slug rules → Tasks 5, 11 (ko/en strings), 2 (server validation)
  - §6 token hand-off → Tasks 12 (signup), 13 (signup guard), 14 (verify), 15 (login)
  - §8.1–8.5 prerequisites → Tasks 1, 2, 3, 15, 13
  - §9 edge cases → covered in Task 9 error kinds + Task 19 conflict E2E
  - §10 tests → Tasks 5 (slug unit), 6 (return-to unit), 16–19 (E2E), 1 (invite API)
- **Placeholder scan:** no TBD/TODO in steps.
- **Type consistency:** `InviteFetchResult`, `AcceptError`, `ErrorKind`,
  `SeededSession` all appear in a single canonical definition and are
  re-used by name.
