import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { zValidator } from "@hono/zod-validator";
import {
  McpTokenCreateSchema,
  type McpTokenCreated,
  type McpTokenSummary,
} from "@opencairn/shared";
import {
  and,
  db,
  desc,
  eq,
  mcpServerTokens,
} from "@opencairn/db";
import { Hono } from "hono";
import { z } from "zod";

import { canAdmin } from "../lib/permissions";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";
import {
  bearerToken,
  generateMcpServerToken,
  hashMcpServerToken,
  tokenPrefix,
  verifyMcpServerToken,
} from "../lib/mcp-server/token";
import {
  mcpBearerChallenge,
  mcpProtectedResourceMetadata,
  mcpResourceUrl,
} from "../lib/mcp-server/metadata";
import { createOpenCairnMcpServer } from "../lib/mcp-server/server";
import type { Handler } from "hono";

export const mcpServerRoutes = new Hono<AppEnv>();

export function mcpServerFeatureEnabled(): boolean {
  return (process.env.FEATURE_MCP_SERVER ?? "false").toLowerCase() === "true";
}

function notFound() {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

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

mcpServerRoutes.use("*", async (_c, next) => {
  if (!mcpServerFeatureEnabled()) return notFound();
  return next();
});

mcpServerRoutes.get(
  "/tokens",
  requireAuth,
  zValidator("query", z.object({ workspaceId: z.string().uuid() })),
  async (c) => {
    const userId = c.get("userId");
    const { workspaceId } = c.req.valid("query");
    if (!(await canAdmin(userId, workspaceId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const rows = await db
      .select()
      .from(mcpServerTokens)
      .where(eq(mcpServerTokens.workspaceId, workspaceId))
      .orderBy(desc(mcpServerTokens.createdAt));
    return c.json({ tokens: rows.map(toSummary) });
  },
);

mcpServerRoutes.post(
  "/tokens",
  requireAuth,
  zValidator("json", McpTokenCreateSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    if (!(await canAdmin(userId, body.workspaceId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const token = generateMcpServerToken();
    const [created] = await db
      .insert(mcpServerTokens)
      .values({
        workspaceId: body.workspaceId,
        createdByUserId: userId,
        label: body.label,
        tokenHash: hashMcpServerToken(token),
        tokenPrefix: tokenPrefix(token),
        scopes: ["workspace:read"],
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      })
      .returning();
    return c.json({ ...toSummary(created), token } satisfies McpTokenCreated, 201);
  },
);

mcpServerRoutes.delete("/tokens/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Bad Request" }, 400);
  const [row] = await db.select().from(mcpServerTokens).where(eq(mcpServerTokens.id, id)).limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAdmin(userId, row.workspaceId))) {
    return c.json({ error: "Not found" }, 404);
  }
  await db
    .update(mcpServerTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpServerTokens.id, id), eq(mcpServerTokens.workspaceId, row.workspaceId)));
  return c.json({ ok: true });
});

const handleMcp: Handler<AppEnv> = async (c) => {
  const accessToken = bearerToken(c.req.header("authorization") ?? null);
  if (!accessToken) {
    return c.json(
      { error: "unauthorized" },
      401,
      { "www-authenticate": mcpBearerChallenge(c.req.url) },
    );
  }
  const verified = await verifyMcpServerToken(accessToken);
  if (!verified) {
    return c.json(
      { error: "unauthorized" },
      401,
      { "www-authenticate": mcpBearerChallenge(c.req.url) },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createOpenCairnMcpServer();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw, {
    authInfo: {
      token: accessToken,
      clientId: verified.id,
      scopes: verified.scopes,
      expiresAt: verified.expiresAt ? Math.floor(verified.expiresAt.getTime() / 1000) : undefined,
      resource: new URL(mcpResourceUrl(c.req.url)),
      extra: {
        opencairnAccess: {
          tokenId: verified.id,
          workspaceId: verified.workspaceId,
          scopes: verified.scopes,
        },
      },
    },
  });
};

mcpServerRoutes.get("/", handleMcp);
mcpServerRoutes.post("/", handleMcp);
mcpServerRoutes.delete("/", handleMcp);

export const mcpProtectedResourceRoutes = new Hono();

mcpProtectedResourceRoutes.get("/", (c) =>
  c.json(mcpProtectedResourceMetadata(c.req.url)),
);
mcpProtectedResourceRoutes.get("/api/mcp", (c) =>
  c.json(mcpProtectedResourceMetadata(c.req.url)),
);
