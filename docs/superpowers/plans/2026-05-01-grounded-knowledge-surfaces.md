# Grounded Knowledge Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first grounded knowledge surface slice: shared `EvidenceBundle` contracts, database persistence, and KG edge evidence APIs that let RAG, wiki, graph, mindmap, and card surfaces share chunk-level citations.

**Architecture:** Build on merged `note_chunks`. Add evidence bundle tables and edge/claim provenance tables in `packages/db`, shared Zod contracts in `packages/shared`, Hono read/write APIs in `apps/api`, and focused tests. Do not implement `apps/web` in this plan.

**Tech Stack:** Drizzle ORM, PostgreSQL, Hono 4, Zod, Vitest, existing auth/permission helpers, existing `note_chunks`, `concepts`, `concept_edges`, and `concept_notes`.

**Spec:** `docs/superpowers/specs/2026-05-01-grounded-knowledge-surfaces-design.md`

---

## Scope

This plan implements recommended slice A:

```text
evidence bundle + KG edge evidence schema/API
```

It intentionally does not implement:

- `apps/web` graph/mindmap/card UI changes;
- ingest wiki maintenance worker changes;
- reranker or context packer changes;
- graph/mindmap/card retrieval API;
- `docs/contributing/plans-status.md` updates before implementation PR merge.

## File Structure

Create:

- `packages/db/src/schema/evidence.ts` — `evidence_bundles`, `evidence_bundle_chunks`, `concept_extractions`, `concept_extraction_chunks`, `knowledge_claims`, `concept_edge_evidence`.
- `packages/db/tests/evidence-schema.test.ts` — schema smoke tests.
- `packages/shared/src/evidence.ts` — Zod schemas and TypeScript types for `EvidenceBundle`, entries, KG evidence responses, and internal create payloads.
- `packages/shared/tests/evidence.test.ts` — contract tests.
- `apps/api/src/lib/evidence-bundles.ts` — helper to create and read permission-filtered evidence bundles.
- `apps/api/src/routes/evidence.ts` — public bundle read route.
- `apps/api/src/routes/graph-evidence.ts` — edge evidence route under project graph.
- `apps/api/tests/lib/evidence-bundles.test.ts` — helper tests.
- `apps/api/tests/evidence-routes.test.ts` — route tests.
- `apps/api/tests/graph-evidence.test.ts` — edge evidence route tests.

Modify:

- `packages/db/src/client.ts` or schema barrel following current export pattern.
- `packages/db/src/index.ts` to export evidence tables.
- `packages/shared/src/index.ts` if the package uses a barrel export.
- `apps/api/src/routes/internal.ts` or internal route mount to add `POST /api/internal/evidence/bundles`.
- `apps/api/src/app.ts` to mount evidence and graph evidence routes.

Do not modify:

- `apps/web/**`
- `docs/contributing/plans-status.md`
- existing generated migrations by hand, except the new Drizzle-generated migration file if Drizzle emits expected DDL.

## Task 1: Shared Evidence Contracts

**Files:**

- Create: `packages/shared/src/evidence.ts`
- Create: `packages/shared/tests/evidence.test.ts`
- Modify: `packages/shared/src/index.ts` if needed

- [ ] **Step 1.1: Write failing shared contract tests**

Create `packages/shared/tests/evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  evidenceBundleSchema,
  createEvidenceBundleSchema,
  graphEdgeEvidenceResponseSchema,
} from "../src/evidence";

const chunkId = "11111111-1111-4111-8111-111111111111";
const noteId = "22222222-2222-4222-8222-222222222222";
const bundleId = "33333333-3333-4333-8333-333333333333";

describe("evidence contracts", () => {
  it("accepts a bundle with chunk citation metadata", () => {
    const parsed = evidenceBundleSchema.parse({
      id: bundleId,
      workspaceId: "44444444-4444-4444-8444-444444444444",
      projectId: "55555555-5555-4555-8555-555555555555",
      purpose: "rag_answer",
      producer: { kind: "chat", runId: "run-1", model: "gemini-2.5-flash" },
      query: "what supports this edge?",
      createdBy: null,
      createdAt: new Date().toISOString(),
      entries: [
        {
          noteChunkId: chunkId,
          noteId,
          noteType: "source",
          sourceType: "pdf",
          headingPath: "Intro > Evidence",
          sourceOffsets: { start: 10, end: 120 },
          score: 0.91,
          rank: 1,
          retrievalChannel: "vector",
          quote: "A short supporting quote.",
          citation: { label: "S1", title: "Paper" },
          metadata: {},
        },
      ],
    });
    expect(parsed.entries[0]?.noteChunkId).toBe(chunkId);
  });

  it("requires at least one entry when creating a bundle", () => {
    expect(() =>
      createEvidenceBundleSchema.parse({
        workspaceId: "44444444-4444-4444-8444-444444444444",
        projectId: "55555555-5555-4555-8555-555555555555",
        purpose: "kg_edge",
        producer: { kind: "worker" },
        entries: [],
      }),
    ).toThrow();
  });

  it("accepts edge evidence with support status", () => {
    const parsed = graphEdgeEvidenceResponseSchema.parse({
      edgeId: "66666666-6666-4666-8666-666666666666",
      claims: [
        {
          claimId: "77777777-7777-4777-8777-777777777777",
          claimText: "A supports B.",
          status: "active",
          confidence: 0.8,
          evidenceBundleId: bundleId,
          evidence: [],
        },
      ],
    });
    expect(parsed.claims[0]?.status).toBe("active");
  });
});
```

- [ ] **Step 1.2: Run failing test**

Run:

```bash
pnpm --filter @opencairn/shared test -- evidence
```

Expected: FAIL because `../src/evidence` does not exist.

- [ ] **Step 1.3: Implement shared schemas**

Create `packages/shared/src/evidence.ts`:

```ts
import { z } from "zod";

export const evidencePurposeSchema = z.enum([
  "rag_answer",
  "wiki_update",
  "concept_extraction",
  "kg_edge",
  "card_summary",
  "mindmap",
  "lint",
]);
export type EvidencePurpose = z.infer<typeof evidencePurposeSchema>;

export const evidenceProducerSchema = z.object({
  kind: z.enum(["ingest", "chat", "worker", "api", "manual"]),
  runId: z.string().optional(),
  model: z.string().optional(),
  tool: z.string().optional(),
});
export type EvidenceProducer = z.infer<typeof evidenceProducerSchema>;

export const evidenceEntrySchema = z.object({
  noteChunkId: z.string().uuid(),
  noteId: z.string().uuid(),
  noteType: z.enum(["source", "wiki", "note"]),
  sourceType: z.string().nullable(),
  headingPath: z.string(),
  sourceOffsets: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  score: z.number(),
  rank: z.number().int().positive(),
  retrievalChannel: z.enum([
    "vector",
    "bm25",
    "graph",
    "rerank",
    "manual",
    "generated",
  ]),
  quote: z.string().max(1200),
  citation: z.object({
    label: z.string().min(1).max(32),
    title: z.string().min(1),
    locator: z.string().optional(),
    url: z.string().url().optional(),
  }),
  metadata: z.record(z.unknown()).default({}),
});
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;

export const evidenceBundleSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  purpose: evidencePurposeSchema,
  producer: evidenceProducerSchema,
  query: z.string().optional(),
  entries: z.array(evidenceEntrySchema),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

export const createEvidenceBundleSchema = evidenceBundleSchema
  .omit({ id: true, createdAt: true })
  .extend({
    entries: z.array(evidenceEntrySchema).min(1),
  });
export type CreateEvidenceBundleInput = z.infer<typeof createEvidenceBundleSchema>;

export const claimStatusSchema = z.enum([
  "active",
  "stale",
  "disputed",
  "retracted",
]);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const graphEdgeEvidenceResponseSchema = z.object({
  edgeId: z.string().uuid(),
  claims: z.array(
    z.object({
      claimId: z.string().uuid(),
      claimText: z.string(),
      status: claimStatusSchema,
      confidence: z.number(),
      evidenceBundleId: z.string().uuid(),
      evidence: z.array(evidenceEntrySchema),
    }),
  ),
});
export type GraphEdgeEvidenceResponse = z.infer<
  typeof graphEdgeEvidenceResponseSchema
>;
```

Export it from the shared package barrel if the repo uses one:

```ts
export * from "./evidence";
```

- [ ] **Step 1.4: Run shared tests**

Run:

```bash
pnpm --filter @opencairn/shared test -- evidence
pnpm --filter @opencairn/shared build
```

Expected: PASS.

- [ ] **Step 1.5: Commit**

```bash
git add packages/shared/src/evidence.ts packages/shared/src/index.ts packages/shared/tests/evidence.test.ts
git commit -m "feat(shared): add evidence bundle contracts"
```

## Task 2: DB Evidence Schema

**Files:**

- Create: `packages/db/src/schema/evidence.ts`
- Create: `packages/db/tests/evidence-schema.test.ts`
- Modify: `packages/db/src/client.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 2.1: Write failing schema smoke test**

Create `packages/db/tests/evidence-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  evidenceBundles,
  evidenceBundleChunks,
  conceptExtractions,
  conceptExtractionChunks,
  knowledgeClaims,
  conceptEdgeEvidence,
} from "../src/schema/evidence";

describe("evidence schema", () => {
  it("defines evidence bundle tables", () => {
    expect(Object.keys(getTableColumns(evidenceBundles))).toEqual(
      expect.arrayContaining(["id", "workspaceId", "projectId", "purpose"]),
    );
    expect(Object.keys(getTableColumns(evidenceBundleChunks))).toEqual(
      expect.arrayContaining(["bundleId", "noteChunkId", "quote", "citation"]),
    );
  });

  it("defines extraction and edge evidence tables", () => {
    expect(Object.keys(getTableColumns(conceptExtractions))).toContain("evidenceBundleId");
    expect(Object.keys(getTableColumns(conceptExtractionChunks))).toContain("noteChunkId");
    expect(Object.keys(getTableColumns(knowledgeClaims))).toContain("claimText");
    expect(Object.keys(getTableColumns(conceptEdgeEvidence))).toContain("stance");
  });
});
```

- [ ] **Step 2.2: Run failing test**

Run:

```bash
pnpm --filter @opencairn/db test -- evidence-schema
```

Expected: FAIL because schema does not exist.

- [ ] **Step 2.3: Implement Drizzle schema**

Create `packages/db/src/schema/evidence.ts`:

```ts
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  integer,
  uuid,
} from "drizzle-orm/pg-core";
import { concepts, conceptEdges } from "./concepts";
import { noteChunks } from "./note-chunks";
import { notes } from "./notes";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const evidenceBundles = pgTable(
  "evidence_bundles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    producerKind: text("producer_kind").notNull(),
    producerRunId: text("producer_run_id"),
    model: text("model"),
    tool: text("tool"),
    query: text("query"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
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
    bundleId: uuid("bundle_id").notNull().references(() => evidenceBundles.id, { onDelete: "cascade" }),
    noteChunkId: uuid("note_chunk_id").notNull().references(() => noteChunks.id, { onDelete: "cascade" }),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    score: real("score").notNull(),
    retrievalChannel: text("retrieval_channel").notNull(),
    headingPath: text("heading_path").notNull().default(""),
    sourceOffsets: jsonb("source_offsets").$type<{ start: number; end: number }>().notNull(),
    quote: text("quote").notNull(),
    citation: jsonb("citation").$type<Record<string, unknown>>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
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
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description").notNull().default(""),
    confidence: real("confidence").notNull(),
    evidenceBundleId: uuid("evidence_bundle_id").notNull().references(() => evidenceBundles.id, { onDelete: "cascade" }),
    sourceNoteId: uuid("source_note_id").references(() => notes.id, { onDelete: "set null" }),
    createdByRunId: text("created_by_run_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("concept_extractions_project_idx").on(t.projectId, t.normalizedName),
    index("concept_extractions_concept_idx").on(t.conceptId),
  ],
);

export const conceptExtractionChunks = pgTable(
  "concept_extraction_chunks",
  {
    extractionId: uuid("extraction_id").notNull().references(() => conceptExtractions.id, { onDelete: "cascade" }),
    noteChunkId: uuid("note_chunk_id").notNull().references(() => noteChunks.id, { onDelete: "cascade" }),
    supportScore: real("support_score").notNull(),
    quote: text("quote").notNull(),
  },
  (t) => [primaryKey({ columns: [t.extractionId, t.noteChunkId] })],
);

export const knowledgeClaims = pgTable(
  "knowledge_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    claimText: text("claim_text").notNull(),
    claimType: text("claim_type").notNull(),
    subjectConceptId: uuid("subject_concept_id").references(() => concepts.id, { onDelete: "set null" }),
    objectConceptId: uuid("object_concept_id").references(() => concepts.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    confidence: real("confidence").notNull(),
    evidenceBundleId: uuid("evidence_bundle_id").notNull().references(() => evidenceBundles.id, { onDelete: "cascade" }),
    producedBy: text("produced_by").notNull(),
    producedByRunId: text("produced_by_run_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("knowledge_claims_project_idx").on(t.projectId, t.status),
    index("knowledge_claims_subject_idx").on(t.subjectConceptId),
    index("knowledge_claims_object_idx").on(t.objectConceptId),
  ],
);

export const conceptEdgeEvidence = pgTable(
  "concept_edge_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conceptEdgeId: uuid("concept_edge_id").notNull().references(() => conceptEdges.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").references(() => knowledgeClaims.id, { onDelete: "set null" }),
    evidenceBundleId: uuid("evidence_bundle_id").notNull().references(() => evidenceBundles.id, { onDelete: "cascade" }),
    noteChunkId: uuid("note_chunk_id").notNull().references(() => noteChunks.id, { onDelete: "cascade" }),
    supportScore: real("support_score").notNull(),
    stance: text("stance").notNull(),
    quote: text("quote").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("concept_edge_evidence_edge_idx").on(t.conceptEdgeId),
    index("concept_edge_evidence_claim_idx").on(t.claimId),
    index("concept_edge_evidence_chunk_idx").on(t.noteChunkId),
  ],
);
```

The current user table is exported as `user` from `packages/db/src/schema/users.ts`; use `text("created_by")` because Better Auth user ids are text, not UUIDs.

- [ ] **Step 2.4: Export schema**

Add evidence table exports to the same DB schema barrel used by `concepts`, `notes`, and `noteChunks`.

- [ ] **Step 2.5: Run schema tests**

Run:

```bash
pnpm --filter @opencairn/db test -- evidence-schema
```

Expected: PASS.

- [ ] **Step 2.6: Generate migration**

Run:

```bash
pnpm --filter @opencairn/db db:generate
```

Expected: Drizzle creates the next migration. Do not manually guess or preselect the migration number.

- [ ] **Step 2.7: Commit**

```bash
git add packages/db/src/schema/evidence.ts packages/db/src/client.ts packages/db/src/index.ts packages/db/tests/evidence-schema.test.ts packages/db/drizzle
git commit -m "feat(db): add grounded evidence schema"
```

## Task 3: Evidence Bundle Persistence Helper

**Files:**

- Create: `apps/api/src/lib/evidence-bundles.ts`
- Create: `apps/api/tests/lib/evidence-bundles.test.ts`

- [ ] **Step 3.1: Write failing helper tests**

Create `apps/api/tests/lib/evidence-bundles.test.ts` with DB mocked in the repo's existing API mock style:

```ts
import { describe, expect, it, vi } from "vitest";
import type { CreateEvidenceBundleInput } from "@opencairn/shared";

const txInsert = vi.fn();
const txSelect = vi.fn();
const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({ insert: txInsert, select: txSelect }),
);

vi.mock("@opencairn/db", () => ({
  db: { transaction },
  evidenceBundles: { id: "evidence_bundles" },
  evidenceBundleChunks: { id: "evidence_bundle_chunks" },
}));

const { createEvidenceBundle } = await import("../../src/lib/evidence-bundles.js");

describe("createEvidenceBundle", () => {
  it("persists bundle and chunk entries in one transaction", async () => {
    txInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "bundle-1", createdAt: new Date("2026-05-01T00:00:00Z") }]),
      }),
    });

    const input: CreateEvidenceBundleInput = {
      workspaceId: "44444444-4444-4444-8444-444444444444",
      projectId: "55555555-5555-4555-8555-555555555555",
      purpose: "kg_edge",
      producer: { kind: "worker", runId: "run-1" },
      createdBy: null,
      entries: [
        {
          noteChunkId: "11111111-1111-4111-8111-111111111111",
          noteId: "22222222-2222-4222-8222-222222222222",
          noteType: "source",
          sourceType: "pdf",
          headingPath: "Intro",
          sourceOffsets: { start: 0, end: 10 },
          score: 0.8,
          rank: 1,
          retrievalChannel: "vector",
          quote: "quote",
          citation: { label: "S1", title: "Source" },
          metadata: {},
        },
      ],
    };

    const result = await createEvidenceBundle(input);
    expect(result.id).toBe("bundle-1");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txInsert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3.2: Run failing test**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/evidence-bundles.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3.3: Implement helper**

Create `apps/api/src/lib/evidence-bundles.ts`:

```ts
import {
  db,
  evidenceBundleChunks,
  evidenceBundles,
} from "@opencairn/db";
import type {
  CreateEvidenceBundleInput,
  EvidenceBundle,
} from "@opencairn/shared";

export async function createEvidenceBundle(
  input: CreateEvidenceBundleInput,
): Promise<{ id: string; createdAt: Date }> {
  return await db.transaction(async (tx) => {
    const [bundle] = await tx
      .insert(evidenceBundles)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        purpose: input.purpose,
        producerKind: input.producer.kind,
        producerRunId: input.producer.runId,
        model: input.producer.model,
        tool: input.producer.tool,
        query: input.query,
        createdBy: input.createdBy,
      })
      .returning({ id: evidenceBundles.id, createdAt: evidenceBundles.createdAt });

    if (!bundle) throw new Error("evidence_bundle_insert_failed");

    await tx.insert(evidenceBundleChunks).values(
      input.entries.map((entry) => ({
        bundleId: bundle.id,
        noteChunkId: entry.noteChunkId,
        noteId: entry.noteId,
        rank: entry.rank,
        score: entry.score,
        retrievalChannel: entry.retrievalChannel,
        headingPath: entry.headingPath,
        sourceOffsets: entry.sourceOffsets,
        quote: entry.quote,
        citation: entry.citation,
        metadata: entry.metadata,
      })),
    );

    return bundle;
  });
}

export async function getEvidenceBundleForUser(
  _userId: string,
  _bundleId: string,
): Promise<EvidenceBundle | null> {
  // Task 4 replaces this stub with the permission-filtered read query.
  return null;
}
```

- [ ] **Step 3.4: Run helper test**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/evidence-bundles.test.ts
```

Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/lib/evidence-bundles.ts apps/api/tests/lib/evidence-bundles.test.ts
git commit -m "feat(api): persist evidence bundles"
```

## Task 4: Evidence Bundle Read API

**Files:**

- Modify: `apps/api/src/lib/evidence-bundles.ts`
- Create: `apps/api/src/routes/evidence.ts`
- Create: `apps/api/tests/evidence-routes.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 4.1: Implement permission-filtered read helper**

Update `getEvidenceBundleForUser()` to:

- load bundle and chunk rows by `bundleId`;
- verify the user can read the bundle project through existing permission helpers;
- filter out rows whose parent note is deleted;
- return `EvidenceBundle | null`;
- preserve old bundle metadata even if some chunks are stale, but do not return unreadable note content.

Use Drizzle query builder and existing permission helpers. Do not use raw SQL in application code.

- [ ] **Step 4.2: Write route tests**

Create tests covering:

- unauthenticated request returns 401/403 following existing API conventions;
- missing bundle returns 404;
- readable bundle returns entries;
- unreadable project returns 403.

Use existing route test setup patterns in `apps/api/tests`.

- [ ] **Step 4.3: Add route**

Create `apps/api/src/routes/evidence.ts`:

```ts
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { getEvidenceBundleForUser } from "../lib/evidence-bundles";
import type { AppEnv } from "../lib/types";

export const evidenceRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/bundles/:bundleId", async (c) => {
    const user = c.get("user");
    const bundle = await getEvidenceBundleForUser(user.id, c.req.param("bundleId"));
    if (!bundle) return c.json({ error: "not-found" }, 404);
    return c.json(bundle);
  });
```

Mount it under `/api/evidence`.

- [ ] **Step 4.4: Run route tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/evidence-routes.test.ts
```

Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/lib/evidence-bundles.ts apps/api/src/routes/evidence.ts apps/api/src/app.ts apps/api/tests/evidence-routes.test.ts
git commit -m "feat(api): expose permission-filtered evidence bundles"
```

## Task 5: Internal Evidence Bundle Writer

**Files:**

- Modify: `apps/api/src/routes/internal.ts` or create a mounted internal subroute if the repo already has that pattern.
- Modify: `apps/api/tests/evidence-routes.test.ts`

- [ ] **Step 5.1: Add internal route test**

Test `POST /api/internal/evidence/bundles`:

- validates body with `createEvidenceBundleSchema`;
- rejects project/workspace mismatch;
- creates a bundle and returns `{ id }`;
- requires at least one entry.

- [ ] **Step 5.2: Implement internal route**

Add:

```text
POST /api/internal/evidence/bundles
```

Body: `CreateEvidenceBundleInput`.

Validation:

- `workspaceId` is required;
- `projectId` must belong to `workspaceId`;
- every `noteId`/`noteChunkId` must belong to that same workspace/project;
- entries must not include deleted chunks.

Implementation:

- parse with `createEvidenceBundleSchema`;
- use existing internal auth conventions;
- call `createEvidenceBundle()`;
- return `{ id, createdAt }`.

- [ ] **Step 5.3: Run tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/evidence-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5.4: Commit**

```bash
git add apps/api/src/routes/internal.ts apps/api/tests/evidence-routes.test.ts
git commit -m "feat(api): add internal evidence bundle writer"
```

## Task 6: KG Edge Evidence Read API

**Files:**

- Create: `apps/api/src/routes/graph-evidence.ts`
- Create: `apps/api/tests/graph-evidence.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 6.1: Write route tests**

Cover:

- non-member cannot read edge evidence;
- edge outside project returns 404;
- supported edge returns claim with evidence entries;
- edge with no evidence returns `{ edgeId, claims: [] }`.

- [ ] **Step 6.2: Implement route**

Create:

```text
GET /api/projects/:projectId/graph/evidence?edgeId=<uuid>
```

Implementation rules:

- `requireAuth`;
- validate `projectId` and `edgeId`;
- `canRead(user.id, { type: "project", id: projectId })`;
- verify the edge belongs to the project by joining both source/target concepts to `concept_edges`;
- load `knowledge_claims`, `concept_edge_evidence`, and `evidence_bundle_chunks`;
- return `graphEdgeEvidenceResponseSchema` shape;
- do not return chunks from deleted or unreadable notes.

- [ ] **Step 6.3: Run tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/graph-evidence.test.ts
```

Expected: PASS.

- [ ] **Step 6.4: Commit**

```bash
git add apps/api/src/routes/graph-evidence.ts apps/api/src/app.ts apps/api/tests/graph-evidence.test.ts
git commit -m "feat(api): expose KG edge evidence"
```

## Task 7: Concept Extraction Evidence Smoke Path

**Files:**

- Modify: `apps/api/src/routes/internal.ts`
- Create: `apps/api/tests/concept-extraction-evidence.test.ts`

- [ ] **Step 7.1: Add internal route test**

Test a minimal internal route for recording concept extraction evidence:

```text
POST /api/internal/concepts/extractions
```

Body:

```ts
{
  workspaceId: string;
  projectId: string;
  conceptId?: string;
  name: string;
  kind: "concept" | "entity" | "topic" | "claim_subject";
  normalizedName: string;
  description?: string;
  confidence: number;
  evidenceBundleId: string;
  sourceNoteId?: string;
  createdByRunId?: string;
  chunks: Array<{ noteChunkId: string; supportScore: number; quote: string }>;
}
```

Assertions:

- project/workspace mismatch is rejected;
- `evidenceBundleId` must belong to same project/workspace;
- chunks must belong to the evidence bundle;
- successful insert returns `{ id }`.

- [ ] **Step 7.2: Implement route**

Use Drizzle and existing internal route patterns. This is intentionally a small writer so the future ingest worker can persist extraction provenance without knowing table details.

- [ ] **Step 7.3: Run tests**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/concept-extraction-evidence.test.ts
```

Expected: PASS.

- [ ] **Step 7.4: Commit**

```bash
git add apps/api/src/routes/internal.ts apps/api/tests/concept-extraction-evidence.test.ts
git commit -m "feat(api): record concept extraction evidence"
```

## Task 8: Final Verification

- [ ] **Step 8.1: Run focused checks**

Run:

```bash
pnpm --filter @opencairn/shared test -- evidence
pnpm --filter @opencairn/shared build
pnpm --filter @opencairn/db test -- evidence-schema
pnpm --filter @opencairn/db db:generate
pnpm --filter @opencairn/api test -- tests/lib/evidence-bundles.test.ts tests/evidence-routes.test.ts tests/graph-evidence.test.ts tests/concept-extraction-evidence.test.ts
pnpm --filter @opencairn/api build
git diff --check
```

Expected: all pass. If Vitest is blocked by the known Windows `#module-evaluator` issue, record the exact error and run the import/build smoke checks that still execute.

- [ ] **Step 8.2: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Confirm no `apps/web/**` and no `docs/contributing/plans-status.md` changes.

- [ ] **Step 8.3: Commit final fixes**

Commit only logical fixes. Use the OpenCairn commit convention.

## Recommended Slice Order

1. **A. evidence bundle + KG edge evidence schema/API**
   - Recommended first. It has the fewest dependencies and gives every later surface a shared citation substrate.
2. **C. graph/mindmap/card retrieval API slice**
   - Recommended second. It can consume A and provide product-facing API value while still avoiding `apps/web` implementation.
3. **B. ingest wiki maintenance worker slice**
   - Recommended third. It has the most product value long-term, but it touches Temporal, prompts, generated wiki artifacts, and audit behavior, so it should build on A and C.

## Next Implementation Session Prompt

Copy-paste this into the next Codex session:

```text
Respond in Korean.

OpenCairn repo에서 Grounded Knowledge Surfaces 첫 구현 slice를 진행해줘.

목표:
docs/superpowers/specs/2026-05-01-grounded-knowledge-surfaces-design.md 와
docs/superpowers/plans/2026-05-01-grounded-knowledge-surfaces.md 를 읽고,
Slice A: evidence bundle + KG edge evidence schema/API 를 구현해.

시작 전에 반드시:
1. AGENTS.md를 읽고 repo rules를 적용해.
2. docs/README.md, docs/contributing/plans-status.md를 읽어.
3. docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md 를 읽어.
4. PR #188이 merged인지 확인하고, `note_chunks` 현재 스키마를 읽어.
5. git status, git branch, git worktree list를 확인하고 열린 PR/브랜치를 건드리지 마.

제약:
- apps/web 구현 금지.
- docs/contributing/plans-status.md는 구현 PR merge 전에는 업데이트하지 마.
- DB migration 번호를 수동 추정하지 말고 `pnpm --filter @opencairn/db db:generate`가 만들게 해.
- application code는 Drizzle/기존 helper 패턴을 써라. raw SQL은 migration에만 둬라.
- VECTOR_DIM/vector3072 helper 동작을 유지해라.
- 기존 Drive/Notion import, `/api/mcp/servers`, graph/mindmap/card 기존 응답을 깨지 마라.

구현 범위:
1. shared EvidenceBundle/Zod contracts.
2. DB evidence schema:
   - evidence_bundles
   - evidence_bundle_chunks
   - concept_extractions
   - concept_extraction_chunks
   - knowledge_claims
   - concept_edge_evidence
3. internal evidence bundle writer.
4. public `GET /api/evidence/bundles/:bundleId`.
5. `GET /api/projects/:projectId/graph/evidence?edgeId=...`.
6. minimal internal concept extraction evidence writer if it fits the plan.

검증:
- focused shared/db/api tests.
- api build.
- git diff --check.
- 변경 파일, 실행한 검증, 남은 리스크를 마지막에 보고.
- 완료 후 OpenCairn branch finish rule에 따라 commit/push/draft PR까지 진행해. 머지는 내가 한다.
```

## Notes For Implementers

- Current root may contain unrelated dirty files. Do not revert or edit unrelated changes.
- If `packages/db` already has local uncommitted edits, inspect before modifying and preserve user changes.
- If implementing DB schema in a separate worktree, create it under `.worktrees/grounded-knowledge-surfaces-a` with branch `codex/grounded-knowledge-surfaces-a`.
- Keep this slice API/data-contract focused. The future UI should consume these APIs, but this slice should not add UI.

## Producer Follow-Up Handoff

PR #190 added the evidence schema/API foundation, PR #191 added the
knowledge-surface retrieval API, and PR #192 added the first producer hardening
pass for compiler definition claims. The next producer layer should focus on
raising evidence-backed data volume without widening schema or UI scope.

Implemented in the follow-up branch `codex/grounded-knowledge-producers-next`:

- compiler concept extraction now also creates bounded adjacent concept
  relation claims using the existing extraction evidence bundle;
- compiler relation producer upserts `co-mentioned` edges and attaches
  `concept_edge_evidence` through `POST /api/internal/knowledge/claims`;
- librarian `strengthen_links` now keeps edge upsert behavior but, when shared
  note chunks exist, creates a `kg_edge` evidence bundle plus relation claim
  with `producedBy="wiki_maintenance"`;
- internal API gained a focused `GET /api/internal/projects/:id/concept-pair-chunks`
  helper so the worker can fetch source/target concept metadata and shared
  chunk evidence without changing existing `list_link_candidates` response
  shape;
- producer failures remain best-effort: missing chunks or evidence writer
  errors warn/skip and do not fail compiler or librarian runs.

Implemented in the UI branch `codex/grounded-knowledge-surfaces-ui`:

- graph, mindmap, and cards viewers now request
  `/api/projects/:projectId/knowledge-surface?includeEvidence=true` while
  timeline/board keep the existing `/graph` path;
- graph and mindmap edges carry support status into Cytoscape styling and open a
  compact evidence detail panel on edge selection;
- cards consume `cards[]` plus `evidenceBundles[]`, display
  `evidenceBundleId`/citation counts, and expose a small source summary;
- missing or unreadable evidence bundles render as "no evidence" instead of
  crashing the view.

Still out of scope after this UI pass:

- a dedicated wiki/card summary producer beyond the existing claim/card
  consumption path;
- Vitest Windows startup issue around `#module-evaluator`;
- full browser E2E against seeded evidence data.
