import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { concepts, conceptEdges } from "./concepts";
import { noteChunks, type NoteChunkSourceOffsets } from "./note-chunks";
import { notes } from "./notes";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export type EvidenceCitationSnapshot = {
  label: string;
  title: string;
  locator?: string;
  url?: string;
};

export const evidenceBundles = pgTable(
  "evidence_bundles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    producerKind: text("producer_kind").notNull(),
    producerRunId: text("producer_run_id"),
    model: text("model"),
    tool: text("tool"),
    query: text("query"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("evidence_bundles_project_idx").on(t.projectId, t.createdAt),
    index("evidence_bundles_workspace_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const evidenceBundleChunks = pgTable(
  "evidence_bundle_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => evidenceBundles.id, { onDelete: "cascade" }),
    noteChunkId: uuid("note_chunk_id")
      .notNull()
      .references(() => noteChunks.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    score: real("score").notNull(),
    retrievalChannel: text("retrieval_channel").notNull(),
    headingPath: text("heading_path").notNull().default(""),
    sourceOffsets: jsonb("source_offsets")
      .$type<NoteChunkSourceOffsets>()
      .notNull(),
    quote: text("quote").notNull(),
    citation: jsonb("citation").$type<EvidenceCitationSnapshot>().notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index("evidence_bundle_chunks_bundle_idx").on(t.bundleId),
    index("evidence_bundle_chunks_chunk_idx").on(t.noteChunkId),
    index("evidence_bundle_chunks_note_idx").on(t.noteId),
  ],
);

export const conceptExtractions = pgTable(
  "concept_extractions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").references(() => concepts.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description").notNull().default(""),
    confidence: real("confidence").notNull(),
    evidenceBundleId: uuid("evidence_bundle_id")
      .notNull()
      .references(() => evidenceBundles.id, { onDelete: "cascade" }),
    sourceNoteId: uuid("source_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    createdByRunId: text("created_by_run_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("concept_extractions_project_idx").on(
      t.projectId,
      t.normalizedName,
    ),
    index("concept_extractions_concept_idx").on(t.conceptId),
    index("concept_extractions_bundle_idx").on(t.evidenceBundleId),
  ],
);

export const conceptExtractionChunks = pgTable(
  "concept_extraction_chunks",
  {
    extractionId: uuid("extraction_id")
      .notNull()
      .references(() => conceptExtractions.id, { onDelete: "cascade" }),
    noteChunkId: uuid("note_chunk_id")
      .notNull()
      .references(() => noteChunks.id, { onDelete: "cascade" }),
    supportScore: real("support_score").notNull(),
    quote: text("quote").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.extractionId, t.noteChunkId] }),
    index("concept_extraction_chunks_chunk_idx").on(t.noteChunkId),
  ],
);

export const knowledgeClaims = pgTable(
  "knowledge_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    claimText: text("claim_text").notNull(),
    claimType: text("claim_type").notNull(),
    subjectConceptId: uuid("subject_concept_id").references(() => concepts.id, {
      onDelete: "set null",
    }),
    objectConceptId: uuid("object_concept_id").references(() => concepts.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("active"),
    confidence: real("confidence").notNull(),
    evidenceBundleId: uuid("evidence_bundle_id")
      .notNull()
      .references(() => evidenceBundles.id, { onDelete: "cascade" }),
    producedBy: text("produced_by").notNull(),
    producedByRunId: text("produced_by_run_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("knowledge_claims_project_idx").on(t.projectId, t.status),
    index("knowledge_claims_subject_idx").on(t.subjectConceptId),
    index("knowledge_claims_object_idx").on(t.objectConceptId),
    index("knowledge_claims_bundle_idx").on(t.evidenceBundleId),
  ],
);

export const conceptEdgeEvidence = pgTable(
  "concept_edge_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conceptEdgeId: uuid("concept_edge_id")
      .notNull()
      .references(() => conceptEdges.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").references(() => knowledgeClaims.id, {
      onDelete: "set null",
    }),
    evidenceBundleId: uuid("evidence_bundle_id")
      .notNull()
      .references(() => evidenceBundles.id, { onDelete: "cascade" }),
    noteChunkId: uuid("note_chunk_id")
      .notNull()
      .references(() => noteChunks.id, { onDelete: "cascade" }),
    supportScore: real("support_score").notNull(),
    stance: text("stance").notNull(),
    quote: text("quote").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("concept_edge_evidence_edge_idx").on(t.conceptEdgeId),
    index("concept_edge_evidence_claim_idx").on(t.claimId),
    index("concept_edge_evidence_bundle_idx").on(t.evidenceBundleId),
    index("concept_edge_evidence_chunk_idx").on(t.noteChunkId),
  ],
);

export type EvidenceBundleRow = typeof evidenceBundles.$inferSelect;
export type NewEvidenceBundleRow = typeof evidenceBundles.$inferInsert;
export type EvidenceBundleChunkRow = typeof evidenceBundleChunks.$inferSelect;
export type NewEvidenceBundleChunkRow =
  typeof evidenceBundleChunks.$inferInsert;
