import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";
import { siteAdminReports } from "./site-admin";

export const adminAuditActionEnum = pgEnum("admin_audit_action", [
  "site_admin.grant",
  "site_admin.revoke",
  "user.plan.update",
  "workspace.plan.update",
  "credit.manual_grant",
  "credit.campaign.create",
  "credit.campaign.update",
  "credit.campaign.grant",
  "report.status.update",
]);

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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    costKrw: numeric("cost_krw", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    usdToKrw: numeric("usd_to_krw", { precision: 12, scale: 4 })
      .notNull()
      .default("1650"),
    inputUsdPer1M: numeric("input_usd_per_1m", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    outputUsdPer1M: numeric("output_usd_per_1m", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("llm_usage_events_created_idx").on(t.createdAt),
    index("llm_usage_events_user_created_idx").on(t.userId, t.createdAt),
    index("llm_usage_events_workspace_created_idx").on(
      t.workspaceId,
      t.createdAt,
    ),
    index("llm_usage_events_provider_model_created_idx").on(
      t.provider,
      t.model,
      t.createdAt,
    ),
    index("llm_usage_events_source_idx").on(t.sourceType, t.sourceId),
  ],
);

export const adminAuditEvents = pgTable(
  "admin_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    action: adminAuditActionEnum("action").notNull(),
    targetUserId: text("target_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    targetWorkspaceId: uuid("target_workspace_id").references(
      () => workspaces.id,
      {
        onDelete: "set null",
      },
    ),
    targetReportId: uuid("target_report_id").references(
      () => siteAdminReports.id,
      {
        onDelete: "set null",
      },
    ),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    before: jsonb("before")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    after: jsonb("after")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("admin_audit_events_created_idx").on(t.createdAt),
    index("admin_audit_events_actor_created_idx").on(
      t.actorUserId,
      t.createdAt,
    ),
    index("admin_audit_events_action_created_idx").on(t.action, t.createdAt),
    index("admin_audit_events_target_user_created_idx").on(
      t.targetUserId,
      t.createdAt,
    ),
    index("admin_audit_events_target_workspace_created_idx").on(
      t.targetWorkspaceId,
      t.createdAt,
    ),
    index("admin_audit_events_target_report_created_idx").on(
      t.targetReportId,
      t.createdAt,
    ),
  ],
);

export type ApiRequestLog = typeof apiRequestLogs.$inferSelect;
export type ApiRequestLogInsert = typeof apiRequestLogs.$inferInsert;
export type LlmUsageEvent = typeof llmUsageEvents.$inferSelect;
export type LlmUsageEventInsert = typeof llmUsageEvents.$inferInsert;
export type AdminAuditEvent = typeof adminAuditEvents.$inferSelect;
export type AdminAuditEventInsert = typeof adminAuditEvents.$inferInsert;
