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
| Parser gateway benchmark path | Implemented as a non-default benchmark and evaluation layer |
| Self-hosting profile | Implemented |
| Hosted-service billing | Not enabled; commercial billing depends on operator setup |

## Active Themes

- Polish the Document Generation IDE flow so generated project files are easier
  to preview, edit, version, download, and bridge into existing Canvas/code
  surfaces.
- Improve grounded retrieval quality and evidence presentation.
- Use the OpenAI-compatible provider and parser gateway benchmark path to guide
  later provider routing and ingest-default changes.
- Tune adaptive RAG routing now that retrieval expansion, reranking, and
  context-packing contracts are stable enough to compare.
- Polish import/export flows without adding provider-specific UX too early.
- Keep the OSS app clean: legal, blog, hosted analytics, and product marketing
  copy are linked from external hosted URLs.

## Near-Term Development Queue

The current next slices are intentionally split so contributors can work without
creating duplicate surfaces:

1. Document Generation IDE Flow Phase 1: deepen the existing generated-file
   viewer and project-object UX instead of adding another artifact store.
2. Agentic workflow E2E reliability: keep mock API fixtures aligned with the
   current AppShell, Agent Panel, Plan8, and graph contracts.
3. Grounded evidence browser coverage: add seeded graph/card evidence smokes
   around the already implemented evidence APIs and UI states.
4. Parser Gateway benchmark quality scoring: keep it benchmark-only until
   fixture data justifies changing ingest defaults.
5. Live-stack E2E split: separate DB, Temporal, and object-storage smokes from
   lightweight mocked browser checks.

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
