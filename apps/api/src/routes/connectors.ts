import { zValidator } from "@hono/zod-validator";
import { ConnectorSourceCreateSchema } from "@opencairn/shared";
import {
  connectorAccounts,
  connectorAuditEvents,
  connectorSources,
  db,
  desc,
  eq,
} from "@opencairn/db";
import { Hono } from "hono";
import { z } from "zod";

import { recordConnectorAuditEvent } from "../lib/connector-audit";
import {
  assertConnectorAccountOwner,
  ConnectorNotFoundError,
} from "../lib/connector-permissions";
import { canWrite } from "../lib/permissions";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";

export const connectorRoutes = new Hono<AppEnv>();

function featureEnabled(): boolean {
  return (
    (process.env.FEATURE_CONNECTOR_PLATFORM ?? "false").toLowerCase() === "true"
  );
}

connectorRoutes.use("*", async (c, next) => {
  if (!featureEnabled()) return c.json({ error: "Not found" }, 404);
  return next();
});

connectorRoutes.get("/accounts", requireAuth, async (c) => {
  const userId = c.get("userId");
  const rows = await db
    .select()
    .from(connectorAccounts)
    .where(eq(connectorAccounts.userId, userId))
    .orderBy(desc(connectorAccounts.updatedAt));

  return c.json({
    accounts: rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      authType: row.authType,
      accountLabel: row.accountLabel,
      accountEmail: row.accountEmail,
      externalAccountId: row.externalAccountId,
      scopes: row.scopes,
      status: row.status,
      hasAccessToken: row.accessTokenEncrypted !== null,
      hasRefreshToken: row.refreshTokenEncrypted !== null,
      tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
});

connectorRoutes.get(
  "/sources",
  requireAuth,
  zValidator("query", z.object({ workspaceId: z.string().uuid() })),
  async (c) => {
    const userId = c.get("userId");
    const { workspaceId } = c.req.valid("query");
    if (!(await canWrite(userId, { type: "workspace", id: workspaceId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const rows = await db
      .select()
      .from(connectorSources)
      .where(eq(connectorSources.workspaceId, workspaceId))
      .orderBy(desc(connectorSources.updatedAt));
    return c.json({ sources: rows });
  },
);

connectorRoutes.post(
  "/sources",
  requireAuth,
  zValidator("json", ConnectorSourceCreateSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    if (!(await canWrite(userId, { type: "workspace", id: body.workspaceId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    let account;
    try {
      account = await assertConnectorAccountOwner(userId, body.accountId);
    } catch (error) {
      if (error instanceof ConnectorNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      throw error;
    }
    if (account.provider !== body.provider) {
      return c.json({ code: "connector_provider_mismatch" }, 400);
    }

    const [source] = await db
      .insert(connectorSources)
      .values({
        workspaceId: body.workspaceId,
        projectId: body.projectId ?? null,
        accountId: body.accountId,
        provider: body.provider,
        sourceKind: body.sourceKind,
        externalId: body.externalId,
        displayName: body.displayName,
        syncMode: body.syncMode,
        permissions: body.permissions,
        createdByUserId: userId,
      })
      .returning();

    await recordConnectorAuditEvent({
      workspaceId: body.workspaceId,
      userId,
      accountId: body.accountId,
      sourceId: source.id,
      action: "source.granted",
      riskLevel: "import",
      provider: body.provider,
      metadata: {
        sourceKind: body.sourceKind,
        externalId: body.externalId,
        displayName: body.displayName,
      },
    });

    return c.json(source, 201);
  },
);

connectorRoutes.get(
  "/audit",
  requireAuth,
  zValidator("query", z.object({ workspaceId: z.string().uuid() })),
  async (c) => {
    const userId = c.get("userId");
    const { workspaceId } = c.req.valid("query");
    if (!(await canWrite(userId, { type: "workspace", id: workspaceId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const rows = await db
      .select()
      .from(connectorAuditEvents)
      .where(eq(connectorAuditEvents.workspaceId, workspaceId))
      .orderBy(desc(connectorAuditEvents.createdAt));
    return c.json({ events: rows });
  },
);
