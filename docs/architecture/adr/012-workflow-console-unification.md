# 012. Workflow Console Unification

## Status

Accepted as a design direction. Implementation should be split into read-only
projection, incremental UI adoption, and later write/control phases.

## Context

OpenCairn now has several user-visible run surfaces:

- durable Agent Panel chat runs with ordered `chat_run_events` SSE replay;
- unified agent actions for note operations and workflow placeholder actions;
- project-object actions for generated files, document generation, compile, and
  export requests;
- Plan8 agent runs with workflow metadata, retry intent, suggestions, stale
  alerts, and audio outputs;
- import/export workflows that already run through existing API and worker
  paths;
- planned code project and code-agent execution loops.

These surfaces are useful, but they currently normalize status and outputs in
different places. If each feature adds its own run card, drawer, event names,
approval controls, and retry/cancel behavior, OpenCairn will accumulate several
parallel consoles for the same product idea.

At the same time, forcing every existing source into one physical table too
early would create migration risk and would obscure mature source contracts such
as durable chat run replay, the agent action ledger, project-object generation
events, and Plan8 workflow summaries.

## Decision

OpenCairn will unify agentic workflow UX through a normalized Workflow Console
projection before it unifies physical storage.

The first shared model is a run envelope plus append-only event projection. It
maps existing source records into one vocabulary:

- normalized status: `draft`, `approval_required`, `queued`, `running`,
  `blocked`, `completed`, `failed`, `cancelled`, `reverted`;
- run type: `chat`, `agent_action`, `plan8_agent`, `document_generation`,
  `import`, `export`, `code_agent`, or `system_workflow`;
- stable run ID: globally unique across source families, usually by prefixing
  the source ID with `runType` and using deterministic derived IDs for legacy
  projections;
- outputs: notes, generated project objects, imports, exports, logs, previews,
  provider URLs, and future code artifacts;
- approvals: requested, accepted, rejected, expired, or superseded;
- errors: stable error code, retryability, and diagnostic summary;
- audit timestamps, actor, workspace, project, source ID, and optional chat
  anchors.

The projection may be computed from existing tables and event streams. A new
materialized run index is allowed only after repeated list/detail queries,
notification fan-out, search, or retention requirements justify it.

## Product Rules

- The Workflow Console is a status, approval, output, and recovery surface. It
  is not a new artifact editor.
- Opening an output deep-links to the owning surface: note editor, generated
  file viewer, import result, export URL, code project tab, log artifact, or
  provider URL.
- Browser disconnect from chat SSE remains stream detach, not cancellation.
  Cancellation must go through explicit cancel APIs and source state changes.
- Destructive, external-provider, expensive, dependency-install, deployment, or
  code-command actions require approval unless the user later configures
  automation.
- Self-hosted OpenCairn must remain functional without Google Workspace,
  hosted previews, or provider export credentials.

## Technical Rules

- Server-injected scope stays mandatory. Agents, LLMs, and web clients must not
  provide trusted `workspaceId`, `projectId`, `pageId`, `userId`, or
  `actorUserId` inside action payloads.
- Existing source contracts remain authoritative until they are deliberately
  migrated: `chat_runs`, `chat_run_events`, `agent_actions`, project-object
  action events, Plan8 `agent_runs`, import/export rows, and future code-run
  rows.
- Status adapters must preserve both normalized `status` and source-specific
  `sourceStatus`.
- Events must be replayable by stable ordering when the source supports it.
  Sources without an event stream can participate through polling projections.
- Workflow-start failures must transition to terminal `failed`; they must not
  leave jobs indefinitely `queued`.
- Large generated artifacts, command logs, screenshots, and binary outputs stay
  in object storage or artifact storage. The console stores links and summaries,
  not large inline payloads.
- Real-time log events are transient and bounded. Durable command, worker, and
  provider logs stay in object or artifact storage and are referenced as run
  outputs.

## Implementation Phases

### 1. Shared Contracts

Implemented as pure shared contracts and mapper tests in
`packages/shared/src/workflow-console.ts` and
`packages/shared/tests/workflow-console.test.ts`. This phase does not add a DB
migration.

### 2. Read-Only API Projection

Implemented as authenticated, project-scoped list/detail APIs at
`/api/projects/:projectId/workflow-console/runs`. The projection adapts chat
runs scoped to the project, agent action rows, Plan8 run summaries,
target-project import jobs, and project synthesis export runs for the requesting
user where source data already exists. It does not mutate run tables or add a
new run table.

### 3. Incremental UI Adoption

Reuse the projection in the current Agent Panel and Plan8 surfaces. Avoid a
broad Agent Panel rewrite. Keep document-generation, note-action, suggestions,
stale-alert, and audio output placement stable while the shared model proves
itself.

### 4. Generic Controls

Centralize approve, reject, cancel, retry, and stale-preview recovery controls
behind source adapters. Each adapter owns whether the control is available and
which existing endpoint performs it.

### 5. Import/Export And Code Run Adapters

Add adapters for import/export jobs and future code agent runs after their
durable source statuses are stable. Code run logs and previews should be outputs
of the console, not a separate run dashboard.

## Consequences

This creates one product language for long-running work without blocking current
feature progress on a risky schema migration. It also lets the UI converge
gradually: Agent Panel, Plan8, document-generation cards, import/export pages,
and code project tabs can keep their existing placement while sharing status,
events, approvals, outputs, and error behavior.

The tradeoff is that the first implementation must write careful adapters and
tests. The same run may appear with a source-specific ID and a normalized
console ID until the source contracts are eventually consolidated.

## Non-Goals

- Do not implement the console in this ADR-only slice.
- Do not add DB migrations before a concrete implementation phase requires
  them.
- Do not rewrite `apps/web/src/components/agent-panel/*` as part of the spec.
- Do not add provider-specific import/export UX.
- Do not replace Temporal, durable chat runs, the agent action ledger, or
  project-object actions.
- Do not introduce unrestricted server-side arbitrary code execution.
