# Feature Registry

Use this file before starting a feature, follow-up, or bugfix. It is a duplicate-work guard, not a full implementation record.

Read order for new work:

1. Search this registry for the feature/domain keyword.
2. Open the source-of-truth docs listed here.
3. Check `docs/contributing/plans-status.md` for current status.
4. Inspect the owning paths before adding new routes, tables, stores, agents, workers, or i18n namespaces.
5. If the feature already exists, extend it or record a deliberate replacement. Do not implement a parallel copy.

Status legend: `complete` means the main implementation exists; `active` means recently implemented or in review; `planned` means spec/plan exists but code should be checked before assuming availability; `blocked` means do not start without explicit user instruction.

## Maintenance Rules

Update this registry when a change introduces or materially changes any of these:

- user-visible feature surface
- API route family
- DB table or migration-owned domain
- worker workflow, activity family, or agent
- feature flag
- shared schema or contract used by multiple packages
- superseded plan, renamed route, or compatibility redirect

Do not use this file as the only source of truth. It is the fast lookup layer.
Stable architecture belongs in `docs/architecture/`, current status belongs in
`docs/contributing/plans-status.md`, historical context belongs in
`docs/contributing/project-history.md`, and repeated mistakes belong in
`docs/contributing/llm-antipatterns.md`.

| Feature ID | Status | Owning paths | Source of truth | Duplicate guard |
| --- | --- | --- | --- | --- |
| workspace-auth-permissions | complete | `apps/api/src/routes/workspaces.ts`, `packages/db/src/schema/`, `apps/api/src/lib/permissions*` | `docs/superpowers/plans/2026-04-09-plan-1-foundation.md`, `docs/architecture/security-model.md` | Do not add direct DB permission checks in route handlers; use existing permission helpers. |
| oss-branding-hosted-links | complete | `apps/web/src/lib/site-config.ts`, `.env.example`, `docker-compose.yml`, `docs/contributing/hosted-service.md` | `docs/contributing/hosted-service.md` | Public site URL, repo/docs/issues/license, author/contact/social, legal, and blog links are env-driven; do not hardcode personal domains or emails in runtime surfaces. |
| web-i18n-foundation | complete | `apps/web/src/i18n.ts`, `apps/web/messages/`, `apps/web/src/proxy.ts` | `docs/superpowers/specs/2026-04-20-web-foundation-design.md`, `docs/superpowers/plans/2026-04-20-plan-9a-web-foundation-and-landing.md` | Do not add user-facing literals outside message JSON. Run i18n parity when touching copy. |
| editor-yjs-comments | complete | `apps/web/src/components/editor/`, `apps/hocuspocus/`, `apps/api/src/routes/comments.ts` | `docs/superpowers/plans/2026-04-21-plan-2a-editor-core.md`, `docs/superpowers/plans/2026-04-22-plan-2b-hocuspocus-collab.md`, `docs/architecture/collaboration-model.md` | Yjs is canonical for collaborative note content; do not reintroduce PATCH-content as canonical save. |
| share-links-note-permissions | complete | `apps/api/src/routes/share.ts`, `apps/web/src/components/share/`, `apps/web/src/app/[locale]/s/` | `docs/superpowers/plans/2026-04-26-plan-2c-share-notifications.md` | Public share and per-note permission APIs already exist; extend them rather than adding a second share surface. |
| notification-dispatcher | complete | `apps/api/src/lib/email-dispatcher.ts`, `packages/emails/src/templates/notifications/`, `apps/web/src/app/[locale]/settings/notifications/` | `docs/superpowers/plans/2026-04-29-email-notification-dispatcher.md` | Email notification preferences and dispatcher exist behind flags; do not add another scheduler without checking this path. |
| app-shell-tabs-routes | complete | `apps/web/src/components/shell/`, `apps/web/src/stores/`, `apps/web/src/lib/urls.ts`, `apps/web/src/lib/url-parsers.ts` | `docs/superpowers/specs/2026-04-20-tab-system-design.md`, `docs/superpowers/plans/2026-04-23-app-shell-phase-*.md`, `docs/superpowers/plans/2026-04-30-url-restructure.md` | Use the central URL helpers and tab stores; old `/app/w/...` paths are compatibility redirects only. |
| chat-agent-panel-real-llm | complete | `apps/api/src/lib/agent-pipeline.ts`, `apps/api/src/lib/chat-llm.ts`, `apps/web/src/components/agent-panel/` | `docs/superpowers/plans/2026-04-23-app-shell-phase-4-agent-panel.md`, `docs/review/2026-04-28-completion-claims-audit.md` | Chat stubs were replaced by real LLM paths; do not add new placeholder chat surfaces unless test-only. |
| chat-scope-rag | complete | `apps/api/src/routes/chat.ts`, `apps/api/src/lib/chat-retrieval.ts`, `apps/web/src/components/chat-scope/` | `docs/superpowers/plans/2026-04-20-plan-11a-chat-scope-foundation.md`, `docs/architecture/context-budget.md` | Scope chips and strict/expand RAG modes exist; new retrieval should plug into them. |
| doc-editor-slash-commands | complete | `apps/api/src/routes/doc-editor.ts`, `apps/worker/src/worker/agents/doc_editor/`, `apps/web/src/components/editor/doc-editor/` | `docs/superpowers/plans/2026-04-28-plan-11b-phase-a-slash-commands.md`, `docs/superpowers/plans/2026-04-28-plan-11b-phase-b-rag-slash-commands.md` | `/improve`, `/translate`, `/summarize`, `/expand`, `/cite`, and `/factcheck` already have a shared surface. |
| ingest-pipeline | complete | `apps/api/src/routes/ingest.ts`, `apps/worker/src/worker/workflows/ingest_workflow.py`, `apps/worker/src/worker/activities/` | `docs/superpowers/plans/2026-04-09-plan-3-ingest-pipeline.md`, `docs/architecture/data-flow.md` | Use the existing Temporal ingest workflow; do not create ad hoc long-running parse jobs in the API. |
| drive-notion-import | complete | `apps/api/src/routes/import.ts`, `apps/api/src/routes/integrations.ts`, `apps/worker/src/worker/workflows/import_workflow.py`, `apps/web/src/app/[locale]/workspace/[wsSlug]/import/` | `docs/superpowers/specs/2026-04-22-ingest-source-expansion-design.md`, `docs/superpowers/plans/2026-04-22-ingest-source-expansion.md` | Drive/Notion one-shot import exists; provider-specific UX changes need to preserve current import APIs. |
| markdown-export-import | planned | `apps/api/src/routes/import.ts`, `apps/worker/src/worker/workflows/import_workflow.py`, `apps/worker/src/worker/activities/markdown_import_activities.py`, `apps/web/src/app/[locale]/workspace/[wsSlug]/import/` | `docs/superpowers/plans/2026-05-03-import-connectors-gap.md` | Obsidian/Bear-style exports should enter through generic Markdown ZIP import first; do not add separate provider tabs or dedicated importers until this path is proven. |
| literature-import | complete | `apps/api/src/routes/literature.ts`, `apps/worker/src/worker/workflows/lit_import_workflow.py`, `apps/web/src/components/tab-shell/viewers/lit-search-viewer.tsx` | `docs/contributing/plans-status.md`, `docs/architecture/data-flow.md` | Search/import federation and DOI dedupe exist; check DOI and metadata note paths before adding paper import logic. |
| content-aware-enrichment | complete | `apps/worker/src/worker/activities/enrich_document_activity.py`, `apps/worker/src/worker/activities/detect_content_type_activity.py`, `apps/api/src/routes/internal.ts` | `docs/contributing/plans-status.md`, `docs/review/2026-04-28-completion-claims-audit.md` | Enrichment artifacts already exist behind feature flags; UI surfacing is a follow-up, not a new enrichment backend. |
| grounded-evidence-surfaces | active | `apps/api/src/routes/knowledge-surface.ts`, `apps/api/src/lib/knowledge-surface-evidence.ts`, `packages/shared/src/knowledge*` | `docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md`, `docs/superpowers/plans/2026-05-01-grounded-knowledge-surfaces.md` | Evidence-aware graph/mindmap/cards work is active; search existing evidence bundle APIs before adding duplicate graph evidence. |
| grounded-rerank-context | active | `apps/api/src/lib/chat-retrieval.ts`, `apps/api/src/lib/retrieval-graph-expansion.ts`, `apps/api/src/lib/context-packer*` | `docs/superpowers/plans/2026-05-01-grounded-agent-rerank-context.md`, `docs/superpowers/plans/2026-05-01-grounded-agent-graph-expansion.md` | Retrieval expansion/rerank/context packing exist; new chat grounding should reuse these helpers. |
| knowledge-graph-visualization | complete | `apps/web/src/components/graph/`, `apps/worker/src/worker/agents/visualization/`, `apps/api/src/routes/visualize.ts` | `docs/contributing/plans-status.md`, `docs/review/2026-04-28-completion-claims-audit.md` | Visualization is the owner of timeline/graph generation; Temporal agents should not duplicate timeline creation. |
| learning-system | complete | `apps/api/src/routes/learning.ts`, `apps/web/src/components/learn/`, `apps/worker/src/worker/activities/socratic_activity.py`, `apps/worker/src/worker/workflows/socratic_workflow.py` | `docs/contributing/plans-status.md` | SM-2 flashcards and Socratic surfaces exist; add learning follow-ups to this path. |
| synthesis-agents-export | complete | `apps/worker/src/worker/agents/synthesis/`, `apps/web/src/components/synthesis-export/`, `apps/tectonic/` | `docs/contributing/plans-status.md` | Synthesis export exists behind flags; do not restart document export from Plan 10 assumptions. |
| agent-generated-files | active | `packages/db/src/schema/agent-files.ts`, `packages/shared/src/agent-files.ts`, `apps/api/src/routes/agent-files.ts`, `apps/api/src/lib/agent-files.ts`, `apps/api/src/lib/agent-file-fence.ts`, `apps/web/src/components/tab-shell/viewers/agent-file-viewer.tsx`, `apps/web/src/components/sidebar/project-tree*.tsx` | `docs/superpowers/specs/2026-05-03-agent-generated-files-and-viewers-design.md`, `docs/superpowers/plans/2026-05-03-agent-generated-files-and-viewers.md` | Generated agent files are first-class project objects with storage, explorer rows, viewers, download, ingest, version, LaTeX compile, and canvas bridge. Extend this surface instead of adding chat-only file artifacts. |
| mcp-client | complete | `apps/api/src/routes/mcp.ts`, `apps/api/src/lib/mcp-runner.ts`, `apps/web/src/app/[locale]/settings/mcp/` | `docs/contributing/plans-status.md` | Per-user MCP server registry and SSRF guard exist; do not add provider UX that bypasses this foundation. |
| llm-ingest-modernization | planned | `packages/llm/`, `apps/worker/src/worker/activities/`, `apps/api/src/lib/chat-retrieval.ts` | `docs/superpowers/specs/2026-05-03-llm-provider-and-ingest-modernization-design.md` | OpenAI-compatible providers, Parser Gateway, and Adaptive RAG are planned together; avoid one-off provider/parser rewrites. |
| billing-plan-9b | blocked | `docs/superpowers/plans/2026-04-09-plan-9b-billing-engine.md` | `docs/contributing/hosted-service.md`, `docs/architecture/billing-model.md` | Blocked on business registration. Do not implement billing/legal/blog inside the OSS app unless explicitly requested. |
