import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { embeddingBatchStateEnum } from "./enums";

// Plan 3b — provider-level batch embedding jobs.
//
// A row's lifecycle: pending (created locally, not yet submitted) →
// running (provider accepted) → succeeded | failed | cancelled | expired.
// `timeout` is OpenCairn-specific — our poll loop gave up before the
// provider reached a terminal state; in that case we also issued a
// best-effort cancel.
//
// Deliberately FK-less to users/projects — a batch is a provider-level
// artefact used by Librarian cross-workspace sweeps too. `workspace_id`
// is nullable so maintenance sweeps don't need a synthetic workspace.
// `ON DELETE SET NULL` keeps historical rows intact for billing audits
// even after the owning workspace is removed (Plan 3b OQ #3).
export const embeddingBatches = pgTable(
  "embedding_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    // Provider key — matches llmProviderEnum values but kept as text so we
    // can log rows from providers we haven't whitelisted yet (e.g. vendor
    // trials without adding a new enum value).
    provider: text("provider").notNull(),
    // e.g. "batches/abc123" for Gemini. Unique so a worker restart that
    // replays the submit activity can dedupe via the unique-constraint
    // rather than building its own idempotency token.
    providerBatchName: text("provider_batch_name").notNull(),
    state: embeddingBatchStateEnum("state").notNull().default("pending"),
    inputCount: integer("input_count").notNull(),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    pendingCount: integer("pending_count").notNull().default(0),
    // Object-storage keys for the JSONL request/response sidecars
    // (s3://{bucket}/embeddings/batch/{id}/{input,output}.jsonl). Raw
    // vectors never land in Postgres — Temporal payload cap is 2 MiB and
    // 2000×768×float32 is already ~6 MiB.
    inputS3Key: text("input_s3_key").notNull(),
    outputS3Key: text("output_s3_key"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    submittedAt: timestamp("submitted_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("embedding_batches_state_created_idx").on(t.state, t.createdAt),
    uniqueIndex("embedding_batches_provider_name_idx").on(t.providerBatchName),
  ],
);
