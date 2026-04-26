import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  and,
  db,
  eq,
  user,
  userPreferences,
  workspaceMembers,
  workspaces,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { encryptToken, decryptToken } from "../lib/integration-tokens";
import type { AppEnv } from "../lib/types";

export const userRoutes = new Hono<AppEnv>().use("*", requireAuth);

// App Shell Phase 1 — root `/` reads this to decide where to land the user.
// Returns the {id, slug} pair so the caller can redirect without a second
// hop just to resolve the slug. Membership is re-checked at read time so a
// user kicked from the workspace after writing the value doesn't leak the
// id back to themselves.
userRoutes.get("/me/last-viewed-workspace", async (c) => {
  const me = c.get("user");
  const [row] = await db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
    })
    .from(user)
    .innerJoin(workspaces, eq(workspaces.id, user.lastViewedWorkspaceId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, me.id),
      ),
    )
    .where(eq(user.id, me.id))
    .limit(1);

  if (!row) return c.json({ workspace: null });
  return c.json({ workspace: { id: row.id, slug: row.slug } });
});

// App Shell Phase 1 — record the user's most recent workspace so the root
// `/` redirect can land them in the same place across devices. The membership
// check before the write is mandatory: without it, a malicious client could
// pin a foreign workspace into their own user row, and our redirect would
// happily 302 them into a 403 next time they hit `/`.
const lastViewedSchema = z.object({
  workspaceId: z.string().uuid(),
});

// Deep Research Phase E — BYOK key validation. Length bounds are first so a
// bare `AIza` token (4 chars, prefix-valid) surfaces `too_short` rather than
// being accepted; max prevents a DoS via multi-megabyte ciphertext writes.
// The `.startsWith("AIza")` is a cheap shape gate — real validity is only
// known once the worker calls Gemini, but rejecting obvious typos here saves
// a roundtrip and keeps the error UX local to /settings/ai.
const setByokKeySchema = z.object({
  apiKey: z
    .string()
    .min(20, { message: "too_short" })
    .max(200, { message: "too_long" })
    .startsWith("AIza", { message: "wrong_prefix" }),
});

userRoutes.patch(
  "/me/last-viewed-workspace",
  zValidator("json", lastViewedSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "invalid_workspace_id" }, 400);
    }
  }),
  async (c) => {
    const me = c.get("user");
    const { workspaceId } = c.req.valid("json");

    const [membership] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, me.id),
        ),
      )
      .limit(1);

    if (!membership) {
      return c.json({ error: "not_a_member" }, 403);
    }

    await db
      .update(user)
      .set({ lastViewedWorkspaceId: workspaceId })
      .where(eq(user.id, me.id));

    return c.json({ ok: true });
  },
);

// Deep Research Phase E — read endpoint for the BYOK Gemini key.
// Decrypts on read to compute lastFour rather than storing it as a separate
// column — single-user reads, negligible cost, no consistency burden.
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

  // Decrypt can throw if ciphertext is corrupt or the encryption key has been
  // rotated. In either case the user's recovery path (re-register a key on
  // /settings/ai) is identical to the no-row case, so we surface
  // `registered: false` rather than 500. We log a short warning so operators
  // can detect mass-rotation issues — userId + error message only, no
  // plaintext or stack dump.
  let plain: string;
  try {
    plain = decryptToken(row.enc);
  } catch (err) {
    console.warn("byok-key decrypt failed", {
      userId: me.id,
      error: (err as Error).message,
    });
    return c.json({ registered: false });
  }
  return c.json({
    registered: true,
    lastFour: plain.slice(-4),
    updatedAt: row.updatedAt.toISOString(),
  });
});

// Deep Research Phase E — write endpoint for the BYOK Gemini key.
// Upsert on userId (PK) so re-registration is idempotent and never leaves a
// stale row. We surface the first failing Zod issue's `message` as a stable
// `code` (too_short / too_long / wrong_prefix) so the /settings/ai client
// can map to localized copy without parsing free-form messages.
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

    // Encrypt can throw if INTEGRATION_TOKEN_ENCRYPTION_KEY is unset/malformed.
    // Without this guard the failure surfaces as an opaque 500 with no ops
    // signal — mirroring the GET handler's decrypt try/catch keeps the BYOK
    // CRUD trio symmetric and gives operators a structured log line.
    let ciphertext: Buffer;
    try {
      ciphertext = encryptToken(apiKey);
    } catch (err) {
      console.warn("byok-key encrypt failed", {
        userId: me.id,
        error: (err as Error).message,
      });
      return c.json({ error: "internal_error" }, 500);
    }
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

// Deep Research Phase E — clear endpoint for the BYOK Gemini key.
// Sets `byokApiKeyEncrypted` to NULL rather than deleting the row so other
// `user_preferences` columns (llm_provider, llm_model, etc.) are preserved.
// Idempotent: an UPDATE with no matching row affects zero rows and silently
// succeeds, so we always return `{ registered: false }` for a consistent UX
// regardless of whether the user had a key registered.
userRoutes.delete("/me/byok-key", async (c) => {
  const me = c.get("user");
  await db
    .update(userPreferences)
    .set({ byokApiKeyEncrypted: null, updatedAt: new Date() })
    .where(eq(userPreferences.userId, me.id));
  return c.json({ registered: false });
});
