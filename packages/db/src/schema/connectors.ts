import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { concepts, conceptEdges } from "./concepts";
import { bytea } from "./custom-types";
import {
  connectorAccountStatusEnum,
  connectorAuthTypeEnum,
  connectorExternalObjectTypeEnum,
  connectorJobTypeEnum,
  connectorProviderEnum,
  connectorRiskLevelEnum,
  connectorSourceKindEnum,
  connectorSourceStatusEnum,
  connectorSyncModeEnum,
  jobStatusEnum,
} from "./enums";
import { notes } from "./notes";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const connectorAccounts = pgTable(
  "connector_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: connectorProviderEnum("provider").notNull(),
    authType: connectorAuthTypeEnum("auth_type").notNull(),
    accountLabel: text("account_label").notNull(),
    accountEmail: text("account_email"),
    externalAccountId: text("external_account_id"),
    scopes: text("scopes").array().notNull().default([]),
    accessTokenEncrypted: bytea("access_token_encrypted"),
    refreshTokenEncrypted: bytea("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    status: connectorAccountStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("connector_accounts_user_idx").on(t.userId),
    unique("connector_accounts_user_provider_external_unique").on(
      t.userId,
      t.provider,
      t.externalAccountId,
    ),
  ],
);

export const connectorSources = pgTable(
  "connector_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    provider: connectorProviderEnum("provider").notNull(),
    sourceKind: connectorSourceKindEnum("source_kind").notNull(),
    externalId: text("external_id").notNull(),
    displayName: text("display_name").notNull(),
    syncMode: connectorSyncModeEnum("sync_mode")
      .notNull()
      .default("one_shot"),
    permissions: jsonb("permissions")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: connectorSourceStatusEnum("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("connector_sources_workspace_idx").on(t.workspaceId),
    index("connector_sources_project_idx").on(t.projectId),
    unique("connector_sources_workspace_account_source_unique").on(
      t.workspaceId,
      t.accountId,
      t.sourceKind,
      t.externalId,
    ),
  ],
);

export const connectorJobs = pgTable(
  "connector_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    sourceId: uuid("source_id").references(() => connectorSources.id, {
      onDelete: "set null",
    }),
    jobType: connectorJobTypeEnum("job_type").notNull(),
    workflowId: text("workflow_id").notNull().unique(),
    status: jobStatusEnum("status").notNull().default("queued"),
    totalItems: integer("total_items").notNull().default(0),
    completedItems: integer("completed_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
    skippedItems: integer("skipped_items").notNull().default(0),
    sourceMetadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("connector_jobs_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("connector_jobs_source_idx").on(t.sourceId),
  ],
);

export const externalObjectRefs = pgTable(
  "external_object_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: connectorProviderEnum("provider").notNull(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => connectorSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    objectType: connectorExternalObjectTypeEnum("object_type").notNull(),
    externalVersion: text("external_version"),
    noteId: uuid("note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    conceptId: uuid("concept_id").references(() => concepts.id, {
      onDelete: "set null",
    }),
    conceptEdgeId: uuid("concept_edge_id").references(() => conceptEdges.id, {
      onDelete: "set null",
    }),
    connectorJobId: uuid("connector_job_id").references(() => connectorJobs.id, {
      onDelete: "set null",
    }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("external_object_refs_workspace_idx").on(t.workspaceId),
    index("external_object_refs_note_idx").on(t.noteId),
    index("external_object_refs_concept_idx").on(t.conceptId),
    unique("external_object_refs_source_external_unique").on(
      t.sourceId,
      t.externalId,
      t.objectType,
    ),
  ],
);

export const connectorMcpTools = pgTable(
  "connector_mcp_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => connectorSources.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    description: text("description"),
    inputSchema: jsonb("input_schema")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    riskLevel: connectorRiskLevelEnum("risk_level").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("connector_mcp_tools_source_tool_unique").on(
      t.sourceId,
      t.toolName,
    ),
    index("connector_mcp_tools_source_idx").on(t.sourceId),
  ],
);

export const connectorAuditEvents = pgTable(
  "connector_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    accountId: uuid("account_id").references(() => connectorAccounts.id, {
      onDelete: "set null",
    }),
    sourceId: uuid("source_id").references(() => connectorSources.id, {
      onDelete: "set null",
    }),
    connectorJobId: uuid("connector_job_id").references(() => connectorJobs.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    riskLevel: connectorRiskLevelEnum("risk_level").notNull(),
    provider: connectorProviderEnum("provider").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("connector_audit_events_workspace_created_idx").on(
      t.workspaceId,
      t.createdAt,
    ),
    index("connector_audit_events_source_idx").on(t.sourceId),
  ],
);

export type ConnectorAccount = typeof connectorAccounts.$inferSelect;
export type ConnectorAccountInsert = typeof connectorAccounts.$inferInsert;
export type ConnectorSource = typeof connectorSources.$inferSelect;
export type ConnectorSourceInsert = typeof connectorSources.$inferInsert;
export type ConnectorJob = typeof connectorJobs.$inferSelect;
export type ExternalObjectRef = typeof externalObjectRefs.$inferSelect;
export type ConnectorMcpTool = typeof connectorMcpTools.$inferSelect;
export type ConnectorAuditEvent = typeof connectorAuditEvents.$inferSelect;
