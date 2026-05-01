# Grounded Knowledge Surfaces

> Date: 2026-05-01
> Status: Spec complete, implementation plan proposed
> Builds on:
> - `docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md`
> - `docs/superpowers/plans/2026-05-01-grounded-agent-note-chunks.md`
> - PR #188, merged 2026-05-01: `note_chunks` schema + chunk hybrid retrieval
> - Plan 5 Knowledge Graph Phase 1/2: graph, mindmap, cards, timeline, board, VisualizationAgent

## 1. Problem

OpenCairn now has paragraph-level retrieval through `note_chunks`, but the knowledge surfaces still use several different evidence models:

- RAG answers cite retrieval hits.
- generated wiki pages are persistent LLM-maintained artifacts.
- `concepts` and `concept_edges` are concept-level rows with only `evidence_note_id`.
- graph, mindmap, card, timeline, and board views render concept nodes and edges without chunk-level evidence.
- ingest enrichment can summarize or extract concepts without a shared claim/evidence ledger.

This makes the product look like it has connected knowledge, but it cannot yet answer the key verification questions:

- Which paragraph supports this concept?
- Which source text supports this edge?
- Did this wiki page sentence come from raw source, another wiki page, or an answer?
- Is this card summary still supported after source notes changed?
- Which graph edges are weak, stale, contradicted, or orphaned?

The next architecture step is to make every generated knowledge surface consume and emit the same evidence bundle model.

## 2. Product Direction

`note_chunks` is the canonical evidence unit for raw source notes, manual notes, and generated wiki notes. Raw source notes remain the immutable source of truth. Generated wiki pages remain persistent artifacts maintained by LLM workflows, but their claims must point back to chunk evidence.

The graph, mindmap, and card views are not decorative visualizations. They are evidence navigation surfaces:

- a graph edge is a claim with chunk evidence;
- a mindmap branch is a concept path backed by chunks;
- a card is a compact claim bundle with citations;
- RAG answers, wiki updates, KG edges, and cards share citation metadata;
- lint jobs can find weakly cited or stale generated knowledge.

## 3. Non-Goals

- Do not implement `apps/web` UI in the first slice.
- Do not introduce Neo4j or a second search engine.
- Do not replace `note_chunks` with a new evidence store.
- Do not make generated wiki pages a source of truth over raw imported source.
- Do not remove existing note-level fallback retrieval until chunk backfill and coverage are proven.
- Do not change `VECTOR_DIM` or the `vector3072` helper behavior.

## 4. Existing State

### 4.1 `note_chunks`

PR #188 added:

- `packages/db/src/schema/note-chunks.ts`
- migration `0042_regular_daredevil.sql`
- `apps/api/src/lib/note-chunker.ts`
- `apps/api/src/lib/note-chunk-indexer.ts`
- `apps/api/src/lib/chunk-hybrid-search.ts`
- chat retrieval preference for chunk hits with note-level fallback

Current chunk rows include:

- `workspace_id`, `project_id`, `note_id`
- `chunk_index`, `heading_path`, `content_text`, `content_tsv`
- `embedding`, `token_count`, `source_offsets`
- `content_hash`, `deleted_at`, timestamps

This is enough to build stable evidence references without duplicating raw text into every consumer table.

### 4.2 Plan 5 Graph Surfaces

Current KG data is centered on:

- `concepts`
- `concept_edges`
- `concept_notes`

Current graph API contracts expose:

- `GraphNode`: concept id, name, description, degree, note count, first note id, created date
- `GraphEdge`: edge id, source id, target id, relation type, weight
- `ViewSpec`: graph/mindmap/cards/timeline/board node and edge structures

This is useful for visualization, but not yet grounded. The only edge evidence pointer is `concept_edges.evidence_note_id`, which is too coarse for paragraph-level verification.

## 5. Core Model

### 5.1 EvidenceBundle

An `EvidenceBundle` is the shared evidence payload used by RAG answers, wiki page updates, concept extraction, KG edge claims, graph/mindmap/card retrieval APIs, and lint jobs.

Logical TypeScript shape:

```ts
export type EvidenceBundle = {
  id: string;
  workspaceId: string;
  projectId: string;
  purpose:
    | "rag_answer"
    | "wiki_update"
    | "concept_extraction"
    | "kg_edge"
    | "card_summary"
    | "mindmap"
    | "lint";
  producer: {
    kind: "ingest" | "chat" | "worker" | "api" | "manual";
    runId?: string;
    model?: string;
    tool?: string;
  };
  query?: string;
  entries: EvidenceEntry[];
  createdBy: string | null;
  createdAt: string;
};

export type EvidenceEntry = {
  noteChunkId: string;
  noteId: string;
  noteType: "source" | "wiki" | "note";
  sourceType: string | null;
  headingPath: string;
  sourceOffsets: { start: number; end: number };
  score: number;
  rank: number;
  retrievalChannel:
    | "vector"
    | "bm25"
    | "graph"
    | "rerank"
    | "manual"
    | "generated";
  quote: string;
  citation: {
    label: string;
    title: string;
    locator?: string;
    url?: string;
  };
  metadata?: Record<string, unknown>;
};
```

Important rules:

- `noteChunkId` is the durable evidence reference.
- `quote` is a short snapshot for audit and UI previews, not the source of truth.
- `sourceOffsets` and `headingPath` are copied from `note_chunks` to make citations stable and readable.
- `score` is channel-local before rerank unless `retrievalChannel="rerank"`.
- Every entry must be permission-filtered before being returned to a user.
- Generated wiki chunks may cite raw source chunks, but raw source chunks outrank generated wiki chunks when claims conflict.

### 5.2 Database Schema

Use Drizzle for application code. Raw SQL belongs only in migrations.

Recommended new tables:

```text
evidence_bundles
  id uuid pk
  workspace_id uuid not null
  project_id uuid not null
  purpose text not null
  producer_kind text not null
  producer_run_id text null
  model text null
  tool text null
  query text null
  created_by text null
  created_at timestamp not null

evidence_bundle_chunks
  id uuid pk
  bundle_id uuid not null -> evidence_bundles(id) on delete cascade
  note_chunk_id uuid not null -> note_chunks(id) on delete cascade
  note_id uuid not null -> notes(id) on delete cascade
  rank int not null
  score real not null
  retrieval_channel text not null
  heading_path text not null
  source_offsets jsonb not null
  quote text not null
  citation jsonb not null
  metadata jsonb not null default '{}'
```

The join table intentionally snapshots `heading_path`, `source_offsets`, `quote`, and `citation` so old answers and audit logs can still explain what the model saw even if a generated wiki page is later rewritten.

### 5.3 Concept Extraction Evidence

Concept and entity extraction must record which chunks produced each concept.

Recommended schema:

```text
concept_extractions
  id uuid pk
  workspace_id uuid not null
  project_id uuid not null
  concept_id uuid null -> concepts(id) on delete set null
  name text not null
  kind text not null              -- concept | entity | topic | claim_subject
  normalized_name text not null
  description text not null default ''
  confidence real not null
  evidence_bundle_id uuid not null -> evidence_bundles(id)
  source_note_id uuid null -> notes(id)
  created_by_run_id text null
  created_at timestamp not null

concept_extraction_chunks
  extraction_id uuid not null -> concept_extractions(id) on delete cascade
  note_chunk_id uuid not null -> note_chunks(id) on delete cascade
  support_score real not null
  quote text not null
  primary key (extraction_id, note_chunk_id)
```

Rules:

- `concepts` stays the canonical concept table used by existing graph views.
- `concept_extractions` is the provenance ledger for how a concept was found or refreshed.
- Multiple extractions may point to one `concept_id`.
- Entity merge/normalization should never delete extraction evidence.

### 5.4 KG Edge And Claim Evidence

`concept_edges.evidence_note_id` is too coarse. Keep it for compatibility, but add chunk-level edge evidence and source claims.

Recommended schema:

```text
knowledge_claims
  id uuid pk
  workspace_id uuid not null
  project_id uuid not null
  claim_text text not null
  claim_type text not null         -- relation | summary | definition | contradiction | synthesis
  subject_concept_id uuid null -> concepts(id)
  object_concept_id uuid null -> concepts(id)
  status text not null             -- active | stale | disputed | retracted
  confidence real not null
  evidence_bundle_id uuid not null -> evidence_bundles(id)
  produced_by text not null        -- ingest | wiki_maintenance | chat_save | lint
  produced_by_run_id text null
  created_at timestamp not null
  updated_at timestamp not null

concept_edge_evidence
  id uuid pk
  concept_edge_id uuid not null -> concept_edges(id) on delete cascade
  claim_id uuid null -> knowledge_claims(id) on delete set null
  evidence_bundle_id uuid not null -> evidence_bundles(id)
  note_chunk_id uuid not null -> note_chunks(id)
  support_score real not null
  stance text not null             -- supports | contradicts | mentions
  quote text not null
  created_at timestamp not null
```

Rules:

- a visible graph edge is valid only if it has at least one `supports` chunk or is marked as manually created;
- contradiction candidates attach to `knowledge_claims`, not directly to `concept_edges`;
- cards and mindmaps should prefer claims with active status and strong support;
- edge weight remains a graph display signal, while support score is evidence quality.

## 6. Ingest Workflow

Target workflow:

```text
1. raw source import
2. contentText/source note creation
3. note_chunks indexing
4. summary/entity/concept/synthesis wiki page update proposal
5. KG/card/mindmap evidence update
6. log/audit append
```

Detailed contract:

1. Raw source import creates immutable source artifacts and a `source` note.
2. The API/worker extracts `contentText` and creates or updates source note metadata.
3. `indexNoteChunks()` builds chunk rows and embeddings.
4. Concept/entity extraction reads chunks and writes:
   - `evidence_bundles(purpose="concept_extraction")`
   - `concept_extractions`
   - `concept_extraction_chunks`
5. Wiki maintenance proposes updates to generated wiki pages:
   - page summary
   - entity/concept pages
   - synthesis pages
   - stale/contradiction annotations
6. KG/card/mindmap maintenance writes:
   - `knowledge_claims`
   - `concept_edge_evidence`
   - evidence-backed card summaries
7. Audit append records:
   - workflow id
   - source note id
   - generated wiki note ids touched
   - evidence bundle ids
   - claim ids
   - lint findings

The generated wiki page is a persistent artifact. It can be rewritten by LLM maintenance workflows, but it is never the immutable source of truth. Raw source chunks remain authoritative.

## 7. Query Workflow

Target query workflow:

```text
1. chunk hybrid search
2. graph neighborhood expansion
3. rerank/context budget
4. answer with citations
5. valuable answer saved as wiki note/card
```

Detailed contract:

1. `projectChunkHybridSearch()` produces seed chunks from vector and full-text retrieval.
2. The graph expansion step maps seed chunks to concepts through extraction evidence and `concept_notes`, then expands 1-2 hops through supported edges.
3. Rerank receives chunk candidates and graph-derived claims, then emits an `EvidenceBundle`.
4. The answer generator receives only packed evidence plus citation metadata.
5. The verifier rejects workspace factual claims without bundle entries.
6. If the answer is valuable, saving it as a wiki note or card stores:
   - generated content;
   - source `evidence_bundle_id`;
   - linked `knowledge_claims` when applicable;
   - citation markers that point to `evidence_bundle_chunks`.

## 8. Lint Workflow

The lint workflow runs over stored evidence and claims. It is not a UI feature first; it should start as API/worker data contracts.

Lint categories:

| Category | Detection |
| --- | --- |
| stale claims | claim evidence chunks changed, deleted, or hash-mismatched since bundle creation |
| contradiction candidates | two active claims with overlapping subject/object and opposing stance |
| orphan concepts | concepts without extraction evidence or source chunks |
| weakly cited graph edges | concept edges without `supports` evidence or support score below threshold |
| missing concept pages | high-confidence concepts without a generated wiki page |
| generated-only claims | wiki/card claims whose evidence chain never reaches a raw source chunk |

Lint output should reference claim ids, concept ids, edge ids, note ids, chunk ids, and a suggested remediation action.

## 9. API/Data Contracts

Do not implement `apps/web` in the first slice. Define the API shapes that future graph/mindmap/card views consume.

### 9.1 Evidence Bundle API

```text
GET /api/evidence/bundles/:bundleId
```

Returns one `EvidenceBundle` with permission-filtered entries.

```text
POST /api/internal/evidence/bundles
```

Internal route used by worker/API producers to persist a bundle.

### 9.2 KG Edge Evidence API

```text
GET /api/projects/:projectId/graph/evidence?edgeId=<uuid>
```

Returns:

```ts
{
  edgeId: string;
  claims: Array<{
    claimId: string;
    claimText: string;
    status: "active" | "stale" | "disputed" | "retracted";
    confidence: number;
    evidenceBundleId: string;
    evidence: EvidenceEntry[];
  }>;
}
```

Future graph/mindmap/card views consume this on demand when the user selects an edge or card.

### 9.3 Grounded Surface Retrieval API

```text
GET /api/projects/:projectId/knowledge-surface
  ?view=graph|mindmap|cards
  &query=<optional>
  &root=<optional concept id>
  &includeEvidence=true|false
```

Returns a `ViewSpec`-compatible shape plus evidence summaries:

```ts
{
  viewType: "graph" | "mindmap" | "cards";
  rootId: string | null;
  nodes: ViewNode[];
  edges: Array<ViewEdge & {
    support: {
      claimId: string | null;
      evidenceBundleId: string | null;
      supportScore: number;
      citationCount: number;
      status: "supported" | "weak" | "stale" | "disputed" | "missing";
    };
  }>;
  cards?: Array<{
    id: string;
    conceptId: string;
    title: string;
    summary: string;
    evidenceBundleId: string;
    citationCount: number;
  }>;
  evidenceBundles?: EvidenceBundle[];
}
```

The first implementation slice does not need to build this endpoint. It should shape the DB and shared contracts so this endpoint is straightforward.

## 10. Permissions And Safety

- All public user APIs must use `requireAuth`.
- Every bundle and evidence row is scoped by workspace/project.
- Every returned entry must verify readable note access through existing permission helpers.
- Internal routes must require explicit `workspaceId` and project/workspace consistency checks.
- Deleted notes and chunks must not appear in new retrieval results.
- Old bundles may reference now-deleted chunks for audit, but user-facing APIs should mark them stale or hidden.

## 11. Implementation Phases

### Phase A: Evidence Bundle + KG Edge Evidence Schema/API

Add shared contracts, DB tables, internal writer, and read APIs for bundle and edge evidence. This is the recommended first slice.

Why first:

- depends only on merged `note_chunks` and existing KG tables;
- does not require `apps/web`;
- unlocks RAG/wiki/KG/card shared citations;
- provides a testable foundation before changing worker ingest behavior.

### Phase B: Grounded Surface Retrieval API

Build `knowledge-surface` API for graph/mindmap/cards using chunk search, graph expansion, rerank-lite, and evidence summaries.

Why second:

- gives product-visible API value after evidence data exists;
- can remain API-only;
- prepares future UI without touching `apps/web`.

### Phase C: Ingest Wiki Maintenance Worker

Extend ingest workflows to create extraction evidence, propose wiki page updates, update KG/card/mindmap evidence, and append audit logs.

Why third:

- highest long-term value but broadest blast radius;
- touches Temporal/worker, internal APIs, wiki maintenance prompts, and audit behavior;
- should build on the stable evidence writer and retrieval API.

## 12. Recommended Slice Order

1. **A. evidence bundle + KG edge evidence schema/API**
   - lowest dependency, highest architecture leverage, and creates stable contracts for all later surfaces.
2. **C. graph/mindmap/card retrieval API slice**
   - strong product value after A; API-only surface can be validated without web implementation.
3. **B. ingest wiki maintenance worker slice**
   - largest product value eventually, but depends on A and benefits from C's retrieval contract.

For the user's A/B/C labels, the recommended order is:

```text
A -> C -> B
```

## 13. Acceptance Criteria

- RAG answer, wiki update, KG edge, card summary, and mindmap retrieval can all reference an `EvidenceBundle`.
- Concept/entity extractions persist chunk evidence.
- Concept edge/source claims persist chunk evidence and support stance.
- Graph/mindmap/card APIs have a path to return evidence-backed support metadata.
- Lint workflow can identify stale, weak, orphaned, disputed, and generated-only claims.
- Raw source chunks stay authoritative over generated wiki chunks.
- No `apps/web` implementation is required for the first slice.
