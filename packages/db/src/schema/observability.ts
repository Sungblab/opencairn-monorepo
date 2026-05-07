import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const apiRequestLogs = pgTable(
  "api_request_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: text("request_id").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    query: text("query"),
    statusCode: integer("status_code").notNull(),
    durationMs: integer("duration_ms").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    referer: text("referer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_request_logs_created_idx").on(t.createdAt),
    index("api_request_logs_user_created_idx").on(t.userId, t.createdAt),
    index("api_request_logs_path_created_idx").on(t.path, t.createdAt),
    index("api_request_logs_status_created_idx").on(t.statusCode, t.createdAt),
  ],
);

export const llmUsageEvents = pgTable(
  "llm_usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    operation: text("operation").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    costKrw: numeric("cost_krw", { precision: 14, scale: 4 }).notNull().default("0"),
    usdToKrw: numeric("usd_to_krw", { precision: 12, scale: 4 }).notNull().default("1650"),
    inputUsdPer1M: numeric("input_usd_per_1m", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    outputUsdPer1M: numeric("output_usd_per_1m", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("llm_usage_events_created_idx").on(t.createdAt),
    index("llm_usage_events_user_created_idx").on(t.userId, t.createdAt),
    index("llm_usage_events_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("llm_usage_events_provider_model_created_idx").on(
      t.provider,
      t.model,
      t.createdAt,
    ),
    index("llm_usage_events_source_idx").on(t.sourceType, t.sourceId),
  ],
);

export type ApiRequestLog = typeof apiRequestLogs.$inferSelect;
export type ApiRequestLogInsert = typeof apiRequestLogs.$inferInsert;
export type LlmUsageEvent = typeof llmUsageEvents.$inferSelect;
export type LlmUsageEventInsert = typeof llmUsageEvents.$inferInsert;
