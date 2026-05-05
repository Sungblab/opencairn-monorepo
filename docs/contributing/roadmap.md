# OpenCairn Public Roadmap

This page is the public status summary. It intentionally avoids raw internal
execution logs, private audit notes, and branch-by-branch agent handoffs.

## Current Product Shape

OpenCairn is an AI-powered knowledge OS for individuals and teams. The core
shape is:

- workspaces, projects, pages, and role-scoped permissions
- collaborative note editing with comments and mentions
- source ingest through API and Temporal workflows
- AI chat, scoped retrieval, and grounded evidence surfaces
- agentic actions for generated project files, workflow runs, and future note,
  code, import, and export operations
- browser sandbox execution for generated code
- self-hosting through Docker Compose
- hosted-service configuration through env-driven public URLs

## Stable Foundations

| Area | Public status |
| --- | --- |
| Monorepo, auth, DB, permissions | Implemented |
| Multi-LLM provider abstraction | Implemented for Gemini, native Ollama worker paths, and OpenAI-compatible gateways |
| Agent runtime and Temporal workers | Implemented |
| Editor and collaboration | Implemented |
| App shell, dashboard, settings, and canonical URLs | Implemented |
| Public sharing and notifications | Implemented |
| Ingest, parsing, embeddings, and source notes | Implemented |
| Knowledge graph and grounded retrieval surfaces | Implemented and actively improving |
| Agent-generated project files and viewers | Implemented; full API smoke requires local database and object-storage infra |
| Unified agent action ledger | Implemented for Phase 1 typed action substrate, idempotent request ledger, server-injected scope, status transitions, low-risk placeholder execution, Phase 2A note create/rename/move/delete/restore actions, and Phase 2B `note.update` preview/apply review flow |
| Parser gateway benchmark path | Implemented as a non-default benchmark and evaluation layer |
| Self-hosting profile | Implemented |
| Hosted-service billing | Not enabled; commercial billing depends on operator setup |

## Active Themes

- Polish the Document Generation IDE flow so generated project files are easier
  to request from project sources, preview, edit, version, download, and bridge
  into existing Canvas/code surfaces.
- Build the Agentic Workflow roadmap so note operations, generated files, code
  projects, import, export, approvals, and workflow status use one auditable
  action model.
- Improve grounded retrieval quality and evidence presentation.
- Use the OpenAI-compatible provider and parser gateway benchmark path to guide
  later provider routing and ingest-default changes.
- Tune adaptive RAG routing now that retrieval expansion, reranking, and
  context-packing contracts are stable enough to compare.
- Polish import/export flows without adding provider-specific UX too early.
- Extend Workflow Console unification from shared run/event contracts into a
  read-only API projection before rewriting existing Agent Panel or Plan8 UI.
- Keep the OSS app clean: legal, blog, hosted analytics, and product marketing
  copy are linked from external hosted URLs.

## Near-Term Development Queue

The current next slices are intentionally split so contributors can work without
creating duplicate surfaces:

1. Unified Agent Action Ledger follow-through: route future note, file,
   document generation, import, export, code, approval, and status workflows
   through the shared Phase 1 action substrate.
2. Note Agent Actions follow-through: Phase 2A covers create, rename, move,
   soft-delete, and restore through permission-checked actions; Phase 2B covers
   `note.update` draft previews, Yjs state-vector guarded apply, note-version
   capture, mirror/wiki-link sync, and a minimal Agent Panel review/apply card.
3. Document Generation Export Pipeline Phase 1: generate PDF, DOCX, PPTX, and
   XLSX through workers and object storage instead of LLM base64.
4. Import/Export Agent Actions Phase 1: wrap existing import and export flows in
   the same action/status model and avoid queued orphan jobs.
5. Code Project Workspace Phase 1: represent generated code as mini projects
   with file trees, multi-file patches, snapshots, and downloads.
6. Code Agent Execution Loop Phase 1: run approved test/build/lint commands,
   feed failures back to the agent, and show final diffs and logs.
7. Hosted Preview Phase 1: add safe generated-app previews after the code
   workspace and execution loop are stable.
8. Google Workspace Export Phase 1: optionally upload or convert generated
   files to Drive, Docs, Sheets, and Slides without making Google required.
9. Workflow Console Unification: converge Agent Panel, Plan8, project object
   jobs, import/export jobs, and code agent loops into one run surface.

## Public Completion Standard

Treat public status as a summary, not as a substitute for verification. Before
claiming a feature is complete, check:

- the owning code paths listed in `feature-registry.md`
- focused tests for the touched packages
- user-facing route or API behavior where applicable
- i18n parity for web copy changes

Internal audit logs and historical agent plans are kept out of the public repo
to avoid exposing implementation churn, deferred test notes, or operational
assumptions that are not useful to contributors.
