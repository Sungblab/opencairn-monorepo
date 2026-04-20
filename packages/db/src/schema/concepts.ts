import {
  pgTable,
  uuid,
  text,
  real,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { notes } from "./notes";
import { vector3072 } from "./custom-types";

export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default(""),
    embedding: vector3072("embedding"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("concepts_project_id_idx").on(t.projectId)]
);

export const conceptEdges = pgTable(
  "concept_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull().default("related-to"),
    weight: real("weight").notNull().default(1.0),
    evidenceNoteId: uuid("evidence_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("concept_edges_source_id_idx").on(t.sourceId),
    index("concept_edges_target_id_idx").on(t.targetId),
  ]
);

export const conceptNotes = pgTable(
  "concept_notes",
  {
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.conceptId, t.noteId] })]
);
