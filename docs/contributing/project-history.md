# Project History And Decision Log

> Snapshot: 2026-05-03, based on the current Markdown corpus, `docs/contributing/plans-status.md`, review documents, ADRs, and recent git history.
>
> This file is a map, not a replacement for the plan/spec files. Use it to understand why the project looks the way it does, then follow the linked source documents for implementation details.

## How To Read The Docs

OpenCairn has 207 Markdown files as of this snapshot, including this map. They fall into five roles:

| Role | Primary location | Use it for |
| --- | --- | --- |
| Public project surface | `README.md`, `README.ko.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CLA.md`, `LICENSE*` | What outside users and contributors see first. |
| Current routing index | `docs/README.md` | Find the right architecture, ops, test, review, plan, or spec document. |
| Architecture decisions | `docs/architecture/`, `docs/architecture/adr/` | Stable system shape and accepted tradeoffs. |
| Plans and specs | `docs/superpowers/specs/`, `docs/superpowers/plans/` | Design intent and implementation execution records. |
| Audits and reality checks | `docs/review/` | Places where implementation claims were checked against code, tests, and product surface. |

For current work, read in this order:

1. `docs/README.md`
2. `docs/contributing/plans-status.md`
3. This file
4. The relevant `docs/superpowers/specs/*` and `docs/superpowers/plans/*`
5. Any linked audit in `docs/review/*`

## Development Timeline

### 1. Initial Product Bet: Personal And Team Knowledge OS

The starting point was a Notion-alternative knowledge OS: workspaces, projects, pages, wiki-style notes, ingest, graph search, and a fleet of AI agents. The earliest documents are the PRD and system design:

- `docs/superpowers/specs/2026-04-09-opencairn-prd.md`
- `docs/superpowers/specs/2026-04-09-opencairn-design.md`

The early critical path was deliberately infrastructure-heavy: create the monorepo, data model, auth, permissions, Docker services, LLM abstraction, and agent runtime before trying to make the UI feel complete.

### 2. Foundation: Monorepo, Auth, DB, Multi-LLM, Runtime

Phase 0 established the system boundaries:

- `apps/api` owns business logic and permission checks.
- `apps/web` stays UI-only and calls APIs.
- `apps/worker` runs long-running work through Temporal.
- `packages/db` owns Drizzle schema and pgvector.
- `packages/llm` abstracts Gemini and Ollama.

Key decisions:

- Hono was chosen over Next.js API routes for backend isolation: `docs/architecture/adr/001-hono-over-nextjs-api.md`.
- Temporal was chosen over Redis streams for durable agent orchestration: `docs/architecture/adr/002-temporal-over-redis-streams.md`.
- Gemini and Ollama became the supported provider pair, with Gemini for hosted/BYOK and Ollama for local/self-host: `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md`.
- The runtime was standardized around `runtime.Agent`, tool/event contracts, hooks, trajectory logging, and evals: `docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md`.

Important correction: early plans sometimes claimed more production readiness than the code had. `docs/review/2026-04-28-completion-claims-audit.md` is the canonical warning against treating "plan complete" as equivalent to "user-facing path verified."

### 3. Editor And Collaboration: From Solo Notes To Notion-Class Surface

The editor track moved from a solo Plate editor to collaborative note editing:

- Plan 2A: Plate editor, basic nodes, wiki links, slash menu, save/load.
- Plan 2B: Hocuspocus/Yjs collaboration, comments, mentions, role-aware read-only mode.
- Plan 2C: share links, per-note permissions, notification wiring.
- Plan 2D: rich chat rendering and editor block extensions.
- Plan 2E: editor follow-ups such as paste normalization, table context menus, image/embed/math UX.

Decisions that still matter:

- Yjs is canonical for note content after collaboration landed.
- Hocuspocus auth must respect page-level permissions, not just workspace membership.
- User-facing editor copy belongs in `apps/web/messages/{ko,en}` with parity checks.
- Editor plans often split "backend exists" from "discoverable UI"; the app shell audits later fixed several hidden surfaces.

### 4. Ingest And Research: Broad Source Support, Then Evidence Quality

The ingest track started with upload and parsing infrastructure, then expanded:

- Plan 3: ingest API, MinIO, Temporal workflow, PDF/STT/image/YouTube/web parsing, note materialization.
- Plan 3b: batch embeddings.
- Follow-ups: Office/HWP parser support, scan PDF OCR, live ingest visualization, literature search/import, content-aware enrichment.
- Source expansion added Google Drive and Notion import.

Current source coverage includes PDF, Office, HWP/HWPX, text/Markdown, image/audio/video, web URL, YouTube, Notion/Drive import, and literature paper import.

The important direction changed from "parse more files" to "preserve better evidence":

- Raw sources are immutable source of truth.
- Generated wiki pages are persistent artifacts maintained by agents.
- Retrieval should cite paragraph/section-level evidence, not just parent notes.
- Grounded retrieval and evidence surfaces are now the active architecture direction.

Primary docs:

- `docs/architecture/data-flow.md`
- `docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md`
- `docs/superpowers/plans/2026-05-01-grounded-agent-note-chunks.md`
- `docs/superpowers/plans/2026-05-01-grounded-knowledge-surfaces.md`

### 5. Agent Platform: From Stubs To Real LLM Paths

The original user-facing chat and save-suggestion surfaces had stub/placeholder paths. The completion-claims audit identified this as the biggest truth gap. Plan 11B Phase A closed the critical path by wiring real Gemini-backed chat and real save-suggestion fence parsing into the API chat surfaces.

The agent platform then moved in layers:

- Agent Runtime Standard: common event/tool/agent contracts.
- Agent Runtime v2A: tool-use loop and builtin tools.
- Chat Scope Foundation: scoped conversation model, chips, RAG modes, cost tracking.
- Chat Real LLM Wiring: real streaming LLM responses in chat surfaces.
- DocEditor slash commands: `/improve`, `/translate`, `/summarize`, `/expand`.
- RAG slash commands: `/cite`, `/factcheck`.
- MCP client/server work and connector platform work, kept behind flags and permission boundaries.

Current direction:

- Keep `runtime.Agent` and Temporal as the core runtime.
- Do not introduce LangGraph/LangChain as the primary runtime.
- Add provider capabilities and routing where needed.
- Keep grounded evidence and verifier checks deterministic where possible.

### 6. Web Product Surface: Shell, Routes, Discoverability, URL Cleanup

The web app went through a deliberate shell rebuild:

- App Shell Phase 1: three-panel frame.
- Phase 2: sidebar, workspace/project tree.
- Phase 3: tab bar and tab mode router.
- Phase 4: agent panel.
- Phase 5: dashboard, project routes, settings, palette, notifications.

The first version had many implemented-but-hidden features. The 2026-04-30 app shell audit and follow-up made entry points visible for synthesis export, learning, BYOK provider settings, MCP settings, note editor, research hub, and Socratic sessions.

The URL restructure then promoted app routes from `/app/w/...` to canonical `/workspace/{slug}/project/{id}/note/{id}` style paths, with temporary redirects scheduled for cleanup.

Primary docs:

- `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md`
- `docs/review/2026-04-30-app-shell-fidelity.md`
- `docs/superpowers/specs/2026-04-30-url-restructure-design.md`
- `docs/superpowers/plans/2026-04-30-url-restructure.md`

### 7. OSS And Hosted-Service Boundary

OpenCairn is now positioned as an open-source self-hosted project with an optional hosted/commercial path:

- Default license: AGPL-3.0-or-later.
- Commercial license: available for organizations that cannot use AGPL.
- Contributor License Agreement exists so accepted contributions can be distributed under both license paths.
- `README.md`, `README.ko.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CLA.md`, `LICENSE`, and `LICENSE-COMMERCIAL.md` are the public repo surface.

Key boundary:

- The OSS app repo includes source code, docs, landing/app UI, configuration examples, and self-hosting guidance.
- Legal pages, blog, marketing analytics, and hosted-service legal copy live outside this repo and are linked through env-configured URLs.

Primary docs:

- `docs/architecture/adr/005-agplv3-dual-licensing.md`
- `docs/contributing/hosted-service.md`

### 8. Current Direction: Grounded Knowledge And Provider/Ingest Modernization

As of 2026-05-03, the strongest current direction is grounded knowledge:

- chunk-level retrieval and paragraph evidence
- graph expansion as recall booster, not as a Neo4j replacement
- rerank and context packing
- deterministic answer verifier and evals
- evidence surfaced in graph/mindmap/cards
- provider and parser modernization without rewriting the whole stack

Recent git history shows this arc:

- PR #188: grounded note chunk retrieval
- PR #190-#193: grounded evidence schemas, knowledge surface retrieval, producer hardening, producer follow-up
- PR #196: graph/mindmap/cards evidence UI
- PR #198: grounded answer verifier evals
- PR #199: grounded retrieval context packing
- PR #200: LLM provider and ingest modernization design

The umbrella spec for the next substrate modernization is `docs/superpowers/specs/2026-05-03-llm-provider-and-ingest-modernization-design.md`.

## Major Decision Log

| Decision | Why | Source |
| --- | --- | --- |
| Separate Hono API instead of Next.js API routes | Keep business logic, auth, and permission helpers out of the frontend runtime. | `docs/architecture/adr/001-hono-over-nextjs-api.md` |
| Temporal for durable orchestration | Agent and ingest workflows need retries, long waits, cancellation, and observability. | `docs/architecture/adr/002-temporal-over-redis-streams.md` |
| Browser Pyodide sandbox instead of server-side arbitrary execution | Preserve self-host safety and avoid server-side code execution risk. | `docs/architecture/adr/006-pyodide-iframe-sandbox.md` |
| AGPL plus commercial dual licensing | Keep the OSS network-use clause while allowing commercial adoption. | `docs/architecture/adr/005-agplv3-dual-licensing.md` |
| Workspace -> Project -> Page permission hierarchy | Workspace is the isolation boundary; project/page inherit and override. | `docs/architecture/collaboration-model.md` |
| Drizzle/Postgres/pgvector instead of external vector DB by default | Keep self-hosting simple and transactional with app data. | `docs/architecture/storage-planning.md`, `docs/architecture/data-flow.md` |
| Gemini/Ollama first | Gemini gives strong hosted multimodal/native features; Ollama gives local self-host path. | `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md` |
| OpenAI-compatible provider should be named `openai_compatible` | It targets vLLM, Ollama `/v1`, LiteLLM, LM Studio, OpenRouter, and gateways, not only one vendor. | `docs/superpowers/specs/2026-05-03-llm-provider-and-ingest-modernization-design.md` |
| Legal/blog stay outside the OSS app repo | Hosted legal/marketing content is not part of the self-hosted app surface. | `docs/contributing/hosted-service.md` |

## What Is Done

This is the high-level product state, not a promise that every edge case is production hardened:

- Monorepo, Docker infra, Drizzle schema, Better Auth, workspace/project/page permissions.
- Multi-LLM provider foundation for Gemini and Ollama.
- Custom agent runtime and Temporal worker foundation.
- Plate editor, wiki links, Yjs/Hocuspocus collaboration, comments, mentions, share links, per-note permissions.
- App shell, sidebar, tab system, command palette, dashboard, settings, notifications.
- Ingest for major file/source types, including Office/HWP follow-ups, scan PDF OCR, Notion/Drive import, literature import, enrichment, and live ingest visualization.
- Knowledge graph, backlinks, visualization surfaces, learning/flashcards, Socratic agent, canvas/code-agent path.
- Chat renderer, real LLM chat wiring, save_suggestion, DocEditor slash commands, RAG slash commands.
- Synthesis export, email notifications, MCP client/server foundations, connector foundation.
- OSS public surface: README, bilingual README, contributing/security/community/license/CLA docs.

## What Is Not Done Or Still Needs Care

- Plan 9b billing remains blocked on business-registration and payment-provider decisions.
- CI/CD and multi-arch build automation have been called out as still missing in review docs.
- Several E2E specs were historically deferred; `docs/review/2026-04-29-e2e-smoke-debt.md` records the move toward executable smokes, but full-stack browser coverage is still not equivalent to all manual acceptance paths.
- Some implemented features remain flag-gated or require operator env flips, especially hosted-service or risk-sensitive surfaces.
- Grounded knowledge is still being deepened: browser E2E with seeded evidence data, dedicated wiki/card summary producer depth, answer verifier rollout, and provider/ingest modernization are active follow-up areas.
- Plans can be stale after implementation. Treat `docs/contributing/plans-status.md` as a router, then verify code, branch state, and tests.

## Documentation Cleanup Rules Going Forward

Use these placement rules when adding or cleaning docs:

- Put public contributor and self-hosting guidance under `README*`, `CONTRIBUTING.md`, `SECURITY.md`, or `docs/contributing/*`.
- Put durable architecture decisions in `docs/architecture/adr/*`.
- Put current architecture references in `docs/architecture/*`.
- Put large feature designs in `docs/superpowers/specs/*`.
- Put execution checklists in `docs/superpowers/plans/*`.
- Put post-hoc truth checks in `docs/review/*`.
- Put next-session prompts in `docs/superpowers/handoffs/*` only when the next session needs a copy-paste handoff.
- Do not duplicate legal/blog content into this repo; link it through hosted-service env URLs.
- When a plan's claim changes after implementation, update `docs/contributing/plans-status.md` or add a review note rather than silently editing history out of the original plan.
