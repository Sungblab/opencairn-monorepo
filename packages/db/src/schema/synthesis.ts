import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { projects } from "./projects";
import { user } from "./users";

// Multi-format Synthesis Export pipeline state.
//
// `synthesis_runs` is one user prompt → at most one final document set
// (LaTeX/DOCX/PDF/MD). `synthesis_sources` records the inputs the synthesizer
// pulled (notes, S3 objects, deep-research results) so we can reproduce or
// audit the run. `synthesis_documents` are the materialized artifacts on S3
// (one row per output format, plus a `zip` row when bundled).
//
// Cascades match worker workflow lifetime — sources/documents never outlive
// their run. `projects.id` FK is `set null` because a synthesis run can
// outlive a project deletion (the artifact is still useful to the user).
export const synthesisRuns = pgTable(
  "synthesis_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    format: text("format").notNull(), // latex | docx | pdf | md
    template: text("template").notNull(), // ieee | acm | apa | korean_thesis | report
    userPrompt: text("user_prompt").notNull(),
    autoSearch: boolean("auto_search").notNull().default(false),
    status: text("status").notNull().default("pending"),
    // pending | fetching | synthesizing | compiling | completed | failed | cancelled
    workflowId: text("workflow_id"),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("synthesis_runs_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
    index("synthesis_runs_user_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const synthesisSources = pgTable("synthesis_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => synthesisRuns.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(), // s3_object | note | dr_result
  sourceId: uuid("source_id").notNull(),
  title: text("title"),
  tokenCount: integer("token_count"),
  included: boolean("included").notNull().default(true),
});

export const synthesisDocuments = pgTable("synthesis_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => synthesisRuns.id, { onDelete: "cascade" }),
  format: text("format").notNull(), // latex | docx | pdf | md | bibtex | zip
  s3Key: text("s3_key"),
  bytes: integer("bytes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
