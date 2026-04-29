# Connector Platform — Design Spec

**Status:** Draft (2026-04-29). Implementation plans are split by subsystem.
**Owner:** Sungbin
**Author:** Sungbin + Codex
**Related docs:**

- `docs/architecture/agent-platform-roadmap.md` — A1 MCP client priority
- `docs/superpowers/specs/2026-04-28-mcp-client-design.md` — current generic MCP client Phase 1
- `docs/superpowers/specs/2026-04-22-ingest-source-expansion-design.md` — Drive + Notion ZIP import baseline
- `docs/architecture/data-flow.md` — ingest -> enrichment -> compiler -> KG
- `docs/architecture/collaboration-model.md` — workspace boundary and page/project permissions
- `docs/architecture/security-model.md` — token storage, BYOK posture, scope checks

## 1. Goal

Build a hosted-SaaS-first connector platform that lets OpenCairn connect to external knowledge systems, import selected objects into the existing ingest and KG pipeline, and expose safe connector tools to agents without weakening workspace boundaries.

This spec is an umbrella design. It intentionally produces several implementation plans instead of one large PR:

1. Connector foundation
2. Google Drive connector v2
3. GitHub connector import
4. Notion connector import
5. Connector provenance UI
6. Generic MCP tools

## 2. Current Baseline

OpenCairn already has pieces of this platform:

- Generic MCP registration exists behind `FEATURE_MCP_CLIENT`:
  - `apps/api/src/routes/mcp.ts`
  - `apps/api/src/lib/mcp-runner.ts`
  - `apps/worker/src/runtime/mcp/`
  - `packages/db/src/schema/user-mcp-servers.ts`
- Drive and Notion one-shot imports exist:
  - `apps/api/src/routes/import.ts`
  - `apps/worker/src/worker/workflows/import_workflow.py`
  - `apps/worker/src/worker/activities/drive_activities.py`
  - `apps/worker/src/worker/activities/notion_activities.py`
  - `apps/web/src/app/[locale]/app/w/[wsSlug]/import/`
- The downstream knowledge path is already established:
  - `IngestWorkflow`
  - content-aware enrichment
  - `CompilerAgent`
  - concepts, backlinks, visualization, connector/curator agents

The missing layer is a product-grade connector model: account ownership, workspace source grants, tool risk classification, audit, provenance, and provider-specific import UX that all share one contract.

## 3. Product Shape

OpenCairn gets two connector entry points.

### 3.1 Settings > Connectors

The global connector hub is for account and security management:

- connect/disconnect external accounts
- refresh or revoke tokens
- inspect provider scopes
- grant sources to workspaces or projects
- view MCP tool catalogs and risk tiers
- inspect audit events

This page owns long-lived account state. It does not start bulk import jobs directly.

### 3.2 Workspace Import

The workspace import route remains the place where users bring content into OpenCairn:

- choose provider: Drive, GitHub, Notion, or generic MCP
- pick external objects
- preview object tree and import estimate
- start one-shot import or sync
- watch job progress
- inspect imported notes and provenance

The route should continue to live under the App Shell import surface, but it should draw its connected accounts and source grants from the shared connector model.

## 4. Connector Taxonomy

The platform distinguishes first-class connectors from generic MCP connectors.

### 4.1 First-Class Connectors

First-class connectors have product-owned UX and import semantics:

- `google_drive`
- `github`
- `notion`

They may use native APIs, official remote MCP servers, or both. The important point is that OpenCairn owns the user workflow, source preview, provenance mapping, and import behavior.

### 4.2 Generic MCP Connectors

Generic MCP connectors are advanced connectors registered by URL. They expose tools to agents after cataloging and risk classification.

Generic MCP is not the primary path for Drive/GitHub/Notion import in v0. It is a standard tool layer and an escape hatch for custom systems.

## 5. Data Model

The connector platform should add generic tables and gradually bridge existing provider-specific tables into them. Existing tables are not deleted in the first plan.

### 5.1 `connector_accounts`

One row per connected external account.

Key fields:

- `id`
- `user_id`
- `provider`: `google_drive | github | notion | mcp_custom`
- `auth_type`: `oauth | pat | static_header | none`
- `account_label`
- `account_email`
- `external_account_id`
- `scopes`
- `access_token_encrypted`
- `refresh_token_encrypted`
- `token_expires_at`
- `status`: `active | disabled | auth_expired | revoked`
- `created_at`
- `updated_at`

Rules:

- Tokens are user-owned, not workspace-owned.
- Plaintext tokens never leave API/worker internals.
- `mcp_custom` may store a static auth header in the same encrypted token envelope.
- Existing `user_integrations` and `user_mcp_servers` are bridged to this model before they are folded in.

### 5.2 `connector_sources`

One row per external source granted to a workspace or project.

Key fields:

- `id`
- `workspace_id`
- `project_id`
- `account_id`
- `provider`
- `source_kind`: `drive_folder | drive_file | github_repo | notion_workspace | notion_page_tree | mcp_server`
- `external_id`
- `display_name`
- `sync_mode`: `one_shot | manual_resync | scheduled`
- `permissions`: JSON object containing provider-specific read/import/write flags
- `status`
- `created_by_user_id`
- `created_at`
- `updated_at`

Rules:

- Account connection alone grants nothing to a workspace.
- A source grant is required before preview, import, or agent tool exposure can use the account.
- `project_id` is nullable so workspace-wide sources are possible, but v0 import jobs should prefer project-scoped grants where a project is selected.
- `scheduled` is a reserved enum value in the foundation plan. v0 UI exposes `one_shot` and `manual_resync`; scheduled refresh becomes active only after queueing, rate-limit, and deletion-reconciliation behavior is specified.

### 5.3 `external_object_refs`

Provenance rows linking external objects to OpenCairn objects.

Key fields:

- `id`
- `workspace_id`
- `provider`
- `source_id`
- `external_id`
- `external_url`
- `object_type`: `file | folder | page | database | repo | issue | pull_request | comment | action_run | code_file | mcp_result`
- `external_version`: ETag, commit SHA, updated timestamp, content hash, or provider version
- `note_id`
- `concept_id`
- `concept_edge_id`
- `import_job_id`
- `last_seen_at`
- `created_at`
- `updated_at`

Rules:

- At least one internal object reference must be present once an import succeeds.
- Multiple external objects may map to one OpenCairn note when the import deliberately bundles them.
- One external object may map to multiple concepts or edges through compiler/KG extraction.
- This table is the canonical bridge for future sync reconciliation.

### 5.4 `connector_jobs`

A provider-neutral parent job for import, sync, and tool refresh work.

Key fields:

- `id`
- `workspace_id`
- `user_id`
- `source_id`
- `job_type`: `import | sync | refresh_tools | preview`
- `workflow_id`
- `status`
- `total_items`
- `completed_items`
- `failed_items`
- `skipped_items`
- `source_metadata`
- `error_summary`
- `started_at`
- `finished_at`
- `created_at`

Rules:

- The existing `import_jobs` table is preserved during migration.
- New connector plans should create `connector_jobs` and may also write compatibility rows into `import_jobs` until the UI is moved.
- Partial success is represented as `status=completed` with non-zero `failed_items`.
- `sync` means "fetch a new external snapshot into OpenCairn"; it does not mean two-way sync or remote deletion reconciliation in v0.

### 5.5 `connector_audit_events`

Append-only audit trail.

Key fields:

- `id`
- `workspace_id`
- `user_id`
- `account_id`
- `source_id`
- `job_id`
- `action`
- `risk_level`: `safe_read | import | write | destructive | external_send | unknown`
- `provider`
- `metadata`
- `created_at`

Rules:

- Account connect/disconnect, token refresh failure, source grant changes, import start, import cancel, MCP tool exposure, and blocked write/destructive actions all emit audit events.
- Audit metadata must redact token values and user-provided secrets.
- Audit events should be queryable by workspace owner/admin.

## 6. Permission Model

The permission model has three layers.

### 6.1 Account Ownership

The user who connects an account owns the encrypted tokens. A workspace admin cannot read or use a connected account unless the owner grants a source to that workspace.

### 6.2 Workspace Source Grant

A connector source grant authorizes a bounded external source for a workspace or project. Examples:

- one Drive folder
- one GitHub repository
- one Notion workspace or page subtree
- one MCP server with a selected read-only toolset

All API routes that preview or import external objects require both:

- authenticated user
- workspace/project permission to write/import into the target
- source grant owned by the same workspace

### 6.3 Tool and Action Permission

Tools and provider actions are classified before exposure:

| Risk tier | Examples | v0 behavior |
| --- | --- | --- |
| `safe_read` | search, list, fetch, get | allowed after source grant |
| `import` | snapshot/import selected external object | allowed after source grant and target write permission |
| `write` | create, update, comment | cataloged, blocked by default |
| `destructive` | delete, remove, archive | cataloged, blocked by default |
| `external_send` | send, invite, share, publish | cataloged, blocked by default |
| `unknown` | ambiguous tool/action | blocked until explicitly classified |

This default is intentionally conservative for hosted SaaS. Write-capable tools become a separate plan with confirmation UX and stronger audit.

## 7. Provider Flows

### 7.1 Google Drive

Drive is a first-class native connector, not a generic MCP connector in v0.

Login and connector identity remain separate:

- Google login users can add Drive through incremental OAuth consent.
- Email/password users can connect Drive through a normal Google OAuth flow.
- Both paths create the same `connector_accounts(provider='google_drive')` shape.

Drive scope:

- Use `https://www.googleapis.com/auth/drive.file` as the default import scope.
- Request Drive scope at first Drive action, not at sign-in.
- Request offline access for hosted import jobs that may need token refresh during long workflows.

Import flow:

```text
connect Drive account
  -> grant selected Drive folder or file source
  -> Picker selects files/folders
  -> connector job starts
  -> Drive native client fetches files
  -> existing ImportWorkflow/IngestWorkflow processes binaries
  -> external_object_refs record Drive file/folder provenance
```

The existing Drive import worker path stays useful, but token lookup and job tracking should move from provider-specific tables into connector platform tables.

### 7.2 GitHub

GitHub is a first-class developer connector.

Supported account paths:

- hosted SaaS: GitHub OAuth app or GitHub App installation flow
- self-host fallback: PAT stored as a connector account
- generic MCP fallback: official GitHub MCP server URL or local server, cataloged through generic MCP

v0 import scopes:

- repository README and docs
- selected files or folders
- issues and comments
- pull requests and review comments
- workflow run summaries and failed logs

v0 does not create issues, comment on PRs, push commits, or mutate GitHub state.

Import flow:

```text
connect GitHub
  -> grant repo source to workspace/project
  -> preview branches, docs, issues, PRs, Actions runs
  -> start connector job
  -> fetch snapshot with commit SHA / issue updated_at / run id
  -> create source notes
  -> compiler extracts repo topics, labels, concepts, and entities
  -> external_object_refs link notes/concepts back to GitHub objects
```

GitHub MCP toolsets are useful for agent tool access, but source import should use product-owned preview and snapshot behavior for predictable provenance.

### 7.3 Notion

Notion is a first-class migration connector.

Supported paths:

- official Notion MCP remote server + OAuth for connected workspace access
- ZIP import fallback for bulk migration and self-host users

v0 import scopes:

- page tree
- page content
- files attached to pages
- database CSV/source artifacts as source notes

v0 does not attempt full Notion database to OpenCairn database fidelity. Database rows/properties are imported as structured artifacts and provenance, not as a new database feature.

Import flow:

```text
connect Notion
  -> grant Notion workspace or page subtree source
  -> preview page tree
  -> start connector job
  -> fetch pages or unzip export
  -> convert pages to Plate notes where possible
  -> route binaries through existing ingest
  -> external_object_refs link Notion pages/databases/files to notes/concepts
```

### 7.4 Generic MCP

Generic MCP remains a power-user connector.

Supported v0 behavior:

- register Streamable HTTP MCP server
- run `list_tools`
- cache tool catalog
- classify risk tier
- allow only safe-read tools after a source grant
- expose safe-read tools to runtime agents with user/workspace context checks

Generic MCP source import is limited in v0. A generic MCP result may be used as runtime context, but turning arbitrary tool output into a bulk import source requires a follow-up plan with explicit output schemas.

## 8. Common Data Flow

```text
connect account
  -> create connector_account
  -> grant source
  -> create connector_source
  -> preview external object tree
  -> create connector_job
  -> fetch snapshot
  -> normalize to SourceDocument / NoteCandidate
  -> existing ingest, enrichment, compiler path
  -> write external_object_refs
  -> write connector_audit_events
  -> show provenance in note/KG UI
```

Normalization should produce a small internal contract:

```ts
type SourceDocument = {
  provider: "google_drive" | "github" | "notion" | "mcp_custom";
  sourceId: string;
  externalId: string;
  externalUrl?: string;
  objectType: string;
  title: string;
  contentText?: string;
  plateValue?: unknown;
  binaryObjectKey?: string;
  mimeType?: string;
  version?: string;
  metadata: Record<string, unknown>;
};
```

Provider-specific fetchers produce `SourceDocument` records. The rest of the pipeline consumes that shape.

## 9. OpenCairn as an MCP Server

This umbrella spec focuses on OpenCairn as an MCP client and connector platform. It also sets the direction for an OpenCairn MCP server.

Server exposure should be a separate plan with this v0 shape:

- read-only `search`
- read-only `fetch`
- OAuth-protected access
- workspace-scoped search
- citations/provenance in fetch results

This matches the current ChatGPT company knowledge/deep research compatibility expectation that MCP servers provide read-only `search` and `fetch` tools. Write tools such as `create_note` or `start_ingest` are intentionally out of the server v0.

## 10. Security Requirements

Hosted SaaS defaults:

- OAuth and token refresh are first-class.
- PAT/static header are allowed only for GitHub/self-host/custom MCP fallback.
- All connector endpoints use HTTPS except local self-host-only development overrides.
- Tokens are encrypted with the existing integration token/BYOK-style envelope.
- Responses expose `hasAuth`, scopes, status, and account label, never token values.
- Workspace source grants are checked before preview/import/tool exposure.
- Cross-workspace source/job/object IDs return 404.
- MCP URL validation blocks private, loopback, link-local, metadata, multicast, and reserved addresses.
- MCP OAuth flows use PKCE where the remote authorization server supports it and refuse servers whose metadata shows no PKCE support for public-client OAuth.
- Tool output is treated as untrusted content. It can inform agents, but it cannot bypass source grants or write permissions.
- Write/destructive/external-send tools are cataloged and blocked in v0.
- Every connector action with external data movement writes an audit event.

## 11. Testing Strategy

### 11.1 Database

- enum values match provider/risk/status model
- FK cascade behavior is explicit and tested
- unique constraints prevent duplicate account/source/object mappings
- `external_object_refs` rejects cross-workspace object linkage

### 11.2 API

- feature flag off returns 404 for new connector routes
- OAuth state HMAC and nonce validation reject replay
- token values are never returned
- account owner and workspace source grant are both enforced
- cross-workspace source/job/ref IDs return 404
- audit events are emitted for connect, grant, import, blocked action, token expiry

### 11.3 Worker

- provider fetchers use fake clients in unit tests
- connector workflow tolerates item-level failure
- retry does not duplicate `external_object_refs`
- Drive token refresh failure marks account `auth_expired`
- GitHub snapshot stores commit SHA or updated timestamp
- Notion ZIP fallback preserves page hierarchy

### 11.4 MCP

- SSRF guard blocks private and metadata IPs
- tool catalog limit prevents runaway tool declarations
- tool classifier assigns expected risk tiers
- owner user mismatch blocks tool execution
- unknown/write/destructive tools are blocked by default

### 11.5 Web

- connector settings render status without secrets
- Drive incremental consent path is visible for Google login users
- import preview shows provider-specific object tree
- provenance badges render on imported notes
- i18n parity remains green for new copy

## 12. Implementation Plan Split

### Plan A: Connector Foundation

Scope:

- connector tables and enums
- token vault abstraction
- source grants
- connector audit events
- generic connector API surface
- MCP catalog cache and risk classifier

Exit criteria:

- no provider-specific import UX yet
- existing MCP client and existing Drive/Notion paths still work
- tests cover auth, redaction, source grant, audit, SSRF, and classifier behavior

### Plan B: Drive Connector v2

Scope:

- bridge existing Google integration into `connector_accounts`
- support incremental consent for Google login users
- support separate OAuth for non-Google login users
- move Drive import jobs to `connector_jobs`
- write Drive `external_object_refs`

Exit criteria:

- existing Drive UI behavior is preserved
- Drive import provenance is visible through API

### Plan C: GitHub Connector Import

Scope:

- GitHub account connection
- repo source grant
- repo preview
- docs/issues/PR/actions snapshot import
- GitHub provenance refs

Exit criteria:

- read-only GitHub import works without GitHub mutation
- repo issue/PR provenance appears on imported notes

### Plan D: Notion Connector Import

Scope:

- Notion MCP/OAuth account connection
- Notion page tree source grant
- Notion preview/import
- ZIP fallback compatibility
- Notion provenance refs

Exit criteria:

- Notion page tree import works through the connector model
- Notion ZIP remains available for migration

### Plan E: Connector Provenance UI

Scope:

- imported note provenance badge
- source panel with external URL/version/import job
- KG concept provenance view
- connector audit page in settings

Exit criteria:

- users can answer where a note/concept came from without querying the DB

### Plan F: Generic MCP Tools

Scope:

- move `user_mcp_servers` into connector account/source model
- cache tool catalog
- expose safe-read tools to selected agents
- block and audit unsafe tools

Exit criteria:

- generic MCP remains useful without giving agents broad write capability

## 13. Deliberate Non-Goals

- Full two-way sync
- GitHub write automation
- Notion database fidelity as an OpenCairn database feature
- Obsidian local live sync
- OpenCairn MCP server write tools
- Arbitrary generic MCP output as a bulk import source
- Workspace-owned tokens that admins can use without the connecting user

These are product candidates after the connector foundation and first-class import flows prove useful.

## 14. External References Verified

- OpenAI MCP docs: ChatGPT/company knowledge compatibility expects read-only `search` and `fetch` tools for MCP-backed knowledge integrations.
- Anthropic Claude MCP connector docs: Claude API supports remote MCP servers through `mcp_servers` and toolset configuration.
- MCP authorization spec 2025-11-25: OAuth 2.1, HTTPS, secure token storage, and PKCE are required for authorization flows.
- Notion MCP docs: Notion exposes a remote Streamable HTTP MCP endpoint at `https://mcp.notion.com/mcp` and uses OAuth in supported clients.
- GitHub MCP server docs: GitHub offers an official MCP server, remote and local modes, toolsets, and read-only mode.
- Google OAuth web server docs: Google supports incremental authorization and recommends requesting scopes when needed.
