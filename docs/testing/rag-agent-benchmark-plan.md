# RAG And Agent Benchmark Plan

This document defines the public benchmark plan for OpenCairn retrieval,
parsing, and agentic workflow quality. It is intentionally separate from
feature status: a feature can be implemented while still needing benchmark
evidence before the project claims it is high quality.

## Goals

OpenCairn should be evaluated on the things that matter for a personal and team
knowledge OS:

- answers must cite readable evidence
- retrieval must not leak inaccessible notes or sources
- mutable notes must be re-indexed after content changes
- parsers must preserve enough structure for later evidence and citations
- agents must produce reviewable plans, typed actions, status, and recovery
  paths instead of mutating state directly

The first benchmark suite should be small, deterministic, and runnable on a
developer machine. It should become broader only after the signal is useful.

## Evaluation Areas

| Area | Primary question | Representative owning paths |
| --- | --- | --- |
| Permission-aware RAG | Does retrieval only use sources the user can read? | `apps/api/src/lib/chat-retrieval.ts`, `apps/api/src/lib/adaptive-rag-router.ts`, `apps/api/src/lib/retrieval-quality.ts`, `apps/api/src/lib/context-packer*` |
| Citation grounding | Do citations actually support the generated answer? | `apps/api/src/lib/chat-llm.ts`, `apps/api/src/lib/agent-pipeline.ts`, `apps/web/src/components/agent-panel/` |
| Note freshness | Are changed Yjs-backed notes reflected in later retrieval? | `apps/api/src/lib/note-chunk-refresh.ts`, `apps/api/src/lib/note-chunk-indexer.ts`, `apps/hocuspocus/` |
| Parser fidelity | Does ingest preserve text, headings, tables, and order? | `apps/worker/src/worker/lib/parser_gateway.py`, `apps/worker/src/worker/lib/canonical_document.py`, `apps/worker/scripts/parser_benchmark.py` |
| Agent planning | Are user goals split into executable, reviewable steps? | `packages/shared/src/agentic-plans.ts`, `apps/api/src/lib/agentic-plans.ts`, `apps/web/src/components/agent-panel/` |
| Action execution | Do typed actions record preview, approval, result, and failures? | `packages/shared/src/agent-actions.ts`, `apps/api/src/lib/agent-actions.ts`, `apps/api/src/routes/agent-actions.ts` |

## Metrics

### RAG

| Metric | Definition | Target for first public report |
| --- | --- | --- |
| `citation_precision` | Share of cited evidence snippets that directly support the answer sentence they are attached to. | Report baseline, then improve. |
| `unsupported_claim_rate` | Share of answer claims not supported by cited readable evidence. | Lower is better; zero tolerance for critical claims. |
| `permission_leakage_count` | Count of retrieval candidates or citations from resources the acting user cannot read. | Must be `0`. |
| `answer_abstention_accuracy` | Whether the system says it lacks evidence when the fixture has no answer. | Report by fixture group. |
| `retrieval_path_coverage` | Which paths contributed evidence: vector, text search, graph expansion, rerank, fallback. | Used to debug, not to rank quality alone. |
| `fresh_note_hit_rate` | Share of changed-note queries where the newest Yjs-derived content is retrieved. | Must improve before claiming mutable-note quality. |

### Parser

| Metric | Definition | Target for first public report |
| --- | --- | --- |
| `text_recall` | Share of expected text spans recovered from the source document. | Report per file type. |
| `heading_order_accuracy` | Whether headings and major sections remain in source order. | Report per fixture. |
| `table_cell_f1` | Cell-level precision/recall for table fixtures. | Report baseline, especially for PDFs. |
| `korean_text_integrity` | Whether Korean text, spacing, and encoding survive parse. | Must be manually inspected for initial fixtures. |
| `canonical_document_validity` | Whether parser output conforms to the canonical document schema. | Must pass before comparing quality. |

### Agentic Workflow

| Metric | Definition | Target for first public report |
| --- | --- | --- |
| `plan_validity_rate` | Share of model-backed or deterministic plans that validate against schema and scope constraints. | Report by scenario. |
| `unsafe_step_downgrade_rate` | Share of risky model steps correctly converted to `manual.review`. | Higher is better when risks exist. |
| `action_audit_completeness` | Share of actions with input, preview/result, status, actor, and stable error code when failed. | Should be close to 100% for typed actions. |
| `approval_boundary_pass_rate` | Whether destructive, external, or expensive actions require approval before execution. | Must be 100% for covered fixtures. |
| `recovery_success_rate` | Share of failed runs where the system exposes a useful retry, repair, or review path. | Report baseline. |

## Fixture Design

Start with fixtures that are small enough to inspect by hand:

1. **Permission fixtures**
   - two users in one workspace
   - one shared project, one private project, one page with an override
   - queries whose tempting best answer lives in a resource the acting user
     cannot read

2. **Mutable note fixtures**
   - create a note, query it, edit the Yjs-backed content, query again
   - include rename, move, and note.update apply cases when the action ledger
     is involved

3. **Parser fixtures**
   - PDF with headings and paragraphs
   - PDF with tables
   - Korean PDF or HWP/HWPX-converted fixture
   - Markdown and Office fixtures with known expected spans

4. **Agent workflow fixtures**
   - low-risk note creation
   - note.update preview/apply
   - code_project.run that succeeds
   - code_project.run that fails and creates a recovery/repair step
   - external-provider export request requiring approval

## Runner Shape

The first runner should be explicit and boring:

```text
fixture manifest
-> seed test workspace/users/projects/pages/sources
-> run retrieval/parser/agent scenario
-> collect structured events, citations, candidates, actions, and statuses
-> score deterministic metrics
-> write JSONL results and a Markdown summary
```

The preferred future locations are:

- parser fixtures and runner extensions under `apps/worker/benchmarks/`
- API RAG fixtures near `apps/api/tests/` or a dedicated `apps/api/benchmarks/`
  directory once DB seeding is stable
- agent workflow fixtures near the owning API/worker packages, with a shared
  result schema in `packages/shared`

## Reporting Standard

Public benchmark reports should include:

- commit SHA and date
- fixture manifest version
- provider and model configuration
- whether provider rerank or grounding was enabled
- exact command used
- number of cases
- per-area metric table
- examples of failures, not just averages
- caveats about fixture size and unmeasured behavior

Do not publish a single aggregate "RAG score" or "agent score" without the
underlying metric table. A single number hides the most important failure modes:
unsupported claims, permission leaks, stale-note retrieval, and unreviewed
agent actions.

## First Milestones

1. Capture a small permission-aware RAG fixture set and prove
   `permission_leakage_count = 0`.
2. Add citation grounding annotations for 20-30 question/answer fixtures.
3. Run the existing parser benchmark path on a curated PDF/Markdown/Korean
   fixture set and publish parser fidelity caveats.
4. Add agent workflow fixtures for note.update and code_project.run approval,
   terminal status, and recovery behavior.
5. Turn the first result into a public technical report rather than marketing
   copy.

## First Baseline - 2026-05-06

The first baseline is intentionally small and deterministic. It does not seed
the production database, call an LLM provider, change ingest defaults, add a
parser dependency, or add a migration.

Run from the repository root:

```powershell
pnpm --filter @opencairn/api benchmark:rag-agent
```

Output:

- raw JSONL:
  `apps/api/benchmarks/results/rag-agent-first-baseline-2026-05-06.jsonl`
- Markdown summary:
  `apps/api/benchmarks/results/rag-agent-first-baseline-2026-05-06.md`

Baseline result:

| Area | Cases | Result |
| --- | ---: | --- |
| Permission-aware RAG | 3 | `permission_leakage_count = 0` |
| Citation grounding skeleton | 6 | Manual expected evidence, allowed citation, and unsupported claim labels; LLM judge disabled |
| Agentic workflow actual slice | 1 | `note.update` is the first actual verification target |
| Agentic workflow follow-up skeleton | 1 | `code_project.run` is follow-up only and excluded from actual metric averages |

Recorded metrics:

| Metric | Value |
| --- | ---: |
| `permission_leakage_count` | 0 |
| `agentic_actual_fixture_count` | 1 |
| `agentic_follow_up_fixture_count` | 1 |
| `plan_validity_rate` | 1.00 |
| `approval_boundary_pass_rate` | 1.00 |
| `action_audit_completeness` | 1.00 |

Current limits:

- Permission-aware RAG is measured from deterministic post-filter traces, not
  a DB-backed retrieval seed yet.
- Citation grounding only validates labeled fixture shape. It does not score a
  generated answer and does not attach an LLM judge.
- Agentic workflow metric averages include only actual first-slice fixtures.
  `note.update` is in the actual first slice; executable `code_project.run`
  success/failure and recovery scoring remain follow-up work and are excluded
  from actual metric averages.
- Mutable-note freshness and parser fidelity remain separate follow-ups.
