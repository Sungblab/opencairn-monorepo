# Agent Generated Files And Viewers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent chat can create durable project files that are stored, ingested, shown in the explorer, opened in the right viewer, downloaded, versioned, compiled when relevant, and connected to existing canvas/code execution.

**Architecture:** Add `agent_files` as a first-class project object beside folders and notes. API owns storage upload, ingest startup, compile/version actions, and chat SSE materialization; web renders these rows through the app-shell tab system and dispatches viewers by file kind. Existing upload ingest, synthesis export, source viewer, data viewer, Canvas, and Tectonic paths are reused instead of adding duplicate runtimes.

**Tech Stack:** Drizzle/Postgres, Hono/Zod, Temporal ingest workflow, MinIO/R2 object storage, Next.js 16, TanStack Query, app-shell tabs, Monaco, existing Pyodide iframe sandbox, Tectonic compile service.

---

## File Structure

- `packages/db/src/schema/agent-files.ts`: Drizzle table, indexes, enums-as-text constraints.
- `packages/db/src/client.ts`: register `agentFiles` in the Drizzle schema object.
- `packages/db/src/index.ts`: export the new schema module.
- `packages/shared/src/agent-files.ts`: shared Zod contracts, file kind registry, metadata types.
- `packages/shared/src/index.ts`: public export.
- `apps/api/src/lib/agent-file-fence.ts`: parse and strip ```agent-file fences from LLM output.
- `apps/api/src/lib/agent-files.ts`: create/version/download/ingest/compile helpers with storage and permission-safe metadata.
- `apps/api/src/routes/agent-files.ts`: authenticated REST routes.
- `apps/api/src/app.ts`: mount `/api/agent-files`.
- `apps/api/src/lib/tree-queries.ts`: include generated files in project tree rows.
- `apps/api/src/routes/projects.ts`: propagate agent-file tree rows and tree events.
- `apps/api/src/routes/threads.ts`: persist chat-generated files and stream `agent_file_created`.
- `apps/api/src/routes/chat.ts`: apply the same file materialization to chat-scope SSE.
- `apps/api/src/lib/chat-llm.ts`: add `agent_file` chunk contract and system prompt instructions.
- `apps/web/src/stores/tabs-store.ts`: add `TabKind = "agent_file"` and `TabMode = "agent-file"`.
- `apps/web/src/lib/tab-factory.ts`: create file tabs.
- `apps/web/src/hooks/use-project-tree.ts`: add `agent_file` node type and invalidation events.
- `apps/web/src/components/sidebar/project-tree.tsx`: move, rename, delete file rows.
- `apps/web/src/components/sidebar/project-tree-node.tsx`: file icons and tab opening behavior.
- `apps/web/src/components/tab-shell/tab-mode-router.tsx`: route `agent-file` mode.
- `apps/web/src/components/tab-shell/viewers/agent-file-viewer.tsx`: metadata loader, toolbar, viewer dispatch.
- `apps/web/src/components/tab-shell/viewers/markdown-file-viewer.tsx`: Markdown/text source and preview.
- `apps/web/src/components/tab-shell/viewers/latex-file-viewer.tsx`: source view, compile action, PDF preview.
- `apps/web/src/components/tab-shell/viewers/html-file-viewer.tsx`: sandboxed iframe.
- `apps/web/src/components/tab-shell/viewers/code-file-viewer.tsx`: source view and canvas materialization.
- `apps/web/src/components/tab-shell/viewers/image-file-viewer.tsx`: image preview.
- `apps/web/src/messages/ko/agent-files.json` and `apps/web/src/messages/en/agent-files.json`: user-facing copy.
- Relevant tests next to each layer.

---

### Task 1: Database And Shared Contracts

**Files:**
- Create: `packages/db/src/schema/agent-files.ts`
- Modify: `packages/db/src/client.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/shared/src/agent-files.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/agent-files.test.ts`

- [ ] **Step 1: Add shared schema tests**

Create `packages/shared/src/agent-files.test.ts` with cases for allowed file kinds, inline content limits, safe filenames, and metadata returned to the browser.

Run: `pnpm --filter @opencairn/shared test agent-files`

Expected: FAIL because `./agent-files` does not exist.

- [ ] **Step 2: Add shared contracts**

Create `packages/shared/src/agent-files.ts` with `agentFileKindSchema`, `createAgentFileSchema`, `agentFileSummarySchema`, `agentFileVersionSchema`, and `agentFileSseEventSchema`. The create schema accepts either UTF-8 `content` or base64 `base64`, limits chat inline files to 1 MiB, caps batch creation at 5 files, and rejects path separators in filenames.

Export from `packages/shared/src/index.ts`:

```ts
export * from "./agent-files";
```

- [ ] **Step 3: Add Drizzle schema**

Create `packages/db/src/schema/agent-files.ts` with `agentFiles = pgTable("agent_files", ...)`, foreign keys to `workspaces`, `projects`, `folders`, `users`, and `notes`, unique indexes for `object_key` and `(version_group_id, version)`, and nullable links to `source_note_id` and `canvas_note_id`.

Register it in `packages/db/src/client.ts`:

```ts
import * as agentFiles from "./schema/agent-files";

const schema = {
  ...agentFiles,
  // existing schema modules
};
```

Export it from `packages/db/src/index.ts`:

```ts
export * from "./schema/agent-files";
```

- [ ] **Step 4: Generate migration**

Run: `pnpm db:generate`

Expected: a new generated migration creates `agent_files`; do not hand-number it.

- [ ] **Step 5: Verify contracts**

Run: `pnpm --filter @opencairn/shared test agent-files`

Expected: PASS.

---

### Task 2: API Service And Routes

**Files:**
- Create: `apps/api/src/lib/agent-files.ts`
- Create: `apps/api/src/routes/agent-files.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/agent-files.test.ts`

- [ ] **Step 1: Write API route tests**

Cover create, metadata read, byte download headers, rename, move, version creation, soft delete, cross-project forbidden access, ingest retry, and LaTeX compile-disabled response.

Run: `pnpm --filter @opencairn/api test agent-files`

Expected: FAIL because the route is missing.

- [ ] **Step 2: Implement service helpers**

`apps/api/src/lib/agent-files.ts` must provide:

```ts
export async function createAgentFile(input: CreateAgentFileInput): Promise<AgentFileSummary>;
export async function createAgentFileVersion(input: CreateAgentFileVersionInput): Promise<AgentFileSummary>;
export async function getAgentFileForRead(id: string, userId: string): Promise<AgentFileRecord>;
export async function streamAgentFile(id: string, userId: string): Promise<Response>;
export async function startAgentFileIngest(id: string, userId: string): Promise<AgentFileSummary>;
export async function compileAgentFile(id: string, userId: string): Promise<AgentFileSummary>;
export async function registerExistingObjectAsAgentFile(input: RegisterExistingObjectInput): Promise<AgentFileSummary>;
```

Use existing `uploadObject`, `streamObject`, Temporal `IngestWorkflow` startup shape from `apps/api/src/routes/ingest.ts`, and project permission helpers.

- [ ] **Step 3: Add REST routes**

`apps/api/src/routes/agent-files.ts` exposes:

```ts
agentFilesRoute.post("/");
agentFilesRoute.get("/:id");
agentFilesRoute.get("/:id/file");
agentFilesRoute.get("/:id/compiled");
agentFilesRoute.patch("/:id");
agentFilesRoute.post("/:id/versions");
agentFilesRoute.post("/:id/ingest");
agentFilesRoute.post("/:id/compile");
agentFilesRoute.delete("/:id");
```

Mount in `apps/api/src/app.ts` before note fallback routes:

```ts
app.route("/api/agent-files", agentFilesRoute);
```

- [ ] **Step 4: Verify API**

Run: `pnpm --filter @opencairn/api test agent-files`

Expected: PASS.

---

### Task 3: Chat Materialization

**Files:**
- Create: `apps/api/src/lib/agent-file-fence.ts`
- Modify: `apps/api/src/lib/chat-llm.ts`
- Modify: `apps/api/src/routes/threads.ts`
- Modify: `apps/api/src/routes/chat.ts`
- Test: `apps/api/src/lib/agent-file-fence.test.ts`
- Test: `apps/api/src/routes/threads.agent-files.test.ts`

- [ ] **Step 1: Write parser tests**

Cover one fenced JSON block, multiple files, invalid JSON, visible text stripping, and coexistence with `save-suggestion`.

Run: `pnpm --filter @opencairn/api test agent-file-fence`

Expected: FAIL because parser is missing.

- [ ] **Step 2: Implement parser and chat chunk**

Add `agent_file` to `ChatChunk` and parse:

```ts
type ChatChunk =
  | ExistingChatChunk
  | { type: "agent_file"; files: CreateAgentFilePayload[] };
```

The system prompt must tell the LLM that files are emitted only through ```agent-file JSON fences and that raw object keys are server-owned.

- [ ] **Step 3: Persist files in SSE routes**

In `threads.ts` and `chat.ts`, when a chunk has `type === "agent_file"`, call `createAgentFile` with `source: "agent_chat"`, current user, project, thread/message context, then send:

```ts
sendSse(controller, { type: "agent_file_created", file: summary });
```

Store `meta.agent_files = AgentFileSummary[]` on the assistant message.

- [ ] **Step 4: Verify chat file SSE**

Run: `pnpm --filter @opencairn/api test agent-file-fence threads.agent-files`

Expected: PASS.

---

### Task 4: Project Tree Integration

**Files:**
- Modify: `apps/api/src/lib/tree-queries.ts`
- Modify: `apps/api/src/routes/projects.ts`
- Modify: `apps/web/src/hooks/use-project-tree.ts`
- Modify: `apps/web/src/components/sidebar/project-tree.tsx`
- Modify: `apps/web/src/components/sidebar/project-tree-node.tsx`
- Test: `apps/api/src/lib/tree-queries.test.ts`
- Test: `apps/web/src/components/sidebar/project-tree.agent-files.test.tsx`

- [ ] **Step 1: Write tree tests**

API test verifies `listChildren` returns folders, notes, and `agent_file` rows with `fileKind` and `mimeType`. Web test clicks an agent file row and opens an app-shell tab without navigating to a note route.

- [ ] **Step 2: Extend tree rows**

Add `kind: "agent_file"` rows to tree queries and sort them with notes. Expose `tree.agent_file_created`, `tree.agent_file_renamed`, `tree.agent_file_moved`, and `tree.agent_file_deleted` invalidation events.

- [ ] **Step 3: Extend web tree behavior**

Click opens:

```ts
addOrActivateTab(
  newTab({
    kind: "agent_file",
    targetId: node.id,
    title: node.label,
    mode: "agent-file",
  }),
);
```

Move, rename, and delete call `/api/agent-files/:id`.

- [ ] **Step 4: Verify tree behavior**

Run: `pnpm --filter @opencairn/api test tree-queries`

Run: `pnpm --filter @opencairn/web test project-tree.agent-files`

Expected: PASS.

---

### Task 5: App-Shell File Viewers

**Files:**
- Modify: `apps/web/src/stores/tabs-store.ts`
- Modify: `apps/web/src/lib/tab-factory.ts`
- Modify: `apps/web/src/components/tab-shell/tab-mode-router.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/agent-file-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/markdown-file-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/latex-file-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/html-file-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/code-file-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/image-file-viewer.tsx`
- Test: `apps/web/src/components/tab-shell/agent-file-viewer.test.tsx`

- [ ] **Step 1: Write viewer tests**

Tests cover Markdown preview, LaTeX compile button disabled/enabled states, HTML sandbox iframe attributes, image preview, download link, and code file "Create Canvas" action.

- [ ] **Step 2: Add tab mode**

Extend tab types:

```ts
export type TabKind = ExistingTabKind | "agent_file";
export type TabMode = ExistingTabMode | "agent-file";
```

Route `agent-file` in `TabModeRouter`.

- [ ] **Step 3: Implement viewer dispatcher**

`AgentFileViewer` loads `/api/agent-files/:id`, renders a toolbar with original download, ingest status, compile status, version number, and dispatches by `file.kind`.

- [ ] **Step 4: Implement specialized viewers**

Use safe viewers:

- Markdown/text/LaTeX/code: fetch original text from `/api/agent-files/:id/file` and render source.
- HTML: `<iframe sandbox="allow-scripts" src="/api/agent-files/:id/file" />`.
- PDF: embed `/api/agent-files/:id/file`.
- Image: `<img src="/api/agent-files/:id/file" />`.
- JSON/CSV: reuse `DataViewer` behavior where possible.

- [ ] **Step 5: Verify viewers**

Run: `pnpm --filter @opencairn/web test agent-file-viewer tab-mode-router`

Expected: PASS.

---

### Task 6: LaTeX Compile And Code Canvas Bridge

**Files:**
- Modify: `apps/api/src/lib/agent-files.ts`
- Modify: `apps/api/src/routes/agent-files.ts`
- Modify: `apps/web/src/components/tab-shell/viewers/latex-file-viewer.tsx`
- Modify: `apps/web/src/components/tab-shell/viewers/code-file-viewer.tsx`
- Test: `apps/api/src/routes/agent-files.compile.test.ts`
- Test: `apps/web/src/components/tab-shell/latex-file-viewer.test.tsx`
- Test: `apps/web/src/components/tab-shell/code-file-viewer.test.tsx`

- [ ] **Step 1: Add compile tests**

Cover `FEATURE_TECTONIC_COMPILE=false` returning `{ code: "compile_disabled" }`, successful compile setting `compiled_object_key`, and compile errors returning sanitized messages.

- [ ] **Step 2: Reuse Tectonic compile path**

Call the existing Tectonic compile endpoint/client used by synthesis export. Store compiled PDF metadata on `agent_files.compiled_object_key` and `compiled_mime_type = "application/pdf"`.

- [ ] **Step 3: Add code-to-canvas action**

Create or update a canvas note from the current file version, set `agent_files.canvas_note_id`, and open an existing `canvas` tab. Keep execution in the browser sandbox.

- [ ] **Step 4: Verify compile and canvas bridge**

Run: `pnpm --filter @opencairn/api test agent-files.compile`

Run: `pnpm --filter @opencairn/web test latex-file-viewer code-file-viewer`

Expected: PASS.

---

### Task 7: Synthesis Export Registration

**Files:**
- Modify: `apps/api/src/lib/agent-files.ts`
- Modify: `apps/api/src/routes/synthesis-export.ts`
- Test: `apps/api/src/routes/synthesis-export.agent-files.test.ts`

- [ ] **Step 1: Add registration tests**

When a synthesis document completes, registering it as a project file creates an `agent_files` row with the existing S3 key and shows it in the explorer.

- [ ] **Step 2: Call registration helper**

After synthesis export stores a document, call `registerExistingObjectAsAgentFile` with source `synthesis_export`, title, filename, MIME, byte size when known, workspace, project, and creator.

- [ ] **Step 3: Verify synthesis registration**

Run: `pnpm --filter @opencairn/api test synthesis-export.agent-files`

Expected: PASS.

---

### Task 8: i18n, Docs, And Completion Audit

**Files:**
- Create: `apps/web/src/messages/ko/agent-files.json`
- Create: `apps/web/src/messages/en/agent-files.json`
- Modify: web message registry file discovered during implementation
- Modify: `docs/contributing/plans-status.md`
- Modify: `docs/contributing/feature-registry.md`

- [ ] **Step 1: Add user-facing copy**

Add Korean and English strings for file viewer toolbar, compile statuses, ingest statuses, download actions, version labels, and errors.

- [ ] **Step 2: Run parity**

Run: `pnpm --filter @opencairn/web i18n:parity`

Expected: PASS.

- [ ] **Step 3: Update docs**

Add this plan/spec to status and feature registry with owned paths and implemented surfaces.

- [ ] **Step 4: Run focused verification**

Run:

```bash
pnpm --filter @opencairn/shared test agent-files
pnpm --filter @opencairn/api test agent-files agent-file-fence tree-queries synthesis-export.agent-files
pnpm --filter @opencairn/web test agent-file-viewer project-tree.agent-files tab-mode-router
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/api typecheck
pnpm --filter @opencairn/web typecheck
```

Expected: all targeted checks pass or unrelated pre-existing failures are documented with evidence.

- [ ] **Step 5: Commit**

Use OpenCairn commit conventions:

```bash
git status --short
git add packages apps docs
git commit -m "feat: add agent generated project files"
```

---

## Self-Review

- Spec coverage: durable storage, DB row, chat SSE, explorer, viewer dispatch, download, ingest, versioning, LaTeX compile, code execution bridge, synthesis registration, permissions, and i18n are covered by Tasks 1-8.
- Placeholder scan: this plan intentionally avoids `TBD`, `TODO`, `placeholder`, and deferred implementation language.
- Type consistency: shared `AgentFileSummary`, API service return shape, SSE `agent_file_created`, tree `kind: "agent_file"`, and web tab `kind: "agent_file" / mode: "agent-file"` use the same names across tasks.
