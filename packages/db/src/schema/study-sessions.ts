import {
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const studySessionStatusEnum = pgEnum("study_session_status", [
  "active",
  "processing",
  "ready",
  "archived",
]);

export const studySessionSourceRoleEnum = pgEnum("study_session_source_role", [
  "primary_pdf",
  "reference",
  "recording_note",
  "generated_note",
]);

export const sessionRecordingStatusEnum = pgEnum("session_recording_status", [
  "uploaded",
  "processing",
  "ready",
  "failed",
]);

export const transcriptStatusEnum = pgEnum("transcript_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export const studySessions = pgTable(
  "study_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    status: studySessionStatusEnum("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("study_sessions_project_status_idx").on(t.projectId, t.status, t.updatedAt),
    index("study_sessions_workspace_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const studySessionSources = pgTable(
  "study_session_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    role: studySessionSourceRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("study_session_sources_note_idx").on(t.noteId),
    uniqueIndex("study_session_sources_session_note_role_idx").on(
      t.sessionId,
      t.noteId,
      t.role,
    ),
  ],
);

export const sessionRecordings = pgTable(
  "session_recordings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    durationSec: doublePrecision("duration_sec"),
    status: sessionRecordingStatusEnum("status").notNull().default("uploaded"),
    transcriptStatus: transcriptStatusEnum("transcript_status").notNull().default("pending"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("session_recordings_session_status_idx").on(
      t.sessionId,
      t.status,
      t.createdAt,
    ),
  ],
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => sessionRecordings.id, { onDelete: "cascade" }),
    index: integer("segment_index").notNull(),
    startSec: doublePrecision("start_sec").notNull(),
    endSec: doublePrecision("end_sec").notNull(),
    text: text("text").notNull(),
    speaker: text("speaker"),
    language: text("language"),
    confidence: doublePrecision("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transcript_segments_recording_index_idx").on(t.recordingId, t.index),
    index("transcript_segments_recording_time_idx").on(
      t.recordingId,
      t.startSec,
      t.endSec,
    ),
  ],
);
