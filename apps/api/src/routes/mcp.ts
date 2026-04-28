import { zValidator } from "@hono/zod-validator";
import {
  McpServerCreateSchema,
  McpServerUpdateSchema,
  type McpServerSummary,
  type McpServerTestResult,
} from "@opencairn/shared";
import {
  and,
  db,
  desc,
  eq,
  userMcpServers,
  type UserMcpServer,
} from "@opencairn/db";
import { Hono } from "hono";

import { encryptToken, decryptToken } from "../lib/integration-tokens";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";
import { generateSlug } from "../lib/mcp-slug";
import { runListTools } from "../lib/mcp-runner";

export const mcpRoutes = new Hono<AppEnv>();

function featureEnabled(): boolean {
  return (process.env.FEATURE_MCP_CLIENT ?? "false").toLowerCase() === "true";
}

mcpRoutes.use("*", async (c, next) => {
  if (!featureEnabled()) return c.json({ error: "Not found" }, 404);
  return next();
});

function toSummary(row: UserMcpServer): McpServerSummary {
  return {
    id: row.id,
    serverSlug: row.serverSlug,
    displayName: row.displayName,
    serverUrl: row.serverUrl,
    authHeaderName: row.authHeaderName,
    hasAuth: row.authHeaderValueEncrypted !== null,
    status: row.status,
    lastSeenToolCount: row.lastSeenToolCount,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findOwnedServer(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(userMcpServers)
    .where(and(eq(userMcpServers.userId, userId), eq(userMcpServers.id, id)))
    .limit(1);
  return row ?? null;
}

function paramId(c: { req: { param: (name: string) => string | undefined } }) {
  const id = c.req.param("id");
  if (!id) throw new Error("missing MCP server id param");
  return id;
}

function authHeaderFromRow(row: UserMcpServer) {
  if (!row.authHeaderValueEncrypted) return null;
  return {
    name: row.authHeaderName,
    value: decryptToken(row.authHeaderValueEncrypted),
  };
}

async function applyTestResult(
  id: string,
  result: McpServerTestResult,
): Promise<void> {
  await db
    .update(userMcpServers)
    .set({
      status: result.status === "auth_failed" ? "auth_expired" : "active",
      lastSeenToolCount: result.toolCount,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userMcpServers.id, id));
}

mcpRoutes.get("/", requireAuth, async (c) => {
  const userId = c.get("userId");
  const rows = await db
    .select()
    .from(userMcpServers)
    .where(eq(userMcpServers.userId, userId))
    .orderBy(desc(userMcpServers.updatedAt));
  return c.json({ servers: rows.map(toSummary) });
});

mcpRoutes.post(
  "/",
  requireAuth,
  zValidator("json", McpServerCreateSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const existing = await db
      .select({ serverSlug: userMcpServers.serverSlug })
      .from(userMcpServers)
      .where(eq(userMcpServers.userId, userId));
    const serverSlug = generateSlug(
      body.displayName,
      new Set(existing.map((row) => row.serverSlug)),
    );

    const authHeader =
      body.authHeaderValue?.trim()
        ? { name: body.authHeaderName, value: body.authHeaderValue.trim() }
        : null;
    const testResult = await runListTools(body.serverUrl, authHeader);
    if (testResult.status === "transport_error") {
      return c.json(
        { code: "mcp_unreachable", error: testResult.errorMessage },
        400,
      );
    }
    if (testResult.toolCount > 50) {
      return c.json({ code: "mcp_too_many_tools" }, 400);
    }

    const [created] = await db
      .insert(userMcpServers)
      .values({
        userId,
        serverSlug,
        displayName: body.displayName,
        serverUrl: body.serverUrl,
        authHeaderName: body.authHeaderName,
        authHeaderValueEncrypted: authHeader
          ? encryptToken(authHeader.value)
          : null,
        status: testResult.status === "auth_failed" ? "auth_expired" : "active",
        lastSeenToolCount: testResult.toolCount,
        lastSeenAt: new Date(),
      })
      .returning();

    return c.json(toSummary(created), 201);
  },
);

mcpRoutes.patch(
  "/:id",
  requireAuth,
  zValidator("json", McpServerUpdateSchema),
  async (c) => {
    const userId = c.get("userId");
    const id = paramId(c);
    const current = await findOwnedServer(userId, id);
    if (!current) return c.json({ error: "Not found" }, 404);

    const body = c.req.valid("json");
    const patch: Partial<UserMcpServer> = { updatedAt: new Date() };
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.authHeaderName !== undefined) {
      patch.authHeaderName = body.authHeaderName;
    }
    if (body.authHeaderValue !== undefined) {
      patch.authHeaderValueEncrypted = body.authHeaderValue
        ? encryptToken(body.authHeaderValue)
        : null;
    }
    if (body.status !== undefined) patch.status = body.status;

    const [updated] = await db
      .update(userMcpServers)
      .set(patch)
      .where(eq(userMcpServers.id, id))
      .returning();
    return c.json(toSummary(updated));
  },
);

mcpRoutes.delete("/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = paramId(c);
  const current = await findOwnedServer(userId, id);
  if (!current) return c.json({ error: "Not found" }, 404);
  await db.delete(userMcpServers).where(eq(userMcpServers.id, id));
  return c.json({ ok: true });
});

mcpRoutes.post("/:id/test", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = paramId(c);
  const current = await findOwnedServer(userId, id);
  if (!current) return c.json({ error: "Not found" }, 404);
  const result = await runListTools(current.serverUrl, authHeaderFromRow(current));
  await applyTestResult(id, result);
  return c.json(result);
});
