import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    scopes: text("scopes").array().notNull().default(["workspace:read"]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mcp_server_tokens_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("mcp_server_tokens_created_by_idx").on(t.createdByUserId),
    index("mcp_server_tokens_revoked_idx").on(t.revokedAt),
  ],
);

export type McpServerToken = typeof mcpServerTokens.$inferSelect;
export type McpServerTokenInsert = typeof mcpServerTokens.$inferInsert;
