# Grounded Agent Retrieval Architecture

> Date: 2026-04-30
> Status: Draft for implementation planning
> Scope: OpenCairn chat, research, document-agent, retrieval, grounding, and agent reliability

## 1. Problem

OpenCairn's chat and agents already have the right early building blocks:
workspace-scoped notes, pgvector embeddings, PostgreSQL full-text search,
concepts/edges for the knowledge graph, Gemini/Ollama providers, and a bounded
tool loop. This is enough for early personal and team knowledge workflows, but
it is not yet enough to make the assistant reliably correct as the corpus grows.

The main risks are:

- model priors overriding runtime facts such as the current date;
- recent-event questions answered without live grounding;
- workspace answers without citations or with weak citations;
- note-level embeddings missing the relevant paragraph inside long documents;
- graph data being treated as a separate product surface instead of improving
  retrieval quality;
- large corpora causing context selection failures before database scale becomes
  the real bottleneck.

The goal is to turn OpenCairn from a plausible chat assistant into a grounded
knowledge agent whose answers are controlled by runtime evidence, source
metadata, time awareness, and verifiable retrieval contracts.

## 2. Recommendation

Use a PostgreSQL-based grounded retrieval layer before considering Neo4j or a
dedicated search engine.

PostgreSQL with pgvector, GIN full-text indexes, project/workspace scoping, and
the existing `concepts`/`concept_edges` model is the right v1/v2 platform. A
separate graph database should only be introduced after measured evidence shows
that Postgres traversal or graph analytics are the bottleneck.

The recommended architecture is:

```text
user query
  -> intent router
  -> scope resolver
  -> chunk vector search
  -> chunk full-text search
  -> graph expansion
  -> RRF fusion
  -> rerank
  -> context packing
  -> answer generation
  -> verifier pass
  -> final response
```

## 3. Non-Goals

- Do not introduce Neo4j in this phase.
- Do not introduce OpenSearch, Elasticsearch, or another search service in this
  phase.
- Do not route all serious questions through Deep Research.
- Do not rely on prompting alone to solve hallucination.
- Do not weaken workspace, project, page, or note permission boundaries.
- Do not hardcode a hosted-service assumption that would make self-hosting
  harder.

## 4. Truth Hierarchy

Every answer-producing path must follow this truth hierarchy:

```text
server current time
> explicit user-provided facts
> verified external tools/search
> workspace RAG sources
> previous conversation
> model prior
```

Server current time is authoritative for interpreting relative time such as
"today", "yesterday", "latest", and "recent". Model training cutoff or internal
prior knowledge must not be treated as current-state evidence.

If user-provided facts conflict with server time or verified tool results, the
assistant should explain the conflict instead of blindly trusting either side.
For example, if the user says "tomorrow, January 1, 2027" but the server date
does not match that relation, the response should use the exact date and state
the mismatch.

## 5. Runtime Time Injection

Every model call that can produce user-visible content must receive runtime time
context from the server. The injected context should include:

- ISO timestamp with timezone;
- locale;
- user timezone when known;
- instruction that relative dates must be resolved from server time;
- instruction that current/latest facts require grounding unless already
  provided by a trusted tool result.

This is a runtime contract, not only a prompt style. Tests should assert that
chat and agent model calls include the time context.

## 6. Intent Router

Before calling the model, OpenCairn should classify the user request with a
deterministic router. The router may use simple rules first, then evolve to a
small classifier if needed.

Router categories:

| Category | Meaning | Required policy |
| --- | --- | --- |
| `freshness_required` | The answer depends on current or recent facts. | External grounding required. |
| `workspace_grounded` | The user asks about their documents, notes, project, or workspace. | Workspace retrieval and citation required. |
| `tool_action` | The request asks OpenCairn to create, modify, save, import, call, or send. | Tool loop required, with permissions. |
| `ambiguous` | Goal, target, scope, or risk is unclear. | Ask a focused clarifying question or offer choices. |
| `high_risk` | The action is costly, destructive, externally visible, or long running. | User confirmation unless automatic mode is explicitly selected and allowed. |
| `research_depth` | The task requires multi-source investigation or synthesis. | Research mode, source ledger, and verifier required. |

Router output:

- `thinkingLevel`;
- `ragMode`;
- `externalGroundingRequired`;
- `toolMode`;
- `requiresUserConfirmation`;
- `verifierRequired`;
- `contextBudgetPolicy`.

## 7. Mode Policy

The existing chat modes should map to real runtime behavior, not just labels.

| Mode | Thinking | Retrieval | Grounding | Verification |
| --- | --- | --- | --- | --- |
| `fast` | `low` | Strict RAG only | Required when freshness is detected | Minimal deterministic checks |
| `balanced` | `medium` | Strict or expand RAG | Required when freshness is detected | Lightweight verifier |
| `accurate` | `high` | Expand RAG | Required for freshness or disputed facts | Full verifier |
| `research` | `high` | Query plan + expanded retrieval | Multi-source grounding | Full verifier + source ledger |
| `auto` | Router selected | Router selected | Router selected | Router selected |

For Gemini 3 models, use `thinkingLevel`. `thinkingBudget` is reserved for
Gemini 2.5 compatibility and should not be the primary control for Gemini 3.

## 8. Grounding Contract

### 8.1 Current And Recent Facts

If `freshness_required=true`, the assistant must not provide a factual answer
from model priors alone. The response must be grounded by at least one verified
external source or tool result.

If grounding fails, the assistant should say that it could not verify the latest
state and answer only the stable portion of the question, if any.

The system should persist:

- grounding tool used;
- source title;
- source URL;
- source timestamp or retrieval timestamp;
- answer claims linked to sources when available.

### 8.2 Workspace Facts

If `workspace_grounded=true`, the answer must use retrieved workspace evidence.

Rules:

- no citation means no workspace factual claim;
- citation markers must map to retrieved chunks;
- cited chunks must belong to readable resources;
- if no relevant chunks are found, say that the workspace did not contain enough
  information.

### 8.3 Mixed Questions

Many requests mix workspace knowledge with current facts. Example: "Compare my
draft with the latest Gemini 3 docs." These require both workspace retrieval and
external grounding. The final answer should separate:

- what comes from the user's workspace;
- what comes from external sources;
- what is inferred by the model.

## 9. Chunk-Level Retrieval

Note-level embeddings are not enough for large documents. Long notes and
imported documents should be indexed as chunks.

Proposed `note_chunks` shape:

| Field | Purpose |
| --- | --- |
| `id` | Stable chunk id. |
| `workspace_id` | Permission and tenant boundary. |
| `project_id` | Project-scoped retrieval. |
| `note_id` | Parent note. |
| `chunk_index` | Stable order within the note. |
| `heading_path` | Human-readable section path. |
| `content_text` | Chunk text. |
| `content_tsv` | Full-text index input. |
| `embedding` | pgvector embedding. |
| `token_count` | Context packing budget. |
| `source_offsets` | Optional source location data for citations. |
| `content_hash` | Idempotent re-indexing and duplicate suppression. |
| `created_at`, `updated_at`, `deleted_at` | Maintenance, freshness, and soft-deletion. |

Chunking should preserve headings and avoid splitting tables, code blocks, and
short semantic units when possible. Re-indexing should be content-hash based so
small edits do not rebuild unrelated chunks.

`deleted_at` is intentionally denormalized from `notes.deleted_at`. Retrieval
hot paths should be able to filter active chunks directly before joining parent
notes, while write paths must keep note and chunk soft-deletion state in sync.

## 10. Hybrid Retrieval

The retrieval layer should collect candidates from multiple channels:

1. vector search over `note_chunks.embedding`;
2. full-text search over `note_chunks.content_tsv`;
3. current note or active project hints;
4. concept graph expansion;
5. optionally, prior conversation anchors.

Use RRF to merge channels into a candidate pool. RRF is appropriate here because
different channels produce different score distributions.

Initial defaults:

- collect 50-100 candidates;
- cap per source note to avoid one long note dominating;
- preserve source diversity across documents;
- rerank down to 8-15 chunks for final context.

## 11. Graph RAG Without Neo4j

The knowledge graph should improve recall rather than replace retrieval.

Recommended flow:

```text
seed chunks from vector/BM25
  -> linked concepts
  -> 1-2 hop neighboring concepts
  -> related notes/chunks
  -> merge into candidate pool
  -> rerank and pack context
```

Graph expansion should be bounded:

- max depth 2 by default;
- max added candidates per concept;
- permission checks on every related note or chunk;
- relation-type weights, for example stronger weights for `defines`,
  `supports`, and `cites` than loose similarity relations.

Neo4j reconsideration criteria:

- graph traversal query latency remains unacceptable after indexes and bounded
  expansion;
- product requirements need deep multi-hop graph analytics;
- online paths need centrality, community detection, or path ranking at a scale
  that Postgres cannot support;
- edge count grows beyond the practical range for the current Postgres
  deployment and measured queries identify graph traversal as the bottleneck.

## 12. Reranking

RRF is a good recall mechanism, but large corpora need reranking for precision.

Phase one can use a lightweight LLM or heuristic reranker:

- exact phrase and entity overlap;
- section title relevance;
- source recency;
- source authority;
- graph proximity;
- active-note or active-project boost.

Later phases may introduce a dedicated reranker model if evals show a clear
quality gap.

## 13. Context Packing

Context packing is likely to become the first real scale bottleneck. The packer
should decide what evidence reaches the model.

Packing rules:

- fit within a mode-specific token budget;
- include citation metadata for every chunk;
- avoid duplicate chunks from the same note unless required;
- preserve source diversity;
- include exact dates and source timestamps where relevant;
- keep conversation history bounded and summarized;
- prefer retrieved evidence over conversation memory for factual answers.

The packer should output a structured `EvidenceBundle` rather than a free-form
string so the verifier can inspect the same evidence.

## 14. Answer Verifier

Important answers should pass through a verifier before final output.

Verifier checks:

- date claims do not conflict with server current time;
- freshness-required answers have external grounding;
- workspace claims have citations;
- citations map to readable chunks;
- cited chunks support the corresponding claim;
- tool results and final prose do not conflict;
- the answer clearly separates source facts from inference.

Use deterministic checks wherever possible. LLM verification should be reserved
for claim-support classification and nuanced contradiction detection.

## 15. Human Interaction Policy

OpenCairn should expose two user-visible working styles:

| Style | Behavior |
| --- | --- |
| Confirming mode | Ask concise questions, present choices, and wait for approval before risky or ambiguous work. |
| Automatic mode | Plan, retrieve, act, verify, fix, and report without intermediate confirmation when policy allows. |

The "ralph loop" should be a product-level behavior:

```text
plan
  -> execute
  -> verify
  -> repair if verification fails
  -> repeat within limits
  -> report changes, evidence, and residual risks
```

Ambiguous or high-risk requests should default to confirming mode unless the
user explicitly opts into automatic mode for that run or workspace.

## 16. Persistence And Observability

Each grounded answer or agent run should persist enough metadata to debug and
evaluate quality:

- router classification;
- mode policy selected;
- time context used;
- retrieval query or decomposed queries;
- candidate counts per channel;
- selected chunks and citations;
- external sources;
- verifier result;
- model id and thinking level;
- tool calls and tool results;
- termination reason.

This metadata should not expose secrets or private source content outside the
authorized workspace. It is for audit, debugging, evals, and user-facing
transparency.

## 17. Evaluation

Create a focused eval suite before broad implementation claims.

Required eval categories:

- server date is 2026 but model tries to answer as if it is 2024;
- latest/current-event query answered without grounding;
- workspace claim without citation;
- citation points to a chunk that does not support the claim;
- user false premise conflicts with server time or source facts;
- long document answer requires paragraph-level retrieval;
- graph expansion improves recall over vector/BM25 alone;
- tool calling preserves Gemini 3 function call ids and thought signatures;
- ambiguous request triggers choices instead of unsupported assumptions;
- automatic mode executes and verifies within bounded iterations.

Metrics:

- recall@k for retrieval;
- citation precision;
- answer faithfulness;
- source freshness compliance;
- verifier catch rate;
- latency by mode;
- token and cost by mode.

## 18. Implementation Phases

### Phase 1: Reliability Policy

- Inject runtime current time into chat and agent model calls.
- Switch Gemini 3 paths to `thinkingLevel` policy.
- Connect chat modes to real runtime policy.
- Add freshness detector.
- Add no-source answer guard for latest and workspace-grounded questions.
- Add tests for time injection, mode policy, and grounding-required routing.

### Phase 2: Chunk Retrieval

- Add `note_chunks` schema and indexes.
- Add chunk generation/backfill pipeline.
- Store chunk embeddings and full-text index.
- Return chunk-level citations.
- Keep note-level retrieval as fallback during migration.

### Phase 3: Graph Expansion

- Add bounded concept expansion to retrieval.
- Merge graph candidates through RRF.
- Preserve permission checks and workspace boundaries.
- Add eval cases showing graph expansion improves recall.

### Phase 4: Rerank And Context Packing

- Add candidate pool and rerank step.
- Add structured `EvidenceBundle`.
- Add source diversity and duplicate suppression.
- Add context packing tests for large corpora.

### Phase 5: Verifier And Evals

- Add deterministic verifier checks.
- Add LLM verifier only where deterministic checks are insufficient.
- Persist source ledger and verifier metadata.
- Add nightly or manual eval command.

## 19. Open Questions

- Should chunking be generated during ingest only, or also for manually edited
  notes through a background queue?
- Should chunk embeddings be stored for all notes immediately, or lazy-built on
  first retrieval for existing workspaces?
- Should `accurate` mode always run verifier, or only when the router detects
  factual/current/workspace claims?
- Should external grounding use Gemini Google Search first, or an
  OpenCairn-owned search abstraction that can support multiple providers later?
- How much source ledger detail should be user-visible by default versus hidden
  behind a "sources/details" UI?

## 20. Acceptance Criteria

- Latest/current questions cannot produce factual answers without grounding.
- Workspace-grounded answers cannot produce factual claims without citations.
- Server current time is injected and tested for every chat/agent answer path.
- Gemini 3 model calls use `thinkingLevel` according to mode policy.
- Long-document retrieval can cite a specific chunk, not only a parent note.
- Graph expansion improves measured recall without introducing Neo4j.
- Verifier catches date conflicts, missing grounding, and unsupported citations.
- Retrieval and answer quality are covered by an eval suite, not only unit tests.
