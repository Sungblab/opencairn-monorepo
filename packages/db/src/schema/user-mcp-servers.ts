import {
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { bytea } from "./custom-types";
import { mcpServerStatusEnum } from "./enums";
import { user } from "./users";

export const userMcpServers = pgTable(
  "user_mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    serverSlug: text("server_slug").notNull(),
    displayName: text("display_name").notNull(),
    serverUrl: text("server_url").notNull(),
    authHeaderName: text("auth_header_name")
      .notNull()
      .default("Authorization"),
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
