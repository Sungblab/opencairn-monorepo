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

### Phase 4: Google Export

Goal: generated outputs can be sent to Google Workspace without making Google a
core dependency.

- Save generated file to Google Drive.
- Convert DOCX to Google Docs.
- Convert XLSX to Google Sheets.
- Convert PPTX to Google Slides.
- Store provider export metadata and external URLs.
- Keep provider grants scoped and revocable.

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
