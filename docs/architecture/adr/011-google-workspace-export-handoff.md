# 011. Google Workspace Export Handoff

## Status

Accepted as a design direction. Implementation is split into later phases.

## Context

ADR 010 established that generated documents are OpenCairn project objects
first. Phase 3 now generates PDF, DOCX, PPTX, and XLSX artifacts through worker
jobs, stores them in object storage, registers them as `agent_files`, and shows
preview/download actions in the existing Agent Panel and tab-shell surfaces.

The next product question is whether generated files can move into Google
Workspace. Google export is useful because advanced Office-style editing is
better delegated to Docs, Sheets, and Slides than rebuilt inside OpenCairn.
However, self-hosted OpenCairn must continue to work without Google credentials,
and Google login must not imply Drive/Docs write consent.

## Decision

OpenCairn will implement Google Workspace export as an optional provider
handoff from an existing generated project object.

- The OpenCairn `agent_files` row and object-storage artifact remain the source
  of truth.
- `export_project_object` is the action entrypoint for `google_drive`,
  `google_docs`, `google_sheets`, and `google_slides`.
- Google export requires a separate, least-privilege, revocable
  Workspace/Drive grant. The default target scope should be `drive.file` so
  OpenCairn can access files it creates or files the user explicitly shares
  with it. Authentication through Google as an identity provider is not enough.
- External export runs through Temporal and worker activities because it calls a
  provider, refreshes OAuth tokens, may retry, and needs terminal status.
- Provider export metadata should reuse connector accounts and connector audit
  events where they fit. Current connector external object references do not yet
  link back to `agent_files` and do not carry export status, exported MIME type,
  or stable provider error codes, so the implementation must not force generated
  file exports into that table without either extending the schema or adding a
  narrowly scoped provider-export record.
- The first UI surface is an export action/status/link on existing project
  object cards and viewers, not a new Google-specific generation form.

## Supported First Targets

| Source artifact | Provider | Result |
| --- | --- | --- |
| Any generated file | Google Drive | Raw Drive file upload |
| DOCX | Google Docs | Converted Google Docs document |
| XLSX | Google Sheets | Converted Google Sheets spreadsheet |
| PPTX | Google Slides | Converted Google Slides deck |
| PDF | Google Drive | Drive-hosted PDF |

The first phase does not sync edits back from Google into OpenCairn and does not
try to convert arbitrary unsupported formats.

## Implementation Split

### 1. Contract And API Gate

Extend the shared project-object action/event contracts with provider export
terminal metadata: provider, external object ID, external URL, exported MIME
type, export status, and stable error code. The API should validate:

- authenticated user, workspace, and project scope;
- object ownership through the existing agent-file/project-object checks;
- provider/file compatibility;
- Google connector grant status and least-privilege Drive scopes, with
  `drive.file` as the default design target;
- idempotency by request ID where the existing action ledger supports it.

### 2. Worker Google Export

Add a focused Temporal workflow and activities for provider export. The worker
should read the already-generated object-storage artifact, refresh or fetch the
Drive access token through the existing credential boundary, upload the artifact,
request conversion for DOCX/XLSX/PPTX when the selected provider requires a
native Google type, and return terminal metadata.

Offline tests should mock Google clients and token refresh. Live Google smoke
should stay operator-controlled because it requires real OAuth credentials and
disposable Drive fixtures.

### 3. Metadata And Audit

Persist successful exports as external provider references linked back to the
OpenCairn project object. Existing connector metadata should be reused only
where the current schema actually represents the export relationship:

- `connector_accounts` for the user-owned Google account;
- `connector_sources` only when a Drive folder or export destination needs a
  stable source boundary;
- `connector_audit_events` for the external send action.

The current `external_object_refs` table is not sufficient by itself for
generated-file export state because it lacks a direct `agent_files` reference
and does not store exported MIME type, terminal status, or stable error codes.
The implementation should therefore choose one of two explicit paths before
persisting provider export results:

1. extend connector metadata with a generated project-object reference and the
   required export-status fields; or
2. add a narrowly scoped provider-export record linked to the OpenCairn project
   object and, when useful, to connector account/source metadata.

Do not treat `external_object_refs` as the sole source of provider export state
unless that schema gap has been closed.

### 4. Existing UI Surfaces

Expose provider exports from the current project-object surfaces:

- Agent Panel document generation result card;
- agent-file viewer actions;
- future workflow console events.

The UI should show pending/running/completed/failed export status, preserve the
OpenCairn download action, and open the external Google URL only after export
completion.

## Foundation Slice Notes

The first executable foundation adds a mocked Google export API and worker
skeleton without a DB migration or live Google API call:

- API work starts `file.export` agent actions for `google_drive`,
  `google_docs`, `google_sheets`, and `google_slides` after checking project
  write access, existing `agent_files` scope, provider/file compatibility, and
  a user/workspace Google Drive grant with `drive.file`.
- Worker work registers a feature-gated `GoogleWorkspaceExportWorkflow` and an
  `export_project_object_to_google_workspace` activity. The activity reads the
  existing object-storage artifact and supports mocked Drive upload/conversion
  tests; the default live client deliberately returns
  `google_export_live_disabled`.
- Export terminal metadata is now represented in shared action events, but
  successful provider export persistence is still not written to
  `external_object_refs`. That table cannot yet directly link an
  `agent_files` project object or carry exported MIME type, terminal status, and
  stable provider error codes. A later slice must either extend connector
  metadata or add a narrow provider-export record before treating persisted
  Google export state as durable.

## Consequences

This keeps the OSS and self-host path stable: users can generate, preview, and
download files without Google. Hosted or user-configured deployments can add
Google export as a clear external action with audit metadata and revocable
consent.

The tradeoff is that Google export cannot be treated as a quick link decoration.
It needs action status, token/grant handling, provider error mapping, and tests
that prove a failed Google export does not corrupt or hide the OpenCairn
artifact.

## Non-Goals

- Do not implement Google Workspace export in this ADR-only slice.
- Do not add a DB migration until metadata fit is proven.
- Do not add provider-specific generation UX or a new generation page.
- Do not make Google required for document generation.
- Do not implement two-way Google Docs/Sheets/Slides sync.
- Do not replace OpenCairn object storage, preview, or download semantics.
