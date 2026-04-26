import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { workspaces } from "./workspaces";
import { user } from "./users";

// Plan 7 Canvas Phase 2 — Code Agent state.
//
// `code_runs` is one user prompt → potentially many `code_turns` (each turn is
// either an LLM-generated code attempt or a self-repair after a runtime error).
// `canvas_outputs` are the materialized artifacts (images, html, json) produced
// by a successful run. `runId` is `set null` on output rows because we want
// outputs to outlive their generating run for auditing — hashes still uniquely
// pin them per note.
export const codeRuns = pgTable(
  "code_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    language: text("language").notNull(),
    status: text("status").notNull().default("pending"),
    workflowId: text("workflow_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("code_runs_note_idx").on(t.noteId, t.createdAt.desc())],
);

export const codeTurns = pgTable(
  "code_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => codeRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    explanation: text("explanation"),
    prevError: text("prev_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("code_turns_run_seq_unique").on(t.runId, t.seq)],
);

export const canvasOutputs = pgTable(
  "canvas_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => codeRuns.id, { onDelete: "set null" }),
    contentHash: text("content_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    s3Key: text("s3_key").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("canvas_outputs_note_hash_unique").on(t.noteId, t.contentHash),
    index("canvas_outputs_note_idx").on(t.noteId, t.createdAt.desc()),
  ],
);
