import { Hono } from "hono";
import { db, userIntegrations, workspaces, eq, and } from "@opencairn/db";
import { integrationStatusSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import {
  isConfigured,
  signState,
  verifyState,
  authorizationUrl,
  exchangeCode,
  fetchAccountEmail,
  revokeToken,
} from "../lib/google-oauth";
import { encryptToken, decryptToken } from "../lib/integration-tokens";
import { canRead, canWrite } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

// Base URL the browser is redirected BACK to after Google's consent screen.
// Must exactly match one of the Authorized redirect URIs registered on the
// Google Cloud OAuth client. We default to BETTER_AUTH_URL (same public API
// origin) so local dev works without extra config.
function redirectUri(): string {
  const base =
    process.env.PUBLIC_API_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:4000";
  return `${base}/api/integrations/google/callback`;
}

function webBase(): string {
  return process.env.PUBLIC_WEB_URL ?? "http://localhost:3000";
}

export const integrationsRouter = new Hono<AppEnv>();

// --- Unauthenticated: OAuth callback. Identity derives from the HMAC state.
integrationsRouter.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.json({ error: "missing code or state" }, 400);
  }
  let parsed;
  try {
    parsed = verifyState(state);
  } catch {
    return c.json({ error: "invalid state" }, 400);
  }
  const tokens = await exchangeCode(code, redirectUri());
  const accountEmail = await fetchAccountEmail(tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const scopes = tokens.scope.split(" ");
  await db
    .insert(userIntegrations)
    .values({
      userId: parsed.userId,
      // Pin the token to the workspace the user was in when they hit
      // /google/connect. Different workspaces require separate consent so
      // a member of A can't silently use their token from inside B
      // (Ralph audit S3-022).
      workspaceId: parsed.workspaceId,
      provider: "google_drive",
      accessTokenEncrypted: encryptToken(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token
        ? encryptToken(tokens.refresh_token)
        : null,
      tokenExpiresAt: expiresAt,
      accountEmail,
      scopes,
    })
    .onConflictDoUpdate({
      target: [
        userIntegrations.userId,
        userIntegrations.workspaceId,
        userIntegrations.provider,
      ],
      set: {
        accessTokenEncrypted: encryptToken(tokens.access_token),
        // Preserve existing refresh token if Google omits it on re-consent.
        ...(tokens.refresh_token
          ? { refreshTokenEncrypted: encryptToken(tokens.refresh_token) }
          : {}),
        tokenExpiresAt: expiresAt,
        accountEmail,
        scopes,
        updatedAt: new Date(),
      },
    });
  let wsSlug: string | null = null;
  try {
    wsSlug = await lookupWorkspaceSlug(parsed.workspaceId);
  } catch {
    // Workspace may have been deleted between connect and callback. Fall
    // through to a generic dashboard landing — user can pick a workspace manually.
  }
  // TODO: carry locale through OAuth state; callbacks default to ko for now.
  const locale = "ko";
  const target = wsSlug
    ? `${webBase()}/${locale}/workspace/${wsSlug}/import?connected=true`
    : `${webBase()}/${locale}/dashboard?integration=connected`;
  return c.redirect(target);
});

// --- Authenticated routes below use inline requireAuth. Global .use("*") would
// also intercept /google/callback (Hono does not gate middleware by
// registration order for wildcard paths), which must stay open for Google's
// redirect back.

integrationsRouter.get("/google/connect", requireAuth, async (c) => {
  if (!isConfigured()) {
    return c.json({ error: "google_oauth_not_configured" }, 503);
  }
  const userId = c.get("userId");
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) {
    return c.json({ error: "workspaceId required" }, 400);
  }
  const allowed = await canRead(userId, {
    type: "workspace",
    id: workspaceId,
  });
  if (!allowed) return c.json({ error: "Forbidden" }, 403);
  const state = signState({ userId, workspaceId });
  return c.redirect(authorizationUrl(state, redirectUri()));
});

integrationsRouter.get("/google", requireAuth, async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) {
    return c.json({ error: "workspaceId required" }, 400);
  }
  // Workspace membership check: matches the rest of the codebase's
  // per-route discipline ("Internal API workspaceId 강제 원칙"). Without
  // it a former member who still knows wsId could probe whether the
  // current user has Drive connected there. The query itself is
  // already userId-scoped so blast radius is small, but consistency
  // with the canRead/canWrite pattern matters more than the bytes.
  const allowed = await canRead(userId, {
    type: "workspace",
    id: workspaceId,
  });
  if (!allowed) return c.json({ error: "Forbidden" }, 403);
  const [row] = await db
    .select()
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.workspaceId, workspaceId),
        eq(userIntegrations.provider, "google_drive"),
      ),
    )
    .limit(1);
  const payload = integrationStatusSchema.parse({
    connected: Boolean(row),
    accountEmail: row?.accountEmail ?? null,
    scopes: row?.scopes ?? null,
  });
  return c.json(payload);
});

integrationsRouter.delete("/google", requireAuth, async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) {
    return c.json({ error: "workspaceId required" }, 400);
  }
  // canWrite for DELETE — disconnecting an integration is a workspace
  // mutation. A former member should not be able to wipe their own row
  // in a workspace they no longer belong to (low blast radius but
  // consistent with the rest of the codebase).
  const allowed = await canWrite(userId, {
    type: "workspace",
    id: workspaceId,
  });
  if (!allowed) return c.json({ error: "Forbidden" }, 403);
  const [row] = await db
    .select()
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.workspaceId, workspaceId),
        eq(userIntegrations.provider, "google_drive"),
      ),
    )
    .limit(1);
  if (row) {
    try {
      await revokeToken(decryptToken(row.accessTokenEncrypted));
    } catch {
      // best-effort revoke; always clear the local row
    }
    await db.delete(userIntegrations).where(eq(userIntegrations.id, row.id));
  }
  return c.json({ ok: true });
});

async function lookupWorkspaceSlug(workspaceId: string): Promise<string> {
  const [ws] = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) throw new Error("workspace not found");
  return ws.slug;
}
