# 012. Code Project Workspace

## Status

Accepted. Phase 1A contracts and storage are implemented; Phase 1B/1C remain
follow-up implementation work.

## Context

OpenCairn already has two code-related foundations:

- `agent_files` and project-object actions store generated files, versions,
  downloads, compile requests, and document-generation results.
- Canvas Code Agent is a default-off experimental surface that edits one canvas
  note through `/api/code/run`, streams turns, and waits for browser sandbox
  feedback.

Those surfaces are useful, but neither is a full code project model. A generated
app or script set needs multiple files, directories, patch history, snapshots,
downloadable archives, and later an execution loop. Treating that as many
unrelated single files would hide project structure, while extending the current
Canvas route directly would couple multi-file projects to a single note editor
and browser-run feedback path.

## Decision

OpenCairn will represent generated code as a project-scoped code workspace: a
mini project with a file tree, patch sets, snapshots, and downloads.

Phase 1 defines and implements only the stored workspace model and reviewable
patch flow. Hosted preview and command execution are separate later phases.

The user-facing model is:

```text
project
-> code workspace
-> file tree
-> proposed multi-file patch
-> approved snapshot
-> zip/download or open files in existing project-object viewers
```

## Model

### Code Workspace

A code workspace is a project object that groups generated code files. It should
carry:

- `id`
- `workspaceId` and `projectId`, injected by the server
- display name and optional description
- language/framework metadata such as `javascript`, `python`, `html`, or
  `react`
- root file tree manifest
- current snapshot pointer
- source run/action IDs for audit
- created/updated timestamps

The first implementation may store code-workspace metadata in the agent-action
result or a narrowly scoped table, but it must not make LLM-supplied scope
trusted. If a new table is required, add it in the implementation phase with a
generated Drizzle migration number, not in this ADR-only slice.

### File Tree

The file tree is a normalized manifest, not a chat transcript. Each file entry
should include:

- path relative to the code workspace root
- kind: file or directory, enforced as a database-level enum when persisted
- MIME type or language hint
- byte size and content hash for files
- optional object-storage key when content is not inline

Paths must be normalized. No absolute paths, drive letters, `..`, control
characters, duplicate normalized paths, or case-insensitive collisions on
Windows-like paths are allowed.

The manifest must also be bounded before storage or traversal:

- maximum tree depth: 16 segments from the code workspace root
- maximum entries: 2,000 files or directories per workspace snapshot
- maximum normalized relative path length: 512 characters

Implementation should validate these limits in the shared schema/API boundary
and, when file entries are persisted as rows, use a Drizzle/PostgreSQL enum such
as `pgEnum("code_workspace_entry_kind", ["file", "directory"])` rather than a
free-text `kind` column.

### Patch

A patch is a multi-file proposed change against a base snapshot. It should
support:

- create, update, rename, move, and delete operations
- base snapshot ID
- per-file before/after hashes when applicable
- preview diff summary
- risk classification
- approval status

Patch application must be idempotent by request ID and reject stale bases unless
the implementation deliberately creates a rebase/merge preview.

### Snapshot

A snapshot is an immutable version of the code workspace after an approved
patch. It should include:

- snapshot ID
- parent snapshot ID when present
- tree hash
- file manifest
- storage references for file contents
- action/run metadata

Rollback should create a new snapshot that restores an older tree rather than
mutating history.

### Download

Phase 1 should support an OpenCairn-native archive download of a snapshot. The
archive should be generated from the validated tree and must preserve normalized
relative paths only.

## Action Contract Direction

The shared agent action family already reserves:

- `code_project.create`
- `code_project.patch`
- `code_project.rename`
- `code_project.delete`
- `code_project.install`
- `code_project.run`
- `code_project.preview`
- `code_project.package`

Phase 1 should implement only the stored/reviewable subset:

- `code_project.create`
- `code_project.patch`
- `code_project.rename`
- `code_project.delete`
- `code_project.package`

`code_project.install` and `code_project.run` belong to the execution-loop
phase because they require sandbox command allowlists, logs, cancellation, and
explicit approval for risky operations.

`code_project.preview` belongs to the hosted-preview phase because it requires
external approval, public URL lifecycle, and cleanup semantics before any
preview can be exposed.

## Duplicate Guard

Do not create a parallel chat-only code artifact store.

Extend existing foundations as follows:

- Use the unified agent action ledger for request ID, status, risk, preview,
  result, and audit trail.
- Reuse project-object navigation and tab-shell concepts so generated code is
  visible from the project explorer.
- Reuse `agent_files` or project-object viewers only for individual files or
  archive/download outputs, not as the sole representation of a multi-file code
  workspace.
- Keep Canvas notes as the single-file runnable/sandbox note surface.
- Keep `/api/code/run` and `CodeAgentWorkflow` scoped to the default-off Canvas
  Code Agent until a later execution-loop phase deliberately replaces or wraps
  it.

If a future implementation adds `/api/code-projects` or a
`code_project_workspace` route, it must not reuse `/api/code/run` semantics for
multi-file project runs. The route should own stored file trees and patch
review; run/test/preview endpoints should be added only in the execution-loop
or hosted-preview phases.

## Phase Split

### Phase 1A: Contracts And Storage

- Add shared schemas for code workspace manifests, file entries, patches,
  snapshots, and archive package results.
- Add API validation for server-injected scope, path normalization, duplicate
  guards, manifest depth/entry/path-length limits, idempotency, and stale-base
  rejection.
- Add storage for workspace metadata, file contents, patches, and snapshots.
- Use database-level enums for persisted closed sets such as file entry kind.
- Keep execution, dependency install, and hosted preview out of scope.

Phase 1A now exists in `packages/shared/src/code-project-workspaces.ts`,
`packages/db/src/schema/code-workspaces.ts`, and
`apps/api/src/lib/code-project-workspaces.ts`. The shared contract normalizes
relative paths, rejects traversal/absolute/drive-letter/control-character paths,
guards case-insensitive duplicate collisions, and enforces the Phase 1A bounds
of 16 path segments, 2,000 entries, and 512 characters per normalized path.
The storage model adds code workspaces, immutable snapshots, snapshot file
entries, and reviewable patches with DB enums for file entry kind and patch
status. The API lib validates server-injected scope and request idempotency and
rejects stale patch bases before route-level APIs are exposed.

### Phase 1B: API And Project Surface

- Add create/list/get endpoints for project-scoped code workspaces.
- Add patch preview/apply endpoints or route them through the existing action
  ledger.
- Add package/download for a snapshot archive.
- Add focused permission and contract tests.
- Surface code workspaces in the existing project explorer/tab shell without
  adding a separate IDE page.

Phase 1B now exposes project-scoped code workspace routes in
`apps/api/src/routes/code-workspaces.ts`: create/list/get workspace, create
reviewable patch requests with stale-base rejection, rename/delete workspace
metadata for the existing project tree, and package immutable snapshots as zip
archives. The routes derive workspace scope from the project, check project
read/write permissions before rows are exposed or mutated, and preserve
`requestId` idempotency for create and patch requests. The existing project
tree now surfaces `kind:"code_workspace"` rows and opens them in the tab shell
with a read-only manifest/archive viewer. Phase 1B still does not execute
commands, install dependencies, start hosted previews, or replace Canvas notes.

### Phase 1C: Agent Wiring

- Teach the agent/project-object flow to emit `code_project.create` and
  `code_project.patch` actions.
- Show patch previews and terminal status in the Agent Panel or current action
  surfaces.
- Persist final snapshots and archive links.
- Keep command execution as a later handoff.

Phase 1C now routes `code_project.create` and `code_project.patch` through the
existing Agent Action Ledger. `code_project.create` persists a stored code
workspace and first snapshot, then completes the action with workspace,
snapshot, and archive link result metadata. `code_project.patch` stores a draft
review action, records the reviewable patch request, renders the patch preview
in the existing Agent Panel, and applies approved patches into a new immutable
snapshot with a downloadable archive link. It still does not run generated
project commands, install dependencies, host previews, or deploy external apps.

### Phase 6A: Execution Loop API Seam

- `code_project.run` actions validate approved `lint`, `test`, and `build`
  command intents against an explicit immutable snapshot.
- Caller-owned `workspaceId`, `projectId`, and actor scope fields remain
  rejected; the API resolves project and workspace scope from the ledger action.
- The API service calls an injected command runner and stores terminal result
  metadata with `ok`, `command`, `exitCode`, bounded logs, and archive link
  context.
- The default API runner is intentionally unavailable. Real command execution,
  dependency installation, repair iteration, cancellation, and network approval
  handling must run through the later sandboxed worker/runtime path.

### Later Phase: Execution Loop

- Register the worker-side command activity only when
  `FEATURE_CODE_WORKSPACE_COMMANDS=true`. The Phase 6B activity validates and
  materializes inline manifests, rejects unsafe paths and object-hydration gaps,
  and delegates to an injected executor.
- Wire the API `code_project.run` runner seam to `CodeWorkspaceCommandWorkflow`
  only when `FEATURE_CODE_WORKSPACE_COMMANDS=true`; the API uses a stable
  workflow id per Agent Action row and passes the resolved snapshot manifest
  rather than trusting request-owned file data.
- Keep the default executor unavailable until an executor is explicitly
  configured. `CODE_WORKSPACE_COMMAND_EXECUTOR=docker` is the first opt-in
  executor and runs approved commands in a networkless `node:20-alpine`
  container with bounded CPU/memory flags and the snapshot mounted at
  `/workspace`.
- Create repair patch drafts from failed run actions through
  `POST /api/agent-actions/:id/repair`. The API reuses `code_project.patch`,
  links the patch action back to the failed run with `sourceRunId`, and caps
  repair drafts at three per failed run.
- Register `CodeWorkspaceRepairWorkflow` only when
  `FEATURE_CODE_WORKSPACE_REPAIR=true`. The worker repair agent receives failed
  run logs plus the resolved inline manifest and returns file replacements that
  the activity converts into a reviewable `code_project.patch` payload.
- Add explicit cancellation for queued/running `code_project.run` actions via
  `POST /api/agent-actions/:id/cancel`; browser disconnects are detach-only.
- Add a typed `code_project.install` approval substrate. Dependency install
  actions require `risk:"external"`, explicit `network:"required"`, and remain
  approval-only until an approved install executor exists.
- Implement approved sandbox commands for test/build/lint.
- Store logs and command artifacts.
- Feed failures back into the agent for bounded repair loops.
- Add cancellation, retries, iteration limits, and install/network approvals.

### Later Phase: Hosted Preview

- Add typed `code_project.preview` static approval substrate first. Phase 7A
  records static preview intent with `risk:"external"` but does not allocate
  hosted URLs or start app processes.
- Materialize approved static previews as private sandboxed API assets before
  introducing public preview hostnames. Phase 7B completes the action with an
  internal preview URL only for inline snapshot entries.
- Show pending preview approvals and completed preview links in the existing
  Agent Panel before adding a separate preview dashboard.
- Add Vite/Next preview only after process lifecycle and cleanup are safe.
- Capture browser smoke results and screenshots.
- Keep unrestricted server-side arbitrary code execution out of scope.

## Implementation Session Prompts

### Prompt 1: Contracts And Storage

```text
Respond in Korean. Use $opencairn-rules and finish with $opencairn-post-feature.

Goal: Implement Code Project Workspace Phase 1A contracts and storage only.

Read first: AGENTS.md, docs/architecture/adr/012-code-project-workspace.md,
docs/architecture/agentic-workflow-roadmap.md,
docs/contributing/feature-registry.md, packages/shared/src/agent-actions.ts,
packages/shared/src/project-object-actions.ts, packages/db/src/schema.

Scope:
- Add shared schemas for code workspace manifest/file tree/patch/snapshot/package result.
- Add storage schema only if needed; let pnpm db:generate choose migration number.
- Validate server-injected scope, path normalization, duplicate paths,
  manifest depth/entry/path-length limits, idempotency, and stale base behavior.
- Use database-level enums for persisted closed sets such as file entry kind.
- Add focused shared/db/API-lib tests.

Avoid:
- apps/web UI.
- /api/code/run changes.
- CodeAgentWorkflow execution loop.
- hosted preview.
- dependency install/run command support.
```

### Prompt 2: API And Project Surface

```text
Respond in Korean. Use $opencairn-rules and finish with $opencairn-post-feature.

Goal: Implement Code Project Workspace Phase 1B API and existing project-surface
navigation.

Read first: AGENTS.md, docs/architecture/adr/012-code-project-workspace.md,
apps/api/src/routes/code.ts, apps/api/src/lib/project-object-actions.ts,
apps/web/src/components/tab-shell, apps/web/src/components/sidebar,
apps/web/src/lib/api-client.ts.

Scope:
- Add project-scoped create/list/get/patch/package endpoints or action-ledger
  handlers for code workspaces.
- Add permission checks and requestId idempotency.
- Add project explorer/tab shell entries for opening a stored code workspace.
- Add focused API and web component tests plus i18n parity if copy changes.

Avoid:
- command execution.
- dependency installation.
- hosted preview.
- replacing Canvas notes or removing the default-off Canvas Code Agent.
```

### Prompt 3: Agent Patch Review

```text
Respond in Korean. Use $opencairn-rules and finish with $opencairn-post-feature.

Goal: Implement Code Project Workspace Phase 1C agent patch review.

Read first: AGENTS.md, docs/architecture/adr/012-code-project-workspace.md,
apps/api/src/lib/chat-runs.ts, apps/api/src/lib/agent-actions.ts,
apps/web/src/components/agent-panel, packages/shared/src/agent-actions.ts.

Scope:
- Let agent/chat flows emit code_project.create and code_project.patch actions.
- Render patch preview/status/result cards in the existing Agent Panel/action surfaces.
- Apply approved patches into immutable snapshots and expose archive/download links.
- Add focused contract/API/web tests.

Avoid:
- running tests/build/lint commands from generated projects.
- hosted app preview.
- external deployment.
- new chat-only artifact storage.
```

## Consequences

This gives OpenCairn a clear path from generated single files to generated code
projects without prematurely shipping a hosted IDE or execution runtime.

The tradeoff is that Phase 1 will feel like a structured project/file tree and
patch review surface, not a full Replit/Lovable-style app builder. That is
intentional: execution and preview require stronger sandbox, lifecycle, and
approval guarantees than a stored file-tree model.

## Non-Goals

- Do not implement hosted preview in Phase 1.
- Do not run package managers, tests, builds, or arbitrary commands in Phase 1.
- Do not add unrestricted server-side arbitrary code execution.
- Do not replace the existing Canvas note sandbox.
- Do not migrate existing `agent_files` into a new store.
- Do not make generated code projects a chat-only attachment concept.
