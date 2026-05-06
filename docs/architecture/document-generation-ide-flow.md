# Document Generation IDE Flow

This document is the implementation guide for ADR 010. It keeps the product and
engineering context in one public place so future work can extend the same
surface instead of creating parallel chat-only file artifacts.

For the broader note, file, code, import, export, and workflow action model, see
`agentic-workflow-roadmap.md`.

## Goal

OpenCairn should behave like a knowledge OS with an IDE-grade document generation
surface:

```text
note / chat / research result
-> typed project-object action
-> generated output stored in OpenCairn
-> project explorer entry
-> preview / edit / version / download
-> optional provider export
```

The feature is not "LLM writes a downloadable blob in chat." Generated outputs
belong to the project and should remain usable after the chat turn ends.

## Product Model

Use one user-facing model: project objects.

Implementation may still use existing tables such as `notes`, `agent_files`,
`synthesis_runs`, and connector tables, but users and agents should see a
single project explorer model:

| Output | Primary OpenCairn surface | Editing target | Preview target |
| --- | --- | --- | --- |
| Markdown | note or generated file | Plate / Markdown source | rendered Markdown |
| HTML | Canvas note or generated file | Monaco | sandboxed iframe |
| Code | Canvas note or generated file | Monaco | sandbox / run output |
| LaTeX | generated file | Monaco | compiled PDF + logs |
| JSON | generated file | source editor | JSON tree |
| CSV | generated file | table/source editor | table preview |
| DOCX | generated file | provider handoff later | document preview |
| PPTX | generated file | provider handoff later | slide preview |
| XLSX | generated file | provider handoff later | sheet preview |
| PDF | generated file | source regeneration | PDF viewer |
| Image | generated file | source regeneration | image viewer |

## Current Foundations

The repo already contains these pieces and future work should extend them:

- Agent files: `packages/shared/src/agent-files.ts`,
  `apps/api/src/lib/agent-files.ts`, `apps/api/src/routes/agent-files.ts`,
  `apps/web/src/components/tab-shell/viewers/agent-file-viewer.tsx`.
- Canvas editor and sandbox: `apps/web/src/components/canvas/`,
  `apps/api/src/routes/code.ts`, `apps/worker/src/worker/workflows/code_workflow.py`.
- Synthesis export: `apps/api/src/routes/synthesis-export.ts`,
  `apps/worker/src/worker/activities/synthesis_export/`,
  `apps/worker/src/worker/workflows/synthesis_export_workflow.py`.
- LaTeX compile service: `apps/tectonic/`.
- Google and connector foundations: `/api/integrations/google`,
  `/api/connectors`, and provider consent tables.
- Worker tool loop: `apps/worker/src/runtime/tool_loop.py`,
  `apps/worker/src/runtime/tools.py`.

## Action Contract Direction

Move write-capable chat and agent flows toward typed actions:

```text
create_project_object
update_project_object_content
export_project_object
compile_project_object
save_project_object_to_provider
```

The current `save_suggestion` and `agent-file` fenced JSON paths are compatibility
bridges. New write flows should not depend on the model hiding JSON fences inside
plain text.

Minimum action rules:

- The server injects and validates `workspaceId`, `projectId`, and `userId`.
- LLM-supplied scope fields never override authenticated context.
- Every write action checks project or page permissions.
- Generated files are stored in object storage and surfaced in the project tree.
- Long-running generation or export work uses Temporal.
- Provider export is optional and must degrade when provider credentials are not
  configured.

## Format Strategy

### Editor-Grade In App

These formats should become strong in-app IDE surfaces:

- `md`
- `html`
- `code`
- `tex`
- `json`
- `csv`

Expected capabilities:

- open from project explorer
- source editing
- preview
- agent edits
- versions
- download
- ingest into knowledge graph where useful

### Generate, Preview, Export

These formats should focus first on reliable generation, inspection, versioning,
download, and provider handoff:

- `docx`
- `pptx`
- `xlsx`
- `pdf`
- images

OpenCairn should not initially rebuild a full Office editor. Advanced native
editing should be delegated to Google Docs, Sheets, and Slides through optional
provider export.

## Google Workspace Boundary

Google login and Google Workspace access are separate grants.

```text
Google auth       -> identity
Google Drive API  -> optional storage/export consent
Google Docs API   -> optional native document handoff
Google Sheets API -> optional spreadsheet handoff
Google Slides API -> optional deck handoff
```

Self-hosted deployments must work without Google credentials. If Google env vars
or provider grants are missing, the UI should show OpenCairn storage and download
actions only.

## Implementation Phases

### Phase 1: Normalize File Types And Previews

Goal: make existing agent files feel like project explorer objects.

- Keep `agent_files` as the stored-file table for now.
- Ensure supported kinds include `md`, `html`, `code`, `tex`, `json`, `csv`,
  `docx`, `pptx`, `xlsx`, `pdf`, image, and binary fallback.
- Improve lightweight previews:
  - Markdown rendered preview
  - JSON tree
  - CSV table
  - PDF/image/html existing previews
  - LaTeX source + compiled PDF when available
- Add dynamic heavy viewers later for DOCX/PPTX/XLSX.

### Phase 2: Typed Project-Object Actions

Goal: remove the product dependency on fenced JSON generation.

- Add shared schemas for project-object create/export/compile actions.
- Route chat and agent write intents through typed action handlers.
- Keep `agent-file` fence parsing as a backward-compatible fallback.
- Emit typed SSE events that the web UI can render as file/object cards.
- Persist action metadata on chat messages or runs.

Current implementation boundary:

- `agent-file` fences still exist only as the compatibility input bridge from
  LLM text.
- API chat routes convert that bridge into `create_project_object` typed
  actions before writing bytes or rows.
- The action handler delegates storage and versioning to the existing
  `agent_files` service while returning typed `project_object_created` events.
- The legacy `agent_file_created` SSE event is still emitted so existing web
  consumers and saved message metadata keep working during the migration.
- `export_project_object` returns an OpenCairn stored-file download event for
  `provider: "opencairn_download"` and remains a typed skeleton for optional
  provider exports until those provider capabilities are implemented. Google
  Workspace remains optional.

### Phase 3: General Document Generation

Goal: let users ask for common work outputs from notes, chat, and research.

Initial targets:

- Markdown report
- DOCX report
- PDF report
- LaTeX source and compiled PDF
- CSV and XLSX table
- HTML artifact
- PPTX deck

Reuse Synthesis Export where it fits, but expose generation through the project
explorer and agent action surface rather than only through a separate page.

Current implementation boundary:

- Completed Synthesis Export runs can publish an existing `synthesis_documents`
  object as an `agent_files` project object through the API.
- The publish path reuses the stored object key instead of re-uploading bytes,
  registers the file with `source: "synthesis_export"`, and emits the project
  tree update needed for explorer discovery.
- The response includes the typed `project_object_created` event and the legacy
  `agent_file_created` compatibility event so existing consumers can migrate
  incrementally.
- The Synthesis Export result panel exposes a completed-document action that
  publishes the generated document to the project and opens the returned
  `agent_file` in the existing tab shell viewer. The download action remains
  available as the self-host friendly file escape hatch.
- The existing `/api/synthesis-export/runs/:id/document` download path remains
  unchanged.
- Provider export remains optional; OpenCairn stored files and download remain
  the core self-host path.
- Worker-backed `generate_project_object` jobs now run a first quality slice:
  the workflow hydrates note sources through the internal worker/API source
  boundary, builds a structured intermediate document model, preserves Korean
  and English text, renders multi-page PDFs, source-aware DOCX files, readable
  PPTX decks, and structured XLSX workbooks, then registers the final object
  through the existing `agent_files` callback contract.
- The follow-up hydration slice adds a dedicated internal
  `/api/internal/document-generation/hydrate-source` endpoint for generated
  project objects, chat threads, research runs, and synthesis runs/documents.
  The worker uses hydrated content when available and falls back to a structured
  reference for that individual source if the internal hydration call fails, so
  one inaccessible source does not unnecessarily kill the whole generation
  workflow.
- Binary/heavy generated project objects and synthesis documents keep the API
  boundary lightweight: the internal endpoint returns scope-checked object
  metadata, and the worker attempts bounded body extraction for PDF, DOCX,
  PPTX, XLSX, and XLS using existing worker dependencies. Unsupported MIME
  types, objects over the worker extraction limit, corrupt files, scanned PDFs
  without embedded text, and parser failures remain per-source metadata
  fallbacks instead of workflow-level failures.
- The Agent Panel and Chat Scope now render the worker-backed
  `generate_project_object` lifecycle inside the existing message surfaces.
  Request, queued/running, completed, and failed events are merged by
  `requestId`; cards show the target format, filename, current status, selected
  source kinds (`note`, `agent_file`, `chat_thread`, `research_run`,
  `synthesis_run`), and the worker error code when a run fails. Completed
  outputs expose both the existing agent-file viewer action and the direct
  OpenCairn download link without adding a new document-generation screen.
- A first productized request form now lives inside the existing Agent Panel and
  Chat Scope surfaces. It lists project-scoped source options for notes,
  generated agent files, the current user's chat threads, research runs, and
  synthesis runs/documents, then submits the same `generate_project_object`
  payload used by the API and live smoke harness. It does not add a separate
  document-generation page or a second artifact store.
- Source handling quality signals are additive metadata. Unsupported, corrupt,
  oversized, scanned, unextractable, hydration-failed, or token-budget-skipped
  sources can be shown as compact warnings while preserving the worker error
  code and the existing viewer/download result actions. Result cards keep both
  aggregate signals and affected source titles, so users can tell which selected
  source fell back without opening a separate document-generation page.

Remaining Phase 3C/3D work:

- Keep running the live smoke script against source selection, source-quality
  metadata, Temporal, object storage, project tree update, callback
  registration, authenticated download, and artifact magic bytes when these
  boundaries change.
- Expand Phase 3D quality signals only after the current event/result contract
  has been exercised with real user prompts.
- Evaluate OCR and multimodal extraction as a later quality slice, not as a
  production default in Phase 3D. The current worker extraction path should keep
  scanned or image-only PDFs as per-source metadata fallbacks with
  `scanned_no_text` and `metadata_fallback` quality signals, so document
  generation still completes without inventing body text.
- The minimum fixture strategy for that follow-up is:
  - keep tiny generated fixtures in worker tests instead of committing large
    sample PDFs;
  - cover an embedded-text PDF, an image-only/scanned PDF, unsupported binary,
    oversized supported binary, corrupt supported binary, and one Office OOXML
    source;
  - assert quality signals and fallback body behavior before adding provider
    calls;
  - add provider-gated OCR or multimodal extraction behind a worker-only feature
    flag after fixtures prove the fallback contract is stable.
- A future multimodal implementation can reuse existing provider abstractions
  and the ingest PDF/image OCR precedent, but it must remain bounded by source
  byte/page limits, provider capability checks, self-host degradation, and the
  existing `generate_project_object` request/result/event contract. Gemini's
  current public document-processing guidance supports PDF and image
  multimodal inputs, including file-based prompting for larger PDFs, but that
  should be treated as an optional extraction backend rather than a new storage
  or API contract.

### Phase 4: Google Workspace Export

Goal: generated outputs can be sent to Google Workspace without making Google a
core dependency or creating a second generated-file system.

This phase extends `export_project_object` for provider handoff. The source of
truth remains the OpenCairn `agent_files` project object and object-storage
artifact created by Phase 3. Google receives a copy or a converted native
document only after the user has a scoped, revocable Workspace grant.

Supported first targets:

| OpenCairn file | Google provider action | Google result |
| --- | --- | --- |
| Any generated file | `google_drive` upload | Drive file with original MIME type |
| DOCX | `google_docs` conversion | Google Docs document |
| XLSX | `google_sheets` conversion | Google Sheets spreadsheet |
| PPTX | `google_slides` conversion | Google Slides deck |
| PDF | `google_drive` upload | Drive PDF, no Docs conversion in first slice |

Provider export should be modeled as an external, auditable effect:

- `export_project_object` accepts the existing provider values
  `google_drive`, `google_docs`, `google_sheets`, and `google_slides`.
- The API validates the project object, workspace/project permissions,
  requested format/provider compatibility, and a user-owned Google Workspace
  grant before starting work.
- External exports run through Temporal because they call Google APIs, may need
  token refresh, and can fail after retries.
- The worker reads the already-stored OpenCairn artifact, uploads it to Drive,
  optionally asks Drive to convert it to a Google-native type, and returns
  provider metadata.
- The API stores provider metadata through the narrow
  `agent_file_provider_exports` record linked to the generated `agent_files`
  project object and originating `file.export` action. Broader connector
  metadata can still reference these rows later, but `external_object_refs`
  is not the source of truth for generated-file provider exports.
- Result events include provider name, external object ID, external URL, final
  Google MIME type, export status, and stable error codes.

Grant and fallback rules:

- Google login remains identity only. Workspace export requires a separate
  connector/provider grant with least-privilege Drive scope. The default design
  target is `drive.file`, not broad full-Drive access.
- Self-hosted deployments with no Google env vars or no connected Google
  account still expose OpenCairn preview and download.
- Revoked, expired, or insufficient grants fail the provider export action with
  a reconnect/permission-required status; they do not break the generated file.
- The first slice should avoid provider-specific generation UX. Provider export
  is an action on an existing completed project object.

Implementation split:

1. Contract and API gate:
   extend shared event/result contracts for provider export metadata, validate
   provider/file compatibility, require authenticated project access, check the
   Google connector grant, and start an export workflow.
2. Worker Google export:
   add a Temporal workflow/activity pair that refreshes Drive credentials,
   reads the object-storage artifact, uploads to Drive, performs Docs/Sheets/
   Slides conversion where supported, and returns terminal metadata or a stable
   error code.
3. Metadata and audit:
   map successful exports to connector accounts and connector audit events where
   that model fits. Do not force export state into `external_object_refs` unless
   the schema can link back to the generated project object and carry exported
   MIME type, terminal status, and stable error codes; otherwise add a narrowly
   scoped provider-export persistence shape in the implementation slice.
4. UI consumption:
   surface provider export status and external links in the existing Agent Panel
   cards, agent-file viewer actions, and workflow/status surfaces. Do not add a
   separate provider-specific generation form.
5. Verification and smoke:
   keep unit tests offline with mocked Google clients, add API permission and
   compatibility tests, add worker retry/error tests, and reserve a live Google
   smoke for an operator-controlled environment with disposable Drive fixtures.

Out of scope for Phase 4:

- DB migration before the metadata gap is proven.
- Provider-specific document generation prompts or UX.
- Replacing OpenCairn preview/download with Google links.
- Native two-way sync or collaborative editing back from Google Docs/Sheets/
  Slides into OpenCairn.
- Google conversion for arbitrary formats beyond DOCX/XLSX/PPTX.

### Phase 5: Project Object Consolidation

Goal: reduce implementation split between notes, Canvas notes, agent files, and
synthesis documents.

- Introduce or refine a project-object abstraction only after the action and
  viewer contracts are clearer.
- Preserve existing note/Yjs semantics.
- Preserve object-storage immutability and file versions.
- Avoid migration churn until the API shape is stable.

## Verification Checklist

For any change in this area:

- Run shared contract tests if file kinds or schemas change.
- Run API build/tests if agent file, synthesis export, or connector routes
  change.
- Run web lint/build if viewers, tabs, explorer, or i18n copy change.
- Run i18n parity when user-facing copy changes.
- Run docs consistency check when public docs change.
- For viewer changes, manually open at least one supported file type when a
  local dev stack is available.

## Non-Goals For The First Pass

- Full native DOCX/PPTX/XLSX editing inside OpenCairn.
- Making Google Workspace a required dependency.
- Adding a second chat-only file artifact store.
- Adding server-side arbitrary code execution outside the existing worker,
  sandbox, and compile-service boundaries.
