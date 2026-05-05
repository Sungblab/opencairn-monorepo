import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { agentActions } from "./agent-actions";
import { agentFiles } from "./agent-files";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const agentFileProviderExports = pgTable(
  "agent_file_provider_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentFileId: uuid("agent_file_id")
      .notNull()
      .references(() => agentFiles.id, { onDelete: "cascade" }),
    actionId: uuid("action_id")
      .notNull()
      .references(() => agentActions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    workflowId: text("workflow_id"),
    externalObjectId: text("external_object_id"),
    externalUrl: text("external_url"),
    exportedMimeType: text("exported_mime_type"),
    errorCode: text("error_code"),
    retryable: boolean("retryable").notNull().default(false),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("agent_file_provider_exports_action_unique").on(t.actionId),
    index("agent_file_provider_exports_file_created_idx").on(
      t.agentFileId,
      t.createdAt,
    ),
    index("agent_file_provider_exports_project_created_idx").on(
      t.projectId,
      t.createdAt,
    ),
    index("agent_file_provider_exports_external_idx").on(
      t.provider,
      t.externalObjectId,
    ),
  ],
);

export type AgentFileProviderExport = typeof agentFileProviderExports.$inferSelect;
export type AgentFileProviderExportInsert = typeof agentFileProviderExports.$inferInsert;
