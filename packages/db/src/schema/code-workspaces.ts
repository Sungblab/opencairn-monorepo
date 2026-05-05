import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { agentActions, agentActionRiskEnum } from "./agent-actions";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const codeWorkspaceEntryKindEnum = pgEnum("code_workspace_entry_kind", [
  "file",
  "directory",
]);

export const codeWorkspacePatchStatusEnum = pgEnum("code_workspace_patch_status", [
  "approval_required",
  "applied",
  "rejected",
]);

export const codeWorkspaces = pgTable(
  "code_workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    language: text("language"),
    framework: text("framework"),
    currentSnapshotId: uuid("current_snapshot_id"),
    sourceRunId: text("source_run_id"),
    sourceActionId: uuid("source_action_id").references(() => agentActions.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("code_workspaces_request_unique").on(
      t.projectId,
      t.createdBy,
      t.requestId,
    ),
    index("code_workspaces_project_live_idx")
      .on(t.projectId, t.updatedAt)
      .where(sql`${t.deletedAt} IS NULL`),
    index("code_workspaces_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("code_workspaces_source_action_idx")
      .on(t.sourceActionId)
      .where(sql`${t.sourceActionId} IS NOT NULL`),
  ],
);

export const codeWorkspaceSnapshots = pgTable(
  "code_workspace_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeWorkspaceId: uuid("code_workspace_id")
      .notNull()
      .references(() => codeWorkspaces.id, { onDelete: "cascade" }),
    parentSnapshotId: uuid("parent_snapshot_id").references(
      (): AnyPgColumn => codeWorkspaceSnapshots.id,
      { onDelete: "set null" },
    ),
    treeHash: text("tree_hash").notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    sourceActionId: uuid("source_action_id").references(() => agentActions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("code_workspace_snapshots_workspace_created_idx").on(
      t.codeWorkspaceId,
      t.createdAt,
    ),
    uniqueIndex("code_workspace_snapshots_tree_unique").on(
      t.codeWorkspaceId,
      t.treeHash,
    ),
  ],
);

export const codeWorkspaceFileEntries = pgTable(
  "code_workspace_file_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => codeWorkspaceSnapshots.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    pathKey: text("path_key").notNull(),
    kind: codeWorkspaceEntryKindEnum("kind").notNull(),
    language: text("language"),
    mimeType: text("mime_type"),
    bytes: bigint("bytes", { mode: "number" }),
    contentHash: text("content_hash"),
    objectKey: text("object_key"),
    inlineContent: text("inline_content"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    uniqueIndex("code_workspace_file_entries_path_unique").on(
      t.snapshotId,
      t.pathKey,
    ),
    index("code_workspace_file_entries_snapshot_kind_idx").on(t.snapshotId, t.kind),
    index("code_workspace_file_entries_object_key_idx")
      .on(t.objectKey)
      .where(sql`${t.objectKey} IS NOT NULL`),
  ],
);

export const codeWorkspacePatches = pgTable(
  "code_workspace_patches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeWorkspaceId: uuid("code_workspace_id")
      .notNull()
      .references(() => codeWorkspaces.id, { onDelete: "cascade" }),
    baseSnapshotId: uuid("base_snapshot_id")
      .notNull()
      .references(() => codeWorkspaceSnapshots.id, { onDelete: "restrict" }),
    appliedSnapshotId: uuid("applied_snapshot_id").references(
      () => codeWorkspaceSnapshots.id,
      { onDelete: "set null" },
    ),
    status: codeWorkspacePatchStatusEnum("status")
      .notNull()
      .default("approval_required"),
    risk: agentActionRiskEnum("risk").notNull().default("write"),
    operations: jsonb("operations")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    preview: jsonb("preview").$type<Record<string, unknown>>().notNull(),
    actionId: uuid("action_id").references(() => agentActions.id, {
      onDelete: "set null",
    }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("code_workspace_patches_request_unique").on(
      t.projectId,
      t.createdBy,
      t.requestId,
    ),
    index("code_workspace_patches_workspace_status_idx").on(
      t.codeWorkspaceId,
      t.status,
      t.createdAt,
    ),
    index("code_workspace_patches_action_idx")
      .on(t.actionId)
      .where(sql`${t.actionId} IS NOT NULL`),
  ],
);

export type CodeWorkspaceRow = typeof codeWorkspaces.$inferSelect;
export type CodeWorkspaceInsert = typeof codeWorkspaces.$inferInsert;
export type CodeWorkspaceSnapshotRow = typeof codeWorkspaceSnapshots.$inferSelect;
export type CodeWorkspaceSnapshotInsert = typeof codeWorkspaceSnapshots.$inferInsert;
export type CodeWorkspaceFileEntryRow = typeof codeWorkspaceFileEntries.$inferSelect;
export type CodeWorkspaceFileEntryInsert = typeof codeWorkspaceFileEntries.$inferInsert;
export type CodeWorkspacePatchRow = typeof codeWorkspacePatches.$inferSelect;
export type CodeWorkspacePatchInsert = typeof codeWorkspacePatches.$inferInsert;
