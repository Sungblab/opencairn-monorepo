# 012. Code Project Workspace

## Status

Accepted as a Phase 1 design direction. Implementation is split into later
sessions.

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
- kind: file or directory
- MIME type or language hint
- byte size and content hash for files
- optional object-storage key when content is not inline

Paths must be normalized. No absolute paths, drive letters, `..`, control
characters, duplicate normalized paths, or case-insensitive collisions on
Windows-like paths are allowed.

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
  guards, idempotency, and stale-base rejection.
- Add storage for workspace metadata, file contents, patches, and snapshots.
- Keep execution, dependency install, and hosted preview out of scope.

### Phase 1B: API And Project Surface

- Add create/list/get endpoints for project-scoped code workspaces.
- Add patch preview/apply endpoints or route them through the existing action
  ledger.
- Add package/download for a snapshot archive.
- Add focused permission and contract tests.
- Surface code workspaces in the existing project explorer/tab shell without
  adding a separate IDE page.

### Phase 1C: Agent Wiring

- Teach the agent/project-object flow to emit `code_project.create` and
  `code_project.patch` actions.
- Show patch previews and terminal status in the Agent Panel or current action
  surfaces.
- Persist final snapshots and archive links.
- Keep command execution as a later handoff.

### Later Phase: Execution Loop

- Implement approved sandbox commands for test/build/lint.
- Store logs and command artifacts.
- Feed failures back into the agent for bounded repair loops.
- Add cancellation, retries, iteration limits, and install/network approvals.

### Later Phase: Hosted Preview

- Add static preview first.
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
  idempotency, and stale base behavior.
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
